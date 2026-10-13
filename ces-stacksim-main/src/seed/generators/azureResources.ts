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
