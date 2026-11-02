// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-E (2026-09-28) — the Entra ID operator verifier, against locally generated RSA keys.
 * A valid operator token (right tenant, issuer, audience, unexpired, in the operator group) yields a
 * verified principal with role `bhd-operator`; every other case is refused or yields no role.
 */
import { signPrincipalToken } from 'ces-shared/http/principal';
import {
  EntraSigningKeyStore,
  createEntraOperatorVerifier,
  entraOperatorConfigFromEnv,
  peekKid,
  type EntraOperatorConfig,
} from '../../../src/eo/approver-tokens/EntraOperatorVerifier';
import {
  CLIENT_ID, HOST, ISSUER, JWKS_URI, OP_GROUP, OP_TENANT, OTHER_GROUP, OTHER_TENANT,
  entraEnv, entraToken, fakeFetch, jwksOf, makeKey,
} from './entra-test-kit';

const keyA = makeKey('kid-a');
const keyB = makeKey('kid-b');
const stranger = makeKey('kid-a'); // same kid, different key: a forged signature

function cfg(over: Record<string, string> = {}): EntraOperatorConfig {
  const r = entraOperatorConfigFromEnv({ ...entraEnv(), ...over });
  if (!r.ok) throw new Error(r.error);
  return r.config;
}

async function setup() {
  const f = fakeFetch(() => jwksOf(keyA));
  const store = new EntraSigningKeyStore(JWKS_URI, f.fn);
  await store.ensureKey('kid-a');
  return { store, verifier: createEntraOperatorVerifier(cfg(), store), calls: f.calls };
}

describe('FC-EO-E: Entra operator configuration', () => {
  it('derives issuer, audience and signing-key URL from the operator tenant', () => {
    expect(cfg()).toEqual({
      tenantId: OP_TENANT, clientId: CLIENT_ID, operatorGroupId: OP_GROUP, audience: CLIENT_ID,
      authorityHost: HOST, issuer: ISSUER, jwksUri: JWKS_URI,
    });
    const us = cfg({ CES_EO_OPERATOR_ENTRA_AUTHORITY_HOST: 'login.microsoftonline.us' });
    expect(us.issuer).toBe(`https://login.microsoftonline.us/${OP_TENANT}/v2.0`);
    expect(us.jwksUri).toBe(`https://login.microsoftonline.us/${OP_TENANT}/discovery/v2.0/keys`);
  });

  it('refuses incomplete or malformed settings', () => {
    expect(entraOperatorConfigFromEnv({ CES_EO_OPERATOR_ENTRA_TENANT_ID: OP_TENANT })).toMatchObject({ ok: false });
    expect(entraOperatorConfigFromEnv({ ...entraEnv(), CES_EO_OPERATOR_ENTRA_TENANT_ID: 'contoso' })).toMatchObject({ ok: false });
    expect(entraOperatorConfigFromEnv({ ...entraEnv(), CES_EO_OPERATOR_ENTRA_GROUP_ID: 'BHD Operators' })).toMatchObject({ ok: false });
    expect(entraOperatorConfigFromEnv({ ...entraEnv(), CES_EO_OPERATOR_ENTRA_AUTHORITY_HOST: 'evil.test/x?' })).toMatchObject({ ok: false });
  });
});

describe('FC-EO-E: Entra operator verifier', () => {
  it('a valid operator token -> verified principal with role bhd-operator', async () => {
    const { verifier, calls } = await setup();
    const r = verifier.verify(entraToken(keyA));
    expect(r).toEqual({
      ok: true,
      principal: expect.objectContaining({
        subjectId: '11111111-1111-4111-8111-111111111111',
        upn: 'operator.e@bhd.example.test',
        roles: ['bhd-operator'],
        tenantId: OP_TENANT,
        verified: true,
        source: 'token',
      }),
    });
    expect(calls).toEqual([JWKS_URI]); // the only "network" is the injected fetcher
  });

  it('a signed-in tenant member outside the operator group -> verified, but no operator role', async () => {
    const { verifier } = await setup();
    expect(verifier.verify(entraToken(keyA, { groups: [OTHER_GROUP] }))).toMatchObject({ ok: true, principal: { roles: [] } });
    expect(verifier.verify(entraToken(keyA, { groups: undefined }))).toMatchObject({ ok: true, principal: { roles: [] } });
  });

  it('groups overage (list replaced by a Graph pointer) is refused, not guessed', async () => {
    const { verifier } = await setup();
    const t = entraToken(keyA, { groups: undefined, _claim_names: { groups: 'src1' }, _claim_sources: { src1: { endpoint: 'https://graph.example.test' } } });
    expect(verifier.verify(t)).toEqual({ ok: false, reason: 'missing_claims' });
  });

  it('wrong tenant is refused, even when issuer and audience look right', async () => {
    const { verifier } = await setup();
    expect(verifier.verify(entraToken(keyA, { tid: OTHER_TENANT }))).toEqual({ ok: false, reason: 'wrong_issuer' });
    expect(verifier.verify(entraToken(keyA, { tid: OTHER_TENANT, iss: `https://${HOST}/${OTHER_TENANT}/v2.0` })))
      .toEqual({ ok: false, reason: 'wrong_issuer' });
  });

  it('wrong issuer or audience is refused', async () => {
    const { verifier } = await setup();
    expect(verifier.verify(entraToken(keyA, { iss: `https://sts.windows.net/${OP_TENANT}/` }))).toEqual({ ok: false, reason: 'wrong_issuer' });
    expect(verifier.verify(entraToken(keyA, { aud: '00000003-0000-0000-c000-000000000000' }))).toEqual({ ok: false, reason: 'wrong_audience' });
  });

  it('expired or not-yet-valid tokens are refused', async () => {
    const { verifier } = await setup();
    const now = Math.floor(Date.now() / 1000);
    expect(verifier.verify(entraToken(keyA, { exp: now - 120 }))).toEqual({ ok: false, reason: 'expired' });
    expect(verifier.verify(entraToken(keyA, { nbf: now + 600 }))).toEqual({ ok: false, reason: 'not_yet_valid' });
    expect(verifier.verify(entraToken(keyA, { exp: undefined }))).toEqual({ ok: false, reason: 'missing_claims' });
  });

  it('bad signatures are refused: forged key with the same kid, tampered payload, unknown kid', async () => {
    const { verifier } = await setup();
    expect(verifier.verify(entraToken(stranger))).toEqual({ ok: false, reason: 'bad_signature' });
    // A non-operator's genuine token with its payload swapped to claim the operator group.
    const [h, , s] = entraToken(keyA, { groups: [OTHER_GROUP] }).split('.');
    const forgedPayload = entraToken(keyA, { groups: [OP_GROUP] }).split('.')[1];
    expect(verifier.verify(`${h}.${forgedPayload}.${s}`)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifier.verify(entraToken(keyB))).toEqual({ ok: false, reason: 'bad_signature' }); // kid-b not published
  });

  it('non-RS256 tokens (HS256 CES tokens, alg none) are refused', async () => {
    const { verifier } = await setup();
    const hs = signPrincipalToken({ sub: 'x', upn: 'op@bhd.example.test', roles: ['bhd-operator'], tid: OP_TENANT }, { secret: 'a-shared-secret-of-enough-length' });
    expect(verifier.verify(hs)).toEqual({ ok: false, reason: 'unsupported_alg' });
    expect(verifier.verify(entraToken(keyA, {}, { alg: 'none' }))).toEqual({ ok: false, reason: 'unsupported_alg' });
    expect(verifier.verify('not-a-jwt')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('identity claims are required', async () => {
    const { verifier } = await setup();
    expect(verifier.verify(entraToken(keyA, { preferred_username: undefined }))).toEqual({ ok: false, reason: 'missing_claims' });
    expect(verifier.verify(entraToken(keyA, { oid: undefined, sub: undefined }))).toEqual({ ok: false, reason: 'missing_claims' });
  });
});

describe('FC-EO-E: signing-key store', () => {
  it('loads keys on an unknown kid, picks up rotation, and rate-limits refreshes', async () => {
    let published = [keyA];
    let now = 1_000_000;
    const f = fakeFetch(() => jwksOf(...published));
    const store = new EntraSigningKeyStore(JWKS_URI, f.fn, { minRefreshMs: 60_000, now: () => now });
    await store.ensureKey('kid-a');
    expect(store.get('kid-a')).toBeDefined();
    await store.ensureKey('kid-a');
    expect(f.calls.length).toBe(1); // known kid: no fetch
    published = [keyA, keyB];
    await store.ensureKey('kid-b');
    expect(store.get('kid-b')).toBeUndefined(); // within the refresh interval: no fetch
    expect(f.calls.length).toBe(1);
    now += 61_000;
    await store.ensureKey('kid-b');
    expect(store.get('kid-b')).toBeDefined();
    expect(f.calls.length).toBe(2);
  });

  it('peekKid reads the header kid (with or without Bearer) and nothing else', () => {
    const t = entraToken(keyA);
    expect(peekKid(t)).toBe('kid-a');
    expect(peekKid(`Bearer ${t}`)).toBe('kid-a');
    expect(peekKid('garbage')).toBeUndefined();
  });
});
