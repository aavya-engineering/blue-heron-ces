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
import { loadProfile, resolveProfilePath } from '../../src/profiles/ProfileLoader.js';
import { SeedEngine } from '../../src/seed/SeedEngine.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';

/**
 * M4 gate (PLAN.md Milestone Ladder row M4; File Inventory rows tagged M4;
 * DOC checks 1 and 3; task instructions for this milestone).
 *
 * Test gate (PLAN.md M4 row): executing AO's A-18 template command mutates
 * the store; the matching audit entry is readable via
 * Get-MgAuditLogDirectoryAudit in the same shadowed session AND appears in
 * ledger.jsonl; Stamper's equivalent mutation is independently verified
 * against the store.
 *
 * AO's A-18 set_command, quoted verbatim from
 * ces-ao/src/registry/TemplateRegistry.ts:59-62:
 *   Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/authorizationPolicy'
 *     -Body @{ defaultUserRolePermissions=@{ allowedToCreateApps=$false;
 *              allowedToCreateSecurityGroups=$false; allowedToCreateTenants=$false } }
 *
 * Stamper's baseline-stamping template for an authorization-policy-class
 * control, quoted verbatim from
 * ces-stamper/src/registry/cmmc-l2-commands.registry.json, entry_id
 * "IA.L2-3.5.3.fido2-enable" (set_command, line 1704):
 *   Invoke-MgGraphRequest -Method PATCH
 *     -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2'
 *     -Body (@{state='enabled'} | ConvertTo-Json) -ContentType 'application/json'
 *
 * A targeted read of ces-stamper's own template source
 * (src/core/BaselineProvisioner.ts, and a grep across ces-stamper/src for
 * "authorizationPolicy"/"defaultUserRolePermissions"/"allowInvitesFrom") found
 * BaselineProvisioner.ts covers Azure infrastructure resources only (Resource
 * Group, LAW, Storage, KeyVault, CMK, Automation, VNet, Subnet, NSG - all
 * New-Az / Get-Az commands), and Stamper's registry
 * (cmmc-l2-commands.registry.json) has no entry targeting
 * '/v1.0/policies/authorizationPolicy' at all. IA.L2-3.5.3.fido2-enable is
 * the closest genuine Stamper command in the same policy-singleton class (a
 * Graph `/v1.0/policies/...` resource PATCHed via Invoke-MgGraphRequest) -
 * see IMPLEMENTATION_LOG.md M4 Deviations for the full rationale.
 *
 * Both spawned scripts drive real powershell.exe with the same
 * $env:PSModulePath replacement M2/M3 established (SessionManager.ts in both
 * ces-eo and ces-stamper spawn the identical GRAPH_MODULE_IMPORTS block and
 * the same ces-shared/scripts/session-host.ps1 - confirmed by reading
 * ces-stamper/src/core/SessionManager.ts:43-81).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const PSMODULES_DIR = path.join(SIM_ROOT, 'psmodules');

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

function psModulePathPrelude(): string {
  return `$ErrorActionPreference = 'Stop'\n$env:PSModulePath = '${SIM_ROOT}\\psmodules;' + $PSHOME + '\\Modules'\n\n${GRAPH_MODULE_IMPORTS}\n`;
}

/** AO's A-18 template command, transcribed verbatim (TemplateRegistry.ts:59-62), plus
 * an in-session Get-MgAuditLogDirectoryAudit call (DOC check 3: "in the same shadowed session"). */
function buildAoA18Script(): string {
  return `${psModulePathPrelude()}
Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/authorizationPolicy' -Body @{ defaultUserRolePermissions=@{ allowedToCreateApps=$false; allowedToCreateSecurityGroups=$false; allowedToCreateTenants=$false } } | Out-Null

$audits = Get-MgAuditLogDirectoryAudit | ConvertTo-Json -Depth 5 -Compress
Write-Output ("AUDITS::" + $audits)
Write-Output "AO_A18::ok"
`;
}

/** Stamper's IA.L2-3.5.3.fido2-enable set_command, transcribed verbatim
 * (cmmc-l2-commands.registry.json:1704). */
function buildStamperFido2Script(): string {
  return `${psModulePathPrelude()}
Invoke-MgGraphRequest -Method PATCH -Uri 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2' -Body (@{state='enabled'} | ConvertTo-Json) -ContentType 'application/json' | Out-Null
Write-Output "STAMPER_FIDO2::ok"
`;
}

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runPowershellScript(scriptPath: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
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
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function extractMarker(stdout: string, marker: string): string | undefined {
  const line = stdout.split('\n').find((l) => l.startsWith(marker));
  return line ? line.slice(marker.length).trim() : undefined;
}

describe('M4: write surface (DirectoryAuditWriter + Invoke-MgGraphRequest mutation handling)', () => {
  let tenantRoot: string;
  let handle: ServeHandle;

  beforeEach(async () => {
    tenantRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-m4-'));

    const profile = await loadProfile(resolveProfilePath('m365_azure', PROFILES_DIR));
    handle = await startServe({
      stance: 'm365_azure',
      slug: 'stacksim-test-m4',
      port: 0,
      profilesDir: PROFILES_DIR,
      tenantRoot,
    });

    const seedEngine = new SeedEngine(handle.store, handle.ledger);
    await seedEngine.seed(profile);
  });

  afterEach(async () => {
    await handle.stop();
    await fs.rm(tenantRoot, { recursive: true, force: true });
  });

  it(
    "DOC check 3: AO's A-18 PATCH mutates the store; the matching audit entry is readable via " +
      'Get-MgAuditLogDirectoryAudit in the same shadowed session AND appears in ledger.jsonl',
    async () => {
      const scriptPath = path.join(tenantRoot, 'ao-a18.ps1');
      await fs.writeFile(scriptPath, buildAoA18Script(), 'utf8');

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        STACKSIM_SERVER_URL: `http://127.0.0.1:${handle.port}`,
      };
      const result = await runPowershellScript(scriptPath, env);

      if (result.exitCode !== 0) {
        throw new Error(
          `AO A-18 script failed (exit ${result.exitCode})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
        );
      }
      expect(extractMarker(result.stdout, 'AO_A18::')).toBe('ok');

      // "mutates the store" - re-read via the sim's ObjectStore directly (server-owned, Core Design (f)).
      const stored = await handle.store.read('authorizationPolicy', 'authorizationPolicy');
      expect(stored?.defaultUserRolePermissions).toEqual({
        allowedToCreateApps: false,
        allowedToCreateSecurityGroups: false,
        allowedToCreateTenants: false,
      });

      // "readable via Get-MgAuditLogDirectoryAudit in the same shadowed session"
      const auditsRaw = extractMarker(result.stdout, 'AUDITS::');
      expect(auditsRaw, `stdout was:\n${result.stdout}`).toBeDefined();
      const audits = JSON.parse(auditsRaw!) as
        | { targetResources: Array<{ id: string; type: string }> }
        | Array<{ targetResources: Array<{ id: string; type: string }> }>;
      const auditList = Array.isArray(audits) ? audits : [audits];
      expect(auditList.length).toBeGreaterThan(0);
      expect(auditList.some((a) => a.targetResources[0]?.id === 'authorizationPolicy')).toBe(true);

      // "AND appears in ledger.jsonl"
      const ledgerEntries = await handle.ledger.query({ type: 'mutate', objectType: 'authorizationPolicy' });
      expect(ledgerEntries.length).toBeGreaterThan(0);
      expect(ledgerEntries[0].source).toBe('/v1.0/policies/authorizationPolicy');
    },
    60_000,
  );

  it(
    "DOC check 1: Stamper's baseline-stamping template for an authorization-policy-class control " +
      '(IA.L2-3.5.3.fido2-enable) mutates the sim tenant; the mutation is visible in the object store on re-read, ' +
      'independently of AO\'s A-18 path, verified against the same running store instance',
    async () => {
      const scriptPath = path.join(tenantRoot, 'stamper-fido2.ps1');
      await fs.writeFile(scriptPath, buildStamperFido2Script(), 'utf8');

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        STACKSIM_SERVER_URL: `http://127.0.0.1:${handle.port}`,
      };
      const result = await runPowershellScript(scriptPath, env);

      if (result.exitCode !== 0) {
        throw new Error(
          `Stamper Fido2 script failed (exit ${result.exitCode})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
        );
      }
      expect(extractMarker(result.stdout, 'STAMPER_FIDO2::')).toBe('ok');

      // "mutation is visible in the object store on re-read" (DOC check 1) - same
      // handle.store instance the AO test above also reads (Core Design (f):
      // stacksim serve is the sole owner of store.json).
      const stored = await handle.store.read('authenticationMethodsPolicyConfigurations', 'Fido2');
      expect(stored?.state).toBe('enabled');

      // DirectoryAuditWriter fires for every mutation, not just A-18's.
      const audits = await handle.store.list('directoryAudits');
      expect(audits.some((a) => (a.targetResources as Array<{ id: string }>)[0]?.id === 'Fido2')).toBe(true);

      const ledgerEntries = await handle.ledger.query({
        type: 'mutate',
        objectType: 'authenticationMethodsPolicyConfigurations',
      });
      expect(ledgerEntries.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it('gate-of-record: PSModules directory used by both scripts is the sim\'s own (not a real install)', async () => {
    const authManifest = await fs.readFile(
      path.join(PSMODULES_DIR, 'Microsoft.Graph.Authentication', 'Microsoft.Graph.Authentication.psd1'),
      'utf8',
    );
    expect(authManifest).toContain("ModuleVersion = '2.35.1'");
  });
});
