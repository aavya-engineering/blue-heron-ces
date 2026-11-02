// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// idTokenKeys.ts — FC-MU-3 step 4 test helper: a LOCAL signing key and a fake
// JWKS endpoint, so ID-token verification is proven without any network.
// Keys are generated per process with node:crypto; nothing is fetched.
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Jwk, JwksFetcher } from '../../src/services/idTokenVerifier.js';

export interface TestSigningKey {
  kid: string;
  privateKey: KeyObject;
  jwk: Jwk;
}

export function makeSigningKey(kid: string): TestSigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Jwk), kid, kty: 'RSA', use: 'sig', alg: 'RS256' };
  return { kid, privateKey, jwk };
}

/** A fake JWKS fetcher serving `keys`; records every URL it was asked for. */
export function fakeJwks(keys: Jwk[]): { fetchKeys: JwksFetcher; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetchKeys: async (url: string) => {
      urls.push(url);
      return { keys };
    },
  };
}

export interface IdTokenOptions {
  tid: string;
  aud: string;
  loginBase?: string;
  /** Override the issuer (default `<loginBase>/<tid>/v2.0`). */
  iss?: string;
  preferred_username?: string;
  /** Seconds relative to `nowSec`. */
  expIn?: number;
  nbfIn?: number;
  nowSec: number;
  extra?: Record<string, unknown>;
}

/** Sign an Entra-shaped v2 ID token with the test key (RS256). */
export function signIdToken(key: TestSigningKey, o: IdTokenOptions): string {
  const loginBase = o.loginBase ?? 'https://login.microsoftonline.us';
  const claims: Record<string, unknown> = {
    iss: o.iss ?? `${loginBase}/${o.tid}/v2.0`,
    aud: o.aud,
    tid: o.tid,
    iat: o.nowSec - 10,
    nbf: o.nowSec + (o.nbfIn ?? -10),
    exp: o.nowSec + (o.expIn ?? 3600),
    preferred_username: o.preferred_username ?? 'it-admin@customer.example',
    ...o.extra,
  };
  return jwt.sign(claims, key.privateKey, { algorithm: 'RS256', keyid: key.kid, noTimestamp: true });
}

/** An unsigned `alg: none` token with the same claims (must be refused). */
export function unsignedIdToken(claims: Record<string, unknown>): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}
