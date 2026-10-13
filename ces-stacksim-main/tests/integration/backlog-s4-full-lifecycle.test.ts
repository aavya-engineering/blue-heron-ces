// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seedTenant } from '../../src/cli/commands/seed.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
import { buildSimTenantConfig } from '../../src/config/SimTenantConfig.js';
import { buildShadowedEnv, getPowerShellHostModulesPath, runProcess } from '../../src/coverage/psHarness.js';

/**
 * backlog-S4 acceptance test (BACKLOG.md § S4): "Stamper completes a full
 * session lifecycle (sign-in -> connect -> execute -> disconnect) against
 * the sim with zero Stamper code edits."
 *
 * Drives ces-stamper's REAL SessionManager (persistent session-host.ps1
 * processes, buildConnectCommand, ensureConnected, execute, disconnectAll)
 * in a tsx child process whose environment is shadowed onto a live sim
 * server — all SIX session types, including sharepoint, whose connect now
 * binds -CertificateThumbprint (the owner-approved production change in
 * SessionManager.ts) so no real certificate store is ever involved.
 *
 * "Sign-in" for Stamper sessions IS the cert-credentialed Connect-* call
 * (there is no separate interactive leg); "disconnect" is
 * SessionManager.disconnectAll() killing the persistent hosts.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const PSMODULES_DIR = path.join(SIM_ROOT, 'psmodules');
const STAMPER_SRC = path.resolve(SIM_ROOT, '..', 'ces-stamper', 'src');
const SESSION_MANAGER = path.join(STAMPER_SRC, 'core', 'SessionManager.ts');
const TSX_CLI = path.resolve(SIM_ROOT, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

const stamperAvailable = existsSync(SESSION_MANAGER) && existsSync(TSX_CLI);

const SLUG = 's4-lifecycle';
const CONFIG = buildSimTenantConfig({ slug: SLUG, tenantStance: 'm365_azure' });

/** One real command per session type for the execute leg. */
const EXECUTE_COMMANDS: Record<string, string> = {
  graph: 'Get-MgUser | ConvertTo-Json -Depth 3 -Compress',
  azure: 'Get-AzStorageAccount | ConvertTo-Json -Compress',
  exchange: 'Get-OrganizationConfig | ConvertTo-Json -Compress',
  purview: 'Get-DlpCompliancePolicy | ConvertTo-Json -Compress',
  teams: 'Get-CsExternalAccessPolicy -Identity Global | ConvertTo-Json -Compress',
  sharepoint: 'Get-SPOTenant | ConvertTo-Json -Compress',
};

function lifecycleRunnerScript(): string {
  return [
    `const { SessionManager } = await import(${JSON.stringify(pathToFileURL(SESSION_MANAGER).href)});`,
    `const config = ${JSON.stringify({
      tenantSlug: SLUG,
      tenantId: CONFIG.tenant.tenant_id,
      appId: CONFIG.auth.app_id,
      certPath: CONFIG.auth.cert_path,
      certThumbprint: CONFIG.auth.cert_thumbprint,
      domain: CONFIG.tenant.domain,
      targetTenantDomain: CONFIG.tenant.domain,
      endpoints: CONFIG.endpoints,
      subscriptionId: CONFIG.subscription!.subscription_id,
    })};`,
    `const commands = ${JSON.stringify(EXECUTE_COMMANDS)};`,
    `const sm = new SessionManager(config);`,
    `const results = {};`,
    `for (const [type, command] of Object.entries(commands)) {`,
    `  await sm.ensureConnected(type);`,
    `  const r = await sm.execute(type, command);`,
    `  results[type] = { exitCode: r.exitCode, stdoutLen: r.stdout.trim().length, stderrHead: r.stderr.trim().slice(0, 200) };`,
    `}`,
    `await sm.disconnectAll();`,
    `const states = sm.getAllSessionStates().map((s) => ({ type: s.type, connected: s.connected }));`,
    `console.log('LIFECYCLE::' + JSON.stringify({ results, states }));`,
    `process.exit(0);`,
    '',
  ].join('\n');
}

describe.skipIf(!stamperAvailable)('backlog-S4: full Stamper session lifecycle against the sim', () => {
  let dir: string;
  let handle: ServeHandle;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-s4-'));
    const tenantRoot = path.join(dir, 'tenant');
    await seedTenant({ stance: 'm365_azure', slug: SLUG, profilesDir: PROFILES_DIR, tenantRoot });
    handle = await startServe({ stance: 'm365_azure', slug: SLUG, port: 0, profilesDir: PROFILES_DIR, tenantRoot });

    const psHomeModules = await getPowerShellHostModulesPath();
    env = buildShadowedEnv(process.env, PSMODULES_DIR, psHomeModules);
    env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
  }, 120_000);

  afterAll(async () => {
    await handle?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it(
    'sign-in -> connect -> execute -> disconnect across all six session types (real SessionManager)',
    async () => {
      const runnerPath = path.join(dir, 's4-lifecycle-runner.mts');
      await fs.writeFile(runnerPath, lifecycleRunnerScript(), 'utf8');

      const result = await runProcess(process.execPath, [TSX_CLI, runnerPath], env);
      if (result.exitCode !== 0) {
        throw new Error(
          `lifecycle runner failed (exit ${result.exitCode})\n--- stdout ---\n${result.stdout.slice(-4000)}\n--- stderr ---\n${result.stderr.slice(-2000)}`,
        );
      }

      const line = result.stdout.split('\n').find((l) => l.startsWith('LIFECYCLE::'));
      expect(line, `runner stdout tail:\n${result.stdout.slice(-2000)}`).toBeDefined();
      const { results, states } = JSON.parse(line!.slice('LIFECYCLE::'.length)) as {
        results: Record<string, { exitCode: number; stdoutLen: number; stderrHead: string }>;
        states: Array<{ type: string; connected: boolean }>;
      };

      for (const type of Object.keys(EXECUTE_COMMANDS)) {
        const r = results[type];
        expect(r, `no result for session type "${type}"`).toBeDefined();
        expect(r.exitCode, `${type} execute failed: ${r.stderrHead}`).toBe(0);
      }
      // Disconnect leg: every session state reports disconnected.
      for (const s of states) {
        expect(s.connected, `session "${s.type}" still connected after disconnectAll`).toBe(false);
      }
    },
    300_000,
  );
});
