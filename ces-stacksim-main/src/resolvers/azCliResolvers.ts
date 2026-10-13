// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { ResolverEntry } from './types.js';

/**
 * G-STACKSIM-2 iteration 4: resolver entries backing the `az` CLI shim
 * (azshim/az.cmd + azshim/az-shim.ps1). Unlike graphResolvers.ts/
 * azureResolvers.ts/exoResolvers.ts, these are never wired into a generated
 * fake PowerShell module - the shim itself POSTs directly to `stacksim
 * serve`'s /resolve endpoint (mirroring generatePsModule.ts's
 * Invoke-StacksimResolve helper, duplicated into the shim script since a
 * standalone `az.cmd`/`.ps1` pair has no PowerShell module to share it
 * with), using the exact same `{kind:'uri', method, uri, body}` request
 * shape and `ResolverTable.resolveUri()` dispatch every other write/read
 * path already uses. No ResolverTable/QueryServer code changes were needed.
 *
 * Two entry shapes:
 *  1. Fixed ARM/Graph REST paths (`az rest --method M --url U`) - matched
 *     against the real path `az rest` calls hit (after ResolverTable's
 *     existing normalizeUri() strips the https://<host> prefix and query
 *     string), with '*' wildcards over subscriptionId/resourceGroup/
 *     workspace-name segments (template-substituted to `sim-<var>` by the
 *     coverage harness before the shim ever sees them).
 *  2. Synthetic `/azcli/...` paths for CLI-subcommand-shaped calls (e.g.
 *     `az keyvault key rotate ...`, `az network nsg list`) that carry no
 *     real REST URL of their own on the command line - the shim itself
 *     builds these paths from parsed --flag values (azshim/az-shim.ps1).
 *     Where a synthetic path's target already has a real, M1-seeded
 *     collection (`logAnalyticsWorkspaces`, `nsgs`), it is reused so the
 *     az-CLI path observes the same store state a Graph/Az-cmdlet caller
 *     would.
 *
 * Real `az rest --method PUT` calls are mapped by the shim to method
 * 'PATCH' before POSTing to /resolve - ResolverTable's MutationVerb union is
 * `'POST' | 'PATCH' | 'DELETE'` (no 'PUT'), and its PATCH path already does
 * a create-or-merge-patch (ObjectStore.upsert), the closest honest
 * equivalent to ARM's idempotent PUT semantics this sim's mutation model
 * supports without widening ResolverTable's verb union for one CLI caller
 * (see IMPLEMENTATION_LOG.md G-STACKSIM-2 iteration 4 Deviations).
 */
export const azCliResolvers: ResolverEntry[] = [
  // --- az rest (fixed ARM/Graph REST paths) ---

  // Stamper AU.L2-3.3.3.sentinel-connector (set/get): PUT/GET the Office365
  // Sentinel data connector. Reused by the CLI-shaped
  // "sentinel data-connector list" entry below (same collection).
  {
    kind: 'uri',
    pattern:
      '/subscriptions/*/resourceGroups/*/providers/Microsoft.OperationalInsights/workspaces/*/providers/Microsoft.SecurityInsights/dataConnectors/office365',
    collection: 'sentinelDataConnectors',
    verb: 'GET',
    azureTier: 'sentinel',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
    singletonId: 'office365',
  },
  // Stamper AZ-SEN-001 (set/get): PUT/GET the Sentinel onboarding state.
  {
    kind: 'uri',
    pattern:
      '/subscriptions/*/resourceGroups/*/providers/Microsoft.OperationalInsights/workspaces/*/providers/Microsoft.SecurityInsights/onboardingStates/default',
    collection: 'sentinelOnboardingStates',
    verb: 'GET',
    azureTier: 'sentinel',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
    singletonId: 'default',
  },
  // Stamper AZ-DIAG-007/008 (get): Entra ID tenant-level diagnostic
  // settings. AZ-DIAG-007 pipes the result through
  // `ConvertFrom-Json | Where-Object { $_.value } | ConvertTo-Json`, so this
  // MUST be envelope 'value' (the '.value' member access is load-bearing).
  // Reused by the CLI-shaped "monitor diagnostic-settings list" entry below.
  {
    kind: 'uri',
    pattern: '/providers/microsoft.aadiam/diagnosticSettings',
    collection: 'diagnosticSettings',
    verb: 'GET',
    azureTier: 'sentinel',
    envelope: 'value',
  },
  // Stamper AZ-SEN-009 (get): Sentinel content packages (CMMC solution
  // lookup). `$json.value | Where-Object {...}` - also requires 'value'.
  {
    kind: 'uri',
    pattern:
      '/subscriptions/*/resourceGroups/*/providers/Microsoft.OperationalInsights/workspaces/*/providers/Microsoft.SecurityInsights/contentPackages',
    collection: 'sentinelContentPackages',
    verb: 'GET',
    azureTier: 'sentinel',
    envelope: 'value',
  },

  // --- CLI-subcommand-shaped calls (synthetic /azcli/... paths built by azshim/az-shim.ps1) ---

  // Stamper SC.L2-3.13.2.advisor (get): `az advisor recommendation list`.
  {
    kind: 'uri',
    pattern: '/azcli/advisor/recommendations',
    collection: 'advisorRecommendations',
    verb: 'GET',
    azureTier: 'full',
    envelope: 'value',
  },
  // Stamper SI.L2-3.14.7.threat-intel (get): `az sentinel data-connector list`.
  // Shares the 'sentinelDataConnectors' collection the office365 PUT/GET
  // entry above mutates, so a list call reflects what was onboarded.
  {
    kind: 'uri',
    pattern: '/azcli/sentinel/dataConnectors',
    collection: 'sentinelDataConnectors',
    verb: 'GET',
    azureTier: 'sentinel',
    envelope: 'value',
  },
  // AO C-05 (get): `az keyvault certificate list --vault-name $vault`.
  {
    kind: 'uri',
    pattern: '/azcli/keyvault/*/certificates',
    collection: 'keyVaultCertificates',
    verb: 'GET',
    azureTier: 'full',
    envelope: 'value',
  },
  // AO C-03 (set: `az keyvault key rotate`; get: `az keyvault key show`) -
  // one entry backs both: GET lists, PATCH mutates (the captured key-name
  // wildcard becomes the mutation's dynamic object id - see
  // ResolverTable.ts's matchPatternCapture()).
  {
    kind: 'uri',
    pattern: '/azcli/keyvault/*/keys/*',
    collection: 'keyVaultKeys',
    verb: 'GET',
    azureTier: 'full',
    envelope: 'value',
    mutationVerbs: ['PATCH'],
    singletonId: 'keyVaultKey-1',
  },
  // AO C-09 (get, second statement): `az ad auth password-policy show`.
  {
    kind: 'uri',
    pattern: '/azcli/ad/authPasswordPolicy',
    collection: 'adAuthPasswordPolicy',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
  },
  // AO E-01 (set, second statement): `az monitor log-analytics workspace
  // update --retention-time ...`. Reuses M1's real 'logAnalyticsWorkspaces'
  // collection (the same one Get-AzOperationalInsightsWorkspace-class
  // resolvers read) so the CLI-driven retention patch is visible there too.
  {
    kind: 'uri',
    pattern: '/azcli/monitor/logAnalyticsWorkspace/*',
    collection: 'logAnalyticsWorkspaces',
    verb: 'GET',
    azureTier: 'sentinel',
    envelope: 'value',
    mutationVerbs: ['PATCH'],
    singletonId: 'logAnalyticsWorkspace-1',
  },
  // AO E-03 (get, first statement): `az monitor diagnostic-settings list
  // --resource-group ''`. Shares the 'diagnosticSettings' collection
  // AZ-DIAG-007/008 (az rest) target.
  {
    kind: 'uri',
    pattern: '/azcli/monitor/diagnosticSettings',
    collection: 'diagnosticSettings',
    verb: 'GET',
    azureTier: 'sentinel',
    envelope: 'value',
  },
  // AO F-06 (get, first statement): `az network nsg list`. Reuses M1's real
  // 'nsgs' collection (same one Get-AzNetworkSecurityGroup reads).
  {
    kind: 'uri',
    pattern: '/azcli/network/nsgs',
    collection: 'nsgs',
    verb: 'GET',
    azureTier: 'full',
    envelope: 'value',
  },
  // AO F-06 (get, second statement): `az network nsg rule list --nsg-name`.
  {
    kind: 'uri',
    pattern: '/azcli/network/nsgs/*/rules',
    collection: 'nsgRules',
    verb: 'GET',
    azureTier: 'full',
    envelope: 'value',
  },
  // AO F-08 (set, second statement): `az resource update --ids <id> --set
  // properties.X=Y`. Generic ARM resource property patch; the captured
  // resource-id wildcard becomes the mutation's dynamic object id.
  {
    kind: 'uri',
    pattern: '/azcli/resource/*',
    collection: 'armResources',
    verb: 'GET',
    azureTier: 'full',
    envelope: 'value',
    mutationVerbs: ['PATCH'],
    singletonId: 'armResource-1',
  },
  // AO H-07 (get, first statement): `az backup job list`.
  {
    kind: 'uri',
    pattern: '/azcli/backup/jobs',
    collection: 'backupJobs',
    verb: 'GET',
    azureTier: 'full',
    envelope: 'value',
  },
];
