-- ============================================================
-- 011 — Reporting support: materialized-view refresh function
-- ------------------------------------------------------------
-- The reporting worker refreshes mv_daily_stats (created in 004) on demand /
-- on a digest run. supabase-js can't issue REFRESH MATERIALIZED VIEW directly,
-- so we expose it as a SECURITY DEFINER function callable via supabase.rpc().
--
-- mv_daily_stats has a UNIQUE index (idx_mv_daily_stats), so CONCURRENTLY is
-- allowed (non-blocking refresh).
--
-- Idempotent: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_mv_daily_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_stats;
EXCEPTION
  -- If a concurrent refresh isn't possible yet (e.g. view never populated),
  -- fall back to a plain refresh so the first run still succeeds.
  WHEN feature_not_supported OR object_not_in_prerequisite_state THEN
    REFRESH MATERIALIZED VIEW mv_daily_stats;
END;
$$;

-- Allow the service role (used by the worker) to execute it.
GRANT EXECUTE ON FUNCTION refresh_mv_daily_stats() TO service_role;
