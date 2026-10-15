// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// eo-live-sim.test.ts — G-EO-STAB-1 M4: the live-sim assessment smoke.
//
// Boots the REAL EO server as a subprocess against a LIVE tenant-stacksim
// simulator and drives the operator flow end to end:
//   register a sim tenant  ->  GET /api/connect (builds the sim Graph session,
//   real powershell.exe running the shims)  ->  GET /api/assess (SSE; live
//   ComplianceSignalFetcher.fetchAllSignals against the sim + evaluate) ->
//   assert the assessment streams to completion with the live signal leg
//   actually having fetched signals AND evaluated them into real control
//   assessments.
//
// Runs the server OUT-OF-PROCESS (via `tsx src/eo/index.ts`) rather than
// importing createEoServer in-process: the full server drags the docx/blob
// export chain whose ESM/import.meta shape the CommonJS ts-jest transform can't
// load, and — more importantly — a subprocess is the real integration (its own
// Node process, its own inherited sim environment), exactly how EO runs live.
//
// Sim mode: the EO SessionManager (a ces-tenant PersistentSessionFactory) spawns
// its powershell host inheriting the process env, so we inject the sim launch
// env into the child — PSModulePath (sim psmodules + $PSHOME modules) with EVERY
// inherited casing stripped first (else the developer's REAL Microsoft.Graph
// modules shadow the sim shims), Path (azshim first), and STACKSIM_SERVER_URL.
//
// Self-gating: skips cleanly when the sibling tenant-stacksim checkout / its
// generated psmodules / the ces-stamper registry are absent, or off Windows.
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as net from 'node:net';
import * as path from 'node:path';

const EO_ROOT = process.cwd();
const SIM_ROOT = path.resolve(EO_ROOT, '..', 'tenant-stacksim');
const PSMODULES = path.join(SIM_ROOT, 'psmodules');
const STAMPER_REGISTRY = path.resolve(EO_ROOT, '..', 'ces-stamper', 'src', 'registry', 'cmmc-l2-commands.registry.json');
const SIM_URL = 'http://127.0.0.1:4390';
const SLUG = 'eo-sim-smoke';

const SIM_AVAILABLE =
  process.platform === 'win32' &&
  fs.existsSync(path.join(PSMODULES, 'Microsoft.Graph.Authentication')) &&
  fs.existsSync(path.join(SIM_ROOT, 'bin', 'stacksim.mjs')) &&
  fs.existsSync(STAMPER_REGISTRY);

const SIM_TENANT_JSON = {
  kind: 'sim',
  client: { slug: SLUG, name: 'EO Sim Smoke Tenant' },
  tenant: { tenant_id: '00000000-0000-0000-0000-000000000000', domain: 'sim.onmicrosoft.us' },
  auth: {
    app_id: '00000000-0000-0000-0000-000000000000',
    cert_path: 'C:/dummy/sim.pfx',
    cert_thumbprint: '0'.repeat(40),
  },
  endpoints: {
    graph: 'https://graph.microsoft.us',
    login: 'https://login.microsoftonline.us',
    arm: 'https://management.usgovcloudapi.net',
  },
  infrastructure_model: 'm365_azure',
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

function psHomeModules(): Promise<string> {
  return new Promise((resolve) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-Command', 'Write-Output (Join-Path $PSHOME Modules)']);
    let o = '';
    c.stdout.on('data', (d: Buffer) => (o += d.toString('utf8')));
    c.on('close', () => resolve(o.trim()));
    c.on('error', () => resolve(''));
  });
}

async function ledgerReachable(): Promise<boolean> {
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

/** Read an SSE endpoint, collecting `data:` event objects until the stream ends
 * or a stop-type event arrives (or the timeout fires). Never throws. */
async function drainSse(port: number, url: string, stopType: string, timeoutMs: number): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try {
          const obj = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
          events.push(obj);
          if (obj.type === stopType) { clearTimeout(timer); return events; }
        } catch { /* keepalive — ignore */ }
      }
    }
  } catch { /* aborted / stream error — return what we have */ }
  clearTimeout(timer);
  return events;
}

const maybe = SIM_AVAILABLE ? describe : describe.skip;

maybe('G-EO-STAB-1 M4 — EO live-sim assessment smoke', () => {
  let eo: ChildProcess | undefined;
  let simProc: ChildProcess | undefined;
  let bootedSim = false;
  let port = 0;
  let tenantRoot = '';
  let storageRoot = '';

  beforeAll(async () => {
    // 1. Register a sim tenant in a temp registry root (CES_TENANT_ROOT is what
    //    EO's resolveTenantJsonPath honors for ephemeral sim tenants).
    tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-sim-tenants-'));
    fs.mkdirSync(path.join(tenantRoot, 'sim'), { recursive: true });
    fs.writeFileSync(path.join(tenantRoot, 'sim', `${SLUG}.json`), JSON.stringify(SIM_TENANT_JSON, null, 2));
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-sim-storage-'));

    // 2. Boot the sim server (reuse one already up; else own it).
    if (!(await ledgerReachable())) {
      simProc = spawn('node', ['bin/stacksim.mjs', 'serve', 'm365_azure'], { cwd: SIM_ROOT, stdio: 'ignore' });
      bootedSim = true;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !(await ledgerReachable())) await new Promise((r) => setTimeout(r, 500));
      if (!(await ledgerReachable())) throw new Error('stacksim sim server did not come up within 15s');
    }

    // 3. Build the child env: strip EVERY PSModulePath/Path casing (Windows env
    //    keys are case-insensitive; a surviving inherited PSModulePath lets the
    //    real Microsoft.Graph modules shadow the sim shims), then set the sim
    //    launch values + EO config env.
    const psHome = await psHomeModules();
    const childEnv: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      const lk = k.toLowerCase();
      if (lk === 'psmodulepath' || lk === 'path') continue;
      childEnv[k] = v;
    }
    childEnv.PSModulePath = psHome ? `${PSMODULES};${psHome}` : PSMODULES;
    childEnv.Path = `${path.join(SIM_ROOT, 'azshim')};${process.env.Path ?? process.env.PATH ?? ''}`;
    childEnv.STACKSIM_SERVER_URL = SIM_URL;
    childEnv.CES_TENANT_ROOT = tenantRoot;
    childEnv.REGISTRY_PATH = STAMPER_REGISTRY;
    childEnv.STORAGE_ROOT = storageRoot;
    childEnv.TENANT_SLUG = SLUG;

    // 4. Boot the EO server subprocess on a free port; wait for health.
    port = await freePort();
    childEnv.EO_PORT = String(port);
    // Single shell-string form (avoids DEP0190 for args + shell:true); npx
    // resolves the local tsx. Runs source, so no stale dist.
    eo = spawn('npx tsx src/eo/index.ts', { cwd: EO_ROOT, env: childEnv, shell: true, stdio: 'ignore' });

    const deadline = Date.now() + 60000;
    const healthy = async (): Promise<boolean> => {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; }
    };
    while (Date.now() < deadline && !(await healthy())) await new Promise((r) => setTimeout(r, 1000));
    if (!(await healthy())) throw new Error('EO server did not become healthy within 60s');
  }, 90000);

  afterAll(async () => {
    if (eo?.pid) { try { spawnSync('taskkill', ['/pid', String(eo.pid), '/T', '/F'], { shell: true }); } catch { /* ignore */ } }
    if (bootedSim && simProc && !simProc.killed) simProc.kill();
    for (const dir of [tenantRoot, storageRoot]) {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    }
  });

  it('connects a sim tenant Graph session (real powershell.exe against the shims)', async () => {
    const events = await drainSse(port, `/api/connect?tenant=${SLUG}`, 'done', 40000);
    const phases = events.filter((e) => e.type === 'connection_log').map((e) => e.phase);
    expect(phases).toContain('config_loaded');
    expect(phases).toContain('connected_graph'); // the sim shim answered the connect
    expect(phases).not.toContain('error_graph');
    expect(phases).toContain('done');
  }, 60000);

  it('streams a full live-sim assessment: fetches sim signals, evaluates them, completes', async () => {
    // /api/connect above set the server's sessionManager, so assess takes the
    // live signal-fetch path (Phase 4) against the sim.
    const events = await drainSse(port, `/api/assess?tenant=${SLUG}`, 'assess_done', 90000);
    const types = events.map((e) => e.type);

    // Terminal success, no fatal error.
    expect(types).toContain('assess_start');
    expect(types).toContain('assess_done');
    expect(types).not.toContain('assess_error');

    // The LIVE sim leg fetched signals AND evaluated them (both only fire with a
    // connected session). signal_fetch_error must NOT appear — its presence was
    // the normalizePath undefined-endpoint crash this smoke first surfaced.
    expect(types).toContain('signal_fetch');
    expect(types).toContain('signal_eval_done');
    expect(types).not.toContain('signal_fetch_error');

    const fetchEvt = events.find((e) => e.type === 'signal_fetch');
    expect(typeof fetchEvt?.signalCount).toBe('number');
    expect(fetchEvt!.signalCount as number).toBeGreaterThan(0);

    const evalEvt = events.find((e) => e.type === 'signal_eval_done');
    expect((evalEvt?.controlsEvaluated as number) ?? 0).toBeGreaterThan(0);

    // The assessment produced REAL live control assessments (not the 0/110 that
    // the eval crash left behind).
    const summary = events.find((e) => e.type === 'assess_summary');
    expect((summary?.liveAssessmentCount as number) ?? 0).toBeGreaterThan(0);
  }, 120000);
});
