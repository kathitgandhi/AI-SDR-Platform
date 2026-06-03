import { Redis } from 'ioredis';
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
import { ElevenLabsAgentClient, ClaudeReasoningService, GmailClient, ZoomInfoClient } from '@ai-sdr/integrations';
import { DncChecker, TimezoneGuard, CallOutcomeScorer } from '@ai-sdr/core';

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
