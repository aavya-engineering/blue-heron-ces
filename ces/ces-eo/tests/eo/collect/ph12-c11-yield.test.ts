// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH-12 (C11 event-loop block, LOG-PH12-EO.md): C11 at R-F8 size (155 Stamper files + 1092 ces.db
 * rows = 1248 records) no longer blocks EO's event loop for seconds (before PH-12: 11.6-12.1 s in
 * one block), and the chain it writes is the chain the per-record append writes for the same records.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { collectorInfo } from '../../../src/eo/evidence/store/collectorIdentity';
import { runCollectors } from '../../../src/eo/collect/index';
import { stamperEvidenceCollector, stamperEvidenceFromChain, NO_COLLECTOR_READER } from '../../../src/eo/collect/StamperEvidenceCollector';
import { EvidenceStore, MANIFEST_FILE, RECORDS_FILE } from '../../../src/eo/evidence/store/EvidenceStore';

const TENANT = 'sim-tenant-ph12';
const ZERO = '00000000-0000-0000-0000-000000000000';
const SLUG = 'ph12-sim';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

describe('PH-12: C11 yields and keeps its chain', () => {
  let tmp: string;
  const prev = process.env.CES_PIPELINE_ROOT;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-ph12-c11-')); process.env.CES_PIPELINE_ROOT = tmp; });
  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
  });

  it('1248 records: the event loop keeps turning, and a per-record replay gives the same records.jsonl', async () => {
    const evDir = path.join(tmp, 'Stamper', 'plan-data', SLUG, 'evidence', 'access_control');
    fs.mkdirSync(evDir, { recursive: true });
    const files: string[] = [];
    for (let i = 0; i < 155; i++) {
      const f = path.join(evDir, `e${i}.json`);
      fs.writeFileSync(f, JSON.stringify({ metadata: { controlIds: ['AC.L1-3.1.1'], sha256Hash: '', timestamp: '2026-11-01T00:00:00.000Z' }, output: 'x'.repeat(2000), i }));
      files.push(f);
    }
    const repo = getCesRepository(path.join(tmp, 'ces.db'));
    const data = (i: number) => ({ artifact_id: `a${i}`, task_id: 't', control_ids: ['AC.L1-3.1.1'], storage_location: files[i % 155], sha256_hash: sha(fs.readFileSync(files[i % 155])) });
    for (let i = 0; i < 726; i++) repo.put('stamper_evidence_metadata', { id: `newrun:z${i}:a#1`, ces: { tenantId: ZERO, tenantSlug: SLUG }, data: data(i) });
    for (let i = 0; i < 366; i++) repo.put('stamper_evidence_metadata', { id: `newrun:t${i}:a#1`, ces: { tenantId: TENANT, tenantSlug: SLUG }, data: data(i) });

    const root = path.join(tmp, 'eo');
    let last = Date.now();
    let maxGap = 0;
    let ticks = 0;
    const timer = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; ticks += 1; }, 5);
    let run;
    try {
      run = await runCollectors({
        storageRoot: root, tenantId: TENANT, tenantSlug: SLUG, nowMs: Date.parse('2026-11-01T12:00:00.000Z'),
        reader: NO_COLLECTOR_READER, identity: collectorInfo('00000000-0000-4000-8000-00000000c1a1'), collectors: [stamperEvidenceCollector],
      });
    } finally {
      clearInterval(timer);
    }
    maxGap = Math.max(maxGap, Date.now() - last);
    expect(run.errors).toEqual([]);
    expect(run.recorded).toBe(1248); // 155 files + 1092 rows + 1 index
    expect(ticks).toBeGreaterThan(0); // the loop turned during the run (before PH-12 it never did)
    expect(maxGap).toBeLessThan(5000); // generous: measured about 0.9 s, against 11.6-12.1 s before PH-12 and the ~6.5 s stale-socket threshold (LOG-PH11-EO.md §3a)

    const store = EvidenceStore.forStorageRoot(root, TENANT);
    expect(store.verify().ok).toBe(true);
    const chained = stamperEvidenceFromChain(store, run.results[0]);
    expect(chained.evidence).toHaveLength(155);
    expect(chained.missing).toEqual([]);

    // Replay every record through the per-record append into a fresh store: identical log and manifest chain.
    const replayRoot = path.join(tmp, 'replay');
    const replay = EvidenceStore.forStorageRoot(replayRoot, TENANT);
    for (const r of store.records()) {
      replay.append({
        tenantId: r.tenantId, tenantSlug: r.tenantSlug, sourceId: r.sourceId, collector: r.collector, host: r.host,
        endpoint: r.endpoint, query: r.query, window: r.window, collectedAt: r.collectedAt, status: r.status,
        itemCount: r.itemCount, payload: store.readPayload(r), controlIds: r.controlIds, objectiveIds: r.objectiveIds,
        recordId: r.recordId, ...(r.error !== undefined ? { error: r.error } : {}),
      });
    }
    const dir = (rt: string) => path.join(rt, 'evidence-store', TENANT);
    expect(fs.readFileSync(path.join(dir(replayRoot), RECORDS_FILE))).toEqual(fs.readFileSync(path.join(dir(root), RECORDS_FILE)));
    const chainOf = (rt: string) => (JSON.parse(fs.readFileSync(path.join(dir(rt), MANIFEST_FILE), 'utf-8')) as { chain: unknown[] }).chain;
    expect(chainOf(replayRoot)).toEqual(chainOf(root));

    // Order (unchanged by PH-12): the runner's sortRows rule, item time then id; every C11 item carries the read's
    // window end as its time, so the records follow item-id order.
    const ids = store.records().map((r) => r.query.slice('stamper_evidence/'.length));
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  }, 120000);
});
