import { SupabaseClient } from '@supabase/supabase-js';

export function leadsTools(supabase: SupabaseClient) {
  return [
    {
      definition: {
        name: 'search_leads',
        description: 'Search and filter leads by stage, score, vertical, or company',
        inputSchema: {
          type: 'object' as const,
          properties: {
            stage: { type: 'string' },
            min_score: { type: 'number' },
            campaign_id: { type: 'string' },
            company_name: { type: 'string' },
            retail_vertical: { type: 'string' },
            limit: { type: 'number' },
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        let query = supabase
          .from('leads')
          .select('*, contacts(first_name, last_name, title, phone_direct, email), companies(name, store_count, retail_vertical, icp_score)')
          .order('score', { ascending: false })
          .limit((args['limit'] as number) ?? 25);

        if (args['stage']) query = query.eq('stage', args['stage']);
        if (args['min_score']) query = query.gte('score', args['min_score']);
        if (args['campaign_id']) query = query.eq('campaign_id', args['campaign_id']);

        const { data, error } = await query;
        if (error) throw error;

        let results = data ?? [];
        if (args['company_name']) {
          const term = (args['company_name'] as string).toLowerCase();
          results = results.filter(l => {
            const co = (l as { companies: { name: string } }).companies;
            return co?.name?.toLowerCase().includes(term);
          });
        }

        return results;
      },
    },

    {
      definition: {
        name: 'get_lead_detail',
        description: 'Get full detail for a specific lead including all calls and emails',
        inputSchema: {
          type: 'object' as const,
          properties: { lead_id: { type: 'string' } },
          required: ['lead_id'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const [{ data: lead }, { data: calls }, { data: emails }] = await Promise.all([
          supabase.from('leads').select('*, contacts(*), companies(*)').eq('id', args['lead_id']).single(),
          supabase.from('calls').select('id, persona, outcome, status, duration_seconds, call_summary, created_at').eq('lead_id', args['lead_id']).order('created_at', { ascending: false }),
          supabase.from('emails').select('id, subject, status, sent_at, opened_count, clicked_count').eq('lead_id', args['lead_id']).order('created_at', { ascending: false }),
        ]);
        return { lead, calls, emails };
      },
    },

    {
      definition: {
        name: 'add_to_dnc',
        description: 'Add a phone number or email to the Do Not Contact list',
        inputSchema: {
          type: 'object' as const,
          properties: {
            phone: { type: 'string' },
            email: { type: 'string' },
            reason: { type: 'string' },
            contact_id: { type: 'string' },
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        if (!args['phone'] && !args['email']) throw new Error('Must provide phone or email');

        await supabase.from('dnc_list').insert({
          phone: args['phone'] ?? null,
          email: args['email'] ?? null,
          source: 'manual_mcp',
          added_reason: args['reason'] ?? 'Added via MCP',
          contact_id: args['contact_id'] ?? null,
          is_permanent: true,
        });

        if (args['contact_id']) {
          const updates: Record<string, unknown> = {};
          if (args['phone']) updates['call_opted_out'] = true;
          if (args['email']) updates['email_opted_out'] = true;
          await supabase.from('contacts').update(updates).eq('id', args['contact_id']);
        }

        return { success: true, message: 'Added to DNC list' };
      },
    },

    {
      definition: {
        name: 'update_lead_stage',
        description: 'Manually update a lead\'s pipeline stage',
        inputSchema: {
          type: 'object' as const,
          properties: {
            lead_id: { type: 'string' },
            stage: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['lead_id', 'stage'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const { data: current } = await supabase.from('leads').select('stage').eq('id', args['lead_id']).single();

        await supabase.from('leads').update({ stage: args['stage'], updated_at: new Date().toISOString() }).eq('id', args['lead_id']);

        await supabase.from('lead_stage_history').insert({
          lead_id: args['lead_id'],
          from_stage: current?.stage,
          to_stage: args['stage'],
          changed_by: 'mcp_manual',
          reason: args['reason'] ?? null,
        });

        return { success: true, from: current?.stage, to: args['stage'] };
      },
    },

    {
      definition: {
        name: 'get_hot_leads',
        description: 'Get top qualified leads that need immediate human follow-up',
        inputSchema: {
          type: 'object' as const,
          properties: { min_score: { type: 'number', description: 'Minimum lead score (default 70)' } },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const minScore = (args['min_score'] as number) ?? 70;
        const { data, error } = await supabase
          .from('leads')
          .select('*, contacts(first_name, last_name, title, email, phone_direct), companies(name, store_count, retail_vertical)')
          .gte('score', minScore)
          .in('stage', ['qualified', 'connected', 'meeting_booked', 'nurturing_30d'])
          .order('score', { ascending: false })
          .limit(20);

        if (error) throw error;
        return data;
      },
    },
  ];
}
