'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Phone } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/**
 * Manually trigger an outbound call for a lead. Calls the Express API with the
 * signed-in user's Supabase JWT (the API accepts Bearer tokens), so no service
 * secret is ever exposed to the browser. The worker still enforces DNC + call
 * window before dialing.
 */
export function CallNowButton({ leadId }: { leadId: string }) {
  const [calling, setCalling] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const handleCall = async () => {
    setCalling(true);
    setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not signed in');

      const res = await fetch(`${API_BASE}/api/v1/leads/${leadId}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? body?.message ?? `Request failed (${res.status})`);
      }
      setMsg({ text: 'Call queued — dialing shortly', ok: true });
      router.refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Failed to queue call', ok: false });
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleCall}
        disabled={calling}
        className="w-full inline-flex items-center justify-center gap-2 py-2 text-xs font-semibold bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors"
      >
        <Phone className="w-3.5 h-3.5" />
        {calling ? 'Queuing…' : 'Call now'}
      </button>
      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
      )}
    </div>
  );
}
