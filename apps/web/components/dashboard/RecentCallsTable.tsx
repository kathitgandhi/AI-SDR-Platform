import Link from 'next/link';
import { cn, formatRelativeTime, formatDuration, capitalize } from '@/lib/utils';
import type { RecentCall } from '@/lib/services/dashboard.service';

const outcomeVariant: Record<string, string> = {
  meeting_booked: 'bg-green-100 text-green-700',
  callback_requested: 'bg-blue-100 text-blue-700',
  not_interested: 'bg-slate-100 text-slate-600',
  voicemail_left: 'bg-amber-100 text-amber-700',
  no_answer: 'bg-slate-100 text-slate-500',
  dnc_requested: 'bg-red-100 text-red-700',
  qualified_nurture: 'bg-purple-100 text-purple-700',
};

export function RecentCallsTable({ calls }: { calls: RecentCall[] }) {
  if (!calls.length) {
    return <p className="text-center text-slate-400 text-sm py-8">No calls recorded yet today.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Contact</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Persona</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Outcome</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Duration</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {calls.map((call) => (
            <tr key={call.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3">
                <Link href={`/activity/${call.id}`} className="hover:text-blue-600 transition-colors">
                  <span className="font-medium text-slate-900">
                    {call.contact_first_name} {call.contact_last_name ?? ''}
                  </span>
                  <span className="text-slate-500 ml-1.5 text-xs">· {call.company_name}</span>
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className="text-slate-700 capitalize">{call.persona}</span>
              </td>
              <td className="px-4 py-3">
                {call.outcome ? (
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', outcomeVariant[call.outcome] ?? 'bg-slate-100 text-slate-600')}>
                    {capitalize(call.outcome)}
                  </span>
                ) : <span className="text-slate-400">—</span>}
              </td>
              <td className="px-4 py-3 text-slate-600">{formatDuration(call.duration_seconds)}</td>
              <td className="px-4 py-3 text-slate-400 text-xs">{formatRelativeTime(call.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
