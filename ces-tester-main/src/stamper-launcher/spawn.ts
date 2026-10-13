// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'node:child_process';

/**
 * PLAN.md Tech Stack: every Stamper CLI invocation goes through Windows
 * PowerShell 5.1 (`powershell.exe`), never `pwsh`. Confirmed independently
 * at PHASE0_FINDINGS.md item 4b against ces-stamper/src/core/SessionManager.ts.
 *
 * PHASE0_FINDINGS.md item 4: `execute` fires one preflight inquirer Y/n
 * confirm with no `--yes` flag; unattended runs must pipe a newline to
 * stdin (defaults Y). This wrapper always writes "\n" to the child's stdin
 * immediately after spawn so a piped (non-TTY) confirm resolves to its
 * default without hanging the run.
 */

export interface StamperSpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface StamperSpawnOptions {
  /** Command to run inside powershell.exe, e.g. "stamper translate ...". */
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Whether to pipe a newline to stdin (the execute preflight confirm). Default false. */
  confirmYes?: boolean;
}

export function runPowershellCommand(opts: StamperSpawnOptions): Promise<StamperSpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', opts.command],
      {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

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
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    if (opts.confirmYes) {
      child.stdin?.write('\n');
    }
    child.stdin?.end();
  });
}

/** The genuine spawned binary, for the M1 acceptance gate's runtime check. */
export const STAMPER_SPAWN_BINARY = 'powershell.exe';
