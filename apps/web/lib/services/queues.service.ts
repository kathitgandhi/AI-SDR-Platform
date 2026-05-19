const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const SECRET = process.env.API_INTERNAL_SECRET ?? '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}

export interface QueueStats {
  queue: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export async function getQueueStats(): Promise<QueueStats[]> {
  return apiFetch<QueueStats[]>('/api/queues/stats');
}

export async function retryFailedJobs(queueName: string, limit = 10): Promise<{ retried_count: number }> {
  return apiFetch('/api/queues/retry', {
    method: 'POST',
    body: JSON.stringify({ queue_name: queueName, limit }),
  });
}

export async function drainCallQueue(): Promise<void> {
  await apiFetch('/api/queues/drain', {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  });
}

export async function triggerLeadImport(campaignId: string, pageSize = 100): Promise<{ jobId: string }> {
  return apiFetch('/api/queues/trigger-import', {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaignId, page_size: pageSize }),
  });
}
