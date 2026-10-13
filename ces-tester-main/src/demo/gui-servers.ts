// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M3 — spawn/stop helpers for the two GUI servers the all-Playwright
 * mandate drives: `stamper gui --port 3000` and `ao gui --port 3001`.
 *
 * This is INVISIBLE SETUP, not a demo surface — the founder's carve-out covers
 * arming a server before Playwright drives it from the user's perspective.
 *
 * Four things here are load-bearing, all measured in the M0 spike
 * (docs/context/IMPLEMENTATION_LOG.md, "GP-DEMO-3 — M0 Drivability Spike"):
 *
 * 1. **Sim mode is three inherited env vars** (finding #7). Neither GUI's spawn
 *    site passes an `env` option to its PowerShell children, so whatever we set
 *    here is inherited all the way down. That is what makes an all-GUI demo
 *    reach tenant-stacksim with no in-frame CLI.
 *
 * 2. **The FD-5 shim is APPENDED after the merge, never before.**
 *    `mergeSimLaunchEnv` REPLACES `PSModulePath` wholesale, so a shim appended
 *    to the base env is silently discarded. Appending afterwards also keeps the
 *    sim's own shims first, so tenant-stacksim wins every name collision and
 *    only the missing `Microsoft.Graph` rollup is filled in. (`stamper gui
 *    --stacksim` is NOT usable for arming: it calls `enableStacksimMode`, which
 *    replaces `PSModulePath` and clobbers the shim.)
 *
 * 3. **cwd must be the module's own root** or the server serves 404s, and
 *    `CES_PIPELINE_ROOT` must be run-scoped — its default `C:\CES_Pipeline` is
 *    shared global state and the AO evidence assertions must never run against
 *    the global `ces.db`.
 *
 * 4. **`CES_AO_AUTH_TOKEN` must be absent** or AO stops trusting loopback
 *    without a header (`AoServer.ts:99`). Windows env keys are case-insensitive,
 *    so it is deleted in every casing.
 *
 * Cert handling: the sim cert reaches `AuthChain` through an ABSOLUTE
 * `auth.cert_path` in the registry record (`sim-tenant-record.ts`), not through
 * finding #5's relative `sim/<slug>.pfx` placeholder. The placeholder would
 * have to be written relative to the GUI server's cwd — i.e. INSIDE ces-stamper
 * or ces-ao — which the write boundary forbids; M0 proved the absolute path
 * works and never needed the placeholder.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SimLaunchEnv } from 'ces-tenant';
import { mergeSimLaunchEnv } from '../stamper-launcher/env.js';

export type GuiServerKind = 'stamper' | 'ao';

/** FD-2 port assignment: both GUIs default to 3000, so AO is moved to 3001. */
export const STAMPER_GUI_PORT = 3000;
export const AO_GUI_PORT = 3001;

export const DEFAULT_GUI_PORT: Readonly<Record<GuiServerKind, number>> = {
  stamper: STAMPER_GUI_PORT,
  ao: AO_GUI_PORT,
};

/** Readiness probe per server — a real API route, not the SPA shell (M0-verified). */
export const GUI_READY_PATH: Readonly<Record<GuiServerKind, string>> = {
  stamper: '/api/tenants',
  ao: '/api/commands',
};

function deleteKeyCaseInsensitive(env: NodeJS.ProcessEnv, name: string): void {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === name.toLowerCase()) delete env[key];
  }
}

export interface GuiChildEnvOptions {
  /** From `getSimLaunchEnv(registry, slug, ...)` — the three sim vars. */
  readonly simLaunchEnv: SimLaunchEnv;
  /** ces-tester's `assets/psmodules-shim` directory (FD-5 Option B). */
  readonly shimRoot: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
  /** Run-scoped registry root holding `sim/<slug>.json`. */
  readonly tenantRoot?: string;
  /** Run-scoped `CES_PIPELINE_ROOT` — where `ces.db` and Stamper's plan-data land. */
  readonly pipelineRoot?: string;
  /** Run-scoped Stamper `STORAGE_ROOT` (execution reports, state). */
  readonly storageRoot?: string;
}

/**
 * Build the child env for a GUI server. Pure — takes the base env and the
 * resolved roots, returns a new env object. Ordering is the whole point: merge
 * first (which replaces `PSModulePath`), THEN append the shim.
 */
export function buildGuiChildEnv(opts: GuiChildEnvOptions): NodeJS.ProcessEnv {
  const env = mergeSimLaunchEnv({ simLaunchEnv: opts.simLaunchEnv, baseEnv: opts.baseEnv });

  // FD-5 Option B — APPEND, never replace: the sim's shims stay first and keep
  // winning every collision; the stub rollup only fills the Microsoft.Graph gap.
  env.PSModulePath = `${env.PSModulePath ?? ''};${opts.shimRoot}`;

  if (opts.tenantRoot) env.CES_TENANT_ROOT = opts.tenantRoot;
  if (opts.pipelineRoot) env.CES_PIPELINE_ROOT = opts.pipelineRoot;
  if (opts.storageRoot) env.STORAGE_ROOT = opts.storageRoot;

  // AoServer.ts:99 — loopback is trusted only when no token is configured.
  deleteKeyCaseInsensitive(env, 'CES_AO_AUTH_TOKEN');

  // WS2 pre-set (GP-DEMO-6, REQ-SIBLING-NO-OPEN): ces-ao (`AoServer.openBrowser`)
  // and ces-stamper (`GuiServer.ts:416`) call the npm `open()` package
  // unconditionally, so a stray browser window pops beside Playwright's. Neither
  // sibling gates it today, so this is INERT — but the moment they honour the flag
  // (the filed requirement) the suppression self-activates with zero further
  // change here. Both spellings are set: a `CES_NO_OPEN` gate and the de-facto
  // `BROWSER=none` convention.
  env.CES_NO_OPEN = '1';
  env.BROWSER = 'none';

  return env;
}

/** `<moduleRoot>/dist/cli/index.js` — both modules expose `gui --port <n>` there. */
export function guiCliEntry(moduleRoot: string): string {
  return path.join(moduleRoot, 'dist', 'cli', 'index.js');
}

/** Polls `url` until it answers 2xx, or rejects on timeout. */
export async function waitForHttpOk(url: string, timeoutMs = 90000, intervalMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() >= deadline) throw new Error(`GUI server never became ready at ${url} (${timeoutMs}ms)`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface GuiServerHandle {
  readonly kind: GuiServerKind;
  readonly port: number;
  readonly baseUrl: string;
  readonly process: ChildProcess;
  stop: () => Promise<void>;
}

export interface StartGuiServerOptions {
  readonly kind: GuiServerKind;
  /** ces-stamper / ces-ao checkout root — also the spawn cwd (404s otherwise). */
  readonly moduleRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly port?: number;
  /** Full stdout+stderr is appended here — the server log is evidence, not inference. */
  readonly logPath?: string;
  readonly readyTimeoutMs?: number;
}

/** Kill the whole process tree — `child.kill()` leaves the real server listening. */
function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}

/**
 * Spawn one GUI server and resolve once its API answers. Never falls back to a
 * CLI surface: if the server cannot come up, that is a real failure for the
 * caller to report honestly.
 */
export async function startGuiServer(opts: StartGuiServerOptions): Promise<GuiServerHandle> {
  const port = opts.port ?? DEFAULT_GUI_PORT[opts.kind];
  const entry = guiCliEntry(opts.moduleRoot);
  if (!fs.existsSync(entry)) {
    throw new Error(`${opts.kind} GUI entry not built: ${entry} (preflight builds every module first)`);
  }

  const child = spawn('node', [entry, 'gui', '--port', String(port)], {
    cwd: opts.moduleRoot,
    env: opts.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (opts.logPath) {
    fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
    const log = fs.createWriteStream(opts.logPath, { flags: 'a' });
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
  } else {
    child.stdout?.resume();
    child.stderr?.resume();
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHttpOk(`${baseUrl}${GUI_READY_PATH[opts.kind]}`, opts.readyTimeoutMs ?? 90000);
  } catch (err) {
    killTree(child);
    throw err;
  }

  let stopped = false;
  return {
    kind: opts.kind,
    port,
    baseUrl,
    process: child,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      killTree(child);
      await new Promise((r) => setTimeout(r, 250));
    },
  };
}

/** `stamper gui --port 3000`, cwd = ces-stamper. */
export function startStamperGui(
  opts: Omit<StartGuiServerOptions, 'kind' | 'moduleRoot'> & { stamperRoot: string },
): Promise<GuiServerHandle> {
  const { stamperRoot, ...rest } = opts;
  return startGuiServer({ ...rest, kind: 'stamper', moduleRoot: stamperRoot });
}

/**
 * `ao gui --port 3001`, cwd = ces-ao. Note `AoServer.start` also calls `open()`,
 * so a real browser window pops beside Playwright's — harmless, expected.
 */
export function startAoGui(
  opts: Omit<StartGuiServerOptions, 'kind' | 'moduleRoot'> & { aoRoot: string },
): Promise<GuiServerHandle> {
  const { aoRoot, ...rest } = opts;
  return startGuiServer({ ...rest, kind: 'ao', moduleRoot: aoRoot });
}
