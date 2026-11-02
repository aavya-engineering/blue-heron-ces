// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, applyScenario } from '../../src/scenarios/ScenarioEngine.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
import { generateAllModules } from '../../src/codegen/generatePsModule.js';
import { buildShadowedEnv, runProcess } from '../../src/coverage/psHarness.js';

/**
 * PH-6 R-SIM (D-2, LOG-PH6-UI.md): the generated Add-Type forwards to the real
 * Microsoft.PowerShell.Utility\Add-Type and sends nothing to the simulator, so
 * no ledger entry (before, it was a derived "Add" mutation that wrote a
 * `type/type-1` object). AO C-06:set's `Add-Type -AssemblyName System.Web`
 * then really loads System.Web. In-process server on a random port (never :4390).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shell = (exe: string) => {
  const r = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'Write-Output $PSHOME'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const PS = { pwsh: shell('pwsh'), powershell: process.platform === 'win32' ? shell('powershell') : null };

describe.skipIf(!PS.pwsh && !PS.powershell)('PH-6 D-2: generated Add-Type forwards to the built-in, no ledger write', () => {
  let dir: string;
  let tenantRoot: string;
  let psmodules: string;
  let handle: ServeHandle;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ph6-addtype-'));
    tenantRoot = path.join(dir, 'tenant');
    await applyScenario(await loadScenario(path.join(SIM_ROOT, 'scenarios', 'clean-g5.json')), { profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    handle = await startServe({ stance: 'm365_azure', slug: 'clean-g5', port: 0, profilesDir: path.join(SIM_ROOT, 'profiles'), tenantRoot });
    psmodules = path.join(dir, 'psmodules');
    await generateAllModules(psmodules);
  }, 120_000);

  afterAll(async () => {
    await handle?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }, 60_000);

  it('the generated module source forwards Add-Type to Microsoft.PowerShell.Utility', async () => {
    const psm1 = await fs.readFile(path.join(psmodules, 'Microsoft.Graph.Authentication', 'Microsoft.Graph.Authentication.psm1'), 'utf8');
    const fn = psm1.slice(psm1.indexOf('function Add-Type {'));
    expect(fn.slice(0, fn.indexOf('}') + 1)).toBe('function Add-Type {\n    Microsoft.PowerShell.Utility\\Add-Type @args\n}');
  });

  for (const exe of ['pwsh', 'powershell'] as const) {
    it.skipIf(!PS[exe])(`${exe}: Add-Type loads the real assembly / type, and the ledger gains no entry`, async () => {
      const ledgerPath = path.join(tenantRoot, 'ledger.jsonl');
      const before = existsSync(ledgerPath) ? (await fs.readFile(ledgerPath, 'utf8')).split('\n').filter(Boolean).length : 0;
      const env = buildShadowedEnv(process.env, psmodules, path.join(PS[exe]!, 'Modules'));
      env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
      const cls = `Ph6AddType${exe}`;
      const script = [
        "$ErrorActionPreference = 'Stop'",
        'Import-Module Microsoft.Graph.Authentication',
        "Write-Output (\"SRC=\" + (Get-Command Add-Type).Source)",
        'Add-Type -AssemblyName System.Web',
        `Add-Type -TypeDefinition 'public static class ${cls} { public static int Two() { return 2; } }'`,
        `Write-Output ("TWO=" + [${cls}]::Two())`,
        ...(exe === 'powershell' ? ['Write-Output ("PWLEN=" + [System.Web.Security.Membership]::GeneratePassword(24, 6).Length)'] : []),
      ].join('; ');
      const run = await runProcess(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], env);
      expect(run.exitCode, `${run.stdout}\n${run.stderr}`).toBe(0);
      expect(run.stdout).toContain('SRC=Microsoft.Graph.Authentication');
      expect(run.stdout).toContain('TWO=2');
      if (exe === 'powershell') expect(run.stdout).toContain('PWLEN=24');
      const after = existsSync(ledgerPath) ? (await fs.readFile(ledgerPath, 'utf8')).split('\n').filter(Boolean) : [];
      expect(after.length).toBe(before);
      expect(after.some((l) => l.includes('Add-Type'))).toBe(false);
      expect(await handle.store.list('type').catch(() => [])).toEqual([]);
    }, 120_000);
  }
});
