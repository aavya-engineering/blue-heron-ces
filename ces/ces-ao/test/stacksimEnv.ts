// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AO-20 (2026-09-27, FC-AO) shared test helper: makes `isStacksimModeActive()`
// (src/execution/SimOnlyRail.ts) return true, the same way ces-tester's real
// stacksim-routed process would — a loopback STACKSIM_SERVER_URL and a PSModulePath
// whose first segment contains a directory named after the stacksim shim marker
// module (Microsoft.Graph.Authentication).
//
// Every existing test that runs a `kind:'sim'` tenant through the production
// executor (CommandExecutor.ts) needs this now that AO-20 wires isStacksimModeActive
// into the executor's fail-closed sim-only rail: a sim tenant on a process the
// predicate says is NOT stacksim-routed is refused, regardless of endpoints/kind.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface StacksimEnvHandle {
  /** Temp dir holding the fake psmodules — remove after restore() if you created your own. */
  dir: string;
  /** Restore the saved STACKSIM_SERVER_URL / PSModulePath and delete the temp dir. */
  restore(): void;
}

/**
 * Sets STACKSIM_SERVER_URL + PSModulePath so `isStacksimModeActive()` returns true.
 * Call `restore()` in afterEach/afterAll (or let it be, then call it once at the end —
 * always pair a call with exactly one restore()).
 */
export function activateStacksimEnv(): StacksimEnvHandle {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-stacksim-env-'));
  const psmodules = path.join(dir, 'psmodules');
  fs.mkdirSync(path.join(psmodules, 'Microsoft.Graph.Authentication'), { recursive: true });

  const saved = {
    STACKSIM_SERVER_URL: process.env.STACKSIM_SERVER_URL,
    PSModulePath: process.env.PSModulePath,
  };
  process.env.STACKSIM_SERVER_URL = 'http://127.0.0.1:4390';
  process.env.PSModulePath = `${psmodules}${path.delimiter}C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules`;

  return {
    dir,
    restore() {
      if (saved.STACKSIM_SERVER_URL === undefined) delete process.env.STACKSIM_SERVER_URL;
      else process.env.STACKSIM_SERVER_URL = saved.STACKSIM_SERVER_URL;
      if (saved.PSModulePath === undefined) delete process.env.PSModulePath;
      else process.env.PSModulePath = saved.PSModulePath;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Explicitly makes isStacksimModeActive() false (belt-and-suspenders over "just don't set it"). */
export function deactivateStacksimEnv(): { STACKSIM_SERVER_URL?: string; PSModulePath?: string } {
  const saved = {
    STACKSIM_SERVER_URL: process.env.STACKSIM_SERVER_URL,
    PSModulePath: process.env.PSModulePath,
  };
  delete process.env.STACKSIM_SERVER_URL;
  delete process.env.PSModulePath;
  return saved;
}

export function restoreEnv(saved: { STACKSIM_SERVER_URL?: string; PSModulePath?: string }): void {
  if (saved.STACKSIM_SERVER_URL === undefined) delete process.env.STACKSIM_SERVER_URL;
  else process.env.STACKSIM_SERVER_URL = saved.STACKSIM_SERVER_URL;
  if (saved.PSModulePath === undefined) delete process.env.PSModulePath;
  else process.env.PSModulePath = saved.PSModulePath;
}
