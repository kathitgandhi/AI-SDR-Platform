import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

/**
 * Payload consumed by the phone-lookup worker (apps/workers). Must stay in sync
 * with PhoneLookupJobPayload in apps/workers/src/queues/queue.registry.ts.
 *
 * The queue name is 'phone-lookup' (kebab-case) to match the worker.
 */
export interface PhoneLookupPayload {
  contactId: string;
  leadId: string;
  phone: string;
}

let redis: IORedis | null = null;
let queue: Queue | null = null;

function getQueue(): Queue {
  if (!redis) redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  if (!queue) queue = new Queue('phone-lookup', { connection: redis });
  return queue;
}

/** Enqueue a line-type lookup for a lead's phone. Returns the BullMQ job id. */
export async function enqueuePhoneLookup(payload: PhoneLookupPayload): Promise<string> {
  const job = await getQueue().add('lookup', payload);
  return job.id ?? '';
}
