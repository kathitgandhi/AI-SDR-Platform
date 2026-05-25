import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createCallsRouter({ supabase, logger: _logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/calls/meetings — must be before /:id
  router.get('/meetings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { status, limit = '50', offset = '0' } = req.query as Record<string, string>;

      let query = supabase
        .from('appointments')
        .select(`
          id, status, scheduled_at, duration_minutes, timezone, meeting_type,
          meeting_link, assigned_rep_name, assigned_rep_email,
          qualification_summary, key_pain_points, products_of_interest,
          store_count, budget_indication, decision_timeline, created_at,
          contacts(id, first_name, last_name, title, email),
          companies(id, name, retail_vertical, store_count)
        `, { count: 'exact' })
        .order('scheduled_at', { ascending: false });

      if (userId) query = query.eq('created_by', userId);
      if (status) query = query.eq('status', status);

      query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      res.json({ appointments: data ?? [], total: count ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/calls/search
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q, limit = '20' } = req.query as Record<string, string>;
      if (!q) { res.json({ results: [] }); return; }

      const { data, error } = await supabase
        .from('call_transcripts')
        .select(`
          id, call_id, created_at,
          calls(persona, outcome, created_at,
            contacts(first_name, last_name),
            companies(name)
          )
        `)
        .textSearch('full_transcript', q, { type: 'websearch' })
        .limit(parseInt(limit));

      if (error) throw error;
      res.json({ results: data ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/calls
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const {
        persona, outcome, campaign_id,
        limit = '50', offset = '0',
      } = req.query as Record<string, string>;

      const { direction } = req.query as Record<string, string>;
      let query = supabase
        .from('calls')
        .select(`
          id, persona, outcome, status, direction, duration_seconds, meeting_booked,
          voicemail_left, decision_maker_reached, dnc_requested, from_number, to_number, created_at,
          contacts(id, first_name, last_name, title),
          companies(id, name, retail_vertical)
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (userId) query = query.eq('created_by', userId);
      if (persona) query = query.eq('persona', persona);
      if (direction) query = query.eq('direction', direction);
      if (outcome) query = query.eq('outcome', outcome);
      if (campaign_id) query = query.eq('campaign_id', campaign_id);

      query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      res.json({ calls: data ?? [], total: count ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/calls/:id/transcript
  router.get('/:id/transcript', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let q = supabase
        .from('calls')
        .select(`
          id, persona, outcome, status, direction, duration_seconds, talk_time_seconds,
          meeting_booked, voicemail_left, decision_maker_reached, dnc_requested,
          from_number, to_number, call_summary, next_steps, qualification_score, sentiment_score,
          created_at, answered_at, ended_at,
          contacts(id, first_name, last_name, title, email, phone_direct),
          companies(id, name, retail_vertical, store_count, website)
        `)
        .eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data: call, error: callError } = await q.single();

      if (callError || !call) throw new NotFoundError('Call', req.params.id);

      const { data: transcript } = await supabase
        .from('call_transcripts')
        .select('*')
        .eq('call_id', req.params.id)
        .single();

      res.json({ call, transcript: transcript ?? null });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
