import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

/**
 * Transfer rules govern when an in-progress AI call should be transferred to a human number.
 *
 * Triggers:
 *  - explicit_request: caller asked to speak to a human (detected by the ElevenLabs agent's tool call)
 *  - qualification_threshold: BANT/qualification score meets `conditions.min_qualification_score`
 *  - keyword: transcript contains any of `conditions.keywords`
 *  - outcome: call analysis returned an outcome in `conditions.outcomes`
 *  - always: every inbound call is transferred (e.g., business hours overflow)
 *
 * Evaluated by the worker / call handler at the right moments. This router only manages config.
 */
export function createTransferRulesRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/transfer-rules
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { campaign_id, enabled } = req.query as Record<string, string>;

      let q = supabase
        .from('transfer_rules')
        .select('*')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      if (userId) q = q.eq('created_by', userId);
      if (campaign_id) q = q.eq('campaign_id', campaign_id);
      if (enabled !== undefined) q = q.eq('enabled', enabled === 'true');

      const { data, error } = await q;
      if (error) throw error;
      res.json({ rules: data ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/transfer-rules
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const {
        name, trigger, conditions, transfer_to_number, transfer_to_name,
        campaign_id, enabled, priority,
      } = req.body;
      if (!name) throw new ValidationError('name is required');
      if (!trigger) throw new ValidationError('trigger is required');
      if (!transfer_to_number) throw new ValidationError('transfer_to_number is required');

      const validTriggers = ['explicit_request', 'qualification_threshold', 'keyword', 'outcome', 'always'];
      if (!validTriggers.includes(trigger)) {
        throw new ValidationError(`trigger must be one of: ${validTriggers.join(', ')}`);
      }

      const insert: Record<string, unknown> = {
        name,
        trigger,
        conditions: conditions ?? {},
        transfer_to_number,
        transfer_to_name,
        campaign_id,
        enabled: enabled ?? true,
        priority: priority ?? 50,
      };
      if (userId) insert.created_by = userId;

      const { data, error } = await supabase.from('transfer_rules').insert(insert).select().single();
      if (error) throw error;
      logger.info({ ruleId: data.id, trigger }, 'Transfer rule created');
      res.status(201).json({ rule: data });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/transfer-rules/:id
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const allowed = ['name', 'trigger', 'conditions', 'transfer_to_number', 'transfer_to_name', 'campaign_id', 'enabled', 'priority'];
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of allowed) {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      }

      let q = supabase.from('transfer_rules').update(updates).eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data, error } = await q.select().single();
      if (error || !data) throw new NotFoundError('Transfer rule', req.params.id);
      res.json({ rule: data });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/v1/transfer-rules/:id
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let q = supabase.from('transfer_rules').delete().eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { error } = await q;
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/transfer-rules/transfer-now
  // Manually trigger a transfer on an in-progress call (button in UI for live override).
  //
  // ⚠️ NOT SUPPORTED with the ElevenLabs/Twilio stack. ElevenLabs owns the live
  // call leg, and there is no backend REST endpoint to force-transfer an active
  // conversation to a PSTN number. Live transfer must instead be configured as an
  // agent-side "Transfer to number" tool in the ElevenLabs dashboard (the agent
  // invokes it when the `explicit_request`/keyword conditions are met). This route
  // is retained so the UI gets a clear, actionable error rather than a 404.
  router.post('/transfer-now', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { call_id, transfer_to_number } = req.body;
      if (!call_id || !transfer_to_number) {
        throw new ValidationError('call_id and transfer_to_number required');
      }

      logger.warn(
        { callId: call_id, to: transfer_to_number },
        'transfer-now invoked but manual live transfer is not supported on ElevenLabs/Twilio',
      );

      res.status(501).json({
        error: {
          code: 'LIVE_TRANSFER_UNSUPPORTED',
          message:
            'Manual live transfer is not available with the ElevenLabs/Twilio stack. ' +
            'Configure a "Transfer to number" tool on the ElevenLabs agent so it can transfer ' +
            'when a transfer rule (explicit_request / keyword) is triggered.',
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
