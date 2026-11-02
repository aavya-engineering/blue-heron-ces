// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SP-3 (SECRETS-PLAN.md) + tenant-init P-5 (TENANT-INIT-AUDIT.md section 5): Pester-free static checks of
// New-TenantBootstrap.ps1, plus the bootstrap CLI launch and the preflight additions. No tenant is touched.

import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STAMPER = path.join(__dirname, '..', '..');
const SCRIPT = path.join(STAMPER, 'scripts', 'New-TenantBootstrap.ps1');
const ps1 = fs.readFileSync(SCRIPT, 'utf-8');
const cli = fs.readFileSync(path.join(STAMPER, 'src', 'cli', 'index.ts'), 'utf-8');
const execRoutes = fs.readFileSync(path.join(STAMPER, 'src', 'server', 'routes', 'execute.routes.ts'), 'utf-8');

/** Code lines only: drop `#` comment lines and the `<# ... #>` help blocks. */
const code = ps1
  .replace(/<#[\s\S]*?#>/g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');

describe('New-TenantBootstrap.ps1 parses', () => {
  const run = process.platform === 'win32' ? it : it.skip;
  run('has zero PowerShell parse errors', () => {
    const probe =
      "$e=$null; $t=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:CES_TI_SCRIPT,[ref]$t,[ref]$e); $e.Count";
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', probe], {
      env: { ...process.env, CES_TI_SCRIPT: SCRIPT },
      encoding: 'utf-8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('0');
  });

  it('keeps LF line endings', () => {
    expect(ps1.includes('\r')).toBe(false);
  });
});

describe('SP-3: non-exportable key, no PFX, append not replace', () => {
  it('creates the key NonExportable and never Exportable', () => {
    expect(code).toMatch(/-KeyExportPolicy NonExportable/);
    expect(code).not.toMatch(/-KeyExportPolicy Exportable/);
  });

  it('writes no PFX and takes no certificate password', () => {
    expect(code).not.toMatch(/Export-PfxCertificate/);
    expect(code).not.toMatch(/\.pfx/i);
    expect(code).not.toMatch(/CertPassword/);
    expect(code).not.toMatch(/Read-Host -AsSecureString/);
    expect(code).toMatch(/Export-Certificate -Cert \$cert -FilePath \$cerPath/);
  });

  it('merges the new key credential with the existing ones', () => {
    expect(code).toMatch(/\$currentApp = Get-MgApplication -ApplicationId \$appObjectId -Property "id,keyCredentials"/);
    expect(code).toMatch(/\$mergedKeyCredentials = @\(\$existingKeyCredentials\) \+ @\(\$keyCredential\)/);
    expect(code).toMatch(/Update-MgApplication -ApplicationId \$appObjectId -KeyCredentials \$mergedKeyCredentials/);
    expect(code).not.toMatch(/-KeyCredentials @\(\$keyCredential\)/);
  });
});

describe('P-5 tenant-init quick fixes in the script', () => {
  it('grants Exchange.ManageAsApp on Office 365 Exchange Online', () => {
    expect(code).toMatch(/ResourceAppId = "00000002-0000-0ff1-ce00-000000000000".*Permissions = @\("Exchange\.ManageAsApp"\)/);
  });

  it('grants Sites.FullControl.All on Office 365 SharePoint Online', () => {
    expect(code).toMatch(/ResourceAppId = "00000003-0000-0ff1-ce00-000000000000".*Permissions = @\("Sites\.FullControl\.All"\)/);
  });

  it('assigns Contributor + User Access Administrator on the subscription, idempotently', () => {
    expect(code).toMatch(/\$azureRoles = @\("Contributor", "User Access Administrator"\)/);
    expect(code).toMatch(/Get-AzRoleAssignment -ObjectId \$appSP\.Id -RoleDefinitionName \$roleName -Scope \$subscriptionScope/);
    expect(code).toMatch(/New-AzRoleAssignment -ObjectId \$appSP\.Id -RoleDefinitionName \$roleName -Scope \$subscriptionScope/);
    expect(code).toMatch(/\$subscriptionScope = "\/subscriptions\/\$SubscriptionId"/);
  });

  it('turns Security Defaults off only after the operator types yes', () => {
    const prompt = code.indexOf('$sdAnswer = Read-Host');
    const update = code.indexOf('Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy');
    expect(prompt).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(prompt);
    expect(code).toMatch(/if \(\$sdAnswer -eq "yes"\)/);
    expect(code).toMatch(/isEnabled = \$false/);
    expect((code.match(/Update-MgPolicyIdentitySecurityDefaultEnforcementPolicy/g) ?? []).length).toBe(1);
  });

  it('break-glass is VERIFY only: needs two accounts, never creates users', () => {
    expect(code).toMatch(/\$distinctUpns\.Count -lt 2/);
    expect(code).toMatch(/Get-MgUser -Filter "userPrincipalName eq '\$escapedUpn'"/);
    expect(code).toMatch(/OnPremisesSyncEnabled -eq \$true/);
    expect(code).not.toMatch(/New-MgUser|Update-MgUser|New-MgIdentityConditionalAccessPolicy/);
  });

  it('writes a secret-free result file for the tenant record', () => {
    expect(code).toMatch(/schema = "ces-stamper\/bootstrap-result@1"/);
    expect(code).toMatch(/cert_source = "store"/);
    expect(code).toMatch(/ConvertTo-Json -Depth 6 \| Out-File -FilePath \$ResultPath/);
  });

  it('avoids PowerShell-7-only syntax so the 5.1 parser check stays meaningful', () => {
    expect(code).not.toMatch(/\?\?|\?\./);
  });
});

describe('stamper bootstrap CLI command', () => {
  const start = cli.indexOf(".command('bootstrap')");
  const end = cli.indexOf('program', start + 10);
  const block = cli.slice(start, end);

  it('launches pwsh with a clear missing-pwsh error, never powershell.exe', () => {
    expect(block).toMatch(/spawn\(BOOTSTRAP_PWSH, psArgs/);
    expect(block).not.toMatch(/spawn\('powershell\.exe'/);
    expect(block).toMatch(/describeBootstrapSpawnError\(error\)/);
  });

  it('passes the result path and writes the registry record', () => {
    expect(block).toMatch(/'-ResultPath', resultPath/);
    expect(block).toMatch(/writeBootstrapTenantRecord\(result, slug\)/);
    expect(block).not.toMatch(/cert-password|CertPassword/);
  });
});

describe('preflight additions', () => {
  it('keeps Teams Administrator and the non-Graph app permissions in the code', () => {
    expect(execRoutes).toMatch(/name: 'Teams Administrator'/);
    expect(execRoutes).toMatch(/permission: 'Exchange\.ManageAsApp', held: false/);
    expect(execRoutes).toMatch(/permission: 'Sites\.FullControl\.All', held: true/);
  });

  it('break-glass VERIFY never creates accounts', () => {
    const s = execRoutes.indexOf('Phase 5c: Break-glass VERIFY');
    const e = execRoutes.indexOf('---- Summary + done ----', s);
    const block = execRoutes.slice(s, e);
    expect(s).toBeGreaterThan(0);
    expect(block).toMatch(/BREAK_GLASS_MIN_ACCOUNTS/);
    expect(block).toMatch(/Get-MgUser -Filter/);
    expect(block).not.toMatch(/New-MgUser|Update-MgUser/);
  });

  it('leaves the other directory roles unheld', () => {
    expect(execRoutes).toMatch(/\{ name: 'Exchange Administrator', held: false \}/);
    expect(execRoutes).toMatch(/\{ name: 'SharePoint Administrator', held: false \}/);
    expect(execRoutes).toMatch(/\{ name: 'Compliance Administrator', held: false \}/);
    expect(execRoutes).toMatch(/\{ name: 'Teams Administrator', held: true \}/);
  });

  it('leaves the HELD AC.L2-3.1.2.role-assign entry alone (no reference added)', () => {
    expect(execRoutes).not.toMatch(/AC\.L2-3\.1\.2\.role-assign/);
  });
});

describe('HOLD-ROLES: held standing grants are off by default', () => {
  it('preflight gates both held grants on one flag, off unless exactly true', () => {
    expect(execRoutes).toMatch(/const HELD_STANDING_GRANTS_ENABLED = process\.env\.CES_HELD_STANDING_GRANTS_ENABLED === 'true';/);
    expect(execRoutes).toMatch(/ALL_DIRECTORY_ROLES\s*\.filter\(\(r\) => !r\.held \|\| HELD_STANDING_GRANTS_ENABLED\)/);
    expect(execRoutes).toMatch(/ALL_RESOURCE_APP_ROLES\.filter\(\(rp\) => !rp\.held \|\| HELD_STANDING_GRANTS_ENABLED\)/);
  });

  it('preflight reports held steps as held (founder decision pending), not failed', () => {
    expect(execRoutes).toMatch(/const HELD_DETAIL = 'founder decision pending';/);
    expect(execRoutes).toMatch(/phase: 'directory_role', name: heldRole, status: 'held', detail: HELD_DETAIL/);
    expect(execRoutes).toMatch(/phase: 'graph_permission', name: `\$\{hp\.permission\} \(\$\{hp\.resourceName\}\)`, status: 'held', detail: HELD_DETAIL/);
    expect(execRoutes).toMatch(/held: HELD_DIRECTORY_ROLES\.length/);
    expect(execRoutes).toMatch(/held: HELD_RESOURCE_APP_ROLES\.length/);
  });

  it('bootstrap skips Sites.FullControl.All unless the same flag is true', () => {
    expect(code).toMatch(/\$heldStandingGrantsEnabled = \(\$env:CES_HELD_STANDING_GRANTS_ENABLED -eq 'true'\)/);
    expect(code).toMatch(/Permissions = @\("Sites\.FullControl\.All"\); Held = \$true/);
    expect(code).toMatch(/Permissions = @\("Exchange\.ManageAsApp"\); Held = \$false/);
    expect(code).toMatch(/if \(\$resource\.Held -and -not \$heldStandingGrantsEnabled\)/);
    expect(code).toMatch(/held \(founder decision pending\)/);
    expect(code).toMatch(/held = @\(\$heldPermissions\)/);
  });

  it('bootstrap never assigns the Teams Administrator directory role', () => {
    expect(code).not.toMatch(/New-MgRoleManagementDirectoryRoleAssignment/);
  });
});

describe('SIM-BL: BitLockerKey.ReadBasic.All for SC.L2-3.13.10.key-escrow', () => {
  const ps1Graph = (code.match(/\$requiredPermissions = @\(([\s\S]*?)\n\)/)?.[1] ?? '').match(/"[^"]+"/g)?.map((s) => s.slice(1, -1)) ?? [];
  const tsGraph = (execRoutes.match(/const REQUIRED_GRAPH_PERMISSIONS = \[([\s\S]*?)\];/)?.[1] ?? '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    .match(/'[^']+'/g)?.map((s) => s.slice(1, -1)) ?? [];

  it('both Graph permission lists carry it', () => {
    expect(ps1Graph).toContain('BitLockerKey.ReadBasic.All');
    expect(tsGraph).toContain('BitLockerKey.ReadBasic.All');
  });

  it('the bootstrap and preflight Graph lists are the same set', () => {
    expect(ps1Graph.length).toBeGreaterThan(20);
    expect([...ps1Graph].sort()).toEqual([...tsGraph].sort());
  });

  it('is read-only and not a held standing grant', () => {
    expect(execRoutes).not.toMatch(/BitLockerKey\.ReadWrite/);
    expect(code).not.toMatch(/BitLockerKey\.ReadWrite/);
    expect(execRoutes).not.toMatch(/permission: 'BitLockerKey[^']*'/);
    expect(code).not.toMatch(/Permissions = @\("BitLockerKey/);
  });
});
