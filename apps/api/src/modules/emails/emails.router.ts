import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Logger } from 'pino';
import { env } from '../../config/env';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

let redis: IORedis | null = null;
let emailQueue: Queue | null = null;

function getQueue(): Queue {
  if (!redis) redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  if (!emailQueue) emailQueue = new Queue('emailSender', { connection: redis });
  return emailQueue;
}

export function createEmailsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/emails?lead_id=
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lead_id, contact_id, limit = '50' } = req.query as Record<string, string>;
      let q = supabase
        .from('emails')
        .select('id, subject, status, sent_at, opened_count, clicked_count, lead_id, contact_id, body_preview')
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));
      if (lead_id) q = q.eq('lead_id', lead_id);
      if (contact_id) q = q.eq('contact_id', contact_id);

      const { data, error } = await q;
      if (error) throw error;
      res.json({ emails: data ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/emails/send
  // Body: { lead_id, subject?, body?, template?: 'follow_up' | 'meeting_confirm' | ... }
  // If no subject/body, the email-writer worker generates one via Claude using the lead context.
  router.post('/send', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { lead_id, subject, body, template, cc } = req.body;
      if (!lead_id) throw new ValidationError('lead_id is required');

      // Verify the lead belongs to the user
      let leadQ = supabase
        .from('leads')
        .select('id, contact_id, company_id, campaign_id')
        .eq('id', lead_id);
      if (userId) leadQ = leadQ.eq('created_by', userId);
      const { data: lead, error: leadErr } = await leadQ.single();
      if (leadErr || !lead) throw new NotFoundError('Lead', lead_id);

      const job = await getQueue().add('send-email', {
        leadId: lead_id,
        contactId: lead.contact_id,
        companyId: lead.company_id,
        campaignId: lead.campaign_id,
        subject,
        body,
        template: template ?? 'follow_up',
        cc,
        createdBy: userId,
      }, { attempts: 3, backoff: { type: 'exponential', delay: 30000 } });

      logger.info({ jobId: job.id, leadId: lead_id }, 'Email queued');
      res.status(202).json({ success: true, jobId: job.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
