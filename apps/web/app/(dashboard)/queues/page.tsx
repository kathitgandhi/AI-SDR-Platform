'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getQueueStats, retryFailedJobs, drainCallQueue } from '@/lib/services/queues.service';
import { PageSpinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

const QUEUE_LABELS: Record<string, string> = {
  callExecute: 'Call Execution',
  leadImport: 'Lead Import',
  enrichment: 'Enrichment',
  phoneLookup: 'Phone Lookup',
  reporting: 'Reporting',
};

export default function QueuesPage() {
  const qc = useQueryClient();
  const [draining, setDraining] = useState(false);
  const [drainDone, setDrainDone] = useState(false);

  const { data: queues, isLoading } = useQuery({
    queryKey: ['queue-stats'],
    queryFn: getQueueStats,
    refetchInterval: 15_000,
  });

  const retryMutation = useMutation({
    mutationFn: ({ queue, limit }: { queue: string; limit: number }) => retryFailedJobs(queue, limit),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queue-stats'] }),
  });

  const handleDrain = async () => {
    if (!window.confirm('This will remove all waiting calls from the queue. Active calls will finish. Continue?')) return;
    setDraining(true);
    try { await drainCallQueue(); setDrainDone(true); await qc.invalidateQueries({ queryKey: ['queue-stats'] }); }
    finally { setDraining(false); }
  };

  if (isLoading) return <PageSpinner />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Queue Monitor</h1>
          <p className="text-sm text-slate-500 mt-0.5">Live job counts — refreshes every 15s</p>
        </div>
        <button
          onClick={handleDrain}
          disabled={draining}
          className="px-4 py-2 text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
        >
          {draining ? 'Draining…' : drainDone ? '✓ Drained' : '⚠ Drain Call Queue'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {(queues ?? []).map((q) => (
          <div key={q.queue} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900">{QUEUE_LABELS[q.queue] ?? q.queue}</h2>
              {q.failed > 0 && (
                <button
                  onClick={() => retryMutation.mutate({ queue: q.queue, limit: 10 })}
                  disabled={retryMutation.isPending}
                  className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  Retry {q.failed} failed
                </button>
              )}
            </div>
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Waiting', count: q.waiting, color: 'bg-blue-50 text-blue-700' },
                { label: 'Active', count: q.active, color: 'bg-green-50 text-green-700' },
                { label: 'Delayed', count: q.delayed, color: 'bg-purple-50 text-purple-700' },
                { label: 'Completed', count: q.completed, color: 'bg-slate-50 text-slate-600' },
                { label: 'Failed', count: q.failed, color: q.failed > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-400' },
              ].map(({ label, count, color }) => (
                <div key={label} className={cn('rounded-lg p-3 text-center', color)}>
                  <p className="text-xl font-bold">{count.toLocaleString()}</p>
                  <p className="text-xs font-medium mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
