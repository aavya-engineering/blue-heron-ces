// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-3 M3 — the AO evidence judges, pinned to the M0-measured row shape.
//
// The fixture below is the REAL row M0 captured on a live A-18 apply
// (`runs/m0-spike/m0-001/ao/evidence-row.json`), trimmed only of the bulky
// `rawResponse`. Three things it pins that the plan text got wrong, each of
// which silently passes a fake run if re-derived from the plan alone:
//   - the fields live at `data.evidence.metadata.*`, not `data.metadata.*`;
//   - `tenant_slug` is NULL, so rows scope by `tenant_id`;
//   - the ledger records reads, so mutation counts must filter `type==='mutate'`.
// No DB, no spawn, no native binding is touched by any test here.
import { describe, it, expect } from 'vitest';
import {
  parseAoEvidenceRow,
  newestAoEvidenceRow,
  diffAoEvidenceRows,
  countLedgerMutations,
  evaluateAoEvidence,
  simTenantId,
  AO_EVIDENCE_COLLECTION,
  type AoEvidenceRawRow,
  type AoEvidenceRow,
} from '../src/demo/ao-evidence.js';
import type { LedgerEntry } from '../src/stacksim-client/types.js';

const LIVE_DATA = {
  evidence: {
    rawResponse: '{"@odata.context":"..."}',
    outcome: 'automated_success',
    outcomeRationale: 'command executed',
    complianceVerdict: 'SAT',
    verdictRationale: 'policy tightened',
    metadata: {
      controlIds: ['AC.L1-3.1.2'],
      timestamp: '2026-08-29T21:19:55.123Z',
      executorIdentity: 'cse-ao-service',
      commandExecuted:
        "Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/authorizationPolicy' -Body @{ defaultUserRolePermissions=@{ allowedToCreateApps=$false } }",
      sha256Hash: '0190614b68378817340dec14fad65f836c4630d410c7a712123f88bf0e6498a5',
      environment: 'GCC-High',
      preStateOutput: '[dry-run] PowerShell commands validated',
      postStateOutput: '[dry-run] PowerShell commands validated',
      stateChanged: true,
    },
  },
  metadata: {
    commandId: 'A-18',
    tenantId: 'sim-tenant-demo-dib-small',
    executionId: 'A-18-1788038395123',
    complianceVerdict: 'SAT',
    sha256Hash: '0190614b68378817340dec14fad65f836c4630d410c7a712123f88bf0e6498a5',
  },
};

function rawRow(over: Partial<AoEvidenceRawRow> = {}, data: unknown = LIVE_DATA): AoEvidenceRawRow {
  return {
    collection: AO_EVIDENCE_COLLECTION,
    id: 'A-18:A-18-1788038395123',
    tenant_id: 'sim-tenant-demo-dib-small',
    tenant_slug: null,
    created_at: '2026-08-29T21:19:55.123Z',
    data: JSON.stringify(data),
    ...over,
  };
}

function ledger(types: ReadonlyArray<LedgerEntry['type']>): LedgerEntry[] {
  return types.map((type, i) => ({
    ts: `2026-08-29T21:0${i}:00.000Z`,
    type,
    objectType: 'authorizationPolicy',
    objectId: `obj-${i}`,
    actor: 'ao',
    source: 'test',
    milestone: 'M3',
    sessionType: 'sim',
    requestId: `req-${i}`,
  }));
}

const okRow = parseAoEvidenceRow(rawRow())!;

describe('parseAoEvidenceRow', () => {
  it('reads correlationId from the contract row (data.metadata), not data.evidence.metadata (FX-AO7)', () => {
    const withCorr = parseAoEvidenceRow(
      rawRow({}, { evidence: { metadata: { correlationId: 'wrong-place' } }, metadata: { correlationId: 'ao-ui-abc' } }),
    )!;
    expect(withCorr.correlationId).toBe('ao-ui-abc');
    const without = parseAoEvidenceRow(rawRow({}, { evidence: { metadata: { correlationId: 'wrong-place' } } }))!;
    expect(without.correlationId).toBeUndefined();
  });

  it('reads predicate-7 fields from data.evidence.metadata (NOT data.metadata)', () => {
    const row = parseAoEvidenceRow(rawRow())!;
    expect(row.metadata.stateChanged).toBe(true);
    expect(row.metadata.commandExecuted).toContain('Invoke-MgGraphRequest');
    expect(row.metadata.sha256Hash).toBe(LIVE_DATA.evidence.metadata.sha256Hash);
    expect(row.outcome).toBe('automated_success');
    expect(row.complianceVerdict).toBe('SAT');
  });

  it('scopes on tenant_id — tenant_slug is NULL on every observed row', () => {
    const row = parseAoEvidenceRow(rawRow())!;
    expect(row.tenantId).toBe(simTenantId('demo-dib-small'));
  });

  it('surfaces pre/post state as the stubs they are (finding #6b) without judging them', () => {
    const row = parseAoEvidenceRow(rawRow())!;
    expect(row.metadata.preStateOutput).toBe('[dry-run] PowerShell commands validated');
    expect(row.metadata.postStateOutput).toBe('[dry-run] PowerShell commands validated');
    // ... and a stub pre-state does not stop a genuine apply from passing:
    expect(
      evaluateAoEvidence({ rowsBefore: [], rowsAfter: [row], ledgerBefore: [], ledgerAfter: ledger(['mutate']) })
        .satisfied,
    ).toBe(true);
  });

  it('returns undefined for an unparseable data column rather than a vacuous pass', () => {
    expect(parseAoEvidenceRow(rawRow({ data: 'not json' }))).toBeUndefined();
    expect(parseAoEvidenceRow(rawRow({ data: '[1,2,3]' }))).toBeUndefined();
  });

  it('tolerates a row with no evidence node (fields simply absent)', () => {
    const row = parseAoEvidenceRow(rawRow({}, { metadata: { commandId: 'A-18' } }))!;
    expect(row.metadata.stateChanged).toBeUndefined();
    expect(row.metadata.commandExecuted).toBeUndefined();
  });
});

describe('newestAoEvidenceRow / diffAoEvidenceRows', () => {
  it('picks the newest by created_at, not by array order or id', () => {
    const older = parseAoEvidenceRow(rawRow({ id: 'A-02:1', created_at: '2026-08-29T20:00:00.000Z' }))!;
    const newer = parseAoEvidenceRow(rawRow({ id: 'A-18:2', created_at: '2026-08-29T21:19:55.123Z' }))!;
    expect(newestAoEvidenceRow([newer, older])?.id).toBe('A-18:2');
    expect(newestAoEvidenceRow([])).toBeUndefined();
  });

  it('diffs by row id — only rows added in AO’s window come back', () => {
    const before = [parseAoEvidenceRow(rawRow({ id: 'A-02:1' }))!];
    const after = [before[0], parseAoEvidenceRow(rawRow({ id: 'A-18:2' }))!];
    expect(diffAoEvidenceRows(before, after).map((r) => r.id)).toEqual(['A-18:2']);
    expect(diffAoEvidenceRows(after, after)).toEqual([]);
  });
});

describe('countLedgerMutations', () => {
  it('counts only type==="mutate" — reads and seed creates are contamination', () => {
    expect(countLedgerMutations(ledger(['create', 'read-serve', 'mutate', 'read-serve']))).toBe(1);
    expect(countLedgerMutations(ledger(['create', 'read-serve']))).toBe(0);
    expect(countLedgerMutations([])).toBe(0);
  });
});

describe('evaluateAoEvidence (amended success predicate 7)', () => {
  const pass = {
    rowsBefore: [] as AoEvidenceRow[],
    rowsAfter: [okRow],
    ledgerBefore: ledger(['create', 'read-serve']),
    ledgerAfter: ledger(['create', 'read-serve', 'mutate']),
  };

  it('passes only when every clause holds together', () => {
    const v = evaluateAoEvidence(pass);
    expect(v.satisfied).toBe(true);
    expect(v.rowCountDelta).toBe(1);
    expect(v.ledgerMutationDelta).toBe(1);
    expect(v.failures).toEqual([]);
  });

  it('fails when no new row landed (finding #6: a swallowed persistence failure)', () => {
    const v = evaluateAoEvidence({ ...pass, rowsBefore: [okRow], rowsAfter: [okRow] });
    expect(v.satisfied).toBe(false);
    expect(v.rowCountDelta).toBe(0);
    expect(v.failures.join(' ')).toMatch(/no new adminops_evidence row/);
  });

  it('fails a dry run: a row lands with stateChanged false and no ledger mutation', () => {
    const dry = parseAoEvidenceRow(
      rawRow({ id: 'A-18:dry' }, { evidence: { ...LIVE_DATA.evidence, metadata: { ...LIVE_DATA.evidence.metadata, stateChanged: false } } }),
    )!;
    const v = evaluateAoEvidence({ rowsBefore: [], rowsAfter: [dry], ledgerBefore: [], ledgerAfter: [] });
    expect(v.satisfied).toBe(false);
    expect(v.stateChanged).toBe(false);
    expect(v.failures.join(' ')).toMatch(/stateChanged=false/);
    expect(v.failures.join(' ')).toMatch(/no mutate entry/);
  });

  it('fails when the ledger gained only reads, even with a perfect row', () => {
    const v = evaluateAoEvidence({ ...pass, ledgerAfter: ledger(['create', 'read-serve', 'read-serve']) });
    expect(v.satisfied).toBe(false);
    expect(v.ledgerMutationDelta).toBe(0);
  });

  it('fails on a row missing commandExecuted or sha256Hash', () => {
    const bare = parseAoEvidenceRow(rawRow({ id: 'A-18:bare' }, { evidence: { metadata: { stateChanged: true } } }))!;
    const v = evaluateAoEvidence({ ...pass, rowsAfter: [bare] });
    expect(v.satisfied).toBe(false);
    expect(v.hasCommandExecuted).toBe(false);
    expect(v.hasSha256Hash).toBe(false);
    expect(v.failures).toHaveLength(2);
  });

  it('judges the row ADDED in the window, not an older pre-existing one', () => {
    const stale = parseAoEvidenceRow(
      rawRow({ id: 'A-02:old', created_at: '2026-08-29T23:59:59.000Z' }, { evidence: { metadata: { stateChanged: false } } }),
    )!;
    // The stale row is newer by clock but was already there before AO ran.
    const v = evaluateAoEvidence({ ...pass, rowsBefore: [stale], rowsAfter: [stale, okRow] });
    expect(v.newest?.id).toBe(okRow.id);
    expect(v.satisfied).toBe(true);
  });
});
