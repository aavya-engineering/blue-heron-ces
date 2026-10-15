// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4 (2026-09-27): request inputs for every AO command against the stacksim
// m365_azure seed (users `sim.userN@simtenant.onmicrosoft.us`, `group-N`,
// `device-N`, `managedDevice-N`, `alert-N`, `caPolicy-N` "Sim CA Policy N").
// Only USER inputs live here — tenant-sourced values come from the tenant record
// (W4-AO2 SourceBindings), never from this table.

import type { AoCommand } from '../../src/types/AoCommand.js';

const U = (n: number) => `sim.user${n}@simtenant.onmicrosoft.us`;

/** Defaults per parameter name. */
const BY_NAME: Record<string, string> = {
  upn: U(3),
  targetUPN: U(3),
  displayName: 'AO W4 New Hire',
  oldGroupId: 'group-2',
  newGroupId: 'group-3',
  newDepartment: 'Engineering',
  enforcementMode: 'immediate',
  policyDisplayName: 'Sim CA Policy 1',
  policyName: 'AO W4 Compliance Policy',
  profileName: 'AO W4 Configuration Profile',
  trustedCidr: '10.10.0.0/24',
  adminUPN: 'adm.sim.user1@simtenant.onmicrosoft.us',
  adminDisplayName: 'ADM Sim User 1',
  deviceName: 'AO-W4-LAPTOP-01',
  deviceSerialNumber: 'SN-AOW4-0001',
  deviceId: 'managedDevice-2',
  appPackageId: 'com.microsoft.office.outlook',
  appId: '00000000-0000-0000-0000-000000000001',
  rotationReason: 'scheduled rotation',
  secretValidityDays: '90',
  keyName: 'sim-storage-key-1',
  serviceAccountUPN: U(2),
  bannedPasswordList: 'Password1,Welcome1,Summer2026',
  lockoutThreshold: '10',
  incidentId: 'alert-1',
  transportRuleName: 'AO W4 CUI Encrypt',
  omeTemplateName: 'Encrypt',
  cuiSiteUrl: 'https://simtenant.sharepoint.us/sites/cui',
  labelDisplayName: 'CUI//SP-CTI',
  cuiGroupEmail: 'cui-authorized@simtenant.onmicrosoft.us',
  alertId: 'alert-1',
  driftResourceId: 'caPolicy-1',
  driftProperty: 'state',
  expectedValue: 'enabled',
  incidentSeverity: 'high',
  incidentClassification: 'truePositive',
  incidentStartDate: '2026-09-01',
  incidentEndDate: '2026-09-02',
  reason: 'Offboarding complete, retention period elapsed',
};

/** Per-command overrides (so destructive ops do not collide on the same seeded object). */
const BY_COMMAND: Record<string, Record<string, string>> = {
  'A-01': { upn: 'ao.w4.newhire@simtenant.onmicrosoft.us' },
  'A-02': { upn: U(4) },
  'A-03': { targetUPN: U(5) },
  'A-04': { targetUPN: U(3) },
  // FC-AO-2 (tenant-stacksim REQ-ces-ao-matrix-inputs): A-02 already disabled sim.user4, so an LOA
  // disable of the same user changes nothing (on a real tenant too). A-05/A-06 get their own
  // seeded, enabled user.
  'A-05': { targetUPN: 'sim.inactive1@simtenant.onmicrosoft.us' },
  'A-06': { targetUPN: 'sim.inactive1@simtenant.onmicrosoft.us' },
  'A-07': { upn: U(3) },
  'A-10': { targetUPN: U(1) },
  'A-16': { targetUPN: U(3) },
  // FC-AO-2 (REQ-ces-ao-matrix-inputs): 'Sim CA Policy 1' names ONE policy, so the dedupe correctly
  // does nothing; the seeded duplicate pair (one enabled, one disabled) is the real case.
  'A-20': { policyDisplayName: 'Sim Duplicate CA Policy' },
  // FC-AO-2 (REQ-ces-ao-matrix-inputs): driftResourceId is an ARM resource id (az resource update --ids),
  // not a Conditional Access policy id. Seeded storage account with a real drift (https-only false).
  'F-08': {
    driftResourceId: '/subscriptions/sim-sub/resourceGroups/sim-rg/providers/Microsoft.Storage/storageAccounts/simstorage1',
    driftProperty: 'supportsHttpsTrafficOnly',
    expectedValue: 'true',
  },
  // FC-AO-2 (REQ-ces-ao-matrix-inputs): an incident id, not an alert id (alert-1 is now an honest 404).
  'H-01': { incidentId: 'incident-1' },
  'B-05': { targetUPN: U(4) },
  'C-10': { targetUPN: U(3) },
  'D-03': { targetUPN: U(3) },
  'G-02': { targetUPN: U(3) },
  'H-02': { targetUPN: U(3) },
  'H-03': { deviceId: 'managedDevice-3' },
  'H-04': { targetUPN: U(3) },
};

export function inputsFor(cmd: AoCommand): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const p of cmd.parameters) {
    if (p.source) continue;
    const v = BY_COMMAND[cmd.id]?.[p.name] ?? BY_NAME[p.name];
    if (v === undefined) throw new Error(`opInputs: no stacksim input for ${cmd.id}.${p.name}`);
    inputs[p.name] = v;
  }
  return inputs;
}
