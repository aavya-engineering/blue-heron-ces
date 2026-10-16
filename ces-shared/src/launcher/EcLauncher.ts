// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EcLauncher — auto-start the Evidence Collector (EC) module server for a caller (e.g. ces-stamper's
// GuiServer) that wants it running without the operator starting it by hand.
//
// FC-SH step 4 (REQ-ces-shared-ec-launcher, ces-ec plan M4b, 2026-09-28):
//   - The hardcoded spawn target (`src/ec/index.ts`) never existed in ces-ec; the real entry is
//     `npx tsx src/index.ts` run with cwd = the ces-ec module root (a sibling of the caller's own
//     module root). Both command and cwd are now configurable instead of hardcoded.
//   - Auto-start is now explicit opt-in: a caller that does not set CES_EC_AUTOSTART=1 gets a health
//     check only — it will use EC if already running, but will never spawn a background process on
//     the operator's behalf without that flag. (Founder decision set, feature-completion round 2.)
//
// Callers, adopt: set CES_EC_AUTOSTART=1 in the environment to keep prior "always try to spawn"
// behavior; otherwise ensureEcRunning() becomes health-check-only.

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'child_process';
import http from 'http';

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
export type HealthCheckFn = (ecUrl: string, timeoutMs?: number) => Promise<boolean>;
export type SleepFn = (ms: number) => Promise<void>;

export interface EnsureEcRunningOptions {
  /** EC health-check base URL. Default 'http://localhost:4001'. */
  ecUrl?: string;
  /**
   * EC module working directory. Precedence: this field, then `env.CES_EC_CWD`, then
   * `../ces-ec` resolved relative to `process.cwd()` (the caller's module root).
   */
  cwd?: string;
  /** Spawn command. Default 'npx'. */
  command?: string;
  /** Spawn args. Default ['tsx', 'src/index.ts'] — the real ces-ec entry point. */
  args?: string[];
  /** Environment consulted for CES_EC_CWD / CES_EC_AUTOSTART and passed to the spawned process. Default process.env. */
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests — never touches the network or spawns a process when supplied. */
  spawnFn?: SpawnFn;
  healthCheckFn?: HealthCheckFn;
  sleepFn?: SleepFn;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export type EnsureEcRunningResult =
  | 'already_running'
  | 'started'
  | 'autostart_disabled'
  | 'failed';

let spawning = false;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultHealthCheck(ecUrl: string, timeoutMs: number = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL('/api/health', ecUrl);
    const req = http.get(url.href, { timeout: timeoutMs }, (res) => {
      const ok = !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
      res.resume();
      resolve(ok);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolveCwd(opts: EnsureEcRunningOptions, env: NodeJS.ProcessEnv): string {
  if (opts.cwd) return opts.cwd;
  if (env.CES_EC_CWD) return env.CES_EC_CWD;
  // A plain forward-slash join; Node/npm/npx all accept forward slashes in cwd on Windows too, and
  // this avoids pulling in node:path for a single string.
  return `${process.cwd()}/../ces-ec`;
}

/**
 * Ensure EC is reachable. Always health-checks first (works whether or not autostart is enabled).
 * Spawns EC only when it is unhealthy AND `env.CES_EC_AUTOSTART === '1'`.
 *
 * Backward-compatible: `ensureEcRunning(ecUrl, ecCwd)` (both optional strings) is still accepted; it
 * is equivalent to `ensureEcRunning({ ecUrl, cwd: ecCwd })`. Existing callers that `await` the
 * promise without inspecting its value are unaffected by the new resolved type.
 */
export async function ensureEcRunning(
  ecUrlOrOptions?: string | EnsureEcRunningOptions,
  ecCwd?: string,
): Promise<EnsureEcRunningResult> {
  const opts: EnsureEcRunningOptions =
    typeof ecUrlOrOptions === 'string' || ecUrlOrOptions === undefined
      ? { ecUrl: ecUrlOrOptions, cwd: ecCwd }
      : ecUrlOrOptions;

  const env = opts.env ?? process.env;
  const ecUrl = opts.ecUrl ?? 'http://localhost:4001';
  const cwd = resolveCwd(opts, env);
  const command = opts.command ?? 'npx';
  const args = opts.args ?? ['tsx', 'src/index.ts'];
  const spawnImpl = opts.spawnFn ?? nodeSpawn;
  const healthCheck = opts.healthCheckFn ?? defaultHealthCheck;
  const sleep = opts.sleepFn ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 10;
  const baseDelay = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 2500;
  const port = new URL(ecUrl).port || (new URL(ecUrl).protocol === 'https:' ? '443' : '80');

  const alreadyRunning = await healthCheck(ecUrl, 2000);
  if (alreadyRunning) {
    console.log(`  EC already running on :${port}`);
    return 'already_running';
  }

  if (env.CES_EC_AUTOSTART !== '1') {
    console.log('  EC not running and CES_EC_AUTOSTART is not set to 1 — skipping auto-start');
    return 'autostart_disabled';
  }

  // Spawn lock — prevent double-spawning from concurrent calls in this process.
  if (spawning) {
    return 'autostart_disabled';
  }
  spawning = true;

  try {
    console.log(`  Spawning EC (${command} ${args.join(' ')}) in ${cwd}...`);
    // The child gets process.env (PATH, etc.) PLUS the caller's overrides — `env` above is consulted
    // for flags (CES_EC_CWD/CES_EC_AUTOSTART) but is not itself a full environment: a caller that
    // opts in with `{ env: { CES_EC_AUTOSTART: '1' } }` alone must not spawn a child with no PATH.
    const childEnv = opts.env ? { ...process.env, ...env } : env;
    const child = spawnImpl(command, args, { detached: true, stdio: 'ignore', env: childEnv, cwd, shell: true });
    child.unref();

    for (let i = 0; i < maxRetries; i++) {
      const delay = Math.min(baseDelay + i * 500, maxDelay);
      await sleep(delay);

      const healthy = await healthCheck(ecUrl, 2000);
      if (healthy) {
        console.log(`  EC auto-started on :${port}`);
        return 'started';
      }
    }

    console.warn('  EC failed to start — continuing without EC');
    return 'failed';
  } finally {
    spawning = false;
  }
}
