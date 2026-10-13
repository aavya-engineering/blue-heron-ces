// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { NamedCmdletResolverEntry, ResolverEntry, UriPatternResolverEntry } from './types.js';
import { deriveResolversFromInventory, loadInventoryItemsSync } from '../codegen/deriveResolversFromInventory.js';

/**
 * Azure (Az.*) resolver entries. M2-M6 hand-authored nothing here; the
 * G-STACKSIM-2 iteration-2 pass populated it entirely from
 * `coverage/inventory.json`'s az-cmdlet-engine items
 * (src/codegen/deriveResolversFromInventory.ts) - every Get-Az/New-Az/Set-Az
 * cmdlet Stamper or AO reference got a derived entry with an
 * auto-generated, singular-noun collection name (e.g. Get-AzStorageAccount
 * -> "storageAccount").
 *
 * G-STACKSIM-2 iteration 3 adds hand-authored overrides for the handful of
 * Get-Az / Set-Az cmdlets that Stamper/AO scripts expect to return the
 * SAME real, field-rich object M1's `azureResources.ts` generators already
 * seed under the *plural* collection name ("storageAccounts", "vnets",
 * "nsgs") - e.g. `Get-AzVirtualNetwork | Select-Object -ExpandProperty
 * Subnets`. Left to the generic deriver, these cmdlets would resolve
 * against an always-empty, auto-named singular collection instead (a
 * distinct, never-seeded collection - see IMPLEMENTATION_LOG.md's
 * G-STACKSIM-2 iteration 3 entry for the full derivation-order bug that
 * caused this). Every mutating override still collapses to one
 * well-known id (the collection's first seeded object), per this
 * codebase's established singleton-mutation convention.
 */
const manualAzureResolvers: NamedCmdletResolverEntry[] = [
  {
    kind: 'cmdlet',
    cmdlet: 'Get-AzStorageAccount',
    endpoint: 'derived:Get-AzStorageAccount',
    collection: 'storageAccounts',
    verb: 'GET',
    azureTier: 'full',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Set-AzStorageAccount',
    endpoint: 'derived:Set-AzStorageAccount',
    collection: 'storageAccounts',
    verb: 'PATCH',
    azureTier: 'full',
    mutationVerbs: ['PATCH'],
    singletonId: 'storageAccount-1',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'New-AzStorageAccount',
    endpoint: 'derived:New-AzStorageAccount',
    collection: 'storageAccounts',
    verb: 'POST',
    azureTier: 'full',
    mutationVerbs: ['POST'],
    singletonId: 'storageAccount-1',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-AzVirtualNetwork',
    endpoint: 'derived:Get-AzVirtualNetwork',
    collection: 'vnets',
    verb: 'GET',
    azureTier: 'full',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Set-AzVirtualNetwork',
    endpoint: 'derived:Set-AzVirtualNetwork',
    collection: 'vnets',
    verb: 'PATCH',
    azureTier: 'full',
    mutationVerbs: ['PATCH'],
    singletonId: 'vnet-1',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-AzVirtualNetworkSubnetConfig',
    endpoint: 'derived:Get-AzVirtualNetworkSubnetConfig',
    collection: 'vnets',
    verb: 'GET',
    azureTier: 'full',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Add-AzVirtualNetworkSubnetConfig',
    endpoint: 'derived:Add-AzVirtualNetworkSubnetConfig',
    collection: 'vnets',
    verb: 'POST',
    azureTier: 'full',
    mutationVerbs: ['POST'],
    singletonId: 'vnet-1',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Set-AzVirtualNetworkSubnetConfig',
    endpoint: 'derived:Set-AzVirtualNetworkSubnetConfig',
    collection: 'vnets',
    verb: 'PATCH',
    azureTier: 'full',
    mutationVerbs: ['PATCH'],
    singletonId: 'vnet-1',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-AzNetworkSecurityGroup',
    endpoint: 'derived:Get-AzNetworkSecurityGroup',
    collection: 'nsgs',
    verb: 'GET',
    azureTier: 'full',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Set-AzNetworkSecurityGroup',
    endpoint: 'derived:Set-AzNetworkSecurityGroup',
    collection: 'nsgs',
    verb: 'PATCH',
    azureTier: 'full',
    mutationVerbs: ['PATCH'],
    singletonId: 'nsg-1',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Add-AzNetworkSecurityRuleConfig',
    endpoint: 'derived:Add-AzNetworkSecurityRuleConfig',
    collection: 'nsgs',
    verb: 'POST',
    azureTier: 'full',
    mutationVerbs: ['POST'],
    singletonId: 'nsg-1',
  },
  // AZ-FW-003/004 (Stamper) and F-11/F-12 (AO): Get-AzFirewall's wrapper
  // (generatePsModule.ts) attaches Deallocate()/Allocate() script-methods to
  // the returned object client-side (JSON has no function values) - see
  // that file's doc comment. Set-AzFirewall stays a generic mutation.
  {
    kind: 'cmdlet',
    cmdlet: 'Get-AzFirewall',
    endpoint: 'derived:Get-AzFirewall',
    collection: 'firewalls',
    verb: 'GET',
    azureTier: 'full',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Set-AzFirewall',
    endpoint: 'derived:Set-AzFirewall',
    collection: 'firewalls',
    verb: 'PATCH',
    azureTier: 'full',
    mutationVerbs: ['PATCH'],
    singletonId: 'firewall-1',
  },
  // GP-DEMO-2 (2026-07-28) ledger-truthfulness fix: Invoke-AzRestMethod is a
  // generic REST passthrough whose HTTP verb is caller-supplied via its OWN
  // -Method argument, not intrinsic to the cmdlet name the way New-/Set-/
  // Remove-Az* are. deriveResolversFromInventory's WRITE_VERB_TO_HTTP maps
  // every 'Invoke' verb cmdlet to POST unconditionally, so a GET call
  // (e.g. Stamper's AZ-LOG-004/AZ-SEN-010 :get commands) was routed through
  // the mutation path and ledgered as a mutate - a false record of state
  // change against a real tenant that never happened (live-reproduced via
  // Muster's read-only discovery walk, which correctly refused to proceed
  // on this ledger falsification). This manual entry is the FALLBACK
  // mutation target for non-GET calls whose -Path isn't one of the
  // specifically-modeled ARM resources below (ResolverTable.ts's
  // Invoke-AzRestMethod special case in resolveCmdlet reads -Method/-Path
  // from the raw args at resolution time and only reaches this entry for
  // non-GET verbs); GET calls never reach it - see resolveCmdlet.
  {
    kind: 'cmdlet',
    cmdlet: 'Invoke-AzRestMethod',
    endpoint: 'derived:Invoke-AzRestMethod',
    collection: 'restMethod',
    verb: 'POST',
    azureTier: 'full',
    mutationVerbs: ['POST', 'PATCH', 'DELETE'],
    singletonId: 'restMethod',
  },
];

/**
 * GP-DEMO-2 (2026-07-28): specifically-modeled ARM REST resources reachable
 * via Invoke-AzRestMethod -Path (ResolverTable.ts's Invoke-AzRestMethod
 * special case matches these by normalized path before falling back to the
 * generic 'restMethod' singleton above). Real ces-stamper infra-registry
 * command pair evidence (coverage/inventory.json):
 *  - AZ-LOG-004: GET '.../workspaces/{law}/providers/Microsoft.Authorization/
 *    locks' (collection list) / PUT '.../locks/DoNotDelete' (item-level).
 *  - AZ-SEN-010: GET and PUT both target
 *    '.../workspaces/{law}/providers/Microsoft.SecurityInsights/settings/Ueba'
 *    (a singleton resource).
 * '*' wildcards over subscriptionId/resourceGroup/workspace-name segments
 * mirror azCliResolvers.ts's established az-rest pattern convention (those
 * segments are template-substituted to literal values by the coverage
 * harness before this ever runs).
 */
export const azRestMethodPathResolvers: UriPatternResolverEntry[] = [
  {
    kind: 'uri',
    pattern:
      '/subscriptions/*/resourceGroups/*/providers/Microsoft.OperationalInsights/workspaces/*/providers/Microsoft.Authorization/locks',
    collection: 'resourceLocks',
    verb: 'GET',
    azureTier: 'full',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern:
      '/subscriptions/*/resourceGroups/*/providers/Microsoft.OperationalInsights/workspaces/*/providers/Microsoft.Authorization/locks/DoNotDelete',
    collection: 'resourceLocks',
    verb: 'GET',
    azureTier: 'full',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
    singletonId: 'DoNotDelete',
  },
  {
    kind: 'uri',
    pattern:
      '/subscriptions/*/resourceGroups/*/providers/Microsoft.OperationalInsights/workspaces/*/providers/Microsoft.SecurityInsights/settings/Ueba',
    collection: 'sentinelUebaSettings',
    verb: 'GET',
    azureTier: 'sentinel',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
    singletonId: 'Ueba',
  },
];

const MANUAL_AZURE_CMDLETS = new Set(manualAzureResolvers.map((e) => e.cmdlet));

const derived = deriveResolversFromInventory(loadInventoryItemsSync(), {
  cmdlets: MANUAL_AZURE_CMDLETS,
  uriPatterns: new Set<string>(),
});

export const azureResolvers: ResolverEntry[] = [
  ...manualAzureResolvers,
  ...derived.az,
  ...azRestMethodPathResolvers,
];
