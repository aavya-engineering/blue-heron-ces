// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH-12 (C11 event-loop block, LOG-PH12-EO.md): EvidenceStore.appendMany writes the same chain as
 * the pre-PH-12 per-record append, byte for byte, and refuses a bad batch before writing anything.
 * The reference is a verbatim copy of the old `append` body (bhd/nb f720b50, EvidenceStore.ts:143-207).
 * Temp dirs only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJsonStringify } from 'ces-shared/crypto';
import {
  EvidenceStore, EvidenceStoreIntegrityError, GENESIS_SHA256, MANIFEST_FILE, RECORDS_FILE, computeRecordSha256,
} from '../../../../src/eo/evidence/store/EvidenceStore';
import { RETENTION_POLICY_ID, retainUntil } from '../../../../src/eo/evidence/store/RetentionPolicy';
import { WATERMARKS_FILE } from '../../../../src/eo/evidence/store/Watermarks';
import type { AppendInput, EvidenceManifest, EvidenceRecord } from '../../../../src/eo/evidence/store/types';

const T = '00000000-0000-4000-8000-0000000012ee';
const collector = { name: 'ces-eo/collect/C11', version: '9.9.9', identity: 'ces-eo/9.9.9@11111111-2222-4333-8444-555555555555' };
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function input(i: number, over: Partial<AppendInput> = {}): AppendInput {
  return {
    tenantId: T, tenantSlug: 'ph12', sourceId: 'collect.stamperEvidence', collector, host: 'stamper',
    endpoint: i % 3 === 0 ? 'stamper_evidence/row' : 'stamper_evidence/file', query: `stamper_evidence/item-${i}`,
    window: { start: '2026-11-01T00:00:00.000Z', end: '2026-11-01T01:00:00.000Z' }, collectedAt: '2026-11-01T01:00:00.000Z',
    status: 'success', itemCount: 1, payload: { kind: 'file', id: `item-${i}`, n: i, text: 'x'.repeat(i % 50) },
    controlIds: i % 2 ? ['MP.L2-3.8.5', 'AC.L1-3.1.1'] : ['AC.L1-3.1.1'], objectiveIds: [`AC.L1-3.1.1[${'abcd'[i % 4]}]`],
    recordId: `rec-${i}`, ...over,
  };
}

/** The pre-PH-12 `EvidenceStore.append`, verbatim except `this` -> `dir` (the reference for "same chain"). */
function legacyAppend(dir: string, inp: AppendInput): EvidenceRecord {
  const recordsFile = path.join(dir, RECORDS_FILE);
  const manifestFile = path.join(dir, MANIFEST_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const records: EvidenceRecord[] = fs.existsSync(recordsFile)
    ? fs.readFileSync(recordsFile, 'utf-8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as EvidenceRecord) : [];
  const recordId = inp.recordId ?? randomUUID();
  const text = canonicalJsonStringify(inp.payload === undefined ? null : inp.payload);
  const payloadSha256 = sha(Buffer.from(text, 'utf-8'));
  const pfile = path.join(dir, 'payloads', `${payloadSha256}.json`);
  fs.mkdirSync(path.dirname(pfile), { recursive: true });
  if (!fs.existsSync(pfile)) fs.writeFileSync(pfile, text, { encoding: 'utf-8', flag: 'wx' });
  const prev = records.length ? records[records.length - 1].recordSha256 : GENESIS_SHA256;
  const body: Omit<EvidenceRecord, 'recordSha256'> = {
    schema: 'ces-eo/evidence-record@1', seq: records.length + 1, recordId, tenantId: inp.tenantId, tenantSlug: inp.tenantSlug,
    sourceId: inp.sourceId, collector: inp.collector, host: inp.host, endpoint: inp.endpoint, query: inp.query, window: inp.window,
    collectedAt: inp.collectedAt, status: inp.status, itemCount: inp.itemCount, payloadSha256,
    controlIds: [...(inp.controlIds ?? [])].sort(), objectiveIds: [...(inp.objectiveIds ?? [])].sort(),
    retentionPolicy: RETENTION_POLICY_ID, retainUntil: retainUntil(inp.collectedAt),
    ...(inp.error !== undefined ? { error: inp.error } : {}), prevRecordSha256: prev,
  };
  const record: EvidenceRecord = { ...body, recordSha256: computeRecordSha256(body) };
  fs.appendFileSync(recordsFile, JSON.stringify(record) + '\n', 'utf-8');
  const old = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf-8')) as EvidenceManifest : null;
  const manifest: EvidenceManifest = {
    schema: 'ces-eo/evidence-manifest@1', tenantId: inp.tenantId, tenantSlug: inp.tenantSlug, hashAlgorithm: 'sha256/canonical-json',
    recordCount: record.seq, headSha256: record.recordSha256, genesisSha256: GENESIS_SHA256, retentionPolicy: RETENTION_POLICY_ID,
    updatedAt: new Date().toISOString(),
    chain: [...(old?.chain ?? []), { seq: record.seq, recordId, recordSha256: record.recordSha256, payloadSha256, sourceId: record.sourceId, collectedAt: record.collectedAt }],
  };
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return record;
}

const withoutUpdatedAt = (file: string): unknown => {
  const j = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  if ('updatedAt' in j) delete j.updatedAt;
  for (const v of Object.values(j)) if (v && typeof v === 'object' && 'updatedAt' in (v as object)) delete (v as Record<string, unknown>).updatedAt;
  return j;
};

describe('EvidenceStore.appendMany (PH-12)', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-ph12-store-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const dirOf = (name: string) => path.join(tmp, name, 'evidence-store', T);
  const storeOf = (name: string) => EvidenceStore.forStorageRoot(path.join(tmp, name), T);

  it('writes the chain the old per-record append writes: records.jsonl and payloads byte-identical, manifest equal but for updatedAt', () => {
    const head = [input(0, { sourceId: 'directoryAudits', endpoint: '/auditLogs/directoryAudits', status: 'empty', itemCount: 0, payload: [] })];
    const batch = Array.from({ length: 250 }, (_, i) => input(i + 1));
    for (const x of [...head, ...batch]) legacyAppend(dirOf('legacy'), x);

    const store = storeOf('batch');
    store.append(head[0]);
    const written = store.appendMany(batch);

    expect(written.map((r) => r.seq)).toEqual(batch.map((_, i) => i + 2));
    expect(fs.readFileSync(path.join(dirOf('batch'), RECORDS_FILE))).toEqual(fs.readFileSync(path.join(dirOf('legacy'), RECORDS_FILE)));
    expect(withoutUpdatedAt(path.join(dirOf('batch'), MANIFEST_FILE))).toEqual(withoutUpdatedAt(path.join(dirOf('legacy'), MANIFEST_FILE)));
    expect(fs.readdirSync(path.join(dirOf('batch'), 'payloads')).sort()).toEqual(fs.readdirSync(path.join(dirOf('legacy'), 'payloads')).sort());
    expect(store.verify().ok).toBe(true);
    expect(storeOf('legacy').verify().ok).toBe(true);
  });

  it('a batch equals the same records appended one by one through append (watermark on the last record included)', () => {
    const wm = { lastEventTime: '2026-11-01T01:00:00.000Z', lastId: 'item-40', lastWindowEnd: '2026-11-01T01:00:00.000Z', overlapMinutes: 0, seenIds: [] };
    const batch = Array.from({ length: 40 }, (_, i) => input(i, i === 39 ? { watermark: wm } : {}));
    const one = storeOf('one');
    for (const x of batch) one.append(x);
    const many = storeOf('many');
    many.appendMany(batch);
    expect(fs.readFileSync(path.join(dirOf('many'), RECORDS_FILE))).toEqual(fs.readFileSync(path.join(dirOf('one'), RECORDS_FILE)));
    expect(withoutUpdatedAt(path.join(dirOf('many'), MANIFEST_FILE))).toEqual(withoutUpdatedAt(path.join(dirOf('one'), MANIFEST_FILE)));
    expect(withoutUpdatedAt(path.join(dirOf('many'), WATERMARKS_FILE))).toEqual(withoutUpdatedAt(path.join(dirOf('one'), WATERMARKS_FILE)));
    expect(many.watermarks.get('collect.stamperEvidence')?.recordId).toBe('rec-39');
  });

  it('refuses a bad batch before writing any record', () => {
    const store = storeOf('refuse');
    store.append(input(0));
    const before = fs.readFileSync(path.join(dirOf('refuse'), RECORDS_FILE));
    const wm = { lastWindowEnd: '2026-11-01T01:00:00.000Z' };
    expect(() => store.appendMany([input(1), input(1)])).toThrow(/already exists/);
    expect(() => store.appendMany([input(2), input(0)])).toThrow(/already exists/);
    expect(() => store.appendMany([input(3), input(4, { tenantId: '00000000-0000-4000-8000-0000000012ff' })])).toThrow(EvidenceStoreIntegrityError);
    expect(() => store.appendMany([input(5, { watermark: wm }), input(6, { watermark: wm })])).toThrow(/more than one watermark/);
    expect(fs.readFileSync(path.join(dirOf('refuse'), RECORDS_FILE))).toEqual(before);
    expect(store.appendMany([])).toEqual([]);
    expect(store.verify().ok).toBe(true);
  });

  it('refuses to append onto a rewritten log, as append does', () => {
    const store = storeOf('rewritten');
    store.appendMany([input(0), input(1)]);
    const file = path.join(dirOf('rewritten'), RECORDS_FILE);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf-8').split('\n')[0] + '\n');
    expect(() => store.appendMany([input(2)])).toThrow(/log rewritten/);
  });
});
