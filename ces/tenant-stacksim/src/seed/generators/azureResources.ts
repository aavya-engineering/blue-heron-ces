// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../../store/StoreTypes.js';

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/**
 * azureTier 'sentinel'. Log Analytics workspaces are the Sentinel-solution
 * hosting object; the sentinelEnabled flag stands in for a distinct
 * Sentinel-solution-status resolver per Core Design (e)'s note that the
 * Vault's Object Surface list only names Log Analytics workspaces for this
 * tier.
 */
export function generateLogAnalyticsWorkspaces(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `logAnalyticsWorkspace-${i + 1}`,
    name: `sim-law-${i + 1}`,
    sentinelEnabled: true,
  }));
}

// azureTier 'full' below.

export function generateStorageAccounts(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `storageAccount-${i + 1}`,
    name: `simstorage${i + 1}`,
    immutabilityEnabled: true,
    // G-STACKSIM-2 iteration 2: Stamper's AZ-LOG-002a/c read paths
    // (Select-Object -ExpandProperty Identity / Encryption) require these
    // real Get-AzStorageAccount sub-properties to exist.
    Identity: { Type: 'SystemAssigned', PrincipalId: `sim-storage-mi-${i + 1}`, TenantId: 'sim-tenant' },
    Encryption: {
      KeySource: 'Microsoft.Keyvault',
      KeyVaultProperties: { KeyName: `sim-storage-key-${i + 1}`, KeyVersion: '' },
    },
  }));
}

export function generateKeyVaults(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `keyVault-${i + 1}`,
    name: `sim-kv-${i + 1}`,
  }));
}

export function generateAutomationAccounts(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `automationAccount-${i + 1}`,
    name: `sim-automation-${i + 1}`,
  }));
}

export function generateVnets(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `vnet-${i + 1}`,
    name: `sim-vnet-${i + 1}`,
    addressSpace: `10.${i}.0.0/16`,
    // G-STACKSIM-2 iteration 2/3: Stamper's AZ-NET-002..005/AZ-NSG-005/
    // AZ-PE-001/AZ-PE-002 read/write paths all
    // `Select-Object -ExpandProperty Subnets` off a Get-AzVirtualNetwork
    // result - the property itself must exist (a real vnet always has this
    // sub-property, even an empty array) so the read side never throws
    // "Property Subnets cannot be found". Deliberately seeded EMPTY, not
    // pre-populated with snet-mgmt/snet-workload/AzureBastionSubnet/
    // AzureFirewallSubnet: AZ-NET-002..005's set_command is a genuine
    // get-then-set idempotency check (`if (-not $existing) { Add-Az...
    // SubnetConfig ... }`) - a freshly-provisioned vnet BEFORE CMMC
    // baseline stamping realistically has none of these subnets yet
    // (creating them is Stamper's whole job), and pre-seeding them here
    // made every one of those idempotent checks find its subnet "already
    // there" and skip the mutation entirely (iteration 3's fix for the
    // AZ-LOG-002a/c-class wrong-collection bug surfaced this side effect -
    // see IMPLEMENTATION_LOG.md's G-STACKSIM-2 iteration 3 entry).
    Subnets: [] as unknown[],
  }));
}

export function generateNsgs(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `nsg-${i + 1}`,
    name: `sim-nsg-${i + 1}`,
    // G-STACKSIM-2 iteration 2: Stamper's AZ-NSG-002..004 read paths
    // `Select-Object -ExpandProperty SecurityRules` off a
    // Get-AzNetworkSecurityGroup result - a real NSG's SecurityRules
    // sub-property, minimally populated with the rule names those scripts
    // filter for.
    SecurityRules: [
      { Name: 'DenyAllInbound', Direction: 'Inbound', Access: 'Deny', Priority: 4096 },
      { Name: 'DenyAllOutbound', Direction: 'Outbound', Access: 'Deny', Priority: 4096 },
      { Name: 'AllowBastionInbound', Direction: 'Inbound', Access: 'Allow', Priority: 100 },
    ],
  }));
}

export function generateManagedIdentities(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `managedIdentity-${i + 1}`,
    name: `sim-mi-${i + 1}`,
  }));
}

/**
 * G-STACKSIM-2 iteration 3: Stamper's AZ-FW-003/004 and AO's F-11/F-12 both
 * call `Get-AzFirewall`, then invoke `.Deallocate()`/`.Allocate(...)`
 * script-methods directly on the returned object (real Az.Network cmdlet
 * shape - the firewall object itself carries those two methods). Those
 * methods are attached client-side by the fake Az.Accounts module's
 * Get-AzFirewall wrapper (generatePsModule.ts), not stored data - this
 * generator only needs to supply the plain properties (`Name`,
 * `ProvisioningState`, `IpConfigurations`) the get_command's
 * `Select-Object`/computed `AllocationState` column reads.
 */
export function generateFirewalls(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `firewall-${i + 1}`,
    Name: `sim-fw-${i + 1}`,
    ProvisioningState: 'Succeeded',
    IpConfigurations: [{ Name: 'ipconfig1' }],
  }));
}

/**
 * GP-STACKSIM-1 M3 (2026-07-25): a real Key Vault that CES manages holds at
 * least one key and one certificate - AO's C-03 (`az keyvault key show`)
 * addresses a key by name (honest item-level 404 against an unseeded
 * collection = the C-03 500 in the 2026-07-25 coverage re-run) and C-05
 * lists certificates.
 */
export function generateKeyVaultKeys(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `keyVaultKey-${i + 1}`,
    key: { kid: `https://sim-kv-1.vault.usgovcloudapi.net/keys/keyVaultKey-${i + 1}` },
    attributes: { enabled: true, expires: null, created: 1720000000 },
  }));
}

export function generateKeyVaultCertificates(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `keyVaultCertificate-${i + 1}`,
    name: `sim-cert-${i + 1}`,
    attributes: { enabled: true, expires: 1783000000 },
  }));
}

/**
 * synthetic-customer W0 (2026-10-28): the Azure Government facade for a
 * synthetic customer (PLAN §2.2) - readable resource names, CIDRs and a
 * subscription id, so Infrastructure Manifest rows can be `discovered`.
 * Input is the customer's `azure_government` block (customer.json, copied
 * into the scenario's seedContext by scripts/build-customer-scenario.mjs).
 * Ids keep the generic collection ids (`vnet-1`, `nsg-1`, `keyVault-1`,
 * `logAnalyticsWorkspace-1`) so id-keyed readers still match; the scenario
 * zeroes those generators' counts so no `sim-*` named twin exists. There is
 * no VM collection: VMs, the backup vault and the subscription are
 * `armResources` rows typed like their ARM resources. All names, ids and
 * addresses are fictional (private 10/8 space; RFC 5737 admin source).
 */
export interface AzureFacadeSpec {
  subscription_id: string;
  subscription_name: string;
  region: string;
  resource_group: string;
  vms: Array<{ name: string; role: string; subnet: string; private_ip: string }>;
  vnet: { name: string; address_space: string; subnets: Array<{ name: string; cidr: string }> };
  nsg: string;
  /** synthetic-customer W6: absent = the customer has no key vault (S2); the vault collections are then empty. */
  key_vault?: string;
  log_analytics: string;
  backup_vault: string;
  allowed_admin_source: string;
}

export function buildAzureFacade(spec: AzureFacadeSpec, anchorMs: number): Record<string, StoreObject[]> {
  const rg = `/subscriptions/${spec.subscription_id}/resourceGroups/${spec.resource_group}`;
  const armId = (type: string, name: string) => `${rg}/providers/${type}/${name}`;
  const nsgId = armId('Microsoft.Network/networkSecurityGroups', spec.nsg);
  const lawId = armId('Microsoft.OperationalInsights/workspaces', spec.log_analytics);
  const kvId = spec.key_vault ? armId('Microsoft.KeyVault/vaults', spec.key_vault) : '';
  const vaultId = armId('Microsoft.RecoveryServices/vaults', spec.backup_vault);
  const vnetId = armId('Microsoft.Network/virtualNetworks', spec.vnet.name);
  const daysAgo = (d: number, h = 0) => new Date(anchorMs - d * 86400000 - h * 3600000).toISOString();
  const tags = { environment: 'prod', owner: 'it', fictional: 'true' };

  const vnets: StoreObject[] = [
    {
      id: 'vnet-1',
      name: spec.vnet.name,
      Name: spec.vnet.name,
      Id: vnetId,
      Location: spec.region,
      addressSpace: spec.vnet.address_space,
      AddressSpace: { AddressPrefixes: [spec.vnet.address_space] },
      Subnets: spec.vnet.subnets.map((s) => ({
        Name: s.name,
        Id: `${vnetId}/subnets/${s.name}`,
        AddressPrefix: s.cidr,
        NetworkSecurityGroup: s.name.includes('workload') ? { Id: nsgId } : null,
        RouteTable: null,
        PrivateEndpointNetworkPolicies: 'Disabled',
        PrivateEndpoints: [],
      })),
      Tags: tags,
    },
  ];
  const nsgs: StoreObject[] = [
    {
      id: 'nsg-1',
      name: spec.nsg,
      Name: spec.nsg,
      Id: nsgId,
      Location: spec.region,
      SecurityRules: [
        { Name: 'AllowJumpBoxRdpFromOffice', Direction: 'Inbound', Access: 'Allow', Priority: 200, Protocol: 'Tcp', SourceAddressPrefix: spec.allowed_admin_source, DestinationPortRange: '3389' },
        { Name: 'DenyAllInbound', Direction: 'Inbound', Access: 'Deny', Priority: 4096 },
        { Name: 'DenyAllOutbound', Direction: 'Outbound', Access: 'Deny', Priority: 4096 },
      ],
      Tags: tags,
    },
  ];
  // W5c2 follow-up 11: the Az.KeyVault PowerShell properties Stamper's
  // SC.L2-3.13.10.key-vault reads (VaultName, ResourceId, ResourceGroupName,
  // SoftDeleteRetentionInDays, EnableRbacAuthorization); S1's vault conforms
  // (purge protection, soft delete 90 days, RBAC).
  const keyVaults: StoreObject[] = [
    {
      id: 'keyVault-1', name: spec.key_vault, VaultName: spec.key_vault, Id: kvId, ResourceId: kvId, ResourceGroupName: spec.resource_group, Location: spec.region,
      VaultUri: `https://${spec.key_vault}.vault.usgovcloudapi.net/`, Sku: 'Premium',
      EnablePurgeProtection: true, EnableSoftDelete: true, SoftDeleteRetentionInDays: 90, EnableRbacAuthorization: true, PublicNetworkAccess: 'Disabled', Tags: tags,
    },
  ];
  const keyVaultKeys: StoreObject[] = [
    { id: 'keyVaultKey-1', name: 'cmk-cui-storage', key: { kid: `https://${spec.key_vault}.vault.usgovcloudapi.net/keys/cmk-cui-storage` }, attributes: { enabled: true, expires: null, created: Math.floor((anchorMs - 300 * 86400000) / 1000) } },
  ];
  const keyVaultCertificates: StoreObject[] = [
    { id: 'keyVaultCertificate-1', name: 'jumpbox-rdp-tls', attributes: { enabled: true, expires: Math.floor((anchorMs + 200 * 86400000) / 1000) } },
  ];
  const logAnalyticsWorkspaces: StoreObject[] = [
    { id: 'logAnalyticsWorkspace-1', name: spec.log_analytics, ResourceId: lawId, Location: spec.region, retentionInDays: 365, sentinelEnabled: false, Tags: tags },
  ];
  // W5c2 follow-up 11: each enclave VM has a system-assigned managed identity
  // (S1 sim id family), assigned "Key Vault Crypto Service Encryption User"
  // on the vault (azRoleAssignments below).
  const vmPrincipalId = (i: number) => `51510000-00be-4000-8000-${String(i + 1).padStart(12, '0')}`;
  const vmArm = (vm: AzureFacadeSpec['vms'][number], i: number): StoreObject => ({
    id: armId('Microsoft.Compute/virtualMachines', vm.name),
    name: vm.name,
    type: 'Microsoft.Compute/virtualMachines',
    location: spec.region,
    identity: { type: 'SystemAssigned', principalId: vmPrincipalId(i), tenantId: null },
    tags: { ...tags, role: vm.role },
    properties: {
      hardwareProfile: { vmSize: 'Standard_D4s_v5' },
      storageProfile: { osDisk: { osType: 'Windows', encryptionSettings: { enabled: true } } },
      networkProfile: { networkInterfaces: [{ subnetId: `${vnetId}/subnets/${vm.subnet}`, privateIPAddress: vm.private_ip }] },
      provisioningState: 'Succeeded',
    },
  });
  const armResources: StoreObject[] = [
    { id: `/subscriptions/${spec.subscription_id}`, name: spec.subscription_name, type: 'Microsoft.Resources/subscriptions', subscriptionId: spec.subscription_id, state: 'Enabled', cloud: 'AzureUSGovernment' },
    { id: rg, name: spec.resource_group, type: 'Microsoft.Resources/resourceGroups', location: spec.region, tags },
    ...spec.vms.map(vmArm),
    { id: vnetId, name: spec.vnet.name, type: 'Microsoft.Network/virtualNetworks', location: spec.region, properties: { addressSpace: { addressPrefixes: [spec.vnet.address_space] }, subnets: spec.vnet.subnets.map((s) => ({ name: s.name, addressPrefix: s.cidr })) } },
    { id: nsgId, name: spec.nsg, type: 'Microsoft.Network/networkSecurityGroups', location: spec.region },
    { id: kvId, name: spec.key_vault, type: 'Microsoft.KeyVault/vaults', location: spec.region, enablePurgeProtection: true, publicNetworkAccess: 'Disabled' },
    { id: lawId, name: spec.log_analytics, type: 'Microsoft.OperationalInsights/workspaces', location: spec.region, retentionInDays: 365 },
    { id: vaultId, name: spec.backup_vault, type: 'Microsoft.RecoveryServices/vaults', location: spec.region, properties: { redundancySettings: { standardTierStorageRedundancy: 'GeoRedundant' }, securitySettings: { softDeleteSettings: { softDeleteState: 'Enabled' }, immutabilitySettings: { state: 'Unlocked' } } } },
  ];
  const backupJobs: StoreObject[] = spec.vms.map((vm, i) => ({
    id: `backupJob-${i + 1}`,
    name: `${spec.backup_vault}-job-${String(i + 1).padStart(4, '0')}`,
    properties: { operation: 'Backup', status: 'Completed', entityFriendlyName: vm.name, backupManagementType: 'AzureIaasVM', startTime: daysAgo(1, 22 - i), vaultId },
  }));
  const azRoleAssignments: StoreObject[] = spec.vms.map((vm, i) => ({
    id: `azRoleAssignment-s1-${i + 1}`,
    RoleAssignmentId: `${kvId}/providers/Microsoft.Authorization/roleAssignments/51510000-00bf-4000-8000-${String(i + 1).padStart(12, '0')}`,
    Scope: kvId,
    DisplayName: vm.name,
    ObjectId: vmPrincipalId(i),
    ObjectType: 'ServicePrincipal',
    RoleDefinitionName: 'Key Vault Crypto Service Encryption User',
    CanDelegate: false,
  }));
  if (!spec.key_vault) {
    // synthetic-customer W6 (S2): no customer vault, no vault role assignments.
    return { vnets, nsgs, keyVaults: [], keyVaultKeys: [], keyVaultCertificates: [], logAnalyticsWorkspaces, armResources: armResources.filter((r) => r.type !== 'Microsoft.KeyVault/vaults'), backupJobs, azRoleAssignments: [] };
  }
  return { vnets, nsgs, keyVaults, keyVaultKeys, keyVaultCertificates, logAnalyticsWorkspaces, armResources, backupJobs, azRoleAssignments };
}
