'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getCampaign, updateCampaignPacing } from '@/lib/services/campaigns.service';
import { Spinner } from '@/components/ui/Spinner';
import type { Campaign } from '@ai-sdr/database';

export default function EditPacingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [hourlyLimit, setHourlyLimit] = useState(20);
  const [concurrent, setConcurrent] = useState(5);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCampaign(supabase, params.id).then((c) => {
      if (c) {
        setCampaign(c);
        setDailyLimit(c.daily_call_limit);
        setHourlyLimit(c.hourly_call_limit);
        setConcurrent(c.max_concurrent_calls);
      }
    });
  }, [params.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateCampaignPacing(supabase, params.id, {
        daily_call_limit: dailyLimit,
        hourly_call_limit: hourlyLimit,
        max_concurrent_calls: concurrent,
      });
      router.push(`/campaigns/${params.id}`);
      router.refresh();
    } finally { setSaving(false); }
  };

  if (!campaign) return <div className="p-6"><Spinner /></div>;

  return (
    <div className="p-6 max-w-lg">
      <Link href={`/campaigns/${params.id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to {campaign.name}
      </Link>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900 mb-1">Edit Pacing</h1>
        <p className="text-sm text-slate-500 mb-6">{campaign.name}</p>

        <div className="space-y-5">
          {[
            { label: 'Daily Call Limit', hint: 'Max calls per calendar day', value: dailyLimit, setter: setDailyLimit, min: 1, max: 2000 },
            { label: 'Hourly Call Limit', hint: 'Max calls per hour', value: hourlyLimit, setter: setHourlyLimit, min: 1, max: 200 },
            { label: 'Max Concurrent Calls', hint: 'Simultaneous active calls', value: concurrent, setter: setConcurrent, min: 1, max: 50 },
          ].map(({ label, hint, value, setter, min, max }) => (
            <div key={label}>
              <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
              <p className="text-xs text-slate-400 mb-2">{hint}</p>
              <input
                type="number"
                value={value}
                min={min}
                max={max}
                onChange={(e) => setter(parseInt(e.target.value) || min)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
          ))}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-6 w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors text-sm"
        >
          {saving ? <Spinner className="w-4 h-4 border-white border-t-blue-200" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
