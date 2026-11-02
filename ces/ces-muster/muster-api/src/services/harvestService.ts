// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// harvestService.ts — Graph probe table + runHarvest.
//
// FCA guardrail (MUST NOT violate):
//   - Absence of evidence never scores as pass.
//   - A failed probe yields NO fact (absence, not 'no') — callers must not
//     treat missing facts as confirmation of compliance.
//   - Harvest facts never flip a question from 'unknown' to 'pass'.
//     W5: the one exception is a verdict from a complete positive reading
//     (the standing Global Administrator verdict needs all four of its reads
//     and at least one assignment); absence still yields no fact.
//
// NOT-PROBEABLE probes (documented below, never produce facts):
//   mon-004 (Microsoft Sentinel SIEM): Sentinel is an Azure Monitor/Log Analytics
//     workspace resource exposed via Azure Resource Manager (ARM) API, not via
//     Microsoft Graph API. There is no /sentinel or equivalent endpoint on
//     graph.microsoft.us. Clients must self-report mon-004.
//   dp-002 (TLS in transit): Device compliance policies can require encryption
//     for device storage but do not authoritatively report TLS enforcement for
//     all network paths. No reliable Graph probe exists. Must be self-reported.

import type { GraphClient } from '../lib/graphClient.js';

export interface HarvestFact {
  question_id: string;
  answer: 'yes' | 'no';
  provenance: 'auto_detected';
  confidence: 'high';
  captured_at: string; // ISO 8601
  source: string;      // 'graph:<probe-name>'
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface PagedResponse {
  value: unknown[];
}

function isPaged(v: unknown): v is PagedResponse {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as Record<string, unknown>)['value'])
  );
}

interface CaPolicy {
  state: string;
  grantControls?: { builtInControls?: string[] } | null;
}

function mfaEnforced(policies: unknown[]): boolean {
  return policies.some((p) => {
    const policy = p as CaPolicy;
    return (
      policy.state === 'enabled' &&
      Array.isArray(policy.grantControls?.builtInControls) &&
      policy.grantControls!.builtInControls!.includes('mfa')
    );
  });
}

// ── Probe table ───────────────────────────────────────────────────────────────

type ProbeResult = HarvestFact | HarvestFact[];

interface Probe {
  name: string;
  path: string;
  run(data: unknown, capturedAt: string): ProbeResult;
}

/**
 * MG-07: the RR readiness activities each probe answers. The 25 static
 * readiness nodes (iam-001 …) are retired; these are the activities the SPA's
 * LEGACY_READINESS_ALIASES maps each retired id to (same requirements), so a
 * probe answer scores exactly as before. muster-api cannot import the SPA
 * graph (tsc rootDir), so the ids are listed here and tests/harvest.test.ts
 * asserts they equal the SPA table. Payloads written before this change still
 * carry the retired ids; the SPA re-keys them (expandLegacyReadinessFacts).
 */
export const PROBE_RR_ACTIVITIES = {
  mfa: ['RR-ACT-AC_L2_3_1_13', 'RR-ACT-IA_L2_3_5_3'], // retired iam-001
  remoteAccess: ['RR-ACT-AC_L2_3_1_12', 'RR-ACT-AC_L2_3_1_14'], // retired iam-004
  mdmEnrollment: ['RR-ACT-CM_L2_3_4_1', 'RR-ACT-CM_L2_3_4_2'], // retired ep-001
  endpointProtection: ['RR-ACT-SI_L1_3_14_1', 'RR-ACT-SI_L2_3_14_2'], // retired ep-002
} as const;

/** The retired readiness id each PROBE_RR_ACTIVITIES row replaces. */
export const PROBE_RETIRED_ID: Record<keyof typeof PROBE_RR_ACTIVITIES, string> = {
  mfa: 'iam-001',
  remoteAccess: 'iam-004',
  mdmEnrollment: 'ep-001',
  endpointProtection: 'ep-002',
};

function activityFacts(
  row: keyof typeof PROBE_RR_ACTIVITIES,
  answer: 'yes' | 'no',
  capturedAt: string,
  source: string
): HarvestFact[] {
  return PROBE_RR_ACTIVITIES[row].map((question_id) => ({
    question_id,
    answer,
    provenance: 'auto_detected',
    confidence: 'high',
    captured_at: capturedAt,
    source,
  }));
}

const PROBES: readonly Probe[] = [
  {
    // Conditional Access policies → MFA and remote access via CA.
    // A policy with state='enabled' and builtInControls includes 'mfa' counts as enforced.
    name: 'conditionalAccess',
    path: '/identity/conditionalAccess/policies',
    run(data, capturedAt): HarvestFact[] {
      const policies = isPaged(data) ? data.value : [];
      const answer: 'yes' | 'no' = mfaEnforced(policies) ? 'yes' : 'no';
      return [
        ...activityFacts('mfa', answer, capturedAt, 'graph:conditionalAccess'),
        ...activityFacts('remoteAccess', answer, capturedAt, 'graph:conditionalAccess'),
      ];
    },
  },
  {
    // Intune managed devices → MDM enrollment.
    // count > 0 means at least one device is enrolled → 'yes'.
    name: 'intuneDevices',
    path: '/deviceManagement/managedDevices',
    run(data, capturedAt): HarvestFact[] {
      const devices = isPaged(data) ? data.value : [];
      return activityFacts('mdmEnrollment', devices.length > 0 ? 'yes' : 'no', capturedAt, 'graph:intuneDevices');
    },
  },
  {
    // Device compliance policies → endpoint protection.
    // At least one compliance policy configured → 'yes'.
    name: 'defenderCompliance',
    path: '/deviceManagement/deviceCompliancePolicies',
    run(data, capturedAt): HarvestFact[] {
      const policies = isPaged(data) ? data.value : [];
      return activityFacts('endpointProtection', policies.length > 0 ? 'yes' : 'no', capturedAt, 'graph:defenderCompliance');
    },
  },
];

// ── runHarvest ─────────────────────────────────────────────────────────────────

/**
 * Runs all Graph probes against the given client and returns harvested facts.
 *
 * Probe failures are per-probe non-fatal: a failed probe produces NO fact
 * (absence, not 'no'). FCA guardrail: callers must never treat a missing fact
 * as evidence of compliance.
 *
 * @param client - GraphClient implementation (real or mock).
 * @param now    - Clock injectable for testing; defaults to Date.now.
 */
export async function runHarvest(
  client: GraphClient,
  now: () => Date = () => new Date()
): Promise<HarvestFact[]> {
  const facts: HarvestFact[] = [];
  const capturedAt = now().toISOString();

  for (const probe of PROBES) {
    try {
      const data = await client.get(probe.path);
      const result = probe.run(data, capturedAt);
      if (Array.isArray(result)) {
        facts.push(...result);
      } else {
        facts.push(result);
      }
    } catch {
      // Per-probe non-fatal: a failed probe yields NO fact (absence, not 'no').
      // FCA guardrail: absence of evidence never scores as pass.
    }
  }

  return facts;
}

// ── MG-13 / MG-14: tenant-fact probes ─────────────────────────────────────────
//
// The readiness probes above reduce a read to yes/no. These read the tenant's
// own configuration values the SI Baseline and Tenant Config Profile need and
// emit them as prefill facts on the SPA's plan-input nodes (siPlanInputNodes /
// tcpPlanInputNodes): provenance 'auto_detected', source 'graph:<read>', the
// answer in the node's own value format (radio slug, or the typed-input string
// parsePlanInputAnswer accepts — lists comma-separated). They are overridable
// pre-fills: the interview shows them and the operator's answer replaces them.
//
// Same FCA guardrail as the readiness probes: a failed or empty read yields NO
// fact; nothing is inferred from absence.
//
// NOT-PROBEABLE through Graph (asked, or bank-defaulted, instead):
//   Sentinel workspace name / resource group / workspace id / data connectors
//     (TCP.MON.001-004): Azure Resource Manager, not Graph.
//   DLP policies, audit-log retention: Purview / Exchange Online PowerShell
//     (IPPS), not Graph v1.0.
//   Nonlocal maintenance (S-29), Wi-Fi SSID, security notification mailbox:
//     operational facts no tenant read evidences.

export interface TenantFact {
  question_id: string;
  answer: string;
  provenance: 'auto_detected';
  confidence: 'high' | 'medium';
  captured_at: string;
  source: string;
}

/** The Graph reads the tenant-fact probes use, by name. */
export const TENANT_READS = {
  organization: '/organization',
  subscribedSkus: '/subscribedSkus',
  users: '/users?$select=id,userPrincipalName,onPremisesSyncEnabled',
  conditionalAccess: '/identity/conditionalAccess/policies',
  roleAssignments: '/roleManagement/directory/roleAssignments',
  roleEligibility: '/roleManagement/directory/roleEligibilitySchedules',
  groups: '/groups',
  managedDevices: '/deviceManagement/managedDevices',
  deviceConfigurations: '/deviceManagement/deviceConfigurations',
  me: '/me',
  // W1: Intune templates (security baselines) are a beta-only list.
  deviceManagementTemplates: '/beta/deviceManagement/templates',
  // W5c3 (SC-8b): the tenant's Conditional Access named locations (TCP.CA.002).
  namedLocations: '/identity/conditionalAccess/namedLocations',
} as const;

export type TenantReadName = keyof typeof TENANT_READS;
/** Read name → the response (undefined when the read failed). */
export type TenantReads = Partial<Record<TenantReadName, unknown>>;

/** W5: the RR readiness activity the standing-Global-Administrator verdict answers (least privilege). */
export const STANDING_GLOBAL_ADMIN_ACTIVITY = 'RR-ACT-AC_L2_3_1_5';

/** Built-in Entra role template ids (platform constants, identical in every tenant). */
export const ROLE_TEMPLATE = {
  globalAdministrator: '62e90394-69f5-4237-9190-012177145e10',
  securityAdministrator: '194ae4cb-b126-40b2-bd5b-6091b380977d',
  complianceAdministrator: '17315797-102d-40b4-93e0-432062caca18',
} as const;

/** subscribedSkus skuPartNumber → TCP.LIC.001 value. First match wins. */
const SKU_RULES: Array<[RegExp, string]> = [
  [/^SPE_E5_USGOV|M365_G5/i, 'm365_g5'],
  [/^SPE_E3_USGOV|M365_G3/i, 'm365_g3'],
  [/^ENTERPRISEPREMIUM_USGOV|O365_G5/i, 'o365_g5'],
  [/^ENTERPRISEPACK_USGOV|O365_G3/i, 'o365_g3'],
  [/^SPE_E5$/i, 'm365_e5'],
  [/^SPE_E3$/i, 'm365_e3'],
];

function list(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  return isPaged(v) ? (v.value as Array<Record<string, unknown>>) : [];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Pure: the tenant facts a set of Graph reads supports. Each fact cites the
 * read it came from. Unit-testable without a client.
 */
export function tenantFactsFromReads(reads: TenantReads, capturedAt: string): TenantFact[] {
  const out: TenantFact[] = [];
  const emit = (question_id: string, answer: string, read: TenantReadName, confidence: 'high' | 'medium' = 'high') => {
    if (answer.trim() === '') return;
    out.push({ question_id, answer, provenance: 'auto_detected', confidence, captured_at: capturedAt, source: `graph:${read}` });
  };

  // Organisation: tenant id, domains, display name; a .us initial domain is a
  // US Government (GCC High / DoD) cloud tenant — DoD is not told apart, so medium.
  const org = list(reads.organization)[0];
  let primaryDomain = '';
  if (org) {
    emit('TCP.TI.001', str(org.id), 'organization');
    const domains = list(org.verifiedDomains);
    primaryDomain = str(domains.find((d) => d.isDefault === true)?.name);
    emit('TCP.TI.002', primaryDomain, 'organization');
    emit('TCP.TI.003', domains.map((d) => str(d.name)).filter(Boolean).join(', '), 'organization');
    emit('TCP.TI.005', str(org.displayName), 'organization');
    if (domains.some((d) => /\.onmicrosoft\.us$/i.test(str(d.name)))) emit('TCP.TI.004', 'gcc_high', 'organization', 'medium');
    // MG-16: the organisation's address, for the Policy Inputs profile (PI.ORG.002-005).
    emit('PI.ORG.002', str(org.street), 'organization');
    emit('PI.ORG.003', str(org.city), 'organization');
    emit('PI.ORG.004', str(org.state), 'organization');
    emit('PI.ORG.005', str(org.postalCode), 'organization');
  }

  // Licensing: the most-consumed recognised SKU and its assigned count.
  const skus = list(reads.subscribedSkus)
    .map((s) => ({ value: SKU_RULES.find(([re]) => re.test(str(s.skuPartNumber)))?.[1], used: Number(s.consumedUnits ?? 0) }))
    .filter((s): s is { value: string; used: number } => Boolean(s.value))
    .sort((a, b) => b.used - a.used);
  if (skus[0]) {
    emit('TCP.LIC.001', skus[0].value, 'subscribedSkus');
    emit('TCP.LIC.002', String(skus[0].used), 'subscribedSkus');
  }

  // Users: id → UPN (for role holders and CA exclusions); directory sync.
  const users = list(reads.users);
  const upnById = new Map(users.map((u) => [str(u.id), str(u.userPrincipalName)]));
  if (reads.users !== undefined && users.length > 0) {
    const synced = users.some((u) => u.onPremisesSyncEnabled === true);
    emit('TCP.IA.005', synced ? 'yes' : 'no', 'users');
    // Hybrid could be AD Connect or Cloud Sync, which Graph does not tell apart.
    if (!synced) emit('TCP.IA.004', 'entra_native', 'users');
  }

  // Role holders by built-in role template.
  const holders = (template: string) =>
    list(reads.roleAssignments)
      .filter((a) => str(a.roleDefinitionId) === template)
      .map((a) => str(a.principalId))
      .filter((id) => upnById.has(id));
  const globalAdminIds = holders(ROLE_TEMPLATE.globalAdministrator);

  // Conditional Access: policy count; break-glass = Global Administrators
  // excluded from every enabled policy; remote access governed cloud-natively
  // when an enabled policy covers all users and all cloud apps with MFA or a
  // compliant device.
  const ca = list(reads.conditionalAccess);
  let breakGlassIds: string[] = [];
  if (reads.conditionalAccess !== undefined) {
    emit('TCP.CA.003', String(ca.length), 'conditionalAccess');
    const enabled = ca.filter((p) => p.state === 'enabled');
    // W5c3 (SC-8b): the break-glass exclusion group = the one security group every
    // enabled policy excludes (several such groups would be a choice, not a reading).
    const excludedGroups = (p: Record<string, unknown>): unknown[] => {
      const usersCond = ((p.conditions as Record<string, unknown> | undefined)?.users ?? {}) as Record<string, unknown>;
      return Array.isArray(usersCond.excludeGroups) ? (usersCond.excludeGroups as unknown[]) : [];
    };
    const everywhere = enabled.length > 0
      ? [...new Set(excludedGroups(enabled[0]).map(str))].filter((g) => g && enabled.every((p) => excludedGroups(p).includes(g)))
      : [];
    if (everywhere.length === 1) {
      const group = list(reads.groups).find((g) => str(g.id) === everywhere[0]);
      if (group) emit('TCP.PA.005', str(group.displayName), 'conditionalAccess');
    }
    const excludedEverywhere = (id: string) =>
      enabled.length > 0 &&
      enabled.every((p) => {
        const usersCond = ((p.conditions as Record<string, unknown> | undefined)?.users ?? {}) as Record<string, unknown>;
        return Array.isArray(usersCond.excludeUsers) && (usersCond.excludeUsers as unknown[]).includes(id);
      });
    breakGlassIds = globalAdminIds.filter(excludedEverywhere);
    const coversAll = enabled.some((p) => {
      const c = (p.conditions ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const includeUsers = (c.users?.includeUsers ?? []) as unknown[];
      const includeApps = (c.applications?.includeApplications ?? []) as unknown[];
      const grant = ((p.grantControls as Record<string, unknown> | null | undefined)?.builtInControls ?? []) as unknown[];
      return includeUsers.includes('All') && includeApps.includes('All') && (grant.includes('mfa') || grant.includes('compliantDevice'));
    });
    if (coversAll) emit('S-28', 'cloud_native', 'conditionalAccess', 'medium');
  }
  if (reads.roleAssignments !== undefined && upnById.size > 0) {
    const upns = (ids: string[]) => ids.map((id) => upnById.get(id) ?? '').filter(Boolean).join(', ');
    emit('TCP.IA.001', upns(breakGlassIds), 'conditionalAccess');
    if (breakGlassIds[0]) emit('TCP.MU.005', breakGlassIds[0], 'conditionalAccess');
    emit('TCP.PA.001', upns(globalAdminIds.filter((id) => !breakGlassIds.includes(id))), 'roleAssignments');
    emit('TCP.PA.002', upns(holders(ROLE_TEMPLATE.securityAdministrator)), 'roleAssignments');
    // W5c4: Compliance Administrators also count when they hold the role through a
    // PIM eligibility (no standing assignment), read the way TCP.PA.004 reads it.
    const complianceActive = holders(ROLE_TEMPLATE.complianceAdministrator);
    const complianceEligible = list(reads.roleEligibility)
      .filter((e) => str(e.roleDefinitionId) === ROLE_TEMPLATE.complianceAdministrator)
      .map((e) => str(e.principalId))
      .filter((id) => upnById.has(id) && !complianceActive.includes(id));
    emit(
      'TCP.PA.003',
      upns([...complianceActive, ...new Set(complianceEligible)]),
      complianceActive.length === 0 && complianceEligible.length > 0 ? 'roleEligibility' : 'roleAssignments'
    );
  }
  if (reads.roleEligibility !== undefined) {
    emit('TCP.PA.004', list(reads.roleEligibility).length > 0 ? 'yes' : 'no', 'roleEligibility');
  }

  // W5 (MG-02 predicate, standing Global Administrator): least privilege
  // (AC.L2-3.1.5) is a decisive 'no' when any active Global Administrator
  // assignment belongs to neither a break-glass account (CA exclusions ∩ GA,
  // above) nor a principal eligible for the role through PIM (an eligible
  // principal's active assignment is an activation, not a standing one), and
  // 'yes' otherwise. Needs all four reads (users, role assignments,
  // eligibility schedules, Conditional Access) and at least one Global
  // Administrator assignment; anything less yields no fact (absence, not 'no').
  if (
    reads.roleAssignments !== undefined &&
    reads.roleEligibility !== undefined &&
    reads.conditionalAccess !== undefined &&
    upnById.size > 0
  ) {
    const gaPrincipals = list(reads.roleAssignments)
      .filter((a) => str(a.roleDefinitionId) === ROLE_TEMPLATE.globalAdministrator)
      .map((a) => str(a.principalId))
      .filter(Boolean);
    if (gaPrincipals.length > 0) {
      const eligibleGa = new Set(
        list(reads.roleEligibility)
          .filter((e) => str(e.roleDefinitionId) === ROLE_TEMPLATE.globalAdministrator)
          .map((e) => str(e.principalId))
      );
      const standing = gaPrincipals.filter((id) => !breakGlassIds.includes(id) && !eligibleGa.has(id));
      emit(STANDING_GLOBAL_ADMIN_ACTIVITY, standing.length > 0 ? 'no' : 'yes', 'roleAssignments');
    }
  }

  // Groups: the security groups that govern CUI / compliance access; strategy.
  const groups = list(reads.groups).filter((g) => g.securityEnabled === true);
  if (groups.length > 0) {
    emit('TCP.GA.002', groups.map((g) => str(g.displayName)).filter((n) => /cui|cmmc|complian|evidence/i.test(n)).join(', '), 'groups');
    const dyn = groups.filter((g) => Array.isArray(g.groupTypes) && (g.groupTypes as unknown[]).includes('DynamicMembership')).length;
    emit('TCP.GA.004', dyn === 0 ? 'assigned' : dyn === groups.length ? 'dynamic' : 'mixed', 'groups');
  }

  // Intune managed devices: platforms and join type.
  const devices = list(reads.managedDevices);
  if (devices.length > 0) {
    const platform = (os: string): string | null =>
      /^windows/i.test(os) ? 'Windows' : /^mac/i.test(os) ? 'macOS' : /^(ios|ipados)/i.test(os) ? 'iOS/iPadOS' : /^android/i.test(os) ? 'Android' : null;
    const order = ['Windows', 'macOS', 'iOS/iPadOS', 'Android'];
    const found = new Set(devices.map((d) => platform(str(d.operatingSystem))).filter((p): p is string => p !== null));
    emit('TCP.DM.004', order.filter((p) => found.has(p)).join(', '), 'managedDevices');
    const joins = devices.map((d) => str(d.joinType));
    if (joins.includes('hybridAzureADJoined')) emit('TCP.DM.001', 'hybrid_join', 'managedDevices');
    else if (joins.includes('azureADJoined')) emit('TCP.DM.001', 'azure_ad_join', 'managedDevices');
  }

  // Intune device configuration: removable storage blocked.
  if (list(reads.deviceConfigurations).some((c) => c.storageBlockRemovableStorage === true)) {
    emit('S-27', 'blocked', 'deviceConfigurations');
  }

  // W5c3 (SC-8b): named locations as the TCP bank's "Name|Type|Value" lines
  // (ip: the CIDR ranges; country: the country codes; several values space-separated).
  const locations = list(reads.namedLocations)
    .map((l) => {
      const name = str(l.displayName).replace(/[|,;]/g, ' ').trim();
      const odata = str(l['@odata.type']);
      if (/countryNamedLocation/i.test(odata)) {
        const countries = (Array.isArray(l.countriesAndRegions) ? (l.countriesAndRegions as unknown[]) : []).map(str).filter(Boolean);
        return name && countries.length ? `${name}|country|${countries.join(' ')}` : '';
      }
      const ranges = (Array.isArray(l.ipRanges) ? (l.ipRanges as Array<Record<string, unknown>>) : []).map((r) => str(r.cidrAddress)).filter(Boolean);
      return name && ranges.length ? `${name}|ip|${ranges.join(' ')}` : '';
    })
    .filter(Boolean);
  if (locations.length > 0) emit('TCP.CA.002', locations.join(', '), 'namedLocations');

  // The consented operator (delegated sign-in only; app-only has no /me).
  const me = reads.me as Record<string, unknown> | undefined;
  if (me && typeof me === 'object') emit('TCP.MU.004', str(me.userPrincipalName), 'me');

  // W1: the Windows security-baseline template Stamper's baseline task deploys
  // (baselineTemplateId). Exactly one current Windows 10+ security baseline, or
  // no fact (several would be a choice, not a reading). The fact rides an
  // OPV.<stamperVar> id (no register row): the SPA's graph drops it, the
  // headless runner keeps it for the Tenant Manifest.
  const baselines = list(reads.deviceManagementTemplates).filter(
    (t) => t.templateType === 'securityBaseline' && t.platformType === 'windows10AndLater' && t.isDeprecated !== true
  );
  if (baselines.length === 1) emit('OPV.baselineTemplateId', str(baselines[0].id), 'deviceManagementTemplates');

  return out;
}

/**
 * Run the tenant-fact reads and return the facts they support. Per-read
 * non-fatal: a failed read is absent from `reads`, so it yields no fact.
 */
export async function runTenantHarvest(
  client: GraphClient,
  now: () => Date = () => new Date()
): Promise<TenantFact[]> {
  const reads: TenantReads = {};
  for (const [name, path] of Object.entries(TENANT_READS) as Array<[TenantReadName, string]>) {
    try {
      reads[name] = await client.get(path);
    } catch {
      // absence, not 'no'
    }
  }
  return tenantFactsFromReads(reads, now().toISOString());
}
