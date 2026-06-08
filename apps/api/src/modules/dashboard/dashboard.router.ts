import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { getReadScopeUserId } from '../../shared/user-scope';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

export function createDashboardRouter({ supabase }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/dashboard
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getReadScopeUserId(req);
      const scope = <T>(q: T): T => (userId ? (q as any).eq('created_by', userId) : q);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());

      const monthStart = new Date(today);
      monthStart.setDate(1);

      const [
        todayCallsRes,
        meetingsThisWeekRes,
        activeCampaignsRes,
        hotLeadsRes,
        recentCallsRes,
        agentStatsRes,
        monthCostRes,
        monthCallsRes,
        funnelRes,
        topLeadsRes,
      ] = await Promise.all([
        scope(supabase
          .from('calls')
          .select('outcome, duration_seconds, meeting_booked, decision_maker_reached')
          .gte('created_at', todayIso)),
        scope(supabase
          .from('appointments')
          .select('id, status')
          .gte('created_at', weekStart.toISOString())
          .in('status', ['scheduled', 'confirmed', 'held'])),
        scope(supabase
          .from('campaigns')
          .select('id')
          .eq('status', 'active')),
        scope(supabase
          .from('leads')
          .select('id, score')
          .in('stage', ['qualified', 'meeting_booked'])
          .order('score', { ascending: false })
          .limit(5)),
        scope(supabase
          .from('calls')
          .select(`
            id, persona, outcome, duration_seconds, created_at,
            contacts(first_name, last_name),
            companies(name)
          `)
          .order('created_at', { ascending: false })
          .limit(8)),
        scope(supabase
          .from('calls')
          .select('persona, outcome, meeting_booked')
          .eq('status', 'completed')
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())),
        // api_usage is global — not user-scoped (provider-level)
        supabase
          .from('api_usage')
          .select('cost_usd')
          .gte('created_at', monthStart.toISOString()),
        scope(supabase
          .from('calls')
          .select('id, direction, outcome, meeting_booked')
          .gte('created_at', monthStart.toISOString())),
        scope(supabase
          .from('leads')
          .select('stage')),
        scope(supabase
          .from('leads')
          .select(`
            id, score, stage, created_at,
            contacts(first_name, last_name, title),
            companies(name)
          `)
          .in('stage', ['qualified','meeting_booked','connected'])
          .order('score', { ascending: false })
          .limit(10)),
      ]);

      const todayCalls = todayCallsRes.data ?? [];
      const totalToday = todayCalls.length;
      const meetingsToday = todayCalls.filter((c: any) => c.meeting_booked).length;
      const dmReachedToday = todayCalls.filter((c: any) => c.decision_maker_reached).length;
      const avgDuration = totalToday > 0
        ? Math.round(todayCalls.reduce((sum: number, c: any) => sum + (c.duration_seconds ?? 0), 0) / totalToday)
        : 0;

      const agentMap: Record<string, { calls: number; meetings: number }> = {};
      for (const call of agentStatsRes.data ?? []) {
        const c = call as any;
        if (!agentMap[c.persona]) agentMap[c.persona] = { calls: 0, meetings: 0 };
        agentMap[c.persona].calls++;
        if (c.meeting_booked) agentMap[c.persona].meetings++;
      }
      const agentStats = Object.entries(agentMap).map(([persona, s]) => ({
        persona,
        calls: s.calls,
        meetings: s.meetings,
        meetingRate: s.calls > 0 ? Math.round((s.meetings / s.calls) * 100) : 0,
      })).sort((a, b) => b.meetings - a.meetings);

      const inboundToday = todayCalls.filter((c: any) => c.direction === 'inbound').length;
      const outboundToday = totalToday - inboundToday;

      // Month cost
      const monthCost = (monthCostRes.data ?? []).reduce(
        (sum: number, row: any) => sum + (row.cost_usd ?? 0),
        0,
      );

      // Month calls totals
      const monthCalls = monthCallsRes.data ?? [];
      const monthInbound = monthCalls.filter((c: any) => c.direction === 'inbound').length;
      const monthMeetings = monthCalls.filter((c: any) => c.meeting_booked).length;

      // Funnel: count by stage
      const stageGroups: Record<string, string[]> = {
        new: ['new', 'enriching', 'enriched', 'phone_lookup_pending', 'callable', 'email_only'],
        contacted: ['in_call_queue', 'calling', 'called_no_answer', 'called_voicemail', 'called_gatekeeper'],
        connected: ['connected'],
        qualified: ['qualified'],
        meeting: ['meeting_booked', 'meeting_held'],
        dead: ['disqualified', 'dnc', 'dead'],
      };
      const stageCounts: Record<string, number> = {};
      for (const lead of funnelRes.data ?? []) {
        const s = (lead as any).stage as string;
        stageCounts[s] = (stageCounts[s] ?? 0) + 1;
      }
      const funnel = Object.entries(stageGroups).map(([bucket, stages]) => ({
        bucket,
        count: stages.reduce((sum, s) => sum + (stageCounts[s] ?? 0), 0),
      }));

      res.json({
        today: {
          totalCalls: totalToday,
          inboundCalls: inboundToday,
          outboundCalls: outboundToday,
          meetingsBooked: meetingsToday,
          dmReached: dmReachedToday,
          avgDurationSeconds: avgDuration,
          meetingRate: totalToday > 0 ? Math.round((meetingsToday / totalToday) * 100) : 0,
        },
        thisMonth: {
          totalCalls: monthCalls.length,
          inboundCalls: monthInbound,
          meetingsBooked: monthMeetings,
          costUsd: Math.round(monthCost * 100) / 100,
        },
        weekMeetings: (meetingsThisWeekRes.data ?? []).length,
        activeCampaigns: (activeCampaignsRes.data ?? []).length,
        hotLeadsCount: (hotLeadsRes.data ?? []).length,
        hotLeads: topLeadsRes.data ?? [],
        recentCalls: recentCallsRes.data ?? [],
        agentStats,
        funnel,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
