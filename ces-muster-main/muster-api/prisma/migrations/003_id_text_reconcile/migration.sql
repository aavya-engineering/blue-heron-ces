-- Migration: 003_id_text_reconcile
-- Reconciles the UUID-typed id/FK columns from 001/002 with schema.prisma,
-- which declares every id as String (TEXT). This was logged as deviation 4 in
-- IMPLEMENTATION_LOG (P1 scaffold): "will reconcile in a later phase if needed."
-- It is needed now: the SPA generates nanoid ids (21-char url-safe, NOT UUIDs)
-- and syncs them via POST /api/sessions/sync — inserts into UUID columns would
-- fail at the database layer for every offline-created session.
--
-- Server-generated rows keep uuid-shaped ids via (gen_random_uuid())::text
-- defaults; the columns simply stop rejecting client-generated nanoids.
--
-- Order matters: policies and FK constraints depend on the columns, so they
-- are dropped, the types changed, then both recreated. Policies are recreated
-- with plain text comparison (no ::uuid cast).

-- ── 1. Drop RLS policies (column dependencies) ──────────────────────────────
DROP POLICY tenant_isolation ON parties;
DROP POLICY tenant_isolation ON interview_sessions;
DROP POLICY tenant_isolation ON contracts;
DROP POLICY tenant_isolation ON hil_items;
DROP POLICY tenant_isolation ON touch_events;

-- ── 2. Drop FK constraints (default names from 001) ────────────────────────
ALTER TABLE engagements        DROP CONSTRAINT engagements_tenant_id_fkey;
ALTER TABLE users              DROP CONSTRAINT users_tenant_id_fkey;
ALTER TABLE parties            DROP CONSTRAINT parties_tenant_id_fkey;
ALTER TABLE parties            DROP CONSTRAINT parties_engagement_id_fkey;
ALTER TABLE interview_sessions DROP CONSTRAINT interview_sessions_party_id_fkey;
ALTER TABLE contracts          DROP CONSTRAINT contracts_party_id_fkey;
ALTER TABLE contracts          DROP CONSTRAINT contracts_engagement_id_fkey;
ALTER TABLE nudge_events       DROP CONSTRAINT nudge_events_party_id_fkey;
ALTER TABLE nudge_events       DROP CONSTRAINT nudge_events_engagement_id_fkey;
ALTER TABLE dispositions       DROP CONSTRAINT dispositions_party_id_fkey;
ALTER TABLE dispositions       DROP CONSTRAINT dispositions_engagement_id_fkey;
ALTER TABLE dispositions       DROP CONSTRAINT dispositions_set_by_user_id_fkey;

-- ── 3. UUID → TEXT (with text defaults for server-generated rows) ──────────
ALTER TABLE tenants
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text;

ALTER TABLE engagements
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text,
  ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;

ALTER TABLE users
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text,
  ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text,
  ALTER COLUMN party_id TYPE TEXT USING party_id::text;

ALTER TABLE parties
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text,
  ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text,
  ALTER COLUMN engagement_id TYPE TEXT USING engagement_id::text;

ALTER TABLE interview_sessions
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text,
  ALTER COLUMN party_id TYPE TEXT USING party_id::text;

ALTER TABLE contracts
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text,
  ALTER COLUMN party_id TYPE TEXT USING party_id::text,
  ALTER COLUMN engagement_id TYPE TEXT USING engagement_id::text;

ALTER TABLE nudge_events
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text,
  ALTER COLUMN party_id TYPE TEXT USING party_id::text,
  ALTER COLUMN engagement_id TYPE TEXT USING engagement_id::text;

ALTER TABLE dispositions
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text,
  ALTER COLUMN party_id TYPE TEXT USING party_id::text,
  ALTER COLUMN engagement_id TYPE TEXT USING engagement_id::text,
  ALTER COLUMN set_by_user_id TYPE TEXT USING set_by_user_id::text;

ALTER TABLE hil_items
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text,
  ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text,
  ALTER COLUMN party_id TYPE TEXT USING party_id::text,
  ALTER COLUMN session_id TYPE TEXT USING session_id::text,
  ALTER COLUMN resolved_by_user_id TYPE TEXT USING resolved_by_user_id::text;

ALTER TABLE touch_events
  ALTER COLUMN id TYPE TEXT USING id::text,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text,
  ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text,
  ALTER COLUMN engagement_id TYPE TEXT USING engagement_id::text;

-- ── 4. Recreate FK constraints ──────────────────────────────────────────────
ALTER TABLE engagements        ADD CONSTRAINT engagements_tenant_id_fkey        FOREIGN KEY (tenant_id)      REFERENCES tenants(id);
ALTER TABLE users              ADD CONSTRAINT users_tenant_id_fkey              FOREIGN KEY (tenant_id)      REFERENCES tenants(id);
ALTER TABLE parties            ADD CONSTRAINT parties_tenant_id_fkey            FOREIGN KEY (tenant_id)      REFERENCES tenants(id);
ALTER TABLE parties            ADD CONSTRAINT parties_engagement_id_fkey        FOREIGN KEY (engagement_id)  REFERENCES engagements(id);
ALTER TABLE interview_sessions ADD CONSTRAINT interview_sessions_party_id_fkey  FOREIGN KEY (party_id)       REFERENCES parties(id);
ALTER TABLE contracts          ADD CONSTRAINT contracts_party_id_fkey           FOREIGN KEY (party_id)       REFERENCES parties(id);
ALTER TABLE contracts          ADD CONSTRAINT contracts_engagement_id_fkey      FOREIGN KEY (engagement_id)  REFERENCES engagements(id);
ALTER TABLE nudge_events       ADD CONSTRAINT nudge_events_party_id_fkey        FOREIGN KEY (party_id)       REFERENCES parties(id);
ALTER TABLE nudge_events       ADD CONSTRAINT nudge_events_engagement_id_fkey   FOREIGN KEY (engagement_id)  REFERENCES engagements(id);
ALTER TABLE dispositions       ADD CONSTRAINT dispositions_party_id_fkey        FOREIGN KEY (party_id)       REFERENCES parties(id);
ALTER TABLE dispositions       ADD CONSTRAINT dispositions_engagement_id_fkey   FOREIGN KEY (engagement_id)  REFERENCES engagements(id);
ALTER TABLE dispositions       ADD CONSTRAINT dispositions_set_by_user_id_fkey  FOREIGN KEY (set_by_user_id) REFERENCES users(id);

-- ── 5. Recreate RLS policies (text comparison — no ::uuid cast) ────────────
CREATE POLICY tenant_isolation ON parties
  USING (tenant_id = current_setting('app.tenant_id'));

CREATE POLICY tenant_isolation ON interview_sessions
  USING (
    party_id IN (
      SELECT id FROM parties
      WHERE tenant_id = current_setting('app.tenant_id')
    )
  );

CREATE POLICY tenant_isolation ON contracts
  USING (
    party_id IN (
      SELECT id FROM parties
      WHERE tenant_id = current_setting('app.tenant_id')
    )
  );

CREATE POLICY tenant_isolation ON hil_items
  USING (tenant_id = current_setting('app.tenant_id'));

CREATE POLICY tenant_isolation ON touch_events
  USING (tenant_id = current_setting('app.tenant_id'));
