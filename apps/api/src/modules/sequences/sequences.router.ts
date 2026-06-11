import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

/**
 * Read API for the Sequences screen. Previously the frontend had no endpoint and
 * had to read Supabase tables directly. This exposes:
 *   - GET /              → email_sequences + their steps (the sequence catalog)
 *   - GET /enrollments   → contact_sequences (who's enrolled, current step, status)
 *
 * All read-only and single-team (see getReadScopeUserId): enrollments are created
 * by the workers (post-call + email_only on add/import) with created_by NULL, so
 * they must NOT be per-user scoped or the screen would look empty.
 */
export function createSequencesRouter({ supabase }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/sequences — sequence catalog with steps
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { data: sequences, error } = await supabase
        .from('email_sequences')
        .select('id, name, description, trigger_event, is_active, total_steps, created_at')
        .order('name', { ascending: true });
      if (error) throw error;

      const ids = (sequences ?? []).map((s) => s.id);
      let stepsBySeq: Record<string, unknown[]> = {};
      if (ids.length > 0) {
        const { data: steps } = await supabase
          .from('sequence_steps')
          .select('id, sequence_id, step_number, delay_days, delay_hours, subject_template, send_time_hour, send_time_minute, is_active')
          .in('sequence_id', ids)
          .order('step_number', { ascending: true });
        stepsBySeq = (steps ?? []).reduce((acc: Record<string, unknown[]>, step) => {
          (acc[step.sequence_id] ??= []).push(step);
          return acc;
        }, {});
      }

      // Live enrollment counts per sequence (active enrollments).
      const { data: enrollCounts } = await supabase
        .from('contact_sequences')
        .select('sequence_id, status');
      const activeBySeq: Record<string, number> = {};
      for (const row of enrollCounts ?? []) {
        if (row.status === 'active') activeBySeq[row.sequence_id] = (activeBySeq[row.sequence_id] ?? 0) + 1;
      }

      res.json({
        sequences: (sequences ?? []).map((s) => ({
          ...s,
          steps: stepsBySeq[s.id] ?? [],
          active_enrollments: activeBySeq[s.id] ?? 0,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/sequences/enrollments?status=&lead_id=&contact_id=&sequence_id=
  // NOTE: contact_sequences has no created_by column (worker-created), so these
  // are intentionally never per-user scoped.
  router.get('/enrollments', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, lead_id, contact_id, sequence_id, limit = '100', offset = '0' } =
        req.query as Record<string, string>;

      let q = supabase
        .from('contact_sequences')
        .select(`
          id, contact_id, lead_id, sequence_id, campaign_id, current_step, status,
          trigger_event, enrolled_at, next_send_at, completed_at,
          contacts(id, first_name, last_name, email),
          email_sequences(id, name, total_steps)
        `, { count: 'exact' })
        .order('enrolled_at', { ascending: false });

      if (status) q = q.eq('status', status);
      if (lead_id) q = q.eq('lead_id', lead_id);
      if (contact_id) q = q.eq('contact_id', contact_id);
      if (sequence_id) q = q.eq('sequence_id', sequence_id);

      q = q.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      res.json({ enrollments: data ?? [], total: count ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
