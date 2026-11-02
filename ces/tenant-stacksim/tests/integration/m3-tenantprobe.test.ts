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
import { writeSimTenantConfig } from '../../src/config/SimTenantConfig.js';

/**
 * M3 gate (PLAN.md Milestone Ladder row M3; File Inventory rows tagged M3;
 * task instructions for this milestone).
 *
 * Runs the REAL, unmodified `tenant-tests/lib/TenantProbe.psm1`
 * (Connect-EutTenant + Invoke-EutGraph) against a seeded m365_azure sim
 * tenant, and reproduces the exact "MFA required for all users (network
 * access)" assertion from `tenant-tests/cases/UC-A.identity.ps1` (lines
 * 9-11, transcribed verbatim below):
 *
 *   try { $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and (@($_.grantControls.builtInControls) -contains 'mfa') -and (@($_.conditions.users.includeUsers) -contains 'All') })
 *       if($p.Count){ New-EutVerdict PASS "MFA CA policy enabled for All users: '$($p[0].displayName)' (MFA implemented for network access to non-priv [c] and priv [d] accounts)" } else { New-EutVerdict FAIL 'no enabled all-user MFA CA policy' } } catch { Resolve-EutProbeError $_ -What 'CA read' }
 *
 * TenantProbe.psm1:Get-EutTenantConfig reads tenant config from
 * `$env:CES_STAMPER_TENANTS_DIR\$TenantSlug.json` when that is set, else
 * `$HOME\.stamper\tenants\$TenantSlug.json` (a spawned powershell.exe's
 * automatic $HOME does not follow a modified USERPROFILE, so an env-var
 * override is the only safe redirect). PL-123 / CR-17: this test writes the
 * sim tenant config under its own temp root and points
 * CES_STAMPER_TENANTS_DIR there; it never touches the real ~/.stamper.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');
const TENANT_TESTS_ROOT = path.resolve(SIM_ROOT, '..', 'tenant-tests');
const TENANT_PROBE_PATH = path.join(TENANT_TESTS_ROOT, 'lib', 'TenantProbe.psm1');
const TENANT_SLUG = 'stacksim-test-m3';

/**
 * Builds the PowerShell script that: (1) shadows PSModulePath exactly as
 * M2's spike does; (2) imports the real, unmodified TenantProbe.psm1 by
 * path (read-only; never modified); (3) calls Connect-EutTenant; (4) runs
 * UC-A.identity.ps1's MFA-CA-policy assertion verbatim; (5) as a secondary
 * M3-deliverable smoke check, imports Az.Accounts/ExchangeOnlineManagement
 * (the same real module names TenantProbe.psm1:85/143 import) and calls
 * their no-op connect cmdlets directly, proving those M3 fake modules
 * resolve and execute without error under the shadowed PSModulePath.
 */
function buildProbeScript(): string {
  return `$ErrorActionPreference = 'Stop'
$env:PSModulePath = '${SIM_ROOT}\\psmodules;' + $PSHOME + '\\Modules'

Import-Module '${TENANT_PROBE_PATH}' -Force -ErrorAction Stop

Connect-EutTenant -TenantSlug '${TENANT_SLUG}' | Out-Null

$verdict = & {
    try { $p=@(Get-EutGraphValue '/v1.0/identity/conditionalAccess/policies' | Where-Object { $_.state -eq 'enabled' -and (@($_.grantControls.builtInControls) -contains 'mfa') -and (@($_.conditions.users.includeUsers) -contains 'All') })
        if($p.Count){ New-EutVerdict PASS "MFA CA policy enabled for All users: '$($p[0].displayName)' (MFA implemented for network access to non-priv [c] and priv [d] accounts)" } else { New-EutVerdict FAIL 'no enabled all-user MFA CA policy' } } catch { Resolve-EutProbeError $_ -What 'CA read' }
}
Write-Output ("VERDICT::" + ($verdict | ConvertTo-Json -Depth 5 -Compress))

# M3-deliverable smoke check: Az.Accounts / ExchangeOnlineManagement fake
# modules resolve over the shadowed PSModulePath and their no-op connect
# cmdlets execute without throwing (TenantProbe.psm1:85/143 import these
# same real module names from Invoke-EutExo/Invoke-EutArm).
Import-Module Az.Accounts -ErrorAction Stop
$azCtx = Connect-AzAccount -ServicePrincipal -ApplicationId 'sim-app' -CertificateThumbprint 'SIMTHUMB' -Tenant 'sim-tenant' -Environment AzureUSGovernment
$null = Set-AzContext -Subscription 'sim-sub' -ErrorAction Stop
Import-Module ExchangeOnlineManagement -ErrorAction Stop
$null = Connect-ExchangeOnline -AppId 'sim-app' -CertificateThumbprint 'SIMTHUMB' -Organization 'sim.onmicrosoft.us' -ExchangeEnvironmentName 'O365USGovGCCHighSim' -ShowBanner:$false
$null = Connect-IPPSSession -AppId 'sim-app' -CertificateThumbprint 'SIMTHUMB' -Organization 'sim.onmicrosoft.us' -ConnectionUri 'https://ps.compliance.protection.office365.us/powershell-liveid/' -AzureADAuthorizationEndpointUri 'https://login.microsoftonline.us/organizations' -ShowBanner:$false
Write-Output ("AZ_AND_EXO_SMOKE::ok")
`;
}

interface ProbeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runPowershellScript(scriptPath: string, env: NodeJS.ProcessEnv): Promise<ProbeResult> {
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

describe('M3: unmodified TenantProbe.psm1 against a seeded m365_azure sim tenant', () => {
  let tenantRoot: string;
  let handle: ServeHandle;
  let flatConfigPath: string | undefined;

  beforeEach(async () => {
    tenantRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-m3-'));

    const profile = await loadProfile(resolveProfilePath('m365_azure', PROFILES_DIR));
    handle = await startServe({
      stance: 'm365_azure',
      slug: TENANT_SLUG,
      port: 0,
      profilesDir: PROFILES_DIR,
      tenantRoot,
    });

    const seedEngine = new SeedEngine(handle.store, handle.ledger);
    await seedEngine.seed(profile);

    // UC-A.identity.ps1's MFA-all-users assertion requires a CA policy
    // shaped exactly like a real "require MFA for all users" policy
    // (state/grantControls.builtInControls/conditions.users.includeUsers);
    // M1's generateCaPolicies() only produces bare {id, displayName, state}
    // objects (no grantControls/conditions), so this test seeds one
    // additional, correctly-shaped policy directly via ObjectStore.create,
    // rather than modifying the shared M1 generator (which M2's golden
    // fixture depends on byte-for-byte).
    await handle.store.create('caPolicies', {
      id: 'caPolicy-mfa-all-users',
      displayName: 'Require MFA for All Users',
      state: 'enabled',
      grantControls: { builtInControls: ['mfa'] },
      conditions: { users: { includeUsers: ['All'] } },
    });

    // PL-123 / CR-17: TenantProbe.psm1:Get-EutTenantConfig now honours
    // CES_STAMPER_TENANTS_DIR, so the flat config goes under this test's temp
    // root (homeDir = tenantRoot), never the real ~/.stamper/tenants. It is
    // still removed in afterEach.
    const written = await writeSimTenantConfig(
      { slug: TENANT_SLUG, tenantStance: 'm365_azure', port: handle.port },
      { emitFlat: true, homeDir: tenantRoot },
    );
    flatConfigPath = written.flatPath;
    expect(path.resolve(flatConfigPath!).startsWith(path.resolve(tenantRoot) + path.sep)).toBe(true);
  });

  afterEach(async () => {
    await handle.stop();
    await fs.rm(tenantRoot, { recursive: true, force: true });
    if (flatConfigPath) {
      await fs.rm(flatConfigPath, { force: true });
      flatConfigPath = undefined;
    }
  });

  it(
    'Connect-EutTenant + Invoke-EutGraph reproduce the UC-A MFA-CA-policy assertion and return a PASS-shaped New-EutVerdict',
    async () => {
      const scriptPath = path.join(tenantRoot, 'probe.ps1');
      await fs.writeFile(scriptPath, buildProbeScript(), 'utf8');

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        STACKSIM_SERVER_URL: `http://127.0.0.1:${handle.port}`,
        CES_STAMPER_TENANTS_DIR: path.join(tenantRoot, '.stamper', 'tenants'),
      };

      const result = await runPowershellScript(scriptPath, env);

      if (result.exitCode !== 0) {
        throw new Error(
          `probe script failed (exit ${result.exitCode})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
        );
      }

      const verdictRaw = extractMarker(result.stdout, 'VERDICT::');
      expect(verdictRaw, `stdout was:\n${result.stdout}`).toBeDefined();
      const verdict = JSON.parse(verdictRaw!) as { Verdict: string; Detail: string };
      expect(verdict.Verdict).toBe('PASS');
      expect(verdict.Detail).toContain('MFA CA policy enabled for All users');

      const azExoSmoke = extractMarker(result.stdout, 'AZ_AND_EXO_SMOKE::');
      expect(azExoSmoke, `stdout was:\n${result.stdout}`).toBe('ok');
    },
    60_000,
  );
});
