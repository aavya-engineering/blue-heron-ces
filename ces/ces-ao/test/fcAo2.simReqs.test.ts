// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-AO-2 step 4 (2026-09-28): tenant-stacksim's REQs against AO, one test per op.
//
//  - REQ-ces-ao-paired-reads (A-07, B-05, B-08, C-09, D-03): the paired read (get_command) must look
//    at the field the set changes, or get-then-set can never observe the write (stateChanged=false).
//  - REQ-ces-ao-matrix-inputs, command-text rows (D-02, E-07) and matrix-input rows (A-05, A-06,
//    A-20, F-08, H-01).
//
// Production code under test: the registry templates through RegistryBridge.translateAoCommandToCommandEntry,
// the production read-only guard (GetThenSetExecutor.readOnlyViolation), and the matrix's own input
// table (test/integration/opInputs.ts). The sim-side proof of each is the 95-op matrix
// (test/integration/ao95.matrix.stacksim.test.ts, AO_STACKSIM_IT=1).

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { translateAoCommandToCommandEntry } from '../src/registry/RegistryBridge.js';
import { readOnlyViolation } from '../src/execution/GetThenSetExecutor.js';
import { getCommand } from '../src/execution/invokeCommand.js';
import { inputsFor } from './integration/opInputs.js';

const entry = (id: string) => translateAoCommandToCommandEntry(getCommand(id)!);

describe('FC-AO-2 paired reads observe the field the set changes', () => {
  it('A-07: the set enables the Microsoft Authenticator configuration; the read reads that configuration state', () => {
    const e = entry('A-07');
    expect(e.set_command).toMatch(/AuthenticationMethodConfigurationId 'MicrosoftAuthenticator'\s+-State 'enabled'/);
    expect(e.get_command).toMatch(/-Method GET\b/);
    expect(e.get_command).toContain('/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/MicrosoftAuthenticator');
    expect(e.get_command).toMatch(/Select-Object id,state/);
    expect(e.get_command).not.toMatch(/Get-MgUserAuthenticationMethod\b/);
  });

  it('B-05: wipe/retire are queued in managementState; the read projects ManagementState', () => {
    const e = entry('B-05');
    expect(e.set_command).toMatch(/Clear-MgDeviceManagementManagedDevice/);
    expect(e.get_command).toMatch(/-Property [^|]*\bManagementState\b/);
    expect(e.get_command).toMatch(/\| Select-Object [^|]*\bManagementState\b/);
  });

  it("B-08: the set adds an app to the policy's apps; the read reads THAT policy's apps", () => {
    const e = entry('B-08');
    const setPolicy = /New-MgDeviceAppManagementAndroidManagedAppProtectionApp\s+-AndroidManagedAppProtectionId '([^']+)'/.exec(e.set_command)?.[1];
    const getPolicy = /Get-MgDeviceAppManagementAndroidManagedAppProtectionApp\s+-AndroidManagedAppProtectionId '([^']+)'/.exec(e.get_command)?.[1];
    expect(setPolicy).toBe('{appProtectionPolicyId}');
    expect(getPolicy).toBe(setPolicy);
    expect(e.get_command).toMatch(/MobileAppIdentifier/);
  });

  it("C-09: the set writes BannedPasswordList/LockoutThreshold of 'Password Rule Settings'; the read reads those values", () => {
    const e = entry('C-09');
    for (const f of ['BannedPasswordList', 'LockoutThreshold']) {
      expect(e.set_command).toContain(`$_.Name -eq '${f}'`);
      expect(e.get_command).toContain(`'${f}'`);
    }
    expect(e.get_command).toContain("$_.DisplayName -eq 'Password Rule Settings'");
    expect(e.get_command).toMatch(/Select-Object -ExpandProperty Values/);
    expect(e.get_command).not.toMatch(/Get-MgPolicyAuthorizationPolicy|az ad auth/);
  });

  it('D-03: the read reads the case + hold the set opens (same names) and the AccountEnabled it flips; eDiscovery is spelled right', () => {
    const e = entry('D-03');
    expect(e.set_command).toContain("New-ComplianceCase -Name 'CUI-Exfil-{incidentId}' -CaseType eDiscovery");
    expect(e.set_command).not.toMatch(/eDscovery/);
    expect(e.get_command).toContain("Get-ComplianceCase -Identity 'CUI-Exfil-{incidentId}'");
    expect(e.get_command).toContain("Get-CaseHoldPolicy -Case 'CUI-Exfil-{incidentId}'");
    expect(e.set_command).toMatch(/Update-MgUser -UserId '\{targetUPN\}' -AccountEnabled:\$false/);
    expect(e.get_command).toMatch(/Get-MgUser -UserId '\{targetUPN\}'[^|]*\| Select-Object [^;]*AccountEnabled/);
    expect(e.get_command).not.toMatch(/Search-UnifiedAuditLog/);
  });

  it('every changed paired read passes the production read-only guard', () => {
    for (const id of ['A-07', 'B-05', 'B-08', 'C-09', 'D-03']) {
      expect(readOnlyViolation(entry(id).get_command), id).toBeUndefined();
    }
  });
});

describe('FC-AO-2 command text (REQ-ces-ao-matrix-inputs)', () => {
  it('D-02: every statement emits its own output (ConvertTo-Json), so a connect object cannot fix the table columns', () => {
    const statements = entry('D-02').get_command.split(/\s;\s/).map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBe(2);
    for (const s of statements) expect(s).toMatch(/\| ConvertTo-Json -Depth \d+ -Compress$/);
  });

  it("E-07: -Operations names are quoted ('Add member to role.','Activate role')", () => {
    expect(entry('E-07').get_command).toContain("-Operations 'Add member to role.','Activate role'");
  });

  it('E-07: role changes are searched under the AzureActiveDirectory record type (not sign-ins / Teams)', () => {
    const g = entry('E-07').get_command;
    expect(g).toMatch(/-RecordType AzureActiveDirectory\s/);
    expect(g).not.toMatch(/AzureActiveDirectoryAccountLogon|MicrosoftTeams/);
  });

  it.skipIf(process.platform !== 'win32')('E-07: the PowerShell parser binds BOTH operation names to -Operations (one array argument)', () => {
    const cmd = entry('E-07').get_command;
    const script = [
      '$ast = [System.Management.Automation.Language.Parser]::ParseInput($env:AO_E07_CMD, [ref]$null, [ref]$null)',
      "$c = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Search-UnifiedAuditLog' }, $true) | Select-Object -First 1",
      '$els = @($c.CommandElements)',
      "$i = [array]::FindIndex($els, [Predicate[object]]{ param($x) $x -is [System.Management.Automation.Language.CommandParameterAst] -and $x.ParameterName -eq 'Operations' })",
      '$arg = $els[$i + 1]',
      "$vals = if ($arg -is [System.Management.Automation.Language.ArrayLiteralAst]) { @($arg.Elements | ForEach-Object { $_.Value }) } else { @($arg.Extent.Text) }",
      "@{ ops = $vals; kind = $arg.GetType().Name } | ConvertTo-Json -Compress",
    ].join('; ');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, AO_E07_CMD: cmd },
      encoding: 'utf-8',
      timeout: 60_000,
    });
    const parsed = JSON.parse(out.trim());
    expect(parsed.kind).toBe('ArrayLiteralAst');
    expect(parsed.ops).toEqual(['Add member to role.', 'Activate role']);
  }, 60_000);
});

describe('FC-AO-2 matrix inputs (REQ-ces-ao-matrix-inputs)', () => {
  const inp = (id: string) => inputsFor(getCommand(id)!);

  it('A-05/A-06 act on their own seeded, enabled user — not sim.user4, which A-02 already disabled', () => {
    expect(inp('A-02').upn).toBe('sim.user4@simtenant.onmicrosoft.us');
    for (const id of ['A-05', 'A-06']) {
      expect(inp(id).targetUPN).toBe('sim.inactive1@simtenant.onmicrosoft.us');
      expect(inp(id).targetUPN).not.toBe(inp('A-02').upn);
    }
  });

  it('A-20 names the seeded duplicate pair, so the dedupe has something to do', () => {
    expect(inp('A-20').policyDisplayName).toBe('Sim Duplicate CA Policy');
  });

  it('F-08 drifts an ARM resource id (az resource update --ids), not a CA policy id', () => {
    const i = inp('F-08');
    expect(i.driftResourceId).toMatch(/^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Storage\/storageAccounts\/simstorage1$/);
    expect(i.driftProperty).toBe('supportsHttpsTrafficOnly');
    expect(i.expectedValue).toBe('true');
  });

  it('H-01 triages an incident id, not an alert id', () => {
    expect(inp('H-01').incidentId).toBe('incident-1');
  });
});
