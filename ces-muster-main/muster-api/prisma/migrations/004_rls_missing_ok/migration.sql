-- Migration: 004_rls_missing_ok
--
-- Problem: the TEXT-comparison policies from 003 call
--   current_setting('app.tenant_id')
-- which throws Postgres error 42704 "unrecognized configuration parameter" on
-- any connection that has not first executed
--   SET [LOCAL] app.tenant_id = '<uuid>'
-- Plain db connections (no GUC set) therefore ERROR instead of returning 0 rows,
-- causing 500 on every RLS-protected route when withTenant is not yet wired.
--
-- Fix: switch every USING clause to the two-argument form
--   current_setting('app.tenant_id', true)   -- missing_ok = true
-- When the parameter is not set, current_setting(..., true) returns NULL instead
-- of raising an exception. NULL = <tenant_id> evaluates to NULL (not TRUE), so
-- all rows are excluded — the connection fails CLOSED, never crashes.
--
-- Rationale: fail-closed is the correct security posture. An unscoped connection
-- must see ZERO rows, not all rows and not an error.
--
-- Order: DROP POLICY first (they reference nothing, so no dependency issues),
-- then CREATE POLICY. No column or FK changes are needed.

-- ── 1. Drop existing policies (003 form) ─────────────────────────────────────

DROP POLICY tenant_isolation ON parties;
DROP POLICY tenant_isolation ON interview_sessions;
DROP POLICY tenant_isolation ON contracts;
DROP POLICY tenant_isolation ON hil_items;
DROP POLICY tenant_isolation ON touch_events;

-- ── 2. Recreate with missing_ok = true ───────────────────────────────────────
-- The USING expression now reads current_setting('app.tenant_id', true).
-- If app.tenant_id is not set the function returns NULL, the equality is NULL,
-- and RLS excludes every row — fail-closed, no error.

CREATE POLICY tenant_isolation ON parties
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON interview_sessions
  USING (
    party_id IN (
      SELECT id FROM parties
      WHERE tenant_id = current_setting('app.tenant_id', true)
    )
  );

CREATE POLICY tenant_isolation ON contracts
  USING (
    party_id IN (
      SELECT id FROM parties
      WHERE tenant_id = current_setting('app.tenant_id', true)
    )
  );

CREATE POLICY tenant_isolation ON hil_items
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON touch_events
  USING (tenant_id = current_setting('app.tenant_id', true));
