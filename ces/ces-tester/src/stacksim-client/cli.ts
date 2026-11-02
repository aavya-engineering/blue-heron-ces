// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { writeMaterializedScenario } from './materialize.js';
import type { RunScenarioResult, StacksimSeedBlock } from './types.js';

/**
 * stacksim-findings.md gotcha 1: the CLI is cwd-bound (profiles/ and the
 * tenant root both derive from process.cwd()) — every spawn MUST run with
 * cwd = the tenant-stacksim repo root.
 */
export interface StacksimClientOptions {
  /** Absolute path to the tenant-stacksim repo root (spawn cwd). */
  stacksimRoot: string;
}

function stacksimBinPath(stacksimRoot: string): string {
  return path.join(stacksimRoot, 'bin', 'stacksim.mjs');
}

/** Absolute tenant root stacksim's `scenario` CLI will create/wipe for this scenario+slug. */
export function tenantRootFor(stacksimRoot: string, slug: string): string {
  return path.join(stacksimRoot, '.stacksim', 'tenants', slug);
}

/**
 * Materializes the scenario's stacksim_seed block into scenariosDir, then
 * invokes `stacksim scenario <scenarioId> --scenarios-dir <scenariosDir>`
 * (bare name — gotcha 2; absolute scenariosDir — gotcha 3). This is the
 * only reset/seed path M1 uses (`scenario`, not `seed` — PLAN.md M1 task 2).
 */
export async function runScenario(
  opts: StacksimClientOptions,
  scenariosDir: string,
  scenarioId: string,
  seed: StacksimSeedBlock,
  description?: string,
): Promise<RunScenarioResult> {
  if (!path.isAbsolute(scenariosDir)) {
    throw new Error(`runScenario: scenariosDir must be absolute (got "${scenariosDir}")`);
  }

  await writeMaterializedScenario(scenariosDir, scenarioId, seed, description);

  const bin = stacksimBinPath(opts.stacksimRoot);
  const args = ['scenario', scenarioId, '--scenarios-dir', scenariosDir];

  const { stdout, exitCode } = await spawnAndCapture('node', [bin, ...args], opts.stacksimRoot);

  if (exitCode !== 0) {
    throw new Error(
      `stacksim scenario "${scenarioId}" exited ${exitCode} (cwd=${opts.stacksimRoot}):\n${stdout}`,
    );
  }

  return {
    scenarioId,
    tenantRoot: tenantRootFor(opts.stacksimRoot, scenarioId),
    stdout,
    exitCode,
  };
}

/**
 * REMOVED (docs/goals/G-TENANT-ADOPT.md, 2026-07-11): this module previously
 * exported `initTenant()`, which invoked `stacksim init-tenant <stance>
 * --slug <slug> --plan-data-root <stamperRoot>` to emit
 * `<stamperRoot>/plan-data/<slug>/<slug>.json` directly. The goal's ADDENDUM
 * names this exact path "now-deprecated-for-orchestrated-use" — sim tenant
 * registration is now owned exclusively by `ces-tenant`'s
 * `TenantRegistryLifecycle.createEphemeralSimTenant()`
 * (`src/tenant-registry/index.ts`), consumed from
 * `src/cli/run-m2-command.ts`. stacksim itself still only receives its own
 * scenario/seed inputs via `runScenario()` above (the `scenario` CLI path,
 * unchanged) — it never learns about the registry, per the goal's
 * governing principle.
 */

interface SpawnCaptureResult {
  stdout: string;
  exitCode: number;
}

function spawnAndCapture(command: string, args: string[], cwd: string): Promise<SpawnCaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout: stdout + stderr, exitCode: code ?? 1 });
    });
  });
}
