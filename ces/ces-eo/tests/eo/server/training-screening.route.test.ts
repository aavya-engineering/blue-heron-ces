// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-B / EO-12, EO-13 — training + screening routes, driven through the REAL
 * personnel-router over HTTP (createPersonnelRouter), with real TrainingStore /
 * ScreeningElementStore / PersonnelStore behind it. Blob replication is disabled by
 * injecting `personnelBlobReplicatorFor` bound to a `null` EvidenceStorageConfig — every
 * PersonnelBlobReplicator.replicate* method no-ops on `config === null` (see
 * src/eo/personnel/PersonnelBlobReplicator.ts), so nothing leaves 127.0.0.1 and no blob
 * mock is needed. Two tenants (A, B) exercise "happy path, validation, tenant isolation"
 * per the EO-12/EO-13 acceptance criteria.
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

const T = {
  A: { slug: 'trsc-tenant-a', guid: '00000000-0000-4000-8000-0000000009aa' },
  B: { slug: 'trsc-tenant-b', guid: '00000000-0000-4000-8000-0000000009bb' },
};

describe('EO-12/EO-13: training + screening routes (happy path, validation, tenant isolation)', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let personnelStore: PersonnelStore;
  let trainingStore: TrainingStore;
  let screeningElementStore: ScreeningElementStore;
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;
  let personA: string;
  let personB: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-trsc-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });

    const stamperRoot = path.join(tmp, 'stamper');
    for (const t of [T.A, T.B]) {
      const dir = path.join(stamperRoot, 'plan-data', t.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${t.slug}.json`), JSON.stringify({ tenant: { tenant_id: t.guid } }));
    }

    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    personnelStore = new PersonnelStore(storageRoot);
    trainingStore = new TrainingStore(storageRoot);
    screeningElementStore = new ScreeningElementStore(storageRoot);

    personA = personnelStore.create(T.A.slug, { displayName: 'Alice A', email: 'alice-a@example.test', role: 'Engineer' }).id;
    personB = personnelStore.create(T.B.slug, { displayName: 'Bob B', email: 'bob-b@example.test', role: 'Engineer' }).id;

    const config = { storageRoot, tenantSlug: T.A.slug, tenantConfigPath: path.join(stamperRoot, 'plan-data', T.A.slug, `${T.A.slug}.json`) } as any;
    const app = express();
    app.use(express.json());
    app.use(createPersonnelRouter({
      config,
      upload: multer({ dest: path.join(tmp, 'uploads') }),
      personnelStore,
      trainingStore,
      attachmentHandler: new AttachmentHandler(storageRoot),
      offboardingWizardStore: new OffboardingWizardStore(storageRoot),
      screeningElementStore,
      // No-op replicator (null EvidenceStorageConfig): sim only, nothing hits Azure.
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

  const get = (p: string) => fetch(base + p);
  const send = (method: string, p: string, body: unknown = {}) => fetch(base + p, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  // ── Training: happy path ──

  describe('training routes', () => {
    it('GET training for a person with nothing assigned yet returns empty required/status', async () => {
      const r = await get(`/api/personnel/${personA}/training?tenant=${T.A.slug}`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.state.completions).toEqual([]);
    });

    it('assigns courses, then completing one reports it complete and not overdue', async () => {
      // Pin the catalog to a single required course so "complete it -> overdue 0" is
      // deterministic (the default catalog has two courses required_for_roles: all_users).
      const courseId = 'course-solo';
      const putCatalog = await send('PUT', `/api/training/catalog?tenant=${T.A.slug}`, {
        courses: [{
          id: courseId, title: 'Solo Course', provider: 'Test', duration: '10min',
          targetRoles: ['*'], required_for_roles: ['all_users'], satisfies_controls: [], refresh_cycle_days: 365,
        }],
      });
      expect(putCatalog.status).toBe(200);

      const assign = await send('POST', `/api/personnel/${personA}/training/assign?tenant=${T.A.slug}`, { courseIds: [courseId] });
      expect(assign.status).toBe(200);
      const assigned = await assign.json();
      expect(assigned.requiredCourses).toContain(courseId);

      const before = await (await get(`/api/personnel/${personA}/training?tenant=${T.A.slug}`)).json();
      expect(before.status.overdue).toBeGreaterThanOrEqual(1);

      const complete = await send('POST', `/api/personnel/${personA}/training/complete?tenant=${T.A.slug}`, {
        courseId, completedDate: new Date().toISOString(),
      });
      expect(complete.status).toBe(200);

      const after = await (await get(`/api/personnel/${personA}/training?tenant=${T.A.slug}`)).json();
      expect(after.status.completed).toBeGreaterThanOrEqual(1);
      expect(after.status.overdue).toBe(0);
    });

    it('rejects a completedDate in the future (validation)', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const r = await send('POST', `/api/personnel/${personA}/training/complete?tenant=${T.A.slug}`, {
        courseId: 'dod-cyber-awareness-challenge-2026', completedDate: futureDate,
      });
      expect(r.status).toBe(400);
    });

    it('rejects an assign request with an empty courseIds array (validation)', async () => {
      const r = await send('POST', `/api/personnel/${personA}/training/assign?tenant=${T.A.slug}`, { courseIds: [] });
      expect(r.status).toBe(400);
    });

    it('404s for an unknown personnel id', async () => {
      const r = await get(`/api/personnel/00000000-0000-4000-8000-000000000000/training?tenant=${T.A.slug}`);
      expect(r.status).toBe(404);
    });

    it("tenant isolation: B's training state is invisible via A's personnel id and vice versa", async () => {
      // personB belongs to tenant B; asking for it under tenant A's scope 404s (person not found there).
      const r = await get(`/api/personnel/${personB}/training?tenant=${T.A.slug}`);
      expect(r.status).toBe(404);
    });

    it("completing a course for B does not appear in A's completions (tenant isolation)", async () => {
      const catalog = await (await get(`/api/training/catalog?tenant=${T.B.slug}`)).json();
      const courseId = catalog.courses[1].id; // a course A never touched in the earlier test
      await send('POST', `/api/personnel/${personB}/training/complete?tenant=${T.B.slug}`, {
        courseId, completedDate: new Date().toISOString(),
      });
      const bState = await (await get(`/api/personnel/${personB}/training?tenant=${T.B.slug}`)).json();
      expect(bState.state.completions.map((c: any) => c.courseId)).toContain(courseId);

      const aState = await (await get(`/api/personnel/${personA}/training?tenant=${T.A.slug}`)).json();
      expect(aState.state.completions.map((c: any) => c.courseId)).not.toContain(courseId);
    });

    it('generates an assignment email mentioning the tenant slug as the org name', async () => {
      const catalog = await (await get(`/api/training/catalog?tenant=${T.A.slug}`)).json();
      const courseId = catalog.courses[0].id;
      const r = await send('POST', `/api/personnel/${personA}/training/email?tenant=${T.A.slug}`, { courseIds: [courseId] });
      expect(r.status).toBe(200);
      const { emailText } = await r.json();
      expect(emailText).toContain(T.A.slug);
    });
  });

  // ── Screening: happy path + sequencing + template substitution ──

  describe('screening routes', () => {
    it('a fresh person has all 7 elements not_started and readiness incomplete', async () => {
      const r = await get(`/api/personnel/${personA}/screening?tenant=${T.A.slug}`);
      expect(r.status).toBe(200);
      const { elements } = await r.json();
      expect(elements).toHaveLength(7);
      expect(elements.every((e: any) => e.status === 'not_started')).toBe(true);

      const readiness = await (await get(`/api/personnel/${personA}/screening/readiness?tenant=${T.A.slug}`)).json();
      expect(readiness.packageComplete).toBe(false);
    });

    it('template substitution fills in the person and tenant name for element 6 (CUI ack)', async () => {
      const r = await get(`/api/personnel/${personA}/screening/template/6?tenant=${T.A.slug}`);
      expect(r.status).toBe(200);
      const { templateText } = await r.json();
      expect(templateText).toContain('Alice A');
      expect(templateText).not.toContain('{person_name}');
    });

    it('element 7 (AO sign-off) is rejected until elements 1-6 are completed', async () => {
      const r = await send('PUT', `/api/personnel/${personA}/screening/7?tenant=${T.A.slug}`, {
        status: 'completed',
        data: { ao_name: 'Ann Officer', ao_email: 'ao@example.test', ao_role: 'AO', determination: 'approve', signOffDate: '2026-01-01', signedText: 'x' },
      });
      expect(r.status).toBe(400);
    });

    it('completing elements 1-6 then 7 makes the package complete, and rejects AO == subject', async () => {
      for (let i = 1; i <= 6; i++) {
        const r = await send('PUT', `/api/personnel/${personA}/screening/${i}?tenant=${T.A.slug}`, {
          status: 'completed', data: null,
        });
        expect(r.status).toBe(200);
      }

      // AO cannot be the person being screened (their own email).
      const selfAo = await send('PUT', `/api/personnel/${personA}/screening/7?tenant=${T.A.slug}`, {
        status: 'completed',
        data: { ao_name: 'Alice A', ao_email: 'alice-a@example.test', ao_role: 'AO', determination: 'approve', signOffDate: '2026-01-01', signedText: 'x' },
      });
      expect(selfAo.status).toBe(400);

      const ok = await send('PUT', `/api/personnel/${personA}/screening/7?tenant=${T.A.slug}`, {
        status: 'completed',
        data: { ao_name: 'Ann Officer', ao_email: 'ao@example.test', ao_role: 'AO', determination: 'approve', signOffDate: '2026-01-01', signedText: 'x' },
      });
      expect(ok.status).toBe(200);

      const readiness = await (await get(`/api/personnel/${personA}/screening/readiness?tenant=${T.A.slug}`)).json();
      expect(readiness.packageComplete).toBe(true);
      expect(readiness.aoDetermination).toBe('approve');
    });

    it('rejects an out-of-range elementNum', async () => {
      const r = await get(`/api/personnel/${personA}/screening/8?tenant=${T.A.slug}`);
      expect(r.status).toBe(400);
    });

    it("tenant isolation: A's completed screening elements do not leak into B's readiness", async () => {
      const readinessB = await (await get(`/api/personnel/${personB}/screening/readiness?tenant=${T.B.slug}`)).json();
      expect(readinessB.packageComplete).toBe(false);
      expect(readinessB.elementsComplete).toEqual([]);
    });

    it('every screening/training route 400s without ?tenant=', async () => {
      const routes: Array<[string, string]> = [
        ['GET', `/api/personnel/${personA}/training`],
        ['POST', `/api/personnel/${personA}/training/assign`],
        ['POST', `/api/personnel/${personA}/training/complete`],
        ['GET', '/api/training/catalog'],
        ['GET', `/api/personnel/${personA}/screening`],
        ['GET', `/api/personnel/${personA}/screening/readiness`],
        ['GET', `/api/personnel/${personA}/screening/template/6`],
        ['GET', `/api/personnel/${personA}/screening/1`],
        ['PUT', `/api/personnel/${personA}/screening/1`],
      ];
      for (const [m, p] of routes) {
        const r = m === 'GET' ? await get(p) : await send(m, p);
        expect({ m, p, status: r.status }).toEqual({ m, p, status: 400 });
      }
    });
  });
});
