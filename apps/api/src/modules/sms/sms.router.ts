import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { TwilioSmsClient, validateTwilioWebhookSignature, TwilioInboundSmsPayload } from '@ai-sdr/integrations';
import { env } from '../../config/env';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId, getReadScopeUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createSmsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();
  const smsClient = new TwilioSmsClient(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, logger);

  // GET /api/v1/sms?contact_id=&direction=
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getReadScopeUserId(req);
      const { contact_id, lead_id, direction, limit = '100' } =
        req.query as Record<string, string>;

      let q = supabase
        .from('sms_messages')
        .select('id, contact_id, lead_id, from_number, to_number, direction, body, status, sent_at, delivered_at, created_at')
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));
      if (userId) q = q.eq('created_by', userId);
      if (contact_id) q = q.eq('contact_id', contact_id);
      if (lead_id) q = q.eq('lead_id', lead_id);
      if (direction) q = q.eq('direction', direction);

      const { data, error } = await q;
      if (error) throw error;
      res.json({ messages: data ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/sms/threads
  // Returns latest message per contact (for thread-list UI)
  router.get('/threads', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getReadScopeUserId(req);
      let q = supabase
        .from('sms_messages')
        .select('contact_id, from_number, to_number, body, direction, created_at, contacts(id, first_name, last_name, phone_direct, companies(name))')
        .order('created_at', { ascending: false });
      if (userId) q = q.eq('created_by', userId);
      const { data, error } = await q;
      if (error) throw error;

      // Group to one row per contact
      const seen = new Set<string>();
      const threads = [];
      for (const m of data ?? []) {
        const key = (m.contact_id as string) ?? (m.direction === 'inbound' ? m.from_number : m.to_number);
        if (seen.has(key)) continue;
        seen.add(key);
        threads.push(m);
      }
      res.json({ threads });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/sms/send
  router.post('/send', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { to, body, contact_id, lead_id, from } = req.body;
      if (!to || !body) throw new ValidationError('to and body are required');

      const fromNumber = from ?? env.TWILIO_FROM_NUMBER;

      // Send via Twilio. The `telnyx_message_id` column is reused to store the
      // Twilio Message SID (no DB migration — see migration 006).
      let providerMessageId: string | undefined;
      let status = 'failed';
      let errorCode: string | undefined;
      try {
        const result = await smsClient.send({
          from: fromNumber,
          to,
          text: body,
          messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || undefined,
        });
        providerMessageId = result.sid;
        status = 'sent';
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        errorCode = msg;
        logger.error({ err: msg }, 'SMS send failed');
      }

      // Persist (even on failure, so we have a record)
      const insert: Record<string, unknown> = {
        contact_id,
        lead_id,
        from_number: fromNumber,
        to_number: to,
        direction: 'outbound',
        body,
        status,
        telnyx_message_id: providerMessageId,
        error_code: errorCode,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      };
      if (userId) insert.created_by = userId;

      const { data, error } = await supabase.from('sms_messages').insert(insert).select().single();
      if (error) throw error;

      logger.info({ smsId: data.id, status }, 'SMS recorded');
      if (status === 'failed') {
        res.status(502).json({ message: data, error: errorCode });
        return;
      }
      res.status(201).json({ message: data });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/sms/:id  (mostly for marking read/etc — minimal for now)
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { status } = req.body;
      const updates: Record<string, unknown> = {};
      if (status) updates.status = status;

      let q = supabase.from('sms_messages').update(updates).eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data, error } = await q.select().single();
      if (error || !data) throw new NotFoundError('SMS message', req.params.id);
      res.json({ message: data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Webhook handler for Twilio SMS events.
 * Mount under /webhooks/twilio-sms — no auth required (validated by signature).
 *
 * Twilio sends a single endpoint two kinds of POSTs (application/x-www-form-urlencoded):
 *   - Inbound message    → SmsStatus/MessageStatus = 'received', includes Body
 *   - Status callback     → MessageStatus in {queued,sending,sent,delivered,undelivered,failed}
 */
export function createSmsWebhookRouter(deps: { supabase: SupabaseClient; logger: Logger }): Router {
  const router = Router();
  const { supabase, logger } = deps;

  router.post('/twilio-sms', async (req: Request, res: Response) => {
    const payload = (req.body ?? {}) as TwilioInboundSmsPayload;

    // Validate Twilio signature (defence in depth; webhook URL is public).
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    if (env.TWILIO_AUTH_TOKEN) {
      const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
      const url = `${proto}://${req.get('host')}${req.originalUrl}`;
      const valid = validateTwilioWebhookSignature(
        env.TWILIO_AUTH_TOKEN,
        signature,
        url,
        payload as Record<string, string | undefined>
      );
      if (!valid) {
        logger.warn('Rejected SMS webhook with invalid Twilio signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      logger.warn('SMS webhook received but TWILIO_AUTH_TOKEN unset — accepting in dev mode');
    }

    // Twilio expects a 2xx; empty TwiML is fine (no auto-reply).
    res.status(200).type('text/xml').send('<Response></Response>');

    const status = (payload.MessageStatus ?? payload.SmsStatus ?? '').toLowerCase();
    const messageSid = payload.MessageSid ?? payload.SmsSid;

    try {
      if (status === 'received') {
        // Inbound message
        const fromNumber = payload.From;
        const toNumber = payload.To;
        const body = payload.Body ?? '';

        // Look up contact by phone
        const { data: matchedContact } = await supabase
          .from('contacts')
          .select('id, company_id, created_by')
          .or(`phone_direct.eq.${fromNumber},phone_mobile.eq.${fromNumber},phone_hq.eq.${fromNumber}`)
          .maybeSingle();

        const insert: Record<string, unknown> = {
          from_number: fromNumber,
          to_number: toNumber,
          direction: 'inbound',
          body,
          status: 'received',
          telnyx_message_id: messageSid,
          sent_at: new Date().toISOString(),
        };
        if (matchedContact) {
          insert.contact_id = matchedContact.id;
          insert.created_by = matchedContact.created_by;
        }
        await supabase.from('sms_messages').insert(insert);
        logger.info({ from: fromNumber }, 'Inbound SMS recorded');
      } else if (messageSid && status) {
        // Outbound status callback — update existing row by Message SID.
        const update: Record<string, unknown> = { status };
        if (status === 'delivered' || status === 'sent') {
          update.delivered_at = new Date().toISOString();
        }
        if ((status === 'failed' || status === 'undelivered') && payload.ErrorCode) {
          update.error_code = payload.ErrorCode;
        }
        await supabase.from('sms_messages').update(update).eq('telnyx_message_id', messageSid);
      }
    } catch (err) {
      logger.error({ err }, 'SMS webhook error');
    }
  });

  return router;
}
