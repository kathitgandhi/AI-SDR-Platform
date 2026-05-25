import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createNotesRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/notes?lead_id=&call_id=
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { lead_id, call_id } = req.query as Record<string, string>;
      if (!lead_id && !call_id) throw new ValidationError('lead_id or call_id required');

      let q = supabase
        .from('notes')
        .select('id, body, source, created_by, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (lead_id) q = q.eq('lead_id', lead_id);
      if (call_id) q = q.eq('call_id', call_id);
      if (userId) q = q.eq('created_by', userId);

      const { data, error } = await q;
      if (error) throw error;
      res.json({ notes: data ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/notes
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { lead_id, call_id, body, source } = req.body;
      if (!body) throw new ValidationError('body is required');
      if (!lead_id && !call_id) throw new ValidationError('lead_id or call_id required');

      const insert: Record<string, unknown> = { body, source: source ?? 'manual' };
      if (lead_id) insert.lead_id = lead_id;
      if (call_id) insert.call_id = call_id;
      if (userId) insert.created_by = userId;

      const { data, error } = await supabase.from('notes').insert(insert).select().single();
      if (error) throw error;
      logger.info({ noteId: data.id }, 'Note created');
      res.status(201).json({ note: data });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/notes/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { body } = req.body;
      if (!body) throw new ValidationError('body is required');

      let q = supabase
        .from('notes')
        .update({ body, updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data, error } = await q.select().single();

      if (error || !data) throw new NotFoundError('Note', req.params.id);
      res.json({ note: data });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/notes/:id
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let q = supabase.from('notes').delete().eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { error } = await q;
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
