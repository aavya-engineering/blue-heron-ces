// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-EO-E (2026-09-28): BHD operators prove who they are to the approver-token issuer with a
// Microsoft Entra ID sign-in (founder decision 5, 2026-09-28).
//
// The operator presents an Entra ID token or access token (RS256, JWT) in `x-ces-principal`.
// It is accepted only when ALL of these hold:
//   * the header alg is RS256 (anything else, including an HS256 CES token, is `unsupported_alg`);
//   * the signature verifies against the signing key named by `kid`, taken from the operator
//     tenant's published signing keys (JWKS);
//   * `iss` equals the configured issuer (default `https://<authority host>/<tenant>/v2.0`);
//   * `aud` contains the configured audience (EO's app registration client id / App ID URI);
//   * `exp` / `nbf` hold (30 s skew);
//   * `tid` equals BHD's operator tenant (checked on its own, not only through `iss`);
//   * it carries a subject (`oid`|`sub`) and a login name (`preferred_username`|`upn`).
// The `bhd-operator` role is granted ONLY when the token's `groups` claim contains the configured
// operator group object id. A signed-in member of the tenant outside that group gets no role, and
// the route's role guard answers 403. A token whose groups were replaced by an overage pointer
// (`_claim_names.groups`) is refused (`missing_claims`): resolving it needs a Graph call, which the
// issuer does not make (HONEST-OPEN, see docs/FLOW-THROUGH-REPORT-2026-09.md).
//
// The key store is the only piece that talks to the network, and only through an injected
// `fetchJson`. Verification itself is synchronous and local, matching ces-shared's
// PrincipalVerifier; the router awaits `ensureKey(kid)` before calling it.
//
// Configuration (all read from the environment by entraOperatorConfigFromEnv):
//   CES_EO_OPERATOR_ENTRA_TENANT_ID   BHD operator tenant GUID (required)
//   CES_EO_OPERATOR_ENTRA_CLIENT_ID   EO app registration client id (required; SPA sign-in + default audience)
//   CES_EO_OPERATOR_ENTRA_GROUP_ID    object id of the Entra group whose members are BHD operators (required)
//   CES_EO_OPERATOR_ENTRA_AUDIENCE    accepted `aud` (default: the client id)
//   CES_EO_OPERATOR_ENTRA_AUTHORITY_HOST  default login.microsoftonline.com (GCC High: login.microsoftonline.us)
//   CES_EO_OPERATOR_ENTRA_ISSUER      accepted `iss` (default https://<host>/<tenant>/v2.0)

import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import type { PrincipalVerifier, PrincipalVerifyResult, RequestPrincipal } from 'ces-shared/http/principal';

export const BHD_OPERATOR_ROLE_FROM_GROUP = 'bhd-operator';
export const DEFAULT_ENTRA_AUTHORITY_HOST = 'login.microsoftonline.com';

type Env = Record<string, string | undefined>;

export interface EntraOperatorConfig {
  tenantId: string;
  clientId: string;
  operatorGroupId: string;
  audience: string;
  authorityHost: string;
  issuer: string;
  jwksUri: string;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_RE = /^[a-z0-9.-]+$/i;

export const ENTRA_OPERATOR_ENV_KEYS = [
  'CES_EO_OPERATOR_ENTRA_TENANT_ID',
  'CES_EO_OPERATOR_ENTRA_CLIENT_ID',
  'CES_EO_OPERATOR_ENTRA_GROUP_ID',
] as const;

/** True when any of the required Entra operator settings is present (even if incomplete). */
export function entraOperatorConfigured(env: Env): boolean {
  return ENTRA_OPERATOR_ENV_KEYS.some((k) => typeof env[k] === 'string' && env[k]!.trim() !== '');
}

/**
 * Read and validate the Entra operator configuration. Returns an error string (never throws) so the
 * caller decides the refusal code.
 */
export function entraOperatorConfigFromEnv(env: Env): { ok: true; config: EntraOperatorConfig } | { ok: false; error: string } {
  const get = (k: string) => (typeof env[k] === 'string' ? env[k]!.trim() : '');
  const tenantId = get('CES_EO_OPERATOR_ENTRA_TENANT_ID');
  const clientId = get('CES_EO_OPERATOR_ENTRA_CLIENT_ID');
  const operatorGroupId = get('CES_EO_OPERATOR_ENTRA_GROUP_ID');
  const missing = ENTRA_OPERATOR_ENV_KEYS.filter((k) => !get(k));
  if (missing.length) return { ok: false, error: `Entra operator sign-in is incomplete: set ${missing.join(', ')}` };
  if (!GUID_RE.test(tenantId)) return { ok: false, error: 'CES_EO_OPERATOR_ENTRA_TENANT_ID must be the operator tenant GUID' };
  if (!GUID_RE.test(clientId)) return { ok: false, error: 'CES_EO_OPERATOR_ENTRA_CLIENT_ID must be the app registration client id (GUID)' };
  if (!GUID_RE.test(operatorGroupId)) return { ok: false, error: 'CES_EO_OPERATOR_ENTRA_GROUP_ID must be the operator group object id (GUID)' };
  const authorityHost = get('CES_EO_OPERATOR_ENTRA_AUTHORITY_HOST') || DEFAULT_ENTRA_AUTHORITY_HOST;
  if (!HOST_RE.test(authorityHost)) return { ok: false, error: 'CES_EO_OPERATOR_ENTRA_AUTHORITY_HOST must be a bare host name' };
  const audience = get('CES_EO_OPERATOR_ENTRA_AUDIENCE') || clientId;
  const issuer = get('CES_EO_OPERATOR_ENTRA_ISSUER') || `https://${authorityHost}/${tenantId}/v2.0`;
  const jwksUri = `https://${authorityHost}/${tenantId}/discovery/v2.0/keys`;
  return { ok: true, config: { tenantId, clientId, operatorGroupId, audience, authorityHost, issuer, jwksUri } };
}

// ---------------------------------------------------------------------------------------------
// Signing keys
// ---------------------------------------------------------------------------------------------

export type FetchJson = (url: string) => Promise<unknown>;

interface Jwk { kty?: unknown; kid?: unknown; use?: unknown; n?: unknown; e?: unknown }

/** Default fetcher (production). Tests always inject their own. */
export const defaultFetchJson: FetchJson = async (url: string) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`signing-key fetch failed: HTTP ${res.status}`);
  return res.json();
};

/**
 * Cache of the operator tenant's RSA signing keys, keyed by `kid`. `get` is synchronous; `ensureKey`
 * refreshes from the JWKS endpoint when a `kid` is unknown, at most once per `minRefreshMs`
 * (default 5 min) so a stream of garbage `kid`s cannot hammer the endpoint.
 */
export class EntraSigningKeyStore {
  private keys = new Map<string, KeyObject>();
  private lastRefresh = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    readonly jwksUri: string,
    private readonly fetchJson: FetchJson = defaultFetchJson,
    private readonly opts: { minRefreshMs?: number; now?: () => number } = {},
  ) {}

  get(kid: string): KeyObject | undefined {
    return this.keys.get(kid);
  }

  async ensureKey(kid: string): Promise<void> {
    if (this.keys.has(kid)) return;
    const now = (this.opts.now ?? Date.now)();
    if (this.lastRefresh && now - this.lastRefresh < (this.opts.minRefreshMs ?? 5 * 60_000)) return;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        this.lastRefresh = (this.opts.now ?? Date.now)();
        const doc = (await this.fetchJson(this.jwksUri)) as { keys?: unknown };
        const next = new Map<string, KeyObject>();
        for (const k of Array.isArray(doc?.keys) ? (doc.keys as Jwk[]) : []) {
          if (k.kty !== 'RSA' || typeof k.kid !== 'string' || typeof k.n !== 'string' || typeof k.e !== 'string') continue;
          if (k.use !== undefined && k.use !== 'sig') continue;
          try {
            next.set(k.kid, createPublicKey({ key: { kty: 'RSA', n: k.n, e: k.e }, format: 'jwk' }));
          } catch { /* skip an unusable key */ }
        }
        if (next.size > 0) this.keys = next;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}

// ---------------------------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------------------------

function b64urlDecode(s: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  return Buffer.from(s, 'base64url');
}

/** Read the (unverified) JWT header's `kid`, or undefined. Used only to pick which key to load. */
export function peekKid(token: string): string | undefined {
  const h = typeof token === 'string' ? token.replace(/^Bearer\s+/i, '').split('.')[0] : undefined;
  if (!h) return undefined;
  try {
    const header = JSON.parse(b64urlDecode(h).toString('utf8')) as { kid?: unknown };
    return typeof header.kid === 'string' ? header.kid : undefined;
  } catch {
    return undefined;
  }
}

interface EntraClaims {
  sub?: unknown; oid?: unknown; upn?: unknown; preferred_username?: unknown; name?: unknown;
  tid?: unknown; iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown;
  groups?: unknown; _claim_names?: unknown;
}

export function createEntraOperatorVerifier(
  config: EntraOperatorConfig,
  keys: Pick<EntraSigningKeyStore, 'get'>,
  opts: { clockSkewSeconds?: number; now?: () => number } = {},
): PrincipalVerifier {
  const skew = opts.clockSkewSeconds ?? 30;
  const clock = opts.now ?? Date.now;
  return {
    verify(token: string): PrincipalVerifyResult {
      const parts = typeof token === 'string' ? token.split('.') : [];
      if (parts.length !== 3 || parts.some((p) => p.length === 0)) return { ok: false, reason: 'malformed' };
      const [h, p, s] = parts as [string, string, string];
      let header: { alg?: unknown; kid?: unknown };
      let claims: EntraClaims;
      let sig: Buffer;
      try {
        header = JSON.parse(b64urlDecode(h).toString('utf8'));
        claims = JSON.parse(b64urlDecode(p).toString('utf8'));
        sig = b64urlDecode(s);
      } catch {
        return { ok: false, reason: 'malformed' };
      }
      if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') return { ok: false, reason: 'malformed' };
      if (header.alg !== 'RS256') return { ok: false, reason: 'unsupported_alg' };
      if (typeof header.kid !== 'string') return { ok: false, reason: 'malformed' };
      const key = keys.get(header.kid);
      if (!key) return { ok: false, reason: 'bad_signature' }; // no such signing key in the operator tenant
      let good = false;
      try {
        good = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, sig);
      } catch {
        good = false;
      }
      if (!good) return { ok: false, reason: 'bad_signature' };

      const nowSec = Math.floor(clock() / 1000);
      if (typeof claims.exp !== 'number') return { ok: false, reason: 'missing_claims' };
      if (nowSec > claims.exp + skew) return { ok: false, reason: 'expired' };
      if (typeof claims.nbf === 'number' && nowSec + skew < claims.nbf) return { ok: false, reason: 'not_yet_valid' };
      if (claims.iss !== config.issuer) return { ok: false, reason: 'wrong_issuer' };
      const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud !== undefined ? [claims.aud] : [];
      if (!aud.includes(config.audience)) return { ok: false, reason: 'wrong_audience' };
      // The tenant check stands on its own (ces-shared has no `wrong_tenant` reason yet — see
      // docs/requirements/REQ-ces-shared-principal-verify-reasons.md).
      if (typeof claims.tid !== 'string' || claims.tid.toLowerCase() !== config.tenantId.toLowerCase()) {
        return { ok: false, reason: 'wrong_issuer' };
      }

      const subjectId = typeof claims.oid === 'string' && claims.oid ? claims.oid : claims.sub;
      const upn = typeof claims.preferred_username === 'string' && claims.preferred_username
        ? claims.preferred_username
        : claims.upn;
      if (typeof subjectId !== 'string' || !subjectId || typeof upn !== 'string' || !upn) {
        return { ok: false, reason: 'missing_claims' };
      }

      let groups: string[];
      if (claims.groups === undefined) {
        // Groups overage: Entra replaced the list with a pointer. Resolving it needs Graph — refuse.
        const names = claims._claim_names as { groups?: unknown } | undefined;
        if (names && typeof names === 'object' && names.groups !== undefined) return { ok: false, reason: 'missing_claims' };
        groups = [];
      } else if (Array.isArray(claims.groups) && claims.groups.every((g) => typeof g === 'string')) {
        groups = claims.groups as string[];
      } else {
        return { ok: false, reason: 'malformed' };
      }
      const isOperator = groups.some((g) => g.toLowerCase() === config.operatorGroupId.toLowerCase());

      const principal: RequestPrincipal = {
        subjectId,
        upn,
        ...(typeof claims.name === 'string' ? { displayName: claims.name } : {}),
        roles: isOperator ? [BHD_OPERATOR_ROLE_FROM_GROUP] : [],
        tenantId: claims.tid,
        verified: true,
        source: 'token',
        expiresAt: claims.exp,
      };
      Object.freeze(principal.roles);
      return { ok: true, principal: Object.freeze(principal) };
    },
  };
}
