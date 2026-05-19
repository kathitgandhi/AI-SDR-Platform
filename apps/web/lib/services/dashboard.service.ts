import type { SupabaseClient } from '@supabase/supabase-js';
import { startOfToday, startOfWeek, startOfMonth } from '@/lib/utils';

export interface DashboardStats {
  callsToday: number;
  callsThisWeek: number;
  meetingsThisWeek: number;
  meetingsThisMonth: number;
  activeCampaigns: number;
  hotLeads: number;
  qualifiedLeads: number;
  connectRateToday: number;
}

export interface RecentCall {
  id: string;
  persona: string;
  outcome: string | null;
  duration_seconds: number | null;
  created_at: string;
  contact_first_name: string;
  contact_last_name: string | null;
  company_name: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  calls_made: number;
  meetings_booked: number;
  total_leads: number;
}

export interface AgentStat {
  name: string;
  calls_made: number;
  meetings_booked: number;
  connect_rate: number;
  meeting_rate: number;
}

export async function getDashboardStats(supabase: SupabaseClient): Promise<DashboardStats> {
  const today = startOfToday();
  const weekStart = startOfWeek();
  const monthStart = startOfMonth();

  const [
    { count: callsToday },
    { count: callsThisWeek },
    { count: answeredToday },
    { count: meetingsThisWeek },
    { count: meetingsThisMonth },
    { count: activeCampaigns },
    { count: hotLeads },
    { count: qualifiedLeads },
  ] = await Promise.all([
    supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', today),
    supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
    supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', today).eq('status', 'completed').not('outcome', 'is', null),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
    supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('leads').select('*', { count: 'exact', head: true }).in('stage', ['qualified', 'meeting_booked']),
    supabase.from('leads').select('*', { count: 'exact', head: true }).eq('stage', 'qualified'),
  ]);

  const c = callsToday ?? 0;
  const a = answeredToday ?? 0;

  return {
    callsToday: c,
    callsThisWeek: callsThisWeek ?? 0,
    meetingsThisWeek: meetingsThisWeek ?? 0,
    meetingsThisMonth: meetingsThisMonth ?? 0,
    activeCampaigns: activeCampaigns ?? 0,
    hotLeads: hotLeads ?? 0,
    qualifiedLeads: qualifiedLeads ?? 0,
    connectRateToday: c > 0 ? Math.round((a / c) * 100) : 0,
  };
}

export async function getRecentCalls(supabase: SupabaseClient, limit = 15): Promise<RecentCall[]> {
  const { data, error } = await supabase
    .from('calls')
    .select(`
      id, persona, outcome, duration_seconds, created_at,
      contacts:contact_id ( first_name, last_name ),
      companies:company_id ( name )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    return {
      id: row.id as string,
      persona: row.persona as string,
      outcome: row.outcome as string | null,
      duration_seconds: row.duration_seconds as number | null,
      created_at: row.created_at as string,
      contact_first_name: (contact as { first_name: string } | null)?.first_name ?? '—',
      contact_last_name: (contact as { last_name: string | null } | null)?.last_name ?? null,
      company_name: (company as { name: string } | null)?.name ?? '—',
    };
  });
}

export async function getCampaignSummaries(supabase: SupabaseClient): Promise<CampaignSummary[]> {
  const { data } = await supabase
    .from('campaigns')
    .select('id, name, status, calls_made, meetings_booked, total_leads')
    .not('status', 'eq', 'archived')
    .order('updated_at', { ascending: false })
    .limit(10);
  return (data ?? []) as CampaignSummary[];
}

export async function getAgentStats(supabase: SupabaseClient): Promise<AgentStat[]> {
  const { data } = await supabase
    .from('agent_personas')
    .select('name, calls_made, meetings_booked, connect_rate, meeting_rate')
    .eq('is_active', true)
    .order('meetings_booked', { ascending: false });
  return (data ?? []) as AgentStat[];
}
