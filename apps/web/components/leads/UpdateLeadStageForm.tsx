'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { updateLeadStage } from '@/lib/services/leads.service';
import type { LeadStage } from '@ai-sdr/database';

const STAGES: LeadStage[] = [
  'new', 'callable', 'in_call_queue', 'connected',
  'qualified', 'meeting_booked', 'meeting_held',
  'nurturing_30d', 'nurturing_90d', 'disqualified', 'dnc',
];

export function UpdateLeadStageForm({ leadId, currentStage }: { leadId: string; currentStage: LeadStage }) {
  const [stage, setStage] = useState<LeadStage>(currentStage);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSave = async () => {
    if (stage === currentStage) return;
    setSaving(true);
    try {
      await updateLeadStage(supabase, leadId, stage);
      router.refresh();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2">
      <select
        value={stage}
        onChange={(e) => setStage(e.target.value as LeadStage)}
        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
        ))}
      </select>
      <button
        onClick={handleSave}
        disabled={saving || stage === currentStage}
        className="w-full py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : 'Update Stage'}
      </button>
    </div>
  );
}
