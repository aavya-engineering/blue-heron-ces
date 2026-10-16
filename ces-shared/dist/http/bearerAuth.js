// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
/** True if the request originates from the loopback interface. */
export function isLoopbackRequest(req) {
    const raw = req.ip || req.socket?.remoteAddress || '';
    const addr = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
    return LOOPBACK.has(addr) || LOOPBACK.has(raw);
}
function headerValue(req, name) {
    const h = req.headers?.[name];
    if (h !== undefined)
        return (Array.isArray(h) ? h[0] : h) ?? '';
    // Fallback to Express's req.header() accessor (used by some callers/tests).
    return req.header?.(name) ?? '';
}
function requestTenant(req) {
    const q = req.query?.['tenant'] || '';
    if (q)
        return q;
    const body = req.body;
    return body?.tenantSlug ?? '';
}
/**
 * Express-compatible middleware factory. See the security model at the top of this file.
 */
export function createBearerAuthMiddleware(opts) {
    const enabled = typeof opts.token === 'string' && opts.token.length > 0;
    const prefix = opts.apiPrefix ?? '/api/';
    return function bearerAuth(req, res, next) {
        // Only guard the API surface; GUI/static assets stay open.
        if (!req.path || !req.path.startsWith(prefix))
            return next();
        if (!enabled) {
            // Dev mode: loopback trusted, network rejected.
            if (isLoopbackRequest(req))
                return next();
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
export function authPostureLine(opts) {
    const svc = opts.service ?? 'server';
    if (typeof opts.token === 'string' && opts.token.length > 0) {
        return `[${svc}] auth: bearer token ENFORCED on ${opts.apiPrefix ?? '/api/'}*${opts.tenant ? ` (tenant-pinned: ${opts.tenant})` : ''}`;
    }
    return `[${svc}] auth: DEV mode — ${opts.apiPrefix ?? '/api/'}* allowed from LOOPBACK only; set the auth token env var for network access`;
}
//# sourceMappingURL=bearerAuth.js.map