-- ============================================================
-- Migration 005: per-user data ownership
-- ============================================================
-- Adds created_by column linking rows to auth.users.id, so the
-- API can scope every query to the calling user's data.
--
-- Service-to-service calls (x-api-key) bypass this filter in the
-- API layer — they see everything for admin/MCP operations.
-- ============================================================

-- Clean up any existing demo data first (rows that have no owner)
DELETE FROM appointments WHERE meeting_link LIKE 'https://meet.example.com/demo-%';
DELETE FROM call_transcripts WHERE call_id IN (
  SELECT id FROM calls WHERE summary IS NOT NULL AND persona = 'mike'
);
DELETE FROM calls WHERE company_id IN (
  SELECT id FROM companies WHERE name LIKE '%(Demo)%'
);
DELETE FROM leads WHERE company_id IN (
  SELECT id FROM companies WHERE name LIKE '%(Demo)%'
);
DELETE FROM contacts WHERE company_id IN (
  SELECT id FROM companies WHERE name LIKE '%(Demo)%'
);
DELETE FROM companies WHERE name LIKE '%(Demo)%';
DELETE FROM campaigns WHERE name = 'Demo Grocery Campaign';

-- Add created_by to all top-level tables
ALTER TABLE campaigns    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE companies    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE contacts     ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE leads        ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE calls        ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_campaigns_created_by    ON campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_companies_created_by    ON companies(created_by);
CREATE INDEX IF NOT EXISTS idx_contacts_created_by     ON contacts(created_by);
CREATE INDEX IF NOT EXISTS idx_leads_created_by        ON leads(created_by);
CREATE INDEX IF NOT EXISTS idx_calls_created_by        ON calls(created_by);
CREATE INDEX IF NOT EXISTS idx_appointments_created_by ON appointments(created_by);
