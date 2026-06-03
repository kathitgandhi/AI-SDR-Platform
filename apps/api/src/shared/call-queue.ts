import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

/**
 * Payload consumed by the call-executor worker (apps/workers). Must stay in sync
 * with CallExecuteJobPayload in apps/workers/src/queues/queue.registry.ts.
 *
 * NOTE: the queue name is 'call-execute' (kebab-case) to match the worker — the
 * camelCase 'callExecute' used elsewhere in the API for *stats* does NOT match the
 * real BullMQ queue and would never be consumed.
 */
export interface CallExecutePayload {
  leadId: string;
  contactId: string;
  companyId: string;
  campaignId: string;
  phone: string;
  persona: string;
  attemptNumber: number;
}

let redis: IORedis | null = null;
let queue: Queue | null = null;

function getQueue(): Queue {
  if (!redis) redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  if (!queue) queue = new Queue('call-execute', { connection: redis });
  return queue;
}

/** Enqueue a single outbound call. Returns the BullMQ job id. */
export async function enqueueCall(payload: CallExecutePayload): Promise<string> {
  const job = await getQueue().add('execute', payload, { attempts: 1 });
  return job.id ?? '';
}
