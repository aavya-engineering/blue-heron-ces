// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TenantStance } from './types.js';
import { tenantRootFor } from './cli.js';

/**
 * G-TESTER-1 Gate Ledger "Operational consequence": stacksim's S1 exclusive
 * tenant lock means `scenario`/`seed` FAIL LOUDLY (TenantLockedError) while
 * `serve` holds the tenant. Run lifecycle MUST be: run scenario CLI (no
 * serve running) -> start serve -> HTTP ready-check + queries -> stop serve.
 * This module owns only the serve half of that lifecycle.
 */

export interface ServeHandle {
  process: ChildProcess;
  stop: () => Promise<void>;
}

export interface StartServeOptions {
  stacksimRoot: string;
  stance: TenantStance;
  slug: string;
  port?: number;
  /** When set, the serve child's full stdout+stderr is appended here and an
   * UNEXPECTED exit (one not initiated by stop()) is recorded both in the
   * log and on stderr — added after the gp-m1-gate-1 teams-external-baseline
   * crash, where the serve died mid-Stamper-leg and nothing had captured why. */
  logPath?: string;
}

/**
 * Spawns `node bin/stacksim.mjs serve <stance> --slug <slug>` with
 * cwd = stacksimRoot (gotcha 1 applies here too — tenant root resolution is
 * cwd-bound). Resolves once the process has printed its "listening on"
 * line, or rejects if the process exits first (e.g. TenantLockedError).
 */
export function startServe(opts: StartServeOptions): Promise<ServeHandle> {
  const bin = path.join(opts.stacksimRoot, 'bin', 'stacksim.mjs');
  const args = ['serve', opts.stance, '--slug', opts.slug];
  if (opts.port !== undefined) {
    args.push('--port', String(opts.port));
  }

  return new Promise((resolve, reject) => {
    const child = spawn('node', [bin, ...args], { cwd: opts.stacksimRoot });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let stopRequested = false;

    const appendLog = (line: string): void => {
      if (!opts.logPath) return;
      void fs.appendFile(opts.logPath, line, 'utf8').catch(() => undefined);
    };

    const onStdout = (chunk: Buffer): void => {
      stdout += chunk.toString('utf8');
      appendLog(chunk.toString('utf8'));
      if (!settled && /listening on/i.test(stdout)) {
        settled = true;
        child.stdout?.removeListener('data', onStdout);
        // Keep appending post-ready output to the log without accumulating
        // it in memory.
        child.stdout?.on('data', (c: Buffer) => appendLog(c.toString('utf8')));
        resolve({
          process: child,
          stop: () => {
            stopRequested = true;
            return stopServe(child, tenantRootFor(opts.stacksimRoot, opts.slug));
          },
        });
      }
    };

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      appendLog(chunk.toString('utf8'));
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`stacksim serve exited early (code ${code}) before reporting ready:\n${stdout}${stderr}`));
      } else if (!stopRequested) {
        const msg = `\n[ces-tester serve-lifecycle] UNEXPECTED stacksim serve exit (code ${code}) at ${new Date().toISOString()} — not initiated by stop()\n`;
        appendLog(msg);
        console.error(msg.trim());
      }
    });
  });
}

/**
 * Stops the spawned `stacksim serve` child. stacksim's serve command has no
 * SIGTERM/SIGINT handler (verified: no `process.on('SIG...')` anywhere in
 * its src/), so `child.kill()` does not run its `lock.release()` cleanup —
 * this leaves a stale `.stacksim.lock` behind (harmless: TenantLock.ts's own
 * pid-liveness check steals a dead-pid lock on the next acquire, verified
 * live in this run's acceptance gate). This client defensively removes the
 * lock file itself after kill, best-effort, so repeated runs stay clean
 * without depending on stacksim's next-acquire steal path.
 */
function stopServe(child: ChildProcess, tenantRoot: string): Promise<void> {
  return new Promise((resolve) => {
    const cleanupLock = (): void => {
      void fs.unlink(path.join(tenantRoot, '.stacksim.lock')).catch(() => undefined);
    };
    if (child.exitCode !== null || child.killed) {
      cleanupLock();
      resolve();
      return;
    }
    child.once('close', () => {
      cleanupLock();
      resolve();
    });
    child.kill();
  });
}
