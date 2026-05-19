import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getRecentCallsDetailed } from '@/lib/services/activity.service';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PhoneCall } from 'lucide-react';
import { formatRelativeTime, formatDuration, capitalize, cn } from '@/lib/utils';
import type { CallOutcome } from '@ai-sdr/database';

const outcomeVariant = (outcome: CallOutcome | null): 'success' | 'info' | 'warning' | 'error' | 'default' => {
  if (!outcome) return 'default';
  if (outcome === 'meeting_booked') return 'success';
  if (outcome === 'callback_requested' || outcome === 'qualified_nurture') return 'info';
  if (outcome === 'voicemail_left' || outcome === 'not_decision_maker') return 'warning';
  if (outcome === 'dnc_requested') return 'error';
  return 'default';
};

export const revalidate = 30;

export default async function ActivityPage() {
  const supabase = createClient();
  const calls = await getRecentCallsDetailed(supabase, { limit: 100 });

  return (
    <>
      <Header title="Activity" subtitle="Recent calls and transcripts" />

      <div className="p-6">
        {calls.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <EmptyState icon={PhoneCall} title="No calls yet" description="Calls will appear here once the AI starts dialing." />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Persona</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Outcome</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Duration</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Time</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {calls.map((call) => (
                  <tr key={call.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <span className="font-medium text-slate-900">{call.contact_name}</span>
                      <span className="text-slate-500 ml-1.5 text-xs">· {call.company_name}</span>
                    </td>
                    <td className="px-4 py-4 text-slate-600 capitalize">{call.persona}</td>
                    <td className="px-4 py-4">
                      {call.outcome
                        ? <Badge label={capitalize(call.outcome)} variant={outcomeVariant(call.outcome)} />
                        : <span className="text-slate-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-4 text-right text-slate-600">{formatDuration(call.duration_seconds)}</td>
                    <td className="px-4 py-4 text-slate-400 text-xs">{formatRelativeTime(call.created_at)}</td>
                    <td className="px-4 py-4 text-right">
                      <Link href={`/activity/${call.id}`} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                        Transcript →
                      </Link>
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
