import { Queue } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';

/** Default sequence used for leads that can only be reached by email (no
 *  callable phone), enrolled the moment they're added/imported rather than
 *  after a call. */
export const EMAIL_ONLY_SEQUENCE = 'cold_followup';

export interface EnrollParams {
  leadId: string;
  contactId: string;
  campaignId: string | null;
  /** email_sequences.name to enroll into (must be is_active). */
  sequenceName: string;
  /** Originating call, when the enrollment is triggered post-call. Null for
   *  email-only leads that were never called. */
  triggerCallId?: string | null;
}

/**
 * Enroll a contact into an email sequence and fire its first step immediately.
 *
 * Used by:
 *  - transcript worker (post-call follow-up)
 *  - phone-lookup worker (lead routed to email_only — mobile/voip/inconclusive)
 *  - email-sequence worker (handling an `enroll` job enqueued by the API when a
 *    lead is manually added as email_only)
 *
 * contact_sequences has UNIQUE(contact_id, sequence_id): if the contact already
 * holds an enrollment for this sequence we RESET it to the first step and
 * re-fire (re-engagement), otherwise insert fresh. The first email is sent now;
 * the email-sequence worker schedules later steps from their own delay config.
 */
export async function enrollContactInSequence(
  supabase: SupabaseClient,
  emailSequenceQueue: Queue,
  params: EnrollParams,
): Promise<void> {
  const { leadId, contactId, campaignId, sequenceName, triggerCallId = null } = params;

  const { data: sequence } = await supabase
    .from('email_sequences')
    .select('id')
    .eq('name', sequenceName)
    .eq('is_active', true)
    .maybeSingle();
  if (!sequence) return;

  const { data: firstStep } = await supabase
    .from('sequence_steps')
    .select('step_number')
    .eq('sequence_id', sequence.id)
    .eq('is_active', true)
    .order('step_number', { ascending: true })
    .limit(1)
    .maybeSingle();

  const startStep = firstStep?.step_number ?? 1;
  const nextSendAt = new Date();

  const { data: existing } = await supabase
    .from('contact_sequences')
    .select('id')
    .eq('contact_id', contactId)
    .eq('sequence_id', sequence.id)
    .maybeSingle();

  let enrollmentId: string | null = null;
  if (existing) {
    const { data: reset } = await supabase
      .from('contact_sequences')
      .update({
        lead_id: leadId, campaign_id: campaignId, trigger_event: sequenceName,
        trigger_call_id: triggerCallId, next_send_at: nextSendAt.toISOString(),
        current_step: startStep, status: 'active', completed_at: null,
      })
      .eq('id', existing.id)
      .select('id')
      .single();
    enrollmentId = reset?.id ?? existing.id;
  } else {
    const { data: enrollment } = await supabase.from('contact_sequences').insert({
      contact_id: contactId, lead_id: leadId, sequence_id: sequence.id, campaign_id: campaignId,
      trigger_event: sequenceName, trigger_call_id: triggerCallId, next_send_at: nextSendAt.toISOString(),
      current_step: startStep, status: 'active',
    }).select('id').single();
    enrollmentId = enrollment?.id ?? null;
  }

  if (enrollmentId) {
    await emailSequenceQueue.add('process-sequence', { contactSequenceId: enrollmentId }, { delay: 0 });
  }
}
