// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// readinessScope.ts — MG-07 (decision D5): readiness covers all 165 RR
// activities, filtered per scenario as Planner does, and asks only the residue
// the bulk cascade and discovery cannot settle.
//
//   scenario SI   — the SI Baseline fields Planner's selection and cascade read,
//                   from the session's facts: an explicit answer, else Muster's
//                   SI derivation (plan/siDerivation), else 'unknown' (which
//                   never excludes an activity). Real SI layout, so the
//                   vendored cascade reads what Planner's reads.
//   selection     — the vendored Planner questionSetGenerator over the 165
//                   activities (selected + excluded with reasons).
//   cascade       — the vendored Planner bulk cascade (deriveActionStatuses).
//                   A requirement is cascade-settled when at least one of its
//                   actions derives from a rule (license/scope gate, inherent,
//                   SI override, BTC flag, preamble); it is residue when every
//                   action fell to the archetype fallback (no rule applied).
//   residue       — selected activities with a residue requirement, plus the
//                   SSP foundation activity (the only input to policy_doc_state).
// Sync and fetch-free over readinessIndex.json except the selection, which
// awaits the vendored (async) generator.
import type { InterviewFact } from '@/shared/types/engagement';
import type { SIBaseline, RRQuestionSet } from '@/features/plan/engine/shared/types/artifacts';
import type { PreambleAnswers } from '@/features/plan/engine/rrt/types';
import type { ImplementationPatterns, VendorPlaybook } from '@/features/plan/engine/shared/types/domain';
import type { TechRefIndex } from '@/features/plan/engine/shared/services/techRefIndex';
import { generateRRQuestionSet, type DomainKnowledge } from '@/features/plan/engine/sit/services/questionSetGenerator';
import { deriveActionStatuses } from '@/features/plan/engine/rrt/services/bulkAnswerDerivation';
import { deriveSitFacts } from '@/features/plan/siDerivation';
import { bankFromIndex, type ReadinessIndex } from './readinessIndex';
import indexJson from './readinessIndex.json';

export const READINESS_INDEX = indexJson as unknown as ReadinessIndex;

/** RR activity question ids (the generated readiness nodes) carry this prefix. */
export const RR_ACTIVITY_PREFIX = 'RR-ACT-';

/** The SSP foundation activity: always asked until answered (feeds policy_doc_state). */
export const SSP_ACTIVITY_ID = 'RR-ACT-UNIV-SSP';

/** SI question id -> the si_baseline section/field the selection and cascade read. */
export const SCENARIO_FIELDS: Record<string, [string, string]> = {
  'G-01': ['target', 'target_cmmc_level'],
  'G-02': ['target', 'cui_presence'],
  'G-05': ['assessment', 'assessment_route'],
  'G-07': ['scope', 'boundary_strategy'],
  'G-08': ['scope', 'deployment_posture'],
  'S-12': ['operations', 'collaboration_mode'],
  'S-13': ['operations', 'byod_posture'],
  'S-16': ['evidence', 'evidence_posture_target'],
  'S-20': ['dependencies', 'tenant_model_preference'],
  'S-24': ['risk_acceptance', 'poam_policy_intent'],
};

/**
 * The scenario SI Baseline from a session's facts. Precedence mirrors the plan
 * compile: an explicit answer (not `derived:si:*`, not "unsure") beats Muster's
 * SI derivation; a field neither answered nor derived is left out ('unknown'
 * to Planner's selection, which then excludes nothing on it).
 */
export function scenarioSiBaseline(facts: InterviewFact[], selectedStacks: string[]): SIBaseline {
  const values = new Map<string, string>();
  for (const f of deriveSitFacts({ selectedStacks, facts }).facts) {
    if (SCENARIO_FIELDS[f.question_id]) values.set(f.question_id, f.answer);
  }
  for (const f of facts) {
    if (!SCENARIO_FIELDS[f.question_id]) continue;
    if (f.provenance.startsWith('derived:si:') || f.confidence === 'unknown') continue;
    if (!f.answer || f.answer === 'unknown' || f.answer === 'unsure') continue;
    values.set(f.question_id, f.answer);
  }
  const si: Record<string, Record<string, string>> = {};
  for (const [id, [section, field]] of Object.entries(SCENARIO_FIELDS)) {
    const v = values.get(id);
    if (v === undefined) continue;
    (si[section] ??= {})[field] = v;
  }
  return { ces: { version: '1.0.0' }, si_baseline: si } as unknown as SIBaseline;
}

export interface ReadinessSelection {
  selected: string[];
  excluded: Array<{ activity_id: string; reason: string }>;
}

const selectionCache = new Map<string, ReadinessSelection>();

/** Planner's activity selection over all 165 RR activities for this scenario (vendored generator). */
export async function selectActivities(si: SIBaseline): Promise<ReadinessSelection> {
  const key = JSON.stringify((si as unknown as { si_baseline: unknown }).si_baseline);
  const hit = selectionCache.get(key);
  if (hit) return hit;
  const qs = await generateRRQuestionSet(si, bankFromIndex(READINESS_INDEX), 1);
  const sel = qs.ces.selection;
  const out: ReadinessSelection = {
    selected: sel.selected_activity_ids.filter((id) => id !== 'none'),
    excluded: sel.excluded_activity_ids.map((e) => ({ activity_id: e.activity_id, reason: e.reason })),
  };
  selectionCache.set(key, out);
  return out;
}

/**
 * The scenario-specific RR Question Set artifact (Planner's CES_RR_QUESTION_SET),
 * from the full RR bank and the domain knowledge bases the caller loaded.
 */
export async function buildRRQuestionSet(
  si: SIBaseline,
  rrQuestionBank: unknown,
  domainKnowledge?: DomainKnowledge,
  cesId?: string
): Promise<RRQuestionSet> {
  return generateRRQuestionSet(si, rrQuestionBank, 1, undefined, domainKnowledge, null, cesId);
}

export interface CascadeScope {
  /** requirement id -> true when a rule settled at least one of its actions. */
  settled: Set<string>;
  /** requirement ids whose every action fell to the archetype fallback. */
  residue: Set<string>;
}

/** Which requirements the vendored bulk cascade settles for this preamble + SI. */
export function cascadeScope(
  preamble: PreambleAnswers,
  si: SIBaseline,
  techRef?: TechRefIndex,
  knowledge: { patterns: ImplementationPatterns; playbook: VendorPlaybook } = {
    patterns: READINESS_INDEX.patterns as unknown as ImplementationPatterns,
    playbook: READINESS_INDEX.playbook as unknown as VendorPlaybook,
  }
): CascadeScope {
  const derived = deriveActionStatuses(knowledge.patterns, knowledge.playbook, preamble, si, techRef);
  const ruled = new Set<string>();
  const all = new Set<string>();
  for (const a of derived) {
    all.add(a.practice_id);
    if (a.derivation_source !== 'archetype_default') ruled.add(a.practice_id);
  }
  return { settled: ruled, residue: new Set([...all].filter((r) => !ruled.has(r))) };
}

/** A selected activity is asked when the cascade cannot settle one of its requirements (or it is the SSP). */
export function residueActivities(selected: string[], cascade: CascadeScope): Set<string> {
  const byId = new Map(READINESS_INDEX.activities.map((a) => [a.id, a]));
  const out = new Set<string>();
  for (const id of selected) {
    const reqs = byId.get(id)?.mapped_requirements ?? [];
    if (id === SSP_ACTIVITY_ID || reqs.some((r) => cascade.residue.has(r))) out.add(id);
  }
  return out;
}
