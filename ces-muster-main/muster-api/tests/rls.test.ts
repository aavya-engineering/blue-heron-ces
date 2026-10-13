// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = join(__dirname, '..', 'prisma', 'migrations');

function readMigration(subdir: string): string {
  try {
    return readFileSync(join(MIGRATION_DIR, subdir, 'migration.sql'), 'utf-8');
  } catch {
    return '';
  }
}

// ─── (a) Static — assert migration SQL contains required RLS statements ──────
//
// RLS tenant isolation convention (documented here for live test below):
//   Before each tenant-scoped query, the request pipeline calls:
//     SELECT set_config('app.tenant_id', tenantId, true)
//   via lib/prisma.ts withTenant(). The 'true' flag makes it transaction-scoped
//   (equivalent to SET LOCAL). Policies use:
//     current_setting('app.tenant_id')::uuid
//   to resolve the current tenant. All tenant-isolated tables MUST have both
//   ENABLE and FORCE ROW LEVEL SECURITY so even the table owner cannot bypass.

describe('rls.test — static migration SQL assertions', () => {
  const sql001 = readMigration('001_init');
  const sql002 = readMigration('002_p1_domain');
  const combined = sql001 + '\n' + sql002;

  it('001: parties has ENABLE ROW LEVEL SECURITY', () => {
    expect(combined).toMatch(/ALTER TABLE parties\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it('001: parties has FORCE ROW LEVEL SECURITY', () => {
    expect(combined).toMatch(/ALTER TABLE parties\s+FORCE ROW LEVEL SECURITY/i);
  });

  it('001: parties has CREATE POLICY', () => {
    expect(combined).toMatch(/CREATE POLICY tenant_isolation ON parties/i);
  });

  it('001: interview_sessions has ENABLE ROW LEVEL SECURITY', () => {
    expect(combined).toMatch(/ALTER TABLE interview_sessions\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it('001: interview_sessions has FORCE ROW LEVEL SECURITY', () => {
    expect(combined).toMatch(/ALTER TABLE interview_sessions\s+FORCE ROW LEVEL SECURITY/i);
  });

  it('001: interview_sessions has CREATE POLICY', () => {
    expect(combined).toMatch(/CREATE POLICY tenant_isolation ON interview_sessions/i);
  });

  it('001: contracts has ENABLE ROW LEVEL SECURITY', () => {
    expect(combined).toMatch(/ALTER TABLE contracts\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it('001: contracts has FORCE ROW LEVEL SECURITY', () => {
    expect(combined).toMatch(/ALTER TABLE contracts\s+FORCE ROW LEVEL SECURITY/i);
  });

  it('001: contracts has CREATE POLICY', () => {
    expect(combined).toMatch(/CREATE POLICY tenant_isolation ON contracts/i);
  });

  it('002: hil_items has ENABLE ROW LEVEL SECURITY', () => {
    expect(sql002).toMatch(/ALTER TABLE hil_items\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it('002: hil_items has FORCE ROW LEVEL SECURITY', () => {
    expect(sql002).toMatch(/ALTER TABLE hil_items\s+FORCE ROW LEVEL SECURITY/i);
  });

  it('002: hil_items has CREATE POLICY', () => {
    expect(sql002).toMatch(/CREATE POLICY tenant_isolation ON hil_items/i);
  });

  it('002: touch_events has ENABLE ROW LEVEL SECURITY', () => {
    expect(sql002).toMatch(/ALTER TABLE touch_events\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it('002: touch_events has FORCE ROW LEVEL SECURITY', () => {
    expect(sql002).toMatch(/ALTER TABLE touch_events\s+FORCE ROW LEVEL SECURITY/i);
  });

  it('002: touch_events has CREATE POLICY', () => {
    expect(sql002).toMatch(/CREATE POLICY tenant_isolation ON touch_events/i);
  });

  it('all tenant policies use current_setting(app.tenant_id) convention', () => {
    // Verifies both migrations use the same SET LOCAL convention
    expect(combined).toMatch(/current_setting\('app\.tenant_id'\)/);
    expect(sql002).toMatch(/current_setting\('app\.tenant_id'\)/);
  });
});

// ─── (b) Live — skipped unless DATABASE_URL is configured ───────────────────
// When a real Postgres is available, proves that a tenant-scoped connection
// cannot read another tenant's parties row.
// How it works: withTenant() in lib/prisma.ts wraps the fn in a transaction and
// calls set_config('app.tenant_id', tenantId, true) — the 'true' flag scopes it
// to the transaction (same as SET LOCAL). RLS policies on parties then filter
// rows by tenant_id = current_setting('app.tenant_id', true) (missing_ok).
describe.skipIf(!process.env.DATABASE_URL)(
  'rls.test — live cross-tenant isolation (requires DATABASE_URL)',
  () => {
    it('tenant-A context cannot read tenant-B parties', async () => {
      const { withTenant } = await import('../src/lib/prisma.js');

      const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
      const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

      // With tenant-A context, querying for tenant-B rows should return empty
      // because RLS filters party.tenant_id = current_setting('app.tenant_id', true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenant(TENANT_A, (tx: any) =>
        tx.party.findMany({ where: { tenant_id: TENANT_B } })
      );
      expect(rows).toHaveLength(0);
    });

    it('unscoped plain-db query returns [] and does not throw (004 missing_ok)', async () => {
      // Proves migration 004: current_setting('app.tenant_id', true) returns NULL
      // when the GUC is unset. NULL = tenant_id evaluates to NULL (not TRUE) so
      // all rows are filtered out — fail-closed, no Postgres 42704 error.
      const { db } = await import('../src/lib/prisma.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (db as any).party.findMany();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });

    it('withTenant(tenant-B) sees tenant-B parties (positive visibility)', async () => {
      // Proves that a properly scoped connection can read its own tenant's rows.
      // Seed has one tenant-B party (bbbbbbbb-...0002).
      const { withTenant } = await import('../src/lib/prisma.js');
      const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await withTenant(TENANT_B, (tx: any) =>
        tx.party.findMany()
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  }
);
