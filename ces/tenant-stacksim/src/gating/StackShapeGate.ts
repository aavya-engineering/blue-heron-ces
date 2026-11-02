// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

/**
 * Stack-shape gating (Core Design (e)). Two independent layers:
 *  1. Seed-data absence — enforced by ProfileLoader at manifest-validation
 *     time (a profile manifest cannot declare counts for an object type
 *     whose azureTier exceeds the profile's own tier).
 *  2. Invoke-time enforcement — this class. Any resolver-shaped call site
 *     that carries an `azureTier` field is checked here before it is allowed
 *     to touch the store; a call outside the active profile's tier throws
 *     before touching the store (mirrors a real tenant 403/404ing a call
 *     outside its licensed surface).
 */

export type TenantStance = 'm365_only' | 'm365_sentinel' | 'm365_azure';

export type AzureTier = 'none' | 'sentinel' | 'full';

const TIER_ORDER: Record<AzureTier, number> = { none: 0, sentinel: 1, full: 2 };

export const STANCE_TO_TIER: Record<TenantStance, AzureTier> = {
  m365_only: 'none',
  m365_sentinel: 'sentinel',
  m365_azure: 'full',
};

/**
 * Object-type -> azureTier mapping. Mirrors the azureTier field planned for
 * every ResolverTable entry (M2); reused here for M1's invoke-time gate and
 * by ProfileLoader for seed-data-absence validation, per Core Design (e).
 * Object types not listed here are `'none'` (available to every profile).
 *
 * Per the plan's m365_sentinel disambiguation: Log Analytics workspaces
 * (Sentinel-solution-hosting) are `'sentinel'`; storage/KeyVault/VNet/NSG/
 * automation/managedIdentity remain `'full'` and are denied under
 * m365_sentinel identically to m365_only.
 */
export const AZURE_TIER_BY_OBJECT_TYPE: Record<string, AzureTier> = {
  logAnalyticsWorkspaces: 'sentinel',
  storageAccounts: 'full',
  keyVaults: 'full',
  automationAccounts: 'full',
  vnets: 'full',
  nsgs: 'full',
  managedIdentities: 'full',
  firewalls: 'full',
};

export interface GatedResolver {
  azureTier: AzureTier;
}

export class StackShapeGate {
  constructor(private readonly tenantStance: TenantStance) {}

  /**
   * Throws if the active profile's tier is below the resolver's required
   * tier. Succeeds (returns void) otherwise. Must be called before the
   * resolver touches the store.
   */
  checkAccess(resolver: GatedResolver): void {
    const profileTier = STANCE_TO_TIER[this.tenantStance];
    if (TIER_ORDER[profileTier] < TIER_ORDER[resolver.azureTier]) {
      throw new Error(
        `StackShapeGate: profile "${this.tenantStance}" (azureTier "${profileTier}") cannot access a resolver requiring azureTier "${resolver.azureTier}"`,
      );
    }
  }
}
