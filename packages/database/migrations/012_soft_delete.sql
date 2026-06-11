-- ============================================================
-- 012 — Soft delete for campaigns + leads
-- ------------------------------------------------------------
-- Adds a nullable deleted_at marker so the UI can "remove" a campaign/lead
-- without a hard DELETE. Hard deletes are blocked anyway by RESTRICT foreign
-- keys (calls.campaign_id, emails.lead_id, appointments.lead_id, etc.) for any
-- record with activity, and would destroy call/email history. Soft delete is
-- reversible (set deleted_at = NULL) and FK-safe.
--
-- The API filters `deleted_at IS NULL` on list/detail reads, so soft-deleted
-- rows disappear from the UI but the data (and its call/email history) is kept.
--
-- Idempotent.
-- ============================================================

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE leads     ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes keep the common "not deleted" scans fast.
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_not_deleted ON leads(stage) WHERE deleted_at IS NULL;
