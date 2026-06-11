import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { SupabaseClient } from '@supabase/supabase-js';
import { EmailSequenceType } from '@ai-sdr/integrations';
import { QUEUE_NAMES } from '../queues/queue.registry';
import { enrollContactInSequence } from '../shared/email-enrollment';
import type { EmailSendJobPayload } from './email-sender.worker';

/**
 * Job pushed by the transcript worker (enrollInEmailSequence) onto the
 * `email-sequence` queue. One job per contact-sequence, re-scheduled after
 * each step until the sequence completes.
 */
export interface ProcessSequenceJobPayload {
  contactSequenceId: string;
}

/**
 * `enroll` job, enqueued by the API when a lead is added directly as email_only
 * (no call to trigger post-call enrollment). The worker enrolls the contact and
 * fires the first email immediately.
 */
export interface EnrollJobPayload {
  leadId: string;
  contactId: string;
  campaignId: string | null;
  sequenceName: string;
}

interface EmailSequenceDeps {
  supabase: SupabaseClient;
  /** Queue the email-sender worker consumes. NOTE: the consumer listens on the
   *  literal name `emailSender`, NOT QUEUE_NAMES.EMAIL_SEND — keep this in sync. */
  emailSenderQueue: Queue;
  /** This worker's own queue, used to re-schedule the next step. */
  sequenceQueue: Queue;
  connection: Redis;
  logger: Logger;
}

/** Map a stored sequence name to the Claude email-writer sequence type. */
const SEQUENCE_NAME_TO_TYPE: Record<string, EmailSequenceType> = {
  cold_followup: 'cold_followup',
  no_answer_email: 'no_answer',
  meeting_confirmation: 'meeting_confirmation',
  post_demo: 'post_demo',
  nurture_30d: 'long_nurture',
  nurture_90d: 'long_nurture',
  nurture_180d: 'long_nurture',
  reactivation: 'reactivation',
};

interface SequenceStepRow {
  step_number: number;
  delay_days: number;
  delay_hours: number;
  send_time_hour: number | null;
  send_time_minute: number | null;
}

/** Compute when a step should fire, relative to now, honouring its send-time-of-day. */
function computeNextSendAt(step: SequenceStepRow): Date {
  const d = new Date();
  d.setDate(d.getDate() + (step.delay_days ?? 0));
  d.setHours(d.getHours() + (step.delay_hours ?? 0));
  if (step.send_time_hour != null) {
    d.setHours(step.send_time_hour, step.send_time_minute ?? 0, 0, 0);
  }
  return d;
}

/**
 * Consumes `process-sequence` jobs on the `email-sequence` queue. For each:
 *   1. Loads the contact_sequences enrollment + its sequence steps.
 *   2. Enqueues an email-send job for the CURRENT step (sent immediately —
 *      the delay was already applied when this job was scheduled).
 *   3. Advances current_step and either re-schedules the next step or marks
 *      the enrollment completed.
 *
 * Without this worker the enrollment row is created but no email is ever
 * generated or sent.
 */
export function createEmailSequenceWorker(deps: EmailSequenceDeps): Worker {
  const { supabase, emailSenderQueue, sequenceQueue, connection, logger } = deps;
  const workerLogger = logger.child({ worker: 'email-sequence' });

  return new Worker<ProcessSequenceJobPayload | EnrollJobPayload>(
    QUEUE_NAMES.EMAIL_SEQUENCE,
    async (job: Job<ProcessSequenceJobPayload | EnrollJobPayload>) => {
      // `enroll` jobs (from the API for email_only leads) create the enrollment
      // then enqueue a `process-sequence` job to send the first email.
      if (job.name === 'enroll') {
        const p = job.data as EnrollJobPayload;
        const enrollLogger = workerLogger.child({ jobId: job.id, leadId: p.leadId });
        await enrollContactInSequence(supabase, sequenceQueue, {
          leadId: p.leadId, contactId: p.contactId, campaignId: p.campaignId ?? null,
          sequenceName: p.sequenceName,
        });
        enrollLogger.info({ sequenceName: p.sequenceName }, 'Enrolled email_only lead into sequence');
        return { enrolled: true };
      }

      const { contactSequenceId } = job.data as ProcessSequenceJobPayload;
      const jobLogger = workerLogger.child({ jobId: job.id, contactSequenceId });

      // 1. Load the enrollment
      const { data: cs, error: csErr } = await supabase
        .from('contact_sequences')
        .select('id, lead_id, contact_id, campaign_id, sequence_id, current_step, status')
        .eq('id', contactSequenceId)
        .single();
      if (csErr || !cs) {
        jobLogger.warn({ err: csErr }, 'Contact sequence not found — skipping');
        return { skipped: true, reason: 'not_found' };
      }
      if (cs.status !== 'active') {
        jobLogger.info({ status: cs.status }, 'Enrollment no longer active — skipping');
        return { skipped: true, reason: cs.status };
      }

      // 2. Load the sequence name + its active steps
      const { data: sequence } = await supabase
        .from('email_sequences')
        .select('name')
        .eq('id', cs.sequence_id)
        .single();
      const { data: steps } = await supabase
        .from('sequence_steps')
        .select('step_number, delay_days, delay_hours, send_time_hour, send_time_minute')
        .eq('sequence_id', cs.sequence_id)
        .eq('is_active', true)
        .order('step_number', { ascending: true });

      const allSteps = (steps ?? []) as SequenceStepRow[];
      const currentStep = allSteps.find((s) => s.step_number === cs.current_step);
      if (!currentStep) {
        jobLogger.info({ currentStep: cs.current_step }, 'No matching step — completing enrollment');
        await supabase
          .from('contact_sequences')
          .update({ status: 'completed', completed_at: new Date().toISOString(), next_send_at: null })
          .eq('id', cs.id);
        return { completed: true };
      }

      const sequenceName = sequence?.name ?? 'cold_followup';
      const sequenceType = SEQUENCE_NAME_TO_TYPE[sequenceName] ?? 'cold_followup';

      // 3. Enqueue the send for the current step (immediate)
      const sendPayload: EmailSendJobPayload = {
        leadId: cs.lead_id,
        contactId: cs.contact_id,
        campaignId: cs.campaign_id ?? undefined,
        sequenceType,
        stepNumber: cs.current_step,
      };
      await emailSenderQueue.add('send', sendPayload, { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } });
      jobLogger.info({ sequenceName, step: cs.current_step }, 'Enqueued email send for step');

      // 4. Advance to the next step or complete
      const nextStep = allSteps.find((s) => s.step_number === cs.current_step + 1);
      if (!nextStep) {
        await supabase
          .from('contact_sequences')
          .update({ status: 'completed', completed_at: new Date().toISOString(), next_send_at: null })
          .eq('id', cs.id);
        jobLogger.info('Sequence completed');
        return { sent: true, completed: true };
      }

      const nextSendAt = computeNextSendAt(nextStep);
      const delayMs = Math.max(0, nextSendAt.getTime() - Date.now());
      await supabase
        .from('contact_sequences')
        .update({ current_step: nextStep.step_number, next_send_at: nextSendAt.toISOString() })
        .eq('id', cs.id);
      await sequenceQueue.add('process-sequence', { contactSequenceId: cs.id } satisfies ProcessSequenceJobPayload, { delay: delayMs });
      jobLogger.info({ nextStep: nextStep.step_number, nextSendAt: nextSendAt.toISOString() }, 'Scheduled next step');

      return { sent: true, nextStep: nextStep.step_number };
    },
    { connection, concurrency: 5 },
  );
}
