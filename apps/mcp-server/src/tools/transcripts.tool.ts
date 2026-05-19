import { SupabaseClient } from '@supabase/supabase-js';

export function transcriptsTools(supabase: SupabaseClient) {
  return [
    {
      definition: {
        name: 'get_call_transcript',
        description: 'Retrieve the full transcript and analysis for a specific call',
        inputSchema: {
          type: 'object' as const,
          properties: {
            call_id: { type: 'string', description: 'Call UUID' },
          },
          required: ['call_id'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const { data, error } = await supabase
          .from('call_transcripts')
          .select('*')
          .eq('call_id', args['call_id'])
          .single();
        if (error) throw error;
        return data;
      },
    },

    {
      definition: {
        name: 'search_transcripts',
        description: 'Full-text search across all call transcripts',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search terms' },
            limit: { type: 'number', description: 'Max results (default 10)' },
            campaign_id: { type: 'string' },
          },
          required: ['query'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const { data, error } = await supabase
          .from('call_transcripts')
          .select('call_id, lead_id, full_transcript, qualification_data, claude_analysis, created_at')
          .textSearch('full_transcript', args['query'] as string)
          .limit((args['limit'] as number) ?? 10);
        if (error) throw error;
        return data;
      },
    },

    {
      definition: {
        name: 'get_recent_calls',
        description: 'Get the most recent calls with their outcomes and summaries',
        inputSchema: {
          type: 'object' as const,
          properties: {
            limit: { type: 'number', description: 'Number of calls to return (default 20)' },
            persona: { type: 'string', enum: ['mike', 'sarah', 'david', 'rachel', 'chris', 'emma', 'daniel'] },
            outcome: { type: 'string' },
            campaign_id: { type: 'string' },
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        let query = supabase
          .from('calls')
          .select('id, persona, outcome, status, duration_seconds, qualification_score, outcome_score, meeting_booked, call_summary, created_at, contacts(first_name, last_name, title), companies(name, store_count, retail_vertical)')
          .order('created_at', { ascending: false })
          .limit((args['limit'] as number) ?? 20);

        if (args['persona']) query = query.eq('persona', args['persona']);
        if (args['outcome']) query = query.eq('outcome', args['outcome']);
        if (args['campaign_id']) query = query.eq('campaign_id', args['campaign_id']);

        const { data, error } = await query;
        if (error) throw error;
        return data;
      },
    },

    {
      definition: {
        name: 'get_meetings_booked',
        description: 'Get all booked appointments with qualification summaries',
        inputSchema: {
          type: 'object' as const,
          properties: {
            status: { type: 'string', enum: ['scheduled', 'confirmed', 'held', 'cancelled', 'no_show', 'all'] },
            days_ahead: { type: 'number', description: 'Look ahead N days (default upcoming only)' },
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        let query = supabase
          .from('appointments')
          .select('*, contacts(first_name, last_name, email, title), companies(name, store_count, retail_vertical)')
          .order('scheduled_at', { ascending: true });

        const status = args['status'] as string;
        if (status && status !== 'all') query = query.eq('status', status);
        else if (!status || status === 'all') {
          query = query.gt('scheduled_at', new Date().toISOString());
        }

        const daysAhead = args['days_ahead'] as number;
        if (daysAhead) {
          const future = new Date();
          future.setDate(future.getDate() + daysAhead);
          query = query.lt('scheduled_at', future.toISOString());
        }

        const { data, error } = await query;
        if (error) throw error;
        return data;
      },
    },
  ];
}
