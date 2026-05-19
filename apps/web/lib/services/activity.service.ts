import type { SupabaseClient } from '@supabase/supabase-js';
import type { Call, CallTranscript, Appointment } from '@ai-sdr/database';

export interface CallWithContext extends Call {
  contact_name: string;
  company_name: string;
}

export async function getRecentCallsDetailed(
  supabase: SupabaseClient,
  params: { persona?: string; outcome?: string; limit?: number } = {}
): Promise<CallWithContext[]> {
  let query = supabase
    .from('calls')
    .select(`
      *,
      contacts:contact_id ( first_name, last_name ),
      companies:company_id ( name )
    `)
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 50);

  if (params.persona) query = query.eq('persona', params.persona);
  if (params.outcome) query = query.eq('outcome', params.outcome);

  const { data } = await query;
  return (data ?? []).map((row) => {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
    const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
    return {
      ...(row as unknown as Call),
      contact_name: contact
        ? `${(contact as { first_name: string }).first_name} ${(contact as { last_name: string | null }).last_name ?? ''}`.trim()
        : '—',
      company_name: (company as { name: string } | null)?.name ?? '—',
    };
  });
}

export async function getCallWithTranscript(supabase: SupabaseClient, callId: string) {
  const [{ data: call }, { data: transcript }] = await Promise.all([
    supabase.from('calls').select(`
      *,
      contacts:contact_id ( first_name, last_name, title ),
      companies:company_id ( name )
    `).eq('id', callId).single(),
    supabase.from('call_transcripts').select('*').eq('call_id', callId).single(),
  ]);
  return { call, transcript: transcript as CallTranscript | null };
}

export async function getMeetingsBooked(supabase: SupabaseClient, limit = 50): Promise<Appointment[]> {
  const { data } = await supabase
    .from('appointments')
    .select('*')
    .order('scheduled_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as Appointment[];
}

export async function searchTranscripts(supabase: SupabaseClient, query: string): Promise<CallTranscript[]> {
  const { data } = await supabase
    .from('call_transcripts')
    .select('*')
    .textSearch('full_transcript', query, { type: 'plain' })
    .order('created_at', { ascending: false })
    .limit(30);
  return (data ?? []) as CallTranscript[];
}
