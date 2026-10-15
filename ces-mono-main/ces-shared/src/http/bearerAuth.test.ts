// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, vi } from 'vitest';
import { createBearerAuthMiddleware, isLoopbackRequest, authPostureLine } from './bearerAuth.js';

function mkRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; };
  return res;
}
const loopback = { path: '/api/x', headers: {}, socket: { remoteAddress: '127.0.0.1' } };
const remote = { path: '/api/x', headers: {}, socket: { remoteAddress: '10.0.0.5' } };

describe('isLoopbackRequest', () => {
  it('recognizes 127.0.0.1, ::1, and IPv4-mapped IPv6', () => {
    expect(isLoopbackRequest({ socket: { remoteAddress: '127.0.0.1' } })).toBe(true);
    expect(isLoopbackRequest({ socket: { remoteAddress: '::1' } })).toBe(true);
    expect(isLoopbackRequest({ socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBe(true);
    expect(isLoopbackRequest({ ip: '127.0.0.1' })).toBe(true);
    expect(isLoopbackRequest({ socket: { remoteAddress: '10.0.0.5' } })).toBe(false);
  });
});

describe('bearer auth — dev mode (no token): loopback trusted, network rejected', () => {
  const mw = createBearerAuthMiddleware({ service: 'test' });

  it('allows a loopback /api request without a token', () => {
    const next = vi.fn();
    mw(loopback, mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a network /api request with 401 and a helpful detail', () => {
    const next = vi.fn(); const res = mkRes();
    mw(remote, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as any).detail).toMatch(/requires a bearer token/i);
  });

  it('leaves non-/api paths open even from the network', () => {
    const next = vi.fn();
    mw({ path: '/', headers: {}, socket: { remoteAddress: '10.0.0.5' } }, mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('bearer auth — token configured: enforced everywhere', () => {
  const mw = createBearerAuthMiddleware({ token: 'secret', service: 'test' });

  it('rejects loopback WITHOUT the token (token beats loopback trust)', () => {
    const next = vi.fn(); const res = mkRes();
    mw(loopback, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('accepts a correct bearer token', () => {
    const next = vi.fn();
    mw({ ...remote, headers: { authorization: 'Bearer secret' } }, mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a wrong token', () => {
    const next = vi.fn(); const res = mkRes();
    mw({ ...remote, headers: { authorization: 'Bearer nope' } }, res, next);
    expect(res.statusCode).toBe(401);
  });
});

describe('bearer auth — tenant pin', () => {
  const mw = createBearerAuthMiddleware({ token: 'secret', tenant: 'vfsgov', service: 'test' });
  it('rejects a valid token acting on a different tenant', () => {
    const next = vi.fn(); const res = mkRes();
    mw({ path: '/api/x', headers: { authorization: 'Bearer secret' }, query: { tenant: 'other' }, socket: { remoteAddress: '10.0.0.5' } }, res, next);
    expect(res.statusCode).toBe(403);
  });
  it('allows the pinned tenant', () => {
    const next = vi.fn();
    mw({ path: '/api/x', headers: { authorization: 'Bearer secret' }, query: { tenant: 'vfsgov' }, socket: { remoteAddress: '10.0.0.5' } }, mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('authPostureLine', () => {
  it('says ENFORCED when a token is set, DEV/loopback otherwise', () => {
    expect(authPostureLine({ token: 't', service: 'ao' })).toMatch(/ENFORCED/);
    expect(authPostureLine({ service: 'ao' })).toMatch(/DEV mode.*LOOPBACK/);
  });
});
