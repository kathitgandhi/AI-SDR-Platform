/**
 * HTTP transport MCP server — for remote Claude Code / Claude Desktop connections.
 * Exposes the same tools as the stdio server but over SSE for remote access.
 *
 * This is what you use when Claude Code is running on your local machine
 * but the MCP server is deployed to Render.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { QUEUE_NAMES } from './queues.js';
import { campaignTools } from './tools/campaigns.tool.js';
import { leadsTools } from './tools/leads.tool.js';
import { reportingTools } from './tools/reporting.tool.js';
import { queuesTools } from './tools/queues.tool.js';
import { transcriptsTools } from './tools/transcripts.tool.js';

const logger = pino({ level: 'info' });
const app = express();
const MCP_PORT = parseInt(process.env['MCP_PORT'] ?? '3001', 10);
const MCP_AUTH_TOKEN = process.env['MCP_AUTH_TOKEN'];

const supabase = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } }
);

const redis = new Redis(process.env['REDIS_URL']!, { maxRetriesPerRequest: null });

const queues = {
  callExecute: new Queue(QUEUE_NAMES.CALL_EXECUTE, { connection: redis }),
  leadImport: new Queue(QUEUE_NAMES.LEAD_IMPORT, { connection: redis }),
  enrichment: new Queue(QUEUE_NAMES.ENRICHMENT, { connection: redis }),
  phoneLookup: new Queue(QUEUE_NAMES.PHONE_LOOKUP, { connection: redis }),
  reporting: new Queue(QUEUE_NAMES.REPORTING, { connection: redis }),
};

const allTools = [
  ...campaignTools(supabase),
  ...leadsTools(supabase),
  ...reportingTools(supabase),
  ...queuesTools(queues, supabase),
  ...transcriptsTools(supabase),
];

// Auth middleware
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (MCP_AUTH_TOKEN && token !== MCP_AUTH_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

// SSE endpoint — Claude connects here
const transports = new Map<string, SSEServerTransport>();

app.get('/sse', async (_req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  const sessionId = Math.random().toString(36).slice(2);
  transports.set(sessionId, transport);

  res.on('close', () => {
    transports.delete(sessionId);
    logger.info({ sessionId }, 'SSE client disconnected');
  });

  const server = buildMcpServer();
  await server.connect(transport);
  logger.info({ sessionId }, 'Claude connected via SSE');
});

app.post('/messages', express.json(), async (req, res) => {
  const sessionId = req.query['sessionId'] as string;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handlePostMessage(req, res);
});

function buildMcpServer(): Server {
  const server = new Server(
    { name: 'ai-sdr-control', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map(({ definition }) => definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = allTools.find((t) => t.definition.name === name);
    if (!tool) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    try {
      const result = await tool.handler(args ?? {});
      return {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg, tool: name }, 'MCP tool execution failed');
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  });

  return server;
}

app.listen(MCP_PORT, () => {
  logger.info({ port: MCP_PORT }, 'AI SDR MCP HTTP server running');
});
