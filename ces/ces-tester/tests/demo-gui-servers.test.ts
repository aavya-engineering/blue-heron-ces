// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-3 M3 — the GUI child env, pinned.
//
// One ordering bug here breaks both GUI legs silently and looks like a sibling
// defect: `mergeSimLaunchEnv` REPLACES PSModulePath, so a shim appended to the
// base env vanishes, Stamper's Connect prereq bails `prereq_blocked`, and the
// Execute button is never clickable (FD-5). These tests pin the append-AFTER-
// merge ordering, the sim-first precedence, and the CES_AO_AUTH_TOKEN scrub.
// No process is spawned and no port is bound by any test here.
import { describe, it, expect } from 'vitest';
import {
  buildGuiChildEnv,
  guiCliEntry,
  GUI_READY_PATH,
  DEFAULT_GUI_PORT,
  STAMPER_GUI_PORT,
  AO_GUI_PORT,
} from '../src/demo/gui-servers.js';

const SIM_LAUNCH_ENV = {
  psModulePath: 'C:\\ces\\tenant-stacksim\\psmodules',
  path: 'C:\\ces\\tenant-stacksim\\azshim;C:\\Windows',
  stacksimServerUrl: 'http://127.0.0.1:4390',
};
const SHIM = 'C:\\ces\\ces-tester\\assets\\psmodules-shim';

describe('buildGuiChildEnv', () => {
  it('appends the shim AFTER the merge, with the sim shims still first', () => {
    const env = buildGuiChildEnv({ simLaunchEnv: SIM_LAUNCH_ENV, shimRoot: SHIM, baseEnv: {} });
    expect(env.PSModulePath).toBe(`${SIM_LAUNCH_ENV.psModulePath};${SHIM}`);
    const parts = env.PSModulePath!.split(';');
    expect(parts.indexOf(SIM_LAUNCH_ENV.psModulePath)).toBeLessThan(parts.indexOf(SHIM));
  });

  it('discards a shim the caller pre-set on the base env (merge replaces PSModulePath)', () => {
    const env = buildGuiChildEnv({
      simLaunchEnv: SIM_LAUNCH_ENV,
      shimRoot: SHIM,
      baseEnv: { PSModulePath: 'C:\\real\\Microsoft.Graph;C:\\other' },
    });
    expect(env.PSModulePath).not.toContain('C:\\real\\Microsoft.Graph');
    expect(env.PSModulePath).toContain(SHIM);
  });

  it('sets the three sim vars and the run-scoped roots', () => {
    const env = buildGuiChildEnv({
      simLaunchEnv: SIM_LAUNCH_ENV,
      shimRoot: SHIM,
      baseEnv: {},
      tenantRoot: 'C:\\run\\tenant-root',
      pipelineRoot: 'C:\\run\\pipeline',
      storageRoot: 'C:\\run\\stamper-storage',
    });
    expect(env.STACKSIM_SERVER_URL).toBe('http://127.0.0.1:4390');
    expect(env.Path).toBe(SIM_LAUNCH_ENV.path);
    expect(env.CES_TENANT_ROOT).toBe('C:\\run\\tenant-root');
    expect(env.CES_PIPELINE_ROOT).toBe('C:\\run\\pipeline');
    expect(env.STORAGE_ROOT).toBe('C:\\run\\stamper-storage');
  });

  it('leaves CES_PIPELINE_ROOT untouched when not run-scoped (caller opts in)', () => {
    const env = buildGuiChildEnv({ simLaunchEnv: SIM_LAUNCH_ENV, shimRoot: SHIM, baseEnv: {} });
    expect(env.CES_PIPELINE_ROOT).toBeUndefined();
  });

  it('deletes CES_AO_AUTH_TOKEN in every casing (loopback trust — AoServer.ts:99)', () => {
    const env = buildGuiChildEnv({
      simLaunchEnv: SIM_LAUNCH_ENV,
      shimRoot: SHIM,
      baseEnv: { CES_AO_AUTH_TOKEN: 'a', ces_ao_auth_token: 'b', Ces_Ao_Auth_Token: 'c', KEEP: 'yes' },
    });
    expect(Object.keys(env).some((k) => k.toLowerCase() === 'ces_ao_auth_token')).toBe(false);
    expect(env.KEEP).toBe('yes');
  });

  it('does not mutate the caller’s base env', () => {
    const base = { PSModulePath: 'orig', CES_AO_AUTH_TOKEN: 'tok' };
    buildGuiChildEnv({ simLaunchEnv: SIM_LAUNCH_ENV, shimRoot: SHIM, baseEnv: base });
    expect(base).toEqual({ PSModulePath: 'orig', CES_AO_AUTH_TOKEN: 'tok' });
  });

  it('sets the GUI opt-out used by both sibling servers to suppress browser tabs', () => {
    const env = buildGuiChildEnv({ simLaunchEnv: SIM_LAUNCH_ENV, shimRoot: SHIM, baseEnv: {} });
    expect(env.CES_NO_OPEN).toBe('1');
    expect(env.BROWSER).toBe('none');
  });
});

describe('GUI server constants', () => {
  it('keeps the two GUIs off each other’s default port', () => {
    expect(STAMPER_GUI_PORT).toBe(3000);
    expect(AO_GUI_PORT).toBe(3001);
    expect(DEFAULT_GUI_PORT.stamper).not.toBe(DEFAULT_GUI_PORT.ao);
  });

  it('probes a real API route per server, never the SPA shell', () => {
    expect(GUI_READY_PATH.stamper).toBe('/api/tenants');
    expect(GUI_READY_PATH.ao).toBe('/api/commands');
  });

  it('resolves each module’s built CLI entry', () => {
    expect(guiCliEntry('C:\\ces\\ces-ao').replace(/\\/g, '/')).toBe('C:/ces/ces-ao/dist/cli/index.js');
  });
});
