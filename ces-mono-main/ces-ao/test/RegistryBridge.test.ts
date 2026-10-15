// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { translateAoCommandToCommandEntry } from '../src/registry/RegistryBridge.js';
import { makeAoCommand } from './fixtures.js';

// Characterization tests for the AoCommand -> CommandEntry translation.
describe('translateAoCommandToCommandEntry', () => {
  it('translates an AUDIT P1 command with a wired template (A-09)', () => {
    const entry = translateAoCommandToCommandEntry(
      makeAoCommand({
        id: 'A-09',
        title: 'Privileged Role Review',
        domain: 'A',
        trigger: 'AUDIT',
        priority: 'P1 Critical',
        sodTier: 'Tier 2',
        overview: 'review privileged roles',
        cmmcPractices: ['AC.L2-3.1.5'],
        parameters: [
          { name: 'tenantId', label: 'Tenant', type: 'readonly', source: 'tenantId', required: true },
          { name: 'globalAdminRoleDefId', label: 'GA', type: 'text', required: true },
        ],
      })
    );

    expect(entry.entry_id).toBe('A.A-09');
    expect(entry.control_ids).toEqual(['AC.L2-3.1.5']);
    expect(entry.label).toBe('Privileged Role Review');
    expect(entry.engine).toBe('mgraph');
    // AUDIT -> evidence-only via classifier (no explicit idempotencyClass)
    expect(entry.idempotency).toBe('evidence-only');
    // source param -> uppercased; runtime param (no source) -> name
    expect(entry.variables_required).toEqual(['TENANT_ID']);
    expect(entry.variables_runtime).toEqual(['globalAdminRoleDefId']);
    // P1 Critical -> abort_plan
    expect(entry.on_failure).toBe('abort_plan');
    // wired template: get_command populated, set_command empty for this audit command
    expect(entry.set_command).toBe('');
    expect(entry.get_command).toContain('Get-MgRoleManagementDirectoryRoleEligibilitySchedule');
    expect(entry.evidence_commands).toEqual(['Get-MgUser', 'Get-MgGroup']);
    // constant scaffolding
    expect(entry.layer_hint).toBe(0);
    expect(entry.sequence_hint).toBe(0);
    expect(entry.manual_only).toBe(false);
    expect(entry.captures).toEqual([]);
  });

  it('uses explicit idempotencyClass over the heuristic, manual_gate engine for Tier 3, warn_continue for non-P1', () => {
    const entry = translateAoCommandToCommandEntry(
      makeAoCommand({
        id: 'A-03',
        domain: 'A',
        trigger: 'CONFIG',
        priority: 'P3 Medium',
        sodTier: 'Tier 3',
        title: 'User Offboarding Hard Delete',
        overview: 'permanently remove user',
        idempotencyClass: 'evidence-only',
      })
    );

    expect(entry.idempotency).toBe('evidence-only'); // explicit override wins
    expect(entry.engine).toBe('manual_gate'); // Tier 3 override in AdapterRouter
    expect(entry.on_failure).toBe('warn_continue'); // not P1 Critical
  });

  it('falls back to empty template strings for an unwired command id', () => {
    const entry = translateAoCommandToCommandEntry(
      makeAoCommand({ id: 'Z-99', domain: 'B', trigger: 'CONFIG', overview: 'no template here' })
    );
    expect(entry.set_command).toBe('');
    expect(entry.get_command).toBe('');
    expect(entry.evidence_commands).toEqual(['Get-MgDeviceManagementManagedDevice']);
  });
});
