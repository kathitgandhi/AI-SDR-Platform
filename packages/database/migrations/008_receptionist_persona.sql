-- ============================================================
-- Migration 008: add 'receptionist' to persona_name enum
-- ============================================================
--
-- Inbound calls are answered by a dedicated receptionist agent (assigned to the
-- phone number in the ElevenLabs portal — currently Charlotte), not by one of the
-- 7 outbound SDR personas. The calls.persona column is a NOT NULL persona_name
-- enum, so we extend the enum to record who actually handled inbound calls.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block that also
-- *uses* the new value. This statement only adds it, so it is safe in a migration.

ALTER TYPE persona_name ADD VALUE IF NOT EXISTS 'receptionist';
