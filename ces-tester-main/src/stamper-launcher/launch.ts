// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as path from 'node:path';
import { runPowershellCommand, type StamperSpawnResult } from './spawn.js';

/**
 * PLAN.md M1 task 4: spawn powershell.exe running Stamper's
 * `translate` + `execute --mode auto`, with `--stacksim` env injection,
 * against the sim tenant identified by `tenantSlug` (the slug this repo's
 * `ces-tenant`-backed registry created via `createEphemeralSimTenant`).
 *
 * `translate --execute` is NOT used (hard-forces DRY_RUN, PHASE0_FINDINGS.md
 * item 4) — this launcher always runs translate then a separate execute.
 *
 * Deviation note (logged in IMPLEMENTATION_LOG.md, M2 pass): M1 built this
 * launcher around a bare `stamper` command name, matching the CLI contract
 * in PLAN.md's Interface Contract Summary, but that name was never actually
 * exercised end-to-end in M1 (its own logged Deviation 1). Live-tested here:
 * `stamper` is NOT on PATH from a plain `powershell.exe` shell — it only
 * resolves inside `npm run` scripts (via npm's own PATH injection) or from
 * this workspace's hoisted root `node_modules/.bin`, which a `cwd =
 * stamperRoot` spawn does not pick up. `ces-stamper/package.json`'s own
 * `bin` field points at `./dist/cli/index.js`, and that file runs directly
 * under `node` (confirmed: `node dist/cli/index.js --version` prints
 * `0.1.0` from a bare shell) — this launcher now invokes Stamper as
 * `node "<stamperRoot>/dist/cli/index.js" <args>` instead of relying on a
 * `stamper` PATH entry, mirroring the same fix already applied to
 * stacksim-client/cli.ts (M1) and muster-driver/dev-server.ts (M2) for
 * their own PATH-resolution gaps.
 *
 * G-TENANT-ADOPT (2026-07-11): this module no longer computes the
 * PSModulePath/Path/STACKSIM_SERVER_URL env bundle itself — the caller
 * (`src/cli/run-m2-command.ts`) obtains it from `ces-tenant`'s
 * `TenantLaunchContextProvider.getSimLaunchEnv()`
 * (`src/tenant-registry/index.ts`) and passes the fully-merged child env in
 * directly, per the goal's Must-NOT: "Do not hand-reconstruct StacksimMode's
 * env-mutation logic inside stamper-launcher."
 */

function stamperCliInvocation(stamperRoot: string): string {
  return `node "${path.join(stamperRoot, 'dist', 'cli', 'index.js')}"`;
}
export interface LaunchStamperOptions {
  stamperRoot: string;
  /** Full child-process env (already merged with the sim launch-context
   * bundle by the caller — see this module's doc comment). */
  env: NodeJS.ProcessEnv;
  missionPlanPath: string;
  manifestPath: string;
  tenantSlug: string;
  /** Output path for the translated Executable Plan JSON. */
  outputPath: string;
  /**
   * Path to a `.env` file supplying `StamperConfig`'s required non-dry-run
   * fields (TENANT_ID/APP_ID/CERT_THUMBPRINT — `StamperConfig.ts:114-123`
   * throws without them). Only consumed by `execute` (`translate`'s action
   * never constructs a `StamperConfig`, so it needs no env file). Passed
   * through as `-e <path>` (`cli/index.ts`'s `-e, --env <path>` option).
   */
  envFilePath?: string;
  /**
   * Working directory for the Stamper child processes. Defaults to
   * `stamperRoot` (legacy behaviour). Flow-through (2026-09-27): plan evidence
   * commands write relative files (e.g. AU.L2-3.3.4's `Export-Csv
   * audit_failure_alerts.csv`), so a cwd inside the sibling repo writes into
   * ces-stamper — callers that own a run workspace pass it here instead.
   */
  workDir?: string;
}

export interface LaunchStamperResult {
  translate: StamperSpawnResult;
  execute: StamperSpawnResult;
}

export async function launchStamperTranslateAndExecute(
  opts: LaunchStamperOptions,
): Promise<LaunchStamperResult> {
  const env = opts.env;

  const stamperCli = stamperCliInvocation(opts.stamperRoot);
  const translateCommand =
    `${stamperCli} translate "${opts.missionPlanPath}" -m "${opts.manifestPath}" ` +
    `--tenant "${opts.tenantSlug}" -o "${opts.outputPath}"`;

  const translate = await runPowershellCommand({
    command: translateCommand,
    cwd: opts.workDir ?? opts.stamperRoot,
    env,
    confirmYes: false,
  });

  if (translate.exitCode !== 0) {
    throw new Error(`stamper translate exited ${translate.exitCode}:\n${translate.stdout}\n${translate.stderr}`);
  }

  const envFlag = opts.envFilePath ? ` -e "${opts.envFilePath}"` : '';
  const executeCommand = `${stamperCli} execute "${opts.outputPath}" --mode auto${envFlag}`;

  const execute = await runPowershellCommand({
    command: executeCommand,
    cwd: opts.workDir ?? opts.stamperRoot,
    env,
    confirmYes: true,
  });

  return { translate, execute };
}
