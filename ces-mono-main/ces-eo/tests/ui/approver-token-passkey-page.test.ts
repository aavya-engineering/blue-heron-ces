// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-G (2026-09-28) — the approver-token issuer page (public/approver-tokens.html) in passkey
 * mode. The page's functions are lifted out of the served HTML unmodified and driven against the
 * REAL approver-token router over HTTP. `navigator.credentials` is a software authenticator
 * (locally generated P-256 keys), so the page's own base64url <-> ArrayBuffer conversions are what
 * carry the WebAuthn ceremony. No browser, no network.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createApproverTokenRouter } from '../../src/eo/server/routers/approver-token-router';
import { ApproverTokenMintLog } from '../../src/eo/approver-tokens/ApproverTokenMintLog';
import { PasskeyOperatorService } from '../../src/eo/approver-tokens/PasskeyOperatorService';
import { PasskeyOperatorStore } from '../../src/eo/approver-tokens/PasskeyOperatorStore';
import { runOperatorCli } from '../../src/eo/approver-tokens/operatorPasskeyCli';
import { verifyApproverToken } from '../../../ces-ao/src/execution/VerifiedApprover';
import { SoftAuthenticator, b64url } from '../eo/approver-tokens/passkey-test-kit';

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

const AO_SECRET = 'ao-principal-secret-for-passkey-page-01';
const ORIGIN = 'http://localhost:5004';
const RP_ID = 'localhost';
const TENANT = { slug: 'fceog-ui-tenant', guid: '00000000-0000-4000-8000-0000000fce0c' };
const APPROVER = 'approver.ui@ui-tenant.example.test';

type El = { innerHTML: string; textContent: string; className: string; value: string; hidden: boolean };
const el = (): El => ({ innerHTML: '', textContent: '', className: '', value: '', hidden: true });
const buf = (s: string) => { const b = Buffer.from(s, 'base64url'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

/** navigator.credentials backed by a software authenticator; records what the page asked for. */
function softNavigator(auth: SoftAuthenticator, o: { userVerified?: boolean } = {}) {
  const seen: { create?: any; get?: any } = {};
  return {
    seen,
    navigator: {
      credentials: {
        async create({ publicKey }: { publicKey: any }) {
          seen.create = publicKey;
          const r = auth.register({ challenge: b64url(new Uint8Array(publicKey.challenge)), user: { id: b64url(new Uint8Array(publicKey.user.id)) } }, o);
          return {
            id: r.id, rawId: buf(r.rawId), type: r.type, authenticatorAttachment: 'platform',
            getClientExtensionResults: () => ({}),
            response: { clientDataJSON: buf(r.response.clientDataJSON), attestationObject: buf(r.response.attestationObject), getTransports: () => ['internal'] },
          };
        },
        async get({ publicKey }: { publicKey: any }) {
          seen.get = publicKey;
          const r = auth.assert({ challenge: b64url(new Uint8Array(publicKey.challenge)) }, o);
          return {
            id: r.id, rawId: buf(r.rawId), type: r.type, authenticatorAttachment: 'platform',
            getClientExtensionResults: () => ({}),
            response: {
              clientDataJSON: buf(r.response.clientDataJSON),
              authenticatorData: buf(r.response.authenticatorData),
              signature: buf(r.response.signature),
              userHandle: r.response.userHandle ? buf(r.response.userHandle) : null,
            },
          };
        },
      },
    },
  };
}

describe('FC-EO-G: approver-token issuer page, passkey mode', () => {
  it('serves passkey sign-in, enrollment, operator management; keeps secrets out of storage and the URL', () => {
    for (const id of ['issuerPasskeySignInBtn', 'issuerEnrollBox', 'issuerEnrollCode', 'issuerEnrollBtn', 'issuerOperatorsCard',
      'issuerPasskeysBody', 'issuerNewOpName', 'issuerNewOpUpn', 'issuerIssueCodeBtn', 'issuerNewCodeOut']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toMatch(/localStorage/);
    expect(html).not.toMatch(/sessionStorage\.setItem\([^)]*(session|Session|token|Token)/);
    // The enrollment code arrives in the fragment (never sent to a server) and is dropped from the address bar.
    expect(html).toMatch(/location\.hash/);
    expect(html).toMatch(/history\.replaceState\(null, '', location\.pathname\); \/\/ drop the code/);
  });

  describe('against the real route', () => {
    let tmp: string;
    let server: Server;
    let base: string;
    let passkeys: PasskeyOperatorService;
    const env: Record<string, string | undefined> = { CES_AO_PRINCIPAL_SECRET: AO_SECRET, CES_EO_OPERATOR_PASSKEY_ORIGIN: ORIGIN };
    const prevTenantRoot = process.env.CES_TENANT_ROOT;

    beforeAll(async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-eo-g-ui-'));
      process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
      const stamperRoot = path.join(tmp, 'stamper');
      fs.mkdirSync(path.join(stamperRoot, 'plan-data', TENANT.slug), { recursive: true });
      fs.writeFileSync(path.join(stamperRoot, 'plan-data', TENANT.slug, `${TENANT.slug}.json`),
        JSON.stringify({ tenant: { tenant_id: TENANT.guid, domain: 'ui-tenant.example.test' } }));
      const db = path.join(tmp, 'ces.db');
      passkeys = new PasskeyOperatorService({ store: new PasskeyOperatorStore(db) });
      const app = express();
      app.use(express.json());
      app.use(createApproverTokenRouter({ stamperRoot, env, passkeys, mintLog: new ApproverTokenMintLog(db) }));
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

    const FNS = ['issuerEsc', 'issuerB64url', 'issuerB64urlToBuf', 'issuerBufToB64url', 'issuerCreationOptions', 'issuerRequestOptions',
      'issuerCredentialJSON', 'issuerPostJson', 'issuerRefusalText', 'issuerPasskeyEnroll', 'issuerPasskeySignIn', 'issuerLoadPasskeys',
      'issuerRevokePasskey', 'issuerIssueEnrollmentCode', 'issuerMint', 'issuerLoadMints'];

    /** One browser tab: its own element stubs, in-memory session, and authenticator. */
    function page(nav: ReturnType<typeof softNavigator>['navigator']) {
      const els: Record<string, El> = {};
      const $ = (sel: string) => (els[sel] ??= el());
      const pageFetch = (url: string, init?: RequestInit) => fetch(base + url, init);
      // eslint-disable-next-line no-new-func
      const factory = new Function('fetch', '$', 'encodeURIComponent', 'navigator', 'atob', 'btoa',
        `var issuerOperatorToken = ''; var issuerOperatorInfo = null;\n${FNS.map(liftFunction).join('\n')}\n` +
        `return { ${FNS.join(', ')}, state: function () { return { token: issuerOperatorToken, info: issuerOperatorInfo }; } };`);
      return { els, fns: factory(pageFetch, $, encodeURIComponent, nav, atob, btoa) as Record<string, (...a: any[]) => any> };
    }

    function cliCode(name: string, upn: string): string {
      const lines: string[] = [];
      expect(runOperatorCli(['enroll', '--name', name, '--upn', upn], { env, service: passkeys, out: l => lines.push(l) })).toBe(0);
      return /#enroll=([A-Za-z0-9_-]+)/.exec(lines.join('\n'))![1];
    }

    it('first operator: enroll with the local-command code, sign in with the passkey, mint a token AdminOps accepts', async () => {
      const auth = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
      const soft = softNavigator(auth);
      const { els, fns } = page(soft.navigator);

      const enrolled = await fns.issuerPasskeyEnroll(cliCode('Operator Page', 'operator.page@bhd.example.test'));
      expect(enrolled).toMatchObject({ credentialId: auth.id, displayName: 'Operator Page' });
      expect(els['#issuerEnrollStatus'].className).toBe('status ok');
      expect(soft.seen.create.authenticatorSelection).toMatchObject({ userVerification: 'required', residentKey: 'required' });
      expect(soft.seen.create.rp).toMatchObject({ id: RP_ID });

      const session = await fns.issuerPasskeySignIn();
      expect(session).not.toBeNull();
      expect(soft.seen.get.userVerification).toBe('required');
      const st = fns.state();
      expect(st.token).toBe(session.sessionToken);
      expect(st.info).toMatchObject({ displayName: 'Operator Page', upn: 'operator.page@bhd.example.test', credentialId: auth.id });

      const minted = await fns.issuerMint(st.token, TENANT.slug, APPROVER, 'Approver UI', '10');
      expect(minted).toMatchObject({ operatorAuth: 'passkey', ttlSeconds: 600 });
      expect(els['#issuerTokenOut'].value).toBe(minted.token);
      expect(verifyApproverToken(minted.token, { CES_AO_PRINCIPAL_SECRET: AO_SECRET } as NodeJS.ProcessEnv).upn).toBe(APPROVER);

      await fns.issuerLoadMints(st.token, TENANT.slug);
      expect(els['#issuerMintsBody'].innerHTML).toContain('passkey');
      expect(els['#issuerMintsBody'].innerHTML).not.toContain(minted.token);
    });

    it('an operator adds a second operator from the page, lists passkeys, and revokes one immediately', async () => {
      const adminAuth = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
      const admin = page(softNavigator(adminAuth).navigator);
      await admin.fns.issuerPasskeyEnroll(cliCode('Operator Lead', 'operator.lead@bhd.example.test'));
      await admin.fns.issuerPasskeySignIn();
      const adminToken = admin.fns.state().token;

      const issued = await admin.fns.issuerIssueEnrollmentCode(adminToken, 'Operator New', 'operator.new@bhd.example.test');
      expect(issued).not.toBeNull();
      expect(admin.els['#issuerNewCodeOut'].hidden).toBe(false);
      expect(admin.els['#issuerNewCodeOut'].value).toContain(`${ORIGIN}/approver-tokens.html#enroll=${issued.code}`);

      const newAuth = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
      const newbie = page(softNavigator(newAuth).navigator);
      expect(await newbie.fns.issuerPasskeyEnroll(issued.code)).toMatchObject({ credentialId: newAuth.id });
      await newbie.fns.issuerPasskeySignIn();
      const newToken = newbie.fns.state().token;
      expect(await newbie.fns.issuerMint(newToken, TENANT.slug, APPROVER, '', '')).not.toBeNull();

      const rows = await admin.fns.issuerLoadPasskeys(adminToken);
      expect(rows.map((r: any) => r.credentialId)).toEqual(expect.arrayContaining([adminAuth.id, newAuth.id]));
      expect(admin.els['#issuerPasskeysBody'].innerHTML).toContain(`data-revoke="${newAuth.id}"`);

      const revoked = await admin.fns.issuerRevokePasskey(adminToken, newAuth.id);
      expect(revoked.revokedAt).toBeTruthy();
      expect(admin.fns.state().token).toBe(adminToken); // revoking someone else keeps my session

      // The revoked operator's open page session stops minting at once.
      expect(await newbie.fns.issuerMint(newToken, TENANT.slug, APPROVER, '', '')).toBeNull();
      expect(newbie.els['#issuerMintStatus'].textContent).toMatch(/Refused \(401\)/);
      expect(await newbie.fns.issuerPasskeySignIn()).toBeNull();
      expect(newbie.els['#issuerAuthState'].textContent).toMatch(/revoked/);

      // Revoking your own passkey signs this page out.
      await admin.fns.issuerRevokePasskey(adminToken, adminAuth.id);
      expect(admin.fns.state()).toEqual({ token: '', info: null });
    });

    it('shows refusals: a used code, and an authenticator without user verification', async () => {
      const auth = new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID });
      const code = cliCode('Operator Twice', 'operator.twice@bhd.example.test');
      const p1 = page(softNavigator(auth).navigator);
      expect(await p1.fns.issuerPasskeyEnroll(code)).not.toBeNull();
      const p2 = page(softNavigator(new SoftAuthenticator({ origin: ORIGIN, rpId: RP_ID })).navigator);
      expect(await p2.fns.issuerPasskeyEnroll(code)).toBeNull();
      expect(p2.els['#issuerEnrollStatus'].className).toBe('status err');
      expect(p2.els['#issuerEnrollStatus'].textContent).toMatch(/already been used/);

      const noUv = page(softNavigator(auth, { userVerified: false }).navigator);
      expect(await noUv.fns.issuerPasskeySignIn()).toBeNull();
      expect(noUv.els['#issuerAuthState'].textContent).toMatch(/Refused \(401\)/);
      expect(noUv.fns.state().token).toBe('');
    });
  });
});
