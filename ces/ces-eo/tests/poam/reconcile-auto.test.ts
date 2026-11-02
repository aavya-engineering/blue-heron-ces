// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W3 through the REAL assessment router (harness as in assess-policy-invariance):
 * every /api/assess now (a) compares its snapshot with the tenant's previous stored one, writes
 * assessments/<snapshotId>/drift.json and sends a `drift` SSE event whose `regressions[]` lists the
 * controls that were met and are now worse, and (b) reconciles the stored POA&M lifecycle ledger
 * automatically (`poam_reconciled`): new deficiencies open, remediated ones close, history is kept.
 * The state is moved between passes by rewriting one Stamper evidence file (SAT -> NOT_SAT -> SAT),
 * the same mechanism as the harness's forced E8F pass. No Graph session, no simulator.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createAssessmentRouter } from '../../src/eo/server/routers/assessment-router';
import { AssessmentStore } from '../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../src/eo/poam/PoamStore';
import { PoamLedgerStore } from '../../src/eo/poam/PoamLedgerStore';
import { PolicyStore } from '../../src/eo/policies/PolicyStore';
import { PersonnelStore } from '../../src/eo/personnel/PersonnelStore';
import { TrainingStore } from '../../src/eo/personnel/TrainingStore';
import { ScreeningElementStore } from '../../src/eo/personnel/ScreeningElementStore';

jest.mock('../../src/eo/rendering/RenderOrchestrator', () => ({
  RenderOrchestrator: class { setAdminOpsData() {} async orchestrateRenders() { return new Map(); } },
}));

jest.mock('ces-shared/blob', () => ({
  ...jest.requireActual('../__mocks__/ces-shared/blob'),
  listBlobs: async () => [],
  downloadBlob: async () => null,
}));

const REGISTRY = path.resolve(__dirname, '../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const SLUG = 'w3-auto-reconcile';
const GUID = '00000000-0000-4000-8000-0000000033aa';
const CONTROL = 'AC.L1-3.1.1';

describe('W3: drift, regression alerts and the automatic POA&M reconcile on every /api/assess', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let storageRoot: string;
  let evFile: string;
  let assessmentStore: AssessmentStore;
  let poamLedgerStore: PoamLedgerStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  // A state-verified Stamper file for AC.L1-3.1.1, written now (fresh), SAT or NOT_SAT.
  const writeEvidence = (verdict: 'SAT' | 'NOT_SAT'): void => {
    fs.writeFileSync(evFile, JSON.stringify({
      rawResponse: '{"value":[{"id":"caPolicy-1"}]}',
      complianceVerdict: verdict,
      outcomeRationale: verdict === 'SAT' ? 'Command completed successfully (exit code 0)' : 'Expected state not found after execution',
      registryEntry: { entry_id: 'AC.L1-3.1.1.ca-policy', label: 'Create Conditional Access Policy', control_ids: [CONTROL] },
      metadata: { controlIds: [CONTROL], timestamp: new Date().toISOString(), commandExecuted: 'New-MgIdentityConditionalAccessPolicy', sha256Hash: 'x' },
    }));
  };

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w3-auto-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const evDir = path.join(process.env.CES_PIPELINE_ROOT, 'Stamper', 'plan-data', SLUG, 'evidence', 'access_control');
    fs.mkdirSync(evDir, { recursive: true });
    evFile = path.join(evDir, 'ac.l1-3.1.1.ca-policy.json');
    writeEvidence('SAT');

    const stamperRoot = path.join(tmp, 'stamper');
    const dir = path.join(stamperRoot, 'plan-data', SLUG);
    fs.mkdirSync(dir, { recursive: true });
    const cfgPath = path.join(dir, `${SLUG}.json`);
    fs.writeFileSync(cfgPath, JSON.stringify({
      tenant: { tenant_id: GUID, domain: `${SLUG}.example.test` },
      client: { name: SLUG },
      auth: { app_id: '00000000-0000-4000-8000-000000000000', cert_path: 'sim.pfx', cert_thumbprint: 'SIM' },
      evidence_storage: { account_name: 'acct-w3', account_key: 'sim-key', container: 'evidence', base_path: '', blob_endpoint: 'http://127.0.0.1:1/never-called' },
    }));

    storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    assessmentStore = new AssessmentStore(storageRoot);
    poamLedgerStore = new PoamLedgerStore(storageRoot);
    const config = { storageRoot, tenantSlug: SLUG, tenantConfigPath: cfgPath, registryPath: REGISTRY } as any;
    const app = express();
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: () => null,
      assessmentStore, poamStore: new PoamStore(storageRoot), poamLedgerStore,
      policyStore: new PolicyStore(storageRoot), personnelStore: new PersonnelStore(storageRoot),
      screeningElementStore: new ScreeningElementStore(storageRoot), trainingStore: new TrainingStore(storageRoot),
    }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  async function assess(forced = false): Promise<{ events: any[]; drift: any; reconciled: any; snapshotId: string }> {
    const r = await fetch(`${base}/api/assess?tenant=${SLUG}${forced ? '&forced=1' : ''}`);
    expect(r.status).toBe(200);
    const events = (await r.text()).split('\n\n').filter(f => f.startsWith('data: ')).map(f => JSON.parse(f.slice(6)));
    expect(events.find(e => e.type === 'assess_error' || e.type === 'drift_error' || e.type === 'poam_reconcile_failed')).toBeUndefined();
    const types = events.map(e => e.type);
    // Order: POA&M generated, then drift, then the reconcile, all before the summary.
    expect(types.indexOf('poam_generated')).toBeLessThan(types.indexOf('drift'));
    expect(types.indexOf('drift')).toBeLessThan(types.indexOf('poam_reconciled'));
    expect(types.indexOf('poam_reconciled')).toBeLessThan(types.indexOf('assess_summary'));
    return {
      events,
      drift: events.find(e => e.type === 'drift'),
      reconciled: events.find(e => e.type === 'poam_reconciled'),
      snapshotId: events.find(e => e.type === 'assess_summary').snapshotId,
    };
  }

  const itemsOf = (key: string) => poamLedgerStore.loadLatest(SLUG)!.items.filter(i => i.controlId === key);

  it('runs a baseline, then no change, then a regression, then the remediation, and keeps the POA&M history', async () => {
    // 1. Baseline: no previous snapshot. Every deficiency opens.
    const p1 = await assess();
    expect(p1.drift).toMatchObject({ baseline: true, previousSnapshotId: null, empty: true, regressions: [] });
    const opened = p1.reconciled.summary.newThisRun;
    expect(opened).toBeGreaterThan(0);
    expect(p1.reconciled.summary).toMatchObject({ carriedForward: 0, closedThisRun: 0 });
    const stored1 = poamLedgerStore.loadLatest(SLUG)!;
    expect(stored1.poamId).toBe(p1.reconciled.poamId);
    expect(itemsOf(CONTROL)).toEqual([]);   // met on its SAT file: no item

    // 2. Same state: no regression; everything carried forward, nothing new or closed.
    // FIN-27 (FD-4): EO's own records now exist (p1 and its POA&M ledger), so CA.L2-3.12.1 and 3.12.2 improve
    // not_assessed -> met on this second assess; 3.12.3 needs two prior assessments (it improves at step 3).
    const p2 = await assess();
    expect(p2.drift).toMatchObject({ baseline: false, previousSnapshotId: p1.snapshotId, regressions: [] });
    expect(p2.drift.summary).toMatchObject({ regressions: 0, declines: 0, improvements: 2 });
    // FIN-27: the CA items of those two controls auto-close; nothing else opens or closes.
    const caClosed = (ids: string[]) => poamLedgerStore.loadLatest(SLUG)!.items.filter(i => ids.includes(i.controlId) && i.status === 'closed').length;
    const ca2 = caClosed(['CA.L2-3.12.1', 'CA.L2-3.12.2']);
    expect(ca2).toBeGreaterThan(0);
    expect(p2.reconciled.summary).toMatchObject({ newThisRun: 0, closedThisRun: ca2, carriedForward: opened - ca2 });

    // 3. The Stamper file turns NOT_SAT (the forced-failure shape): a regression alert, new items.
    writeEvidence('NOT_SAT');
    const p3 = await assess();
    expect(p3.drift.regressions).toEqual([{
      controlId: CONTROL, change: 'regression',
      previous: { status: 'met', tier: 3, source: 'evidence_import/imported' },
      current: { status: 'not_met', tier: 1, source: 'evidence_import/missing' },
    }]);
    expect(p3.drift.summary).toMatchObject({ regressions: 1, improvements: 1, declines: 0 }); // FIN-27: CA.L2-3.12.3 met (two prior assessments)
    const newItems = itemsOf(CONTROL);
    expect(newItems.length).toBeGreaterThan(0);
    expect(newItems.every(i => i.status === 'open' && i.history.map(h => h.event).join() === 'opened')).toBe(true);
    const ca3 = caClosed(['CA.L2-3.12.3']);
    expect(ca3).toBeGreaterThan(0);
    const caAll = ca2 + ca3;
    expect(p3.reconciled.summary).toMatchObject({ newThisRun: newItems.length, carriedForward: opened - caAll, closedThisRun: ca3 });

    // The drift file sits beside the snapshot and GET /api/drift serves it.
    const file = path.join(storageRoot, 'assessments', p3.snapshotId, 'drift.json');
    expect(fs.existsSync(file)).toBe(true);
    const served = await (await fetch(`${base}/api/drift?tenant=${SLUG}`)).json();
    expect(served).toEqual(JSON.parse(fs.readFileSync(file, 'utf-8')));
    expect(served).toMatchObject({ schema: 'ces-eo/drift@1', tenantId: GUID, snapshotId: p3.snapshotId, previousSnapshotId: p2.snapshotId });
    expect(served.objectives.filter((o: any) => o.controlId === CONTROL).every((o: any) => o.change === 'regression')).toBe(true);
    const older = await (await fetch(`${base}/api/drift?tenant=${SLUG}&snapshotId=${p1.snapshotId}`)).json();
    expect(older).toMatchObject({ snapshotId: p1.snapshotId, baseline: true });

    // 4. Remediated: an improvement, the items auto-close and stay in the ledger with their history.
    writeEvidence('SAT');
    const p4 = await assess();
    expect(p4.drift.regressions).toEqual([]);
    expect(p4.drift.summary).toMatchObject({ improvements: 1 });
    expect(p4.reconciled.summary).toMatchObject({ newThisRun: 0, closedThisRun: newItems.length, carriedForward: opened - caAll });
    const closed = itemsOf(CONTROL);
    expect(closed.map(i => i.key)).toEqual(newItems.map(i => i.key));
    expect(closed.every(i => i.status === 'closed' && i.history.map(h => h.event).join() === 'opened,auto-closed')).toBe(true);

    // The on-demand route is kept: it reconciles the same deficiencies, so nothing opens or closes.
    const route = await (await fetch(`${base}/api/poam/reconcile?tenant=${SLUG}`)).json();
    expect(route.summary).toMatchObject({ newThisRun: 0, closedThisRun: 0, carriedForward: opened - caAll, closed: newItems.length + caAll });
    expect(route.items.map((i: any) => [i.key, i.status])).toEqual(poamLedgerStore.loadLatest(SLUG)!.items.map(i => [i.key, i.status]));
  });

  it('forced=1 stores metadata.forced; the forced snapshot gets its own drift record, and the next assess baselines on the last non-forced one', async () => {
    writeEvidence('SAT');
    const before = await assess();
    expect(assessmentStore.listFullSnapshotsForTenant(GUID).find(x => x.snapshotId === before.snapshotId)?.metadata).toBeUndefined();

    // The forced pass (E8F shape): stored with the flag; its drift is against the last non-forced snapshot.
    writeEvidence('NOT_SAT');
    const forced = await assess(true);
    expect(assessmentStore.listFullSnapshotsForTenant(GUID).find(x => x.snapshotId === forced.snapshotId)?.metadata).toEqual({ forced: true });
    expect(assessmentStore.loadForTenant(GUID, forced.snapshotId)).toMatchObject({ metadata: { forced: true } });
    expect(forced.drift).toMatchObject({ previousSnapshotId: before.snapshotId });
    expect(forced.drift.regressions.map((r: any) => r.controlId)).toEqual([CONTROL]);

    // Next run's pass 1: same state as before the forced pass. Baseline skips the forced snapshot: no drift.
    writeEvidence('SAT');
    const next = await assess();
    expect(next.drift).toMatchObject({ baseline: false, previousSnapshotId: before.snapshotId, empty: true, regressions: [] });
  });

  it('GET /api/drift: 400 without a tenant, 404 for a snapshot that is not this tenant\'s', async () => {
    expect((await fetch(`${base}/api/drift`)).status).toBe(400);
    expect((await fetch(`${base}/api/drift?tenant=${SLUG}&snapshotId=not-a-snapshot`)).status).toBe(404);
  });
});
