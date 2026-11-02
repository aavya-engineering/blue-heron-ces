// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH-5 (V128 red, R-F2 S1/S2): POST /api/personnel/:id/training/certificate with a file type the
 * upload filter refuses (the V128 probe sent `.txt`) answered Express's 500 HTML error page, because
 * multer's fileFilter error escaped the route. It now answers 400 JSON; an allowed file still answers 200.
 * The multer here uses the same extension filter as EoServer.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import multer from 'multer';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createPersonnelRouter } from '../../../src/eo/server/routers/personnel-router';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { TrainingStore } from '../../../src/eo/personnel/TrainingStore';
import { AttachmentHandler } from '../../../src/eo/personnel/AttachmentHandler';
import { OffboardingWizardStore } from '../../../src/eo/personnel/OffboardingWizardStore';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';
import { RiskAssessmentStore } from '../../../src/eo/risk-assessment/RiskAssessmentStore';
import { PersonnelBlobReplicator } from '../../../src/eo/personnel/PersonnelBlobReplicator';

const SLUG = 'ph5-cert';
const GUID = '00000000-0000-4000-8000-0000000005ce';
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.docx'];

describe('PH-5 V128: training certificate upload errors are JSON', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let person: string;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-ph5-cert-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    const stamperRoot = path.join(tmp, 'stamper');
    const dir = path.join(stamperRoot, 'plan-data', SLUG);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SLUG}.json`), JSON.stringify({ tenant: { tenant_id: GUID } }));
    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const personnelStore = new PersonnelStore(storageRoot);
    person = personnelStore.create(SLUG, { displayName: 'Cert Person', email: 'cert@example.test', role: 'Engineer' }).id;
    const upload = multer({
      dest: path.join(tmp, 'uploads'),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ALLOWED_EXTENSIONS.includes(ext)) cb(null, true);
        else cb(new Error(`File type not allowed: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
      },
    });
    const app = express();
    app.use(express.json());
    app.use(createPersonnelRouter({
      config: { storageRoot, tenantSlug: SLUG, tenantConfigPath: path.join(dir, `${SLUG}.json`) } as any,
      upload, personnelStore, trainingStore: new TrainingStore(storageRoot),
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
  });

  const post = (name: string, type: string, route = 'training/certificate') => {
    const fd = new FormData();
    fd.append('courseId', 'course-x');
    fd.append('file', new Blob([Buffer.from('%PDF-1.4\nSIMULATED (FICTIONAL) certificate\n', 'utf8')], { type }), name);
    return fetch(`${base}/api/personnel/${person}/${route}?tenant=${SLUG}`, { method: 'POST', body: fd });
  };

  it('a refused file type (.txt, the R-F2 probe) answers 400 JSON naming the allowed types, not a 500 HTML page', async () => {
    const r = await post('v128-certificate.txt', 'text/plain');
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type') ?? '').toMatch(/application\/json/);
    const body = await r.json();
    expect(JSON.stringify(body)).toMatch(/File type not allowed: \.txt/);
  });

  it('the other upload routes of the router answer 400 JSON the same way', async () => {
    const r = await post('x.txt', 'text/plain', 'attachments');
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type') ?? '').toMatch(/application\/json/);
    const s = await post('x.txt', 'text/plain', 'screening/1/artifact');
    expect(s.status).toBe(400);
    expect(s.headers.get('content-type') ?? '').toMatch(/application\/json/);
  });

  it('an allowed file (.pdf) uploads: 200 with the artifact id and type', async () => {
    const r = await post('v128-certificate.pdf', 'application/pdf');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(typeof body.id).toBe('string');
    expect(body.type).toBe('training-certificate');
  });
});
