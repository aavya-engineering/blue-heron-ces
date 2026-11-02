// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * NS-1 (GD-b): POST/GET /api/reviews over real HTTP, with approver tokens minted by the production
 * issuer into a temp ces.db mint log, a temp stamper plan-data tenant, and an injected EC item lookup.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories, getCesRepository } from 'ces-shared/persistence/node';
import { signPrincipalToken, type RequestPrincipal } from 'ces-shared/http/principal';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import { mintApproverToken, AO_APPROVER_ROLE } from '../../../src/eo/approver-tokens/ApproverTokenIssuer';
import { ApproverTokenMintLog } from '../../../src/eo/approver-tokens/ApproverTokenMintLog';
import { createReviewRouter, DocumentReviewStore, DOCUMENT_REVIEW_COLLECTION, liveReviews } from '../../../src/eo/server/routers/review-router';

const AO_SECRET = 'ao-principal-secret-for-review-tests-0123';
const TENANT = { slug: 'ns1-review-tenant', guid: '00000000-0000-4000-8000-0000000a5101' };
const REVIEWER = 'reviewer.one@review-tenant.example.test';
const UPLOADER = 'uploader.one@review-tenant.example.test';
const CONTROL = 'AT.L2-3.2.1';
const HASH = 'd'.repeat(64);

const operator: RequestPrincipal = Object.freeze({
  subjectId: 'op-subject-ns1', upn: 'operator.ns1@bhd.example.test', roles: ['bhd-operator'], verified: true, source: 'token',
});

const item = (overrides: Partial<EcEvidenceItem> = {}): EcEvidenceItem => ({
  contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
  itemId: 'ec-item-1', tenantSlug: TENANT.slug, controlIds: [CONTROL], source: 'manual_upload',
  filename: 'training.pdf', mediaType: 'application/pdf', sha256: HASH, sizeBytes: 5,
  collectedAt: '2026-10-30T00:00:00.000Z', submittedByRole: 'compliance_officer',
  uploadedBy: { subjectId: `uploader:${UPLOADER}`, upn: UPLOADER }, mode: 'sim', ...overrides,
});

describe('NS-1: /api/reviews', () => {
  let tmp: string;
  let dbPath: string;
  let server: Server;
  let base: string;
  let mintLog: ApproverTokenMintLog;
  let ecItems: EcEvidenceItem[] = [];
  const env = { CES_AO_PRINCIPAL_SECRET: AO_SECRET };
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ns1-review-'));
    dbPath = path.join(tmp, 'ces.db');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', TENANT.slug), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', TENANT.slug, `${TENANT.slug}.json`),
      JSON.stringify({ tenant: { tenant_id: TENANT.guid, domain: 'review-tenant.example.test' } }));
    mintLog = new ApproverTokenMintLog(dbPath);
    const app = express();
    app.use(express.json());
    app.use(createReviewRouter({
      stamperRoot, env, mints: mintLog, store: new DocumentReviewStore(dbPath),
      ecItems: async () => ecItems,
    }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => { ecItems = [item()]; });

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()));
    closeAllCesRepositories();
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const mint = (upn = REVIEWER) =>
    mintApproverToken({ operator, tenant: { slug: TENANT.slug, tenantId: TENANT.guid }, approverUpn: upn }, { env, evidence: mintLog }).token;
  const body = (o: Record<string, unknown> = {}) => ({
    tenant: TENANT.slug, controlId: CONTROL, objectiveId: `${CONTROL}[a]`, artifactHash: HASH, verdict: 'met', notes: 'roster reviewed', ...o,
  });
  const post = (b: unknown, token?: string) => fetch(`${base}/api/reviews`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-ces-principal': token } : {}) },
    body: JSON.stringify(b),
  });

  it('refuses without a token (401 missing_token)', async () => {
    const r = await post(body());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'unauthorized', reason: 'missing_token' });
  });

  it('refuses a bad token: wrong secret, and a validly signed token that was never minted', async () => {
    const wrongSecret = signPrincipalToken({ sub: `ao-approver:${REVIEWER}`, upn: REVIEWER, roles: [AO_APPROVER_ROLE], tid: TENANT.guid, jti: 'x' } as any,
      { secret: 'some-other-secret-0123456789', ttlSeconds: 600 });
    const r1 = await post(body(), wrongSecret);
    expect(r1.status).toBe(401);
    expect((await r1.json()).reason).toBe('bad_signature');
    const unminted = signPrincipalToken({ sub: `ao-approver:${REVIEWER}`, upn: REVIEWER, roles: [AO_APPROVER_ROLE], tid: TENANT.guid, jti: 'never-minted' } as any,
      { secret: AO_SECRET, ttlSeconds: 600 });
    const r2 = await post(body(), unminted);
    expect(r2.status).toBe(401);
    expect((await r2.json()).reason).toBe('unknown_mint');
  });

  it('refuses the uploader reviewing their own artifact (UPN, case-insensitive) with 403', async () => {
    const r = await post(body(), mint(UPLOADER.toUpperCase()));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe('reviewer_is_uploader');
  });

  it('refuses a missing artifact hash (400) and a hash no EC item carries (404)', async () => {
    const token = mint();
    const r1 = await post(body({ artifactHash: undefined }), token);
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe('artifactHash_required');
    const r2 = await post(body({ artifactHash: 'e'.repeat(64) }), token);
    expect(r2.status).toBe(404);
    expect((await r2.json()).error).toBe('artifact_not_found');
  });

  it('refuses an artifact whose uploader is unknown (409)', async () => {
    ecItems = [item({ uploadedBy: null })];
    const r = await post(body(), mint());
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('uploader_unknown');
  });

  it('refuses a bad verdict and an objective that is not the control\'s (400)', async () => {
    const token = mint();
    expect((await post(body({ verdict: 'partial' }), token)).status).toBe(400);
    const r = await post(body({ objectiveId: 'AC.L1-3.1.1[a]' }), token);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('objective_unknown');
  });

  it('records a valid review once (WORM) and lists it by tenant and control', async () => {
    const r = await post(body(), mint());
    expect(r.status).toBe(201);
    const rec = await r.json();
    expect(rec).toEqual(expect.objectContaining({
      tenantSlug: TENANT.slug, controlId: CONTROL, objectiveId: `${CONTROL}[a]`, artifactHash: HASH, verdict: 'met',
      uploader: { subjectId: `uploader:${UPLOADER}`, upn: UPLOADER }, ecItemIds: ['ec-item-1'],
    }));
    expect(rec.reviewer.upn).toBe(REVIEWER);

    const list = await (await fetch(`${base}/api/reviews?tenant=${TENANT.slug}&controlId=${CONTROL}`)).json();
    expect(list.reviews.map((x: { reviewId: string }) => x.reviewId)).toContain(rec.reviewId);
    const other = await (await fetch(`${base}/api/reviews?tenant=${TENANT.slug}&controlId=AC.L1-3.1.1`)).json();
    expect(other.reviews).toEqual([]);
    expect((await fetch(`${base}/api/reviews`)).status).toBe(400);

    // The collection is append-only: the stored row cannot be overwritten.
    expect(() => getCesRepository(dbPath).put(DOCUMENT_REVIEW_COLLECTION, {
      id: rec.reviewId, ces: { tenantSlug: TENANT.slug, tenantId: TENANT.guid }, data: { ...rec, verdict: 'not_met' },
    })).toThrow(/append-only/);
  });

  // FIN-12 (NS-audit F-7, FD-8): a supersede record; the latest review per objective counts.
  describe('FIN-12 supersede', () => {
    const SECOND = 'reviewer.two@review-tenant.example.test';
    const store = () => new DocumentReviewStore(dbPath);
    const tenant = { slug: TENANT.slug, tenantId: TENANT.guid };
    const objB = `${CONTROL}[b]`;

    it('a new review of the same objective supersedes the live one; the old row stays in WORM', async () => {
      const r1 = await (await post(body({ objectiveId: objB, verdict: 'not_met' }), mint())).json();
      expect(r1.supersedes).toBeUndefined();
      const r2res = await post(body({ objectiveId: objB, verdict: 'met' }), mint(SECOND));
      expect(r2res.status).toBe(201);
      const r2 = await r2res.json();
      expect(r2.supersedes).toEqual([r1.reviewId]);

      const live = store().list(tenant, CONTROL).filter((r) => r.objectiveId === objB);
      expect(live.map((r) => r.reviewId)).toEqual([r2.reviewId]);
      expect(live[0].verdict).toBe('met');

      const all = store().listAll(tenant, CONTROL).filter((r) => r.objectiveId === objB);
      expect(all.map((r) => r.reviewId).sort()).toEqual([r1.reviewId, r2.reviewId].sort());
      expect(all.find((r) => r.reviewId === r1.reviewId)!.supersededBy).toBe(r2.reviewId);
      expect(all.find((r) => r.reviewId === r2.reviewId)!.supersededBy).toBeUndefined();
      expect(getCesRepository(dbPath).get(DOCUMENT_REVIEW_COLLECTION, r1.reviewId, { tenantSlug: TENANT.slug, tenantId: TENANT.guid })).toBeTruthy();

      const got = await (await fetch(`${base}/api/reviews?tenant=${TENANT.slug}&controlId=${CONTROL}&history=1`)).json();
      expect(got.reviews.map((x: { reviewId: string }) => x.reviewId)).not.toContain(r1.reviewId);
      expect(got.history.find((x: { reviewId: string }) => x.reviewId === r1.reviewId).supersededBy).toBe(r2.reviewId);
      const plain = await (await fetch(`${base}/api/reviews?tenant=${TENANT.slug}&controlId=${CONTROL}`)).json();
      expect(plain.history).toBeUndefined();
    });

    it('a review of one objective never supersedes another objective', async () => {
      const before = store().list(tenant, CONTROL).filter((r) => r.objectiveId === `${CONTROL}[a]`).map((r) => r.reviewId);
      expect(before.length).toBeGreaterThan(0);
      const r3 = await (await post(body({ objectiveId: objB, verdict: 'met' }), mint())).json();
      expect(r3.supersedes).toHaveLength(1);
      expect(before.every((id) => !r3.supersedes.includes(id))).toBe(true);
      expect(store().list(tenant, CONTROL).filter((r) => r.objectiveId === `${CONTROL}[a]`).map((r) => r.reviewId)).toEqual(before);
    });

    it('legacy rows (no supersedes) all stay live until the next review of the objective supersedes every one', async () => {
      const ctl = 'AT.L2-3.2.3';
      const objA = `${ctl}[a]`;
      const legacy = (id: string, verdict: 'met' | 'not_met') => getCesRepository(dbPath).put(DOCUMENT_REVIEW_COLLECTION, {
        id, ces: { tenantSlug: TENANT.slug, tenantId: TENANT.guid },
        data: {
          reviewId: id, tenantSlug: TENANT.slug, controlId: ctl, objectiveId: objA, artifactHash: HASH, verdict,
          reviewer: { upn: REVIEWER, subjectId: 's', tokenId: 't' }, uploader: { upn: UPLOADER, subjectId: 'u' },
          ecItemIds: ['ec-item-1'], reviewedAt: '2026-10-30T00:00:00.000Z',
        },
      });
      legacy('legacy-1', 'met');
      legacy('legacy-2', 'not_met');
      expect(store().list(tenant, ctl).map((r) => r.reviewId).sort()).toEqual(['legacy-1', 'legacy-2']);
      ecItems = [item({ controlIds: [ctl] })];
      const r = await (await post(body({ controlId: ctl, objectiveId: objA, verdict: 'met' }), mint())).json();
      expect([...r.supersedes].sort()).toEqual(['legacy-1', 'legacy-2']);
      expect(store().list(tenant, ctl).map((x) => x.reviewId)).toEqual([r.reviewId]);
    });

    it('GD-b still holds on the superseding review: the uploader cannot supersede with their own review', async () => {
      const before = store().list(tenant, CONTROL).map((r) => r.reviewId);
      const r = await post(body({ objectiveId: objB, verdict: 'not_met' }), mint(UPLOADER));
      expect(r.status).toBe(403);
      expect(store().list(tenant, CONTROL).map((x) => x.reviewId)).toEqual(before);
    });

    it('liveReviews ignores a self-reference and keeps order', () => {
      const row = (reviewId: string, supersedes?: string[]) => ({ reviewId, controlId: CONTROL, objectiveId: objB, supersedes } as never);
      expect(liveReviews([row('a', ['a']), row('b'), row('c', ['b'])]).map((r: { reviewId: string }) => r.reviewId)).toEqual(['a', 'c']);
    });
  });

});
