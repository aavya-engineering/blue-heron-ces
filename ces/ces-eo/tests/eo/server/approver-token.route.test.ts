// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-C AO-16 (2026-09-27) — the tenant-scoped approver-token route over real HTTP.
 * FC-EO-E (2026-09-28): the HS256 CES_EO_OPERATOR_SECRET operator token is now the explicit
 * dev-only fallback (CES_EO_OPERATOR_DEV_FALLBACK=1, loopback, recorded unverified), so this suite
 * runs with that flag set; the Entra ID production path is proven in approver-token-entra.route.test.ts.
 * Drives the REAL router with a temp ces.db and a temp stamper plan-data tenant; operator tokens are
 * signed with ces-shared's signPrincipalToken; minted tokens are checked with AdminOps' real
 * verifyApproverToken (read-only import from ces-ao).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { signPrincipalToken } from 'ces-shared/http/principal';
import { createApproverTokenRouter } from '../../../src/eo/server/routers/approver-token-router';
import { ApproverTokenMintLog } from '../../../src/eo/approver-tokens/ApproverTokenMintLog';
import { verifyApproverToken } from '../../../../ces-ao/src/execution/VerifiedApprover';

const AO_SECRET = 'ao-principal-secret-for-route-tests-01234';
const OP_SECRET = 'eo-operator-secret-for-route-tests-98765';
const TENANT = { slug: 'fceoc-route-tenant', guid: '00000000-0000-4000-8000-0000000fc0d1' };
const APPROVER = 'approver.two@route-tenant.example.test';
const OPERATOR_UPN = 'operator.two@bhd.example.test';

const opToken = (roles: string[] = ['bhd-operator'], secret = OP_SECRET, upn = OPERATOR_UPN) =>
  signPrincipalToken({ sub: 'op-2', upn, roles }, { secret, ttlSeconds: 600 });

describe('FC-EO-C AO-16: POST /api/approver-tokens', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  const env: Record<string, string | undefined> = {};
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-eo-c-route-'));
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', TENANT.slug), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', TENANT.slug, `${TENANT.slug}.json`),
      JSON.stringify({ tenant: { tenant_id: TENANT.guid, domain: 'route-tenant.example.test' } }));
    const app = express();
    app.set('trust proxy', true); // lets one test present a non-loopback client address
    app.use(express.json());
    app.use(createApproverTokenRouter({ stamperRoot, env, mintLog: new ApproverTokenMintLog(path.join(tmp, 'ces.db')) }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    Object.assign(env, { CES_AO_PRINCIPAL_SECRET: AO_SECRET, CES_EO_OPERATOR_SECRET: OP_SECRET, CES_EO_OPERATOR_DEV_FALLBACK: '1' });
  });

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()));
    closeAllCesRepositories();
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const post = (opts: { token?: string; tenant?: string | null; body?: unknown } = {}) => {
    const t = opts.tenant === undefined ? TENANT.slug : opts.tenant;
    return fetch(`${base}/api/approver-tokens${t === null ? '' : `?tenant=${t}`}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(opts.token ? { 'x-ces-principal': opts.token } : {}) },
      body: JSON.stringify(opts.body ?? { approverUpn: APPROVER }),
    });
  };

  it('an authenticated operator mints a token AdminOps accepts; response is no-store', async () => {
    const res = await post({ token: opToken() });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json() as { token: string; mintId: string; approverUpn: string; tenant: { slug: string; tenantId: string }; operatorAuth: string };
    expect(body.tenant).toEqual({ slug: TENANT.slug, tenantId: TENANT.guid });
    expect(body.operatorAuth).toBe('dev-hs256-unverified');
    expect(verifyApproverToken(body.token, { CES_AO_PRINCIPAL_SECRET: AO_SECRET } as NodeJS.ProcessEnv).upn).toBe(APPROVER);

    const list = await fetch(`${base}/api/approver-tokens/mints?tenant=${TENANT.slug}`, { headers: { 'x-ces-principal': opToken() } });
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).not.toContain(body.token);
    const mints = (JSON.parse(text) as { mints: Array<{ mintId: string; mintedBy: { upn: string }; approver: { upn: string } }> }).mints;
    expect(mints.find(m => m.mintId === body.mintId)).toMatchObject({
      mintedBy: { upn: OPERATOR_UPN }, approver: { upn: APPROVER }, operatorAuth: 'dev-hs256-unverified',
    });
  });

  it('refuses a caller with no operator token (401), even on loopback', async () => {
    expect((await post()).status).toBe(401);
  });

  it('refuses a verified principal without the operator role (403)', async () => {
    expect((await post({ token: opToken(['ao-approver']) })).status).toBe(403);
  });

  it('refuses an operator token signed with the wrong secret — e.g. an AO approver token (401)', async () => {
    expect((await post({ token: opToken(['bhd-operator'], AO_SECRET) })).status).toBe(401);
  });

  it('refuses when operator auth is not configured, or reuses the AO secret (503)', async () => {
    delete env.CES_EO_OPERATOR_SECRET;
    const r1 = await post({ token: opToken() });
    expect(r1.status).toBe(503);
    expect(((await r1.json()) as { error: string }).error).toBe('operator_auth_not_configured');
    env.CES_EO_OPERATOR_SECRET = AO_SECRET;
    const r2 = await post({ token: opToken(['bhd-operator'], AO_SECRET) });
    expect(r2.status).toBe(503);
    expect(((await r2.json()) as { error: string }).error).toBe('secret_reuse');
  });

  it('refuses when the AO secret is missing (503)', async () => {
    delete env.CES_AO_PRINCIPAL_SECRET;
    const r = await post({ token: opToken() });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('issuer_not_configured');
  });

  it('refuses a missing (400) or unknown (404) tenant', async () => {
    expect((await post({ token: opToken(), tenant: null })).status).toBe(400);
    expect((await post({ token: opToken(), tenant: 'no-such-tenant' })).status).toBe(404);
  });

  it('refuses an empty approver and an excessive lifetime (400)', async () => {
    const r1 = await post({ token: opToken(), body: { approverUpn: '  ' } });
    expect(r1.status).toBe(400);
    expect(((await r1.json()) as { error: string }).error).toBe('approver_required');
    const r2 = await post({ token: opToken(), body: { approverUpn: APPROVER, ttlSeconds: 86400 } });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { error: string }).error).toBe('ttl_excessive');
  });

  it('FC-EO-E: without the dev flag (and no Entra config) the HS256 operator token no longer mints (503)', async () => {
    delete env.CES_EO_OPERATOR_DEV_FALLBACK;
    const r = await post({ token: opToken() });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('operator_auth_not_configured');
  });

  it('FC-EO-E: the dev flag alongside Entra settings is refused as a misconfiguration (503)', async () => {
    env.CES_EO_OPERATOR_ENTRA_TENANT_ID = '00000000-0000-4000-8000-00000000e0e0';
    const r = await post({ token: opToken() });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('operator_auth_misconfigured');
  });

  it('FC-EO-E: the dev fallback refuses a non-loopback caller, even with a valid dev token (403)', async () => {
    const r = await fetch(`${base}/api/approver-tokens?tenant=${TENANT.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ces-principal': opToken(), 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ approverUpn: APPROVER }),
    });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('dev_operator_not_loopback');
  });

  it('the mint-evidence listing is operator-only too', async () => {
    expect((await fetch(`${base}/api/approver-tokens/mints?tenant=${TENANT.slug}`)).status).toBe(401);
  });
});
