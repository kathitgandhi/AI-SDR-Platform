import { Redis } from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import pino from 'pino';
import { workerEnv } from './config/env';
import { createQueues, QUEUE_NAMES } from './queues/queue.registry';
import { createCallExecutorWorker } from './workers/call-executor.worker';
import { createTranscriptWorker } from './workers/transcript.worker';
import { TelnyxCallClient, ElevenLabsAgentClient, ClaudeReasoningService } from '@ai-sdr/integrations';
import { DncChecker, TimezoneGuard, CallOutcomeScorer } from '@ai-sdr/core';

const logger = pino({ level: workerEnv.LOG_LEVEL });
const workerTypes = workerEnv.WORKER_TYPES.split(',').map(s => s.trim()).filter(Boolean);

const redis = new Redis(workerEnv.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
const supabase = createClient(workerEnv.SUPABASE_URL, workerEnv.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: WebSocket },
});
const queues = createQueues(redis);
const workers: Array<{ close: () => Promise<void> }> = [];

async function bootstrap(): Promise<void> {
  logger.info({ workerTypes }, 'Starting workers');

  const dncChecker = new DncChecker(workerEnv.SUPABASE_URL, workerEnv.SUPABASE_SERVICE_ROLE_KEY, logger);
  const timezoneGuard = new TimezoneGuard(workerEnv.CALL_WINDOW_START_HOUR, workerEnv.CALL_WINDOW_END_HOUR);

  if (workerTypes.includes('call-executor')) {
    const telnyxCallClient = new TelnyxCallClient(workerEnv.TELNYX_API_KEY, workerEnv.TELNYX_BASE_URL, logger);
    const elevenLabsClient = new ElevenLabsAgentClient(workerEnv.ELEVENLABS_API_KEY, workerEnv.ELEVENLABS_BASE_URL, logger);

    workers.push(createCallExecutorWorker({
      supabase, telnyxCallClient, elevenLabsClient, dncChecker, timezoneGuard,
      transcriptQueue: queues[QUEUE_NAMES.TRANSCRIPT_PROCESS],
      connection: redis, logger,
      config: {
        fromNumber: workerEnv.TELNYX_FROM_NUMBER,
        companyName: workerEnv.COMPANY_NAME,
        maxDurationSeconds: workerEnv.CALL_MAX_DURATION_SECONDS,
        ringTimeoutSeconds: workerEnv.CALL_RING_TIMEOUT_SECONDS,
        telnyxConnectionId: workerEnv.TELNYX_CONNECTION_ID,
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
