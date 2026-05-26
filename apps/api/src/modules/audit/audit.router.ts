import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { getUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createAuditRouter({ supabase, logger: _logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/audit?entity_type=&entity_id=&action=&limit=&offset=
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { entity_type, entity_id, action, limit = '50', offset = '0' } =
        req.query as Record<string, string>;

      let q = supabase
        .from('audit_log')
        .select('id, user_id, action, entity_type, entity_id, changes, ip_address, created_at', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (userId) q = q.eq('user_id', userId);
      if (entity_type) q = q.eq('entity_type', entity_type);
      if (entity_id) q = q.eq('entity_id', entity_id);
      if (action) q = q.eq('action', action);

      q = q.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      res.json({ entries: data ?? [], total: count ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
