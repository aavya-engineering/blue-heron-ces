// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { createEoAuthMiddleware, readEoAuthOptionsFromEnv } from '../src/eo/server/authMiddleware.js';
import type { Request, Response } from 'express';

function mockReq(opts: { path: string; auth?: string; tenant?: string; remoteAddress?: string }): Request {
  return {
    path: opts.path,
    query: opts.tenant ? { tenant: opts.tenant } : {},
    body: undefined,
    header: (name: string) => (name.toLowerCase() === 'authorization' ? opts.auth : undefined),
    // Default to loopback so token-path tests exercise the "token beats loopback" rule and the
    // no-token dev case is the local-dev path. A network case sets remoteAddress explicitly.
    socket: { remoteAddress: opts.remoteAddress ?? '127.0.0.1' },
  } as unknown as Request;
}

interface Captured {
  status?: number;
  json?: unknown;
}

function mockRes(): { res: Response; captured: Captured } {
  const captured: Captured = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.json = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

/** Run the middleware; return { nexted, captured }. */
function run(mw: ReturnType<typeof createEoAuthMiddleware>, req: Request) {
  const { res, captured } = mockRes();
  let nexted = false;
  mw(req, res, () => {
    nexted = true;
  });
  return { nexted, captured };
}

describe('EO auth middleware (G8)', () => {
  it('allows a LOOPBACK /api request when no token is configured (zero-friction local dev)', () => {
    const { nexted, captured } = run(
      createEoAuthMiddleware({}),
      mockReq({ path: '/api/assess' }), // defaults to 127.0.0.1
    );
    expect(nexted).toBe(true);
    expect(captured.status).toBeUndefined();
  });

  it('REJECTS a NETWORK /api request when no token is configured (no silent exposure)', () => {
    const { nexted, captured } = run(
      createEoAuthMiddleware({}),
      mockReq({ path: '/api/assess', remoteAddress: '10.0.0.5' }),
    );
    expect(nexted).toBe(false);
    expect(captured.status).toBe(401);
  });

  it('401s an /api request with an invalid bearer token when enabled', () => {
    const { nexted, captured } = run(
      createEoAuthMiddleware({ token: 'secret' }),
      mockReq({ path: '/api/assess', auth: 'Bearer wrong' }),
    );
    expect(nexted).toBe(false);
    expect(captured.status).toBe(401);
  });

  it('allows an /api request with the correct bearer token', () => {
    const { nexted, captured } = run(
      createEoAuthMiddleware({ token: 'secret' }),
      mockReq({ path: '/api/assess', auth: 'Bearer secret' }),
    );
    expect(nexted).toBe(true);
    expect(captured.status).toBeUndefined();
  });

  it('does not guard non-/api paths even when enabled', () => {
    const { nexted } = run(
      createEoAuthMiddleware({ token: 'secret' }),
      mockReq({ path: '/dashboard' }),
    );
    expect(nexted).toBe(true);
  });

  it('403s when the request tenant does not match the pinned tenant', () => {
    const { nexted, captured } = run(
      createEoAuthMiddleware({ token: 'secret', tenant: 'acme' }),
      mockReq({ path: '/api/assess', auth: 'Bearer secret', tenant: 'evil' }),
    );
    expect(nexted).toBe(false);
    expect(captured.status).toBe(403);
  });

  it('allows the pinned tenant', () => {
    const { nexted } = run(
      createEoAuthMiddleware({ token: 'secret', tenant: 'acme' }),
      mockReq({ path: '/api/assess', auth: 'Bearer secret', tenant: 'acme' }),
    );
    expect(nexted).toBe(true);
  });

  it('readEoAuthOptionsFromEnv reads token + tenant', () => {
    expect(readEoAuthOptionsFromEnv({ CES_EO_AUTH_TOKEN: 't', CES_EO_TENANT: 'acme' })).toEqual({
      token: 't',
      tenant: 'acme',
    });
    expect(readEoAuthOptionsFromEnv({})).toEqual({ token: undefined, tenant: undefined });
  });
});
