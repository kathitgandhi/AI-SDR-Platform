import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { CallExecuteJobPayload, QUEUE_NAMES, TranscriptProcessJobPayload } from '../queues/queue.registry';
import { ElevenLabsAgentClient } from '@ai-sdr/integrations';
import { DncChecker, TimezoneGuard } from '@ai-sdr/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { PersonaName } from '@ai-sdr/database';
import { elevenLabsAgentIds } from '../config/env';

interface CallExecutorConfig {
  fromNumber: string;
  companyName: string;
  maxDurationSeconds: number;
  ringTimeoutSeconds: number;
  /** ElevenLabs phone number id (phnum_...) backing outbound origination, now Twilio-backed. */
  elevenLabsPhoneNumberId: string;
}

interface CallExecutorDeps {
  supabase: SupabaseClient;
  elevenLabsClient: ElevenLabsAgentClient;
  dncChecker: DncChecker;
  timezoneGuard: TimezoneGuard;
  transcriptQueue: Queue;
  connection: Redis;
  logger: Logger;
  config: CallExecutorConfig;
}

export function createCallExecutorWorker(deps: CallExecutorDeps): Worker {
  const { supabase, elevenLabsClient, dncChecker, timezoneGuard, logger, config } = deps;

  return new Worker<CallExecuteJobPayload>(
    QUEUE_NAMES.CALL_EXECUTE,
    async (job: Job<CallExecuteJobPayload>) => {
      const { leadId, contactId, companyId, campaignId, phone, persona, attemptNumber } = job.data;
      const workerLogger = logger.child({ jobId: job.id, leadId });

      const [{ data: contact }, { data: company }] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', contactId).single(),
        supabase.from('companies').select('*').eq('id', companyId).single(),
      ]);

      if (!contact || !company) {
        throw new Error(`Missing data: contact=${!!contact}, company=${!!company}`);
      }

      // DNC check — fails safe (blocks on error)
      const dncResult = await dncChecker.checkPhone(phone);
      if (dncResult.isOnDnc) {
        workerLogger.info({ reason: dncResult.reason }, 'Phone on DNC — skipping');
        await supabase.from('leads').update({ stage: 'dnc', updated_at: new Date().toISOString() }).eq('id', leadId);
        await logCompliance(supabase, 'lead', leadId, 'dnc_check', false, { reason: dncResult.reason });
        return { skipped: true, reason: 'dnc' };
      }
      await logCompliance(supabase, 'lead', leadId, 'dnc_check', true, {});

      // Timezone window check
      const windowCheck = timezoneGuard.isCallAllowed(
        (company as Record<string, string>)['headquarters_state'] ?? 'NY'
      );
      if (!windowCheck.allowed) {
        workerLogger.info({ reason: windowCheck.reason }, 'Outside call window — rescheduling');
        await supabase.from('leads').update({
          next_contact_at: windowCheck.nextAllowedAt?.toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', leadId);
        await logCompliance(supabase, 'lead', leadId, 'call_window', false, { reason: windowCheck.reason });
        return { skipped: true, reason: 'outside_window' };
      }

      // Create call record
      const { data: callRecord, error: callError } = await supabase
        .from('calls')
        .insert({
          lead_id: leadId,
          contact_id: contactId,
          company_id: companyId,
          campaign_id: campaignId || null,
          persona: persona as PersonaName,
          from_number: config.fromNumber,
          to_number: phone,
          status: 'dialing',
          attempt_number: attemptNumber,
          initiated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (callError || !callRecord) throw new Error(`Failed to create call record: ${callError?.message}`);

      await supabase.from('leads').update({ stage: 'calling', updated_at: new Date().toISOString() }).eq('id', leadId);

      const agentId = elevenLabsAgentIds[persona];
      if (!agentId) throw new Error(`No ElevenLabs agent ID for persona: ${persona}`);

      const co = company as Record<string, unknown>;
      const dynamicVars = elevenLabsClient.buildDynamicVariables({
        contactFirstName: (contact as Record<string, string>)['first_name'],
        companyName: (co['name'] as string),
        callerName: persona.charAt(0).toUpperCase() + persona.slice(1),
        sellerCompanyName: config.companyName,
        contactTitle: (contact as Record<string, string>)['title'] ?? 'there',
        ...(typeof co['store_count'] === 'number' ? { storeCount: co['store_count'] } : {}),
        ...(typeof co['esl_vendor'] === 'string' ? { currentEslVendor: co['esl_vendor'] } : {}),
        ...(typeof co['pos_vendor'] === 'string' ? { currentPosVendor: co['pos_vendor'] } : {}),
        ...(typeof co['retail_vertical'] === 'string' ? { vertical: co['retail_vertical'] } : {}),
      });

      try {
        const elCall = await elevenLabsClient.initiateOutboundCall({
          agent_id: agentId,
          agent_phone_number_id: config.elevenLabsPhoneNumberId,
          to_number: phone,
          conversation_initiation_client_data: { dynamic_variables: dynamicVars },
        });

        await supabase.from('calls').update({
          elevenlabs_session_id: elCall.conversation_id,
          status: 'ringing',
          updated_at: new Date().toISOString(),
        }).eq('id', callRecord.id);

        await deps.transcriptQueue.add(
          'process-transcript',
          {
            callId: callRecord.id,
            leadId,
            conversationId: elCall.conversation_id,
          } satisfies TranscriptProcessJobPayload,
          // Delayed fallback: if the ElevenLabs post-call webhook never fires (or
          // can't enqueue), this still drives post-call processing. Shares a
          // deterministic jobId with the webhook-enqueued job so the two collapse
          // into one while either is still queued (BullMQ ignores a duplicate id).
          {
            jobId: `transcript:${elCall.conversation_id}`,
            delay: config.maxDurationSeconds * 1000 + 30000,
          }
        );

        workerLogger.info({ conversationId: elCall.conversation_id }, 'Call initiated');
        return { callId: callRecord.id, conversationId: elCall.conversation_id };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        await supabase.from('calls').update({
          status: 'failed', outcome: 'error', internal_notes: errMsg,
          ended_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', callRecord.id);
        await supabase.from('leads').update({
          stage: 'called_no_answer', call_attempts: attemptNumber,
          last_called_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', leadId);
        throw error;
      }
    },
    {
      connection: deps.connection,
      concurrency: parseInt(process.env['CALL_MAX_CONCURRENT'] ?? '10', 10),
      limiter: {
        max: parseInt(process.env['CALL_MAX_CONCURRENT'] ?? '10', 10),
        duration: parseInt(process.env['CALL_PACING_DELAY_MS'] ?? '2000', 10),
      },
    }
  );
}

async function logCompliance(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
  checkType: string,
  passed: boolean,
  details: Record<string, unknown>
): Promise<void> {
  await supabase.from('compliance_logs').insert({ entity_type: entityType, entity_id: entityId, check_type: checkType, passed, details });
}
