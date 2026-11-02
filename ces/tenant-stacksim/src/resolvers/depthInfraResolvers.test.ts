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
import { resolveDepthInfra, DEPTH_INFRA_CMDLETS } from './depthInfraResolvers.js';
import { azureResolvers } from './azureResolvers.js';
import { ResolverTable } from './ResolverTable.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';

type Row = Record<string, any>;

describe('DEPTH-9a resolvers (depthInfraResolvers.ts)', () => {
  let dir: string;
  let store: ObjectStore;
  const run = (name: string, args: unknown[]) => resolveDepthInfra({ store }, name, args);

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-depth9a-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('every DEPTH-9a cmdlet is a manual Azure entry (so no derived twin is generated)', () => {
    const named = azureResolvers.filter((e) => e.kind === 'cmdlet').map((e) => (e as { cmdlet: string }).cmdlet);
    for (const c of DEPTH_INFRA_CMDLETS) expect(named.filter((n) => n === c)).toHaveLength(1);
  });

  it('Get-AzContext is empty until Set-AzContext; then it reads the subscription back', async () => {
    expect(await run('Get-AzContext', [])).toEqual([]);
    await store.create('armResources', { id: 'sub', type: 'Microsoft.Resources/subscriptions', subscriptionId: 'aaaa-1', displayName: 'Sim sub' });
    await run('Set-AzContext', ['-Subscription', 'aaaa-1']);
    const ctx = (await run('Get-AzContext', [])) as Row[];
    expect(ctx[0].Subscription).toEqual({ Id: 'aaaa-1', Name: 'Sim sub' });
    expect(ctx[0].Account).toBeNull();
  });

  it('Set-AzContext refuses a subscription the tenant does not hold, and takes any one when none is seeded', async () => {
    await expect(run('Set-AzContext', [])).rejects.toThrow(/-Subscription is required/);
    await run('Set-AzContext', ['-Subscription', 'free-1']);
    expect(((await run('Get-AzContext', [])) as Row[])[0].Subscription.Id).toBe('free-1');
    await store.create('armResources', { id: 'sub', type: 'Microsoft.Resources/subscriptions', subscriptionId: 'aaaa-1' });
    await expect(run('Set-AzContext', ['-Subscription', 'other'])).rejects.toThrow(/not in this tenant/);
  });

  it('policy assignments: create at a scope, read back by -Name and -Scope, 404 otherwise, no duplicate', async () => {
    const setDef = (await run('Get-AzPolicySetDefinition', ['-Id', '/providers/Microsoft.Authorization/policySetDefinitions/4e50fd13-098b-3206-61d6-d1d78205cb45'])) as Row;
    expect(setDef.PolicySetDefinitionId).toMatch(/policySetDefinitions\/4e50fd13/);
    await run('New-AzPolicyAssignment', ['-Name', 'CMMC-L2-Initiative', '-DisplayName', 'CMMC Level 2', '-PolicySetDefinition', setDef, '-Scope', '/subscriptions/s1', '-IdentityType', 'SystemAssigned', '-Location', 'usgovvirginia']);
    const def = (await run('Get-AzPolicyDefinition', ['-Id', '/providers/Microsoft.Authorization/policyDefinitions/83a86a26-fd1f-447c-b59d-e51f44264114'])) as Row;
    await run('New-AzPolicyAssignment', ['-Name', 'CES-No-NIC-Public-IP', '-PolicyDefinition', def, '-Scope', '/subscriptions/s1/resourceGroups/rg']);

    const one = (await run('Get-AzPolicyAssignment', ['-Name', 'CES-No-NIC-Public-IP', '-Scope', '/subscriptions/s1/resourceGroups/rg'])) as Row;
    expect(one).toMatchObject({ Name: 'CES-No-NIC-Public-IP', EnforcementMode: 'Default', PolicyDefinitionId: def.PolicyDefinitionId });
    // -Name at the wrong scope is a 404, not the other assignment (the generic resolver returned any row).
    await expect(run('Get-AzPolicyAssignment', ['-Name', 'CES-No-NIC-Public-IP', '-Scope', '/subscriptions/s1'])).rejects.toThrow(/PolicyAssignmentNotFound/);
    expect(((await run('Get-AzPolicyAssignment', ['-Name', 'CMMC-L2-Initiative', '-Scope', '/subscriptions/s1'])) as Row).Identity).toEqual({ Type: 'SystemAssigned' });
    expect((await run('Get-AzPolicyAssignment', [])) as Row[]).toHaveLength(2);
    await expect(run('New-AzPolicyAssignment', ['-Name', 'CES-No-NIC-Public-IP', '-PolicyDefinition', def, '-Scope', '/subscriptions/s1/resourceGroups/rg'])).rejects.toThrow(/already exists/);
    await expect(run('New-AzPolicyAssignment', ['-Name', 'x', '-Scope', '/subscriptions/s1'])).rejects.toThrow(/definition/);
  });

  it('built-in definition reads refuse a malformed id', async () => {
    await expect(run('Get-AzPolicyDefinition', ['-Id', '/subscriptions/x/providers/Microsoft.Authorization/policyDefinitions/custom'])).rejects.toThrow(/not a built-in/);
    await expect(run('Get-AzPolicySetDefinition', ['-Id', 'nope'])).rejects.toThrow(/not a built-in/);
  });

  it('New-AzNetworkWatcher creates one watcher per region, provisioned', async () => {
    const nw = (await run('New-AzNetworkWatcher', ['-ResourceGroupName', 'rg', '-Name', 'nw-usgovvirginia', '-Location', 'usgovvirginia'])) as Row;
    expect(nw).toMatchObject({ Name: 'nw-usgovvirginia', Location: 'usgovvirginia', ProvisioningState: 'Succeeded' });
    expect((await store.list('networkWatchers')).length).toBe(1);
    await expect(run('New-AzNetworkWatcher', ['-ResourceGroupName', 'rg', '-Name', 'nw2', '-Location', 'usgovvirginia'])).rejects.toThrow(/only one per region/);
  });
});

describe('DEPTH-9b resolvers (PH-9 P9-SIM: V55, V77 H-07)', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;
  const run = (name: string, args: unknown[]) => resolveDepthInfra({ store }, name, args);
  const PROVIDERS = ['Microsoft.OperationalInsights', 'Microsoft.SecurityInsights', 'Microsoft.Security', 'Microsoft.Automation', 'Microsoft.KeyVault', 'Microsoft.Storage', 'Microsoft.Network', 'Microsoft.Compute', 'microsoft.insights', 'Microsoft.AlertsManagement', 'Microsoft.OperationsManagement'];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-depth9b-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_azure'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('the new cmdlets are manual Azure entries (no derived twin)', () => {
    const named = azureResolvers.filter((e) => e.kind === 'cmdlet').map((e) => (e as { cmdlet: string }).cmdlet);
    for (const c of ['Register-AzResourceProvider', 'Get-AzResourceProvider', 'Set-AzSecurityPricing', 'Get-AzSecurityPricing', 'Get-AzRecoveryServicesVault']) {
      expect(DEPTH_INFRA_CMDLETS.has(c)).toBe(true);
      expect(named.filter((n) => n === c)).toHaveLength(1);
    }
  });

  it('AZ-PREFLIGHT-001: the 11 registered providers read back Registered, once each (re-registering is a no-op)', async () => {
    expect(await table.resolveCmdlet('Get-AzResourceProvider', ['-ListAvailable'])).toEqual([]);
    for (const ns of PROVIDERS) await table.resolveCmdlet('Register-AzResourceProvider', ['-ProviderNamespace', ns]);
    await table.resolveCmdlet('Register-AzResourceProvider', ['-ProviderNamespace', 'Microsoft.Network']);
    const all = (await table.resolveCmdlet('Get-AzResourceProvider', ['-ListAvailable'])) as Row[];
    expect(all.map((p) => p.ProviderNamespace)).toEqual(PROVIDERS);
    expect(all.every((p) => p.RegistrationState === 'Registered')).toBe(true);
    expect((await run('Get-AzResourceProvider', ['-ProviderNamespace', 'Microsoft.KeyVault'])) as Row[]).toHaveLength(1);
    await expect(run('Register-AzResourceProvider', [])).rejects.toThrow(/-ProviderNamespace is required/);
  });

  it('AZ-FOUND-003: four Set calls leave four plans, each with its tier; Get -Name reads one', async () => {
    expect(await table.resolveCmdlet('Get-AzSecurityPricing', ['-Name', 'Arm'])).toEqual([]);
    for (const p of ['VirtualMachines', 'StorageAccounts', 'CloudPosture', 'Arm']) await table.resolveCmdlet('Set-AzSecurityPricing', ['-Name', p, '-PricingTier', 'Free']);
    await table.resolveCmdlet('Set-AzSecurityPricing', ['-Name', 'Arm', '-PricingTier', 'Standard']);
    const all = (await table.resolveCmdlet('Get-AzSecurityPricing', [])) as Row[];
    expect(all.map((p) => [p.Name, p.PricingTier])).toEqual([['VirtualMachines', 'Free'], ['StorageAccounts', 'Free'], ['CloudPosture', 'Free'], ['Arm', 'Standard']]);
    expect(all[0].Id).toMatch(/\/providers\/Microsoft\.Security\/pricings\/VirtualMachines$/);
    expect((await run('Get-AzSecurityPricing', ['-Name', 'cloudposture'])) as Row[]).toEqual([all[2]]);
    await expect(run('Set-AzSecurityPricing', ['-Name', 'Arm'])).rejects.toThrow(/-PricingTier are required/);
  });

  it('AZ-NET-001 / AZ-NSG-001: a VNet and an NSG New-Az* created read back with AddressSpace and ProvisioningState', async () => {
    await table.resolveCmdlet('New-AzVirtualNetwork', ['-ResourceGroupName', 'rg-x', '-Name', 'vnet-x', '-Location', 'usgovvirginia', '-AddressPrefix', '10.0.0.0/16']);
    await table.resolveCmdlet('New-AzNetworkSecurityGroup', ['-ResourceGroupName', 'rg-x', '-Name', 'nsg-workload-cmmc', '-Location', 'usgovvirginia']);
    const vnet = (await table.resolveCmdlet('Get-AzVirtualNetwork', ['-ResourceGroupName', 'rg-x', '-Name', 'vnet-x'])) as Row;
    expect(vnet).toMatchObject({ Name: 'vnet-x', AddressPrefix: '10.0.0.0/16', AddressSpace: { AddressPrefixes: ['10.0.0.0/16'] }, ProvisioningState: 'Succeeded' });
    expect(vnet.Id).toMatch(/virtualNetworks\/vnet-x$/);
    const nsg = (await table.resolveCmdlet('Get-AzNetworkSecurityGroup', ['-ResourceGroupName', 'rg-x', '-Name', 'nsg-workload-cmmc'])) as Row;
    expect(nsg).toMatchObject({ Name: 'nsg-workload-cmmc', ProvisioningState: 'Succeeded' });
    // a stored value wins (a seeded VNet's own AddressSpace, a stored ProvisioningState)
    await store.create('vnets', { id: 'vnet-seed', Name: 'vnet-seed', AddressSpace: { AddressPrefixes: ['10.9.0.0/16'] }, ProvisioningState: 'Updating' });
    const seeded = ((await table.resolveCmdlet('Get-AzVirtualNetwork', [])) as Row[]).find((v) => v.Name === 'vnet-seed')!;
    expect(seeded).toMatchObject({ AddressSpace: { AddressPrefixes: ['10.9.0.0/16'] }, ProvisioningState: 'Updating' });
  });

  it('V77 H-07: Get-AzRecoveryServicesVault surfaces the seeded Recovery Services vault (armResources) in the Az shape', async () => {
    const id = '/subscriptions/s1/resourceGroups/rg-s1/providers/Microsoft.RecoveryServices/vaults/rsv-s1';
    await store.create('armResources', { id, name: 'rsv-s1', type: 'Microsoft.RecoveryServices/vaults', location: 'usgovvirginia', properties: { redundancySettings: { standardTierStorageRedundancy: 'GeoRedundant' } } });
    await store.create('armResources', { id: '/subscriptions/s1/resourceGroups/rg-s1/providers/Microsoft.KeyVault/vaults/kv-s1', name: 'kv-s1', type: 'Microsoft.KeyVault/vaults' });
    const vaults = (await table.resolveCmdlet('Get-AzRecoveryServicesVault', [])) as Row[];
    expect(vaults).toHaveLength(1);
    expect(vaults[0]).toMatchObject({ Name: 'rsv-s1', name: 'rsv-s1', ID: id, Id: id, Type: 'Microsoft.RecoveryServices/vaults', Location: 'usgovvirginia', ResourceGroupName: 'rg-s1', SubscriptionId: 's1' });
    expect(((await run('Get-AzRecoveryServicesVault', ['-ResourceGroupName', 'rg-s1', '-Name', 'rsv-s1'])) as Row).ID).toBe(id);
    expect(await run('Get-AzRecoveryServicesVault', ['-ResourceGroupName', 'rg-other'])).toEqual([]);
    await expect(run('Get-AzRecoveryServicesVault', ['-Name', 'nope'])).rejects.toThrow(/ResourceNotFound/);
  });
});
