// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Static question graph derived from public/knowledge/primed RR Question Bank.yaml.
// Questions are pre-selected representative items covering the six key CMMC clusters.
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

export const QUESTION_GRAPH: QuestionNode[] = [
  // ── Identity / Access Management ─────────────────────────────────────────
  {
    id: 'iam-001',
    text: 'Does your organization enforce multi-factor authentication (MFA) for all users accessing CUI systems?',
    options: YN_OPTS,
    cluster: 'identity',
    mapped_requirements: ['AC.L2-3.1.13', 'IA.L2-3.5.3'],
  },
  {
    id: 'iam-002',
    text: 'Does your organization maintain an inventory of authorized users with access to CUI systems?',
    options: YN_OPTS,
    cluster: 'identity',
    mapped_requirements: ['AC.L1-3.1.1', 'AC.L1-3.1.2'],
  },
  {
    id: 'iam-003',
    text: 'Are privileged user accounts (admin accounts) kept separate from regular user accounts?',
    options: YN_OPTS,
    cluster: 'identity',
    mapped_requirements: ['AC.L2-3.1.6', 'IA.L2-3.5.5'],
  },
  {
    id: 'iam-004',
    text: 'Is remote access to CUI systems controlled through an approved mechanism (e.g., VPN or Conditional Access)?',
    options: YN_OPTS,
    cluster: 'identity',
    mapped_requirements: ['AC.L2-3.1.12', 'AC.L2-3.1.14'],
  },
  {
    id: 'iam-005',
    text: 'Does your organization regularly review and revoke access rights when employees change roles or leave?',
    options: YN_OPTS,
    cluster: 'identity',
    mapped_requirements: ['AC.L1-3.1.1', 'PS.L2-3.9.2'],
  },
  // ── Endpoint Management ───────────────────────────────────────────────────
  {
    id: 'ep-001',
    text: 'Are all devices accessing CUI enrolled in a mobile device management (MDM) solution such as Microsoft Intune?',
    options: YN_OPTS,
    cluster: 'endpoint',
    applicable_stacks: ['microsoft_intune'],
    mapped_requirements: ['CM.L2-3.4.1', 'CM.L2-3.4.2'],
  },
  {
    id: 'ep-002',
    text: 'Is endpoint protection software (antivirus or EDR) deployed on all workstations accessing CUI?',
    options: YN_OPTS,
    cluster: 'endpoint',
    mapped_requirements: ['SI.L1-3.14.1', 'SI.L2-3.14.2'],
  },
  {
    id: 'ep-003',
    text: 'Are software applications on CUI systems limited to an approved/authorized list?',
    options: YN_OPTS,
    cluster: 'endpoint',
    mapped_requirements: ['CM.L2-3.4.7', 'CM.L2-3.4.8'],
  },
  {
    id: 'ep-004',
    text: 'Are operating systems and software kept current with security patches within 30 days of release?',
    options: YN_OPTS,
    cluster: 'endpoint',
    mapped_requirements: ['SI.L1-3.14.1', 'CM.L2-3.4.8'],
  },
  // ── Policy / Governance ───────────────────────────────────────────────────
  {
    id: 'pol-001',
    text: 'Does your organization have a System Security Plan (SSP) documenting your cybersecurity controls?',
    options: YNU_OPTS,
    cluster: 'policy',
    mapped_requirements: ['CA.L2-3.12.4'],
  },
  {
    id: 'pol-002',
    text: 'Does your organization have written cybersecurity policies that have been reviewed in the past 12 months?',
    options: YN_OPTS,
    cluster: 'policy',
    mapped_requirements: ['CA.L2-3.12.4', 'AT.L2-3.2.1'],
  },
  {
    id: 'pol-003',
    text: 'Does your organization conduct annual cybersecurity awareness training for all personnel?',
    options: YN_OPTS,
    cluster: 'policy',
    mapped_requirements: ['AT.L2-3.2.1', 'AT.L2-3.2.2'],
  },
  {
    id: 'pol-004',
    text: 'Does your organization conduct periodic risk assessments to identify cybersecurity risks?',
    options: YN_OPTS,
    cluster: 'policy',
    mapped_requirements: ['RA.L2-3.11.1', 'RA.L2-3.11.2'],
  },
  // ── Monitoring / SIEM ─────────────────────────────────────────────────────
  {
    id: 'mon-001',
    text: 'Does your organization collect and review audit/activity logs from IT systems on a regular basis?',
    options: YN_OPTS,
    cluster: 'monitoring',
    mapped_requirements: ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
  },
  {
    id: 'mon-002',
    text: 'Is there an automated process to alert on suspicious or anomalous activity?',
    options: YN_OPTS,
    cluster: 'monitoring',
    mapped_requirements: ['AU.L2-3.3.5', 'IR.L2-3.6.1'],
  },
  {
    id: 'mon-003',
    text: 'Are security logs retained for at least 90 days?',
    options: YN_OPTS,
    cluster: 'monitoring',
    mapped_requirements: ['AU.L2-3.3.1'],
  },
  {
    id: 'mon-004',
    text: 'Does your organization use Microsoft Sentinel or another centralized SIEM for log management?',
    options: YN_OPTS,
    cluster: 'monitoring',
    applicable_stacks: ['microsoft_sentinel'],
    mapped_requirements: ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
  },
  // ── Data Protection ───────────────────────────────────────────────────────
  {
    id: 'dp-001',
    text: 'Is CUI encrypted when stored on laptops, USB drives, or other portable devices?',
    options: YN_OPTS,
    cluster: 'data_protection',
    mapped_requirements: ['MP.L2-3.8.6', 'SC.L2-3.13.10'],
  },
  {
    id: 'dp-002',
    text: 'Is CUI encrypted in transit when transmitted across networks (e.g., TLS for email and file transfers)?',
    options: YN_OPTS,
    cluster: 'data_protection',
    mapped_requirements: ['SC.L2-3.13.8'],
  },
  {
    id: 'dp-003',
    text: 'Does your organization have controls to prevent unauthorized removal or transfer of CUI (e.g., DLP policies)?',
    options: YN_OPTS,
    cluster: 'data_protection',
    mapped_requirements: ['MP.L1-3.8.3', 'MP.L2-3.8.9'],
  },
  {
    id: 'dp-004',
    text: 'Is there a documented process for securely disposing of or sanitizing media that contains CUI?',
    options: YN_OPTS,
    cluster: 'data_protection',
    mapped_requirements: ['MP.L1-3.8.3'],
  },
  // ── Incident Response ─────────────────────────────────────────────────────
  {
    id: 'ir-001',
    text: 'Does your organization have a documented incident response plan that has been tested in the past year?',
    options: YN_OPTS,
    cluster: 'incident_response',
    mapped_requirements: ['IR.L2-3.6.1', 'IR.L2-3.6.3'],
  },
  {
    id: 'ir-002',
    text: 'Is there a defined process for reporting security incidents to required stakeholders (e.g., contracting officer)?',
    options: YN_OPTS,
    cluster: 'incident_response',
    mapped_requirements: ['IR.L2-3.6.2'],
  },
  {
    id: 'ir-003',
    text: 'Does your organization track and monitor security incidents from detection through resolution?',
    options: YN_OPTS,
    cluster: 'incident_response',
    mapped_requirements: ['IR.L2-3.6.1'],
  },
  {
    id: 'ir-004',
    text: 'Has your organization conducted a lessons-learned review following any security incident or drill?',
    options: YN_OPTS,
    cluster: 'incident_response',
    mapped_requirements: ['IR.L2-3.6.1', 'IR.L2-3.6.3'],
  },
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
];
