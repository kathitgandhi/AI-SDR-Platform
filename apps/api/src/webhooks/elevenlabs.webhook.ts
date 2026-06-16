import { Request, Response, Router } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { validateElevenLabsWebhookSignature } from '@ai-sdr/integrations';
import { enqueueTranscript } from '../shared/transcript-queue';

/**
 * ElevenLabs webhooks. Replaces the retired Telnyx call-event webhook.
 *
 * Since the Twilio voice number is imported into ElevenLabs, our backend is NOT
 * in the inbound call media path — ElevenLabs answers the call directly. We learn
 * about inbound calls via ElevenLabs' "conversation initiation" webhook, which
 * fires at call start and lets us return dynamic variables to personalize the agent.
 *
 * Two endpoints:
 *   POST /elevenlabs/conversation-init  → identify inbound caller, create call row,
 *                                          return dynamic_variables for the agent.
 *   POST /elevenlabs/post-call          → (optional) lifecycle/finalization hook.
 *
 * ⚠️  PORTAL WIRING REQUIRED: configure these URLs + signing secret in the
 *     ElevenLabs dashboard (Conversational AI → Webhooks). Verify the request
 *     field names below against the live payload — ElevenLabs has varied them.
 */
export function createElevenLabsWebhookRouter(deps: {
  supabase: SupabaseClient;
  logger: Logger;
  webhookSecret?: string | undefined;
  /** Our own company name, used as the `seller_company` dynamic-variable default. */
  sellerCompany?: string | undefined;
}): Router {
  const router = Router();
  const { supabase, logger, webhookSecret, sellerCompany } = deps;

  /**
   * The agents' first-message / prompt templates reference dynamic variables.
   * If ANY referenced variable is missing, ElevenLabs throws error 1008 and the
   * call hangs up. Outbound supplies these from the lead/company; inbound has no
   * lead context, so we must still return a safe default for EVERY variable any
   * agent might reference (the outbound set in
   * ElevenLabsAgentClient.buildDynamicVariables, plus the inbound caller_* pair).
   * Known caller info is layered on top of these defaults.
   */
  function buildInboundDynamicVariables(known: {
    firstName?: string | null | undefined;
    companyName?: string | null | undefined;
  }): Record<string, string> {
    const firstName = known.firstName?.trim() || 'there';
    const companyName = known.companyName?.trim() || 'your company';
    return {
      // Inbound-specific (consumed by the receptionist agent greeting).
      caller_first_name: firstName,
      caller_company: known.companyName?.trim() ?? '',
      // Outbound variable set — supplied with safe defaults so a persona agent
      // assigned to inbound can never 1008 on a missing variable.
      contact_first_name: firstName,
      company_name: companyName,
      caller_name: 'our receptionist',
      seller_company: sellerCompany?.trim() || 'our company',
      contact_title: 'there',
      store_count: 'unknown',
      current_esl_vendor: 'unknown',
      current_pos_vendor: 'unknown',
      retail_vertical: 'retail',
    };
  }

  router.post('/elevenlabs/conversation-init', async (req: Request, res: Response) => {
    if (webhookSecret) {
      const raw = (req as any).rawBody ? (req as any).rawBody.toString() : JSON.stringify(req.body);
      const signature = (req.headers['elevenlabs-signature'] ?? req.headers['ElevenLabs-Signature']) as
        | string
        | undefined;
      if (!validateElevenLabsWebhookSignature(webhookSecret, signature, raw)) {
        logger.warn('Rejected ElevenLabs conversation-init webhook: bad signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      logger.warn('ELEVENLABS_WEBHOOK_SECRET unset — accepting conversation-init in dev mode');
    }

    const body = req.body ?? {};
    // ElevenLabs sends the caller/called numbers at the top level (field names
    // vary by version — accept the common variants).
    const fromPhone: string | undefined = body.caller_id ?? body.from_number ?? body.from;
    const toPhone: string | undefined = body.called_number ?? body.agent_number ?? body.to;
    const conversationId: string | undefined = body.conversation_id ?? body.call_sid;

    try {
      const result = await handleInboundInitiated(supabase, logger, {
        fromPhone: fromPhone ?? 'unknown',
        toPhone: toPhone ?? 'unknown',
        conversationId,
      });

      // Respond with a COMPLETE set of dynamic variables (caller info layered on
      // safe defaults) so the agent's first message can never 1008 on a missing var.
      res.status(200).json({
        type: 'conversation_initiation_client_data',
        dynamic_variables: buildInboundDynamicVariables({
          firstName: result?.firstName,
          companyName: result?.companyName,
        }),
      });
    } catch (err) {
      logger.error({ err }, 'conversation-init handler failed');
      // Still return a fully-defaulted personalization response so the call proceeds.
      res.status(200).json({
        type: 'conversation_initiation_client_data',
        dynamic_variables: buildInboundDynamicVariables({}),
      });
    }
  });

  // Post-call hook. Fires when ElevenLabs finishes a conversation. We enqueue
  // transcript processing IMMEDIATELY so the lead leaves the `calling` stage the
  // moment the call actually ends — instead of waiting for the call-executor's
  // fixed max-duration fallback delay (~10 min). The delayed job remains as a
  // safety net; the deterministic jobId + worker idempotency guard prevent any
  // double-processing.
  router.post('/elevenlabs/post-call', async (req: Request, res: Response) => {
    if (webhookSecret) {
      const raw = (req as any).rawBody ? (req as any).rawBody.toString() : JSON.stringify(req.body);
      const signature = (req.headers['elevenlabs-signature'] ?? req.headers['ElevenLabs-Signature']) as
        | string
        | undefined;
      if (!validateElevenLabsWebhookSignature(webhookSecret, signature, raw)) {
        logger.warn('Rejected ElevenLabs post-call webhook: bad signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      logger.warn('ELEVENLABS_WEBHOOK_SECRET unset — accepting post-call in dev mode');
    }

    const body = req.body ?? {};
    // ElevenLabs wraps the post_call_transcription payload under `data`; the
    // conversation id may also appear at the top level depending on version.
    const conversationId: string | undefined =
      body.data?.conversation_id ??
      body.conversation_id ??
      body.data?.call_sid ??
      body.call_sid;

    // Always 200 quickly — ElevenLabs retries on non-2xx, and the delayed
    // fallback job covers any case where we can't enqueue here.
    if (!conversationId) {
      logger.warn({ type: body.type }, 'post-call webhook missing conversation_id — relying on fallback');
      res.status(200).json({ received: true, enqueued: false });
      return;
    }

    try {
      let { data: call } = await supabase
        .from('calls')
        .select('id, lead_id, status')
        .eq('elevenlabs_session_id', conversationId)
        .maybeSingle();

      // No call row for this conversation. For OUTBOUND the call-executor always
      // pre-creates the row, so a missing row means this is almost certainly an
      // INBOUND call where the conversation-init webhook wasn't received (or
      // isn't configured). Recover by creating the inbound call from the
      // post-call payload, so inbound works even if only THIS webhook is wired.
      if (!call) {
        const phone = (body.data?.metadata?.phone_call ?? {}) as Record<string, string>;
        const fromPhone = phone['external_number'] ?? body.data?.metadata?.caller_id ?? body.caller_id ?? 'unknown';
        const toPhone = phone['agent_number'] ?? body.data?.metadata?.called_number ?? 'unknown';
        const direction = phone['direction'] ?? 'inbound';
        if (direction !== 'outbound') {
          logger.info({ conversationId, fromPhone }, 'post-call: no row — recovering as inbound');
          await handleInboundInitiated(supabase, logger, { fromPhone, toPhone, conversationId });
          const { data: created } = await supabase
            .from('calls').select('id, lead_id, status').eq('elevenlabs_session_id', conversationId).maybeSingle();
          call = created ?? null;
        }
      }

      if (!call || !call.lead_id) {
        logger.warn({ conversationId }, 'post-call: no matching call row — relying on fallback');
        res.status(200).json({ received: true, enqueued: false });
        return;
      }

      if (call.status === 'completed') {
        logger.info({ conversationId, callId: call.id }, 'post-call: call already processed — skipping');
        res.status(200).json({ received: true, enqueued: false, alreadyProcessed: true });
        return;
      }

      const jobId = await enqueueTranscript({
        callId: call.id,
        leadId: call.lead_id,
        conversationId,
      });
      logger.info({ conversationId, callId: call.id, jobId }, 'post-call: enqueued transcript processing');
      res.status(200).json({ received: true, enqueued: true, jobId });
    } catch (err) {
      logger.error({ err, conversationId }, 'post-call: failed to enqueue transcript — relying on fallback');
      res.status(200).json({ received: true, enqueued: false });
    }
  });

  return router;
}

/**
 * Identify an inbound caller by phone and ensure a call row exists.
 * Ported from the retired Telnyx webhook's handleInboundInitiated; preserves the
 * "unknown caller → stub company/contact/lead" behavior.
 *
 * Returns light caller info used to personalize the ElevenLabs agent greeting.
 */
async function handleInboundInitiated(
  supabase: SupabaseClient,
  logger: Logger,
  args: { fromPhone: string; toPhone: string; conversationId?: string | undefined },
): Promise<{ firstName: string | null; companyName: string | null } | null> {
  const { fromPhone, toPhone, conversationId } = args;
  logger.info({ from: fromPhone, to: toPhone, conversationId }, 'Inbound call initiated');

  // Avoid duplicate rows if this conversation was already recorded.
  if (conversationId) {
    const { data: existing } = await supabase
      .from('calls')
      .select('id')
      .eq('elevenlabs_session_id', conversationId)
      .maybeSingle();
    if (existing) {
      logger.debug({ conversationId }, 'Inbound call already recorded');
    }
  }

  // 1. Try to identify the caller by phone (direct, mobile, or HQ).
  const { data: matchedContact } = await supabase
    .from('contacts')
    .select('id, company_id, first_name, last_name, created_by')
    .or(`phone_direct.eq.${fromPhone},phone_mobile.eq.${fromPhone},phone_hq.eq.${fromPhone}`)
    .maybeSingle();

  let contactId: string;
  let companyId: string;
  let createdBy: string | null = null;
  let leadId: string | null = null;
  // All inbound calls are answered by the receptionist agent (assigned to this
  // number in the ElevenLabs portal — currently Charlotte), regardless of the
  // lead's outbound assigned_persona. Record who actually handled the call.
  const persona = 'receptionist';
  let firstName: string | null = null;
  let companyName: string | null = null;

  if (matchedContact) {
    contactId = matchedContact.id;
    companyId = matchedContact.company_id;
    createdBy = matchedContact.created_by ?? null;
    firstName = matchedContact.first_name ?? null;

    const { data: company } = await supabase
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .maybeSingle();
    companyName = company?.name ?? null;

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, campaign_id, assigned_persona')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingLead) {
      leadId = existingLead.id;
    }
    logger.info({ contactId, leadId, persona }, 'Identified inbound caller');
  } else {
    // Unknown caller: create stub company + contact + lead.
    const { data: stubCompany, error: coErr } = await supabase
      .from('companies')
      .insert({ name: `Unknown caller ${fromPhone}` })
      .select('id')
      .single();
    if (coErr || !stubCompany) {
      logger.error({ err: coErr }, 'Failed to create stub company for unknown inbound');
      return null;
    }
    companyId = stubCompany.id;

    const { data: stubContact, error: ctErr } = await supabase
      .from('contacts')
      .insert({
        company_id: companyId,
        first_name: 'Unknown',
        last_name: 'Caller',
        phone_direct: fromPhone,
      })
      .select('id')
      .single();
    if (ctErr || !stubContact) {
      logger.error({ err: ctErr }, 'Failed to create stub contact for unknown inbound');
      return null;
    }
    contactId = stubContact.id;

    const { data: stubLead, error: leadErr } = await supabase
      .from('leads')
      .insert({
        contact_id: contactId,
        company_id: companyId,
        stage: 'connected',
        score: 0,
        source: 'inbound',
      })
      .select('id')
      .single();
    if (leadErr || !stubLead) {
      logger.error({ err: leadErr }, 'Failed to create stub lead for unknown inbound');
      return null;
    }
    leadId = stubLead.id;
    logger.info({ leadId, contactId }, 'Created stub lead for unknown inbound caller');
  }

  // 2. Create the call row.
  const { error: callErr } = await supabase
    .from('calls')
    .insert({
      lead_id: leadId,
      contact_id: contactId,
      company_id: companyId,
      persona,
      direction: 'inbound',
      status: 'ringing',
      from_number: fromPhone,
      to_number: toPhone,
      elevenlabs_session_id: conversationId ?? null,
      initiated_at: new Date().toISOString(),
      ai_disclosed: false,
      ...(createdBy ? { created_by: createdBy } : {}),
    });

  if (callErr) {
    logger.error({ err: callErr }, 'Failed to create inbound call row');
  } else {
    logger.info({ leadId, contactId, conversationId }, 'Inbound call recorded');
  }

  return { firstName, companyName };
}
