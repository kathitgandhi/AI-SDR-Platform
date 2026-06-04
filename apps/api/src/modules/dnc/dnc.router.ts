import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId, getReadScopeUserId } from '../../shared/user-scope';
import { audit } from '../../shared/audit';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createDncRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/dnc?type=phone|email&q=search
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getReadScopeUserId(req);
      const { type, q, limit = '100', offset = '0' } = req.query as Record<string, string>;

      let query = supabase
        .from('dnc_list')
        .select('id, phone, email, source, added_reason, added_by, is_permanent, created_at, expires_at', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (userId) query = query.eq('created_by', userId);
      if (type === 'phone') query = query.not('phone', 'is', null);
      if (type === 'email') query = query.not('email', 'is', null);
      if (q) query = query.or(`phone.ilike.%${q}%,email.ilike.%${q}%`);

      query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      const { data, error, count } = await query;
      if (error) throw error;
      res.json({ entries: data ?? [], total: count ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/dnc — add an entry
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { phone, email, reason, source, is_permanent, expires_at } = req.body;
      if (!phone && !email) throw new ValidationError('phone or email is required');

      const insert: Record<string, unknown> = {
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        source: source ?? 'manual',
        added_reason: reason ?? 'Added via dashboard',
        added_by: 'api',
        is_permanent: is_permanent ?? true,
        expires_at: expires_at ?? null,
      };
      if (userId) insert.created_by = userId;

      const { data, error } = await supabase.from('dnc_list').insert(insert).select().single();
      if (error) throw error;

      audit(supabase, logger, req, {
        action: 'create',
        entity_type: 'dnc',
        entity_id: data.id,
        changes: { phone, email, reason },
      });

      // Cascade: mark any leads with this phone/email as stage='dnc'
      if (phone) {
        await supabase
          .from('leads')
          .update({ stage: 'dnc', updated_at: new Date().toISOString() })
          .eq('contact_id', (
            await supabase.from('contacts').select('id').eq('phone_direct', phone).maybeSingle()
          ).data?.id ?? '00000000-0000-0000-0000-000000000000');
      }

      res.status(201).json({ entry: data });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/dnc/:id
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let q = supabase.from('dnc_list').delete().eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { error, count } = await q;
      if (error) throw error;
      if (count === 0) throw new NotFoundError('DNC entry', req.params.id);

      audit(supabase, logger, req, {
        action: 'delete',
        entity_type: 'dnc',
        entity_id: req.params.id,
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
