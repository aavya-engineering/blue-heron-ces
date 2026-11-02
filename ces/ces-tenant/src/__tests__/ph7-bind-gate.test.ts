// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PH7-SEC (founder rule 10-30, no loopback-only defaults): the tenant service daemon listens on
 * every interface by default, behind the CES_TENANT_AUTH_TOKEN gate. Daemons bind port 0 only;
 * registry and pipeline roots are temp folders.
 */

import * as fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { TenantServiceClient } from '../service/client.js';
import { resolveTenantBindHost, TENANT_BIND_ALL, TenantServiceDaemon } from '../service/server.js';

const quietLogger = { log: () => {}, warn: () => {}, error: () => {} };
const TOKEN = 'ph7-test-token-0123456789abcdef';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function startDaemon(env: NodeJS.ProcessEnv, host?: string): Promise<{ daemon: TenantServiceDaemon; port: number }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-tenant-ph7-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registryRoot = path.join(dir, 'tenants');
  const cesPipelineRoot = path.join(dir, 'pl');
  const homeDir = path.join(dir, 'home');
  for (const d of [registryRoot, cesPipelineRoot, homeDir]) fs.mkdirSync(d, { recursive: true });
  const full = { ...env, CES_TENANT_ROOT: registryRoot, CES_PIPELINE_ROOT: cesPipelineRoot };
  const daemon = new TenantServiceDaemon({
    port: 0,
    ...(host !== undefined ? { host } : {}),
    env: full,
    registryOptions: { registryRoot, cesPipelineRoot, homeDir, env: full },
    keysOptions: { cesPipelineRoot, homeDir, env: full },
    launchOptions: { env: full, stacksimRoot: path.join(dir, 'stacksim') },
    logger: quietLogger,
  });
  const port = await daemon.start();
  cleanups.push(() => daemon.stop());
  return { daemon, port };
}

function boundAddress(daemon: TenantServiceDaemon): string {
  const server = (daemon as unknown as { server: Server }).server;
  return (server.address() as AddressInfo).address;
}

function lanAddress(): string | undefined {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return undefined;
}

describe('tenant daemon bind (PH7-SEC)', () => {
  it('resolveTenantBindHost: unset/blank = every interface; a value names one address', () => {
    expect(resolveTenantBindHost({})).toBe(TENANT_BIND_ALL);
    expect(resolveTenantBindHost({ CES_TENANT_BIND: ' ' })).toBe(TENANT_BIND_ALL);
    expect(resolveTenantBindHost({ CES_TENANT_BIND: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it('default listens on the wildcard address; CES_TENANT_BIND pins one address', async () => {
    const all = await startDaemon({});
    expect(['::', '0.0.0.0']).toContain(boundAddress(all.daemon));
    const pinned = await startDaemon({ CES_TENANT_BIND: '127.0.0.1' });
    expect(boundAddress(pinned.daemon)).toBe('127.0.0.1');
  });
});

describe('tenant daemon token gate (PH7-SEC)', () => {
  it('no token: loopback callers are served as before; /health is open', async () => {
    const { port } = await startDaemon({});
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/status`)).status).toBe(200);
    expect((await fetch(`${base}/status`)).status).toBe(200);
  });

  it('token set: /api/* and /status need the bearer (loopback included); /health stays open', async () => {
    const { port } = await startDaemon({ CES_TENANT_AUTH_TOKEN: TOKEN });
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    for (const route of ['/api/status', '/status', '/api/activity']) {
      expect((await fetch(`${base}${route}`)).status).toBe(401);
      expect((await fetch(`${base}${route}`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
      expect((await fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    }
    const claim = await fetch(`${base}/api/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug: 't', consumer: { module: 'm', purpose: 'p' } }),
    });
    expect(claim.status).toBe(401);
  });

  const lan = lanAddress();
  it.skipIf(!lan)('no token: a network caller is refused 401 (credential routes included)', async () => {
    const { port } = await startDaemon({});
    const base = `http://${lan}:${port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/status`)).status).toBe(401);
    expect((await fetch(`${base}/status`)).status).toBe(401);
    const claim = await fetch(`${base}/api/auth/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug: 't', consumer: { module: 'm', purpose: 'p' } }),
    });
    expect(claim.status).toBe(401);
  });

  it.skipIf(!lan)('token set: a network caller with the bearer is served', async () => {
    const { port } = await startDaemon({ CES_TENANT_AUTH_TOKEN: TOKEN });
    const r = await fetch(`http://${lan}:${port}/api/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(200);
  });
});

describe('tenant client sends the daemon bearer (PH7-SEC)', () => {
  const consumer = { module: 'ph7-test', purpose: 'client bearer' };

  it('token in env: the client is served by a token-enforced daemon', async () => {
    const { port } = await startDaemon({ CES_TENANT_AUTH_TOKEN: TOKEN });
    const client = new TenantServiceClient({ consumer, baseUrl: `http://127.0.0.1:${port}`, env: { CES_TENANT_AUTH_TOKEN: TOKEN }, logger: quietLogger });
    const status = await client.getStatus();
    expect(status.mode).toBe('auth-state-only');
    expect(await client.claimAuthState('no-such-tenant')).toBeUndefined();
  });

  it('authToken option wins; no token = refused by a token-enforced daemon', async () => {
    const { port } = await startDaemon({ CES_TENANT_AUTH_TOKEN: TOKEN });
    const base = `http://127.0.0.1:${port}`;
    const viaOption = new TenantServiceClient({ consumer, baseUrl: base, env: {}, authToken: TOKEN, logger: quietLogger });
    expect((await viaOption.getStatus()).mode).toBe('auth-state-only');
    const none = new TenantServiceClient({ consumer, baseUrl: base, env: {}, logger: quietLogger });
    await expect(none.getStatus()).rejects.toThrow();
  });

  it('no token anywhere: no authorization header is sent (loopback dev mode unchanged)', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string>) });
      return new Response(JSON.stringify({ mode: 'auth-state-only', startedAt: '', tenants: [], activitySource: 'self-reported' }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new TenantServiceClient({ consumer, baseUrl: 'http://127.0.0.1:1', env: {}, fetchFn, logger: quietLogger });
    await client.getStatus();
    expect(seen[0].authorization).toBeUndefined();
    const withTok = new TenantServiceClient({ consumer, baseUrl: 'http://127.0.0.1:1', env: { CES_TENANT_AUTH_TOKEN: TOKEN }, fetchFn, logger: quietLogger });
    await withTok.getStatus();
    expect(seen[1].authorization).toBe(`Bearer ${TOKEN}`);
  });
});
