// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.


// W8-UIT2: the tester's presence-only Microsoft.Graph shim passes the SIM-ONLY guard; anything that could load a cmdlet does not.
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { isPresenceOnlyStub, simOnlyEnvViolations } from '../src/flow/sim-only-guard.js';

const ROOT = path.resolve('C:/sim/tenant-stacksim');
const SIM_MODS = path.join(ROOT, 'psmodules');
const SHIM = path.resolve('C:/t/assets/psmodules-shim');
const STUB = "@{\n  RootModule = ''\n  ModuleVersion = '2.0.0'\n  FunctionsToExport = @()\n  CmdletsToExport = @()\n  AliasesToExport = @()\n}\n";
const env = { STACKSIM_SERVER_URL: 'http://127.0.0.1:4390', PSModulePath: `${SIM_MODS};${SHIM}` };

function fs(files: Record<string, string>) {
  const dirs: Record<string, string[]> = { [SIM_MODS]: ['Microsoft.Graph.Authentication'], [SHIM]: ['Microsoft.Graph'] };
  for (const f of Object.keys(files)) (dirs[path.dirname(f)] ??= []).push(path.basename(f));
  return { listDir: (d: string) => dirs[d] ?? [], readText: (f: string) => files[f] ?? null };
}
const mod = path.join(SHIM, 'Microsoft.Graph');

describe('SIM-ONLY guard: presence-only stub roots', () => {
  test('the stub passes when its root is allowed', () => {
    const f = fs({ [path.join(mod, 'Microsoft.Graph.psd1')]: STUB });
    expect(simOnlyEnvViolations(env, ROOT, f.listDir, { stubRoots: [SHIM], readText: f.readText })).toEqual([]);
  });

  test('the same stub still fails when its root is not allowed', () => {
    const f = fs({ [path.join(mod, 'Microsoft.Graph.psd1')]: STUB });
    expect(simOnlyEnvViolations(env, ROOT, f.listDir, { readText: f.readText })).toHaveLength(1);
  });

  test('a module with a root module, exports, nested modules or extra files is not a stub', () => {
    const psd1 = path.join(mod, 'Microsoft.Graph.psd1');
    const cases = [
      { [psd1]: STUB.replace("RootModule = ''", "RootModule = 'Graph.psm1'") },
      { [psd1]: STUB.replace('CmdletsToExport = @()', "CmdletsToExport = @('Get-MgUser')") },
      { [psd1]: `${STUB}NestedModules = @('Microsoft.Graph.Users')\n` },
      { [psd1]: STUB, [path.join(mod, 'Microsoft.Graph.psm1')]: 'function Get-MgUser {}' },
    ];
    for (const files of cases) {
      const f = fs(files);
      expect(simOnlyEnvViolations(env, ROOT, f.listDir, { stubRoots: [SHIM], readText: f.readText })).toHaveLength(1);
    }
  });

  test('the shipped assets/psmodules-shim is a presence-only stub', () => {
    const shim = fileURLToPath(new URL('../assets/psmodules-shim/Microsoft.Graph', import.meta.url));
    expect(isPresenceOnlyStub(shim, 'Microsoft.Graph', (d) => nodeFs.readdirSync(d), (p) => nodeFs.readFileSync(p, 'utf8'))).toBe(true);
  });
});
