// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W2: the AdminOps evidence reader on a fixture shared DB, collector C10
 * (`collect.adminOps`: one store record per row, de-dup by row id, watermark by row time), the
 * AD-6 / B27 tier rule (Tier 3 only for an apply with a confirming read; read-only and unconfirmed
 * rows Tier 4 "state not verified"), and the method labels (test for a confirmed apply, else examine).
 *
 * The fixture DB is created by ces-shared's CesRepository (the schema AdminOps writes through) at
 * {CES_PIPELINE_ROOT}\ces.db; rows are AO's golden contract rows (makeRealShapeRow). Fictional ids only.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { canonicalSha256 } from 'ces-shared/crypto';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import type { AssessmentSource, ControlAssessment } from 'ces-shared/types/controls';
import { AdminOpsEvidenceReader, adminOpsEvidenceKind, adminOpsRunWindowStart, ADMINOPS_SINCE_ENV } from '../../../src/eo/adminops/AdminOpsEvidenceReader';
import { ControlAssessor, type EoControlAssessment } from '../../../src/eo/assessment/ControlAssessor';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { collectorInfo } from '../../../src/eo/evidence/store/collectorIdentity';
import { runCollectors, adminOpsCollector, COLLECTED, REGISTERED_COLLECTORS, type AdminOpsCollectedRow } from '../../../src/eo/collect/index';
import { methodForObjective, methodForStoreSource } from '../../../src/eo/packager/MethodLabeler';
import { makeRealShapeRow, type RealShapeOpts } from '../adminops/helpers/makeRealShapeRow';

const TENANT = '00000000-0000-4000-8000-0000000000a0';
const OTHER = '00000000-0000-4000-8000-0000000000a9';
const SLUG = 's1-sim';
const REQ = 'requestor@s1-sim.example.test';
const APPROVER = 'approver@s1-sim.example.test';
const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const T = (min: number) => new Date(NOW - min * 60_000).toISOString();
const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');

/** The S1 E7A op rows (PLAN section 3): A-02 and B-07 writes (dry run, then apply), A-11 and A-09 reads. */
function s1Rows(): RealShapeOpts[] {
  const pre = '{"accountEnabled":true}';
  return [
    { commandId: 'A-02', executionId: 'e1', mode: 'dry_run', dryRun: true, outcome: 'dry_run', controlIds: ['AC.L1-3.1.2'], timestamp: T(50), preStateOutput: pre },
    { commandId: 'A-02', executionId: 'e2', controlIds: ['AC.L1-3.1.2'], timestamp: T(49), preStateOutput: pre, postStateOutput: '{"accountEnabled":false}', verdict: 'SAT' },
    { commandId: 'A-11', executionId: 'e3', controlIds: ['AC.L1-3.1.2'], timestamp: T(48), verdict: 'SAT' },
    { commandId: 'A-09', executionId: 'e4', controlIds: ['AC.L2-3.1.3'], timestamp: T(47), verdict: 'SAT' },
    { commandId: 'B-07', executionId: 'e5', mode: 'dry_run', dryRun: true, outcome: 'dry_run', controlIds: ['AC.L2-3.1.18'], timestamp: T(46), preStateOutput: '[]' },
    { commandId: 'B-07', executionId: 'e6', controlIds: ['AC.L2-3.1.18'], timestamp: T(45), preStateOutput: '[]', postStateOutput: '[{"displayName":"Block non-compliant devices"}]', verdict: 'SAT' },
    { commandId: 'A-11', executionId: 'e7', controlIds: ['AC.L1-3.1.2'], timestamp: T(44), verdict: 'SAT' },
    { commandId: 'A-09', executionId: 'e8', controlIds: ['AC.L2-3.1.3'], timestamp: T(43), verdict: 'SAT' },
  ];
}

describe('AdminOps evidence in EO (synthetic-customer W2: reader, C10, AD-6 tiers)', () => {
  let tmp: string;
  let dbPath: string;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-c10-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    dbPath = path.join(tmp, 'ces.db');
  });
  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
  });

  const seed = (rows: RealShapeOpts[], tenantId = TENANT) => {
    const repo = getCesRepository(dbPath);
    for (const r of rows) repo.put('adminops_evidence', makeRealShapeRow({ tenantId, tenantSlug: SLUG, requestorUPN: REQ, ...r }));
  };
  const ctx = (nowMs: number) => ({
    storageRoot: path.join(tmp, 'eo'), tenantId: TENANT, tenantSlug: SLUG, nowMs,
    reader: {} as any, identity: collectorInfo('00000000-0000-4000-8000-00000000c1a0'), collectors: [adminOpsCollector],
  });

  describe('reader (fixture shared DB)', () => {
    it('reads only this tenant, filters by row time and slug, and ranks rows by AD-6', () => {
      seed(s1Rows());
      seed([{ commandId: 'A-02', executionId: 'x1', controlIds: ['AC.L1-3.1.2'], timestamp: T(30), preStateOutput: 'a', postStateOutput: 'b' }], OTHER);
      const all = new AdminOpsEvidenceReader(TENANT, dbPath).read();
      expect(all.entries.map(e => e.rowId).sort()).toEqual(['A-02:e1', 'A-02:e2', 'A-09:e4', 'A-09:e8', 'A-11:e3', 'A-11:e7', 'B-07:e5', 'B-07:e6']);
      expect(all.stats).toMatchObject({ total: 8, live: 6, dryRun: 2 });

      const windowed = new AdminOpsEvidenceReader(TENANT, dbPath).read({ from: T(46) });
      expect(windowed.entries.map(e => e.rowId).sort()).toEqual(['A-09:e8', 'A-11:e7', 'B-07:e5', 'B-07:e6']);
      expect(new AdminOpsEvidenceReader(TENANT, dbPath).read({ tenantSlug: 'another-slug' }).entries).toEqual([]);

      const kinds = Object.fromEntries(all.entries.map(e => [e.rowId, adminOpsEvidenceKind(e.evidence)]));
      expect(kinds).toEqual({
        'A-02:e1': 'dry_run', 'A-02:e2': 'apply_confirmed', 'A-11:e3': 'read', 'A-09:e4': 'read',
        'B-07:e5': 'dry_run', 'B-07:e6': 'apply_confirmed', 'A-11:e7': 'read', 'A-09:e8': 'read',
      });
      const ac312 = all.sources.get('AC.L1-3.1.2')!;
      expect(ac312.map(s => s.detail.replace(/ \([^)]*corr[^)]*\)/, ''))).toEqual([
        'A-02', 'A-11 read-only op (state not verified)', 'A-11 read-only op (state not verified)',
      ]);
    });

    it('an apply whose confirming read is missing or empty is unconfirmed', () => {
      seed([
        { commandId: 'A-02', executionId: 'u1', controlIds: ['AC.L1-3.1.2'], timestamp: T(10), preStateOutput: '{"accountEnabled":true}' },
        { commandId: 'A-02', executionId: 'u2', controlIds: ['AC.L1-3.1.2'], timestamp: T(9), preStateOutput: '{"accountEnabled":true}', postStateOutput: '  ' },
      ]);
      const r = new AdminOpsEvidenceReader(TENANT, dbPath).read();
      expect(r.entries.map(e => adminOpsEvidenceKind(e.evidence))).toEqual(['apply_unconfirmed', 'apply_unconfirmed']);
      expect(r.sources.get('AC.L1-3.1.2')!.every(s => s.detail.endsWith('apply without a confirming read (state not verified)'))).toBe(true);
    });
  });

  describe('collector C10', () => {
    it('is registered after C9', () => {
      expect(REGISTERED_COLLECTORS.map(c => c.planId).slice(-2)).toEqual(['C9', 'C10']);
      expect(adminOpsCollector.sourceId).toBe(COLLECTED.ADMIN_OPS);
    });

    it('appends one record per row (payload hash, own controls, kind endpoint), adds no view signal, and never creates the DB', async () => {
      const empty = await runCollectors(ctx(NOW));
      expect(empty.results[0]).toMatchObject({ planId: 'C10', status: 'empty', newItems: 0 });
      expect(empty.signals).toEqual([]);
      expect(fs.existsSync(dbPath)).toBe(false);

      seed(s1Rows());
      const out = await runCollectors(ctx(NOW));
      expect(out.errors).toEqual([]);
      expect(out.results[0]).toMatchObject({ planId: 'C10', status: 'success', newItems: 8 });
      expect(out.recorded).toBe(8);
      expect(out.signals).toEqual([]);

      const store = EvidenceStore.forStorageRoot(path.join(tmp, 'eo'), TENANT);
      expect(store.verify().ok).toBe(true);
      const recs = store.query({ sourceId: COLLECTED.ADMIN_OPS }).filter(r => r.status === 'success');
      expect(recs).toHaveLength(8);
      const byRow = new Map(recs.map(r => [(store.readPayload(r) as AdminOpsCollectedRow).rowId, r]));
      const a02 = byRow.get('A-02:e2')!;
      const p = store.readPayload(a02) as AdminOpsCollectedRow;
      expect(a02.payloadSha256).toBe(canonicalSha256(p));
      expect(a02).toMatchObject({ itemCount: 1, controlIds: ['AC.L1-3.1.2'], endpoint: 'adminops_evidence/apply_confirmed', query: 'adminops_evidence/A-02:e2', tenantId: TENANT });
      expect(a02.objectiveIds.length).toBeGreaterThan(0);
      expect(p).toMatchObject({ opId: 'A-02', requestorUPN: REQ, mode: 'apply', result: 'executed', verdict: 'SAT', confirmingRead: true, kind: 'apply_confirmed' });
      expect(p.rowSha256).toBe(canonicalSha256(p.row));
      // V45 join: the row hash equals the canonical hash of the ces.db row's contract part (data.metadata)
      const dbRow = getCesRepository(dbPath).get<any>('adminops_evidence', 'A-02:e2', { tenantId: TENANT })!;
      expect(p.rowSha256).toBe(canonicalSha256(dbRow.data.metadata));
      expect(p.aoSha256).toBe(dbRow.data.metadata.sha256);
      expect(byRow.get('A-11:e3')!.endpoint).toBe('adminops_evidence/read');
      expect((store.readPayload(byRow.get('A-02:e1')!) as AdminOpsCollectedRow)).toMatchObject({ mode: 'dry_run', result: 'dry_run', confirmingRead: false });
      const wm = store.watermarks.get(COLLECTED.ADMIN_OPS)!;
      expect(wm.lastEventTime).toBe(T(43));
      expect(wm.lastId).toBe('A-09:e8');
    });

    it('de-duplicates by row id: a second pass appends one empty record; a later row is the only new record', async () => {
      seed(s1Rows());
      await runCollectors(ctx(NOW));
      const again = await runCollectors(ctx(NOW + 5 * 60_000));
      expect(again.results[0]).toMatchObject({ status: 'empty', newItems: 0 });
      expect(again.recorded).toBe(1);

      seed([{
        commandId: 'A-10', executionId: 'e9', controlIds: ['AC.L2-3.1.5'], timestamp: new Date(NOW + 6 * 60_000).toISOString(),
        approverUPN: APPROVER, approvalId: 'ap-1', preStateOutput: '[]', postStateOutput: '[{"roleDefinitionId":"r1"}]',
      }]);
      const third = await runCollectors(ctx(NOW + 10 * 60_000));
      expect(third.results[0]).toMatchObject({ status: 'success', newItems: 1 });
      const store = EvidenceStore.forStorageRoot(path.join(tmp, 'eo'), TENANT);
      const rows = store.query({ sourceId: COLLECTED.ADMIN_OPS }).filter(r => r.status === 'success').map(r => (store.readPayload(r) as AdminOpsCollectedRow));
      expect(rows.map(r => r.rowId).filter((id, i, a) => a.indexOf(id) !== i)).toEqual([]);
      expect(rows.find(r => r.rowId === 'A-10:e9')).toMatchObject({ approverUPN: APPROVER, approvalId: 'ap-1', confirmingRead: true });
      expect(store.verify().ok).toBe(true);
    });

    it('reads only the collecting tenant', async () => {
      seed(s1Rows(), OTHER);
      const out = await runCollectors(ctx(NOW));
      expect(out.results[0]).toMatchObject({ status: 'empty', newItems: 0 });
    });
  });

  describe('simulator run window (CES_EO_ADMINOPS_SINCE, W2 follow-up)', () => {
    const prevSince = process.env[ADMINOPS_SINCE_ENV];
    afterEach(() => { if (prevSince === undefined) delete process.env[ADMINOPS_SINCE_ENV]; else process.env[ADMINOPS_SINCE_ENV] = prevSince; });
    /** An earlier run's rows (two hours before NOW) and this run's S1 rows (50 to 43 minutes before NOW). */
    const seedTwoRuns = () => seed([
      { commandId: 'A-02', executionId: 'old-1', controlIds: ['AC.L1-3.1.2'], timestamp: T(120), preStateOutput: 'a', postStateOutput: 'b', verdict: 'SAT' },
      { commandId: 'A-11', executionId: 'old-2', controlIds: ['AC.L1-3.1.2'], timestamp: T(119), verdict: 'SAT' },
      ...s1Rows(),
    ]);

    it('unset or blank: every row of the tenant is read (production behaviour unchanged)', () => {
      delete process.env[ADMINOPS_SINCE_ENV];
      expect(adminOpsRunWindowStart()).toBeUndefined();
      expect(adminOpsRunWindowStart({ [ADMINOPS_SINCE_ENV]: '  ' })).toBeUndefined();
      seedTwoRuns();
      expect(new AdminOpsEvidenceReader(TENANT, dbPath).read().stats.total).toBe(10);
    });

    it('set: every read (status sources, stats, entries) skips rows timed before the run start; an explicit later from still narrows', () => {
      seedTwoRuns();
      process.env[ADMINOPS_SINCE_ENV] = T(60);
      const res = new AdminOpsEvidenceReader(TENANT, dbPath).read();
      expect(res.stats.total).toBe(8);
      expect(res.stats.live).toBe(6);
      expect(res.entries.map(e => e.rowId)).not.toContain('A-02:old-1');
      expect((res.sources.get('AC.L1-3.1.2') ?? []).map(x => x.timestamp)).not.toContain(T(120));
      // An earlier explicit from does not widen the run window; a later one narrows it.
      expect(new AdminOpsEvidenceReader(TENANT, dbPath).read({ from: T(500) }).stats.total).toBe(8);
      expect(new AdminOpsEvidenceReader(TENANT, dbPath).read({ from: T(45) }).stats.total).toBe(3);
    });

    it('C10: the first pass of a run re-collects no row of an earlier run (365-day lookback bounded by the run start)', async () => {
      seed([
        { commandId: 'A-02', executionId: 'old-1', controlIds: ['AC.L1-3.1.2'], timestamp: T(120), preStateOutput: 'a', postStateOutput: 'b', verdict: 'SAT' },
      ]);
      process.env[ADMINOPS_SINCE_ENV] = T(60);
      const first = await runCollectors(ctx(NOW - 55 * 60_000));
      expect(first.results[0]).toMatchObject({ planId: 'C10', status: 'empty', newItems: 0 });
      seed(s1Rows());
      const second = await runCollectors(ctx(NOW));
      expect(second.results[0]).toMatchObject({ status: 'success', newItems: 8 });
      const store = EvidenceStore.forStorageRoot(path.join(tmp, 'eo'), TENANT);
      const recs = store.query({ sourceId: COLLECTED.ADMIN_OPS });
      expect(recs.filter(r => r.status === 'success').map(r => (store.readPayload(r) as AdminOpsCollectedRow).rowId)).not.toContain('A-02:old-1');
      // The pass-level (empty) record's query names the run window.
      const emptyRecs = recs.filter(r => r.status === 'empty');
      expect(emptyRecs).toHaveLength(1);
      expect(emptyRecs[0].query).toContain(`AND timestamp >= ${T(60)}`);
    });
  });

  describe('AD-6 / B27 tiers (ControlAssessor)', () => {
    const C = 'AC.L1-3.1.2';
    const assess = (rows: RealShapeOpts[], signal?: ControlAssessment): EoControlAssessment => {
      seed(rows);
      const sources = new AdminOpsEvidenceReader(TENANT, dbPath).read().sources;
      const signals = signal ? new Map([[C, signal]]) : undefined;
      const snap = new ControlAssessor(controlsRefPath, []).merge(TENANT, [], [], [], [], sources, signals);
      return snap.controls.find(c => c.control_id === C) as EoControlAssessment;
    };
    const liveRead = (result: AssessmentSource['result']): ControlAssessment => ({
      control_id: C, nist_ref: '3.1.2', status: result === 'exists' ? 'met' : 'not_met', classification: 'automated',
      sources: [{ type: 'discovery', timestamp: T(1), detail: 'live read', result }], last_assessed: T(1),
      signals: [], evidenceArtifactIds: [], automationSource: 'graph', lastFetchedAt: T(1),
    });

    it('apply + confirming read: Tier 3 (state verified) decides, method test', () => {
      const c = assess([{ commandId: 'A-02', executionId: 'k1', controlIds: [C], timestamp: T(5), preStateOutput: 'a', postStateOutput: 'b', verdict: 'SAT' }]);
      expect(c.status).toBe('met');
      expect(c.statusRationale).toMatch(/^Tier 3 \(state-verified execution verdict\) decides: adminops_execution\/imported: A-02/);
      expect(methodForObjective({ source: 'digital-signal', statusRationale: c.statusRationale })).toBe('test');
      expect(methodForStoreSource(COLLECTED.ADMIN_OPS, 'adminops_evidence/apply_confirmed')).toBe('test');
    });

    it('apply without a confirming read: Tier 4, "state not verified", method examine', () => {
      const c = assess([{ commandId: 'A-02', executionId: 'k2', controlIds: [C], timestamp: T(5), preStateOutput: 'a', verdict: 'SAT' }]);
      expect(c.status).toBe('met');
      expect(c.statusRationale).toMatch(/^Tier 4 \(evidence-only Stamper SAT or unconfirmed AdminOps row\) decides; state not verified: /);
      expect(methodForObjective({ source: 'digital-signal', statusRationale: c.statusRationale })).toBe('examine');
      expect(methodForStoreSource(COLLECTED.ADMIN_OPS, 'adminops_evidence/apply_unconfirmed')).toBe('examine');
    });

    it('a read-only op is never Tier 3; it cannot outrank a live read; a read NOT_SAT is a Tier 4 negative', () => {
      const read = { commandId: 'A-11', controlIds: [C], timestamp: T(5), verdict: 'SAT' };
      const c = assess([{ ...read, executionId: 'k3' }]);
      expect(c.statusRationale).toMatch(/^Tier 4 .*state not verified: adminops_execution\/imported: A-11 .*read-only op \(state not verified\)$/);
      expect(methodForStoreSource(COLLECTED.ADMIN_OPS, 'adminops_evidence/read')).toBe('examine');
      closeAllCesRepositories(); fs.rmSync(dbPath, { force: true });

      const overLive = assess([{ ...read, executionId: 'k4' }], liveRead('missing'));
      expect(overLive.status).toBe('not_met');
      expect(overLive.statusRationale).toMatch(/^Tier 2/);
      closeAllCesRepositories(); fs.rmSync(dbPath, { force: true });

      const neg = assess([{ ...read, executionId: 'k5', verdict: 'NOT_SAT' }]);
      expect(neg.status).toBe('not_met');
      expect(neg.statusRationale).toMatch(/^Tier 4 \(evidence-only Stamper SAT or unconfirmed AdminOps row\) decides: adminops_execution\/missing/);
    });

    it('a confirmed apply outranks a read-only row on the same control (A-02 over A-11)', () => {
      const c = assess([
        { commandId: 'A-11', executionId: 'k6', controlIds: [C], timestamp: T(6), verdict: 'NOT_SAT' },
        { commandId: 'A-02', executionId: 'k7', controlIds: [C], timestamp: T(5), preStateOutput: 'a', postStateOutput: 'b', verdict: 'SAT' },
      ]);
      expect(c.status).toBe('met');
      expect(c.statusRationale).toMatch(/^Tier 3/);
    });
  });
});
