// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Authenticated request principal for CES module servers (W4-SH1).
//
// Problem: createBearerAuthMiddleware (./bearerAuth) authenticates the *service* — one shared token,
// loopback trusted — and attaches no per-user identity. Anything that needs "who is acting" (ces-ao's
// two-person approval, requestor/approver separation of duties) had to trust free-text body fields.
//
// This module gives a server a VERIFIED principal per request:
//
//   app.use(requirePrincipal({ verifier: createHs256PrincipalVerifier({ secret }) , apiPrefix: '/api/' }));
//   ...
//   const p = getRequestPrincipal(req);   // { subjectId, upn, displayName?, roles, verified, source }
//
// Security model
//   • The principal comes ONLY from a signed token in a dedicated header (default `x-ces-principal`),
//     verified by a PrincipalVerifier. It is never read from req.body, req.query, or any request property
//     a client or body parser could populate — it lives in a module-private WeakMap keyed by the request.
//   • The dedicated header keeps `Authorization: Bearer` free for the service token, so both middlewares
//     can run on the same request.
//   • Fail closed: no verifier and no dev principal ⇒ every guarded request is 401, loopback included.
//     (This deliberately does NOT inherit bearerAuth's "loopback is trusted" posture.)
//   • Dev mode is explicit: `devPrincipal` must be passed by the caller (the middleware reads no env var).
//     It applies to LOOPBACK requests without a token only, and the principal is marked
//     `verified: false, source: 'dev-unverified'`. A network request without a valid token is still 401.
//     A token that is present but invalid is 401 even from loopback in dev mode (no silent downgrade).
//   • Shipped verifier: HS256 over a JWT-shaped token, local-only (no network / JWKS fetch). Claims are
//     mapped Entra-style (oid|sub → subjectId, upn|preferred_username → upn, name → displayName,
//     roles → roles) so an Entra ID verifier can implement PrincipalVerifier later without caller changes.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isLoopbackRequest, type AuthRequest, type AuthResponse } from './bearerAuth.js';

/** Version of the request-principal surface (shape of RequestPrincipal + token claims). */
export const REQUEST_PRINCIPAL_VERSION = '1.1.0';

/** Default header carrying the per-user principal token. */
export const DEFAULT_PRINCIPAL_HEADER = 'x-ces-principal';

export interface RequestPrincipal {
  /** Stable subject id (Entra `oid`, else `sub`). */
  readonly subjectId: string;
  /** User principal name / login (Entra `upn`, else `preferred_username`). */
  readonly upn: string;
  readonly displayName?: string;
  readonly roles: readonly string[];
  /** Tenant id claim (`tid`) when present. */
  readonly tenantId?: string;
  /** True only when the principal was proven by a verifier. False for the explicit dev principal. */
  readonly verified: boolean;
  /** Where the principal came from. */
  readonly source: 'token' | 'dev-unverified';
  /** Token expiry (epoch seconds), when verified from a token. */
  readonly expiresAt?: number;
  /**
   * The token's id (`jti`), when present. FC-SH step 2 (REQ-ces-shared-principal-token-id, ces-ao
   * FC-AO-2): lets a verifier (e.g. AdminOps approver-token consumers) link a decision back to the
   * EvidenceOps mint record it came from, without decoding the JWT a second time. Never set for a
   * dev-unverified principal.
   */
  readonly tokenId?: string;
}

export type PrincipalVerifyFailure = 'malformed' | 'bad_signature' | 'unsupported_alg' | 'expired' | 'not_yet_valid'
  | 'wrong_issuer' | 'wrong_audience' | 'missing_claims';

export type PrincipalVerifyResult =
  | { ok: true; principal: RequestPrincipal }
  | { ok: false; reason: PrincipalVerifyFailure };

/** Pluggable verifier. The HS256 one below is local-only; an Entra verifier can implement the same shape. */
export interface PrincipalVerifier {
  verify(token: string): PrincipalVerifyResult;
}

export interface Hs256VerifierOptions {
  /** Shared HMAC secret. Must be non-empty (at least 16 chars). */
  secret: string;
  /** If set, the token's `iss` must equal it. */
  issuer?: string;
  /** If set, the token's `aud` (string or array) must contain it. */
  audience?: string;
  /** Allowed clock skew for exp/nbf, seconds. Default 30. */
  clockSkewSeconds?: number;
  /** Clock (epoch ms). Default Date.now. Injectable for tests. */
  now?: () => number;
}

export interface PrincipalClaims {
  sub: string;
  oid?: string;
  upn?: string;
  preferred_username?: string;
  name?: string;
  roles?: string[];
  tid?: string;
  jti?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function assertSecret(secret: unknown): asserts secret is string {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('request principal: HMAC secret must be a string of at least 16 characters');
  }
}

/**
 * Sign a principal token (HS256, JWT-shaped). For local issuers, dev tooling and tests — it requires the same
 * secret the verifier holds, so it is not a bypass. `ttlSeconds` (default 3600) sets `exp` from `now`.
 */
export function signPrincipalToken(
  claims: PrincipalClaims,
  opts: { secret: string; ttlSeconds?: number; now?: () => number },
): string {
  assertSecret(opts.secret);
  const nowSec = Math.floor((opts.now ?? Date.now)() / 1000);
  const payload: PrincipalClaims = { iat: nowSec, exp: nowSec + (opts.ttlSeconds ?? 3600), ...claims };
  const head = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', opts.secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

/** Local-only HS256 verifier. Algorithm is pinned: any header alg other than HS256 (incl. `none`) is rejected. */
export function createHs256PrincipalVerifier(opts: Hs256VerifierOptions): PrincipalVerifier {
  assertSecret(opts.secret);
  const skew = opts.clockSkewSeconds ?? 30;
  const clock = opts.now ?? Date.now;
  return {
    verify(token: string): PrincipalVerifyResult {
      const parts = typeof token === 'string' ? token.split('.') : [];
      if (parts.length !== 3 || parts.some((p) => p.length === 0)) return { ok: false, reason: 'malformed' };
      const [h, p, s] = parts as [string, string, string];
      let header: { alg?: unknown };
      let claims: PrincipalClaims;
      let sig: Buffer;
      try {
        header = JSON.parse(b64urlDecode(h).toString('utf8'));
        claims = JSON.parse(b64urlDecode(p).toString('utf8'));
        sig = b64urlDecode(s);
      } catch {
        return { ok: false, reason: 'malformed' };
      }
      if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') return { ok: false, reason: 'malformed' };
      if (header.alg !== 'HS256') return { ok: false, reason: 'unsupported_alg' };
      const expected = createHmac('sha256', opts.secret).update(`${h}.${p}`).digest();
      if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return { ok: false, reason: 'bad_signature' };

      const nowSec = Math.floor(clock() / 1000);
      if (typeof claims.exp !== 'number') return { ok: false, reason: 'missing_claims' };
      if (nowSec > claims.exp + skew) return { ok: false, reason: 'expired' };
      if (typeof claims.nbf === 'number' && nowSec + skew < claims.nbf) return { ok: false, reason: 'not_yet_valid' };
      if (opts.issuer !== undefined && claims.iss !== opts.issuer) return { ok: false, reason: 'wrong_issuer' };
      if (opts.audience !== undefined) {
        const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud !== undefined ? [claims.aud] : [];
        if (!aud.includes(opts.audience)) return { ok: false, reason: 'wrong_audience' };
      }

      const subjectId = typeof claims.oid === 'string' && claims.oid ? claims.oid : claims.sub;
      const upn = typeof claims.upn === 'string' && claims.upn ? claims.upn : claims.preferred_username;
      if (typeof subjectId !== 'string' || !subjectId || typeof upn !== 'string' || !upn) {
        return { ok: false, reason: 'missing_claims' };
      }
      if (claims.roles !== undefined && (!Array.isArray(claims.roles) || claims.roles.some((r) => typeof r !== 'string'))) {
        return { ok: false, reason: 'malformed' };
      }
      return {
        ok: true,
        principal: freezePrincipal({
          subjectId,
          upn,
          ...(typeof claims.name === 'string' ? { displayName: claims.name } : {}),
          roles: claims.roles ?? [],
          ...(typeof claims.tid === 'string' ? { tenantId: claims.tid } : {}),
          ...(typeof claims.jti === 'string' && claims.jti ? { tokenId: claims.jti } : {}),
          verified: true,
          source: 'token',
          expiresAt: claims.exp,
        }),
      };
    },
  };
}

function freezePrincipal(p: RequestPrincipal): RequestPrincipal {
  Object.freeze(p.roles);
  return Object.freeze(p);
}

export interface DevPrincipalConfig {
  subjectId: string;
  upn: string;
  displayName?: string;
  roles?: string[];
}

export interface RequirePrincipalOptions {
  /** Verifier for principal tokens. Omit only together with devPrincipal (or to refuse everything). */
  verifier?: PrincipalVerifier;
  /**
   * EXPLICIT local-dev principal. Applied only to loopback requests that carry no principal token; marked
   * `verified: false, source: 'dev-unverified'`. Never set this in a deployed configuration.
   */
  devPrincipal?: DevPrincipalConfig;
  /** Header carrying the principal token. Default `x-ces-principal`. Value may be the raw token or `Bearer <token>`. */
  header?: string;
  /** Path prefix to guard. Default '/api/'. Other paths pass through with no principal attached. */
  apiPrefix?: string;
  /** If set, the principal must hold at least one of these roles (else 403). */
  requiredRoles?: string[];
  /** Service name, for messages. */
  service?: string;
}

export type RequirePrincipalMiddleware = (req: AuthRequest, res: AuthResponse, next: () => void) => void;

// Module-private: the ONLY place a principal is stored. Not reachable from request bodies or properties.
const PRINCIPALS = new WeakMap<object, RequestPrincipal>();

/** The verified (or explicitly dev) principal attached by requirePrincipal, or undefined. Never reads req fields. */
export function getRequestPrincipal(req: object): RequestPrincipal | undefined {
  return req && typeof req === 'object' ? PRINCIPALS.get(req) : undefined;
}

/** True if the request's principal holds `role`. */
export function principalHasRole(req: object, role: string): boolean {
  return getRequestPrincipal(req)?.roles.includes(role) ?? false;
}

function readHeader(req: AuthRequest, name: string): string {
  const h = req.headers?.[name];
  if (h !== undefined) return (Array.isArray(h) ? h[0] : h) ?? '';
  return req.header?.(name) ?? '';
}

/** Express-compatible middleware that authenticates the per-user principal. See the model at the top of this file. */
export function requirePrincipal(opts: RequirePrincipalOptions): RequirePrincipalMiddleware {
  const headerName = (opts.header ?? DEFAULT_PRINCIPAL_HEADER).toLowerCase();
  const prefix = opts.apiPrefix ?? '/api/';
  const dev = opts.devPrincipal
    ? freezePrincipal({
        subjectId: opts.devPrincipal.subjectId,
        upn: opts.devPrincipal.upn,
        ...(opts.devPrincipal.displayName ? { displayName: opts.devPrincipal.displayName } : {}),
        roles: [...(opts.devPrincipal.roles ?? [])],
        verified: false,
        source: 'dev-unverified',
      })
    : undefined;

  return function principalAuth(req: AuthRequest, res: AuthResponse, next: () => void): void {
    if (!req.path || !req.path.startsWith(prefix)) return next();

    const raw = readHeader(req, headerName).trim();
    const token = raw.replace(/^Bearer\s+/i, '');

    let principal: RequestPrincipal | undefined;
    if (token) {
      if (!opts.verifier) {
        res.status(401).json({ error: 'unauthorized', detail: 'principal token supplied but no verifier is configured' });
        return;
      }
      const r = opts.verifier.verify(token);
      if (!r.ok) {
        res.status(401).json({ error: 'unauthorized', reason: r.reason });
        return;
      }
      principal = r.principal;
    } else if (dev && isLoopbackRequest(req)) {
      principal = dev;
    } else {
      res.status(401).json({
        error: 'unauthorized',
        detail: `${opts.service ?? 'this service'} requires an authenticated principal (header ${headerName})`,
      });
      return;
    }

    if (opts.requiredRoles && opts.requiredRoles.length > 0 && !opts.requiredRoles.some((r) => principal!.roles.includes(r))) {
      res.status(403).json({ error: 'forbidden', detail: `requires one of roles: ${opts.requiredRoles.join(', ')}` });
      return;
    }

    PRINCIPALS.set(req, principal);
    next();
  };
}

/** One-line description of the principal posture, for a startup log. */
export function principalPostureLine(opts: RequirePrincipalOptions): string {
  const svc = opts.service ?? 'server';
  const hdr = opts.header ?? DEFAULT_PRINCIPAL_HEADER;
  if (opts.verifier && opts.devPrincipal) {
    return `[${svc}] principal: VERIFIED tokens (${hdr}) + DEV UNVERIFIED principal '${opts.devPrincipal.upn}' for loopback requests without a token — never deploy with devPrincipal set`;
  }
  if (opts.verifier) return `[${svc}] principal: VERIFIED tokens required (${hdr})`;
  if (opts.devPrincipal) {
    return `[${svc}] principal: DEV UNVERIFIED principal '${opts.devPrincipal.upn}' (loopback only); no verifier — network requests refused`;
  }
  return `[${svc}] principal: NOT CONFIGURED — every guarded request is refused (401)`;
}
