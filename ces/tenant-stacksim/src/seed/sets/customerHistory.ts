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
import { buildAzureFacade, type AzureFacadeSpec } from '../generators/azureResources.js';
import { simVerifiedDomains } from './base.js';
import { COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID, entraDefaultPimRules } from './pimDefaults.js';

/**
 * synthetic-customer W0 (2026-10-28): the "customer-history" seed set - the
 * 90-day history of a synthetic customer (PLAN §2.1 / §2.2), in the B20
 * record shapes (src/seed/sets/eoCollectionB20.ts) plus device sync and TVM
 * dates, per-CVE advanced-hunting rows, Secure Score controlScores and
 * control profiles, and alerts whose lifecycle has moved.
 *
 * Input: the scenario's `seedContext['customer-history']` (CustomerHistoryContext),
 * generated from the customer's customer.json by
 * scripts/build-customer-scenario.mjs. The roster's names and UPNs are set on
 * the generated users by the scenario's PATCH steps (the real resolver path);
 * this set only ENRICHES those objects (existing fields win) and ADDS records.
 *
 * Clock: every date is `anchor` minus a fixed offset (SeedEngine passes the
 * day-floored build time, or STACKSIM_FIXED_NOW). Ids are fixed literals, so
 * two builds with the same anchor produce identical records.
 *
 * Everything here is fictional; the only real identifiers are the built-in
 * Entra role template ids (platform constants) carried in the context.
 */

export const CUSTOMER_HISTORY = 'customer-history';

export interface HistoryAccount {
  seedId: string;
  upn: string;
  displayName: string;
  kind: 'staff' | 'admin' | 'break_glass' | 'service';
  department: string;
  jobTitle: string;
  lifecycle?: { event: 'joiner' | 'leaver'; days_before_anchor: number; account_enabled: boolean };
  /** W5c1-b: the security roles the person holds (customer.json `roles`, e.g. 'issm'). */
  roles?: string[];
  /** W5c1-b: for an admin account, its owner's primary account (customer.json `owner_person_id`). */
  ownerSeedId?: string;
}

export interface HistoryDevice {
  seedId: string;
  entraId: string;
  deviceName: string;
  os: 'Windows' | 'iOS';
  osVersion: string;
  kind: 'staff' | 'kiosk' | 'programming' | 'ios';
  upn: string | null;
  compliant: boolean;
  encrypted: boolean;
}

export interface CustomerHistoryContext {
  slug: string;
  domain: string;
  accounts: HistoryAccount[];
  groups: Array<{ seedId: string; name: string; memberSeedIds: string[] }>;
  devices: HistoryDevice[];
  pim: {
    eligible: Array<{ principalSeedId: string; role: string; roleTemplateId: string }>;
    breakGlassSeedIds: string[];
    globalAdministratorTemplateId: string;
  };
  dlpPolicies: string[];
  sensitivityLabel: { name: string; description: string };
  licensing: { skuId: string; skuPartNumber: string; displayName: string; prepaidUnits: number };
  azure: AzureFacadeSpec;
  /** synthetic-customer W1: the operator /me returns (the administrator's admin account). */
  operatorSeedId: string;
  /** synthetic-customer W1: Graph /organization fields (customer.json organization). */
  organization: { displayName: string };
  /** W5c2 follow-up 6 (SIM-A2): the CA named locations (build-customer-scenario.mjs S1_NAMED_LOCATIONS). */
  namedLocations?: Array<{ seedId: string; name: string; kind: 'ip' | 'country'; cidrs?: string[]; countries?: string[] }>;
}

const MIN = 60000;
const DAY = 1440 * MIN;
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');
/** Deterministic GUID-shaped sim id (the customer.json family, 5151 = "S1 sim"; not a real id). */
const simGuid = (kind: number, n: number) => `51510000-${hex(kind, 4)}-4000-8000-${hex(n, 12)}`;

/**
 * W5c2 follow-up 7: an Intune policy's group assignment, in Graph's shape
 * (`{ id: '<policyId>_<groupId>', target: groupAssignmentTarget }`; the
 * `/assign` action stores the same). S1 assigns its Intune policies to the
 * CUI enclave group (customer.json cui_enclave.group_id).
 */
const groupAssignments = (policyId: string, groupId: string) => [
  { id: `${policyId}_${groupId}`, target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId } },
];
const CUI_ENCLAVE_GROUP = 'group-1';

/**
 * W5c2 follow-up 6 (SIM-A3): S1's G5 (GCC High) service plans and the
 * service each one activates (the S1 answers file's TCP.LIC.004 list).
 * Sentinel is an Azure service, not a Microsoft 365 plan, so it has none.
 */
export const S1_SERVICE_PLANS: Array<[string, string]> = [
  ['EXCHANGE_S_ENTERPRISE_GOV', 'Exchange Online'],
  ['SHAREPOINTENTERPRISE_GOV', 'SharePoint Online'],
  ['TEAMS_GOV', 'Teams'],
  ['INTUNE_A', 'Intune'],
  ['WINDEFATP', 'Defender for Endpoint'],
  ['ATP_ENTERPRISE_GOV', 'Defender for Office 365'],
  ['THREAT_INTELLIGENCE_GOV', 'Defender for Office 365'],
  ['ATA', 'Defender for Identity'],
  ['ADALLOM_S_STANDALONE', 'Defender for Cloud Apps'],
  ['RMS_S_PREMIUM2_GOV', 'Azure Information Protection'],
  ['MIP_S_CLP2', 'Azure Information Protection'],
  ['M365_ADVANCED_AUDITING', 'Purview Compliance'],
  ['INSIDER_RISK', 'Purview Compliance'],
  ['AAD_PREMIUM_P2', 'Entra ID P2'],
];

/** Office egress and documentation addresses (RFC 5737). */
const OFFICE_IP = '198.51.100.20';
const RISKY_IP = '203.0.113.77';

/**
 * synthetic-customer W5 cycle 1: Microsoft platform constants (not tenant
 * data, the same in every tenant), allowlisted in the identity scan.
 *  - the directory setting template "Password Rule Settings";
 *  - the lifecycle-workflow built-in task "Disable user account" (the id
 *    EO's PS.L2-3.9.2 evaluator recognises, coverage-evaluators.ts).
 */
export const PASSWORD_RULE_SETTINGS_TEMPLATE_ID = '5cf42378-d67d-4f36-ba46-e8b86229381d';
export const LCW_DISABLE_USER_TASK_ID = '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950';

function assertContext(ctx: unknown): CustomerHistoryContext {
  const c = ctx as Partial<CustomerHistoryContext> | undefined;
  if (!c || !Array.isArray(c.accounts) || !Array.isArray(c.devices) || !c.azure || !c.domain || !c.operatorSeedId || !c.organization) {
    throw new Error("customer-history: the scenario must carry seedContext['customer-history'] (scripts/build-customer-scenario.mjs writes it)");
  }
  return c as CustomerHistoryContext;
}

export function buildCustomerHistorySeed(anchorMs: number, context: unknown): SeedSet {
  const ctx = assertContext(context);
  const at = (days: number, minutes = 0) => new Date(anchorMs - days * DAY - minutes * MIN).toISOString();
  const ahead = (days: number) => new Date(anchorMs + days * DAY).toISOString();
  const tenantId = `sim-tenant-${ctx.slug}`;
  // W7-SIM (2026-10-29): S3 (customerHistoryS3.ts) passes its context with
  // the `deficient` block; it opts out of the W7 seeds, so its records stay
  // as before (each W7 collection is emitted empty for it).
  const w7Seeds = !('deficient' in (context as object));

  const accounts = ctx.accounts;
  const byKind = (k: HistoryAccount['kind']) => accounts.filter((a) => a.kind === k);
  const staff = byKind('staff');
  const admins = byKind('admin');
  const breakGlass = byKind('break_glass');
  const joiner = staff.find((a) => a.lifecycle?.event === 'joiner');
  const leavers = staff.filter((a) => a.lifecycle?.event === 'leaver');
  const disabledLeaver = leavers.find((a) => a.lifecycle?.account_enabled === false);
  const openLeaver = leavers.find((a) => a.lifecycle?.account_enabled === true);
  const acct = (seedId: string) => accounts.find((a) => a.seedId === seedId)!;
  const idx = (a: HistoryAccount) => Number(a.seedId.replace(/^user-/, ''));

  /** Whether the account was in use `d` days before the anchor (leavers stop, joiners start). */
  const activeOn = (a: HistoryAccount, d: number) =>
    (a.lifecycle?.event === 'leaver' ? d > a.lifecycle.days_before_anchor : true) &&
    (a.lifecycle?.event === 'joiner' ? d < a.lifecycle.days_before_anchor : true);
  const licensed = (a: HistoryAccount) => a.kind === 'staff' && a !== disabledLeaver;
  const lic = [{ skuId: ctx.licensing.skuId, disabledPlans: [] as string[] }];

  // ---------------------------------------------------------------- users
  const userEnrich: Record<string, Record<string, unknown>> = {};
  for (const a of accounts) {
    const n = idx(a);
    const created = a.lifecycle?.event === 'joiner' ? a.lifecycle.days_before_anchor : 420 + ((n * 37) % 900);
    let last: number;
    if (a.kind === 'break_glass') last = 45;
    else if (a.lifecycle?.event === 'leaver') last = a.lifecycle.days_before_anchor + 1;
    else last = n % 3;
    const signAt = at(last, (n * 17) % 600);
    userEnrich[a.seedId] = {
      userType: 'Member',
      createdDateTime: at(created),
      signInActivity: { lastSignInDateTime: a.kind === 'service' ? null : signAt, lastNonInteractiveSignInDateTime: signAt },
      assignedLicenses: licensed(a) ? lic : [],
      mail: a.kind === 'staff' ? a.upn : null,
      onPremisesSyncEnabled: null,
      lastPasswordChangeDateTime: at(a.kind === 'service' ? 200 : 20 + ((n * 11) % 150)),
      // W5c1: per-user password policy (expiry itself is the domain's, below).
      passwordPolicies: a.kind === 'service' || a.kind === 'break_glass' ? 'DisablePasswordExpiration' : 'None',
      usageLocation: 'US',
      ...(a.lifecycle?.event === 'joiner' ? { employeeHireDate: at(a.lifecycle.days_before_anchor) } : {}),
      ...(a.lifecycle?.event === 'leaver' ? { employeeLeaveDateTime: at(a.lifecycle.days_before_anchor) } : {}),
    };
  }

  const subscribedSkus: StoreObject[] = [
    {
      id: ctx.licensing.skuId,
      skuId: ctx.licensing.skuId,
      skuPartNumber: ctx.licensing.skuPartNumber,
      displayName: ctx.licensing.displayName,
      appliesTo: 'User',
      capabilityStatus: 'Enabled',
      prepaidUnits: { enabled: ctx.licensing.prepaidUnits, suspended: 0, warning: 0 },
      consumedUnits: accounts.filter(licensed).length,
      // W5c2 follow-up 6 (SIM-A3): the SKU's service plans, all provisioned
      // (Graph subscribedSku.servicePlans). Plan names follow the GCC High
      // G5 naming; the plan ids are S1 sim ids, not Microsoft's.
      servicePlans: S1_SERVICE_PLANS.map(([servicePlanName], i) => ({
        servicePlanId: simGuid(0xb2, i + 1),
        servicePlanName,
        provisioningStatus: 'Success',
        appliesTo: 'User',
      })),
    },
  ];
  const registrationDetails: StoreObject[] = accounts
    .filter((a) => a.kind !== 'service')
    .map((a) => ({
      id: `s1h-reg-${a.seedId}`,
      userPrincipalName: a.upn,
      userDisplayName: a.displayName,
      isMfaRegistered: true,
      isMfaCapable: true,
      isPasswordlessCapable: a.kind !== 'staff',
      methodsRegistered: a.kind === 'staff' ? ['microsoftAuthenticatorPush', 'softwareOneTimePasscode'] : ['fido2'],
      isAdmin: a.kind === 'admin' || a.kind === 'break_glass',
      userType: 'member',
      lastUpdatedDateTime: at(30 + (idx(a) % 40)),
      // W5c1: the rest of Graph's userRegistrationDetails (MFA state per user).
      defaultMfaMethod: a.kind === 'staff' ? 'microsoftAuthenticatorPush' : 'none',
      isSsprRegistered: a.kind === 'staff',
      isSsprEnabled: a.kind === 'staff',
      isSsprCapable: a.kind === 'staff',
      isSystemPreferredAuthenticationMethodEnabled: true,
      systemPreferredAuthenticationMethods: a.kind === 'staff' ? ['push'] : ['fido2'],
      userPreferredMethodForSecondaryAuthentication: a.kind === 'staff' ? 'push' : 'none',
    }));
  // W5c1: per-user authentication methods (Get-MgUserAuthenticationMethod
  // -UserId <id> reads `authMethods`, semantics.ts COLLECTION_REMAP, scoped
  // by userId). `methodType` matches the base seed rows beside them.
  // Staff: password + Authenticator + software OATH; admin and break-glass:
  // password + FIDO2 security key; service accounts: password only.
  const authMethods: StoreObject[] = [];
  for (const a of accounts) {
    const n = idx(a);
    const method = (kind: number, odataType: string, extra: Record<string, unknown>) =>
      authMethods.push({ id: simGuid(0xa700 + kind, n), userId: a.seedId, '@odata.type': odataType, methodType: odataType.replace(/^#microsoft\.graph\.|AuthenticationMethod$/g, ''), ...extra });
    method(1, '#microsoft.graph.passwordAuthenticationMethod', { password: null, createdDateTime: at(a.kind === 'service' ? 200 : 20 + ((n * 11) % 150)) });
    if (a.kind === 'staff') {
      method(2, '#microsoft.graph.microsoftAuthenticatorAuthenticationMethod', { displayName: 'Company iPhone', deviceTag: 'SoftwareTokenActivated', phoneAppVersion: '6.8.12', createdDateTime: at(300 + (n % 90)) });
      method(3, '#microsoft.graph.softwareOathAuthenticationMethod', { secretKey: null, createdDateTime: at(300 + (n % 90)) });
    } else if (a.kind === 'admin' || a.kind === 'break_glass') {
      method(4, '#microsoft.graph.fido2AuthenticationMethod', { displayName: 'Security key', model: 'Sim FIDO2 Key (FICTIONAL)', aaGuid: simGuid(0xfd, 1), attestationLevel: 'attested', createdDateTime: at(250 + (n % 30)) });
    }
  }

  // --------------------------------------------------------------- groups
  const groupEnrich: Record<string, Record<string, unknown>> = {};
  const groupMember: StoreObject[] = [];
  for (const g of ctx.groups) {
    groupEnrich[g.seedId] = { securityEnabled: true, mailEnabled: false, createdDateTime: at(700 - Number(g.seedId.replace(/^group-/, '')) * 7) };
    for (const m of g.memberSeedIds) groupMember.push({ id: `${g.seedId}|${m}`, groupId: g.seedId, memberId: m });
  }
  // PH-12 P12-AO (2026-11-01): the CUI enclave group is a MAIL-ENABLED security group, so a
  // sensitivity label's encryption can grant rights to its address (AO D-11; Purview rights take
  // a mail-enabled group). Still securityEnabled with the same displayName and members, so
  // Muster (securityEnabled + /cui/) and EO (displayName) read it as before. An override, because
  // the generic group generator already sets mailEnabled false and enrich never replaces a value.
  // S2 and S3 drop it (customerHistoryS2.ts, customerHistoryS3.ts): their CUI group stays as it was.
  const cuiMailNickname = 'cui-authorized-users';
  const groupOverride: Record<string, Record<string, unknown>> = {
    [CUI_ENCLAVE_GROUP]: { mailEnabled: true, mailNickname: cuiMailNickname, mail: `${cuiMailNickname}@${ctx.domain}`, proxyAddresses: [`SMTP:${cuiMailNickname}@${ctx.domain}`] },
  };

  // -------------------------------------------------------- roles and PIM
  const roleAssignments: StoreObject[] = ctx.pim.breakGlassSeedIds.map((u, i) => ({
    id: `roleAssignment-${i + 1}`,
    principalId: u,
    roleDefinitionId: ctx.pim.globalAdministratorTemplateId,
    directoryScopeId: '/',
  }));
  const roleEligibilitySchedules: StoreObject[] = ctx.pim.eligible.map((e, i) => ({
    id: `roleEligibilitySchedule-${i + 1}`,
    principalId: e.principalSeedId,
    roleDefinitionId: e.roleTemplateId,
    directoryScopeId: '/',
    memberType: 'Direct',
    status: 'Provisioned',
    createdDateTime: at(300 - i * 20),
    scheduleInfo: { startDateTime: at(300 - i * 20), expiration: { type: 'afterDateTime', endDateTime: ahead(65 + i * 20) } },
  }));
  // W5c2 follow-up 6 (SIM-A4): the ISSM's admin account is PIM-eligible for
  // Compliance Administrator (S1 holds every admin role through PIM, none
  // standing). Its policy is follow-up 4's (Entra defaults).
  const issmAdminForCompliance = admins.find((a) => a.ownerSeedId !== undefined && acct(a.ownerSeedId)?.roles?.includes('issm'));
  if (issmAdminForCompliance) {
    const i = roleEligibilitySchedules.length;
    roleEligibilitySchedules.push({
      id: `roleEligibilitySchedule-${i + 1}`,
      principalId: issmAdminForCompliance.seedId,
      roleDefinitionId: COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID,
      directoryScopeId: '/',
      memberType: 'Direct',
      status: 'Provisioned',
      createdDateTime: at(200),
      scheduleInfo: { startDateTime: at(200), expiration: { type: 'afterDateTime', endDateTime: ahead(165) } },
    });
  }
  // W7-SIM (2026-10-29): the operator (the systems administrator's admin
  // account, the one CES signs in as) is also PIM-eligible for Global
  // Administrator, so it can activate the role for an approved change. Still
  // no standing role: PIM eligibility only.
  if (w7Seeds && !ctx.pim.eligible.some((e) => e.principalSeedId === ctx.operatorSeedId && e.roleTemplateId === ctx.pim.globalAdministratorTemplateId)) {
    const i = roleEligibilitySchedules.length;
    roleEligibilitySchedules.push({
      id: `roleEligibilitySchedule-${i + 1}`,
      principalId: ctx.operatorSeedId,
      roleDefinitionId: ctx.pim.globalAdministratorTemplateId,
      directoryScopeId: '/',
      memberType: 'Direct',
      status: 'Provisioned',
      createdDateTime: at(180),
      scheduleInfo: { startDateTime: at(180), expiration: { type: 'afterDateTime', endDateTime: ahead(185) } },
    });
  }
  const eligibleFor = (role: string) => ctx.pim.eligible.find((e) => e.role === role) ?? ctx.pim.eligible[0];
  const activations = [
    { n: 1, e: eligibleFor('Security Administrator'), days: 12, justification: 'Investigate incident-s1-1 (phishing click and risky sign-in)', ticket: 'S1-IR-0007' },
    { n: 2, e: eligibleFor('Exchange Administrator'), days: 33, justification: 'Apply approved change S1-CHG-0042 (DLP rule for CUI mail)', ticket: 'S1-CHG-0042' },
  ];
  const roleAssignmentScheduleRequests: StoreObject[] = activations.map(({ n, e, days, justification, ticket }) => ({
    id: `s1h-pim-${pad(n, 4)}`,
    action: 'selfActivate',
    principalId: e.principalSeedId,
    roleDefinitionId: e.roleTemplateId,
    directoryScopeId: '/',
    appScopeId: null,
    isValidationOnly: false,
    targetScheduleId: `s1h-pim-${pad(n, 4)}`,
    justification,
    status: 'Provisioned',
    approvalId: null,
    createdDateTime: at(days),
    completedDateTime: at(days, -1),
    createdBy: { user: { id: e.principalSeedId, displayName: acct(e.principalSeedId).displayName } },
    scheduleInfo: { startDateTime: at(days, -1), expiration: { type: 'afterDuration', duration: 'PT4H', endDateTime: null } },
    ticketInfo: { ticketNumber: ticket, ticketSystem: 'S1 ITSM' },
  }));

  // W5c1: PIM activation requirements. One role management policy per role
  // S1 manages in PIM (Global Administrator and the eligible roles), its
  // assignment to the role, and the role definitions (built-in template ids
  // = role ids, platform constants already in the context). Rules are the
  // Graph rule ids, inline as `$expand=rules` returns them. Activation: MFA,
  // justification and a ticket, at most 4 h (the 2 recorded activations are
  // PT4H); Global and Privileged Role Administrator also need approval by
  // another admin account. Eligibility expires after at most 365 days.
  const pimRoles: Array<{ role: string; roleTemplateId: string }> = [{ role: 'Global Administrator', roleTemplateId: ctx.pim.globalAdministratorTemplateId }];
  for (const e of ctx.pim.eligible) if (!pimRoles.some((r) => r.roleTemplateId === e.roleTemplateId)) pimRoles.push({ role: e.role, roleTemplateId: e.roleTemplateId });
  const APPROVAL_ROLES = new Set(['Global Administrator', 'Privileged Role Administrator']);
  const target = (caller: string, level: string) => ({ caller, operations: ['all'], level, inheritableSettings: [], enforcedSettings: [] });
  const roleManagementPolicies: StoreObject[] = [];
  const policyRoleManagementPolicyAssignment: StoreObject[] = [];
  const roleManagementDirectoryRoleDefinition: StoreObject[] = [];
  // W5c1-b: the approver is the ISSM's admin account (customer.json roles.issm
  // and owner_person_id). PIM never lets a requestor approve their own
  // request, so where that account is itself eligible for the role (S1: the
  // ISSM holds Global Administrator) the ISSO's admin account is a second
  // approver, and an admin who holds the role is never the only approver.
  const adminOf = (role: string) => admins.find((a) => a.ownerSeedId !== undefined && acct(a.ownerSeedId)?.roles?.includes(role));
  const issmAdmin = adminOf('issm');
  const backupAdmin = adminOf('isso');
  pimRoles.forEach((r, i) => {
    const policyId = `DirectoryRole_${tenantId}_${simGuid(0x9a, i + 1)}`;
    const holders = new Set(ctx.pim.eligible.filter((e) => e.roleTemplateId === r.roleTemplateId).map((e) => e.principalSeedId));
    const approvers: HistoryAccount[] = [];
    if (issmAdmin) approvers.push(issmAdmin);
    if (approvers.every((a) => holders.has(a.seedId))) {
      const other = [backupAdmin, ...admins].find((a): a is HistoryAccount => a !== undefined && !holders.has(a.seedId) && !approvers.includes(a));
      if (other) approvers.push(other);
    }
    const needsApproval = APPROVAL_ROLES.has(r.role);
    roleManagementPolicies.push({
      id: policyId,
      displayName: 'Directory Role',
      description: `PIM settings for ${r.role}`,
      isOrganizationDefault: false,
      scopeId: '/',
      scopeType: 'DirectoryRole',
      lastModifiedDateTime: at(150 - i * 3),
      lastModifiedBy: { displayName: (admins[0] ?? staff[0]).displayName, id: (admins[0] ?? staff[0]).seedId },
      rules: [
        { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule', id: 'Expiration_Admin_Eligibility', isExpirationRequired: true, maximumDuration: 'P365D', target: target('Admin', 'Eligibility') },
        { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule', id: 'Expiration_Admin_Assignment', isExpirationRequired: true, maximumDuration: 'P180D', target: target('Admin', 'Assignment') },
        { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyEnablementRule', id: 'Enablement_Admin_Assignment', enabledRules: ['MultiFactorAuthentication', 'Justification'], target: target('Admin', 'Assignment') },
        { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule', id: 'Expiration_EndUser_Assignment', isExpirationRequired: true, maximumDuration: 'PT4H', target: target('EndUser', 'Assignment') },
        { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyEnablementRule', id: 'Enablement_EndUser_Assignment', enabledRules: ['MultiFactorAuthentication', 'Justification', 'Ticketing'], target: target('EndUser', 'Assignment') },
        {
          '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyApprovalRule',
          id: 'Approval_EndUser_Assignment',
          target: target('EndUser', 'Assignment'),
          setting: {
            isApprovalRequired: needsApproval,
            isApprovalRequiredForExtension: false,
            isRequestorJustificationRequired: true,
            approvalMode: 'SingleStage',
            approvalStages: needsApproval
              ? [{ approvalStageTimeOutInDays: 1, isApproverJustificationRequired: true, escalationTimeInMinutes: 0, isEscalationEnabled: false, primaryApprovers: approvers.map((a) => ({ '@odata.type': '#microsoft.graph.singleUser', userId: a.seedId, description: a.displayName })), escalationApprovers: [] }]
              : [],
          },
        },
        { '@odata.type': '#microsoft.graph.unifiedRoleManagementPolicyNotificationRule', id: 'Notification_Admin_EndUser_Assignment', notificationType: 'Email', recipientType: 'Admin', notificationLevel: 'All', isDefaultRecipientsEnabled: true, notificationRecipients: [], target: target('EndUser', 'Assignment') },
      ],
    });
    policyRoleManagementPolicyAssignment.push({ id: `${policyId}_${r.roleTemplateId}`, policyId, scopeId: '/', scopeType: 'DirectoryRole', roleDefinitionId: r.roleTemplateId });
    roleManagementDirectoryRoleDefinition.push({ id: r.roleTemplateId, templateId: r.roleTemplateId, displayName: r.role, description: `Built-in role: ${r.role}`, isBuiltIn: true, isEnabled: true, resourceScopes: ['/'] });
  });
  // W5c2 follow-up 4: every tenant holds every built-in role and a PIM policy
  // for it. S1 does not manage Compliance Administrator, so its policy keeps
  // Entra's defaults (no approval); it is the role Stamper's
  // AC.L2-3.1.4.pim-approval / pim-policy-get look up by displayName.
  if (!pimRoles.some((r) => r.roleTemplateId === COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID)) {
    const policyId = `DirectoryRole_${tenantId}_${simGuid(0x9a, pimRoles.length + 1)}`;
    roleManagementPolicies.push({
      id: policyId,
      displayName: 'Directory Role',
      description: 'PIM settings for Compliance Administrator',
      isOrganizationDefault: false,
      scopeId: '/',
      scopeType: 'DirectoryRole',
      lastModifiedDateTime: null,
      lastModifiedBy: null,
      rules: entraDefaultPimRules(),
    });
    policyRoleManagementPolicyAssignment.push({ id: `${policyId}_${COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID}`, policyId, scopeId: '/', scopeType: 'DirectoryRole', roleDefinitionId: COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID });
    roleManagementDirectoryRoleDefinition.push({ id: COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID, templateId: COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID, displayName: 'Compliance Administrator', description: 'Built-in role: Compliance Administrator', isBuiltIn: true, isEnabled: true, resourceScopes: ['/'] });
  }

  // -------------------------------------------------------------- devices
  const managedDeviceEnrich: Record<string, Record<string, unknown>> = {};
  const entraDevices: StoreObject[] = [];
  ctx.devices.forEach((d, i) => {
    const n = i + 1;
    const lastSyncMin = d.compliant ? (n * 37) % 1200 : 3 * 1440 + ((n * 37) % 600);
    managedDeviceEnrich[d.seedId] = {
      operatingSystem: d.os,
      osVersion: d.osVersion,
      manufacturer: d.os === 'iOS' ? 'Apple' : 'Sim Workstations Inc. (FICTIONAL)',
      model: d.os === 'iOS' ? 'iPhone' : d.kind === 'kiosk' ? 'Shop Kiosk K2' : 'Workstation W7',
      serialNumber: `S1SN${pad(n, 5)}`,
      azureADDeviceId: d.entraId,
      deviceEnrollmentType: d.os === 'iOS' ? 'appleBulkWithUser' : 'windowsAzureADJoin',
      managementAgent: 'mdm',
      enrolledDateTime: at(200 + ((n * 13) % 400)),
      lastSyncDateTime: at(0, lastSyncMin),
      ...(d.os === 'Windows' ? { lastTvmAssessed: at(n % 7, (n * 29) % 600) } : {}),
    };
    entraDevices.push({
      id: d.entraId,
      deviceId: d.entraId,
      displayName: d.deviceName,
      operatingSystem: d.os,
      operatingSystemVersion: d.osVersion,
      accountEnabled: true,
      isCompliant: d.compliant,
      isManaged: true,
      trustType: d.os === 'iOS' ? 'Workplace' : 'AzureAd',
      approximateLastSignInDateTime: at(0, lastSyncMin),
      registrationDateTime: at(200 + ((n * 13) % 400)),
    });
  });
  const windows = ctx.devices.filter((d) => d.os === 'Windows');
  // SIM-BL (2026-10-31): the BitLocker recovery key each encrypted Windows
  // device escrowed in Entra ID at enrolment (OS volume). An unencrypted
  // device (customer devices.unencrypted) has none; iOS has none. Metadata
  // only: no key material is seeded.
  const bitlockerRecoveryKeys: StoreObject[] = ctx.devices
    .map((d, i) => ({ d, n: i + 1 }))
    .filter(({ d }) => d.os === 'Windows' && d.encrypted)
    .map(({ d, n }) => ({
      id: simGuid(0xbf, n),
      createdDateTime: at(200 + ((n * 13) % 400), -30),
      deviceId: d.entraId,
      volumeType: 'operatingSystemVolume',
    }));

  // ------------------------------------------------- vulnerabilities (TVM)
  // 34 CVEs, 28 remediated. Severity by position; CVE numbers are fictional.
  const sev = (c: number): string => (c <= 4 ? 'Critical' : c <= 14 ? 'High' : c <= 28 ? 'Medium' : c <= 30 ? 'High' : 'Medium');
  const software = [
    ['microsoft', 'windows_11', '10.0.22631.4037'],
    ['microsoft', 'office', '16.0.17928'],
    ['sim-cam-vendor', 'cam-suite', '2025.2'],
    ['sim-pdf-vendor', 'pdf-reader', '24.1.3'],
    ['sim-browser-vendor', 'browser', '128.0'],
    ['sim-cmm-vendor', 'cmm-metrology', '8.4'],
  ];
  const vulnerabilities: StoreObject[] = [];
  const tvmSoftwareVulnerabilities: StoreObject[] = [];
  for (let c = 1; c <= 34; c++) {
    const cveId = `CVE-2026-9${pad(c, 4)}`;
    const remediated = c <= 28;
    const [vendor, name, version] = software[c % software.length];
    vulnerabilities.push({ id: `vulnerability-${c}`, cveId, severity: sev(c).toLowerCase(), cvssScore: sev(c) === 'Critical' ? 9.8 : sev(c) === 'High' ? 8.1 : 5.4, publishedDateTime: at(95 - c), remediated, remediatedDateTime: remediated ? at(60 - c) : null });
    const affected = 1 + (c % 3);
    for (let j = 0; j < affected; j++) {
      const dev = windows[(c * 7 + j * 11) % windows.length];
      tvmSoftwareVulnerabilities.push({
        id: `s1h-tvm-${pad(c, 3)}-${j + 1}`,
        DeviceId: dev.seedId,
        DeviceName: dev.deviceName,
        OSPlatform: 'Windows11',
        SoftwareVendor: vendor,
        SoftwareName: name,
        SoftwareVersion: version,
        CveId: cveId,
        VulnerabilitySeverityLevel: sev(c),
        RecommendedSecurityUpdate: remediated ? '' : `Update ${name} to the current release`,
        RecommendedSecurityUpdateId: remediated ? '' : `S1KB${pad(c, 5)}`,
        CveMitigationStatus: remediated ? 'applied' : '',
      });
    }
  }

  // ------------------------------------------------------- secure score
  // 90 daily snapshots, 61 % -> 72 %, stepping up as controls were closed.
  const scoreAt = (d: number): number => (d >= 70 ? 61 : d >= 50 ? 64 : d >= 30 ? 67 : d >= 10 ? 70 : 72);
  const controls = (d: number) => [
    { controlCategory: 'Identity', controlName: 'AdminMFAV2', score: 10, maxScore: 10 },
    { controlCategory: 'Identity', controlName: 'MFARegistrationV2', score: 9, maxScore: 9 },
    { controlCategory: 'Identity', controlName: 'BlockLegacyAuthentication', score: d >= 70 ? 0 : 8, maxScore: 8 },
    { controlCategory: 'Identity', controlName: 'PWAgePolicyNew', score: 8, maxScore: 8 },
    { controlCategory: 'Device', controlName: 'mde_onboarding', score: d >= 50 ? 4 : 7, maxScore: 7 },
    { controlCategory: 'Apps', controlName: 'mdo_safeattachments', score: d >= 30 ? 0 : 8, maxScore: 8 },
    { controlCategory: 'Data', controlName: 'dlp_datalossprevention', score: d >= 10 ? 2 : 5, maxScore: 5 },
    { controlCategory: 'Apps', controlName: 'mdo_safelinksforemail', score: 0, maxScore: 9 },
  ].map((x) => ({ ...x, scoreInPercentage: Math.round((x.score / x.maxScore) * 10000) / 100, description: `${x.controlName} control state on this day` }));
  const secureScores: StoreObject[] = [];
  for (let d = 0; d < 90; d++) {
    const day = at(d).slice(0, 10);
    secureScores.push({
      id: `${tenantId}_${day}`,
      azureTenantId: tenantId,
      activeUserCount: accounts.filter((a) => a.kind === 'staff').length,
      licensedUserCount: accounts.filter(licensed).length,
      currentScore: scoreAt(d),
      maxScore: 100,
      createdDateTime: at(d),
      enabledServices: ['HasExchange', 'HasSharePoint', 'HasOD4B', 'HasMDEP'],
      averageComparativeScores: [{ basis: 'AllTenants', averageScore: 52.4 }],
      controlScores: controls(d),
    });
  }
  const secureScoreControlProfiles: StoreObject[] = [
    ['AdminMFAV2', 'Ensure multifactor authentication is enabled for all users in administrative roles', 'Identity', 10, 'implemented'],
    ['MFARegistrationV2', 'Ensure all users can complete multifactor authentication', 'Identity', 9, 'implemented'],
    ['BlockLegacyAuthentication', 'Enable policy to block legacy authentication', 'Identity', 8, 'implemented'],
    ['PWAgePolicyNew', 'Set the password expiration policy to never expire', 'Identity', 8, 'implemented'],
    ['mde_onboarding', 'Onboard devices to Defender for Endpoint', 'Device', 7, 'implemented'],
    ['mdo_safeattachments', 'Turn on Safe Attachments in block mode', 'Apps', 8, 'implemented'],
    ['dlp_datalossprevention', 'Turn on data loss prevention policies', 'Data', 5, 'implemented'],
    ['mdo_safelinksforemail', 'Create Safe Links policies for email messages', 'Apps', 9, 'notImplemented'],
  ].map(([id, title, controlCategory, maxScore, implementationStatus], i) => ({
    id: id as string,
    title,
    controlCategory,
    maxScore,
    implementationStatus,
    tier: i < 4 ? 'Core' : 'Defense in Depth',
    rank: i + 1,
    actionType: 'Config',
    service: controlCategory === 'Identity' ? 'AzureAD' : controlCategory === 'Device' ? 'MDATP' : controlCategory === 'Data' ? 'MIP' : 'MDO',
    deprecated: false,
    threats: ['accountBreach'],
    lastModifiedDateTime: at(10 + i * 9),
    // W5c1: the recommendation and its review state (Graph controlStateUpdates).
    // Implemented controls were reviewed; Safe Links (not implemented) is
    // assigned to the administrator with a planned change.
    remediation: `${title}.`,
    remediationImpact: 'Low impact on users',
    userImpact: 'Low',
    implementationCost: 'Low',
    complianceInformation: [],
    controlStateUpdates: [
      implementationStatus === 'implemented'
        ? { assignedTo: '', comment: 'Implemented and reviewed at the quarterly control review', state: 'Reviewed', updatedBy: (admins[0] ?? staff[0]).upn, updatedDateTime: at(10 + i * 9) }
        : { assignedTo: (admins[2] ?? admins[0] ?? staff[0]).upn, comment: 'Planned under change S1-CHG-0051', state: 'Default', updatedBy: (admins[0] ?? staff[0]).upn, updatedDateTime: at(6) },
    ],
  }));

  // ---------------------------------------------- alerts and incidents
  // 6 alerts whose lifecycle moved: 4 resolved, 1 in progress, 1 new.
  const victim = staff.find((a) => a.department === 'Engineering') ?? staff[0];
  const victimDevice = ctx.devices.find((d) => d.upn === victim.upn) ?? windows[0];
  const analyst = admins[0] ?? staff[0];
  const userEvidence = (a: HistoryAccount) => ({
    '@odata.type': '#microsoft.graph.security.userEvidence',
    roles: ['impacted'],
    userAccount: { accountName: a.upn.split('@')[0], azureAdUserId: a.seedId, displayName: a.displayName, userPrincipalName: a.upn },
  });
  const deviceEvidence = (d: HistoryDevice) => ({ '@odata.type': '#microsoft.graph.security.deviceEvidence', roles: ['impacted'], mdeDeviceId: d.seedId, deviceDnsName: d.deviceName });
  const alertSpec = [
    { n: 1, title: 'Email messages containing malicious URL removed after delivery', sev: 'medium', svc: 'microsoftDefenderForOffice365', cat: 'InitialAccess', created: 12 * 1440 + 120, updated: 10 * 1440, status: 'resolved', cls: 'truePositive', det: 'phishing', inc: 'incident-s1-1', ev: [userEvidence(victim)], mitre: ['T1566.002'] },
    { n: 2, title: 'Unfamiliar sign-in properties', sev: 'medium', svc: 'azureAdIdentityProtection', cat: 'InitialAccess', created: 12 * 1440, updated: 10 * 1440, status: 'resolved', cls: 'truePositive', det: 'compromisedAccount', inc: 'incident-s1-1', ev: [userEvidence(victim), deviceEvidence(victimDevice)], mitre: ['T1078'] },
    { n: 3, title: 'Suspicious inbox forwarding rule', sev: 'low', svc: 'microsoftDefenderForOffice365', cat: 'Exfiltration', created: 41 * 1440, updated: 39 * 1440, status: 'resolved', cls: 'falsePositive', det: 'other', inc: null, ev: [userEvidence(staff[2])], mitre: ['T1114.003'] },
    { n: 4, title: 'Potentially unwanted application detected', sev: 'low', svc: 'microsoftDefenderForEndpoint', cat: 'Malware', created: 63 * 1440, updated: 62 * 1440, status: 'resolved', cls: 'truePositive', det: 'unwantedSoftware', inc: null, ev: [deviceEvidence(windows[5])], mitre: [] },
    { n: 5, title: 'Suspicious PowerShell command line', sev: 'high', svc: 'microsoftDefenderForEndpoint', cat: 'Execution', created: 3 * 1440, updated: 1 * 1440, status: 'inProgress', cls: null, det: null, inc: 'incident-s1-2', ev: [deviceEvidence(windows[11])], mitre: ['T1059.001'] },
    { n: 6, title: 'Atypical travel', sev: 'low', svc: 'azureAdIdentityProtection', cat: 'InitialAccess', created: 1 * 1440 + 300, updated: 1 * 1440 + 300, status: 'new', cls: null, det: null, inc: null, ev: [userEvidence(staff[7])], mitre: ['T1078'] },
  ];
  const alerts: StoreObject[] = alertSpec.map((a) => ({
    id: `alert-s1-${a.n}`,
    providerAlertId: `s1-${a.svc}-${pad(a.n, 4)}`,
    title: a.title,
    severity: a.sev,
    status: a.status,
    serviceSource: a.svc,
    detectionSource: a.svc,
    category: a.cat,
    classification: a.cls,
    determination: a.det,
    incidentId: a.inc,
    assignedTo: a.status === 'new' ? null : analyst.upn,
    description: `${a.title} (fictional history record)`,
    createdDateTime: at(0, a.created),
    firstActivityDateTime: at(0, a.created + 10),
    lastActivityDateTime: at(0, a.created),
    lastUpdateDateTime: at(0, a.updated),
    resolvedDateTime: a.status === 'resolved' ? at(0, a.updated) : null,
    mitreTechniques: a.mitre,
    tenantId,
    evidence: a.ev,
    // W5c1: the lifecycle as the alert's own comment trail (Graph alerts_v2
    // `comments`): new -> inProgress when the analyst took it (1 h after
    // creation), inProgress -> resolved with the classification. A Graph read
    // returns only the current state; this trail is what the record carries
    // about its earlier states.
    comments: [
      ...(a.status !== 'new' ? [{ comment: `Status changed from new to inProgress; assigned to ${analyst.upn}`, createdByDisplayName: analyst.displayName, createdDateTime: at(0, a.created - 60) }] : []),
      ...(a.status === 'resolved' ? [{ comment: `Classified ${a.cls} (${a.det}); status changed from inProgress to resolved`, createdByDisplayName: analyst.displayName, createdDateTime: at(0, a.updated) }] : []),
    ],
  }));
  const inline = (id: string) => {
    const a = alerts.find((x) => x.id === id)! as Record<string, unknown>;
    return { id, title: a.title, severity: a.severity, status: a.status, incidentId: a.incidentId, serviceSource: a.serviceSource, detectionSource: a.detectionSource, createdDateTime: a.createdDateTime, lastUpdateDateTime: a.lastUpdateDateTime };
  };
  const securityIncidents: StoreObject[] = [
    {
      id: 'incident-s1-1',
      displayName: 'Initial access involving one user (phishing click and risky sign-in)',
      severity: 'medium',
      status: 'resolved',
      classification: 'truePositive',
      determination: 'phishing',
      assignedTo: analyst.upn,
      tenantId,
      createdDateTime: at(0, 12 * 1440 + 120),
      lastUpdateDateTime: at(10),
      resolvedDateTime: at(10),
      incidentWebUrl: 'https://security.microsoft.us/incidents/incident-s1-1',
      alerts: [inline('alert-s1-1'), inline('alert-s1-2')],
    },
    {
      id: 'incident-s1-2',
      displayName: 'Suspicious execution on one device',
      severity: 'high',
      status: 'active',
      classification: 'unknown',
      determination: 'unknown',
      assignedTo: analyst.upn,
      tenantId,
      createdDateTime: at(0, 3 * 1440),
      lastUpdateDateTime: at(1),
      resolvedDateTime: null,
      incidentWebUrl: 'https://security.microsoft.us/incidents/incident-s1-2',
      alerts: [inline('alert-s1-5')],
    },
  ];

  // ------------------------------------------------------ identity risk
  const detection = (id: string, a: HistoryAccount, ageMin: number, riskEventType: string, riskLevel: string, riskState: string, ip: string) => ({
    id, riskEventType, riskLevel, riskState, riskDetail: riskState === 'remediated' ? 'userPerformedSecuredPasswordReset' : riskState === 'dismissed' ? 'adminDismissedAllRiskForUser' : 'none',
    detectionTimingType: 'realtime', activity: 'signin', source: 'IdentityProtection', tokenIssuerType: 'AzureAD',
    userId: a.seedId, userDisplayName: a.displayName, userPrincipalName: a.upn, ipAddress: ip,
    location: { city: 'Unknown', countryOrRegion: 'ZZ' },
    activityDateTime: at(0, ageMin), detectedDateTime: at(0, ageMin), lastUpdatedDateTime: at(0, Math.max(ageMin - 2 * 1440, 0)),
  });
  const riskDetections: StoreObject[] = [
    detection('riskDetection-s1-1', victim, 12 * 1440 + 30, 'unfamiliarFeatures', 'medium', 'remediated', RISKY_IP),
    detection('riskDetection-s1-2', victim, 12 * 1440, 'anonymizedIPAddress', 'high', 'remediated', '203.0.113.78'),
    detection('riskDetection-s1-3', staff[7], 1 * 1440 + 300, 'unlikelyTravel', 'low', 'atRisk', '192.0.2.144'),
  ];
  const riskyUsers: StoreObject[] = [
    { id: victim.seedId, userPrincipalName: victim.upn, userDisplayName: victim.displayName, riskLevel: 'none', riskState: 'remediated', riskDetail: 'userPerformedSecuredPasswordReset', riskLastUpdatedDateTime: at(10), isDeleted: false, isProcessing: false },
    { id: staff[7].seedId, userPrincipalName: staff[7].upn, userDisplayName: staff[7].displayName, riskLevel: 'low', riskState: 'atRisk', riskDetail: 'none', riskLastUpdatedDateTime: at(0, 1 * 1440 + 300), isDeleted: false, isProcessing: false },
  ];

  // ----------------------------------------------------------- sign-ins
  // 900 sign-ins over 90 days (10 per day), active accounts only.
  const apps = [
    ['Office 365 Exchange Online', 'Mobile Apps and Desktop clients'],
    ['Microsoft Teams', 'Mobile Apps and Desktop clients'],
    ['Office 365 SharePoint Online', 'Browser'],
    ['Microsoft Intune Company Portal', 'Mobile Apps and Desktop clients'],
    ['Microsoft 365 Admin Portal', 'Browser'],
  ];
  const interactive = accounts.filter((a) => a.kind === 'staff' || a.kind === 'admin');
  const signInLogs: StoreObject[] = [];
  let k = 0;
  for (let d = 0; d < 90; d++) {
    const pool = interactive.filter((a) => activeOn(a, d));
    for (let s = 0; s < 10; s++) {
      k++;
      const a = pool[(d * 10 + s * 7) % pool.length];
      const [appDisplayName, clientAppUsed] = a.kind === 'admin' ? apps[4] : apps[(k + s) % 4];
      const failed = k % 31 === 0;
      const dev = ctx.devices.find((x) => x.upn === a.upn);
      signInLogs.push({
        id: `s1h-signin-${pad(k, 6)}`,
        createdDateTime: at(d, 60 + s * 50 + (k % 29)),
        userId: a.seedId,
        userPrincipalName: a.upn,
        userDisplayName: a.displayName,
        appDisplayName,
        clientAppUsed,
        ipAddress: OFFICE_IP,
        location: { city: 'Fennick Falls', state: 'ZZ', countryOrRegion: 'US' },
        isInteractive: true,
        authenticationRequirement: 'multiFactorAuthentication',
        conditionalAccessStatus: failed ? 'notApplied' : 'success',
        riskLevelDuringSignIn: 'none',
        status: failed ? { errorCode: 50126, failureReason: 'Invalid username or password.' } : { errorCode: 0 },
        deviceDetail: dev ? { deviceId: dev.entraId, displayName: dev.deviceName, operatingSystem: dev.os, isCompliant: dev.compliant, isManaged: true } : { deviceId: '', displayName: '', operatingSystem: 'Windows', isCompliant: false, isManaged: false },
      });
    }
  }
  // The incident's two risky sign-ins replace two of day 12's rows by id (same count).
  for (const [i, det] of [[0, riskDetections[0]], [1, riskDetections[1]]] as const) {
    const row = signInLogs[12 * 10 + i] as Record<string, unknown>;
    const r = det as Record<string, unknown>;
    Object.assign(row, { userId: victim.seedId, userPrincipalName: victim.upn, userDisplayName: victim.displayName, createdDateTime: r.detectedDateTime, ipAddress: r.ipAddress, location: r.location, riskLevelDuringSignIn: r.riskLevel, riskEventTypes_v2: [r.riskEventType], conditionalAccessStatus: 'success', status: { errorCode: 0 } });
  }
  for (const bg of breakGlass) {
    // Quarterly break-glass test sign-in (recorded in the change log).
    const row = signInLogs[45 * 10 + idx(bg) % 10] as Record<string, unknown>;
    Object.assign(row, { userId: bg.seedId, userPrincipalName: bg.upn, userDisplayName: bg.displayName, appDisplayName: 'Microsoft 365 Admin Portal', clientAppUsed: 'Browser', authenticationRequirement: 'multiFactorAuthentication', deviceDetail: { deviceId: '', displayName: '', operatingSystem: 'Windows', isCompliant: false, isManaged: false } });
  }
  // signInActivity agrees with the log: each account's latest interactive row wins.
  const latest = new Map<string, string>();
  for (const r of signInLogs as Array<Record<string, unknown>>) {
    const prev = latest.get(r.userId as string);
    if (!prev || (r.createdDateTime as string) > prev) latest.set(r.userId as string, r.createdDateTime as string);
  }
  for (const a of accounts) {
    const t = latest.get(a.seedId);
    if (!t) continue;
    const sia = userEnrich[a.seedId].signInActivity as Record<string, unknown>;
    userEnrich[a.seedId].signInActivity = { ...sia, lastSignInDateTime: t, lastNonInteractiveSignInDateTime: t > (sia.lastNonInteractiveSignInDateTime as string) ? t : sia.lastNonInteractiveSignInDateTime };
  }

  // ---------------------------------------------------- directory audits
  // 120 Core Directory records over 90 days, incl. the joiner, both leavers
  // and the 2 PIM activations (category RoleManagement).
  const actorAdmin = (i: number) => admins[i % Math.max(admins.length, 1)] ?? staff[0];
  const dirAudit = (n: number, ageMin: number, category: string, activity: string, initiator: HistoryAccount, target: { id: string; displayName: string; type: string; userPrincipalName?: string }, extra: Record<string, unknown> = {}): StoreObject => ({
    id: `s1h-diraudit-${pad(n, 4)}`,
    activityDateTime: at(0, ageMin),
    activityDisplayName: activity,
    category,
    correlationId: simGuid(0xd1, n),
    loggedByService: category === 'RoleManagement' ? 'PIM' : 'Core Directory',
    operationType: activity.startsWith('Add') ? 'Add' : activity.startsWith('Delete') || activity.startsWith('Remove') ? 'Delete' : 'Update',
    result: 'success',
    resultReason: '',
    initiatedBy: { user: { id: initiator.seedId, displayName: initiator.displayName, userPrincipalName: initiator.upn, ipAddress: OFFICE_IP } },
    targetResources: [{ ...target, modifiedProperties: [] }],
    additionalDetails: [],
    ...extra,
  });
  const directoryAudits: StoreObject[] = [];
  const fixedAudits: Array<[number, string, string, HistoryAccount, { id: string; displayName: string; type: string; userPrincipalName?: string }]> = [];
  const userTarget = (a: HistoryAccount) => ({ id: a.seedId, displayName: a.displayName, type: 'User', userPrincipalName: a.upn });
  if (joiner) {
    const d = joiner.lifecycle!.days_before_anchor;
    fixedAudits.push([d * 1440 + 300, 'UserManagement', 'Add user', actorAdmin(0), userTarget(joiner)]);
    fixedAudits.push([d * 1440 + 290, 'UserManagement', 'Change user license', actorAdmin(0), userTarget(joiner)]);
    fixedAudits.push([d * 1440 + 280, 'GroupManagement', 'Add member to group', actorAdmin(0), userTarget(joiner)]);
  }
  if (disabledLeaver) {
    const d = disabledLeaver.lifecycle!.days_before_anchor;
    fixedAudits.push([d * 1440 - 60, 'UserManagement', 'Disable account', actorAdmin(1), userTarget(disabledLeaver)]);
    fixedAudits.push([d * 1440 - 70, 'UserManagement', 'Change user license', actorAdmin(1), userTarget(disabledLeaver)]);
    fixedAudits.push([d * 1440 - 80, 'GroupManagement', 'Remove member from group', actorAdmin(1), userTarget(disabledLeaver)]);
  }
  if (openLeaver) {
    // The leaver whose account was NOT disabled: only a profile update was logged.
    const d = openLeaver.lifecycle!.days_before_anchor;
    fixedAudits.push([d * 1440 - 120, 'UserManagement', 'Update user', actorAdmin(2), userTarget(openLeaver)]);
  }
  // W5c2 follow-up 4 (SIM-11): Entra's recycle bin (deleted users are kept
  // 30 days). Two former staff who left before the 90-day history (so no
  // leave or disable record falls inside it): disabled then, deleted after
  // HR's retention, 9 and 23 days before the anchor. Neither is one of
  // customer.json's two current leavers (both still in the directory), and
  // no account holds either original UPN. Graph prefixes a deleted user's UPN
  // with its object id (hex, no hyphens). Names are invented.
  const s1Domain = (staff[0] ?? accounts[0]).upn.split('@')[1];
  const deletedUsers: StoreObject[] = [
    { n: 1, local: 'brannoc.ferrowick', name: 'Brannoc Ferrowick', department: 'Machining', jobTitle: 'CNC Machinist', deletedDays: 9, createdDays: 900, leftDays: 104 },
    { n: 2, local: 'ilsa.quellmarsh', name: 'Ilsa Quellmarsh', department: 'Quality', jobTitle: 'Quality Inspector', deletedDays: 23, createdDays: 640, leftDays: 118 },
  ].map((d) => {
    const id = simGuid(0xde, d.n);
    const upn = `${d.local}@${s1Domain}`;
    return {
      id,
      '@odata.type': '#microsoft.graph.user',
      displayName: d.name,
      userPrincipalName: `${id.replace(/-/g, '')}${upn}`,
      mail: null,
      accountEnabled: false,
      userType: 'Member',
      department: d.department,
      jobTitle: d.jobTitle,
      createdDateTime: at(d.createdDays),
      employeeLeaveDateTime: at(d.leftDays),
      deletedDateTime: at(d.deletedDays),
      onPremisesSyncEnabled: null,
    };
  });
  deletedUsers.forEach((d, i) => {
    const o = d as Record<string, unknown>;
    const original = String(o.userPrincipalName).replace(/^[0-9a-f]{32}/, '');
    fixedAudits.push([Math.round((anchorMs - Date.parse(String(o.deletedDateTime))) / 60000), 'UserManagement', 'Delete user', actorAdmin(i), { id: d.id, displayName: String(o.displayName), type: 'User', userPrincipalName: original }]);
  });
  for (const r of roleAssignmentScheduleRequests) {
    const o = r as Record<string, unknown>;
    const principal = acct(o.principalId as string);
    const days = Math.round((anchorMs - Date.parse(o.createdDateTime as string)) / DAY);
    fixedAudits.push([days * 1440, 'RoleManagement', 'Add member to role completed (PIM activation)', principal, { id: o.roleDefinitionId as string, displayName: ctx.pim.eligible.find((e) => e.roleTemplateId === o.roleDefinitionId)?.role ?? 'Role', type: 'Role' }]);
  }
  fixedAudits.forEach(([ageMin, category, activity, initiator, target], i) => directoryAudits.push(dirAudit(i + 1, ageMin, category, activity, initiator, target)));
  const routine: Array<[string, string, (i: number) => { id: string; displayName: string; type: string; userPrincipalName?: string }]> = [
    ['UserManagement', 'Update user', (i) => userTarget(staff[(i * 5) % staff.length])],
    ['UserManagement', 'Reset user password', (i) => userTarget(staff[(i * 3 + 1) % staff.length])],
    ['GroupManagement', 'Add member to group', (i) => ({ id: ctx.groups[(i % (ctx.groups.length - 1)) + 1].seedId, displayName: ctx.groups[(i % (ctx.groups.length - 1)) + 1].name, type: 'Group' })],
    ['Device', 'Update device', (i) => ({ id: ctx.devices[(i * 7) % ctx.devices.length].entraId, displayName: ctx.devices[(i * 7) % ctx.devices.length].deviceName, type: 'Device' })],
    ['Policy', 'Update conditional access policy', (i) => ({ id: `caPolicy-${(i % 9) + 1}`, displayName: `caPolicy-${(i % 9) + 1}`, type: 'Policy' })],
    ['ApplicationManagement', 'Consent to application', () => ({ id: 'sp-1', displayName: 'sp-1', type: 'ServicePrincipal' })],
  ];
  for (let n = directoryAudits.length + 1, i = 0; n <= 120; n++, i++) {
    const [category, activity, target] = routine[i % routine.length];
    const ageMin = Math.floor((i * 89 * 1440) / (120 - fixedAudits.length)) + 45 + (i % 7) * 13;
    directoryAudits.push(dirAudit(n, ageMin, category, activity, actorAdmin(i), target(i)));
  }

  // --------------------------------------------------- unified audit log
  // 240 rows over 90 days across Exchange, SharePoint, Entra ID and Teams.
  const RECORD_TYPE_NUM: Record<string, number> = { ExchangeAdmin: 1, ExchangeItem: 2, SharePointFileOperation: 6, AzureActiveDirectory: 8, SharePointSharingOperation: 14, AzureActiveDirectoryStsLogon: 15, MicrosoftTeams: 25, ExchangeItemAggregated: 50 };
  const cuiSite = `https://${ctx.slug}.sharepoint.us/sites/cui-enclave`;
  const ualTemplates: Array<[string, string, string, (a: HistoryAccount, i: number) => Record<string, unknown>]> = [
    ['ExchangeItemAggregated', 'MailItemsAccessed', 'Exchange', (a, i) => ({ MailboxOwnerUPN: a.upn, OperationCount: 1 + (i % 9) })],
    ['SharePointFileOperation', 'FileAccessed', 'SharePoint', (_a, i) => ({ ObjectId: `${cuiSite}/Shared Documents/part-${pad(1000 + (i % 40), 4)}.pdf`, SiteUrl: cuiSite })],
    ['SharePointFileOperation', 'FileModified', 'SharePoint', (_a, i) => ({ ObjectId: `${cuiSite}/Shared Documents/router-${pad(200 + (i % 25), 4)}.docx`, SiteUrl: cuiSite })],
    ['MicrosoftTeams', 'MessageSent', 'MicrosoftTeams', (_a, i) => ({ TeamName: 'S1 CUI Program Team', ChannelName: i % 2 ? 'CUI-Programs' : 'CUI-Engineering-Drawings' })],
    ['AzureActiveDirectoryStsLogon', 'UserLoggedIn', 'AzureActiveDirectory', () => ({ ClientIP: OFFICE_IP, LogonError: null })],
    ['ExchangeItem', 'Send', 'Exchange', (_a, i) => ({ Item: { Subject: `Encrypted: PO ${pad(5000 + i, 5)} drawing package` } })],
    ['SharePointFileOperation', 'FileDownloaded', 'SharePoint', (_a, i) => ({ ObjectId: `${cuiSite}/Shared Documents/part-${pad(1000 + (i % 40), 4)}.pdf`, SiteUrl: cuiSite })],
    ['SharePointSharingOperation', 'SharingSet', 'SharePoint', () => ({ ObjectId: cuiSite, TargetUserOrGroupName: 'CUI-Authorized-Users' })],
    ['AzureActiveDirectoryStsLogon', 'UserLoginFailed', 'AzureActiveDirectory', () => ({ ClientIP: OFFICE_IP, LogonError: 'InvalidUserNameOrPassword' })],
    ['MicrosoftTeams', 'TeamsSessionStarted', 'MicrosoftTeams', () => ({})],
    ['ExchangeAdmin', 'Set-Mailbox', 'Exchange', (a) => ({ ObjectId: a.upn, Parameters: [{ Name: 'AuditEnabled', Value: 'True' }] })],
    ['AzureActiveDirectory', 'Update user.', 'AzureActiveDirectory', (a) => ({ ObjectId: a.upn })],
  ];
  const ualUsers = interactive;
  const unifiedAuditLog: StoreObject[] = [];
  for (let i = 0; i < 240; i++) {
    const [recordType, operation, workload, extra] = ualTemplates[i % ualTemplates.length];
    const adminOp = recordType === 'ExchangeAdmin' || operation === 'Update user.';
    const ageMin = Math.floor((i * 90 * 1440) / 240) + 17 + (i % 11) * 7;
    const day = Math.floor(ageMin / 1440);
    const pool = ualUsers.filter((a) => (adminOp ? a.kind === 'admin' : a.kind === 'staff') && activeOn(a, day));
    const a = pool[(i * 13) % pool.length];
    const target = adminOp ? staff[(i * 3) % staff.length] : a;
    const id = simGuid(0xa1, i + 1);
    const created = at(0, ageMin);
    unifiedAuditLog.push({
      id,
      CreationDate: created,
      RecordType: recordType,
      Operations: operation,
      UserIds: a.upn,
      AuditData: JSON.stringify({
        CreationTime: created.replace(/\.\d{3}Z$/, ''),
        Id: id,
        Operation: operation,
        OrganizationId: tenantId,
        RecordType: RECORD_TYPE_NUM[recordType],
        ResultStatus: operation === 'UserLoginFailed' ? 'Failed' : 'Succeeded',
        UserKey: a.seedId,
        UserType: a.kind === 'admin' ? 2 : 0,
        Version: 1,
        Workload: workload,
        UserId: a.upn,
        ...extra(target, i),
      }),
    });
  }

  // --------------------------------------------- data protection objects
  const dlpPolicies: StoreObject[] = ctx.dlpPolicies.map((name, i) => ({ id: `dlpPolicy-${i + 1}`, name, isEnabled: true }));
  const dlpCompliancePolicy: StoreObject[] = ctx.dlpPolicies.map((name, i) => ({
    id: name,
    Name: name,
    Mode: 'Enable',
    Enabled: true,
    Workload: ['SharePoint, OneDriveForBusiness', 'Exchange', 'Teams'][i % 3],
    Priority: i,
    WhenCreated: at(120 - i * 30),
    DistributionStatus: 'Success',
  }));
  // W5c1-b: the CUI label's protection, as Get-Label reports it. Encryption
  // grants co-author rights to the CUI enclave's members only (the enclave
  // group has no mailbox, so the rights name its members); content marking
  // is the CUI banner top and bottom with the designation line; the label
  // also scopes sites and groups (the enclave site carries it, below).
  const cuiGroup = ctx.groups.find((g) => /\bCUI\b/.test(g.name)) ?? ctx.groups[0];
  const cuiMembers = cuiGroup.memberSeedIds.map((s) => acct(s)).filter((a): a is HistoryAccount => a !== undefined);
  const CO_AUTHOR = 'VIEW,VIEWRIGHTSDATA,DOCEDIT,EDIT,PRINT,EXTRACT,REPLY,REPLYALL,FORWARD,OBJMODEL';
  const cuiLabelGuid = simGuid(0x1a, 1);
  const label: StoreObject[] = [
    {
      id: 'label-cui',
      Name: ctx.sensitivityLabel.name,
      DisplayName: ctx.sensitivityLabel.name,
      Comment: ctx.sensitivityLabel.description,
      Tooltip: ctx.sensitivityLabel.description,
      Guid: cuiLabelGuid,
      Priority: 1,
      Disabled: false,
      ContentType: 'File, Email, Site, UnifiedGroup',
      EncryptionEnabled: true,
      EncryptionProtectionType: 'Template',
      EncryptionEncryptOnly: false,
      EncryptionDoNotForward: false,
      EncryptionRightsDefinitions: cuiMembers.map((a) => `${a.upn}:${CO_AUTHOR}`).join(';'),
      EncryptionContentExpiredOnDateInDaysOrNever: 'Never',
      EncryptionOfflineAccessDays: 7,
      ApplyContentMarkingHeaderEnabled: true,
      ApplyContentMarkingHeaderText: ctx.sensitivityLabel.name,
      ApplyContentMarkingHeaderAlignment: 'Center',
      ApplyContentMarkingFooterEnabled: true,
      ApplyContentMarkingFooterText: `${ctx.sensitivityLabel.name} | Controlled by: ${ctx.organization.displayName}`,
      ApplyContentMarkingFooterAlignment: 'Center',
      ApplyWaterMarkingEnabled: false,
      SiteAndGroupProtectionEnabled: true,
      SiteAndGroupProtectionPrivacy: 'Private',
      SiteAndGroupProtectionAllowAccessToGuestUsers: false,
      SiteAndGroupProtectionAllowEmailFromGuestUsers: false,
      SiteExternalSharingControlType: 'Disabled',
      WhenCreated: at(400),
    },
  ];
  // The label policy that publishes the label to the enclave's members
  // (Get-LabelPolicy), labelling mandatory and CUI the default for them.
  const labelPolicy: StoreObject[] = [
    {
      id: `${ctx.sensitivityLabel.name} label policy - ${cuiGroup.name}`,
      Name: `${ctx.sensitivityLabel.name} label policy - ${cuiGroup.name}`,
      Guid: simGuid(0x1b, 1),
      Labels: [ctx.sensitivityLabel.name],
      ExchangeLocation: [cuiGroup.name],
      ModernGroupLocation: [],
      Enabled: true,
      Mode: 'Enforce',
      DistributionStatus: 'Success',
      Settings: ['[mandatory, true]', `[defaultlabelid, ${cuiLabelGuid}]`, '[requiredowngradejustification, true]'],
      WhenCreated: at(395),
    },
  ];
  // The CUI enclave's SharePoint site, labelled CUI (Get-SPOSite).
  const spoSites: StoreObject[] = [
    {
      id: 'spoSite-s1-cui-enclave',
      Url: cuiSite,
      // W5c2 follow-up 10: the Graph site id (host,siteCollectionId,webId) /v1.0/sites/{id} addresses.
      GraphSiteId: `${ctx.slug}.sharepoint.us,51510000-00bd-4000-8000-000000000001,51510000-00bd-4000-8000-000000000002`,
      Title: 'CUI Enclave',
      SensitivityLabel: cuiLabelGuid,
      SharingCapability: 'Disabled',
      ConditionalAccessPolicy: 'AllowLimitedAccess',
      LockState: 'Unlock',
      DenyAddAndCustomizePages: 'Enabled',
      DefaultLinkPermission: 'View',
      Owner: (admins[0] ?? staff[0]).upn,
    },
  ];
  // The same label on the Graph surfaces (one id, the label Guid):
  // /informationProtection/policy/labels (policyLabels) and
  // /informationProtection/sensitivityLabels (sensitivityLabels).
  const policyLabels: StoreObject[] = [
    { id: cuiLabelGuid, name: ctx.sensitivityLabel.name, description: ctx.sensitivityLabel.description, color: '#C00000', sensitivity: 1, tooltip: ctx.sensitivityLabel.description, isActive: true, parent: null },
  ];
  const sensitivityLabels: StoreObject[] = [
    { id: cuiLabelGuid, name: ctx.sensitivityLabel.name, displayName: ctx.sensitivityLabel.name, description: ctx.sensitivityLabel.description, toolTip: ctx.sensitivityLabel.description, color: '#C00000', sensitivity: 1, isActive: true, isAppliable: true, hasProtection: true, contentFormats: ['file', 'email', 'site', 'unifiedGroup'], parent: null },
  ];

  // ---------------------------------- W5c1: training, lifecycle, password
  // Attack simulation training user coverage (Graph
  // /reports/security/getAttackSimulationTrainingUserCoverage): every
  // licensed, enabled member completed the annual awareness course and the
  // insider-threat course; the joiner completed both 2 days after hire.
  const AWARENESS = 'S1 Security Awareness: Handling CUI (2026)';
  const INSIDER = 'S1 Insider Threat Awareness (2026)';
  const trainingUserCoverage: StoreObject[] = staff.filter(licensed).map((a) => {
    const n = idx(a);
    const done = a === joiner ? a.lifecycle!.days_before_anchor - 2 : 30 + ((n * 23) % 170);
    const course = (displayName: string, offset: number) => ({
      displayName,
      trainingStatus: 'completed',
      assignedDateTime: at(done + 14 + offset),
      completionDateTime: at(done + offset, (n * 7) % 300),
    });
    return {
      id: `s1h-training-${a.seedId}`,
      attackSimulationUser: { userId: a.seedId, displayName: a.displayName, email: a.upn },
      userTrainings: [course(AWARENESS, 0), course(INSIDER, a === joiner ? 0 : 1)],
    };
  });

  // Lifecycle workflows (Graph identityGovernance/lifecycleWorkflows/workflows
  // ?$expand=tasks). Joiner and mover run on schedule. The leaver workflow is
  // enabled but ON DEMAND (isSchedulingEnabled false): the administrator runs
  // it per HR ticket, which is how one leaver is still enabled 9 days after
  // leaving (customer.json lifecycle; the AO A-02 target).
  const lcwTask = (n: number, seq: number, displayName: string, category: string, taskDefinitionId: string) => ({
    id: simGuid(0x1c, n), displayName, description: displayName, category, continueOnError: false, executionSequence: seq, isEnabled: true, taskDefinitionId, arguments: [],
  });
  const lcw = (n: number, category: string, displayName: string, scheduled: boolean, trigger: Record<string, unknown>, tasks: unknown[]) => ({
    id: simGuid(0x1f, n),
    category,
    displayName,
    description: `${displayName} (fictional S1 workflow)`,
    isEnabled: true,
    isSchedulingEnabled: scheduled,
    version: 2,
    createdDateTime: at(330 - n * 10),
    lastModifiedDateTime: at(120 - n * 10),
    nextScheduleRunDateTime: scheduled ? ahead(0) : null,
    executionConditions: {
      '@odata.type': '#microsoft.graph.identityGovernance.triggerAndScopeBasedConditions',
      scope: { '@odata.type': '#microsoft.graph.identityGovernance.ruleBasedSubjectSet', rule: "(userType eq 'Member')" },
      trigger,
    },
    tasks,
  });
  const lifecycleWorkflows: StoreObject[] = [
    lcw(1, 'joiner', 'S1 Joiner - prepare new staff account', true,
      { '@odata.type': '#microsoft.graph.identityGovernance.timeBasedAttributeTrigger', timeBasedAttribute: 'employeeHireDate', offsetInDays: -1 },
      [lcwTask(1, 1, 'Generate Temporary Access Pass and send to manager', 'joiner', simGuid(0x1d, 1)), lcwTask(2, 2, 'Add user to groups', 'joiner,mover', simGuid(0x1d, 2))]),
    lcw(2, 'mover', 'S1 Mover - review group access on department change', true,
      { '@odata.type': '#microsoft.graph.identityGovernance.attributeChangeTrigger', triggerAttributes: [{ name: 'department' }] },
      [lcwTask(3, 1, 'Remove user from selected groups', 'leaver,mover', simGuid(0x1d, 3)), lcwTask(4, 2, 'Add user to groups', 'joiner,mover', simGuid(0x1d, 2))]),
    lcw(3, 'leaver', 'S1 Leaver - disable account and remove access', false,
      { '@odata.type': '#microsoft.graph.identityGovernance.timeBasedAttributeTrigger', timeBasedAttribute: 'employeeLeaveDateTime', offsetInDays: 0 },
      [lcwTask(5, 1, 'Disable user account', 'leaver', LCW_DISABLE_USER_TASK_ID), lcwTask(6, 2, 'Remove user from all groups', 'leaver', simGuid(0x1d, 4)), lcwTask(7, 3, 'Remove all licenses for user', 'leaver', simGuid(0x1d, 5))]),
  ];

  // Smart lockout and banned passwords (Get-MgDirectorySetting "Password
  // Rule Settings"; `values` as Graph returns them, all strings). The banned
  // words are invented.
  const directorySettings: StoreObject[] = [
    {
      id: simGuid(0x5e, 1),
      displayName: 'Password Rule Settings',
      templateId: PASSWORD_RULE_SETTINGS_TEMPLATE_ID,
      values: [
        { name: 'BannedPasswordCheckOnPremisesMode', value: 'Audit' },
        { name: 'EnableBannedPasswordCheckOnPremises', value: 'False' },
        { name: 'EnableBannedPasswordCheck', value: 'True' },
        { name: 'LockoutDurationInSeconds', value: '300' },
        { name: 'LockoutThreshold', value: '5' },
        { name: 'BannedPasswordList', value: 'fennick\tspindlework\tmachshop\tcuiprime' },
      ],
    },
  ];
  // Tenant domains: passwords never expire (Secure Score PWAgePolicyNew).
  const domains: StoreObject[] = simVerifiedDomains(ctx.slug).map((d) => ({
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
  // Intune compliance settings on the 2 generator policies (Windows), plus
  // the iOS policy the 6 iPhones are evaluated against.
  // W5c1-b: S1's own policies replace the profile's 2 generic ones (the
  // scenario zeroes deviceCompliancePolicies; same ids), so they carry S1's
  // names. passwordExpirationDays is null (not configured): S1 passwords
  // never expire (the domains below; Secure Score PWAgePolicyNew).
  const windowsCompliance = (name: string, n: number) => ({
    id: `deviceCompliancePolicy-${n}`,
    '@odata.type': '#microsoft.graph.windows10CompliancePolicy',
    displayName: name,
    platformType: 'windows10',
    description: name,
    createdDateTime: at(400 - n * 20),
    lastModifiedDateTime: at(90 - n * 20),
    passwordRequired: true,
    passwordBlockSimple: true,
    passwordMinimumLength: 14,
    passwordRequiredType: 'alphanumeric',
    passwordMinutesOfInactivityBeforeLock: 15,
    passwordPreviousPasswordBlockCount: 24,
    passwordExpirationDays: null,
    osMinimumVersion: '10.0.22631',
    bitLockerEnabled: true,
    secureBootEnabled: true,
    codeIntegrityEnabled: true,
    storageRequireEncryption: true,
    tpmRequired: true,
    defenderEnabled: true,
    rtpEnabled: true,
    antivirusRequired: true,
    antiSpywareRequired: true,
    deviceThreatProtectionEnabled: true,
    deviceThreatProtectionRequiredSecurityLevel: 'medium',
    scheduledActionsForRule: [{ ruleName: 'PasswordRequired', scheduledActionConfigurations: [{ actionType: 'block', gracePeriodHours: 24 }] }],
    // W5c2 follow-up 7: assigned to the CUI enclave group.
    assignments: groupAssignments(`deviceCompliancePolicy-${n}`, CUI_ENCLAVE_GROUP),
  });
  const deviceCompliancePolicies: StoreObject[] = [
    windowsCompliance('S1 Windows 11 staff and kiosk compliance', 1),
    windowsCompliance('S1 Windows 11 programming workstation compliance', 2),
    // W5c2 follow-up 6 (SIM-B6): the Defender for Endpoint device-risk
    // policy (machine risk at most medium), with the Windows settings of the
    // other two so no compliance-policy verdict changes.
    windowsCompliance('S1 Windows 11 Defender for Endpoint risk compliance', 3),
    {
      id: 'deviceCompliancePolicy-s1-ios',
      '@odata.type': '#microsoft.graph.iosCompliancePolicy',
      displayName: 'S1 iOS compliance',
      platformType: 'iOS',
      createdDateTime: at(380),
      lastModifiedDateTime: at(60),
      passcodeRequired: true,
      passcodeBlockSimple: true,
      passcodeMinimumLength: 6,
      passcodeMinutesOfInactivityBeforeLock: 5,
      osMinimumVersion: '17.0',
      securityBlockJailbrokenDevices: true,
      managedEmailProfileRequired: false,
      assignments: groupAssignments('deviceCompliancePolicy-s1-ios', CUI_ENCLAVE_GROUP),
    },
  ];

  // ------------------------------- W5c1-b: authentication methods policy
  // The per-method settings (Graph authenticationMethodConfigurations; the
  // policy read embeds them at read time, ResolverTable). The ids are the
  // Graph ids, which are also Stamper's PATCH targets. Consistent with
  // CA02 (phishing-resistant strength for admin roles): FIDO2 is enabled,
  // attested and restricted to the one key model the admin and break-glass
  // accounts registered; Microsoft Authenticator (push with number matching
  // and app and location context) and software OATH serve staff; the
  // one-time Temporary Access Pass serves the joiner workflow's first
  // sign-in; SMS, voice and email OTP are off.
  const ALL_USERS = { targetType: 'group', id: 'all_users', isRegistrationRequired: false };
  const allUsersOn = { state: 'enabled', includeTarget: { targetType: 'group', id: 'all_users' } };
  const authenticationMethodsPolicyConfigurations: StoreObject[] = [
    {
      id: 'Fido2',
      '@odata.type': '#microsoft.graph.fido2AuthenticationMethodConfiguration',
      state: 'enabled',
      isSelfServiceRegistrationAllowed: true,
      isAttestationEnforced: true,
      keyRestrictions: { isEnforced: true, enforcementType: 'allow', aaGuids: [simGuid(0xfd, 1)] },
      includeTargets: [ALL_USERS],
      excludeTargets: [],
    },
    {
      id: 'MicrosoftAuthenticator',
      '@odata.type': '#microsoft.graph.microsoftAuthenticatorAuthenticationMethodConfiguration',
      state: 'enabled',
      isSoftwareOathEnabled: false,
      featureSettings: {
        numberMatchingRequiredState: allUsersOn,
        displayAppInformationRequiredState: allUsersOn,
        displayLocationInformationRequiredState: allUsersOn,
      },
      includeTargets: [{ ...ALL_USERS, authenticationMode: 'push' }],
      excludeTargets: [],
    },
    {
      id: 'TemporaryAccessPass',
      '@odata.type': '#microsoft.graph.temporaryAccessPassAuthenticationMethodConfiguration',
      state: 'enabled',
      isUsableOnce: true,
      defaultLifetimeInMinutes: 60,
      minimumLifetimeInMinutes: 60,
      maximumLifetimeInMinutes: 480,
      defaultLength: 8,
      includeTargets: [ALL_USERS],
      excludeTargets: [],
    },
    { id: 'SoftwareOath', '@odata.type': '#microsoft.graph.softwareOathAuthenticationMethodConfiguration', state: 'enabled', includeTargets: [ALL_USERS], excludeTargets: [] },
    { id: 'Sms', '@odata.type': '#microsoft.graph.smsAuthenticationMethodConfiguration', state: 'disabled', includeTargets: [], excludeTargets: [] },
    { id: 'Voice', '@odata.type': '#microsoft.graph.voiceAuthenticationMethodConfiguration', state: 'disabled', isOfficePhoneAllowed: false, includeTargets: [], excludeTargets: [] },
    { id: 'Email', '@odata.type': '#microsoft.graph.emailAuthenticationMethodConfiguration', state: 'disabled', allowExternalIdToUseEmailOtp: 'disabled', includeTargets: [], excludeTargets: [] },
    { id: 'x509Certificate', '@odata.type': '#microsoft.graph.x509CertificateAuthenticationMethodConfiguration', state: 'disabled', includeTargets: [], excludeTargets: [] },
  ];
  const authMethodsPolicyEnrich = {
    description: 'The tenant-wide policy that controls the authentication methods users can register and use',
    lastModifiedDateTime: at(140),
    policyMigrationState: 'migrationComplete',
    reconfirmationInDays: 180,
    registrationEnforcement: {
      authenticationMethodsRegistrationCampaign: { snoozeDurationInDays: 1, state: 'enabled', excludeTargets: [], includeTargets: [{ id: 'all_users', targetType: 'group', targetedAuthenticationMethod: 'microsoftAuthenticator' }] },
    },
  };

  // ------------------------------------ W5c1-b: cross-tenant access default
  // customer.json names no partner organisation, so S1's default is
  // deny-all: B2B collaboration and B2B direct connect are blocked inbound
  // and outbound for all users and applications, and no external MFA or
  // device claim is trusted. (No partner configurations are seeded.)
  const blockedAll = {
    usersAndGroups: { accessType: 'blocked', targets: [{ target: 'AllUsers', targetType: 'user' }] },
    applications: { accessType: 'blocked', targets: [{ target: 'AllApplications', targetType: 'application' }] },
  };
  const crossTenantDefaultEnrich = {
    isServiceDefault: false,
    b2bCollaborationInbound: blockedAll,
    b2bCollaborationOutbound: blockedAll,
    b2bDirectConnectInbound: blockedAll,
    b2bDirectConnectOutbound: blockedAll,
    inboundTrust: { isMfaAccepted: false, isCompliantDeviceAccepted: false, isHybridAzureADJoinedDeviceAccepted: false },
    automaticUserConsentSettings: { inboundAllowed: false, outboundAllowed: false },
    invitationRedemptionIdentityProviderConfiguration: { primaryIdentityProviderPrecedenceOrder: ['azureActiveDirectory', 'externalFederation'], fallbackIdentityProvider: 'defaultConfiguredIdp' },
  };

  // ----------------------- W5c1-b: settings catalog and iOS app protection
  // A settings-catalog policy (/deviceManagement/configurationPolicies) for
  // the Windows credential UI: the password reveal button is disabled and
  // administrator accounts are not enumerated on elevation. Settings are
  // inline, as `$expand=settings` returns them.
  const choice = (n: number, def: string, value: string) => ({
    id: String(n),
    settingInstance: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: def, choiceSettingValue: { value: `${def}_${value}`, children: [] } },
  });
  const deviceManagementConfigurationPolicies: StoreObject[] = [
    {
      id: simGuid(0xc5, 1),
      name: 'S1 Windows 11 credential UI',
      description: 'S1: obscure authentication feedback (no password reveal) and no administrator enumeration',
      platforms: 'windows10',
      technologies: 'mdm',
      isAssigned: true,
      settingCount: 2,
      roleScopeTagIds: ['0'],
      createdDateTime: at(320),
      lastModifiedDateTime: at(120),
      settings: [
        choice(0, 'device_vendor_msft_policy_config_credentialsui_disablepasswordreveal', '1'),
        choice(1, 'device_vendor_msft_policy_config_credentialsui_enumerateadministrators', '0'),
      ],
      assignments: groupAssignments(simGuid(0xc5, 1), CUI_ENCLAVE_GROUP),
    },
    // W5c2 follow-up 10 (SIM-W4c5): Windows time service, NTP client on the
    // enclave devices (AU.L2-3.3.7 time synchronisation).
    {
      id: simGuid(0xc5, 2),
      name: 'S1 Windows time synchronisation (NTP)',
      description: 'S1: Windows Time service syncs every device to the authoritative NTP source (time.windows.com), polled hourly',
      platforms: 'windows10',
      technologies: 'mdm',
      isAssigned: true,
      settingCount: 2,
      roleScopeTagIds: ['0'],
      createdDateTime: at(310),
      lastModifiedDateTime: at(110),
      settings: [
        choice(0, 'device_vendor_msft_policy_config_admx_w32time_w32time_policy_enable_ntpclient', '1'),
        {
          id: '1',
          settingInstance: {
            '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance',
            settingDefinitionId: 'device_vendor_msft_policy_config_admx_w32time_w32time_policy_configure_ntpclient',
            choiceSettingValue: {
              value: 'device_vendor_msft_policy_config_admx_w32time_w32time_policy_configure_ntpclient_1',
              children: [
                { '@odata.type': '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance', settingDefinitionId: 'device_vendor_msft_policy_config_admx_w32time_w32time_policy_configure_ntpclient_w32time_ntpclient_ntpserver', simpleSettingValue: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationStringSettingValue', value: 'time.windows.com,0x9' } },
                { '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance', settingDefinitionId: 'device_vendor_msft_policy_config_admx_w32time_w32time_policy_configure_ntpclient_w32time_ntpclient_type', choiceSettingValue: { value: 'device_vendor_msft_policy_config_admx_w32time_w32time_policy_configure_ntpclient_w32time_ntpclient_type_ntp', children: [] } },
                { '@odata.type': '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance', settingDefinitionId: 'device_vendor_msft_policy_config_admx_w32time_w32time_policy_configure_ntpclient_w32time_ntpclient_specialpollinterval', simpleSettingValue: { '@odata.type': '#microsoft.graph.deviceManagementConfigurationIntegerSettingValue', value: 3600 } },
              ],
            },
          },
        },
      ],
      assignments: groupAssignments(simGuid(0xc5, 2), CUI_ENCLAVE_GROUP),
    },
  ];
  // iOS app protection for the 6 company iPhones: app data encrypted when
  // the device is locked, a compliant device required, backup and Save As
  // blocked, data kept in the tenant's OneDrive and SharePoint.
  const iosManagedAppProtections: StoreObject[] = [
    {
      id: simGuid(0xc6, 1),
      '@odata.type': '#microsoft.graph.iosManagedAppProtection',
      displayName: 'S1 iOS CUI app protection',
      description: 'S1: protects CUI in Outlook, Teams, OneDrive and SharePoint on company iPhones',
      isAssigned: true,
      assignments: groupAssignments(simGuid(0xc6, 1), CUI_ENCLAVE_GROUP),
      appGroupType: 'allCoreMicrosoftApps',
      appDataEncryptionType: 'whenDeviceLocked',
      deviceComplianceRequired: true,
      dataBackupBlocked: true,
      saveAsBlocked: true,
      allowedDataStorageLocations: ['oneDriveForBusiness', 'sharePoint'],
      allowedInboundDataTransferSources: 'managedApps',
      allowedOutboundDataTransferDestinations: 'managedApps',
      allowedOutboundClipboardSharingLevel: 'managedAppsWithPasteIn',
      pinRequired: true,
      minimumPinLength: 6,
      periodOfflineBeforeAccessCheck: 'PT12H',
      periodOfflineBeforeWipeIsEnforced: 'P30D',
      minimumRequiredOsVersion: '17.0',
      createdDateTime: at(370),
      lastModifiedDateTime: at(60),
    },
  ];
  // PH-12 P12-AO (2026-11-01): the Android twin of the iOS policy. S1 issues iPhones only; this
  // policy is the guardrail for an Android phone a CUI user signs in with (MAM without
  // enrollment): app data encrypted, compliant device, backup, Save As and screen capture blocked,
  // the same PIN and offline rules. AO B-08 (CUI app allow/block list) and B-09 (BYOD
  // separation) act on it; EO reads iOS app protection only, and Stamper names only its own
  // CMMC-* policies, so no status reads this one. S3 drops it (no app protection at all); S2
  // replaces it with its own (customerHistoryS2.ts).
  const androidManagedAppProtections: StoreObject[] = [
    {
      id: simGuid(0xc6, 2),
      '@odata.type': '#microsoft.graph.androidManagedAppProtection',
      displayName: 'S1 Android CUI app protection',
      description: 'S1: protects CUI in Outlook, Teams, OneDrive and SharePoint on any Android phone (no company Android devices are issued)',
      isAssigned: true,
      assignments: groupAssignments(simGuid(0xc6, 2), CUI_ENCLAVE_GROUP),
      appGroupType: 'allCoreMicrosoftApps',
      encryptAppData: true,
      deviceComplianceRequired: true,
      dataBackupBlocked: true,
      saveAsBlocked: true,
      screenCaptureBlocked: true,
      allowedDataStorageLocations: ['oneDriveForBusiness', 'sharePoint'],
      allowedInboundDataTransferSources: 'managedApps',
      allowedOutboundDataTransferDestinations: 'managedApps',
      allowedOutboundClipboardSharingLevel: 'managedAppsWithPasteIn',
      pinRequired: true,
      minimumPinLength: 6,
      periodOfflineBeforeAccessCheck: 'PT12H',
      periodOfflineBeforeWipeIsEnforced: 'P30D',
      minimumRequiredOsVersion: '13.0',
      createdDateTime: at(370),
      lastModifiedDateTime: at(60),
    },
  ];

  // ------------------------------- W5c2 follow-up 6: discovery coverage
  // SIM-A2: named locations (CA06 excludes the US country location).
  const namedLocations: StoreObject[] = (ctx.namedLocations ?? []).map((l, i) =>
    l.kind === 'country'
      ? { id: l.seedId, '@odata.type': '#microsoft.graph.countryNamedLocation', displayName: l.name, countriesAndRegions: l.countries ?? [], includeUnknownCountriesAndRegions: false, countryLookupMethod: 'clientIpAddress', createdDateTime: at(500 - i * 10), modifiedDateTime: at(200) }
      : { id: l.seedId, '@odata.type': '#microsoft.graph.ipNamedLocation', displayName: l.name, isTrusted: true, ipRanges: (l.cidrs ?? []).map((c) => ({ '@odata.type': '#microsoft.graph.iPv4CidrRange', cidrAddress: c })), createdDateTime: at(500 - i * 10), modifiedDateTime: at(200) },
  );

  // SIM-B1: directory roles (one per role S1 assigns or makes eligible) and
  // their ACTIVE members (the break-glass Global Administrators; every
  // other admin role is PIM-eligible only, so it has no standing member).
  const directoryRole: StoreObject[] = roleManagementDirectoryRoleDefinition.map((d, i) => ({
    id: simGuid(0xb3, i + 1),
    displayName: (d as Record<string, unknown>).displayName,
    description: (d as Record<string, unknown>).description,
    roleTemplateId: d.id,
  }));
  const directoryRoleMember: StoreObject[] = [];
  for (const ra of roleAssignments) {
    const r = ra as Record<string, unknown>;
    const role = directoryRole.find((x) => (x as Record<string, unknown>).roleTemplateId === r.roleDefinitionId);
    if (!role) continue;
    const who = acct(String(r.principalId));
    directoryRoleMember.push({ id: `${role.id}|${who.seedId}`, directoryRoleId: role.id, memberId: who.seedId, '@odata.type': '#microsoft.graph.user', displayName: who.displayName, userPrincipalName: who.upn });
  }

  // SIM-B2 / B4 / B9: Intune device configurations. Subtype properties are
  // top-level (Graph REST) and in AdditionalProperties (the SDK's view,
  // which Stamper's `$_.AdditionalProperties.'@odata.type'` filters read).
  const deviceConfig = (n: number, odataType: string, displayName: string, description: string, fields: Record<string, unknown>): StoreObject => ({
    id: simGuid(0xb4, n),
    '@odata.type': odataType,
    displayName,
    description,
    version: 1,
    createdDateTime: at(420 - n * 30),
    lastModifiedDateTime: at(75 - n * 15),
    ...fields,
    AdditionalProperties: { '@odata.type': odataType, ...fields },
    // W5c2 follow-up 7: assigned to the CUI enclave group.
    assignments: groupAssignments(simGuid(0xb4, n), CUI_ENCLAVE_GROUP),
  });
  const deviceConfigurations: StoreObject[] = [
    // SIM-B2: corporate Wi-Fi, 802.1X (v1.0 wifiSecurityType has no WPA3 value; wpa2Enterprise is the enterprise mode).
    deviceConfig(1, '#microsoft.graph.windowsWifiConfiguration', 'S1-MACH-CORP Wi-Fi', 'Corporate wireless, WPA2/WPA3-Enterprise (802.1X), staff and programming workstations', {
      ssid: 'S1-MACH-CORP', networkName: 'S1-MACH-CORP', wifiSecurityType: 'wpa2Enterprise', connectAutomatically: true, connectWhenNetworkNameIsHidden: false, meteredConnectionLimit: 'unrestricted', proxySetting: 'none',
    }),
    // SIM-B4: Microsoft Defender Antivirus (scheduled full scan, real time, cloud block high, signatures every 4 h).
    deviceConfig(2, '#microsoft.graph.windows10GeneralConfiguration', 'S1-Defender-AV', 'Microsoft Defender Antivirus: weekly full scan, real-time protection, cloud-delivered protection', {
      defenderRequireRealTimeMonitoring: true, defenderRequireBehaviorMonitoring: true, defenderRequireCloudProtection: true, defenderCloudBlockLevel: 'high',
      defenderMonitorFileActivity: 'monitorAllFiles', defenderScanType: 'full', defenderSystemScanSchedule: 'saturday', defenderScheduledScanTime: '02:00:00.0000000',
      defenderScheduledQuickScanTime: '12:00:00.0000000', defenderSignatureUpdateIntervalInHours: 4, defenderScanArchiveFiles: true, defenderScanDownloads: true,
      defenderScanIncomingMail: true, defenderScanRemovableDrivesDuringFullScan: true, defenderPromptForSampleSubmission: 'sendSafeSamplesAutomatically', defenderDaysBeforeDeletingQuarantinedMalware: 30,
    }),
    // SIM-B9: removable storage blocked (the S1 answer S-27 "blocked").
    deviceConfig(3, '#microsoft.graph.windows10GeneralConfiguration', 'S1-Block-Removable-Storage', 'Device restriction: block removable storage and USB on all managed Windows devices', {
      storageBlockRemovableStorage: true, usbBlocked: true,
    }),
  ];

  // SIM-B5: Intune audit events (Get-MgDeviceManagementAuditEvent) for the
  // Intune changes S1's history already dates: each compliance policy's,
  // configuration's and the settings-catalog policy's last modification.
  const intuneActor = admins[0] ?? staff[0];
  const changed: Array<[string, string, string, string]> = [
    ...deviceCompliancePolicies.map((p) => [String((p as Record<string, unknown>).displayName), 'DeviceCompliancePolicy', String((p as Record<string, unknown>).lastModifiedDateTime), p.id] as [string, string, string, string]),
    ...deviceConfigurations.map((c) => [String((c as Record<string, unknown>).displayName), 'DeviceConfiguration', String((c as Record<string, unknown>).lastModifiedDateTime), c.id] as [string, string, string, string]),
  ].filter(([, , t]) => Date.parse(t) > anchorMs - 90 * DAY);
  const deviceManagementAuditEvent: StoreObject[] = changed.map(([name, type, t, resourceId], i) => ({
    id: simGuid(0xb5, i + 1),
    displayName: `Patch ${type}`,
    componentName: type === 'DeviceCompliancePolicy' ? 'DeviceCompliance' : 'DeviceConfiguration',
    activityDateTime: t,
    activityType: `Patch ${type}`,
    activityOperationType: 'Patch',
    activityResult: 'Success',
    category: 'Policy',
    correlationId: simGuid(0xb5, 0x100 + i + 1),
    actor: { type: 'ItPro', userPrincipalName: intuneActor.upn, userId: intuneActor.seedId, applicationDisplayName: 'Microsoft Intune portal extension', auditActorType: 'ItPro', ipAddress: OFFICE_IP },
    resources: [{ displayName: name, type, resourceId, auditResourceType: type }],
  }));
  // W5c2 follow-up 10 (SIM-W4c6): device sanitisation. Two devices taken out
  // of service in S1's hardware refresh: a staff workstation factory-reset
  // (wipe) before disposal and a company iPhone retired. Both left the
  // inventory afterwards (not in managedDevices).
  const remoteActions: Array<{ n: number; action: 'factoryReset' | 'retire'; device: string; os: string; owner: HistoryAccount; days: number }> = [
    { n: 1, action: 'factoryReset', device: 'S1-WS-RET-01', os: 'Windows', owner: staff[3] ?? staff[0], days: 40 },
    { n: 2, action: 'retire', device: 'S1-IOS-RET-01', os: 'iOS', owner: staff[9] ?? staff[0], days: 22 },
  ];
  const remoteActionAudits: StoreObject[] = remoteActions.map((r) => ({
    id: simGuid(0xb9, r.n),
    deviceDisplayName: r.device,
    userName: r.owner.displayName,
    initiatedByUserPrincipalName: intuneActor.upn,
    action: r.action,
    requestDateTime: at(r.days),
    deviceOwnerUserPrincipalName: r.owner.upn,
    deviceIMEI: r.os === 'iOS' ? `35${pad(r.n, 13)}` : '',
    actionState: 'done',
    managedDeviceId: simGuid(0xb9, 0x100 + r.n),
    deviceOperatingSystem: r.os,
  }));
  remoteActions.forEach((r, i) => {
    const type = r.action === 'factoryReset' ? 'Wipe ManagedDevice' : 'Retire ManagedDevice';
    deviceManagementAuditEvent.push({
      id: simGuid(0xb5, 0x50 + i + 1),
      displayName: type,
      componentName: 'DeviceManagement',
      activityDateTime: at(r.days),
      activityType: type,
      activityOperationType: 'Action',
      activityResult: 'Success',
      category: 'Device',
      correlationId: simGuid(0xb5, 0x150 + i + 1),
      actor: { type: 'ItPro', userPrincipalName: intuneActor.upn, userId: intuneActor.seedId, applicationDisplayName: 'Microsoft Intune portal extension', auditActorType: 'ItPro', ipAddress: OFFICE_IP },
      resources: [{ displayName: r.device, type: 'ManagedDevice', resourceId: simGuid(0xb9, 0x100 + r.n), auditResourceType: 'ManagedDevice' }],
    });
  });

  // SIM-W4c1: Defender for Endpoint protection state per Windows device,
  // consistent with S1-Defender-AV (full scan Saturday 02:00, quick scan
  // daily 12:00, signatures every 4 h, real time on) and with each
  // device's last check-in; the two noncompliant, unencrypted workstations
  // have not reported for 3+ days, so their signatures are overdue.
  // The full scan is the Saturday 02:00 before the device's own last
  // report (a device cannot report a scan it ran after it went quiet).
  const saturdayBefore = (ms: number) => {
    const d = new Date(ms);
    const back = (d.getUTCDay() + 1) % 7 || 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back, 2, 0, 0);
  };
  const sigVersion = (k: number) => `1.421.${pad(1200 + k, 4)}.0`;
  const windowsProtectionStates: StoreObject[] = ctx.devices
    .map((d, i) => ({ d, n: i + 1 }))
    .filter(({ d }) => d.os === 'Windows')
    .map(({ d, n }) => {
      const lastSyncMin = d.compliant ? (n * 37) % 1200 : 3 * 1440 + ((n * 37) % 600);
      const reported = anchorMs - lastSyncMin * MIN;
      const stale = !d.encrypted;
      const quick = Date.UTC(new Date(reported).getUTCFullYear(), new Date(reported).getUTCMonth(), new Date(reported).getUTCDate() - (new Date(reported).getUTCHours() < 12 ? 1 : 0), 12, 0, 0);
      return {
        id: d.seedId,
        managedDeviceId: d.seedId,
        deviceName: d.deviceName,
        malwareProtectionEnabled: true,
        deviceState: 'clean',
        realTimeProtectionEnabled: true,
        networkInspectionSystemEnabled: true,
        tamperProtectionEnabled: true,
        quickScanOverdue: stale,
        fullScanOverdue: stale,
        signatureUpdateOverdue: stale,
        rebootRequired: false,
        fullScanRequired: false,
        isVirtualMachine: false,
        productStatus: stale ? 'asSignaturesOutOfDate' : 'noStatus',
        engineVersion: '1.1.24090.11',
        antiMalwareVersion: '4.18.24090.11',
        signatureVersion: sigVersion(stale ? 0 : 6),
        signatureUpdateDateTime: new Date(reported - ((n * 53) % 240) * MIN).toISOString(),
        lastQuickScanDateTime: new Date(Math.min(quick, reported)).toISOString(),
        lastQuickScanSignatureVersion: sigVersion(stale ? 0 : 5),
        lastFullScanDateTime: new Date(saturdayBefore(reported)).toISOString(),
        lastFullScanSignatureVersion: sigVersion(stale ? 0 : 3),
        lastReportedDateTime: new Date(reported).toISOString(),
      };
    });
  // The one malware detection in S1's history (alert 4, a potentially
  // unwanted application on a staff workstation, 63 days ago, quarantined).
  const puaDevice = windows[5] ?? windows[0];
  const windowsMalwareInformation: StoreObject[] = [
    { id: simGuid(0xba, 1), displayName: 'PUA:Win32/SimBundler.FICTIONAL', additionalInformationUrl: null, severity: 'low', category: 'potentiallyUnwantedSoftware', lastDetectionDateTime: at(63) },
  ];
  const deviceMalwareStates: StoreObject[] = [
    { id: `${simGuid(0xba, 1)}|${puaDevice.seedId}`, malwareId: simGuid(0xba, 1), deviceName: puaDevice.deviceName, managedDeviceId: puaDevice.seedId, executionState: 'notRunning', threatState: 'quarantined', initialDetectionDateTime: at(63), lastStateChangeDateTime: at(62), detectionCount: 1 },
  ];

  // SIM-W4c2: terms-of-use acceptances of the "CUI System Access Notice"
  // (touAgreement-1, the notice the sign-in banner points to) by every
  // person and admin account; a joiner accepted on their hire day.
  const touId = 'touAgreement-1';
  const touAgreementEnrich = {
    [touId]: {
      createdDateTime: at(400),
      isPerDeviceAcceptanceRequired: false,
      userReacceptRequiredFrequency: 'P365D',
      termsExpiration: null,
      files: [{ id: simGuid(0xbb, 1), fileName: 'S1-CUI-System-Access-Notice.pdf', language: 'en-US', isDefault: true, displayName: 'CUI System Access Notice' }],
    },
  };
  const touAgreementAcceptances: StoreObject[] = accounts
    .filter((a) => a.kind === 'staff' || a.kind === 'admin')
    .map((a) => {
      const days = a.lifecycle?.event === 'joiner' ? a.lifecycle.days_before_anchor : 330 - (idx(a) % 60);
      return {
        id: `${touId}_${a.seedId}`,
        agreementId: touId,
        agreementFileId: simGuid(0xbb, 1),
        userId: a.seedId,
        userDisplayName: a.displayName,
        userPrincipalName: a.upn,
        userEmail: a.upn,
        state: 'accepted',
        recordedDateTime: at(days),
        expirationDateTime: ahead(365 - days),
        deviceId: null,
        deviceDisplayName: null,
        deviceOSType: null,
        deviceOSVersion: null,
      };
    });

  // SIM-W4c3: the quarterly access review of privileged directory roles,
  // last completed instance with one decision per privileged assignment
  // (PIM eligibilities and the standing break-glass Global Administrators).
  // The ISSM reviews; the ISSO reviews the ISSM's own admin account.
  const issmPerson = accounts.find((a) => a.roles?.includes('issm') && a.kind === 'staff');
  const issoPerson = accounts.find((a) => a.roles?.includes('isso') && a.kind === 'staff');
  const reviewer = issmPerson ?? admins[0] ?? staff[0];
  const reviewDefId = simGuid(0xbc, 1);
  const reviewInstId = simGuid(0xbc, 2);
  const roleName = (t: string) => String((roleManagementDirectoryRoleDefinition.find((r) => r.id === t) as Record<string, unknown> | undefined)?.displayName ?? t);
  const identityOf = (a: HistoryAccount) => ({ id: a.seedId, displayName: a.displayName, userPrincipalName: a.upn });
  const accessReviewDefinitions: StoreObject[] = [
    {
      id: reviewDefId,
      displayName: 'S1 Quarterly privileged role review',
      descriptionForAdmins: 'Quarterly review of every Entra privileged role assignment and PIM eligibility (CMMC AC.L1-3.1.1 account review).',
      descriptionForReviewers: 'Confirm each person still needs the role for their duties; deny anything not required.',
      status: 'InProgress',
      createdDateTime: at(320),
      lastModifiedDateTime: at(45),
      createdBy: identityOf(reviewer),
      scope: { '@odata.type': '#microsoft.graph.principalResourceMembershipsScope', principalScopes: [{ '@odata.type': '#microsoft.graph.accessReviewQueryScope', query: '/users', queryType: 'MicrosoftGraph' }], resourceScopes: [{ '@odata.type': '#microsoft.graph.accessReviewQueryScope', query: '/roleManagement/directory/roleDefinitions', queryType: 'MicrosoftGraph' }] },
      reviewers: [{ query: `/users/${reviewer.seedId}`, queryType: 'MicrosoftGraph', queryRoot: null }],
      fallbackReviewers: issoPerson ? [{ query: `/users/${issoPerson.seedId}`, queryType: 'MicrosoftGraph', queryRoot: null }] : [],
      settings: {
        mailNotificationsEnabled: true, reminderNotificationsEnabled: true, justificationRequiredOnApproval: true, defaultDecisionEnabled: false, defaultDecision: 'None',
        instanceDurationInDays: 14, autoApplyDecisionsEnabled: true, recommendationsEnabled: true,
        recurrence: { pattern: { type: 'absoluteMonthly', interval: 3, dayOfMonth: 0 }, range: { type: 'noEnd', startDate: at(320).slice(0, 10), endDate: '9999-12-31' } },
      },
    },
  ];
  const accessReviewInstances: StoreObject[] = [
    { id: reviewInstId, definitionId: reviewDefId, startDateTime: at(45), endDateTime: at(31), status: 'Completed', scope: (accessReviewDefinitions[0] as Record<string, unknown>).scope, reviewers: (accessReviewDefinitions[0] as Record<string, unknown>).reviewers },
  ];
  const reviewed: Array<{ who: HistoryAccount; role: string; kind: string }> = [
    ...roleEligibilitySchedules.map((e) => { const o = e as Record<string, unknown>; return { who: acct(String(o.principalId)), role: String(o.roleDefinitionId), kind: 'eligible' }; }),
    ...roleAssignments.map((e) => { const o = e as Record<string, unknown>; return { who: acct(String(o.principalId)), role: String(o.roleDefinitionId), kind: 'active' }; }),
  ];
  const accessReviewDecisions: StoreObject[] = reviewed.map((r, i) => {
    const byIsso = issmPerson !== undefined && r.who.ownerSeedId === issmPerson.seedId && issoPerson !== undefined;
    const by = byIsso ? issoPerson! : reviewer;
    return {
      id: simGuid(0xbc, 0x100 + i + 1),
      definitionId: reviewDefId,
      instanceId: reviewInstId,
      accessReviewId: reviewInstId,
      decision: 'Approve',
      recommendation: r.who.kind === 'break_glass' ? 'NotAvailable' : 'Approve',
      justification: r.who.kind === 'break_glass' ? 'Emergency access account, excluded from CA by design; sign-ins monitored' : `${roleName(r.role)} still required for ${r.who.jobTitle}`,
      reviewedBy: identityOf(by),
      reviewedDateTime: at(38, i * 17),
      appliedBy: identityOf(by),
      appliedDateTime: at(31),
      applyResult: 'AppliedSuccessfully',
      principal: { '@odata.type': '#microsoft.graph.userIdentity', ...identityOf(r.who) },
      resource: { '@odata.type': '#microsoft.graph.accessReviewInstanceDecisionItemAzureRoleResource', id: r.role, displayName: roleName(r.role), type: r.kind === 'eligible' ? 'eligibleRoleAssignment' : 'activeRoleAssignment' },
    };
  });

  // SIM-W4c4: Purview alert policies (Get-ProtectionAlert): the built-in
  // policies S1 keeps on, plus S1's own alert when audit logging is turned
  // off (AU.L2-3.3.4, alert on audit logging failure).
  // The security mailbox S1's answers name (TCP.MU.007, Muster's securityEmail / cisoEmail).
  const secOpsMail = `security@${ctx.domain}`;
  const alertPolicy = (name: string, category: string, severity: string, isSystem: boolean, comment: string, extra: Record<string, unknown> = {}) => ({
    id: name, Identity: name, Name: name, Category: category, Severity: severity, IsSystemRule: isSystem, Disabled: false,
    NotifyUser: [secOpsMail], NotificationEnabled: true, AggregationType: 'None', Comment: comment, ...extra,
  });
  const protectionAlert: StoreObject[] = [
    alertPolicy('Elevation of Exchange admin privilege', 'AccessGovernance', 'Low', true, 'Generates an alert when someone is assigned administrative permissions in Exchange Online.'),
    alertPolicy('Suspicious email sending patterns detected', 'ThreatManagement', 'Medium', true, 'Generates an alert when someone in the organization has sent suspicious email.'),
    alertPolicy('Email messages containing malicious URL removed after delivery', 'ThreatManagement', 'Informational', true, 'Generates an alert when messages containing a malicious URL are removed after delivery.'),
    alertPolicy('Messages have been delayed', 'MailFlow', 'High', true, 'Generates an alert when a large number of messages are delayed.'),
    alertPolicy('S1 Audit logging turned off or changed', 'Others', 'High', false, 'S1: alert the ISSO when unified audit log ingestion or admin audit logging is disabled or changed (audit logging failure).', {
      Operation: ['Set-AdminAuditLogConfig'], ThreatType: 'Activity', Filter: "Mailbox.Parameters -like '*UnifiedAuditLogIngestionEnabled*'", CreatedBy: intuneActor.upn, LastModifiedTime: at(150),
    }),
  ];

  // SIM-W4c7: app permissions on the CUI enclave site (Sites.Selected): the
  // drawing-sync service may write; nothing else is granted. The enclave is
  // not public: sharing is disabled and only the CUI group's members post.
  const enclaveGraphSiteId = `${ctx.slug}.sharepoint.us,${simGuid(0xbd, 1)},${simGuid(0xbd, 2)}`;
  const sitePermissions: StoreObject[] = [
    { id: simGuid(0xbd, 0x10), siteId: enclaveGraphSiteId, roles: ['write'], grantedToIdentitiesV2: [{ application: { id: simGuid(0xbd, 0x20), displayName: 'S1 Drawing Sync (FICTIONAL)' } }], grantedToIdentities: [{ application: { id: simGuid(0xbd, 0x20), displayName: 'S1 Drawing Sync (FICTIONAL)' } }] },
  ];

  // SIM-B3: the company branding (default locale id '0') with S1's sign-in notice.
  const organizationBranding: StoreObject[] = [
    {
      id: '0',
      signInPageText: `Authorized use only. This system belongs to ${ctx.organization.displayName} and processes Controlled Unclassified Information (CUI). Use is monitored and recorded; by signing in you consent to monitoring. Unauthorized use may result in disciplinary action and civil or criminal penalties.`,
      usernameHintText: `user@${ctx.domain}`,
      backgroundColor: '#1F2A36',
      customAccountResetCredentialsUrl: null,
      customPrivacyAndCookiesText: null,
      customTermsOfUseText: 'CUI handling rules',
      loginPageTextVisibilitySettings: { hideCannotAccessYourAccount: false, hideForgotMyPassword: false, hideResetItNow: false, hideTermsOfUse: false },
    },
  ];

  // SIM-B7: Safe Links (S1's own names; Stamper's CMMC-* gets stay misses)
  // and the Microsoft 365 message center.
  const safeLinksPolicyName = 'S1 Safe Links - all users';
  const safeLinksPolicy: StoreObject[] = [
    {
      id: safeLinksPolicyName, Identity: safeLinksPolicyName, Name: safeLinksPolicyName, IsDefault: false,
      EnableSafeLinksForEmail: true, EnableSafeLinksForTeams: true, EnableSafeLinksForOffice: true, ScanUrls: true, EnableForInternalSenders: true,
      DeliverMessageAfterScan: true, DisableUrlRewrite: false, TrackClicks: true, AllowClickThrough: false, EnableOrganizationBranding: false,
      WhenCreated: at(380), WhenChanged: at(120),
    },
  ];
  const safeLinksRule: StoreObject[] = [
    { id: 'S1 Safe Links rule', Identity: 'S1 Safe Links rule', Name: 'S1 Safe Links rule', SafeLinksPolicy: safeLinksPolicyName, RecipientDomainIs: [ctx.domain], State: 'Enabled', Priority: 0, WhenCreated: at(380), WhenChanged: at(120) },
  ];
  const message = (n: number, ageDays: number, title: string, severity: string, category: string, services: string[], isMajorChange: boolean) => ({
    id: `MC${900100 + n}`,
    title,
    severity,
    category,
    services,
    isMajorChange,
    startDateTime: at(ageDays),
    endDateTime: ahead(60),
    lastModifiedDateTime: at(Math.max(ageDays - 2, 0)),
    actionRequiredByDateTime: severity === 'high' ? ahead(30) : null,
    tags: isMajorChange ? ['Admin impact'] : ['Updated message'],
  });
  const messages: StoreObject[] = [
    message(1, 3, 'Microsoft Defender for Office 365: Safe Links URL detonation update', 'normal', 'stayInformed', ['Microsoft Defender XDR'], false),
    message(2, 9, 'Action required: retire legacy authentication protocols for Exchange Online (GCC High)', 'high', 'planForChange', ['Exchange Online'], true),
    message(3, 16, 'Microsoft Intune: Windows security baseline version update', 'normal', 'planForChange', ['Microsoft Intune'], false),
    message(4, 27, 'Microsoft Purview: sensitivity label encryption change for co-authoring', 'high', 'preventOrFixIssue', ['Microsoft Purview'], false),
  ];

  // SIM-B8: Purview insider risk, the departing-users data theft policy.
  const insiderRiskPolicy: StoreObject[] = [
    { id: 'S1 Departing users - data theft', Identity: 'S1 Departing users - data theft', Name: 'S1 Departing users - data theft', Guid: simGuid(0xb7, 1), InsiderRiskScenario: 'IntellectualPropertyTheft', Enabled: true, IsEnabled: true, CreatedBy: (admins[0] ?? staff[0]).upn, CreatedDate: at(240), WhenChanged: at(60) },
  ];

  // SIM-B10: DKIM for S1's default domain (id = the domain, as New-DkimSigningConfig stores it).
  const dkimSigningConfig: StoreObject[] = [
    { id: ctx.domain, Identity: ctx.domain, Name: ctx.domain, Domain: ctx.domain, Enabled: true, Status: 'Valid', KeySize: 2048, Selector1CNAME: `selector1-${ctx.slug}._domainkey.simtenant.onmicrosoft.us`, Selector2CNAME: `selector2-${ctx.slug}._domainkey.simtenant.onmicrosoft.us`, WhenCreated: at(500) },
  ];

  // SIM-B11: Sentinel incidents mirroring the Defender XDR incidents (the
  // XDR connector syncs them into the workspace).
  const sentinelIncident: StoreObject[] = securityIncidents.map((inc, i) => {
    const o = inc as Record<string, unknown>;
    const cap = (v: unknown) => { const t = String(v ?? ''); return t.charAt(0).toUpperCase() + t.slice(1); };
    return {
      id: simGuid(0xb6, i + 1),
      Name: simGuid(0xb6, i + 1),
      IncidentNumber: i + 1,
      Title: o.displayName,
      Severity: cap(o.severity),
      Status: o.status === 'resolved' ? 'Closed' : o.status === 'active' ? 'Active' : 'New',
      Classification: o.classification === 'truePositive' ? 'TruePositive' : o.classification === 'falsePositive' ? 'FalsePositive' : 'Undetermined',
      CreatedTimeUtc: o.createdDateTime,
      LastModifiedTimeUtc: o.lastUpdateDateTime,
      ProviderName: 'Microsoft XDR',
      ProviderIncidentId: o.id,
      Owner: { AssignedTo: o.assignedTo },
    };
  });

  // W7-SIM (2026-10-29): Microsoft Sentinel on the S1 workspace (S2 has no
  // Sentinel and empties these, customerHistoryS2.ts): onboarded, with the
  // Office 365 connector (Exchange, SharePoint and Teams audit logs) and the
  // Microsoft Defender XDR connector that mirrors the incidents above. Ids are
  // the ARM resource names the az rest reads address (the store key).
  const sentinelOnboardingStates: StoreObject[] = w7Seeds
    ? [{ id: 'default', name: 'default', type: 'Microsoft.SecurityInsights/onboardingStates', etag: `"${simGuid(0xbe, 1)}"`, properties: { customerManagedKey: false } }]
    : [];
  const sentinelDataConnectors: StoreObject[] = w7Seeds
    ? [
        {
          id: 'office365', name: 'office365', kind: 'Office365', type: 'Microsoft.SecurityInsights/dataConnectors', etag: `"${simGuid(0xbe, 2)}"`,
          properties: { tenantId, dataTypes: { exchange: { state: 'enabled' }, sharePoint: { state: 'enabled' }, teams: { state: 'enabled' } } },
        },
        {
          id: 'microsoftThreatProtection', name: 'microsoftThreatProtection', kind: 'MicrosoftThreatProtection', type: 'Microsoft.SecurityInsights/dataConnectors', etag: `"${simGuid(0xbe, 3)}"`,
          properties: { tenantId, dataTypes: { incidents: { state: 'enabled' }, alerts: { state: 'enabled' } } },
        },
      ]
    : [];
  // W7-SIM: the ISSO's monthly audit-record reduction, a Purview compliance
  // search over the admin and CUI-site activity (Get-ComplianceSearch). The
  // object is named by the customer, so it is keyed by its Name (the EXO
  // Identity convention).
  const isso = accounts.find((a) => a.roles?.includes('isso') && a.kind === 'staff') ?? admins[0] ?? staff[0];
  const complianceSearchName = 'S1 Monthly audit review - admin and CUI site activity';
  const complianceSearch: StoreObject[] = w7Seeds
    ? [
        {
          id: complianceSearchName, Identity: complianceSearchName, Name: complianceSearchName,
          Description: 'S1: monthly reduction of audit records for review: admin role changes and access to the CUI enclave site, exported to the ISSO',
          Status: 'Completed', Items: 412, Size: 1843200, RunBy: isso.displayName, CreatedBy: isso.displayName,
          CreatedTime: at(12), LastModifiedTime: at(12), JobStartTime: at(12), JobEndTime: at(12, -6),
          ContentMatchQuery: `(Date>=${at(42).slice(0, 10)}) AND (Date<=${at(12).slice(0, 10)})`,
          ExchangeLocation: [secOpsMail], SharePointLocation: [`https://${ctx.slug}.sharepoint.us/sites/cui-enclave`],
        },
      ]
    : [];

  // ------------------------------------------------------------- Azure
  const azure = buildAzureFacade(ctx.azure, anchorMs);
  // W5c2 follow-up 12: the Azure Monitor action group S1's alert rules use,
  // in the enclave resource group, mailing the security mailbox.
  const agName = 'ag-s1-security-alerts';
  const agId = `/subscriptions/${ctx.azure.subscription_id}/resourceGroups/${ctx.azure.resource_group}/providers/Microsoft.Insights/actionGroups/${agName}`;
  azure.actionGroup = [
    {
      id: agId,
      Id: agId,
      Name: agName,
      ResourceGroupName: ctx.azure.resource_group,
      Location: 'Global',
      GroupShortName: 'S1SecAlert',
      Enabled: true,
      EmailReceiver: [{ Name: 'S1 Security mailbox', EmailAddress: secOpsMail, UseCommonAlertSchema: true, Status: 'Enabled' }],
      SmsReceiver: [],
      WebhookReceiver: [],
      Tags: { environment: 'prod', owner: 'it', fictional: 'true' },
    },
  ];

  // PH-6 R-SIM (2026-10-31): the public IP the tenant's Azure Firewall needs
  // (a real Azure Firewall cannot exist without one; AO F-12 binds
  // publicIpName from Get-AzPublicIpAddress). The name is deliberately not
  // one Stamper's infra registry reads by name (pip-fw-cmmc,
  // pip-bastion-cmmc), so no Stamper verdict moves. RFC 5737 address.
  const pipName = `pip-${ctx.slug}-fw`;
  const pipId = `/subscriptions/${ctx.azure.subscription_id}/resourceGroups/${ctx.azure.resource_group}/providers/Microsoft.Network/publicIPAddresses/${pipName}`;
  azure.publicIpAddresses = [
    {
      id: 'publicIpAddress-1', Id: pipId, Name: pipName, name: pipName, ResourceGroupName: ctx.azure.resource_group, Location: ctx.azure.region,
      PublicIpAllocationMethod: 'Static', Sku: { Name: 'Standard', Tier: 'Regional' }, IpAddress: '203.0.113.51', ProvisioningState: 'Succeeded',
      Tags: { environment: 'prod', owner: 'it', fictional: 'true' },
    },
  ];
  // PH-12 P12-AO (2026-11-01): the two generic storage accounts (simstorage1, simstorage2, from
  // the storageAccounts generator) get their ARM ids, and armResources the matching rows, so
  // `az resource update --ids <ARM id>` (AO F-08, config-drift response) addresses a real
  // resource. Before, Get-AzStorageAccount returned only the store id 'storageAccount-1', and the
  // F-08 apply was a 404 in R-F9 S1. Both conform (HTTPS only, TLS 1.2). Stamper reads storage
  // by StorageAccountName and EO reads none, so no status moves.
  const storageEnrich: Record<string, Record<string, unknown>> = {};
  for (const n of [1, 2]) {
    const saName = `simstorage${n}`;
    const saId = `/subscriptions/${ctx.azure.subscription_id}/resourceGroups/${ctx.azure.resource_group}/providers/Microsoft.Storage/storageAccounts/${saName}`;
    storageEnrich[`storageAccount-${n}`] = { Id: saId };
    (azure.armResources ??= []).push({ id: saId, name: saName, type: 'Microsoft.Storage/storageAccounts', location: ctx.azure.region, supportsHttpsTrafficOnly: true, minimumTlsVersion: 'TLS1_2', tags: { environment: 'prod', owner: 'it', fictional: 'true' } });
  }
  // PH-6 R-SIM: CES's own app registration (a CES-managed tenant always has
  // one; AO C-02 binds appId from GET /v1.0/applications). appId = the sim
  // tenant record's auth.app_id (SimTenantConfig.ts). One healthy cert
  // credential, no client secret.
  const applications: StoreObject[] = [
    {
      id: simGuid(0xa9, 1), appId: `sim-app-${ctx.slug}`, displayName: 'CES Automation (FICTIONAL)', signInAudience: 'AzureADMyOrg', createdDateTime: at(300),
      passwordCredentials: [],
      keyCredentials: [{ keyId: simGuid(0xa9, 2), type: 'AsymmetricX509Cert', usage: 'Verify', displayName: 'CES automation certificate', startDateTime: at(65), endDateTime: ahead(300) }],
    },
  ];

  // ------------------------------------- tenant identity (synthetic-customer W1)
  // Graph /organization (tenant id = SimTenantConfig's tenant.tenant_id) and
  // the /me operator pointer (ResolverTable.resolveMe).
  const organization: StoreObject[] = [
    { id: tenantId, displayName: ctx.organization.displayName, tenantType: 'AAD', countryLetterCode: 'US', verifiedDomains: simVerifiedDomains(ctx.slug) },
  ];
  const signedInUser: StoreObject[] = [{ id: 'me', userId: ctx.operatorSeedId }];

  return {
    enrich: {
      users: userEnrich,
      groups: groupEnrich,
      managedDevices: managedDeviceEnrich,
      authenticationMethodsPolicy: { authenticationMethodsPolicy: authMethodsPolicyEnrich },
      crossTenantAccessPolicy: { crossTenantAccessPolicy: crossTenantDefaultEnrich },
      // W5c2 follow-up 10 (SIM-W4c2)
      touAgreements: touAgreementEnrich,
      // PH-12 P12-AO
      storageAccounts: storageEnrich,
    },
    // PH-12 P12-AO
    override: { groups: groupOverride },
    add: {
      organization,
      signedInUser,
      subscribedSkus,
      authenticationMethodUserRegistrationDetails: registrationDetails,
      authMethods,
      groupMember,
      roleAssignments,
      roleEligibilitySchedules,
      roleAssignmentScheduleRequests,
      roleManagementPolicies,
      policyRoleManagementPolicyAssignment,
      roleManagementDirectoryRoleDefinition,
      // W5c2 follow-up 4 (SIM-11)
      deletedUsers,
      // W5c2 follow-up 6
      namedLocations,
      directoryRole,
      directoryRoleMember,
      deviceConfigurations,
      deviceManagementAuditEvent,
      organizationBranding,
      safeLinksPolicy,
      safeLinksRule,
      messages,
      insiderRiskPolicy,
      dkimSigningConfig,
      sentinelIncident,
      // W5c2 follow-up 10
      remoteActionAudits,
      windowsProtectionStates,
      windowsMalwareInformation,
      deviceMalwareStates,
      touAgreementAcceptances,
      accessReviewDefinitions,
      accessReviewInstances,
      accessReviewDecisions,
      protectionAlert,
      sitePermissions,
      trainingUserCoverage,
      lifecycleWorkflows,
      directorySettings,
      domains,
      deviceCompliancePolicies,
      devices: entraDevices,
      bitlockerRecoveryKeys,
      vulnerabilities,
      tvmSoftwareVulnerabilities,
      secureScores,
      secureScoreControlProfiles,
      alerts,
      securityIncidents,
      riskDetections,
      riskyUsers,
      signInLogs,
      directoryAudits,
      unifiedAuditLog,
      dlpPolicies,
      dlpCompliancePolicy,
      label,
      // W5c1-b
      labelPolicy,
      spoSites,
      policyLabels,
      sensitivityLabels,
      authenticationMethodsPolicyConfigurations,
      deviceManagementConfigurationPolicies,
      iosManagedAppProtections,
      // PH-12 P12-AO
      androidManagedAppProtections,
      // W7-SIM
      sentinelOnboardingStates,
      sentinelDataConnectors,
      complianceSearch,
      // PH-6 R-SIM
      applications,
      ...azure,
    },
  };
}
