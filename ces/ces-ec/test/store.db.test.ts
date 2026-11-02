// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DB-1: EC records live in CesRepository (ces.db), not JSON/JSONL files; legacy files import once.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getCesRepository } from 'ces-shared/persistence/node';

import {
  EC_COLLECTIONS,
  EcWriteOnceError,
  appendRun,
  applyFindings,
  importLegacyFiles,
  listFindings,
  listItems,
  listRuns,
  listStoredTenants,
  loadLedgerState,
  readItem,
  readLedgerHistory,
  recordLedger,
  sha256Hex,
  writeItem,
} from '../src/store.js';
import { ecTenantDir, makeSandbox, type Sandbox } from './helpers.js';

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => sb.restore());

const T = '2026-09-28T12:00:00.000Z';
const ITEM_ID = 'eci-00000000-0000-4000-8000-000000000001';

function item(slug: string, content: Buffer) {
  return {
    contractVersion: '1.0.0' as const,
    itemId: ITEM_ID,
    tenantSlug: slug,
    controlIds: ['PE.L1-3.10.1'],
    source: 'manual_upload' as const,
    filename: 'badge.csv',
    mediaType: 'text/csv',
    sha256: sha256Hex(content),
    sizeBytes: content.length,
    collectedAt: T,
    submittedByRole: 'operator',
    mode: 'sim' as const,
  };
}

describe('DB-1 store on CesRepository', () => {
  it('writes runs, findings and ledger to ces.db, not to JSON/JSONL files', () => {
    appendRun('ec-sim-a', { runId: 'ecr-1', startedAt: T, runType: 'index', status: 'success', artifactsWritten: 0 });
    applyFindings('ec-sim-a', [{ checkId: 'STALE', subject: 's', severity: 'low', detail: 'd' }], [], T);
    recordLedger('ec-sim-a', 'stamper', 'evidence/a.json', 'a'.repeat(64), T);
    const dir = ecTenantDir(sb, 'ec-sim-a');
    for (const f of ['runs.jsonl', 'findings.json', 'ledger.jsonl', 'ledger-state.json']) {
      expect(fs.existsSync(path.join(dir, f))).toBe(false);
    }
    expect(fs.existsSync(path.join(sb.pipelineRoot, 'ces.db'))).toBe(true);
    expect(listRuns('ec-sim-a').map((r) => r.runId)).toEqual(['ecr-1']);
    expect(listFindings('ec-sim-a')).toHaveLength(1);
    expect(readLedgerHistory('ec-sim-a')).toHaveLength(1);
    expect(listStoredTenants()).toEqual(['ec-sim-a']);
  });

  it('items: metadata row + blob referenced by sha256, scoped per tenant', () => {
    const content = Buffer.from('badge log bytes');
    writeItem(item('ec-sim-a', content), content, T);
    const got = readItem('ec-sim-a', ITEM_ID);
    expect(got?.content.equals(content)).toBe(true);
    expect(sha256Hex(got!.content)).toBe(got!.item.sha256);
    expect(listItems('ec-sim-a')).toHaveLength(1);
    expect(listItems('ec-sim-b')).toHaveLength(0);
    expect(readItem('ec-sim-b', ITEM_ID)).toBeUndefined();
    expect(readLedgerHistory('ec-sim-a')[0]).toMatchObject({ origin: 'ec', path: `items/${ITEM_ID}.bin` });
  });

  it('ledger history keeps append order', () => {
    for (let i = 0; i < 5; i++) recordLedger('ec-sim-a', 'stamper', 'evidence/a.json', String(i).repeat(64), T);
    expect(readLedgerHistory('ec-sim-a').map((e) => e.sha256[0])).toEqual(['0', '1', '2', '3', '4']);
  });

  it('imports legacy JSON/JSONL files once (idempotent), leaving them on disk', () => {
    const slug = 'ec-legacy';
    const dir = ecTenantDir(sb, slug);
    const content = Buffer.from('legacy bytes');
    fs.mkdirSync(path.join(dir, 'items'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'items', `${ITEM_ID}.bin`), content);
    fs.writeFileSync(path.join(dir, 'items', `${ITEM_ID}.json`), JSON.stringify(item(slug, content)));
    fs.writeFileSync(
      path.join(dir, 'runs.jsonl'),
      [
        { runId: 'ecr-a', startedAt: '2026-09-01T00:00:00.000Z', runType: 'index', status: 'success', artifactsWritten: 0 },
        { runId: 'ecr-b', startedAt: '2026-09-02T00:00:00.000Z', runType: 'index', status: 'success', artifactsWritten: 0 },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n',
    );
    const finding = {
      findingId: 'ecf-1',
      checkId: 'STALE',
      detectedAt: T,
      severity: 'low',
      status: 'open',
      tenantSlug: slug,
      detail: 'old',
      key: 'STALE|x',
    };
    fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify([finding]));
    const entry = { tenantSlug: slug, path: 'evidence/a.json', sha256: 'b'.repeat(64), firstSeen: T, lastSeen: T, origin: 'stamper' };
    fs.writeFileSync(path.join(dir, 'ledger-state.json'), JSON.stringify({ 'stamper:evidence/a.json': entry }));
    fs.writeFileSync(path.join(dir, 'ledger.jsonl'), JSON.stringify(entry) + '\n');

    // first access imports
    expect(listRuns(slug).map((r) => r.runId)).toEqual(['ecr-b', 'ecr-a']);
    expect(listItems(slug).map((i) => i.itemId)).toEqual([ITEM_ID]);
    expect(readItem(slug, ITEM_ID)?.content.equals(content)).toBe(true);
    expect(listFindings(slug)).toHaveLength(1);
    expect(loadLedgerState(slug)['stamper:evidence/a.json'].sha256).toBe('b'.repeat(64));
    expect(readLedgerHistory(slug)).toHaveLength(1);
    expect(listStoredTenants()).toContain(slug);

    // resolve the finding after import; a re-import must not reopen it or duplicate rows
    applyFindings(slug, [], ['STALE'], T);
    expect(importLegacyFiles(slug)).toBe(0);
    expect(listFindings(slug)[0].status).toBe('resolved');
    expect(listRuns(slug)).toHaveLength(2);
    expect(readLedgerHistory(slug)).toHaveLength(1);
    expect(getCesRepository().list(EC_COLLECTIONS.migrations, { tenantSlug: slug })).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'runs.jsonl'))).toBe(true);
  });
});

// FIN-24 (CONTRACT CHANGE): EC items, their blobs and ledger history are write-once.
describe('FIN-24 write-once items and ledger history', () => {
  it('an overwrite probe on an existing item is refused and the original record and blob stay intact', () => {
    const slug = 'ec-sim-a';
    const original = Buffer.from('original bytes');
    writeItem(item(slug, original), original, T);
    const tampered = Buffer.from('TAMPERED bytes');
    expect(() => writeItem({ ...item(slug, tampered), filename: 'other.csv' }, tampered, T)).toThrow(EcWriteOnceError);
    const read = readItem(slug, ITEM_ID)!;
    expect(read.content.toString()).toBe('original bytes');
    expect(read.item.filename).toBe('badge.csv');
    // the history holds the one ingest row only
    expect(readLedgerHistory(slug)).toHaveLength(1);
  });

  it('a blob left on disk without a row is not overwritten either', () => {
    const slug = 'ec-sim-a';
    const dir = path.join(ecTenantDir(sb, slug), 'items');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${ITEM_ID}.bin`), 'pre-existing');
    const content = Buffer.from('new');
    expect(() => writeItem(item(slug, content), content, T)).toThrow(EcWriteOnceError);
    expect(fs.readFileSync(path.join(dir, `${ITEM_ID}.bin`), 'utf-8')).toBe('pre-existing');
  });

  it('ledger history rows are never rewritten; ledger state stays mutable', () => {
    const slug = 'ec-sim-a';
    recordLedger(slug, 'stamper', 'evidence/a.json', 'a'.repeat(64), T);
    recordLedger(slug, 'stamper', 'evidence/a.json', 'b'.repeat(64), '2026-09-28T13:00:00.000Z');
    const history = readLedgerHistory(slug);
    expect(history.map((h) => h.sha256)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    expect(loadLedgerState(slug)['stamper:evidence/a.json'].sha256).toBe('b'.repeat(64));
    // (the CesRepository WORM list itself is tested in ces-shared's CesRepository.test.ts)
  });
});
