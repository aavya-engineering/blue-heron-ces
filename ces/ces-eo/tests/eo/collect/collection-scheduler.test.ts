// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-24 (W2.0a): the collection scheduler against the REAL assessment router over HTTP (loopback
 * assess, as EoServer wires it), real stores in a temp root and a scripted tenant session
 * (tests/eo/collect/scriptedTenant.ts). No sim, no network.
 *
 * Proves: tick 1 assesses (snapshot + drift baseline + POA&M); tick 2 runs only the collectors whose
 * cadence elapsed; a drift seeded between ticks is detected by tick 3 and raises a notice naming the
 * POA&M; EC HASH_DRIFT becomes one EO integrity finding (write-once) with a notice; a busy server
 * defers the tick; the routes show it all.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories, getCesRepository, CesWormError } from 'ces-shared/persistence/node';
import { createAssessmentRouter } from '../../../src/eo/server/routers/assessment-router';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { readDrift } from '../../../src/eo/assessment/DriftDetector';
import { PoamStore } from '../../../src/eo/poam/PoamStore';
import { PoamLedgerStore } from '../../../src/eo/poam/PoamLedgerStore';
import { PolicyStore } from '../../../src/eo/policies/PolicyStore';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { TrainingStore } from '../../../src/eo/personnel/TrainingStore';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';
import { ComplianceSignalFetcher } from '../../../src/eo/ingestion/ComplianceSignalFetcher';
import { PowerShellFallbackAdapter } from '../../../src/eo/ingestion/PowerShellFallbackAdapter';
import { resolveCollectorIdentity } from '../../../src/eo/evidence/store/collectorIdentity';
import {
  CollectionScheduler, createCollectionScheduleRouter, loopbackAssess, readSchedulerOptions, scheduleDir,
  SCHEDULER_COLLECTIONS, NO_AUTO_FIX, type SchedulerDeps,
} from '../../../src/eo/collect/collectionScheduler';
import type { EcFindingLike } from '../../../src/eo/collect/ecIntegrity';
import { ScriptedTenant } from './scriptedTenant';

jest.mock('../../../src/eo/rendering/RenderOrchestrator', () => ({
  RenderOrchestrator: class { setAdminOpsData() {} async orchestrateRenders() { return new Map(); } },
}));
jest.mock('../../../src/eo/ingestion/PowerShellFallbackAdapter', () => ({
  PowerShellFallbackAdapter: class { async runExchangeCommands() { return []; } async runPurviewCommands() { return []; } },
}));
jest.mock('ces-shared/blob', () => ({
  ...jest.requireActual('../../__mocks__/ces-shared/blob'),
  listBlobs: async () => [],
  downloadBlob: async () => null,
}));

const REGISTRY = path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const SLUG = 'fin24-sched';
const GUID = '00000000-0000-4000-8000-0000000024aa';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe('readSchedulerOptions (FIN-24 configuration)', () => {
  it('defaults: on per D-11, first tick = the daily assess interval, 15-minute ticks, all tenants', () => {
    const o = readSchedulerOptions({}, { enabled: true, intervalHours: 24 });
    expect(o).toEqual({ enabled: true, firstTickMs: DAY, tickMs: 15 * MIN, assessIntervalMs: DAY });
  });
  it('a configurable first tick, tick period and tenant allowlist', () => {
    const o = readSchedulerOptions(
      { CES_EO_COLLECT_FIRST_TICK_SEC: '20', CES_EO_COLLECT_TICK_MIN: '5', CES_EO_COLLECT_TENANTS: 's1-mach, s2-eng' },
      { enabled: true, intervalHours: 0.5 },
    );
    expect(o).toEqual({ enabled: true, firstTickMs: 20_000, tickMs: 5 * MIN, assessIntervalMs: 30 * MIN, tenantAllowlist: ['s1-mach', 's2-eng'] });
    expect(readSchedulerOptions({ CES_EO_COLLECT_FIRST_TICK_SEC: 'x' }, { enabled: false, intervalHours: 24 }).firstTickMs).toBe(DAY);
  });
});

describe('CollectionScheduler (FIN-24, W2.0a) over the real assess route', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let storageRoot: string;
  let session: ScriptedTenant;
  let assessmentStore: AssessmentStore;
  let poamLedgerStore: PoamLedgerStore;
  let scheduler: CollectionScheduler;
  let clock: number;
  let busy = false;
  let ecFindings: EcFindingLike[] | null = [];
  const logs: string[] = [];
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin24-sched-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const stamperRoot = path.join(tmp, 'stamper');
    const dir = path.join(stamperRoot, 'plan-data', SLUG);
    fs.mkdirSync(dir, { recursive: true });
    const cfgPath = path.join(dir, `${SLUG}.json`);
    fs.writeFileSync(cfgPath, JSON.stringify({
      tenant: { tenant_id: GUID, domain: `${SLUG}.example.test` },
      client: { name: SLUG },
      auth: { app_id: '00000000-0000-4000-8000-000000000000', cert_path: 'sim.pfx', cert_thumbprint: 'SIM' },
    }));
    storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    assessmentStore = new AssessmentStore(storageRoot);
    poamLedgerStore = new PoamLedgerStore(storageRoot);
    session = new ScriptedTenant(SLUG, GUID).rebase(Date.now());
    clock = Date.now();

    const config = { storageRoot, tenantSlug: SLUG, tenantConfigPath: cfgPath, registryPath: REGISTRY } as any;
    const deps: SchedulerDeps = {
      storageRoot,
      listTenants: async () => [SLUG],
      ensureSession: async (slug) => {
        if (slug !== SLUG) return { ok: false, reason: 'unknown tenant' };
        const reader = new ComplianceSignalFetcher(session as any, new PowerShellFallbackAdapter({} as any));
        return { ok: true, tenantId: GUID, reader, identity: await resolveCollectorIdentity(session as any), session: 'app_only' };
      },
      runAssess: (slug) => loopbackAssess(base, slug),
      latestSnapshotId: (tenantId) => assessmentStore.loadLatestForTenant(tenantId)?.snapshotId ?? null,
      readDrift: (snapshotId, tenantId) => readDrift(storageRoot, snapshotId, tenantId),
      loadPoamLedger: (slug) => poamLedgerStore.loadLatest(slug),
      readEcFindings: async () => ecFindings,
      isBusy: () => busy,
      now: () => clock,
      logger: { log: (m: string) => logs.push(m), warn: (m: string) => logs.push(m) },
    };
    scheduler = new CollectionScheduler(readSchedulerOptions({}, { enabled: true, intervalHours: 24 }), deps);

    const app = express();
    app.use(createCollectionScheduleRouter({ scheduler, tenantExists: (s) => s === SLUG }));
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: () => session as any,
      assessmentStore, poamStore: new PoamStore(storageRoot), poamLedgerStore,
      policyStore: new PolicyStore(storageRoot), personnelStore: new PersonnelStore(storageRoot),
      screeningElementStore: new ScreeningElementStore(storageRoot), trainingStore: new TrainingStore(storageRoot),
    }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    scheduler.stop();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  let firstSnapshot: string;

  it('tick 1 assesses every registered tenant: collectors, snapshot, drift baseline, POA&M', async () => {
    const [t] = await scheduler.tick();
    expect(t.mode).toBe('assess');
    expect(t.session).toBe('app_only');
    expect(t.assess?.ok).toBe(true);
    expect(t.assess?.snapshotId).toBeTruthy();
    firstSnapshot = t.assess!.snapshotId!;
    expect(assessmentStore.loadLatestForTenant(GUID)?.snapshotId).toBe(firstSnapshot);
    expect(t.assess?.drift?.baseline).toBe(true);
    expect(t.assess?.poamId).toBeTruthy();
    // the assess ran every registered collector
    expect(t.collectors.map(c => c.planId)).toEqual(['C1a', 'C2', 'C3', 'C4', 'C5a', 'C5b', 'C6a', 'C6b', 'C7a', 'C7b', 'C8', 'C8b', 'C9', 'C10']);
    expect(t.noticeIds).toEqual([]);
  }, 120_000);

  it('tick 2 (16 min later) runs only the collectors whose declared cadence elapsed', async () => {
    clock += 16 * MIN;
    const [t] = await scheduler.tick();
    expect(t.mode).toBe('collect');
    expect(t.collectors.map(c => [c.planId, c.cadenceMinutes])).toEqual([
      ['C2', 15], ['C3', 15], ['C4', 15], ['C6a', 15], ['C6b', 15], ['C10', 15],
    ]);
    expect(t.notDue.map(c => [c.planId, c.cadenceMinutes])).toEqual([
      ['C1a', 60], ['C5a', 60], ['C5b', 60], ['C7a', 1440], ['C7b', 1440], ['C8', 1440], ['C8b', 1440], ['C9', 1440],
    ]);
    expect(t.assess).toBeUndefined();
    expect(assessmentStore.loadLatestForTenant(GUID)?.snapshotId).toBe(firstSnapshot); // no new snapshot
  }, 60_000);

  it('tick 3 (next day) re-assesses and detects the drift seeded between ticks; a notice lists each drifted control with its open POA&M items; nothing is fixed', async () => {
    // the seeded drift: the audit log and directory audits stop answering (permission removed)
    session.ualDenied = true;
    session.denied.add('directoryAudits');
    const before = session.calls.length;
    clock += DAY + MIN;
    const [t] = await scheduler.tick();
    expect(t.mode).toBe('assess');
    expect(t.assess?.ok).toBe(true);
    expect(t.assess?.snapshotId).not.toBe(firstSnapshot);
    expect(t.assess?.drift?.previousSnapshotId).toBe(firstSnapshot);
    const drifted = t.assess!.drift!.drifted;
    expect(drifted.length).toBeGreaterThan(0);
    expect(drifted.every(d => d.change === 'regression' || d.change === 'decline')).toBe(true);
    expect(t.noticeIds).toHaveLength(1);
    const [notice] = scheduler.noticesFor(SLUG);
    expect(notice.kind).toBe('drift');
    expect(notice.snapshotId).toBe(t.assess!.snapshotId);
    expect(notice.action).toBe(NO_AUTO_FIX);
    expect(notice.drifted).toEqual(drifted);
    // the drift is on the POA&M: the assess's reconcile opened items for every drifted control
    expect(drifted.map(d => d.controlId)).toEqual(expect.arrayContaining(['AU.L2-3.3.1', 'AU.L2-3.3.2']));
    for (const d of drifted) expect([d.controlId, d.poamItems.length > 0]).toEqual([d.controlId, true]);
    expect(notice.message).toContain('POA&M');
    // drift.json is the router's own record of this snapshot
    expect(readDrift(storageRoot, t.assess!.snapshotId!, GUID)?.summary).toEqual(t.assess!.drift!.summary);
    // no silent auto-fix: the scheduler only read; no command it sent sets or changes anything
    // (the one POST is advanced hunting, a KQL read: /security/runHuntingQuery)
    const sent = session.calls.slice(before).map(c => c.cmd);
    const writes = sent.filter(c => /\b(Set|New|Remove|Update|Enable|Disable|Grant|Revoke)-[A-Z]/.test(c)
      || (/-Method (POST|PATCH|PUT|DELETE)/i.test(c) && !c.includes('/security/runHuntingQuery')));
    expect(writes).toEqual([]);
  }, 120_000);

  it('EC HASH_DRIFT becomes one EO integrity finding with a notice (write-once), whatever the number of ticks', async () => {
    session.ualDenied = false;
    session.denied.clear();
    ecFindings = [
      { findingId: 'ecf-1', checkId: 'HASH_DRIFT', detectedAt: '2026-10-31T10:00:00.000Z', severity: 'high', status: 'open', tenantSlug: SLUG, detail: 'ec:items/eci-x.bin: sha256 changed' },
      { findingId: 'ecf-2', checkId: 'STALE', detectedAt: '2026-10-31T10:00:00.000Z', severity: 'low', status: 'open', tenantSlug: SLUG, detail: 'old' },
    ];
    clock += 16 * MIN;
    const [t1] = await scheduler.tick();
    expect(t1.integrity).toEqual({ reachable: true, newHashDrift: 1 });
    clock += 16 * MIN;
    const [t2] = await scheduler.tick();
    expect(t2.integrity).toEqual({ reachable: true, newHashDrift: 0 });
    const findings = scheduler.integrityFor(SLUG);
    expect(findings.map(f => [f.code, f.ecFindingId, f.source])).toEqual([['HASH_DRIFT', 'ecf-1', 'ces-ec']]);
    expect(scheduler.noticesFor(SLUG).filter(n => n.kind === 'hash_drift').map(n => n.integrityFindingIds)).toEqual([[findings[0].findingId]]);
    // write-once: an overwrite probe on a recorded finding, tick or notice is refused
    const repo = getCesRepository();
    const row = repo.list('eo_integrity_findings', { tenantSlug: SLUG })[0];
    expect(() => repo.put('eo_integrity_findings', { id: row.id, ces: { tenantSlug: SLUG }, data: { tampered: true } })).toThrow(CesWormError);
    const tick = repo.list(SCHEDULER_COLLECTIONS.ticks, { tenantSlug: SLUG })[0];
    expect(() => repo.put(SCHEDULER_COLLECTIONS.ticks, { id: tick.id, ces: { tenantSlug: SLUG }, data: {} })).toThrow(CesWormError);
    expect(() => repo.delete(SCHEDULER_COLLECTIONS.notices, 'x', { tenantSlug: SLUG })).toThrow(CesWormError);
    ecFindings = null;
    clock += 16 * MIN;
    const [t3] = await scheduler.tick();
    expect(t3.integrity.reachable).toBe(false);
  }, 60_000);

  it('a tick is deferred while an operator assess is in flight', async () => {
    busy = true;
    const [t] = await scheduler.tick();
    busy = false;
    expect(t.mode).toBe('deferred');
    expect(t.collectors).toEqual([]);
  });

  it('records are mirrored as JSONL; the routes show status, ticks, notices and integrity findings', async () => {
    const dir = scheduleDir(storageRoot, SLUG);
    const ticks = fs.readFileSync(path.join(dir, 'ticks.jsonl'), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(ticks.map(t => t.mode)).toEqual(['assess', 'collect', 'assess', 'collect', 'collect', 'collect', 'deferred']);
    expect(fs.readFileSync(path.join(dir, 'notices.jsonl'), 'utf-8').trim().split('\n')).toHaveLength(2);

    const status = await (await fetch(`${base}/api/collect/schedule?tenant=${SLUG}`)).json() as any;
    expect(status.ticks).toHaveLength(7);
    expect(status.tenants[SLUG].lastMode).toBe('deferred');
    expect((await (await fetch(`${base}/api/collect/notices?tenant=${SLUG}`)).json() as any[]).map(n => n.kind)).toEqual(['drift', 'hash_drift']);
    expect((await (await fetch(`${base}/api/collect/integrity?tenant=${SLUG}`)).json() as any[])).toHaveLength(1);
    expect((await fetch(`${base}/api/collect/notices`)).status).toBe(400);
    expect((await fetch(`${base}/api/collect/notices?tenant=other`)).status).toBe(404);

    clock += 16 * MIN;
    const r = await fetch(`${base}/api/collect/tick?tenant=${SLUG}`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).mode).toBe('collect');
  }, 60_000);

  it('start() arms the first tick at the configured delay and stop() disarms it', () => {
    const s = new CollectionScheduler(readSchedulerOptions({ CES_EO_COLLECT_FIRST_TICK_SEC: '30' }, { enabled: true, intervalHours: 24 }), {
      ...({} as SchedulerDeps), storageRoot, listTenants: async () => [], now: () => 0, logger: { log: () => {}, warn: () => {} },
    } as SchedulerDeps);
    s.start();
    expect(s.status().started).toBe(true);
    expect(s.status().nextTickAt).toBe(new Date(30_000).toISOString());
    s.stop();
    expect(s.status().started).toBe(false);
    const off = new CollectionScheduler(readSchedulerOptions({}, { enabled: false, intervalHours: 24 }), { storageRoot } as SchedulerDeps);
    off.start();
    expect(off.status().started).toBe(false);
  });
});
