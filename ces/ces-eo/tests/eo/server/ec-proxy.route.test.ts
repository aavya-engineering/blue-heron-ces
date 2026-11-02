// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-F (M4a) — /api/ec/* server-side proxy to EC (REQ-ces-eo-ec-wiring). Drives the
 * REAL router (`createEcRouter`) over HTTP against a small fake EC on an ephemeral port
 * (tool-boundary rule: EO never links against EC's code), exactly the pattern used by
 * tenant-reads.route.test.ts (real listen(0) + native fetch, no supertest dependency).
 * Covers: health pass-through including a distinct 'degraded' state, runs/findings
 * pass-through, EC-unreachable => 503 {status:'unreachable'} (never conflated with
 * 'degraded'), and the ingest proxy (multipart in, JSON+bearer out to EC, bearer never
 * sent to the browser, 400/503 guards).
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import multer from 'multer';
import { createEcRouter } from '../../../src/eo/server/routers/ec-router';

const SECRET = 'eo-ec-secret';

interface FakeEc {
  server: Server;
  url: string;
  ingestCalls: Array<{ auth: string; principal?: string; body: unknown }>;
}

function startFakeEc(opts: { health?: unknown; runs?: unknown[]; findings?: unknown[] } = {}): Promise<FakeEc> {
  const app = express();
  app.use(express.json());
  const ingestCalls: Array<{ auth: string; principal?: string; body: unknown }> = [];

  app.get('/api/health', (_req, res) => res.json(opts.health ?? { status: 'ok', mode: 'sim', startedAt: 't', version: '0.1.0' }));
  app.get('/api/runs', (_req, res) => res.json(opts.runs ?? []));
  app.get('/api/findings', (_req, res) => res.json(opts.findings ?? []));
  app.post('/api/ingest', (req, res) => {
    const auth = req.headers.authorization ?? '';
    const principal = req.headers['x-ces-principal'] as string | undefined;
    ingestCalls.push({ auth, principal, body: req.body });
    if (auth !== `Bearer ${SECRET}`) { res.status(401).json({ error: 'unauthorized' }); return; }
    // Like EC (NS-0): a principal that is present must verify, else 401; absent => uploadedBy null.
    if (principal !== undefined && principal !== 'good.uploader.token') { res.status(401).json({ error: 'unauthorized', detail: 'bad principal' }); return; }
    res.status(201).json({
      itemId: 'eci-new-1', ...(req.body as object),
      uploadedBy: principal ? { subjectId: 'uploader-sub', upn: 'uploader@acme.example.test' } : null,
    });
  });

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}`, ingestCalls });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function startEoApp(ecUrl: string, secret?: string): Promise<{ server: Server; base: string }> {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.use(createEcRouter({ ecUrl, secret, upload, timeoutMs: 1000 }));
  const server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

describe('GET /api/ec/health|runs|findings — proxy', () => {
  let fake: FakeEc;
  let eo: { server: Server; base: string } | undefined;
  afterEach(async () => {
    if (fake) await closeServer(fake.server);
    if (eo) await closeServer(eo.server);
    eo = undefined;
  });

  it('passes through an ok health response', async () => {
    fake = await startFakeEc({ health: { status: 'ok', mode: 'sim', startedAt: 't', version: '1.0.0' } });
    eo = await startEoApp(fake.url, SECRET);
    const res = await fetch(`${eo.base}/api/ec/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('passes through a degraded health response as its own state (never remapped to unavailable)', async () => {
    fake = await startFakeEc({ health: { status: 'degraded', mode: 'sim', startedAt: 't', version: '1.0.0', reasons: ['EVIDENCE_OPS_SECRET not set'] } });
    eo = await startEoApp(fake.url, SECRET);
    const res = await fetch(`${eo.base}/api/ec/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.reasons).toContain('EVIDENCE_OPS_SECRET not set');
  });

  it('returns 503 {status:"unreachable"} when EC is down (distinct from "degraded")', async () => {
    eo = await startEoApp('http://127.0.0.1:1', SECRET); // nothing listening
    const res = await fetch(`${eo.base}/api/ec/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unreachable' });
  });

  it('proxies /api/ec/runs and /api/ec/findings', async () => {
    fake = await startFakeEc({
      runs: [{ runId: 'ecr-1', startedAt: 't', runType: 'ingest', status: 'success', artifactsWritten: 1 }],
      findings: [{ findingId: 'f-1', checkId: 'c', detectedAt: 't', severity: 'low', status: 'open', tenantSlug: 'acme-sim', detail: 'x' }],
    });
    eo = await startEoApp(fake.url, SECRET);
    const runs = await fetch(`${eo.base}/api/ec/runs`);
    expect(runs.status).toBe(200);
    expect(await runs.json()).toHaveLength(1);
    const findings = await fetch(`${eo.base}/api/ec/findings`);
    expect(findings.status).toBe(200);
    expect(await findings.json()).toHaveLength(1);
  });
});

describe('POST /api/ec/ingest — multipart proxy', () => {
  let fake: FakeEc;
  let eo: { server: Server; base: string } | undefined;
  afterEach(async () => {
    if (fake) await closeServer(fake.server);
    if (eo) await closeServer(eo.server);
    eo = undefined;
  });

  function form(fields: Record<string, string>, fileContent = 'roster contents', filename = 'roster.pdf'): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set('file', new Blob([fileContent], { type: 'application/pdf' }), filename);
    return fd;
  }

  it('forwards the upload to EC with the bearer attached server-side (never exposed to the browser request)', async () => {
    fake = await startFakeEc();
    eo = await startEoApp(fake.url, SECRET);
    const res = await fetch(`${eo.base}/api/ec/ingest`, {
      method: 'POST',
      body: form({
        tenantSlug: 'acme-sim',
        controlIds: 'AC.L1-3.1.1,SC.L1-3.13.1',
        source: 'manual_upload',
        submittedByRole: 'compliance_officer',
      }),
    });

    expect(res.status).toBe(201);
    expect(fake.ingestCalls).toHaveLength(1);
    expect(fake.ingestCalls[0].auth).toBe(`Bearer ${SECRET}`);
    const body = fake.ingestCalls[0].body as any;
    expect(body.tenantSlug).toBe('acme-sim');
    expect(body.controlIds).toEqual(['AC.L1-3.1.1', 'SC.L1-3.13.1']);
    expect(body.filename).toBe('roster.pdf');
    expect(body.contentBase64).toBe(Buffer.from('roster contents').toString('base64'));
    expect(body.verdict).toBeUndefined(); // EO never invents a verdict on ingest

    // The browser-side request itself never carried the bearer secret.
    expect(res.url).not.toContain(SECRET);
  });

  // FIN-12 (NS-audit F-2): the uploader's x-ces-principal reaches EC, so EC can record uploadedBy.
  const fields = { tenantSlug: 'acme-sim', controlIds: 'AT.L2-3.2.1', source: 'manual_upload', submittedByRole: 'compliance_officer' };

  it('forwards the caller x-ces-principal to EC verbatim; EC records the uploader', async () => {
    fake = await startFakeEc();
    eo = await startEoApp(fake.url, SECRET);
    const res = await fetch(`${eo.base}/api/ec/ingest`, { method: 'POST', body: form(fields), headers: { 'x-ces-principal': 'good.uploader.token' } });
    expect(res.status).toBe(201);
    expect(fake.ingestCalls[0].principal).toBe('good.uploader.token');
    expect(fake.ingestCalls[0].auth).toBe(`Bearer ${SECRET}`);
    expect((await res.json()).uploadedBy).toEqual({ subjectId: 'uploader-sub', upn: 'uploader@acme.example.test' });
    // The uploader is never a body field (EC rejects one): EO sends it only as the header.
    expect((fake.ingestCalls[0].body as Record<string, unknown>).uploadedBy).toBeUndefined();
  });

  it('sends no principal header when the caller sent none (EC records uploadedBy null)', async () => {
    fake = await startFakeEc();
    eo = await startEoApp(fake.url, SECRET);
    const res = await fetch(`${eo.base}/api/ec/ingest`, { method: 'POST', body: form(fields) });
    expect(res.status).toBe(201);
    expect(fake.ingestCalls[0].principal).toBeUndefined();
    expect((await res.json()).uploadedBy).toBeNull();
  });

  it("passes EC's 401 for a bad uploader token through (never a silent downgrade to no uploader)", async () => {
    fake = await startFakeEc();
    eo = await startEoApp(fake.url, SECRET);
    const res = await fetch(`${eo.base}/api/ec/ingest`, { method: 'POST', body: form(fields), headers: { 'x-ces-principal': 'forged' } });
    expect(res.status).toBe(401);
    expect(fake.ingestCalls[0].principal).toBe('forged');
  });

  it('forwards the principal together with form_id and emx_ids', async () => {
    fake = await startFakeEc();
    const fd = form(fields);
    fd.set('form_id', 'FORM-X');
    fd.set('emx_ids', 'EMX-1, EMX-2');
    const app = express();
    const upload = multer({ storage: multer.memoryStorage() });
    // An unavailable catalog: EVC.5 forwards the ids unvalidated (validation itself is evc5-catalog-ids.test.ts).
    app.use(createEcRouter({
      ecUrl: fake.url, secret: SECRET, upload, timeoutMs: 1000,
      loadCatalog: () => ({ status: 'unavailable', reason: 'test: ids forwarded unvalidated' }),
    }));
    const srv = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/ec/ingest`, {
        method: 'POST', body: fd, headers: { 'x-ces-principal': 'good.uploader.token' },
      });
      expect(res.status).toBe(201);
      const call = fake.ingestCalls[0];
      expect(call.principal).toBe('good.uploader.token');
      expect(call.body).toMatchObject({ form_id: 'FORM-X', emx_ids: ['EMX-1', 'EMX-2'] });
    } finally {
      await closeServer(srv);
    }
  });

  it('400s when required fields are missing (no request reaches EC)', async () => {
    fake = await startFakeEc();
    eo = await startEoApp(fake.url, SECRET);
    const res = await fetch(`${eo.base}/api/ec/ingest`, { method: 'POST', body: form({ tenantSlug: 'acme-sim' }) });
    expect(res.status).toBe(400);
    expect(fake.ingestCalls).toHaveLength(0);
  });

  it('400s when no file is attached', async () => {
    fake = await startFakeEc();
    eo = await startEoApp(fake.url, SECRET);
    const fd = new FormData();
    fd.set('tenantSlug', 'acme-sim');
    fd.set('controlIds', 'AC.L1-3.1.1');
    fd.set('source', 'manual_upload');
    fd.set('submittedByRole', 'compliance_officer');
    const res = await fetch(`${eo.base}/api/ec/ingest`, { method: 'POST', body: fd });
    expect(res.status).toBe(400);
  });

  it('503s when EVIDENCE_OPS_SECRET is not configured (never sends an unauthenticated ingest)', async () => {
    fake = await startFakeEc();
    eo = await startEoApp(fake.url, undefined); // no secret
    const res = await fetch(`${eo.base}/api/ec/ingest`, {
      method: 'POST',
      body: form({
        tenantSlug: 'acme-sim',
        controlIds: 'AC.L1-3.1.1',
        source: 'manual_upload',
        submittedByRole: 'compliance_officer',
      }),
    });
    expect(res.status).toBe(503);
    expect(fake.ingestCalls).toHaveLength(0);
  });
});
