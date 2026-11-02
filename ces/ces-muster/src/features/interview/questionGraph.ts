// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Static question graph derived from public/knowledge/primed RR Question Bank.yaml.
// MG-07: the readiness part is every RR activity (165), generated from the bank
// via scoring/readinessIndex.json; the per-scenario selection and the residue
// are decided in questionGraphService.loadQuestionGraph.
// Keeping this as a static TS constant avoids YAML parsing at runtime and eliminates
// any network dependency (DW#5 CI assertion: zero API calls during an interview run).
//
// 2026-07-11 (ADAPTIVE_VERIFY divergence #2 resolution, on_prem_ot seeding):
// this file is NOT vendored (it lives under src/features/interview/, outside
// src/vendored/**), so it is the correct place to tag genuinely OT/on-prem-
// scoped nodes via `applicable_stacks: ['on_prem_ot']` — questionGraphService
// now folds the Situation tab's on_prem_ot answer into the same
// declaredStacks dimension that already filters `applicable_stacks` (see
// questionGraphService.ts). Today's 25-node CMMC L1/L2 identity/endpoint/
// policy/monitoring/data-protection/incident-response set contains NO node
// whose `mapped_requirements` are OT- or on-prem-specific (no PE-domain or
// OT-segmentation control is represented) — every node here is either
// generic (applies regardless of on-prem/OT posture) or already gated on a
// cloud-service stack tag (microsoft_intune, microsoft_sentinel). Forcing an
// `on_prem_ot` tag onto an unrelated node to make pruning "do something"
// would violate the FCA rule that a "no on-prem/OT" answer may only prune
// nodes that are genuinely OT/on-prem-scoped per the graph's own metadata.
// The mapping below is therefore a deliberate, clearly-marked no-op: zero
// nodes carry `applicable_stacks: ['on_prem_ot']` today. This is blocked on
// the question graph's own content (no OT-specific question exists yet), not
// on file ownership. The seam is wired and tested end-to-end
// (questionGraphService.test / AssessmentPage on_prem_ot wiring) so the next
// OT-relevant question added to this file only needs
// `applicable_stacks: ['on_prem_ot']` to be picked up by pruning — no further
// code changes required.

import { SI_PLAN_INPUT_NODES } from './siPlanInputNodes';
import { TCP_PLAN_INPUT_NODES } from './tcpPlanInputNodes';
import { TCP_PROVISIONING_NODES } from './tcpProvisioningNodes';
import { CUI_BOUNDARY_NODES } from './cuiBoundaryNodes';
import { PLAN_MODE_NODE } from './planModeNode';
import { BTC_GATE_NODES } from '../plan/btc/btcGateNodes';
import { POLICY_INPUT_NODES } from './policyInputNodes';
import type { ReadinessIndex } from '@/features/scoring/readinessIndex';
import readinessIndexJson from '@/features/scoring/readinessIndex.json';
import type { InterviewFact } from '@/shared/types/engagement';
import controlsReference from 'ces-shared/data/cmmc-l2-controls';

export interface QuestionNode {
  id: string;
  text: string;
  options: Array<{ label: string; value: string }>;
  cluster: string;
  applicable_stacks?: string[];
  mapped_requirements: string[];
  /**
   * G-MUSTER-PLAN-3 M1: present on plan-input nodes (SIT/BTC/TCP/policy
   * residue) sourced from Planner's primed banks. Names the contract field the
   * node's answer sets. Plan-input nodes ALWAYS carry `mapped_requirements: []`
   * so they contribute zero to SPRS (score-leak safe) — they capture plan
   * inputs, never readiness posture. RR readiness nodes never carry this.
   */
  plan_input?: { contract: string; field: string };
  /**
   * FC-MU (MU-10, F9 closed): a plan-input node whose answer is not an enum —
   * rendered as a typed input instead of radios (options is []). The captured
   * string is validated and typed by siPlanInputNodes.parsePlanInputAnswer.
   */
  input?: PlanInputKind;
  /**
   * MG-07: a retired static readiness node (iam-001 ... ir-004), kept only so a
   * fact written under its id (muster-api harvest probes, older sessions)
   * persists and prunes. Never asked (loadQuestionGraph drops it), never joined
   * by discovery; its facts are re-keyed onto these RR activity ids.
   */
  alias_of?: string[];
}

/** The typed-input kinds a non-enum plan-input node can carry. */
export type PlanInputKind =
  | 'number'
  | 'text'
  | 'list'
  | 'time_goal'
  // FC-MU-2 (MS-5): the Stamper provisioning inputs (tcpProvisioningNodes.ts).
  | 'upn'
  | 'file'
  | 'secret';

const YN_OPTS: Array<{ label: string; value: string }> = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
  { label: "I don't know / Not sure", value: 'unknown' },
];

const YNU_OPTS: Array<{ label: string; value: string }> = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
  { label: 'Unsure', value: 'unsure' },
  { label: "I don't know", value: 'unknown' },
];

// ── MG-07 (decision D5): the RR readiness activities ────────────────────────
// All 165 activities of the primed RR Question Bank (public/knowledge), one node
// each, generated from scoring/readinessIndex.json (rebuilt from the YAML and
// checked by readinessIndex.test.ts). They replace the 25 hand-picked static
// readiness nodes. loadQuestionGraph keeps only the activities Planner's
// questionSetGenerator selects for the scenario, and of those asks only the
// residue the bulk cascade and discovery cannot settle (scoring/readinessScope.ts).
// Answers use the posture vocabulary the scorers already read: yes = implemented,
// partial, no = not implemented.

const READINESS_INDEX = readinessIndexJson as unknown as ReadinessIndex;

const RR_STATUS_OPTS: Array<{ label: string; value: string }> = [
  { label: 'Implemented', value: 'yes' },
  { label: 'Partially implemented', value: 'partial' },
  { label: 'Not implemented', value: 'no' },
  { label: "I don't know / Not sure", value: 'unknown' },
];

/** The interview tab an RR activity sits on, by CMMC domain. */
const RR_DOMAIN_CLUSTER: Record<string, string> = {
  AC: 'identity',
  IA: 'identity',
  PS: 'identity',
  CM: 'endpoint',
  MA: 'endpoint',
  SI: 'endpoint',
  AU: 'monitoring',
  IR: 'incident_response',
  MP: 'data_protection',
  SC: 'data_protection',
  AT: 'policy',
  CA: 'policy',
  RA: 'policy',
  PE: 'policy',
};

/** Interview tab order (the tabs the 25 static nodes had); bank order within a tab. */
const RR_CLUSTER_ORDER = ['identity', 'endpoint', 'policy', 'monitoring', 'data_protection', 'incident_response'];

const rrNodesInBankOrder: QuestionNode[] = READINESS_INDEX.activities.map((a) => {
  const foundation = a.mapped_requirements.includes('FOUNDATION');
  const domain = /^([A-Z]{2})\./.exec(a.mapped_requirements[0] ?? '')?.[1] ?? '';
  return {
    id: a.id,
    text: foundation ? `${a.name}?` : `What is the implementation status of ${a.name}?`,
    options: foundation ? YN_OPTS : RR_STATUS_OPTS,
    cluster: foundation ? 'policy' : RR_DOMAIN_CLUSTER[domain] ?? 'policy',
    // FOUNDATION activities keep the bank's 'FOUNDATION' requirement, as in
    // Planner's posture (its cascade derives a FOUNDATION result too).
    mapped_requirements: a.mapped_requirements,
  };
});

export const RR_ACTIVITY_NODES: QuestionNode[] = RR_CLUSTER_ORDER.flatMap((c) =>
  rrNodesInBankOrder.filter((n) => n.cluster === c)
);

// FIN-17b / FIN-26b (NS-audit F-10, AUDIT-NONSTACK.md section 5): the RR bank labels some L1 practices as L2 as
// well (RR-ACT-AC_L2_3_1_20 beside RR-ACT-AC_L1_3_1_20). Those L2 ids are not in the ces-shared 110-control
// reference ("phantom" ids), so NS-2 drops their interview objectives and the gap compile keeps the L1 entry
// (L1_CANONICAL_IN_L2). The node stays in the graph (a recorded fact still maps through it) and the register
// marks it (phantom_requirement_ids), but the interview never asks it: the L1 twin is the practice
// (questionGraphService.readinessResidueIds). L3 (enhanced) practices are outside the reference by design.
const REFERENCE_CONTROL_IDS: ReadonlySet<string> = new Set(
  (controlsReference.controls as Array<{ control_id: string }>).map((c) => c.control_id)
);
const L1_L2_PRACTICE = /^[A-Z]{2}\.L[12]-\d+\.\d+\.\d+$/;

/** The node's L1/L2-labelled practice ids that the ces-shared reference does not have. */
export function phantomRequirementIds(n: Pick<QuestionNode, 'mapped_requirements'>): string[] {
  return n.mapped_requirements.filter((r) => L1_L2_PRACTICE.test(r) && !REFERENCE_CONTROL_IDS.has(r));
}

/** An RR activity node every requirement of which is such a phantom id (FIN-17b). */
export function isPhantomReadinessNode(n: Pick<QuestionNode, 'id' | 'mapped_requirements'>): boolean {
  if (!n.id.startsWith('RR-ACT-')) return false;
  const reqs = n.mapped_requirements.filter((r) => r !== 'FOUNDATION');
  return reqs.length > 0 && phantomRequirementIds({ mapped_requirements: reqs }).length === reqs.length;
}

/** FIN-26b: the RR activity ids the interview never asks (every requirement is a phantom L2 twin). */
export const PHANTOM_RR_ACTIVITY_IDS: ReadonlySet<string> = new Set(
  RR_ACTIVITY_NODES.filter(isPhantomReadinessNode).map((n) => n.id)
);

/**
 * The 25 retired static readiness node ids and the requirements each mapped to.
 * Facts recorded under these ids (older sessions, harvest probes) are re-keyed
 * to the RR activities for the same requirements (expandLegacyReadinessFacts),
 * so they keep scoring and pruning instead of leaking as unknown ids.
 */
export const LEGACY_READINESS_REQUIREMENTS: Record<string, string[]> = {
  'iam-001': ['AC.L2-3.1.13', 'IA.L2-3.5.3'],
  'iam-002': ['AC.L1-3.1.1', 'AC.L1-3.1.2'],
  'iam-003': ['AC.L2-3.1.6', 'IA.L2-3.5.5'],
  'iam-004': ['AC.L2-3.1.12', 'AC.L2-3.1.14'],
  'iam-005': ['AC.L1-3.1.1', 'PS.L2-3.9.2'],
  'ep-001': ['CM.L2-3.4.1', 'CM.L2-3.4.2'],
  'ep-002': ['SI.L1-3.14.1', 'SI.L2-3.14.2'],
  'ep-003': ['CM.L2-3.4.7', 'CM.L2-3.4.8'],
  'ep-004': ['SI.L1-3.14.1', 'CM.L2-3.4.8'],
  'pol-001': ['CA.L2-3.12.4'],
  'pol-002': ['CA.L2-3.12.4', 'AT.L2-3.2.1'],
  'pol-003': ['AT.L2-3.2.1', 'AT.L2-3.2.2'],
  'pol-004': ['RA.L2-3.11.1', 'RA.L2-3.11.2'],
  'mon-001': ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
  'mon-002': ['AU.L2-3.3.5', 'IR.L2-3.6.1'],
  'mon-003': ['AU.L2-3.3.1'],
  'mon-004': ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
  'dp-001': ['MP.L2-3.8.6', 'SC.L2-3.13.10'],
  'dp-002': ['SC.L2-3.13.8'],
  'dp-003': ['MP.L1-3.8.3', 'MP.L2-3.8.9'],
  'dp-004': ['MP.L1-3.8.3'],
  'ir-001': ['IR.L2-3.6.1', 'IR.L2-3.6.3'],
  'ir-002': ['IR.L2-3.6.2'],
  'ir-003': ['IR.L2-3.6.1'],
  'ir-004': ['IR.L2-3.6.1', 'IR.L2-3.6.3'],
};

/** Text, tab and stack gate of the retired nodes (unchanged), for their alias nodes. */
const LEGACY_NODE_META: Record<string, { text: string; cluster: string; applicable_stacks?: string[]; ynu?: boolean }> = {
  'iam-001': { text: 'Does your organization enforce multi-factor authentication (MFA) for all users accessing CUI systems?', cluster: 'identity' },
  'iam-002': { text: 'Does your organization maintain an inventory of authorized users with access to CUI systems?', cluster: 'identity' },
  'iam-003': { text: 'Are privileged user accounts (admin accounts) kept separate from regular user accounts?', cluster: 'identity' },
  'iam-004': { text: 'Is remote access to CUI systems controlled through an approved mechanism (e.g., VPN or Conditional Access)?', cluster: 'identity' },
  'iam-005': { text: 'Does your organization regularly review and revoke access rights when employees change roles or leave?', cluster: 'identity' },
  'ep-001': { text: 'Are all devices accessing CUI enrolled in a mobile device management (MDM) solution such as Microsoft Intune?', cluster: 'endpoint', applicable_stacks: ['microsoft_intune'] },
  'ep-002': { text: 'Is endpoint protection software (antivirus or EDR) deployed on all workstations accessing CUI?', cluster: 'endpoint' },
  'ep-003': { text: 'Are software applications on CUI systems limited to an approved/authorized list?', cluster: 'endpoint' },
  'ep-004': { text: 'Are operating systems and software kept current with security patches within 30 days of release?', cluster: 'endpoint' },
  'pol-001': { text: 'Does your organization have a System Security Plan (SSP) documenting your cybersecurity controls?', cluster: 'policy', ynu: true },
  'pol-002': { text: 'Does your organization have written cybersecurity policies that have been reviewed in the past 12 months?', cluster: 'policy' },
  'pol-003': { text: 'Does your organization conduct annual cybersecurity awareness training for all personnel?', cluster: 'policy' },
  'pol-004': { text: 'Does your organization conduct periodic risk assessments to identify cybersecurity risks?', cluster: 'policy' },
  'mon-001': { text: 'Does your organization collect and review audit/activity logs from IT systems on a regular basis?', cluster: 'monitoring' },
  'mon-002': { text: 'Is there an automated process to alert on suspicious or anomalous activity?', cluster: 'monitoring' },
  'mon-003': { text: 'Are security logs retained for at least 90 days?', cluster: 'monitoring' },
  'mon-004': { text: 'Does your organization use Microsoft Sentinel or another centralized SIEM for log management?', cluster: 'monitoring', applicable_stacks: ['microsoft_sentinel'] },
  'dp-001': { text: 'Is CUI encrypted when stored on laptops, USB drives, or other portable devices?', cluster: 'data_protection' },
  'dp-002': { text: 'Is CUI encrypted in transit when transmitted across networks (e.g., TLS for email and file transfers)?', cluster: 'data_protection' },
  'dp-003': { text: 'Does your organization have controls to prevent unauthorized removal or transfer of CUI (e.g., DLP policies)?', cluster: 'data_protection' },
  'dp-004': { text: 'Is there a documented process for securely disposing of or sanitizing media that contains CUI?', cluster: 'data_protection' },
  'ir-001': { text: 'Does your organization have a documented incident response plan that has been tested in the past year?', cluster: 'incident_response' },
  'ir-002': { text: 'Is there a defined process for reporting security incidents to required stakeholders (e.g., contracting officer)?', cluster: 'incident_response' },
  'ir-003': { text: 'Does your organization track and monitor security incidents from detection through resolution?', cluster: 'incident_response' },
  'ir-004': { text: 'Has your organization conducted a lessons-learned review following any security incident or drill?', cluster: 'incident_response' },
};

/** Legacy id -> the RR activity ids mapping the same requirements. */
export const LEGACY_READINESS_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.entries(LEGACY_READINESS_REQUIREMENTS).map(([id, reqs]) => [
    id,
    RR_ACTIVITY_NODES.filter((n) => n.mapped_requirements.some((r) => reqs.includes(r))).map((n) => n.id),
  ])
);

/** The retired readiness nodes as never-asked alias nodes (see QuestionNode.alias_of). */
export const LEGACY_READINESS_NODES: QuestionNode[] = Object.entries(LEGACY_READINESS_REQUIREMENTS).map(([id, reqs]) => {
  const m = LEGACY_NODE_META[id];
  return {
    id,
    text: m.text,
    options: m.ynu ? YNU_OPTS : YN_OPTS,
    cluster: m.cluster,
    ...(m.applicable_stacks ? { applicable_stacks: m.applicable_stacks } : {}),
    mapped_requirements: reqs,
    alias_of: LEGACY_READINESS_ALIASES[id],
  };
});

/**
 * Re-key facts recorded under a retired static readiness id onto the RR
 * activities for the same requirements (same answer, provenance, confidence,
 * timestamp). Every other fact passes through unchanged.
 */
export function expandLegacyReadinessFacts(facts: InterviewFact[]): InterviewFact[] {
  const out: InterviewFact[] = [];
  for (const f of facts) {
    const aliases = LEGACY_READINESS_ALIASES[f.question_id];
    if (!aliases) {
      out.push(f);
      continue;
    }
    for (const id of aliases) out.push({ ...f, question_id: id });
  }
  return out;
}

export const QUESTION_GRAPH: QuestionNode[] = [
  ...RR_ACTIVITY_NODES,
  // ── CUI Boundary (G-MUSTER-GO-2 M1, rung 1) ───────────────────────────────
  // The boundary questions live in THE question bank (one bank, one fact store,
  // one provenance model — mandatory engineering note). Rung 1 drafts answers to
  // these from discovery footprints (boundaryInference.ts) and asks the human to
  // confirm/correct rather than recall.
  {
    id: 'bnd-001',
    text: 'Does Controlled Unclassified Information (CUI) exist in your environment?',
    options: YNU_OPTS,
    cluster: 'boundary',
    mapped_requirements: ['AC.L1-3.1.1'],
  },
  {
    id: 'bnd-002',
    text: 'Are the systems and repositories where CUI lives identified and scoped (sites, shares, mailboxes)?',
    options: YNU_OPTS,
    cluster: 'boundary',
    mapped_requirements: ['AC.L2-3.1.13', 'MP.L1-3.8.3'],
  },
  {
    id: 'bnd-003',
    text: 'Are the users and groups who handle CUI identified?',
    options: YNU_OPTS,
    cluster: 'boundary',
    mapped_requirements: ['AC.L1-3.1.1', 'AC.L1-3.1.2'],
  },
  // G-MUSTER-PLAN-3 M1 (F8): SIT plan-input residue — one graph, one pruner.
  // These carry mapped_requirements: [] (score-leak safe) and plan_input; they
  // are OPTIONAL for the finish gate (allAnswered ignores plan_input nodes).
  ...SI_PLAN_INPUT_NODES,
  // W4-MU1 (PLAN-3 M3): Tenant Config Profile plan inputs — same contract as
  // the SI nodes (score-leak safe, optional for finish).
  ...TCP_PLAN_INPUT_NODES,
  // FC-MU-2 (MS-5): approver UPN, terms-of-use file, generated initial password.
  ...TCP_PROVISIONING_NODES,
  // MG-08: the CUI boundary bindings still asked (cluster boundary, optional).
  ...CUI_BOUNDARY_NODES,
  // MG-10: the one plan-mode confirm question (Plan Inputs tab, optional).
  PLAN_MODE_NODE,
  // MG-09: the BTC questions no discovery read can evidence (Boundary tab, optional).
  ...BTC_GATE_NODES,
  // MG-16: the Policy Inputs questions nothing discovers, derives or defaults (Policy Inputs tab, optional).
  ...POLICY_INPUT_NODES,
  // MG-07: the retired static readiness ids, never asked (alias_of).
  ...LEGACY_READINESS_NODES,
];
