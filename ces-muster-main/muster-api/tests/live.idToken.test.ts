// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * live.idToken.test.ts — FC-MU-3 step 4 (founder decision 2026-09-28 #13):
 * before a live device-code consent is recorded, the ID token is VERIFIED:
 * RS256 signature against Microsoft's published signing keys for the cloud
 * (`<login>/<tenant>/discovery/v2.0/keys`), issuer `<login>/<tenant>/v2.0`,
 * audience = the public client id, and expiry / not-before. A token that fails
 * any check refuses the consent and records nothing.
 *
 * Keys are generated locally (tests/helpers/idTokenKeys.ts) and served by a
 * fake JWKS fetcher. No network: the production fetcher refuses under vitest.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { LiveConsentService, prismaLiveAccessStore, type DeviceCodeTransport } from '../src/services/liveAccess.js';
import { verifyIdToken, fetchJwks, IdTokenError, LIVE_CLOUDS } from '../src/services/idTokenVerifier.js';
import { createMockDb, type MockDb } from './helpers/mockDb.js';
import { fakeJwks, makeSigningKey, signIdToken, unsignedIdToken } from './helpers/idTokenKeys.js';

const SAAS = 't-live';
const TENANT = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NOW = new Date('2026-09-28T12:00:00.000Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const GCCH = 'https://login.microsoftonline.us';
const SCOPE = 'https://graph.microsoft.us/Policy.Read.All openid profile';

const KEY = makeSigningKey('kid-good');
const ROGUE = makeSigningKey('kid-good'); // same kid, different key material

let db: MockDb;
let engagementId: string;

beforeEach(async () => {
  db = createMockDb();
  const e = await db.engagement.create({ data: { tenant_id: SAAS, engagement_kind: 'prime_and_subs', live_access_enabled: true } });
  engagementId = e.id as string;
});

function serviceReturning(idToken: string, jwksKeys = [KEY.jwk], loginBase = GCCH) {
  const transport: DeviceCodeTransport = async (url) =>
    url.endsWith('/devicecode')
      ? { status: 200, json: { device_code: 'dc', user_code: 'UC', verification_uri: 'https://example.invalid', expires_in: 900, interval: 5 } }
      : { status: 200, json: { access_token: 'fake-access', expires_in: 3600, scope: SCOPE, id_token: idToken } };
  const jwks = fakeJwks(jwksKeys);
  const store = prismaLiveAccessStore(db);
  const svc = new LiveConsentService(store, { clientId: CLIENT, loginBase, transport, now: () => NOW, fetchKeys: jwks.fetchKeys });
  return { svc, jwks };
}

async function consent(idToken: string, jwksKeys = [KEY.jwk], loginBase = GCCH) {
  const { svc, jwks } = serviceReturning(idToken, jwksKeys, loginBase);
  const started = await svc.start(SAAS, engagementId, TENANT);
  const out = await svc.poll(started.consent_id, SAAS);
  const row = db.engagement._records.find((e: any) => e.id === engagementId) as Record<string, any>;
  return { out, row, svc, jwks };
}

const good = (over: Partial<Parameters<typeof signIdToken>[1]> = {}) =>
  signIdToken(KEY, { tid: TENANT, aud: CLIENT, nowSec: NOW_SEC, ...over });

describe('FC-MU-3 step 4 — a verified ID token is required before consent is recorded', () => {
  it('a correctly signed token (GCC High keys, issuer, audience, time) → granted and recorded', async () => {
    const { out, row, jwks } = await consent(good());
    expect(out).toMatchObject({ status: 'granted' });
    expect(row.live_consent).toMatchObject({ consented_by: 'it-admin@customer.example', tenant_id: TENANT });
    // Keys come from the declared cloud + tenant's published endpoint.
    expect(jwks.urls).toEqual([`${GCCH}/${TENANT}/discovery/v2.0/keys`]);
  });

  it('commercial cloud: keys and issuer follow the configured login base', async () => {
    const com = LIVE_CLOUDS.commercial.loginBase;
    const { out, jwks } = await consent(good({ loginBase: com }), [KEY.jwk], com);
    expect(out).toMatchObject({ status: 'granted' });
    expect(jwks.urls).toEqual([`${com}/${TENANT}/discovery/v2.0/keys`]);
  });

  const refusals: Array<[string, () => string, RegExp, (() => typeof KEY.jwk[]) | undefined]> = [
    ['alg none (unsigned)', () => unsignedIdToken({ iss: `${GCCH}/${TENANT}/v2.0`, aud: CLIENT, tid: TENANT, exp: NOW_SEC + 3600, preferred_username: 'x@y' }), /alg/, undefined],
    ['signed by a key that is not published', () => signIdToken(ROGUE, { tid: TENANT, aud: CLIENT, nowSec: NOW_SEC }), /signature/, undefined],
    ['unknown kid', () => signIdToken(makeSigningKey('kid-unknown'), { tid: TENANT, aud: CLIENT, nowSec: NOW_SEC }), /kid/, undefined],
    ['HS256 signed with the public key (alg confusion)', () => jwt.sign({ iss: `${GCCH}/${TENANT}/v2.0`, aud: CLIENT, tid: TENANT, exp: NOW_SEC + 3600 }, JSON.stringify(KEY.jwk), { algorithm: 'HS256', keyid: KEY.kid }), /alg/, undefined],
    ['wrong issuer (commercial token on a GCC High login)', () => good({ iss: `https://login.microsoftonline.com/${TENANT}/v2.0` }), /issuer/, undefined],
    ['wrong audience (another app)', () => good({ aud: '00000000-0000-0000-0000-000000000000' }), /audience/, undefined],
    ['expired', () => good({ expIn: -600 }), /expired/, undefined],
    ['not yet valid', () => good({ nbfIn: 600 }), /not.?yet|nbf/, undefined],
    ['account from another tenant', () => signIdToken(KEY, { tid: OTHER, aud: CLIENT, nowSec: NOW_SEC }), /tenant/, undefined],
    ['no published keys', () => good(), /kid|keys/, () => []],
  ];
  for (const [name, token, reason, keys] of refusals) {
    it(`${name} → refused, nothing recorded, no token held`, async () => {
      const { out, row, svc } = await consent(token(), keys ? keys() : [KEY.jwk]);
      expect(out?.status).toBe('refused');
      expect((out as { reason: string }).reason).toMatch(reason);
      expect(row.live_consent).toBeUndefined();
      expect(svc.size).toBe(0);
    });
  }

  it('verifyIdToken is the check the service runs (direct call, same verdicts)', async () => {
    const { fetchKeys } = fakeJwks([KEY.jwk]);
    const claims = await verifyIdToken(good(), { tenantId: TENANT, clientId: CLIENT, loginBase: GCCH, now: () => NOW, fetchKeys });
    expect(claims.tid).toBe(TENANT);
    await expect(
      verifyIdToken(good({ expIn: -600 }), { tenantId: TENANT, clientId: CLIENT, loginBase: GCCH, now: () => NOW, fetchKeys })
    ).rejects.toBeInstanceOf(IdTokenError);
  });

  it('the production JWKS fetcher cannot reach Microsoft under test', async () => {
    await expect(fetchJwks(`${GCCH}/${TENANT}/discovery/v2.0/keys`)).rejects.toThrow(/refused under test/);
  });
});
