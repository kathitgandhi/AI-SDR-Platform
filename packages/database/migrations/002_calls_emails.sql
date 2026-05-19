-- ============================================================
-- AI SDR PLATFORM — CALLS + EMAILS SCHEMA
-- Migration: 002_calls_emails.sql
-- ============================================================

-- ============================================================
-- CALLS
-- ============================================================

CREATE TABLE calls (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id               UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contact_id            UUID NOT NULL REFERENCES contacts(id),
  company_id            UUID NOT NULL REFERENCES companies(id),
  campaign_id           UUID REFERENCES campaigns(id),

  -- Telnyx data
  telnyx_call_id        TEXT UNIQUE,
  telnyx_call_leg_id    TEXT,
  call_control_id       TEXT,

  -- Call details
  persona               persona_name NOT NULL,
  from_number           TEXT NOT NULL,
  to_number             TEXT NOT NULL,
  status                call_status DEFAULT 'pending',
  outcome               call_outcome,
  direction             TEXT DEFAULT 'outbound',

  -- Timing
  initiated_at          TIMESTAMPTZ DEFAULT NOW(),
  answered_at           TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  duration_seconds      INTEGER,
  ring_duration_seconds INTEGER,
  talk_time_seconds     INTEGER,

  -- AI metadata
  elevenlabs_session_id TEXT,
  claude_session_id     TEXT,
  ai_confidence_score   DECIMAL(3,2),

  -- Outcome data
  outcome_score         INTEGER CHECK (outcome_score BETWEEN 0 AND 100),
  qualification_score   INTEGER CHECK (qualification_score BETWEEN 0 AND 100),
  sentiment_score       DECIMAL(3,2),
  meeting_booked        BOOLEAN DEFAULT FALSE,
  dnc_requested         BOOLEAN DEFAULT FALSE,
  voicemail_left        BOOLEAN DEFAULT FALSE,
  gatekeeper_reached    BOOLEAN DEFAULT FALSE,
  decision_maker_reached BOOLEAN DEFAULT FALSE,

  -- Notes
  call_summary          TEXT,
  next_steps            TEXT,
  internal_notes        TEXT,

  -- Retry tracking
  attempt_number        INTEGER DEFAULT 1,
  retry_scheduled_at    TIMESTAMPTZ,

  -- Compliance
  ai_disclosed          BOOLEAN DEFAULT FALSE,
  company_identified    BOOLEAN DEFAULT FALSE,
  purpose_stated        BOOLEAN DEFAULT FALSE,
  compliance_passed     BOOLEAN DEFAULT FALSE,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_calls_lead ON calls(lead_id);
CREATE INDEX idx_calls_contact ON calls(contact_id);
CREATE INDEX idx_calls_campaign ON calls(campaign_id);
CREATE INDEX idx_calls_telnyx ON calls(telnyx_call_id);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_created ON calls(created_at DESC);
CREATE INDEX idx_calls_persona ON calls(persona);
CREATE INDEX idx_calls_outcome ON calls(outcome);

-- ============================================================
-- CALL TRANSCRIPTS
-- ============================================================

CREATE TABLE call_transcripts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id         UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id),

  full_transcript TEXT,
  transcript_json JSONB,  -- structured with timestamps + speakers

  -- Extracted entities
  objections_raised     TEXT[],
  pain_points_mentioned TEXT[],
  competitors_mentioned TEXT[],
  interest_signals      TEXT[],
  next_steps_agreed     TEXT[],

  -- Claude analysis
  claude_analysis       JSONB,
  qualification_data    JSONB,
  meeting_details       JSONB,

  -- Processing state
  processed             BOOLEAN DEFAULT FALSE,
  processed_at          TIMESTAMPTZ,
  processing_error      TEXT,

  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transcripts_call ON call_transcripts(call_id);
CREATE INDEX idx_transcripts_lead ON call_transcripts(lead_id);
CREATE INDEX idx_transcripts_processed ON call_transcripts(processed) WHERE processed = FALSE;
CREATE INDEX idx_transcripts_full_text ON call_transcripts USING gin(to_tsvector('english', COALESCE(full_transcript, '')));

-- ============================================================
-- CALL EVENTS (real-time event stream)
-- ============================================================

CREATE TABLE call_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  event_data  JSONB NOT NULL DEFAULT '{}',
  source      TEXT NOT NULL,  -- 'telnyx' | 'elevenlabs' | 'system'
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_call_events_call ON call_events(call_id);
CREATE INDEX idx_call_events_type ON call_events(event_type);

-- ============================================================
-- VOICEMAILS
-- ============================================================

CREATE TABLE voicemails (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id             UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  lead_id             UUID NOT NULL REFERENCES leads(id),
  contact_id          UUID NOT NULL REFERENCES contacts(id),

  script_used         TEXT,
  duration_seconds    INTEGER,
  audio_url           TEXT,
  delivered           BOOLEAN DEFAULT FALSE,
  delivered_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_voicemails_lead ON voicemails(lead_id);

-- ============================================================
-- EMAIL SEQUENCES
-- ============================================================

CREATE TABLE email_sequences (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  trigger_event   TEXT NOT NULL,  -- 'no_answer' | 'voicemail' | 'meeting_booked' | etc
  is_active       BOOLEAN DEFAULT TRUE,
  total_steps     INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sequence_steps (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence_id       UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number       INTEGER NOT NULL,
  delay_days        INTEGER NOT NULL DEFAULT 0,
  delay_hours       INTEGER NOT NULL DEFAULT 0,
  subject_template  TEXT NOT NULL,
  body_template     TEXT NOT NULL,
  personalization_prompt TEXT,
  send_time_hour    INTEGER DEFAULT 9,
  send_time_minute  INTEGER DEFAULT 0,
  is_active         BOOLEAN DEFAULT TRUE,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sequence_id, step_number)
);

CREATE INDEX idx_sequence_steps_sequence ON sequence_steps(sequence_id);

-- ============================================================
-- CONTACT SEQUENCE ENROLLMENT
-- ============================================================

CREATE TABLE contact_sequences (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id         UUID NOT NULL REFERENCES email_sequences(id),
  campaign_id         UUID REFERENCES campaigns(id),

  current_step        INTEGER DEFAULT 1,
  status              TEXT DEFAULT 'active',  -- 'active' | 'paused' | 'completed' | 'unsubscribed'
  trigger_event       TEXT,
  trigger_call_id     UUID REFERENCES calls(id),

  enrolled_at         TIMESTAMPTZ DEFAULT NOW(),
  next_send_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  paused_at           TIMESTAMPTZ,
  paused_reason       TEXT,

  UNIQUE(contact_id, sequence_id)
);

CREATE INDEX idx_contact_sequences_contact ON contact_sequences(contact_id);
CREATE INDEX idx_contact_sequences_next_send ON contact_sequences(next_send_at)
  WHERE status = 'active' AND next_send_at IS NOT NULL;

-- ============================================================
-- EMAILS
-- ============================================================

CREATE TABLE emails (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  lead_id             UUID NOT NULL REFERENCES leads(id),
  campaign_id         UUID REFERENCES campaigns(id),
  sequence_id         UUID REFERENCES email_sequences(id),
  sequence_step_id    UUID REFERENCES sequence_steps(id),
  contact_sequence_id UUID REFERENCES contact_sequences(id),

  -- Gmail metadata
  gmail_message_id    TEXT,
  gmail_thread_id     TEXT,

  from_address        TEXT NOT NULL,
  to_address          TEXT NOT NULL,
  cc_addresses        TEXT[],
  subject             TEXT NOT NULL,
  body_html           TEXT,
  body_text           TEXT,

  status              email_status DEFAULT 'pending',
  is_hot_lead_cc      BOOLEAN DEFAULT FALSE,

  -- Tracking
  opened_count        INTEGER DEFAULT 0,
  first_opened_at     TIMESTAMPTZ,
  last_opened_at      TIMESTAMPTZ,
  clicked_count       INTEGER DEFAULT 0,
  first_clicked_at    TIMESTAMPTZ,
  replied_at          TIMESTAMPTZ,
  bounced_at          TIMESTAMPTZ,
  bounce_reason       TEXT,

  sent_at             TIMESTAMPTZ,
  scheduled_for       TIMESTAMPTZ,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_emails_contact ON emails(contact_id);
CREATE INDEX idx_emails_lead ON emails(lead_id);
CREATE INDEX idx_emails_status ON emails(status);
CREATE INDEX idx_emails_scheduled ON emails(scheduled_for) WHERE status = 'pending';
CREATE INDEX idx_emails_gmail_thread ON emails(gmail_thread_id);

-- ============================================================
-- EMAIL EVENTS
-- ============================================================

CREATE TABLE email_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email_id      UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id),
  event_type    TEXT NOT NULL,  -- 'sent' | 'delivered' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed'
  event_data    JSONB DEFAULT '{}',
  ip_address    TEXT,
  user_agent    TEXT,
  occurred_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_events_email ON email_events(email_id);
CREATE INDEX idx_email_events_contact ON email_events(contact_id);
CREATE INDEX idx_email_events_type ON email_events(event_type);

-- ============================================================
-- APPOINTMENTS
-- ============================================================

CREATE TABLE appointments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id               UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contact_id            UUID NOT NULL REFERENCES contacts(id),
  company_id            UUID NOT NULL REFERENCES companies(id),
  call_id               UUID REFERENCES calls(id),
  campaign_id           UUID REFERENCES campaigns(id),

  status                TEXT DEFAULT 'scheduled',  -- 'scheduled' | 'confirmed' | 'held' | 'cancelled' | 'no_show' | 'rescheduled'

  scheduled_at          TIMESTAMPTZ NOT NULL,
  duration_minutes      INTEGER DEFAULT 30,
  timezone              TEXT NOT NULL DEFAULT 'America/New_York',

  meeting_type          TEXT DEFAULT 'discovery',  -- 'discovery' | 'demo' | 'follow_up'
  meeting_link          TEXT,
  calendar_event_id     TEXT,

  -- Attendees
  assigned_rep_email    TEXT,
  assigned_rep_name     TEXT,
  contact_confirmed     BOOLEAN DEFAULT FALSE,
  contact_confirmed_at  TIMESTAMPTZ,

  -- Qualification snapshot
  qualification_summary TEXT,
  key_pain_points       TEXT[],
  products_of_interest  TEXT[],
  store_count           INTEGER,
  budget_indication     TEXT,
  decision_timeline     TEXT,

  -- Outcome
  held_at               TIMESTAMPTZ,
  outcome               TEXT,
  outcome_notes         TEXT,

  reminder_sent         BOOLEAN DEFAULT FALSE,
  reminder_sent_at      TIMESTAMPTZ,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_appointments_lead ON appointments(lead_id);
CREATE INDEX idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_rep ON appointments(assigned_rep_email);
