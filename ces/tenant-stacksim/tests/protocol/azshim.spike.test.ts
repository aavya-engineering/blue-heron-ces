// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { QueryServer } from '../../src/http/QueryServer.js';
import { assertAzShimResolves, buildShadowedEnv, getPowerShellHostModulesPath, runProcess } from '../../src/coverage/psHarness.js';

/**
 * G-STACKSIM-2 iteration 4 az-shim spike (mirrors M2's
 * psmodule-shadow.spike.test.ts proof style, per the task's explicit
 * instruction). Two things this test proves, both required before the
 * coverage harness is allowed to execute any az-CLI-shaped inventory item:
 *
 *  1. Adversarial probe: this dev box has the REAL Azure CLI genuinely
 *     installed (confirmed independently via `where az` at authoring time -
 *     C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd) - the exact
 *     adversarial case the task calls out. A session shadowed via
 *     buildShadowedEnv's azShimDir prepend must still resolve bare `az` to
 *     azshim\az.cmd, not that real install.
 *  2. End-to-end: a real spawned powershell.exe, in a shadowed session,
 *     running real `az ...` command shapes reaches this test's own
 *     in-process QueryServer/ObjectStore via /resolve (same mechanism
 *     GRAPH_MODULE_IMPORTS-shadowed sessions already use for PowerShell
 *     cmdlets) - one read (`az rest`), one write (`az resource update`,
 *     store-verified), and one deliberately-unsupported az subcommand that
 *     must fail loud (non-zero exit, stderr message), never silently
 *     succeed and never fall through to the real az CLI.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AZSHIM_DIR = path.join(SIM_ROOT, 'azshim');
const PSMODULES_DIR = path.join(SIM_ROOT, 'psmodules');

describe('G-STACKSIM-2 iteration 4 az-shim spike: adversarial probe + end-to-end routing', () => {
  let dir: string;
  let store: ObjectStore;
  let server: QueryServer;
  let port: number;
  let psHomeModules: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-azshim-spike-'));
    store = new ObjectStore(path.join(dir, 'store.json'));

    const gate = new StackShapeGate('m365_azure');
    const resolverTable = new ResolverTable(store, gate);
    server = new QueryServer({ resolverTable });
    port = await server.start(0);
    psHomeModules = await getPowerShellHostModulesPath();
  }, 30_000);

  afterEach(async () => {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it(
    'adversarial probe: real az CLI is reachable unshadowed; azshim/az.cmd wins in a shadowed session',
    async () => {
      const shadowedEnv = buildShadowedEnv(process.env, PSMODULES_DIR, psHomeModules, AZSHIM_DIR);
      const probe = await assertAzShimResolves(process.env, shadowedEnv, AZSHIM_DIR);
      expect(probe.realAzPath.toLowerCase()).not.toContain('azshim');
      expect(probe.shimmedAzPath.toLowerCase().startsWith(AZSHIM_DIR.toLowerCase())).toBe(true);
    },
    30_000,
  );

  it(
    "az rest GET routes through the shim to /resolve and returns the OData 'value' envelope",
    async () => {
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "az rest --method GET --url 'https://management.usgovcloudapi.net/providers/microsoft.aadiam/diagnosticSettings?api-version=2017-04-01'",
      ].join('\n');
      const scriptPath = path.join(dir, 'read.ps1');
      await fs.writeFile(scriptPath, script, 'utf8');

      const env = buildShadowedEnv(process.env, PSMODULES_DIR, psHomeModules, AZSHIM_DIR);
      env.STACKSIM_SERVER_URL = `http://127.0.0.1:${port}`;

      const result = await runProcess(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        env,
      );

      expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const parsed = JSON.parse(result.stdout.trim()) as { value: unknown[] };
      expect(Array.isArray(parsed.value)).toBe(true);
    },
    30_000,
  );

  it(
    'az resource update PATCHes the sim store (verified directly against the in-process ObjectStore)',
    async () => {
      // SIMFIX FIX-S1 (2026-09-27): the resource must EXIST - real
      // `az resource update --ids <missing>` fails, and the sim no longer
      // upserts a phantom object for an id nothing seeded (see the
      // unknown-id case asserted at the end of this test).
      await store.create('armResources', { id: 'sim-drift-resource-1', driftProperty: 'originalValue' });
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "az resource update --ids 'sim-drift-resource-1' --set properties.driftProperty='driftedValue' 2>&1",
      ].join('\n');
      const scriptPath = path.join(dir, 'write.ps1');
      await fs.writeFile(scriptPath, script, 'utf8');

      const env = buildShadowedEnv(process.env, PSMODULES_DIR, psHomeModules, AZSHIM_DIR);
      env.STACKSIM_SERVER_URL = `http://127.0.0.1:${port}`;

      const result = await runProcess(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        env,
      );

      expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const stored = await store.read('armResources', 'sim-drift-resource-1');
      expect(stored).toBeDefined();
      expect((stored as Record<string, unknown>).driftProperty).toBe('driftedValue');

      // An id that names nothing is a not-found, and creates nothing.
      const missingPath = path.join(dir, 'write-missing.ps1');
      await fs.writeFile(
        missingPath,
        "az resource update --ids 'sim-no-such-resource' --set properties.driftProperty='x' 2>&1\nexit $LASTEXITCODE",
        'utf8',
      );
      const missing = await runProcess(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', missingPath],
        env,
      );
      expect(missing.exitCode).not.toBe(0);
      expect(await store.read('armResources', 'sim-no-such-resource')).toBeUndefined();
    },
    30_000,
  );

  it(
    "an unrecognized az subcommand fails loud (az.cmd's own exit code + stderr message) - never silently succeeds, never falls through to the real az CLI",
    async () => {
      // Spawns azshim/az.cmd directly (via cmd.exe, its own native invocation
      // convention) rather than through an ambient PowerShell wrapper script,
      // to test the shim's own exit-code/stderr contract in isolation - a
      // bare native-command nonzero exit code is NOT, by itself, a
      // PowerShell-catchable terminating error in Windows PowerShell 5.1
      // (the outer script would need the real commandText's own `2>&1`
      // convention, which AO's registry already uses for every one of its
      // az-CLI items - see IMPLEMENTATION_LOG.md G-STACKSIM-2 iteration 4).
      const env: NodeJS.ProcessEnv = { ...process.env, STACKSIM_SERVER_URL: `http://127.0.0.1:${port}` };
      const azCmdPath = path.join(AZSHIM_DIR, 'az.cmd');

      const result = await runProcess('cmd.exe', ['/c', azCmdPath, 'storage', 'account', 'list', '--output', 'json'], env);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('az-shim');
      expect(result.stderr).toContain('unsupported az subcommand');
    },
    30_000,
  );
});
