// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { NamedCmdletResolverEntry, ResolverEntry } from './types.js';
import { deriveResolversFromInventory, loadInventoryItemsSync } from '../codegen/deriveResolversFromInventory.js';
import { DEPTH10_IR_EXO_ENTRIES } from './depth10IRResolvers.js';
import { DEPTH10_AU_EXO_ENTRIES } from './depth10AuResolvers.js';

/**
 * Exchange Online / Security & Compliance (IPPS) / SharePoint Online (SPO)
 * resolver entries. M2-M6 hand-authored nothing here; G-STACKSIM-2
 * iteration 2 populates it entirely from `coverage/inventory.json`'s
 * exo-cmdlet/ipps-cmdlet/spo-cmdlet/other-engine items
 * (src/codegen/deriveResolversFromInventory.ts). All of these wrapper
 * functions are exported from the fake ExchangeOnlineManagement module
 * (generatePsModule.ts) since it is already imported by every choke point
 * this sim shadows (SessionManager.ts's GRAPH_MODULE_IMPORTS,
 * TenantProbe.psm1's Invoke-EutExo/Invoke-EutIpps) - matching this
 * codebase's established "PowerShell function export is global regardless
 * of which module technically defines a function name" precedent
 * (Core Design (d)), so a handful of non-Exchange strays (Teams'
 * Get-CsExternalAccessPolicy, PnP's Get-PnPListItem - real modules this sim
 * never shadows) still resolve without editing SessionManager.ts.
 *
 * P0-2 fix 6+7 (malware-rule + anti-phish, 2026-07-27): the first two
 * hand-authored overrides below give New-MalwareFilterRule/New-AntiPhishPolicy
 * a `creationDefaults` (types.ts) for the field each one's real EXO cmdlet
 * computes server-side and the CES registry's SET args never carry
 * ($.State='Enabled', $.Enabled=true) - same class as DLP's
 * DistributionStatus (ResolverTable.ts fix 8). Excluded from the generic
 * derived set below (MANUAL_EXO_CMDLETS) to avoid a duplicate,
 * defaults-less entry shadowing this one.
 */
const manualExoResolvers: NamedCmdletResolverEntry[] = [
  // W5c2 follow-up 10 (SIM-W4c4): Purview alert policies (Security &
  // Compliance PowerShell), the read EO's AU.L2-3.3.4 coverage names.
  {
    kind: 'cmdlet',
    cmdlet: 'Get-ProtectionAlert',
    endpoint: 'derived:Get-ProtectionAlert',
    collection: 'protectionAlert',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'New-MalwareFilterRule',
    endpoint: 'derived:New-MalwareFilterRule',
    collection: 'malwareFilterRule',
    verb: 'POST',
    azureTier: 'none',
    mutationVerbs: ['POST'],
    singletonId: 'malwareFilterRule',
    creationDefaults: { State: 'Enabled' },
  },
  {
    kind: 'cmdlet',
    cmdlet: 'New-AntiPhishPolicy',
    endpoint: 'derived:New-AntiPhishPolicy',
    collection: 'antiPhishPolicy',
    verb: 'POST',
    azureTier: 'none',
    mutationVerbs: ['POST'],
    singletonId: 'antiPhishPolicy',
    creationDefaults: { Enabled: true },
  },
  // FX-08 (2026-10-26): a DLP rule reports the same server-computed
  // DistributionStatus as its policy (generateDlpCompliancePolicies seeds
  // 'Success'); Stamper's MP.L2-3.8.9.dlp-rule verification reads it.
  {
    kind: 'cmdlet',
    cmdlet: 'New-DlpComplianceRule',
    endpoint: 'derived:New-DlpComplianceRule',
    collection: 'dlpComplianceRule',
    verb: 'POST',
    azureTier: 'none',
    mutationVerbs: ['POST'],
    singletonId: 'dlpComplianceRule',
    creationDefaults: { DistributionStatus: 'Success' },
  },
  // synthetic-customer W3 (2026-10-28): Exchange Online answers a new DLP
  // policy with DistributionStatus 'Pending' and reports 'Success' once
  // distribution completes. The sim's rule: the create response says
  // 'Pending'; the stored policy says 'Success', so every later
  // Get-DlpCompliancePolicy returns 'Success' (distribution completes when
  // the create call returns). Seeded policies already carry 'Success'.
  {
    kind: 'cmdlet',
    cmdlet: 'New-DlpCompliancePolicy',
    endpoint: 'derived:New-DlpCompliancePolicy',
    collection: 'dlpCompliancePolicy',
    verb: 'POST',
    azureTier: 'none',
    mutationVerbs: ['POST'],
    singletonId: 'dlpCompliancePolicy',
    creationDefaults: { DistributionStatus: 'Success' },
    createResponseOverrides: { DistributionStatus: 'Pending' },
  },
  // P1.4c (2026-10-27): a saved anti-spam policy reports IsValid true.
  {
    kind: 'cmdlet',
    cmdlet: 'New-HostedContentFilterPolicy',
    endpoint: 'derived:New-HostedContentFilterPolicy',
    collection: 'hostedContentFilterPolicy',
    verb: 'POST',
    azureTier: 'none',
    mutationVerbs: ['POST'],
    singletonId: 'hostedContentFilterPolicy',
    creationDefaults: { IsValid: true },
  },
  // DEPTH-10.8 (PH-12 P12-R4): Get-/Set-ReportSubmissionPolicy; ResolverTable answers them with resolveDepth10Ir.
  ...DEPTH10_IR_EXO_ENTRIES,
  // DEPTH-10.1 (P12-R1): Set-OrganizationConfig and New-ProtectionAlert (depth10AuResolvers.ts).
  ...DEPTH10_AU_EXO_ENTRIES,
];

const MANUAL_EXO_CMDLETS = new Set(manualExoResolvers.map((e) => e.cmdlet));

const derived = deriveResolversFromInventory(loadInventoryItemsSync(), {
  cmdlets: MANUAL_EXO_CMDLETS,
  uriPatterns: new Set<string>(),
});

export const exoResolvers: ResolverEntry[] = [...manualExoResolvers, ...derived.exo];
