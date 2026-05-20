import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { QUEUE_NAMES } from './queues.js';
import { campaignTools } from './tools/campaigns.tool';
import { leadsTools } from './tools/leads.tool';
import { reportingTools } from './tools/reporting.tool';
import { queuesTools } from './tools/queues.tool';
import { transcriptsTools } from './tools/transcripts.tool';

const logger = pino({ level: 'info' });

const supabase = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { realtime: { transport: WebSocket as any } }
);

const redis = new Redis(process.env['REDIS_URL']!);

const queues = {
  callExecute: new Queue(QUEUE_NAMES.CALL_EXECUTE, { connection: redis }),
  leadImport: new Queue(QUEUE_NAMES.LEAD_IMPORT, { connection: redis }),
  enrichment: new Queue(QUEUE_NAMES.ENRICHMENT, { connection: redis }),
  phoneLookup: new Queue(QUEUE_NAMES.PHONE_LOOKUP, { connection: redis }),
  reporting: new Queue(QUEUE_NAMES.REPORTING, { connection: redis }),
};

const server = new Server(
  { name: 'ai-sdr-control', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

const allTools = [
  ...campaignTools(supabase),
  ...leadsTools(supabase),
  ...reportingTools(supabase),
  ...queuesTools(queues, supabase),
  ...transcriptsTools(supabase),
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools.map(({ definition }) => definition),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = allTools.find((t) => t.definition.name === name);

  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(args ?? {});
    return {
      content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg, tool: name }, 'MCP tool execution failed');
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('AI SDR MCP Server running on stdio');
}

main().catch((err) => {
  logger.error({ err }, 'MCP server fatal error');
  process.exit(1);
});
