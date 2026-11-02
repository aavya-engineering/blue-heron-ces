// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../store/ObjectStore.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';
import { ResolverTable } from './ResolverTable.js';
import { searchUnifiedAuditLog } from './semantics.js';

/**
 * SIMFIX FIX-S2 / GOAL M1 regression tests for the semantics table
 * (src/resolvers/semantics.ts), on the REAL default resolver table:
 *  - the four §3 collection defects (write and paired read on one collection);
 *  - audit-log determinism (two reads return identical records - the fix
 *    that took a false AO PASS on D-03 out of the rerun);
 *  - a device action keeps the record and queues the action; risky-user
 *    confirm on an unknown user is a 404.
 */
describe('semantics (FIX-S2)', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-semantics-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('Update-MgIdentityConditionalAccessPolicy writes where both CA-policy reads look (B-07/F-07)', async () => {
    await store.create('caPolicies', { id: 'caPolicy-4', displayName: 'Require Compliant Device', state: 'disabled' });
    await table.resolveCmdlet('Update-MgIdentityConditionalAccessPolicy', ['-ConditionalAccessPolicyId', 'caPolicy-4', '-State', 'enabled']);
    const viaCmdlet = (await table.resolveCmdlet('Get-MgIdentityConditionalAccessPolicy')) as Array<Record<string, unknown>>;
    expect(viaCmdlet.find((p) => p.id === 'caPolicy-4')?.state).toBe('enabled');
    const viaUri = (await table.resolveUri('GET', '/v1.0/identity/conditionalAccess/policies/caPolicy-4')) as Record<string, unknown>;
    expect(viaUri.state).toBe('enabled');
    expect(await store.list('identityConditionalAccessPolicy')).toEqual([]);
  });

  it('F-03 / F-14 / C-04 reads hit the seeded collections', async () => {
    await store.create('deviceConfigurations', { id: 'deviceConfiguration-1', displayName: 'ASR' });
    await store.create('logAnalyticsWorkspaces', { id: 'logAnalyticsWorkspace-1', name: 'sim-law-1' });
    await store.create('roleAssignments', { id: 'ra-kv', principalId: 'user-6', directoryScopeId: '/x/providers/Microsoft.KeyVault/vaults/v' });
    expect(await table.resolveCmdlet('Get-MgDeviceManagementDeviceConfiguration')).toHaveLength(1);
    expect(((await table.resolveCmdlet('Get-AzOperationalInsightsWorkspace', ['-Name', 'sim-law-1'])) as { id: string }).id).toBe(
      'logAnalyticsWorkspace-1',
    );
    expect(await table.resolveCmdlet('Get-MgRoleManagementDirectoryRoleAssignment')).toHaveLength(1);
  });

  it('Search-UnifiedAuditLog is deterministic between reads and honours RecordType/Operations/date window', async () => {
    await store.create('unifiedAuditLog', { id: 'u1', RecordType: 'AttackSim', Operations: 'AttackSimAPI.LinkClicked', UserIds: 'a@x', ageMinutes: 60 * 24 * 20, AuditData: '{}' });
    await store.create('unifiedAuditLog', { id: 'u2', RecordType: 'AzureActiveDirectory', Operations: 'Update user.', UserIds: 'b@x', ageMinutes: 30, AuditData: '{}' });
    const args = ['-StartDate', `/Date(${Date.now() - 90 * 86400000})/`, '-EndDate', `/Date(${Date.now()})/`, '-RecordType', 'AttackSim'];
    const first = await searchUnifiedAuditLog(store, args, Date.now());
    await new Promise((r) => setTimeout(r, 300));
    const second = await searchUnifiedAuditLog(store, args, Date.now());
    expect(first).toHaveLength(1);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const narrow = await searchUnifiedAuditLog(store, ['-StartDate', `/Date(${Date.now() - 7 * 86400000})/`, '-RecordType', 'AttackSim'], Date.now());
    expect(narrow).toHaveLength(0);
  });

  it('Clear-MgDeviceManagementManagedDevice queues a wipe on THAT device and keeps the record', async () => {
    await store.create('managedDevices', { id: 'managedDevice-1', deviceName: 'A' });
    await store.create('managedDevices', { id: 'managedDevice-2', deviceName: 'B' });
    await table.resolveCmdlet('Clear-MgDeviceManagementManagedDevice', ['-ManagedDeviceId', 'managedDevice-2']);
    const d2 = (await store.read('managedDevices', 'managedDevice-2')) as Record<string, unknown>;
    expect(d2.managementState).toBe('wipePending');
    expect((d2.deviceActionResults as Array<{ actionName: string }>)[0].actionName).toBe('wipe');
    expect(await store.read('managedDevices', 'managedDevice-1')).toEqual({ id: 'managedDevice-1', deviceName: 'A' });
  });

  it('Confirm-MgRiskyUser confirms the named users and 404s on an unknown one', async () => {
    await store.create('users', { id: 'user-3', userPrincipalName: 'u3@x', displayName: 'U3' });
    await table.resolveCmdlet('Confirm-MgRiskyUser', ['-UserIds', { value: ['user-3'], Count: 1 }]);
    expect((await store.read('riskyUsers', 'user-3'))?.riskState).toBe('confirmedCompromised');
    await expect(table.resolveCmdlet('Confirm-MgRiskyUser', ['-UserIds', ['user-99']])).rejects.toThrow(/Request_ResourceNotFound/);
  });
});
