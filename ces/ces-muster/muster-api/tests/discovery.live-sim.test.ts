// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discovery.live-sim.test.ts — G-MUSTER-DISCOVERY-1 GATE 1: the executor walks a
// bounded set of real registry get_commands against a LIVE tenant-stacksim sim
// server and produces schema-valid observations from real sim output.
//
// This is the integration counterpart to discovery.test.ts (which proves the
// engine with a mock session). Here the DiscoverySession is REAL: each command
// is run through powershell.exe with the sim psmodules on PSModulePath and the
// sim server URL in the environment — the same resolution path the production
// StacksimEnvironment sets up, minus the persistent-host lifecycle (a thin
// per-command spawn is enough to prove the executor consumes real sim output).
//
// Self-booting + infra-gated: it starts `stacksim serve m365_azure`, waits for
// the ledger to answer, runs, and tears the server down. When the sibling
// tenant-stacksim checkout or its generated psmodules are absent (CI without the
// sim), the whole suite skips — the discovery.test.ts unit gate still runs.
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv from 'ajv';
import {
  runDiscovery,
  type DiscoverySession,
  type DiscoveryExecResult,
  type CaptureSink,
  type RegistryGetEntry,
} from '../src/services/discoveryService.js';
import { loadRegistryGetEntries } from '../src/services/discoveryWiring.js';

const SIM_ROOT = path.resolve(process.cwd(), '..', '..', 'tenant-stacksim');
const PSMODULES = path.join(SIM_ROOT, 'psmodules');
const SIM_URL = 'http://127.0.0.1:4390';

// Infra gate: the sim must be a real sibling checkout with generated modules, on
// Windows (the sim modules are PowerShell). Otherwise skip cleanly.
const SIM_AVAILABLE =
  process.platform === 'win32' &&
  fs.existsSync(path.join(PSMODULES, 'Microsoft.Graph.Authentication')) &&
  fs.existsSync(path.join(SIM_ROOT, 'bin', 'stacksim.mjs'));

const memoryCapture: CaptureSink = {
  write: (entryId: string) => `captures/${entryId}.json`,
};

/**
 * Build the child env with the sim psmodules as the ONLY PSModulePath. Windows
 * env keys are case-insensitive, so `{ ...process.env, PSModulePath: X }` can
 * leave a differently-cased inherited PSModulePath alive — and the REAL
 * Microsoft.Graph modules then win over the sim shim. Strip every casing first
 * (the same guard StacksimEnvironment.deleteEnvKeyCaseInsensitive applies), then
 * set the sim path. This is why the leak only showed under the test runner,
 * whose worker env carries the developer's real module path.
 */
function simEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toLowerCase() === 'psmodulepath') continue;
    env[k] = v;
  }
  env.PSModulePath = PSMODULES;
  env.STACKSIM_SERVER_URL = SIM_URL;
  return env;
}

/** A real DiscoverySession: run each command through the sim's PowerShell modules. */
const simSession: DiscoverySession = {
  execute(_engine: string, command: string): Promise<DiscoveryExecResult> {
    return new Promise((resolve) => {
      const started = Date.now();
      const script = [
        `$env:STACKSIM_SERVER_URL='${SIM_URL}'`,
        'Import-Module Microsoft.Graph.Authentication -RequiredVersion 2.35.1 -Force -ErrorAction SilentlyContinue',
        'Connect-MgGraph -ErrorAction SilentlyContinue | Out-Null',
        command,
      ].join('\n');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: simEnv(),
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      child.on('close', (code) =>
        resolve({ stdout, stderr, exitCode: code ?? 0, durationMs: Date.now() - started })
      );
      child.on('error', () =>
        resolve({ stdout: '', stderr: 'spawn error', exitCode: 1, durationMs: Date.now() - started })
      );
    });
  },
};

/**
 * A bounded, deterministic subset of the real registry: graph-engine,
 * placeholder-free, single-cmdlet `Get-Mg*` gets (no `$` multi-statement logic
 * that would need tenant-context substitution). These resolve cleanly against
 * the sim modules — a hit returns data (posture met), a `-Filter` miss reads
 * empty (posture unknown), and neither degrades. Ordered by the registry so
 * `AC.L2-3.1.6.admin-account` (Get-MgUser Admin-, which returns a row) is in the
 * first few — giving at least one MET observation from real sim data.
 */
function boundedGraphGets(n: number): RegistryGetEntry[] {
  return loadRegistryGetEntries()
    .filter(
      (e) =>
        e.engine === 'mgraph' &&
        !!e.get_command &&
        !/\{[a-zA-Z]/.test(e.get_command) &&
        !e.get_command.includes('$') &&
        /^Get-Mg/.test(e.get_command.trim())
    )
    .slice(0, n);
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

describe.skipIf(!SIM_AVAILABLE)('DISCOVERY-1 GATE 1 — executor over a LIVE stacksim sim', () => {
  let server: ChildProcess | undefined;
  let bootedHere = false;

  beforeAll(async () => {
    if (await ledgerReachable()) return; // a server is already up — use it, don't own it.
    server = spawn('node', ['bin/stacksim.mjs', 'serve', 'm365_azure'], {
      cwd: SIM_ROOT,
      stdio: 'ignore',
    });
    bootedHere = true;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await ledgerReachable()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('stacksim sim server did not come up within 15s');
  }, 30000);

  afterAll(() => {
    if (bootedHere && server && !server.killed) server.kill();
  });

  it('walks real graph get_commands and derives observations from live sim output', async () => {
    const bounded = boundedGraphGets(5);
    expect(bounded.length).toBeGreaterThan(0);

    const { observations, stats } = await runDiscovery(bounded, simSession, memoryCapture);

    // The walk ran the gets and produced an observation per covered control.
    expect(stats.ran).toBe(bounded.length);
    expect(observations.length).toBeGreaterThanOrEqual(bounded.length);

    // Real reads happened — not everything degraded (that would mean the modules
    // never resolved / the server never answered).
    expect(stats.degraded).toBeLessThan(stats.ran);

    // At least one control observed as MET from real sim data (e.g. the Admin-
    // user query returns a row), carrying a capture ref (never inline output).
    const met = observations.filter((o) => o.derived_posture === 'met');
    expect(met.length).toBeGreaterThan(0);
    expect(met[0].raw_capture_ref).toMatch(/^captures\//);
    expect(met[0]).not.toHaveProperty('raw_output');
  }, 60000);

  it('GATE 5 zero-writes: the walk leaves no create/mutate entries in the sim ledger', async () => {
    // The ledger is the sim's authoritative write record (ledger.jsonl behind
    // POST /ledger). A read-only walk must add NOTHING of type create/mutate.
    const from = new Date().toISOString();

    const bounded = boundedGraphGets(3);
    const { stats } = await runDiscovery(bounded, simSession, memoryCapture);
    expect(stats.ran).toBe(bounded.length); // the walk really executed

    for (const type of ['create', 'mutate'] as const) {
      const res = await fetch(`${SIM_URL}/ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, from }),
      });
      expect(res.ok).toBe(true);
      // The query surface wraps results: { data: LedgerEntry[] }.
      const { data: entries } = (await res.json()) as { data: unknown[] };
      if (entries.length > 0) {
        console.error(`unexpected ${type} ledger entries from the walk:`, entries);
      }
      expect(entries).toEqual([]);
    }
  }, 60000);

  it('every emitted observation validates against the readiness-result.v1 observation schema', async () => {
    const schemaPath = path.resolve('..', 'public', 'schemas', 'readiness-result.schema.json');
    const full = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const validate = new Ajv({ strict: true }).compile(full.properties.observations.items);

    const bounded = boundedGraphGets(3);
    const { observations } = await runDiscovery(bounded, simSession, memoryCapture);

    for (const obs of observations) {
      const ok = validate(obs);
      if (!ok) console.error(obs.control_id, validate.errors);
      expect(ok).toBe(true);
    }
  }, 60000);
});
