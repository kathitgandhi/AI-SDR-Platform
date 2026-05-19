import Link from 'next/link';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCampaigns } from '@/lib/services/campaigns.service';
import { Header } from '@/components/layout/Header';
import { CampaignControls } from '@/components/campaigns/CampaignControls';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Megaphone } from 'lucide-react';
import type { CampaignStatus } from '@ai-sdr/database';

const statusVariant: Record<CampaignStatus, 'success' | 'warning' | 'default' | 'info'> = {
  active: 'success',
  paused: 'warning',
  draft: 'default',
  completed: 'info',
  archived: 'default',
};

export const revalidate = 30;

export default async function CampaignsPage() {
  const supabase = createClient();
  const campaigns = await getCampaigns(supabase);

  return (
    <>
      <Header
        title="Campaigns"
        subtitle={`${campaigns.filter((c) => c.status === 'active').length} active`}
      />

      <div className="p-6">
        {campaigns.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet"
              description="Create your first outbound campaign to start calling leads."
            />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Campaign</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Leads</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Calls/Day</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Calls Made</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Meetings</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rate</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {campaigns.map((c) => {
                  const rate = c.calls_made > 0 ? ((c.meetings_booked / c.calls_made) * 100).toFixed(1) : null;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4">
                        <Link href={`/campaigns/${c.id}`} className="font-medium text-slate-900 hover:text-blue-600 transition-colors">
                          {c.name}
                        </Link>
                        {c.description && <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{c.description}</p>}
                      </td>
                      <td className="px-4 py-4">
                        <Badge label={c.status} variant={statusVariant[c.status]} dot />
                      </td>
                      <td className="px-4 py-4 text-right text-slate-600">{c.total_leads.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-slate-600">{c.daily_call_limit}</td>
                      <td className="px-4 py-4 text-right text-slate-600">{c.calls_made.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right text-slate-600">{c.meetings_booked.toLocaleString()}</td>
                      <td className="px-4 py-4 text-right">
                        <span className={rate && parseFloat(rate) > 5 ? 'text-green-600 font-medium' : 'text-slate-500'}>
                          {rate ? `${rate}%` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <CampaignControls campaignId={c.id} status={c.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
