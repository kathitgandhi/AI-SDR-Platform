import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getHotLeads } from '@/lib/services/leads.service';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Users } from 'lucide-react';
import { capitalize } from '@/lib/utils';
import type { LeadStage } from '@ai-sdr/database';

const stageVariant = (stage: LeadStage): 'success' | 'info' | 'warning' | 'default' | 'purple' => {
  if (stage === 'qualified' || stage === 'meeting_booked') return 'success';
  if (stage === 'connected') return 'info';
  if (stage === 'called_gatekeeper') return 'warning';
  if (stage === 'meeting_held') return 'purple';
  return 'default';
};

export const revalidate = 30;

export default async function LeadsPage() {
  const supabase = createClient();
  const leads = await getHotLeads(supabase, 100);

  return (
    <>
      <Header title="Hot Leads" subtitle={`${leads.length} leads needing follow-up`} />

      <div className="p-6">
        {leads.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <EmptyState icon={Users} title="No hot leads yet" description="Leads will appear here when they've been qualified or a meeting is booked." />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Stage</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Score</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Vertical</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Call</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <Link href={`/leads/${lead.id}`} className="hover:text-blue-600 transition-colors">
                        <span className="font-medium text-slate-900">
                          {lead.contact_first_name} {lead.contact_last_name ?? ''}
                        </span>
                        <br />
                        <span className="text-xs text-slate-500">{lead.company_name}</span>
                        {lead.contact_title && <span className="text-xs text-slate-400"> · {lead.contact_title}</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <Badge label={capitalize(lead.stage)} variant={stageVariant(lead.stage)} dot />
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className={`font-semibold ${lead.score >= 70 ? 'text-green-600' : lead.score >= 40 ? 'text-amber-600' : 'text-slate-500'}`}>
                        {lead.score}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-slate-600 capitalize">{lead.company_vertical.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-4 text-slate-400 text-xs">
                      {lead.last_called_at ? new Date(lead.last_called_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-xs text-slate-500 line-clamp-2 max-w-xs">{lead.last_call_summary ?? '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
