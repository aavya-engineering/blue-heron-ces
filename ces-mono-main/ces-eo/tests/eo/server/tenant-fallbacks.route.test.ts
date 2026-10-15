// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-EO7 — the remaining default-tenant fallbacks are closed, consistent with FX-EO1:
 *   - /api/evidence/* blob browser (artifacts list/detail, verify, manifests) reads the
 *     REQUESTED tenant's blob storage only;
 *   - /api/evidence-explorer/signal no longer falls back to config.tenantSlug;
 *   - every personnel route requires ?tenant= (no config.tenantSlug fallback).
 * Missing tenant → 400, unknown → 404, even though the server's default tenant (A) is set.
 *
 * Drives the REAL evidence and personnel routers over HTTP. Only the blob transport
 * (listBlobs/downloadBlob — network I/O to Azure) is replaced, by an in-memory store keyed
 * by storage account, so the test can see WHICH tenant's storage a route read. Sim only:
 * nothing leaves 127.0.0.1.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import multer from 'multer';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createEvidenceRouter } from '../../../src/eo/server/routers/evidence-router';
import { createPersonnelRouter } from '../../../src/eo/server/routers/personnel-router';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';

const RUN_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ART_A = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const RUN_B = 'bbbbbbbb-0000-4000-8000-000000000001';
const ART_B = 'bbbbbbbb-0000-4000-8000-0000000000b1';

const artifact = (runId: string, artifactId: string, controlId: string) => {
  const rawValue = { controlId };
  return JSON.stringify({
    artifactId, runId, capturedAt: '2026-09-27T12:00:00Z', source: 'graph', checkId: 'chk',
    controlIds: [controlId], rawValue,
    sha256: require('node:crypto').createHash('sha256').update(JSON.stringify(rawValue), 'utf-8').digest('hex'),
  });
};

// In-memory blob transport, keyed by storage account → blob name → content.
const mockBlobs: Record<string, Record<string, string>> = {
  'acct-a': {
    [`artifacts/${RUN_A}/${ART_A}.json`]: artifact(RUN_A, ART_A, 'AC.L2-3.1.1'),
    [`manifests/${RUN_A}.manifest.json`]: JSON.stringify({ runId: RUN_A, tenantId: 'A', generatedAt: 'x', artifactCount: 1 }),
  },
  'acct-b': {
    [`artifacts/${RUN_B}/${ART_B}.json`]: artifact(RUN_B, ART_B, 'SC.L1-3.13.1'),
    [`manifests/${RUN_B}.manifest.json`]: JSON.stringify({ runId: RUN_B, tenantId: 'B', generatedAt: 'y', artifactCount: 1 }),
  },
};
const mockUploads: Array<{ account: string; name: string }> = [];
jest.mock('ces-shared/blob', () => ({
  ...jest.requireActual('../../__mocks__/ces-shared/blob'),
  uploadEvidenceBlob: async (cfg: { account_name: string }, name: string) => { mockUploads.push({ account: cfg.account_name, name }); },
  listBlobs: async (cfg: { account_name: string }, prefix: string) =>
    Object.keys(mockBlobs[cfg.account_name] ?? {}).filter(n => n.startsWith(prefix)).map(name => ({ name })),
  downloadBlob: async (cfg: { account_name: string }, name: string) => mockBlobs[cfg.account_name]?.[name] ?? null,
}));

const T = {
  A: { slug: 'fxeo7-tenant-a', guid: '00000000-0000-4000-8000-0000000007aa', acct: 'acct-a' },
  B: { slug: 'fxeo7-tenant-b', guid: '00000000-0000-4000-8000-0000000007bb', acct: 'acct-b' },
};
const PERSON_A = '7aaaaaaa-0000-4000-8000-00000000000a';
const PERSON_B = '7bbbbbbb-0000-4000-8000-00000000000b';

describe('FX-EO7: no default-tenant fallback on the blob browser, live signal and personnel routes', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let personnelStore: PersonnelStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-eo7-'));
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
        tenant: { tenant_id: t.guid },
        evidence_storage: {
          account_name: t.acct, account_key: 'sim-key', container: 'evidence', base_path: '',
          blob_endpoint: 'http://127.0.0.1:1/never-called',
        },
      }));
    }
    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    personnelStore = new PersonnelStore(storageRoot);
    const person = (id: string, name: string) => ({
      id, displayName: name, email: `${name}@example.test`, role: 'engineer',
      screeningState: 'cleared', createdDate: '2026-01-01T00:00:00Z', evidenceArtifacts: [], lifecycleEvents: [],
    } as any);
    personnelStore.save(T.A.slug, person(PERSON_A, 'person-a'));
    personnelStore.save(T.B.slug, person(PERSON_B, 'person-b'));

    // Server DEFAULT tenant is A everywhere — the old fallback target.
    const config = { storageRoot, tenantSlug: T.A.slug, tenantConfigPath: cfgPath[T.A.slug] } as any;
    const emptyStore = { load: () => [], loadRegister: () => ({ entries: [] }), loadLatest: () => null } as any;
    const app = express();
    app.use(express.json());
    app.use(createEvidenceRouter({
      config, stamperRoot,
      assessmentStore: new AssessmentStore(storageRoot),
      personnelStore: emptyStore, riskAssessmentStore: emptyStore, policyStore: emptyStore, poamStore: emptyStore,
      // A (fake) connected session so /signal gets past the connection check to the tenant check.
      getSessionManager: () => ({}) as any,
      captureSignals: async () => ({ capturedCount: 0, errors: [] }),
      getLastCaptureRun: () => null,
    }));
    app.use(createPersonnelRouter({
      config, upload: multer({ dest: path.join(tmp, 'uploads') }),
      personnelStore, trainingStore: {} as any, attachmentHandler: {} as any,
      offboardingWizardStore: {} as any, screeningElementStore: {} as any,
      riskAssessmentStore: {} as any, stamperRoot,
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

  const get = (p: string) => fetch(base + p);
  const send = (method: string, p: string, body: unknown = {}) => fetch(base + p, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  describe('/api/evidence/* blob browser', () => {
    it("lists only the requested tenant's artifacts (B, not the server default A)", async () => {
      const r = await get(`/api/evidence/artifacts?tenant=${T.B.slug}`);
      expect(r.status).toBe(200);
      expect((await r.json()).map((a: any) => a.artifactId)).toEqual([ART_B]);
      const a = await (await get(`/api/evidence/artifacts?tenant=${T.A.slug}`)).json();
      expect(a.map((x: any) => x.artifactId)).toEqual([ART_A]);
    });

    it('artifact detail and verify: own tenant 200, other tenant 404', async () => {
      const own = await get(`/api/evidence/artifacts/${RUN_B}/${ART_B}?tenant=${T.B.slug}`);
      expect(own.status).toBe(200);
      expect((await own.json()).artifactId).toBe(ART_B);
      expect((await get(`/api/evidence/artifacts/${RUN_A}/${ART_A}?tenant=${T.B.slug}`)).status).toBe(404);

      const v = await get(`/api/evidence/verify/${RUN_B}/${ART_B}?tenant=${T.B.slug}`);
      expect(v.status).toBe(200);
      expect((await v.json()).match).toBe(true);
      expect((await get(`/api/evidence/verify/${RUN_A}/${ART_A}?tenant=${T.B.slug}`)).status).toBe(404);
    });

    it("manifests: only the requested tenant's", async () => {
      const m = await (await get(`/api/evidence/manifests?tenant=${T.B.slug}`)).json();
      expect(m.map((x: any) => x.runId)).toEqual([RUN_B]);
    });

    it('no tenant → 400 and unknown tenant → 404 on every blob-browser route', async () => {
      const paths = [
        '/api/evidence/artifacts',
        `/api/evidence/artifacts/${RUN_A}/${ART_A}`,
        `/api/evidence/verify/${RUN_A}/${ART_A}`,
        '/api/evidence/manifests',
      ];
      for (const p of paths) {
        expect({ p, status: (await get(p)).status }).toEqual({ p, status: 400 });
        const sep = p.includes('?') ? '&' : '?';
        expect({ p, status: (await get(`${p}${sep}tenant=no-such-tenant`)).status }).toEqual({ p, status: 404 });
      }
    });
  });

  describe('/api/evidence-explorer/signal and /capture', () => {
    it('signal without a tenant → 400 (no server-default fallback); unknown → 404', async () => {
      expect((await send('POST', '/api/evidence-explorer/signal', { signalId: 'identitySignals' })).status).toBe(400);
      expect((await send('POST', '/api/evidence-explorer/signal', { tenant: 'no-such-tenant', signalId: 'identitySignals' })).status).toBe(404);
    });

    it('capture without a tenant → 400', async () => {
      expect((await send('POST', '/api/evidence-explorer/capture')).status).toBe(400);
    });
  });

  describe('personnel routes', () => {
    it("GET /api/personnel?tenant=B returns B's people only; no tenant → 400 (not tenant A's list)", async () => {
      const b = await get(`/api/personnel?tenant=${T.B.slug}`);
      expect(b.status).toBe(200);
      expect((await b.json()).map((p: any) => p.id)).toEqual([PERSON_B]);
      expect((await get('/api/personnel')).status).toBe(400);
      expect((await get('/api/personnel?tenant=no-such-tenant')).status).toBe(404);
    });

    it("another tenant's person id is not found", async () => {
      expect((await get(`/api/personnel/${PERSON_A}?tenant=${T.A.slug}`)).status).toBe(200);
      expect((await get(`/api/personnel/${PERSON_A}?tenant=${T.B.slug}`)).status).toBe(404);
    });

    it('a write with no tenant is rejected before touching the default tenant', async () => {
      const r = await send('POST', '/api/personnel', { displayName: 'x', email: 'x@example.test', role: 'engineer' });
      expect(r.status).toBe(400);
      expect(personnelStore.load(T.A.slug).map(p => p.id)).toEqual([PERSON_A]);
      expect((await send('DELETE', `/api/personnel/${PERSON_A}`)).status).toBe(400);
      expect(personnelStore.get(T.A.slug, PERSON_A)).not.toBeNull();
    });

    it("a personnel write for tenant B replicates into B's blob account, not the default tenant's", async () => {
      mockUploads.length = 0;
      // Production default replicator factory (no test injection): bound per request to the tenant's config.
      const r = await send('POST', `/api/personnel?tenant=${T.B.slug}`, { displayName: 'new-b', email: 'new-b@example.test', role: 'engineer' });
      expect(r.status).toBe(201);
      for (let i = 0; i < 50 && mockUploads.length === 0; i++) await new Promise(res => setTimeout(res, 10)); // fire-and-forget
      expect(mockUploads.length).toBeGreaterThan(0);
      expect(mockUploads.every(u => u.account === T.B.acct)).toBe(true);
      expect(mockUploads.every(u => u.name.startsWith(`personnel/${T.B.slug}/`))).toBe(true);
    });

    it('every tenant-scoped personnel route answers 400 without ?tenant=', async () => {
      const id = PERSON_A;
      const routes: Array<[string, string]> = [
        ['GET', '/api/personnel/readiness'],
        ['GET', '/api/risk-assessment/readiness'],
        ['GET', '/api/personnel/config'],
        ['PUT', '/api/personnel/config'],
        ['PUT', `/api/personnel/${id}`],
        ['POST', `/api/personnel/${id}/events`],
        ['DELETE', `/api/personnel/${id}/record`],
        ['GET', `/api/personnel/${id}/offboarding`],
        ['POST', `/api/personnel/${id}/offboarding`],
        ['POST', `/api/personnel/${id}/offboarding/complete`],
        ['GET', `/api/personnel/${id}/training`],
        ['POST', `/api/personnel/${id}/training/assign`],
        ['POST', `/api/personnel/${id}/training/email`],
        ['GET', '/api/training/catalog'],
        ['PUT', '/api/training/catalog'],
        ['GET', `/api/personnel/${id}/screening`],
        ['GET', `/api/personnel/${id}/screening/readiness`],
        ['GET', `/api/personnel/${id}/screening/template/1`],
        ['GET', `/api/personnel/${id}/screening/1`],
        ['PUT', `/api/personnel/${id}/screening/1`],
      ];
      // The error text proves the 400 comes from the tenant check, not e.g. body validation.
      const got: Array<[string, string, number, string]> = [];
      for (const [m, p] of routes) {
        const r = m === 'GET' ? await get(p) : await send(m, p);
        got.push([m, p, r.status, (await r.json()).error]);
      }
      expect(got).toEqual(routes.map(([m, p]) => [m, p, 400, 'tenant required']));
    });
  });
});
