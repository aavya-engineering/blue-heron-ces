// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { ObjectStore } from '../store/ObjectStore.js';
import type { Ledger } from '../ledger/Ledger.js';
import type { LedgerActor } from '../ledger/LedgerTypes.js';
import type { StoreObject } from '../store/StoreTypes.js';
import type { Profile } from '../profiles/ProfileLoader.js';
import * as identity from './generators/identity.js';
import * as devices from './generators/devices.js';
import * as caPolicies from './generators/caPolicies.js';
import * as azureResources from './generators/azureResources.js';
import * as compliance from './generators/compliance.js';
import { buildSeedSet, type SeedSetName } from './sets/gccHighG5.js';
import { buildBaseSeed } from './sets/base.js';

type Generator = (count: number) => StoreObject[];

const GENERATORS: Record<string, Generator> = {
  users: identity.generateUsers,
  servicePrincipals: identity.generateServicePrincipals,
  groups: identity.generateGroups,
  roleAssignments: identity.generateRoleAssignments,
  pimSchedules: identity.generatePimSchedules,
  authMethods: identity.generateAuthMethods,
  authorizationPolicy: identity.generateAuthorizationPolicy,
  devices: devices.generateDevices,
  deviceCompliancePolicies: devices.generateDeviceCompliancePolicies,
  managedDevices: devices.generateManagedDevices,
  deviceConfigurations: devices.generateDeviceConfigurations,
  detectedApps: devices.generateDetectedApps,
  caPolicies: caPolicies.generateCaPolicies,
  namedLocations: caPolicies.generateNamedLocations,
  logAnalyticsWorkspaces: azureResources.generateLogAnalyticsWorkspaces,
  storageAccounts: azureResources.generateStorageAccounts,
  keyVaults: azureResources.generateKeyVaults,
  automationAccounts: azureResources.generateAutomationAccounts,
  vnets: azureResources.generateVnets,
  nsgs: azureResources.generateNsgs,
  managedIdentities: azureResources.generateManagedIdentities,
  firewalls: azureResources.generateFirewalls,
  // G-STACKSIM-2 iteration 3: EO ComplianceSignalFetcher.ts collections (see
  // src/resolvers/graphResolvers.ts's iteration-3 manual entries and
  // src/seed/generators/compliance.ts's doc comment).
  authenticationMethodsPolicy: compliance.generateAuthenticationMethodsPolicy,
  secureScores: compliance.generateSecureScores,
  alerts: compliance.generateAlerts,
  policyLabels: compliance.generatePolicyLabels,
  authenticationStrengthPolicies: compliance.generateAuthenticationStrengthPolicies,
  touAgreements: compliance.generateTouAgreements,
  roleManagementPolicies: compliance.generateRoleManagementPolicies,
  vulnerabilities: compliance.generateVulnerabilities,
  crossTenantAccessPolicy: compliance.generateCrossTenantAccessPolicy,
  authenticationMethodUserRegistrationDetails: compliance.generateAuthenticationMethodUserRegistrationDetails,
  signInLogs: compliance.generateSignInLogs,
  deviceManagementConfigurationPolicies: compliance.generateDeviceManagementConfigurationPolicies,
  deviceManagementIntents: compliance.generateDeviceManagementIntents,
  sensitivityLabels: compliance.generateSensitivityLabels,
  dlpPolicies: compliance.generateDlpPolicies,
  // GP-STACKSIM-1 fidelity tail (a): IPPS Get-DlpCompliancePolicy collection
  // (server-computed DistributionStatus) - distinct from Graph dlpPolicies.
  dlpCompliancePolicy: compliance.generateDlpCompliancePolicies,
  attackSimulations: compliance.generateAttackSimulations,
  riskDetections: compliance.generateRiskDetections,
  // GP-STACKSIM-1 M3 (2026-07-25): collections real tenants always carry
  // that the post-report fidelity commits (STAB-1 M1b honest 404s,
  // FIDELITY-1 honest -Filter) exposed as unseeded - see each generator's
  // doc comment.
  authenticationMethodsPolicyConfigurations: compliance.generateAuthenticationMethodsPolicyConfigurations,
  keyVaultKeys: azureResources.generateKeyVaultKeys,
  keyVaultCertificates: azureResources.generateKeyVaultCertificates,
};

/**
 * synthetic-customer W0 (2026-10-28): the seeded-history clock anchor. With
 * STACKSIM_FIXED_NOW set (an ISO date-time; unit tests and reproducible
 * builds) the anchor is that instant; otherwise it is build time floored to
 * the UTC day. The customer-history seed set dates every record as this
 * anchor minus a fixed offset. Runtime stamps (ledger, directory audits,
 * resolver writes) stay on the live clock.
 */
export function seedAnchorMs(nowMs: number = Date.now(), env: NodeJS.ProcessEnv = process.env): number {
  const fixed = env.STACKSIM_FIXED_NOW;
  if (fixed !== undefined && fixed !== '') {
    const t = Date.parse(fixed);
    if (Number.isNaN(t)) throw new Error(`SeedEngine: STACKSIM_FIXED_NOW "${fixed}" is not an ISO date-time`);
    return t;
  }
  return Math.floor(nowMs / 86400000) * 86400000;
}

export interface SeedOptions {
  /** Per-seed-set build context (scenario `seedContext`), by set name. */
  seedContext?: Record<string, unknown>;
  /** synthetic-customer W1: the scenario name; turns on the base seed's tenant defaults (base.ts BaseSeedDefaults). */
  tenantSlug?: string;
}

export interface SeedResult {
  /** Objects created per collection (count generators + seed sets). */
  counts: Record<string, number>;
}

/**
 * Populates an ObjectStore from a validated Profile manifest, logging one
 * ledger 'create' entry per seeded object (Core Design (a)/(f)) so seeded
 * data is traceable in ledger.jsonl like any other creation.
 */
export class SeedEngine {
  constructor(
    private readonly store: ObjectStore,
    private readonly ledger: Ledger,
    private readonly actor: LedgerActor = 'probe',
  ) {}

  async seed(profile: Profile, opts: SeedOptions = {}): Promise<SeedResult> {
    const counts: Record<string, number> = {};
    // SIMFIX FIX-S2: seed sets (profile.seedSets) enrich generator objects by
    // id (existing fields win) and add objects/collections - see
    // src/seed/sets/gccHighG5.ts. Built once so every timestamp shares one "now".
    // synthetic-customer W0: customer-history is dated from the day-floored
    // anchor; the other sets keep the build-time "now" unless
    // STACKSIM_FIXED_NOW pins it.
    const fixed = process.env.STACKSIM_FIXED_NOW !== undefined && process.env.STACKSIM_FIXED_NOW !== '';
    const anchor = seedAnchorMs();
    const now = fixed ? anchor : Date.now();
    const sets = (profile.seedSets ?? []).map((n) =>
      buildSeedSet(n as SeedSetName, n === 'customer-history' || n === 'customer-history-s2' || n === 'customer-history-s3' ? anchor : now, opts.seedContext?.[n]),
    );
    // FX-07/FX-08: the base seed (src/seed/sets/base.ts) applies to every
    // profile and scenario, LAST, so a named set's enrich values win over it.
    // synthetic-customer W1: its tenant defaults (organization, subscribedSkus)
    // fill only collections no named set supplied.
    const supplied = new Set(sets.flatMap((st) => Object.entries(st.add).filter(([, v]) => v.length > 0).map(([k]) => k)));
    sets.push(buildBaseSeed(now, profile.counts.users ?? 0, { tenantSlug: opts.tenantSlug, supplied }));

    for (const [objectType, count] of Object.entries(profile.counts)) {
      if (count <= 0) continue;

      const generator = GENERATORS[objectType];
      if (!generator) {
        throw new Error(`SeedEngine: no generator registered for object type "${objectType}"`);
      }

      const objects = generator(count).map((obj) => {
        let out = obj;
        for (const set of sets) {
          const extra = set.enrich[objectType]?.[obj.id];
          if (extra) out = { ...extra, ...out };
          const app = set.append?.[objectType]?.[obj.id];
          if (app) {
            const next: Record<string, unknown> = { ...out };
            for (const [field, items] of Object.entries(app)) {
              next[field] = [...((out as Record<string, unknown>)[field] as unknown[] | undefined ?? []), ...items];
            }
            out = next as typeof out;
          }
          // PH-12 P12-AO: a set's override replaces the generator's value (the id never changes).
          const over = set.override?.[objectType]?.[obj.id];
          if (over) out = { ...out, ...over, id: out.id };
        }
        return out;
      });
      for (const obj of objects) {
        await this.createSeeded(objectType, obj);
      }
      counts[objectType] = objects.length;
    }

    for (const set of sets) {
      for (const [objectType, objects] of Object.entries(set.add)) {
        for (const obj of objects) {
          await this.createSeeded(objectType, obj);
        }
        counts[objectType] = (counts[objectType] ?? 0) + objects.length;
      }
    }

    return { counts };
  }

  private async createSeeded(objectType: string, obj: StoreObject): Promise<void> {
    await this.store.create(objectType, obj);
    await this.ledger.append({
      ts: new Date().toISOString(),
      type: 'create',
      objectType,
      objectId: obj.id,
      actor: this.actor,
      source: 'SeedEngine',
      milestone: 'M1',
      sessionType: 'seed',
      requestId: `seed-${objectType}-${obj.id}`,
    });
  }
}
