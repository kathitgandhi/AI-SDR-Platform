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
          id, name, status, vertical, daily_limit, concurrency, hourly_limit,
          total_leads, leads_called, leads_qualified, meetings_booked,
          start_date, end_date, created_at, updated_at
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
      const { name, vertical, daily_limit, concurrency, hourly_limit, start_date, end_date, target_filters } = req.body;
      if (!name) throw new ValidationError('name is required');

      const { data, error } = await supabase
        .from('campaigns')
        .insert({
          name,
          vertical,
          daily_limit: daily_limit ?? 100,
          concurrency: concurrency ?? 5,
          hourly_limit: hourly_limit ?? 20,
          start_date,
          end_date,
          target_filters: target_filters ?? {},
          status: 'active',
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
      const { daily_limit, concurrency, hourly_limit } = req.body;
      const updates: Record<string, number | string> = { updated_at: new Date().toISOString() };
      if (daily_limit !== undefined) updates.daily_limit = daily_limit;
      if (concurrency !== undefined) updates.concurrency = concurrency;
      if (hourly_limit !== undefined) updates.hourly_limit = hourly_limit;

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
