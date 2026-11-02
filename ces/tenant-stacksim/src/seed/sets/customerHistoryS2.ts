// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { SeedSet } from './gccHighG5.js';
import { buildCustomerHistorySeed, type CustomerHistoryContext, type HistoryAccount } from './customerHistory.js';

/**
 * synthetic-customer W6 (2026-10-28): the "customer-history-s2" seed set - the
 * 90-day history of the synthetic customer S2 `s2-eng` (PLAN §2.1 S2 column, as
 * scoped by the W6 brief: ~35 accounts, hybrid identity, no Sentinel).
 *
 * How it is built:
 *  1. The S1 builder (customerHistory.ts, unchanged) produces every record
 *     shape S1's reads are served from, from S2's own context (roster,
 *     groups, devices, PIM, DLP, label, Azure). So every read S1 answers
 *     answers on S2 too; where S2 lacks the object the collection is empty.
 *  2. S2_REBRAND rewrites the S1 fiction that builder carries as literals
 *     (sim id family 5151 -> 5252, `s1h-` ids, S1 policy and course names,
 *     the S1 city, the machining software and documents) in every string.
 *  3. S2's own deltas (below): hybrid identity (Entra Connect, password hash
 *     sync), personal Android phones, iOS and Android app protection (MAM),
 *     an Android compliance policy, no Sentinel incidents, no action group,
 *     no customer key vault (the Azure facade emits none), S2's former staff
 *     in the recycle bin, and directory-audit targets on S2's 3 CA policies.
 *
 * Clock: every date is `anchor` minus a fixed offset (SeedEngine passes the
 * day-floored build time, or STACKSIM_FIXED_NOW). Ids are fixed literals.
 * Everything here is fictional; the only real identifiers are the built-in
 * Entra role template ids carried in the context (platform constants).
 */

export const CUSTOMER_HISTORY_S2 = 'customer-history-s2';

export interface S2OnPremises {
  sync_enabled: boolean;
  immutable_id: string;
  sam_account_name: string;
  domain_name: string;
  distinguished_name: string;
  security_identifier: string;
}

export interface S2Account extends HistoryAccount {
  employeeType?: string;
  onPremises?: S2OnPremises;
}

export interface S2Device {
  seedId: string;
  entraId: string;
  deviceName: string;
  os: 'Windows' | 'iOS' | 'Android';
  osVersion: string;
  kind: 'laptop' | 'cad' | 'ios' | 'android';
  upn: string | null;
  ownership: 'company' | 'personal';
  compliant: boolean;
  encrypted: boolean;
}

export interface CustomerHistoryS2Context extends Omit<CustomerHistoryContext, 'accounts' | 'devices'> {
  accounts: S2Account[];
  devices: S2Device[];
  hybrid: {
    model: string;
    sync_engine: string;
    on_premises_domain: string;
    last_sync_minutes_before_anchor: number;
    last_password_sync_minutes_before_anchor: number;
  };
  mam: { target_group: string; ios_policy: string; android_policy: string };
  /** The customer's CA policy ids (builder: customer.json conditional_access). */
  caPolicyIds: string[];
}

/**
 * The S1 fiction the shared builder carries as literals, and S2's replacement.
 * Applied in order, as exact substrings (a RegExp where anchored), to every
 * string the builder emits. S2's roster and names never contain these tokens.
 */
export const S2_REBRAND: Array<[string | RegExp, string]> = [
  ['51510000-', '52520000-'],
  ['s1h-', 's2h-'],
  ['S1-MACH-CORP', 'S2-ENG-CORP'],
  ['S1SecAlert', 'S2SecAlert'],
  ['S1KB', 'S2KB'],
  ['S1SN', 'S2SN'],
  ['S1-WS-RET-01', 'S2-LT-RET-01'],
  ['-s1-', '-s2-'],
  [/^s1-(?=microsoft|azure)/, 's2-'],
  ['S1 Windows 11 staff and kiosk compliance', 'S2 Windows 11 staff laptop compliance'],
  ['S1 Windows 11 programming workstation compliance', 'S2 Windows 11 CAD workstation compliance'],
  ['staff and programming workstations', 'staff laptops and CAD workstations'],
  ['S1 ', 'S2 '],
  ['S1-', 'S2-'],
  ['S1:', 'S2:'],
  ['Fennick Falls', 'Wrenmoor'],
  ['sim-cam-vendor', 'sim-cad-vendor'],
  ['cam-suite', 'cad-suite'],
  ['sim-cmm-vendor', 'sim-fea-vendor'],
  ['cmm-metrology', 'fea-solver'],
  ['CUI-Programs', 'CUI-Projects'],
  ['CUI-Engineering-Drawings', 'CUI-Design-Reviews'],
  ['CUI Program Team', 'CUI Project Team'],
  ['/Shared Documents/part-', '/Shared Documents/drawing-'],
  ['/Shared Documents/router-', '/Shared Documents/calc-'],
];

function rewrite(s: string): string {
  let out = s;
  for (const [from, to] of S2_REBRAND) out = typeof from === 'string' ? out.split(from).join(to) : out.replace(from, to);
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

const MIN = 60000;
const DAY = 1440 * MIN;
const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');
/** Deterministic GUID-shaped sim id (the S2 customer.json family, 5252 = "S2 sim"; not a real id). */
const simGuid = (kind: number, n: number) => `52520000-${hex(kind, 4)}-4000-8000-${hex(n, 12)}`;
const groupTarget = (policyId: string, groupId: string) => ({ id: `${policyId}_${groupId}`, target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId } });

function assertContext(ctx: unknown): CustomerHistoryS2Context {
  const c = ctx as Partial<CustomerHistoryS2Context> | undefined;
  if (!c || !Array.isArray(c.accounts) || !Array.isArray(c.devices) || !c.azure || !c.hybrid || !c.mam || !Array.isArray(c.caPolicyIds)) {
    throw new Error("customer-history-s2: the scenario must carry seedContext['customer-history-s2'] with hybrid and mam (scripts/build-customer-scenario.mjs writes it)");
  }
  return c as CustomerHistoryS2Context;
}

export function buildCustomerHistoryS2Seed(anchorMs: number, context: unknown): SeedSet {
  const ctx = assertContext(context);
  const at = (days: number, minutes = 0) => new Date(anchorMs - days * DAY - minutes * MIN).toISOString();
  const seed = rebrand(buildCustomerHistorySeed(anchorMs, ctx as unknown as CustomerHistoryContext));
  // PH-12 P12-AO: the S1 builder's override (S1's mail-enabled CUI group, for AO D-11) is S1's
  // only; S2's CUI group stays security-only, as before.
  delete seed.override;
  const add = seed.add;
  const rows = (c: string) => (add[c] ?? []) as Array<Record<string, unknown>>;

  // ------------------------------------------------- hybrid identity
  // Synced staff carry the on-premises AD attributes Entra Connect writes; the
  // admin, break-glass, contractor and service accounts are cloud-only (Graph
  // reports onPremisesSyncEnabled null for an object that was never synced).
  // Password hash sync: synced passwords follow the on-premises policy, so
  // Entra Connect sets DisablePasswordExpiration on the cloud object.
  const lastSync = at(0, ctx.hybrid.last_sync_minutes_before_anchor);
  for (const a of ctx.accounts) {
    if (!a.onPremises?.sync_enabled) continue;
    Object.assign(seed.enrich.users[a.seedId], {
      onPremisesSyncEnabled: true,
      onPremisesImmutableId: a.onPremises.immutable_id,
      onPremisesSamAccountName: a.onPremises.sam_account_name,
      onPremisesDomainName: a.onPremises.domain_name,
      onPremisesDistinguishedName: a.onPremises.distinguished_name,
      onPremisesSecurityIdentifier: a.onPremises.security_identifier,
      onPremisesUserPrincipalName: a.upn,
      onPremisesLastSyncDateTime: lastSync,
      onPremisesProvisioningErrors: [],
      passwordPolicies: 'DisablePasswordExpiration',
    });
  }
  for (const a of ctx.accounts) if (a.employeeType) seed.enrich.users[a.seedId].employeeType = a.employeeType;
  Object.assign(rows('organization')[0], {
    onPremisesSyncEnabled: true,
    onPremisesLastSyncDateTime: lastSync,
    onPremisesLastPasswordSyncDateTime: at(0, ctx.hybrid.last_password_sync_minutes_before_anchor),
  });

  // ------------------------------------------------- recycle bin (S2's own former staff)
  // Two former synced staff who left before the 90-day history, disabled in AD
  // then and deleted after HR's retention, 7 and 26 days before the anchor.
  // Graph prefixes a deleted user's UPN with its object id (hex, no hyphens).
  const deleted = [
    { n: 1, local: 'brannel.oskwood', name: 'Brannel Oskwood', department: 'Engineering', jobTitle: 'Mechanical Design Engineer', deletedDays: 7, createdDays: 980, leftDays: 98 },
    { n: 2, local: 'ilvane.querridge', name: 'Ilvane Querridge', department: 'Drafting', jobTitle: 'CAD Designer', deletedDays: 26, createdDays: 610, leftDays: 121 },
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
      onPremisesSyncEnabled: true,
    };
  });
  // Their "Delete user" audit rows: same ids as the shared builder's, S2's names and dates.
  for (const r of rows('directoryAudits')) {
    const t = ((r.targetResources as Array<Record<string, unknown>>) ?? [])[0];
    const d = deleted.find((x) => t && t.id === simGuid(0xde, x.n));
    if (!d || r.activityDisplayName !== 'Delete user') continue;
    r.activityDateTime = at(d.deletedDays);
    t.displayName = d.name;
    t.userPrincipalName = `${d.local}@${ctx.domain}`;
  }
  // Routine "Update conditional access policy" rows name S2's own policies (the shared builder cycles S1's 9).
  for (const r of rows('directoryAudits')) {
    const t = ((r.targetResources as Array<Record<string, unknown>>) ?? [])[0];
    const m = t && t.type === 'Policy' ? /^caPolicy-(\d+)$/.exec(String(t.id)) : null;
    if (!m) continue;
    const id = ctx.caPolicyIds[(Number(m[1]) - 1) % ctx.caPolicyIds.length];
    t.id = id;
    t.displayName = id;
  }

  // ------------------------------------------------- devices (Android, BYOD)
  // The shared builder treats every non-iOS device as a Windows workstation;
  // S2's personal Android phones (Android Enterprise work profile) are fixed
  // here. They are Intune-enrolled personal devices (no TVM or Defender rows:
  // the shared builder keeps those to Windows).
  ctx.devices.forEach((d) => {
    if (d.os !== 'Android') return;
    const md = seed.enrich.managedDevices[d.seedId];
    md.manufacturer = 'Sim Mobile Devices (FICTIONAL)';
    md.model = 'Android phone';
    md.deviceEnrollmentType = 'userEnrollment';
    const ed = rows('devices').find((x) => x.id === d.entraId);
    if (ed) ed.trustType = 'Workplace';
  });
  // Compliance: the Android work-profile policy for the personal phones.
  add.deviceCompliancePolicies = [
    ...(add.deviceCompliancePolicies ?? []),
    {
      id: 'deviceCompliancePolicy-s2-android',
      '@odata.type': '#microsoft.graph.androidWorkProfileCompliancePolicy',
      displayName: 'S2 Android work profile compliance (BYOD)',
      platformType: 'androidWorkProfile',
      createdDateTime: at(260),
      lastModifiedDateTime: at(70),
      passwordRequired: true,
      passwordMinimumLength: 6,
      passwordMinutesOfInactivityBeforeLock: 5,
      securityBlockJailbrokenDevices: true,
      osMinimumVersion: '13',
      storageRequireEncryption: true,
      deviceThreatProtectionEnabled: false,
      assignments: [groupTarget('deviceCompliancePolicy-s2-android', ctx.mam.target_group)],
    },
  ];

  // ------------------------------------------------- app protection (MAM)
  // Ids are the simulator tenant object's published policy ids
  // (resources.ios_app_protection_policy_id / android_app_protection_policy_id,
  // AO B-09's targets). Data is encrypted and a PIN is required, but backup and
  // Save As are still allowed and org data may go to any app: the BYOD
  // separation AO's B-09 would tighten.
  const mamCommon = (policyId: string) => ({
    isAssigned: true,
    assignments: [groupTarget(policyId, ctx.mam.target_group), groupTarget(policyId, 'group-1')],
    appGroupType: 'allCoreMicrosoftApps',
    dataBackupBlocked: false,
    saveAsBlocked: false,
    deviceComplianceRequired: false,
    allowedDataStorageLocations: ['oneDriveForBusiness', 'sharePoint'],
    allowedInboundDataTransferSources: 'allApps',
    allowedOutboundDataTransferDestinations: 'allApps',
    allowedOutboundClipboardSharingLevel: 'allApps',
    pinRequired: true,
    minimumPinLength: 6,
    periodOfflineBeforeAccessCheck: 'PT12H',
    periodOfflineBeforeWipeIsEnforced: 'P90D',
    createdDateTime: at(300),
    lastModifiedDateTime: at(64),
  });
  add.iosManagedAppProtections = [
    {
      id: 'iosManagedAppProtection-1',
      '@odata.type': '#microsoft.graph.iosManagedAppProtection',
      displayName: ctx.mam.ios_policy,
      description: 'S2: app protection for Outlook, Teams, OneDrive and SharePoint on company and personal iPhones',
      appDataEncryptionType: 'whenDeviceLocked',
      minimumRequiredOsVersion: '17.0',
      ...mamCommon('iosManagedAppProtection-1'),
    },
  ];
  add.androidManagedAppProtections = [
    {
      id: 'androidManagedAppProtection-1',
      '@odata.type': '#microsoft.graph.androidManagedAppProtection',
      displayName: ctx.mam.android_policy,
      description: 'S2: app protection for Outlook, Teams, OneDrive and SharePoint on personal Android phones (work profile)',
      encryptAppData: true,
      screenCaptureBlocked: false,
      minimumRequiredOsVersion: '13.0',
      ...mamCommon('androidManagedAppProtection-1'),
    },
  ];

  // ------------------------------------------------- security operations
  // No Microsoft Sentinel: Defender XDR alerts and incidents stay, nothing is
  // mirrored into a workspace. No Azure Monitor action group either.
  add.sentinelIncident = [];
  add.actionGroup = [];
  // W7-SIM: no Sentinel onboarding or data connectors either.
  add.sentinelOnboardingStates = [];
  add.sentinelDataConnectors = [];

  // Banned password words (invented, S2's).
  for (const s of rows('directorySettings')) {
    for (const v of (s.values as Array<{ name: string; value: string }>) ?? []) {
      if (v.name === 'BannedPasswordList') v.value = 'wrenmoor\thalberd\ttamberlow\tcuiprime';
    }
  }

  return seed;
}
