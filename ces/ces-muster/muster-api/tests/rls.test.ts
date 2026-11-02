// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// rls.test.ts — FIN-25 (DB-3): the REQUIRED TENANT SCOPE that replaced Postgres
// row-level security (RLS). The file keeps its name so `npm run test:live`
// still points at the isolation suite, but it now runs against the real ces.db
// store (lib/musterStore.ts over ces-shared CesRepository), with no database
// server and nothing skipped:
//   (a) every one of the 13 engagement models (plus the FD-6 outbox) is
//       invisible, un-updatable and un-deletable from another tenant;
//   (b) the root store refuses tenant data — only the documented pre-tenant
//       lookups (tenant list, user by email, grant by token hash) exist;
//   (c) an id is unique across tenants, so a tenant cannot overwrite another
//       tenant's row by reusing its id, and a row cannot be written for a
//       tenant other than the scope's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MusterStore, ENGAGEMENT_MODELS, MODELS, type ModelName } from '../src/lib/musterStore.js';
import { withTenant } from '../src/lib/db.js';

const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

/** Minimal valid row per model (ids fixed so cross-tenant probes are exact). */
function fixture(model: ModelName, tag: string): Record<string, unknown> {
  const id = `${model}-${tag}`;
  switch (model) {
    case 'tenant':
      return { id: tag === 'A' ? TENANT_A : TENANT_B, name: `Tenant ${tag}` };
    case 'user':
      return { id, email: `user-${tag.toLowerCase()}@example.test`, password_hash: 'x', role: 'prime' };
    case 'engagement':
      return { id, engagement_kind: 'prime_and_subs' };
    case 'party':
      return { id, engagement_id: `engagement-${tag}`, name: `Party ${tag}`, on_prem_ot: 'no' };
    case 'interviewSession':
      return { id, party_id: `party-${tag}`, status: 'in_progress', facts: [], timing_segments: [], selected_stacks: [] };
    case 'contract':
      return { id, party_id: `party-${tag}`, engagement_id: `engagement-${tag}`, contract_number: 'C-1', program_name: 'P', cmmc_level_required: 2, cui_categories: [] };
    case 'nudgeEvent':
      return { id, party_id: `party-${tag}`, engagement_id: `engagement-${tag}`, nudge_type: 't3', channel: 'email' };
    case 'disposition':
      return { id, party_id: `party-${tag}`, engagement_id: `engagement-${tag}`, state: 'ready', set_by_user_id: `user-${tag}` };
    case 'hilItem':
      return { id, party_id: `party-${tag}`, question_id: 'Q1', reason: 'low_confidence', fact: {} };
    case 'touchEvent':
      return { id, engagement_id: `engagement-${tag}`, mode: 'a', kind: 'k' };
    case 'deliveryArtifact':
      return { id, engagement_id: `engagement-${tag}`, kind: 'capture', filename: 'f.json', content: Buffer.from(`bytes-${tag}`), content_sha256: 'h' };
    case 'deliveryGrant':
      return { id, engagement_id: `engagement-${tag}`, grantee_name: 'G', grantee_email: `g-${tag.toLowerCase()}@example.test`, issued_by: 'op', token_hash: `hash-${tag}`, expires_at: new Date('2027-01-01T00:00:00Z') };
    case 'deliveryAuditEntry':
      return { id, engagement_id: `engagement-${tag}`, actor: 'op', action: 'pull', outcome: 'ok' };
    case 'mailOutbox':
      return { id, engagement_id: `engagement-${tag}`, party_id: `party-${tag}`, kind: 'nudge_t3', to: [], subject: 's', body: 'b', sha256: 'h' };
  }
}

let store: MusterStore;

beforeEach(async () => {
  store = new MusterStore(':memory:');
  for (const model of Object.keys(MODELS) as ModelName[]) {
    for (const [tenant, tag] of [[TENANT_A, 'A'], [TENANT_B, 'B']] as const) {
      await store.forTenant(tenant)[model].create({ data: fixture(model, tag) });
    }
  }
});

afterEach(() => store.close());

describe('rls.test — (a) the tenant scope isolates every engagement model', () => {
  it('there are 13 engagement models', () => {
    expect(ENGAGEMENT_MODELS).toHaveLength(13);
  });

  for (const model of Object.keys(MODELS) as ModelName[]) {
    it(`${model}: tenant A sees only its own row; B's row is not found, not updatable, not deletable`, async () => {
      const a = store.forTenant(TENANT_A)[model];
      const own = fixture(model, 'A');
      const other = fixture(model, 'B');

      const rows = await a.findMany();
      expect(rows.map((r) => r.id)).toEqual([own.id]);
      expect(await a.findUnique({ where: { id: other.id } })).toBeNull();
      // A where clause naming the other tenant still yields nothing.
      expect(await a.findMany({ where: { tenant_id: TENANT_B } })).toEqual([]);

      const worm = model === 'deliveryAuditEntry' || model === 'mailOutbox';
      await expect(a.update({ where: { id: other.id }, data: { x: 1 } })).rejects.toThrow(/not found/);
      await expect(a.delete({ where: { id: other.id } })).rejects.toThrow(/not found/);
      // B's row is intact.
      const b = await store.forTenant(TENANT_B)[model].findUnique({ where: { id: other.id } });
      expect(b).not.toBeNull();
      if (worm) {
        // Append-only: even the owning tenant cannot change or remove the record.
        await expect(store.forTenant(TENANT_B)[model].update({ where: { id: other.id }, data: { x: 1 } })).rejects.toThrow(/append-only/);
        await expect(store.forTenant(TENANT_B)[model].delete({ where: { id: other.id } })).rejects.toThrow(/append-only/);
      }
    });
  }

  it('withTenant hands the route its tenant view of the store', async () => {
    const rows = await withTenant(TENANT_B, (tx) => tx.party.findMany(), store);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['party-B']);
  });

  it('withTenant refuses an empty tenant id', async () => {
    await expect(withTenant('', (tx) => tx.party.findMany(), store)).rejects.toThrow(/tenant id is required/);
  });
});

describe('rls.test — (b) the root store refuses tenant data', () => {
  for (const model of ENGAGEMENT_MODELS.filter((m) => !['tenant', 'user', 'deliveryGrant'].includes(m))) {
    it(`root ${model} access is refused`, () => {
      expect(() => (store as unknown as Record<string, { findMany: () => unknown }>)[model].findMany()).toThrow(/needs a tenant scope/);
    });
  }

  it('root user lookup works by email only (login), and lands in the right tenant', async () => {
    const u = await store.user.findUnique({ where: { email: 'user-b@example.test' } });
    expect(u?.tenant_id).toBe(TENANT_B);
    await expect(store.user.findUnique({ where: { id: 'user-B' } })).rejects.toThrow(/needs a tenant scope/);
  });

  it('root grant lookup works by token hash only (portal capability)', async () => {
    const g = await store.deliveryGrant.findUnique({ where: { token_hash: 'hash-A' } });
    expect(g?.tenant_id).toBe(TENANT_A);
    expect(g?.expires_at).toBeInstanceOf(Date);
    await expect(store.deliveryGrant.findUnique({ where: { id: 'deliveryGrant-A' } })).rejects.toThrow(/needs a tenant scope/);
  });

  it('the scripts/seed.ts call shapes work on the root store (operator bootstrap, no Postgres)', async () => {
    const tenant =
      (await store.tenant.findFirst({ where: { name: 'Seed Tenant' } })) ??
      (await store.tenant.create({ data: { name: 'Seed Tenant' } }));
    expect(await store.tenant.findFirst({ where: { name: 'Seed Tenant' } })).toMatchObject({ id: tenant.id });
    const email = 'seed-op@example.test';
    expect(await store.user.findUnique({ where: { email } })).toBeNull();
    await store.user.create({ data: { tenant_id: tenant.id, email, password_hash: 'h1', role: 'bhd_operator' } });
    const updated = await store.user.update({ where: { email }, data: { password_hash: 'h2', role: 'prime' } });
    expect(updated).toMatchObject({ email, password_hash: 'h2', role: 'prime', tenant_id: tenant.id });
  });

  it('root tenant list names both tenants (the scheduler reads it)', () => {
    expect(store.tenantIds().sort()).toEqual([TENANT_A, TENANT_B]);
  });
});

describe('rls.test — (c) ids and tenant fields cannot cross tenants', () => {
  it("tenant A cannot create a row with tenant B's id", async () => {
    await expect(store.forTenant(TENANT_A).party.create({ data: { ...fixture('party', 'B') } })).rejects.toThrow(/unique constraint/);
    const b = await store.forTenant(TENANT_B).party.findUnique({ where: { id: 'party-B' } });
    expect(b?.name).toBe('Party B');
  });

  it("a row naming another tenant's tenant_id is refused", async () => {
    await expect(
      store.forTenant(TENANT_A).party.create({ data: { ...fixture('party', 'X'), id: 'party-X', tenant_id: TENANT_B } })
    ).rejects.toThrow(/cannot be written in tenant/);
  });

  it('email is unique across tenants', async () => {
    await expect(
      store.forTenant(TENANT_A).user.create({ data: { ...fixture('user', 'B'), id: 'user-dup' } })
    ).rejects.toThrow(/unique constraint failed on muster_users.email/);
  });

  it('bytes and dates survive the round trip', async () => {
    const art = await store.forTenant(TENANT_A).deliveryArtifact.findUnique({ where: { id: 'deliveryArtifact-A' } });
    expect(Buffer.isBuffer(art?.content)).toBe(true);
    expect((art?.content as Buffer).toString()).toBe('bytes-A');
    expect(art?.delivered_at).toBeInstanceOf(Date);
    expect(art?.purged_at).toBeNull();
  });
});
