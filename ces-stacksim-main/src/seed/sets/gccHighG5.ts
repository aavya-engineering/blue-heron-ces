// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../../store/StoreTypes.js';

/**
 * SIMFIX FIX-S2 / GOAL-AO-SIM-COVERAGE M1-M5 (2026-09-27): the "gcc-high-g5"
 * seed set - a Microsoft 365 G5 (GCC High) tenant carrying every object and
 * field AO's 95 commands read or change, plus a deliberate gap for every
 * detect-type command to find.
 *
 * How it is applied (SeedEngine): the profile's count-based generators run
 * first (their objects and ids are unchanged); this set then (a) ENRICHES
 * existing seeded objects by id with additional fields - never changing an
 * existing field's value - and (b) ADDS new objects/collections. A profile
 * opts in with `"seedSets": ["gcc-high-g5"]` (profiles/m365-azure.json does:
 * AO's harness can only seed that profile). Scenarios opt in explicitly, so
 * demo-dib-small and the muster-* scenarios stay byte-identical.
 *
 * Ids are deterministic (same input -> same ids). Timestamps are relative to
 * the seed time (`now`), so "inactive 120+ days" / "expires in 10 days" hold
 * when the tenant is built; audit-log records use `ageMinutes` and are dated
 * at query time (see semantics.ts searchUnifiedAuditLog).
 *
 * Every person, company, domain and SKU here is fictional; no real Microsoft
 * GUID is used except the three built-in Entra role template ids and the
 * Graph Directory.ReadWrite.All app-role id, which are platform constants
 * identical in every tenant (AO filters on them).
 */

export const SEED_SET_NAMES = ['gcc-high-g5'] as const;
export type SeedSetName = (typeof SEED_SET_NAMES)[number];

/** Licensing - the single source for both the seed and the tenant object (founder decision OD-6). */
export const G5_LICENSING = {
  /** Stamper tenant manifest `tenant_identity.primary_sku`. */
  primarySku: 'Microsoft 365 G5',
  /** Stamper tenant manifest `tenant_identity.license_count`. */
  licenseCount: 25,
  /** Stamper tenant manifest `tenant_identity.addon_skus`. */
  addonSkus: [] as string[],
  /** Sim-style SKU id (no real Microsoft GUID) - published as resources.m365_license_sku_id. */
  skuId: 'sim-sku-g5',
  skuPartNumber: 'SIM_M365_G5_GCCHIGH',
};

/** Built-in Entra role template ids - identical in every tenant (platform constants, not tenant data). */
export const BUILTIN_ROLES = {
  globalAdministrator: '62e90394-69f5-4237-9190-012177145e10',
  privilegedRoleAdministrator: 'e8611ab8-c189-46e8-94e1-60213ab1f814',
  securityAdministrator: '194ae4cb-b126-40b2-bd5b-6091b380977d',
};

const DOMAIN = 'simtenant.onmicrosoft.us';
const upn = (local: string) => `${local}@${DOMAIN}`;

/**
 * The ids/names this set creates that the tenant object publishes
 * (buildSimTenantConfig reads THESE constants - never parallel literals).
 */
export const G5_IDS = {
  m365LicenseSkuId: G5_LICENSING.skuId,
  baseGroupId: 'group-4',
  loaGroupId: 'group-5',
  adminGroupId: 'group-6',
  trainingEnforcementGroupId: 'group-7',
  cuiGroupId: 'group-1',
  cuiGroupName: 'CUI-Authorized-Users',
  namedLocationId: 'namedLocation-1',
  deviceComplianceCaPolicyId: 'caPolicy-4',
  adminPortalCaPolicyId: 'caPolicy-5',
  androidAppProtectionPolicyId: 'androidManagedAppProtection-1',
  iosAppProtectionPolicyId: 'iosManagedAppProtection-1',
  cuiSiteUrl: 'https://simtenant.sharepoint.us/sites/cui',
  firewallName: 'sim-fw-1',
  publicIpName: 'sim-fw-pip-1',
  backupVaultName: 'sim-rsv-1',
  auditLogRetentionDays: '365',
  itHelpDeskPhone: '+1-555-0100',
  approverUpn: upn('sim.user3'),
  operatorUserId: 'user-1',
  breakGlassUserId: 'user-2',
  serviceAccountUpn: upn('svc.backup'),
} as const;

export interface SeedSet {
  /** Extra fields merged onto generator-seeded objects, by collection then id. Existing field values win. */
  enrich: Record<string, Record<string, Record<string, unknown>>>;
  /** Items APPENDED to an existing array field of a generator-seeded object (existing items kept). */
  append?: Record<string, Record<string, Record<string, unknown[]>>>;
  /** New objects, by collection. */
  add: Record<string, StoreObject[]>;
}

function daysAgo(now: number, d: number): string {
  return new Date(now - d * 86400000).toISOString();
}
function daysAhead(now: number, d: number): string {
  return new Date(now + d * 86400000).toISOString();
}

export function buildSeedSet(name: SeedSetName, nowMs: number = Date.now()): SeedSet {
  if (name !== 'gcc-high-g5') throw new Error(`unknown seed set "${name as string}"`);
  const now = nowMs;
  const lic = [{ skuId: G5_LICENSING.skuId, disabledPlans: [] as string[] }];
  const signIn = (d: number) => ({ lastSignInDateTime: daysAgo(now, d), lastNonInteractiveSignInDateTime: daysAgo(now, d) });

  // ---------------------------------------------------------------- users
  const userEnrich: Record<string, Record<string, unknown>> = {
    'user-1': { userType: 'Member', jobTitle: 'IT Security Operator', department: 'IT', createdDateTime: daysAgo(now, 700), signInActivity: signIn(0), assignedLicenses: lic, mail: upn('sim.user1'), onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 40) },
    'user-2': { userType: 'Member', jobTitle: 'Emergency Access (Break Glass)', department: 'IT', createdDateTime: daysAgo(now, 700), signInActivity: signIn(60), assignedLicenses: lic, mail: upn('sim.user2'), onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 180) },
    'user-3': { userType: 'Member', jobTitle: 'Manufacturing Engineer', department: 'Engineering', createdDateTime: daysAgo(now, 500), signInActivity: signIn(1), assignedLicenses: lic, mail: upn('sim.user3'), onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 30) },
    'user-4': { userType: 'Member', jobTitle: 'Quality Inspector', department: 'Quality', createdDateTime: daysAgo(now, 400), signInActivity: signIn(2), assignedLicenses: lic, mail: upn('sim.user4'), onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 60) },
    'user-5': { userType: 'Member', jobTitle: 'Buyer', department: 'Purchasing', createdDateTime: daysAgo(now, 300), signInActivity: signIn(5), assignedLicenses: lic, mail: upn('sim.user5'), onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 90) },
  };
  const users: StoreObject[] = [
    { id: 'user-6', displayName: 'Sim Backup Service', userPrincipalName: G5_IDS.serviceAccountUpn, accountEnabled: true, userType: 'Member', jobTitle: 'Service Account', department: 'IT', createdDateTime: daysAgo(now, 900), signInActivity: signIn(0), assignedLicenses: [], mail: null, onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 420) },
    // Deliberate gap: an unlicensed contractor.
    { id: 'user-7', displayName: 'Sim Contractor', userPrincipalName: upn('sim.contractor1'), accountEnabled: true, userType: 'Member', jobTitle: 'Contractor', department: 'Contractors', employeeType: 'Contractor', createdDateTime: daysAgo(now, 120), signInActivity: signIn(3), assignedLicenses: [], mail: upn('sim.contractor1'), onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 120) },
    // Deliberate gap: enabled, licensed, no sign-in for 150 days.
    { id: 'user-8', displayName: 'Sim Inactive User', userPrincipalName: upn('sim.inactive1'), accountEnabled: true, userType: 'Member', jobTitle: 'Machinist', department: 'Production', createdDateTime: daysAgo(now, 800), signInActivity: signIn(150), assignedLicenses: lic, mail: upn('sim.inactive1'), onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 300) },
    // Deliberate gap: two guests, one invited 200 days ago.
    { id: 'user-9', displayName: 'Sim Partner Guest One', userPrincipalName: `partner.one_example.test#EXT#@${DOMAIN}`, accountEnabled: true, userType: 'Guest', externalUserState: 'Accepted', createdDateTime: daysAgo(now, 200), signInActivity: signIn(100), assignedLicenses: [], mail: 'partner.one@example.test', onPremisesSyncEnabled: null },
    { id: 'user-10', displayName: 'Sim Partner Guest Two', userPrincipalName: `partner.two_example.test#EXT#@${DOMAIN}`, accountEnabled: true, userType: 'Guest', externalUserState: 'PendingAcceptance', createdDateTime: daysAgo(now, 20), signInActivity: { lastSignInDateTime: null, lastNonInteractiveSignInDateTime: null }, assignedLicenses: [], mail: 'partner.two@example.test', onPremisesSyncEnabled: null },
    { id: 'user-11', displayName: 'Sim Continuity Lead', userPrincipalName: upn('sim.bcp1'), accountEnabled: true, userType: 'Member', jobTitle: 'Business Continuity Officer', department: 'Operations', createdDateTime: daysAgo(now, 600), signInActivity: signIn(4), assignedLicenses: lic, mail: upn('sim.bcp1'), onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 50) },
    // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-users): a disabled leaver -
    // EO's PS.L2-3.9.2 personnel-action evaluator needs at least one disabled
    // account to check for residual directory-role access against (none held
    // here, so a leaver workflow that removes access is genuinely evidenced).
    { id: 'user-12', displayName: 'Sim Departed Employee', userPrincipalName: upn('sim.departed1'), accountEnabled: false, userType: 'Member', jobTitle: 'Former Machinist', department: 'Production', createdDateTime: daysAgo(now, 250), signInActivity: signIn(35), assignedLicenses: [], mail: upn('sim.departed1'), onPremisesSyncEnabled: null, lastPasswordChangeDateTime: daysAgo(now, 200) },
  ];
  const licensedCount =
    Object.values(userEnrich).filter((u) => (u.assignedLicenses as unknown[]).length > 0).length +
    users.filter((u) => ((u.assignedLicenses as unknown[] | undefined) ?? []).length > 0).length;

  // --------------------------------------------------------------- groups
  const sec = (description: string) => ({ groupTypes: [] as string[], securityEnabled: true, mailEnabled: false, description });
  const groupEnrich = {
    'group-1': { ...sec('Users authorized to access CUI'), mail: upn('cui-authorized'), mailNickname: 'cui-authorized' },
    'group-2': { ...sec('Engineering access group') },
    'group-3': { ...sec('Quality access group') },
  };
  const groups: StoreObject[] = [
    { id: 'group-4', displayName: 'All-Staff-Base', ...sec('Baseline group every new hire joins') },
    { id: 'group-5', displayName: 'LOA-Suspended', ...sec('Leave of absence - access blocked') },
    { id: 'group-6', displayName: 'Privileged-Admins', ...sec('Separated privileged admin accounts') },
    { id: 'group-7', displayName: 'Training-Not-Complete-Restricted', ...sec('New hires restricted until security training is complete') },
    // Deliberate gap: a PUBLIC Microsoft 365 (Teams) group.
    { id: 'group-8', displayName: 'Shop Floor Team', groupTypes: ['Unified'], securityEnabled: false, mailEnabled: true, visibility: 'Public', mailNickname: 'shopfloor', createdDateTime: daysAgo(now, 250) },
    { id: 'group-9', displayName: 'CUI Program Team', groupTypes: ['Unified'], securityEnabled: false, mailEnabled: true, visibility: 'Private', mailNickname: 'cuiprogram', createdDateTime: daysAgo(now, 300) },
  ];
  const member = (g: string, u: string): StoreObject => ({ id: `${g}|${u}`, groupId: g, memberId: u });
  const groupMember: StoreObject[] = [
    member('group-1', 'user-1'), member('group-1', 'user-3'), member('group-1', 'user-7'),
    member('group-2', 'user-3'), member('group-2', 'user-4'),
    member('group-3', 'user-5'),
    ...['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-7', 'user-8', 'user-11'].map((u) => member('group-4', u)),
    member('group-6', 'user-1'),
    member('group-8', 'user-3'), member('group-8', 'user-4'),
    member('group-9', 'user-1'), member('group-9', 'user-3'),
  ];

  // ------------------------------------------------------------ licensing
  const subscribedSkus: StoreObject[] = [
    {
      id: G5_LICENSING.skuId,
      skuId: G5_LICENSING.skuId,
      skuPartNumber: G5_LICENSING.skuPartNumber,
      displayName: G5_LICENSING.primarySku,
      appliesTo: 'User',
      capabilityStatus: 'Enabled',
      prepaidUnits: { enabled: G5_LICENSING.licenseCount, suspended: 0, warning: 0 },
      consumedUnits: licensedCount,
    },
  ];

  // --------------------------------------------------------- PIM / roles
  const roleAssignments: StoreObject[] = [
    // Deliberate gap: a STANDING Global Administrator assignment (A-10 converts it).
    { id: 'roleAssignment-3', principalId: 'user-1', roleDefinitionId: BUILTIN_ROLES.globalAdministrator, directoryScopeId: '/' },
    { id: 'roleAssignment-4', principalId: 'user-2', roleDefinitionId: BUILTIN_ROLES.globalAdministrator, directoryScopeId: '/' },
    { id: 'roleAssignment-5', principalId: 'user-6', roleDefinitionId: 'sim-role-kv-secrets-officer', directoryScopeId: '/subscriptions/sim-sub/resourceGroups/sim-rg/providers/Microsoft.KeyVault/vaults/sim-kv-1' },
  ];
  const sched = (n: number, principalId: string, roleDefinitionId: string): StoreObject => ({
    id: `roleEligibilitySchedule-${n}`,
    principalId,
    roleDefinitionId,
    directoryScopeId: '/',
    memberType: 'Direct',
    status: 'Provisioned',
    createdDateTime: daysAgo(now, 90),
    scheduleInfo: { startDateTime: daysAgo(now, 90), expiration: { type: 'afterDateTime', endDateTime: daysAhead(now, 275) } },
  });
  const roleEligibilitySchedules = [
    sched(1, 'user-3', BUILTIN_ROLES.privilegedRoleAdministrator),
    sched(2, 'user-4', BUILTIN_ROLES.securityAdministrator),
    sched(3, 'user-2', BUILTIN_ROLES.globalAdministrator),
  ];

  // ------------------------------------------------------- apps and SPNs
  const pwd = (keyId: string, displayName: string, start: number, end: number) => ({
    keyId, displayName, startDateTime: daysAgo(now, start), endDateTime: end >= 0 ? daysAhead(now, end) : daysAgo(now, -end), hint: 'sim',
  });
  const applications: StoreObject[] = [
    {
      id: 'application-1', appId: '00000000-0000-0000-0000-000000000001', displayName: 'Sim Evidence Collector', signInAudience: 'AzureADMyOrg',
      // one expired secret (rotation target) + one current
      passwordCredentials: [pwd('sim-key-application-1-a', 'initial', 400, -35), pwd('sim-key-application-1-b', 'current', 60, 300)],
      keyCredentials: [],
    },
    {
      // Deliberate gaps: secret expires in 10 days, and the app has NO owner.
      id: 'application-2', appId: '00000000-0000-0000-0000-000000000002', displayName: 'Sim Legacy HR Connector', signInAudience: 'AzureADMyOrg',
      passwordCredentials: [pwd('sim-key-application-2-a', 'hr-sync', 355, 10)],
      keyCredentials: [],
    },
    {
      id: 'application-3', appId: '00000000-0000-0000-0000-000000000003', displayName: 'Sim Payroll Export', signInAudience: 'AzureADMyOrg',
      passwordCredentials: [],
      keyCredentials: [{ keyId: 'sim-cert-application-3-a', displayName: 'CN=sim-payroll-export', type: 'AsymmetricX509Cert', usage: 'Verify', startDateTime: daysAgo(now, 165), endDateTime: daysAhead(now, 200) }],
    },
  ];
  const applicationOwners: StoreObject[] = [
    { id: 'application-1|user-1', applicationId: 'application-1', memberId: 'user-1' },
    { id: 'application-3|user-6', applicationId: 'application-3', memberId: 'user-6' },
  ];
  const spEnrich = {
    'sp-1': { servicePrincipalType: 'Application', appDisplayName: 'Sim Evidence Collector', signInAudience: 'AzureADMyOrg', appRoles: [] },
    // Deliberate gap: an application SPN on a client secret instead of a managed identity.
    'sp-2': { servicePrincipalType: 'Application', appDisplayName: 'Sim Legacy HR Connector', signInAudience: 'AzureADMyOrg', appRoles: [] },
  };
  const servicePrincipals: StoreObject[] = [
    { id: 'sp-3', displayName: 'sim-automation-1', appId: '00000000-0000-0000-0000-000000000004', servicePrincipalType: 'ManagedIdentity', signInAudience: 'AzureADMyOrg', appRoles: [] },
  ];
  const servicePrincipalAppRoleAssignments: StoreObject[] = [
    { id: 'sp-1|auditlog-read', servicePrincipalId: 'sp-1', principalId: 'sp-1', principalDisplayName: 'Sim Evidence Collector', resourceDisplayName: 'Microsoft Graph', appRoleId: 'b0afded3-3588-46d8-8b3d-9842eff778da', createdDateTime: daysAgo(now, 300) },
    // Deliberate gap: over-privileged consent (Directory.ReadWrite.All).
    { id: 'sp-2|directory-readwrite', servicePrincipalId: 'sp-2', principalId: 'sp-2', principalDisplayName: 'Sim Legacy HR Connector', resourceDisplayName: 'Microsoft Graph', appRoleId: '19dbc75e-c2e2-444c-a770-ec69d8559fc7', createdDateTime: daysAgo(now, 355) },
  ];

  // ---------------------------------------------------- identity security
  const riskyUsers: StoreObject[] = [
    // Deliberate gap: a high-risk user nobody has triaged.
    { id: 'user-3', userPrincipalName: upn('sim.user3'), userDisplayName: 'Sim User 3', riskLevel: 'high', riskState: 'atRisk', riskDetail: 'none', riskLastUpdatedDateTime: daysAgo(now, 1), isDeleted: false, isProcessing: false },
    { id: 'user-8', userPrincipalName: upn('sim.inactive1'), userDisplayName: 'Sim Inactive User', riskLevel: 'none', riskState: 'remediated', riskDetail: 'userPerformedSecuredPasswordReset', riskLastUpdatedDateTime: daysAgo(now, 40), isDeleted: false, isProcessing: false },
  ];
  const signInLogs: StoreObject[] = [
    { id: 'signIn-risky-1', userPrincipalName: upn('sim.user3'), userId: 'user-3', createdDateTime: daysAgo(now, 1), riskLevelDuringSignIn: 'high', riskEventTypes_v2: ['unfamiliarFeatures'], ipAddress: '203.0.113.50', location: { city: 'Unknown', countryOrRegion: 'ZZ' }, status: { errorCode: 0 } },
    { id: 'signIn-risky-2', userPrincipalName: upn('sim.user3'), userId: 'user-3', createdDateTime: daysAgo(now, 2), riskLevelDuringSignIn: 'medium', riskEventTypes_v2: ['anonymizedIPAddress'], ipAddress: '198.51.100.23', location: { city: 'Unknown', countryOrRegion: 'ZZ' }, status: { errorCode: 0 } },
  ];
  const method = (id: string, userId: string, odataType: string, extra: Record<string, unknown> = {}): StoreObject => ({
    id, userId, '@odata.type': odataType, ...extra, AdditionalProperties: { '@odata.type': odataType, ...extra },
  });
  const authMethodEnrich = {
    'authMethod-1': { '@odata.type': '#microsoft.graph.fido2AuthenticationMethod', AdditionalProperties: { '@odata.type': '#microsoft.graph.fido2AuthenticationMethod' } },
    'authMethod-2': { '@odata.type': '#microsoft.graph.fido2AuthenticationMethod', AdditionalProperties: { '@odata.type': '#microsoft.graph.fido2AuthenticationMethod' } },
    'authMethod-3': { '@odata.type': '#microsoft.graph.fido2AuthenticationMethod', AdditionalProperties: { '@odata.type': '#microsoft.graph.fido2AuthenticationMethod' } },
  };
  const authMethods: StoreObject[] = [
    method('authMethod-4', 'user-3', '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod', { displayName: 'SIM-PHONE-USER3' }),
    // Deliberate gap: an SMS-only user.
    method('authMethod-5', 'user-4', '#microsoft.graph.phoneAuthenticationMethod', { phoneType: 'mobile', phoneNumber: '+1 555 0104', smsSignInState: 'ready' }),
    method('authMethod-6', 'user-5', '#microsoft.graph.passwordAuthenticationMethod'),
    method('authMethod-7', 'user-11', '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod', { displayName: 'SIM-PHONE-BCP1' }),
  ];
  const directorySettings: StoreObject[] = [
    {
      id: 'directorySetting-1',
      displayName: 'Password Rule Settings',
      templateId: '5cf42378-d67d-4f36-ba46-e8b86229381d',
      values: [
        { name: 'BannedPasswordCheckOnPremisesMode', value: 'Audit' },
        { name: 'EnableBannedPasswordCheckOnPremises', value: 'True' },
        { name: 'EnableBannedPasswordCheck', value: 'True' },
        { name: 'LockoutDurationInSeconds', value: '60' },
        { name: 'LockoutThreshold', value: '10' },
        // Deliberate gap: no custom banned-password list.
        { name: 'BannedPasswordList', value: '' },
      ],
    },
  ];
  const secureScoreControlProfiles: StoreObject[] = [
    { id: 'AdminMFAV2', title: 'Ensure multifactor authentication is enabled for all users in administrative roles', controlCategory: 'Identity', maxScore: 10, implementationStatus: 'implemented', tier: 'Core', threats: ['accountBreach'] },
    { id: 'BlockLegacyAuthentication', title: 'Enable policy to block legacy authentication', controlCategory: 'Identity', maxScore: 8, implementationStatus: 'implemented', tier: 'Core', threats: ['passwordCracking'] },
    { id: 'SelfServicePasswordReset', title: 'Enable self-service password reset', controlCategory: 'Identity', maxScore: 1, implementationStatus: 'notImplemented', tier: 'Core', threats: ['accountBreach'] },
    { id: 'mdo_safeattachments', title: 'Turn on Safe Attachments in block mode', controlCategory: 'Apps', maxScore: 8, implementationStatus: 'notImplemented', tier: 'Defense in Depth', threats: ['malware'] },
    { id: 'ASC_StorageSecureTransfer', title: 'Secure transfer to storage accounts should be enabled', controlCategory: 'AzureResourceManager', maxScore: 5, implementationStatus: 'partial', tier: 'Core', threats: ['dataExfiltration'] },
    { id: 'ASC_DiagnosticLogs', title: 'Diagnostic logs in Key Vault should be enabled', controlCategory: 'AzureResourceManager', maxScore: 3, implementationStatus: 'notImplemented', tier: 'Core', threats: ['elevationOfPrivilege'] },
  ];
  const securityIncidents: StoreObject[] = [
    // Deliberate gap: a new, unassigned high-severity incident. FC-SIM-2
    // (2026-09-28, REQ-tenant-stacksim-security-incidents): 2 distinct alert
    // sources - AU.L2-3.3.5's correlation evaluator reaches `met` on this one.
    { id: 'incident-1', displayName: 'Multi-stage incident involving initial access on one device', severity: 'high', status: 'active', classification: 'unknown', determination: 'unknown', assignedTo: null, createdDateTime: daysAgo(now, 0.2), lastUpdateDateTime: daysAgo(now, 0.2),
      alerts: [
        { id: 'alert-inc1-1', serviceSource: 'microsoftDefenderForEndpoint', detectionSource: 'antivirus' },
        { id: 'alert-inc1-2', serviceSource: 'microsoftDefenderForOffice365', detectionSource: 'microsoftDefenderForOffice365' },
      ] },
    // Single alert source - does not correlate on its own (the evaluator's not-met case).
    { id: 'incident-2', displayName: 'Suspicious inbox rule', severity: 'low', status: 'resolved', classification: 'falsePositive', determination: 'other', assignedTo: upn('sim.user1'), createdDateTime: daysAgo(now, 25), lastUpdateDateTime: daysAgo(now, 20),
      alerts: [{ id: 'alert-inc2-1', serviceSource: 'azureAdIdentityProtection', detectionSource: 'azureAdIdentityProtection' }] },
  ];
  const alertEnrich = {
    'alert-1': { category: 'Malware', deviceId: 'managedDevice-3', createdDateTime: daysAgo(now, 0.1), description: 'Malware detected on a managed device', recommendedActions: 'Isolate the device and run a full scan' },
    'alert-2': { category: 'InitialAccess', createdDateTime: daysAgo(now, 1), description: 'Unfamiliar sign-in properties', recommendedActions: 'Confirm the sign-in with the user' },
  };
  const alerts: StoreObject[] = [
    { id: 'alert-3', title: 'Sim continuity plan test overdue', severity: 'low', status: 'newAlert', category: 'BusinessContinuity', createdDateTime: daysAgo(now, 3) },
    { id: 'alert-4', title: 'Sim backup job failed', severity: 'high', status: 'newAlert', category: 'Backup', createdDateTime: daysAgo(now, 1) },
  ];

  // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-training-user-coverage):
  // attack-simulation training coverage, keyed to REAL eligible directory
  // users (accountEnabled + Member + licensed - see `userEnrich`/`users`
  // above) so AT.L2-3.2.1/3.2.3's population-vs-trained correlation is
  // genuine, not a disconnected fixture. user-1 completed both trainings
  // (met for both practices); user-2 completed awareness only, insider
  // training remains "assigned" (not completed - a met/not-met split within
  // the SAME record); user-3/4/5/8/11 have none (the not-met population).
  const trainingUserCoverage: StoreObject[] = [
    { id: 'training-user-1', attackSimulationUser: { userId: 'user-1', displayName: 'Sim User 1', email: upn('sim.user1') },
      userTrainings: [
        { assignedDateTime: daysAgo(now, 90), completionDateTime: daysAgo(now, 60), displayName: 'Security Awareness Essentials', trainingStatus: 'completed' },
        { assignedDateTime: daysAgo(now, 70), completionDateTime: daysAgo(now, 40), displayName: 'Insider Threat Indicators', trainingStatus: 'completed' },
      ] },
    { id: 'training-user-2', attackSimulationUser: { userId: 'user-2', displayName: 'Sim User 2', email: upn('sim.user2') },
      userTrainings: [
        { assignedDateTime: daysAgo(now, 120), completionDateTime: daysAgo(now, 90), displayName: 'Security Awareness Essentials', trainingStatus: 'completed' },
        { assignedDateTime: daysAgo(now, 20), completionDateTime: null, displayName: 'Insider Threat Indicators', trainingStatus: 'assigned' },
      ] },
  ];

  // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-lifecycle-workflows): an
  // enforced leaver workflow that disables the account (Microsoft built-in
  // task id - matches EO's LEAVER_ACCESS_TASK_IDS) and an enforced mover
  // workflow (met-contributing), plus a defined-but-NOT-scheduled joiner
  // workflow (the not-met case: it exists but is not enforced).
  const lifecycleWorkflows: StoreObject[] = [
    { id: 'lifecycleWorkflow-1', category: 'leaver', displayName: 'Sim Offboard On Last Day', isEnabled: true, isSchedulingEnabled: true,
      tasks: [
        { id: 'lwf-task-1', displayName: 'Disable User Account', taskDefinitionId: '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950', isEnabled: true },
        { id: 'lwf-task-2', displayName: 'Remove user from all groups', taskDefinitionId: 'b3a31406-2a15-4c9a-b25b-a658fa5f07fc', isEnabled: true },
      ] },
    { id: 'lifecycleWorkflow-2', category: 'mover', displayName: 'Sim Department Transfer', isEnabled: true, isSchedulingEnabled: true,
      tasks: [{ id: 'lwf-task-3', displayName: 'Remove user from selected groups', taskDefinitionId: '1953a66c-751c-45e5-8bfe-01462c70da3c', isEnabled: true }] },
    // Deliberate gap: defined but not scheduled - exists on paper, never runs.
    { id: 'lifecycleWorkflow-3', category: 'joiner', displayName: 'Sim New Hire Onboarding (draft)', isEnabled: true, isSchedulingEnabled: false,
      tasks: [{ id: 'lwf-task-4', displayName: 'Add user to groups', taskDefinitionId: '22046e01-3e0a-4102-a8b7-08a4b810bda5', isEnabled: true }] },
  ];

  // ------------------------------------------------ conditional access
  const cond = (extra: Record<string, unknown> = {}) => ({
    users: { includeUsers: ['All'], excludeUsers: [] as string[] },
    applications: { includeApplications: ['All'] },
    clientAppTypes: ['all'],
    ...extra,
  });
  const caPolicies: StoreObject[] = [
    // Deliberate gap: exists but disabled.
    { id: 'caPolicy-4', displayName: 'Require Compliant Device', state: 'disabled', createdDateTime: '2026-01-04T00:00:00.000Z', conditions: cond(), grantControls: { operator: 'OR', builtInControls: ['compliantDevice'] } },
    { id: 'caPolicy-5', displayName: 'Admin Portal IP Restriction', state: 'disabled', createdDateTime: '2026-01-05T00:00:00.000Z', conditions: cond({ applications: { includeApplications: ['MicrosoftAdminPortals'] } }), grantControls: { operator: 'OR', builtInControls: ['block'] } },
    { id: 'caPolicy-6', displayName: 'Block Legacy Authentication', state: 'enabled', createdDateTime: '2026-01-06T00:00:00.000Z', conditions: cond({ clientAppTypes: ['exchangeActiveSync', 'other'] }), grantControls: { operator: 'OR', builtInControls: ['block'] } },
    // A-20: two policies sharing one name (moved here from the coverage harness).
    { id: 'caPolicy-dup-a', displayName: 'Sim Duplicate CA Policy', state: 'enabled', createdDateTime: '2025-01-01T00:00:00.000Z', conditions: cond() },
    { id: 'caPolicy-dup-b', displayName: 'Sim Duplicate CA Policy', state: 'disabled', createdDateTime: '2025-06-01T00:00:00.000Z', conditions: cond() },
  ];
  const namedLocationEnrich = {
    'namedLocation-1': {
      '@odata.type': '#microsoft.graph.ipNamedLocation',
      ipRanges: [{ '@odata.type': '#microsoft.graph.iPv4CidrRange', cidrAddress: '198.51.100.0/24' }],
      createdDateTime: '2026-01-01T00:00:00.000Z',
    },
    'namedLocation-2': {
      '@odata.type': '#microsoft.graph.ipNamedLocation',
      ipRanges: [{ '@odata.type': '#microsoft.graph.iPv4CidrRange', cidrAddress: '192.0.2.0/24' }],
      createdDateTime: '2026-01-02T00:00:00.000Z',
    },
  };

  // --------------------------------------------------------------- devices
  const dev = (n: number, os: string, osVersion: string, serial: string, d: number) => ({
    operatingSystem: os, osVersion, serialNumber: serial, manufacturer: 'Sim Computers', model: os === 'iOS' ? 'SimPhone 12' : 'SimBook 14',
    enrolledDateTime: daysAgo(now, 30 * n + 10), lastSyncDateTime: daysAgo(now, d), azureADDeviceId: `aad-device-${n}`,
    managementState: 'managed', lostModeState: 'disabled', deviceActionResults: [] as unknown[],
    // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-run-hunting-query): Defender
    // vulnerability-assessment recency tracks the device's own sync cadence -
    // a device that syncs stays assessed; managedDevice-5 (the kiosk, synced
    // 12 days ago) is a genuine stale-assessment gap, the rest (<=4 days) are
    // current (RA.L2-3.11.2's 7-day recency window).
    lastTvmAssessed: daysAgo(now, d),
  });
  const managedDeviceEnrich = {
    'managedDevice-1': dev(1, 'Windows', '10.0.22631.4317', 'SIM-SN-0001', 0),
    'managedDevice-2': dev(2, 'Windows', '10.0.22631.4317', 'SIM-SN-0002', 1),
    'managedDevice-3': dev(3, 'Windows', '10.0.22631.4317', 'SIM-SN-0003', 0),
    'managedDevice-4': dev(4, 'Windows', '10.0.22631.4169', 'SIM-SN-0004', 2),
  };
  const managedDevices: StoreObject[] = [
    // Deliberate gaps: non-compliant shared kiosk on an outdated build.
    { id: 'managedDevice-5', deviceName: 'KIOSK-SHOP-01', complianceState: 'noncompliant', isEncrypted: false, userPrincipalName: upn('sim.contractor1'), managedDeviceOwnerType: 'company', ...dev(5, 'Windows', '10.0.19044.1288', 'SIM-SN-0005', 12) },
    // A personally owned phone (B-05 retires rather than wipes it).
    { id: 'managedDevice-6', deviceName: 'SIM-PHONE-USER4', complianceState: 'compliant', isEncrypted: true, userPrincipalName: upn('sim.user4'), managedDeviceOwnerType: 'personal', ...dev(6, 'iOS', '17.6.1', 'SIM-SN-0006', 1) },
    // A newly enrolled device still carrying its factory name.
    { id: 'managedDevice-7', deviceName: 'DESKTOP-SIM0007', complianceState: 'compliant', isEncrypted: true, userPrincipalName: null, managedDeviceOwnerType: 'company', ...dev(7, 'Windows', '10.0.22631.4317', 'SN-AOW4-0001', 0) },
    // Deliberate gap: hardware inventory hole (no serial number reported).
    { id: 'managedDevice-8', deviceName: 'SIM-LAPTOP-008', complianceState: 'compliant', isEncrypted: true, userPrincipalName: upn('sim.user5'), managedDeviceOwnerType: 'company', ...dev(8, 'Windows', '10.0.22631.4317', '', 4) },
  ];
  const status = (p: string, dn: string, s: string, d: number): StoreObject => ({
    id: `${p}|${dn}`, deviceCompliancePolicyId: p, deviceDisplayName: dn, status: s, lastReportedDateTime: daysAgo(now, d), userPrincipalName: null,
  });
  const deviceCompliancePolicyDeviceStatuses = [
    status('deviceCompliancePolicy-1', 'Sim Managed Device 1', 'compliant', 0),
    status('deviceCompliancePolicy-1', 'Sim Managed Device 2', 'compliant', 1),
    status('deviceCompliancePolicy-1', 'KIOSK-SHOP-01', 'nonCompliant', 12),
    status('deviceCompliancePolicy-2', 'Sim Managed Device 3', 'compliant', 0),
    status('deviceCompliancePolicy-2', 'SIM-LAPTOP-008', 'error', 4),
  ];
  const windowsAutopilotDeploymentProfiles: StoreObject[] = [
    {
      id: 'windowsAutopilotDeploymentProfile-1', '@odata.type': '#microsoft.graph.azureADWindowsAutopilotDeploymentProfile', displayName: 'Sim Standard Autopilot', description: 'Standard user-driven profile', deviceNameTemplate: 'SIM-%SERIAL%', language: 'os-default', createdDateTime: daysAgo(now, 200), lastModifiedDateTime: daysAgo(now, 100),
      outOfBoxExperienceSettings: { hidePrivacySettings: true, hideEULA: true, userType: 'standard', deviceUsageType: 'singleUser', skipKeyboardSelectionPage: true, hideEscapeLink: true },
    },
  ];
  const deviceConfigurationEnrich = {
    'deviceConfiguration-1': { '@odata.type': '#microsoft.graph.windows10EndpointProtectionConfiguration', odataType: '#microsoft.graph.windows10EndpointProtectionConfiguration', lastModifiedDateTime: daysAgo(now, 45), defenderAttackSurfaceReductionExcludedPaths: [] },
    'deviceConfiguration-2': { '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', odataType: '#microsoft.graph.windows10GeneralConfiguration', lastModifiedDateTime: daysAgo(now, 80) },
  };
  // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-vpn-device-configurations): a
  // managed Always-On VPN profile with split tunneling explicitly disabled
  // (SC.L2-3.13.7). Both top-level and AdditionalProperties carry the same
  // fields - Invoke-MgGraphRequest callers (EO's URI-less cmdlet read) see
  // flat Graph JSON; Get-MgDeviceManagementDeviceConfiguration's SDK shape
  // nests type-specific properties under AdditionalProperties (see
  // coverage-evaluators.ts's `prop()`, which checks both).
  const deviceConfigurationsVpn: StoreObject[] = [
    {
      id: 'deviceConfiguration-vpn-1', displayName: 'Sim Always On VPN - Enclave',
      '@odata.type': '#microsoft.graph.windows10VpnConfiguration', enableSplitTunneling: false, connectionName: 'Enclave',
      lastModifiedDateTime: daysAgo(now, 30),
      AdditionalProperties: { '@odata.type': '#microsoft.graph.windows10VpnConfiguration', enableSplitTunneling: false, connectionName: 'Enclave' },
    },
  ];
  const androidManagedAppProtections: StoreObject[] = [
    // Deliberate gap: backups of org data not blocked.
    { id: G5_IDS.androidAppProtectionPolicyId, displayName: 'Sim Android CUI Protection', isAssigned: true, appGroupType: 'selectedPublicApps', dataBackupBlocked: false, deviceComplianceRequired: true, allowedDataStorageLocations: ['oneDriveForBusiness', 'sharePoint'], saveAsBlocked: false, createdDateTime: daysAgo(now, 150) },
  ];
  const iosManagedAppProtections: StoreObject[] = [
    // Deliberate gap: exists but not assigned to anyone, weak data controls.
    { id: G5_IDS.iosAppProtectionPolicyId, displayName: 'Sim iOS Baseline', isAssigned: false, appGroupType: 'allCoreMicrosoftApps', dataBackupBlocked: false, deviceComplianceRequired: false, saveAsBlocked: false, createdDateTime: daysAgo(now, 150) },
  ];

  // -------------------------------------------------- Exchange / Purview
  const mailboxes: StoreObject[] = [
    ...['sim.user1', 'sim.user2', 'sim.user3', 'sim.user4', 'sim.user5', 'sim.contractor1', 'sim.inactive1', 'sim.bcp1'].map((l, i) => ({
      id: `mailbox-${i + 1}`, Identity: upn(l), Name: l, UserPrincipalName: upn(l), PrimarySmtpAddress: upn(l), RecipientTypeDetails: 'UserMailbox', LitigationHoldEnabled: false,
    })),
  ];
  const exoDefault = (id: string, fields: Record<string, unknown>): StoreObject => ({ id, Identity: id, Name: id, IsDefault: true, ...fields });
  const adminAuditLogConfig: StoreObject[] = [
    { id: 'adminAuditLogConfig', Identity: 'Admin Audit Log Settings', UnifiedAuditLogIngestionEnabled: true, AdminAuditLogEnabled: true, AdminAuditLogAgeLimit: '90.00:00:00' },
  ];
  const label: StoreObject[] = [
    { id: 'label-cui', Name: 'CUI', DisplayName: 'CUI//SP-CTI', Guid: '5f6c2b1e-0000-4000-8000-00000000c011', Priority: 1, ContentType: 'File, Email', EncryptionEnabled: false, ApplyContentMarkingHeaderEnabled: false, ApplyContentMarkingFooterEnabled: false, ApplyWaterMarkingEnabled: false },
    // Coverage-harness label (moved here from CoverageRunner.ts).
    { id: 'label-1', Name: 'Sim CUI Label', DisplayName: 'Sim CUI Label', Guid: '11111111-1111-1111-1111-111111111111', Priority: 0, ContentType: 'File, Email', EncryptionEnabled: false },
  ];
  const retentionCompliancePolicy: StoreObject[] = [
    { id: 'Sim CUI Retention 7y', Name: 'Sim CUI Retention 7y', Mode: 'Enforce', Enabled: true, Workload: 'Exchange, SharePoint, OneDriveForBusiness', WorkloadFormat: 'Exchange, SharePoint', RetentionDuration: 2555, DistributionStatus: 'Success' },
  ];
  const holdCompliancePolicy: StoreObject[] = [
    { id: 'Sim Litigation Hold 2025-01', Name: 'Sim Litigation Hold 2025-01', Mode: 'Enforce', Enabled: true, Workload: 'Exchange', DistributionStatus: 'Success' },
  ];

  // ------------------------------------------------ SharePoint / PnP
  const spoTenant: StoreObject[] = [
    // Deliberate gap: guest + external sharing enabled tenant-wide.
    { id: 'spoTenant', SharingCapability: 'ExternalUserAndGuestSharing', DefaultSharingLinkType: 'AnonymousAccess', ExternalServicesEnabled: true, ConditionalAccessPolicy: 'AllowFullAccess' },
  ];
  const spoSites: StoreObject[] = [
    { id: 'spoSite-1', Url: G5_IDS.cuiSiteUrl, Title: 'CUI Repository', SharingCapability: 'ExternalUserSharingOnly', LockState: 'Unlock', ConditionalAccessPolicy: 'AllowFullAccess', DenyAddAndCustomizePages: 'Disabled', DefaultLinkPermission: 'Edit', Owner: upn('sim.user1') },
    { id: 'spoSite-2', Url: 'https://simtenant.sharepoint.us/sites/intranet', Title: 'Intranet', SharingCapability: 'ExistingExternalUserSharingOnly', LockState: 'Unlock', ConditionalAccessPolicy: 'AllowFullAccess', Owner: upn('sim.user1') },
  ];
  const spoUser = (site: string, l: string, name: string, grp: string): StoreObject => ({
    id: `${site}|${l}`, site, LoginName: `i:0#.f|membership|${l}`, DisplayName: name, Groups: [grp], IsHiddenInUI: false,
  });
  const spoUsers = [
    spoUser('spoSite-1', upn('sim.user1'), 'Sim User 1', 'CUI Repository Owners'),
    spoUser('spoSite-1', upn('sim.user3'), 'Sim User 3', 'CUI Repository Members'),
    // Deliberate gap: a stale member (inactive 150 days) still on the CUI site.
    spoUser('spoSite-1', upn('sim.inactive1'), 'Sim Inactive User', 'CUI Repository Members'),
    spoUser('spoSite-2', upn('sim.user4'), 'Sim User 4', 'Intranet Members'),
  ];
  const pnpLists: StoreObject[] = [{ id: 'pnpList-1', title: 'NDA_AUP_Acknowledgments' }];
  const ack = (n: number, who: string, signed: number, expires: number): StoreObject => ({
    id: `pnpListItem-${n}`, list: 'NDA_AUP_Acknowledgments',
    fieldValues: { Title: `NDA/AUP ${who}`, AcknowledgedBy: upn(who), AcknowledgedDate: daysAgo(now, signed), ExpiryDate: expires >= 0 ? daysAhead(now, expires) : daysAgo(now, -expires) },
  });
  // Deliberate gaps: one acknowledgement expired, and sim.contractor1 never acknowledged.
  const pnpListItems = [
    ack(1, 'sim.user1', 100, 265), ack(2, 'sim.user2', 100, 265), ack(3, 'sim.user3', 380, -15),
    ack(4, 'sim.user4', 50, 315), ack(5, 'sim.user5', 200, 165), ack(6, 'sim.inactive1', 300, 65),
  ];

  // ------------------------------------------------ unified audit log
  let ual = 0;
  const rec = (RecordType: string, Operations: string, UserIds: string, ageMinutes: number, data: Record<string, unknown> = {}): StoreObject => {
    ual += 1;
    return {
      id: `ual-${ual}`, RecordType, Operations, UserIds, ageMinutes,
      AuditData: JSON.stringify({ Operation: Operations, UserId: UserIds, RecordType, Workload: data.Workload ?? RecordType, ...data }),
    };
  };
  const H = 60;
  const D = 1440;
  const unifiedAuditLog: StoreObject[] = [
    // D-01 sensitivity-label activity (+ an unlabeled CUI download gap for D-10/G-07 context)
    rec('SharePointFileOperation', 'FileSensitivityLabelApplied', upn('sim.user3'), 2 * D, { ObjectId: `${G5_IDS.cuiSiteUrl}/Shared Documents/traveler-ops.docx`, SensitivityLabelId: 'label-cui' }),
    rec('SharePointFileOperation', 'FileSensitivityLabelChanged', upn('sim.user1'), 5 * D, { ObjectId: `${G5_IDS.cuiSiteUrl}/Shared Documents/drawing-1042.pdf` }),
    rec('SharePointFileOperation', 'FileSensitivityLabelRemoved', upn('sim.contractor1'), 3 * D, { ObjectId: `${G5_IDS.cuiSiteUrl}/Shared Documents/bom-2231.xlsx` }),
    rec('SharePointFileOperation', 'FileDownloaded', upn('sim.contractor1'), 1 * D, { ObjectId: `${G5_IDS.cuiSiteUrl}/Shared Documents/bom-2231.xlsx`, SensitivityLabelId: null }),
    // D-04/D-10 sharing (external + an anonymous link gap)
    rec('SharePointSharingOperation', 'SharingInvitationCreated', upn('sim.user3'), 4 * D, { TargetUserOrGroupName: 'partner.one@example.test' }),
    rec('SharePointSharingOperation', 'AnonymousLinkCreated', upn('sim.contractor1'), 2 * D, { ObjectId: `${G5_IDS.cuiSiteUrl}/Shared Documents/bom-2231.xlsx` }),
    rec('SharePointSharingOperation', 'AddedToSecureLink', upn('sim.user1'), 6 * D, {}),
    // D-02/D-03/G-07 DLP matches (one names sim.user3 within the last day; one insider-risk indicator)
    rec('ComplianceDLPExchange', 'DlpRuleMatch', upn('sim.user3'), 3 * H, { Workload: 'Exchange', PolicyDetails: [{ PolicyName: 'CMMC-CUI-Block' }], Recipient: 'partner.one@example.test' }),
    rec('ComplianceDLPSharePoint', 'DlpRuleMatch', upn('sim.contractor1'), 10 * H, { Workload: 'SharePoint', PolicyDetails: [{ PolicyName: 'CUI-SharePoint-Protection' }], insiderRiskIndicator: 'cuiDownloadedToRemovableMedia' }),
    rec('ComplianceDLPSharePoint', 'DataExfiltrationRuleMatch', upn('sim.contractor1'), 2 * D, { Workload: 'SharePoint' }),
    // E-03/E-06/E-09 directory activity; E-07 role change; F-08 drift event on caPolicy-1
    rec('AzureActiveDirectory', 'Update user.', upn('sim.user1'), 6 * H, { ObjectId: upn('sim.user4') }),
    rec('AzureActiveDirectory', 'Add member to role.', upn('sim.user1'), 3 * D, { ObjectId: upn('sim.user4'), Role: 'Security Administrator' }),
    rec('AzureActiveDirectory', 'Update conditional access policy.', upn('sim.user1'), 2 * H, { ObjectId: 'caPolicy-1' }),
    rec('AzureActiveDirectory', 'Add user.', upn('sim.user1'), 20 * D, { ObjectId: upn('sim.contractor1') }),
    // E-08 risky logon; F-04 legacy-auth logon
    rec('AzureActiveDirectoryAccountLogon', 'UserLoggedIn', upn('sim.user3'), 1 * D, { riskEventTypes: ['unfamiliarFeatures'], ClientIP: '203.0.113.50' }),
    rec('AzureActiveDirectoryAccountLogon', 'UserLoggedIn', upn('sim.user5'), 3 * D, { legacyAuth: true, ClientAppUsed: 'IMAP4', ClientIP: '198.51.100.77' }),
    // E-04/E-05 a noisy alert series (same rule firing daily)
    ...Array.from({ length: 12 }, (_, i) => rec('SecurityComplianceAlerts', 'AlertTriggered', 'SecurityComplianceAlerts', (i * 2 + 1) * D, { Name: 'Sim noisy rule: mass download', Severity: 'Low' })),
    rec('SecurityComplianceAlerts', 'AlertEntityGenerated', 'SecurityComplianceAlerts', 4 * D, { Name: 'Sim phishing reported', Severity: 'Medium' }),
    // E-09 SharePoint/Exchange workload activity
    rec('SharePoint', 'FileAccessed', upn('sim.user4'), 10 * D, {}),
    rec('Exchange', 'MailItemsAccessed', upn('sim.user2'), 12 * D, {}),
    rec('ExchangeAdmin', 'Set-TransportConfig', upn('sim.user1'), 3 * H, { ObjectId: 'caPolicy-1' }),
    // E-10/H-05 eDiscovery case lifecycle
    rec('SecurityComplianceCenterEOPCmdlet', 'New-ComplianceCase', upn('sim.user1'), 40 * D, { ObjectId: 'Sim-Case-2026-001' }),
    rec('SecurityComplianceCenterEOPCmdlet', 'Set-ComplianceCase', upn('sim.user1'), 35 * D, { ObjectId: 'Sim-Case-2026-001' }),
    rec('SecurityComplianceCenterEOPCmdlet', 'Close-ComplianceCase', upn('sim.user1'), 20 * D, { ObjectId: 'Sim-Case-2026-001' }),
    // G-04 phishing-simulation clicks
    rec('AttackSim', 'AttackSimAPI.LinkClicked', upn('sim.user4'), 20 * D, { SimulationName: 'Sim Q3 credential-harvest drill' }),
    rec('AttackSim', 'AttackSimAPI.CredentialSubmitted', upn('sim.user4'), 20 * D, { SimulationName: 'Sim Q3 credential-harvest drill' }),
    rec('AttackSim', 'AttackSimAPI.LinkClicked', upn('sim.contractor1'), 19 * D, { SimulationName: 'Sim Q3 credential-harvest drill' }),
  ];

  // -------------------------------------------------------------- Azure
  const armId = (type: string, name: string) => `/subscriptions/sim-sub/resourceGroups/sim-rg/providers/${type}/${name}`;
  const vnetEnrich = {
    'vnet-1': { Id: armId('Microsoft.Network/virtualNetworks', 'sim-vnet-1'), Location: 'usgovvirginia' },
    'vnet-2': { Id: armId('Microsoft.Network/virtualNetworks', 'sim-vnet-2'), Location: 'usgovvirginia' },
  };
  const storageEnrich = {
    'storageAccount-1': { Id: armId('Microsoft.Storage/storageAccounts', 'simstorage1') },
    'storageAccount-2': { Id: armId('Microsoft.Storage/storageAccounts', 'simstorage2') },
  };
  const lawEnrich = {
    'logAnalyticsWorkspace-1': { ResourceId: armId('Microsoft.OperationalInsights/workspaces', 'sim-law-1'), retentionInDays: 90 },
  };
  const keyVaultKeyEnrich = { 'keyVaultKey-1': { name: 'sim-storage-key-1' } };
  const publicIpAddresses: StoreObject[] = [
    { id: 'publicIpAddress-1', Name: G5_IDS.publicIpName, name: G5_IDS.publicIpName, IpAddress: '203.0.113.10', PublicIpAllocationMethod: 'Static', Id: armId('Microsoft.Network/publicIPAddresses', G5_IDS.publicIpName) },
  ];
  const networkWatchers: StoreObject[] = [
    { id: 'networkWatcher-1', Name: 'NetworkWatcher_usgovvirginia', Location: 'usgovvirginia', Id: armId('Microsoft.Network/networkWatchers', 'NetworkWatcher_usgovvirginia') },
  ];
  const sentinelAlertRules: StoreObject[] = [
    { id: 'sentinelAlertRule-1', DisplayName: 'Sim - Multiple failed sign-ins', Kind: 'Scheduled', Enabled: true, Severity: 'Medium', Query: 'SigninLogs | where ResultType != 0 | summarize count() by UserPrincipalName' },
    // Deliberate gap: a disabled rule.
    { id: 'sentinelAlertRule-2', DisplayName: 'Sim - Mass file download', Kind: 'Scheduled', Enabled: false, Severity: 'High', Query: 'OfficeActivity | where Operation == "FileDownloaded" | summarize count() by UserId' },
  ];
  const backupJobs: StoreObject[] = [
    { id: 'backupJob-1', name: 'sim-job-0001', properties: { operation: 'Backup', status: 'Completed', entityFriendlyName: 'sim-vm-1', backupManagementType: 'AzureIaasVM', startTime: daysAgo(now, 1) } },
    // Deliberate gap: a failed backup.
    { id: 'backupJob-2', name: 'sim-job-0002', properties: { operation: 'Backup', status: 'Failed', entityFriendlyName: 'sim-sql-1', backupManagementType: 'AzureWorkload', startTime: daysAgo(now, 0.5), errorDetails: [{ errorString: 'Sim: backup extension timed out' }] } },
    { id: 'backupJob-3', name: 'sim-job-0003', properties: { operation: 'Restore', status: 'Completed', entityFriendlyName: 'sim-vm-1', backupManagementType: 'AzureIaasVM', startTime: daysAgo(now, 30) } },
  ];
  const diagnosticSettings: StoreObject[] = [
    { id: 'diagnosticSetting-1', name: 'send-to-sim-law-1', resourceId: armId('Microsoft.KeyVault/vaults', 'sim-kv-1'), workspaceId: armId('Microsoft.OperationalInsights/workspaces', 'sim-law-1'), logs: [{ category: 'AuditEvent', enabled: true }] },
    // (deliberate gap: the storage accounts carry no diagnostic setting)
  ];

  const nsgEnrich = {
    'nsg-1': { Id: armId('Microsoft.Network/networkSecurityGroups', 'sim-nsg-1'), Location: 'usgovvirginia' },
    'nsg-2': { Id: armId('Microsoft.Network/networkSecurityGroups', 'sim-nsg-2'), Location: 'usgovvirginia' },
  };
  return {
    // A workload subnet on sim-vnet-1 with no NSG and no route table (the
    // deny-by-default gap AO F-13 closes). Named so it collides with none of
    // the subnets Stamper's AZ-NET-002..005 create idempotently.
    append: {
      vnets: {
        'vnet-1': {
          Subnets: [{ Name: 'snet-cui-apps', AddressPrefix: '10.0.4.0/24', NetworkSecurityGroup: null, RouteTable: null, PrivateEndpointNetworkPolicies: 'Disabled', PrivateEndpoints: [] }],
        },
      },
    },
    enrich: {
      nsgs: nsgEnrich,
      users: userEnrich,
      groups: groupEnrich,
      servicePrincipals: spEnrich,
      authMethods: authMethodEnrich,
      alerts: alertEnrich,
      namedLocations: namedLocationEnrich,
      managedDevices: managedDeviceEnrich,
      deviceConfigurations: deviceConfigurationEnrich,
      vnets: vnetEnrich,
      storageAccounts: storageEnrich,
      logAnalyticsWorkspaces: lawEnrich,
      keyVaultKeys: keyVaultKeyEnrich,
    },
    add: {
      users,
      groups,
      groupMember,
      subscribedSkus,
      roleAssignments,
      roleEligibilitySchedules,
      applications,
      applicationOwners,
      servicePrincipals,
      servicePrincipalAppRoleAssignments,
      riskyUsers,
      signInLogs,
      authMethods,
      directorySettings,
      secureScoreControlProfiles,
      securityIncidents,
      alerts,
      caPolicies,
      managedDevices,
      deviceCompliancePolicyDeviceStatuses,
      windowsAutopilotDeploymentProfiles,
      androidManagedAppProtections,
      iosManagedAppProtections,
      trainingUserCoverage,
      lifecycleWorkflows,
      deviceConfigurations: deviceConfigurationsVpn,
      mailboxes,
      malwareFilterPolicy: [exoDefault('Default', { EnableFileFilter: false, FileTypeAction: 'Reject' })],
      hostedContentFilterPolicy: [exoDefault('Default', { HighConfidenceSpamAction: 'MoveToJmf', SpamAction: 'MoveToJmf', BulkThreshold: 7 })],
      hostedOutboundSpamFilterPolicy: [exoDefault('Default', { RecipientLimitExternalPerHour: 0, ActionWhenThresholdReached: 'BlockUserForToday', AutoForwardingMode: 'Automatic' })],
      antiPhishPolicy: [exoDefault('Office365 AntiPhish Default', { Enabled: true, EnableMailboxIntelligence: true })],
      csExternalAccessPolicy: [exoDefault('Global', { EnableFederationAccess: true, EnableTeamsConsumerAccess: true, EnableTeamsConsumerInbound: true })],
      adminAuditLogConfig,
      oMEConfiguration: [{ id: 'OME Configuration', Identity: 'OME Configuration', OTPEnabled: true, SocialIdSignIn: true }],
      label,
      retentionCompliancePolicy,
      holdCompliancePolicy,
      spoTenant,
      spoSites,
      spoUsers,
      pnpLists,
      pnpListItems,
      unifiedAuditLog,
      publicIpAddresses,
      networkWatchers,
      sentinelAlertRules,
      backupJobs,
      diagnosticSettings,
      // Generic ARM resources for drift response (`az resource update --ids <arm id>`).
      armResources: [
        // Deliberate gap: the storage account allows plain-HTTP transfer and TLS 1.0.
        { id: armId('Microsoft.Storage/storageAccounts', 'simstorage1'), name: 'simstorage1', type: 'Microsoft.Storage/storageAccounts', supportsHttpsTrafficOnly: false, minimumTlsVersion: 'TLS1_0' },
        { id: armId('Microsoft.KeyVault/vaults', 'sim-kv-1'), name: 'sim-kv-1', type: 'Microsoft.KeyVault/vaults', enablePurgeProtection: true, publicNetworkAccess: 'Disabled' },
      ],
    },
  };
}
