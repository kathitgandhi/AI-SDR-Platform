'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addToDnc } from '@/lib/services/leads.service';

export function AddToDncForm() {
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setSaving(true);
    try {
      await addToDnc(supabase, phone.trim(), reason.trim() || 'manual_web');
      setDone(true);
      setPhone('');
      setReason('');
    } finally { setSaving(false); }
  };

  if (done) {
    return (
      <p className="text-xs text-green-600 font-medium py-1">
        ✓ Added to DNC list
        <button onClick={() => setDone(false)} className="ml-2 text-slate-400 hover:text-slate-600">Add another</button>
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+15125550100"
        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-400"
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-400"
      />
      <button
        type="submit"
        disabled={saving || !phone.trim()}
        className="w-full py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg transition-colors"
      >
        {saving ? 'Adding…' : 'Add to DNC'}
      </button>
    </form>
  );
}
