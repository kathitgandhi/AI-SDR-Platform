import { Router, Request, Response, NextFunction } from 'express';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Logger } from 'pino';
import { env } from '../../config/env';

interface RouterContext {
  logger: Logger;
}

const QUEUE_NAMES = [
  'callExecute',
  'transcriptProcess',
  'leadImport',
  'enrichment',
  'phoneLookup',
  'emailSender',
  'emailSequence',
  'reporting',
  'crmSync',
  'compliance',
] as const;

let redis: IORedis | null = null;
const queues = new Map<string, Queue>();

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  }
  return redis;
}

function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: getRedis() }));
  }
  return queues.get(name)!;
}

export function createQueuesRouter({ logger: _logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/queues
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await Promise.all(
        QUEUE_NAMES.map(async (name) => {
          const q = getQueue(name);
          const [waiting, active, delayed, completed, failed] = await Promise.all([
            q.getWaitingCount(),
            q.getActiveCount(),
            q.getDelayedCount(),
            q.getCompletedCount(),
            q.getFailedCount(),
          ]);
          return { queue: name, waiting, active, delayed, completed, failed };
        })
      );
      res.json({ queues: stats });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/queues/:queue/retry
  router.post('/:queue/retry', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { queue } = req.params;
      const limit = parseInt((req.body.limit as string) ?? '10');

      const q = getQueue(queue);
      const failed = await q.getFailed(0, limit - 1);
      await Promise.all(failed.map((job) => job.retry()));

      res.json({ retried: failed.length, queue });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/queues/calls/drain
  router.post('/calls/drain', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const q = getQueue('callExecute');
      await q.drain();
      res.json({ success: true, message: 'Call queue drained' });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/queues/import
  router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { campaign_id } = req.body;
      const q = getQueue('leadImport');
      const job = await q.add('import', { campaignId: campaign_id }, { priority: 1 });
      res.json({ success: true, jobId: job.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
