import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { ValidationError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';
import { audit } from '../../shared/audit';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

const DEFAULT_SETTINGS = {
  company_profile: {
    company_name: 'AirRetail Technologies',
    company_website: 'https://airretail.com',
    sales_team_email: 'sales@airretail.com',
    support_email: 'support@airretail.com',
    ai_disclosure_text: 'Hi, this is an AI assistant calling on behalf of {company}. This call may be recorded for quality assurance.',
    timezone: 'America/New_York',
  },
  business_hours: {
    call_window_start_hour: 8,
    call_window_end_hour: 21,
    call_days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    auto_pause_outside_hours: true,
  },
  pacing: {
    default_daily_call_limit: 100,
    default_hourly_call_limit: 20,
    default_max_concurrent: 5,
  },
  compliance: {
    ai_disclosure_required: true,
    record_calls: true,
    delete_recordings_after_days: 90,
  },
};

export function createSettingsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/settings — returns all settings merged with defaults
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        res.json({ settings: DEFAULT_SETTINGS });
        return;
      }

      const { data } = await supabase
        .from('app_settings')
        .select('key, value')
        .eq('user_id', userId);

      const stored: Record<string, unknown> = {};
      for (const row of data ?? []) {
        stored[row.key] = row.value;
      }

      // Merge defaults so frontend always sees a complete object
      const merged: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        merged[k] = { ...v, ...((stored[k] as object) ?? {}) };
      }
      // Include any non-default keys the user might have set
      for (const [k, v] of Object.entries(stored)) {
        if (!(k in merged)) merged[k] = v;
      }

      res.json({ settings: merged });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/settings/:key
  router.get('/:key', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        const def = (DEFAULT_SETTINGS as Record<string, unknown>)[req.params.key];
        res.json({ key: req.params.key, value: def ?? null });
        return;
      }

      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', userId)
        .eq('key', req.params.key)
        .maybeSingle();

      const def = (DEFAULT_SETTINGS as Record<string, unknown>)[req.params.key];
      const value = data?.value ?? def ?? null;
      res.json({ key: req.params.key, value });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/v1/settings/:key — upsert a setting block
  router.put('/:key', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      if (!userId) throw new ValidationError('Authentication required to write settings');
      const { value } = req.body;
      if (value === undefined) throw new ValidationError('value is required');

      const { data, error } = await supabase
        .from('app_settings')
        .upsert(
          { user_id: userId, key: req.params.key, value, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,key' },
        )
        .select()
        .single();
      if (error) throw error;

      audit(supabase, logger, req, {
        action: 'update',
        entity_type: 'setting',
        entity_id: data.id,
        changes: { key: req.params.key, value },
      });

      res.json({ key: req.params.key, value: data.value });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
