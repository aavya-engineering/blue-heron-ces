// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-EO1 (P0) — cross-tenant exposure. Drives the REAL evidence router over HTTP
 * (express + app.listen(0) + fetch; no supertest in the tree) against a temp ces.db
 * holding AdminOps rows for TWO tenants, and asserts every surface returns only the
 * requested tenant's rows and rejects a request with no tenant — even though the server
 * is configured with a default tenant (tenant A), which is exactly the old leak path.
 *
 * Also covers FX-EO2: an AO item opened by the id/path the index returns → 200.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createEvidenceRouter } from '../../../src/eo/server/routers/evidence-router';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { makeRealShapeRow } from '../adminops/helpers/makeRealShapeRow';

const SLUG_A = 'fxeo1-tenant-a';
const SLUG_B = 'fxeo1-tenant-b';
const GUID_A = '00000000-0000-4000-8000-0000000000aa';
const GUID_B = '00000000-0000-4000-8000-0000000000bb';
const CMD_A = 'F-13';
const CMD_B = 'F-21';

function writeTenantConfig(stamperRoot: string, slug: string, guid: string): string {
  const dir = path.join(stamperRoot, 'plan-data', slug);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${slug}.json`);
  fs.writeFileSync(p, JSON.stringify({ tenant: { tenant_id: guid, domain: `${slug}.example.test` } }));
  return p;
}

function snapshot(tenantId: string, id: string, generatedAt: string) {
  return {
    snapshotId: id,
    tenantId,
    generatedAt,
    sprs_score: 110,
    controls: [{ control_id: 'SC.L2-3.13.1', status: 'met', sources: [] }],
  } as any;
}

describe('FX-EO1: tenant scoping on Explorer index, AdminOps executions and evidence package', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-eo1-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry'); // real sim registry can't resolve
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    const tenantAPath = writeTenantConfig(stamperRoot, SLUG_A, GUID_A);
    writeTenantConfig(stamperRoot, SLUG_B, GUID_B);

    const repo = getCesRepository();
    repo.put('adminops_evidence', makeRealShapeRow({ tenantId: GUID_A, commandId: CMD_A, id: 'row-a-live', correlationId: 'corr-a-1' }));
    repo.put('adminops_evidence', makeRealShapeRow({ tenantId: GUID_A, commandId: CMD_A, id: 'row-a-dry', mode: 'dry_run', dryRun: true, outcome: 'dry_run' }));
    repo.put('adminops_evidence', makeRealShapeRow({ tenantId: GUID_B, commandId: CMD_B, id: 'row-b-live', correlationId: 'corr-b-1' }));

    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const assessmentStore = new AssessmentStore(storageRoot);
    assessmentStore.save(snapshot(GUID_B, 'snap-b', '2026-09-27T10:00:00Z'));
    // A saved LAST: the storageRoot scope pointer now says "A" — the old leak for a B request.
    assessmentStore.save(snapshot(GUID_A, 'snap-a', '2026-09-27T11:00:00Z'));

    const emptyStore = { load: () => [], loadRegister: () => ({ entries: [] }), loadLatest: () => null } as any;
    const app = express();
    app.use(express.json());
    app.use(createEvidenceRouter({
      // Server DEFAULT tenant is A: a request for B (or with no tenant) must never fall back to it.
      config: { storageRoot, tenantSlug: SLUG_A, tenantConfigPath: tenantAPath } as any,
      stamperRoot,
      assessmentStore,
      personnelStore: emptyStore,
      riskAssessmentStore: emptyStore,
      policyStore: emptyStore,
      poamStore: emptyStore,
      getSessionManager: () => null,
      captureSignals: async () => ({ capturedCount: 0, errors: [] }),
      getLastCaptureRun: () => null,
    }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections(); // fetch keep-alive sockets would otherwise hold close()
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  const get = (p: string) => fetch(base + p);
  const aoItems = (body: any) => (body.items as any[]).filter(i => i.source === 'adminops');

  describe('GET /api/evidence-explorer/index', () => {
    it('tenant A sees only A rows', async () => {
      const r = await get(`/api/evidence-explorer/index?tenant=${SLUG_A}`);
      expect(r.status).toBe(200);
      const ao = aoItems(await r.json());
      expect(ao.map(i => i.id).sort()).toEqual(['adminops:row-a-dry', 'adminops:row-a-live']);
      expect(ao.every(i => i.title.startsWith(CMD_A))).toBe(true);
    });

    it('tenant B sees only B rows (not the server default tenant A)', async () => {
      const r = await get(`/api/evidence-explorer/index?tenant=${SLUG_B}`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(aoItems(body).map(i => i.id)).toEqual(['adminops:row-b-live']);
      // Local assessment items are B's snapshot, not the storageRoot's last-saved tenant (A).
      const local = (body.items as any[]).filter(i => i.id.startsWith('assessment:'));
      expect(local).toHaveLength(1);
      expect(local[0].timestamp).toBe('2026-09-27T10:00:00Z');
    });

    it('no tenant → 400 (never the default tenant, never all rows)', async () => {
      expect((await get('/api/evidence-explorer/index')).status).toBe(400);
    });

    it('unknown tenant → 404', async () => {
      expect((await get('/api/evidence-explorer/index?tenant=no-such-tenant')).status).toBe(404);
    });
  });

  describe('FX-EO2: GET /api/evidence-explorer/item for an AdminOps item', () => {
    const open = (slug: string, item: any) =>
      get(`/api/evidence-explorer/item?tenant=${slug}&source=${encodeURIComponent(item.source)}&path=${encodeURIComponent(item.path)}`);

    it('opens the item by the path the index returned → 200 with commandId, mode, outcome, correlationId', async () => {
      const idx = await (await get(`/api/evidence-explorer/index?tenant=${SLUG_A}`)).json();
      const live = aoItems(idx).find(i => i.id === 'adminops:row-a-live');
      expect(live).toBeDefined();
      const r = await open(SLUG_A, live);
      expect(r.status).toBe(200);
      const { content } = await r.json();
      expect(content.rowId).toBe('row-a-live');
      expect(content.commandId).toBe(CMD_A);
      expect(content.mode).toBe('live');
      expect(content.outcome).toBe('executed');
      expect(content.correlationId).toBe('corr-a-1');
    });

    it('a dry-run item opens with its preview mode/outcome', async () => {
      const idx = await (await get(`/api/evidence-explorer/index?tenant=${SLUG_A}`)).json();
      const dry = aoItems(idx).find(i => i.id === 'adminops:row-a-dry');
      const r = await open(SLUG_A, dry);
      expect(r.status).toBe(200);
      const { content } = await r.json();
      expect(content.mode).toBe('dry_run');
      expect(content.outcome).toBe('dry_run');
    });

    it("another tenant's row id is not found (404), and a malformed path is 400", async () => {
      expect((await open(SLUG_B, { source: 'adminops', path: 'adminops/row-a-live' })).status).toBe(404);
      expect((await open(SLUG_A, { source: 'adminops', path: 'not-an-ao-path' })).status).toBe(400);
    });
  });

  describe('GET /api/adminops/executions', () => {
    it('tenant A → only A executions', async () => {
      const r = await get(`/api/adminops/executions?tenant=${SLUG_A}`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.executions.map((e: any) => e.rowId).sort()).toEqual(['row-a-dry', 'row-a-live']);
      expect(body.executions.every((e: any) => e.commandId === CMD_A)).toBe(true);
      expect(body.stats.total).toBe(2);
    });

    it('tenant B → only B executions', async () => {
      const r = await get(`/api/adminops/executions?tenant=${SLUG_B}`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.executions.map((e: any) => e.rowId)).toEqual(['row-b-live']);
      expect(body.executions[0].correlationId).toBe('corr-b-1');
      expect(body.stats.total).toBe(1);
    });

    it('no tenant → 400; unknown tenant → 404', async () => {
      expect((await get('/api/adminops/executions')).status).toBe(400);
      expect((await get('/api/adminops/executions?tenant=no-such-tenant')).status).toBe(404);
      expect((await get('/api/adminops/executions?tenant=..%2F..%2Fetc')).status).toBe(400);
    });
  });

  describe('POST /api/package/build', () => {
    const build = (body: unknown) => fetch(base + '/api/package/build', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    // Zip entry names are stored uncompressed in the local/central headers.
    const zipNames = (filePath: string) => fs.readFileSync(filePath).toString('latin1');

    it('tenant A package holds only A AdminOps rows', async () => {
      const r = await build({ tenant: SLUG_A });
      expect(r.status).toBe(200);
      const names = zipNames((await r.json()).filePath);
      expect(names).toContain(`/adminops/${CMD_A}-`);
      expect(names).not.toContain(`/adminops/${CMD_B}-`);
    });

    it('tenant B package holds only B AdminOps rows', async () => {
      const r = await build({ tenant: SLUG_B });
      expect(r.status).toBe(200);
      const names = zipNames((await r.json()).filePath);
      expect(names).toContain(`/adminops/${CMD_B}-`);
      expect(names).not.toContain(`/adminops/${CMD_A}-`);
    });

    it('no tenant → 400; unknown tenant → 404', async () => {
      expect((await build({})).status).toBe(400);
      expect((await build({ tenant: 'no-such-tenant' })).status).toBe(404);
    });
  });
});
