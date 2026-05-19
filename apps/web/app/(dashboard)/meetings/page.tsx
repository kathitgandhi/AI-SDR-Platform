import { createClient } from '@/lib/supabase/server';
import { getMeetingsBooked } from '@/lib/services/activity.service';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { CalendarCheck } from 'lucide-react';
import { format } from 'date-fns';
import type { Appointment } from '@ai-sdr/database';

const statusVariant: Record<Appointment['status'], 'success' | 'info' | 'warning' | 'error' | 'default'> = {
  scheduled: 'info',
  confirmed: 'success',
  held: 'success',
  cancelled: 'error',
  no_show: 'warning',
  rescheduled: 'warning',
};

export const revalidate = 30;

export default async function MeetingsPage() {
  const supabase = createClient();
  const meetings = await getMeetingsBooked(supabase);

  return (
    <>
      <Header title="Meetings Booked" subtitle={`${meetings.filter((m) => m.status === 'scheduled' || m.status === 'confirmed').length} upcoming`} />

      <div className="p-6">
        {meetings.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <EmptyState icon={CalendarCheck} title="No meetings yet" description="Meetings will appear here when the AI books them during calls." />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Scheduled</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Duration</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Stores</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Budget</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Timeline</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {meetings.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-900">{format(new Date(m.scheduled_at), 'MMM d, yyyy')}</p>
                      <p className="text-xs text-slate-500">{format(new Date(m.scheduled_at), 'h:mm a')} {m.timezone}</p>
                    </td>
                    <td className="px-4 py-4">
                      <Badge label={m.status} variant={statusVariant[m.status]} dot />
                    </td>
                    <td className="px-4 py-4 text-slate-600">{m.duration_minutes} min</td>
                    <td className="px-4 py-4 text-slate-600">{m.store_count ?? '—'}</td>
                    <td className="px-4 py-4 text-slate-600">{m.budget_indication ?? '—'}</td>
                    <td className="px-4 py-4 text-slate-600">{m.decision_timeline ?? '—'}</td>
                    <td className="px-4 py-4">
                      <p className="text-xs text-slate-500 max-w-xs truncate">{m.qualification_summary ?? '—'}</p>
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
