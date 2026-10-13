// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

/**
 * Known object-type collection names, matching the "Object Surface CES Touches"
 * list in docs/context/VAULT.md. ObjectStore validates create()/update() calls
 * against this list so a typo'd or unmodeled objectType fails loudly instead of
 * silently creating a stray collection.
 */
export const KNOWN_OBJECT_TYPES: readonly string[] = [
  // Identity/Access
  'users',
  'servicePrincipals',
  'devices',
  'groups',
  'roleAssignments',
  'pimSchedules',
  'caPolicies',
  'namedLocations',
  'authMethods',
  'authorizationPolicy',
  // Audit
  'directoryAudits',
  'signInLogs',
  // CM
  'deviceCompliancePolicies',
  'managedDevices',
  'deviceConfigurations',
  'detectedApps',
  // Data protection
  'sensitivityLabels',
  'dlpPolicies',
  // GP-STACKSIM-1 fidelity tail (a) (2026-07-27): IPPS/Purview DLP policies
  // (Get-DlpCompliancePolicy, PascalCase, server-computed DistributionStatus)
  // - the derived cmdlet path maps this cmdlet's noun to this exact collection.
  'dlpCompliancePolicy',
  'encryptionStates',
  'touAgreements',
  // Security
  'secureScores',
  'alerts',
  'attackSimulations',
  'riskDetections',
  // M4 write surface (Invoke-MgGraphRequest mutation targets beyond authorizationPolicy)
  'authenticationMethodsPolicyConfigurations',
  // Azure infra (m365_azure/sentinel shapes)
  'storageAccounts',
  'keyVaults',
  'logAnalyticsWorkspaces',
  'automationAccounts',
  'vnets',
  'nsgs',
  'managedIdentities',
  'firewalls',
  // G-STACKSIM-2 iteration 3: EO ComplianceSignalFetcher.ts collections (see
  // src/resolvers/graphResolvers.ts's iteration-3 manual entries and
  // src/seed/generators/compliance.ts).
  'authenticationMethodsPolicy',
  'policyLabels',
  'authenticationStrengthPolicies',
  'roleManagementPolicies',
  'vulnerabilities',
  'crossTenantAccessPolicy',
  'authenticationMethodUserRegistrationDetails',
  'deviceManagementConfigurationPolicies',
  'deviceManagementIntents',
  // GP-STACKSIM-1 M3 (2026-07-25): collections every real tenant carries
  // that became SEEDED (profile-manifest) collections when the honest
  // item-404/-Filter fidelity commits exposed them - ProfileLoader validates
  // manifests against THIS list (the dynamic resolver-derived allowlist
  // below only covers codegen writes), so seedable collections must be here.
  'authenticationMethodsPolicyConfigurations',
  'keyVaultKeys',
  'keyVaultCertificates',
  // SIMFIX FIX-S2 (2026-09-27): the gcc-high-g5 seed set's collections
  // (src/seed/sets/gccHighG5.ts) - every object AO's 95 commands read/change.
  'groupMember',
  'subscribedSkus',
  'roleEligibilitySchedules',
  'roleEligibilityScheduleRequests',
  'applications',
  'applicationOwners',
  'servicePrincipalAppRoleAssignments',
  'riskyUsers',
  'directorySettings',
  'secureScoreControlProfiles',
  'securityIncidents',
  'deviceCompliancePolicyDeviceStatuses',
  'windowsAutopilotDeploymentProfiles',
  'androidManagedAppProtections',
  'androidManagedAppProtectionApps',
  'iosManagedAppProtections',
  'mailboxes',
  'malwareFilterPolicy',
  'hostedContentFilterPolicy',
  'hostedOutboundSpamFilterPolicy',
  'antiPhishPolicy',
  'csExternalAccessPolicy',
  'adminAuditLogConfig',
  'oMEConfiguration',
  'label',
  'retentionCompliancePolicy',
  'holdCompliancePolicy',
  'spoTenant',
  'spoSites',
  'spoUsers',
  'pnpLists',
  'pnpListItems',
  'unifiedAuditLog',
  'publicIpAddresses',
  'networkWatchers',
  'flowLogs',
  'routeTables',
  'sentinelAlertRules',
  'backupJobs',
  'diagnosticSettings',
  'armResources',
  // FC-SIM-2 (2026-09-28): EvidenceOps overlay signal reads (EO-03) - new
  // gcc-high-g5 seed collections (src/seed/sets/gccHighG5.ts) that have no
  // OTHER hand-authored resolver importer in every test's module graph
  // (SeedEngine.test.ts seeds directly, without importing ResolverTable.ts,
  // so the dynamic DYNAMIC_OBJECT_TYPES registration below never runs for
  // them) - must be hand-listed here like every other seed-only collection.
  'trainingUserCoverage',
  'lifecycleWorkflows',
];

/**
 * G-STACKSIM-2 iteration 2: collection names derived programmatically from
 * `coverage/inventory.json` (src/codegen/deriveResolversFromInventory.ts)
 * self-register here so a generated write resolver never trips the
 * hand-curated KNOWN_OBJECT_TYPES guard above. This does not weaken the
 * guard for typos in hand-authored code: KNOWN_OBJECT_TYPES stays the
 * VAULT-sourced list; this is a second, explicitly-populated allowlist for
 * codegen-derived collections only.
 */
const DYNAMIC_OBJECT_TYPES = new Set<string>();

export function registerObjectType(objectType: string): void {
  DYNAMIC_OBJECT_TYPES.add(objectType);
}

export function assertKnownObjectType(objectType: string): void {
  if (!KNOWN_OBJECT_TYPES.includes(objectType) && !DYNAMIC_OBJECT_TYPES.has(objectType)) {
    throw new Error(`ObjectStore: unknown object type "${objectType}"`);
  }
}
