// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// eo-live-sim-coverage.test.ts — FC-EO-H (2026-09-28): confirm the six automatic-signal-coverage
// reads (FC-EO-D, EO-03) actually work end to end against the LIVE tenant-stacksim simulator,
// closing REQ-tenant-stacksim-{training-user-coverage, users, security-incidents,
// lifecycle-workflows, run-hunting-query, vpn-device-configurations}.md now that tenant-stacksim
// commit 05532d0 serves them.
//
// Same boot pattern as eo-live-sim.test.ts (real EO server subprocess, real powershell.exe
// against the sim shims) — see that file's header for why out-of-process. This file drives
// /api/connect then the on-demand `POST /api/evidence-explorer/signal` route (methodMap entry
// 'coverageSignals', added by this same session) plus the existing 'deviceConfigurations' entry,
// and asserts each of the seven expected signal ids comes back `status: 'success'` with non-empty
// data — the literal acceptance criterion each REQ states ("a `success` signal `<name>` with
// non-empty data"), rather than inferring it from an /api/assess count.
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
const SLUG = 'eo-sim-coverage';

const SIM_AVAILABLE =
  process.platform === 'win32' &&
  fs.existsSync(path.join(PSMODULES, 'Microsoft.Graph.Authentication')) &&
  fs.existsSync(path.join(SIM_ROOT, 'bin', 'stacksim.mjs')) &&
  fs.existsSync(STAMPER_REGISTRY);

const SIM_TENANT_JSON = {
  kind: 'sim',
  client: { slug: SLUG, name: 'EO Sim Coverage Tenant' },
  tenant: { tenant_id: '00000000-0000-0000-0000-000000000001', domain: 'sim.onmicrosoft.us' },
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

maybe('FC-EO-H — EO live-sim automatic-signal-coverage smoke', () => {
  let eo: ChildProcess | undefined;
  let simProc: ChildProcess | undefined;
  let bootedSim = false;
  let port = 0;
  let tenantRoot = '';
  let storageRoot = '';

  beforeAll(async () => {
    tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-sim-cov-tenants-'));
    fs.mkdirSync(path.join(tenantRoot, 'sim'), { recursive: true });
    fs.writeFileSync(path.join(tenantRoot, 'sim', `${SLUG}.json`), JSON.stringify(SIM_TENANT_JSON, null, 2));
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-sim-cov-storage-'));

    // Reuse an already-running sim (ground rule: never restart it); own one only if none is up.
    if (!(await ledgerReachable())) {
      simProc = spawn('node', ['bin/stacksim.mjs', 'serve', 'm365_azure'], { cwd: SIM_ROOT, stdio: 'ignore' });
      bootedSim = true;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !(await ledgerReachable())) await new Promise((r) => setTimeout(r, 500));
      if (!(await ledgerReachable())) throw new Error('stacksim sim server did not come up within 15s');
    }

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

    port = await freePort();
    childEnv.EO_PORT = String(port);
    eo = spawn('npx tsx src/eo/index.ts', { cwd: EO_ROOT, env: childEnv, shell: true, stdio: 'ignore' });

    const deadline = Date.now() + 60000;
    const healthy = async (): Promise<boolean> => {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; }
    };
    while (Date.now() < deadline && !(await healthy())) await new Promise((r) => setTimeout(r, 1000));
    if (!(await healthy())) throw new Error('EO server did not become healthy within 60s');

    // Connect once for every test in this file.
    const events = await drainSse(port, `/api/connect?tenant=${SLUG}`, 'done', 40000);
    const phases = events.filter((e) => e.type === 'connection_log').map((e) => e.phase);
    if (!phases.includes('connected_graph')) throw new Error(`sim connect failed: phases=${JSON.stringify(phases)}`);
  }, 90000);

  afterAll(async () => {
    if (eo?.pid) { try { spawnSync('taskkill', ['/pid', String(eo.pid), '/T', '/F'], { shell: true }); } catch { /* ignore */ } }
    if (bootedSim && simProc && !simProc.killed) simProc.kill();
    for (const dir of [tenantRoot, storageRoot]) {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    }
  });

  async function fetchSignal(signalId: string): Promise<{ signalResults: Array<{ signalId: string; status: string; rawData: unknown }> }> {
    const res = await fetch(`http://127.0.0.1:${port}/api/evidence-explorer/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: SLUG, signalId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`${signalId} -> HTTP ${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ signalResults: Array<{ signalId: string; status: string; rawData: unknown }> }>;
  }

  it('coverageSignals: all five multi-endpoint reads succeed against the sim with non-empty data', async () => {
    const body = await fetchSignal('coverageSignals');
    const byId = new Map(body.signalResults.map((s) => [s.signalId, s]));
    // REQ-tenant-stacksim-{training-user-coverage,users,security-incidents,lifecycle-workflows,
    // run-hunting-query}.md — each REQ's acceptance criterion, checked directly.
    for (const id of ['trainingUserCoverage', 'directoryUsers', 'securityIncidents', 'lifecycleWorkflows', 'roleAssignmentsAll', 'managedDevicesAll', 'tvmAssessmentRecency']) {
      const s = byId.get(id);
      expect(s).toBeDefined();
      expect(s!.status).toBe('success');
      expect(s!.rawData).not.toBeNull();
      const items = Array.isArray((s!.rawData as any)?.value) ? (s!.rawData as any).value
        : Array.isArray((s!.rawData as any)?.results) ? (s!.rawData as any).results
          : (s!.rawData as any);
      expect(Array.isArray(items) ? items.length : Object.keys(items ?? {}).length).toBeGreaterThan(0);
    }
  }, 60000);

  it('deviceConfigurations: seeded VPN profile is present with enableSplitTunneling — REQ-tenant-stacksim-vpn-device-configurations', async () => {
    const body = await fetchSignal('deviceConfigurations');
    const s = body.signalResults.find((r) => r.signalId === 'deviceConfigurations');
    expect(s).toBeDefined();
    expect(s!.status).toBe('success');
    const raw = s!.rawData as any;
    const items: any[] = Array.isArray(raw) ? raw : (raw?.value ?? []);
    expect(items.length).toBeGreaterThan(0);
    const vpnProfiles = items.filter((d) => {
      const odataType = d?.['@odata.type'] ?? d?.AdditionalProperties?.['@odata.type'] ?? '';
      return typeof odataType === 'string' && /VpnConfiguration/i.test(odataType);
    });
    expect(vpnProfiles.length).toBeGreaterThan(0);
    const hasSplitTunnelField = vpnProfiles.some((v) =>
      'enableSplitTunneling' in v || 'enableSplitTunneling' in (v.AdditionalProperties ?? {}));
    expect(hasSplitTunnelField).toBe(true);
  }, 60000);
});
