import type { SupabaseClient } from '@supabase/supabase-js';
import type { Campaign } from '@ai-sdr/database';

export async function getCampaigns(supabase: SupabaseClient): Promise<Campaign[]> {
  const { data } = await supabase
    .from('campaigns')
    .select('*')
    .not('status', 'eq', 'archived')
    .order('created_at', { ascending: false });
  return (data ?? []) as Campaign[];
}

export async function getCampaign(supabase: SupabaseClient, id: string): Promise<Campaign | null> {
  const { data } = await supabase.from('campaigns').select('*').eq('id', id).single();
  return (data ?? null) as Campaign | null;
}

export async function pauseCampaign(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from('campaigns').update({ status: 'paused', paused_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
}

export async function resumeCampaign(supabase: SupabaseClient, id: string): Promise<void> {
  await supabase.from('campaigns').update({ status: 'active', paused_at: null, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function updateCampaignPacing(
  supabase: SupabaseClient,
  id: string,
  pacing: { daily_call_limit?: number; hourly_call_limit?: number; max_concurrent_calls?: number }
): Promise<void> {
  await supabase.from('campaigns').update({ ...pacing, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function getCampaignLeadStages(supabase: SupabaseClient, campaignId: string) {
  const { data } = await supabase
    .from('leads')
    .select('stage')
    .eq('campaign_id', campaignId);

  if (!data) return {};
  const counts: Record<string, number> = {};
  for (const row of data) {
    const s = row.stage as string;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}
