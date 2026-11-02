// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * harvest.retired.test.ts — FC-MU-3 step 2 (founder decision 2026-09-28 #9):
 * the client-secret harvest routes `GET /api/harvest/consent-url` and
 * `POST /api/harvest/callback` are RETIRED. Device-code
 * (`/api/live/engagements/:id/consent` → `POST /api/harvest/run {live:true}`)
 * is the only live path. Even with every GRAPH_* env var set and a tenant
 * slug supplied, neither route exists any more, and the CLI subcommand that
 * called the first one refuses without making a request.
 *
 * No network beyond 127.0.0.1: the routes are mounted on a local express app.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createHarvestRouter } from '../src/routes/harvest.js';
import { mintToken } from '../src/lib/jwt.js';
import { runMu } from '../src/cli/mu.js';

function bhdToken(): string {
  return mintToken({ sub: 'user-bhd', tenant_id: 'tenant-1', party_id: null, role: 'bhd_operator' });
}

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/harvest', createHarvestRouter());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  vi.unstubAllEnvs();
});

describe('FC-MU-3 step 2 — client-secret harvest routes are retired', () => {
  it('GET /consent-url is gone (404) even with GRAPH_* env fully configured', async () => {
    vi.stubEnv('GRAPH_CLIENT_ID', 'env-client-id');
    vi.stubEnv('GRAPH_CLIENT_SECRET', 'env-secret');
    vi.stubEnv('GRAPH_TENANT_ID', 'env-tenant-id');
    try {
      const res = await fetch(`${base}/api/harvest/consent-url?state=s&redirect_uri=x`, {
        headers: { Authorization: `Bearer ${bhdToken()}` },
      });
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).not.toContain('login.microsoftonline');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('GET /consent-url?tenant_slug= is gone (404)', async () => {
    const res = await fetch(`${base}/api/harvest/consent-url?tenant_slug=acme`, {
      headers: { Authorization: `Bearer ${bhdToken()}` },
    });
    expect(res.status).toBe(404);
  });

  it('POST /callback is gone (404) even with GRAPH_* env fully configured', async () => {
    vi.stubEnv('GRAPH_CLIENT_ID', 'env-client-id');
    vi.stubEnv('GRAPH_CLIENT_SECRET', 'env-secret');
    vi.stubEnv('GRAPH_TENANT_ID', 'env-tenant-id');
    try {
      const res = await fetch(`${base}/api/harvest/callback`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bhdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'auth-code', tenant_slug: 'acme' }),
      });
      expect(res.status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('the device-code live path is still the harvest route: POST /run {live:true} without a gate → 403', async () => {
    const res = await fetch(`${base}/api/harvest/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bhdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ live: true, engagement_id: 'e1', consent_id: 'c1' }),
    });
    expect(res.status).toBe(403);
  });

  it('`mu harvest consent-url` refuses (exit 2) and makes no request', async () => {
    const calls: string[] = [];
    let err = '';
    const code = await runMu(['harvest', 'consent-url', '--tenant-slug', 'acme'], {
      fetchImpl: async (url: string) => {
        calls.push(String(url));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      stdout: { write: () => undefined },
      stderr: { write: (s: string) => void (err += s) },
      env: { MU_TOKEN: bhdToken() },
    });
    expect(code).toBe(2);
    expect(calls).toEqual([]);
    expect(err).toMatch(/retired/i);
  });
});
