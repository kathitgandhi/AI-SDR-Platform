-- ============================================================
-- AI SDR PLATFORM — INITIAL SCHEMA
-- Migration: 001_initial_schema.sql
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE lead_stage AS ENUM (
  'new',
  'enriching',
  'enriched',
  'phone_lookup_pending',
  'callable',
  'email_only',
  'in_call_queue',
  'calling',
  'called_no_answer',
  'called_voicemail',
  'called_gatekeeper',
  'connected',
  'qualified',
  'meeting_booked',
  'meeting_held',
  'nurturing_30d',
  'nurturing_90d',
  'nurturing_180d',
  'disqualified',
  'dnc',
  'dead'
);

CREATE TYPE line_type AS ENUM (
  'landline',
  'mobile',
  'voip',
  'toll_free',
  'premium',
  'unknown',
  'invalid'
);

CREATE TYPE call_status AS ENUM (
  'pending',
  'dialing',
  'ringing',
  'answered',
  'voicemail',
  'no_answer',
  'busy',
  'failed',
  'completed',
  'dnc_blocked',
  'window_blocked'
);

CREATE TYPE call_outcome AS ENUM (
  'meeting_booked',
  'callback_requested',
  'not_interested',
  'not_decision_maker',
  'wrong_number',
  'voicemail_left',
  'voicemail_full',
  'no_answer',
  'busy',
  'gatekeeper_blocked',
  'dnc_requested',
  'already_customer',
  'using_competitor',
  'too_small',
  'qualified_nurture',
  'error'
);

CREATE TYPE email_status AS ENUM (
  'pending',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'replied',
  'bounced',
  'spam',
  'unsubscribed',
  'failed'
);

CREATE TYPE campaign_status AS ENUM (
  'draft',
  'active',
  'paused',
  'completed',
  'archived'
);

CREATE TYPE crm_provider AS ENUM (
  'hubspot',
  'salesforce',
  'pipedrive',
  'zoho',
  'none'
);

CREATE TYPE retail_vertical AS ENUM (
  'grocery',
  'general_retail',
  'wholesale_distribution',
  'automotive_retail',
  'electronics',
  'specialty',
  'cpg_operator',
  'pharmacy',
  'convenience',
  'home_improvement',
  'fashion_apparel',
  'furniture',
  'unknown'
);

CREATE TYPE persona_name AS ENUM (
  'mike',
  'sarah',
  'david',
  'rachel',
  'chris',
  'emma',
  'daniel'
);

-- ============================================================
-- COMPANIES
-- ============================================================

CREATE TABLE companies (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL,
  domain                TEXT,
  website               TEXT,
  industry              TEXT,
  retail_vertical       retail_vertical DEFAULT 'unknown',
  employee_count        INTEGER,
  annual_revenue        BIGINT,
  store_count           INTEGER,
  location_count        INTEGER,
  headquarters_city     TEXT,
  headquarters_state    TEXT,
  headquarters_country  TEXT DEFAULT 'US',
  description           TEXT,

  -- Technology signals
  has_esl               BOOLEAN DEFAULT FALSE,
  esl_vendor            TEXT,
  has_pos               BOOLEAN DEFAULT FALSE,
  pos_vendor            TEXT,
  has_erp               BOOLEAN DEFAULT FALSE,
  erp_vendor            TEXT,
  has_wms               BOOLEAN DEFAULT FALSE,
  wms_vendor            TEXT,

  -- Enrichment metadata
  enriched_at           TIMESTAMPTZ,
  enrichment_source     TEXT,
  enrichment_confidence DECIMAL(3,2) DEFAULT 0,

  -- Scoring
  icp_score             INTEGER DEFAULT 0 CHECK (icp_score BETWEEN 0 AND 100),
  icp_tier              CHAR(1) CHECK (icp_tier IN ('A', 'B', 'C', 'D')),

  -- External IDs
  zoominfo_company_id   TEXT UNIQUE,
  hubspot_company_id    TEXT,
  salesforce_account_id TEXT,
  pipedrive_org_id      TEXT,
  zoho_account_id       TEXT,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_domain ON companies(domain);
CREATE INDEX idx_companies_vertical ON companies(retail_vertical);
CREATE INDEX idx_companies_icp_score ON companies(icp_score DESC);
CREATE INDEX idx_companies_store_count ON companies(store_count DESC NULLS LAST);
CREATE INDEX idx_companies_zoominfo ON companies(zoominfo_company_id);

-- ============================================================
-- CONTACTS
-- ============================================================

CREATE TABLE contacts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  first_name            TEXT NOT NULL,
  last_name             TEXT,
  full_name             TEXT GENERATED ALWAYS AS (
    COALESCE(first_name || ' ' || last_name, first_name)
  ) STORED,
  title                 TEXT,
  department            TEXT,
  seniority             TEXT,

  -- Contact info
  email                 TEXT,
  email_valid           BOOLEAN DEFAULT TRUE,
  phone_direct          TEXT,
  phone_direct_type     line_type,
  phone_direct_valid    BOOLEAN DEFAULT TRUE,
  phone_mobile          TEXT,
  phone_hq              TEXT,
  linkedin_url          TEXT,

  -- Decision maker classification
  is_decision_maker     BOOLEAN DEFAULT FALSE,
  decision_authority    TEXT,

  -- Opt-out tracking
  email_opted_out       BOOLEAN DEFAULT FALSE,
  email_opted_out_at    TIMESTAMPTZ,
  call_opted_out        BOOLEAN DEFAULT FALSE,
  call_opted_out_at     TIMESTAMPTZ,

  -- External IDs
  zoominfo_contact_id   TEXT UNIQUE,
  hubspot_contact_id    TEXT,
  salesforce_contact_id TEXT,
  pipedrive_person_id   TEXT,
  zoho_contact_id       TEXT,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_phone_direct ON contacts(phone_direct);
CREATE INDEX idx_contacts_decision_maker ON contacts(is_decision_maker) WHERE is_decision_maker = TRUE;
CREATE INDEX idx_contacts_zoominfo ON contacts(zoominfo_contact_id);

-- ============================================================
-- LEADS (Pipeline records)
-- ============================================================

CREATE TABLE leads (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id            UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id           UUID, -- FK added after campaigns table

  stage                 lead_stage DEFAULT 'new',
  score                 INTEGER DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  priority              INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),

  -- Call state
  call_attempts         INTEGER DEFAULT 0,
  last_called_at        TIMESTAMPTZ,
  next_contact_at       TIMESTAMPTZ,
  assigned_persona      persona_name,

  -- Qualification data (populated post-call)
  store_count_confirmed INTEGER,
  current_esl_vendor    TEXT,
  current_pos_vendor    TEXT,
  current_erp_vendor    TEXT,
  current_wms_vendor    TEXT,
  pain_points           TEXT[],
  rollout_timeline      TEXT,
  budget_range          TEXT,
  is_decision_maker     BOOLEAN,
  decision_process      TEXT,

  -- Pipeline
  pipeline_stage        TEXT,
  meeting_booked_at     TIMESTAMPTZ,
  meeting_date          TIMESTAMPTZ,
  disqualified_reason   TEXT,

  -- Notes
  last_call_summary     TEXT,
  handoff_summary       TEXT,
  internal_notes        TEXT,

  -- Source tracking
  source                TEXT DEFAULT 'zoominfo',
  source_list_id        TEXT,
  imported_at           TIMESTAMPTZ DEFAULT NOW(),

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_contact ON leads(contact_id);
CREATE INDEX idx_leads_company ON leads(company_id);
CREATE INDEX idx_leads_campaign ON leads(campaign_id);
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_score ON leads(score DESC);
CREATE INDEX idx_leads_next_contact ON leads(next_contact_at) WHERE next_contact_at IS NOT NULL;
CREATE INDEX idx_leads_callable ON leads(stage, next_contact_at)
  WHERE stage IN ('callable', 'in_call_queue', 'called_no_answer', 'called_voicemail');

-- ============================================================
-- LEAD SCORES (audit trail)
-- ============================================================

CREATE TABLE lead_scores (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL,
  previous_score  INTEGER,
  scored_by       TEXT NOT NULL, -- 'system', 'claude', 'manual'
  factors         JSONB NOT NULL DEFAULT '{}',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lead_scores_lead ON lead_scores(lead_id);
CREATE INDEX idx_lead_scores_created ON lead_scores(created_at DESC);

-- ============================================================
-- LEAD STAGE HISTORY
-- ============================================================

CREATE TABLE lead_stage_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_stage    lead_stage,
  to_stage      lead_stage NOT NULL,
  changed_by    TEXT NOT NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stage_history_lead ON lead_stage_history(lead_id);

-- ============================================================
-- CAMPAIGNS
-- ============================================================

CREATE TABLE campaigns (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                    TEXT NOT NULL,
  description             TEXT,
  status                  campaign_status DEFAULT 'draft',

  -- Targeting config
  target_verticals        retail_vertical[],
  target_titles           TEXT[],
  target_min_store_count  INTEGER DEFAULT 1,
  target_min_employees    INTEGER,
  target_states           TEXT[],

  -- Pacing
  daily_call_limit        INTEGER DEFAULT 100,
  hourly_call_limit       INTEGER DEFAULT 20,
  max_concurrent_calls    INTEGER DEFAULT 5,
  call_retry_max          INTEGER DEFAULT 3,
  call_window_start       INTEGER DEFAULT 8,
  call_window_end         INTEGER DEFAULT 21,

  -- Personas
  enabled_personas        persona_name[] DEFAULT ARRAY['mike','sarah','david','rachel','chris','emma','daniel']::persona_name[],

  -- Email sequences
  email_sequence_id       TEXT,
  email_enabled           BOOLEAN DEFAULT TRUE,

  -- Stats (denormalized for performance)
  total_leads             INTEGER DEFAULT 0,
  calls_made              INTEGER DEFAULT 0,
  meetings_booked         INTEGER DEFAULT 0,
  emails_sent             INTEGER DEFAULT 0,

  started_at              TIMESTAMPTZ,
  paused_at               TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,

  created_by              TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK from leads to campaigns
ALTER TABLE leads ADD CONSTRAINT leads_campaign_fk
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id);

-- ============================================================
-- AGENT PERSONAS
-- ============================================================

CREATE TABLE agent_personas (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  persona_name UNIQUE NOT NULL,
  display_name          TEXT NOT NULL,
  elevenlabs_agent_id   TEXT NOT NULL,
  voice_id              TEXT NOT NULL,
  tone                  TEXT NOT NULL,
  style                 TEXT NOT NULL,
  opening_style         TEXT NOT NULL,
  system_prompt_override TEXT,
  is_active             BOOLEAN DEFAULT TRUE,

  -- Performance stats
  calls_made            INTEGER DEFAULT 0,
  meetings_booked       INTEGER DEFAULT 0,
  connect_rate          DECIMAL(5,4) DEFAULT 0,
  meeting_rate          DECIMAL(5,4) DEFAULT 0,
  avg_call_duration     INTEGER DEFAULT 0,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
