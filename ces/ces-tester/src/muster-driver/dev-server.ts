// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { type ChildProcess, spawn, execFile } from 'node:child_process';

/**
 * PLAN.md M2 task 1: launches ces-planner's Vite dev server as a child
 * process. `npm run dev` -> `vite` (`ces-planner/package.json:8`), default
 * port 5173 (no `server.port` override found in `ces-planner/vite.config.ts`
 * — confirmed by direct read and by an independent recon pass).
 *
 * `/api/save-to-stamper` (M2 task 2) only exists under the Vite DEV server
 * (`configureServer`, dev-only per PHASE0_FINDINGS.md item 3) — this is why
 * `npm run dev`, not `npm run preview`, is required here.
 *
 * Deviation note (logged in IMPLEMENTATION_LOG.md): PLAN.md's task 1 says to
 * inject `GRAPH_BASE_URL=http://127.0.0.1:4390/v1.0` into this dev server's
 * env. Direct grep of `ces-planner/src/` and `vite.config.ts` (corroborated
 * by an independent recon agent pass) finds ZERO references to
 * `GRAPH_BASE_URL` anywhere in this repo — that env var is consumed by a
 * different, sibling product (`ces-muster/muster-api/src/lib/graphClient.ts`),
 * not by ces-planner's wizard SPA. ces-planner's wizards never call Graph
 * directly; only Stamper's execution (M1's already-built stamper-launcher)
 * touches stacksim. This module still injects the var into the child env
 * (harmless no-op per the evidence above) so the driver matches PLAN.md's
 * literal instruction, but readiness/behavior does not depend on it.
 */

export interface DevServerHandle {
  process: ChildProcess;
  baseUrl: string;
  stop: () => Promise<void>;
}

export interface StartDevServerOptions {
  /** Absolute path to the ces-planner repo root. */
  plannerRoot: string;
  port?: number;
  /** Injected into the child env; see deviation note above re: GRAPH_BASE_URL. */
  graphBaseUrl?: string;
}

const DEFAULT_PORT = 5173;

/**
 * Deviation note (logged in IMPLEMENTATION_LOG.md): live-tested on this
 * machine, Vite's dev server binds to `::1` (IPv6 loopback) only, not
 * `127.0.0.1`/`0.0.0.0` — confirmed via `Get-NetTCPConnection` showing
 * `LocalAddress ::1` and a direct `127.0.0.1` request failing while the same
 * request to `localhost` succeeds (200). Uses `localhost`, not `127.0.0.1`,
 * for exactly this reason — unlike stacksim's own HTTP server (M1,
 * `127.0.0.1:4390`), which binds to all interfaces and works with the
 * literal IP.
 */
export function devServerBaseUrl(port: number = DEFAULT_PORT): string {
  return `http://localhost:${port}`;
}

/** Spawns `npm run dev` (via powershell.exe, matching this project's
 * Windows-only convention) in ces-planner's repo root. Resolves once the
 * process has spawned; callers must separately readiness-poll the URL
 * (see waitForDevServerReady) because Vite's "ready" stdout message alone is
 * not a reliable HTTP-accepting signal on every run. */
export function startDevServer(opts: StartDevServerOptions): DevServerHandle {
  const port = opts.port ?? DEFAULT_PORT;
  const baseUrl = devServerBaseUrl(port);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.graphBaseUrl) {
    env.GRAPH_BASE_URL = opts.graphBaseUrl;
  }

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `npm run dev -- --port ${port} --strictPort`],
    {
      cwd: opts.plannerRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  const stop = (): Promise<void> => {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.killed) {
        resolve();
        return;
      }
      // Deviation note (logged in IMPLEMENTATION_LOG.md): live-tested,
      // `child.kill()` alone only terminates the top-level powershell.exe
      // process — the actual `npm` -> `node`/vite process tree it spawns
      // keeps running and the dev server port stays bound (confirmed via
      // `Get-NetTCPConnection` showing the port still LISTENing after
      // `child.kill()` returned). `taskkill /T /F` kills the whole process
      // tree rooted at the spawned PID, which is the standard fix for this
      // class of Windows child-process-tree bug.
      child.once('close', () => resolve());
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {
        // taskkill errors (e.g. already exited) are non-fatal — the 'close'
        // listener above resolves the promise either way.
      });
    });
  };

  return { process: child, baseUrl, stop };
}

export class DevServerReadyCheckExhaustedError extends Error {}

/**
 * PLAN.md M2 acceptance gate: "the driver performs its own readiness check
 * that the `npm run dev` instance is up ... not assumed warm." Polls the
 * dev server's root URL with a bounded retry budget; throws (hard failure,
 * not a silent pass) if the budget is exhausted.
 */
export async function waitForDevServerReady(
  baseUrl: string,
  opts: { attempts?: number; intervalMs?: number } = {},
): Promise<void> {
  const attempts = opts.attempts ?? 30;
  const intervalMs = opts.intervalMs ?? 1000;

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(baseUrl, { method: 'GET' });
      if (res.ok || res.status < 500) {
        return;
      }
    } catch {
      // connection refused / not up yet — fall through to retry
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new DevServerReadyCheckExhaustedError(
    `ces-planner dev server at ${baseUrl} did not become ready after ${attempts} attempts (${intervalMs}ms interval)`,
  );
}
