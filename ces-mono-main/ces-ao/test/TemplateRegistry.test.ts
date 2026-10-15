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
