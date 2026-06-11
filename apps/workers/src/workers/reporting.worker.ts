import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { SupabaseClient } from '@supabase/supabase-js';
import { GmailClient } from '@ai-sdr/integrations';
import { ReportingJobPayload, QUEUE_NAMES } from '../queues/queue.registry';

interface ReportingDeps {
  supabase: SupabaseClient;
  /** Null when Gmail OAuth isn't configured — digests are then computed + logged
   *  but not emailed. */
  gmailClient: GmailClient | null;
  connection: Redis;
  logger: Logger;
  config: {
    fromAddress: string;
    fromName: string;
    /** Recipient for digest emails (e.g. the team inbox). Null = don't email. */
    digestRecipient: string | null;
  };
}

interface DigestStats {
  periodLabel: string;
  from: string;
  to: string;
  totalCalls: number;
  connected: number;
  meetingsBooked: number;
  emailsSent: number;
  costUsd: number;
}

/**
 * Consumes the `reporting` queue. Without this worker, the MCP `trigger_reporting`
 * tool and any digest jobs are silently dropped (nothing consumed the queue) and
 * mv_daily_stats was never refreshed.
 *
 * Job types (ReportingJobPayload.type):
 *   - 'mv_refresh'    → refresh the mv_daily_stats materialized view
 *   - 'daily_digest'  → summarize the given day (default: today)
 *   - 'weekly_digest' → summarize the trailing 7 days
 *
 * Digests are computed from base tables, logged, and emailed to the configured
 * recipient when Gmail is set up.
 */
export function createReportingWorker(deps: ReportingDeps): Worker {
  const { supabase, gmailClient, connection, logger, config } = deps;
  const workerLogger = logger.child({ worker: 'reporting' });

  async function computeStats(from: Date, to: Date, periodLabel: string): Promise<DigestStats> {
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const [callsRes, apptRes, emailsRes, costRes] = await Promise.all([
      supabase.from('calls').select('outcome, meeting_booked, decision_maker_reached')
        .gte('created_at', fromIso).lt('created_at', toIso),
      supabase.from('appointments').select('id', { count: 'exact', head: true })
        .gte('created_at', fromIso).lt('created_at', toIso),
      supabase.from('emails').select('id', { count: 'exact', head: true })
        .gte('created_at', fromIso).lt('created_at', toIso),
      supabase.from('api_usage').select('cost_usd')
        .gte('created_at', fromIso).lt('created_at', toIso),
    ]);

    const calls = callsRes.data ?? [];
    const connected = calls.filter((c: { outcome: string | null }) =>
      ['connected', 'qualified', 'meeting_booked'].includes(c.outcome ?? '')).length;
    const costUsd = (costRes.data ?? []).reduce(
      (sum: number, r: { cost_usd: number | null }) => sum + Number(r.cost_usd ?? 0), 0);

    return {
      periodLabel,
      from: fromIso,
      to: toIso,
      totalCalls: calls.length,
      connected,
      meetingsBooked: apptRes.count ?? 0,
      emailsSent: emailsRes.count ?? 0,
      costUsd: Math.round(costUsd * 100) / 100,
    };
  }

  function renderDigest(s: DigestStats): { subject: string; text: string; html: string } {
    const subject = `AI SDR ${s.periodLabel} digest — ${s.totalCalls} calls, ${s.meetingsBooked} meetings`;
    const lines = [
      `${s.periodLabel} (${s.from.slice(0, 10)} → ${s.to.slice(0, 10)})`,
      ``,
      `Calls:           ${s.totalCalls}`,
      `Connected:       ${s.connected}`,
      `Meetings booked: ${s.meetingsBooked}`,
      `Emails sent:     ${s.emailsSent}`,
      `Spend:           $${s.costUsd.toFixed(2)}`,
    ];
    const text = lines.join('\n');
    const html = `<pre style="font:14px/1.5 monospace">${lines.join('\n')}</pre>`;
    return { subject, text, html };
  }

  return new Worker<ReportingJobPayload>(
    QUEUE_NAMES.REPORTING,
    async (job: Job<ReportingJobPayload>) => {
      const { type, date } = job.data;
      const jobLogger = workerLogger.child({ jobId: job.id, type });

      if (type === 'mv_refresh') {
        const { error } = await supabase.rpc('refresh_mv_daily_stats');
        if (error) {
          jobLogger.error({ err: error.message }, 'mv_daily_stats refresh failed');
          throw new Error(`mv_refresh failed: ${error.message}`);
        }
        jobLogger.info('mv_daily_stats refreshed');
        return { refreshed: true };
      }

      // Digest window.
      const anchor = date ? new Date(date) : new Date();
      let from: Date;
      const to = new Date(anchor);
      if (type === 'weekly_digest') {
        from = new Date(anchor); from.setDate(from.getDate() - 7);
      } else {
        from = new Date(anchor); from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
      }
      const periodLabel = type === 'weekly_digest' ? 'Weekly' : 'Daily';
      const stats = await computeStats(from, to, periodLabel);
      jobLogger.info({ stats }, 'Digest computed');

      // Keep stats fresh for the reporting views too (best-effort).
      try {
        await supabase.rpc('refresh_mv_daily_stats');
      } catch (err) {
        jobLogger.warn({ err }, 'mv refresh during digest failed (non-fatal)');
      }

      let emailed = false;
      if (gmailClient && config.digestRecipient) {
        const { subject, text, html } = renderDigest(stats);
        try {
          await gmailClient.sendEmail({
            to: config.digestRecipient,
            from: config.fromAddress,
            fromName: config.fromName,
            subject,
            bodyHtml: html,
            bodyText: text,
          });
          emailed = true;
          jobLogger.info({ to: config.digestRecipient }, 'Digest emailed');
        } catch (err) {
          jobLogger.error({ err }, 'Digest email failed');
        }
      }

      return { ...stats, emailed };
    },
    { connection, concurrency: 2 },
  );
}
