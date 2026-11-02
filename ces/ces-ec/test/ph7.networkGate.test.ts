// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH7-SEC: EC listens on every interface by default (founder rule 10-30, no loopback-only defaults),
// and the read routes that were open (/api/runs, /api/findings) need the bearer from a network
// caller. Servers here bind port 0 only.

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';

import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireBearerFromNetwork } from '../src/auth.js';
import { createApp } from '../src/app.js';
import { DEFAULT_EC_HOST, EC_BIND_ALL, getHost } from '../src/config.js';
import { startEc, type RunningEc } from '../src/index.js';
import { auth, makeSandbox, registerTenant, SECRET, type Sandbox } from './helpers.js';

function fakeRes() {
  const r = { code: 0, body: undefined as unknown };
  const res = {
    status(c: number) { r.code = c; return res; },
    json(b: unknown) { r.body = b; },
  };
  return { r, res: res as unknown as Response };
}

function call(remote: string, authorization?: string) {
  const req = { ip: remote, socket: { remoteAddress: remote }, headers: authorization ? { authorization } : {} } as unknown as Request;
  const { r, res } = fakeRes();
  let passed = false;
  requireBearerFromNetwork(req, res, (() => { passed = true; }) as NextFunction);
  return { passed, code: r.code };
}

/** A non-internal IPv4 address of this machine, or undefined (then the socket test is skipped). */
function lanAddress(): string | undefined {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return undefined;
}

let sb: Sandbox;
beforeEach(() => { sb = makeSandbox(); });
afterEach(() => { sb.restore(); });

describe('EC bind default (PH7-SEC)', () => {
  it('defaults to every interface; EC_HOST still names one address', () => {
    expect(DEFAULT_EC_HOST).toBe(EC_BIND_ALL);
    expect(getHost({})).toBe('all');
    expect(getHost({ EC_HOST: '  ' })).toBe('all');
    expect(getHost({ EC_HOST: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it('startEc with no host listens on the wildcard address, and loopback still answers', async () => {
    let ec: RunningEc | undefined;
    try {
      ec = await startEc({ port: 0, intervalMin: 1440 });
      const a = ec.server.address() as AddressInfo;
      expect(['::', '0.0.0.0']).toContain(a.address);
      const r = await fetch(`http://127.0.0.1:${a.port}/api/health`);
      expect(r.status).toBe(200);
    } finally {
      await ec?.close();
    }
  });

  it('startEc with EC_HOST=127.0.0.1 binds that one address', async () => {
    process.env.EC_HOST = '127.0.0.1';
    let ec: RunningEc | undefined;
    try {
      ec = await startEc({ port: 0, intervalMin: 1440 });
      expect((ec.server.address() as AddressInfo).address).toBe('127.0.0.1');
    } finally {
      await ec?.close();
    }
  });
});

describe('requireBearerFromNetwork (PH7-SEC)', () => {
  it('loopback callers pass with no token (EO on the same host is unchanged)', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(call(ip).passed).toBe(true);
  });

  it('a network caller needs the bearer', () => {
    expect(call('10.1.2.3')).toEqual({ passed: false, code: 401 });
    expect(call('10.1.2.3', 'Bearer wrong')).toEqual({ passed: false, code: 401 });
    expect(call('10.1.2.3', `Bearer ${SECRET}`)).toEqual({ passed: true, code: 0 });
  });

  it('with no secret set, a network caller is refused even with a token', () => {
    delete process.env.EVIDENCE_OPS_SECRET;
    expect(call('10.1.2.3', `Bearer ${SECRET}`)).toEqual({ passed: false, code: 401 });
    expect(call('127.0.0.1').passed).toBe(true);
  });
});

const lan = lanAddress();
describe.skipIf(!lan)('network caller over a real socket (PH7-SEC)', () => {
  it('/api/runs and /api/findings answer 401 without the bearer and 200 with it; /api/health stays open', async () => {
    registerTenant(sb, 'ec-sim-a', 'sim');
    const app = createApp({ resolveTenant: sb.resolver });
    const server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const { port } = server.address() as AddressInfo;
      const base = `http://${lan}:${port}`;
      expect((await fetch(`${base}/api/health`)).status).toBe(200);
      for (const route of ['/api/runs?tenant=ec-sim-a', '/api/findings?tenant=ec-sim-a']) {
        expect((await fetch(`${base}${route}`)).status).toBe(401);
        expect((await fetch(`${base}${route}`, { headers: auth() })).status).toBe(200);
        expect((await fetch(`http://127.0.0.1:${port}${route}`)).status).toBe(200);
      }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
