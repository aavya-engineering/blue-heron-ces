// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-5 — prep-phase arming for the Muster ("Readiness Evaluation") GUI acts.
 *
 * Same INVISIBLE-SETUP carve-out as `arm-eo.ts` / `arm-sim.ts`: this runs before
 * slide 1 and is never a demo surface. It is armed CONDITIONALLY — a deck that
 * never drives a `muster-gui` act must not pay the Vite preview boot.
 *
 * ## Serving
 *
 * The ces-muster SPA is a Vite build served by `npm run preview` on **:4173**
 * (`vite.config.ts` sets no port; `vite preview`'s default is 4173). It serves a
 * prebuilt `dist/` — an OPERATOR PREREQUISITE (`npm run build` in ces-muster),
 * never built here (ces-tester never builds a sibling).
 *
 * ## Teardown (TD1) — the Windows grandchild
 *
 * `npm run preview` launches Vite as a GRANDCHILD of the shell/npm process, so
 * killing only the direct child orphans Vite, which keeps holding :4173 and reds
 * TD1. The mechanism here is the arm-eo-proven one: spawn with `shell: true` and
 * kill the whole process TREE with `taskkill /PID <pid> /T /F`. `--strictPort`
 * is a second guard behind arm-sim's pre-spawn port probe: Vite fails loudly
 * rather than silently picking another port if 4173 is taken.
 *
 * Two-entities boundary: ces-muster is consumed over its existing SPA surface and
 * spawned from its own root; nothing is written into it.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The Vite preview port — the same one `demo:preflight` and the acts harness guard. */
export const MUSTER_SPA_PORT = 4173;

/** `<musterRoot>/dist/index.html` — the built SPA the preview serves. */
export function musterDistIndex(musterRoot: string): string {
  return path.join(musterRoot, 'dist', 'index.html');
}

export interface MusterPreviewHandle {
  readonly baseUrl: string;
  readonly port: number;
  /** Idempotent: kills the whole Vite process tree and closes the log fd. */
  stop(): Promise<void>;
}

export interface StartMusterPreviewOptions {
  readonly musterRoot: string;
  readonly logPath: string;
  readonly port?: number;
  readonly readyTimeoutMs?: number;
}

/**
 * Boot the ces-muster Vite preview on a fixed port and resolve once the SPA
 * answers. Throws (after killing the child) if it never does — a half-armed show
 * must never reach slide 1 looking ready.
 */
export async function startMusterPreview(opts: StartMusterPreviewOptions): Promise<MusterPreviewHandle> {
  if (!fs.existsSync(opts.musterRoot)) {
    throw new Error(`the ces-muster checkout is missing: ${opts.musterRoot} (pass --muster-root or clone ces-muster beside ces-tester)`);
  }
  if (!fs.existsSync(musterDistIndex(opts.musterRoot))) {
    throw new Error(
      `the ces-muster SPA is not built: ${musterDistIndex(opts.musterRoot)} does not exist. ` +
        'Run `npm run build` in ces-muster — ces-tester never builds a sibling.',
    );
  }

  const port = opts.port ?? MUSTER_SPA_PORT;
  fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
  const logFd = fs.openSync(opts.logPath, 'a');

  // shell:true so `npm run preview` runs via cmd.exe; the `/T` kill below reaches
  // the Vite grandchild. `--strictPort` makes Vite fail loudly if 4173 is taken.
  // `--host 127.0.0.1` binds IPv4 explicitly: Vite's default `localhost` can
  // resolve to ::1, which the 127.0.0.1 health check and the Playwright drive
  // then cannot reach.
  const child: ChildProcess = spawn(`npm run preview -- --port ${port} --strictPort --host 127.0.0.1`, {
    cwd: opts.musterRoot,
    shell: true,
    stdio: ['ignore', logFd, logFd],
  });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (child.pid) {
      try {
        // No shell — taskkill is on PATH (avoids DEP0190), and `/T` is the point:
        // `npm run preview` spawns Vite as a grandchild, so killing only the
        // direct child leaves Vite listening on 4173 (the TD1 orphan).
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } catch {
        /* already gone */
      }
    }
    try {
      fs.closeSync(logFd);
    } catch {
      /* already closed */
    }
    await new Promise((r) => setTimeout(r, 250));
  };

  const baseUrl = `http://127.0.0.1:${port}`;
  const healthy = async (): Promise<boolean> => {
    try {
      const r = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + (opts.readyTimeoutMs ?? 60_000);
  while (Date.now() < deadline && !(await healthy())) await new Promise((r) => setTimeout(r, 1000));
  if (!(await healthy())) {
    await stop();
    throw new Error(`the ces-muster preview never became healthy on ${baseUrl} — see ${opts.logPath}`);
  }

  return { baseUrl, port, stop };
}
