// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.4b (P1 #5): the verify routes recompute hashes the way the writers compute them.
 * Before: `/api/evidence/verify/:runId/:artifactId` hashed JSON.stringify(rawValue) while capture
 * writes canonicalSha256(rawValue); `/api/evidence-explorer/verify` hashed whole files while capture
 * and Stamper hash the payload. A fresh capture (the real EvidenceCaptureService, written to an
 * in-memory blob store at the path capture really uses) now verifies on both routes; a tampered one
 * does not. Store records verify through `source=store`. Real routers over HTTP; no network.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { canonicalSha256 } from 'ces-shared/crypto';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createEvidenceRouter, recomputeEvidenceHash } from '../../../src/eo/server/routers/evidence-router';
import { EvidenceCaptureService } from '../../../src/eo/generation/EvidenceCaptureService';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../../src/eo/poam/PoamStore';
import { PolicyStore } from '../../../src/eo/policies/PolicyStore';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { RiskAssessmentStore } from '../../../src/eo/risk-assessment/RiskAssessmentStore';

const blobs = new Map<string, string>();
jest.mock('ces-shared/blob', () => ({
  ...jest.requireActual('../../__mocks__/ces-shared/blob'),
  uploadEvidenceBlob: async (_cfg: unknown, name: string, content: string) => { blobs.set(name, content); },
  listBlobs: async () => [],
  downloadBlob: async (_cfg: unknown, name: string) => blobs.get(name) ?? null,
}));

const SLUG = 'w14b-verify';
const GUID = '00000000-0000-4000-8000-00000000014b';
const STORAGE_CFG = { account_name: 'acct-14b', account_key: 'sim-key', container: 'evidence', base_path: '', blob_endpoint: 'http://127.0.0.1:1/never-called' };

describe('W1.4b: evidence verify routes use the writers\' hashes and real capture paths', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let storageRoot: string;
  let stamperRoot: string;
  const prev = { pipeline: process.env.CES_PIPELINE_ROOT, tenantRoot: process.env.CES_TENANT_ROOT };

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-w14b-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    stamperRoot = path.join(tmp, 'pipeline', 'Stamper');
    const dir = path.join(stamperRoot, 'plan-data', SLUG);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SLUG}.json`), JSON.stringify({ tenant: { tenant_id: GUID }, evidence_storage: STORAGE_CFG }));
    storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const config = { storageRoot, registryPath: 'unused' } as any;
    const app = express();
    app.use(express.json());
    app.use(createEvidenceRouter({
      config, stamperRoot, assessmentStore: new AssessmentStore(storageRoot), personnelStore: new PersonnelStore(storageRoot),
      riskAssessmentStore: new RiskAssessmentStore(storageRoot), policyStore: new PolicyStore(storageRoot), poamStore: new PoamStore(storageRoot),
      getSessionManager: () => null,
      captureSignals: async () => ({ capturedCount: 0, errors: [], liveSignals: 'not_connected' }),
      getLastCaptureRun: () => null,
    }));
    server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prev.pipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev.pipeline;
    if (prev.tenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prev.tenantRoot;
  });

  const get = async (p: string) => {
    const r = await fetch(`${base}${p}`);
    return { status: r.status, body: await r.json() as any };
  };

  async function freshCapture(): Promise<string> {
    blobs.clear();
    const svc = new EvidenceCaptureService(STORAGE_CFG as any);
    // Keys out of order: JSON.stringify and the canonical form differ, which the old route got wrong.
    const rawData = { value: [{ z: 1, a: { y: 2, b: 3 } }], '@odata.context': 'x' };
    const ids = await svc.captureForAssessment({
      control_id: 'AU.L2-3.3.2', status: 'met',
      signals: [{ signalId: 'directoryAudits', source: 'graph', endpoint: '/auditLogs/directoryAudits', timestamp: new Date().toISOString(), rawData, status: 'success' }],
    } as any);
    expect(ids).toHaveLength(1);
    const [name] = [...blobs.keys()];
    expect(name).toMatch(/^audit_accountability\/au\.l2-3\.3\.2\.directoryAudits_.*\.json$/);
    return name;
  }

  it('GET /api/evidence/verify?path= verifies a fresh capture at its real path; a tampered one fails', async () => {
    const name = await freshCapture();
    const ok = await get(`/api/evidence/verify?tenant=${SLUG}&path=${encodeURIComponent(name)}`);
    expect(ok.status).toBe(200);
    expect(ok.body.match).toBe(true);
    expect(ok.body.recomputed).toBe(JSON.parse(blobs.get(name)!).sha256);

    const art = JSON.parse(blobs.get(name)!);
    art.rawValue.value[0].z = 999;
    blobs.set(name, JSON.stringify(art));
    const bad = await get(`/api/evidence/verify?tenant=${SLUG}&path=${encodeURIComponent(name)}`);
    expect(bad.body.match).toBe(false);

    expect((await get(`/api/evidence/verify?tenant=${SLUG}&path=..%2Fx.json`)).status).toBe(400);
    expect((await get(`/api/evidence/verify?tenant=${SLUG}`)).status).toBe(400);
  });

  it('GET /api/evidence-explorer/verify source=blob verifies the same fresh capture', async () => {
    const name = await freshCapture();
    const r = await get(`/api/evidence-explorer/verify?tenant=${SLUG}&source=blob&path=${encodeURIComponent(name)}`);
    expect(r.body).toMatchObject({ verified: true });
    expect(r.body.actual).toBe(JSON.parse(blobs.get(name)!).sha256);
  });

  it('GET /api/evidence/verify/:runId/:artifactId uses canonicalSha256(rawValue)', async () => {
    const runId = randomUUID();
    const artifactId = randomUUID();
    const rawValue = { b: 1, a: [{ d: 1, c: 2 }] };
    blobs.set(`artifacts/${runId}/${artifactId}.json`, JSON.stringify({ artifactId, rawValue, sha256: canonicalSha256(rawValue) }));
    const r = await get(`/api/evidence/verify/${runId}/${artifactId}?tenant=${SLUG}`);
    expect(r.body).toMatchObject({ match: true });
    expect(createHash('sha256').update(JSON.stringify(rawValue)).digest('hex')).not.toBe(canonicalSha256(rawValue));
  });

  it('source=stamper hashes rawResponse (what Stamper hashes), not the file', async () => {
    const evDir = path.join(stamperRoot, 'plan-data', SLUG, 'evidence');
    fs.mkdirSync(evDir, { recursive: true });
    const rawResponse = '[{"Name":"rule"}]';
    fs.writeFileSync(path.join(evDir, 'au.l2-3.3.1.x.json'), JSON.stringify({ rawResponse, metadata: { sha256Hash: createHash('sha256').update(rawResponse, 'utf8').digest('hex') } }, null, 2));
    const r = await get(`/api/evidence-explorer/verify?tenant=${SLUG}&source=stamper&path=au.l2-3.3.1.x`);
    expect(r.body).toMatchObject({ verified: true });
  });

  it('source=store verifies a store record and its payload, this tenant\'s only', async () => {
    const store = EvidenceStore.forStorageRoot(storageRoot, GUID);
    const rec = store.append({
      tenantId: GUID, tenantSlug: SLUG, sourceId: 'groups', collector: { name: 'n', version: 'v', identity: 'i' },
      host: 'graph.microsoft.us', endpoint: '/groups', query: 'Get-MgGroup', window: { start: null, end: '2026-10-27T00:00:00.000Z' },
      collectedAt: '2026-10-27T00:00:00.000Z', status: 'success', itemCount: 1, payload: { id: 'g1' },
    });
    const ok = await get(`/api/evidence-explorer/verify?tenant=${SLUG}&source=store&path=${rec.recordId}`);
    expect(ok.body).toMatchObject({ verified: true, payloadVerified: true, expected: rec.recordSha256, actual: rec.recordSha256 });
    fs.writeFileSync(store.payloadPath(rec.payloadSha256), '{"id":"g2"}');
    const bad = await get(`/api/evidence-explorer/verify?tenant=${SLUG}&source=store&path=${rec.recordId}`);
    expect(bad.body).toMatchObject({ verified: false, payloadVerified: false });
    expect((await get(`/api/evidence-explorer/verify?tenant=${SLUG}&source=store&path=nope`)).status).toBe(404);
  });

  it('recomputeEvidenceHash: capture blob, Stamper file, anything else', () => {
    const rawValue = { b: 1, a: 2 };
    expect(recomputeEvidenceHash({ rawValue, sha256: 'x' }, '')).toEqual({ expected: 'x', actual: canonicalSha256(rawValue) });
    expect(recomputeEvidenceHash({ rawResponse: 'abc', metadata: { sha256Hash: 'y' } }, '').actual).toBe(createHash('sha256').update('abc').digest('hex'));
    expect(recomputeEvidenceHash({ other: 1 }, 'file').actual).toBe(createHash('sha256').update('file').digest('hex'));
  });
});
