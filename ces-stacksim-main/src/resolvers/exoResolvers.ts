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
];

const MANUAL_EXO_CMDLETS = new Set(manualExoResolvers.map((e) => e.cmdlet));

const derived = deriveResolversFromInventory(loadInventoryItemsSync(), {
  cmdlets: MANUAL_EXO_CMDLETS,
  uriPatterns: new Set<string>(),
});

export const exoResolvers: ResolverEntry[] = [...manualExoResolvers, ...derived.exo];
