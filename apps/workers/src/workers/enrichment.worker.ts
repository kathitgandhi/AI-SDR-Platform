import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { SupabaseClient } from '@supabase/supabase-js';
import { EnrichmentJobPayload, QUEUE_NAMES, PhoneLookupJobPayload } from '../queues/queue.registry';
import { EMAIL_ONLY_SEQUENCE } from '../shared/email-enrollment';

interface EnrichmentDeps {
  supabase: SupabaseClient;
  /** Routes leads with a phone into line-type validation. */
  phoneLookupQueue: Queue;
  /** Used to start a first-touch email sequence for email-only leads. */
  emailSequenceQueue: Queue;
  connection: Redis;
  logger: Logger;
}

/**
 * Consumes the `enrichment` queue. Leads created at stage `new` (e.g. CSV
 * import) have no automatic path forward — nothing advances them. This worker
 * is that path: it normalizes the lead and routes it into the rest of the
 * pipeline based on what contact info we have.
 *
 *   - has a phone   → phone_lookup_pending, enqueue phone-lookup (line-type +
 *                     DNC → callable / email_only)
 *   - email only    → email_only, enqueue a first-touch email enrollment
 *   - neither       → dead
 *
 * NOTE: there is no external enrichment provider wired here — this is the
 * routing/normalization step that unblocks `new` leads. A real data-enrichment
 * provider (firmographics, etc.) can be slotted in before the routing below.
 */
export function createEnrichmentWorker(deps: EnrichmentDeps): Worker {
  const { supabase, phoneLookupQueue, emailSequenceQueue, connection, logger } = deps;
  const workerLogger = logger.child({ worker: 'enrichment' });

  return new Worker<EnrichmentJobPayload>(
    QUEUE_NAMES.ENRICHMENT,
    async (job: Job<EnrichmentJobPayload>) => {
      const { leadId } = job.data;
      const jobLogger = workerLogger.child({ jobId: job.id, leadId });
      const now = new Date().toISOString();

      await supabase.from('leads').update({ stage: 'enriching', updated_at: now }).eq('id', leadId);

      // Load the lead's contact to decide routing.
      const { data: lead } = await supabase
        .from('leads')
        .select('id, contact_id, campaign_id, contacts:contact_id(phone_direct, email)')
        .eq('id', leadId)
        .maybeSingle();
      if (!lead) {
        jobLogger.warn('Lead not found — skipping enrichment');
        return { skipped: true, reason: 'lead_not_found' };
      }

      const contact = (lead as unknown as { contacts: { phone_direct: string | null; email: string | null } | null }).contacts;
      const phone = contact?.phone_direct ?? null;
      const email = contact?.email ?? null;
      const campaignId = (lead as unknown as { campaign_id: string | null }).campaign_id ?? null;

      // Mark enriched, then route.
      await supabase.from('leads').update({ stage: 'enriched', updated_at: now }).eq('id', leadId);

      if (phone) {
        await supabase.from('leads').update({ stage: 'phone_lookup_pending', updated_at: now }).eq('id', leadId);
        await phoneLookupQueue.add('lookup', { contactId: lead.contact_id, leadId, phone } satisfies PhoneLookupJobPayload);
        jobLogger.info('Routed to phone-lookup');
        return { leadId, result: 'phone_lookup_pending' };
      }

      if (email) {
        await supabase.from('leads').update({ stage: 'email_only', updated_at: now }).eq('id', leadId);
        await emailSequenceQueue.add('enroll', {
          leadId, contactId: lead.contact_id, campaignId, sequenceName: EMAIL_ONLY_SEQUENCE,
        });
        jobLogger.info('Routed to email_only + enrollment');
        return { leadId, result: 'email_only' };
      }

      await supabase.from('leads').update({ stage: 'dead', updated_at: now }).eq('id', leadId);
      jobLogger.info('No phone or email — marking dead');
      return { leadId, result: 'dead' };
    },
    { connection, concurrency: 5 },
  );
}
