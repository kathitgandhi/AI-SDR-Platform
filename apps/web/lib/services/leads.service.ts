import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lead, LeadStage } from '@ai-sdr/database';

export interface LeadWithDetails extends Lead {
  contact_first_name: string;
  contact_last_name: string | null;
  contact_title: string | null;
  company_name: string;
  company_vertical: string;
}

export async function getHotLeads(supabase: SupabaseClient, limit = 50): Promise<LeadWithDetails[]> {
  const { data } = await supabase
    .from('leads')
    .select(`
      *,
      contacts:contact_id ( first_name, last_name, title ),
      companies:company_id ( name, retail_vertical )
    `)
    .in('stage', ['qualified', 'meeting_booked', 'connected'])
    .order('score', { ascending: false })
    .limit(limit);

  return mapLeadsWithDetails(data ?? []);
}

export async function searchLeads(
  supabase: SupabaseClient,
  params: { stage?: LeadStage; minScore?: number; campaignId?: string; search?: string; limit?: number }
): Promise<LeadWithDetails[]> {
  let query = supabase
    .from('leads')
    .select(`
      *,
      contacts:contact_id ( first_name, last_name, title ),
      companies:company_id ( name, retail_vertical )
    `)
    .order('score', { ascending: false })
    .limit(params.limit ?? 100);

  if (params.stage) query = query.eq('stage', params.stage);
  if (params.minScore) query = query.gte('score', params.minScore);
  if (params.campaignId) query = query.eq('campaign_id', params.campaignId);

  const { data } = await query;
  return mapLeadsWithDetails(data ?? []);
}

export async function getLeadWithCalls(supabase: SupabaseClient, id: string) {
  const [{ data: lead }, { data: calls }] = await Promise.all([
    supabase.from('leads').select(`
      *,
      contacts:contact_id ( * ),
      companies:company_id ( * )
    `).eq('id', id).single(),
    supabase.from('calls').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
  ]);
  return { lead, calls: calls ?? [] };
}

export async function updateLeadStage(supabase: SupabaseClient, id: string, stage: LeadStage): Promise<void> {
  await supabase.from('leads').update({ stage, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function addToDnc(supabase: SupabaseClient, phone: string, reason: string): Promise<void> {
  await supabase.from('dnc_entries').insert({
    phone,
    source: 'manual_web',
    added_reason: reason,
    is_permanent: true,
  });
}

function mapLeadsWithDetails(data: Record<string, unknown>[]): LeadWithDetails[] {
  return data.map((row) => {
    const contact = Array.isArray(row['contacts']) ? row['contacts'][0] : row['contacts'];
    const company = Array.isArray(row['companies']) ? row['companies'][0] : row['companies'];
    return {
      ...(row as unknown as Lead),
      contact_first_name: (contact as { first_name: string } | null)?.first_name ?? '—',
      contact_last_name: (contact as { last_name: string | null } | null)?.last_name ?? null,
      contact_title: (contact as { title: string | null } | null)?.title ?? null,
      company_name: (company as { name: string } | null)?.name ?? '—',
      company_vertical: (company as { retail_vertical: string } | null)?.retail_vertical ?? 'unknown',
    };
  });
}
