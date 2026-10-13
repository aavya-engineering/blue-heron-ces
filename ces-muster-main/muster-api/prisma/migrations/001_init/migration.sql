-- Migration: 001_init
-- Hand-written DDL matching schema.prisma exactly, followed by RLS setup.

-- Enum types
CREATE TYPE "Role" AS ENUM ('prime', 'sub', 'bhd_operator', 'assessor_read_only');
CREATE TYPE "EngagementKind" AS ENUM ('prime_and_subs', 'individual_contractor');
CREATE TYPE "OnPremOt" AS ENUM ('yes', 'no', 'unsure');
CREATE TYPE "SessionStatus" AS ENUM ('in_progress', 'complete');
CREATE TYPE "NudgeType" AS ENUM ('t3', 't7', 't14', 'stall', 'escalation');
CREATE TYPE "DispositionState" AS ENUM (
  'ready', 'validate', 'convert_to_enclave', 'schedule_reassessment',
  'abandoned', 'opted_out', 'escalated', 'complete'
);

-- tenants
CREATE TABLE tenants (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- engagements
CREATE TABLE engagements (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID            NOT NULL REFERENCES tenants(id),
  engagement_kind "EngagementKind" NOT NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- users
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  party_id      UUID,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          "Role"      NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- parties
CREATE TABLE parties (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  engagement_id UUID        NOT NULL REFERENCES engagements(id),
  name          TEXT        NOT NULL,
  uei           TEXT,
  cage          TEXT,
  on_prem_ot    "OnPremOt"  NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- interview_sessions
CREATE TABLE interview_sessions (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id               UUID          NOT NULL REFERENCES parties(id),
  status                 "SessionStatus" NOT NULL,
  facts                  JSONB         NOT NULL,
  timing_segments        JSONB         NOT NULL,
  selected_stacks        TEXT[]        NOT NULL,
  current_question_index INTEGER,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  completed_at           TIMESTAMPTZ
);

-- contracts (14 named fields, excluding id)
CREATE TABLE contracts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id            UUID        NOT NULL REFERENCES parties(id),
  engagement_id       UUID        NOT NULL REFERENCES engagements(id),
  contract_number     TEXT        NOT NULL,
  program_name        TEXT        NOT NULL,
  cage_code           TEXT,
  uei                 TEXT,
  contracting_office  TEXT,
  co_name             TEXT,
  award_date          TIMESTAMPTZ,
  pop_start           TIMESTAMPTZ,
  pop_end             TIMESTAMPTZ,
  cmmc_level_required INTEGER     NOT NULL,
  cui_categories      JSONB       NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- nudge_events
CREATE TABLE nudge_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id      UUID        NOT NULL REFERENCES parties(id),
  engagement_id UUID        NOT NULL REFERENCES engagements(id),
  nudge_type    "NudgeType" NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel       TEXT        NOT NULL,
  payload       JSONB
);

-- dispositions
CREATE TABLE dispositions (
  id             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id       UUID              NOT NULL REFERENCES parties(id),
  engagement_id  UUID              NOT NULL REFERENCES engagements(id),
  state          "DispositionState" NOT NULL,
  set_by_user_id UUID              NOT NULL REFERENCES users(id),
  set_at         TIMESTAMPTZ       NOT NULL DEFAULT now(),
  notes          TEXT
);

-- ============================================================
-- RLS: exempt migration-runner role
-- WARNING: `postgres` bypasses ALL tenant isolation. The application
-- connection (DATABASE_URL) MUST use a NON-superuser role WITHOUT
-- BYPASSRLS. If the app ever connects as `postgres`, RLS silently
-- evaporates and every query sees every tenant's data.
-- ============================================================
ALTER ROLE postgres BYPASSRLS;

-- ============================================================
-- RLS: parties — tenant_id column is direct
-- ============================================================
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON parties
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ============================================================
-- RLS: interview_sessions — isolated via party tenant_id
-- ============================================================
ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON interview_sessions
  USING (
    party_id IN (
      SELECT id FROM parties
      WHERE tenant_id = current_setting('app.tenant_id')::uuid
    )
  );

-- ============================================================
-- RLS: contracts — isolated via party tenant_id
-- ============================================================
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contracts
  USING (
    party_id IN (
      SELECT id FROM parties
      WHERE tenant_id = current_setting('app.tenant_id')::uuid
    )
  );
