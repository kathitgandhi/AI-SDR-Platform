import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId, getReadScopeUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

// These mirror the Postgres enums (retail_vertical, persona_name, campaign_status)
// in 001_initial_schema.sql. target_verticals/enabled_personas are enum[] columns,
// so a value that isn't an exact enum member makes Postgres reject the whole insert
// with an opaque 500. We normalize friendly labels ("Grocery", "Wholesale
// Distribution") to the enum value and return a clear 400 on anything invalid.
const VALID_VERTICALS = [
  'grocery', 'general_retail', 'wholesale_distribution', 'automotive_retail',
  'electronics', 'specialty', 'cpg_operator', 'pharmacy', 'convenience',
  'home_improvement', 'fashion_apparel', 'furniture', 'unknown',
];
const VALID_PERSONAS = ['mike', 'sarah', 'david', 'rachel', 'chris', 'emma', 'daniel'];
const VALID_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'];

/** Lowercase + collapse spaces/hyphens to underscores so "Wholesale Distribution"
 *  and "wholesale-distribution" both map to the enum value "wholesale_distribution". */
function toEnumValue(raw: unknown): string {
  return String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Normalize an incoming enum array against the allowed set. Returns undefined for
 *  null/undefined (so the DB column default is preserved); throws ValidationError
 *  (→ 400) listing valid values when any entry is unrecognized. */
function normalizeEnumArray(
  value: unknown,
  valid: string[],
  field: string,
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array`);
  return value.map((raw) => {
    const norm = toEnumValue(raw);
    if (!valid.includes(norm)) {
      throw new ValidationError(
        `Invalid ${field} value "${raw}". Valid values: ${valid.join(', ')}`,
      );
    }
    return norm;
  });
}

export function createCampaignsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/campaigns
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getReadScopeUserId(req);
      let query = supabase
        .from('campaigns')
        .select(`
          id, name, description, status, target_verticals, target_titles,
          daily_call_limit, hourly_call_limit, max_concurrent_calls,
          enabled_personas, total_leads, calls_made, meetings_booked, emails_sent,
          started_at, paused_at, completed_at, created_at, updated_at
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (userId) query = query.eq('created_by', userId);

      const { data, error } = await query;
      if (error) throw error;

      // The total_leads/calls_made/meetings_booked columns are denormalized and
      // were never maintained, so they always read 0. Compute the counts live
      // from the source tables instead.
      const campaigns = data ?? [];
      const ids = campaigns.map((c) => c.id);
      if (ids.length > 0) {
        const [leadRows, callRows, apptRows] = await Promise.all([
          supabase.from('leads').select('campaign_id').in('campaign_id', ids).is('deleted_at', null),
          supabase.from('calls').select('campaign_id').in('campaign_id', ids),
          supabase.from('appointments').select('campaign_id').in('campaign_id', ids),
        ]);
        const tally = (rows: Array<{ campaign_id: string | null }> | null) => {
          const m: Record<string, number> = {};
          for (const r of rows ?? []) if (r.campaign_id) m[r.campaign_id] = (m[r.campaign_id] ?? 0) + 1;
          return m;
        };
        const leadsByC = tally(leadRows.data);
        const callsByC = tally(callRows.data);
        const apptsByC = tally(apptRows.data);
        for (const c of campaigns) {
          (c as Record<string, unknown>)['total_leads'] = leadsByC[c.id] ?? 0;
          (c as Record<string, unknown>)['calls_made'] = callsByC[c.id] ?? 0;
          (c as Record<string, unknown>)['meetings_booked'] = apptsByC[c.id] ?? 0;
        }
      }

      res.json({ campaigns });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/campaigns/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getReadScopeUserId(req);
      let query = supabase.from('campaigns').select('*').eq('id', req.params.id).is('deleted_at', null);
      if (userId) query = query.eq('created_by', userId);
      const { data: campaign, error } = await query.single();

      if (error || !campaign) throw new NotFoundError('Campaign', req.params.id);

      const { data: stageData } = await supabase
        .from('leads')
        .select('stage')
        .eq('campaign_id', req.params.id);

      const stageCounts: Record<string, number> = {};
      for (const lead of stageData ?? []) {
        stageCounts[lead.stage] = (stageCounts[lead.stage] ?? 0) + 1;
      }

      const { data: recentCalls } = await supabase
        .from('calls')
        .select('id, persona, outcome, duration_seconds, created_at')
        .eq('campaign_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(10);

      // Live counts (the denormalized columns are never maintained).
      const [{ count: callsMade }, { count: meetingsBooked }] = await Promise.all([
        supabase.from('calls').select('id', { count: 'exact', head: true }).eq('campaign_id', req.params.id),
        supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('campaign_id', req.params.id),
      ]);
      (campaign as Record<string, unknown>)['total_leads'] = (stageData ?? []).length;
      (campaign as Record<string, unknown>)['calls_made'] = callsMade ?? 0;
      (campaign as Record<string, unknown>)['meetings_booked'] = meetingsBooked ?? 0;

      res.json({ campaign, stageCounts, recentCalls: recentCalls ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/campaigns
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const {
        name, description, target_verticals, target_titles,
        daily_call_limit, hourly_call_limit, max_concurrent_calls,
        enabled_personas, status,
      } = req.body;
      if (!name) throw new ValidationError('name is required');

      const normalizedVerticals = normalizeEnumArray(target_verticals, VALID_VERTICALS, 'target_verticals');
      const normalizedPersonas = normalizeEnumArray(enabled_personas, VALID_PERSONAS, 'enabled_personas');
      const normalizedStatus = status === undefined || status === null ? 'draft' : toEnumValue(status);
      if (!VALID_STATUSES.includes(normalizedStatus)) {
        throw new ValidationError(`Invalid status "${status}". Valid values: ${VALID_STATUSES.join(', ')}`);
      }

      const insert: Record<string, unknown> = {
        name,
        description,
        target_titles,
        daily_call_limit: daily_call_limit ?? 100,
        hourly_call_limit: hourly_call_limit ?? 20,
        max_concurrent_calls: max_concurrent_calls ?? 5,
        status: normalizedStatus,
      };
      // Only set enum-array columns when provided, so the DB defaults are preserved.
      if (normalizedVerticals !== undefined) insert.target_verticals = normalizedVerticals;
      if (normalizedPersonas !== undefined) insert.enabled_personas = normalizedPersonas;
      if (userId) insert.created_by = userId;

      const { data, error } = await supabase
        .from('campaigns')
        .insert(insert)
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
      const userId = getUserId(req);
      let query = supabase
        .from('campaigns')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (userId) query = query.eq('created_by', userId);
      const { data, error } = await query.select().single();

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
      const userId = getUserId(req);
      let query = supabase
        .from('campaigns')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (userId) query = query.eq('created_by', userId);
      const { data, error } = await query.select().single();

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
      const userId = getUserId(req);
      const { daily_call_limit, max_concurrent_calls, hourly_call_limit } = req.body;
      const updates: Record<string, number | string> = { updated_at: new Date().toISOString() };
      if (daily_call_limit !== undefined) updates.daily_call_limit = daily_call_limit;
      if (max_concurrent_calls !== undefined) updates.max_concurrent_calls = max_concurrent_calls;
      if (hourly_call_limit !== undefined) updates.hourly_call_limit = hourly_call_limit;

      let query = supabase.from('campaigns').update(updates).eq('id', req.params.id);
      if (userId) query = query.eq('created_by', userId);
      const { data, error } = await query.select().single();

      if (error || !data) throw new NotFoundError('Campaign', req.params.id);
      res.json({ campaign: data });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/campaigns/:id — edit general fields
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const b = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

      if (b['name'] !== undefined) updates['name'] = b['name'];
      if (b['description'] !== undefined) updates['description'] = b['description'];
      if (b['target_titles'] !== undefined) updates['target_titles'] = b['target_titles'];
      if (b['daily_call_limit'] !== undefined) updates['daily_call_limit'] = b['daily_call_limit'];
      if (b['hourly_call_limit'] !== undefined) updates['hourly_call_limit'] = b['hourly_call_limit'];
      if (b['max_concurrent_calls'] !== undefined) updates['max_concurrent_calls'] = b['max_concurrent_calls'];
      const verticals = normalizeEnumArray(b['target_verticals'], VALID_VERTICALS, 'target_verticals');
      if (verticals !== undefined) updates['target_verticals'] = verticals;
      const personas = normalizeEnumArray(b['enabled_personas'], VALID_PERSONAS, 'enabled_personas');
      if (personas !== undefined) updates['enabled_personas'] = personas;
      if (b['status'] !== undefined) {
        const status = toEnumValue(b['status']);
        if (!VALID_STATUSES.includes(status)) {
          throw new ValidationError(`Invalid status "${b['status']}". Valid values: ${VALID_STATUSES.join(', ')}`);
        }
        updates['status'] = status;
      }

      let query = supabase.from('campaigns').update(updates).eq('id', req.params.id).is('deleted_at', null);
      if (userId) query = query.eq('created_by', userId);
      const { data, error } = await query.select().single();
      if (error || !data) throw new NotFoundError('Campaign', req.params.id);
      logger.info({ campaignId: req.params.id }, 'Campaign updated');
      res.json({ campaign: data });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/campaigns/:id — soft delete (reversible; hard delete is
  // blocked by RESTRICT FKs on calls/leads and would destroy history).
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const now = new Date().toISOString();
      let query = supabase.from('campaigns')
        .update({ deleted_at: now, status: 'archived', updated_at: now })
        .eq('id', req.params.id).is('deleted_at', null);
      if (userId) query = query.eq('created_by', userId);
      const { data, error } = await query.select('id').single();
      if (error || !data) throw new NotFoundError('Campaign', req.params.id);
      logger.info({ campaignId: req.params.id }, 'Campaign soft-deleted');
      res.json({ success: true, id: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
