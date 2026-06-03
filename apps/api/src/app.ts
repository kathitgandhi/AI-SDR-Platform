import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { logger } from './shared/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { createElevenLabsWebhookRouter } from './webhooks/elevenlabs.webhook';
import { createDashboardRouter } from './modules/dashboard/dashboard.router';
import { createCampaignsRouter } from './modules/campaigns/campaigns.router';
import { createLeadsRouter } from './modules/leads/leads.router';
import { createCallsRouter } from './modules/calls/calls.router';
import { createReportingRouter } from './modules/reporting/reporting.router';
import { createQueuesRouter } from './modules/queues/queues.router';
import { createNotesRouter } from './modules/notes/notes.router';
import { createTicketsRouter } from './modules/tickets/tickets.router';
import { createEmailsRouter } from './modules/emails/emails.router';
import { createSmsRouter, createSmsWebhookRouter } from './modules/sms/sms.router';
import { createTransferRulesRouter } from './modules/transfer-rules/transfer-rules.router';
import { createSettingsRouter } from './modules/settings/settings.router';
import { createDncRouter } from './modules/dnc/dnc.router';
import { createImportsRouter } from './modules/imports/imports.router';
import { createAuditRouter } from './modules/audit/audit.router';
import { createDocsRouter } from './modules/docs/docs.router';
import { createCrmRouter } from './modules/crm/crm.router';
import { requireApiKey } from './middleware/auth.middleware';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

export function createApp(): Application {
  const app = express();

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    realtime: { transport: WebSocket as any },
  });

  // --- Security middleware ---
  app.use(helmet());
  app.use(cors({
    origin: env.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
    credentials: true,
  }));

  // --- Logging ---
  app.use(pinoHttp({ logger }));

  // --- Webhook body parsing + raw body for signature validation ---
  // JSON webhooks (ElevenLabs) keep their raw body for HMAC signature checks.
  app.use('/webhooks', express.raw({ type: 'application/json' }), (req, _, next) => {
    if (Buffer.isBuffer(req.body)) {
      (req as express.Request & { rawBody: Buffer }).rawBody = req.body;
      req.body = JSON.parse(req.body.toString());
    }
    next();
  });
  // Twilio posts application/x-www-form-urlencoded; signature is validated over
  // the parsed params (not the raw body), so a plain urlencoded parser is fine.
  app.use('/webhooks', express.urlencoded({ extended: false, type: 'application/x-www-form-urlencoded' }));

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
  // Inbound calls are answered by ElevenLabs (Twilio number imported there);
  // the conversation-init webhook identifies the caller + records the call row.
  app.use('/webhooks', createElevenLabsWebhookRouter({
    supabase,
    logger,
    webhookSecret: env.ELEVENLABS_WEBHOOK_SECRET,
  }));
  app.use('/webhooks', createSmsWebhookRouter({ supabase, logger }));

  // --- API routes ---
  const routerCtx = { supabase, logger };
  app.use('/api/v1', requireApiKey);
  app.use('/api/v1/dashboard', createDashboardRouter(routerCtx));
  app.use('/api/v1/campaigns', createCampaignsRouter(routerCtx));
  app.use('/api/v1/leads', createLeadsRouter(routerCtx));
  app.use('/api/v1/calls', createCallsRouter(routerCtx));
  app.use('/api/v1/reporting', createReportingRouter(routerCtx));
  app.use('/api/v1/queues', createQueuesRouter({ logger }));
  app.use('/api/v1/notes', createNotesRouter(routerCtx));
  app.use('/api/v1/tickets', createTicketsRouter(routerCtx));
  app.use('/api/v1/emails', createEmailsRouter(routerCtx));
  app.use('/api/v1/sms', createSmsRouter(routerCtx));
  app.use('/api/v1/transfer-rules', createTransferRulesRouter(routerCtx));
  app.use('/api/v1/settings', createSettingsRouter(routerCtx));
  app.use('/api/v1/dnc', createDncRouter(routerCtx));
  app.use('/api/v1/imports', createImportsRouter(routerCtx));
  app.use('/api/v1/audit', createAuditRouter(routerCtx));
  app.use('/api/v1/crm', createCrmRouter(routerCtx));

  // Public docs (no auth)
  app.use('/api/docs', createDocsRouter());

  // --- 404 + error handlers ---
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
