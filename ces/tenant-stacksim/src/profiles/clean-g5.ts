// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../store/StoreTypes.js';
import type { SeedSet } from '../seed/sets/gccHighG5.js';
// Only used inside functions: gccHighG5.ts imports this module (seed-set dispatch), so a top-level
// use of its exports would hit the import cycle before they are initialized.
import { G5_LICENSING } from '../seed/sets/gccHighG5.js';
import { SIM_BASE_DOMAIN, simVerifiedDomains } from '../seed/sets/base.js';
import { registerObjectType } from '../store/schemas.js';

// The Security Defaults singleton is a collection no other seed or resolver declares.
registerObjectType('identitySecurityDefaultsEnforcementPolicy');

/**
 * FIN-21 (2026-10-31): the CLEAN G5 tenant - a Microsoft 365 G5 (GCC High)
 * tenant as the customer hands it over, BEFORE any CES tenant
 * initialization. Stamper's bootstrap (New-TenantBootstrap.ps1), preflight
 * (GET /api/preflight) and baseline (GET /api/baseline) run against it on
 * the simulator (finishing-plan step E0, check V117).
 *
 * What it carries:
 *  - NO CES app: no application, no CES service principal, no app-role or
 *    directory-role grants, no Azure subscription role.
 *  - Security Defaults ON (the identitySecurityDefaultsEnforcementPolicy
 *    singleton, isEnabled true).
 *  - Two customer-created break-glass accounts (cloud-only, enabled, Global
 *    Administrator), per QUESTIONS D-8: CES only verifies them.
 *  - Seeded licences: the G5 SKU (25 seats, only the admin and the two
 *    break-glass accounts consume one), so the bootstrap licence check and
 *    licence assignment (audit steps 1 and 18) have something to find.
 *  - The Microsoft first-party service principals a real tenant always has
 *    (Microsoft Graph, Office 365 Exchange Online, Office 365 SharePoint
 *    Online) with the app roles CES grants, and the built-in directory role
 *    definitions preflight assigns.
 *  - An Azure Government subscription with NO resource groups or resources
 *    (baseline builds them), and an un-hydrated Exchange organization
 *    (base seed organizationConfig IsDehydrated true).
 *
 * Built with `stacksim scenario clean-g5` (scenarios/clean-g5.json:
 * stance m365_azure, CLEAN_G5_COUNT_OVERRIDES, seedSets ['clean-g5']).
 * Every name, domain, id and SKU here is fictional; the only platform
 * constants are the well-known first-party app ids and built-in role
 * template ids, identical in every tenant.
 */

export const CLEAN_G5_SLUG = 'clean-g5';
/** The tenant id SimTenantConfig/base seed use for a scenario tenant: sim-tenant-<slug>. */
export const CLEAN_G5_TENANT_ID = `sim-tenant-${CLEAN_G5_SLUG}`;
export const CLEAN_G5_DOMAIN = `${CLEAN_G5_SLUG}.${SIM_BASE_DOMAIN}`;
export const CLEAN_G5_ORG_NAME = 'Clean G5 Sim Tenant';
/** Fictional Azure Government subscription (no resources in it). */
export const CLEAN_G5_SUBSCRIPTION_ID = '5c1ea000-0000-4000-8000-00000000c1e5';

const upn = (local: string) => `${local}@${CLEAN_G5_DOMAIN}`;

/** The two customer-created break-glass accounts (QUESTIONS D-8: the customer creates them, CES verifies). */
export const CLEAN_G5_BREAK_GLASS_UPNS = [upn('bg-emergency1'), upn('bg-emergency2')] as const;
/** The customer's own admin (signs in to bootstrap) and the CES operator (unlicensed until bootstrap step 18). */
export const CLEAN_G5_ADMIN_UPN = upn('it.admin');
export const CLEAN_G5_OPERATOR_UPN = upn('ces.operator');

/** Well-known first-party application ids (platform constants). */
export const FIRST_PARTY_APP_IDS = {
  microsoftGraph: '00000003-0000-0000-c000-000000000000',
  exchangeOnline: '00000002-0000-0ff1-ce00-000000000000',
  sharePointOnline: '00000003-0000-0ff1-ce00-000000000000',
} as const;

/**
 * The Graph application permissions CES needs (New-TenantBootstrap.ps1
 * $requiredPermissions = preflight REQUIRED_GRAPH_PERMISSIONS), plus two the
 * tenant offers that CES does not ask for, so "present but not requested"
 * stays distinguishable.
 */
export const CLEAN_G5_GRAPH_APP_ROLES = [
  'Policy.ReadWrite.ConditionalAccess',
  'Directory.ReadWrite.All',
  'DeviceManagementConfiguration.ReadWrite.All',
  'DeviceManagementManagedDevices.ReadWrite.All',
  'DeviceManagementServiceConfig.ReadWrite.All',
  'User.ReadWrite.All',
  'Group.ReadWrite.All',
  'RoleManagement.ReadWrite.Directory',
  'Organization.ReadWrite.All',
  'Policy.ReadWrite.Authorization',
  'AuditLog.Read.All',
  'SecurityEvents.ReadWrite.All',
  'ThreatIndicators.ReadWrite.OwnedBy',
  'IdentityRiskyUser.ReadWrite.All',
  'IdentityRiskEvent.ReadWrite.All',
  'InformationProtectionPolicy.Read.All',
  'AppRoleAssignment.ReadWrite.All',
  'DeviceManagementApps.ReadWrite.All',
  'SecurityAlert.Read.All',
  'SecurityAlert.ReadWrite.All',
  'SecurityIncident.Read.All',
  'SecurityIncident.ReadWrite.All',
  'BitLockerKey.ReadBasic.All',
  'Mail.Read',
  'Sites.Read.All',
] as const;

/** Built-in directory role definitions preflight assigns (template ids are fictional sim GUIDs except Global Administrator). */
/** Global Administrator's built-in role template id (platform constant; same value as gccHighG5 BUILTIN_ROLES). */
const GLOBAL_ADMINISTRATOR_TEMPLATE_ID = '62e90394-69f5-4237-9190-012177145e10';

export const CLEAN_G5_ROLE_DEFINITIONS = [
  { id: GLOBAL_ADMINISTRATOR_TEMPLATE_ID, displayName: 'Global Administrator' },
  { id: 'c1e50000-0000-4000-8000-000000000e01', displayName: 'Exchange Administrator' },
  { id: 'c1e50000-0000-4000-8000-000000000e02', displayName: 'SharePoint Administrator' },
  { id: 'c1e50000-0000-4000-8000-000000000e03', displayName: 'Compliance Administrator' },
  { id: 'c1e50000-0000-4000-8000-000000000e04', displayName: 'Teams Administrator' },
] as const;

/**
 * The m365_azure profile's count-based generators, all OFF: a clean tenant
 * has none of the generated users, devices, policies or Azure resources.
 * Singletons every tenant carries (authorization policy, authentication
 * methods policy and its method configurations, cross-tenant access policy,
 * role management policy) stay at their profile counts.
 */
export const CLEAN_G5_COUNT_OVERRIDES: Record<string, number> = {
  users: 0,
  servicePrincipals: 0,
  groups: 0,
  roleAssignments: 0,
  pimSchedules: 0,
  authMethods: 0,
  devices: 0,
  deviceCompliancePolicies: 0,
  managedDevices: 0,
  deviceConfigurations: 0,
  detectedApps: 0,
  caPolicies: 0,
  namedLocations: 0,
  logAnalyticsWorkspaces: 0,
  storageAccounts: 0,
  keyVaults: 0,
  automationAccounts: 0,
  vnets: 0,
  nsgs: 0,
  managedIdentities: 0,
  firewalls: 0,
  keyVaultKeys: 0,
  keyVaultCertificates: 0,
  secureScores: 0,
  alerts: 0,
  policyLabels: 0,
  authenticationStrengthPolicies: 0,
  touAgreements: 0,
  vulnerabilities: 0,
  authenticationMethodUserRegistrationDetails: 0,
  signInLogs: 0,
  deviceManagementConfigurationPolicies: 0,
  deviceManagementIntents: 0,
  sensitivityLabels: 0,
  dlpPolicies: 0,
  dlpCompliancePolicy: 0,
  attackSimulations: 0,
  riskDetections: 0,
};

/** Deterministic sim app-role id for a permission value (not a Microsoft GUID). */
export function cleanG5AppRoleId(resource: 'graph' | 'exo' | 'spo', value: string): string {
  let h = 0;
  for (const ch of `${resource}:${value}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  const tag = resource === 'graph' ? '0001' : resource === 'exo' ? '0002' : '0003';
  return `${hex}-c1e5-4000-8000-${tag}00000000`;
}

const appRole = (resource: 'graph' | 'exo' | 'spo', value: string) => ({
  id: cleanG5AppRoleId(resource, value),
  value,
  displayName: value,
  allowedMemberTypes: ['Application'],
  isEnabled: true,
});

function daysAgo(now: number, d: number): string {
  return new Date(now - d * 86400000).toISOString();
}

export function buildCleanG5Seed(nowMs: number = Date.now()): SeedSet {
  const lic = [{ skuId: G5_LICENSING.skuId, disabledPlans: [] as string[] }];
  const user = (id: string, upnValue: string, displayName: string, jobTitle: string, licensed: boolean): StoreObject => ({
    id,
    displayName,
    userPrincipalName: upnValue,
    mail: upnValue,
    accountEnabled: true,
    userType: 'Member',
    jobTitle,
    department: 'IT',
    onPremisesSyncEnabled: null,
    createdDateTime: daysAgo(nowMs, 30),
    signInActivity: { lastSignInDateTime: daysAgo(nowMs, 1), lastNonInteractiveSignInDateTime: daysAgo(nowMs, 1) },
    assignedLicenses: licensed ? lic : [],
  });
  const users: StoreObject[] = [
    user('user-1', CLEAN_G5_ADMIN_UPN, 'IT Admin', 'IT Administrator', true),
    user('user-2', CLEAN_G5_BREAK_GLASS_UPNS[0], 'Emergency Access 1', 'Emergency Access (Break Glass)', true),
    user('user-3', CLEAN_G5_BREAK_GLASS_UPNS[1], 'Emergency Access 2', 'Emergency Access (Break Glass)', true),
    user('user-4', CLEAN_G5_OPERATOR_UPN, 'CES Operator', 'Compliance Operator', false),
  ];
  const consumed = users.filter((u) => (u.assignedLicenses as unknown[]).length > 0).length;

  const servicePrincipals: StoreObject[] = [
    {
      id: 'sp-msgraph',
      appId: FIRST_PARTY_APP_IDS.microsoftGraph,
      displayName: 'Microsoft Graph',
      servicePrincipalType: 'Application',
      appRoles: CLEAN_G5_GRAPH_APP_ROLES.map((v) => appRole('graph', v)),
    },
    {
      id: 'sp-exo',
      appId: FIRST_PARTY_APP_IDS.exchangeOnline,
      displayName: 'Office 365 Exchange Online',
      servicePrincipalType: 'Application',
      appRoles: ['Exchange.ManageAsApp', 'full_access_as_app'].map((v) => appRole('exo', v)),
    },
    {
      id: 'sp-spo',
      appId: FIRST_PARTY_APP_IDS.sharePointOnline,
      displayName: 'Office 365 SharePoint Online',
      servicePrincipalType: 'Application',
      appRoles: ['Sites.FullControl.All', 'Sites.Read.All'].map((v) => appRole('spo', v)),
    },
  ];

  const roleDefinitions: StoreObject[] = CLEAN_G5_ROLE_DEFINITIONS.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    templateId: r.id,
    isBuiltIn: true,
    isEnabled: true,
  }));

  // The customer's admin and both break-glass accounts hold Global Administrator (permanent, tenant-wide).
  const roleAssignments: StoreObject[] = ['user-1', 'user-2', 'user-3'].map((principalId, i) => ({
    id: `roleAssignment-${i + 1}`,
    principalId,
    roleDefinitionId: GLOBAL_ADMINISTRATOR_TEMPLATE_ID,
    directoryScopeId: '/',
  }));

  return {
    enrich: {},
    add: {
      users,
      servicePrincipals,
      roleManagementDirectoryRoleDefinition: roleDefinitions,
      roleAssignments,
      organization: [
        {
          id: CLEAN_G5_TENANT_ID,
          displayName: CLEAN_G5_ORG_NAME,
          tenantType: 'AAD',
          countryLetterCode: 'US',
          verifiedDomains: simVerifiedDomains(CLEAN_G5_SLUG),
        },
      ],
      subscribedSkus: [
        {
          id: G5_LICENSING.skuId,
          skuId: G5_LICENSING.skuId,
          skuPartNumber: G5_LICENSING.skuPartNumber,
          displayName: G5_LICENSING.primarySku,
          appliesTo: 'User',
          capabilityStatus: 'Enabled',
          prepaidUnits: { enabled: G5_LICENSING.licenseCount, suspended: 0, warning: 0 },
          consumedUnits: consumed,
        },
      ],
      identitySecurityDefaultsEnforcementPolicy: [
        {
          id: '00000000-0000-0000-0000-000000000005',
          displayName: 'Security Defaults',
          description: 'Security defaults is a set of basic identity security mechanisms recommended by Microsoft.',
          isEnabled: true,
        },
      ],
      armResources: [
        {
          id: `/subscriptions/${CLEAN_G5_SUBSCRIPTION_ID}`,
          name: 'Clean G5 Azure Government',
          type: 'Microsoft.Resources/subscriptions',
          subscriptionId: CLEAN_G5_SUBSCRIPTION_ID,
          tenantId: CLEAN_G5_TENANT_ID,
          state: 'Enabled',
          cloud: 'AzureUSGovernment',
        },
      ],
    },
  };
}
