import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createDashboardRouter({ supabase }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/dashboard
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());

      const [
        todayCallsRes,
        meetingsThisWeekRes,
        activeCampaignsRes,
        hotLeadsRes,
        recentCallsRes,
        agentStatsRes,
      ] = await Promise.all([
        supabase
          .from('calls')
          .select('outcome, duration_seconds, meeting_booked, decision_maker_reached')
          .gte('created_at', todayIso),
        supabase
          .from('appointments')
          .select('id, status')
          .gte('created_at', weekStart.toISOString())
          .in('status', ['scheduled', 'confirmed', 'held']),
        supabase
          .from('campaigns')
          .select('id')
          .eq('status', 'active'),
        supabase
          .from('leads')
          .select('id, score')
          .in('stage', ['qualified', 'meeting_booked'])
          .order('score', { ascending: false })
          .limit(5),
        supabase
          .from('calls')
          .select(`
            id, persona, outcome, duration_seconds, created_at,
            contacts(first_name, last_name),
            companies(name)
          `)
          .order('created_at', { ascending: false })
          .limit(8),
        supabase
          .from('calls')
          .select('persona, outcome, meeting_booked')
          .eq('status', 'completed')
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      const todayCalls = todayCallsRes.data ?? [];
      const totalToday = todayCalls.length;
      const meetingsToday = todayCalls.filter((c) => c.meeting_booked).length;
      const dmReachedToday = todayCalls.filter((c) => c.decision_maker_reached).length;
      const avgDuration = totalToday > 0
        ? Math.round(todayCalls.reduce((sum, c) => sum + (c.duration_seconds ?? 0), 0) / totalToday)
        : 0;

      // Agent stats aggregation
      const agentMap: Record<string, { calls: number; meetings: number }> = {};
      for (const call of agentStatsRes.data ?? []) {
        if (!agentMap[call.persona]) agentMap[call.persona] = { calls: 0, meetings: 0 };
        agentMap[call.persona].calls++;
        if (call.meeting_booked) agentMap[call.persona].meetings++;
      }
      const agentStats = Object.entries(agentMap).map(([persona, s]) => ({
        persona,
        calls: s.calls,
        meetings: s.meetings,
        meetingRate: s.calls > 0 ? Math.round((s.meetings / s.calls) * 100) : 0,
      })).sort((a, b) => b.meetings - a.meetings);

      res.json({
        today: {
          totalCalls: totalToday,
          meetingsBooked: meetingsToday,
          dmReached: dmReachedToday,
          avgDurationSeconds: avgDuration,
          meetingRate: totalToday > 0 ? Math.round((meetingsToday / totalToday) * 100) : 0,
        },
        weekMeetings: (meetingsThisWeekRes.data ?? []).length,
        activeCampaigns: (activeCampaignsRes.data ?? []).length,
        hotLeadsCount: (hotLeadsRes.data ?? []).length,
        recentCalls: recentCallsRes.data ?? [],
        agentStats,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
