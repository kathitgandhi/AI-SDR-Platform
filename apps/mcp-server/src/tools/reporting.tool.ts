import { SupabaseClient } from '@supabase/supabase-js';

export function reportingTools(supabase: SupabaseClient) {
  return [
    {
      definition: {
        name: 'get_daily_stats',
        description: 'Get call and pipeline statistics for a specific date or date range',
        inputSchema: {
          type: 'object' as const,
          properties: {
            start_date: { type: 'string', description: 'YYYY-MM-DD' },
            end_date: { type: 'string', description: 'YYYY-MM-DD' },
            campaign_id: { type: 'string', description: 'Optional campaign filter' },
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const startDate = args['start_date'] ?? new Date().toISOString().split('T')[0];
        const endDate = args['end_date'] ?? startDate;

        let query = supabase
          .from('calls')
          .select('status, outcome, persona, duration_seconds, qualification_score, outcome_score, meeting_booked, decision_maker_reached')
          .gte('created_at', `${startDate}T00:00:00`)
          .lte('created_at', `${endDate}T23:59:59`);

        if (args['campaign_id']) query = query.eq('campaign_id', args['campaign_id']);

        const { data: calls, error } = await query;
        if (error) throw error;

        const stats = {
          total_calls: calls?.length ?? 0,
          completed: calls?.filter(c => c.status === 'completed').length ?? 0,
          meetings_booked: calls?.filter(c => c.meeting_booked).length ?? 0,
          decision_makers_reached: calls?.filter(c => c.decision_maker_reached).length ?? 0,
          voicemails: calls?.filter(c => c.outcome === 'voicemail_left').length ?? 0,
          no_answer: calls?.filter(c => c.outcome === 'no_answer').length ?? 0,
          not_interested: calls?.filter(c => c.outcome === 'not_interested').length ?? 0,
          dnc_requests: calls?.filter(c => c.outcome === 'dnc_requested').length ?? 0,
          avg_duration_secs: calls?.reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / Math.max((calls?.filter(c => (c.duration_seconds ?? 0) > 0).length ?? 1), 1),
          avg_qualification_score: calls?.filter(c => c.qualification_score != null).reduce((s, c) => s + c.qualification_score!, 0) / Math.max(calls?.filter(c => c.qualification_score != null).length ?? 1, 1),
          meeting_rate_pct: calls?.length ? ((calls?.filter(c => c.meeting_booked).length ?? 0) / calls.length * 100).toFixed(2) : '0',
          connect_rate_pct: calls?.length ? ((calls?.filter(c => c.decision_maker_reached).length ?? 0) / calls.length * 100).toFixed(2) : '0',
          by_persona: {} as Record<string, number>,
          by_outcome: {} as Record<string, number>,
        };

        calls?.forEach(c => {
          if (c.persona) stats.by_persona[c.persona] = (stats.by_persona[c.persona] ?? 0) + 1;
          if (c.outcome) stats.by_outcome[c.outcome] = (stats.by_outcome[c.outcome] ?? 0) + 1;
        });

        return { date_range: { start: startDate, end: endDate }, stats };
      },
    },

    {
      definition: {
        name: 'get_agent_leaderboard',
        description: 'Get performance rankings for all 7 AI SDR personas',
        inputSchema: {
          type: 'object' as const,
          properties: {
            days: { type: 'number', description: 'Lookback period in days (default 30)' },
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const days = (args['days'] as number) ?? 30;
        const since = new Date();
        since.setDate(since.getDate() - days);

        const { data, error } = await supabase
          .from('calls')
          .select('persona, status, outcome, meeting_booked, decision_maker_reached, talk_time_seconds, qualification_score')
          .gte('created_at', since.toISOString())
          .eq('status', 'completed');

        if (error) throw error;

        const byPersona: Record<string, {
          calls: number; meetings: number; dm_reached: number;
          total_talk: number; total_qual: number; qual_count: number;
        }> = {};

        data?.forEach(c => {
          if (!c.persona) return;
          if (!byPersona[c.persona]) byPersona[c.persona] = { calls: 0, meetings: 0, dm_reached: 0, total_talk: 0, total_qual: 0, qual_count: 0 };
          const p = byPersona[c.persona]!;
          p.calls++;
          if (c.meeting_booked) p.meetings++;
          if (c.decision_maker_reached) p.dm_reached++;
          p.total_talk += c.talk_time_seconds ?? 0;
          if (c.qualification_score != null) { p.total_qual += c.qualification_score; p.qual_count++; }
        });

        const leaderboard = Object.entries(byPersona)
          .map(([persona, s]) => ({
            persona,
            calls: s.calls,
            meetings_booked: s.meetings,
            meeting_rate_pct: s.calls > 0 ? ((s.meetings / s.calls) * 100).toFixed(2) : '0',
            dm_reach_rate_pct: s.calls > 0 ? ((s.dm_reached / s.calls) * 100).toFixed(2) : '0',
            avg_talk_secs: s.calls > 0 ? Math.round(s.total_talk / s.calls) : 0,
            avg_qual_score: s.qual_count > 0 ? (s.total_qual / s.qual_count).toFixed(1) : 'N/A',
          }))
          .sort((a, b) => b.meetings_booked - a.meetings_booked);

        return { period_days: days, leaderboard };
      },
    },

    {
      definition: {
        name: 'get_pipeline_summary',
        description: 'Get current pipeline stage counts and meeting pipeline value',
        inputSchema: {
          type: 'object' as const,
          properties: { campaign_id: { type: 'string' } },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        let query = supabase.from('leads').select('stage, score, meeting_booked_at, meeting_date');
        if (args['campaign_id']) query = query.eq('campaign_id', args['campaign_id']);
        const { data, error } = await query;
        if (error) throw error;

        const stages: Record<string, number> = {};
        data?.forEach(l => { stages[l.stage] = (stages[l.stage] ?? 0) + 1; });

        const meetings = data?.filter(l => l.meeting_booked_at != null).length ?? 0;
        const upcoming = data?.filter(l => l.meeting_date && new Date(l.meeting_date) > new Date()).length ?? 0;
        const avgScore = data?.length ? (data.reduce((s, l) => s + l.score, 0) / data.length).toFixed(1) : '0';

        return { total_leads: data?.length ?? 0, avg_score: avgScore, meetings_booked: meetings, upcoming_meetings: upcoming, by_stage: stages };
      },
    },

    {
      definition: {
        name: 'get_cost_summary',
        description: 'Get API cost breakdown by provider for a date range',
        inputSchema: {
          type: 'object' as const,
          properties: {
            start_date: { type: 'string' },
            end_date: { type: 'string' },
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const startDate = args['start_date'] ?? new Date().toISOString().split('T')[0];
        const endDate = args['end_date'] ?? startDate;

        const { data, error } = await supabase
          .from('api_usage')
          .select('provider, operation, cost_usd, input_tokens, output_tokens, request_count:id')
          .gte('created_at', `${startDate}T00:00:00`)
          .lte('created_at', `${endDate}T23:59:59`);

        if (error) throw error;

        const byProvider: Record<string, { cost: number; requests: number; input_tokens: number; output_tokens: number }> = {};
        let totalCost = 0;

        data?.forEach(u => {
          if (!byProvider[u.provider]) byProvider[u.provider] = { cost: 0, requests: 0, input_tokens: 0, output_tokens: 0 };
          const p = byProvider[u.provider]!;
          p.cost += u.cost_usd ?? 0;
          p.requests++;
          p.input_tokens += u.input_tokens ?? 0;
          p.output_tokens += u.output_tokens ?? 0;
          totalCost += u.cost_usd ?? 0;
        });

        return { date_range: { start: startDate, end: endDate }, total_cost_usd: totalCost.toFixed(4), by_provider: byProvider };
      },
    },
  ];
}
