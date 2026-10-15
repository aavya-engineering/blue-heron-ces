// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Shared HTTP bearer-auth middleware for CES servers (AdminOps, EvidenceOps, Stamper GUI).
//
// Security model — "loopback is trusted, the network is not":
//   • Token CONFIGURED  → every /api/* request must carry `Authorization: Bearer <token>`
//                          (loopback included). This is the production posture.
//   • Token NOT set (dev)→ /api/* is allowed from LOOPBACK only (127.0.0.1 / ::1); a request from
//                          any other address is rejected 401. The server is therefore never
//                          silently exposed on the network without a token, yet local development
//                          is zero-friction (loopback just works — no token to fumble with).
//   • Non-/api paths (GUI, static assets) are always open.
//   • Optional tenant pin: when set, a token cannot act on a different tenant.
//
// This closes the "no server auth / auth off-by-default" findings without breaking the common
// single-host dev + deploy case (inter-module calls over loopback need no token).

// Framework-agnostic request/response shapes (no express type dependency in ces-shared).
// Exported so callers that re-export the middleware factory can name the return type.
export interface AuthRequest {
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  /** Express's per-header accessor; used as a fallback when `headers` is absent. */
  header?: (name: string) => string | undefined;
  query?: Record<string, unknown>;
  body?: unknown;
  ip?: string;
  socket?: { remoteAddress?: string };
}
export interface AuthResponse {
  status(code: number): AuthResponse;
  json(body: unknown): void;
}
/** The Express-compatible middleware returned by createBearerAuthMiddleware. */
export type BearerAuthMiddleware = (req: AuthRequest, res: AuthResponse, next: () => void) => void;

export interface BearerAuthOptions {
  /** Required bearer token. Empty/undefined ⇒ dev mode (loopback-only, no token required). */
  token?: string;
  /** Optional: only allow requests whose tenant (query `tenant` or body `tenantSlug`) matches. */
  tenant?: string;
  /** Service name, for messages. */
  service?: string;
  /** Path prefix to guard. Default '/api/'. */
  apiPrefix?: string;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

/** True if the request originates from the loopback interface. */
export function isLoopbackRequest(req: AuthRequest): boolean {
  const raw = req.ip || req.socket?.remoteAddress || '';
  const addr = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  return LOOPBACK.has(addr) || LOOPBACK.has(raw);
}

function headerValue(req: AuthRequest, name: string): string {
  const h = req.headers?.[name];
  if (h !== undefined) return (Array.isArray(h) ? h[0] : h) ?? '';
  // Fallback to Express's req.header() accessor (used by some callers/tests).
  return req.header?.(name) ?? '';
}

function requestTenant(req: AuthRequest): string {
  const q = (req.query?.['tenant'] as string) || '';
  if (q) return q;
  const body = req.body as { tenantSlug?: string } | undefined;
  return body?.tenantSlug ?? '';
}

/**
 * Express-compatible middleware factory. See the security model at the top of this file.
 */
export function createBearerAuthMiddleware(opts: BearerAuthOptions): BearerAuthMiddleware {
  const enabled = typeof opts.token === 'string' && opts.token.length > 0;
  const prefix = opts.apiPrefix ?? '/api/';

  return function bearerAuth(req: AuthRequest, res: AuthResponse, next: () => void): void {
    // Only guard the API surface; GUI/static assets stay open.
    if (!req.path || !req.path.startsWith(prefix)) return next();

    if (!enabled) {
      // Dev mode: loopback trusted, network rejected.
      if (isLoopbackRequest(req)) return next();
      res.status(401).json({
        error: 'unauthorized',
        detail: `network access to ${opts.service ?? 'this service'} requires a bearer token; set the auth token env var to enable remote access (local/loopback access needs no token)`,
      });
      return;
    }

    const header = headerValue(req, 'authorization');
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m || m[1] !== opts.token) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    if (opts.tenant) {
      const reqTenant = requestTenant(req);
      if (reqTenant && reqTenant !== opts.tenant) {
        res.status(403).json({ error: 'tenant not permitted' });
        return;
      }
    }

    next();
  };
}

/** One-line description of the current auth posture, for a startup log. */
export function authPostureLine(opts: BearerAuthOptions): string {
  const svc = opts.service ?? 'server';
  if (typeof opts.token === 'string' && opts.token.length > 0) {
    return `[${svc}] auth: bearer token ENFORCED on ${opts.apiPrefix ?? '/api/'}*${opts.tenant ? ` (tenant-pinned: ${opts.tenant})` : ''}`;
  }
  return `[${svc}] auth: DEV mode — ${opts.apiPrefix ?? '/api/'}* allowed from LOOPBACK only; set the auth token env var for network access`;
}
