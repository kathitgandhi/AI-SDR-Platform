import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Settings } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCampaign, getCampaignLeadStages } from '@/lib/services/campaigns.service';
import { Header } from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { CampaignControls } from '@/components/campaigns/CampaignControls';
import type { CampaignStatus } from '@ai-sdr/database';

const statusVariant: Record<CampaignStatus, 'success' | 'warning' | 'default' | 'info'> = {
  active: 'success', paused: 'warning', draft: 'default', completed: 'info', archived: 'default',
};

const PIPELINE_STAGES = [
  'new', 'enriching', 'enriched', 'phone_lookup_pending',
  'callable', 'in_call_queue', 'calling',
  'connected', 'qualified', 'meeting_booked', 'meeting_held',
  'nurturing_30d', 'nurturing_90d', 'disqualified', 'dnc',
];

export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [campaign, stageCounts] = await Promise.all([
    getCampaign(supabase, params.id),
    getCampaignLeadStages(supabase, params.id),
  ]);

  if (!campaign) notFound();

  const meetingRate = campaign.calls_made > 0
    ? `${((campaign.meetings_booked / campaign.calls_made) * 100).toFixed(1)}%`
    : '—';

  return (
    <>
      <Header
        title={campaign.name}
        subtitle={`Campaign · ${campaign.calls_made} calls made`}
        actions={
          <div className="flex items-center gap-2">
            <CampaignControls campaignId={campaign.id} status={campaign.status} />
            <Link href={`/campaigns/${campaign.id}/pacing`} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
              <Settings className="w-3.5 h-3.5" /> Pacing
            </Link>
          </div>
        }
      />

      <div className="p-6 space-y-6">
        <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" /> Back to Campaigns
        </Link>

        {/* Overview cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Status', value: <Badge label={campaign.status} variant={statusVariant[campaign.status]} dot /> },
            { label: 'Total Leads', value: campaign.total_leads.toLocaleString() },
            { label: 'Calls Made', value: campaign.calls_made.toLocaleString() },
            { label: 'Meetings Booked', value: `${campaign.meetings_booked} (${meetingRate})` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
              <div className="text-base font-semibold text-slate-900">{value}</div>
            </div>
          ))}
        </div>

        {/* Pacing settings */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-4">Pacing Settings</h2>
          <div className="grid grid-cols-3 gap-4">
            <div><p className="text-xs text-slate-500">Daily Call Limit</p><p className="text-xl font-bold text-slate-900 mt-1">{campaign.daily_call_limit}</p></div>
            <div><p className="text-xs text-slate-500">Hourly Limit</p><p className="text-xl font-bold text-slate-900 mt-1">{campaign.hourly_call_limit}</p></div>
            <div><p className="text-xs text-slate-500">Max Concurrent</p><p className="text-xl font-bold text-slate-900 mt-1">{campaign.max_concurrent_calls}</p></div>
          </div>
        </div>

        {/* Pipeline stage breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-4">Lead Pipeline</h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {PIPELINE_STAGES.map((stage) => {
              const count = stageCounts[stage] ?? 0;
              return (
                <div key={stage} className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-900">{count}</p>
                  <p className="text-xs text-slate-500 mt-0.5 capitalize">{stage.replace(/_/g, ' ')}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Personas */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Active Personas</h2>
          <div className="flex flex-wrap gap-2">
            {campaign.enabled_personas.map((p) => (
              <span key={p} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-sm font-medium capitalize">{p}</span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
