import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createCallsRouter({ supabase, logger }: RouterContext): Router {
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

  // POST /api/v1/calls/log — manual call log entry (call made outside the AI system)
  router.post('/log', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const {
        lead_id, contact_id, company_id, campaign_id, persona,
        direction, outcome, duration_seconds, notes, meeting_booked,
        from_number, to_number,
      } = req.body;

      if (!lead_id || !contact_id || !company_id) {
        throw new ValidationError('lead_id, contact_id, company_id are required');
      }

      const insert: Record<string, unknown> = {
        lead_id, contact_id, company_id, campaign_id,
        persona: persona ?? 'mike',
        direction: direction ?? 'outbound',
        status: 'completed',
        outcome: outcome ?? 'connected',
        duration_seconds: duration_seconds ?? 0,
        talk_time_seconds: duration_seconds ?? 0,
        meeting_booked: meeting_booked ?? false,
        from_number: from_number ?? 'manual',
        to_number: to_number ?? 'manual',
        call_summary: notes ?? null,
        initiated_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        ai_disclosed: false,  // wasn't an AI call
      };
      if (userId) insert.created_by = userId;

      const { data, error } = await supabase.from('calls').insert(insert).select().single();
      if (error) throw error;
      logger.info({ callId: data.id }, 'Manual call logged');
      res.status(201).json({ call: data });
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
          recording_url, recording_duration_seconds,
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
