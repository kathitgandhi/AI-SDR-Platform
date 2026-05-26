-- ============================================================
-- Migration 007: app_settings, audit_log, csv_imports
-- ============================================================

-- 1. App settings (per-user JSONB key-value bag for company profile, business hours, etc.)
CREATE TABLE IF NOT EXISTS app_settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_app_settings_user ON app_settings(user_id);

-- 2. Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,         -- 'create' | 'update' | 'delete' | 'bulk_update' | 'login' | etc.
  entity_type  TEXT NOT NULL,         -- 'lead' | 'call' | 'campaign' | 'ticket' | etc.
  entity_id    UUID,
  changes      JSONB DEFAULT '{}'::jsonb,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- 3. CSV import tracking
CREATE TABLE IF NOT EXISTS csv_imports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  filename        TEXT,
  total_rows      INTEGER DEFAULT 0,
  imported_count  INTEGER DEFAULT 0,
  failed_count    INTEGER DEFAULT 0,
  errors          JSONB DEFAULT '[]'::jsonb,
  campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  status          TEXT DEFAULT 'processing', -- 'processing' | 'completed' | 'failed'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_csv_imports_user ON csv_imports(user_id);

-- 4. DNC list — add created_by if not already (so it's user-scoped)
ALTER TABLE dnc_list ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dnc_list_created_by ON dnc_list(created_by);

-- 5. Recording fields on calls
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_url TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_duration_seconds INTEGER;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_storage_path TEXT;
