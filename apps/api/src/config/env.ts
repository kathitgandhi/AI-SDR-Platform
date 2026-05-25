import { z } from 'zod';

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_SECRET_KEY: z.string().min(32),
  WEBHOOK_SECRET: z.string().min(16),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().min(1),
  REDIS_MAX_RETRIES: z.coerce.number().default(3),

  // ZoomInfo
  ZOOMINFO_CLIENT_ID: z.string().min(1),
  ZOOMINFO_CLIENT_SECRET: z.string().min(1),
  ZOOMINFO_BASE_URL: z.string().url().default('https://api.zoominfo.com/lookup'),
  ZOOMINFO_RATE_LIMIT_RPM: z.coerce.number().default(100),

  // Telnyx
  TELNYX_API_KEY: z.string().min(1),
  TELNYX_CONNECTION_ID: z.string().min(1),
  TELNYX_FROM_NUMBER: z.string().min(10),
  TELNYX_WEBHOOK_SECRET: z.string().min(1),
  TELNYX_BASE_URL: z.string().url().default('https://api.telnyx.com/v2'),

  // ElevenLabs
  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_BASE_URL: z.string().url().default('https://api.elevenlabs.io/v1'),
  ELEVENLABS_AGENT_MIKE: z.string().min(1),
  ELEVENLABS_AGENT_SARAH: z.string().min(1),
  ELEVENLABS_AGENT_DAVID: z.string().min(1),
  ELEVENLABS_AGENT_RACHEL: z.string().min(1),
  ELEVENLABS_AGENT_CHRIS: z.string().min(1),
  ELEVENLABS_AGENT_EMMA: z.string().min(1),
  ELEVENLABS_AGENT_DANIEL: z.string().min(1),
  ELEVENLABS_AGENT_RECEPTIONIST: z.string().optional(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().default(4096),
  ANTHROPIC_REASONING_BUDGET: z.coerce.number().default(2048),

  // Gmail
  GMAIL_CLIENT_ID: z.string().min(1),
  GMAIL_CLIENT_SECRET: z.string().min(1),
  GMAIL_REFRESH_TOKEN: z.string().min(1),
  GMAIL_FROM_ADDRESS: z.string().email(),
  GMAIL_FROM_NAME: z.string().min(1),
  GMAIL_CC_HOT_LEADS: z.string().email(),

  // CRM
  CRM_PROVIDER: z.enum(['hubspot', 'salesforce', 'pipedrive', 'zoho', 'none']).default('none'),
  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  HUBSPOT_PORTAL_ID: z.string().optional(),
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_CLIENT_SECRET: z.string().optional(),
  SALESFORCE_REFRESH_TOKEN: z.string().optional(),
  SALESFORCE_INSTANCE_URL: z.string().url().optional(),
  PIPEDRIVE_API_KEY: z.string().optional(),
  PIPEDRIVE_COMPANY_DOMAIN: z.string().optional(),
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),
  ZOHO_REFRESH_TOKEN: z.string().optional(),

  // Company identity
  COMPANY_NAME: z.string().min(1),
  COMPANY_WEBSITE: z.string().url(),
  SALES_TEAM_EMAIL: z.string().email(),
  SUPPORT_EMAIL: z.string().email(),

  // Call engine
  CALL_MAX_CONCURRENT: z.coerce.number().default(10),
  CALL_RETRY_MAX_ATTEMPTS: z.coerce.number().default(3),
  CALL_RETRY_DELAY_MINUTES: z.coerce.number().default(60),
  CALL_MAX_DURATION_SECONDS: z.coerce.number().default(600),
  CALL_RING_TIMEOUT_SECONDS: z.coerce.number().default(30),
  CALL_PACING_DELAY_MS: z.coerce.number().default(2000),

  // Compliance
  CALL_WINDOW_START_HOUR: z.coerce.number().min(0).max(23).default(8),
  CALL_WINDOW_END_HOUR: z.coerce.number().min(0).max(23).default(21),
  AI_DISCLOSURE_REQUIRED: z.coerce.boolean().default(true),

  // Monitoring
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default('production'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().default(0.1),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Reporting
  DAILY_DIGEST_CRON: z.string().default('0 7 * * *'),
  WEEKLY_DIGEST_CRON: z.string().default('0 8 * * 1'),
  REPORT_RECIPIENTS: z.string().default(''),

  // MCP
  MCP_PORT: z.coerce.number().default(3001),
  MCP_AUTH_TOKEN: z.string().min(16),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    result.error.errors.forEach((err) => {
      console.error(`  ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();

export const elevenLabsAgentIds: Record<string, string> = {
  mike: env.ELEVENLABS_AGENT_MIKE,
  sarah: env.ELEVENLABS_AGENT_SARAH,
  david: env.ELEVENLABS_AGENT_DAVID,
  rachel: env.ELEVENLABS_AGENT_RACHEL,
  chris: env.ELEVENLABS_AGENT_CHRIS,
  emma: env.ELEVENLABS_AGENT_EMMA,
  daniel: env.ELEVENLABS_AGENT_DANIEL,
};
