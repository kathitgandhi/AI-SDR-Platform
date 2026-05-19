import { Queue } from 'bullmq';
import { SupabaseClient } from '@supabase/supabase-js';

interface QueueDeps {
  callExecute: Queue;
  leadImport: Queue;
  enrichment: Queue;
  phoneLookup: Queue;
  reporting: Queue;
}

export function queuesTools(queues: QueueDeps, _supabase: SupabaseClient) {
  return [
    {
      definition: {
        name: 'get_queue_stats',
        description: 'Get current job counts across all processing queues',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      handler: async () => {
        const stats = await Promise.all(
          Object.entries(queues).map(async ([name, queue]) => {
            const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
            return { queue: name, ...counts };
          })
        );
        return stats;
      },
    },

    {
      definition: {
        name: 'drain_call_queue',
        description: 'Remove all waiting calls from the call execution queue (does not stop active calls)',
        inputSchema: {
          type: 'object' as const,
          properties: { confirm: { type: 'boolean', description: 'Must be true to confirm drain' } },
          required: ['confirm'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        if (!args['confirm']) return { success: false, message: 'Set confirm:true to drain queue' };
        await queues.callExecute.drain();
        return { success: true, message: 'Call execution queue drained' };
      },
    },

    {
      definition: {
        name: 'trigger_lead_import',
        description: 'Trigger a new ZoomInfo lead pull for a campaign',
        inputSchema: {
          type: 'object' as const,
          properties: {
            campaign_id: { type: 'string' },
            page_size: { type: 'number', description: 'Records per page (default 100, max 200)' },
          },
          required: ['campaign_id'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const job = await queues.leadImport.add('import-leads', {
          campaignId: args['campaign_id'],
          page: 1,
          pageSize: Math.min((args['page_size'] as number) ?? 100, 200),
        });
        return { success: true, jobId: job.id, message: `Lead import job queued (${job.id})` };
      },
    },

    {
      definition: {
        name: 'retry_failed_jobs',
        description: 'Retry failed jobs in a specific queue',
        inputSchema: {
          type: 'object' as const,
          properties: {
            queue_name: { type: 'string', enum: ['callExecute', 'leadImport', 'enrichment', 'phoneLookup', 'reporting'] },
            limit: { type: 'number', description: 'Max jobs to retry (default 10)' },
          },
          required: ['queue_name'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const queueName = args['queue_name'] as keyof QueueDeps;
        const queue = queues[queueName];
        if (!queue) throw new Error(`Unknown queue: ${queueName}`);

        const failed = await queue.getFailed(0, (args['limit'] as number) ?? 10);
        const retried: string[] = [];

        for (const job of failed) {
          await job.retry();
          retried.push(job.id ?? '');
        }

        return { success: true, retried_count: retried.length, job_ids: retried };
      },
    },

    {
      definition: {
        name: 'trigger_reporting',
        description: 'Trigger generation of daily or weekly digest report',
        inputSchema: {
          type: 'object' as const,
          properties: {
            type: { type: 'string', enum: ['daily_digest', 'weekly_digest', 'mv_refresh'] },
            date: { type: 'string', description: 'Date for the report (YYYY-MM-DD, defaults to today)' },
          },
          required: ['type'],
        },
      },
      handler: async (args: Record<string, unknown>) => {
        const job = await queues.reporting.add('generate-report', {
          type: args['type'],
          date: args['date'] ?? new Date().toISOString().split('T')[0],
        });
        return { success: true, jobId: job.id };
      },
    },
  ];
}
