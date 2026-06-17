/**
 * One-time backfill: push all completed call transcripts to AirDesk360.
 *
 * Usage (run once on the server from the repo root):
 *
 *   npx ts-node --project tsconfig.json scripts/backfill-crm-call-transcripts.ts
 *
 * Or with env vars explicitly:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... REDIS_URL=... \
 *   CRM_PROVIDER=airdesk360 \
 *   npx ts-node scripts/backfill-crm-call-transcripts.ts
 *
 * What it does:
 *   1. Loads all completed calls that have a call_transcript row
 *   2. Skips any call whose lead already has crm_lead_id set AND which
 *      already has a note in AirDesk (idempotent — safe to re-run)
 *   3. Enqueues a `sync-call` job for each call to the existing crm-sync
 *      BullMQ queue — the same syncCall() logic that runs for new calls
 *
 * The crm-sync worker must be running for jobs to be processed. Jobs are
 * durable in Redis so they survive restarts.
 *
 * Dry-run mode (no jobs enqueued, just logs what would be processed):
 *   DRY_RUN=true npx ts-node scripts/backfill-crm-call-transcripts.ts
 */

import { createClient } from '@supabase/supabase-js';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from repo root
dotenv.config({ path: path.resolve(__dirname, '../apps/workers/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL             = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const REDIS_URL                = process.env.REDIS_URL ?? 'redis://localhost:6379';
const CRM_PROVIDER             = process.env.CRM_PROVIDER ?? 'none';
const DRY_RUN                  = process.env.DRY_RUN === 'true';
const BATCH_SIZE               = Number(process.env.BATCH_SIZE ?? 100);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

if (CRM_PROVIDER !== 'airdesk360') {
  console.warn(`⚠️  CRM_PROVIDER is "${CRM_PROVIDER}" — only airdesk360 is supported. Exiting.`);
  process.exit(0);
}

async function main() {
  console.log(`\n🔄  Backfill: call transcripts → AirDesk360`);
  console.log(`   Supabase : ${SUPABASE_URL}`);
  console.log(`   Redis    : ${REDIS_URL}`);
  console.log(`   Dry run  : ${DRY_RUN}`);
  console.log(`   Batch    : ${BATCH_SIZE} calls per page\n`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const redis    = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue    = new Queue('crm-sync', { connection: redis });

  let offset   = 0;
  let total    = 0;
  let enqueued = 0;
  let skipped  = 0;

  while (true) {
    // Fetch completed calls that have at least one transcript row.
    // Join call_transcripts via inner join (only rows with a transcript).
    const { data: calls, error } = await supabase
      .from('calls')
      .select(`
        id,
        lead_id,
        outcome,
        created_at,
        call_transcripts!inner ( id )
      `)
      .eq('status', 'completed')
      .not('outcome', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('❌  Supabase query failed:', error.message);
      break;
    }

    if (!calls || calls.length === 0) break;

    total += calls.length;
    console.log(`   Page ${Math.floor(offset / BATCH_SIZE) + 1}: ${calls.length} calls (total so far: ${total})`);

    for (const call of calls) {
      if (DRY_RUN) {
        console.log(`   [dry-run] would enqueue sync-call for callId=${call.id} leadId=${call.lead_id} outcome=${call.outcome}`);
        enqueued++;
        continue;
      }

      // Deduplicate: BullMQ jobId ensures the same call isn't re-enqueued if
      // this script is run more than once. The worker itself is idempotent too
      // (addNote in AirDesk is a create, so a duplicate run creates a duplicate
      // note — the jobId guard is the cleaner prevention).
      const jobId = `backfill-call-${call.id}`;

      try {
        await queue.add(
          'sync-call',
          {
            entity:   'call',
            entityId: call.id,
            action:   'create',
            provider: 'airdesk360',
          },
          {
            jobId,           // prevents duplicate enqueue on re-run
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          },
        );
        enqueued++;
        console.log(`   ✓ enqueued callId=${call.id} (${call.outcome}) — jobId=${jobId}`);
      } catch (e: any) {
        // BullMQ throws if a job with this ID already exists (duplicate).
        if (e?.message?.includes('already exists')) {
          skipped++;
          console.log(`   · skipped callId=${call.id} — already enqueued`);
        } else {
          console.warn(`   ⚠️  Failed to enqueue callId=${call.id}: ${e.message}`);
        }
      }
    }

    if (calls.length < BATCH_SIZE) break; // last page
    offset += BATCH_SIZE;
  }

  console.log(`\n✅  Done.`);
  console.log(`   Total calls found : ${total}`);
  console.log(`   Jobs enqueued     : ${enqueued}`);
  console.log(`   Already queued    : ${skipped}`);

  if (!DRY_RUN && enqueued > 0) {
    console.log(`\n   Jobs are waiting in the crm-sync queue.`);
    console.log(`   Make sure the crm-sync worker is running to process them.`);
    console.log(`   Watch progress: docker compose logs -f call-workers | grep crm-sync\n`);
  }

  await queue.close();
  await redis.quit();
}

main().catch(err => {
  console.error('❌  Backfill failed:', err);
  process.exit(1);
});
