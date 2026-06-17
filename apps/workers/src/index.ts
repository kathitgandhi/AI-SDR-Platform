import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import pino from 'pino';
import { workerEnv } from './config/env';
import { createQueues, QUEUE_NAMES } from './queues/queue.registry';
import { createCallExecutorWorker } from './workers/call-executor.worker';
import { createTranscriptWorker } from './workers/transcript.worker';
import { createEmailSenderWorker } from './workers/email-sender.worker';
import { createCrmSyncWorker } from './workers/crm-sync.worker';
import { createLeadImportWorker } from './workers/lead-import.worker';
import { createEmailSequenceWorker } from './workers/email-sequence.worker';
import { createPhoneLookupWorker } from './workers/phone-lookup.worker';
import { createEnrichmentWorker } from './workers/enrichment.worker';
import { createReportingWorker } from './workers/reporting.worker';
import { createPipelineScheduler } from './workers/pipeline-scheduler';
import { ElevenLabsAgentClient, ClaudeReasoningService, GmailClient, ZoomInfoClient, TwilioLookupClient } from '@ai-sdr/integrations';
import { DncChecker, TimezoneGuard, CallOutcomeScorer } from '@ai-sdr/core';
import { elevenLabsAgentIds } from './config/env';

const logger = pino({ level: workerEnv.LOG_LEVEL });
const workerTypes = workerEnv.WORKER_TYPES.split(',').map(s => s.trim()).filter(Boolean);

const redis = new Redis(workerEnv.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
const supabase = createClient(workerEnv.SUPABASE_URL, workerEnv.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: WebSocket as any },
});
const queues = createQueues(redis);
const workers: Array<{ close: () => Promise<void> }> = [];

async function bootstrap(): Promise<void> {
  logger.info({ workerTypes }, 'Starting workers');

  const dncChecker = new DncChecker(workerEnv.SUPABASE_URL, workerEnv.SUPABASE_SERVICE_ROLE_KEY, logger);
  const timezoneGuard = new TimezoneGuard(workerEnv.CALL_WINDOW_START_HOUR, workerEnv.CALL_WINDOW_END_HOUR);

  // Gmail OAuth health check: the refresh-token flow needs the client secret too.
  // The per-worker gate only checks client_id + refresh_token, so a missing
  // secret would pass startup but fail at send time with invalid_client. Warn loudly.
  if (workerEnv.GMAIL_CLIENT_ID && workerEnv.GMAIL_REFRESH_TOKEN && !workerEnv.GMAIL_CLIENT_SECRET) {
    logger.warn('GMAIL_CLIENT_ID/REFRESH_TOKEN set but GMAIL_CLIENT_SECRET is empty — Gmail token refresh will fail at send time. Set GMAIL_CLIENT_SECRET.');
  }
  if (workerEnv.GMAIL_FROM_ADDRESS === 'sales@example.com') {
    logger.warn('GMAIL_FROM_ADDRESS is still the default placeholder (sales@example.com) — set it to the authenticated Gmail account or a verified send-as alias.');
  }

  if (workerTypes.includes('call-executor')) {
    const elevenLabsClient = new ElevenLabsAgentClient(workerEnv.ELEVENLABS_API_KEY, workerEnv.ELEVENLABS_BASE_URL, logger);

    workers.push(createCallExecutorWorker({
      supabase, elevenLabsClient, dncChecker, timezoneGuard,
      transcriptQueue: queues[QUEUE_NAMES.TRANSCRIPT_PROCESS],
      connection: redis, logger,
      config: {
        fromNumber: workerEnv.TWILIO_FROM_NUMBER,
        companyName: workerEnv.COMPANY_NAME,
        maxDurationSeconds: workerEnv.CALL_MAX_DURATION_SECONDS,
        ringTimeoutSeconds: workerEnv.CALL_RING_TIMEOUT_SECONDS,
        elevenLabsPhoneNumberId: workerEnv.ELEVENLABS_PHONE_NUMBER_ID,
      },
    }));
    logger.info('Call executor worker started');
  }

  if (workerTypes.includes('transcript-processor')) {
    const elevenLabsClient = new ElevenLabsAgentClient(workerEnv.ELEVENLABS_API_KEY, workerEnv.ELEVENLABS_BASE_URL, logger);
    const claudeService = new ClaudeReasoningService(workerEnv.ANTHROPIC_API_KEY, workerEnv.ANTHROPIC_MODEL, workerEnv.ANTHROPIC_MAX_TOKENS, logger);

    workers.push(createTranscriptWorker({
      supabase, elevenLabsClient, claudeService,
      outcomeScorer: new CallOutcomeScorer(),
      dncChecker,
      emailSequenceQueue: queues[QUEUE_NAMES.EMAIL_SEQUENCE],
      crmSyncQueue: queues[QUEUE_NAMES.CRM_SYNC],
      connection: redis, logger,
      costRates: {
        elevenLabsPerMinuteUsd: workerEnv.ELEVENLABS_COST_PER_MINUTE_USD,
        twilioPerMinuteUsd: workerEnv.TWILIO_VOICE_COST_PER_MINUTE_USD,
      },
    }));
    logger.info('Transcript worker started');
  }

  if (workerTypes.includes('email-sender')) {
    if (!workerEnv.GMAIL_CLIENT_ID || !workerEnv.GMAIL_REFRESH_TOKEN) {
      logger.warn('email-sender worker requested but Gmail OAuth env vars missing — skipping');
    } else {
      const gmailClient = new GmailClient(
        workerEnv.GMAIL_CLIENT_ID,
        workerEnv.GMAIL_CLIENT_SECRET,
        workerEnv.GMAIL_REFRESH_TOKEN,
        logger,
      );
      const claudeService = new ClaudeReasoningService(workerEnv.ANTHROPIC_API_KEY, workerEnv.ANTHROPIC_MODEL, workerEnv.ANTHROPIC_MAX_TOKENS, logger);

      workers.push(createEmailSenderWorker({
        supabase,
        gmailClient,
        claudeService,
        connection: redis,
        logger,
        config: {
          fromAddress: workerEnv.GMAIL_FROM_ADDRESS,
          fromName: workerEnv.GMAIL_FROM_NAME,
          companyName: workerEnv.COMPANY_NAME,
        },
      }));
      logger.info('Email sender worker started');
    }
  }

  if (workerTypes.includes('email-sequence')) {
    // The email-sender worker consumes the literal `emailSender` queue (not
    // QUEUE_NAMES.EMAIL_SEND), so we enqueue sends there.
    const emailSenderQueue = new Queue('emailSender', { connection: redis });
    workers.push(createEmailSequenceWorker({
      supabase,
      emailSenderQueue,
      sequenceQueue: queues[QUEUE_NAMES.EMAIL_SEQUENCE],
      connection: redis,
      logger,
    }));
    logger.info('Email sequence worker started');
  }

  if (workerTypes.includes('crm-sync')) {
    workers.push(createCrmSyncWorker({
      supabase,
      connection: redis,
      logger,
      config: {
        provider: workerEnv.CRM_PROVIDER,
        airdeskBaseUrl: workerEnv.AIRDESK360_BASE_URL,
        airdeskApiKey: workerEnv.AIRDESK360_API_KEY,
      },
    }));
    logger.info({ provider: workerEnv.CRM_PROVIDER }, 'CRM sync worker started');
  }

  if (workerTypes.includes('lead-import')) {
    // Accept either basic (username+password) or PKI (clientId+username+privateKey) creds.
    const hasBasic = !!workerEnv.ZOOMINFO_USERNAME && !!workerEnv.ZOOMINFO_PASSWORD;
    const hasPki = !!workerEnv.ZOOMINFO_CLIENT_ID && !!workerEnv.ZOOMINFO_USERNAME && !!workerEnv.ZOOMINFO_PRIVATE_KEY;
    if (!hasBasic && !hasPki) {
      logger.warn('lead-import worker requested but ZoomInfo credentials missing — skipping');
    } else {
      // NOTE: the current ZoomInfoClient uses username/password auth. PKI support
      // (signing a JWT with ZOOMINFO_PRIVATE_KEY) will be added once the auth
      // method is confirmed; for now we pass username/password through.
      const zoomInfoClient = new ZoomInfoClient({
        clientId: workerEnv.ZOOMINFO_USERNAME ?? workerEnv.ZOOMINFO_CLIENT_ID ?? '',
        clientSecret: workerEnv.ZOOMINFO_PASSWORD ?? '',
        baseUrl: workerEnv.ZOOMINFO_BASE_URL,
        rateLimitRpm: workerEnv.ZOOMINFO_RATE_LIMIT_RPM,
        logger,
      });

      workers.push(createLeadImportWorker({
        supabase,
        zoomInfoClient,
        connection: redis,
        logger,
        crmSyncQueue: queues[QUEUE_NAMES.CRM_SYNC],
        phoneLookupQueue: queues[QUEUE_NAMES.PHONE_LOOKUP],
        leadImportQueue: queues[QUEUE_NAMES.LEAD_IMPORT],
      }));
      logger.info({ auth: hasPki ? 'pki' : 'basic' }, 'Lead import (ZoomInfo) worker started');
    }
  }

  if (workerTypes.includes('phone-lookup')) {
    const lookupClient = new TwilioLookupClient(workerEnv.TWILIO_ACCOUNT_SID, workerEnv.TWILIO_AUTH_TOKEN, logger);
    workers.push(createPhoneLookupWorker({
      supabase,
      lookupClient,
      dncChecker,
      emailSequenceQueue: queues[QUEUE_NAMES.EMAIL_SEQUENCE],
      connection: redis,
      logger,
      config: { strict: workerEnv.PHONE_LOOKUP_STRICT === 'true' },
    }));
    logger.info({ strict: workerEnv.PHONE_LOOKUP_STRICT === 'true' }, 'Phone-lookup worker started');
  }

  if (workerTypes.includes('enrichment')) {
    workers.push(createEnrichmentWorker({
      supabase,
      phoneLookupQueue: queues[QUEUE_NAMES.PHONE_LOOKUP],
      emailSequenceQueue: queues[QUEUE_NAMES.EMAIL_SEQUENCE],
      connection: redis,
      logger,
    }));
    logger.info('Enrichment worker started');
  }

  if (workerTypes.includes('reporting')) {
    const gmailClient = (workerEnv.GMAIL_CLIENT_ID && workerEnv.GMAIL_REFRESH_TOKEN)
      ? new GmailClient(workerEnv.GMAIL_CLIENT_ID, workerEnv.GMAIL_CLIENT_SECRET, workerEnv.GMAIL_REFRESH_TOKEN, logger)
      : null;
    workers.push(createReportingWorker({
      supabase,
      gmailClient,
      connection: redis,
      logger,
      config: {
        fromAddress: workerEnv.GMAIL_FROM_ADDRESS,
        fromName: workerEnv.GMAIL_FROM_NAME,
        digestRecipient: workerEnv.GMAIL_CC_HOT_LEADS ?? workerEnv.GMAIL_FROM_ADDRESS ?? null,
      },
    }));

    // Register repeatable jobs so digests + MV refresh run on a schedule without
    // an external cron. Repeatable jobs are de-duplicated by their repeat key,
    // so re-adding on every boot is safe.
    const reportingQueue = queues[QUEUE_NAMES.REPORTING];
    await reportingQueue.add('daily-digest', { type: 'daily_digest' },
      { repeat: { pattern: workerEnv.REPORTING_DAILY_DIGEST_CRON } });
    await reportingQueue.add('weekly-digest', { type: 'weekly_digest' },
      { repeat: { pattern: workerEnv.REPORTING_WEEKLY_DIGEST_CRON } });
    await reportingQueue.add('mv-refresh', { type: 'mv_refresh' },
      { repeat: { pattern: workerEnv.REPORTING_MV_REFRESH_CRON } });

    logger.info({
      daily: workerEnv.REPORTING_DAILY_DIGEST_CRON,
      weekly: workerEnv.REPORTING_WEEKLY_DIGEST_CRON,
      mvRefresh: workerEnv.REPORTING_MV_REFRESH_CRON,
    }, 'Reporting worker started + cron jobs registered');
  }

  if (workerTypes.includes('scheduler')) {
    workers.push(createPipelineScheduler({
      supabase,
      redis,
      leadImportQueue: queues[QUEUE_NAMES.LEAD_IMPORT],
      callExecuteQueue: queues[QUEUE_NAMES.CALL_EXECUTE],
      timezoneGuard,
      logger,
      config: {
        dialIntervalMs: workerEnv.PIPELINE_DIAL_INTERVAL_MS,
        importIntervalMs: workerEnv.PIPELINE_IMPORT_INTERVAL_MS,
        minLeadBuffer: workerEnv.PIPELINE_MIN_LEAD_BUFFER,
        importCooldownMs: workerEnv.PIPELINE_IMPORT_COOLDOWN_MS,
        dialBatch: workerEnv.PIPELINE_DIAL_BATCH,
        availablePersonas: Object.keys(elevenLabsAgentIds),
      },
    }));
    logger.info('Pipeline scheduler started');
  }

  logger.info({ count: workers.length }, 'All workers started');
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');
  await Promise.all(workers.map(w => w.close()));
  await redis.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled rejection'));

bootstrap().catch(err => { logger.fatal({ err }, 'Bootstrap failed'); process.exit(1); });
