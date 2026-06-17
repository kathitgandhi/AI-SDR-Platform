-- ============================================================
-- 014 — Appointments: store the Google Calendar event id
-- ------------------------------------------------------------
-- When a meeting is booked with a confirmed time, the transcript worker creates
-- a Google Calendar event with a Meet link and emails the invite. We store the
-- event id (to update/cancel later) here; the Meet link reuses the existing
-- meeting_link column.
--
-- Idempotent.
-- ============================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS calendar_event_id TEXT;
