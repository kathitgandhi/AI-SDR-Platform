-- Migration 015: Store AirDesk360 CRM IDs on leads/contacts/companies so the
-- CRM sync worker does not need to re-discover them on every sync job.
--
-- crm_lead_id    — AirDesk360 lead (deal) ID returned by createDeal()
-- crm_contact_id — AirDesk360 contact ID returned by createOrUpdateContact()
-- crm_company_id — AirDesk360 customer ID returned by createOrUpdateCompany()
--
-- All are nullable TEXT so existing rows are unaffected; they are populated by
-- the crm-sync worker the first time a lead is pushed to AirDesk360.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS crm_lead_id    TEXT,
  ADD COLUMN IF NOT EXISTS crm_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS crm_company_id TEXT;

-- Index for quick lookup when the call-sync job fetches the lead.
CREATE INDEX IF NOT EXISTS idx_leads_crm_lead_id ON leads (crm_lead_id) WHERE crm_lead_id IS NOT NULL;

COMMENT ON COLUMN leads.crm_lead_id    IS 'AirDesk360 lead (deal) ID — populated by crm-sync worker';
COMMENT ON COLUMN leads.crm_contact_id IS 'AirDesk360 contact ID — populated by crm-sync worker';
COMMENT ON COLUMN leads.crm_company_id IS 'AirDesk360 customer ID — populated by crm-sync worker';
