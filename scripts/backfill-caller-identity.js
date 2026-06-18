/**
 * Backfill: resolve "Unknown Caller" contact names from stored transcripts.
 *
 * For every contact whose first_name starts with "Unknown", this script:
 *   1. Finds the most recent call transcript for that contact
 *   2. Asks Claude to extract caller_name / caller_company / caller_title
 *   3. Updates the contacts + companies rows in Supabase
 *   4. Enqueues a crm-sync job so the updated lead is pushed to AirDesk360
 *
 * Run inside the pipeline-workers container (has all env vars + node_modules):
 *
 *   docker cp scripts/backfill-caller-identity.js ai-sdr-pipeline-workers-1:/tmp/backfill-identity.js
 *   docker exec -e DRY_RUN=true ai-sdr-pipeline-workers-1 node /tmp/backfill-identity.js
 *   docker exec ai-sdr-pipeline-workers-1 node /tmp/backfill-identity.js
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { Queue }        = require('bullmq');
const { Redis }        = require('ioredis');
const WebSocket        = require('ws');
const Anthropic        = require('@anthropic-ai/sdk').default ?? require('@anthropic-ai/sdk');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REDIS_URL                 = process.env.REDIS_URL || 'redis://redis:6379';
const ANTHROPIC_API_KEY         = process.env.ANTHROPIC_API_KEY;
const CRM_PROVIDER              = process.env.CRM_PROVIDER || 'none';
const DRY_RUN                   = process.env.DRY_RUN === 'true';
const BATCH_SIZE                = Number(process.env.BATCH_SIZE || 25);

const RUN_ID = Date.now();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('❌  ANTHROPIC_API_KEY is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Claude: extract caller identity from a transcript (cheap haiku call)
// ---------------------------------------------------------------------------
async function extractCallerIdentity(anthropic, transcript) {
  if (!transcript || transcript.trim().length < 20) return null;

  // Truncate very long transcripts — we only need the opening exchanges
  const text = transcript.length > 3000 ? transcript.substring(0, 3000) : transcript;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',        // cheapest model — just name extraction
    max_tokens: 256,
    system: 'You are a data extraction assistant. Return ONLY valid JSON — no explanation.',
    messages: [{
      role: 'user',
      content: `Extract the inbound caller's identity from this call transcript.
Look for lines where the Prospect (caller) mentions their own name, company, or role.

Transcript:
${text}

Return this JSON (use null if not found):
{
  "caller_name": "<full name or first name the caller used for themselves>",
  "caller_company": "<company the caller mentioned as their own employer>",
  "caller_title": "<job title or role the caller mentioned>"
}`,
    }],
  });

  const raw = response.content[0]?.text?.trim() ?? '';
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('\n🔍  Backfill: resolve Unknown Caller identities from transcripts');
  console.log(`   Supabase  : ${SUPABASE_URL}`);
  console.log(`   Redis     : ${REDIS_URL}`);
  console.log(`   CRM sync  : ${CRM_PROVIDER}`);
  console.log(`   Dry run   : ${DRY_RUN}`);
  console.log(`   Batch     : ${BATCH_SIZE}`);
  console.log(`   Run ID    : ${RUN_ID}\n`);

  const supabase  = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    realtime: { transport: WebSocket },
  });
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const redis     = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue     = CRM_PROVIDER === 'airdesk360'
    ? new Queue('crm-sync', { connection: redis })
    : null;

  let offset   = 0;
  let total    = 0;
  let updated  = 0;
  let noName   = 0;
  let errors   = 0;

  while (true) {
    // Fetch contacts that are still Unknown Caller placeholders
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, title, calls(id, company_id, lead_id, call_transcripts(full_transcript))')
      .ilike('first_name', 'Unknown%')
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('❌  Supabase error:', error.message);
      break;
    }
    if (!contacts || contacts.length === 0) break;

    total += contacts.length;
    console.log(`\n   Page ${Math.floor(offset / BATCH_SIZE) + 1}: ${contacts.length} unknown contacts (total: ${total})`);

    for (const contact of contacts) {
      // Find the first call that has a transcript
      const callWithTranscript = (contact.calls ?? []).find(
        c => c.call_transcripts && c.call_transcripts.length > 0
      );

      if (!callWithTranscript) {
        console.log(`   · contactId=${contact.id} — no transcript available, skipping`);
        noName++;
        continue;
      }

      const transcript = callWithTranscript.call_transcripts[0]?.full_transcript ?? '';

      let identity = null;
      try {
        identity = await extractCallerIdentity(anthropic, transcript);
      } catch (e) {
        console.warn(`   ⚠️  Claude error for contactId=${contact.id}: ${e.message}`);
        errors++;
        continue;
      }

      if (!identity || !identity.caller_name) {
        console.log(`   · contactId=${contact.id} — Claude found no name in transcript`);
        noName++;
        continue;
      }

      const parts     = identity.caller_name.trim().split(/\s+/);
      const firstName = parts[0] ?? identity.caller_name.trim();
      const lastName  = parts.slice(1).join(' ') || null;

      console.log(`   ✓  contactId=${contact.id}  name="${identity.caller_name}"  company="${identity.caller_company ?? '—'}"  title="${identity.caller_title ?? '—'}"`);

      if (DRY_RUN) {
        updated++;
        continue;
      }

      const now = new Date().toISOString();

      // Update contact
      await supabase.from('contacts').update({
        first_name: firstName,
        ...(lastName             ? { last_name: lastName }             : {}),
        ...(identity.caller_title ? { title: identity.caller_title }   : {}),
        updated_at: now,
      }).eq('id', contact.id);

      // Update company name if still a phone-number placeholder
      const companyId = callWithTranscript.company_id;
      if (companyId && identity.caller_company) {
        const { data: co } = await supabase
          .from('companies')
          .select('name')
          .eq('id', companyId)
          .single();
        if (co && co.name && co.name.toLowerCase().startsWith('unknown caller')) {
          await supabase.from('companies').update({
            name: identity.caller_company,
            updated_at: now,
          }).eq('id', companyId);
          console.log(`       company updated → "${identity.caller_company}"`);
        }
      }

      // Enqueue CRM sync so AirDesk360 gets the updated name
      if (queue && callWithTranscript.lead_id) {
        const jobId = `backfill-identity-lead-${callWithTranscript.lead_id}-${RUN_ID}`;
        try {
          await queue.add(
            'sync-lead',
            { entity: 'lead', entityId: callWithTranscript.lead_id, action: 'update', provider: 'airdesk360' },
            { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
          );
          console.log(`       CRM sync enqueued for leadId=${callWithTranscript.lead_id}`);
        } catch (e) {
          if (!(e && e.message && e.message.includes('already exists'))) {
            console.warn(`       ⚠️  CRM sync enqueue failed: ${e && e.message}`);
          }
        }
      }

      updated++;

      // Small delay to avoid hammering Claude / Supabase
      await new Promise(r => setTimeout(r, 300));
    }

    if (contacts.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  console.log('\n✅  Done.');
  console.log(`   Unknown contacts found : ${total}`);
  console.log(`   Updated                : ${updated}`);
  console.log(`   No name in transcript  : ${noName}`);
  console.log(`   Errors                 : ${errors}`);

  if (!DRY_RUN && updated > 0 && queue) {
    console.log('\n   CRM sync jobs queued — watch progress:');
    console.log('   docker compose logs -f pipeline-workers | grep crm-sync\n');
  }

  if (queue) await queue.close();
  await redis.quit();
}

main().catch(err => {
  console.error('❌  Fatal:', err);
  process.exit(1);
});
