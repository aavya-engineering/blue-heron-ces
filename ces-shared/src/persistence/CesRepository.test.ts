// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G2 — unified persistence interface + Cust/SI scope enforcement (no cross-tenant leakage).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CesRepository, CesScopeError, CesWormError } from './CesRepository.js';

let repo: CesRepository;
let t = 0;
beforeEach(() => {
  t = 0;
  repo = new CesRepository(':memory:', { now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}.000Z` });
});
afterEach(() => repo.close());

// G-ENG-6: evidence collections are append-only (WORM). Integrity is the product.
describe('WORM (append-only) enforcement', () => {
  const scope = { tenantId: 't1' };
  const rec = { id: 'ev-1', ces: { tenantId: 't1' }, data: { hash: 'abc', verdict: 'SAT' } };

  it('allows the first write of an evidence record (write-once)', () => {
    expect(() => repo.put('adminops_evidence', rec)).not.toThrow();
    expect(repo.findById('adminops_evidence', 'ev-1')?.data).toEqual({ hash: 'abc', verdict: 'SAT' });
  });

  it('refuses to overwrite an existing evidence record via put', () => {
    repo.put('adminops_evidence', rec);
    expect(() => repo.put('adminops_evidence', { ...rec, data: { hash: 'TAMPERED' } })).toThrow(CesWormError);
    // original is intact
    expect(repo.findById('adminops_evidence', 'ev-1')?.data).toEqual({ hash: 'abc', verdict: 'SAT' });
  });

  it('refuses update() and delete() on an evidence record', () => {
    repo.put('adminops_evidence', rec);
    expect(() => repo.update('adminops_evidence', 'ev-1', scope, { verdict: 'NOT_SAT' })).toThrow(CesWormError);
    expect(() => repo.delete('adminops_evidence', 'ev-1', scope)).toThrow(CesWormError);
  });

  it('leaves non-WORM collections fully mutable', () => {
    repo.put('adminops_approvals', { id: 'ap-1', ces: { tenantId: 't1' }, data: { status: 'pending' } });
    expect(() => repo.update('adminops_approvals', 'ap-1', scope, { status: 'approved' })).not.toThrow();
    expect(() => repo.delete('adminops_approvals', 'ap-1', scope)).not.toThrow();
  });

  it('honors a custom wormCollections option', () => {
    const r2 = new CesRepository(':memory:', { wormCollections: ['my_ledger'] });
    r2.put('my_ledger', { id: 'x', ces: { tenantId: 't1' }, data: { n: 1 } });
    expect(() => r2.put('my_ledger', { id: 'x', ces: { tenantId: 't1' }, data: { n: 2 } })).toThrow(CesWormError);
    expect(() => r2.put('adminops_evidence', rec)).not.toThrow(); // default set replaced, not merged
    r2.close();
  });

  // FC-SH step 5 (REQ-ces-shared-worm-approver-token-mints, ces-eo FC-EO-C step AO-16): EO's
  // approver-token mint log is evidence (who minted, for whom, tenant, expiry) and must be as
  // append-only as adminops_evidence, without every caller needing to opt in via wormCollections.
  it('eo_approver_token_mints is append-only by default (put-over, update, delete all throw)', () => {
    const mintRec = { id: 'mint-1', ces: { tenantId: 't1' }, data: { mintedFor: 'approver@example.test', tenantId: 't1' } };
    expect(() => repo.put('eo_approver_token_mints', mintRec)).not.toThrow();
    expect(() => repo.put('eo_approver_token_mints', { ...mintRec, data: { ...mintRec.data, tampered: true } })).toThrow(CesWormError);
    expect(() => repo.update('eo_approver_token_mints', 'mint-1', scope, { tampered: true })).toThrow(CesWormError);
    expect(() => repo.delete('eo_approver_token_mints', 'mint-1', scope)).toThrow(CesWormError);
    expect(repo.findById('eo_approver_token_mints', 'mint-1')?.data).toEqual(mintRec.data);
  });
});

const tupleA = { customerId: 1, siBaselineId: 10 };
const tupleB = { customerId: 2, siBaselineId: 20 };

describe('CRUD', () => {
  it('put then get returns the record within its scope', () => {
    repo.put('postures', { id: 'p1', ces: { customerId: 1, siBaselineId: 10, cesId: 'ces-x' }, data: { score: 42 } });
    const got = repo.get<{ score: number }>('postures', 'p1', tupleA);
    expect(got?.data.score).toBe(42);
    expect(got?.cesId).toBe('ces-x');
    expect(got?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('list returns only the scope’s records, ordered by created_at', () => {
    repo.put('postures', { id: 'p1', ces: tupleA, data: { n: 1 } });
    repo.put('postures', { id: 'p2', ces: tupleA, data: { n: 2 } });
    repo.put('postures', { id: 'p3', ces: tupleB, data: { n: 3 } });
    expect(repo.list('postures', tupleA).map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(repo.list('postures', tupleB).map((r) => r.id)).toEqual(['p3']);
  });

  it('update merges data and preserves created_at, bumps updated_at', () => {
    repo.put('postures', { id: 'p1', ces: tupleA, data: { a: 1, b: 2 } });
    const updated = repo.update<{ a: number; b: number; c?: number }>('postures', 'p1', tupleA, { b: 9, c: 3 });
    expect(updated?.data).toEqual({ a: 1, b: 9, c: 3 });
    expect(updated?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(updated?.updatedAt).not.toBe(updated?.createdAt);
  });

  it('put on an existing id upserts and preserves created_at', () => {
    repo.put('postures', { id: 'p1', ces: tupleA, data: { v: 1 } });
    const again = repo.put('postures', { id: 'p1', ces: tupleA, data: { v: 2 } });
    expect(again.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(repo.get('postures', 'p1', tupleA)?.data).toEqual({ v: 2 });
  });

  it('delete removes only within scope', () => {
    repo.put('postures', { id: 'p1', ces: tupleA, data: {} });
    expect(repo.delete('postures', 'p1', tupleB)).toBe(false); // wrong scope: no-op
    expect(repo.get('postures', 'p1', tupleA)).toBeDefined();
    expect(repo.delete('postures', 'p1', tupleA)).toBe(true);
    expect(repo.get('postures', 'p1', tupleA)).toBeUndefined();
  });
});

describe('scope enforcement — no cross-tenant leakage', () => {
  beforeEach(() => {
    repo.put('postures', { id: 'pA', ces: tupleA, data: { owner: 'A' } });
    repo.put('postures', { id: 'pB', ces: tupleB, data: { owner: 'B' } });
  });

  it('get with the wrong tuple returns undefined (not-found, no disclosure)', () => {
    expect(repo.get('postures', 'pB', tupleA)).toBeUndefined();
    expect(repo.get('postures', 'pA', tupleB)).toBeUndefined();
    expect(repo.get('postures', 'pA', { customerId: 1, siBaselineId: 999 })).toBeUndefined(); // right cust, wrong baseline
  });

  it('list never returns another tuple’s rows', () => {
    expect(repo.list('postures', tupleA).map((r) => r.id)).toEqual(['pA']);
    expect(repo.list('postures', tupleB).map((r) => r.id)).toEqual(['pB']);
  });

  it('update/delete on another tuple’s record are no-ops', () => {
    expect(repo.update('postures', 'pB', tupleA, { x: 1 })).toBeUndefined();
    expect(repo.delete('postures', 'pB', tupleA)).toBe(false);
    expect(repo.get('postures', 'pB', tupleB)?.data).toEqual({ owner: 'B' }); // untouched
  });

  it('rejects an empty scope (makes unscoped reads impossible)', () => {
    expect(() => repo.get('postures', 'pA', {})).toThrow(CesScopeError);
    expect(() => repo.list('postures', {})).toThrow(CesScopeError);
  });
});

describe('unscoped capability lookups (findById / listAll) for control collections', () => {
  it('findById returns by primary key regardless of scope; listAll returns all', () => {
    repo.put('approvals', { id: 'uuid-1', ces: { tenantId: 'guid-1' }, data: { status: 'pending' } });
    repo.put('approvals', { id: 'uuid-2', ces: { tenantId: 'guid-2' }, data: { status: 'approved' } });
    expect(repo.findById('approvals', 'uuid-1')?.data).toEqual({ status: 'pending' });
    expect(repo.findById('approvals', 'nope')).toBeUndefined();
    expect(repo.listAll('approvals').map((r) => r.id).sort()).toEqual(['uuid-1', 'uuid-2']);
  });
});

describe('tenant-slug scoping (Node subsystems keyed by tenant, not customer)', () => {
  it('isolates rows by tenantSlug', () => {
    repo.put('evidence', { id: 'e1', ces: { tenantSlug: 'acme', cesId: 'c' }, data: { k: 1 } });
    repo.put('evidence', { id: 'e2', ces: { tenantSlug: 'globex' }, data: { k: 2 } });
    expect(repo.list('evidence', { tenantSlug: 'acme' }).map((r) => r.id)).toEqual(['e1']);
    expect(repo.get('evidence', 'e1', { tenantSlug: 'globex' })).toBeUndefined();
    expect(repo.get('evidence', 'e1', { tenantSlug: 'acme' })?.data).toEqual({ k: 1 });
  });

  it('isolates rows by tenantId (Stamper/EO/AO carry the Azure tenant GUID)', () => {
    repo.put('state', { id: 's1', ces: { tenantId: 'guid-1' }, data: { k: 1 } });
    repo.put('state', { id: 's2', ces: { tenantId: 'guid-2' }, data: { k: 2 } });
    expect(repo.get('state', 's1', { tenantId: 'guid-1' })?.data).toEqual({ k: 1 });
    expect(repo.get('state', 's1', { tenantId: 'guid-2' })).toBeUndefined();
    expect(repo.list('state', { tenantId: 'guid-2' }).map((r) => r.id)).toEqual(['s2']);
  });
});
