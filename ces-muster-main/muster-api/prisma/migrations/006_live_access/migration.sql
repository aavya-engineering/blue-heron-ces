-- Migration: 006_live_access (FC-MU-2, MU-03 / MU-06 live path)
--
-- The per-engagement live-tenant flag and the recorded customer consent.
-- OFF by default: every existing and new engagement starts with
-- live_access_enabled = false. live_consent is written only when a customer
-- admin completes the device-code sign-in (who, when, scopes, tenant id); a
-- refused or aborted consent writes nothing. No token or secret is stored.
ALTER TABLE engagements ADD COLUMN live_access_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE engagements ADD COLUMN live_access_set_by  TEXT;
ALTER TABLE engagements ADD COLUMN live_access_set_at  TIMESTAMPTZ;
ALTER TABLE engagements ADD COLUMN live_consent        JSONB;
