import { PhoneCall, CalendarCheck, Megaphone, Users, TrendingUp, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getDashboardStats, getRecentCalls, getCampaignSummaries, getAgentStats } from '@/lib/services/dashboard.service';
import { StatCard } from '@/components/ui/StatCard';
import { RecentCallsTable } from '@/components/dashboard/RecentCallsTable';
import { CampaignStatusTable } from '@/components/dashboard/CampaignStatusTable';
import { AutoRefresh } from '@/components/dashboard/AutoRefresh';
import { Header } from '@/components/layout/Header';
import { format } from 'date-fns';

// Render fresh on every request so router.refresh() (AutoRefresh) returns
// up-to-date call/meeting data instead of a cached snapshot.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createClient();
  const [stats, recentCalls, campaigns, agents] = await Promise.all([
    getDashboardStats(supabase),
    getRecentCalls(supabase, 12),
    getCampaignSummaries(supabase),
    getAgentStats(supabase),
  ]);

  return (
    <>
      <AutoRefresh intervalMs={30000} />
      <Header
        title="Dashboard"
        subtitle={`Today · ${format(new Date(), 'EEEE, MMMM d, yyyy')}`}
      />

      <div className="p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Calls Today"
            value={stats.callsToday.toLocaleString()}
            icon={PhoneCall}
            iconColor="text-blue-600"
            iconBg="bg-blue-50"
          />
          <StatCard
            label="Meetings This Week"
            value={stats.meetingsThisWeek.toLocaleString()}
            icon={CalendarCheck}
            iconColor="text-green-600"
            iconBg="bg-green-50"
          />
          <StatCard
            label="Active Campaigns"
            value={stats.activeCampaigns.toLocaleString()}
            icon={Megaphone}
            iconColor="text-purple-600"
            iconBg="bg-purple-50"
          />
          <StatCard
            label="Hot Leads"
            value={stats.hotLeads.toLocaleString()}
            icon={Users}
            iconColor="text-amber-600"
            iconBg="bg-amber-50"
          />
        </div>

        {/* Secondary Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
              <TrendingUp className="w-4 h-4" />
              Connect Rate Today
            </div>
            <p className="text-3xl font-bold text-slate-900">{stats.connectRateToday}%</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
              <PhoneCall className="w-4 h-4" />
              Calls This Week
            </div>
            <p className="text-3xl font-bold text-slate-900">{stats.callsThisWeek.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
              <Clock className="w-4 h-4" />
              Meetings This Month
            </div>
            <p className="text-3xl font-bold text-slate-900">{stats.meetingsThisMonth.toLocaleString()}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Recent Calls */}
          <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Recent Calls</h2>
              <a href="/activity" className="text-sm text-blue-600 hover:text-blue-700 font-medium">View all →</a>
            </div>
            <RecentCallsTable calls={recentCalls} />
          </div>

          {/* Agent Leaderboard */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Agent Leaderboard</h2>
              <p className="text-xs text-slate-500 mt-0.5">All-time performance</p>
            </div>
            <div className="divide-y divide-slate-50">
              {agents.length === 0 && (
                <p className="text-center text-slate-400 text-sm py-8">No agent data yet.</p>
              )}
              {agents.map((agent, i) => (
                <div key={agent.name} className="px-5 py-3.5 flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-100 text-slate-600' : 'bg-orange-50 text-orange-600'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 capitalize">{agent.name}</p>
                    <p className="text-xs text-slate-500">{agent.calls_made} calls · {agent.meetings_booked} meetings</p>
                  </div>
                  <span className="text-sm font-semibold text-green-600">
                    {agent.meeting_rate > 0 ? `${(agent.meeting_rate * 100).toFixed(1)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Campaign Overview */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Campaigns</h2>
            <a href="/campaigns" className="text-sm text-blue-600 hover:text-blue-700 font-medium">Manage →</a>
          </div>
          <CampaignStatusTable campaigns={campaigns} />
        </div>
      </div>
    </>
  );
}
