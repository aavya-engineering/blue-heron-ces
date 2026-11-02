// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-E (2026-09-28) — the approver-token route with Microsoft Entra ID operator sign-in, over real
 * HTTP. The operator tenant's signing keys are local RSA keys served by an injected fetcher (no
 * network). A valid Entra operator mints a token AdminOps' real verifier accepts; wrong tenant,
 * missing group, expired and bad-signature tokens are refused, and so is the old HS256 operator token.
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
import {
  CLIENT_ID, HOST, JWKS_URI, OP_TENANT, OTHER_GROUP, OTHER_TENANT,
  entraEnv, entraToken, fakeFetch, jwksOf, makeKey,
} from '../approver-tokens/entra-test-kit';

const AO_SECRET = 'ao-principal-secret-for-entra-route-0123';
const TENANT = { slug: 'fceoe-route-tenant', guid: '00000000-0000-4000-8000-0000000fce01' };
const APPROVER = 'approver.e@route-tenant.example.test';
const OPERATOR_UPN = 'operator.e@bhd.example.test';

const key = makeKey('route-kid-1');
const forger = makeKey('route-kid-1');

describe('FC-EO-E: approver-token route with Entra operator sign-in', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  const env: Record<string, string | undefined> = {};
  const fetcher = fakeFetch(() => jwksOf(key));
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-eo-e-route-'));
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', TENANT.slug), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', TENANT.slug, `${TENANT.slug}.json`),
      JSON.stringify({ tenant: { tenant_id: TENANT.guid, domain: 'route-tenant.example.test' } }));
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use(createApproverTokenRouter({ stamperRoot, env, fetchJson: fetcher.fn, mintLog: new ApproverTokenMintLog(path.join(tmp, 'ces.db')) }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    Object.assign(env, { CES_AO_PRINCIPAL_SECRET: AO_SECRET, ...entraEnv() });
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    closeAllCesRepositories();
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const post = (token?: string, body: unknown = { approverUpn: APPROVER }, extra: Record<string, string> = {}) =>
    fetch(`${base}/api/approver-tokens?tenant=${TENANT.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { 'x-ces-principal': token } : {}), ...extra },
      body: JSON.stringify(body),
    });
  const errorOf = async (r: Response) => ((await r.json()) as { error: string; reason?: string });

  it('a valid Entra operator mints a token AdminOps accepts; evidence records the Entra sign-in and never the token', async () => {
    const res = await post(entraToken(key, { preferred_username: OPERATOR_UPN }));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json() as { token: string; mintId: string; operatorAuth: string; ttlSeconds: number };
    expect(body.operatorAuth).toBe('entra');
    expect(body.ttlSeconds).toBe(15 * 60);
    expect(verifyApproverToken(body.token, { CES_AO_PRINCIPAL_SECRET: AO_SECRET } as NodeJS.ProcessEnv).upn).toBe(APPROVER);

    const list = await fetch(`${base}/api/approver-tokens/mints?tenant=${TENANT.slug}`, { headers: { 'x-ces-principal': entraToken(key) } });
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).not.toContain(body.token);
    const row = (JSON.parse(text) as { mints: Array<Record<string, unknown>> }).mints.find(m => m.mintId === body.mintId);
    expect(row).toMatchObject({ operatorAuth: 'entra', mintedBy: { upn: OPERATOR_UPN, subjectId: '11111111-1111-4111-8111-111111111111' } });
    expect(fetcher.calls.every(u => u === JWKS_URI)).toBe(true);
  });

  it('works over a remote (non-loopback) connection too — Entra is not loopback-bound', async () => {
    const res = await post(entraToken(key), { approverUpn: APPROVER }, { 'x-forwarded-for': '203.0.113.9' });
    expect(res.status).toBe(201);
  });

  it('wrong tenant -> 401', async () => {
    const r = await post(entraToken(key, { tid: OTHER_TENANT, iss: `https://${HOST}/${OTHER_TENANT}/v2.0` }));
    expect(r.status).toBe(401);
    const r2 = await post(entraToken(key, { tid: OTHER_TENANT }));
    expect(r2.status).toBe(401);
  });

  it('signed-in, but not in the operator group -> 403', async () => {
    const r = await post(entraToken(key, { groups: [OTHER_GROUP] }));
    expect(r.status).toBe(403);
    expect((await errorOf(r)).error).toBe('forbidden');
  });

  it('expired -> 401', async () => {
    const r = await post(entraToken(key, { exp: Math.floor(Date.now() / 1000) - 600 }));
    expect(r.status).toBe(401);
    expect((await errorOf(r)).reason).toBe('expired');
  });

  it('bad signature (a different key claiming the same kid) -> 401', async () => {
    const r = await post(entraToken(forger));
    expect(r.status).toBe(401);
    expect((await errorOf(r)).reason).toBe('bad_signature');
  });

  it('wrong audience -> 401', async () => {
    const r = await post(entraToken(key, { aud: 'some-other-app' }));
    expect(r.status).toBe(401);
    expect((await errorOf(r)).reason).toBe('wrong_audience');
  });

  it('the old HS256 operator token is refused once Entra is configured, even on loopback', async () => {
    env.CES_EO_OPERATOR_SECRET = 'eo-operator-secret-for-entra-route-4567';
    const hs = signPrincipalToken({ sub: 'op', upn: OPERATOR_UPN, roles: ['bhd-operator'], tid: OP_TENANT }, { secret: env.CES_EO_OPERATOR_SECRET });
    const r = await post(hs);
    expect(r.status).toBe(401);
    expect((await errorOf(r)).reason).toBe('unsupported_alg');
  });

  it('no token -> 401; token rules still apply (self-issue 403, over the 30-minute cap 400)', async () => {
    expect((await post()).status).toBe(401);
    const self = await post(entraToken(key, { preferred_username: OPERATOR_UPN }), { approverUpn: OPERATOR_UPN.toUpperCase() });
    expect(self.status).toBe(403);
    expect((await errorOf(self)).error).toBe('self_mint');
    const long = await post(entraToken(key), { approverUpn: APPROVER, ttlSeconds: 31 * 60 });
    expect(long.status).toBe(400);
    expect((await errorOf(long)).error).toBe('ttl_excessive');
  });

  it('signing keys unavailable -> 503, no mint', async () => {
    const down = express();
    down.use(express.json());
    const stamperRoot = path.join(tmp, 'stamper');
    down.use(createApproverTokenRouter({
      stamperRoot, env, mintLog: new ApproverTokenMintLog(path.join(tmp, 'ces.db')),
      fetchJson: async () => { throw new Error('offline'); },
    }));
    const s = await new Promise<Server>(resolve => { const x = down.listen(0, '127.0.0.1', () => resolve(x)); });
    try {
      const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/approver-tokens?tenant=${TENANT.slug}`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-ces-principal': entraToken(key) },
        body: JSON.stringify({ approverUpn: APPROVER }),
      });
      expect(r.status).toBe(503);
      expect((await errorOf(r)).error).toBe('operator_keys_unavailable');
    } finally {
      s.closeAllConnections();
      await new Promise<void>(r => s.close(() => r()));
    }
  });

  it('GET /api/approver-tokens/config exposes the sign-in settings and no secrets', async () => {
    env.CES_EO_OPERATOR_SECRET = 'eo-operator-secret-should-never-leak-99';
    const r = await fetch(`${base}/api/approver-tokens/config`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toMatchObject({
      mode: 'entra',
      entra: {
        tenantId: OP_TENANT, clientId: CLIENT_ID, authorityHost: HOST,
        authorizeUrl: `https://${HOST}/${OP_TENANT}/oauth2/v2.0/authorize`,
        tokenUrl: `https://${HOST}/${OP_TENANT}/oauth2/v2.0/token`,
      },
      defaultTtlSeconds: 900, maxTtlSeconds: 1800,
    });
    expect(text).not.toContain(AO_SECRET);
    expect(text).not.toContain(env.CES_EO_OPERATOR_SECRET);
    expect(text).not.toContain(entraEnv().CES_EO_OPERATOR_ENTRA_GROUP_ID);
  });
});
