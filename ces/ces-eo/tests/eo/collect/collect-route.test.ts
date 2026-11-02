// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2.0: `POST /api/collect?tenant=` and the E7 hook in `GET /api/assess`, through the
 * REAL assessment router over HTTP with real stores in a temp root. The tenant's bound session is a
 * scripted double (tests/eo/collect/scriptedTenant.ts); the Exchange/Purview fallback adapter is
 * stubbed (it would spawn PowerShell). No sim, no network.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createAssessmentRouter } from '../../../src/eo/server/routers/assessment-router';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../../src/eo/poam/PoamStore';
import { PoamLedgerStore } from '../../../src/eo/poam/PoamLedgerStore';
import { PolicyStore } from '../../../src/eo/policies/PolicyStore';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { TrainingStore } from '../../../src/eo/personnel/TrainingStore';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
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
const SLUG = 'w2-collect';
const GUID = '00000000-0000-4000-8000-0000000002aa';

describe('POST /api/collect and the /api/assess collection hook (W2.0)', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let storageRoot: string;
  let session: ScriptedTenant | null;
  let assessmentStore: AssessmentStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w2-collect-'));
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
    const config = { storageRoot, tenantSlug: SLUG, tenantConfigPath: cfgPath, registryPath: REGISTRY } as any;
    const app = express();
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: () => session as any,
      assessmentStore, poamStore: new PoamStore(storageRoot), poamLedgerStore: new PoamLedgerStore(storageRoot),
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

  const store = () => EvidenceStore.forStorageRoot(storageRoot, GUID);

  it('400 without a tenant; 409 when the only session is bound to another tenant', async () => {
    session = new ScriptedTenant('another-tenant', '00000000-0000-4000-8000-0000000009ff');
    expect((await fetch(`${base}/api/collect`, { method: 'POST' })).status).toBe(400);
    expect((await fetch(`${base}/api/collect?tenant=${SLUG}`, { method: 'POST' })).status).toBe(409);
    expect(session.calls).toEqual([]);
  });

  // W2 part 2: both tests rebase the fixtures to one instant, so the versioned sources (alerts and
  // incidents by lastUpdateDateTime) carry the same ids in both collections.
  const REBASE = Date.now();

  it('POST /api/collect runs the registered collectors once on the tenant\'s own session and answers with counts', async () => {
    session = new ScriptedTenant(SLUG, GUID).rebase(REBASE);
    const r = await fetch(`${base}/api/collect?tenant=${SLUG}`, { method: 'POST' });
    expect(r.status).toBe(200);
    const body = await r.json() as any;
    expect(body.tenantId).toBe(GUID);
    expect(body.collectors.map((c: any) => [c.planId, c.status, c.newItems])).toEqual([
      ['C1a', 'success', 5], ['C2', 'success', 4], ['C3', 'success', 2], ['C4', 'success', 2],
      ['C5a', 'success', 2], ['C5b', 'success', 1], ['C6a', 'success', 3], ['C6b', 'success', 2],
      ['C7a', 'success', 2], ['C7b', 'success', 3], ['C8', 'success', 2], ['C8b', 'success', 3], ['C9', 'success', 3],
      ['C10', 'empty', 0],
    ]);
    // W2 part 3: thirteen collectors (C8b added), so twelve Graph records; synthetic-customer W2: C10 adds one empty record
    expect(body.recorded).toBe(7 + 12 + 1); // seven 24-hour UAL windows plus one record per Graph collector
    expect(JSON.stringify(body)).not.toContain('example.test'); // counts only, no rows
    expect(store().verify().ok).toBe(true);
  });

  it('GET /api/assess collects before it fetches, records only the fetched reads itself, and the views reach the mapper', async () => {
    session = new ScriptedTenant(SLUG, GUID).rebase(REBASE);
    const before = store().records().length;
    const res = await fetch(`${base}/api/assess?tenant=${SLUG}`);
    const events = (await res.text()).split('\n\n').filter(f => f.startsWith('data: ')).map(f => JSON.parse(f.slice(6)));
    const types = events.map(e => e.type);
    expect(types).toContain('assess_done');
    expect(types.indexOf('collect')).toBeGreaterThan(-1);
    expect(types.indexOf('collect')).toBeLessThan(types.indexOf('signal_fetch'));
    const collect = events.find(e => e.type === 'collect');
    // the second collection of the same rows: nothing new for C2 to C9
    expect(collect.collectors.filter((c: any) => c.planId !== 'C1a').map((c: any) => [c.planId, c.status, c.newItems]))
      .toEqual(['C2', 'C3', 'C4', 'C5a', 'C5b', 'C6a', 'C6b', 'C7a', 'C7b', 'C8', 'C8b', 'C9', 'C10'].map((id) => [id, 'empty', 0]));

    // collector commands come first, then the fetch (its first Graph read is the CA policy cmdlet)
    const firstFetch = session!.calls.findIndex(c => c.cmd.startsWith('Get-MgIdentityConditionalAccessPolicy'));
    // the last collector command is C9's managed-device compliance read
    const lastCollect = session!.calls.map(c => c.cmd).lastIndexOf(session!.calls.filter(c => c.cmd.includes('complianceState,lastSyncDateTime')).at(-1)!.cmd);
    expect(firstFetch).toBeGreaterThan(lastCollect);

    const added = store().records().slice(before);
    const fromCollectors = added.filter(r => r.collector.name.startsWith('ces-eo/collect/'));
    const fromFetch = added.filter(r => r.collector.name === 'ces-eo/ComplianceSignalFetcher');
    expect(fromCollectors.map(r => r.sourceId).filter((s, i, a) => a.indexOf(s) === i))
      .toEqual(['collect.stamperEvidence', 'collect.unifiedAuditLog', 'collect.directoryAudits', 'collect.signIns', 'collect.pimActivations',
        'collect.riskDetections', 'collect.riskyUsers', 'collect.securityAlerts', 'collect.securityIncidents',
        'collect.tvmAssessmentRecency', 'collect.tvmVulnerabilities', 'collect.secureScores', 'collect.secureScoreControlProfiles', 'collect.deviceCompliance', 'collect.adminOps']);
    expect(fromFetch.length).toBeGreaterThan(0);
    expect(fromFetch.some(r => r.sourceId.startsWith('collect.'))).toBe(false);
    expect(store().verify().ok).toBe(true);

    const snap = assessmentStore.loadLatestForTenant(GUID)!;
    const ctl = (id: string) => snap.controls.find((c: any) => c.control_id === id) as any;
    for (const id of ['AU.L2-3.3.1', 'AU.L2-3.3.2', 'AU.L2-3.3.6', 'AC.L2-3.1.7']) expect([id, ctl(id).status]).toEqual([id, 'met']);
  }, 60_000);
});
