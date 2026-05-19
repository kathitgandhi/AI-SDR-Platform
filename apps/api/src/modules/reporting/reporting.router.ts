import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createReportingRouter({ supabase, logger: _logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/reporting/stats?date_from=&date_to=&campaign_id=
  router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { date_from, date_to, campaign_id } = req.query as Record<string, string>;

      const from = date_from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const to = date_to ?? new Date().toISOString().slice(0, 10);

      let query = supabase
        .from('calls')
        .select('persona, outcome, status, duration_seconds, talk_time_seconds, meeting_booked, decision_maker_reached, voicemail_left, dnc_requested, created_at')
        .gte('created_at', `${from}T00:00:00Z`)
        .lte('created_at', `${to}T23:59:59Z`);

      if (campaign_id) query = query.eq('campaign_id', campaign_id);

      const { data: calls, error } = await query;
      if (error) throw error;

      // Group by date
      const byDate: Record<string, {
        date: string; total: number; completed: number; meetings: number;
        dm_reached: number; voicemails: number; dnc: number; avg_duration: number;
      }> = {};

      for (const call of calls ?? []) {
        const date = call.created_at.slice(0, 10);
        if (!byDate[date]) {
          byDate[date] = { date, total: 0, completed: 0, meetings: 0, dm_reached: 0, voicemails: 0, dnc: 0, avg_duration: 0 };
        }
        const d = byDate[date];
        d.total++;
        if (call.status === 'completed') d.completed++;
        if (call.meeting_booked) d.meetings++;
        if (call.decision_maker_reached) d.dm_reached++;
        if (call.voicemail_left) d.voicemails++;
        if (call.dnc_requested) d.dnc++;
        d.avg_duration = Math.round(
          (d.avg_duration * (d.completed - 1) + (call.duration_seconds ?? 0)) / Math.max(d.completed, 1)
        );
      }

      const stats = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

      const totals = stats.reduce(
        (acc, d) => ({
          total: acc.total + d.total,
          completed: acc.completed + d.completed,
          meetings: acc.meetings + d.meetings,
          dm_reached: acc.dm_reached + d.dm_reached,
          voicemails: acc.voicemails + d.voicemails,
          dnc: acc.dnc + d.dnc,
        }),
        { total: 0, completed: 0, meetings: 0, dm_reached: 0, voicemails: 0, dnc: 0 }
      );

      res.json({ stats, totals, dateRange: { from, to } });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/reporting/leaderboard?days=30
  router.get('/leaderboard', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = parseInt((req.query.days as string) ?? '30');
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const { data: calls, error } = await supabase
        .from('calls')
        .select('persona, outcome, status, duration_seconds, talk_time_seconds, meeting_booked, decision_maker_reached, qualification_score')
        .gte('created_at', since);

      if (error) throw error;

      const agents: Record<string, {
        persona: string; total_calls: number; completed: number; meetings: number;
        dm_reached: number; total_talk_secs: number; qual_scores: number[];
      }> = {};

      for (const call of calls ?? []) {
        if (!agents[call.persona]) {
          agents[call.persona] = { persona: call.persona, total_calls: 0, completed: 0, meetings: 0, dm_reached: 0, total_talk_secs: 0, qual_scores: [] };
        }
        const a = agents[call.persona];
        a.total_calls++;
        if (call.status === 'completed') a.completed++;
        if (call.meeting_booked) a.meetings++;
        if (call.decision_maker_reached) a.dm_reached++;
        if (call.talk_time_seconds) a.total_talk_secs += call.talk_time_seconds;
        if (call.qualification_score != null) a.qual_scores.push(call.qualification_score);
      }

      const leaderboard = Object.values(agents).map((a) => ({
        persona: a.persona,
        total_calls: a.total_calls,
        meetings_booked: a.meetings,
        dm_reached: a.dm_reached,
        meeting_rate_pct: a.completed > 0 ? Math.round((a.meetings / a.completed) * 100 * 10) / 10 : 0,
        dm_rate_pct: a.completed > 0 ? Math.round((a.dm_reached / a.completed) * 100 * 10) / 10 : 0,
        avg_talk_secs: a.completed > 0 ? Math.round(a.total_talk_secs / a.completed) : 0,
        avg_qual_score: a.qual_scores.length > 0
          ? Math.round(a.qual_scores.reduce((s, x) => s + x, 0) / a.qual_scores.length)
          : 0,
      })).sort((a, b) => b.meetings_booked - a.meetings_booked);

      res.json({ leaderboard, periodDays: days });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/reporting/pipeline
  router.get('/pipeline', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { data: leads, error } = await supabase
        .from('leads')
        .select('stage, score, campaign_id, meeting_booked_at');

      if (error) throw error;

      const stageOrder = [
        'new', 'enriching', 'enriched', 'phone_lookup_pending',
        'callable', 'email_only', 'in_call_queue', 'calling',
        'called_no_answer', 'called_voicemail', 'called_gatekeeper', 'connected',
        'qualified', 'meeting_booked', 'meeting_held',
        'nurturing_30d', 'nurturing_90d', 'nurturing_180d',
        'disqualified', 'dnc', 'dead',
      ];

      const stages: Record<string, { stage: string; count: number; avg_score: number; meetings: number }> = {};
      for (const lead of leads ?? []) {
        if (!stages[lead.stage]) stages[lead.stage] = { stage: lead.stage, count: 0, avg_score: 0, meetings: 0 };
        const s = stages[lead.stage];
        s.count++;
        s.avg_score = Math.round((s.avg_score * (s.count - 1) + (lead.score ?? 0)) / s.count);
        if (lead.meeting_booked_at) s.meetings++;
      }

      const pipeline = stageOrder
        .map((stage) => stages[stage] ?? { stage, count: 0, avg_score: 0, meetings: 0 })
        .filter((s) => s.count > 0);

      res.json({ pipeline, totalLeads: (leads ?? []).length });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/reporting/costs?date_from=&date_to=
  router.get('/costs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { date_from, date_to } = req.query as Record<string, string>;
      const from = date_from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const to = date_to ?? new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('api_usage')
        .select('provider, operation, input_tokens, output_tokens, units_consumed, cost_usd, created_at')
        .gte('created_at', `${from}T00:00:00Z`)
        .lte('created_at', `${to}T23:59:59Z`);

      if (error) throw error;

      const byProvider: Record<string, { provider: string; requests: number; cost_usd: number; input_tokens: number; output_tokens: number }> = {};
      let totalCost = 0;

      for (const row of data ?? []) {
        if (!byProvider[row.provider]) {
          byProvider[row.provider] = { provider: row.provider, requests: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
        }
        const p = byProvider[row.provider];
        p.requests++;
        p.cost_usd += row.cost_usd ?? 0;
        p.input_tokens += row.input_tokens ?? 0;
        p.output_tokens += row.output_tokens ?? 0;
        totalCost += row.cost_usd ?? 0;
      }

      res.json({
        byProvider: Object.values(byProvider).sort((a, b) => b.cost_usd - a.cost_usd),
        totalCostUsd: Math.round(totalCost * 10000) / 10000,
        dateRange: { from, to },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
