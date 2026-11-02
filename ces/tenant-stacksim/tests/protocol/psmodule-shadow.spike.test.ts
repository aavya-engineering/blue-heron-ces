// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { QueryServer } from '../../src/http/QueryServer.js';

/**
 * M2 risk-gate spike (PLAN.md Milestone Ladder row M2; Core Design (d)).
 * Spawns real powershell.exe with $env:PSModulePath replaced by exactly
 * `<simRoot>\psmodules;$PSHOME\Modules`, runs the literal GRAPH_MODULE_IMPORTS
 * block quoted in PLAN.md's Context Summary (SessionManager.ts:49-61)
 * verbatim, then `Get-MgIdentityConditionalAccessPolicy | ConvertTo-Json
 * -Depth 5`, plus a builtin smoke check (ForEach-Object, Where-Object,
 * Test-Path, string ops, ConvertTo-Json). Binary gate: green = M2 passes,
 * proceed to M3; red = write docs/context/BLOCKED.md and halt (handled by
 * the caller of this test run, per Core Design (d)'s halt mechanism).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PSMODULES_DIR = path.join(SIM_ROOT, 'psmodules');
const GOLDEN_PATH = path.join(SIM_ROOT, 'tests', 'protocol', 'goldens', 'ca-policies.golden.json');

/** The literal GRAPH_MODULE_IMPORTS block, transcribed verbatim from PLAN.md's
 * Context Summary quotes of SessionManager.ts:49-61. */
const GRAPH_MODULE_IMPORTS = [
  "Import-Module Microsoft.Graph.Authentication -RequiredVersion 2.35.1 -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Identity.Governance -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Users -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Identity.DirectoryManagement -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Groups -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Identity.ConditionalAccess -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.DeviceManagement -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Identity.SignIns -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Identity.Authentication -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Reports -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Domains -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.Applications -Force -ErrorAction SilentlyContinue",
  "Import-Module Microsoft.Graph.DirectoryObjects -Force -ErrorAction SilentlyContinue",
].join('\n');

function buildSpikeScript(): string {
  return `$ErrorActionPreference = 'Stop'
$env:PSModulePath = '${SIM_ROOT}\\psmodules;' + $PSHOME + '\\Modules'

${GRAPH_MODULE_IMPORTS}

# Prove OUR module wins resolution under the controlled PSModulePath (not a
# real installed SDK), even if the real Microsoft.Graph SDK is present on
# this box.
$authModule = Get-Module Microsoft.Graph.Authentication
Write-Output ("MODULE_PATH::" + $authModule.Path)
Write-Output ("MODULE_VERSION::" + $authModule.Version.ToString())

# The one additional Graph GET call required by M2's spike gate.
$caResult = Get-MgIdentityConditionalAccessPolicy | ConvertTo-Json -Depth 5
Write-Output ("CA_POLICIES::" + ($caResult -replace "\`r?\`n", ' '))

# Builtin smoke check (ForEach-Object, Where-Object, Test-Path, string ops,
# ConvertTo-Json) - cheap regression insurance per Core Design (d).
$smokeItems = 1..3 | ForEach-Object { $_ * 2 }
$smokeFiltered = @($smokeItems | Where-Object { $_ -gt 2 })
$pathExists = Test-Path -Path $PSHOME
$stringOp = ('stacksim'.ToUpper())
$smokeResult = @{ items = $smokeFiltered; pathExists = $pathExists; stringOp = $stringOp }
$smokeJson = $smokeResult | ConvertTo-Json -Depth 3 -Compress
Write-Output ("SMOKE::" + $smokeJson)
`;
}

interface SpikeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runPowershellScript(scriptPath: string, env: NodeJS.ProcessEnv): Promise<SpikeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { env },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function extractMarker(stdout: string, marker: string): string | undefined {
  const line = stdout.split('\n').find((l) => l.startsWith(marker));
  return line ? line.slice(marker.length).trim() : undefined;
}

describe('M2 risk-gate spike: PSModulePath shadowing with real module names', () => {
  let dir: string;
  let store: ObjectStore;
  let server: QueryServer;
  let port: number;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-spike-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    await store.create('caPolicies', { id: 'caPolicy-1', displayName: 'Sim CA Policy 1', state: 'enabled' });
    await store.create('caPolicies', { id: 'caPolicy-2', displayName: 'Sim CA Policy 2', state: 'enabled' });

    const gate = new StackShapeGate('m365_azure');
    const resolverTable = new ResolverTable(store, gate);
    server = new QueryServer({ resolverTable });
    port = await server.start(0);
  });

  afterEach(async () => {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it(
    'resolves fake real-named Graph modules over PSModulePath, serves Get-MgIdentityConditionalAccessPolicy via /resolve, and passes the builtin smoke check',
    async () => {
      const scriptPath = path.join(dir, 'spike.ps1');
      await fs.writeFile(scriptPath, buildSpikeScript(), 'utf8');

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        STACKSIM_SERVER_URL: `http://127.0.0.1:${port}`,
      };

      const result = await runPowershellScript(scriptPath, env);

      if (result.exitCode !== 0) {
        throw new Error(
          `spike script failed (exit ${result.exitCode})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
        );
      }

      const modulePath = extractMarker(result.stdout, 'MODULE_PATH::');
      const moduleVersion = extractMarker(result.stdout, 'MODULE_VERSION::');
      const caPoliciesRaw = extractMarker(result.stdout, 'CA_POLICIES::');
      const smokeRaw = extractMarker(result.stdout, 'SMOKE::');

      expect(modulePath, `stdout was:\n${result.stdout}`).toBeDefined();
      expect(modulePath!.toLowerCase().startsWith(PSMODULES_DIR.toLowerCase())).toBe(true);
      expect(moduleVersion).toBe('2.35.1');

      expect(caPoliciesRaw, `stdout was:\n${result.stdout}`).toBeDefined();
      const caPolicies = JSON.parse(caPoliciesRaw!) as Array<{ id: string; displayName: string; state: string }>;
      const golden = JSON.parse(await fs.readFile(GOLDEN_PATH, 'utf8')) as typeof caPolicies;
      expect(caPolicies).toEqual(golden);

      expect(smokeRaw, `stdout was:\n${result.stdout}`).toBeDefined();
      const smoke = JSON.parse(smokeRaw!) as { items: number[]; pathExists: boolean; stringOp: string };
      expect(smoke.items).toEqual([4, 6]);
      expect(smoke.pathExists).toBe(true);
      expect(smoke.stringOp).toBe('STACKSIM');
    },
    60_000,
  );
});
