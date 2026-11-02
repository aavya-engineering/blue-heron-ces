// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// sessionPosture.ts — MG-03 (2C-0): the ONE readiness posture of a session.
//
// Every surface reads this: the Result screen, the Readiness tab and the
// readiness-result export (derived.requirement_results, sprs_now, gaps), the
// Plan compile (the gap compile and the MP's embedded posture) and the headless
// runner's plan-trace.json. It is one scoreFacts call over the same inputs:
//   routed scorable facts + the compiled SI Baseline + the session's preamble
//   + the compiler banks' patterns, playbook and tech-ref index.
//
// Statuses are the vendored posture generator's four: met, partial, not_met,
// unknown. `partial` is the generator's rule (ces-spine postureGenerator
// mergeStatuses / classifyAnswerString): a requirement is partial when no
// contributing answer is not_met and at least one is partial — a cascade
// action derived as partially implemented, or an answer whose value reads
// partial / in_progress. Merge order: not_met > partial > unknown > met.
// MG-09: after scoring, the session's discovery captures are this posture's
// evidence; a requirement they cover that is still unknown becomes partial.
import type { InterviewFact, InterviewSession, Engagement } from '@/shared/types/engagement';
import type { QuestionNode } from '@/features/interview/questionGraphService';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { routeFacts } from '@/features/scoring/factRouter';
import { scorableFacts } from '@/features/scoring/draftSemantics';
import { scoreFacts, computeConservativeScore, type ReadinessPosture } from '@/features/scoring/scoringService';
import { discoveryEvidenceItems, type DiscoveryEvidenceItem } from '@/features/discovery/discoveryEvidence';
import { raisePostureWithEvidence } from './btc/btcLite';
import { buildTechRefIndex } from '@/features/plan/engine/shared/services/techRefIndex';
import type { ImplementationPatterns, VendorPlaybook } from '@/features/plan/engine/shared/types/domain';
import type { PreambleAnswers } from '@/features/plan/engine/rrt/types';
import type { SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import type { SITAnswer } from '@/features/plan/engine/types/siBaseline';
import { db } from '@/shared/db/schema';
import { loadCompilerBanks } from './compilerBanks';
import type { CompilerBanks } from './tenantManifestAdapter';
import { deriveSitFacts, residueIds, type DerivationContext } from './siDerivation';
import { buildSiBaselineFromAnswers, sitAnswersFromFacts } from './siBaselineAdapter';
import { archetypeSitFacts } from './archetypePriors';
import { SI_FIELD_LABELS } from './siResidue';

export type SiFieldSource =
  | { source: 'derived'; provenance: string; answer: string }
  | { source: 'answered'; answer: string }
  | { source: 'archetype'; provenance: string; answer: string }
  | { source: 'defaulted' };

export interface SessionPosture {
  posture: ReadinessPosture;
  conservativeScore: number;
  /** The SI Baseline the posture was scored over (the compile builds the same one). */
  compiledSi: SIBaseline;
  sitAnswers: Record<string, SITAnswer>;
  /** SI bank questions neither derived, answered nor archetype-filled. */
  defaultedInputs: string[];
  siFieldSources: Record<string, SiFieldSource>;
  /** MG-09: the session's discovery captures as evidence items (BTC-lite input; the posture cites them). */
  discoveryEvidence: DiscoveryEvidenceItem[];
  /** MG-09: requirements the captured evidence moved from unknown to partial. */
  evidenceRaised: string[];
}

/** The derivation context for a session — the Muster sources siDerivation reads. */
export function derivationContextFor(
  session: InterviewSession,
  engagementKind?: string | null
): DerivationContext {
  return {
    selectedStacks: session.selected_stacks ?? [],
    // FC-MU (MU-10): the same scorable facts the interview derives from.
    facts: scorableFacts(session.facts),
    preamble: session.preamble ?? null,
    manifest: session.readiness_manifest
      ? {
          mode: session.readiness_manifest.mode,
          tenant_kind: session.readiness_manifest.tenant_kind,
          tenant_slug: session.readiness_manifest.tenant_slug,
        }
      : null,
    engagementKind: engagementKind ?? null,
  };
}

/** Session -> SIT answers -> compiled SI Baseline -> the one scoreFacts posture. */
export async function computeSessionPosture(
  session: InterviewSession,
  engagement: Pick<Engagement, 'id' | 'engagement_kind'>,
  graph: QuestionNode[],
  banks: CompilerBanks
): Promise<SessionPosture> {
  // M1: derive the SIT answers Muster observes; add any residue answered in the
  // interview; the still-unanswered residue is the honest defaulted list.
  const derived = deriveSitFacts(derivationContextFor(session, engagement.engagement_kind));
  const allBankIds = (banks.siQuestionBank?.ces?.question_bank?.questions ?? []).map((q) => q.id);
  const bankIds = new Set(allBankIds);
  const derivedIdSet = new Set(derived.derivedIds);
  // FC-MU (MU-10) precedence, founder default 2026-09-27: an EXPLICIT operator
  // answer always beats a derivation. A SIT fact the session holds for a bank
  // question wins over the derived value for that question; an "I'm not sure"
  // (confidence unknown) is not an explicit answer and never overrides one.
  const answeredFacts: InterviewFact[] = scorableFacts(session.facts).filter(
    (f) =>
      bankIds.has(f.question_id) &&
      !f.provenance.startsWith('derived:si:') &&
      (!derivedIdSet.has(f.question_id) || f.confidence !== 'unknown')
  );
  const answeredIds = new Set(answeredFacts.map((f) => f.question_id));
  const derivedKept = derived.facts.filter((f) => !answeredIds.has(f.question_id));
  // MG-21: after discovery and inference, the selected archetype's priors fill
  // only the bank questions still empty (answered > derived > archetype).
  const archetypeFacts = archetypeSitFacts(
    session.archetype_id,
    graph,
    bankIds,
    new Set([...answeredIds, ...derived.derivedIds])
  );
  const archetypeIds = new Set(archetypeFacts.map((f) => f.question_id));
  const sitAnswers = sitAnswersFromFacts(
    [...derivedKept, ...archetypeFacts, ...answeredFacts],
    banks.siQuestionBank ?? {}
  );

  // Honest residue: every bank question neither derived, answered nor archetype-filled.
  const defaultedInputs = residueIds(allBankIds, derived.derivedIds)
    .filter((id) => !answeredIds.has(id) && !archetypeIds.has(id))
    .map((id) => SI_FIELD_LABELS[id] ?? id);

  // FC-MU (MU-10): the per-question source report (same inputs as sitAnswers).
  const siFieldSources: Record<string, SiFieldSource> = {};
  const lastAnswer = new Map(answeredFacts.map((f) => [f.question_id, f]));
  const derivedById = new Map(derivedKept.map((f) => [f.question_id, f]));
  const archetypeById = new Map(archetypeFacts.map((f) => [f.question_id, f]));
  for (const id of allBankIds) {
    const answered = lastAnswer.get(id);
    const d = derivedById.get(id);
    const a = archetypeById.get(id);
    siFieldSources[id] =
      answered !== undefined
        ? // MG-13: a harvest pre-fill on an SI node (S-27/S-28) is a discovery derivation, not an answer.
          answered.provenance === 'auto_detected'
          ? { source: 'derived', provenance: `derived:si:discovery:${answered.source ?? 'harvest'}`, answer: answered.answer }
          : { source: 'answered', answer: answered.answer }
        : d
          ? { source: 'derived', provenance: d.provenance, answer: d.answer }
          : a
            ? { source: 'archetype', provenance: a.provenance, answer: a.answer }
            : { source: 'defaulted' };
  }

  // MG-07 / MG-03: the full cascade posture over the compiled SI Baseline, with
  // the session's preamble when it holds one. D2: drafts are excluded and one
  // fact per question is routed BEFORE scoring.
  const compiledSi = buildSiBaselineFromAnswers(sitAnswers, banks.siQuestionBank ?? {}, engagement.id);
  const scored = await scoreFacts(
    routeFacts(scorableFacts(session.facts)),
    graph,
    session.selected_stacks ?? [],
    {
      siBaseline: compiledSi,
      // The snapshot is Planner's preamble with its enums widened to strings.
      preamble: (session.preamble ?? null) as PreambleAnswers | null,
      knowledge: { patterns: banks.patterns as ImplementationPatterns, playbook: banks.playbook as VendorPlaybook },
      techRef: banks.techRef ? buildTechRefIndex(banks.techRef) : null,
    }
  );
  // MG-09 (BTC-lite): each discovery capture (raw_capture_ref) is evidence for
  // the requirements its observations cover; a covered requirement still
  // unknown moves to partial (Planner postureGenerator ~27-50), on THIS posture.
  const posture = scored.posture;
  // MG-12: the posture carries the engagement's cesId, as the SI Baseline and TCP do.
  posture.ces.cesId = engagement.id;
  const discoveryEvidence = discoveryEvidenceItems(
    session.discovery_observations,
    session.completed_at ?? session.created_at
  );
  const evidenceRaised = raisePostureWithEvidence(posture, discoveryEvidence);
  const conservativeScore = evidenceRaised.length > 0 ? computeConservativeScore(posture) : scored.conservativeScore;
  return {
    posture,
    conservativeScore,
    compiledSi,
    sitAnswers,
    defaultedInputs,
    siFieldSources,
    discoveryEvidence,
    evidenceRaised,
  };
}

/** Dexie -> computeSessionPosture (the Result screen and the readiness export). */
export async function loadSessionPosture(sessionId: string): Promise<SessionPosture> {
  const session = await db.interview_sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const party = await db.assessed_parties.get(session.party_id);
  if (!party) throw new Error(`Party not found: ${session.party_id}`);
  const engagement = await db.engagements.get(party.engagement_id);
  if (!engagement) throw new Error(`Engagement not found: ${party.engagement_id}`);
  const graph = await loadQuestionGraph(session.selected_stacks ?? []);
  return computeSessionPosture(session, engagement, graph, await loadCompilerBanks());
}

/** The posture's per-requirement statuses (the generator's empty-set placeholder dropped). */
export function postureRequirementRows(
  posture: ReadinessPosture
): Array<{ requirement_id: string; status: 'met' | 'partial' | 'not_met' | 'unknown' }> {
  return posture.ces.requirement_results
    .filter((r) => r.requirement_id !== 'placeholder')
    .map((r) => ({ requirement_id: r.requirement_id, status: r.status as 'met' | 'partial' | 'not_met' | 'unknown' }));
}

/** Status counts over posture rows — the plan trace's requirement_results (runbook V4 compares them to the MP's summary). */
export function postureCounts(rows: Array<{ status: string }>): {
  total: number;
  met: number;
  partial: number;
  not_met: number;
  unknown: number;
} {
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return { total: rows.length, met: count('met'), partial: count('partial'), not_met: count('not_met'), unknown: count('unknown') };
}
