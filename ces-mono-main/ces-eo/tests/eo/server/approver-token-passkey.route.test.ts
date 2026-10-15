// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-G (2026-09-28, founder decisions 16-19) — passkey operator sign-in for the approver-token
 * issuer, over real HTTP against the real router, with a software WebAuthn authenticator (locally
 * generated P-256 keys; no browser, no network). Proves: enroll -> sign in -> mint, and the minted
 * token is accepted by AdminOps' real verifier; revoked / unknown / wrong-origin / replayed (counter)
 * / user-verification-missing assertions are refused; an expired enrollment code is refused.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createApproverTokenRouter } from '../../../src/eo/server/routers/approver-token-router';
import { ApproverTokenMintLog } from '../../../src/eo/approver-tokens/ApproverTokenMintLog';
import { PasskeyOperatorService, OPERATOR_SESSION_PREFIX } from '../../../src/eo/approver-tokens/PasskeyOperatorService';
import { PasskeyOperatorStore } from '../../../src/eo/approver-tokens/PasskeyOperatorStore';
import { runOperatorCli } from '../../../src/eo/approver-tokens/operatorPasskeyCli';
import { verifyApproverToken } from '../../../../ces-ao/src/execution/VerifiedApprover';
import { SoftAuthenticator } from '../approver-tokens/passkey-test-kit';
import { entraEnv } from '../approver-tokens/entra-test-kit';

const AO_SECRET = 'ao-principal-secret-for-passkey-route-01';
const ORIGIN = 'http://localhost:5004';
const RP_ID = 'localhost';
const TENANT = { slug: 'fceog-route-tenant', guid: '00000000-0000-4000-8000-0000000fce09' };
const APPROVER = 'approver.g@route-tenant.example.test';
const OPERATOR = { name: 'Operator One', upn: 'operator.one@bhd.example.test' };

type Json = Record<string, any>;

describe('FC-EO-G: approver-token issuer with passkey operator sign-in', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let clock = Date.now();
  const now = () => clock;
  let store: PasskeyOperatorStore;
  let passkeys: PasskeyOperatorService;
  let mintLog: ApproverTokenMintLog;
  const env: Record<string, string | undefined> = {};
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-eo-g-route-'));
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', TENANT.slug), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', TENANT.slug, `${TENANT.slug}.json`),
      JSON.stringify({ tenant: { tenant_id: TENANT.guid, domain: 'route-tenant.example.test' } }));
    const db = path.join(tmp, 'ces.db');
    store = new PasskeyOperatorStore(db);
    passkeys = new PasskeyOperatorService({ store, now });
    mintLog = new ApproverTokenMintLog(db);
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use(createApproverTokenRouter({ stamperRoot, env, mintLog, passkeys, now }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    clock = Date.now();
    for (const k of Object.keys(env)) delete env[k];
    Object.assign(env, { CES_AO_PRINCIPAL_SECRET: AO_SECRET, CES_EO_OPERATOR_PASSKEY_ORIGIN: ORIGIN });
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    closeAllCesRepositories();
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    return { status: r.status, body: (text ? JSON.parse(text) : {}) as Json, text, headers: r.headers };
  };
  const asOp = (session: string) => ({ 'x-ces-principal': session });

  /** First-operator enrollment code through the real local command. */
  function cliEnrollCode(name = OPERATOR.name, upn = OPERATOR.upn): string {
    const lines: string[] = [];
    const exit = runOperatorCli(['enroll', '--name', name, '--upn', upn], { env, service: passkeys, out: l => lines.push(l), err: l => lines.push(l) });
    expect(exit).toBe(0);
    const m = /#enroll=([A-Za-z0-9_-]+)/.exec(lines.join('\n'));
    expect(m).not.toBeNull();
    expect(lines.join('\n')).toContain(`${ORIGIN}/approver-tokens.html#enroll=`);
    return m![1];
  }

  async function enroll(auth: SoftAuthenticator, code: string, o: Parameters<SoftAuthenticator['register']>[1] = {}) {
    const opts = await call('POST', '/api/approver-tokens/passkeys/enroll/options', { code });
    expect(opts.status).toBe(200);
    expect(opts.body.authenticatorSelection).toMatchObject({ userVerification: 'required', residentKey: 'required' });
    expect(opts.body.rp).toMatchObject({ id: RP_ID });
    return call('POST', '/api/approver-tokens/passkeys/enroll/verify', { code, response: auth.register(opts.body as any, o) });
  }

  async function signIn(auth: SoftAuthenticator, o: Parameters<SoftAuthenticator['assert']>[1] = {}) {
    const opts = await call('POST', '/api/approver-tokens/passkeys/signin/options', {});
    expect(opts.status).toBe(200);
    expect(opts.body.options.userVerification).toBe('required');
    const response = auth.assert(opts.body.options, o);
    const r = await call('POST', '/api/approver-tokens/passkeys/signin/verify', { challengeId: opts.body.challengeId, response });
    return { ...r, challengeId: opts.body.challengeId as string, response };
  }

  const mint = (session: string, approverUpn = APPROVER) =>
    call('POST', `/api/approver-tokens?tenant=${TENANT.slug}`, { approverUpn }, asOp(session));

  async function enrolledOperator(name: string, upn: string) {
    const auth = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
    const r = await enroll(auth, cliEnrollCode(name, upn));
    expect(r.status).toBe(201);
    return auth;
  }

  it('config reports passkey mode with the RP id and origin (no secrets)', async () => {
    const r = await call('GET', '/api/approver-tokens/config');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'passkey', passkey: { rpId: RP_ID, origin: ORIGIN, sessionTtlSeconds: 900 }, maxTtlSeconds: 1800 });
  });

  it('enroll -> sign in -> mint: AdminOps accepts the token; the mint and the enrollment are evidence', async () => {
    const auth = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
    const code = cliEnrollCode();
    const en = await enroll(auth, code);
    expect(en.status).toBe(201);
    expect(en.body).toMatchObject({ credentialId: auth.id, displayName: OPERATOR.name, upn: OPERATOR.upn });

    const s = await signIn(auth);
    expect(s.status).toBe(200);
    expect(s.body.sessionToken.startsWith(OPERATOR_SESSION_PREFIX)).toBe(true);
    expect(Date.parse(s.body.expiresAt) - clock).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(s.body.operator).toMatchObject({ displayName: OPERATOR.name, upn: OPERATOR.upn });

    const m = await mint(s.body.sessionToken);
    expect(m.status).toBe(201);
    expect(m.headers.get('cache-control')).toBe('no-store');
    expect(m.body).toMatchObject({ operatorAuth: 'passkey', ttlSeconds: 900 });
    const ao = verifyApproverToken(m.body.token, { CES_AO_PRINCIPAL_SECRET: AO_SECRET } as NodeJS.ProcessEnv);
    expect(ao.upn).toBe(APPROVER);

    const list = await call('GET', `/api/approver-tokens/mints?tenant=${TENANT.slug}`, undefined, asOp(s.body.sessionToken));
    expect(list.status).toBe(200);
    expect(list.text).not.toContain(m.body.token);
    const row = (list.body.mints as Json[]).find(x => x.mintId === m.body.mintId);
    expect(row).toMatchObject({ operatorAuth: 'passkey', operatorCredentialId: auth.id, mintedBy: { upn: OPERATOR.upn } });

    // Stored: operator id, display name, credential id, public key, counter, created, last used.
    const stored = store.getPasskey(auth.id)!;
    expect(stored).toMatchObject({ displayName: OPERATOR.name, upn: OPERATOR.upn, credentialId: auth.id, counter: 1 });
    expect(stored.operatorId).toBeTruthy();
    expect(stored.publicKey.length).toBeGreaterThan(40);
    expect(stored.createdAt).toBeTruthy();
    expect(stored.lastUsedAt).toBeTruthy();
    const kinds = store.listEvents().filter(e => e.operator.upn === OPERATOR.upn).map(e => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['operator-enrollment-code-issued', 'operator-passkey-enrolled']));
    expect(store.listEvents().find(e => e.kind === 'operator-passkey-enrolled' && e.credentialId === auth.id)?.by).toEqual({ kind: 'local-command' });

    // The code is single use.
    const again = await call('POST', '/api/approver-tokens/passkeys/enroll/options', { code });
    expect(again.status).toBe(401);
    expect(again.body.error).toBe('enrollment_code_used');
  });

  it('keeps the mint rules: no self-issue, 30-minute cap', async () => {
    const auth = await enrolledOperator('Operator Self', 'operator.self@bhd.example.test');
    const s = await signIn(auth);
    const self = await mint(s.body.sessionToken, 'operator.self@bhd.example.test');
    expect(self.status).toBe(403);
    expect(self.body.error).toBe('self_mint');
    const long = await call('POST', `/api/approver-tokens?tenant=${TENANT.slug}`, { approverUpn: APPROVER, ttlSeconds: 31 * 60 }, asOp(s.body.sessionToken));
    expect(long.status).toBe(400);
    expect(long.body.error).toBe('ttl_excessive');
  });

  it('refuses an unknown passkey (never enrolled)', async () => {
    const stranger = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
    const r = await signIn(stranger);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('passkey_unknown');
  });

  it('refuses a wrong-origin assertion and a wrong-RP assertion', async () => {
    const auth = await enrolledOperator('Operator Origin', 'operator.origin@bhd.example.test');
    const r = await signIn(auth, { origin: 'http://localhost:6666' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('passkey_verification_failed');
    expect(r.body.detail).toMatch(/origin/i);
    const r2 = await signIn(auth, { rpId: 'evil.example.test' });
    expect(r2.status).toBe(401);
    expect(r2.body.error).toBe('passkey_verification_failed');
  });

  it('refuses an assertion without user verification', async () => {
    const auth = await enrolledOperator('Operator UV', 'operator.uv@bhd.example.test');
    const r = await signIn(auth, { userVerified: false });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('passkey_verification_failed');
    expect(r.body.detail).toMatch(/verif/i);
  });

  it('refuses a replay: the same assertion again (single-use challenge) and a non-advancing counter', async () => {
    const auth = await enrolledOperator('Operator Replay', 'operator.replay@bhd.example.test');
    const ok = await signIn(auth); // counter 1
    expect(ok.status).toBe(200);
    // Exact replay of the accepted assertion.
    const replay = await call('POST', '/api/approver-tokens/passkeys/signin/verify', { challengeId: ok.challengeId, response: ok.response });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('passkey_challenge_invalid');
    // A fresh challenge signed with a counter that did not advance (cloned authenticator).
    const cloned = await signIn(auth, { counter: 1 });
    expect(cloned.status).toBe(401);
    expect(cloned.body.error).toBe('passkey_verification_failed');
    expect(cloned.body.detail).toMatch(/counter/i);
    expect(store.getPasskey(auth.id)!.counter).toBe(1);
  });

  it('refuses enrollment without user verification or from the wrong origin, and an expired code', async () => {
    const a1 = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
    const noUv = await enroll(a1, cliEnrollCode('Operator E1', 'operator.e1@bhd.example.test'), { userVerified: false });
    expect(noUv.status).toBe(401);
    expect(noUv.body.error).toBe('passkey_verification_failed');
    const badOrigin = await enroll(a1, cliEnrollCode('Operator E2', 'operator.e2@bhd.example.test'), { origin: 'https://evil.example.test' });
    expect(badOrigin.status).toBe(401);
    expect(badOrigin.body.error).toBe('passkey_verification_failed');
    expect(store.getPasskey(a1.id)).toBeUndefined();

    const code = cliEnrollCode('Operator E3', 'operator.e3@bhd.example.test');
    clock += 10 * 60 * 1000 + 1000;
    const expired = await call('POST', '/api/approver-tokens/passkeys/enroll/options', { code });
    expect(expired.status).toBe(401);
    expect(expired.body.error).toBe('enrollment_code_expired');
    const bogus = await call('POST', '/api/approver-tokens/passkeys/enroll/options', { code: 'not-a-real-code' });
    expect(bogus.status).toBe(401);
    expect(bogus.body.error).toBe('enrollment_code_invalid');
  });

  it('an expired code is refused even if the ceremony started in time', async () => {
    const a = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
    const code = cliEnrollCode('Operator Late', 'operator.late@bhd.example.test');
    const opts = await call('POST', '/api/approver-tokens/passkeys/enroll/options', { code });
    clock += 10 * 60 * 1000 + 1000;
    const r = await call('POST', '/api/approver-tokens/passkeys/enroll/verify', { code, response: a.register(opts.body as any) });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('enrollment_code_expired');
  });

  it('an enrolled operator adds a second operator from the issuer routes, lists passkeys and revokes one — immediately', async () => {
    const first = await enrolledOperator('Operator Admin', 'operator.admin@bhd.example.test');
    const s1 = (await signIn(first)).body.sessionToken as string;

    const issued = await call('POST', '/api/approver-tokens/passkeys/enrollment-codes',
      { displayName: 'Operator Two', upn: 'operator.two@bhd.example.test' }, asOp(s1));
    expect(issued.status).toBe(201);
    expect(issued.body.link).toBe(`${ORIGIN}/approver-tokens.html#enroll=${issued.body.code}`);
    expect(Date.parse(issued.body.expiresAt) - clock).toBe(10 * 60 * 1000);

    const second = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
    expect((await enroll(second, issued.body.code)).status).toBe(201);
    const enrolledEvent = store.listEvents().find(e => e.kind === 'operator-passkey-enrolled' && e.credentialId === second.id)!;
    expect(enrolledEvent.by).toMatchObject({ kind: 'operator', upn: 'operator.admin@bhd.example.test', credentialId: first.id });

    const s2 = (await signIn(second)).body.sessionToken as string;
    expect((await mint(s2)).status).toBe(201);

    const list = await call('GET', '/api/approver-tokens/passkeys', undefined, asOp(s1));
    expect(list.status).toBe(200);
    const ids = (list.body.passkeys as Json[]).map(p => p.credentialId);
    expect(ids).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(list.text).not.toContain('publicKey');

    const rev = await call('DELETE', `/api/approver-tokens/passkeys/${encodeURIComponent(second.id)}`, undefined, asOp(s1));
    expect(rev.status).toBe(200);
    expect(rev.body.revoked.revokedAt).toBeTruthy();
    const revokedEvent = store.listEvents().find(e => e.kind === 'operator-passkey-revoked' && e.credentialId === second.id)!;
    expect(revokedEvent.by).toMatchObject({ kind: 'operator', credentialId: first.id });

    // Immediate: the open session of the revoked passkey no longer mints, and it cannot sign in again.
    const after = await mint(s2);
    expect(after.status).toBe(401);
    const again = await signIn(second);
    expect(again.status).toBe(401);
    expect(again.body.error).toBe('passkey_revoked');
    // The revoking operator is unaffected.
    expect((await mint(s1)).status).toBe(201);
  });

  it('a revocation from the local command also ends open sessions immediately', async () => {
    const auth = await enrolledOperator('Operator Cli', 'operator.cli@bhd.example.test');
    const s = (await signIn(auth)).body.sessionToken as string;
    const lines: string[] = [];
    // A separate service instance over the same store, as the command would be (separate process).
    const cliService = new PasskeyOperatorService({ store });
    expect(runOperatorCli(['revoke', auth.id], { env, service: cliService, out: l => lines.push(l), err: l => lines.push(l) })).toBe(0);
    const r = await mint(s);
    expect(r.status).toBe(401);
    expect(r.body.reason).toBe('passkey_revoked');
    const listed: string[] = [];
    runOperatorCli(['list'], { env, service: cliService, out: l => listed.push(l) });
    expect(listed.join('\n')).toMatch(new RegExp(`${auth.id}.*REVOKED`));
  });

  it('the operator session expires after 15 minutes; a made-up session is refused', async () => {
    const auth = await enrolledOperator('Operator Ttl', 'operator.ttl@bhd.example.test');
    const s = (await signIn(auth)).body.sessionToken as string;
    clock += 15 * 60 * 1000 + 1000;
    const r = await mint(s);
    expect(r.status).toBe(401);
    expect(r.body.reason).toBe('session_expired');
    const fake = await mint(`${OPERATOR_SESSION_PREFIX}made-up`);
    expect(fake.status).toBe(401);
    expect((await mint('')).status).toBe(401);
  });

  it('is on-box only: remote requests to sign in or mint are refused (403)', async () => {
    const auth = await enrolledOperator('Operator Remote', 'operator.remote@bhd.example.test');
    const s = (await signIn(auth)).body.sessionToken as string;
    const remote = { 'x-forwarded-for': '203.0.113.7' };
    const o = await call('POST', '/api/approver-tokens/passkeys/signin/options', {}, remote);
    expect(o.status).toBe(403);
    expect(o.body.error).toBe('passkey_not_loopback');
    const m = await call('POST', `/api/approver-tokens?tenant=${TENANT.slug}`, { approverUpn: APPROVER }, { ...asOp(s), ...remote });
    expect(m.status).toBe(403);
    expect(m.body.error).toBe('passkey_not_loopback');
  });

  it('operator routes (list, issue code, revoke) need an operator session', async () => {
    expect((await call('GET', '/api/approver-tokens/passkeys')).status).toBe(401);
    expect((await call('POST', '/api/approver-tokens/passkeys/enrollment-codes', { displayName: 'X', upn: 'x@bhd.example.test' })).status).toBe(401);
    expect((await call('DELETE', '/api/approver-tokens/passkeys/anything')).status).toBe(401);
  });

  it('fails closed when passkey settings are combined with Entra or the dev fallback, or are unsafe', async () => {
    Object.assign(env, entraEnv());
    let r = await call('POST', '/api/approver-tokens/passkeys/signin/options', {});
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('operator_auth_misconfigured');
    for (const k of Object.keys(entraEnv())) delete env[k];
    env.CES_EO_OPERATOR_DEV_FALLBACK = '1';
    r = await call('GET', '/api/approver-tokens/config');
    expect(r.body).toMatchObject({ mode: 'not_configured', error: 'operator_auth_misconfigured' });
    delete env.CES_EO_OPERATOR_DEV_FALLBACK;
    for (const bad of ['http://evil.example.test', 'http://127.0.0.1:5004', 'http://localhost:5004/approver-tokens.html', 'not a url']) {
      env.CES_EO_OPERATOR_PASSKEY_ORIGIN = bad;
      r = await call('POST', '/api/approver-tokens/passkeys/signin/options', {});
      expect(r.status).toBe(503);
      expect(r.body.error).toBe('operator_auth_not_configured');
    }
    env.CES_EO_OPERATOR_PASSKEY_ORIGIN = ORIGIN;
    env.CES_EO_OPERATOR_SESSION_TTL_SECONDS = '3600';
    r = await call('POST', '/api/approver-tokens/passkeys/signin/options', {});
    expect(r.status).toBe(503);
  });

  it('passkey routes are closed when passkey sign-in is not the configured mode', async () => {
    delete env.CES_EO_OPERATOR_PASSKEY_ORIGIN;
    Object.assign(env, entraEnv());
    const r = await call('POST', '/api/approver-tokens/passkeys/signin/options', {});
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('passkey_sign_in_not_enabled');
    const lines: string[] = [];
    expect(runOperatorCli(['enroll', '--name', 'X', '--upn', 'x@bhd.example.test'], { env, service: passkeys, err: l => lines.push(l) })).toBe(2);
  });

  it('the enroll command requires a display name and the operator\'s own address', () => {
    const errs: string[] = [];
    expect(runOperatorCli(['enroll', '--name', 'No Upn'], { env, service: passkeys, err: l => errs.push(l) })).toBe(1);
    expect(errs.join('\n')).toContain('operator_upn_invalid');
    expect(runOperatorCli(['enroll', '--upn', 'no.name@bhd.example.test'], { env, service: passkeys, err: l => errs.push(l) })).toBe(1);
    expect(errs.join('\n')).toContain('operator_name_required');
  });
});
