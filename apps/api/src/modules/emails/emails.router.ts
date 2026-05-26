import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Logger } from 'pino';
import { ClaudeReasoningService } from '@ai-sdr/integrations';
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

async function loadLeadContext(supabase: SupabaseClient, leadId: string, userId?: string) {
  let q = supabase
    .from('leads')
    .select(`
      id, contact_id, company_id, campaign_id, store_count_confirmed, pain_points,
      rollout_timeline, budget_range, last_call_summary,
      contacts(first_name, last_name, title, email),
      companies(name, retail_vertical, store_count)
    `)
    .eq('id', leadId);
  if (userId) q = q.eq('created_by', userId);
  const { data, error } = await q.single();
  if (error || !data) throw new NotFoundError('Lead', leadId);
  return data as any;
}

export function createEmailsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  const claude = new ClaudeReasoningService(
    env.ANTHROPIC_API_KEY,
    env.ANTHROPIC_MODEL,
    env.ANTHROPIC_MAX_TOKENS,
    logger,
  );

  // GET /api/v1/emails?lead_id= | ?contact_id=
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lead_id, contact_id, limit = '50' } = req.query as Record<string, string>;
      let q = supabase
        .from('emails')
        .select('id, subject, body_text, status, sent_at, opened_count, clicked_count, lead_id, contact_id, from_address, to_address, created_at')
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));
      if (lead_id) q = q.eq('lead_id', lead_id);
      if (contact_id) q = q.eq('contact_id', contact_id);

      const { data, error } = await q;
      if (error) throw error;

      const emails = (data ?? []).map((e: any) => ({
        ...e,
        body_preview: e.body_text ? String(e.body_text).slice(0, 280) : null,
      }));
      res.json({ emails });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/emails/preview — generate subject + body via Claude without sending
  router.post('/preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { lead_id, template = 'follow_up' } = req.body;
      if (!lead_id) throw new ValidationError('lead_id is required');

      const lead = await loadLeadContext(supabase, lead_id, userId);
      const contact = lead.contacts ?? {};
      const company = lead.companies ?? {};

      const sequenceType = (TEMPLATE_TO_SEQUENCE[template] ?? 'cold_followup') as any;
      const generated = await claude.generateEmail({
        sequenceType,
        stepNumber: 1,
        contactFirstName: contact.first_name ?? '',
        contactLastName: contact.last_name ?? '',
        contactTitle: contact.title ?? '',
        companyName: company.name ?? '',
        senderName: env.COMPANY_NAME,
        senderTitle: 'Sales',
        senderCompany: env.COMPANY_NAME,
        storeCount: lead.store_count_confirmed ?? company.store_count ?? undefined,
        painPoints: lead.pain_points ?? undefined,
        callSummary: lead.last_call_summary ?? undefined,
      });

      res.json({
        subject: generated.subject,
        body_text: generated.bodyText,
        body_html: generated.bodyHtml,
        preview_text: generated.previewText,
        to_address: contact.email ?? null,
        template,
        cost_usd: generated.costUsd,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/emails/send — queues the email for actual sending
  router.post('/send', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { lead_id, subject, body, template, cc } = req.body;
      if (!lead_id) throw new ValidationError('lead_id is required');

      const lead = await loadLeadContext(supabase, lead_id, userId);
      const contact = lead.contacts ?? {};
      if (!contact.email) {
        res.status(400).json({
          error: { code: 'NO_RECIPIENT_EMAIL', message: 'Contact has no email address on file' },
        });
        return;
      }

      const gmailConfigured =
        !!process.env.GMAIL_CLIENT_ID && !!process.env.GMAIL_REFRESH_TOKEN;

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

      logger.info({ jobId: job.id, leadId: lead_id, gmailConfigured }, 'Email queued');

      res.status(202).json({
        success: true,
        queued: true,
        jobId: job.id,
        gmail_configured: gmailConfigured,
        message: gmailConfigured
          ? 'Email queued and will be sent by the worker shortly.'
          : 'Email queued, but Gmail OAuth is NOT configured in .env — the worker will fail to actually deliver until GMAIL_* env vars are filled in.',
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
