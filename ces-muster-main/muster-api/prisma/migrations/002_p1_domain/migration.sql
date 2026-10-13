-- Migration: 002_p1_domain
-- Additive: new enum PartyLifecycle, two new columns on parties,
-- and two new tables (hil_items, touch_events) with RLS matching 001 pattern.

-- ============================================================
-- New enum: PartyLifecycle
-- abandoned/opted_out are NOT states here — they stay on DispositionState as terminals.
-- ============================================================
CREATE TYPE "PartyLifecycle" AS ENUM (
  'invited',
  'in_progress',
  'stalled',
  'complete',
  'ready',
  'validate',
  'convert_to_enclave',
  'reassessment_due'
);

-- ============================================================
-- Extend parties: lifecycle tracking
-- ============================================================
ALTER TABLE parties
  ADD COLUMN lifecycle         "PartyLifecycle" NOT NULL DEFAULT 'invited',
  ADD COLUMN last_activity_at  TIMESTAMPTZ;

-- ============================================================
-- hil_items: human-in-the-loop escalation queue
-- tenant_id included directly for simple RLS policy (same as parties).
-- ============================================================
CREATE TABLE hil_items (
  id                   UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID             NOT NULL,
  party_id             UUID             NOT NULL,
  session_id           UUID,
  question_id          TEXT             NOT NULL,
  reason               TEXT             NOT NULL,
  fact                 JSONB            NOT NULL,
  created_at           TIMESTAMPTZ      NOT NULL DEFAULT now(),
  resolved_at          TIMESTAMPTZ,
  resolved_by_user_id  UUID,
  advisor_minutes      DOUBLE PRECISION
);

-- ============================================================
-- touch_events: mode-a/c touch log
-- ============================================================
CREATE TABLE touch_events (
  id             UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID             NOT NULL,
  engagement_id  UUID             NOT NULL,
  mode           TEXT             NOT NULL,
  kind           TEXT             NOT NULL,
  minutes        DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ      NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS: hil_items — tenant_id column is direct (same pattern as parties in 001)
-- ============================================================
ALTER TABLE hil_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE hil_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON hil_items
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================
-- RLS: touch_events — tenant_id column is direct
-- ============================================================
ALTER TABLE touch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE touch_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON touch_events
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
