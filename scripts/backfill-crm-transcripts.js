/**
 * Backfill: push all completed call transcripts to AirDesk360 as Tasks.
 *
 * Run inside the pipeline-workers container:
 *   docker cp scripts/backfill-crm-transcripts.js ai-sdr-pipeline-workers-1:/tmp/backfill.js
 *   docker exec ai-sdr-pipeline-workers-1 node /tmp/backfill.js
 *
 * Dry run (no jobs enqueued):
 *   docker exec -e DRY_RUN=true ai-sdr-pipeline-workers-1 node /tmp/backfill.js
 *
 * RUN_ID suffix on every jobId means re-running this script always
 * enqueues fresh jobs — even if a previous run's jobs are in the
 * completed/failed set. Safe to run multiple times (creates duplicate
 * tasks in AirDesk only if run more than once — use DRY_RUN to verify first).
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { Queue }        = require('bullmq');
const { Redis }        = require('ioredis');
const WebSocket        = require('ws');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REDIS_URL                 = process.env.REDIS_URL || 'redis://redis:6379';
const CRM_PROVIDER              = process.env.CRM_PROVIDER || 'none';
const DRY_RUN                   = process.env.DRY_RUN === 'true';
const BATCH_SIZE                = Number(process.env.BATCH_SIZE || 50);

// Unique suffix so re-runs always produce new jobIds (avoids BullMQ dedup
// against completed jobs from previous backfill attempts).
const RUN_ID = Date.now();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}
if (CRM_PROVIDER !== 'airdesk360') {
  console.warn(`⚠️  CRM_PROVIDER="${CRM_PROVIDER}" — only airdesk360 is supported. Exiting.`);
  process.exit(0);
}

async function main() {
  console.log('\n🔄  Backfill: call transcripts → AirDesk360');
  console.log(`   Supabase  : ${SUPABASE_URL}`);
  console.log(`   Redis     : ${REDIS_URL}`);
  console.log(`   Dry run   : ${DRY_RUN}`);
  console.log(`   Batch     : ${BATCH_SIZE}`);
  console.log(`   Run ID    : ${RUN_ID}\n`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    realtime: { transport: WebSocket },
  });

  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue('crm-sync', { connection: redis });

  let offset   = 0;
  let total    = 0;
  let enqueued = 0;
  let skipped  = 0;
  let errors   = 0;

  while (true) {
    const { data: calls, error } = await supabase
      .from('calls')
      .select('id, lead_id, outcome, created_at, call_transcripts!inner(id)')
      .eq('status', 'completed')
      .not('outcome', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('❌  Supabase error:', error.message);
      break;
    }
    if (!calls || calls.length === 0) break;

    total += calls.length;
    console.log(`   Page ${Math.floor(offset / BATCH_SIZE) + 1}: ${calls.length} calls (total: ${total})`);

    for (const call of calls) {
      const jobId = `backfill-call-${call.id}-${RUN_ID}`;

      if (DRY_RUN) {
        console.log(`   [dry-run] callId=${call.id}  outcome=${call.outcome}  jobId=${jobId}`);
        enqueued++;
        continue;
      }

      try {
        await queue.add(
          'sync-call',
          { entity: 'call', entityId: call.id, action: 'create', provider: 'airdesk360' },
          { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
        );
        enqueued++;
        console.log(`   ✓  callId=${call.id}  outcome=${call.outcome}`);
      } catch (e) {
        if (e && e.message && e.message.includes('already exists')) {
          skipped++;
          console.log(`   ·  skipped callId=${call.id} — jobId already in queue`);
        } else {
          errors++;
          console.warn(`   ⚠️  callId=${call.id}: ${e && e.message}`);
        }
      }
    }

    if (calls.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  console.log('\n✅  Done.');
  console.log(`   Calls found  : ${total}`);
  console.log(`   Enqueued     : ${enqueued}`);
  console.log(`   Skipped      : ${skipped}`);
  console.log(`   Errors       : ${errors}`);

  if (!DRY_RUN && enqueued > 0) {
    console.log('\n   Jobs are in the crm-sync queue.');
    console.log('   Watch progress:');
    console.log('   docker compose logs -f pipeline-workers | grep crm-sync\n');
  }

  await queue.close();
  await redis.quit();
}

main().catch(err => {
  console.error('❌  Fatal:', err);
  process.exit(1);
});
