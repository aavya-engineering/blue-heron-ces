// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-EO6 — SSP and POA&M generation read the REQUESTED tenant (not the server default), and
 * `/api/poam/list?tenant=` returns 200 with that tenant's items (it was shadowed by
 * `/api/poam/:poamId` and always 404'd). Drives the REAL documents router over HTTP; two
 * tenants' assessment snapshots in a temp ces.db; the server's default tenant is A.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createDocumentsRouter } from '../../../src/eo/server/routers/documents-router';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../../src/eo/poam/PoamStore';

const REGISTRY = path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const T = {
  A: { slug: 'fxeo6-tenant-a', guid: '00000000-0000-4000-8000-0000000006aa', snap: '6aaaaaaa-0000-4000-8000-000000000001' },
  B: { slug: 'fxeo6-tenant-b', guid: '00000000-0000-4000-8000-0000000006bb', snap: '6bbbbbbb-0000-4000-8000-000000000001' },
};

function snapshot(tenantId: string, snapshotId: string, generatedAt: string, notMet: string) {
  return {
    snapshotId, tenantId, generatedAt, sprs_score: 105,
    controls: [
      { control_id: 'AC.L2-3.1.1', status: 'met', sources: [] },
      { control_id: notMet, status: 'not_met', sources: [] },
    ],
  } as any;
}

describe('FX-EO6: SSP / POA&M are generated and listed per requested tenant', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  const slugsRead: string[] = [];
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-eo6-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    for (const t of [T.A, T.B]) {
      fs.mkdirSync(path.join(stamperRoot, 'plan-data', t.slug), { recursive: true });
      fs.writeFileSync(path.join(stamperRoot, 'plan-data', t.slug, `${t.slug}.json`),
        JSON.stringify({ tenant: { tenant_id: t.guid, domain: `${t.slug}.example.test` } }));
    }
    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const assessmentStore = new AssessmentStore(storageRoot);
    assessmentStore.save(snapshot(T.B.guid, T.B.snap, '2026-09-27T10:00:00Z', 'SC.L2-3.13.8'));
    // A saved last: the storageRoot's scope pointer is A (the old leak for B requests).
    assessmentStore.save(snapshot(T.A.guid, T.A.snap, '2026-09-27T11:00:00Z', 'AU.L2-3.3.1'));

    const recordSlug = (slug: string) => { slugsRead.push(slug); return []; };
    const app = express();
    app.use(express.json());
    app.use(createDocumentsRouter({
      config: { storageRoot, tenantSlug: T.A.slug, registryPath: REGISTRY } as any,
      stamperRoot,
      assessmentStore,
      poamStore: new PoamStore(storageRoot),
      policyStore: { load: recordSlug } as any,
      personnelStore: { load: recordSlug } as any,
      trainingStore: {} as any,
      screeningElementStore: {} as any,
      riskAssessmentStore: {
        loadConfig: () => null, loadRegister: () => ({ entries: [] }), listSnapshots: () => [], loadSnapshot: () => null,
      } as any,
      cleanupService: {} as any,
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

  const post = (p: string, body: unknown) => fetch(base + p, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  it('SSP for each tenant is built from that tenant\'s own snapshot and stores', async () => {
    for (const t of [T.A, T.B]) {
      slugsRead.length = 0;
      const r = await post('/api/ssp/generate', { tenantSlug: t.slug, assessmentId: t.snap });
      expect(r.status).toBe(200);
      const ssp = await r.json();
      expect(ssp.tenantId).toBe(t.guid);
      expect(slugsRead.length).toBeGreaterThan(0);
      expect(new Set(slugsRead)).toEqual(new Set([t.slug])); // policies/personnel of the requested tenant only
    }
    for (const t of [T.A, T.B]) {
      const latest = await fetch(`${base}/api/ssp/latest?tenant=${t.slug}`);
      expect(latest.status).toBe(200);
      expect((await latest.json()).tenantId).toBe(t.guid);
    }
    expect((await fetch(`${base}/api/ssp/latest`)).status).toBe(400);
  });

  it('FX-EO7: SSP fetch/export by id require ?tenant= and never serve another tenant\'s SSP', async () => {
    const ids: Record<string, string> = {};
    for (const t of [T.A, T.B]) {
      const r = await post('/api/ssp/generate', { tenantSlug: t.slug, assessmentId: t.snap });
      expect(r.status).toBe(200);
      ids[t.slug] = (await r.json()).sspId;
    }
    const a = ids[T.A.slug];
    const own = await fetch(`${base}/api/ssp/${a}?tenant=${T.A.slug}`);
    expect(own.status).toBe(200);
    expect((await own.json()).tenantId).toBe(T.A.guid);
    // A's SSP asked for as tenant B → 404 (indistinguishable from "no such SSP").
    expect((await fetch(`${base}/api/ssp/${a}?tenant=${T.B.slug}`)).status).toBe(404);
    // No tenant → 400 (the old route served any SSP by id); unknown tenant → 404; bad id → 400.
    expect((await fetch(`${base}/api/ssp/${a}`)).status).toBe(400);
    expect((await fetch(`${base}/api/ssp/${a}?tenant=no-such-tenant`)).status).toBe(404);
    expect((await fetch(`${base}/api/ssp/not-a-uuid?tenant=${T.A.slug}`)).status).toBe(400);

    const exp = await fetch(`${base}/api/ssp/export/${a}?tenant=${T.A.slug}`);
    expect(exp.status).toBe(200);
    expect(exp.headers.get('content-type')).toContain('wordprocessingml');
    expect((await fetch(`${base}/api/ssp/export/${a}?tenant=${T.B.slug}`)).status).toBe(404);
    expect((await fetch(`${base}/api/ssp/export/${a}`)).status).toBe(400);
  });

  it("another tenant's snapshot id is not found (404); unknown tenant 404", async () => {
    expect((await post('/api/ssp/generate', { tenantSlug: T.B.slug, assessmentId: T.A.snap })).status).toBe(404);
    expect((await post('/api/poam/generate', { tenantSlug: T.A.slug, assessmentId: T.B.snap })).status).toBe(404);
    expect((await post('/api/ssp/generate', { tenantSlug: 'no-such-tenant', assessmentId: T.A.snap })).status).toBe(404);
  });

  it('POA&M for each tenant holds its own deficiencies; /api/poam/list?tenant= returns 200 with that tenant\'s items', async () => {
    const ids: Record<string, string> = {};
    for (const t of [T.A, T.B]) {
      const r = await post('/api/poam/generate', { tenantSlug: t.slug, assessmentId: t.snap });
      expect(r.status).toBe(200);
      const poam = await r.json();
      expect(poam.tenantId).toBe(t.guid);
      ids[t.slug] = poam.poamId;
    }
    const itemsText = async (slug: string) => JSON.stringify(await (await fetch(`${base}/api/poam/latest?tenant=${slug}`)).json());
    const aText = await itemsText(T.A.slug);
    const bText = await itemsText(T.B.slug);
    expect(aText).toContain('3.3.1');
    expect(aText).not.toContain('3.13.8');
    expect(bText).toContain('3.13.8');
    expect(bText).not.toContain('3.3.1');

    for (const t of [T.A, T.B]) {
      const list = await fetch(`${base}/api/poam/list?tenant=${t.slug}`);
      expect(list.status).toBe(200);
      const snaps = await list.json();
      expect(snaps.map((s: any) => s.poamId)).toEqual([ids[t.slug]]);
    }
    expect((await fetch(`${base}/api/poam/list`)).status).toBe(400);
    expect((await fetch(`${base}/api/poam/${ids[T.A.slug]}?tenant=${T.B.slug}`)).status).toBe(404);
  });
});
