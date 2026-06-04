-- ============================================================
-- 010 — Authenticated read (SELECT) policies
-- ------------------------------------------------------------
-- Migration 004 enabled Row-Level Security on the core tables but only
-- created a `service_role` policy. The web frontend connects with the
-- anon key under the logged-in user's JWT (role `authenticated`), so with
-- RLS on and no matching policy Postgres default-DENIED every read —
-- making the Dashboard call data, Conversations, and transcript views all
-- come back empty.
--
-- This grants SELECT to `authenticated` on those tables. Single-team
-- internal tool: any logged-in user may read all rows (USING TRUE). This
-- also makes AI-generated rows (created_by IS NULL) visible.
--
-- Writes are unaffected: they go through the Express API using the
-- service-role key, which bypasses RLS entirely.
--
-- Idempotent: safe to re-run (DROP POLICY IF EXISTS before CREATE).
-- ============================================================

DROP POLICY IF EXISTS "authenticated_read" ON companies;
CREATE POLICY "authenticated_read" ON companies FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "authenticated_read" ON contacts;
CREATE POLICY "authenticated_read" ON contacts FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "authenticated_read" ON leads;
CREATE POLICY "authenticated_read" ON leads FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "authenticated_read" ON calls;
CREATE POLICY "authenticated_read" ON calls FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "authenticated_read" ON call_transcripts;
CREATE POLICY "authenticated_read" ON call_transcripts FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "authenticated_read" ON emails;
CREATE POLICY "authenticated_read" ON emails FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "authenticated_read" ON dnc_list;
CREATE POLICY "authenticated_read" ON dnc_list FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "authenticated_read" ON compliance_logs;
CREATE POLICY "authenticated_read" ON compliance_logs FOR SELECT TO authenticated USING (TRUE);
