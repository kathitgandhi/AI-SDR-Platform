import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

/**
 * Payload consumed by the transcript worker (apps/workers). Must stay in sync
 * with TranscriptProcessJobPayload in apps/workers/src/queues/queue.registry.ts.
 *
 * The queue name is 'transcript-process' (kebab-case) to match the worker
 * (QUEUE_NAMES.TRANSCRIPT_PROCESS).
 */
export interface TranscriptProcessPayload {
  callId: string;
  leadId: string;
  conversationId: string;
}

let redis: IORedis | null = null;
let queue: Queue | null = null;

function getQueue(): Queue {
  if (!redis) redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  if (!queue) queue = new Queue('transcript-process', { connection: redis });
  return queue;
}

/**
 * Enqueue transcript processing immediately (no delay) — used by the ElevenLabs
 * post-call webhook so a lead leaves the `calling` stage the moment the call
 * actually ends, instead of waiting for the fixed max-duration fallback delay.
 *
 * Uses a deterministic jobId keyed on the conversation id so this webhook-driven
 * job and the call-executor's delayed fallback job collapse into one while either
 * is still queued (BullMQ ignores a duplicate jobId). The transcript worker also
 * guards against re-processing an already-completed call, covering the case where
 * the first job has already finished and been removed.
 */
export async function enqueueTranscript(payload: TranscriptProcessPayload): Promise<string> {
  const job = await getQueue().add('process-transcript', payload, {
    jobId: `transcript:${payload.conversationId}`,
    delay: 0,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
  return job.id ?? '';
}
