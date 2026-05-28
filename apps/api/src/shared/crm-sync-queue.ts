import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

let redis: IORedis | null = null;
let queue: Queue | null = null;

function getQueue(): Queue {
  if (!redis) redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  if (!queue) queue = new Queue('crm-sync', { connection: redis });
  return queue;
}

/**
 * Fire-and-forget enqueue of a CRM sync job. No-op if CRM_PROVIDER='none'.
 * Failures are swallowed (logged) so they never break the user-facing request.
 */
export function enqueueCrmSync(entity: 'lead' | 'ticket' | 'contact' | 'company', entityId: string, action: 'create' | 'update' | 'delete' = 'update'): void {
  if (env.CRM_PROVIDER === 'none') return;
  void getQueue()
    .add(
      'sync',
      { entity, entityId, action, provider: env.CRM_PROVIDER },
      { attempts: 3, backoff: { type: 'exponential', delay: 30000 } },
    )
    .catch(() => {
      // swallow — caller doesn't care
    });
}
