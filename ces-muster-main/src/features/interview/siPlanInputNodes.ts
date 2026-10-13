// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// siPlanInputNodes.ts — G-MUSTER-PLAN-3 M1 follow-up (F8): the SIT plan-input
// residue as STATIC question-graph nodes, spread into QUESTION_GRAPH so they
// ride the one graph, the one pruner, and — critically — are visible to BOTH
// scoring paths (requirementStatuses AND scoreFacts) with empty
// mapped_requirements, so an answered plan-input fact can never synthesize a
// requirement or move a score (scoreFacts falls back to `scre.<id>` ONLY for
// facts whose id has no node; keeping the nodes here closes that leak).
//
// Static-TS-transcribed-from-the-primed-bank is the SAME deliberate design the
// RR QUESTION_GRAPH uses (zero YAML parse, zero fetch, renderToStaticMarkup-safe,
// DW#5). Drift from the bank + SI schema is caught by siPlanInputNodes parity
// test (ids/fields vs the bank's sets_its_fields; options vs the schema enums).
//
// Enum SIT fields render as radios. FC-MU (MU-10) closed F9: the eight
// non-enum SIT fields (counts, notes, lists, the timing goal) are nodes too,
// with an `input` kind and a typed widget; parsePlanInputAnswer below is the ONE
// place their captured string is validated and typed (the interview widget and
// the SI adapter both call it). Plan-input nodes are OPTIONAL for the finish
// gate (see allAnswered) — a readiness assessment never requires them;
// answering sharpens the generated plan.
import type { PlanInputKind, QuestionNode } from './questionGraph';

interface SiNodeSpec {
  id: string;
  field: string;
  text: string;
  options: string[];
  /** Non-enum node: the typed-input kind (options is then empty). */
  input?: PlanInputKind;
}

/** id · si_baseline.* field · text · schema enum. Transcribed from
 * `primed SI Question Bank.yaml` + `CES SIT Strategic Intent Baseline.schema.json`;
 * guarded by the parity test. */
const SPECS: SiNodeSpec[] = [
  { id: 'G-01', field: 'si_baseline.target.target_cmmc_level', text: 'What CMMC level is the target compliance destination?', options: ['L1', 'L2', 'L3'] },
  { id: 'G-02', field: 'si_baseline.target.cui_presence', text: 'What is the CUI/FCI presence expectation for the in-scope environment?', options: ['no_cui', 'fci_only', 'cui_present', 'cui_plus_other_sensitive', 'unknown'] },
  { id: 'G-05', field: 'si_baseline.assessment.assessment_route', text: 'What assessment route is intended (self-assessment vs certification)?', options: ['self', 'certification', 'unknown_contract_dependent'] },
  { id: 'G-07', field: 'si_baseline.scope.boundary_strategy', text: 'What is the intended boundary strategy for the in-scope environment?', options: ['single_enclave', 'multiple_enclaves', 'hybrid_boundary', 'unknown'] },
  { id: 'G-08', field: 'si_baseline.scope.deployment_posture', text: 'What is the intended deployment posture for in-scope systems?', options: ['cloud_only', 'hybrid', 'on_prem', 'unknown'] },
  { id: 'S-12', field: 'si_baseline.operations.collaboration_mode', text: 'What collaboration mode is intended for in-scope work?', options: ['teams_first', 'email_first', 'mixed', 'unknown'] },
  { id: 'S-13', field: 'si_baseline.operations.byod_posture', text: 'What is the BYOD posture for in-scope work?', options: ['not_allowed', 'allowed_vdi_only', 'allowed_mdm', 'unknown'] },
  { id: 'S-16', field: 'si_baseline.evidence.evidence_posture_target', text: 'What evidence posture target is desired?', options: ['l2_self_ready', 'c3pao_ready', 'continuous_compliance', 'unknown'] },
  { id: 'S-20', field: 'si_baseline.dependencies.tenant_model_preference', text: 'What tenant model is preferred for the target state?', options: ['commercial_only', 'gcc', 'gcc_high', 'dod_il5', 'dod_il6', 'hybrid', 'unknown'] },
  { id: 'SIT-020', field: 'si_baseline.dependencies.infrastructure_model', text: 'What infrastructure model is intended for the CMMC enclave?', options: ['m365_only', 'm365_sentinel', 'm365_azure'] },
  { id: 'SIT-021', field: 'si_baseline.dependencies.license_tier', text: 'What license tier is intended for the M365 environment?', options: ['business_premium', 'g3', 'g5'] },
  { id: 'S-24', field: 'si_baseline.risk_acceptance.poam_policy_intent', text: 'What is the intended POA&M policy posture?', options: ['no_poam', 'poam_if_allowed', 'unknown'] },
  // FC-MU (MU-10): the six operations postures. The SI schema is stale for these
  // (F5 — no enum); options come from the vendored SIBaseline type (verbatim from
  // ces-planner, drift-pinned), guarded by the siLiveResidue parity test.
  { id: 'S-25', field: 'si_baseline.operations.mobile_device_presence', text: 'Are mobile devices (phones, tablets) used to access CUI or in-scope systems?', options: ['no_mobile_devices', 'company_managed_only', 'byod_and_company', 'session_controlled_byod', 'unknown'] },
  { id: 'S-26', field: 'si_baseline.operations.wireless_posture', text: 'Are wireless networks used within the CUI enclave or in-scope environment?', options: ['no_wireless', 'managed_wireless', 'wireless_access_path_only', 'unknown'] },
  { id: 'S-27', field: 'si_baseline.operations.removable_media_posture', text: 'What is the removable media posture for in-scope systems?', options: ['blocked', 'allowed_encrypted', 'allowed_uncontrolled', 'unknown'] },
  { id: 'S-28', field: 'si_baseline.operations.remote_access_posture', text: 'Is remote access to CUI systems permitted from outside the enclave?', options: ['no_remote', 'vpn_only', 'cloud_native', 'unknown'] },
  { id: 'S-29', field: 'si_baseline.operations.maintenance_posture', text: 'Is nonlocal (remote) maintenance performed on in-scope systems?', options: ['no_nonlocal', 'managed_nonlocal', 'unknown'] },
  { id: 'S-30', field: 'si_baseline.operations.cui_endpoint_posture', text: 'Can CUI be downloaded, synced, or saved to local endpoint storage?', options: ['browser_only', 'managed_endpoints', 'unknown'] },
  // FC-MU (MU-10): the non-enum SIT fields, asked through a typed input.
  { id: 'G-03', field: 'si_baseline.target.cui_types', text: 'What CUI categories/types are expected in the intended scope (if any)? (comma-separated)', options: [], input: 'list' },
  { id: 'G-04', field: 'si_baseline.target.regulated_data_notes', text: 'Are there other regulated or sensitive data constraints that must be honored (ITAR, EAR, privacy, etc.)?', options: [], input: 'text' },
  { id: 'G-06', field: 'si_baseline.assessment.certification_timing_goal', text: 'What is the certification timing goal? (a date YYYY-MM-DD, a number of days, or ASAP; optionally "; driver")', options: [], input: 'time_goal' },
  { id: 'S-11', field: 'si_baseline.scope.in_scope_users_estimate', text: 'Estimate the number of in-scope users and endpoints in the target state (go-live).', options: [], input: 'number' },
  { id: 'SIT-022', field: 'si_baseline.dependencies.user_count', text: 'How many users require M365 licenses in the in-scope environment?', options: [], input: 'number' },
  { id: 'SIT-023', field: 'si_baseline.dependencies.fedramp_package_ids', text: 'Does the CSP hold a FedRAMP authorization? Provide Package ID(s). (comma-separated)', options: [], input: 'list' },
  { id: 'SIT-024', field: 'si_baseline.dependencies.physical_facility_count', text: 'How many physical facilities does the organization operate?', options: [], input: 'number' },
  { id: 'SIT-025', field: 'si_baseline.dependencies.customer_equipment_count', text: 'How many customer-owned equipment items require maintenance?', options: [], input: 'number' },
];

function labelize(v: string): string {
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The static SIT plan-input nodes. cluster 'plan-input:si', mapped_requirements
 * [] (score-leak safe), plan_input set. */
export const SI_PLAN_INPUT_NODES: QuestionNode[] = SPECS.map((s) => ({
  id: s.id,
  text: s.text,
  options: s.options.map((v) => ({ label: labelize(v), value: v })),
  cluster: 'plan-input:si',
  mapped_requirements: [],
  plan_input: { contract: 'si_baseline', field: s.field },
  ...(s.input ? { input: s.input } : {}),
}));

/** question id -> typed-input kind, for the non-enum SIT nodes. */
export const SI_INPUT_KIND_BY_ID: Record<string, PlanInputKind> = Object.fromEntries(
  SPECS.filter((s) => s.input).map((s) => [s.id, s.input as PlanInputKind])
);

type TimeGoalValue = {
  goal_type: 'by_date' | 'within_days' | 'asap';
  by_date?: string;
  within_days?: number;
  driver?: string;
};

/** A typed plan-input value, as the SI generator reads it. */
export type PlanInputValue = number | string | string[] | TimeGoalValue;

export type PlanInputParse = { ok: true; value: PlanInputValue } | { ok: false; reason: string };

/**
 * Validate and type a captured plan-input string. The interview widget calls it
 * before recording (an invalid value is not recorded); the SI adapter calls it
 * to type the fact's answer for the generator. One parser, two callers.
 *   number     — a non-negative whole number
 *   text       — any non-blank text (trimmed)
 *   list       — comma/semicolon-separated, blanks dropped, at least one item
 *   time_goal  — "ASAP" | "YYYY-MM-DD" | "<n>" / "<n> days", optionally "; driver"
 */
export function parsePlanInputAnswer(kind: PlanInputKind, raw: string): PlanInputParse {
  const text = raw.trim();
  switch (kind) {
    case 'number':
      return /^\d+$/.test(text)
        ? { ok: true, value: Number(text) }
        : { ok: false, reason: 'enter a whole number (0 or more)' };
    case 'text':
      return text ? { ok: true, value: text } : { ok: false, reason: 'enter some text' };
    case 'list': {
      const items = text.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      return items.length > 0 ? { ok: true, value: items } : { ok: false, reason: 'enter at least one item' };
    }
    case 'time_goal': {
      const cut = text.indexOf(';');
      const head = (cut >= 0 ? text.slice(0, cut) : text).trim();
      const driver = cut >= 0 ? text.slice(cut + 1).trim() : '';
      const goal = (g: TimeGoalValue): PlanInputParse => ({ ok: true, value: driver ? { ...g, driver } : g });
      if (/^asap$/i.test(head)) return goal({ goal_type: 'asap' });
      if (/^\d{4}-\d{2}-\d{2}$/.test(head) && !Number.isNaN(Date.parse(head))) {
        return goal({ goal_type: 'by_date', by_date: head });
      }
      const days = /^(\d+)(\s*days?)?$/i.exec(head);
      if (days) return goal({ goal_type: 'within_days', within_days: Number(days[1]) });
      return { ok: false, reason: 'enter a date (YYYY-MM-DD), a number of days, or ASAP' };
    }
    // FC-MU-2 (MS-5): the Stamper provisioning inputs.
    case 'upn':
      return /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, reason: 'enter a sign-in name like approver@contoso.com' };
    case 'file':
      return /^file:[^;]+;sha256:[0-9a-f]{64}$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, reason: 'upload the file (the answer is its name and sha256)' };
    case 'secret':
      return /^secretref:one-time:[0-9a-f-]{36}$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, reason: 'generate the value — a secret is never typed' };
  }
}
