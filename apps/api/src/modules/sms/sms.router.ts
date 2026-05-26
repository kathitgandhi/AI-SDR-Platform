import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { TelnyxSmsClient, validateTelnyxWebhookSignature } from '@ai-sdr/integrations';
import { env } from '../../config/env';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createSmsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();
  const smsClient = new TelnyxSmsClient(env.TELNYX_API_KEY, env.TELNYX_BASE_URL, logger);

  // GET /api/v1/sms?contact_id=&direction=
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
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
      const userId = getUserId(req);
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

      const fromNumber = from ?? env.TELNYX_FROM_NUMBER;

      // Send via Telnyx
      let telnyxId: string | undefined;
      let status = 'failed';
      let errorCode: string | undefined;
      try {
        const result = await smsClient.send({ from: fromNumber, to, text: body });
        telnyxId = result.data.id;
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
        telnyx_message_id: telnyxId,
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
 * Webhook handler for Telnyx SMS events.
 * Mount under /webhooks/telnyx-sms — no auth required (validated by signature).
 */
export function createSmsWebhookRouter(deps: { supabase: SupabaseClient; logger: Logger }): Router {
  const router = Router();
  const { supabase, logger } = deps;

  router.post('/telnyx-sms', async (req: Request, res: Response) => {
    // Validate Telnyx signature (defence in depth; webhook URL is public)
    const signature = req.headers['telnyx-signature-ed25519'] as string | undefined;
    const timestamp = req.headers['telnyx-timestamp'] as string | undefined;
    if (signature && timestamp && env.TELNYX_WEBHOOK_SECRET) {
      const raw = (req as any).rawBody ? (req as any).rawBody.toString() : JSON.stringify(req.body);
      const valid = validateTelnyxWebhookSignature(raw, signature, env.TELNYX_WEBHOOK_SECRET);
      if (!valid) {
        logger.warn('Rejected SMS webhook with invalid signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } else {
      logger.warn('SMS webhook received without Telnyx signature headers — accepting in dev mode');
    }

    res.status(200).json({ received: true });

    const payload = (req.body?.data?.payload ?? {}) as Record<string, any>;
    const eventType = req.body?.data?.event_type as string;

    try {
      if (eventType === 'message.received') {
        const fromNumber = payload.from?.phone_number ?? payload.from;
        const toNumber = payload.to?.[0]?.phone_number ?? payload.to;
        const body = payload.text ?? '';

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
          telnyx_message_id: payload.id,
          sent_at: payload.received_at ?? new Date().toISOString(),
        };
        if (matchedContact) {
          insert.contact_id = matchedContact.id;
          insert.created_by = matchedContact.created_by;
        }
        await supabase.from('sms_messages').insert(insert);
        logger.info({ from: fromNumber }, 'Inbound SMS recorded');
      } else if (eventType === 'message.sent' || eventType === 'message.finalized') {
        // Mark delivered
        const id = payload.id;
        const finalStatus = payload.to?.[0]?.status ?? 'delivered';
        await supabase
          .from('sms_messages')
          .update({
            status: finalStatus,
            delivered_at: new Date().toISOString(),
          })
          .eq('telnyx_message_id', id);
      }
    } catch (err) {
      logger.error({ err }, 'SMS webhook error');
    }
  });

  return router;
}
