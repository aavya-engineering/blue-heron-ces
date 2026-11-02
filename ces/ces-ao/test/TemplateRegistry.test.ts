// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { getCommandTemplates } from '../src/registry/TemplateRegistry.js';
import { readOnlyViolation } from '../src/execution/GetThenSetExecutor.js';

// Characterization tests for the static template lookup table.
describe('getCommandTemplates', () => {
  it('returns an AUDIT command template with empty set_command and populated get_command (A-09)', () => {
    const t = getCommandTemplates('A-09');
    expect(t).not.toBeNull();
    expect(t!.set_command).toBe('');
    expect(t!.get_command).toContain('Get-MgRoleManagementDirectoryRoleEligibilitySchedule');
  });

  it('returns both get and set commands for a write command (A-01)', () => {
    const t = getCommandTemplates('A-01');
    expect(t).not.toBeNull();
    expect(t!.get_command.length).toBeGreaterThan(0);
    expect(t!.set_command.length).toBeGreaterThan(0);
    expect(t!.set_command).toContain('New-MgUser');
  });

  it('uses ${...} dollar-brace placeholders for firewall commands (F-11)', () => {
    const t = getCommandTemplates('F-11');
    expect(t).not.toBeNull();
    expect(t!.set_command).toContain('${firewallName}');
    expect(t!.get_command).toContain('Get-AzFirewall');
  });

  it('returns null for an unmapped command id (stub fallback)', () => {
    expect(getCommandTemplates('UNKNOWN-99')).toBeNull();
  });
});

// W7-AO: A-21 Leaver Lifecycle Workflow Scheduling (PS.L2-3.9.2).
describe('A-21 leaver lifecycle workflow scheduling templates', () => {
  const t = getCommandTemplates('A-21')!;

  it('has both a get and a set command', () => {
    expect(t).not.toBeNull();
    expect(t.get_command.length).toBeGreaterThan(0);
    expect(t.set_command.length).toBeGreaterThan(0);
  });

  it('get is a read the dry-run guard accepts, and names each target workflow with its planned change', () => {
    expect(readOnlyViolation(t.get_command)).toBeUndefined();
    expect(t.get_command).toContain("-Method GET -Uri '/v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks'");
    expect(t.get_command).toContain('displayName');
    expect(t.get_command).toContain('isSchedulingEnabled');
    expect(t.get_command).toContain('plannedChange');
    expect(t.get_command).toContain("'{leaverWorkflowId}'");
  });

  it('targets leaver workflows with a disable/delete-account task and the mover workflow (EO rule)', () => {
    for (const cmd of [t.get_command, t.set_command]) {
      expect(cmd).toContain('1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950');
      expect(cmd).toContain('8d18588d-9ad3-4c0f-99d0-ec215f0e3dff');
      expect(cmd).toContain("$_.category -eq 'leaver'");
      expect(cmd).toContain("$_.category -eq 'mover'");
      expect(cmd).toContain('(disable|delete)');
    }
  });

  it('set PATCHes isSchedulingEnabled (and isEnabled when off) per workflow, and is a no-op when already scheduled', () => {
    expect(t.set_command).toContain('Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/identityGovernance/lifecycleWorkflows/workflows/$($w.id)"');
    expect(t.set_command).toContain('$b=@{ isSchedulingEnabled=$true }');
    expect(t.set_command).toContain('if($w.isEnabled -ne $true){ $b.isEnabled=$true }');
    expect(t.set_command).toContain('already enabled and scheduled - no change');
    expect(t.set_command).toMatch(/if\(\$w\.isEnabled -eq \$true -and \$w\.isSchedulingEnabled -eq \$true\)\{[^}]*no change/);
  });

  it('set refuses when the bound leaver workflow is not a leaver target', () => {
    expect(t.set_command).toContain("$_.id -eq '{leaverWorkflowId}' -and $_.category -eq 'leaver'");
    expect(t.set_command).toContain('throw');
  });
});
