// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-31: the read-only review-queue routes (review screen data) and the /app/ mount plus
 * /api/ui/info, over real HTTP.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import { createReviewQueueRouter } from '../../../src/eo/server/routers/review-queue-router';
import { DocumentReviewStore } from '../../../src/eo/server/routers/review-router';
import { createEoUiRouter, describeEoUi } from '../../../src/eo/server/routers/eo-ui-router';

const TENANT = { slug: 'fin31-rq-tenant', guid: '00000000-0000-4000-8000-0000000f3102' };
const CONTROL = 'PE.L2-3.10.2';
const item = (o: Partial<EcEvidenceItem> = {}): EcEvidenceItem => ({
  contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
  itemId: 'ec-1', tenantSlug: TENANT.slug, controlIds: [CONTROL], source: 'manual_upload',
  filename: 'visitor-log.pdf', mediaType: 'application/pdf', sha256: 'b'.repeat(64), sizeBytes: 5,
  collectedAt: '2026-10-31T00:00:00.000Z', submittedByRole: 'facility_manager',
  uploadedBy: { subjectId: 'uploader:u@x.example.test', upn: 'u@x.example.test' }, mode: 'sim', ...o,
});

describe('FIN-31: review queue and UI mount', () => {
  let tmp: string;
  let publicDir: string;
  let server: Server;
  let base: string;
  let items: EcEvidenceItem[] = [];
  let store: DocumentReviewStore;
  const env: Record<string, string | undefined> = {};
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin31-rq-'));
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', TENANT.slug), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', TENANT.slug, `${TENANT.slug}.json`),
      JSON.stringify({ tenant: { tenant_id: TENANT.guid, domain: 'rq-tenant.example.test' } }));
    publicDir = path.join(tmp, 'public');
    fs.mkdirSync(path.join(publicDir, 'app', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'index.html'), '<html>legacy</html>');
    fs.writeFileSync(path.join(publicDir, 'approver-tokens.html'), '<html>issuer</html>');
    fs.writeFileSync(path.join(publicDir, 'app', 'index.html'), '<html>spa</html>');
    fs.writeFileSync(path.join(publicDir, 'app', 'assets', 'main.js'), 'console.log(1)');
    store = new DocumentReviewStore(path.join(tmp, 'ces.db'));
    const app = express();
    app.use(createEoUiRouter(publicDir, env));
    app.use(express.static(publicDir));
    app.use(createReviewQueueRouter({ stamperRoot, ecItems: async () => items, store }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()));
    closeAllCesRepositories();
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists the 28 non-stack controls with their objective ids', async () => {
    const r = await fetch(`${base}/api/review-queue/controls`);
    const body = await r.json() as { controls: Array<{ controlId: string; objectiveIds: string[] }> };
    expect(body.controls).toHaveLength(28);
    const pe = body.controls.find((c) => c.controlId === CONTROL)!;
    expect(pe.objectiveIds.length).toBeGreaterThan(0);
    expect(pe.objectiveIds.every((o) => o.startsWith(`${CONTROL}[`))).toBe(true);
  });

  it('returns the control\'s EC items with uploader (null when unknown), objectives and live reviews; never content', async () => {
    items = [item(), item({ itemId: 'ec-2', uploadedBy: null }), item({ itemId: 'ec-3', controlIds: ['AT.L2-3.2.1'] })];
    store.record({
      reviewId: 'r-1', tenantSlug: TENANT.slug, controlId: CONTROL, objectiveId: `${CONTROL}[a]`, artifactHash: 'b'.repeat(64),
      verdict: 'met', reviewer: { upn: 'rv@x.example.test', subjectId: 's', tokenId: 't' }, uploader: { upn: 'u@x.example.test', subjectId: 'u' },
      ecItemIds: ['ec-1'], reviewedAt: '2026-10-31T01:00:00.000Z',
    }, TENANT.guid);
    const r = await fetch(`${base}/api/review-queue?tenant=${TENANT.slug}&controlId=${CONTROL}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.nonStack).toBe(true);
    expect(body.items.map((i: { itemId: string }) => i.itemId)).toEqual(['ec-1', 'ec-2']);
    expect(body.items[0].uploadedBy).toEqual({ upn: 'u@x.example.test', subjectId: 'uploader:u@x.example.test' });
    expect(body.items[1].uploadedBy).toBeNull();
    expect(body.items[0]).not.toHaveProperty('contentBase64');
    expect(body.reviews.map((x: { reviewId: string }) => x.reviewId)).toEqual(['r-1']);
    expect(body.objectiveIds).toContain(`${CONTROL}[a]`);
  });

  it('refuses a missing tenant (400), an unknown tenant (404) and a bad control id (400)', async () => {
    expect((await fetch(`${base}/api/review-queue?controlId=${CONTROL}`)).status).toBe(400);
    expect((await fetch(`${base}/api/review-queue?tenant=nope&controlId=${CONTROL}`)).status).toBe(404);
    expect((await fetch(`${base}/api/review-queue?tenant=${TENANT.slug}&controlId=bad`)).status).toBe(400);
  });

  it('serves the SPA at /app/ with history fallback; assets, legacy / and the issuer page are untouched', async () => {
    for (const p of ['/app', '/app/', '/app/review', '/app/personnel/training']) {
      const r = await fetch(`${base}${p}`);
      expect([p, await r.text()]).toEqual([p, '<html>spa</html>']);
    }
    expect(await (await fetch(`${base}/app/assets/main.js`)).text()).toBe('console.log(1)');
    expect(await (await fetch(`${base}/`)).text()).toBe('<html>legacy</html>');
    expect(await (await fetch(`${base}/approver-tokens.html`)).text()).toBe('<html>issuer</html>');
    expect((await fetch(`${base}/approver`)).status).toBe(404);
  });

  it('/api/ui/info reports build, simulator and two-person state (off unless CES_TWO_PERSON_APPROVAL=1)', async () => {
    const off = await (await fetch(`${base}/api/ui/info`)).json();
    expect(off).toEqual({ spaPath: '/app/', spaBuilt: true, simulator: { active: false }, twoPersonApproval: false, uploaderTokenIssuer: false });
    env.STACKSIM_SERVER_URL = 'http://127.0.0.1:1';
    env.CES_TWO_PERSON_APPROVAL = '1';
    env.CES_EC_PRINCIPAL_SECRET = 'x'.repeat(16);
    const on = await (await fetch(`${base}/api/ui/info`)).json();
    expect(on).toMatchObject({ simulator: { active: true }, twoPersonApproval: true, uploaderTokenIssuer: true });
    expect(describeEoUi(path.join(tmp, 'missing'), {}).spaBuilt).toBe(false);
  });
});
