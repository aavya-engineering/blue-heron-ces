// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// questionRegister.ts — MG-28: build the question register (one row per
// question Muster asks) from QUESTION_GRAPH, the plan-input nodes, the
// derivation tables, and the hand-authored justifications. Pure and
// deterministic: scripts/generate-question-register.ts writes the result to
// questionRegister.json beside the graph; the questionRegister test fails when
// the committed file differs or a graph node has no justification.
import { QUESTION_GRAPH, isPhantomReadinessNode, phantomRequirementIds, type QuestionNode } from './questionGraph';
import { SI_DERIVATIONS } from '../plan/siDerivation';
import { BHD_ARCHETYPES } from '../../__fixtures__/archetypes';
import {
  HARVEST_NODE_IDS,
  NODE_JUSTIFICATIONS,
  PLAN_TAB_QUESTIONS,
  PROFILE_QUESTIONS,
  SI_DEFAULT_SOURCE,
  TO_JUSTIFY,
  type NodeJustification,
} from './questionRegisterJustifications';

export type RegisterRowKind =
  | 'readiness'
  | 'boundary'
  | 'plan-input:si'
  | 'plan-input:tcp'
  | 'plan-input:policy'
  | 'provisioning'
  | 'profile'
  | 'plan-review';

export type RegisterRowStatus = 'justified' | 'candidate' | 'to_justify' | 'unregistered';

export interface RegisterRow {
  id: string;
  kind: RegisterRowKind;
  text: string;
  /** When the operator actually sees the question. */
  asked_when: string;
  /** Plan inputs and some profile fields are not required to finish the interview. */
  optional_for_finish: boolean;
  output_fields: string[];
  sources_tried: string[];
  /** Grounded reason, "candidate for derivation: MG-nn", or "to justify (BHD)". */
  why_not_derived: string;
  status: RegisterRowStatus;
  /**
   * FIN-17b (NS-audit F-10): the row's L1/L2-labelled practice ids that the ces-shared 110-control reference does not
   * have (present only when there are any). The row is kept (an answers file or a recorded fact may still carry
   * the id), but FIN-26b stops the interview asking it: the L1 twin is the practice (questionGraphService).
   */
  phantom_requirement_ids?: string[];
}

export interface QuestionRegister {
  register: 'muster-question-register';
  rule: string;
  counts: Record<'rows' | 'graph_nodes' | 'profile' | 'plan_tab' | 'phantom' | RegisterRowStatus, number> & {
    candidate_by_item: Record<string, number>;
  };
  rows: RegisterRow[];
}

const RULE = 'discover → infer → default → ask. A PR that adds a question adds a register row (docs/QUESTION_REGISTER.md).';

const SI_DERIVED_IDS = new Set(SI_DERIVATIONS.map((d) => d.questionId));

// MG-21: only BHD's archetype content is a real source; the test archetype is not.
const ARCHETYPE_NODE_IDS = new Set(
  BHD_ARCHETYPES.flatMap((a) => Object.keys(a.defaults))
);

// FIN-17b (NS-audit F-10, AUDIT-NONSTACK.md section 5): rows keyed to L1/L2 practice ids the ces-shared reference
// lacks carry phantom_requirement_ids. The helpers live in questionGraph.ts (FIN-26b), because the interview now
// uses them too: such an activity is never asked (its L1 twin is), but its row stays.
export { phantomRequirementIds, isPhantomReadinessNode };

function kindOf(n: QuestionNode): RegisterRowKind {
  if (n.cluster === 'boundary') return 'boundary';
  if (n.plan_input?.contract === 'si_baseline') return 'plan-input:si';
  if (n.plan_input?.contract === 'tenant_config_profile') return 'plan-input:tcp';
  if (n.plan_input?.contract === 'policy_inputs') return 'plan-input:policy';
  if (n.plan_input) return 'provisioning';
  return 'readiness';
}

function ownOutputs(n: QuestionNode): string[] {
  if (n.plan_input) {
    const { contract, field } = n.plan_input;
    return [field.startsWith(`${contract}.`) ? field : `${contract}.${field}`];
  }
  return n.mapped_requirements.map((r) => `requirement_results[${r}].status`);
}

function nodeSources(n: QuestionNode, kind: RegisterRowKind, j: NodeJustification | undefined): string[] {
  const s: string[] = [];
  if (kind === 'readiness') {
    s.push('discovery: registry reads joined on mapped_requirements, met verdict only (discoveryFactJoin)');
  }
  if (kind === 'boundary' && !n.plan_input) {
    s.push('discovery footprints: unconfirmed draft only (boundaryInference)');
  }
  if (kind === 'boundary' && n.plan_input?.contract === 'btc_confirmation') {
    // MG-09: a BTC question no discovery read evidences (btcGateNodes.ts).
    s.push('BTC-lite: SI/CUI derivation (btcSICUIDerivation), discovery captures (btcEvidenceMap.json: none for this question)');
  } else if (kind === 'boundary' && n.plan_input) {
    // MG-08: a CUI boundary binding, never drafted from footprints.
    s.push('CUI boundary builder: plan mode, SI defaults (cuiSIDerivation), CUI bank recommended value (cuiBoundaryAdapter)');
  }
  if (n.applicable_stacks?.length) {
    s.push(`service inventory: pruned unless ${n.applicable_stacks.join(' / ')} declared (questionGraphService)`);
  }
  if (HARVEST_NODE_IDS.includes(n.id)) {
    s.push('harvest: Graph probe prefill (muster-api harvestService)');
  }
  if (ARCHETYPE_NODE_IDS.has(n.id)) {
    s.push('archetype prior: unconfirmed draft (archetypePrefill)');
  }
  if (SI_DERIVED_IDS.has(n.id)) {
    s.push('SI derivation table (siDerivation.SI_DERIVATIONS)');
  }
  if (kind === 'plan-input:si') s.push(SI_DEFAULT_SOURCE);
  s.push(...(j?.extraSources ?? []));
  return s;
}

function askedWhen(n: QuestionNode, kind: RegisterRowKind): string {
  if (n.id === 'G-01') return 'never in practice (always derived)';
  if (n.alias_of) return 'never (retired id; its facts are re-keyed onto the RR activities)';
  // FIN-26b (NS-audit F-10): a phantom L2-twin activity is never asked; its L1 twin is.
  if (isPhantomReadinessNode(n)) return 'never (phantom L2 twin of an L1 practice; the L1 twin activity is asked or derived instead)';
  const parts: string[] = [];
  if (n.applicable_stacks?.length) parts.push(`only when ${n.applicable_stacks.join(' / ')} is declared`);
  if (SI_DERIVED_IDS.has(n.id)) parts.push('when the SI derivation returns nothing (or to override it)');
  else if (kind === 'readiness' && n.id.startsWith('RR-ACT-')) {
    // MG-07: scenario-selected, cascade-unsettled activities only.
    parts.push('only when the scenario selects it and the bulk cascade cannot settle it; unless pruned by a covering fact');
  } else if (kind === 'boundary' && n.plan_input?.contract === 'btc_confirmation') {
    // MG-09: BTC-lite asks only the questions no discovery read evidences.
    parts.push('with the BTC confirmation (no discovery read evidences it); the BTC is built only when discovery captured evidence and a CUI boundary exists');
  } else if (kind === 'boundary' && n.plan_input) {
    // MG-08: the CUI boundary bindings are boundary-group questions, not footprint drafts.
    parts.push('with the CUI boundary group (a binding the boundary builder cannot resolve); unless pruned by a covering fact');
  } else if (kind === 'readiness' || kind === 'boundary') parts.push('unless pruned by a covering fact');
  if (n.plan_input) parts.push('optional plan input');
  return parts.join('; ');
}

function judge(j: NodeJustification | undefined): { why: string; status: RegisterRowStatus } {
  if (!j) return { why: 'UNREGISTERED: add an entry to questionRegisterJustifications.ts', status: 'unregistered' };
  if (j.candidate?.length) return { why: `candidate for derivation: ${j.candidate.join(', ')}`, status: 'candidate' };
  if (!j.why || j.why === TO_JUSTIFY) return { why: TO_JUSTIFY, status: 'to_justify' };
  return { why: j.why, status: 'justified' };
}

function nodeRow(n: QuestionNode): RegisterRow {
  const kind = kindOf(n);
  const j = NODE_JUSTIFICATIONS[n.id];
  const { why, status } = judge(j);
  return {
    id: n.id,
    kind,
    text: n.text,
    asked_when: askedWhen(n, kind),
    optional_for_finish: Boolean(n.plan_input),
    output_fields: [...ownOutputs(n), ...(j?.extraOutputs ?? [])],
    sources_tried: nodeSources(n, kind, j),
    why_not_derived: why,
    status,
    ...(isPhantomReadinessNode(n) ? { phantom_requirement_ids: phantomRequirementIds(n) } : {}),
  };
}

/** Build the register. `graph` is injectable for tests; production uses QUESTION_GRAPH. */
export function buildQuestionRegister(graph: QuestionNode[] = QUESTION_GRAPH): QuestionRegister {
  const rows: RegisterRow[] = graph.map(nodeRow);
  for (const p of PROFILE_QUESTIONS) {
    const { why, status } = judge(p);
    rows.push({
      id: p.id,
      kind: 'profile',
      text: p.text,
      asked_when: 'Profile tab (AssessmentPage)',
      optional_for_finish: p.optional,
      output_fields: [...p.outputs],
      sources_tried: [...p.sources],
      why_not_derived: why,
      status,
    });
  }
  // MG-09 / MG-16 (e): the Plan tab's capture-review questions (not graph nodes).
  for (const p of PLAN_TAB_QUESTIONS) {
    const { why, status } = judge(p);
    rows.push({
      id: p.id,
      kind: 'plan-review',
      text: p.text,
      asked_when: 'Plan tab capture review, only for a BTC question a discovery capture evidences',
      optional_for_finish: p.optional,
      output_fields: [...p.outputs],
      sources_tried: [...p.sources],
      why_not_derived: why,
      status,
    });
  }
  const count = (s: RegisterRowStatus) => rows.filter((r) => r.status === s).length;
  const byItem: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== 'candidate') continue;
    for (const item of r.why_not_derived.replace('candidate for derivation: ', '').split(', ')) {
      byItem[item] = (byItem[item] ?? 0) + 1;
    }
  }
  const candidate_by_item = Object.fromEntries(Object.keys(byItem).sort().map((k) => [k, byItem[k]]));
  return {
    register: 'muster-question-register',
    rule: RULE,
    counts: {
      rows: rows.length,
      graph_nodes: graph.length,
      profile: PROFILE_QUESTIONS.length,
      plan_tab: PLAN_TAB_QUESTIONS.length,
      phantom: rows.filter((r) => r.phantom_requirement_ids).length,
      justified: count('justified'),
      candidate: count('candidate'),
      to_justify: count('to_justify'),
      unregistered: count('unregistered'),
      candidate_by_item,
    },
    rows,
  };
}

/** The register as the committed file holds it (stable formatting, trailing newline). */
export function serializeQuestionRegister(reg: QuestionRegister): string {
  return `${JSON.stringify(reg, null, 2)}\n`;
}
