// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W4-MU2 (MU-02) acceptance: "Run discovery" runs the real executor.
//
// 1. The SPA's production client (src/features/discovery/discoveryRunService.ts)
//    against the production discovery router: the rows the SPA gets are the
//    rows the executor produced from the session it walked — proven with a
//    session whose output differs from the canned fixture — not
//    DISCOVERY_RESULTS_FIXTURE.
// 2. Failure is honest: sim down -> the client reports it, no rows.
// 3. Route guards: auth, role, slug.
// 4. Live stacksim (self-booting, infra-gated like discovery.cli.live-sim):
//    the production run (real registry slice, real sim session) through the
//    route and the SPA client.
import { describe, test, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import { createDiscoveryRouter } from '../src/routes/discovery.js';
import { mintToken } from '../src/lib/jwt.js';
import { loadRegistryGetEntries } from '../src/services/discoveryWiring.js';
import { simAvailable, SIM_URL } from '../src/services/liveSimSession.js';
import type { DiscoverySession, RegistryGetEntry } from '../src/services/discoveryService.js';
import type { SimDiscoveryDeps } from '../src/services/simDiscoveryRun.js';
import { runDiscoveryOnApi } from '@/features/discovery/discoveryRunService';
import { DISCOVERY_RESULTS_FIXTURE } from '@/__fixtures__/discoveryResults';

const OPERATOR = mintToken({ sub: 'op', tenant_id: 't-1', party_id: null, role: 'bhd_operator' });
const SUB = mintToken({ sub: 'sub', tenant_id: 't-1', party_id: 'p-1', role: 'sub' });

// A registry slice and a session that answers ONE of them: a met-able control
// the fixture does not carry with 'high' confidence.
const ENTRIES: RegistryGetEntry[] = [
  { entry_id: 'w4.users', control_ids: ['AC.L2-3.1.5'], engine: 'mgraph', get_command: 'Get-MgUser' },
  { entry_id: 'w4.groups', control_ids: ['AC.L2-3.1.6'], engine: 'mgraph', get_command: 'Get-MgGroup' },
];
const session: DiscoverySession = {
  async execute(_engine, command) {
    return command === 'Get-MgUser'
      ? { stdout: 'id displayName\n1 user', stderr: '', exitCode: 0, durationMs: 1 }
      : { stdout: '', stderr: '', exitCode: 0, durationMs: 1 };
  },
};

const store = new Map<string, string>();
const servers: http.Server[] = [];
let workRoot: string;

function serve(runDeps: SimDiscoveryDeps): string {
  const app = express();
  app.use(express.json());
  app.use('/api/discovery', createDiscoveryRouter({ runDeps, workRoot }));
  const s = app.listen(0);
  servers.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}/api`;
}

const hermeticDeps: SimDiscoveryDeps = {
  probeLedger: async () => true,
  loadEntries: () => ENTRIES,
  session,
  assertZeroWrites: async () => ({ ok: true }),
  registryRoot: '/no/registry/for/hermetic/test',
};

beforeAll(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-mu2-discovery-'));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  store.set('muster-jwt', OPERATOR);
});

afterAll(() => {
  for (const s of servers) s.close();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  fs.rmSync(workRoot, { recursive: true, force: true });
});

const fastPoll = { pollIntervalMs: 10, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

describe('W4-MU2 MU-02: SPA Run discovery → muster-api run job → executor', () => {
  test('the SPA receives the rows the executor derived from the walked session, not the canned fixture', async () => {
    store.set('muster-api-url', serve(hermeticDeps));
    const o = await runDiscoveryOnApi({ tenantSlug: 'w4-hermetic', ...fastPoll });
    if (!o.ok) console.error(o.message);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const byControl = new Map(o.results.map((r) => [r.control_id, r.confidence]));
    expect(byControl.get('AC.L2-3.1.5')).toBe('high'); // Get-MgUser returned rows
    expect(byControl.get('AC.L2-3.1.6')).toBe('low'); // empty read
    expect(o.results).not.toEqual(DISCOVERY_RESULTS_FIXTURE.map((r) => ({ ...r })));
    expect(o.results.length).toBe(2);
    // Captures landed under the job's work dir (real fileCaptureSink).
    const jobDirs = fs.readdirSync(workRoot);
    expect(jobDirs.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(workRoot, jobDirs[0], 'captures', 'w4.users.txt'))).toBe(true);
  });

  test('sim down: the run fails honestly and returns no rows', async () => {
    store.set('muster-api-url', serve({ ...hermeticDeps, probeLedger: async () => false }));
    const o = await runDiscoveryOnApi(fastPoll);
    expect(o.ok).toBe(false);
    if (o.ok) return;
    expect(o.message).toContain('not reachable');
    expect(o.message).toContain('127.0.0.1:4390');
  });

  test('a ledger write during the walk fails the run (read-only guarantee)', async () => {
    store.set(
      'muster-api-url',
      serve({ ...hermeticDeps, assertZeroWrites: async () => ({ ok: false, offenders: [{ type: 'create' }] }) })
    );
    const o = await runDiscoveryOnApi(fastPoll);
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.message).toContain('READ-ONLY guarantee violated');
  });

  test('guards: 401 without a token, 403 for sub, 400 for a bad slug, 404 for an unknown job', async () => {
    const base = serve(hermeticDeps);
    const post = (token: string | null, body: unknown) =>
      fetch(`${base}/discovery/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    expect((await post(null, {})).status).toBe(401);
    expect((await post(SUB, {})).status).toBe(403);
    expect((await post(OPERATOR, { tenant_slug: '../etc' })).status).toBe(400);
    const unknown = await fetch(`${base}/discovery/run/nope`, { headers: { Authorization: `Bearer ${OPERATOR}` } });
    expect(unknown.status).toBe(404);
  });
});

// ── Live stacksim: the production run through the route and the SPA client ──
async function ledgerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SIM_URL}/ledger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe.skipIf(!simAvailable())('W4-MU2 MU-02: live stacksim run via the route', () => {
  let sim: ChildProcess | undefined;

  beforeAll(async () => {
    if (await ledgerUp()) return; // reuse a running sim, don't own it
    sim = spawn('node', ['bin/stacksim.mjs', 'serve', 'm365_azure'], {
      cwd: path.resolve(process.cwd(), '..', '..', 'tenant-stacksim'),
      stdio: 'ignore',
    });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await ledgerUp()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('stacksim did not come up within 20s');
  }, 30000);

  afterAll(() => {
    sim?.kill();
  });

  it('a bounded real-registry walk over the real sim session reaches the SPA as parsed rows', async () => {
    // Production session + probe + zero-writes ledger check; only the registry
    // is bounded (same deterministic slice as discovery.cli.live-sim) for speed.
    const slice = loadRegistryGetEntries()
      .filter(
        (e) =>
          e.engine === 'mgraph' &&
          !!e.get_command &&
          !/\{[a-zA-Z]/.test(e.get_command) &&
          !e.get_command.includes('$') &&
          /^Get-Mg/.test(e.get_command.trim())
      )
      .slice(0, 3);
    store.set('muster-api-url', serve({ loadEntries: () => slice }));
    const o = await runDiscoveryOnApi({ tenantSlug: 'stacksim-local', pollIntervalMs: 500 });
    if (!o.ok) console.error(o.message);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    const sliceControls = new Set(slice.flatMap((e) => e.control_ids));
    expect(o.results.length).toBeGreaterThan(0);
    for (const r of o.results) expect(sliceControls.has(r.control_id)).toBe(true);
    // At least one command returned real sim data.
    expect(o.results.some((r) => r.confidence === 'high')).toBe(true);
  }, 120000);
});
