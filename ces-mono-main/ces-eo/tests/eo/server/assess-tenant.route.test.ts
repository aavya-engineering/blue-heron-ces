// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-EO8 — test harness for GET /api/assess (the SSE assessment pipeline), covering the two
 * d5c6f57 fixes that had no dedicated test:
 *   1. Phase 2 reads blob evidence from the ASSESSED tenant's blob account (it read the server
 *      default tenant's account);
 *   2. the auto-generated POA&M is saved under the ASSESSED tenant (it was saved under
 *      config.tenantSlug).
 * Also: /api/assess without ?tenant= is a 400 (no fallback to the server default tenant).
 *
 * Drives the REAL assessment router over HTTP with real stores in a temp storage root / ces.db.
 * Two tenants, A (the server default) and B, each with its own blob account holding one evidence
 * artifact for a different control. Only the blob transport (network I/O to Azure) is replaced,
 * by an in-memory store keyed by storage account, and the docx render pipeline (unloadable under
 * ts-jest; no render directives here) is stubbed. No Graph session, so Phase 4 is skipped. Sim only.
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

jest.mock('../../../src/eo/rendering/RenderOrchestrator', () => ({
  RenderOrchestrator: class { setAdminOpsData() {} async orchestrateRenders() { return new Map(); } },
}));

const T = {
  A: { slug: 'fxeo8-assess-a', guid: '00000000-0000-4000-8000-00000008a55a', acct: 'acct-assess-a', art: 'aaaaaaaa-0000-4000-8000-0000000008a1', control: 'AC.L1-3.1.1' },
  B: { slug: 'fxeo8-assess-b', guid: '00000000-0000-4000-8000-00000008a55b', acct: 'acct-assess-b', art: 'bbbbbbbb-0000-4000-8000-0000000008b1', control: 'SC.L1-3.13.1' },
};

const artifact = (t: typeof T.A) => JSON.stringify({
  artifactId: t.art, runId: `run-${t.slug}`, capturedAt: '2026-09-27T12:00:00Z', source: 'graph', checkId: `chk-${t.slug}`,
  controlIds: [t.control], sha256: 'x',
});
const mockBlobs: Record<string, Record<string, string>> = {
  [T.A.acct]: { [`artifacts/run-a/${T.A.art}.json`]: artifact(T.A) },
  [T.B.acct]: { [`artifacts/run-b/${T.B.art}.json`]: artifact(T.B) },
};
const mockListed: string[] = [];
jest.mock('ces-shared/blob', () => ({
  ...jest.requireActual('../../__mocks__/ces-shared/blob'),
  listBlobs: async (cfg: { account_name: string }, prefix: string) => {
    mockListed.push(cfg.account_name);
    return Object.keys(mockBlobs[cfg.account_name] ?? {}).filter(n => n.startsWith(prefix)).map(name => ({ name }));
  },
  downloadBlob: async (cfg: { account_name: string }, name: string) => mockBlobs[cfg.account_name]?.[name] ?? null,
}));

const REGISTRY = path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');

describe('FX-EO8: /api/assess reads the assessed tenant\'s blob evidence and saves its POA&M under that tenant', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let assessmentStore: AssessmentStore;
  let poamStore: PoamStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-eo8-assess-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    const cfgPath: Record<string, string> = {};
    for (const t of [T.A, T.B]) {
      const dir = path.join(stamperRoot, 'plan-data', t.slug);
      fs.mkdirSync(dir, { recursive: true });
      cfgPath[t.slug] = path.join(dir, `${t.slug}.json`);
      fs.writeFileSync(cfgPath[t.slug], JSON.stringify({
        tenant: { tenant_id: t.guid, domain: `${t.slug}.example.test` },
        client: { name: t.slug },
        // loadTenantConfig's required fields; never used (no Graph session in this harness).
        auth: { app_id: '00000000-0000-4000-8000-000000000000', cert_path: 'sim.pfx', cert_thumbprint: 'SIM' },
        evidence_storage: {
          account_name: t.acct, account_key: 'sim-key', container: 'evidence', base_path: '',
          blob_endpoint: 'http://127.0.0.1:1/never-called',
        },
      }));
    }
    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    assessmentStore = new AssessmentStore(storageRoot);
    poamStore = new PoamStore(storageRoot);

    // The server's DEFAULT tenant is A — the old fallback target for B's blob read and POA&M.
    const config = { storageRoot, tenantSlug: T.A.slug, tenantConfigPath: cfgPath[T.A.slug], registryPath: REGISTRY } as any;
    const app = express();
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: () => null,
      assessmentStore, poamStore, poamLedgerStore: new PoamLedgerStore(storageRoot),
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

  /** Run the SSE pipeline to completion and return its events. */
  async function assess(slug: string): Promise<any[]> {
    const r = await fetch(`${base}/api/assess?tenant=${slug}`);
    expect(r.status).toBe(200);
    const text = await r.text();
    return text.split('\n\n').filter(f => f.startsWith('data: ')).map(f => JSON.parse(f.slice(6)));
  }

  const blobArtifactIds = (tenantGuid: string) => {
    const snap = assessmentStore.loadLatestForTenant(tenantGuid);
    expect(snap).not.toBeNull();
    return snap!.controls.flatMap(c => (c as any).evidenceArtifactIds ?? []);
  };

  it("assessing B (not the default tenant) reads only B's blob account and saves B's POA&M under B", async () => {
    mockListed.length = 0;
    const events = await assess(T.B.slug);
    expect(events.map(e => e.type)).toContain('assess_done');
    expect(events.find(e => e.type === 'assess_error')).toBeUndefined();
    expect(events.find(e => e.type === 'poam_generated')).toBeDefined();

    // 1. blob evidence: B's account only, B's artifact only, on B's control only.
    expect(mockListed).toEqual([T.B.acct]);
    expect(blobArtifactIds(T.B.guid)).toEqual([T.B.art]);
    const snapB = assessmentStore.loadLatestForTenant(T.B.guid)!;
    expect(snapB.controls.find(c => c.control_id === T.B.control)!.sources.some(s => s.type === 'blob_artifact')).toBe(true);
    expect(snapB.controls.find(c => c.control_id === T.A.control)!.sources.some(s => s.type === 'blob_artifact')).toBe(false);
    expect(assessmentStore.loadLatestForTenant(T.A.guid)).toBeNull();

    // 2. POA&M: saved under B, nothing written for the default tenant A.
    const poamB = poamStore.loadLatest(T.B.slug);
    expect(poamB).not.toBeNull();
    expect(poamStore.loadLatest(T.A.slug)).toBeNull();
  });

  it("assessing A afterwards sees only A's evidence and does not disturb B's", async () => {
    mockListed.length = 0;
    const events = await assess(T.A.slug);
    expect(events.map(e => e.type)).toContain('assess_done');
    expect(mockListed).toEqual([T.A.acct]);
    expect(blobArtifactIds(T.A.guid)).toEqual([T.A.art]);
    expect(blobArtifactIds(T.B.guid)).toEqual([T.B.art]);
    expect(poamStore.loadLatest(T.A.slug)).not.toBeNull();
  });

  it('no tenant → 400 (no server-default fallback); unknown tenant → 404; nothing is assessed', async () => {
    mockListed.length = 0;
    expect((await fetch(`${base}/api/assess`)).status).toBe(400);
    expect((await fetch(`${base}/api/assess?tenant=no-such-tenant`)).status).toBe(404);
    expect(mockListed).toEqual([]);
  });
});
