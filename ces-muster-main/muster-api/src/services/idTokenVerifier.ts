// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// idTokenVerifier.ts — FC-MU-3 step 4 (founder decision 2026-09-28 #13): the
// live device-code ID token is VERIFIED before a consent is recorded.
//
//   - signature: RS256 only, against the signing keys Microsoft publishes for
//     the cloud's login authority (`<login>/<tenant>/discovery/v2.0/keys`),
//     matched by `kid` (one re-fetch on a miss, for key rotation);
//   - issuer:    `<login>/<tenant>/v2.0` (so a token minted by another cloud's
//     authority does not pass on this one);
//   - audience:  the Muster public client id;
//   - time:      `exp` in the future and `nbf` in the past (small clock skew);
//   - tenant:    `tid` equals the tenant the consent was started for.
//
// Test safety: the production key fetcher goes through assertNotLiveUnderTest,
// so under vitest it can never reach a Microsoft endpoint. Tests inject a fake
// fetcher serving locally generated keys (tests/helpers/idTokenKeys.ts).
import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';
import { assertNotLiveUnderTest } from '../lib/liveGuard.js';

/** Login authorities per Microsoft cloud. GCC High is the platform default. */
export const LIVE_CLOUDS = {
  'gcc-high': { loginBase: 'https://login.microsoftonline.us' },
  commercial: { loginBase: 'https://login.microsoftonline.com' },
} as const;

export interface Jwk extends JsonWebKey {
  kid?: string;
  kty?: string;
  use?: string;
  alg?: string;
}

/** GET a JWKS document. */
export type JwksFetcher = (url: string) => Promise<{ keys: Jwk[] }>;

/** The production fetcher (refused under vitest). */
export const fetchJwks: JwksFetcher = async (url) => {
  assertNotLiveUnderTest('JWKS key fetch', url);
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed (HTTP ${res.status})`);
  const json = (await res.json()) as { keys?: unknown };
  return { keys: Array.isArray(json.keys) ? (json.keys as Jwk[]) : [] };
};

export type IdTokenErrorCode =
  | 'malformed'
  | 'bad_alg'
  | 'unknown_kid'
  | 'bad_signature'
  | 'tenant_mismatch'
  | 'bad_issuer'
  | 'bad_audience'
  | 'expired'
  | 'not_yet_valid';

const MESSAGES: Record<IdTokenErrorCode, string> = {
  malformed: 'id_token is malformed',
  bad_alg: 'id_token alg is not RS256',
  unknown_kid: 'id_token kid is not among the published signing keys',
  bad_signature: 'id_token signature does not verify',
  tenant_mismatch: 'id_token tenant does not match the consent tenant',
  bad_issuer: 'id_token issuer is not the expected login authority',
  bad_audience: 'id_token audience is not the Muster client id',
  expired: 'id_token is expired',
  not_yet_valid: 'id_token is not yet valid (nbf)',
};

export class IdTokenError extends Error {
  constructor(readonly code: IdTokenErrorCode) {
    super(MESSAGES[code]);
    this.name = 'IdTokenError';
  }
}

export interface VerifyIdTokenOptions {
  tenantId: string;
  clientId: string;
  /** The login authority the device-code flow used (e.g. https://login.microsoftonline.us). */
  loginBase: string;
  fetchKeys?: JwksFetcher;
  now?: () => Date;
  /** Allowed clock skew in seconds (default 300). */
  clockSkewSec?: number;
}

function b64urlJson(part: string): Record<string, unknown> {
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    throw new IdTokenError('malformed');
  }
}

/** In-process JWKS cache per fetcher and keys URL, refreshed on a kid miss or after 24h. */
const KEY_CACHE = new WeakMap<JwksFetcher, Map<string, { keys: Jwk[]; at: number }>>();
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

async function keysFor(url: string, fetchKeys: JwksFetcher, nowMs: number, force: boolean): Promise<Jwk[]> {
  let cache = KEY_CACHE.get(fetchKeys);
  if (!cache) {
    cache = new Map();
    KEY_CACHE.set(fetchKeys, cache);
  }
  const hit = cache.get(url);
  if (hit && !force && nowMs - hit.at < KEY_TTL_MS) return hit.keys;
  const { keys } = await fetchKeys(url);
  cache.set(url, { keys, at: nowMs });
  return keys;
}

/**
 * Verify an Entra ID v2 ID token. Resolves to its claims, or rejects with an
 * IdTokenError naming the first failed check.
 */
export async function verifyIdToken(idToken: string, o: VerifyIdTokenOptions): Promise<Record<string, unknown>> {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) throw new IdTokenError('malformed');
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (header.alg !== 'RS256') throw new IdTokenError('bad_alg');
  if (typeof header.kid !== 'string' || header.kid === '') throw new IdTokenError('unknown_kid');
  if (!parts[2]) throw new IdTokenError('bad_signature');

  const loginBase = o.loginBase.replace(/\/+$/, '');
  const nowMs = (o.now ?? (() => new Date()))().getTime();
  const fetchKeys = o.fetchKeys ?? fetchJwks;
  const keysUrl = `${loginBase}/${o.tenantId}/discovery/v2.0/keys`;

  const find = (keys: Jwk[]) => keys.find((k) => k.kid === header.kid && (k.kty ?? 'RSA') === 'RSA');
  let jwk = find(await keysFor(keysUrl, fetchKeys, nowMs, false));
  if (!jwk) jwk = find(await keysFor(keysUrl, fetchKeys, nowMs, true)); // rotation: one re-fetch
  if (!jwk) throw new IdTokenError('unknown_kid');

  let ok = false;
  try {
    const { kid: _kid, use: _use, alg: _alg, ...material } = jwk;
    const key = createPublicKey({ key: material as JsonWebKey, format: 'jwk' });
    ok = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) throw new IdTokenError('bad_signature');

  if (claims.tid !== o.tenantId) throw new IdTokenError('tenant_mismatch');
  if (claims.iss !== `${loginBase}/${o.tenantId}/v2.0`) throw new IdTokenError('bad_issuer');
  const aud = claims.aud;
  if (!(aud === o.clientId || (Array.isArray(aud) && aud.includes(o.clientId)))) throw new IdTokenError('bad_audience');
  const skew = (o.clockSkewSec ?? 300) * 1000;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs - skew) throw new IdTokenError('expired');
  if (typeof claims.nbf === 'number' && claims.nbf * 1000 > nowMs + skew) throw new IdTokenError('not_yet_valid');
  return claims;
}
