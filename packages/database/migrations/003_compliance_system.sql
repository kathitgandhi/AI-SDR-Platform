-- ============================================================
-- AI SDR PLATFORM — COMPLIANCE + SYSTEM TABLES
-- Migration: 003_compliance_system.sql
-- ============================================================

-- ============================================================
-- DNC LIST
-- ============================================================

CREATE TABLE dnc_list (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone         TEXT,
  email         TEXT,
  phone_hash    TEXT GENERATED ALWAYS AS (
    CASE WHEN phone IS NOT NULL
    THEN encode(digest(regexp_replace(phone, '[^0-9]', '', 'g'), 'sha256'), 'hex')
    ELSE NULL END
  ) STORED,
  email_hash    TEXT GENERATED ALWAYS AS (
    CASE WHEN email IS NOT NULL
    THEN encode(digest(lower(trim(email)), 'sha256'), 'hex')
    ELSE NULL END
  ) STORED,
  source        TEXT NOT NULL,  -- 'prospect_request' | 'federal_dnc' | 'state_dnc' | 'internal'
  added_reason  TEXT,
  added_by      TEXT,
  expires_at    TIMESTAMPTZ,
  is_permanent  BOOLEAN DEFAULT FALSE,
  contact_id    UUID REFERENCES contacts(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT dnc_has_phone_or_email CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE UNIQUE INDEX idx_dnc_phone_hash ON dnc_list(phone_hash) WHERE phone_hash IS NOT NULL;
CREATE UNIQUE INDEX idx_dnc_email_hash ON dnc_list(email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX idx_dnc_contact ON dnc_list(contact_id);

-- ============================================================
-- OPT OUTS
-- ============================================================

CREATE TABLE opt_outs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  opt_out_type  TEXT NOT NULL,  -- 'call' | 'email' | 'all'
  channel       TEXT,           -- 'voice' | 'email' | 'web'
  requested_at  TIMESTAMPTZ DEFAULT NOW(),
  call_id       UUID REFERENCES calls(id),
  email_id      UUID REFERENCES emails(id),
  raw_request   TEXT,
  processed     BOOLEAN DEFAULT FALSE,
  processed_at  TIMESTAMPTZ
);

CREATE INDEX idx_opt_outs_contact ON opt_outs(contact_id);
CREATE INDEX idx_opt_outs_unprocessed ON opt_outs(processed) WHERE processed = FALSE;

-- ============================================================
-- COMPLIANCE LOGS
-- ============================================================

CREATE TABLE compliance_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type     TEXT NOT NULL,  -- 'lead' | 'call' | 'contact' | 'email'
  entity_id       UUID NOT NULL,
  check_type      TEXT NOT NULL,  -- 'dnc_check' | 'call_window' | 'ai_disclosure' | 'opt_out_check'
  passed          BOOLEAN NOT NULL,
  details         JSONB DEFAULT '{}',
  checked_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_compliance_logs_entity ON compliance_logs(entity_type, entity_id);
CREATE INDEX idx_compliance_logs_check_type ON compliance_logs(check_type);
CREATE INDEX idx_compliance_logs_failed ON compliance_logs(passed) WHERE passed = FALSE;

-- ============================================================
-- CONSENT RECORDS
-- ============================================================

CREATE TABLE consent_records (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id         UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id),

  ai_disclosed_at TIMESTAMPTZ,
  disclosure_text TEXT,
  company_stated  BOOLEAN DEFAULT FALSE,
  purpose_stated  BOOLEAN DEFAULT FALSE,
  consent_given   BOOLEAN,
  consent_withdrawn BOOLEAN DEFAULT FALSE,
  consent_withdrawn_at TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_consent_records_call ON consent_records(call_id);
CREATE INDEX idx_consent_records_contact ON consent_records(contact_id);

-- ============================================================
-- QUEUE JOBS (BullMQ mirror for visibility)
-- ============================================================

CREATE TABLE queue_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bullmq_job_id   TEXT NOT NULL,
  queue_name      TEXT NOT NULL,
  job_type        TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  status          TEXT DEFAULT 'waiting',  -- 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
  priority        INTEGER DEFAULT 5,
  attempts        INTEGER DEFAULT 0,
  max_attempts    INTEGER DEFAULT 3,
  error_message   TEXT,
  result          JSONB,
  process_after   TIMESTAMPTZ DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(bullmq_job_id, queue_name)
);

CREATE INDEX idx_queue_jobs_status ON queue_jobs(status, process_after);
CREATE INDEX idx_queue_jobs_queue ON queue_jobs(queue_name, status);

-- ============================================================
-- API USAGE TRACKING (cost management)
-- ============================================================

CREATE TABLE api_usage (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider        TEXT NOT NULL,  -- 'anthropic' | 'telnyx' | 'elevenlabs' | 'zoominfo' | 'gmail'
  operation       TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,

  -- Tokens / units
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cache_read_tokens INTEGER,
  units_consumed  DECIMAL(10,4),

  -- Cost (USD)
  cost_usd        DECIMAL(10,6),

  -- Metadata
  model           TEXT,
  duration_ms     INTEGER,
  success         BOOLEAN DEFAULT TRUE,
  error_code      TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_usage_provider ON api_usage(provider, created_at DESC);
CREATE INDEX idx_api_usage_entity ON api_usage(entity_type, entity_id);
CREATE INDEX idx_api_usage_daily ON api_usage(DATE(created_at), provider);

-- ============================================================
-- ERROR LOGS
-- ============================================================

CREATE TABLE error_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  error_code      TEXT NOT NULL,
  message         TEXT NOT NULL,
  stack_trace     TEXT,
  context         JSONB DEFAULT '{}',
  severity        TEXT DEFAULT 'error',  -- 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  service         TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  resolved        BOOLEAN DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_error_logs_severity ON error_logs(severity, created_at DESC);
CREATE INDEX idx_error_logs_service ON error_logs(service, created_at DESC);
CREATE INDEX idx_error_logs_unresolved ON error_logs(resolved) WHERE resolved = FALSE;
