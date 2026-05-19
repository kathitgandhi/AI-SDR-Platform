import Link from 'next/link';
import { cn, capitalize } from '@/lib/utils';
import type { CampaignSummary } from '@/lib/services/dashboard.service';

const statusStyle: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  draft: 'bg-slate-100 text-slate-600',
  completed: 'bg-blue-100 text-blue-700',
};

export function CampaignStatusTable({ campaigns }: { campaigns: CampaignSummary[] }) {
  if (!campaigns.length) {
    return <p className="text-center text-slate-400 text-sm py-8">No campaigns yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Campaign</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Leads</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Calls</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Meetings</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {campaigns.map((c) => {
            const rate = c.calls_made > 0 ? ((c.meetings_booked / c.calls_made) * 100).toFixed(1) : '—';
            return (
              <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/campaigns/${c.id}`} className="font-medium text-slate-900 hover:text-blue-600 transition-colors">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', statusStyle[c.status] ?? 'bg-slate-100 text-slate-600')}>
                    {capitalize(c.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{c.total_leads.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-600">{c.calls_made.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-600">{c.meetings_booked.toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  <span className={cn('font-medium', typeof rate === 'string' && rate !== '—' && parseFloat(rate) > 5 ? 'text-green-600' : 'text-slate-600')}>
                    {rate === '—' ? '—' : `${rate}%`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
