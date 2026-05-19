import { SupabaseClient } from '@supabase/supabase-js';

export function campaignTools(supabase: SupabaseClient) {
  return [
    {
      definition: {
        name: 'list_campaigns',
        description: 'List all campaigns with their status, lead counts, and performance metrics',
        inputSchema: {
          type: 'object' as const,
          properties: {
            status: { type: 'string', enum: ['draft', 'active', 'paused', 'completed', 'archived', 'all'], description: 'Filter by campaign status' },
          },
        },
      },
      handler: async (args: Record<string, unknown>) => {
        let query = supabase.from('campaigns').select('*').order('created_at', { ascending: false });
        if (args['status'] && args['status'] !== 'all') {
          query = query.eq('status', args['status']);
        }
        const { data, error } = await query;
        if (error) throw error;
        return data;
      },
    },

    {
      definition: {
        name: 'get_campaign',
        description: 'Get detailed information about a specific campaign including lead breakdown',
        inputSchema: {
          type: 'object' as const,
          properties: { campaign_id: { type: 'string', description: 'Campaign UUID' } },
          required: ['campaign_id'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const { data: campaign, error } = await supabase
          .from('campaigns').select('*').eq('id', args['campaign_id']).single();
        if (error) throw error;

        const { data: stageCounts } = await supabase
          .from('leads').select('stage')
          .eq('campaign_id', args['campaign_id']);

        const breakdown = stageCounts?.reduce((acc: Record<string, number>, l) => {
          acc[l.stage] = (acc[l.stage] ?? 0) + 1;
          return acc;
        }, {});

        return { campaign, stage_breakdown: breakdown };
      },
    },

    {
      definition: {
        name: 'pause_campaign',
        description: 'Pause an active campaign — stops new calls from being initiated',
        inputSchema: {
          type: 'object' as const,
          properties: { campaign_id: { type: 'string' }, reason: { type: 'string' } },
          required: ['campaign_id'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const { error } = await supabase
          .from('campaigns')
          .update({ status: 'paused', paused_at: new Date().toISOString() })
          .eq('id', args['campaign_id'])
          .eq('status', 'active');
        if (error) throw error;
        return { success: true, message: `Campaign ${args['campaign_id']} paused. Reason: ${args['reason'] ?? 'unspecified'}` };
      },
    },

    {
      definition: {
        name: 'resume_campaign',
        description: 'Resume a paused campaign',
        inputSchema: {
          type: 'object' as const,
          properties: { campaign_id: { type: 'string' } },
          required: ['campaign_id'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const { error } = await supabase
          .from('campaigns')
          .update({ status: 'active', paused_at: null })
          .eq('id', args['campaign_id'])
          .eq('status', 'paused');
        if (error) throw error;
        return { success: true, message: `Campaign ${args['campaign_id']} resumed` };
      },
    },

    {
      definition: {
        name: 'create_campaign',
        description: 'Create a new outbound calling campaign',
        inputSchema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            target_verticals: { type: 'array', items: { type: 'string' } },
            target_titles: { type: 'array', items: { type: 'string' } },
            daily_call_limit: { type: 'number' },
            max_concurrent_calls: { type: 'number' },
            enabled_personas: { type: 'array', items: { type: 'string' } },
          },
          required: ['name'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const { data, error } = await supabase
          .from('campaigns')
          .insert({
            name: args['name'],
            description: args['description'],
            target_verticals: args['target_verticals'],
            target_titles: args['target_titles'],
            daily_call_limit: args['daily_call_limit'] ?? 100,
            max_concurrent_calls: args['max_concurrent_calls'] ?? 5,
            enabled_personas: args['enabled_personas'] ?? ['mike', 'sarah', 'david', 'rachel', 'chris', 'emma', 'daniel'],
            status: 'draft',
          })
          .select()
          .single();
        if (error) throw error;
        return { success: true, campaign: data };
      },
    },

    {
      definition: {
        name: 'update_campaign_pacing',
        description: 'Update call pacing settings for a campaign',
        inputSchema: {
          type: 'object' as const,
          properties: {
            campaign_id: { type: 'string' },
            daily_call_limit: { type: 'number' },
            hourly_call_limit: { type: 'number' },
            max_concurrent_calls: { type: 'number' },
          },
          required: ['campaign_id'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const updates: Record<string, unknown> = {};
        if (args['daily_call_limit']) updates['daily_call_limit'] = args['daily_call_limit'];
        if (args['hourly_call_limit']) updates['hourly_call_limit'] = args['hourly_call_limit'];
        if (args['max_concurrent_calls']) updates['max_concurrent_calls'] = args['max_concurrent_calls'];

        const { error } = await supabase.from('campaigns').update(updates).eq('id', args['campaign_id']);
        if (error) throw error;
        return { success: true, updated: updates };
      },
    },
  ];
}
