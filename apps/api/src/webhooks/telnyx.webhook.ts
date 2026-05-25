import { Request, Response, Router } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { TelnyxWebhookPayload, TelnyxCallPayload, validateTelnyxWebhookSignature } from '@ai-sdr/integrations';

export function createTelnyxWebhookRouter(deps: {
  supabase: SupabaseClient;
  logger: Logger;
  webhookSecret: string;
}): Router {
  const router = Router();
  const { supabase, logger, webhookSecret } = deps;

  router.post('/telnyx', async (req: Request, res: Response) => {
    // Validate signature
    const signature = req.headers['telnyx-signature-ed25519'] as string;
    const timestamp = req.headers['telnyx-timestamp'] as string;

    if (signature && timestamp) {
      const isValid = validateTelnyxWebhookSignature(
        JSON.stringify(req.body),
        signature,
        webhookSecret
      );
      if (!isValid) {
        logger.warn('Invalid Telnyx webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    const payload = req.body as TelnyxWebhookPayload;
    const eventType = payload.data.event_type;
    const callPayload = payload.data.payload as TelnyxCallPayload;

    logger.info({ eventType, callControlId: callPayload.call_control_id }, 'Telnyx webhook received');

    // Acknowledge immediately to prevent retry
    res.status(200).json({ received: true });

    // Process asynchronously
    processCallEvent(supabase, logger, eventType, callPayload).catch((err) => {
      logger.error({ err, eventType }, 'Error processing Telnyx call event');
    });
  });

  return router;
}

async function processCallEvent(
  supabase: SupabaseClient,
  logger: Logger,
  eventType: string,
  payload: TelnyxCallPayload
): Promise<void> {
  const { data: existing } = await supabase
    .from('calls')
    .select('id, lead_id, contact_id')
    .or(`telnyx_call_id.eq.${payload.call_session_id},call_control_id.eq.${payload.call_control_id}`)
    .maybeSingle();

  let call = existing;

  // INBOUND: create the call row on first event if we've never seen this call
  if (!call && eventType === 'call.initiated' && payload.direction === 'inbound') {
    call = await handleInboundInitiated(supabase, logger, payload);
  }

  if (!call) {
    logger.debug({ eventType, callControlId: payload.call_control_id }, 'No call record found for event');
    return;
  }

  // Record all events
  await supabase.from('call_events').insert({
    call_id: call.id,
    event_type: eventType,
    event_data: payload as unknown as Record<string, unknown>,
    source: 'telnyx',
    occurred_at: payload.start_time ?? new Date().toISOString(),
  });

  const now = new Date().toISOString();

  switch (eventType) {
    case 'call.answered':
      await supabase.from('calls').update({
        status: 'answered',
        answered_at: now,
        telnyx_call_id: payload.call_session_id,
        telnyx_call_leg_id: payload.call_leg_id,
        call_control_id: payload.call_control_id,
        updated_at: now,
      }).eq('id', call.id);

      await supabase.from('consent_records').insert({
        call_id: call.id,
        contact_id: call.contact_id,
      });
      break;

    case 'call.hangup':
      await supabase.from('calls').update({
        status: payload.hangup_cause === 'normal_clearing' ? 'completed' : 'failed',
        ended_at: now,
        updated_at: now,
      }).eq('id', call.id).in('status', ['answered', 'ringing', 'dialing']);
      break;

    case 'call.machine.detection.ended':
      if (payload.answering_machine_detection?.result === 'human') {
        await supabase.from('calls').update({
          decision_maker_reached: true,
          updated_at: now,
        }).eq('id', call.id);
      } else if (payload.answering_machine_detection?.result?.startsWith('machine')) {
        await supabase.from('calls').update({
          voicemail_left: true,
          status: 'voicemail',
          updated_at: now,
        }).eq('id', call.id);
      }
      break;

    default:
      logger.debug({ eventType }, 'Unhandled Telnyx event type');
  }
}

/**
 * Handle the first `call.initiated` event for an INBOUND call.
 * Looks up the caller by phone number; if found, attaches to existing lead/campaign.
 * If unknown, creates a new contact + lead so the call has somewhere to land.
 *
 * Returns the new call row (or null on failure).
 */
async function handleInboundInitiated(
  supabase: SupabaseClient,
  logger: Logger,
  payload: TelnyxCallPayload,
): Promise<{ id: string; lead_id: string | null; contact_id: string | null } | null> {
  const fromPhone = payload.from;
  const toPhone = payload.to;

  logger.info({ from: fromPhone, to: toPhone }, 'Inbound call initiated');

  // 1. Try to identify the caller by phone (direct, mobile, or HQ)
  const { data: matchedContact } = await supabase
    .from('contacts')
    .select('id, company_id, first_name, last_name, created_by')
    .or(`phone_direct.eq.${fromPhone},phone_mobile.eq.${fromPhone},phone_hq.eq.${fromPhone}`)
    .maybeSingle();

  let contactId: string;
  let companyId: string;
  let createdBy: string | null = null;
  let leadId: string | null = null;
  let persona: string;

  if (matchedContact) {
    contactId = matchedContact.id;
    companyId = matchedContact.company_id;
    createdBy = matchedContact.created_by ?? null;

    // Find the most recent lead for this contact (preserves campaign context)
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, campaign_id, assigned_persona')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingLead) {
      leadId = existingLead.id;
      persona = existingLead.assigned_persona ?? 'mike';
    } else {
      persona = 'mike';
    }
    logger.info({ contactId, leadId, persona }, 'Identified inbound caller');
  } else {
    // Unknown caller: create stub company + contact + lead, route to receptionist agent
    persona = 'mike'; // placeholder; ElevenLabs picks the actual agent via portal config

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

  // 2. Create the call row
  const { data: newCall, error: callErr } = await supabase
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
      call_control_id: payload.call_control_id,
      telnyx_call_id: payload.call_session_id,
      telnyx_call_leg_id: payload.call_leg_id,
      initiated_at: payload.start_time ?? new Date().toISOString(),
      ai_disclosed: false,
      ...(createdBy ? { created_by: createdBy } : {}),
    })
    .select('id, lead_id, contact_id')
    .single();

  if (callErr || !newCall) {
    logger.error({ err: callErr }, 'Failed to create inbound call row');
    return null;
  }

  logger.info({ callId: newCall.id, leadId, contactId }, 'Inbound call recorded');
  return newCall;
}
