import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { TranscriptProcessJobPayload, QUEUE_NAMES } from '../queues/queue.registry';
import { ElevenLabsAgentClient } from '@ai-sdr/integrations';
import { ClaudeReasoningService } from '@ai-sdr/integrations';
import { CallOutcomeScorer, DncChecker } from '@ai-sdr/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { CallOutcome } from '@ai-sdr/database';
import type { ElevenLabsTranscriptMessage } from '@ai-sdr/integrations';

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

      // Book appointment if meeting booked
      if (outcome === 'meeting_booked' && analysisResult?.callAnalysis?.meeting_details?.booked) {
        const mtg = analysisResult.callAnalysis.meeting_details;
        await deps.supabase.from('appointments').insert({
          lead_id: leadId, contact_id: call.contact_id, company_id: call.company_id, call_id: callId,
          campaign_id: call.campaign_id, scheduled_at: mtg.confirmed_date ?? mtg.proposed_date ?? now,
          duration_minutes: mtg.duration_minutes ?? 30, timezone: mtg.timezone ?? 'America/New_York',
          qualification_summary: handoffSummary, key_pain_points: qualData?.pain_points ?? [],
          store_count: qualData?.store_count ?? null, budget_indication: qualData?.budget_range ?? null,
          decision_timeline: qualData?.rollout_timeline ?? null,
        });
      }

      // Enroll in email sequence
      if (scoredOutcome.sequenceToTrigger) {
        await enrollInEmailSequence(deps.supabase, deps.emailSequenceQueue, leadId, call.contact_id, call.campaign_id, callId, scoredOutcome.sequenceToTrigger);
      }

      await deps.crmSyncQueue.add('sync-lead', { entity: 'lead', entityId: leadId, action: 'update', provider: process.env['CRM_PROVIDER'] ?? 'none' });

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

async function enrollInEmailSequence(
  supabase: SupabaseClient, emailSequenceQueue: Queue,
  leadId: string, contactId: string, campaignId: string | null, triggerCallId: string, sequenceName: string
): Promise<void> {
  const { data: sequence } = await supabase.from('email_sequences').select('id').eq('name', sequenceName).eq('is_active', true).maybeSingle();
  if (!sequence) return;
  const { data: existing } = await supabase.from('contact_sequences').select('id').eq('contact_id', contactId).eq('sequence_id', sequence.id).maybeSingle();
  if (existing) return;

  // Honour the FIRST step's own timing instead of a blanket +2h delay. This is
  // what lets a meeting_confirmation (step 1 delay 0d/0h) go out promptly after
  // the call, while cold/no-answer steps keep their intended lead time. Mirrors
  // computeNextSendAt() in email-sequence.worker.ts.
  const { data: firstStep } = await supabase
    .from('sequence_steps')
    .select('step_number, delay_days, delay_hours, send_time_hour, send_time_minute')
    .eq('sequence_id', sequence.id)
    .eq('is_active', true)
    .order('step_number', { ascending: true })
    .limit(1)
    .maybeSingle();

  const startStep = firstStep?.step_number ?? 1;
  const nextSendAt = new Date();
  nextSendAt.setDate(nextSendAt.getDate() + (firstStep?.delay_days ?? 0));
  nextSendAt.setHours(nextSendAt.getHours() + (firstStep?.delay_hours ?? 0));
  if (firstStep?.send_time_hour != null) {
    nextSendAt.setHours(firstStep.send_time_hour, firstStep.send_time_minute ?? 0, 0, 0);
  }
  const delayMs = Math.max(0, nextSendAt.getTime() - Date.now());

  const { data: enrollment } = await supabase.from('contact_sequences').insert({
    contact_id: contactId, lead_id: leadId, sequence_id: sequence.id, campaign_id: campaignId,
    trigger_event: sequenceName, trigger_call_id: triggerCallId, next_send_at: nextSendAt.toISOString(),
    current_step: startStep, status: 'active',
  }).select().single();
  if (enrollment) {
    await emailSequenceQueue.add('process-sequence', { contactSequenceId: enrollment.id }, { delay: delayMs });
  }
}
