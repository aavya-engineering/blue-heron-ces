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
import { buildCustomerHistorySeed, type CustomerHistoryContext, type HistoryAccount } from './customerHistory.js';
import { COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID, entraDefaultPimRules } from './pimDefaults.js';

/**
 * synthetic-customer W6 (2026-10-28): the "customer-history-s3" seed set - the
 * 90-day history of the synthetic customer S3 `s3-def`, DELIBERATELY DEFICIENT
 * (PLAN §2.1 S3 column and §2.1b; the W6 brief: ~60 accounts, a defence
 * manufacturer with an unmanaged history).
 *
 * How it is built (the S2 pattern):
 *  1. The S1 builder (customerHistory.ts, unchanged) produces every record
 *     shape S1's reads are served from, from S3's context. The builder needs
 *     objects S3 does not have (a PIM eligibility, a sensitivity label, an
 *     Azure landing zone), so it gets placeholders here and their records are
 *     emptied afterwards: every read S1 answers answers on S3, empty where S3
 *     lacks the object.
 *  2. S3_REBRAND rewrites the S1 fiction the builder carries as literals.
 *  3. S3's deficiencies (customers/s3-def/deficiencies.json):
 *     - accounts idle beyond 90 days still enabled (3 staff, and the former
 *       technician's admin account, 140 days: the shared builder dates it as a
 *       leaver, so it carries the oldest employeeLeaveDateTime);
 *     - most staff without MFA registration; Microsoft Authenticator and FIDO2
 *       disabled in the authentication methods policy (SMS and voice only);
 *       single-factor and legacy-protocol sign-ins; CA report-only, so no
 *       sign-in has a CA policy applied;
 *     - 3 standing Global Administrators (the owner's licensed account, the
 *       ISSO's admin account, the emergency account) and a standing Security
 *       Administrator (the stale admin); no PIM eligibility, activation,
 *       approval or access review;
 *     - one Windows compliance policy, unassigned; Defender Antivirus
 *       configuration unassigned; no settings-catalog, removable-storage or
 *       app-protection policy;
 *     - no DLP, no sensitivity label; the program drawings site shared to
 *       anyone (anonymous links);
 *     - 41 CVEs, 9 critical unremediated and untracked, one per device;
 *     - 2 Defender alerts new and unassigned for 20 days;
 *     - security awareness training missing; no lifecycle workflows;
 *     - no Azure resource (the stance stays m365_azure, PLAN §2.2).
 *
 * Clock: every date is `anchor` minus a fixed offset (SeedEngine passes the
 * day-floored build time, or STACKSIM_FIXED_NOW). Ids are fixed literals.
 * Everything here is fictional; the only real identifiers are the built-in
 * Entra role template ids (platform constants).
 */

export const CUSTOMER_HISTORY_S3 = 'customer-history-s3';

export interface S3Account extends HistoryAccount {
  /** Days since an idle account last signed in (no leave record). */
  inactiveDays?: number;
  /** The shared shop-floor login. */
  shared?: boolean;
}

export interface S3Device {
  seedId: string;
  entraId: string;
  deviceName: string;
  os: 'Windows';
  osVersion: string;
  kind: 'workstation' | 'shopfloor';
  upn: string | null;
  ownership: 'company';
  compliant: boolean;
  encrypted: boolean;
}

export interface CustomerHistoryS3Context extends Omit<CustomerHistoryContext, 'accounts' | 'devices' | 'azure' | 'sensitivityLabel'> {
  accounts: S3Account[];
  devices: S3Device[];
  /** S3 seeds no Azure resource (customer.json azure_government null). */
  azure: null;
  /** S3 has no sensitivity label. */
  sensitivityLabel: null;
  deficient: {
    standing: Array<{ principalSeedId: string; role: string; roleTemplateId: string }>;
    caPolicyIds: string[];
    criticalCveDevices: string[];
    subscriptionId: string;
  };
}

/**
 * The S1 fiction the shared builder carries as literals, and S3's replacement.
 * Applied in order, as exact substrings (a RegExp where anchored), to every
 * string the builder emits. S3's roster and names never contain these tokens.
 */
export const S3_REBRAND: Array<[string | RegExp, string]> = [
  ['51510000-', '53530000-'],
  ['s1h-', 's3h-'],
  ['S1-MACH-CORP', 'S3-DEF-CORP'],
  ['S1SecAlert', 'S3SecAlert'],
  ['S1KB', 'S3KB'],
  ['S1SN', 'S3SN'],
  ['S1-WS-RET-01', 'S3-WS-RET-01'],
  ['-s1-', '-s3-'],
  [/^s1-(?=microsoft|azure)/, 's3-'],
  ['S1 Windows 11 staff and kiosk compliance', 'S3 Windows 11 workstation compliance'],
  ['S1 Windows 11 programming workstation compliance', 'S3 Windows 11 test station compliance'],
  ['staff and programming workstations', 'workstations and shop-floor terminals'],
  ['S1 CUI Program Team', 'S3 Production Team'],
  ['CUI-Programs', 'Line-Status'],
  ['CUI-Engineering-Drawings', 'Engineering-Changes'],
  ['S1 ', 'S3 '],
  ['S1-', 'S3-'],
  ['S1:', 'S3:'],
  ['Fennick Falls', 'Dunmarrow'],
  ['198.51.100.20', '192.0.2.20'],
  ['sim-cam-vendor', 'sim-harness-vendor'],
  ['cam-suite', 'harness-cad'],
  ['sim-cmm-vendor', 'sim-ate-vendor'],
  ['cmm-metrology', 'ate-runtime'],
  ['/sites/cui-enclave', '/sites/program-drawings'],
  ['/Shared Documents/part-', '/Shared Documents/harness-'],
  ['/Shared Documents/router-', '/Shared Documents/traveler-'],
];

function rewrite(s: string): string {
  let out = s;
  for (const [from, to] of S3_REBRAND) out = typeof from === 'string' ? out.split(from).join(to) : out.replace(from, to);
  return out;
}

function rebrand<T>(v: T): T {
  if (typeof v === 'string') return rewrite(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => rebrand(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = rebrand(x);
    return out as T;
  }
  return v;
}

type Row = Record<string, unknown>;
const MIN = 60000;
const DAY = 1440 * MIN;
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');
/** Deterministic GUID-shaped sim id (the S3 customer.json family, 5353 = "S3 sim"; not a real id). */
const simGuid = (kind: number, n: number) => `53530000-${hex(kind, 4)}-4000-8000-${hex(n, 12)}`;
const GA_TEMPLATE = '62e90394-69f5-4237-9190-012177145e10';

/** Built-in role names for the role definitions S3 holds (platform constants). */
const ROLE_NAME: Record<string, string> = {
  [GA_TEMPLATE]: 'Global Administrator',
  '194ae4cb-b126-40b2-bd5b-6091b380977d': 'Security Administrator',
  [COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID]: 'Compliance Administrator',
};

/** G3 (GCC High) and the E5 Security add-on: service plans (names as Graph lists them; ids are S3 sim ids). */
export const S3_G3_PLANS = ['EXCHANGE_S_ENTERPRISE_GOV', 'SHAREPOINTENTERPRISE_GOV', 'TEAMS_GOV', 'INTUNE_A', 'RMS_S_PREMIUM_GOV', 'AAD_PREMIUM', 'MIP_S_CLP1'];
export const S3_E5_SECURITY_PLANS = ['WINDEFATP', 'ATP_ENTERPRISE_GOV', 'THREAT_INTELLIGENCE_GOV', 'ATA', 'ADALLOM_S_STANDALONE', 'AAD_PREMIUM_P2'];
export const S3_E5_SECURITY_SKU = { skuId: 'sim-sku-e5sec-gcchigh', skuPartNumber: 'SIM_M365_E5_SECURITY_GCCHIGH', displayName: 'Microsoft 365 E5 Security (GCC High)' };

function assertContext(ctx: unknown): CustomerHistoryS3Context {
  const c = ctx as Partial<CustomerHistoryS3Context> | undefined;
  if (!c || !Array.isArray(c.accounts) || !Array.isArray(c.devices) || !c.deficient || !Array.isArray(c.deficient.standing) || !c.operatorSeedId) {
    throw new Error("customer-history-s3: the scenario must carry seedContext['customer-history-s3'] with the deficient block (scripts/build-customer-scenario.mjs writes it)");
  }
  return c as CustomerHistoryS3Context;
}

/** The objects the shared builder requires and S3 lacks (records emptied after the build). */
function builderContext(ctx: CustomerHistoryS3Context): CustomerHistoryContext {
  return {
    ...(ctx as unknown as CustomerHistoryContext),
    pim: { ...ctx.pim, eligible: [{ principalSeedId: ctx.operatorSeedId, role: 'Global Administrator', roleTemplateId: GA_TEMPLATE }] },
    sensitivityLabel: { name: 'CUI', description: 'placeholder (S3 has no label; emptied)' },
    azure: {
      subscription_id: ctx.deficient.subscriptionId,
      subscription_name: 'placeholder',
      region: 'usgovvirginia',
      resource_group: 'placeholder',
      vms: [],
      vnet: { name: 'placeholder', address_space: '10.53.0.0/16', subnets: [] },
      nsg: 'placeholder',
      log_analytics: 'placeholder',
      backup_vault: 'placeholder',
      allowed_admin_source: '192.0.2.0/26',
    },
  };
}

export function buildCustomerHistoryS3Seed(anchorMs: number, context: unknown): SeedSet {
  const ctx = assertContext(context);
  const at = (days: number, minutes = 0) => new Date(anchorMs - days * DAY - minutes * MIN).toISOString();
  const seed = rebrand(buildCustomerHistorySeed(anchorMs, builderContext(ctx)));
  // PH-12 P12-AO: the S1 builder's override (S1's mail-enabled CUI group, for AO D-11) is S1's
  // only; S3's CUI group stays security-only, as before.
  delete seed.override;
  const add = seed.add;
  const rows = (c: string) => (add[c] ?? []) as Row[];
  const tenantId = `sim-tenant-${ctx.slug}`;
  const acct = (id: string) => ctx.accounts.find((a) => a.seedId === id);
  const operator = acct(ctx.operatorSeedId)!;
  const staleAdmin = ctx.accounts.find((a) => a.kind === 'admin' && a.lifecycle?.event === 'leaver');
  const staff = ctx.accounts.filter((a) => a.kind === 'staff');
  const people = staff.filter((a) => !a.shared);
  const standingIds = new Set(ctx.deficient.standing.map((s) => s.principalSeedId));

  // ------------------------------------------------- idle accounts (no leave record)
  for (const a of ctx.accounts) {
    if (!a.inactiveDays) continue;
    const t = at(a.inactiveDays, 95 + (Number(a.seedId.replace(/^user-/, '')) * 13) % 300);
    seed.enrich.users[a.seedId].signInActivity = { lastSignInDateTime: t, lastNonInteractiveSignInDateTime: t };
    const cut = Date.parse(t);
    add.signInLogs = rows('signInLogs').filter((r) => !(r.userId === a.seedId && Date.parse(String(r.createdDateTime)) > cut)) as StoreObject[];
    add.unifiedAuditLog = rows('unifiedAuditLog').filter((r) => !(r.UserIds === a.upn && Date.parse(String(r.CreationDate)) > cut)) as StoreObject[];
  }
  // The stale admin initiated nothing in its idle window: the shared builder's
  // round-robin initiators become the operator's admin account.
  if (staleAdmin) {
    const left = Date.parse(at(staleAdmin.lifecycle!.days_before_anchor));
    for (const r of rows('directoryAudits')) {
      const u = (r.initiatedBy as { user?: Row } | undefined)?.user;
      if (u && u.id === staleAdmin.seedId && Date.parse(String(r.activityDateTime)) > left) {
        Object.assign(u, { id: operator.seedId, displayName: operator.displayName, userPrincipalName: operator.upn });
      }
    }
  }

  // ------------------------------------------------- licences (G3 + E5 Security)
  const e5 = { skuId: S3_E5_SECURITY_SKU.skuId, disabledPlans: [] as string[] };
  for (const a of staff) {
    const u = seed.enrich.users[a.seedId];
    if (Array.isArray(u.assignedLicenses) && u.assignedLicenses.length > 0) u.assignedLicenses = [...(u.assignedLicenses as unknown[]), e5];
  }
  const g3 = rows('subscribedSkus')[0];
  g3.servicePlans = S3_G3_PLANS.map((servicePlanName, i) => ({ servicePlanId: simGuid(0xb2, i + 1), servicePlanName, provisioningStatus: 'Success', appliesTo: 'User' }));
  add.subscribedSkus = [
    g3 as StoreObject,
    {
      id: S3_E5_SECURITY_SKU.skuId,
      ...S3_E5_SECURITY_SKU,
      appliesTo: 'User',
      capabilityStatus: 'Enabled',
      prepaidUnits: (g3 as Row).prepaidUnits,
      consumedUnits: (g3 as Row).consumedUnits,
      servicePlans: S3_E5_SECURITY_PLANS.map((servicePlanName, i) => ({ servicePlanId: simGuid(0xb2, 0x20 + i + 1), servicePlanName, provisioningStatus: 'Success', appliesTo: 'User' })),
    },
  ];

  // ------------------------------------------------- MFA registration and methods
  // Registered (SMS only): the non-assembly staff and the operator's admin
  // account. Not registered: the 30 assemblers, the shared login, the stale
  // admin and the emergency account.
  const registered = (a: S3Account) => (a.kind === 'staff' && !a.shared && !/Assembler$/.test(a.jobTitle)) || a.seedId === operator.seedId;
  for (const r of rows('authenticationMethodUserRegistrationDetails')) {
    const a = ctx.accounts.find((x) => x.upn === r.userPrincipalName)!;
    const on = registered(a);
    Object.assign(r, {
      isMfaRegistered: on,
      isMfaCapable: on,
      isPasswordlessCapable: false,
      methodsRegistered: on ? ['mobilePhone'] : [],
      isAdmin: standingIds.has(a.seedId),
      defaultMfaMethod: on ? 'mobilePhone' : 'none',
      isSsprRegistered: false,
      isSsprEnabled: false,
      isSsprCapable: false,
      isSystemPreferredAuthenticationMethodEnabled: false,
      systemPreferredAuthenticationMethods: [],
      userPreferredMethodForSecondaryAuthentication: on ? 'sms' : 'none',
    });
  }
  const methods: StoreObject[] = rows('authMethods').filter((m) => m.methodType === 'password') as StoreObject[];
  for (const a of ctx.accounts) {
    if (!registered(a)) continue;
    const n = Number(a.seedId.replace(/^user-/, ''));
    methods.push({ id: simGuid(0xa705, n), userId: a.seedId, '@odata.type': '#microsoft.graph.phoneAuthenticationMethod', methodType: 'phone', phoneNumber: `+1 555-01${pad(n % 100, 2)}`, phoneType: 'mobile', smsSignInState: 'notAllowedByPolicy' } as StoreObject);
  }
  add.authMethods = methods;
  // The tenant's methods policy: Authenticator, FIDO2, OATH and TAP off; SMS,
  // voice and e-mail OTP on; no registration campaign.
  const allUsers = [{ targetType: 'group', id: 'all_users', isRegistrationRequired: false }];
  const state: Record<string, 'enabled' | 'disabled'> = { Fido2: 'disabled', MicrosoftAuthenticator: 'disabled', TemporaryAccessPass: 'disabled', SoftwareOath: 'disabled', Sms: 'enabled', Voice: 'enabled', Email: 'enabled', x509Certificate: 'disabled' };
  for (const c of rows('authenticationMethodsPolicyConfigurations')) {
    const s = state[String(c.id)] ?? 'disabled';
    c.state = s;
    c.includeTargets = s === 'enabled' ? allUsers : [];
    if (c.id === 'Fido2') c.keyRestrictions = { isEnforced: false, enforcementType: 'block', aaGuids: [] };
    if (c.id === 'Email') c.allowExternalIdToUseEmailOtp = 'default';
  }
  Object.assign(seed.enrich.authenticationMethodsPolicy.authenticationMethodsPolicy, {
    lastModifiedDateTime: at(610),
    policyMigrationState: 'preMigration',
    registrationEnforcement: { authenticationMethodsRegistrationCampaign: { snoozeDurationInDays: 1, state: 'disabled', excludeTargets: [], includeTargets: [] } },
  });

  // ------------------------------------------------- sign-ins
  // Report-only CA applies to no sign-in; unregistered users sign in with a
  // password alone; every 12th staff sign-in is a legacy protocol (Exchange
  // ActiveSync or IMAP), which nothing blocks.
  rows('signInLogs').forEach((r, i) => {
    const a = acct(String(r.userId));
    r.conditionalAccessStatus = 'notApplied';
    if (a && !registered(a)) r.authenticationRequirement = 'singleFactorAuthentication';
    if (a && a.kind === 'staff' && i % 12 === 0) {
      Object.assign(r, { appDisplayName: 'Office 365 Exchange Online', clientAppUsed: i % 24 === 0 ? 'Exchange ActiveSync' : 'IMAP4', authenticationRequirement: 'singleFactorAuthentication', isInteractive: false });
    }
  });

  // ------------------------------------------------- roles (standing, no PIM)
  add.roleAssignments = ctx.deficient.standing.map((s, i) => ({ id: `roleAssignment-${i + 1}`, principalId: s.principalSeedId, roleDefinitionId: s.roleTemplateId, directoryScopeId: '/' }));
  add.roleEligibilitySchedules = [];
  add.roleAssignmentScheduleRequests = [];
  const roleIds = [...new Set([...ctx.deficient.standing.map((s) => s.roleTemplateId), COMPLIANCE_ADMINISTRATOR_TEMPLATE_ID])];
  add.roleManagementDirectoryRoleDefinition = roleIds.map((id) => ({ id, templateId: id, displayName: ROLE_NAME[id] ?? id, description: `Built-in role: ${ROLE_NAME[id] ?? id}`, isBuiltIn: true, isEnabled: true, resourceScopes: ['/'] }));
  // Every role keeps Entra's default PIM settings (no approval, no MFA on activation): PIM was never configured.
  add.roleManagementPolicies = roleIds.map((id, i) => ({
    id: `DirectoryRole_${tenantId}_${simGuid(0x9a, i + 1)}`,
    displayName: 'Directory Role',
    description: `PIM settings for ${ROLE_NAME[id] ?? id}`,
    isOrganizationDefault: false,
    scopeId: '/',
    scopeType: 'DirectoryRole',
    lastModifiedDateTime: null,
    lastModifiedBy: null,
    rules: entraDefaultPimRules(),
  }));
  add.policyRoleManagementPolicyAssignment = roleIds.map((id, i) => ({ id: `DirectoryRole_${tenantId}_${simGuid(0x9a, i + 1)}_${id}`, policyId: `DirectoryRole_${tenantId}_${simGuid(0x9a, i + 1)}`, scopeId: '/', scopeType: 'DirectoryRole', roleDefinitionId: id }));
  add.directoryRole = roleIds.map((id, i) => ({ id: simGuid(0xb3, i + 1), displayName: ROLE_NAME[id] ?? id, description: `Built-in role: ${ROLE_NAME[id] ?? id}`, roleTemplateId: id }));
  add.directoryRoleMember = ctx.deficient.standing.map((s) => {
    const role = (add.directoryRole as Row[]).find((r) => r.roleTemplateId === s.roleTemplateId)!;
    const who = acct(s.principalSeedId)!;
    return { id: `${String(role.id)}|${who.seedId}`, directoryRoleId: role.id, memberId: who.seedId, '@odata.type': '#microsoft.graph.user', displayName: who.displayName, userPrincipalName: who.upn } as StoreObject;
  });
  add.accessReviewDefinitions = [];
  add.accessReviewInstances = [];
  add.accessReviewDecisions = [];
  add.directoryAudits = rows('directoryAudits').filter((r) => r.category !== 'RoleManagement') as StoreObject[];

  // Routine "Update conditional access policy" rows name S3's own 2 policies (the shared builder cycles S1's 9).
  for (const r of rows('directoryAudits')) {
    const t = ((r.targetResources as Row[]) ?? [])[0];
    const m = t && t.type === 'Policy' ? /^caPolicy-(\d+)$/.exec(String(t.id)) : null;
    if (!m) continue;
    const id = ctx.deficient.caPolicyIds[(Number(m[1]) - 1) % ctx.deficient.caPolicyIds.length];
    t.id = id;
    t.displayName = id;
  }

  // ------------------------------------------------- recycle bin (S3's own former staff)
  const deleted = [
    { n: 1, local: 'harnell.oskrey', name: 'Harnell Oskrey', department: 'Production', jobTitle: 'Cable Harness Assembler', deletedDays: 6, createdDays: 1210, leftDays: 214 },
    { n: 2, local: 'missel.thurnow', name: 'Missel Thurnow', department: 'Quality', jobTitle: 'Quality Inspector', deletedDays: 19, createdDays: 880, leftDays: 236 },
  ];
  add.deletedUsers = deleted.map((d) => {
    const id = simGuid(0xde, d.n);
    return {
      id,
      '@odata.type': '#microsoft.graph.user',
      displayName: d.name,
      userPrincipalName: `${id.replace(/-/g, '')}${d.local}@${ctx.domain}`,
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
  for (const r of rows('directoryAudits')) {
    const t = ((r.targetResources as Row[]) ?? [])[0];
    const d = deleted.find((x) => t && t.id === simGuid(0xde, x.n));
    if (!d || r.activityDisplayName !== 'Delete user') continue;
    r.activityDateTime = at(d.deletedDays);
    t.displayName = d.name;
    t.userPrincipalName = `${d.local}@${ctx.domain}`;
  }

  // ------------------------------------------------- Intune: unassigned or missing policies
  const windowsCompliance = rows('deviceCompliancePolicies').find((p) => p.id === 'deviceCompliancePolicy-1')!;
  windowsCompliance.assignments = [];
  add.deviceCompliancePolicies = [windowsCompliance as StoreObject];
  add.deviceConfigurations = rows('deviceConfigurations')
    .filter((c) => !/Block-Removable-Storage/.test(String(c.displayName)))
    .map((c) => (/Defender-AV/.test(String(c.displayName)) ? { ...c, assignments: [] } : c)) as StoreObject[];
  add.deviceManagementConfigurationPolicies = [];
  add.iosManagedAppProtections = [];
  // PH-12 P12-AO: nor the Android policy the S1 builder now seeds.
  add.androidManagedAppProtections = [];
  const kept = new Set([...rows('deviceCompliancePolicies'), ...rows('deviceConfigurations')].map((p) => String(p.id)));
  add.deviceManagementAuditEvent = rows('deviceManagementAuditEvent').filter((e) => ((e.resources as Row[]) ?? []).some((x) => kept.has(String(x.resourceId)))) as StoreObject[];
  add.remoteActionAudits = [];
  add.windowsMalwareInformation = [];
  add.deviceMalwareStates = [];

  // ------------------------------------------------- vulnerabilities (TVM)
  // 41 CVEs: 9 critical, unremediated and untracked (no ticket, no
  // mitigation), each on one of the 9 customer.json devices; 12 high (6
  // remediated); 20 medium (14 remediated). CVE numbers are fictional.
  const windows = ctx.devices;
  const byName = (n: string) => windows.find((d) => d.deviceName === n)!;
  const software = [
    ['microsoft', 'windows_11', '10.0.22631.4037'],
    ['sim-browser-vendor', 'browser', '128.0'],
    ['sim-pdf-vendor', 'pdf-reader', '24.1.3'],
    ['microsoft', 'office', '16.0.17928'],
    ['sim-harness-vendor', 'harness-cad', '2025.2'],
    ['sim-ate-vendor', 'ate-runtime', '8.4'],
  ];
  const sev = (c: number) => (c <= 9 ? 'Critical' : c <= 21 ? 'High' : 'Medium');
  const remediated = (c: number) => (c <= 9 ? false : c <= 21 ? c % 2 === 0 : c % 3 !== 0);
  const vulnerabilities: StoreObject[] = [];
  const tvm: StoreObject[] = [];
  for (let c = 1; c <= 41; c++) {
    const cveId = `CVE-2026-8${pad(c, 4)}`;
    const done = remediated(c);
    const [vendor, name, version] = c <= 9 ? software[c % 3] : software[c % software.length];
    vulnerabilities.push({ id: `vulnerability-${c}`, cveId, severity: sev(c).toLowerCase(), cvssScore: sev(c) === 'Critical' ? 9.8 : sev(c) === 'High' ? 8.1 : 5.4, publishedDateTime: at(88 - (c % 40)), remediated: done, remediatedDateTime: done ? at(40 - (c % 30)) : null });
    const devices = c <= 9 ? [byName(ctx.deficient.criticalCveDevices[c - 1])] : Array.from({ length: 1 + (c % 3) }, (_, j) => windows[(c * 7 + j * 11) % windows.length]);
    devices.forEach((dev, j) => {
      tvm.push({
        id: `s3h-tvm-${pad(c, 3)}-${j + 1}`,
        DeviceId: dev.seedId,
        DeviceName: dev.deviceName,
        OSPlatform: 'Windows11',
        SoftwareVendor: vendor,
        SoftwareName: name,
        SoftwareVersion: version,
        CveId: cveId,
        VulnerabilitySeverityLevel: sev(c),
        RecommendedSecurityUpdate: done ? '' : `Update ${name} to the current release`,
        RecommendedSecurityUpdateId: done ? '' : `S3KB${pad(c, 5)}`,
        CveMitigationStatus: done ? 'applied' : '',
      });
    });
  }
  add.vulnerabilities = vulnerabilities;
  add.tvmSoftwareVulnerabilities = tvm;

  // ------------------------------------------------- secure score (34 -> 36 %)
  const low: Record<string, number> = { AdminMFAV2: 0, MFARegistrationV2: 4, BlockLegacyAuthentication: 0, PWAgePolicyNew: 8, mde_onboarding: 5, mdo_safeattachments: 0, dlp_datalossprevention: 0, mdo_safelinksforemail: 0 };
  rows('secureScores').forEach((s) => {
    const d = Math.round((anchorMs - Date.parse(String(s.createdDateTime))) / DAY);
    s.currentScore = d >= 45 ? 34 : 36;
    s.averageComparativeScores = [{ basis: 'AllTenants', averageScore: 52.4 }];
    s.controlScores = ((s.controlScores as Row[]) ?? []).map((x) => {
      const score = low[String(x.controlName)] ?? Number(x.score);
      return { ...x, score, scoreInPercentage: Math.round((score / Number(x.maxScore)) * 10000) / 100 };
    });
  });
  const notImplemented = new Set(['AdminMFAV2', 'MFARegistrationV2', 'BlockLegacyAuthentication', 'mdo_safeattachments', 'dlp_datalossprevention', 'mdo_safelinksforemail']);
  for (const p of rows('secureScoreControlProfiles')) {
    if (!notImplemented.has(String(p.id))) continue;
    p.implementationStatus = 'notImplemented';
    p.controlStateUpdates = [{ assignedTo: '', comment: '', state: 'Default', updatedBy: '', updatedDateTime: p.lastModifiedDateTime }];
  }

  // ------------------------------------------------- alerts and incidents (2 new for 20 days)
  const device = byName(ctx.deficient.criticalCveDevices[1]);
  const victim = people.filter((a) => /Assembler$/.test(a.jobTitle) && !a.inactiveDays && !a.lifecycle)[2];
  const userEvidence = (a: S3Account) => ({ '@odata.type': '#microsoft.graph.security.userEvidence', roles: ['impacted'], userAccount: { accountName: a.upn.split('@')[0], azureAdUserId: a.seedId, displayName: a.displayName, userPrincipalName: a.upn } });
  const deviceEvidence = (d: S3Device) => ({ '@odata.type': '#microsoft.graph.security.deviceEvidence', roles: ['impacted'], mdeDeviceId: d.seedId, deviceDnsName: d.deviceName });
  const alertSpec = [
    { n: 1, title: 'Suspicious PowerShell command line', sev: 'high', svc: 'microsoftDefenderForEndpoint', cat: 'Execution', created: 20 * 1440 + 130, inc: 'incident-s3-1', ev: [deviceEvidence(device)], mitre: ['T1059.001'] },
    { n: 2, title: 'Unfamiliar sign-in properties', sev: 'medium', svc: 'azureAdIdentityProtection', cat: 'InitialAccess', created: 20 * 1440 + 410, inc: 'incident-s3-2', ev: [userEvidence(victim)], mitre: ['T1078'] },
  ];
  add.alerts = alertSpec.map((a) => ({
    id: `alert-s3-${a.n}`,
    providerAlertId: `s3-${a.svc}-${pad(a.n, 4)}`,
    title: a.title,
    severity: a.sev,
    status: 'new',
    serviceSource: a.svc,
    detectionSource: a.svc,
    category: a.cat,
    classification: null,
    determination: null,
    incidentId: a.inc,
    assignedTo: null,
    description: `${a.title} (fictional history record)`,
    createdDateTime: at(0, a.created),
    firstActivityDateTime: at(0, a.created + 10),
    lastActivityDateTime: at(0, a.created),
    lastUpdateDateTime: at(0, a.created),
    resolvedDateTime: null,
    mitreTechniques: a.mitre,
    tenantId,
    evidence: a.ev,
    comments: [],
  }));
  add.securityIncidents = alertSpec.map((a) => ({
    id: a.inc,
    displayName: a.n === 1 ? 'Suspicious execution on one device' : 'Initial access involving one user',
    severity: a.sev,
    status: 'active',
    classification: 'unknown',
    determination: 'unknown',
    assignedTo: null,
    tenantId,
    createdDateTime: at(0, a.created),
    lastUpdateDateTime: at(0, a.created),
    resolvedDateTime: null,
    incidentWebUrl: `https://security.microsoft.us/incidents/${a.inc}`,
    alerts: [{ id: `alert-s3-${a.n}`, title: a.title, severity: a.sev, status: 'new', incidentId: a.inc, serviceSource: a.svc, detectionSource: a.svc, createdDateTime: at(0, a.created), lastUpdateDateTime: at(0, a.created) }],
  }));
  add.riskDetections = [
    {
      id: 'riskDetection-s3-1', riskEventType: 'unfamiliarFeatures', riskLevel: 'medium', riskState: 'atRisk', riskDetail: 'none',
      detectionTimingType: 'realtime', activity: 'signin', source: 'IdentityProtection', tokenIssuerType: 'AzureAD',
      userId: victim.seedId, userDisplayName: victim.displayName, userPrincipalName: victim.upn, ipAddress: '203.0.113.77',
      location: { city: 'Unknown', countryOrRegion: 'ZZ' },
      activityDateTime: at(20, 420), detectedDateTime: at(20, 420), lastUpdatedDateTime: at(20, 420),
    },
  ];
  add.riskyUsers = [
    { id: victim.seedId, userPrincipalName: victim.upn, userDisplayName: victim.displayName, riskLevel: 'medium', riskState: 'atRisk', riskDetail: 'none', riskLastUpdatedDateTime: at(20, 420), isDeleted: false, isProcessing: false },
  ];
  add.sentinelIncident = [];

  // ------------------------------------------------- data protection: no label, no DLP, site shared to anyone
  add.label = [];
  add.labelPolicy = [];
  add.policyLabels = [];
  add.sensitivityLabels = [];
  for (const s of rows('spoSites')) {
    Object.assign(s, {
      Title: 'Program Drawings',
      SensitivityLabel: null,
      SharingCapability: 'ExternalUserAndGuestSharing',
      DefaultSharingLinkType: 'AnonymousAccess',
      DefaultLinkPermission: 'Edit',
      ConditionalAccessPolicy: 'AllowFullAccess',
      DenyAddAndCustomizePages: 'Disabled',
    });
  }
  add.sitePermissions = [];
  for (const r of rows('unifiedAuditLog')) {
    if (r.Operations !== 'SharingSet') continue;
    const data = JSON.parse(String(r.AuditData)) as Row;
    delete data.TargetUserOrGroupName;
    r.Operations = 'AnonymousLinkCreated';
    r.AuditData = JSON.stringify({ ...data, Operation: 'AnonymousLinkCreated', SharingLinkScope: 'Anyone', EventData: '<Type>Edit</Type>' });
  }

  // ------------------------------------------------- training missing, no lifecycle automation
  // The front office, finance, contracts and executives completed last year's
  // awareness course more than a year ago; everyone else was assigned this
  // year's and never started it. No insider-threat course.
  const officeLike = new Set(['Front Office', 'Finance', 'Contracts', 'Executive']);
  add.trainingUserCoverage = people.map((a) => {
    const n = Number(a.seedId.replace(/^user-/, ''));
    const done = officeLike.has(a.department);
    return {
      id: `s3h-training-${a.seedId}`,
      attackSimulationUser: { userId: a.seedId, displayName: a.displayName, email: a.upn },
      userTrainings: [
        done
          ? { displayName: 'S3 Security Awareness (2025)', trainingStatus: 'completed', assignedDateTime: at(430 + (n % 20)), completionDateTime: at(400 + (n % 20), (n * 7) % 300) }
          : { displayName: 'S3 Security Awareness (2026)', trainingStatus: 'assigned', assignedDateTime: at(64), completionDateTime: null },
      ],
    };
  }) as StoreObject[];
  add.lifecycleWorkflows = [];
  add.insiderRiskPolicy = [];
  add.protectionAlert = rows('protectionAlert').filter((p) => p.IsSystemRule === true) as StoreObject[];
  for (const s of rows('directorySettings')) {
    for (const v of (s.values as Array<{ name: string; value: string }>) ?? []) {
      if (v.name === 'BannedPasswordList') v.value = '';
      if (v.name === 'EnableBannedPasswordCheck') v.value = 'False';
      if (v.name === 'LockoutThreshold') v.value = '10';
    }
  }

  // ------------------------------------------------- no Azure resource
  for (const c of ['vnets', 'nsgs', 'keyVaults', 'keyVaultKeys', 'keyVaultCertificates', 'logAnalyticsWorkspaces', 'armResources', 'backupJobs', 'azRoleAssignments', 'actionGroup', 'publicIpAddresses']) add[c] = [];

  return seed;
}
