// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-EO8 — tenant scoping for the last EvidenceOps routes that read "whatever was saved last"
 * or fell back to the server's default tenant:
 *   - assessment reads (/api/assessment, /api/sprs, /api/sprs/history, /api/controls[/:id],
 *     /api/ledger, /api/poam/reconcile, /api/personas, /api/persona/:id, /api/assessor-view,
 *     /assessor) read the REQUESTED tenant's own snapshots;
 *   - /api/packages and /api/package/download/:filename use a per-tenant folder;
 *   - the risk-assessment, timeline and policies routers require the tenant (400 / 404);
 *   - a risk-register write replicates into the requesting tenant's blob account.
 *
 * Drives the REAL routers over HTTP with real stores in a temp storage root / ces.db. Only the
 * blob transport (network I/O to Azure) is replaced, by an in-memory store keyed by storage
 * account, so the test can see WHICH tenant's account a write went to. The server's default
 * tenant is A. Snapshots are saved A first, then B, so the store's "last saved" pointer is B:
 * a request for A that silently used the pointer would get B's data. Sim only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createAssessmentRouter } from '../../../src/eo/server/routers/assessment-router';
import { createEvidenceRouter } from '../../../src/eo/server/routers/evidence-router';
import { createRiskAssessmentRouter } from '../../../src/eo/server/routers/risk-assessment-router';
import { createTimelineRouter } from '../../../src/eo/server/routers/timeline-router';
import { createPoliciesRouter } from '../../../src/eo/server/routers/policies-router';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../../src/eo/poam/PoamStore';
import { PoamLedgerStore } from '../../../src/eo/poam/PoamLedgerStore';
import { PolicyStore } from '../../../src/eo/policies/PolicyStore';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { TrainingStore } from '../../../src/eo/personnel/TrainingStore';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';
import { RiskAssessmentStore } from '../../../src/eo/risk-assessment/RiskAssessmentStore';

const mockUploads: Array<{ account: string; name: string }> = [];
jest.mock('ces-shared/blob', () => ({
  ...jest.requireActual('../../__mocks__/ces-shared/blob'),
  uploadEvidenceBlob: async (cfg: { account_name: string }, name: string) => { mockUploads.push({ account: cfg.account_name, name }); },
  listBlobs: async () => [],
  downloadBlob: async () => null,
}));

// The render pipeline (docx via createRequire(import.meta.url)) cannot load under ts-jest's CJS
// transform, and it is not tenant-relevant here (no render directives). Stub it only.
jest.mock('../../../src/eo/rendering/RenderOrchestrator', () => ({
  RenderOrchestrator: class { setAdminOpsData() {} async orchestrateRenders() { return new Map(); } },
}));

const REGISTRY = path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const T = {
  A: { slug: 'fxeo8-tenant-a', guid: '00000000-0000-4000-8000-0000000008aa', acct: 'acct-8a', snap: '8aaaaaaa-0000-4000-8000-000000000001', score: 88, notMet: 'AU.L2-3.3.1' },
  B: { slug: 'fxeo8-tenant-b', guid: '00000000-0000-4000-8000-0000000008bb', acct: 'acct-8b', snap: '8bbbbbbb-0000-4000-8000-000000000001', score: 42, notMet: 'SC.L2-3.13.8' },
};

function snapshot(t: typeof T.A, generatedAt: string) {
  return {
    snapshotId: t.snap, tenantId: t.guid, generatedAt, sprs_score: t.score,
    controls_met: 1, controls_not_met: 1, controls_partial: 0, controls_not_assessed: 0,
    controls: [
      { control_id: 'AC.L1-3.1.1', nist_ref: '3.1.1', status: 'met', sources: [], evidenceArtifactIds: [] },
      { control_id: t.notMet, nist_ref: t.notMet.replace(/^[A-Z]+\.L\d-/, ''), status: 'not_met', sources: [], evidenceArtifactIds: [] },
    ],
  } as any;
}

describe('FX-EO8: assessment reads, packages, risk/timeline/policies are scoped to the requested tenant', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let storageRoot: string;
  let riskStore: RiskAssessmentStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-eo8-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    for (const t of [T.A, T.B]) {
      const dir = path.join(stamperRoot, 'plan-data', t.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${t.slug}.json`), JSON.stringify({
        tenant: { tenant_id: t.guid },
        evidence_storage: {
          account_name: t.acct, account_key: 'sim-key', container: 'evidence', base_path: '',
          blob_endpoint: 'http://127.0.0.1:1/never-called',
        },
      }));
    }
    storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });

    const assessmentStore = new AssessmentStore(storageRoot);
    assessmentStore.save(snapshot(T.A, '2026-09-27T10:00:00Z'));
    assessmentStore.save(snapshot(T.B, '2026-09-27T11:00:00Z')); // B saved last → the old pointer is B

    // Per-tenant packages already on disk (what /api/package/build writes since FX-EO8).
    for (const t of [T.A, T.B]) {
      fs.mkdirSync(path.join(storageRoot, 'packages', t.slug), { recursive: true });
      fs.writeFileSync(path.join(storageRoot, 'packages', t.slug, `pkg-${t.slug}.zip`), `zip-of-${t.slug}`);
    }

    const config = { storageRoot, tenantSlug: T.A.slug, registryPath: REGISTRY } as any;
    const poamStore = new PoamStore(storageRoot);
    const policyStore = new PolicyStore(storageRoot);
    const personnelStore = new PersonnelStore(storageRoot);
    riskStore = new RiskAssessmentStore(storageRoot);
    const app = express();
    app.use(express.json());
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: () => null,
      assessmentStore, poamStore, poamLedgerStore: new PoamLedgerStore(storageRoot),
      policyStore, personnelStore,
      screeningElementStore: new ScreeningElementStore(storageRoot),
      trainingStore: new TrainingStore(storageRoot),
    }));
    app.use(createEvidenceRouter({
      config, stamperRoot, assessmentStore, personnelStore, riskAssessmentStore: riskStore,
      policyStore, poamStore,
      getSessionManager: () => null,
      captureSignals: async () => ({ capturedCount: 0, errors: [] }),
      getLastCaptureRun: () => null,
    }));
    // Production default replicator factory (no test injection).
    app.use(createRiskAssessmentRouter({ config, riskAssessmentStore: riskStore, assessmentStore, stamperRoot, getSessionManager: () => null }));
    app.use(createTimelineRouter({ config, assessmentStore, stamperRoot }));
    app.use(createPoliciesRouter({ config, stamperRoot, policyStore }));
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

  const get = (p: string) => fetch(base + p);
  const send = (method: string, p: string, body: unknown = {}) => fetch(base + p, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const q = (t: typeof T.A) => `?tenant=${t.slug}`;

  describe('assessment reads', () => {
    it("/api/assessment returns each tenant's own snapshot (A is not the last-saved B)", async () => {
      for (const t of [T.A, T.B]) {
        const r = await get(`/api/assessment${q(t)}`);
        expect(r.status).toBe(200);
        const body = await r.json();
        expect({ t: t.slug, snap: body.snapshotId, tenantId: body.tenantId }).toEqual({ t: t.slug, snap: t.snap, tenantId: t.guid });
      }
    });

    it("/api/sprs deductions and /api/sprs/history come from the tenant's own snapshots", async () => {
      for (const t of [T.A, T.B]) {
        const other = t === T.A ? T.B : T.A;
        const sprs = await (await get(`/api/sprs${q(t)}`)).json();
        const notMet = sprs.deductions.filter((d: any) => d.status === 'not_met').map((d: any) => d.control_id);
        expect(notMet).toEqual([t.notMet]);
        expect(notMet).not.toContain(other.notMet);
        const hist = await (await get(`/api/sprs/history${q(t)}`)).json();
        expect(hist.map((h: any) => h.snapshotId)).toEqual([t.snap]);
      }
    });

    it('/api/controls and /api/controls/:id read the tenant\'s own snapshot', async () => {
      const a = await (await get(`/api/controls${q(T.A)}`)).json();
      expect(a.map((c: any) => c.control_id)).toEqual(['AC.L1-3.1.1', T.A.notMet]);
      expect((await get(`/api/controls/${T.A.notMet}${q(T.A)}`)).status).toBe(200);
      expect((await get(`/api/controls/${T.B.notMet}${q(T.A)}`)).status).toBe(404);
    });

    it('ledger, POA&M reconcile, personas, assessor view and /assessor are built from the tenant\'s own snapshot', async () => {
      for (const t of [T.A, T.B]) {
        const ledger = await get(`/api/ledger${q(t)}`);
        expect(ledger.status).toBe(200);
        expect((await ledger.json()).tenantId).toBe(t.guid);
        const rec = await get(`/api/poam/reconcile${q(t)}`);
        expect(rec.status).toBe(200);
        expect((await rec.json()).tenantId).toBe(t.guid);
        expect((await get(`/api/personas${q(t)}`)).status).toBe(200);
        expect((await get(`/api/persona/P1${q(t)}`)).status).toBe(200);
        const view = await get(`/api/assessor-view${q(t)}`);
        expect(view.status).toBe(200);
        expect(JSON.stringify(await view.json())).toContain(t.guid);
        const html = await get(`/assessor${q(t)}`);
        expect(html.status).toBe(200);
        expect(await html.text()).toContain(t.guid);
      }
    });

    it('a known tenant with no assessment gets 404, never another tenant\'s snapshot', async () => {
      // Register a third tenant C with no snapshot; the old code returned the pointer (B).
      const stamperRoot = path.join(tmp, 'stamper');
      const slug = 'fxeo8-tenant-c';
      fs.mkdirSync(path.join(stamperRoot, 'plan-data', slug), { recursive: true });
      fs.writeFileSync(path.join(stamperRoot, 'plan-data', slug, `${slug}.json`),
        JSON.stringify({ tenant: { tenant_id: '00000000-0000-4000-8000-0000000008cc' } }));
      for (const p of ['/api/assessment', '/api/sprs', '/api/controls', '/api/ledger', '/api/assessor-view']) {
        expect({ p, status: (await get(`${p}?tenant=${slug}`)).status }).toEqual({ p, status: 404 });
      }
      expect(await (await get(`/api/sprs/history?tenant=${slug}`)).json()).toEqual([]);
    });
  });

  describe('packages', () => {
    it('/api/packages lists only the requested tenant\'s packages', async () => {
      for (const t of [T.A, T.B]) {
        const r = await get(`/api/packages${q(t)}`);
        expect(r.status).toBe(200);
        expect((await r.json()).map((p: any) => p.filename)).toEqual([`pkg-${t.slug}.zip`]);
      }
    });

    it('download: own package 200, another tenant\'s package 404', async () => {
      const own = await get(`/api/package/download/pkg-${T.B.slug}.zip${q(T.B)}`);
      expect(own.status).toBe(200);
      expect(await own.text()).toBe(`zip-of-${T.B.slug}`);
      expect((await get(`/api/package/download/pkg-${T.A.slug}.zip${q(T.B)}`)).status).toBe(404);
    });
  });

  describe('risk-register blob copies', () => {
    it("a risk-register write for tenant B replicates into B's blob account only", async () => {
      mockUploads.length = 0;
      const r = await send('POST', `/api/risk-assessment/register/entries${q(T.B)}`, {
        threatSource: 'adversarial', threatEvent: 'phishing',
        vulnerability: { type: 'organizational', description: 'no awareness training' },
        treatmentRecommendation: 'mitigate', treatmentStatus: 'recommended',
        lastReviewed: '2026-09-27T00:00:00Z', nextReviewDue: '2027-09-27T00:00:00Z',
        source: { type: 'manual', description: 'test' },
      });
      expect(r.status).toBe(201);
      for (let i = 0; i < 50 && mockUploads.length === 0; i++) await new Promise(res => setTimeout(res, 10)); // fire-and-forget
      expect(mockUploads.length).toBeGreaterThan(0);
      expect(mockUploads).toEqual(mockUploads.map(() => ({ account: T.B.acct, name: `risk-assessment/${T.B.slug}/register.json` })));
      expect(riskStore.loadRegister(T.B.slug).entries).toHaveLength(1);
      expect(riskStore.loadRegister(T.A.slug).entries).toHaveLength(0);
    });
  });

  describe('timeline and policies', () => {
    it("/api/timeline shows only the tenant's own assessment events", async () => {
      for (const t of [T.A, T.B]) {
        const tl = await (await get(`/api/timeline${q(t)}`)).json();
        expect(tl.events.filter((e: any) => e.type === 'assessment').map((e: any) => e.eventId)).toEqual([`assessment-${t.snap}`]);
      }
    });

    it('policy import without a tenantSlug is rejected (no server-default fallback); unknown → 404', async () => {
      const none = await send('POST', '/api/policies/import', { policies: [{}] });
      expect(none.status).toBe(400);
      expect((await none.json()).error).toBe('tenant required'); // the tenant check, not body validation
      expect((await send('POST', '/api/policies/import', { tenantSlug: 'no-such-tenant', policies: [{}] })).status).toBe(404);
    });
  });

  it('every route answers 400 "tenant required" without a tenant and 404 for an unknown one', async () => {
    const routes: Array<[string, string]> = [
      ['GET', '/api/assessment'], ['GET', '/api/sprs'], ['GET', '/api/sprs/history'],
      ['GET', '/api/controls'], ['GET', '/api/controls/AC.L1-3.1.1'],
      ['GET', '/api/ledger'], ['GET', '/api/poam/reconcile'], ['GET', '/api/personas'], ['GET', '/api/persona/P1'],
      ['GET', '/api/assessor-view'],
      ['GET', '/api/packages'], ['GET', `/api/package/download/pkg-${T.A.slug}.zip`],
      ['GET', '/api/timeline'], ['POST', '/api/timeline/events'], ['GET', '/api/policies'],
      ['GET', '/api/risk-assessment/config'], ['PUT', '/api/risk-assessment/config'],
      ['GET', '/api/risk-assessment/register'], ['POST', '/api/risk-assessment/register/entries'],
      ['GET', '/api/risk-assessment/register/entries/00000000-0000-4000-8000-000000000000'],
      ['PUT', '/api/risk-assessment/register/entries/00000000-0000-4000-8000-000000000000'],
      ['DELETE', '/api/risk-assessment/register/entries/00000000-0000-4000-8000-000000000000'],
      ['POST', '/api/risk-assessment/ingest'], ['GET', '/api/risk-assessment/ingestion-runs'],
      ['GET', '/api/risk-assessment/ingestion-runs/2026'], ['POST', '/api/risk-assessment/auto-score'],
      ['GET', '/api/risk-assessment/snapshots'], ['GET', '/api/risk-assessment/snapshots/2026'],
      ['GET', '/api/risk-assessment/annual-review/state'], ['POST', '/api/risk-assessment/annual-review/start'],
      ['PUT', '/api/risk-assessment/annual-review/step/1'], ['POST', '/api/risk-assessment/annual-review/complete'],
      ['DELETE', '/api/risk-assessment/annual-review/state'],
      ['POST', '/api/risk-assessment/annual-review/one-click'], ['POST', '/api/risk-assessment/render/report'],
    ];
    const call = (m: string, p: string) => (m === 'GET' ? get(p) : send(m, p));
    const got: Array<[string, string, number, string, number]> = [];
    for (const [m, p] of routes) {
      const none = await call(m, p);
      const unknown = await call(m, `${p}?tenant=no-such-tenant`);
      got.push([m, p, none.status, (await none.json()).error, unknown.status]);
    }
    expect(got).toEqual(routes.map(([m, p]) => [m, p, 400, 'tenant required', 404]));
    // /assessor is HTML: same status codes.
    expect((await get('/assessor')).status).toBe(400);
    expect((await get('/assessor?tenant=no-such-tenant')).status).toBe(404);
  });
});
