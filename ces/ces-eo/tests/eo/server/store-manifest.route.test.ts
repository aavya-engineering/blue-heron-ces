// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1 / B11: EO publishes each tenant's store manifest and a chain verification over
 * HTTP, so the Evidence Collector (EC) checks EO's store through an interface, never EO's files.
 * Only EO's side is built here; `ecEoStoreChainClient` below is a stub of the call EC's
 * `eo_store_chain` index pass will make (plan W4.5), used to prove the routes answer it.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createEvidenceRouter } from '../../../src/eo/server/routers/evidence-router';
import { EvidenceStore } from '../../../src/eo/evidence/store/EvidenceStore';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../../src/eo/poam/PoamStore';
import { PolicyStore } from '../../../src/eo/policies/PolicyStore';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { RiskAssessmentStore } from '../../../src/eo/risk-assessment/RiskAssessmentStore';

jest.mock('ces-shared/blob', () => ({
  ...jest.requireActual('../../__mocks__/ces-shared/blob'),
  listBlobs: async () => [],
  downloadBlob: async () => null,
}));

const T = {
  A: { slug: 'w1-store-a', guid: '00000000-0000-4000-8000-0000000004aa' },
  B: { slug: 'w1-store-b', guid: '00000000-0000-4000-8000-0000000004bb' },
  C: { slug: 'w1-store-c', guid: '00000000-0000-4000-8000-0000000004cc' }, // registered, never collected
};

/** Stub of EC's side: read EO's manifest and verification; report the chain's state. */
async function ecEoStoreChainClient(eoUrl: string, slug: string): Promise<{ state: 'intact' | 'broken' | 'absent'; recordCount?: number; headSha256?: string }> {
  const m = await fetch(`${eoUrl}/api/evidence-store/manifest?tenant=${encodeURIComponent(slug)}`);
  if (m.status === 404) return { state: 'absent' };
  const manifest = await m.json() as { recordCount: number; headSha256: string };
  const v = await (await fetch(`${eoUrl}/api/evidence-store/verify?tenant=${encodeURIComponent(slug)}`)).json() as { ok: boolean; recordCount: number; headSha256: string };
  const intact = v.ok && v.recordCount === manifest.recordCount && v.headSha256 === manifest.headSha256;
  return { state: intact ? 'intact' : 'broken', recordCount: manifest.recordCount, headSha256: manifest.headSha256 };
}

describe('evidence-store routes (manifest publish + hash verify)', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let storageRoot: string;
  const prev = { pipeline: process.env.CES_PIPELINE_ROOT, tenantRoot: process.env.CES_TENANT_ROOT };

  function append(t: typeof T.A, sourceId: string) {
    return EvidenceStore.forStorageRoot(storageRoot, t.guid).append({
      tenantId: t.guid, tenantSlug: t.slug, sourceId, collector: { name: 'n', version: 'v', identity: 'ces-eo/v@no-mgcontext' },
      host: 'graph.microsoft.us', endpoint: `/${sourceId}`, query: `GET /v1.0/${sourceId}`, window: { start: null, end: '2026-10-27T00:00:00.000Z' },
      collectedAt: '2026-10-27T00:00:00.000Z', status: 'success', itemCount: 1, payload: { tenant: t.slug, sourceId },
    });
  }

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-w1-man-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const stamperRoot = path.join(tmp, 'pipeline', 'Stamper');
    for (const t of [T.A, T.B, T.C]) {
      const dir = path.join(stamperRoot, 'plan-data', t.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${t.slug}.json`), JSON.stringify({ tenant: { tenant_id: t.guid } }));
    }
    storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    const app = express();
    app.use(createEvidenceRouter({
      config: { storageRoot, registryPath: 'unused' } as any, stamperRoot,
      assessmentStore: new AssessmentStore(storageRoot), personnelStore: new PersonnelStore(storageRoot),
      riskAssessmentStore: new RiskAssessmentStore(storageRoot), policyStore: new PolicyStore(storageRoot), poamStore: new PoamStore(storageRoot),
      getSessionManager: () => null,
      captureSignals: async () => ({ capturedCount: 0, errors: [], liveSignals: 'not_connected' }),
      getLastCaptureRun: () => null,
    }));
    server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    append(T.A, 'conditionalAccess');
    append(T.A, 'directoryAudits');
    append(T.B, 'groups');
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prev.pipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev.pipeline;
    if (prev.tenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prev.tenantRoot;
  });

  it('publishes the requested tenant\'s manifest only (count, head hash, chain)', async () => {
    const a = await (await fetch(`${base}/api/evidence-store/manifest?tenant=${T.A.slug}`)).json() as any;
    const b = await (await fetch(`${base}/api/evidence-store/manifest?tenant=${T.B.slug}`)).json() as any;
    expect(a).toMatchObject({ tenantId: T.A.guid, tenantSlug: T.A.slug, recordCount: 2 });
    expect(a.chain.map((c: any) => c.sourceId)).toEqual(['conditionalAccess', 'directoryAudits']);
    expect(a.headSha256).toBe(a.chain[1].recordSha256);
    expect(b).toMatchObject({ tenantId: T.B.guid, recordCount: 1 });
    expect(b.chain.map((c: any) => c.sourceId)).toEqual(['groups']);
  });

  it('400 without a tenant, 404 for an unknown tenant or a tenant with no store', async () => {
    expect((await fetch(`${base}/api/evidence-store/manifest`)).status).toBe(400);
    expect((await fetch(`${base}/api/evidence-store/manifest?tenant=nobody`)).status).toBe(404);
    expect((await fetch(`${base}/api/evidence-store/manifest?tenant=${T.C.slug}`)).status).toBe(404);
    expect((await fetch(`${base}/api/evidence-store/verify?tenant=nobody`)).status).toBe(404);
  });

  it('the EC client stub reports intact, then broken after a tamper, and absent for a tenant without a store', async () => {
    const before = await ecEoStoreChainClient(base, T.A.slug);
    expect(before).toMatchObject({ state: 'intact', recordCount: 2 });
    expect(await ecEoStoreChainClient(base, T.C.slug)).toEqual({ state: 'absent' });

    const v1 = await (await fetch(`${base}/api/evidence-store/verify?tenant=${T.B.slug}`)).json() as any;
    expect(v1).toMatchObject({ ok: true, tenantId: T.B.guid, recordCount: 1, manifest: { matches: true } });

    const file = path.join(storageRoot, 'evidence-store', T.B.guid, 'records.jsonl');
    const rec = JSON.parse(fs.readFileSync(file, 'utf-8').trim());
    rec.itemCount = 0;
    fs.writeFileSync(file, JSON.stringify(rec) + '\n');
    expect((await ecEoStoreChainClient(base, T.B.slug)).state).toBe('broken');
    const v2 = await (await fetch(`${base}/api/evidence-store/verify?tenant=${T.B.slug}`)).json() as any;
    expect(v2).toMatchObject({ ok: false, firstBreakSeq: 1 });
    // A's chain is untouched by B's tamper.
    expect((await ecEoStoreChainClient(base, T.A.slug)).state).toBe('intact');
  });
});
