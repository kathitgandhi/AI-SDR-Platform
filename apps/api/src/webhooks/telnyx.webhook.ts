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
  const { data: call } = await supabase
    .from('calls')
    .select('id, lead_id, contact_id')
    .or(`telnyx_call_id.eq.${payload.call_session_id},call_control_id.eq.${payload.call_control_id}`)
    .maybeSingle();

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
