// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * ODP (Organization-Defined Parameter) Value Provider
 *
 * Loads and provides ODP values from tenant manifest for injection
 * into Handlebars control narrative templates.
 *
 * Phase 08: ODP Value Pipeline
 */

import { NOT_SUPPLIED, notSupplied } from './ContentGap.js';

export interface OdpValue {
  controlId: string;
  odpId: string;
  description: string;
  value: string;
  rationale?: string;
  enforcementMechanism: string;
  source?: string;
}

/**
 * Provides ODP values for control narrative templates.
 *
 * Usage:
 *   const provider = new OdpValueProvider(manifest.odpValues);
 *   const odp = provider.getByControlId('AC.L2-3.1.8');
 *   // Use odp.value, odp.enforcementMechanism in templates
 */
export class OdpValueProvider {
  private odpMap: Map<string, OdpValue> = new Map();

  constructor(odpValues?: Record<string, OdpValue>) {
    if (odpValues) {
      for (const [controlId, odp] of Object.entries(odpValues)) {
        this.odpMap.set(controlId, odp);
      }
    }
  }

  /**
   * Get ODP values for a given control ID.
   * Returns null if no ODP defined for the control.
   *
   * @param controlId - CMMC control ID (e.g., "AC.L2-3.1.8")
   * @returns Object with value, enforcementMechanism, rationale, description, source fields
   */
  getByControlId(controlId: string): {
    value: string;
    enforcementMechanism: string;
    rationale: string;
    description: string;
    source: string;
  } | null {
    const odp = this.odpMap.get(controlId);
    if (!odp) return null;

    return {
      value: odp.value,
      enforcementMechanism: odp.enforcementMechanism,
      rationale: odp.rationale || '',
      description: odp.description,
      source: odp.source || '',
    };
  }

  /**
   * Get count of loaded ODP values (for diagnostics).
   */
  getLoadedCount(): number {
    return this.odpMap.size;
  }

  /**
   * Check if an ODP value is defined for a control.
   */
  hasOdp(controlId: string): boolean {
    return this.odpMap.has(controlId);
  }
}

// ---------------------------------------------------------------------------
// W3.3b (B9): the policy-inputs profile and the policy-set manifest, the two
// MG-12 envelopes Muster writes into Stamper's plans\ folder (loaded by
// EoConfig.loadPolicyEnvelopes, hash verified). Documentation only: nothing
// here reads or changes a control's status, and nothing goes to policyStore.
// ---------------------------------------------------------------------------

/** The profile artifact (Planner's PolicyInputsOutput); only the fields read here. */
export interface PolicyInputsProfileArtifact {
  ces?: { artifact?: string; policy_bank_version?: string };
  odps?: Record<string, string | number>;
  /** V58: a simulated (fictional) customer's block, from its organisation content via Muster; absent otherwise. */
  simulation?: { simulated?: boolean; legalName?: string; disclaimer?: string };
  /** W5: the role holders the organisation named (PI.PER answers). */
  personnel?: Array<{ role_id?: string; role_title?: string; name?: string; title?: string; email?: string }>;
  /** W5: the organisation's physical-security answers. */
  physical_security?: { facility_addresses?: string[]; access_control_system?: string; visitor_management?: string };
  /** W5 (row 9): per-question provenance, when the envelope carries Muster's PolicyValueSource list (it does not yet). */
  sources?: Array<{ question_id?: string; provenance?: string }>;
  /** W5 cycle 3 (P4): the organisation's identity (PI.ORG.001 / .006 / .007; `duns_number` is Planner's name for the UEI slot). */
  organization?: { legal_name?: string; cage_code?: string; duns_number?: string };
  /** W5 cycle 3 (P7): the policy effective date and review cycle. */
  governance?: { policy_effective_date?: string; review_cycle_months?: number | string };
  /** W5 cycle 3 (P3 / P5 / P9): Muster-only SSP inputs, present only when answered (PI.SYS.001, CUI.LC.VOL.001, CUI.INT.004). */
  ssp_inputs?: {
    system_identifier?: string;
    cui_volume?: string;
    interconnection_agreements?: Array<{ system?: string; agreement_reference?: string; connection_type?: string; data_classification?: string }>;
  };
}

/** W5: a profile person names a role holder when the name is a name, not a drafted UPN. */
const namedPerson = (p: { name?: string }): boolean => !!p.name && p.name.trim() !== '' && !p.name.includes('@');

/** W5 cycle 3: where a filled SSP value came from ('organisation records': operating records uploaded through the Evidence Collector, P11). */
export type SspContentProvenance = 'answered' | 'derived' | 'organisation profile' | 'organisation records';

/** W5 cycle 3: one filled SSP field (JSON path), its provenance and the envelope field(s) behind it. */
export interface SspContentProvenanceEntry {
  field: string;
  provenance: SspContentProvenance;
  source: string;
}

/** W5 cycle 3 (P1 / P2): the role_id vocabulary Muster writes for the three roles EO uses only when named. */
const NAMED_ONLY_ROLES: Array<{ roleId: string; prefix: string; role: string; questionId: string }> = [
  { roleId: 'authorizing_official', prefix: 'authorizingOfficial', role: 'Authorizing Official', questionId: 'PI.PER.009' },
  { roleId: 'privacy_officer', prefix: 'privacyOfficer', role: 'Privacy Officer', questionId: 'PI.PER.010' },
  { roleId: 'network_administrator', prefix: 'networkAdmin', role: 'Network Administrator', questionId: 'PI.PER.011' },
];

/** W5 cycle 3: the profile's own per-question provenance when it carries one, else the field's default. */
function provenanceOf(profile: PolicyInputsProfileArtifact | null | undefined, questionId: string, fallback: SspContentProvenance): SspContentProvenance {
  const p = (profile?.sources ?? []).find(s => s.question_id === questionId)?.provenance;
  if (p === 'answered' || p === 'discovered') return 'answered';
  if (p === 'derived') return 'derived';
  return fallback;
}

/** W5 cycle 3 (P7): an ISO date plus whole months, the day clamped to the target month's last day; undefined when unreadable. */
export function addMonthsIso(date: string, months: number): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m || !Number.isInteger(months)) return undefined;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const y = Math.floor(total / 12);
  const mo = total % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const d = Math.min(Number(m[3]), last);
  return `${String(y).padStart(4, '0')}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

interface ProfileValue { variable: string; value: string; provenance: SspContentProvenance; source: string }

/** W5 cycle 3: the scalar SSP values the profile supplies, each with its provenance. */
function profileValues(profile: PolicyInputsProfileArtifact | null | undefined): ProfileValue[] {
  const out: ProfileValue[] = [];
  const add = (variable: string, raw: unknown, provenance: SspContentProvenance, source: string) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value) out.push({ variable, value, provenance, source });
  };
  const org = profile?.organization;
  add('cageCode', org?.cage_code, provenanceOf(profile, 'PI.ORG.006', 'organisation profile'), 'policy-inputs profile organization.cage_code (PI.ORG.006)');
  add('ueiNumber', org?.duns_number, provenanceOf(profile, 'PI.ORG.007', 'organisation profile'), 'policy-inputs profile organization.duns_number (PI.ORG.007, the UEI)');
  add('systemIdentifier', profile?.ssp_inputs?.system_identifier, provenanceOf(profile, 'PI.SYS.001', 'answered'), 'policy-inputs profile ssp_inputs.system_identifier (PI.SYS.001)');
  const gov = profile?.governance;
  const months = Number(gov?.review_cycle_months);
  const next = gov?.policy_effective_date && Number.isInteger(months) && months > 0 ? addMonthsIso(gov.policy_effective_date, months) : undefined;
  add('nextReviewDate', next, 'derived', `policy-inputs profile governance.policy_effective_date (${gov?.policy_effective_date}) + governance.review_cycle_months (${months})`);
  return out;
}

/**
 * W5 (SC-5, SC-2 row 12): SSP variables from the profile's named role holders. The disk variables
 * win (the caller spreads them after). Roles are matched on the profile `role_id`, or, where the
 * profile has no such role, on the person's title (ISSM, Systems Administrator, CUI manager, FSO).
 * W5 cycle 3 (P1 / P2): an Authorizing Official, Privacy Officer or Network Administrator is used
 * when the organisation names one (role_id `authorizing_official`, `privacy_officer`,
 * `network_administrator`); none is inferred from another role or a title.
 * W5 cycle 3 (P4, P5, P7): CAGE code and UEI from `organization`, the answered system identifier
 * from `ssp_inputs`, and the next review date from `governance` (effective date + review cycle).
 */
export function variablesFromPolicyProfile(profile: PolicyInputsProfileArtifact | null | undefined): Record<string, string> {
  const people = (profile?.personnel ?? []).filter(namedPerson);
  const out: Record<string, string> = {};
  const set = (prefix: string, p: { name?: string; title?: string; email?: string } | undefined) => {
    if (!p) return;
    out[`${prefix}Name`] = p.name!.trim();
    if (p.title) out[`${prefix}Title`] = p.title;
    if (p.email) out[`${prefix}Email`] = p.email;
  };
  const byRole = (id: string) => people.find(p => p.role_id === id);
  const byTitle = (re: RegExp) => people.find(p => re.test(p.title ?? ''));
  set('systemOwner', byRole('system_owner'));
  set('isso', byRole('isso'));
  set('issm', byTitle(/\bISSM\b|Information Security Manager/i));
  const admin = byTitle(/\bSystems? Administrator\b/i);
  set('sysAdmin', admin);
  set('fso', byRole('facilities_manager') ?? byTitle(/Facility Security Officer/i));
  set('cuiPm', byTitle(/\bCUI\b/));
  for (const r of NAMED_ONLY_ROLES) set(r.prefix, byRole(r.roleId));
  if (admin) out.systemAdministrator = `${admin.name!.trim()}${admin.title ? ` (${admin.title})` : ''}`;
  const hr = byRole('hr_representative');
  if (hr) out.humanResourcesManager = `${hr.name!.trim()}${hr.title ? ` (${hr.title})` : ''}`;
  for (const v of profileValues(profile)) out[v.variable] = v.value;
  return out;
}

/**
 * W5 (row 9): whether an ODP value was answered. Per-question provenance when the profile carries it;
 * otherwise the profile shows an answered Policy Inputs interview (named role holders, which only
 * PI.PER answers supply) and the value is taken as answered. Without either, the bank comparison stands.
 */
function odpAnswered(profile: PolicyInputsProfileArtifact | null | undefined, odpId: string): boolean | undefined {
  const src = (profile?.sources ?? []).find(s => s.question_id === odpId);
  if (src?.provenance) return src.provenance === 'answered' || src.provenance === 'discovered';
  if ((profile?.personnel ?? []).some(namedPerson)) return true;
  return undefined;
}

/** V58: what a simulated customer's SSP / POA&M carries (`simulation`), marker text included. */
export interface SimulationMarking {
  simulated: true;
  fictional: true;
  legalName: string;
  /** "SIMULATED CUSTOMER (FICTIONAL): <legal name>" */
  marker: string;
  disclaimer?: string;
}

/** V58: the marking when the profile names a simulated customer (`simulated === true` and a legal name), else null. */
export function simulationMarkingOf(profile: PolicyInputsProfileArtifact | null | undefined): SimulationMarking | null {
  const sim = profile?.simulation;
  const legalName = typeof sim?.legalName === 'string' ? sim.legalName.trim() : '';
  if (sim?.simulated !== true || !legalName) return null;
  const disclaimer = typeof sim.disclaimer === 'string' && sim.disclaimer.trim() ? sim.disclaimer.trim() : undefined;
  return { simulated: true, fictional: true, legalName, marker: `SIMULATED CUSTOMER (FICTIONAL): ${legalName}`, ...(disclaimer ? { disclaimer } : {}) };
}

/**
 * V58: marks, in place, a document of a simulated customer: sets `simulation` and, when the document has a
 * string `systemName` (the SSP), prefixes it with the marker. Idempotent. No simulation block -> unchanged.
 */
export function applySimulationMarker<T extends object>(doc: T, profile: PolicyInputsProfileArtifact | null | undefined): T {
  const marking = simulationMarkingOf(profile);
  if (!marking) return doc;
  const d = doc as T & { simulation?: SimulationMarking; systemName?: unknown };
  d.simulation = marking;
  if (typeof d.systemName === 'string' && !d.systemName.startsWith(marking.marker)) {
    // GC-PKG-2: the marker already ends with the legal name, so a system name equal to it is not repeated.
    // FIN-11: compared with spacing and case ignored, and a doubled "X - X" name counts as X.
    const norm = (v: string): string => v.trim().replace(/\s+/g, ' ').toLowerCase();
    const name = norm(d.systemName).replace(/^(.+?) - \1$/, '$1');
    const sameAsLegal = name === norm(marking.legalName);
    d.systemName = d.systemName.trim() && !sameAsLegal ? `${marking.marker} - ${d.systemName}` : marking.marker;
  }
  return doc;
}

/** The manifest artifact: one entry per Muster-rendered policy document. */
export interface PolicySetManifestArtifact {
  ces?: { artifact?: string };
  documents?: Array<{ name: string; sha256: string }>;
}

interface PolicyOdpDef {
  /** The profile's `odps` key (Planner's policyProfileGenerator odpMap). */
  key: string;
  /** The Policy Inputs bank's `recommended` value (ces-muster public/knowledge/primed Policy Inputs Question Bank.yaml). */
  recommended: string | number;
  /** NIST SP 800-171 Rev 2 requirement numbers the parameter is set for (matched on `nist_ref`). */
  nistRefs: string[];
}

/** PI.ODP.001-015: profile key, bank recommended value, and the requirement(s) each parameter serves. */
export const POLICY_ODPS: Record<string, PolicyOdpDef> = {
  'PI.ODP.001': { key: 'account_lockout_threshold', recommended: 3, nistRefs: ['3.1.8'] },
  'PI.ODP.002': { key: 'account_lockout_duration_minutes', recommended: 15, nistRefs: ['3.1.8'] },
  'PI.ODP.003': { key: 'session_timeout_minutes', recommended: 15, nistRefs: ['3.1.10'] },
  'PI.ODP.004': { key: 'min_password_length', recommended: 14, nistRefs: ['3.5.7'] },
  'PI.ODP.005': { key: 'password_history_count', recommended: 24, nistRefs: ['3.5.8'] },
  'PI.ODP.006': { key: 'max_password_age_days', recommended: 60, nistRefs: ['3.5.7'] },
  'PI.ODP.007': { key: 'audit_log_retention_days', recommended: 365, nistRefs: ['3.3.1'] },
  'PI.ODP.008': { key: 'vuln_scan_frequency', recommended: 'Monthly', nistRefs: ['3.11.2'] },
  'PI.ODP.009': { key: 'critical_patch_timeline_days', recommended: 14, nistRefs: ['3.14.1'] },
  'PI.ODP.010': { key: 'high_patch_timeline_days', recommended: 30, nistRefs: ['3.14.1'] },
  'PI.ODP.011': { key: 'training_frequency', recommended: 'Annually', nistRefs: ['3.2.1'] },
  'PI.ODP.012': { key: 'incident_reporting_hours', recommended: 72, nistRefs: ['3.6.2'] },
  'PI.ODP.013': { key: 'access_review_frequency', recommended: 'Quarterly', nistRefs: ['3.1.1'] },
  'PI.ODP.014': { key: 'backup_frequency', recommended: 'Daily', nistRefs: ['3.8.9'] },
  'PI.ODP.015': { key: 'media_sanitization_standard', recommended: 'NIST SP 800-88 Purge', nistRefs: ['3.8.3'] },
};

/** Control family -> the Muster-rendered policy documents (base names) that govern it. */
export const FAMILY_POLICY_BASES: Record<string, string[]> = {
  AC: ['access-control-policy'],
  AT: ['awareness-training-policy'],
  AU: ['audit-accountability-policy'],
  CM: ['configuration-management-policy'],
  IA: ['identification-authentication-policy'],
  IR: ['incident-response-policy', 'incident-response-plan'],
  MA: ['maintenance-policy'],
  MP: ['media-protection-policy'],
  PS: ['personnel-security-policy', 'personnel-screening-policy', 'personnel-termination-policy'],
  PE: ['physical-protection-policy'],
  RA: ['risk-assessment-policy', 'risk-assessment-report'],
  CA: ['security-assessment-policy', 'system-security-plan', 'poam'],
  SC: ['system-communications-policy'],
  SI: ['system-integrity-policy'],
};

const ODP_SOURCE_PREFIX = 'policy-inputs profile';
const PLAN_REF_MARKER = '**Policy and plan reference:**';

function policyTitle(base: string): string {
  if (base === 'poam') return 'Plan of Action and Milestones';
  return base.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

interface MpStep { id?: string; title?: string; control_coverage?: Array<{ control_id?: string }> }

function mpSteps(missionPlan: unknown): MpStep[] {
  const mp = missionPlan as { outputs?: { human_readable_mission_plan?: { steps?: MpStep[] } }; steps?: MpStep[] } | null | undefined;
  return mp?.outputs?.human_readable_mission_plan?.steps ?? mp?.steps ?? [];
}

interface PolicyInputsControl {
  control_id: string;
  nist_ref: string;
  family: string;
  status: string;
  implementationNarrative: string;
  relatedPolicies: Array<{ title: string; excerpt: string }> | string[];
  odpValues: Array<{ parameter: string; value: string; source: string }>;
}

/**
 * W3.3b: fills, in place, from the two MG-12 policy envelopes:
 *   - `odpValues` on each control a PI.ODP parameter serves (matched on `nist_ref`), one entry per
 *     parameter, labelled "defaulted" when the value equals the bank's recommended value, else "supplied";
 *   - `relatedPolicies` by family, from the manifest's document names (only names the manifest lists);
 *   - for each `not_assessed` control, one narrative line citing its family policy and the Mission
 *     Plan step that covers it (when a missionPlan is given).
 *   - V58: a simulated customer's profile (`simulation`) sets `ssp.simulation` and prefixes `systemName`
 *     with "SIMULATED CUSTOMER (FICTIONAL): <legal name>" (applySimulationMarker).
 *   - W5 cycle 3: appendices I-L from the manifest (SSP_APPENDIX_DOCUMENTS), and the organisation content
 *     of applyOrganisationContent (the unwrapped TM gives the tenant_id fallback); `contentProvenance`
 *     lists each filled field with its provenance (answered / derived / organisation profile).
 * Never touches `status`, `evidenceReferences` or any score. Idempotent: a second call adds nothing.
 */
export function applyPolicyInputs<T extends { controlImplementations: PolicyInputsControl[] }>(
  ssp: T,
  profile: PolicyInputsProfileArtifact | null | undefined,
  manifest: PolicySetManifestArtifact | null | undefined,
  missionPlan?: unknown,
  tenantManifest?: unknown,
): T {
  const odps = profile?.odps ?? {};
  const manifestBases = new Map<string, { name: string; sha256: string }>();
  for (const d of manifest?.documents ?? []) {
    const m = /^policies\/(.+)\.md$/.exec(d.name);
    if (m) manifestBases.set(m[1], d);
  }
  const steps = mpSteps(missionPlan);

  for (const control of ssp.controlImplementations) {
    // ODPs
    for (const [odpId, def] of Object.entries(POLICY_ODPS)) {
      if (!def.nistRefs.includes(control.nist_ref)) continue;
      const raw = odps[def.key];
      if (raw === undefined || raw === null || String(raw) === '') continue;
      const parameter = `${odpId} ${def.key}`;
      if (control.odpValues.some((o) => o.parameter === parameter)) continue;
      const equalsBank = String(raw) === String(def.recommended);
      const answered = odpAnswered(profile, odpId);
      const defaulted = answered === undefined ? equalsBank : !answered;
      control.odpValues.push({
        parameter,
        value: String(raw),
        source: defaulted
          ? `${ODP_SOURCE_PREFIX}: defaulted (Policy Inputs bank recommended value; not confirmed)`
          : equalsBank && answered && !(profile?.sources ?? []).some(s => s.question_id === odpId)
            ? `${ODP_SOURCE_PREFIX}: supplied (answered Policy Inputs interview; equals the bank's recommended value; the envelope carries no per-parameter provenance)`
            : `${ODP_SOURCE_PREFIX}: supplied`,
      });
    }

    // Related policies, by family
    const familyDocs = (FAMILY_POLICY_BASES[control.family] ?? []).filter((b) => manifestBases.has(b));
    for (const base of familyDocs) {
      const doc = manifestBases.get(base)!;
      const title = policyTitle(base);
      const rp = control.relatedPolicies as Array<{ title: string; excerpt: string } | string>;
      if (rp.some((p) => (typeof p === 'string' ? p : p.title) === title)) continue;
      if (rp.length > 0 && typeof rp[0] === 'string') rp.push(title);
      else rp.push({ title, excerpt: `${doc.name} (Muster-rendered; sha256 ${doc.sha256.slice(0, 12)}...)` });
    }

    // Not-assessed controls: cite the policy and the MP step
    if (control.status === 'not_assessed' && !control.implementationNarrative.includes(PLAN_REF_MARKER)) {
      const step = steps.find((s) => (s.control_coverage ?? []).some((c) => c.control_id === control.control_id));
      const parts: string[] = [];
      if (familyDocs.length > 0) parts.push(`Governed by ${familyDocs.map((b) => `${policyTitle(b)} (${manifestBases.get(b)!.name})`).join(', ')}.`);
      if (step?.id) parts.push(`Mission Plan step ${step.id}${step.title ? ` (${step.title})` : ''} carries the work and evidence for this control.`);
      if (parts.length > 0) control.implementationNarrative = `${control.implementationNarrative}\n\n${PLAN_REF_MARKER} ${parts.join(' ')}`;
    }

    // W5 (SC-2 row 12): organisation content the profile carries, stated where it applies.
    const phys = profile?.physical_security;
    if (control.family === 'PE' && phys && !control.implementationNarrative.includes(PHYSICAL_MARKER)) {
      const facts: string[] = [];
      const sites = (phys.facility_addresses ?? []).filter(Boolean);
      if (sites.length > 0) facts.push(`${sites.length} ${sites.length === 1 ? 'facility' : 'facilities'} in scope (${sites.join('; ')})`);
      if (phys.access_control_system) facts.push(`physical access control: ${phys.access_control_system}`);
      if (phys.visitor_management) facts.push(`visitor management: ${phys.visitor_management}`);
      if (facts.length > 0) control.implementationNarrative += `\n\n${PHYSICAL_MARKER} ${facts.map(f => f.replace(/[.\s]+$/, '')).join('; ')}.`;
    }
    const training = odps.training_frequency;
    if (control.family === 'AT' && training !== undefined && String(training) !== '' && !control.implementationNarrative.includes(TRAINING_MARKER)) {
      control.implementationNarrative += `\n\n${TRAINING_MARKER} ${String(training)} (PI.ODP.011).`;
    }
  }

  // W5 cycle 3: every value filled from the envelopes below records its provenance (only filled fields).
  const doc = ssp as unknown as SspContentFields;
  const provenance: SspContentProvenanceEntry[] = doc.contentProvenance ?? [];
  const record = (field: string, prov: SspContentProvenance, source: string) => {
    const at = provenance.findIndex(p => p.field === field);
    const entry = { field, provenance: prov, source };
    if (at >= 0) provenance[at] = entry; else provenance.push(entry);
  };

  // W5 (SC-5): appendices the policy-set manifest supplies (E: the policy library; I-L: SSP_APPENDIX_DOCUMENTS).
  const appendices = doc.appendices;
  if (appendices && manifestBases.size > 0) {
    const e = appendices.find(a => a.id === 'E');
    if (e && e.documentId !== 'AUTO-GENERATED') {
      e.documentId = 'POLICY-SET MANIFEST';
      e.summary = `| Document | SHA-256 (policy-set manifest) |\n|---|---|\n${[...manifestBases.values()].map(d => `| ${d.name} | ${d.sha256} |`).join('\n')}`;
    }
    for (const [id, base] of Object.entries(SSP_APPENDIX_DOCUMENTS)) {
      const d = manifestBases.get(base);
      const a = appendices.find(x => x.id === id);
      if (!a || !d || a.documentId === 'AUTO-GENERATED') continue;
      a.documentId = `${d.name} (sha256 ${d.sha256.slice(0, 12)}...)`;
      record(`appendices[${id}].documentId`, 'organisation profile', `policy-set manifest document ${d.name}, sha256 ${d.sha256} (SSP_APPENDIX_DOCUMENTS ${id})`);
    }
  }

  applyOrganisationContent(doc, profile, missionPlan, tenantManifest, record);
  if (provenance.length > 0) doc.contentProvenance = provenance;
  applySimulationMarker(ssp, profile);
  return ssp;
}

/**
 * W5 cycle 3: Muster's SSP_APPENDIX_DOCUMENTS (ces-muster `policyDocuments.ts`): the policy-set manifest
 * base name (`policies/<base>.md`) each SSP appendix resolves to. Coupled by hand: if Muster changes
 * the map, change this one.
 */
export const SSP_APPENDIX_DOCUMENTS: Readonly<Record<'I' | 'J' | 'K' | 'L', string>> = {
  I: 'incident-response-plan',
  J: 'configuration-management-policy',
  K: 'continuous-monitoring-plan',
  L: 'acceptable-use-policy',
};

/** The SSP fields applyPolicyInputs fills after generation (the generator's output, read loosely). */
interface SspContentFields {
  systemDescription?: string;
  systemType?: string;
  systemIdentifier?: string;
  cageCode?: string;
  ueiNumber?: string;
  nextReviewDate?: string;
  authorizingOfficial?: { name?: string };
  responsibleParties?: Array<{ role: string; name: string }>;
  cuiCategorization?: Array<{ volume?: string }>;
  interconnections?: Array<{ name?: string; type?: string }>;
  cuiDataFlowRows?: Array<{ direction?: string; path?: string; source?: string }>;
  appendices?: Array<{ id: string; documentId: string; summary: string }>;
  contentProvenance?: SspContentProvenanceEntry[];
}

const UNKNOWN_SCOPE = /^(|unknown|not specified|not_specified|tbd)$/i;
const DEPLOYMENT_POSTURE: Record<string, string> = { cloud_only: 'Cloud-only', hybrid: 'Hybrid (cloud and on-premises)', on_premises: 'On-premises', on_prem: 'On-premises' };
const BOUNDARY_STRATEGY: Record<string, string> = { single_enclave: 'a single CUI enclave', multiple_enclaves: 'multiple CUI enclaves', enterprise_wide: 'an enterprise-wide boundary' };
const humanise = (v: string) => v.replace(/_/g, ' ');
const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const STOP_WORDS = new Set(['the', 'and', 'for', 'via', 'from', 'with', 'into', 'online']);
const nameTokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP_WORDS.has(t)));

/**
 * W5 cycle 3: the SSP fields the organisation's envelopes supply, filled only where the generated SSP
 * left them empty or carrying the content-gap sentence. A field with no source value keeps its gap.
 *   - P1 / P2 / P4 / P5 / P7 (through variablesFromPolicyProfile): provenance recorded when the SSP
 *     value is the profile's (the tenant's disk variables, which win, record none);
 *   - P5 fallback: System Identifier derived from the TM tenant_id, said so in the value;
 *   - P6: System Type from the SI Baseline scope (both values known) and the system description;
 *   - P3: CUI volume from ssp_inputs.cui_volume into cuiCategorization[0];
 *   - P9: Appendix H from ssp_inputs.interconnection_agreements[] joined with EO's interconnections and
 *     CUI flow rows (matched on at least two shared name words).
 */
function applyOrganisationContent(
  doc: SspContentFields,
  profile: PolicyInputsProfileArtifact | null | undefined,
  missionPlan: unknown,
  tenantManifest: unknown,
  record: (field: string, prov: SspContentProvenance, source: string) => void,
): void {
  // P1 / P2: the named-only roles.
  const people = (profile?.personnel ?? []).filter(namedPerson);
  for (const r of NAMED_ONLY_ROLES) {
    const p = people.find(x => x.role_id === r.roleId);
    if (!p) continue;
    const name = p.name!.trim();
    const source = `policy-inputs profile personnel[role_id=${r.roleId}] (${r.questionId})`;
    const prov = provenanceOf(profile, r.questionId, 'answered');
    const row = (doc.responsibleParties ?? []).find(x => x.role === r.role);
    if (row?.name === name) record(`responsibleParties[role=${r.role}].name`, prov, source);
    if (r.roleId === 'authorizing_official' && doc.authorizingOfficial?.name === name) record('authorizingOfficial', prov, source);
  }

  // P4 / P5 / P7: the scalar values.
  const fieldOf: Record<string, keyof SspContentFields> = { cageCode: 'cageCode', ueiNumber: 'ueiNumber', systemIdentifier: 'systemIdentifier', nextReviewDate: 'nextReviewDate' };
  for (const v of profileValues(profile)) {
    const field = fieldOf[v.variable];
    if (field && doc[field] === v.value) record(field, v.provenance, v.source);
  }

  // P5 fallback: derived from the TM tenant_id.
  const tm = tenantManifest as { tenant_identity?: { tenant_id?: unknown } } | null | undefined;
  const tenantId = typeof tm?.tenant_identity?.tenant_id === 'string' ? tm.tenant_identity.tenant_id.trim() : '';
  if (!doc.systemIdentifier && tenantId) {
    doc.systemIdentifier = `${tenantId} (derived from the Tenant Manifest tenant_id; the organisation has assigned no system identifier)`;
    record('systemIdentifier', 'derived', `Tenant Manifest tenant_identity.tenant_id (${tenantId}); no ssp_inputs.system_identifier (PI.SYS.001)`);
  }

  // P6: System Type from the SI Baseline scope and the system description.
  const mp = missionPlan as { inputs?: { si_baseline?: { si_baseline?: { scope?: { boundary_strategy?: unknown; deployment_posture?: unknown } } } } } | null | undefined;
  const scope = mp?.inputs?.si_baseline?.si_baseline?.scope;
  const bs = typeof scope?.boundary_strategy === 'string' ? scope.boundary_strategy.trim() : '';
  const dp = typeof scope?.deployment_posture === 'string' ? scope.deployment_posture.trim() : '';
  if (!doc.systemType && !UNKNOWN_SCOPE.test(bs) && !UNKNOWN_SCOPE.test(dp)) {
    const desc = (doc.systemDescription ?? '').trim().replace(/[.\s]+$/, '');
    doc.systemType = `${DEPLOYMENT_POSTURE[dp] ?? humanise(dp)} system within ${BOUNDARY_STRATEGY[bs] ?? humanise(bs)}${desc ? `: ${desc}` : ''}.`;
    record('systemType', 'derived', `SI Baseline scope.deployment_posture (${dp}) + scope.boundary_strategy (${bs})${desc ? ' + SSP systemDescription' : ''}`);
  }

  // P3: CUI volume.
  const volume = (profile?.ssp_inputs?.cui_volume ?? '').trim();
  const cui0 = doc.cuiCategorization?.[0];
  if (volume && cui0 && (!cui0.volume || cui0.volume.startsWith(NOT_SUPPLIED))) {
    cui0.volume = volume;
    record('cuiCategorization[0].volume', provenanceOf(profile, 'CUI.LC.VOL.001', 'answered'), 'policy-inputs profile ssp_inputs.cui_volume (CUI.LC.VOL.001)');
  }

  // P9: Appendix H.
  const agreements = (profile?.ssp_inputs?.interconnection_agreements ?? []).filter(a => typeof a?.system === 'string' && a.system.trim() !== '');
  const h = doc.appendices?.find(a => a.id === 'H');
  if (h && h.documentId === NOT_SUPPLIED && agreements.length > 0) {
    const eoRecords = [
      ...(doc.interconnections ?? []).filter(i => i.name).map(i => ({ name: i.name!, label: `${i.name} (SSP interconnection, ${i.type ?? 'type not stated'})` })),
      ...(doc.cuiDataFlowRows ?? []).filter(r => r.path && /^(Ingress|Egress|Repository)$/.test(r.direction ?? '')).map(r => ({ name: r.path!, label: `${r.path} (CUI flow ${r.direction}, ${r.source ?? 'source not stated'})` })),
    ];
    const rows = agreements.map(a => {
      const system = a.system!.trim();
      const want = nameTokens(system);
      const matched = eoRecords.filter(r => [...nameTokens(r.name)].filter(t => want.has(t)).length >= 2).map(r => r.label);
      const orGap = (v: string | undefined, what: string) => (v && v.trim() ? v.trim() : notSupplied(`the ${what} for ${system}`));
      return `| ${cell(system)} | ${cell(orGap(a.agreement_reference, 'ISA/MOU reference'))} | ${cell(orGap(a.connection_type, 'connection type'))} | ${cell(orGap(a.data_classification, 'data classification'))} | ${cell(matched.length > 0 ? matched.join('; ') : 'No EO interconnection record matches this system; organisation-stated (CUI.INT.004)')} |`;
    });
    h.documentId = 'POLICY-INPUTS PROFILE (CUI.INT.004)';
    h.summary = `| External System | Agreement (ISA/MOU) | Connection Type | Data Classification | EO interconnection record |\n|---|---|---|---|---|\n${rows.join('\n')}\n\nAgreements as the organisation answered them (CUI.INT.004). The last column names the SSP interconnection or CUI flow row EO recorded for the same system, matched on its name.`;
    record('appendices[H]', provenanceOf(profile, 'CUI.INT.004', 'answered'), 'policy-inputs profile ssp_inputs.interconnection_agreements[] (CUI.INT.004), joined with SSP interconnections and cuiDataFlowRows');
  }
}

const PHYSICAL_MARKER = '**Physical security (policy-inputs profile):**';
const TRAINING_MARKER = '**Awareness training frequency (policy-inputs profile):**';
