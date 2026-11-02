// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// PLAN.md M5 task 1 / GP-TESTER-1 M3: the coverage-report computation.
import { describe, it, expect } from 'vitest';
import {
  computeCoverage,
  commandKeyOf,
  controlIdOf,
  T1_PROTECT_CONTROLS,
  type InventoryFile,
} from '../src/results/coverage-report.js';

const INVENTORY: InventoryFile = {
  generatedAt: '2026-07-20T00:00:00Z',
  items: [
    { id: 'stamper:IA.L2-3.5.3.mfa-config:set', source: 'stamper', sourceRef: 'x', commandText: 'Update-MgPolicyAuthenticationMethodPolicyAuthenticationMethodConfiguration -Id MicrosoftAuthenticator', classification: 'write' },
    { id: 'stamper:SI.L2-3.14.2.atp-enable:set', source: 'stamper', sourceRef: 'x', commandText: 'Set-AtpPolicyForO365 -EnableATPForSPOTeamsODB $true', classification: 'write' },
    { id: 'stamper:AC.L2-3.1.1.operator-discover:get', source: 'stamper', sourceRef: 'x', commandText: 'Get-MgUser -Filter "upn eq \'{u}\'"', classification: 'read' },
    { id: 'eo:SC.L2-3.13.1.ca-read:get', source: 'eo', sourceRef: 'x', commandText: 'GET /v1.0/identity/conditionalAccess/policies', classification: 'read' },
    { id: 'ao:MP.L2-3.8.9.dlp:set', source: 'ao', sourceRef: 'x', commandText: 'New-DlpCompliancePolicy -Name x', classification: 'write' },
    { id: 'stamper:AT.L2-3.2.1.training:manual', source: 'stamper', sourceRef: 'x', classification: 'manual_only' },
  ],
};

const LEDGER = [
  { type: 'mutate', source: 'Set-AtpPolicyForO365' },
  { type: 'read-serve', source: 'Get-MgUser' },
  { type: 'read-serve', source: '/v1.0/identity/conditionalAccess/policies' },
  // A read of a write-item's cmdlet must NOT count the write item:
  { type: 'read-serve', source: 'New-DlpCompliancePolicy' },
];

describe('coverage report', () => {
  it('extracts command keys (cmdlet token or Graph URI) and control ids', () => {
    expect(commandKeyOf(INVENTORY.items[1])).toBe('Set-AtpPolicyForO365');
    expect(commandKeyOf(INVENTORY.items[3])).toBe('/v1.0/identity/conditionalAccess/policies');
    expect(controlIdOf(INVENTORY.items[0])).toBe('3.5.3');
    expect(controlIdOf({ id: 'eo:SC.L2-3.13.1.ca-read:get' })).toBe('3.13.1');
  });

  it('write items need mutate/create entries; read items match any entry; manual_only listed as known-untested', () => {
    const r = computeCoverage(INVENTORY, LEDGER, { runsScanned: 2, now: new Date('2026-07-26T06:00:00Z') });
    expect(r.exercised_item_ids).toEqual([
      'eo:SC.L2-3.13.1.ca-read:get',
      'stamper:AC.L2-3.1.1.operator-discover:get',
      'stamper:SI.L2-3.14.2.atp-enable:set',
    ]);
    expect(r.totals.exercised).toBe(3);
    expect(r.totals.by_source['stamper']).toEqual({ total: 4, exercised: 2 });
    expect(r.totals.by_classification['write']).toEqual({ total: 3, exercised: 1 });
    expect(r.manual_only_known_untested).toEqual(['stamper:AT.L2-3.2.1.training:manual']);
  });

  it('computes the T1/PROTECT cut against the 36-control tier', () => {
    expect(T1_PROTECT_CONTROLS).toHaveLength(36);
    const r = computeCoverage(INVENTORY, LEDGER, { runsScanned: 1 });
    // 3.14.2 (write, mutated), 3.1.1 + 3.13.1 (reads, matched) are T1; 3.5.3's item was NOT exercised.
    expect(r.t1_protect.controls_exercised).toEqual(['3.1.1', '3.13.1', '3.14.2']);
    expect(r.t1_protect.controls_unexercised).toContain('3.5.3');
    expect(r.t1_protect.controls_exercised.length + r.t1_protect.controls_unexercised.length).toBe(36);
  });
});
