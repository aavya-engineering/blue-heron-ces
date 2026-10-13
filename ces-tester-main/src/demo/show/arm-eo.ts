// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — prep-phase arming for the EO ("Assessment") live op.
 *
 * Same carve-out as `arm-sim.ts` / `gui-servers.ts`: this is INVISIBLE SETUP,
 * completed before slide 1, never a demo surface. It is a sibling module rather
 * than more lines in `arm-sim.ts` because EO is armed CONDITIONALLY — a deck
 * that never drives `eo-review` must not pay ~10-60 s of EO boot.
 *
 * Everything here mirrors the GP-DEMO-3-proven spawn in `e2e-run.ts`
 * (`startEoServer`, its ~L695-748) and adds no new mechanism:
 *
 * - **`buildEoChildEnv` is reused VERBATIM from `eo-leg.ts`, never re-derived.**
 *   It strips EVERY casing of `PSModulePath`/`Path` before setting the sim
 *   shims; skip that and the real Microsoft.Graph modules shadow the sim's and
 *   the assessment silently crashes to 0/110 while every status text still says
 *   "complete". This is the single most expensive thing to get wrong here.
 * - **`CES_PIPELINE_ROOT` is run-scoped and EO-only.** EO's `AssessmentStore`
 *   writes to `{CES_PIPELINE_ROOT}/ces.db` (ces-eo ADR-002) and `loadLatest()`
 *   filters out only its OWN `eo_assessments:scope:<root>` pointer — every
 *   pointer written by a different storage root reaches the sort and throws,
 *   making `GET /api/assessment` and `/api/sprs` a permanent 500
 *   (REQ-EO-ASSESSMENT-SCOPE-POINTER-CRASH). One pointer per database is a
 *   correctness requirement, not tidiness, so EO does not share the AO GUI's
 *   pipeline root.
 * - **`npx tsx src/eo/index.ts` with `shell: true`, cwd = eoRoot.** The proven
 *   entry. ces-eo's `dist/` is not the surface GP-DEMO-3 exercised, and this is
 *   not the slice to change that.
 *
 * Two-entities boundary: ces-eo is consumed over its existing HTTP/SPA surface
 * and spawned from its own root; nothing is written into it.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildEoChildEnv } from '../eo-leg.js';

/** FD-2's port assignment for EO — the same one `demo:preflight` guards. */
export const EO_PORT = 4002;

/** `<stamperRoot>/src/registry/cmmc-l2-commands.registry.json` — EO's `REGISTRY_PATH`. */
export function stamperRegistryPath(stamperRoot: string): string {
  return path.resolve(stamperRoot, 'src', 'registry', 'cmmc-l2-commands.registry.json');
}

export interface EoServerHandle {
  readonly baseUrl: string;
  readonly port: number;
  /** Idempotent: kills the whole tree and closes the log fd. */
  stop(): Promise<void>;
}

export interface StartShowEoServerOptions {
  readonly eoRoot: string;
  /** tenant-stacksim checkout — supplies `psmodules/` and `azshim/`. */
  readonly simRoot: string;
  readonly stamperRegistry: string;
  /** The run-scoped registry root that already resolves `sim/<slug>.json`. */
  readonly tenantRoot: string;
  readonly storageRoot: string;
  /** EO-only, run-scoped: one `eo_assessments:scope:*` pointer per database. */
  readonly pipelineRoot: string;
  readonly logPath: string;
  readonly slug: string;
  readonly simUrl: string;
  readonly port?: number;
  readonly readyTimeoutMs?: number;
  /** `$PSHOME\Modules`, resolved once by the caller (a PowerShell 5.1 spawn). */
  readonly psHomeModules: string;
}

/**
 * `$PSHOME\Modules` via Windows PowerShell 5.1. Mirrors `eo-leg.ts`'s private
 * helper — it is private there, and copying four lines is cheaper than widening
 * a GP-DEMO-3 module's exported surface from this slice.
 */
export function resolvePsHomeModules(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'Write-Output (Join-Path $PSHOME Modules)']);
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.on('close', () => resolve(out.trim()));
    child.on('error', () => resolve(''));
  });
}

/**
 * Boot ces-eo out-of-process on a fixed port and resolve once `/api/health`
 * answers. Throws (after killing the child) if it never does — a half-armed
 * show must never reach slide 1 looking ready.
 */
export async function startShowEoServer(opts: StartShowEoServerOptions): Promise<EoServerHandle> {
  if (!fs.existsSync(opts.eoRoot)) {
    throw new Error(`the EO checkout is missing: ${opts.eoRoot} (pass --eo-root or clone ces-eo beside ces-tester)`);
  }
  if (!fs.existsSync(opts.stamperRegistry)) {
    throw new Error(
      `EO's command registry is missing: ${opts.stamperRegistry}. ` +
        'EO reads it through REGISTRY_PATH; without it the assessment cannot classify controls.',
    );
  }

  const port = opts.port ?? EO_PORT;
  fs.mkdirSync(opts.storageRoot, { recursive: true });
  fs.mkdirSync(opts.pipelineRoot, { recursive: true });
  fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });

  const env = buildEoChildEnv(process.env, {
    simRoot: opts.simRoot,
    psModules: path.join(opts.simRoot, 'psmodules'),
    psHomeModules: opts.psHomeModules,
    tenantRoot: opts.tenantRoot,
    stamperRegistry: opts.stamperRegistry,
    storageRoot: opts.storageRoot,
    slug: opts.slug,
    simUrl: opts.simUrl,
    port,
  });
  env.CES_PIPELINE_ROOT = opts.pipelineRoot;

  const logFd = fs.openSync(opts.logPath, 'a');
  const child: ChildProcess = spawn('npx tsx src/eo/index.ts', {
    cwd: opts.eoRoot,
    env,
    shell: true,
    stdio: ['ignore', logFd, logFd],
  });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (child.pid) {
      try {
        // No shell — taskkill is on PATH (avoids DEP0190), and `/T` is the
        // point: `npx tsx` is a wrapper, so killing only the direct child
        // leaves the real server listening on 4002 (the A8 orphan).
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
      const r = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + (opts.readyTimeoutMs ?? 90_000);
  while (Date.now() < deadline && !(await healthy())) await new Promise((r) => setTimeout(r, 1000));
  if (!(await healthy())) {
    await stop();
    throw new Error(`the EO server never became healthy on ${baseUrl} — see ${opts.logPath}`);
  }

  return { baseUrl, port, stop };
}
