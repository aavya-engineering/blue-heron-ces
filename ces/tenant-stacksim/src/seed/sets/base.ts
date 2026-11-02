// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../../store/StoreTypes.js';
import { G5_LICENSING, type SeedSet } from './gccHighG5.js';

/**
 * FX-07 / FX-08 (2026-10-26): the BASE seed - state every real Microsoft 365
 * tenant carries, applied by SeedEngine to EVERY profile and scenario (no
 * opt-in), after any named seed set.
 *
 * (a) Built-in Exchange Online / Teams singletons. A real tenant always has
 *     the `Default` malware, content and outbound-spam filter policies, the
 *     `Office365 AntiPhish Default` policy, the Teams `Global` external access
 *     policy, the admin audit log config and the OME configuration; a named
 *     mutation (`Set-MalwareFilterPolicy -Identity Default`) must find them.
 *     These objects moved here from the gcc-high-g5 set unchanged, so a
 *     tenant built with that set holds exactly what it held before.
 * (b) Users' `signInActivity` (FX-08): most users signed in recently, user-2
 *     and user-4 last signed in more than 90 days ago, and user-5 has none, so
 *     a stale-account guard can be exercised on each case. Applied as an
 *     ENRICH with "existing fields win": a named set that already gives a user
 *     sign-in data (gcc-high-g5 does, for user-1..5) keeps its values.
 */

/** P1.4b: the security-baseline template Stamper's CM.L2-3.4.1.security-baseline lookup captures. */
export const SECURITY_BASELINE_TEMPLATE = {
  id: '5ec0ba5e-0000-4000-8000-000000000001',
  displayName: 'MDM Security Baseline for Windows 10 and later',
} as const;

const BUILTIN = (id: string, fields: Record<string, unknown>): StoreObject => ({ id, Identity: id, Name: id, IsDefault: true, ...fields });

export const BASE_BUILTINS: Record<string, StoreObject[]> = {
  malwareFilterPolicy: [BUILTIN('Default', { EnableFileFilter: false, FileTypeAction: 'Reject' })],
  hostedContentFilterPolicy: [BUILTIN('Default', { HighConfidenceSpamAction: 'MoveToJmf', SpamAction: 'MoveToJmf', BulkThreshold: 7 })],
  hostedOutboundSpamFilterPolicy: [BUILTIN('Default', { RecipientLimitExternalPerHour: 0, ActionWhenThresholdReached: 'BlockUserForToday', AutoForwardingMode: 'Automatic' })],
  antiPhishPolicy: [BUILTIN('Office365 AntiPhish Default', { Enabled: true, EnableMailboxIntelligence: true })],
  // W5c2 follow-up 11: Defender for Office 365's "Built-In Protection Policy"
  // for Safe Links and Safe Attachments (every G5 tenant; IsDefault, so never
  // a customer equivalent for Stamper's lookups, and EXO takes no rule on it).
  safeLinksPolicy: [BUILTIN('Built-In Protection Policy', { IsBuiltInProtection: true, EnableSafeLinksForEmail: true, EnableSafeLinksForTeams: true, EnableSafeLinksForOffice: true, ScanUrls: true, EnableForInternalSenders: true, DeliverMessageAfterScan: true, TrackClicks: true, AllowClickThrough: false })],
  safeAttachmentPolicy: [BUILTIN('Built-In Protection Policy', { IsBuiltInProtection: true, Enable: true, Action: 'Block', QuarantineTag: 'AdminOnlyAccessPolicy' })],
  csExternalAccessPolicy: [BUILTIN('Global', { EnableFederationAccess: true, EnableTeamsConsumerAccess: true, EnableTeamsConsumerInbound: true })],
  adminAuditLogConfig: [
    { id: 'adminAuditLogConfig', Identity: 'Admin Audit Log Settings', UnifiedAuditLogIngestionEnabled: true, AdminAuditLogEnabled: true, AdminAuditLogAgeLimit: '90.00:00:00' },
  ],
  oMEConfiguration: [{ id: 'OME Configuration', Identity: 'OME Configuration', OTPEnabled: true, SocialIdSignIn: true }],
  // P1.4b (2026-10-27): a new tenant's organization config is "dehydrated"
  // until Enable-OrganizationCustomization runs (ResolverTable flips it).
  organizationConfig: [
    { id: 'organizationConfig', Identity: 'simtenant.onmicrosoft.us', Name: 'simtenant.onmicrosoft.us', DisplayName: 'Sim Tenant', IsDehydrated: true },
  ],
  // P1.4b: the Intune security-baseline template a tenant lists under
  // /beta/deviceManagement/templates (sim GUID, not a Microsoft constant).
  deviceManagementTemplates: [
    {
      id: SECURITY_BASELINE_TEMPLATE.id,
      '@odata.type': '#microsoft.graph.securityBaselineTemplate',
      displayName: SECURITY_BASELINE_TEMPLATE.displayName,
      description: 'Sim security baseline template for Windows 10 and later',
      templateType: 'securityBaseline',
      templateSubtype: 'none',
      platformType: 'windows10AndLater',
      versionInfo: 'Sim 1.0',
      isDeprecated: false,
      intentCount: 0,
    },
  ],
};

/**
 * W5c2 follow-up 8: Entra's built-in "Phishing-resistant MFA" authentication
 * strength (the platform's fixed id for it, the one S1's CA02 references).
 */
export const BUILTIN_PHISHING_RESISTANT_STRENGTH = {
  id: '00000000-0000-0000-0000-000000000004',
  displayName: 'Phishing-resistant MFA',
  description: 'Phishing-resistant, Passwordless methods for the strongest authentication, such as a FIDO2 security key',
  policyType: 'builtIn',
  requirementsSatisfied: 'mfa',
  allowedCombinations: ['windowsHelloForBusiness', 'fido2', 'x509CertificateMultiFactor'],
  createdDateTime: '2021-12-01T08:00:00Z',
  modifiedDateTime: '2021-12-01T08:00:00Z',
} as const;

/** Days since last sign-in per generated user index (1-based); `null` = never signed in. */
export function baseSignInAgeDays(index: number): number | null {
  if (index === 1) return 0;
  if (index === 2) return 120;
  if (index === 4) return 150;
  if (index === 5) return null;
  return (index % 7) + 1;
}

/** The sim's shared base domain (generated users' UPN suffix; organizationConfig's Identity). */
export const SIM_BASE_DOMAIN = 'simtenant.onmicrosoft.us';

/**
 * synthetic-customer W1 (2026-10-28): a scenario tenant's Graph /organization
 * verifiedDomains. The default domain is the tenant's own
 * `<slug>.simtenant.onmicrosoft.us` - the `primary_domain` SimTenantConfig
 * publishes; the initial domain is the shared base domain the generated users
 * and organizationConfig carry. Both verified (sim domains, not real ones).
 */
export function simVerifiedDomains(slug: string): Array<Record<string, unknown>> {
  const own = `${slug}.${SIM_BASE_DOMAIN}`;
  return [
    { name: own, isDefault: true, isInitial: false, type: 'Managed', capabilities: 'Email, OfficeCommunicationsOnline' },
    { name: SIM_BASE_DOMAIN, isDefault: false, isInitial: true, type: 'Managed', capabilities: 'Email, OfficeCommunicationsOnline' },
  ];
}

/**
 * synthetic-customer W1: tenant defaults for a scenario-built tenant. Each is
 * added only when no named seed set already filled that collection (a plain
 * add would overwrite or duplicate the named set's objects).
 *  - `tenantSlug`: the scenario name; the tenant id is `sim-tenant-<slug>`,
 *    the `tenant.tenant_id` SimTenantConfig publishes. Profile-only seeds
 *    (coverage runners, `stacksim seed`) pass none and get no defaults.
 *  - `supplied`: collections a named seed set added objects to.
 */
export interface BaseSeedDefaults {
  tenantSlug?: string;
  supplied: ReadonlySet<string>;
}

export function buildBaseSeed(nowMs: number, userCount: number, defaults?: BaseSeedDefaults): SeedSet {
  const users: Record<string, Record<string, unknown>> = {};
  for (let i = 1; i <= userCount; i++) {
    const age = baseSignInAgeDays(i);
    if (age === null) continue;
    const at = new Date(nowMs - age * 86400000).toISOString();
    users[`user-${i}`] = { signInActivity: { lastSignInDateTime: at, lastNonInteractiveSignInDateTime: at } };
  }
  const add: Record<string, StoreObject[]> = Object.fromEntries(Object.entries(BASE_BUILTINS).map(([k, v]) => [k, v.map((o) => ({ ...o }))]));
  // W5c2 follow-up 8: Entra's built-in "Phishing-resistant MFA" strength,
  // present in every tenant (every profile and scenario), unless a named set
  // already supplies authentication strengths.
  if (!defaults?.supplied.has('authenticationStrengthPolicies')) {
    add.authenticationStrengthPolicies = [{ ...BUILTIN_PHISHING_RESISTANT_STRENGTH, allowedCombinations: [...BUILTIN_PHISHING_RESISTANT_STRENGTH.allowedCombinations] }];
  }
  const slug = defaults?.tenantSlug;
  if (slug) {
    if (!defaults.supplied.has('organization')) {
      add.organization = [
        { id: `sim-tenant-${slug}`, displayName: 'Sim Tenant', tenantType: 'AAD', countryLetterCode: 'US', verifiedDomains: simVerifiedDomains(slug) },
      ];
    }
    // The G5 SKU (gcc-high-g5's constants) with every generated user licensed,
    // so consumedUnits = users carrying it, which Set-MgUserLicense keeps true.
    if (!defaults.supplied.has('subscribedSkus')) {
      add.subscribedSkus = [
        {
          id: G5_LICENSING.skuId,
          skuId: G5_LICENSING.skuId,
          skuPartNumber: G5_LICENSING.skuPartNumber,
          displayName: G5_LICENSING.primarySku,
          appliesTo: 'User',
          capabilityStatus: 'Enabled',
          prepaidUnits: { enabled: Math.max(G5_LICENSING.licenseCount, userCount), suspended: 0, warning: 0 },
          consumedUnits: userCount,
        },
      ];
      for (let i = 1; i <= userCount; i++) {
        users[`user-${i}`] = { ...(users[`user-${i}`] ?? {}), assignedLicenses: [{ skuId: G5_LICENSING.skuId, disabledPlans: [] }] };
      }
    }
  }
  return { enrich: { users }, add };
}
