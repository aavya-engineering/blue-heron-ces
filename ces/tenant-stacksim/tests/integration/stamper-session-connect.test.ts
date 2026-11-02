// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedTenant } from '../../src/cli/commands/seed.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
import { buildSimTenantConfig } from '../../src/config/SimTenantConfig.js';
import {
  buildShadowedEnv,
  getPowerShellHostModulesPath,
  runProcess,
} from '../../src/coverage/psHarness.js';

/**
 * Stamper SessionManager connect-flow smoke test (--stacksim integration).
 *
 * ces-stamper's SessionManager.connect() spawns powershell.exe running
 * session-host.ps1 and sends one init script per session type: the
 * SESSION_MODULE_MAP imports, buildConnectCommand()'s output wrapped in
 * try/catch, `$ErrorActionPreference = "Stop"`, and a
 * STAMPER_SESSION_CONNECTED echo — followed by a best-effort identity probe
 * (getIdentityCommand()). This test replays those exact scripts (transcribed
 * verbatim from ces-stamper/src/core/SessionManager.ts) inside a shadowed
 * PowerShell session against a live sim server, proving `stamper gui
 * --stacksim` can bring up graph/azure/exchange/purview sessions.
 *
 * sharepoint and teams are intentionally NOT covered: sharepoint's connect
 * command reads a real certificate from Cert:\CurrentUser\My\<thumbprint>
 * (the sim has no cert), and teams has no fake module — both remain
 * unsupported under --stacksim.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PSMODULES_DIR = path.join(SIM_ROOT, 'psmodules');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');

/** Transcribed verbatim from SessionManager.ts GRAPH_MODULE_IMPORTS (lines 49-63). */
const GRAPH_MODULE_IMPORTS = [
  'Import-Module Microsoft.Graph.Authentication -RequiredVersion 2.35.1 -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.Governance -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Users -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.DirectoryManagement -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Groups -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.ConditionalAccess -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.DeviceManagement -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.SignIns -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.Authentication -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Reports -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Domains -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Applications -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.DirectoryObjects -Force -ErrorAction SilentlyContinue',
];

/** Transcribed verbatim from SessionManager.ts SESSION_MODULE_MAP.azure. */
const AZURE_MODULE_IMPORTS = [
  'Import-Module Az.Monitor -Force -ErrorAction SilentlyContinue',
  'Import-Module Az.Storage -Force -ErrorAction SilentlyContinue',
];

const SLUG = 'stamper-smoke';
const CONFIG = buildSimTenantConfig({ slug: SLUG, tenantStance: 'm365_azure' });
const TID = CONFIG.tenant.tenant_id;
const AID = CONFIG.auth.app_id;
const CT = CONFIG.auth.cert_thumbprint;
const DOMAIN = CONFIG.tenant.domain;
const SUB_ID = CONFIG.subscription!.subscription_id;

/** Connect commands transcribed verbatim from SessionManager.buildConnectCommand(). */
const CONNECT_COMMANDS: Record<string, string> = {
  graph: `Connect-MgGraph -TenantId "${TID}" -ClientId "${AID}" -CertificateThumbprint "${CT}" -Environment USGov -NoWelcome`,
  exchange: `Connect-ExchangeOnline -AppId "${AID}" -Organization "${DOMAIN}" -CertificateThumbprint "${CT}" -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false`,
  purview: `Connect-IPPSSession -AppId "${AID}" -Organization "${DOMAIN}" -CertificateThumbprint "${CT}" -ConnectionUri "https://ps.compliance.protection.office365.us/powershell-liveid/" -AzureADAuthorizationEndpointUri "https://login.microsoftonline.us/organizations"`,
  azure: `Connect-AzAccount -ServicePrincipal -TenantId "${TID}" -ApplicationId "${AID}" -CertificateThumbprint "${CT}" -Environment AzureUSGovernment -Subscription "${SUB_ID}" | Out-Null`,
  teams: `Connect-MicrosoftTeams -TenantId "${TID}" -ApplicationId "${AID}" -CertificateThumbprint "${CT}" -TeamsEnvironmentName TeamsGCCH`,
};

/** Identity probes transcribed verbatim from SessionManager.getIdentityCommand().
 *  teams has none (getIdentityCommand returns null — "Teams SDK has limited
 *  introspection"); the probe line is skipped for it. */
const IDENTITY_COMMANDS: Record<string, string | null> = {
  graph: '(Get-MgContext) | Select-Object -Property ClientId, TenantId, AppName | ConvertTo-Json -Compress',
  azure: '(Get-AzContext).Account | Select-Object -Property Id, Type | ConvertTo-Json -Compress',
  exchange: 'Get-ConnectionInformation | Select-Object -Property UserPrincipalName, Organization, ConnectionUri | ConvertTo-Json -Compress',
  purview: 'Get-ConnectionInformation | Select-Object -Property UserPrincipalName, Organization, ConnectionUri | ConvertTo-Json -Compress',
  teams: null,
};

const SESSION_IMPORTS: Record<string, string[]> = {
  graph: GRAPH_MODULE_IMPORTS,
  exchange: [], // Connect-ExchangeOnline auto-loads its module
  purview: GRAPH_MODULE_IMPORTS, // connectIPPS() loads the graph module set
  azure: AZURE_MODULE_IMPORTS,
  teams: [], // Connect-MicrosoftTeams auto-loads its module
};

/**
 * Mirrors SessionManager.connect()'s init script exactly, then runs the
 * identity probe in the same session (session-host.ps1 keeps one process
 * across both commands; a single script is the equivalent here).
 */
function buildSessionScript(type: string): string {
  const identityCmd = IDENTITY_COMMANDS[type];
  return [
    ...SESSION_IMPORTS[type],
    `try { ${CONNECT_COMMANDS[type]} } catch { Start-Sleep -Seconds 2; ${CONNECT_COMMANDS[type]} }`,
    '$ErrorActionPreference = "Stop"',
    'Write-Output "STAMPER_SESSION_CONNECTED"',
    ...(identityCmd ? [`$identity = ${identityCmd}`, 'Write-Output ("IDENTITY::" + $identity)'] : []),
    '',
  ].join('\n');
}

function extractMarker(stdout: string, marker: string): string | undefined {
  const line = stdout.split('\n').find((l) => l.startsWith(marker));
  return line ? line.slice(marker.length).trim() : undefined;
}

describe('Stamper SessionManager connect flow against the sim (--stacksim smoke)', () => {
  let dir: string;
  let handle: ServeHandle;
  let env: NodeJS.ProcessEnv;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-stamper-connect-'));
    const tenantRoot = path.join(dir, 'tenant');

    await seedTenant({
      stance: 'm365_azure',
      slug: SLUG,
      profilesDir: PROFILES_DIR,
      tenantRoot,
    });
    handle = await startServe({
      stance: 'm365_azure',
      slug: SLUG,
      port: 0,
      profilesDir: PROFILES_DIR,
      tenantRoot,
    });

    const psHomeModules = await getPowerShellHostModulesPath();
    env = buildShadowedEnv(process.env, PSMODULES_DIR, psHomeModules);
    env.STACKSIM_SERVER_URL = `http://127.0.0.1:${handle.port}`;
  }, 60_000);

  afterAll(async () => {
    await handle?.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function runSession(type: string): Promise<{ stdout: string; identity: string | undefined }> {
    const scriptPath = path.join(dir, `connect-${type}.ps1`);
    await fs.writeFile(scriptPath, buildSessionScript(type), 'utf8');
    const result = await runProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      env,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `${type} connect script failed (exit ${result.exitCode})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      );
    }
    expect(result.stdout).toContain('STAMPER_SESSION_CONNECTED');
    return { stdout: result.stdout, identity: extractMarker(result.stdout, 'IDENTITY::') };
  }

  it('connects a graph session and reports the connected principal', async () => {
    const { identity } = await runSession('graph');
    expect(identity).toBeTruthy();
    const parsed = JSON.parse(identity!) as { ClientId: string; TenantId: string; AppName: string };
    expect(parsed.ClientId).toBe(AID);
    expect(parsed.TenantId).toBe(TID);
    expect(parsed.AppName).toBe('tenant-stacksim');
  }, 60_000);

  it('connects an azure session (Connect-AzAccount binds -TenantId and -Subscription)', async () => {
    // Identity probe content is store-backed (derived Get-AzContext) and may
    // be empty on a fresh tenant — the connect itself succeeding is the gate,
    // exactly as SessionManager treats the probe (best-effort, non-fatal).
    await runSession('azure');
  }, 60_000);

  it('connects an exchange session and reports the connection', async () => {
    const { identity } = await runSession('exchange');
    expect(identity).toBeTruthy();
    const parsed = JSON.parse(identity!) as { UserPrincipalName: string; Organization: string; ConnectionUri: string };
    expect(parsed.Organization).toBe(DOMAIN);
    expect(parsed.UserPrincipalName).toBe(`${AID}@${DOMAIN}`);
  }, 60_000);

  it('connects a purview session and reports the IPPS connection URI', async () => {
    const { identity } = await runSession('purview');
    expect(identity).toBeTruthy();
    const parsed = JSON.parse(identity!) as { Organization: string; ConnectionUri: string };
    expect(parsed.Organization).toBe(DOMAIN);
    expect(parsed.ConnectionUri).toBe('https://ps.compliance.protection.office365.us/powershell-liveid/');
  }, 60_000);

  it('connects a teams session and runs the registry teams command against the sim', async () => {
    // teams has no identity probe (getIdentityCommand -> null); prove the
    // session is genuinely usable by running the ONE registry command that
    // rides on the teams engine (its Cs* cmdlets auto-load from the EXO fake).
    const scriptPath = path.join(dir, 'connect-teams-cmd.ps1');
    await fs.writeFile(
      scriptPath,
      buildSessionScript('teams') +
        '\n$policy = Get-CsExternalAccessPolicy -Identity Global | Select-Object EnableFederationAccess\n' +
        'Write-Output ("TEAMS_CMD_OK::" + ($null -ne $policy))\n',
      'utf8',
    );
    const result = await runProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      env,
    );
    if (result.exitCode !== 0) {
      throw new Error(`teams script failed (exit ${result.exitCode})\n${result.stdout}\n${result.stderr}`);
    }
    expect(result.stdout).toContain('STAMPER_SESSION_CONNECTED');
    expect(result.stdout).toContain('TEAMS_CMD_OK::');
  }, 60_000);
});
