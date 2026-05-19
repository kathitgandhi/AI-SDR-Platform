import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getLeadWithCalls } from '@/lib/services/leads.service';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { UpdateLeadStageForm } from '@/components/leads/UpdateLeadStageForm';
import { AddToDncForm } from '@/components/leads/AddToDncForm';
import { cn, formatDuration, formatRelativeTime, capitalize } from '@/lib/utils';
import type { LeadStage } from '@ai-sdr/database';

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { lead, calls } = await getLeadWithCalls(supabase, params.id);
  if (!lead) notFound();

  const contact = Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts;
  const company = Array.isArray(lead.companies) ? lead.companies[0] : lead.companies;
  const c = contact as Record<string, string | null>;
  const co = company as Record<string, string | null>;

  return (
    <>
      <Header title={`${c['first_name'] ?? ''} ${c['last_name'] ?? ''}`.trim()} subtitle={co['name'] ?? ''} />

      <div className="p-6 space-y-6 max-w-4xl">
        <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" /> Back to Leads
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Lead info */}
          <div className="md:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900 mb-4">Lead Details</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                { label: 'Stage', value: <Badge label={capitalize((lead as { stage: LeadStage }).stage)} variant="info" dot /> },
                { label: 'Score', value: <span className="font-semibold">{(lead as { score: number }).score}</span> },
                { label: 'Contact', value: `${c['first_name']} ${c['last_name'] ?? ''}`.trim() },
                { label: 'Title', value: c['title'] ?? '—' },
                { label: 'Email', value: c['email'] ?? '—' },
                { label: 'Company', value: co['name'] ?? '—' },
                { label: 'Vertical', value: capitalize((co['retail_vertical'] ?? '').replace(/_/g, ' ')) },
                { label: 'Store Count', value: co['store_count'] ?? '—' },
                { label: 'ESL Vendor', value: (lead as { current_esl_vendor: string | null }).current_esl_vendor ?? '—' },
                { label: 'POS Vendor', value: (lead as { current_pos_vendor: string | null }).current_pos_vendor ?? '—' },
                { label: 'Call Attempts', value: (lead as { call_attempts: number }).call_attempts },
                { label: 'Last Called', value: (lead as { last_called_at: string | null }).last_called_at ? formatRelativeTime((lead as { last_called_at: string }).last_called_at) : '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                  <div className="text-slate-900">{value}</div>
                </div>
              ))}
            </div>

            {(lead as { last_call_summary: string | null }).last_call_summary && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-500 mb-1">Last Call Summary</p>
                <p className="text-sm text-slate-700">{(lead as { last_call_summary: string }).last_call_summary}</p>
              </div>
            )}
            {(lead as { handoff_summary: string | null }).handoff_summary && (
              <div className="mt-3">
                <p className="text-xs text-slate-500 mb-1">Handoff Summary</p>
                <p className="text-sm text-slate-700">{(lead as { handoff_summary: string }).handoff_summary}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Update Stage</h3>
              <UpdateLeadStageForm leadId={params.id} currentStage={(lead as { stage: LeadStage }).stage} />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Add to DNC</h3>
              <AddToDncForm />
            </div>
          </div>
        </div>

        {/* Call history */}
        {calls.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Call History ({calls.length})</h2>
            </div>
            <div className="divide-y divide-slate-50">
              {calls.map((call) => (
                <div key={call.id} className="px-5 py-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-slate-900 capitalize">Attempt #{call.attempt_number} · {call.persona}</span>
                      {call.outcome && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                          {capitalize(call.outcome)}
                        </span>
                      )}
                    </div>
                    {call.call_summary && <p className="text-xs text-slate-500">{call.call_summary}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-500">{formatRelativeTime(call.created_at)}</p>
                    <p className="text-xs text-slate-400">{formatDuration(call.duration_seconds)}</p>
                    {call.elevenlabs_session_id && (
                      <Link href={`/activity/${call.id}`} className="text-xs text-blue-600 hover:text-blue-700 mt-0.5 block">
                        View transcript →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
