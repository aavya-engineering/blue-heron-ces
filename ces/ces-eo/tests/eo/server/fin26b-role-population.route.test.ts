// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-26b (FD-9): GET / PUT /api/personnel/:slug/role-population, the operator entry point for the AT.L2-3.2.2
 * population, driven over HTTP through the real createPersonnelRouter (two tenants, no blob replication).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import multer from 'multer';
import { closeAllCesRepositories, getCesRepository } from 'ces-shared/persistence/node';
import { createPersonnelRouter } from '../../../src/eo/server/routers/personnel-router';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { TrainingStore, INTERVIEW_RECORDS_COLLECTION, ROLE_POPULATION_QUESTION_ID } from '../../../src/eo/personnel/TrainingStore';
import { AttachmentHandler } from '../../../src/eo/personnel/AttachmentHandler';
import { OffboardingWizardStore } from '../../../src/eo/personnel/OffboardingWizardStore';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';
import { RiskAssessmentStore } from '../../../src/eo/risk-assessment/RiskAssessmentStore';
import { PersonnelBlobReplicator } from '../../../src/eo/personnel/PersonnelBlobReplicator';

const T = {
  A: { slug: 'fin26b-tenant-a', guid: '00000000-0000-4000-8000-0000000026aa' },
  B: { slug: 'fin26b-tenant-b', guid: '00000000-0000-4000-8000-0000000026bb' },
};

describe('FIN-26b: /api/personnel/:slug/role-population', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let trainingStore: TrainingStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;
  const prevPin = process.env.CES_EO_TENANT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-fin26b-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    delete process.env.CES_EO_TENANT;
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    for (const t of [T.A, T.B]) {
      const dir = path.join(stamperRoot, 'plan-data', t.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${t.slug}.json`), JSON.stringify({ tenant: { tenant_id: t.guid } }));
    }
    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    trainingStore = new TrainingStore(storageRoot);
    const config = { storageRoot, tenantSlug: T.A.slug } as any;
    const app = express();
    app.use(express.json());
    app.use(createPersonnelRouter({
      config,
      upload: multer({ dest: path.join(tmp, 'uploads') }),
      personnelStore: new PersonnelStore(storageRoot),
      trainingStore,
      attachmentHandler: new AttachmentHandler(storageRoot),
      offboardingWizardStore: new OffboardingWizardStore(storageRoot),
      screeningElementStore: new ScreeningElementStore(storageRoot),
      personnelBlobReplicatorFor: () => new PersonnelBlobReplicator(null),
      riskAssessmentStore: new RiskAssessmentStore(storageRoot),
      stamperRoot,
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
    if (prevPin === undefined) delete process.env.CES_EO_TENANT; else process.env.CES_EO_TENANT = prevPin;
  });

  const url = (slug: string, q = '') => `${base}/api/personnel/${slug}/role-population${q}`;
  const put = (slug: string, body: unknown, q = '') =>
    fetch(url(slug, q), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('GET with nothing defined returns population null', async () => {
    const r = await fetch(url(T.A.slug));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ tenantSlug: T.A.slug, population: null });
  });

  it('PUT saves the operator list (cleaned), GET reads it back; the other tenant is untouched', async () => {
    const r = await put(T.A.slug, { roles: [' Systems Administrator ', 'ISSO', 'systems administrator'] });
    expect(r.status).toBe(200);
    expect((await r.json()).population).toEqual({ controlId: 'AT.L2-3.2.2', roles: ['Systems Administrator', 'ISSO'], source: 'operator' });
    expect((await (await fetch(url(T.A.slug))).json()).population.roles).toEqual(['Systems Administrator', 'ISSO']);
    expect((await (await fetch(url(T.B.slug))).json()).population).toBeNull();
    // The catalog the ledger reads carries it.
    expect(trainingStore.loadCatalog(T.A.slug).role_population).toMatchObject({ source: 'operator', roles: ['Systems Administrator', 'ISSO'] });
  });

  it('PUT [] clears the operator list; the newest PI.PER.012 interview record then applies', async () => {
    getCesRepository().put(INTERVIEW_RECORDS_COLLECTION, {
      id: 'f'.repeat(64),
      ces: { tenantSlug: T.A.slug, tenantId: T.A.guid },
      data: { recordId: 'f'.repeat(64), tenantSlug: T.A.slug, questionId: ROLE_POPULATION_QUESTION_ID, answer: 'Information Security Manager (ISSM)', interviewedAt: '2026-10-31T10:00:00.000Z' },
    });
    const r = await put(T.A.slug, { roles: [] });
    expect(r.status).toBe(200);
    expect((await r.json()).population).toMatchObject({ source: 'interview', roles: ['Information Security Manager (ISSM)'] });
  });

  it('validation: a body without a string array is 400; an unknown tenant is 404', async () => {
    expect((await put(T.A.slug, { roles: 'ISSO' })).status).toBe(400);
    expect((await put(T.A.slug, { roles: [1, 2] })).status).toBe(400);
    expect((await put(T.A.slug, {})).status).toBe(400);
    expect((await fetch(url('no-such-tenant'))).status).toBe(404);
  });

  it('tenant scoping: a ?tenant= naming another tenant is 400; the CES_EO_TENANT pin applies to the path slug', async () => {
    expect((await fetch(url(T.A.slug, `?tenant=${T.B.slug}`))).status).toBe(400);
    expect((await fetch(url(T.A.slug, `?tenant=${T.A.slug}`))).status).toBe(200);
    process.env.CES_EO_TENANT = T.B.slug;
    try {
      expect((await fetch(url(T.A.slug))).status).toBe(403);
      expect((await put(T.A.slug, { roles: ['ISSO'] })).status).toBe(403);
      expect((await fetch(url(T.B.slug))).status).toBe(200);
    } finally {
      delete process.env.CES_EO_TENANT;
    }
  });
});
