-- ============================================================
-- 013 — Appointments: allow "time TBD"
-- ------------------------------------------------------------
-- A meeting can be booked (prospect agreed to a demo) without a concrete
-- date/time confirmed on the call. Previously scheduled_at was NOT NULL, so the
-- worker invented a bogus placeholder (2 days out) — which showed up as a wrong
-- past date in the Meetings tab.
--
-- Make scheduled_at nullable so we can store NULL = "time TBD", and add
-- time_confirmed to distinguish a prospect-confirmed time from a proposed one.
-- Existing rows are treated as confirmed.
--
-- Idempotent.
-- ============================================================

ALTER TABLE appointments ALTER COLUMN scheduled_at DROP NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS time_confirmed BOOLEAN DEFAULT TRUE;
