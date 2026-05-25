-- ============================================================
-- Migration 006: notes, tickets, SMS, transfer rules
-- ============================================================

-- 1. Notes (timestamped, multi-author, attached to lead OR call)
CREATE TABLE IF NOT EXISTS notes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE,
  call_id     UUID REFERENCES calls(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  source      TEXT DEFAULT 'manual',  -- 'manual' | 'transcript' | 'system'
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CHECK (lead_id IS NOT NULL OR call_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_notes_lead       ON notes(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_call       ON notes(call_id) WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_created_by ON notes(created_by);

-- 2. Tickets (in-house)
DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM ('open','in_progress','waiting','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE ticket_priority AS ENUM ('low','medium','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tickets (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT NOT NULL,
  description  TEXT,
  status       ticket_status DEFAULT 'open',
  priority     ticket_priority DEFAULT 'medium',
  -- relations
  lead_id      UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id   UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id   UUID REFERENCES companies(id) ON DELETE SET NULL,
  call_id      UUID REFERENCES calls(id) ON DELETE SET NULL,
  -- assignment
  assigned_to  UUID REFERENCES auth.users(id),
  created_by   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_status     ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority   ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_lead       ON tickets(lead_id);

-- 3. SMS messages (inbound + outbound)
CREATE TABLE IF NOT EXISTS sms_messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id       UUID REFERENCES contacts(id) ON DELETE CASCADE,
  lead_id          UUID REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id      UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  from_number      TEXT NOT NULL,
  to_number        TEXT NOT NULL,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  body             TEXT NOT NULL,
  status           TEXT DEFAULT 'queued',  -- queued|sent|delivered|failed|received
  telnyx_message_id TEXT UNIQUE,
  error_code       TEXT,
  created_by       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_at          TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sms_contact    ON sms_messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_sms_lead       ON sms_messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_direction  ON sms_messages(direction);
CREATE INDEX IF NOT EXISTS idx_sms_created_by ON sms_messages(created_by);

-- 4. Transfer rules (explicit-request + threshold combo)
CREATE TABLE IF NOT EXISTS transfer_rules (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  trigger             TEXT NOT NULL CHECK (trigger IN ('explicit_request','qualification_threshold','keyword','outcome','always')),
  -- conditions: { "min_qualification_score": 80, "keywords": ["pricing","contract"], "outcomes": ["meeting_booked"] }
  conditions          JSONB DEFAULT '{}'::jsonb,
  transfer_to_number  TEXT NOT NULL,
  transfer_to_name    TEXT,
  campaign_id         UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  enabled             BOOLEAN DEFAULT TRUE,
  priority            INTEGER DEFAULT 50,
  created_by          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transfer_rules_campaign ON transfer_rules(campaign_id);
CREATE INDEX IF NOT EXISTS idx_transfer_rules_enabled  ON transfer_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_transfer_rules_created_by ON transfer_rules(created_by);
