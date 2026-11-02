// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, expect, test } from 'vitest';
import { simOnlyEnvViolations } from '../src/flow/sim-only-guard.js';

const ROOT = 'C:\\ces\\tenant-stacksim';
const SIM_MODS = `${ROOT}\\psmodules`;
const PSHOME = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';
const dirs: Record<string, string[]> = {
  [PSHOME]: ['Microsoft.PowerShell.Utility', 'CimCmdlets'],
  'C:\\Users\\x\\Documents\\WindowsPowerShell\\Modules': ['Microsoft.Graph.Authentication', 'Az.Accounts'],
};
const listDir = (d: string) => dirs[d] ?? [];

describe('flow-through SIM-ONLY env guard', () => {
  test('ces-tenant sim launch env shape passes', () => {
    expect(
      simOnlyEnvViolations({ STACKSIM_SERVER_URL: 'http://127.0.0.1:4100', PSModulePath: `${SIM_MODS};${PSHOME}` }, ROOT, listDir),
    ).toEqual([]);
  });

  test('non-loopback server url is refused', () => {
    const v = simOnlyEnvViolations({ STACKSIM_SERVER_URL: 'https://graph.microsoft.us', PSModulePath: SIM_MODS }, ROOT, listDir);
    expect(v.join()).toMatch(/not loopback/);
  });

  test('missing server url is refused', () => {
    expect(simOnlyEnvViolations({ PSModulePath: SIM_MODS }, ROOT, listDir).join()).toMatch(/not set/);
  });

  test('a PSModulePath entry exposing real Graph/Az modules is refused', () => {
    const v = simOnlyEnvViolations(
      { STACKSIM_SERVER_URL: 'http://localhost:4100', PSModulePath: `${SIM_MODS};C:\\Users\\x\\Documents\\WindowsPowerShell\\Modules` },
      ROOT,
      listDir,
    );
    expect(v.join()).toMatch(/Microsoft\.Graph\.Authentication, Az\.Accounts/);
  });

  test('stacksim shims must come first', () => {
    const v = simOnlyEnvViolations({ STACKSIM_SERVER_URL: 'http://localhost:4100', PSModulePath: `${PSHOME};${SIM_MODS}` }, ROOT, listDir);
    expect(v.join()).toMatch(/first PSModulePath entry is not stacksim/);
  });
});
