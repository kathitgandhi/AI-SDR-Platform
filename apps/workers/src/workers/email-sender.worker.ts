import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { SupabaseClient } from '@supabase/supabase-js';
import { GmailClient, ClaudeReasoningService, EmailSequenceType } from '@ai-sdr/integrations';

export interface EmailSendJobPayload {
  leadId: string;
  contactId?: string;
  companyId?: string;
  campaignId?: string;
  subject?: string;
  body?: string;
  template?: string;
  /** When enqueued by the email-sequence worker: drives Claude generation. */
  sequenceType?: EmailSequenceType;
  stepNumber?: number;
  cc?: string[];
  createdBy?: string;
}

interface EmailSenderDeps {
  supabase: SupabaseClient;
  gmailClient: GmailClient;
  claudeService: ClaudeReasoningService;
  connection: Redis;
  logger: Logger;
  config: {
    fromAddress: string;
    fromName: string;
    companyName: string;
  };
}

const TEMPLATE_TO_SEQUENCE: Record<string, string> = {
  follow_up: 'cold_followup',
  no_answer: 'no_answer',
  meeting_confirm: 'meeting_confirmation',
  post_demo: 'post_demo',
  nurture_30d: 'long_nurture',
  nurture_90d: 'long_nurture',
  nurture_180d: 'long_nurture',
  reactivation: 'reactivation',
};

/**
 * Consumes the `emailSender` queue. Each job:
 * 1. Loads lead + contact + company
 * 2. If subject/body missing → AI-generates via Claude
 * 3. Sends via Gmail
 * 4. Records the email in the `emails` table
 */
export function createEmailSenderWorker(deps: EmailSenderDeps): Worker {
  const { supabase, gmailClient, claudeService, connection, logger, config } = deps;
  const workerLogger = logger.child({ worker: 'email-sender' });

  return new Worker<EmailSendJobPayload>(
    'emailSender', // queue name (matches what apps/api/.../emails.router.ts queues to)
    async (job: Job<EmailSendJobPayload>) => {
      const { leadId, subject: providedSubject, body: providedBody, template, sequenceType: providedSequenceType, stepNumber: providedStepNumber, cc, createdBy } = job.data;
      const jobLogger = workerLogger.child({ jobId: job.id, leadId });
      jobLogger.info('Processing email send job');

      // 1. Load lead + contact + company
      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .select('id, contact_id, company_id, campaign_id, store_count_confirmed, pain_points, rollout_timeline, budget_range, last_call_summary, contacts(*), companies(*)')
        .eq('id', leadId)
        .single();
      if (leadErr || !lead) throw new Error(`Lead ${leadId} not found: ${leadErr?.message ?? 'unknown'}`);

      const contact = (lead as any).contacts ?? {};
      const company = (lead as any).companies ?? {};
      if (!contact.email) {
        throw new Error(`Contact has no email address — cannot send (lead=${leadId})`);
      }

      // 2. Generate subject/body if missing
      let subject = providedSubject;
      let bodyText = providedBody;
      let bodyHtml = providedBody ? `<p>${String(providedBody).replace(/\n/g, '<br>')}</p>` : '';

      if (!subject || !bodyText) {
        jobLogger.info('Generating email via Claude');
        const sequenceType = (providedSequenceType ?? TEMPLATE_TO_SEQUENCE[template ?? 'follow_up'] ?? 'cold_followup') as EmailSequenceType;

        // For a meeting-confirmation email, pull the booked appointment so the
        // email includes the actual date/time and the Google Meet join link.
        let meetingDate: string | undefined;
        let meetingLink: string | undefined;
        if (sequenceType === 'meeting_confirmation') {
          const { data: appt } = await supabase
            .from('appointments')
            .select('scheduled_at, meeting_link, timezone, time_confirmed')
            .eq('lead_id', leadId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (appt?.scheduled_at && appt.time_confirmed) {
            meetingDate = new Date(appt.scheduled_at).toLocaleString('en-US', {
              dateStyle: 'full', timeStyle: 'short', timeZone: appt.timezone ?? 'America/New_York',
            }) + (appt.timezone ? ` (${appt.timezone})` : '');
          }
          if (appt?.meeting_link) meetingLink = appt.meeting_link;
        }

        const generated = await claudeService.generateEmail({
          sequenceType,
          stepNumber: providedStepNumber ?? 1,
          contactFirstName: contact.first_name ?? '',
          contactLastName: contact.last_name ?? '',
          contactTitle: contact.title ?? '',
          companyName: company.name ?? '',
          senderName: config.fromName,
          senderTitle: 'Sales',
          senderCompany: config.companyName,
          storeCount: (lead as any).store_count_confirmed ?? company.store_count ?? undefined,
          painPoints: (lead as any).pain_points ?? undefined,
          callSummary: (lead as any).last_call_summary ?? undefined,
          ...(meetingDate ? { meetingDate } : {}),
          ...(meetingLink ? { meetingLink } : {}),
        });
        subject = subject ?? generated.subject;
        bodyText = bodyText ?? generated.bodyText;
        bodyHtml = generated.bodyHtml || bodyHtml;

        // Track Claude cost
        await supabase.from('api_usage').insert({
          provider: 'anthropic',
          operation: 'email_generation',
          entity_type: 'lead',
          entity_id: leadId,
          input_tokens: generated.inputTokens,
          output_tokens: generated.outputTokens,
          cost_usd: generated.costUsd,
        });
      }

      // 3. Send via Gmail
      jobLogger.info({ to: contact.email, subject }, 'Sending email via Gmail');
      const sent = await gmailClient.sendEmail({
        to: contact.email,
        from: config.fromAddress,
        fromName: config.fromName,
        subject: subject ?? '(no subject)',
        bodyHtml: bodyHtml || `<p>${bodyText}</p>`,
        bodyText: bodyText ?? '',
        cc: cc ?? [],
      });
      jobLogger.info({ gmailMessageId: sent.gmailMessageId }, 'Email sent');

      // 4. Record in emails table
      const { error: emailErr } = await supabase.from('emails').insert({
        contact_id: lead.contact_id,
        lead_id: leadId,
        campaign_id: lead.campaign_id,
        from_address: config.fromAddress,
        to_address: contact.email,
        cc_addresses: cc ?? null,
        subject,
        body_html: bodyHtml,
        body_text: bodyText,
        status: 'sent',
        gmail_message_id: sent.gmailMessageId,
        gmail_thread_id: sent.gmailThreadId,
        sent_at: new Date().toISOString(),
      });
      if (emailErr) jobLogger.warn({ err: emailErr }, 'Failed to record email row (send still succeeded)');

      // 5. Auto-note on the lead
      try {
        await supabase.from('notes').insert({
          lead_id: leadId,
          body: `Email sent: "${subject}"`,
          source: 'system',
          created_by: createdBy ?? null,
        });
      } catch {
        // notes table may not exist yet; ignore
      }

      return { gmailMessageId: sent.gmailMessageId, gmailThreadId: sent.gmailThreadId };
    },
    { connection, concurrency: 3 },
  );
}
