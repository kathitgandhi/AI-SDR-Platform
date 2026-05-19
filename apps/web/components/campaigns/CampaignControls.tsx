'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { pauseCampaign, resumeCampaign } from '@/lib/services/campaigns.service';
import type { CampaignStatus } from '@ai-sdr/database';

interface CampaignControlsProps {
  campaignId: string;
  status: CampaignStatus;
}

export function CampaignControls({ campaignId, status }: CampaignControlsProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handlePause = async () => {
    setLoading(true);
    try { await pauseCampaign(supabase, campaignId); router.refresh(); }
    finally { setLoading(false); }
  };

  const handleResume = async () => {
    setLoading(true);
    try { await resumeCampaign(supabase, campaignId); router.refresh(); }
    finally { setLoading(false); }
  };

  if (loading) {
    return <Loader2 className="w-4 h-4 animate-spin text-slate-400" />;
  }

  if (status === 'active') {
    return (
      <button
        onClick={handlePause}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
      >
        <Pause className="w-3.5 h-3.5" /> Pause
      </button>
    );
  }

  if (status === 'paused') {
    return (
      <button
        onClick={handleResume}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
      >
        <Play className="w-3.5 h-3.5" /> Resume
      </button>
    );
  }

  return null;
}
