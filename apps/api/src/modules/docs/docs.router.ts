import { Router, Request, Response } from 'express';

/**
 * Serves a minimal Swagger-UI page that points at the OpenAPI spec.
 * Hand-written spec (a real schema-from-code generator would be nicer but is
 * out of scope here). Updated when endpoints change.
 *
 * Mounted UNAUTHENTICATED so devs can read the docs without a token.
 */
export function createDocsRouter(): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.type('html').send(`<!DOCTYPE html>
<html>
<head>
  <title>AI SDR Platform API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>body{margin:0}</style>
</head>
<body>
  <div id="ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: './openapi.json', dom_id: '#ui' });
  </script>
</body>
</html>`);
  });

  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(buildOpenApiSpec());
  });

  return router;
}

function buildOpenApiSpec() {
  const ok = (description = 'Success') => ({ 200: { description } });
  const created = { 201: { description: 'Created' } };
  const accepted = { 202: { description: 'Accepted' } };
  const unauth = { 401: { description: 'Unauthorized' } };
  const errs = { ...unauth, 500: { description: 'Server error' } };

  return {
    openapi: '3.0.3',
    info: {
      title: 'AI SDR Platform API',
      version: '1.0.0',
      description: 'Outbound + inbound calling, leads, calls, CRM features. Auth: `Authorization: Bearer <supabase_access_token>` for users, `x-api-key` for trusted backend.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      },
    },
    security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
    paths: {
      '/health': { get: { summary: 'Health check (no auth)', security: [], responses: ok() } },

      '/api/v1/dashboard/': { get: { summary: 'Dashboard KPIs + recent + agent stats + funnel + this month', responses: { ...ok(), ...errs } } },

      '/api/v1/campaigns': {
        get: { summary: 'List campaigns', responses: { ...ok(), ...errs } },
        post: { summary: 'Create campaign', responses: { ...created, ...errs } },
      },
      '/api/v1/campaigns/{id}': { get: { summary: 'Campaign detail + stageCounts + recentCalls' } },
      '/api/v1/campaigns/{id}/pause': { patch: { summary: 'Pause campaign' } },
      '/api/v1/campaigns/{id}/resume': { patch: { summary: 'Resume campaign' } },
      '/api/v1/campaigns/{id}/pacing': { patch: { summary: 'Update daily/hourly/concurrent limits' } },

      '/api/v1/leads': {
        get: { summary: 'List leads with filters: stage, score_min, vertical, company, campaign_id' },
      },
      '/api/v1/leads/hot': { get: { summary: 'Top 25 hot leads' } },
      '/api/v1/leads/{id}': { get: { summary: 'Lead detail + calls + emails' } },
      '/api/v1/leads/{id}/stage': { patch: { summary: 'Update lead stage (records lead_stage_history)' } },
      '/api/v1/leads/{id}/dnc': { post: { summary: 'Add lead to DNC and mark stage=dnc' } },
      '/api/v1/leads/bulk-update': { post: { summary: 'Update multiple leads at once (stage, campaign_id, score, priority)' } },
      '/api/v1/leads/bulk-dnc': { post: { summary: 'Add multiple leads to DNC' } },

      '/api/v1/calls': { get: { summary: 'List calls — filters: persona, outcome, campaign_id, direction' } },
      '/api/v1/calls/{id}/transcript': { get: { summary: 'Call detail + transcript' } },
      '/api/v1/calls/log': { post: { summary: 'Manually log a call made outside the AI system' } },
      '/api/v1/calls/meetings': { get: { summary: 'Booked meetings/appointments' } },
      '/api/v1/calls/search': { get: { summary: 'Full-text search across call transcripts (q=)' } },

      '/api/v1/notes': {
        get: { summary: 'Notes for lead or call' },
        post: { summary: 'Create note' },
      },
      '/api/v1/notes/{id}': {
        patch: { summary: 'Edit note' },
        delete: { summary: 'Delete note' },
      },

      '/api/v1/tickets': {
        get: { summary: 'List tickets — filters: status, priority, lead_id, etc.' },
        post: { summary: 'Create ticket' },
      },
      '/api/v1/tickets/{id}': {
        get: { summary: 'Ticket detail' },
        patch: { summary: 'Update ticket' },
        delete: { summary: 'Delete ticket' },
      },

      '/api/v1/emails': { get: { summary: 'Sent emails for a lead/contact' } },
      '/api/v1/emails/preview': { post: { summary: 'AI-generate subject + body (synchronous)' } },
      '/api/v1/emails/send': { post: { summary: 'Queue an email send', responses: { ...accepted, ...errs } } },

      '/api/v1/sms': { get: { summary: 'List SMS messages — filters: contact_id, lead_id, direction' } },
      '/api/v1/sms/threads': { get: { summary: 'One row per contact, latest message first' } },
      '/api/v1/sms/send': { post: { summary: 'Send SMS via Telnyx' } },

      '/api/v1/transfer-rules': {
        get: { summary: 'List transfer rules' },
        post: { summary: 'Create transfer rule' },
      },
      '/api/v1/transfer-rules/{id}': {
        patch: { summary: 'Update rule' },
        delete: { summary: 'Delete rule' },
      },
      '/api/v1/transfer-rules/transfer-now': { post: { summary: 'Immediate transfer (UI override) on an active call' } },

      '/api/v1/dnc': {
        get: { summary: 'List DNC entries — filters: type=phone|email, q=' },
        post: { summary: 'Add DNC entry' },
      },
      '/api/v1/dnc/{id}': { delete: { summary: 'Remove DNC entry' } },

      '/api/v1/settings': { get: { summary: 'All app settings (merged with defaults)' } },
      '/api/v1/settings/{key}': {
        get: { summary: 'Single setting block' },
        put: { summary: 'Upsert a setting block' },
      },

      '/api/v1/imports': { get: { summary: 'Past CSV imports' } },
      '/api/v1/imports/leads': { post: { summary: 'Bulk-import leads from CSV (JSON array)' } },

      '/api/v1/audit': { get: { summary: 'Audit log — filters: entity_type, entity_id, action' } },

      '/api/v1/reporting/stats': { get: { summary: 'Daily call breakdown' } },
      '/api/v1/reporting/leaderboard': { get: { summary: 'Agent performance ranking' } },
      '/api/v1/reporting/pipeline': { get: { summary: 'Lead funnel by stage' } },
      '/api/v1/reporting/costs': { get: { summary: 'API cost by provider' } },

      '/api/v1/queues/': { get: { summary: 'All queue stats' } },

      '/webhooks/telnyx': { post: { summary: 'Telnyx Call Control webhook', security: [] } },
      '/webhooks/telnyx-sms': { post: { summary: 'Telnyx Messaging webhook', security: [] } },
    },
  };
}
