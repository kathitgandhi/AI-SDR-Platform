import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { logger } from './shared/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { createTelnyxWebhookRouter } from './webhooks/telnyx.webhook';
import { createDashboardRouter } from './modules/dashboard/dashboard.router';
import { createCampaignsRouter } from './modules/campaigns/campaigns.router';
import { createLeadsRouter } from './modules/leads/leads.router';
import { createCallsRouter } from './modules/calls/calls.router';
import { createReportingRouter } from './modules/reporting/reporting.router';
import { createQueuesRouter } from './modules/queues/queues.router';
import { requireApiKey } from './middleware/auth.middleware';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

export function createApp(): Application {
  const app = express();

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });

  // --- Security middleware ---
  app.use(helmet());
  app.use(cors({
    origin: env.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
    credentials: true,
  }));

  // --- Logging ---
  app.use(pinoHttp({ logger }));

  // --- Raw body for webhook signature validation ---
  app.use('/webhooks', express.raw({ type: 'application/json' }), (req, _, next) => {
    if (Buffer.isBuffer(req.body)) {
      (req as express.Request & { rawBody: Buffer }).rawBody = req.body;
      req.body = JSON.parse(req.body.toString());
    }
    next();
  });

  // --- JSON body parsing (after webhook routes) ---
  app.use(express.json({ limit: '1mb' }));

  // --- Rate limiting ---
  const globalLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
  });
  app.use('/api', globalLimiter);

  // --- Health check ---
  app.get('/health', async (_, res) => {
    try {
      await supabase.from('campaigns').select('id').limit(1);
      res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'error', timestamp: new Date().toISOString() });
    }
  });

  // --- Webhook routes ---
  app.use('/webhooks', createTelnyxWebhookRouter({
    supabase,
    logger,
    webhookSecret: env.TELNYX_WEBHOOK_SECRET,
  }));

  // --- API routes ---
  const routerCtx = { supabase, logger };
  app.use('/api/v1', requireApiKey);
  app.use('/api/v1/dashboard', createDashboardRouter(routerCtx));
  app.use('/api/v1/campaigns', createCampaignsRouter(routerCtx));
  app.use('/api/v1/leads', createLeadsRouter(routerCtx));
  app.use('/api/v1/calls', createCallsRouter(routerCtx));
  app.use('/api/v1/reporting', createReportingRouter(routerCtx));
  app.use('/api/v1/queues', createQueuesRouter({ logger }));

  // --- 404 + error handlers ---
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
