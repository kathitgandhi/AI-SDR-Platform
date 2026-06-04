import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId, getReadScopeUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createTicketsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/tickets?status=&priority=&lead_id=
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getReadScopeUserId(req);
      const { status, priority, lead_id, contact_id, company_id, call_id, limit = '50', offset = '0' } =
        req.query as Record<string, string>;

      let q = supabase
        .from('tickets')
        .select(`
          id, title, description, status, priority,
          lead_id, contact_id, company_id, call_id,
          assigned_to, created_by, resolved_at, created_at, updated_at,
          contacts(id, first_name, last_name, email),
          companies(id, name)
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (userId) q = q.eq('created_by', userId);
      if (status) q = q.eq('status', status);
      if (priority) q = q.eq('priority', priority);
      if (lead_id) q = q.eq('lead_id', lead_id);
      if (contact_id) q = q.eq('contact_id', contact_id);
      if (company_id) q = q.eq('company_id', company_id);
      if (call_id) q = q.eq('call_id', call_id);

      q = q.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      const { data, error, count } = await q;
      if (error) throw error;
      res.json({ tickets: data ?? [], total: count ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/tickets/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getReadScopeUserId(req);
      let q = supabase
        .from('tickets')
        .select(`*, contacts(*), companies(*)`)
        .eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data, error } = await q.single();
      if (error || !data) throw new NotFoundError('Ticket', req.params.id);
      res.json({ ticket: data });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/tickets
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const {
        title, description, priority, status,
        lead_id, contact_id, company_id, call_id, assigned_to,
      } = req.body;
      if (!title) throw new ValidationError('title is required');

      const insert: Record<string, unknown> = {
        title,
        description,
        priority: priority ?? 'medium',
        status: status ?? 'open',
        lead_id, contact_id, company_id, call_id, assigned_to,
      };
      if (userId) insert.created_by = userId;

      const { data, error } = await supabase.from('tickets').insert(insert).select().single();
      if (error) throw error;
      logger.info({ ticketId: data.id }, 'Ticket created');
      res.status(201).json({ ticket: data });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/tickets/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { title, description, status, priority, assigned_to } = req.body;
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (status !== undefined) {
        updates.status = status;
        if (status === 'resolved' || status === 'closed') updates.resolved_at = new Date().toISOString();
      }
      if (priority !== undefined) updates.priority = priority;
      if (assigned_to !== undefined) updates.assigned_to = assigned_to;

      let q = supabase.from('tickets').update(updates).eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data, error } = await q.select().single();

      if (error || !data) throw new NotFoundError('Ticket', req.params.id);
      res.json({ ticket: data });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/tickets/:id
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let q = supabase.from('tickets').delete().eq('id', req.params.id);
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
