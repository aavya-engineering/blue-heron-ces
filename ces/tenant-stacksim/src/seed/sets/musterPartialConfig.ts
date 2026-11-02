// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../../store/StoreTypes.js';
import type { SeedSet } from './gccHighG5.js';
import { simVerifiedDomains } from './base.js';
import { COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID, entraDefaultPimRules } from './pimDefaults.js';

export { COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID };

/**
 * synthetic-customer W5 cycle 2 (2026-10-28): the configuration fields
 * EvidenceOps' rewritten evaluators test, for the `muster-partial` scenario
 * only (`"seedSets": ["eo-collection-b20", "muster-partial-config"]`). Without
 * them muster-partial read not_assessed (no field) or falsely not_met (stale
 * sign-ins from the base seed) on settings a real tenant would show.
 *
 *  - deviceCompliancePolicies (enrich, the 2 generator policies): the Windows
 *    password settings S1 carries (length 14, history 24, lock after 15 min,
 *    no expiry). Generic names kept.
 *  - roleManagementPolicies (enrich, the generator policy): `scopeType:
 *    'DirectoryRole'`, so EO's `scopeId eq '/' and scopeType eq
 *    'DirectoryRole'` read returns it, and Entra's default `rules` in S1's
 *    shape (W5c2 follow-up, coordinator decision): activation needs no
 *    approval (`Approval_EndUser_Assignment` `isApprovalRequired: false`, no
 *    stage), so AC.L2-3.1.4 reads an honest not_met before Stamper acts. The
 *    URI read returns `rules` only on `$expand=rules` (ResolverTable
 *    EXPAND_ONLY).
 *  - roleManagementDirectoryRoleDefinition + policyRoleManagementPolicyAssignment
 *    (add; W5c2 follow-up 2): the built-in Compliance Administrator role
 *    definition and its assignment to that policy (scopeId '/', scopeType
 *    'DirectoryRole'), S1's shapes. They are what Stamper's
 *    AC.L2-3.1.4.pim-approval / pim-policy-get look up (role by displayName,
 *    then the policy assignment by scope and role), so Stamper's approval
 *    write lands on the rules EO reads.
 *  - roleAssignments (add; W5c2 follow-up 9; the scenario zeroes the
 *    profile's 2 generic `role-1` / `role-2` rows): user-1 (the operator,
 *    SimTenantConfig operator_upn) and user-2 (the break-glass account,
 *    breakglass_upn) hold Global Administrator, standing. directoryRole +
 *    directoryRoleMember: the activated roles (Global Administrator with
 *    those 2 members; Compliance Administrator, whose definition and PIM
 *    policy follow-up 2 seeded, with none), the store Get-MgDirectoryRole /
 *    Get-MgDirectoryRoleMember and /directoryRoles read.
 *  - users (enrich, user-1..5): `signInActivity` within the last 30 days for
 *    every (enabled) account - it overrides the base seed's stale user-2 /
 *    user-4 and never-signed-in user-5, because a named set runs before the
 *    base seed and existing fields win - plus `createdDateTime`, `userType`,
 *    `onPremisesSyncEnabled` false, `passwordPolicies` and
 *    `lastPasswordChangeDateTime`. Served on `$select` as every user property.
 *  - domains (add): the two verified domains the base seed's organization
 *    lists, with `passwordValidityPeriodInDays` (never expire, consistent with
 *    the compliance policies' `passwordExpirationDays` null) and
 *    `passwordNotificationWindowInDays`.
 *  - directorySettings (add): "Password Rule Settings" at the Entra defaults
 *    (lockout 10 attempts / 60 s, banned-password check on, no custom list).
 *
 * Deliberately NOT here (CES's job, Stamper; they stay honest gaps): a CUI
 * sensitivity label and a legacy-authentication-blocking CA policy.
 *
 * Dates: the seed engine's build-time `now`, floored to the UTC hour, minus a
 * fixed offset (as the eo-collection-b20 set). Names and domains are Sim data.
 */

export const MUSTER_PARTIAL_CONFIG = 'muster-partial-config';

const SLUG = 'muster-partial';
/** Microsoft's "Password Rule Settings" directory setting template id (platform constant). */
const PASSWORD_RULE_SETTINGS_TEMPLATE_ID = '5cf42378-d67d-4f36-ba46-e8b86229381d';
/** Built-in Global Administrator role template id (platform constant). */
const GLOBAL_ADMINISTRATOR_TEMPLATE_ID = '62e90394-69f5-4237-9190-012177145e10';
const DOMAIN = 'simtenant.onmicrosoft.us';

/** The generator's one PIM policy (compliance.ts generateRoleManagementPolicies). */
const PIM_POLICY_ID = 'roleManagementPolicy-1';

/** Per generated user (1-based): days since last sign-in, account age, days since password change. */
const USER_AGES: Record<number, { signIn: number; created: number; pwd: number }> = {
  1: { signIn: 0, created: 600, pwd: 30 },
  2: { signIn: 3, created: 600, pwd: 75 },
  3: { signIn: 1, created: 450, pwd: 20 },
  4: { signIn: 6, created: 380, pwd: 55 },
  5: { signIn: 12, created: 300, pwd: 110 },
};

export function buildMusterPartialConfigSeed(nowMs: number): SeedSet {
  const anchor = Math.floor(nowMs / 3600000) * 3600000;
  const daysAgo = (d: number) => new Date(anchor - d * 86400000).toISOString();

  const windowsPassword = {
    '@odata.type': '#microsoft.graph.windows10CompliancePolicy',
    passwordRequired: true,
    passwordBlockSimple: true,
    passwordMinimumLength: 14,
    passwordRequiredType: 'alphanumeric',
    passwordMinutesOfInactivityBeforeLock: 15,
    passwordPreviousPasswordBlockCount: 24,
    passwordExpirationDays: null,
  };

  const users: Record<string, Record<string, unknown>> = {};
  for (const [n, a] of Object.entries(USER_AGES)) {
    const signedIn = daysAgo(a.signIn);
    users[`user-${n}`] = {
      signInActivity: { lastSignInDateTime: signedIn, lastNonInteractiveSignInDateTime: signedIn },
      createdDateTime: daysAgo(a.created),
      userType: 'Member',
      onPremisesSyncEnabled: false,
      passwordPolicies: 'None',
      lastPasswordChangeDateTime: daysAgo(a.pwd),
    };
  }

  const domains: StoreObject[] = simVerifiedDomains(SLUG).map((d) => ({
    id: d.name as string,
    authenticationType: 'Managed',
    isAdminManaged: true,
    isDefault: d.isDefault,
    isInitial: d.isInitial,
    isRoot: true,
    isVerified: true,
    passwordValidityPeriodInDays: 2147483647,
    passwordNotificationWindowInDays: 14,
    supportedServices: ['Email', 'OfficeCommunicationsOnline', 'Intune'],
  }));

  const directorySettings: StoreObject[] = [
    {
      id: 'directorySetting-mp-1',
      displayName: 'Password Rule Settings',
      templateId: PASSWORD_RULE_SETTINGS_TEMPLATE_ID,
      values: [
        { name: 'BannedPasswordCheckOnPremisesMode', value: 'Audit' },
        { name: 'EnableBannedPasswordCheckOnPremises', value: 'False' },
        { name: 'EnableBannedPasswordCheck', value: 'True' },
        { name: 'LockoutDurationInSeconds', value: '60' },
        { name: 'LockoutThreshold', value: '10' },
        { name: 'BannedPasswordList', value: '' },
      ],
    },
  ];

  return {
    enrich: {
      deviceCompliancePolicies: {
        'deviceCompliancePolicy-1': { ...windowsPassword },
        'deviceCompliancePolicy-2': { ...windowsPassword },
      },
      roleManagementPolicies: {
        [PIM_POLICY_ID]: { scopeType: 'DirectoryRole', rules: entraDefaultPimRules() },
      },
      users,
    },
    add: {
      domains,
      directorySettings,
      // PH-13 (LOG-PH13-ST.md STOP-4): CES's own app registration, as customerHistory.ts seeds for S1-S3.
      // A CES-managed tenant always holds it; appId = the sim tenant record's auth.app_id.
      applications: [{
        id: 'a9000000-0000-4000-8000-000000000001', appId: 'sim-app-muster-partial', displayName: 'CES Automation (FICTIONAL)',
        signInAudience: 'AzureADMyOrg', createdDateTime: daysAgo(300), passwordCredentials: [], keyCredentials: [],
      }],
      // SIM-BL (2026-10-31): the BitLocker recovery key each of the profile's
      // four managed Windows devices (generic seed, all isEncrypted true)
      // escrowed in Entra ID; deviceId is the profile's Entra device-N.
      // Metadata only: no key material is seeded.
      bitlockerRecoveryKeys: [1, 2, 3, 4].map((n) => ({
        id: `bitlockerRecoveryKey-mp-${n}`,
        createdDateTime: daysAgo(300 - n * 20),
        deviceId: `device-${n}`,
        volumeType: 'operatingSystemVolume',
      })),
      roleManagementDirectoryRoleDefinition: [
        {
          id: COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID,
          templateId: COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID,
          displayName: 'Compliance Administrator',
          description: 'Built-in role: Compliance Administrator',
          isBuiltIn: true,
          isEnabled: true,
          resourceScopes: ['/'],
        },
      ],
      // W5c2 follow-up 9: standing Global Administrator for the operator and
      // the break-glass account (the pre-Stamper posture: no PIM, no CA
      // exclusion), and the activated directory roles with their members.
      roleAssignments: [1, 2].map((n) => ({ id: `roleAssignment-${n}`, principalId: `user-${n}`, roleDefinitionId: GLOBAL_ADMINISTRATOR_TEMPLATE_ID, directoryScopeId: '/' })),
      directoryRole: [
        { id: 'directoryRole-1', displayName: 'Global Administrator', description: 'Can manage all aspects of Microsoft Entra ID and Microsoft services that use Microsoft Entra identities.', roleTemplateId: GLOBAL_ADMINISTRATOR_TEMPLATE_ID },
        { id: 'directoryRole-2', displayName: 'Compliance Administrator', description: 'Can read and manage compliance configuration and reports in Microsoft Entra ID and Microsoft 365.', roleTemplateId: COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID },
      ],
      directoryRoleMember: [1, 2].map((n) => ({
        id: `directoryRole-1|user-${n}`, directoryRoleId: 'directoryRole-1', memberId: `user-${n}`,
        '@odata.type': '#microsoft.graph.user', displayName: `Sim User ${n}`, userPrincipalName: `sim.user${n}@${DOMAIN}`,
      })),
      policyRoleManagementPolicyAssignment: [
        {
          id: `${PIM_POLICY_ID}_${COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID}`,
          policyId: PIM_POLICY_ID,
          scopeId: '/',
          scopeType: 'DirectoryRole',
          roleDefinitionId: COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID,
        },
      ],
    },
  };
}
