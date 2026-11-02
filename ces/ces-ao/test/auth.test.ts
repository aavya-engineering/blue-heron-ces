// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SEC-4 (gap closure 2026-10-30): AO server auth posture, bind address and /api/health.
// Through the real AoServer.createApp() composition on 127.0.0.1:0:
//  - with CES_AO_AUTH_TOKEN set, a tokenless loopback /api call is 401 and the token passes;
//  - /api/health stays open with a token set and reports auth "ENFORCED" + the bind address;
//  - without a token, /api/health reports "LOOPBACK_TRUSTED" and loopback /api calls pass;
//  - /api/health carries no tenant data (exact key set, no "tenant" anywhere in the body);
//  - the bind is every interface unless CES_AO_BIND is set.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AoServer, resolveAoBindHost, aoAuthPosture } from '../src/server/AoServer.js';

const TOKEN = 'sec4-test-token-0001';
let tmpRoot: string;
let savedPipelineRoot: string | undefined;
let server: Server | undefined;

async function listen(env: NodeJS.ProcessEnv): Promise<string> {
  const app = AoServer.createApp(env);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-sec4-'));
  savedPipelineRoot = process.env.CES_PIPELINE_ROOT;
  process.env.CES_PIPELINE_ROOT = tmpRoot;
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

afterAll(() => {
  if (savedPipelineRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
  else process.env.CES_PIPELINE_ROOT = savedPipelineRoot;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('SEC-4 bind address', () => {
  it('defaults to every interface and honours CES_AO_BIND', () => {
    expect(resolveAoBindHost({})).toBe('all');
    expect(resolveAoBindHost({ CES_AO_BIND: '' })).toBe('all');
    expect(resolveAoBindHost({ CES_AO_BIND: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('auth posture is ENFORCED only with a non-empty token', () => {
    expect(aoAuthPosture(TOKEN)).toBe('ENFORCED');
    expect(aoAuthPosture('')).toBe('LOOPBACK_TRUSTED');
    expect(aoAuthPosture(undefined)).toBe('LOOPBACK_TRUSTED');
  });
});

describe('SEC-4 token configured', () => {
  it('tokenless loopback /api call is 401; the bearer token passes', async () => {
    const base = await listen({ CES_AO_AUTH_TOKEN: TOKEN });
    const noToken = await fetch(`${base}/api/commands`);
    expect(noToken.status).toBe(401);
    const wrong = await fetch(`${base}/api/commands`, { headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
    const ok = await fetch(`${base}/api/commands`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.status).toBe(200);
  });

  it('/api/health stays open and reports ENFORCED + bind, with no tenant data', async () => {
    const base = await listen({ CES_AO_AUTH_TOKEN: TOKEN, CES_AO_BIND: '127.0.0.1' });
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(['auth', 'bind', 'registryLoaded', 'status', 'version']);
    expect(body.auth).toBe('ENFORCED');
    expect(body.bind).toBe('127.0.0.1');
    expect(text.toLowerCase()).not.toContain('tenant');
    expect(text).not.toContain(TOKEN);
  });
});

describe('SEC-4 no token', () => {
  it('/api/health reports LOOPBACK_TRUSTED and loopback /api calls pass', async () => {
    const base = await listen({});
    const health: any = await (await fetch(`${base}/api/health`)).json();
    expect(health.auth).toBe('LOOPBACK_TRUSTED');
    expect(health.bind).toBe('all');
    const res = await fetch(`${base}/api/commands`);
    expect(res.status).toBe(200);
  });
});
