// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  requirePrincipal, getRequestPrincipal, principalHasRole, principalPostureLine,
  createHs256PrincipalVerifier, signPrincipalToken, REQUEST_PRINCIPAL_VERSION, DEFAULT_PRINCIPAL_HEADER,
} from './requestPrincipal.js';
import { createBearerAuthMiddleware } from './bearerAuth.js';

const SECRET = 'test-secret-0123456789abcdef';
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);
const now = () => T0;
const verifier = createHs256PrincipalVerifier({ secret: SECRET, issuer: 'ces-local', audience: 'ces-ao', now });

function mkRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; };
  return res;
}
function tok(extra: Record<string, unknown> = {}, ttlSeconds = 600) {
  return signPrincipalToken(
    { sub: 'sub-approver', oid: 'oid-approver', upn: 'approver@example.test', name: 'Approver One',
      roles: ['ces.approver'], tid: 'tid-1', iss: 'ces-local', aud: 'ces-ao', ...extra } as any,
    { secret: SECRET, ttlSeconds, now },
  );
}
function req(opts: { token?: string; ip?: string; body?: unknown; path?: string; extraHeaders?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.extraHeaders ?? {}) };
  if (opts.token !== undefined) headers[DEFAULT_PRINCIPAL_HEADER] = opts.token;
  return { path: opts.path ?? '/api/approvals/a1/decision', method: 'POST', headers, body: opts.body,
    socket: { remoteAddress: opts.ip ?? '10.0.0.5' } } as any;
}
function run(mw: ReturnType<typeof requirePrincipal>, r: any) {
  const next = vi.fn(); const res = mkRes();
  mw(r, res, next);
  return { next, res, principal: getRequestPrincipal(r) };
}

describe('W4-SH1 request principal — verified token', () => {
  const mw = requirePrincipal({ verifier, service: 'test' });

  it('a valid token yields the principal (subject, UPN, display name, tenant) and exposes roles', () => {
    const { next, principal } = run(mw, req({ token: tok() }));
    expect(next).toHaveBeenCalled();
    expect(principal).toMatchObject({
      subjectId: 'oid-approver', upn: 'approver@example.test', displayName: 'Approver One',
      tenantId: 'tid-1', roles: ['ces.approver'], verified: true, source: 'token',
    });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(Object.isFrozen(principal!.roles)).toBe(true);
  });

  it('accepts "Bearer <token>" in the principal header and falls back to sub / preferred_username', () => {
    const t = signPrincipalToken({ sub: 's-2', preferred_username: 'op@example.test', iss: 'ces-local', aud: ['x', 'ces-ao'] },
      { secret: SECRET, now });
    const r = req({ token: `Bearer ${t}` });
    const { next, principal } = run(mw, r);
    expect(next).toHaveBeenCalled();
    expect(principal).toMatchObject({ subjectId: 's-2', upn: 'op@example.test', roles: [] });
    expect(principalHasRole(r, 'ces.approver')).toBe(false);
  });

  it('principalHasRole reads the verified roles', () => {
    const r = req({ token: tok({ roles: ['ces.approver', 'ces.operator'] }) });
    run(mw, r);
    expect(principalHasRole(r, 'ces.operator')).toBe(true);
  });
});

describe('W4-SH1 request principal — refusals (401)', () => {
  const mw = requirePrincipal({ verifier, service: 'test' });
  const cases: Array<[string, () => string | undefined, string | undefined]> = [
    ['missing token', () => undefined, undefined],
    ['expired token', () => tok({ exp: Math.floor(T0 / 1000) - 3600 }), 'expired'],
    ['not-yet-valid token', () => tok({ nbf: Math.floor(T0 / 1000) + 3600 }), 'not_yet_valid'],
    ['tampered payload', () => { const [h, , s] = tok().split('.'); const p = Buffer.from(JSON.stringify({ sub: 'x', upn: 'evil@example.test', exp: 9e9, iss: 'ces-local', aud: 'ces-ao' })).toString('base64url'); return `${h}.${p}.${s}`; }, 'bad_signature'],
    ['signed with another secret', () => signPrincipalToken({ sub: 's', upn: 'u@example.test', iss: 'ces-local', aud: 'ces-ao' }, { secret: 'another-secret-0123456789', now }), 'bad_signature'],
    ['malformed token', () => 'not.a-token', 'malformed'],
    ['garbage segments', () => 'a.b.c', 'malformed'],
    ['wrong issuer', () => tok({ iss: 'someone-else' }), 'wrong_issuer'],
    ['wrong audience', () => tok({ aud: 'ces-eo' }), 'wrong_audience'],
    ['no upn claim', () => tok({ upn: undefined }), 'missing_claims'],
    ['alg none', () => { const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'); const p = tok().split('.')[1]; return `${h}.${p}.AAAA`; }, 'unsupported_alg'],
    ['alg HS512 header re-signed', () => { const h = Buffer.from(JSON.stringify({ alg: 'HS512' })).toString('base64url'); const p = tok().split('.')[1]; const s = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url'); return `${h}.${p}.${s}`; }, 'unsupported_alg'],
  ];
  for (const [name, mk, reason] of cases) {
    it(`${name} → 401${reason ? ` (${reason})` : ''}, next not called, no principal`, () => {
      const t = mk();
      const { next, res, principal } = run(mw, req({ token: t, ip: '127.0.0.1' }));
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      if (reason) expect(res.body.reason).toBe(reason);
      expect(principal).toBeUndefined();
    });
  }

  it('an expired token within clock skew is still accepted; beyond skew is not', () => {
    const exp = Math.floor(T0 / 1000) - 10;
    expect(run(mw, req({ token: tok({ exp }) })).next).toHaveBeenCalled();
    expect(run(mw, req({ token: tok({ exp: exp - 60 }) })).res.statusCode).toBe(401);
  });

  it('non-/api paths pass through with no principal', () => {
    const { next, principal } = run(mw, req({ path: '/' }));
    expect(next).toHaveBeenCalled();
    expect(principal).toBeUndefined();
  });
});

describe('W4-SH1 request principal — never derived from the request body or properties', () => {
  const mw = requirePrincipal({ verifier });

  it('valid token for approver@ + body approverUPN other@ → principal is approver@', () => {
    const r = req({ token: tok(), body: { approverUPN: 'other@example.test', upn: 'other@example.test', sub: 'evil', roles: ['admin'] } });
    const { principal } = run(mw, r);
    expect(principal!.upn).toBe('approver@example.test');
    expect(principal!.roles).toEqual(['ces.approver']);
  });

  it('no token + principal-looking body → 401', () => {
    const { res, principal } = run(mw, req({ body: { approverUPN: 'other@example.test', principal: { upn: 'other@example.test' } } }));
    expect(res.statusCode).toBe(401);
    expect(principal).toBeUndefined();
  });

  it('getRequestPrincipal ignores req.cesPrincipal / req.principal / body fields', () => {
    const forged = { body: { upn: 'x@example.test' }, cesPrincipal: { upn: 'x@example.test', verified: true }, principal: { upn: 'x@example.test' } };
    expect(getRequestPrincipal(forged)).toBeUndefined();
  });
});

describe('W4-SH1 request principal — fail closed and explicit dev mode', () => {
  it('no verifier and no dev principal → 401 for everything, loopback included', () => {
    const mw = requirePrincipal({});
    expect(run(mw, req({ ip: '127.0.0.1' })).res.statusCode).toBe(401);
    expect(run(mw, req({ ip: '127.0.0.1', token: tok() })).res.statusCode).toBe(401);
  });

  const dev = { subjectId: 'dev-1', upn: 'dev@example.test', roles: ['ces.approver'] };
  const mw = requirePrincipal({ verifier, devPrincipal: dev });

  it('dev principal applies to loopback requests without a token, marked unverified', () => {
    const { next, principal } = run(mw, req({ ip: '127.0.0.1' }));
    expect(next).toHaveBeenCalled();
    expect(principal).toMatchObject({ upn: 'dev@example.test', verified: false, source: 'dev-unverified', roles: ['ces.approver'] });
  });

  it('dev principal is NOT applied to network requests (401)', () => {
    const { res, principal } = run(mw, req({ ip: '10.0.0.5' }));
    expect(res.statusCode).toBe(401);
    expect(principal).toBeUndefined();
  });

  it('an invalid token from loopback in dev mode is 401 (no silent downgrade to the dev principal)', () => {
    const { res } = run(mw, req({ ip: '127.0.0.1', token: tok({ exp: 1 }) }));
    expect(res.statusCode).toBe(401);
  });

  it('a valid token wins over the dev principal on loopback', () => {
    const { principal } = run(mw, req({ ip: '127.0.0.1', token: tok() }));
    expect(principal).toMatchObject({ upn: 'approver@example.test', verified: true });
  });

  it('posture line says DEV UNVERIFIED / NOT CONFIGURED / VERIFIED', () => {
    expect(principalPostureLine({ devPrincipal: dev })).toMatch(/DEV UNVERIFIED/);
    expect(principalPostureLine({ verifier, devPrincipal: dev })).toMatch(/never deploy/);
    expect(principalPostureLine({})).toMatch(/NOT CONFIGURED/);
    expect(principalPostureLine({ verifier })).toMatch(/VERIFIED tokens required/);
  });
});

describe('W4-SH1 request principal — roles gate and coexistence with the service bearer token', () => {
  it('requiredRoles → 403 when the verified principal lacks the role', () => {
    const mw = requirePrincipal({ verifier, requiredRoles: ['ces.approver'] });
    expect(run(mw, req({ token: tok({ roles: ['ces.viewer'] }) })).res.statusCode).toBe(403);
    expect(run(mw, req({ token: tok() })).next).toHaveBeenCalled();
  });

  it('service token in Authorization + principal token in x-ces-principal: both middlewares pass', () => {
    const svc = createBearerAuthMiddleware({ token: 'svc-token' });
    const mw = requirePrincipal({ verifier });
    const r = req({ token: tok(), extraHeaders: { authorization: 'Bearer svc-token' } });
    const n1 = vi.fn(); svc(r, mkRes(), n1);
    expect(n1).toHaveBeenCalled();
    const { next, principal } = run(mw, r);
    expect(next).toHaveBeenCalled();
    expect(principal!.upn).toBe('approver@example.test');
  });

  it('exposes a version and rejects a weak secret', () => {
    expect(REQUEST_PRINCIPAL_VERSION).toBe('1.1.0');
    expect(() => createHs256PrincipalVerifier({ secret: 'short' })).toThrow(/at least 16/);
  });
});

describe('FC-SH step 2 — token id (jti) on the verified principal', () => {
  const mw = requirePrincipal({ verifier, service: 'test' });

  it('a token signed with jti yields a principal carrying tokenId', () => {
    const { principal } = run(mw, req({ token: tok({ jti: 'mint-1' }) }));
    expect(principal).toMatchObject({ tokenId: 'mint-1', verified: true });
  });

  it('a token with no jti claim yields a principal with no tokenId key', () => {
    const { principal } = run(mw, req({ token: tok() }));
    expect(principal).toBeDefined();
    expect('tokenId' in principal!).toBe(false);
  });

  it('the dev-unverified principal never carries a tokenId', () => {
    const devMw = requirePrincipal({ verifier, devPrincipal: { subjectId: 'dev-1', upn: 'dev@example.test' } });
    const { principal } = run(devMw, req({ ip: '127.0.0.1' }));
    expect(principal?.source).toBe('dev-unverified');
    expect('tokenId' in principal!).toBe(false);
  });
});
