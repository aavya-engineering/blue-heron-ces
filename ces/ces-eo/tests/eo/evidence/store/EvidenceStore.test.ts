// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.1 / W1.3: the append-only evidence store. Append; a rewrite (payload, record,
 * log) is refused; the hash chain recomputes and a tamper breaks it; the manifest's head is the last
 * record; tenant isolation; retention metadata; the read API. Temp dirs only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSha256 } from 'ces-shared/crypto';
import {
  EvidenceStore, EvidenceStoreIntegrityError, GENESIS_SHA256, computeRecordSha256, evidenceStoreRootOf,
} from '../../../../src/eo/evidence/store/EvidenceStore';
import { RETENTION_POLICY_ID } from '../../../../src/eo/evidence/store/RetentionPolicy';
import type { AppendInput } from '../../../../src/eo/evidence/store/types';

const A = '00000000-0000-4000-8000-0000000001aa';
const B = '00000000-0000-4000-8000-0000000001bb';
const collector = { name: 'ces-eo/ComplianceSignalFetcher', version: '9.9.9', identity: 'ces-eo/9.9.9@11111111-2222-4333-8444-555555555555' };

function input(tenantId: string, over: Partial<AppendInput> = {}): AppendInput {
  return {
    tenantId,
    tenantSlug: tenantId === A ? 'store-a' : 'store-b',
    sourceId: 'directoryAudits',
    collector,
    host: 'graph.microsoft.us',
    endpoint: '/auditLogs/directoryAudits',
    query: 'GET /v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20ge%202026-09-27T00:00:00.000Z',
    window: { start: '2026-09-27T00:00:00.000Z', end: '2026-10-27T00:00:00.000Z' },
    collectedAt: '2026-10-27T00:00:00.000Z',
    status: 'success',
    itemCount: 2,
    payload: { value: [{ id: 'a1', activityDateTime: '2026-10-26T10:00:00Z' }, { id: 'a2', activityDateTime: '2026-10-26T11:00:00Z' }] },
    controlIds: ['AU.L2-3.3.2', 'CM.L2-3.4.3'],
    objectiveIds: ['AU.L2-3.3.2[a]', 'CM.L2-3.4.3[a]'],
    ...over,
  };
}

describe('EvidenceStore (W1.1)', () => {
  let tmp: string;
  let root: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-store-'));
    root = evidenceStoreRootOf(tmp);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('appends a record with every provenance field, a payload file named by its SHA-256, and a manifest', () => {
    const store = EvidenceStore.forStorageRoot(tmp, A);
    const r = store.append(input(A));
    expect(store.tenantDir).toBe(path.join(tmp, 'evidence-store', A));
    expect(r).toMatchObject({
      schema: 'ces-eo/evidence-record@1', seq: 1, tenantId: A, tenantSlug: 'store-a', sourceId: 'directoryAudits',
      collector, host: 'graph.microsoft.us', endpoint: '/auditLogs/directoryAudits', status: 'success', itemCount: 2,
      prevRecordSha256: GENESIS_SHA256,
    });
    expect(r.query).toContain('$filter=activityDateTime');
    expect(r.window).toEqual({ start: '2026-09-27T00:00:00.000Z', end: '2026-10-27T00:00:00.000Z' });
    expect(r.payloadSha256).toBe(canonicalSha256(input(A).payload));
    const bytes = fs.readFileSync(store.payloadPath(r.payloadSha256));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(r.payloadSha256);
    expect(r.recordSha256).toBe(computeRecordSha256(r));
    const m = store.readManifest()!;
    expect(m).toMatchObject({ tenantId: A, tenantSlug: 'store-a', recordCount: 1, headSha256: r.recordSha256, genesisSha256: GENESIS_SHA256 });
    expect(m.chain).toEqual([{ seq: 1, recordId: r.recordId, recordSha256: r.recordSha256, payloadSha256: r.payloadSha256, sourceId: 'directoryAudits', collectedAt: r.collectedAt }]);
  });

  it('keeps failing and empty reads (error, not_assessed, empty, gap) as records', () => {
    const store = EvidenceStore.forStorageRoot(tmp, A);
    for (const status of ['error', 'not_assessed', 'empty', 'gap'] as const) {
      store.append(input(A, { status, itemCount: 0, payload: null, error: status === 'empty' ? undefined : `${status} text` }));
    }
    expect(store.records().map((r) => r.status)).toEqual(['error', 'not_assessed', 'empty', 'gap']);
    expect(store.records()[0].error).toBe('error text');
    expect(store.verify().ok).toBe(true);
  });

  it('chains records: prev = previous record hash; the manifest head is the last record', () => {
    const store = EvidenceStore.forStorageRoot(tmp, A);
    const r1 = store.append(input(A));
    const r2 = store.append(input(A, { sourceId: 'signInLogs', payload: { value: [] }, itemCount: 0, status: 'empty' }));
    const r3 = store.append(input(A, { sourceId: 'conditionalAccess', collectedAt: '2026-10-27T01:00:00.000Z' }));
    expect(r2.prevRecordSha256).toBe(r1.recordSha256);
    expect(r3.prevRecordSha256).toBe(r2.recordSha256);
    const v = store.verify();
    expect(v).toMatchObject({ ok: true, recordCount: 3, headSha256: r3.recordSha256, manifest: { present: true, recordCount: 3, headSha256: r3.recordSha256, matches: true } });
    expect(v.problems).toEqual([]);
  });

  it('a payload that is already on disk is reused, never rewritten; a tampered payload file is refused', () => {
    const store = EvidenceStore.forStorageRoot(tmp, A);
    const r1 = store.append(input(A));
    const r2 = store.append(input(A, { collectedAt: '2026-10-27T01:00:00.000Z' }));
    expect(r2.payloadSha256).toBe(r1.payloadSha256);
    fs.writeFileSync(store.payloadPath(r1.payloadSha256), '{"value":[]}');
    expect(() => store.append(input(A, { collectedAt: '2026-10-27T02:00:00.000Z' }))).toThrow(/no longer matches its hash; refusing to rewrite/);
    expect(store.verify()).toMatchObject({ ok: false, firstBreakSeq: 1 });
    expect(() => store.readPayload(r1)).toThrow(EvidenceStoreIntegrityError);
  });

  it('a record id already in the chain is refused (records are never rewritten)', () => {
    const store = EvidenceStore.forStorageRoot(tmp, A);
    store.append(input(A, { recordId: 'rec-1' }));
    expect(() => store.append(input(A, { recordId: 'rec-1', itemCount: 99 }))).toThrow(/already exists; records are never rewritten/);
    expect(store.records()).toHaveLength(1);
    expect(store.records()[0].itemCount).toBe(2);
  });

  it('tampering with a record breaks the chain, and the store refuses to append onto a rewritten log', () => {
    const store = EvidenceStore.forStorageRoot(tmp, A);
    store.append(input(A));
    store.append(input(A, { sourceId: 'signInLogs' }));
    const file = path.join(store.tenantDir, 'records.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    const edited = JSON.parse(lines[0]);
    edited.status = 'error'; // rewrite history: a success becomes an error
    fs.writeFileSync(file, [JSON.stringify(edited), lines[1]].join('\n') + '\n');
    const v = store.verify();
    expect(v.ok).toBe(false);
    expect(v.firstBreakSeq).toBe(1);
    expect(v.problems.join(' ')).toMatch(/record 1 .* does not hash to its recordSha256/);

    // Rewriting the head record (re-hashed, so it looks valid on its own) is refused at append.
    const head = JSON.parse(lines[1]);
    head.itemCount = 0;
    head.recordSha256 = computeRecordSha256(head);
    fs.writeFileSync(file, [lines[0], JSON.stringify(head)].join('\n') + '\n');
    expect(() => store.append(input(A, { sourceId: 'riskDetections' }))).toThrow(/head hash does not match manifest.json: log rewritten; refusing to append/);

    // Truncating the log is refused too.
    fs.writeFileSync(file, lines[0] + '\n');
    expect(() => store.append(input(A, { sourceId: 'riskDetections' }))).toThrow(/has 1 records, manifest says 2: log rewritten/);
    expect(store.verify().manifest.matches).toBe(false);
  });

  it('tenant isolation: another tenant\'s append is refused, stores are separate, a foreign record is never returned', () => {
    const a = EvidenceStore.forStorageRoot(tmp, A);
    const b = EvidenceStore.forStorageRoot(tmp, B);
    expect(() => a.append(input(B))).toThrow(/record for tenant .* refused by the store of/);
    a.append(input(A));
    b.append(input(B, { sourceId: 'signInLogs' }));
    expect(a.records().map((r) => r.tenantId)).toEqual([A]);
    expect(b.records().map((r) => r.tenantId)).toEqual([B]);
    expect(a.query({ sourceId: 'signInLogs' })).toEqual([]);

    // A record of B's planted in A's log is never returned by A's read API, and breaks A's chain.
    const bLine = fs.readFileSync(path.join(b.tenantDir, 'records.jsonl'), 'utf-8');
    fs.appendFileSync(path.join(a.tenantDir, 'records.jsonl'), bLine);
    expect(a.records().every((r) => r.tenantId === A)).toBe(true);
    expect(a.query({}).map((r) => r.sourceId)).toEqual(['directoryAudits']);
    expect(a.get(b.records()[0].recordId)).toBeUndefined();
    expect(a.evidenceRefsFor('AU.L2-3.3.2[a]').every((ref) => ref.tenantId === A)).toBe(true);
    const v = a.verify();
    expect(v.ok).toBe(false);
    expect(v.problems.join(' ')).toMatch(/names tenant/);
  });

  it('refuses a tenant id that is not a plain folder name', () => {
    for (const bad of ['..', '../x', 'a/b', 'a\\b', '', '.hidden']) {
      expect(() => new EvidenceStore(root, bad)).toThrow(/invalid tenant id/);
    }
  });

  it('every record carries retention metadata: policy id and retainUntil = collectedAt + 6 years', () => {
    const store = EvidenceStore.forStorageRoot(tmp, A);
    const r = store.append(input(A, { collectedAt: '2026-10-27T13:14:15.000Z' }));
    expect(r.retentionPolicy).toBe(RETENTION_POLICY_ID);
    expect(r.retainUntil).toBe('2032-10-27T13:14:15.000Z');
    expect(store.readManifest()!.retentionPolicy).toBe(RETENTION_POLICY_ID);
  });

  it('read API: by source, by control, by objective, by collection window', () => {
    const store = EvidenceStore.forStorageRoot(tmp, A);
    store.append(input(A, { collectedAt: '2026-10-25T00:00:00.000Z' }));
    store.append(input(A, { sourceId: 'conditionalAccess', controlIds: ['AC.L2-3.1.12'], objectiveIds: ['AC.L2-3.1.12[a]'], collectedAt: '2026-10-26T00:00:00.000Z' }));
    store.append(input(A, { collectedAt: '2026-10-27T00:00:00.000Z' }));
    expect(store.query({ sourceId: 'directoryAudits' })).toHaveLength(2);
    expect(store.query({ controlId: 'AC.L2-3.1.12' }).map((r) => r.sourceId)).toEqual(['conditionalAccess']);
    expect(store.query({ objectiveId: 'CM.L2-3.4.3[a]' })).toHaveLength(2);
    expect(store.query({ from: '2026-10-26T00:00:00.000Z', to: '2026-10-26T23:59:59.000Z' }).map((r) => r.sourceId)).toEqual(['conditionalAccess']);
    expect(store.query({ sourceId: 'directoryAudits', from: '2026-10-26T00:00:00.000Z' })).toHaveLength(1);
    const first = store.records()[0];
    expect(store.readPayload(first)).toEqual(input(A).payload);
  });
});
