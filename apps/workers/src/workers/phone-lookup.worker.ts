import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { SupabaseClient } from '@supabase/supabase-js';
import { TwilioLookupClient } from '@ai-sdr/integrations';
import { DncChecker } from '@ai-sdr/core';
import { PhoneLookupJobPayload, QUEUE_NAMES } from '../queues/queue.registry';

interface PhoneLookupDeps {
  supabase: SupabaseClient;
  /** Twilio Lookup v2 (line_type_intelligence). */
  lookupClient: TwilioLookupClient;
  dncChecker: DncChecker;
  connection: Redis;
  logger: Logger;
  config: {
    /**
     * When true, a phone we cannot positively confirm as a landline (Lookup
     * error / number invalid / add-on disabled) is treated as NOT callable and
     * the lead drops to email_only. When false (default) such inconclusive
     * results stay callable — the lead-import already excludes ZoomInfo-flagged
     * mobiles, so this keeps the pipeline flowing if the Lookup add-on isn't on.
     * Confirmed mobiles/VoIP are always routed to email_only regardless.
     */
    strict: boolean;
  };
}

/**
 * Consumes the `phone-lookup` queue (fed by the lead-import worker). For each
 * lead it: (1) DNC-checks the number, (2) resolves line type via Twilio Lookup,
 * then sets the lead's stage so the pipeline scheduler can pick it up:
 *   - confirmed mobile/voip            → email_only  (federal: never call mobiles)
 *   - confirmed landline (or inconclusive, non-strict) → callable + next_contact_at = now
 *   - on DNC                           → dnc
 *
 * Without this worker, lead-import's hand-off lands in `phone_lookup_pending`
 * and never advances — so no lead ever becomes callable automatically.
 */
export function createPhoneLookupWorker(deps: PhoneLookupDeps): Worker {
  const { supabase, lookupClient, dncChecker, connection, logger, config } = deps;
  const workerLogger = logger.child({ worker: 'phone-lookup' });

  return new Worker<PhoneLookupJobPayload>(
    QUEUE_NAMES.PHONE_LOOKUP,
    async (job: Job<PhoneLookupJobPayload>) => {
      const { contactId, leadId, phone } = job.data;
      const jobLogger = workerLogger.child({ jobId: job.id, leadId });
      const now = new Date().toISOString();

      await supabase.from('leads').update({ stage: 'phone_lookup_pending', updated_at: now }).eq('id', leadId);

      // 1. DNC — fail closed (DncChecker returns isOnDnc:true on error).
      const dnc = await dncChecker.checkPhone(phone);
      if (dnc.isOnDnc) {
        jobLogger.info({ reason: dnc.reason }, 'Phone on DNC — marking lead dnc');
        await supabase.from('leads').update({ stage: 'dnc', updated_at: now }).eq('id', leadId);
        return { leadId, result: 'dnc' };
      }

      // 2. Line-type lookup.
      const lookup = await lookupClient.lookupPhone(phone);

      // Persist what we learned about the number on the contact.
      await supabase.from('contacts').update({
        phone_direct_type: lookup.lineType,
        phone_direct_valid: lookup.isValid,
        updated_at: now,
      }).eq('id', contactId);

      // Confirmed mobile/VoIP → email only (compliance: never call mobiles).
      if (lookup.isValid && lookup.isEmailOnly) {
        const { data: contact } = await supabase.from('contacts').select('email').eq('id', contactId).maybeSingle();
        const stage = contact?.email ? 'email_only' : 'dead';
        jobLogger.info({ lineType: lookup.lineType, stage }, 'Number not callable (mobile/voip)');
        await supabase.from('leads').update({ stage, updated_at: now }).eq('id', leadId);
        return { leadId, result: stage };
      }

      // Inconclusive (Lookup error / invalid / add-on off): in strict mode drop
      // to email_only, otherwise treat as callable (lead-import already filtered
      // ZoomInfo-flagged mobiles).
      if (!lookup.isValid && config.strict) {
        const { data: contact } = await supabase.from('contacts').select('email').eq('id', contactId).maybeSingle();
        const stage = contact?.email ? 'email_only' : 'dead';
        jobLogger.warn({ stage }, 'Lookup inconclusive + strict mode — not calling');
        await supabase.from('leads').update({ stage, updated_at: now }).eq('id', leadId);
        return { leadId, result: stage };
      }

      // Callable.
      if (!lookup.isValid) jobLogger.warn('Lookup inconclusive — treating as callable (non-strict)');
      await supabase.from('leads').update({
        stage: 'callable',
        next_contact_at: now,
        updated_at: now,
      }).eq('id', leadId);
      jobLogger.info({ lineType: lookup.lineType }, 'Lead marked callable');
      return { leadId, result: 'callable' };
    },
    { connection, concurrency: 5 },
  );
}
