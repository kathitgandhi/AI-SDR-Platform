import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../shared/errors';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createCampaignsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/campaigns
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .select(`
          id, name, description, status, target_verticals, target_titles,
          daily_call_limit, hourly_call_limit, max_concurrent_calls,
          enabled_personas, total_leads, calls_made, meetings_booked, emails_sent,
          started_at, paused_at, completed_at, created_at, updated_at
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json({ campaigns: data ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/campaigns/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data: campaign, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', req.params.id)
        .single();

      if (error || !campaign) throw new NotFoundError('Campaign', req.params.id);

      // Lead stage breakdown
      const { data: stageData } = await supabase
        .from('leads')
        .select('stage')
        .eq('campaign_id', req.params.id);

      const stageCounts: Record<string, number> = {};
      for (const lead of stageData ?? []) {
        stageCounts[lead.stage] = (stageCounts[lead.stage] ?? 0) + 1;
      }

      // Recent activity
      const { data: recentCalls } = await supabase
        .from('calls')
        .select('id, persona, outcome, duration_seconds, created_at')
        .eq('campaign_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(10);

      res.json({ campaign, stageCounts, recentCalls: recentCalls ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/campaigns
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        name, description, target_verticals, target_titles,
        daily_call_limit, hourly_call_limit, max_concurrent_calls,
        enabled_personas, status,
      } = req.body;
      if (!name) throw new ValidationError('name is required');

      const { data, error } = await supabase
        .from('campaigns')
        .insert({
          name,
          description,
          target_verticals,
          target_titles,
          daily_call_limit: daily_call_limit ?? 100,
          hourly_call_limit: hourly_call_limit ?? 20,
          max_concurrent_calls: max_concurrent_calls ?? 5,
          enabled_personas,
          status: status ?? 'draft',
        })
        .select()
        .single();

      if (error) throw error;
      logger.info({ campaignId: data.id }, 'Campaign created');
      res.status(201).json({ campaign: data });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/campaigns/:id/pause
  router.patch('/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error || !data) throw new NotFoundError('Campaign', req.params.id);
      logger.info({ campaignId: req.params.id }, 'Campaign paused');
      res.json({ campaign: data });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/campaigns/:id/resume
  router.patch('/:id/resume', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error || !data) throw new NotFoundError('Campaign', req.params.id);
      logger.info({ campaignId: req.params.id }, 'Campaign resumed');
      res.json({ campaign: data });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/campaigns/:id/pacing
  router.patch('/:id/pacing', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { daily_call_limit, max_concurrent_calls, hourly_call_limit } = req.body;
      const updates: Record<string, number | string> = { updated_at: new Date().toISOString() };
      if (daily_call_limit !== undefined) updates.daily_call_limit = daily_call_limit;
      if (max_concurrent_calls !== undefined) updates.max_concurrent_calls = max_concurrent_calls;
      if (hourly_call_limit !== undefined) updates.hourly_call_limit = hourly_call_limit;

      const { data, error } = await supabase
        .from('campaigns')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error || !data) throw new NotFoundError('Campaign', req.params.id);
      res.json({ campaign: data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
