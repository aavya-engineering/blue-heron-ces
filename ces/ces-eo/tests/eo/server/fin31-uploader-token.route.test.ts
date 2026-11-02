// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-31 (closes LOG-FIN-12 open item 2): the EC uploader-token issuer over real HTTP.
 * Operator auth is the loopback dev fallback (as approver-token.route.test.ts); the minted token is
 * checked with EC's REAL uploader middleware (read-only import from ces-ec), then carried through
 * the review route to prove GD-b end to end: an approver token for the uploader is refused 403, an
 * approver token for someone else is accepted.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories, getCesRepository } from 'ces-shared/persistence/node';
import { signPrincipalToken, getRequestPrincipal, type RequestPrincipal } from 'ces-shared/http/principal';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { EC_CONTRACT_VERSION } from 'ces-shared/types/evidence-collector';
import { createUploaderTokenRouter } from '../../../src/eo/server/routers/uploader-token-router';
import { UploaderTokenMintLog, UPLOADER_TOKEN_MINT_COLLECTION } from '../../../src/eo/uploader-tokens/UploaderTokenMintLog';
import { MAX_UPLOADER_TOKEN_TTL_SECONDS } from '../../../src/eo/uploader-tokens/UploaderTokenIssuer';
import { createReviewRouter, DocumentReviewStore } from '../../../src/eo/server/routers/review-router';
import { mintApproverToken } from '../../../src/eo/approver-tokens/ApproverTokenIssuer';
import { ApproverTokenMintLog } from '../../../src/eo/approver-tokens/ApproverTokenMintLog';
import { verifyMintedApproverToken } from '../../../src/eo/approver-tokens/ApproverTokenVerifier';
import { optionalUploaderPrincipal } from '../../../../ces-ec/src/auth';

const EC_SECRET = 'ec-principal-secret-for-fin31-tests-0123';
const AO_SECRET = 'ao-principal-secret-for-fin31-tests-4567';
const OP_SECRET = 'eo-operator-secret-for-fin31-tests-89ab';
const TENANT = { slug: 'fin31-upl-tenant', guid: '00000000-0000-4000-8000-0000000f3101' };
const UPLOADER = 'uploader.fin31@upl-tenant.example.test';
const REVIEWER = 'reviewer.fin31@upl-tenant.example.test';
const OPERATOR_UPN = 'operator.fin31@bhd.example.test';
const CONTROL = 'AT.L2-3.2.1';
const HASH = 'a'.repeat(64);

const opToken = (roles: string[] = ['bhd-operator']) =>
  signPrincipalToken({ sub: 'op-fin31', upn: OPERATOR_UPN, roles }, { secret: OP_SECRET, ttlSeconds: 600 });

const operator: RequestPrincipal = Object.freeze({
  subjectId: 'op-subject-fin31', upn: OPERATOR_UPN, roles: ['bhd-operator'], verified: true, source: 'token',
});

describe('FIN-31: /api/uploader-tokens', () => {
  let tmp: string;
  let dbPath: string;
  let server: Server;
  let base: string;
  let ecItems: EcEvidenceItem[] = [];
  const env: Record<string, string | undefined> = {};
  const prevTenantRoot = process.env.CES_TENANT_ROOT;
  const prevEcSecret = process.env.CES_EC_PRINCIPAL_SECRET;
  let approverMints: ApproverTokenMintLog;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fin31-upl-'));
    dbPath = path.join(tmp, 'ces.db');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    process.env.CES_EC_PRINCIPAL_SECRET = EC_SECRET; // read by EC's real middleware (getPrincipalConfig)
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', TENANT.slug), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', TENANT.slug, `${TENANT.slug}.json`),
      JSON.stringify({ tenant: { tenant_id: TENANT.guid, domain: 'upl-tenant.example.test' } }));
    approverMints = new ApproverTokenMintLog(dbPath);
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use(createUploaderTokenRouter({ stamperRoot, env, mintLog: new UploaderTokenMintLog(dbPath) }));
    app.use(createReviewRouter({
      stamperRoot, env, mints: approverMints, store: new DocumentReviewStore(dbPath), ecItems: async () => ecItems,
    }));
    // EC's own uploader check, as POST /api/ingest runs it.
    app.post('/ec-probe', optionalUploaderPrincipal as any, (req, res) => {
      const p = getRequestPrincipal(req);
      res.json({ uploadedBy: p ? { upn: p.upn, subjectId: p.subjectId } : null });
    });
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    Object.assign(env, {
      CES_EC_PRINCIPAL_SECRET: EC_SECRET, CES_AO_PRINCIPAL_SECRET: AO_SECRET,
      CES_EO_OPERATOR_SECRET: OP_SECRET, CES_EO_OPERATOR_DEV_FALLBACK: '1',
    });
  });

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()));
    closeAllCesRepositories();
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
    if (prevEcSecret === undefined) delete process.env.CES_EC_PRINCIPAL_SECRET; else process.env.CES_EC_PRINCIPAL_SECRET = prevEcSecret;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const mintUploader = (opts: { token?: string; tenant?: string | null; body?: unknown; forwardedFor?: string } = {}) => {
    const t = opts.tenant === undefined ? TENANT.slug : opts.tenant;
    return fetch(`${base}/api/uploader-tokens${t === null ? '' : `?tenant=${t}`}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { 'x-ces-principal': opts.token } : {}),
        ...(opts.forwardedFor ? { 'x-forwarded-for': opts.forwardedFor } : {}),
      },
      body: JSON.stringify(opts.body ?? { uploaderUpn: UPLOADER }),
    });
  };

  it('config is public and names the issuer state and operator mode, with no secret', async () => {
    const r = await fetch(`${base}/api/uploader-tokens/config`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ issuerConfigured: true, operatorAuth: 'dev-hs256', defaultTtlSeconds: 3600, maxTtlSeconds: MAX_UPLOADER_TOKEN_TTL_SECONDS });
    expect(JSON.stringify(body)).not.toContain(EC_SECRET);
  });

  it('an operator mints a token that EC records as the uploader; the mint is evidence without the token', async () => {
    const r = await mintUploader({ token: opToken() });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const minted = await r.json() as { token: string; mintId: string; uploaderUpn: string; operatorAuth: string; tenant: unknown };
    expect(minted.uploaderUpn).toBe(UPLOADER);
    expect(minted.operatorAuth).toBe('dev-hs256-unverified');
    expect(minted.tenant).toEqual({ slug: TENANT.slug, tenantId: TENANT.guid });

    const probe = await fetch(`${base}/ec-probe`, { method: 'POST', headers: { 'x-ces-principal': minted.token } });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toEqual({ uploadedBy: { upn: UPLOADER, subjectId: `uploader:${UPLOADER}` } });

    const rows = getCesRepository(dbPath).list(UPLOADER_TOKEN_MINT_COLLECTION, { tenantSlug: TENANT.slug, tenantId: TENANT.guid });
    const row = rows.find((x) => x.id === minted.mintId)!;
    expect(row.data).toMatchObject({ kind: 'ec-uploader-token-mint', uploader: { upn: UPLOADER }, mintedBy: { upn: OPERATOR_UPN } });
    expect(JSON.stringify(row.data)).not.toContain(minted.token);

    const list = await fetch(`${base}/api/uploader-tokens/mints?tenant=${TENANT.slug}`, { headers: { 'x-ces-principal': opToken() } });
    expect(list.status).toBe(200);
    expect(((await list.json()) as { mints: Array<{ mintId: string }> }).mints.map((m) => m.mintId)).toContain(minted.mintId);
  });

  it('refuses without an operator (401), a non-operator role (403), and a non-loopback dev operator (403)', async () => {
    expect((await mintUploader()).status).toBe(401);
    expect((await mintUploader({ token: opToken(['someone']) })).status).toBe(403);
    const remote = await mintUploader({ token: opToken(), forwardedFor: '203.0.113.9' });
    expect(remote.status).toBe(403);
    expect((await remote.json()).error).toBe('dev_operator_not_loopback');
    expect((await fetch(`${base}/api/uploader-tokens/mints?tenant=${TENANT.slug}`)).status).toBe(401);
  });

  it('refuses a missing or unknown tenant, a bad UPN and an excessive lifetime', async () => {
    expect((await mintUploader({ token: opToken(), tenant: null })).status).toBe(400);
    expect((await mintUploader({ token: opToken(), tenant: 'no-such-tenant' })).status).toBe(404);
    const bad = await mintUploader({ token: opToken(), body: { uploaderUpn: 'not a upn' } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('approver_invalid');
    const long = await mintUploader({ token: opToken(), body: { uploaderUpn: UPLOADER, ttlSeconds: MAX_UPLOADER_TOKEN_TTL_SECONDS + 1 } });
    expect(long.status).toBe(400);
    expect((await long.json()).error).toBe('ttl_excessive');
  });

  it('fails closed: no EC secret in EO (503 issuer_not_configured), or the EC secret reused as the AO secret (503 secret_reuse)', async () => {
    delete env.CES_EC_PRINCIPAL_SECRET;
    const a = await mintUploader({ token: opToken() });
    expect(a.status).toBe(503);
    expect((await a.json()).error).toBe('issuer_not_configured');
    env.CES_EC_PRINCIPAL_SECRET = AO_SECRET;
    const b = await mintUploader({ token: opToken() });
    expect(b.status).toBe(503);
    expect((await b.json()).error).toBe('secret_reuse');
  });

  it('an uploader token is not an approver token (AO signature, role and mint log all fail it)', async () => {
    const minted = await (await mintUploader({ token: opToken() })).json() as { token: string };
    const v = verifyMintedApproverToken(minted.token, { slug: TENANT.slug, tenantId: TENANT.guid }, { mints: approverMints, env });
    expect(v.ok).toBe(false);
  });

  it('GD-b end to end: the uploader recorded from a minted token cannot review it (403); another reviewer can (201)', async () => {
    const minted = await (await mintUploader({ token: opToken() })).json() as { token: string };
    const probe = await (await fetch(`${base}/ec-probe`, { method: 'POST', headers: { 'x-ces-principal': minted.token } })).json() as { uploadedBy: { upn: string; subjectId: string } };
    ecItems = [{
      contractVersion: EC_CONTRACT_VERSION as EcEvidenceItem['contractVersion'],
      itemId: 'ec-item-fin31', tenantSlug: TENANT.slug, controlIds: [CONTROL], source: 'manual_upload',
      filename: 'roster.pdf', mediaType: 'application/pdf', sha256: HASH, sizeBytes: 5,
      collectedAt: '2026-10-31T00:00:00.000Z', submittedByRole: 'compliance_officer',
      uploadedBy: probe.uploadedBy, mode: 'sim',
    }];
    const approver = (upn: string) => mintApproverToken(
      { operator, tenant: { slug: TENANT.slug, tenantId: TENANT.guid }, approverUpn: upn }, { env, evidence: approverMints }).token;
    const review = (token: string) => fetch(`${base}/api/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ces-principal': token },
      body: JSON.stringify({ tenant: TENANT.slug, controlId: CONTROL, objectiveId: `${CONTROL}[a]`, artifactHash: HASH, verdict: 'met' }),
    });
    const self = await review(approver(UPLOADER));
    expect(self.status).toBe(403);
    expect((await self.json()).error).toBe('reviewer_is_uploader');
    const other = await review(approver(REVIEWER));
    expect(other.status).toBe(201);
    expect(await other.json()).toMatchObject({ uploader: { upn: UPLOADER }, reviewer: { upn: REVIEWER } });
  });
});
