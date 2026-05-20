import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createLeadsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/leads/hot — must be before /:id
  router.get('/hot', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let query = supabase
        .from('leads')
        .select(`
          id, score, stage, call_attempts, last_called_at, meeting_booked_at, created_at,
          contacts(id, first_name, last_name, title, email, phone),
          companies(id, name, retail_vertical, store_count, website)
        `)
        .in('stage', ['qualified', 'meeting_booked', 'connected'])
        .order('score', { ascending: false })
        .limit(25);
      if (userId) query = query.eq('created_by', userId);

      const { data, error } = await query;
      if (error) throw error;
      res.json({ leads: data ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/leads
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const {
        stage, score_min, vertical, company, campaign_id,
        limit = '50', offset = '0',
      } = req.query as Record<string, string>;

      let query = supabase
        .from('leads')
        .select(`
          id, score, stage, call_attempts, last_called_at, created_at,
          contacts(id, first_name, last_name, title, email),
          companies(id, name, retail_vertical, store_count)
        `, { count: 'exact' });

      if (userId) query = query.eq('created_by', userId);
      if (stage) query = query.eq('stage', stage);
      if (score_min) query = query.gte('score', parseInt(score_min));
      if (campaign_id) query = query.eq('campaign_id', campaign_id);
      if (vertical) query = query.eq('companies.retail_vertical', vertical);
      if (company) query = query.ilike('companies.name', `%${company}%`);

      query = query
        .order('score', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      res.json({ leads: data ?? [], total: count ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/leads/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let query = supabase
        .from('leads')
        .select(`*, contacts(*), companies(*)`)
        .eq('id', req.params.id);
      if (userId) query = query.eq('created_by', userId);
      const { data: lead, error } = await query.single();

      if (error || !lead) throw new NotFoundError('Lead', req.params.id);

      const { data: calls } = await supabase
        .from('calls')
        .select('id, persona, outcome, duration_seconds, meeting_booked, created_at')
        .eq('lead_id', req.params.id)
        .order('created_at', { ascending: false });

      const { data: emails } = await supabase
        .from('emails')
        .select('id, subject, status, sent_at, opened_count, clicked_count')
        .eq('lead_id', req.params.id)
        .order('created_at', { ascending: false });

      res.json({ lead, calls: calls ?? [], emails: emails ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/leads/:id/stage
  router.patch('/:id/stage', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { stage } = req.body;
      if (!stage) throw new ValidationError('stage is required');

      let query = supabase
        .from('leads')
        .update({ stage, updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (userId) query = query.eq('created_by', userId);
      const { data, error } = await query.select().single();

      if (error || !data) throw new NotFoundError('Lead', req.params.id);
      logger.info({ leadId: req.params.id, stage }, 'Lead stage updated');

      await supabase.from('lead_stage_history').insert({
        lead_id: req.params.id,
        to_stage: stage,
        changed_by: 'manual',
        reason: req.body.reason ?? 'Manual update via API',
      });

      res.json({ lead: data });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/leads/:id/dnc
  router.post('/:id/dnc', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { phone, email, reason } = req.body;
      if (!phone && !email) throw new ValidationError('phone or email is required');

      await supabase.from('dnc_list').insert({
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        source: 'internal',
        added_reason: reason ?? 'Added via dashboard',
        added_by: 'api',
        is_permanent: true,
      });

      let upd = supabase
        .from('leads')
        .update({ stage: 'dnc', updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (userId) upd = upd.eq('created_by', userId);
      await upd;

      logger.info({ leadId: req.params.id }, 'Lead added to DNC');
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
