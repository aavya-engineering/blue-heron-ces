// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-E step 3 — the approver-token issuer page (public/approver-tokens.html).
 * Its functions are lifted out of the served HTML unmodified and driven against the REAL
 * approver-token router over HTTP, configured for Entra operator sign-in with locally generated
 * signing keys (no network). The Entra sign-in redirect itself cannot run offline: the PKCE start
 * and the code-exchange completion are exercised against stubbed browser globals and a stubbed
 * token endpoint.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, webcrypto } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createApproverTokenRouter } from '../../src/eo/server/routers/approver-token-router';
import { ApproverTokenMintLog } from '../../src/eo/approver-tokens/ApproverTokenMintLog';
import { verifyApproverToken } from '../../../ces-ao/src/execution/VerifiedApprover';
import {
  CLIENT_ID, HOST, OP_TENANT, OTHER_GROUP, entraEnv, entraToken, fakeFetch, jwksOf, makeKey,
} from '../eo/approver-tokens/entra-test-kit';

const HTML_PATH = path.resolve(__dirname, '../../public/approver-tokens.html');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

/** Lift a top-level `function <name>(` (or `async function`) out of the served HTML, unmodified. */
function liftFunction(name: string): string {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThan(0);
  const asyncIdx = html.lastIndexOf('async ', start);
  const realStart = (asyncIdx >= 0 && start - asyncIdx <= 6) ? asyncIdx : start;
  const open = html.indexOf('{', html.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(realStart, i + 1); }
  }
  throw new Error(`unbalanced function ${name}`);
}

const AO_SECRET = 'ao-principal-secret-for-issuer-page-0123';
const TENANT = { slug: 'fceoe-ui-tenant', guid: '00000000-0000-4000-8000-0000000fce0a' };
const APPROVER = 'approver.ui@ui-tenant.example.test';
const key = makeKey('ui-kid-1');

type El = { innerHTML: string; textContent: string; className: string; value: string; hidden: boolean };
const el = (): El => ({ innerHTML: '', textContent: '', className: '', value: '', hidden: true });

describe('FC-EO-E: approver-token issuer page', () => {
  it('is served as a page with sign-in, tenant picker, one-time token + copy, and recent mints', () => {
    for (const id of ['issuerSignInBtn', 'issuerTenant', 'issuerApprover', 'issuerTtl', 'issuerMintBtn',
      'issuerTokenOut', 'issuerCopyBtn', 'issuerMintsBody']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/shown once/i);
    // The page never persists the minted token or the operator token.
    expect(html).not.toMatch(/localStorage/);
    expect(html).not.toMatch(/sessionStorage\.setItem\([^)]*(token|Token)/);
  });

  describe('against the real route (Entra operator)', () => {
    let tmp: string;
    let server: Server;
    let base: string;
    const env: Record<string, string | undefined> = { CES_AO_PRINCIPAL_SECRET: AO_SECRET, ...entraEnv() };
    const prevTenantRoot = process.env.CES_TENANT_ROOT;

    beforeAll(async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-eo-e-ui-'));
      process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
      const stamperRoot = path.join(tmp, 'stamper');
      fs.mkdirSync(path.join(stamperRoot, 'plan-data', TENANT.slug), { recursive: true });
      fs.writeFileSync(path.join(stamperRoot, 'plan-data', TENANT.slug, `${TENANT.slug}.json`),
        JSON.stringify({ tenant: { tenant_id: TENANT.guid, domain: 'ui-tenant.example.test' } }));
      const app = express();
      app.use(express.json());
      app.use(createApproverTokenRouter({
        stamperRoot, env, fetchJson: fakeFetch(() => jwksOf(key)).fn,
        mintLog: new ApproverTokenMintLog(path.join(tmp, 'ces.db')),
      }));
      server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r()));
      closeAllCesRepositories();
      if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    function page() {
      const els: Record<string, El> = {};
      const $ = (sel: string) => (els[sel] ??= el());
      const pageFetch = (url: string, init?: RequestInit) => fetch(base + url, init);
      // eslint-disable-next-line no-new-func
      const factory = new Function('fetch', '$', 'encodeURIComponent',
        `${liftFunction('issuerEsc')}\n${liftFunction('issuerMint')}\n${liftFunction('issuerLoadMints')}\nreturn { issuerMint, issuerLoadMints };`);
      return { els, fns: factory(pageFetch, $, encodeURIComponent) as {
        issuerMint: (op: string, tenant: string, upn: string, name: string, ttl: string) => Promise<Record<string, unknown> | null>;
        issuerLoadMints: (op: string, tenant: string) => Promise<void>;
      } };
    }

    it('a signed-in operator mints: the token is shown once, AdminOps accepts it, and recent mints list it without the token', async () => {
      const { els, fns } = page();
      const op = entraToken(key, { preferred_username: 'operator.ui@bhd.example.test' });
      const data = await fns.issuerMint(op, TENANT.slug, APPROVER, 'Approver UI', '10');
      expect(data).not.toBeNull();
      const token = els['#issuerTokenOut'].value;
      expect(token).toBe(data!.token);
      expect(els['#issuerTokenBox'].hidden).toBe(false);
      expect(els['#issuerMintStatus'].className).toBe('status ok');
      const aoP = verifyApproverToken(token, { CES_AO_PRINCIPAL_SECRET: AO_SECRET } as NodeJS.ProcessEnv);
      expect(aoP.upn).toBe(APPROVER);
      expect(data!.ttlSeconds).toBe(600);

      await fns.issuerLoadMints(op, TENANT.slug);
      const table = els['#issuerMintsBody'].innerHTML;
      expect(table).toContain(APPROVER);
      expect(table).toContain('operator.ui@bhd.example.test');
      expect(table).toContain('entra');
      expect(table).not.toContain(token);
    });

    it('a signed-in user outside the operator group is refused; no token is shown', async () => {
      const { els, fns } = page();
      const data = await fns.issuerMint(entraToken(key, { groups: [OTHER_GROUP] }), TENANT.slug, APPROVER, '', '15');
      expect(data).toBeNull();
      expect(els['#issuerTokenOut'].value).toBe('');
      expect(els['#issuerTokenBox'].hidden).toBe(true);
      expect(els['#issuerMintStatus'].textContent).toMatch(/^Refused \(403\)/);
    });

    it('an expired sign-in is refused (401), and a 31-minute lifetime is refused by the 30-minute cap (400)', async () => {
      const { els, fns } = page();
      expect(await fns.issuerMint(entraToken(key, { exp: Math.floor(Date.now() / 1000) - 600 }), TENANT.slug, APPROVER, '', '15')).toBeNull();
      expect(els['#issuerMintStatus'].textContent).toMatch(/^Refused \(401\)/);
      expect(await fns.issuerMint(entraToken(key), TENANT.slug, APPROVER, '', '31')).toBeNull();
      expect(els['#issuerMintStatus'].textContent).toMatch(/^Refused \(400\)/);
    });

    it('without a sign-in or a tenant, nothing is sent', async () => {
      const { els, fns } = page();
      expect(await fns.issuerMint('', TENANT.slug, APPROVER, '', '15')).toBeNull();
      expect(els['#issuerMintStatus'].textContent).toBe('Sign in first.');
      expect(await fns.issuerMint(entraToken(key), '', APPROVER, '', '15')).toBeNull();
      expect(els['#issuerMintStatus'].textContent).toBe('Pick a tenant.');
    });
  });

  describe('Entra sign-in (authorization code + PKCE), with stubbed browser globals', () => {
    const entra = {
      tenantId: OP_TENANT, clientId: CLIENT_ID, authorityHost: HOST,
      authorizeUrl: `https://${HOST}/${OP_TENANT}/oauth2/v2.0/authorize`,
      tokenUrl: `https://${HOST}/${OP_TENANT}/oauth2/v2.0/token`,
      scopes: ['openid', 'profile'],
    };

    function browser(search = '') {
      const store = new Map<string, string>();
      const assigned: string[] = [];
      const tokenCalls: Array<{ url: string; body: string }> = [];
      const g = {
        location: { origin: 'https://eo.example.test', pathname: '/approver-tokens.html', search, assign: (u: string) => assigned.push(u) },
        history: { replaceState: () => undefined },
        sessionStorage: {
          setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null,
          removeItem: (k: string) => store.delete(k),
        },
        crypto: webcrypto,
        tokenResponse: {} as Record<string, unknown>,
      };
      const fetchStub = async (url: string, init: { body: string }) => {
        tokenCalls.push({ url, body: init.body });
        return { ok: true, status: 200, json: async () => g.tokenResponse };
      };
      // eslint-disable-next-line no-new-func
      const factory = new Function('location', 'history', 'sessionStorage', 'crypto', 'fetch', 'cfg', `
        var issuerConfig = cfg; var issuerOperatorToken = '';
        ${liftFunction('issuerB64url')}
        ${liftFunction('issuerRandom')}
        ${liftFunction('issuerJwtClaims')}
        ${liftFunction('issuerRedirectUri')}
        ${liftFunction('issuerStartSignIn')}
        ${liftFunction('issuerCompleteSignIn')}
        return { issuerStartSignIn, issuerCompleteSignIn, token: function () { return issuerOperatorToken; } };`);
      const fns = factory(g.location, g.history, g.sessionStorage, g.crypto, fetchStub, { mode: 'entra', entra });
      return { g, store, assigned, tokenCalls, fns };
    }

    const idToken = (nonce: string) => entraToken(makeKey('id-kid'), { nonce });

    it('starts sign-in at the operator tenant authorize URL with an S256 PKCE challenge', async () => {
      const b = browser();
      await b.fns.issuerStartSignIn();
      expect(b.assigned.length).toBe(1);
      const u = new URL(b.assigned[0]);
      expect(`${u.origin}${u.pathname}`).toBe(entra.authorizeUrl);
      expect(u.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(u.searchParams.get('response_type')).toBe('code');
      expect(u.searchParams.get('redirect_uri')).toBe('https://eo.example.test/approver-tokens.html');
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      const saved = JSON.parse(b.store.get('issuer.pkce')!);
      expect(u.searchParams.get('code_challenge')).toBe(createHash('sha256').update(saved.verifier).digest('base64url'));
      expect(u.searchParams.get('state')).toBe(saved.state);
      expect(u.searchParams.get('nonce')).toBe(saved.nonce);
    });

    it('completes sign-in: exchanges the code with the verifier and keeps the ID token in memory', async () => {
      const start = browser();
      await start.fns.issuerStartSignIn();
      const saved = JSON.parse(start.store.get('issuer.pkce')!);
      const b = browser(`?code=abc123&state=${saved.state}`);
      b.store.set('issuer.pkce', JSON.stringify(saved));
      const tok = idToken(saved.nonce);
      b.g.tokenResponse = { id_token: tok };
      expect(await b.fns.issuerCompleteSignIn()).toBe(true);
      expect(b.fns.token()).toBe(tok);
      expect(b.tokenCalls.length).toBe(1);
      expect(b.tokenCalls[0].url).toBe(entra.tokenUrl);
      const form = new URLSearchParams(b.tokenCalls[0].body);
      expect(form.get('code')).toBe('abc123');
      expect(form.get('code_verifier')).toBe(saved.verifier);
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(b.store.has('issuer.pkce')).toBe(false); // one-time
    });

    it('refuses a state mismatch (no exchange) and a nonce mismatch (no token kept)', async () => {
      const saved = { verifier: 'v', state: 's1', nonce: 'n1' };
      const bad = browser('?code=abc&state=other');
      bad.store.set('issuer.pkce', JSON.stringify(saved));
      await expect(bad.fns.issuerCompleteSignIn()).rejects.toThrow(/state mismatch/);
      expect(bad.tokenCalls.length).toBe(0);

      const b = browser('?code=abc&state=s1');
      b.store.set('issuer.pkce', JSON.stringify(saved));
      b.g.tokenResponse = { id_token: idToken('someone-elses-nonce') };
      await expect(b.fns.issuerCompleteSignIn()).rejects.toThrow(/nonce mismatch/);
      expect(b.fns.token()).toBe('');
    });
  });
});
