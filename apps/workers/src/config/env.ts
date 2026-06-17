import { z } from 'zod';

const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_TYPES: z.string().default(''),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // Twilio (voice number is imported into ElevenLabs; SMS/lookup via Twilio APIs).
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_FROM_NUMBER: z.string().min(10),

  ELEVENLABS_API_KEY: z.string().min(1),
  ELEVENLABS_BASE_URL: z.string().url().default('https://api.elevenlabs.io/v1'),
  // ElevenLabs phone number id (phnum_...) backing outbound origination.
  ELEVENLABS_PHONE_NUMBER_ID: z.string().min(1),
  ELEVENLABS_AGENT_MIKE: z.string().min(1),
  ELEVENLABS_AGENT_SARAH: z.string().min(1),
  ELEVENLABS_AGENT_DAVID: z.string().min(1),
  ELEVENLABS_AGENT_RACHEL: z.string().min(1),
  ELEVENLABS_AGENT_CHRIS: z.string().min(1),
  ELEVENLABS_AGENT_EMMA: z.string().min(1),
  ELEVENLABS_AGENT_DANIEL: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().default(4096),

  COMPANY_NAME: z.string().min(1),
  CALL_MAX_CONCURRENT: z.coerce.number().default(10),
  CALL_PACING_DELAY_MS: z.coerce.number().default(2000),
  CALL_MAX_DURATION_SECONDS: z.coerce.number().default(600),
  CALL_RING_TIMEOUT_SECONDS: z.coerce.number().default(30),
  CALL_WINDOW_START_HOUR: z.coerce.number().default(8),
  CALL_WINDOW_END_HOUR: z.coerce.number().default(21),

  // --- Per-minute voice cost rates (USD) used to record per-call spend ---
  // Plan-specific, so they're configurable. Defaults are rough list prices:
  //  - ElevenLabs Conversational AI ~ $0.10/min (varies by plan/credits)
  //  - Twilio US outbound voice     ~ $0.014/min
  // These are multiplied by the call's billed duration and written to
  // api_usage (entity_type='call') alongside the Claude analysis cost, so the
  // call-detail endpoint can report an all-in total per call.
  ELEVENLABS_COST_PER_MINUTE_USD: z.coerce.number().default(0.10),
  TWILIO_VOICE_COST_PER_MINUTE_USD: z.coerce.number().default(0.014),

  // --- Reporting cron (only used when WORKER_TYPES includes 'reporting') ---
  // Cron patterns for the repeatable digest + materialized-view-refresh jobs the
  // reporting worker registers. Times are in the server's timezone.
  REPORTING_DAILY_DIGEST_CRON: z.string().default('0 23 * * *'),   // 11pm daily
  REPORTING_WEEKLY_DIGEST_CRON: z.string().default('0 23 * * 0'),  // 11pm Sunday
  REPORTING_MV_REFRESH_CRON: z.string().default('0 * * * *'),      // hourly

  // --- Pipeline scheduler (auto-dial + auto-import) ---
  // How often the autonomous engine scans active campaigns to dial leads / top
  // up the lead pool. Only used when WORKER_TYPES includes 'scheduler'.
  PIPELINE_DIAL_INTERVAL_MS: z.coerce.number().default(60_000),
  PIPELINE_IMPORT_INTERVAL_MS: z.coerce.number().default(1_800_000),
  PIPELINE_MIN_LEAD_BUFFER: z.coerce.number().default(200),
  PIPELINE_IMPORT_COOLDOWN_MS: z.coerce.number().default(21_600_000),
  PIPELINE_DIAL_BATCH: z.coerce.number().default(10),
  // When true, a phone we can't positively confirm as a landline drops the lead
  // to email_only. Default false keeps the pipeline flowing if Lookup add-on off.
  PHONE_LOOKUP_STRICT: z.enum(['true', 'false']).default('false'),

  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().default(''),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_FROM_ADDRESS: z.string().default('sales@example.com'),
  GMAIL_FROM_NAME: z.string().default('AI SDR'),
  GMAIL_CC_HOT_LEADS: z.string().optional(),

  // ZoomInfo lead source. Supports both auth methods — provide ONE set:
  //  (a) Basic:  ZOOMINFO_USERNAME + ZOOMINFO_PASSWORD
  //  (b) PKI:    ZOOMINFO_CLIENT_ID + ZOOMINFO_USERNAME + ZOOMINFO_PRIVATE_KEY (PEM)
  // The lead-import worker only starts if a usable combination is present.
  ZOOMINFO_USERNAME: z.string().optional(),
  ZOOMINFO_PASSWORD: z.string().optional(),
  ZOOMINFO_CLIENT_ID: z.string().optional(),
  ZOOMINFO_PRIVATE_KEY: z.string().optional(),
  ZOOMINFO_BASE_URL: z.string().url().default('https://api.zoominfo.com'),
  ZOOMINFO_RATE_LIMIT_RPM: z.coerce.number().default(60),

  CRM_PROVIDER: z.enum(['hubspot', 'salesforce', 'pipedrive', 'zoho', 'airdesk360', 'none']).default('none'),
  AIRDESK360_BASE_URL: z.string().optional(),
  AIRDESK360_API_KEY: z.string().optional(),
  // Default owner/department new AirDesk records are attached to (defaults to '1'
  // in the client). Set these so synced leads/deals land under the right user/dept.
  AIRDESK360_DEFAULT_USER_ID: z.string().optional(),
  AIRDESK360_DEFAULT_DEPARTMENT_ID: z.string().optional(),
  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  SALESFORCE_CLIENT_ID: z.string().optional(),
  SALESFORCE_CLIENT_SECRET: z.string().optional(),
  SALESFORCE_REFRESH_TOKEN: z.string().optional(),
  SALESFORCE_INSTANCE_URL: z.string().url().optional(),

  LOG_LEVEL: z.string().default('info'),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

function validateWorkerEnv(): WorkerEnv {
  const result = workerEnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid worker environment:');
    result.error.errors.forEach((e) => console.error(`  ${e.path.join('.')}: ${e.message}`));
    process.exit(1);
  }
  return result.data;
}

export const workerEnv = validateWorkerEnv();

export const elevenLabsAgentIds: Record<string, string> = {
  mike: workerEnv.ELEVENLABS_AGENT_MIKE,
  sarah: workerEnv.ELEVENLABS_AGENT_SARAH,
  david: workerEnv.ELEVENLABS_AGENT_DAVID,
  rachel: workerEnv.ELEVENLABS_AGENT_RACHEL,
  chris: workerEnv.ELEVENLABS_AGENT_CHRIS,
  emma: workerEnv.ELEVENLABS_AGENT_EMMA,
  daniel: workerEnv.ELEVENLABS_AGENT_DANIEL,
};
