// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// engagement.migrate.test.ts — FIN-25: the one-time Postgres → ces.db move
// (src/cli/engagementMigrate.ts). The import half runs on a fixture shaped
// exactly like `psql -At -c "SELECT json_agg(t) FROM <table> t"` output
// (timestamp(3) without zone, bytea as "\\x<hex>", jsonb inline). The export
// half needs a live Postgres and is not run here; its URL → libpq env split is.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importExport, normalizeValue, pgEnv, TABLES, main } from '../src/cli/engagementMigrate.js';
import { MusterStore } from '../src/lib/musterStore.js';

const T = 'aaaaaaaa-1111-4000-8000-000000000001';
const DIR = mkdtempSync(join(process.env.CES_PIPELINE_ROOT ?? tmpdir(), 'fin25-migrate-'));

const EXPORT: Record<string, unknown[]> = {
  tenants: [{ id: T, name: 'Fictional Prime LLC', created_at: '2026-09-01 10:00:00.123' }],
  users: [{ id: 'u1', tenant_id: T, party_id: null, email: 'op@example.test', password_hash: '$2a$04$x', role: 'bhd_operator', created_at: '2026-09-01 10:00:00' }],
  engagements: [{ id: 'e1', tenant_id: T, engagement_kind: 'prime_and_subs', created_at: '2026-09-01 10:00:00', live_access_enabled: false, live_access_set_by: null, live_access_set_at: null, live_consent: null, live_area_consents: null }],
  parties: [{ id: 'p1', tenant_id: T, engagement_id: 'e1', name: 'Fictional Sub', uei: null, cage: null, on_prem_ot: 'no', lifecycle: 'in_progress', last_activity_at: '2026-09-02 08:00:00', created_at: '2026-09-01 10:00:00' }],
  interview_sessions: [
    { id: 's1', party_id: 'p1', status: 'complete', facts: [{ q: 'Q1', a: 'yes' }], timing_segments: [], selected_stacks: ['m365'], current_question_index: null, created_at: '2026-09-01 10:00:00', completed_at: '2026-09-03 09:00:00' },
    { id: 's-orphan', party_id: 'no-such-party', status: 'in_progress', facts: [], timing_segments: [], selected_stacks: [], current_question_index: 0, created_at: '2026-09-01 10:00:00', completed_at: null },
  ],
  contracts: [{ id: 'c1', party_id: 'p1', engagement_id: 'e1', contract_number: 'FICT-1', program_name: 'P', cage_code: null, uei: null, contracting_office: null, co_name: null, award_date: '2026-01-15 00:00:00', pop_start: null, pop_end: null, cmmc_level_required: 2, cui_categories: ['CTI'], created_at: '2026-09-01 10:00:00' }],
  nudge_events: [{ id: 'n1', party_id: 'p1', engagement_id: 'e1', nudge_type: 't3', sent_at: '2026-09-05 00:00:00', channel: 'email', payload: { idle_days: 3 } }],
  dispositions: [{ id: 'd1', party_id: 'p1', engagement_id: 'e1', state: 'ready', set_by_user_id: 'u1', set_at: '2026-09-06 00:00:00', notes: null }],
  hil_items: [{ id: 'h1', tenant_id: T, party_id: 'p1', session_id: 's1', question_id: 'Q1', reason: 'low_confidence', fact: { answer: 'yes' }, created_at: '2026-09-03 09:00:00', resolved_at: null, resolved_by_user_id: null, advisor_minutes: null }],
  touch_events: [{ id: 't1', tenant_id: T, engagement_id: 'e1', mode: 'a', kind: 'call', minutes: 15, created_at: '2026-09-03 09:00:00' }],
  delivery_artifacts: [{ id: 'a1', tenant_id: T, engagement_id: 'e1', kind: 'capture', filename: 'x.json', content: '\\x68656c6c6f', content_sha256: 'h', delivered_at: '2026-09-07 00:00:00', purged_at: null, purge_reason: null }],
  delivery_grants: [{ id: 'g1', tenant_id: T, engagement_id: 'e1', grantee_name: 'G', grantee_email: 'g@example.test', issued_by: 'u1', token_hash: 'th1', expires_at: '2026-09-14 00:00:00', revoked_at: null, created_at: '2026-09-07 00:00:00' }],
  delivery_audit_entries: [{ id: 'au1', tenant_id: T, engagement_id: 'e1', artifact_id: 'a1', grant_id: 'g1', actor: 'u1', action: 'grant_issued', outcome: 'ok', detail: null, created_at: '2026-09-07 00:00:00' }],
};

beforeAll(() => {
  for (const [table, rows] of Object.entries(EXPORT)) writeFileSync(join(DIR, `${table}.json`), JSON.stringify(rows));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('FIN-25 — one-time Postgres export → ces.db import', () => {
  it('covers all 13 tables', () => {
    expect(TABLES).toHaveLength(13);
    expect(new Set(TABLES.map((t) => t.table))).toEqual(new Set(Object.keys(EXPORT)));
  });

  it('imports every row into its tenant scope, reports orphans, and is idempotent', async () => {
    const store = new MusterStore(':memory:');
    try {
      const dry = await importExport(store, DIR, { dryRun: true });
      expect(dry.parties.written).toBe(1);
      expect(await store.forTenant(T).party.findMany()).toEqual([]);

      const report = await importExport(store, DIR);
      for (const [table, rows] of Object.entries(EXPORT)) {
        const r = report[table];
        expect(r.read).toBe(rows.length);
        expect(r.written + r.orphaned).toBe(rows.length);
      }
      expect(report.interview_sessions.orphaned).toBe(1);

      const tx = store.forTenant(T);
      const party = await tx.party.findUnique({ where: { id: 'p1' } });
      expect(party?.last_activity_at).toEqual(new Date('2026-09-02T08:00:00Z'));
      const art = await tx.deliveryArtifact.findUnique({ where: { id: 'a1' } });
      expect((art?.content as Buffer).toString()).toBe('hello');
      expect((await tx.interviewSession.findUnique({ where: { id: 's1' } }))?.facts).toEqual([{ q: 'Q1', a: 'yes' }]);
      // Login and the portal work on the imported rows.
      expect((await store.user.findUnique({ where: { email: 'op@example.test' } }))?.id).toBe('u1');
      expect((await store.deliveryGrant.findUnique({ where: { token_hash: 'th1' } }))?.id).toBe('g1');
      expect(store.tenantIds()).toEqual([T]);

      const again = await importExport(store, DIR);
      expect(Object.values(again).reduce((n, r) => n + r.written, 0)).toBe(0);
      expect(again.parties.skipped).toBe(1);
    } finally {
      store.close();
    }
  });

  it('normalizes Postgres JSON values', () => {
    expect(normalizeValue('created_at', '2026-09-01 10:00:00.5')).toEqual(new Date('2026-09-01T10:00:00.500Z'));
    expect(normalizeValue('content', '\\x00ff')).toEqual(Buffer.from([0, 255]));
    expect(normalizeValue('name', 'plain text')).toBe('plain text');
  });

  it('the export keeps the password off argv (libpq env)', () => {
    const env = pgEnv('postgresql://app:s%40cret@db.example.test:5433/muster?sslmode=require');
    expect(env).toEqual({ PGHOST: 'db.example.test', PGPORT: '5433', PGUSER: 'app', PGPASSWORD: 's@cret', PGDATABASE: 'muster', PGSSLMODE: 'require' });
    expect(() => pgEnv('mysql://x')).toThrow(/postgres/);
  });

  it('the CLI refuses a missing argument', async () => {
    expect(await main(['import'])).toBe(2);
    expect(await main(['export'])).toBe(2);
    expect(await main([])).toBe(2);
  });
});
