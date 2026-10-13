-- Migration: 005_delivery_portal (GP-MUSTER-2 M2)
--
-- The delivery portal's three tables. docs/design/result-handling-policy.md is
-- the normative source for the rules these tables implement: per-engagement
-- scope, short-lived named grants, download-only, audit on every touch, 90-day
-- retention purge, audit entries outlive artifacts.

-- ============================================================
-- delivery_artifacts: the bytes a contractor receives.
-- content is zeroed (not deleted) on purge; the row + audit trail remain.
-- ============================================================
CREATE TABLE delivery_artifacts (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id      TEXT        NOT NULL,
  engagement_id  TEXT        NOT NULL,
  kind           TEXT        NOT NULL,
  filename       TEXT        NOT NULL,
  content        BYTEA       NOT NULL,
  content_sha256 TEXT        NOT NULL,
  delivered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  purged_at      TIMESTAMPTZ,
  purge_reason   TEXT
);

-- ============================================================
-- delivery_grants: named, short-lived pull capability for ONE engagement.
-- token_hash is sha256 of the capability token; plaintext is returned exactly
-- once at issue time and never stored.
-- ============================================================
CREATE TABLE delivery_grants (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id     TEXT        NOT NULL,
  engagement_id TEXT        NOT NULL,
  grantee_name  TEXT        NOT NULL,
  grantee_email TEXT        NOT NULL,
  issued_by     TEXT        NOT NULL,
  token_hash    TEXT        NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- delivery_audit_entries: who touched what, when, with what outcome.
-- Outlives the artifacts it describes (policy rule 5) — no cascade, no purge.
-- ============================================================
CREATE TABLE delivery_audit_entries (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id     TEXT        NOT NULL,
  engagement_id TEXT        NOT NULL,
  artifact_id   TEXT,
  grant_id      TEXT,
  actor         TEXT        NOT NULL,
  action        TEXT        NOT NULL,
  outcome       TEXT        NOT NULL,
  detail        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS: delivery_artifacts + delivery_audit_entries follow the standard
-- fail-closed tenant policy (004 pattern: missing_ok=true -> NULL -> 0 rows).
-- ============================================================
ALTER TABLE delivery_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_artifacts
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE delivery_audit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_audit_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delivery_audit_entries
  USING (tenant_id = current_setting('app.tenant_id', true));

-- delivery_grants carries NO tenant RLS policy, deliberately: grant resolution
-- happens BEFORE any tenant context exists (the portal caller presents only the
-- token). The 256-bit token is itself the capability — unguessable, stored only
-- as a sha256 hash, unique-indexed. Every artifact/audit access that follows a
-- successful resolution runs under withTenant(grant.tenant_id), where the
-- standard policies apply. Defense in depth: the service layer additionally
-- filters every query by BOTH tenant_id AND engagement_id explicitly.
