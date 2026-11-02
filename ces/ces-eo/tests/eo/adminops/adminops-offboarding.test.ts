// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-EO4 (replaces the AE-R8 store-only tests, which matched the OPERATOR's UPN and never
 * went through the wizard). Drives the REAL personnel router — the wizard's step resolution
 * (POST start / GET run / PUT step) — over HTTP with AO golden-shaped rows in a temp ces.db.
 *
 * Match rule: a step is system-evidenced only by a LIVE, EXECUTED AO row whose TARGET
 * (contract 1.3.0 `targetUPN` / `targetObjectId`, REQ-ces-shared-adminops-target-identity,
 * closed by ces-shared FX-SH3) is the person being offboarded — never the operator.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import multer from 'multer';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createPersonnelRouter } from '../../../src/eo/server/routers/personnel-router';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { OffboardingWizardStore } from '../../../src/eo/personnel/OffboardingWizardStore';
import { makeRealShapeRow } from './helpers/makeRealShapeRow';

const SLUG = 'fxeo4-tenant';
const GUID = '00000000-0000-4000-8000-0000000000e4';
const OTHER_GUID = '00000000-0000-4000-8000-0000000000e5';
const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_UPN = 'departing.user@fxeo4.example.test';
const OPERATOR_UPN = 'it.admin@fxeo4.example.test';
const COLLECTION = 'adminops_evidence';

describe('FX-EO4: offboarding wizard step resolution uses AdminOps rows for the TARGET person', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let personnelStore: PersonnelStore;
  let wizard: OffboardingWizardStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-eo4-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', SLUG), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', SLUG, `${SLUG}.json`),
      JSON.stringify({ tenant: { tenant_id: GUID } }));

    const storageRoot = path.join(tmp, 'eo-storage');
    personnelStore = new PersonnelStore(storageRoot);
    wizard = new OffboardingWizardStore(storageRoot);
    personnelStore.save(SLUG, {
      id: PERSON_ID, displayName: 'Departing User', email: PERSON_UPN, role: 'engineer',
      screeningState: 'cleared', createdDate: '2026-01-01T00:00:00Z',
      evidenceArtifacts: [], lifecycleEvents: [],
    } as any);

    const app = express();
    app.use(express.json());
    app.use(createPersonnelRouter({
      config: { storageRoot, tenantSlug: SLUG } as any,
      upload: multer({ dest: path.join(tmp, 'uploads') }), trainingStore: {} as any, attachmentHandler: {} as any,
      screeningElementStore: {} as any, riskAssessmentStore: {} as any,
      personnelStore, offboardingWizardStore: wizard, stamperRoot,
    }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  const seed = (opts: Parameters<typeof makeRealShapeRow>[0]) =>
    getCesRepository().put(COLLECTION, makeRealShapeRow({ tenantId: GUID, controlIds: ['PS.L2-3.9.2'], ...opts }));

  /** Start the wizard, then read it back — both are real step-resolution paths. */
  const startAndRead = async () => {
    const start = await fetch(`${base}/api/personnel/${PERSON_ID}/offboarding?tenant=${SLUG}`, { method: 'POST' });
    expect(start.status).toBe(201);
    const read = await fetch(`${base}/api/personnel/${PERSON_ID}/offboarding?tenant=${SLUG}`);
    expect(read.status).toBe(200);
    return read.json();
  };
  const step = (run: any, id: string) => run.steps.find((s: any) => s.id === id);

  // Was an it.failing tripwire until ces-shared FX-SH3 (03a6d0a, contract 1.3.0) added targetUPN.
  it('live A-02 row whose TARGET is the offboarded person → step evidenced with the row id', async () => {
    seed({ id: 'row-a02-target', commandId: 'A-02', requestorUPN: OPERATOR_UPN, outerOverrides: { targetUPN: PERSON_UPN } });
    const run = await startAndRead();
    expect(step(run, 'disable-entra-account').systemEvidenced).toBe(true);
    expect(step(run, 'disable-entra-account').adminOpsRowId).toBe('row-a02-target');
  });

  it('a live A-02 row where only the OPERATOR matches (requestor/approver = the person) does NOT evidence the step', async () => {
    seed({ id: 'row-a02-operator', commandId: 'A-02', requestorUPN: PERSON_UPN, approverUPN: PERSON_UPN });
    const run = await startAndRead();
    expect(step(run, 'disable-entra-account').systemEvidenced).toBeUndefined();
    expect(step(run, 'disable-entra-account').adminOpsRowId).toBeUndefined();
  });

  it('no AO rows → every step stays attestation-only', async () => {
    const run = await startAndRead();
    for (const s of run.steps) {
      expect(s.systemEvidenced).toBeUndefined();
      expect(s.adminOpsRowId).toBeUndefined();
    }
  });

  it('a live A-03 row targeting the person by Entra object id evidences remove-group-memberships (case-insensitive UPN also covered)', async () => {
    seed({ id: 'row-a03-oid', commandId: 'A-03', outerOverrides: { targetObjectId: 'OID-DEPARTING-1' } });
    seed({ id: 'row-b05-upn', commandId: 'B-05', controlIds: ['MP.L2-3.8.1'], outerOverrides: { targetUPN: PERSON_UPN.toUpperCase() } });
    personnelStore.save(SLUG, { ...personnelStore.get(SLUG, PERSON_ID)!, entraObjectId: 'oid-departing-1' });
    const run = await startAndRead();
    expect(step(run, 'remove-group-memberships').adminOpsRowId).toBe('row-a03-oid');
    expect(step(run, 'revoke-device-access').adminOpsRowId).toBe('row-b05-upn');
  });

  it('a live A-02 row targeting SOMEONE ELSE does not evidence the step', async () => {
    seed({ id: 'row-a02-other', commandId: 'A-02', requestorUPN: PERSON_UPN, outerOverrides: { targetUPN: 'someone.else@fxeo4.example.test' } });
    const run = await startAndRead();
    expect(step(run, 'disable-entra-account').systemEvidenced).toBeUndefined();
  });

  it('dry-run and other-tenant rows naming the person never evidence a step', async () => {
    seed({ id: 'row-a02-dry', commandId: 'A-02', mode: 'dry_run', dryRun: true, outcome: 'dry_run', outerOverrides: { targetUPN: PERSON_UPN } });
    getCesRepository().put(COLLECTION, makeRealShapeRow({
      tenantId: OTHER_GUID, id: 'row-b05-other-tenant', commandId: 'B-05', controlIds: ['MP.L2-3.8.1'],
      outerOverrides: { targetUPN: PERSON_UPN },
    }));
    const run = await startAndRead();
    expect(step(run, 'disable-entra-account').systemEvidenced).toBeUndefined();
    expect(step(run, 'revoke-device-access').systemEvidenced).toBeUndefined();
  });

  it('step completion (PUT) still runs through the wizard and keeps attestation', async () => {
    await startAndRead();
    const run = wizard.loadRun(SLUG, PERSON_ID)!;
    const first = run.steps[0].id;
    const r = await fetch(`${base}/api/personnel/${PERSON_ID}/offboarding/step/${first}?tenant=${SLUG}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attestor: 'ISSO' }),
    });
    expect(r.status).toBe(200);
    const after = await r.json();
    expect(step(after, first).completed).toBe(true);
    expect(step(after, first).attestor).toBe('ISSO');
  });
});
