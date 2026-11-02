// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// liveSimSession.ts — GP-DEMO-2: the live-sim DiscoverySession + sim-reachability
// helpers, extracted from tests/discovery.live-sim.test.ts's proven GATE-1 recipe
// (ce1d389) so `mu discovery --sim` can run the IDENTICAL per-command PowerShell
// walk in production, not just in the test. Behavior is unchanged from the test:
// strip every casing of PSModulePath, set it to the sim psmodules only, set
// STACKSIM_SERVER_URL, and prefix each command with
// Import-Module Microsoft.Graph.Authentication -RequiredVersion 2.35.1 -Force +
// Connect-MgGraph — so the walk can NEVER resolve the real Microsoft.Graph
// modules or reach live Graph (FD-LIVE-SMOKE safety, non-negotiable).
//
// This module is NEW (the recipe previously lived only in the test file); it does
// not modify tests/discovery.live-sim.test.ts, which keeps proving the recipe
// independently.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DiscoverySession, DiscoveryExecResult } from './discoveryService.js';

export const SIM_URL = 'http://127.0.0.1:4390';

/** muster-api runs from ces-muster/muster-api; tenant-stacksim is a sibling of
 * ces-muster. Overridable for non-standard layouts. */
export function simRoot(): string {
  // Anchor to THIS module (muster-api/{src|dist}/services -> up 4 = ces/), not
  // process.cwd() — the CLI is spawned from arbitrary cwds (ces-tester's eval
  // leg): a cwd-relative default made every psmodule path wrong there, so all
  // walked commands degraded to unknown. Env override still wins.
  return process.env.STACKSIM_ROOT ?? path.resolve(__dirname, '..', '..', '..', '..', 'tenant-stacksim');
}

export function simPsModules(root: string = simRoot()): string {
  return path.join(root, 'psmodules');
}

/** Infra gate: a real sibling tenant-stacksim checkout with generated modules,
 * on Windows (the sim modules are PowerShell). */
export function simAvailable(root: string = simRoot()): boolean {
  return (
    process.platform === 'win32' &&
    fs.existsSync(path.join(simPsModules(root), 'Microsoft.Graph.Authentication')) &&
    fs.existsSync(path.join(root, 'bin', 'stacksim.mjs'))
  );
}

/**
 * Build the child env with the sim psmodules as the ONLY PSModulePath. Windows
 * env keys are case-insensitive, so `{ ...process.env, PSModulePath: X }` can
 * leave a differently-cased inherited PSModulePath alive — and the REAL
 * Microsoft.Graph modules then win over the sim shim. Strip every casing first,
 * then set the sim path.
 */
function simEnv(psmodules: string, simUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toLowerCase() === 'psmodulepath') continue;
    env[k] = v;
  }
  env.PSModulePath = psmodules;
  env.STACKSIM_SERVER_URL = simUrl;
  return env;
}

/** A real DiscoverySession: run each command through the sim's PowerShell
 * modules, one per-command powershell.exe spawn (thin, no persistent host). */
export function buildLiveSimSession(
  psmodules: string = simPsModules(),
  simUrl: string = SIM_URL
): DiscoverySession {
  return {
    execute(_engine: string, command: string): Promise<DiscoveryExecResult> {
      return new Promise((resolve) => {
        const started = Date.now();
        const script = [
          `$env:STACKSIM_SERVER_URL='${simUrl}'`,
          'Import-Module Microsoft.Graph.Authentication -RequiredVersion 2.35.1 -Force -ErrorAction SilentlyContinue',
          'Connect-MgGraph -ErrorAction SilentlyContinue | Out-Null',
          command,
        ].join('\n');
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          env: simEnv(psmodules, simUrl),
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
}

/** Probe the sim's ledger (POST /ledger). The caller owns seeding + serving —
 * this never boots or resets the sim, it only checks. */
export async function ledgerReachable(simUrl: string = SIM_URL): Promise<boolean> {
  try {
    const res = await fetch(`${simUrl}/ledger`, {
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

/** Query the sim ledger for entries of `type` recorded since `from` (ISO). */
export async function queryLedger(
  simUrl: string,
  type: 'create' | 'mutate',
  from: string
): Promise<unknown[]> {
  const res = await fetch(`${simUrl}/ledger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, from }),
  });
  if (!res.ok) throw new Error(`ledger query failed: HTTP ${res.status}`);
  const { data } = (await res.json()) as { data: unknown[] };
  return data;
}
