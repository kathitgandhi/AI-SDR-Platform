import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { TranscriptProcessJobPayload, QUEUE_NAMES } from '../queues/queue.registry';
import { ElevenLabsAgentClient } from '@ai-sdr/integrations';
import { ClaudeReasoningService } from '@ai-sdr/integrations';
import type { GoogleCalendarClient } from '@ai-sdr/integrations';
import { CallOutcomeScorer, DncChecker } from '@ai-sdr/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { CallOutcome } from '@ai-sdr/database';
import type { ElevenLabsTranscriptMessage } from '@ai-sdr/integrations';
import { enrollContactInSequence } from '../shared/email-enrollment';

interface TranscriptWorkerDeps {
  supabase: SupabaseClient;
  elevenLabsClient: ElevenLabsAgentClient;
  claudeService: ClaudeReasoningService;
  outcomeScorer: CallOutcomeScorer;
  dncChecker: DncChecker;
  emailSequenceQueue: Queue;
  crmSyncQueue: Queue;
  connection: Redis;
  logger: Logger;
  /** Per-minute voice cost rates (USD), used to record per-call telephony +
   *  voice-agent spend into api_usage. Sourced from worker env. */
  costRates: { elevenLabsPerMinuteUsd: number; twilioPerMinuteUsd: number };
  /** Optional — when set (CALENDAR_INVITES_ENABLED + Gmail/calendar scope), a
   *  confirmed booking gets a Google Calendar event + Meet link + emailed invite. */
  calendarClient: GoogleCalendarClient | null;
  calendarConfig: { companyName: string; ccEmail: string | null };
}

export function createTranscriptWorker(deps: TranscriptWorkerDeps): Worker {
  return new Worker<TranscriptProcessJobPayload>(
    QUEUE_NAMES.TRANSCRIPT_PROCESS,
    async (job: Job<TranscriptProcessJobPayload>) => {
      const { callId, leadId, conversationId } = job.data;
      const workerLogger = deps.logger.child({ jobId: job.id, callId });
      workerLogger.info('Processing transcript');

      const [{ data: call }, { data: lead }] = await Promise.all([
        deps.supabase.from('calls').select('*').eq('id', callId).single(),
        deps.supabase.from('leads').select('*, contacts(*), companies(*)').eq('id', leadId).single(),
      ]);

      if (!call || !lead) throw new Error(`Missing data for callId=${callId}`);

      // Idempotency guard: the post-call webhook enqueues transcript processing
      // the moment the call ends, while the call-executor schedules a delayed
      // fallback job for the same call. Whichever runs first sets the call to
      // 'completed'; the other must no-op to avoid duplicate transcripts,
      // appointments, notes, and sequence enrollments.
      if (call.status === 'completed') {
        workerLogger.info('Call already processed — skipping (idempotency guard)');
        return { skipped: true, reason: 'already_completed' };
      }

      const contact = (lead as unknown as { contacts: Record<string, string> }).contacts;
      const company = (lead as unknown as { companies: Record<string, string | number> }).companies;

      // Fetch transcript from ElevenLabs
      let conversationDetails = null;
      try {
        conversationDetails = await deps.elevenLabsClient.waitForConversationComplete(conversationId, 120000, 5000);
      } catch (err) {
        workerLogger.warn({ err }, 'ElevenLabs transcript fetch failed');
      }

      const fullTranscript = conversationDetails?.transcript
        ?.map((t: ElevenLabsTranscriptMessage) => `${t.role === 'agent' ? 'Agent' : 'Prospect'}: ${t.message}`)
        .join('\n') ?? '';

      const callDurationSecs = conversationDetails?.metadata?.call_duration_secs ?? 0;

      const { data: transcriptRecord } = await deps.supabase
        .from('call_transcripts')
        .insert({ call_id: callId, lead_id: leadId, full_transcript: fullTranscript, transcript_json: conversationDetails?.transcript ?? null })
        .select().single();

      // Claude analysis
      let analysisResult = null;
      try {
        analysisResult = await deps.claudeService.analyzeCallTranscript({
          transcript: fullTranscript || `[Call status: ${conversationDetails?.analysis?.call_successful ?? 'unknown'}]`,
          companyName: String(company['name'] ?? ''),
          contactName: `${String(contact['first_name'] ?? '')} ${String(contact['last_name'] ?? '')}`.trim(),
          contactTitle: String(contact['title'] ?? ''),
          retailVertical: String(company['retail_vertical'] ?? ''),
        });
        await deps.supabase.from('api_usage').insert({
          provider: 'anthropic', operation: 'transcript_analysis', entity_type: 'call', entity_id: callId,
          input_tokens: analysisResult.inputTokens, output_tokens: analysisResult.outputTokens,
          cache_read_tokens: analysisResult.cacheReadTokens, cost_usd: analysisResult.costUsd,
        });
      } catch (err) {
        workerLogger.error({ err }, 'Claude analysis failed');
      }

      // Record per-call voice spend (ElevenLabs voice agent + Twilio telephony).
      // Both are billed by duration, so we approximate from the call's billed
      // seconds × the configured per-minute rate and store them in api_usage
      // keyed to this call. Combined with the anthropic row above, this lets the
      // call-detail endpoint report an all-in total per call. Never let a cost
      // bookkeeping failure break call processing.
      if (callDurationSecs > 0) {
        try {
          const billedMinutes = Number((callDurationSecs / 60).toFixed(4));
          const durationMs = callDurationSecs * 1000;
          await deps.supabase.from('api_usage').insert([
            {
              provider: 'elevenlabs', operation: 'voice_agent_call',
              entity_type: 'call', entity_id: callId,
              units_consumed: billedMinutes, duration_ms: durationMs,
              cost_usd: Number((billedMinutes * deps.costRates.elevenLabsPerMinuteUsd).toFixed(6)),
            },
            {
              provider: 'twilio', operation: 'voice_call',
              entity_type: 'call', entity_id: callId,
              units_consumed: billedMinutes, duration_ms: durationMs,
              cost_usd: Number((billedMinutes * deps.costRates.twilioPerMinuteUsd).toFixed(6)),
            },
          ]);
        } catch (err) {
          workerLogger.warn({ err }, 'Failed to record voice cost usage');
        }
      }

      const outcome = (analysisResult?.callAnalysis?.outcome ?? 'no_answer') as CallOutcome;
      const qualData = analysisResult?.qualificationData;
      const scoredOutcome = deps.outcomeScorer.score(outcome, qualData ?? {}, call.attempt_number ?? 1, 3);

      // DNC handling
      if (analysisResult?.callAnalysis?.dnc_requested || outcome === 'dnc_requested') {
        await deps.dncChecker.addToPhoneDnc({ phone: call.to_number, source: 'prospect_request', reason: 'Requested during call', contactId: call.contact_id });
        if (contact['email']) {
          await deps.dncChecker.addToEmailDnc({ email: String(contact['email']), source: 'prospect_request', contactId: call.contact_id });
        }
      }

      // Handoff summary for hot leads
      let handoffSummary: string | null = null;
      if (outcome === 'meeting_booked' || (scoredOutcome.qualificationScore ?? 0) >= 60) {
        try {
          handoffSummary = await deps.claudeService.generateHandoffSummary({
            contactName: `${String(contact['first_name'] ?? '')} ${String(contact['last_name'] ?? '')}`.trim(),
            contactTitle: String(contact['title'] ?? ''),
            companyName: String(company['name'] ?? ''),
            storeCount: company['store_count'] ? Number(company['store_count']) : null,
            vertical: String(company['retail_vertical'] ?? ''),
            qualificationData: qualData ?? {},
            callSummary: analysisResult?.callAnalysis?.summary ?? '',
          });
        } catch (err) {
          workerLogger.warn({ err }, 'Handoff summary failed');
        }
      }

      const now = new Date().toISOString();

      await Promise.all([
        deps.supabase.from('calls').update({
          status: 'completed', outcome, duration_seconds: callDurationSecs, talk_time_seconds: callDurationSecs,
          ended_at: now, outcome_score: scoredOutcome.outcomeScore, qualification_score: scoredOutcome.qualificationScore,
          meeting_booked: outcome === 'meeting_booked', dnc_requested: analysisResult?.callAnalysis?.dnc_requested ?? false,
          decision_maker_reached: analysisResult?.callAnalysis?.decision_maker_reached ?? false,
          gatekeeper_reached: analysisResult?.callAnalysis?.gatekeeper_reached ?? false,
          call_summary: analysisResult?.callAnalysis?.summary ?? null,
          next_steps: analysisResult?.callAnalysis?.next_steps ?? null,
          internal_notes: analysisResult?.crmNotes ?? null, updated_at: now,
        }).eq('id', callId),

        transcriptRecord ? deps.supabase.from('call_transcripts').update({
          objections_raised: analysisResult?.callAnalysis?.objections ?? [],
          pain_points_mentioned: qualData?.pain_points ?? [],
          competitors_mentioned: analysisResult?.callAnalysis?.competitors_mentioned ?? [],
          interest_signals: analysisResult?.callAnalysis?.interest_signals ?? [],
          claude_analysis: analysisResult?.callAnalysis ?? null,
          qualification_data: qualData ?? null,
          meeting_details: analysisResult?.callAnalysis?.meeting_details ?? null,
          processed: true, processed_at: now,
        }).eq('id', transcriptRecord.id) : Promise.resolve(),

        deps.supabase.from('leads').update({
          stage: scoredOutcome.newLeadStage, call_attempts: call.attempt_number ?? 1,
          // Propagate the call's qualification score back to the lead. Keep the
          // best score seen so a later no-answer (qual 0) doesn't wipe a good one.
          score: Math.max(Number((lead as { score?: number }).score ?? 0), scoredOutcome.qualificationScore ?? 0),
          last_called_at: now, next_contact_at: scoredOutcome.nextContactAt?.toISOString() ?? null,
          last_call_summary: analysisResult?.callAnalysis?.summary ?? null,
          handoff_summary: handoffSummary,
          ...(qualData ? {
            store_count_confirmed: qualData.store_count, current_esl_vendor: qualData.current_esl_vendor,
            current_pos_vendor: qualData.current_pos_vendor, current_erp_vendor: qualData.current_erp_vendor,
            current_wms_vendor: qualData.current_wms_vendor, pain_points: qualData.pain_points,
            rollout_timeline: qualData.rollout_timeline, budget_range: qualData.budget_range,
            is_decision_maker: qualData.is_decision_maker,
          } : {}),
          updated_at: now,
        }).eq('id', leadId),
      ]);

      // Capture email mentioned during the call (if contact has none yet)
      try {
        const mentionedEmail =
          (analysisResult?.callAnalysis as any)?.contact_email
          ?? (qualData as any)?.contact_email
          ?? extractEmailFromText(fullTranscript);
        if (mentionedEmail && !contact['email']) {
          await deps.supabase
            .from('contacts')
            .update({ email: mentionedEmail, updated_at: now })
            .eq('id', call.contact_id);
          workerLogger.info({ contactId: call.contact_id, email: mentionedEmail }, 'Captured email from transcript');
        }
      } catch (err) {
        workerLogger.warn({ err }, 'Email capture from transcript failed');
      }

      // Resolve inbound caller identity: if the contact is still a placeholder
      // ("Unknown Caller") and Claude extracted a name from the transcript, update
      // the contact row so the lead list shows a real name going forward.
      try {
        const callerName    = (analysisResult?.callAnalysis as any)?.caller_name   as string | null | undefined;
        const callerCompany = (analysisResult?.callAnalysis as any)?.caller_company as string | null | undefined;
        const callerTitle   = (analysisResult?.callAnalysis as any)?.caller_title   as string | null | undefined;

        const isUnknownContact =
          !contact['first_name'] ||
          String(contact['first_name']).toLowerCase().startsWith('unknown');

        if (callerName && isUnknownContact) {
          const parts     = callerName.trim().split(/\s+/);
          const firstName = parts[0] ?? callerName.trim();
          const lastName  = parts.slice(1).join(' ') || null;
          await deps.supabase.from('contacts').update({
            first_name: firstName,
            ...(lastName      ? { last_name: lastName }     : {}),
            ...(callerTitle   ? { title: callerTitle }      : {}),
            updated_at: now,
          }).eq('id', call.contact_id);
          workerLogger.info({ contactId: call.contact_id, callerName }, 'Updated inbound caller name from transcript');
        }

        // Update company name if still a phone-number placeholder
        const isUnknownCompany = String(company['name'] ?? '').toLowerCase().startsWith('unknown caller');
        if (callerCompany && isUnknownCompany && call.company_id) {
          await deps.supabase.from('companies').update({
            name: callerCompany,
            updated_at: now,
          }).eq('id', call.company_id);
          workerLogger.info({ companyId: call.company_id, callerCompany }, 'Updated inbound caller company from transcript');
        }
      } catch (err) {
        workerLogger.warn({ err }, 'Inbound caller identity update failed');
      }

      // Auto-note: persist Claude summary + next_steps as a transcript-sourced note
      try {
        if (analysisResult?.callAnalysis?.summary || analysisResult?.callAnalysis?.next_steps) {
          const noteBody = [
            analysisResult.callAnalysis.summary,
            analysisResult.callAnalysis.next_steps ? `\n\nNext steps: ${analysisResult.callAnalysis.next_steps}` : '',
          ].filter(Boolean).join('');
          await deps.supabase.from('notes').insert({
            lead_id: leadId,
            call_id: callId,
            body: noteBody,
            source: 'transcript',
            created_by: call.created_by ?? null,
          });
        }
      } catch (err) {
        workerLogger.warn({ err }, 'Auto-note insert failed (table may not exist yet — run migration 006)');
      }

      // Book appointment whenever the call outcome is a booked meeting. We no
      // longer require structured `meeting_details.booked` — Claude often sets
      // the outcome to meeting_booked without populating a parsed date/time, and
      // previously that left the Meetings tab empty for a real booking. When the
      // date is missing we default to a placeholder (2 days out) so the rep still
      // sees the meeting and can adjust it.
      if (outcome === 'meeting_booked') {
        const mtg = analysisResult?.callAnalysis?.meeting_details;
        // Only store a real time when the prospect committed to one:
        //  confirmed_date → confirmed; proposed_date → tentative; neither → TBD (null).
        const scheduledAt = mtg?.confirmed_date ?? mtg?.proposed_date ?? null;
        const timeConfirmed = !!mtg?.confirmed_date;

        const durationMinutes = mtg?.duration_minutes ?? 30;
        const timezone = mtg?.timezone ?? 'America/New_York';

        // Defensive idempotency: don't create a second appointment for this call.
        const { data: existingAppt } = await deps.supabase
          .from('appointments').select('id').eq('call_id', callId).maybeSingle();
        if (!existingAppt) {
          const { data: appt } = await deps.supabase.from('appointments').insert({
            lead_id: leadId, contact_id: call.contact_id, company_id: call.company_id, call_id: callId,
            campaign_id: call.campaign_id, scheduled_at: scheduledAt, time_confirmed: timeConfirmed,
            duration_minutes: durationMinutes, timezone,
            qualification_summary: handoffSummary, key_pain_points: qualData?.pain_points ?? [],
            store_count: qualData?.store_count ?? null, budget_indication: qualData?.budget_range ?? null,
            decision_timeline: qualData?.rollout_timeline ?? null,
          }).select('id').single();

          // Calendar invite + Google Meet link — only when a concrete time was
          // confirmed and we have the prospect's email. Best-effort: never let a
          // calendar failure break call processing.
          const prospectEmail = String(contact['email'] ?? (mtg as any)?.attendee_email ?? '').trim();
          if (deps.calendarClient && appt && timeConfirmed && scheduledAt && prospectEmail) {
            try {
              const attendees = [prospectEmail, deps.calendarConfig.ccEmail].filter(Boolean) as string[];
              const meeting = await deps.calendarClient.createMeeting({
                summary: `${deps.calendarConfig.companyName} — intro demo with ${String(company['name'] ?? 'your team')}`,
                description: handoffSummary ?? analysisResult?.callAnalysis?.summary ?? 'Product demo.',
                startIso: scheduledAt,
                durationMinutes,
                timezone,
                attendees,
                requestId: callId,
              });
              await deps.supabase.from('appointments').update({
                meeting_link: meeting.meetLink, calendar_event_id: meeting.eventId,
              }).eq('id', appt.id);
              workerLogger.info({ apptId: appt.id, meetLink: meeting.meetLink }, 'Calendar invite + Meet link created');
            } catch (err) {
              workerLogger.warn({ err }, 'Calendar invite creation failed (appointment still booked)');
            }
          }
        }
      }

      // Enroll in email sequence
      if (scoredOutcome.sequenceToTrigger) {
        await enrollContactInSequence(deps.supabase, deps.emailSequenceQueue, {
          leadId, contactId: call.contact_id, campaignId: call.campaign_id,
          sequenceName: scoredOutcome.sequenceToTrigger, triggerCallId: callId,
        });
      }

      // Push the lead update + the full call transcript to AirDesk360 (or whichever
      // CRM is configured). Both jobs are independent — the call-sync worker will
      // run syncLead() inline if the lead hasn't been synced yet, so ordering
      // between these two jobs does not matter.
      await Promise.all([
        deps.crmSyncQueue.add('sync-lead', {
          entity: 'lead', entityId: leadId, action: 'update',
          provider: process.env['CRM_PROVIDER'] ?? 'none',
        }),
        deps.crmSyncQueue.add('sync-call', {
          entity: 'call', entityId: callId, action: 'create',
          provider: process.env['CRM_PROVIDER'] ?? 'none',
        }),
      ]);

      workerLogger.info({ outcome, outcomeScore: scoredOutcome.outcomeScore }, 'Transcript processing complete');
      return { outcome, scores: scoredOutcome };
    },
    { connection: deps.connection, concurrency: 5 }
  );
}

/** Best-effort email extraction from raw transcript text. */
function extractEmailFromText(text: string): string | null {
  if (!text) return null;
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0] : null;
}
