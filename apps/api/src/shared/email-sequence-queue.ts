import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

/**
 * Payload for the `enroll` job consumed by the email-sequence worker
 * (apps/workers). Must stay in sync with EnrollJobPayload in
 * apps/workers/src/workers/email-sequence.worker.ts.
 *
 * Queue name is 'email-sequence' (matches QUEUE_NAMES.EMAIL_SEQUENCE).
 */
export interface EmailEnrollmentPayload {
  leadId: string;
  contactId: string;
  campaignId: string | null;
  /** email_sequences.name to enroll into (must be is_active). */
  sequenceName: string;
}

let redis: IORedis | null = null;
let queue: Queue | null = null;

function getQueue(): Queue {
  if (!redis) redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  if (!queue) queue = new Queue('email-sequence', { connection: redis });
  return queue;
}

/**
 * Enqueue a first-touch email-sequence enrollment for an email_only lead. The
 * email-sequence worker creates the enrollment and fires the first email.
 * Returns the BullMQ job id.
 */
export async function enqueueEmailEnrollment(payload: EmailEnrollmentPayload): Promise<string> {
  const job = await getQueue().add('enroll', payload);
  return job.id ?? '';
}
