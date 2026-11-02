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
 * DEPTH-10.3 (PH-12, agent P12-R2, 2026-11-01): the one Graph write the AC batch's new Stamper registry
 * entries send that the simulator did not model. Every other call of the batch is already answered by
 * graphResolvers.ts or the inventory-derived entries (see the golden test next to this file).
 *
 *  - POST /v1.0/groupSettings: Stamper's AC.L2-3.1.8.password-rule-settings creates the tenant's
 *    "Password Rule Settings" directory setting from its template when the tenant has none (Graph
 *    `group-post-settings`). The existing entry (graphResolvers.ts, W5c1-b) is GET-only, so the create
 *    would have been refused. Same collection (`directorySettings`) as that GET, `/beta/settings` and
 *    Get-/Update-MgDirectorySetting, so the setting the POST creates is what every reader sees.
 *    `singletonId` = the collection name keeps a POST creating a new member with a new id (the
 *    deviceCompliancePolicies idiom in graphResolvers.ts).
 *
 * ResolverTable.ts spreads these entries BEFORE graphResolvers, so this GET+POST entry is the one a
 * '/v1.0/groupSettings' call matches; its GET answers exactly as the GET-only entry did.
 */
export const DEPTH10_AC_ENTRIES: ResolverEntry[] = [
  {
    kind: 'uri',
    pattern: '/v1.0/groupSettings',
    collection: 'directorySettings',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
    mutationVerbs: ['POST'],
    singletonId: 'directorySettings',
  },
];
