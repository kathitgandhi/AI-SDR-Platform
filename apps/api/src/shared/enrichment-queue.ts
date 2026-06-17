import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

/**
 * Payload consumed by the enrichment worker (apps/workers). Must stay in sync
 * with EnrichmentJobPayload in apps/workers/src/queues/queue.registry.ts.
 *
 * Queue name is 'enrichment' (matches QUEUE_NAMES.ENRICHMENT).
 */
export interface EnrichmentPayload {
  companyId: string;
  leadId: string;
  domain: string;
  website?: string;
}

let redis: IORedis | null = null;
let queue: Queue | null = null;

function getQueue(): Queue {
  if (!redis) redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  if (!queue) queue = new Queue('enrichment', { connection: redis });
  return queue;
}

/** Enqueue enrichment + pipeline routing for a freshly created `new` lead
 *  (e.g. CSV import). Returns the BullMQ job id. */
export async function enqueueEnrichment(payload: EnrichmentPayload): Promise<string> {
  const job = await getQueue().add('enrich', payload);
  return job.id ?? '';
}
