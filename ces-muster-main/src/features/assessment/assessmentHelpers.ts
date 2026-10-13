// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { QuestionNode } from '@/features/interview/questionGraphService';
import type { FactAttestation, InterviewFact } from '@/shared/types/engagement';

/** Display labels for question-graph cluster keys, in canonical tab order. */
export const CLUSTER_LABELS: Record<string, string> = {
  boundary: 'CUI Boundary',
  identity: 'Identity & Access',
  endpoint: 'Endpoints',
  policy: 'Policy & Governance',
  monitoring: 'Monitoring',
  data_protection: 'Data Protection',
  incident_response: 'Incident Response',
  // G-MUSTER-PLAN-3 M1 (F8): SIT plan-input residue cluster. Optional for finish.
  'plan-input:si': 'Plan Inputs',
  // W4-MU1 (PLAN-3 M3): Tenant Config Profile plan inputs. Optional for finish.
  'plan-input:tcp': 'Tenant Config',
};

export interface ClusterGroup {
  cluster: string;
  label: string;
  questions: QuestionNode[];
}

/**
 * Group a filtered question graph into cluster tabs, preserving graph order.
 * Clusters with zero questions (all filtered out by stack selection) produce
 * no tab — the tab set is derived from prior answers.
 */
export function groupByCluster(questions: QuestionNode[]): ClusterGroup[] {
  const groups: ClusterGroup[] = [];
  const byCluster = new Map<string, ClusterGroup>();
  for (const q of questions) {
    let group = byCluster.get(q.cluster);
    if (!group) {
      group = { cluster: q.cluster, label: CLUSTER_LABELS[q.cluster] ?? q.cluster, questions: [] };
      byCluster.set(q.cluster, group);
      groups.push(group);
    }
    group.questions.push(q);
  }
  return groups;
}

/** Count of the given questions that have an answer recorded. */
export function answeredCount(questions: QuestionNode[], answers: Record<string, string>): number {
  return questions.reduce((n, q) => (answers[q.id] !== undefined ? n + 1 : n), 0);
}

/** True when every given question has an answer recorded. */
export function allAnswered(questions: QuestionNode[], answers: Record<string, string>): boolean {
  return questions.length > 0 && answeredCount(questions, answers) === questions.length;
}

/**
 * Build the facts array for persistence from the answers map.
 * Only the given questions contribute facts. The interview passes the
 * STACK-FILTERED graph (FC-MU-3): answers to questions hidden by a later
 * service change are excluded, while a question hidden because a prefill
 * already answers it is kept (its answer is saved and scores).
 *
 * Optional `provenances` and `confidences` maps override the defaults per question.
 * When absent, provenance defaults to 'operator_interview' and confidence to
 * 'high' (or 'unknown' for explicitly unknown answers).
 */
export function factsFromAnswers(
  questions: QuestionNode[],
  answers: Record<string, string>,
  provenances?: Record<string, string>,
  confidences?: Record<string, InterviewFact['confidence']>,
  attestations?: Record<string, FactAttestation>,
  sources?: Record<string, string>
): InterviewFact[] {
  const now = new Date().toISOString();
  return questions
    .filter((q) => answers[q.id] !== undefined)
    .map((q) => ({
      question_id: q.id,
      question_text: q.text,
      answer: answers[q.id],
      provenance: provenances?.[q.id] ?? 'operator_interview',
      confidence:
        confidences?.[q.id] ?? (answers[q.id] === 'unknown' ? 'unknown' : 'high'),
      recorded_at: now,
      // GO-2 M4: a named-human attestation survives fact regeneration — losing it
      // here would silently demote a confirmed fact back to an unconfirmed draft.
      ...(attestations?.[q.id] ? { attestation: attestations[q.id] } : {}),
      // FC-MU-3: an auto-detected answer keeps where it came from.
      ...(sources?.[q.id] ? { source: sources[q.id] } : {}),
    }));
}

/** Rebuild the answers map from persisted facts (mid-interview resume). */
export function answersFromFacts(facts: InterviewFact[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const f of facts) answers[f.question_id] = f.answer;
  return answers;
}

// ── Harvest prefill helpers ────────────────────────────────────────────────

/**
 * A harvest fact as stored in localStorage 'muster-harvest-facts'.
 * Populated by the /harvest/* API endpoints (S5 slice); this module reads
 * the seam without knowing how the facts got there.
 */
export interface HarvestFact {
  question_id: string;
  answer: string;
  provenance: 'auto_detected';
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  source: string;
}

function isHarvestFact(v: unknown): v is HarvestFact {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.question_id === 'string' &&
    typeof f.answer === 'string' &&
    f.provenance === 'auto_detected' &&
    typeof f.source === 'string'
  );
}

/**
 * Read harvest facts from localStorage 'muster-harvest-facts'.
 * Returns an empty array if the key is absent, invalid JSON, or not an array.
 * Pure (reads localStorage; does not call fetch).
 */
export function loadHarvestFacts(): HarvestFact[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem('muster-harvest-facts');
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHarvestFact);
  } catch {
    return [];
  }
}

/**
 * W4-MU2 (MU-06): WRITE the harvest store the mount-time prefill reads (the
 * seam's missing half — until now nothing wrote 'muster-harvest-facts').
 * Only well-formed harvest facts are stored; returns how many.
 */
export function storeHarvestFacts(facts: unknown[]): number {
  const valid = facts.filter(isHarvestFact);
  if (typeof localStorage === 'undefined') return 0;
  localStorage.setItem('muster-harvest-facts', JSON.stringify(valid));
  return valid.length;
}

/**
 * FC-MU (MU-06): clear the harvest handoff key. The harvest belongs to the ONE
 * assessment it was run for — the interview consumes it once, on mount (same
 * discipline as clearDiscoveryFacts), so a later fresh assessment never
 * re-applies an earlier assessment's AUTO-DETECTED answers.
 */
export function clearHarvestFacts(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem('muster-harvest-facts');
}

export interface HarvestPrefillResult {
  answers: Record<string, string>;
  provenances: Record<string, string>;
  confidences: Record<string, InterviewFact['confidence']>;
  sources: Record<string, string>;
}

/**
 * Convert harvest facts into the answer/provenance/confidence/source maps
 * used by AssessmentPage. Questions with existing answers are NOT overwritten
 * (existing takes priority).
 */
export function applyHarvestFacts(
  harvestFacts: HarvestFact[],
  existingAnswers: Record<string, string>
): HarvestPrefillResult {
  const answers: Record<string, string> = {};
  const provenances: Record<string, string> = {};
  const confidences: Record<string, InterviewFact['confidence']> = {};
  const sources: Record<string, string> = {};

  for (const f of harvestFacts) {
    if (existingAnswers[f.question_id] !== undefined) continue; // existing wins
    answers[f.question_id] = f.answer;
    provenances[f.question_id] = 'auto_detected';
    confidences[f.question_id] = f.confidence;
    sources[f.question_id] = f.source;
  }
  return { answers, provenances, confidences, sources };
}

// ── Discovery prefill helpers ─────────────────────────────────────────────
// Same localStorage-handoff pattern as loadHarvestFacts/applyHarvestFacts
// above, but for facts synthesized from a completed Discovery sub-tab run
// (synthesizeFactsFromDiscovery, provenance 'auto_detected'). DiscoverySubTab
// writes to this key when the user continues to the interview; AssessmentPage
// reads and clears it once, on mount, the same way harvest facts are consumed.

const DISCOVERY_FACTS_KEY = 'muster-discovery-facts';

/** Persist synthesized discovery facts for AssessmentPage to pick up on next mount. */
export function storeDiscoveryFacts(facts: InterviewFact[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DISCOVERY_FACTS_KEY, JSON.stringify(facts));
}

function isInterviewFact(v: unknown): v is InterviewFact {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.question_id === 'string' &&
    typeof f.answer === 'string' &&
    typeof f.provenance === 'string' &&
    typeof f.confidence === 'string'
  );
}

/**
 * Read discovery facts from localStorage 'muster-discovery-facts'.
 * Returns an empty array if the key is absent, invalid JSON, or not an array.
 * Pure (reads localStorage; does not call fetch).
 */
export function loadDiscoveryFacts(): InterviewFact[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(DISCOVERY_FACTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isInterviewFact);
  } catch {
    return [];
  }
}

/** Clear the discovery-facts handoff key (consumed once, on mount). */
export function clearDiscoveryFacts(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(DISCOVERY_FACTS_KEY);
}

// READINESS-1 M2: the raw discovery ROWS ride the same handoff pattern as the
// facts (separate key, same consume-once discipline) so the session record can
// persist them for the readiness exporter's observations[].
const DISCOVERY_RESULTS_KEY = 'muster-discovery-results';

export function storeDiscoveryResults(results: import('@/shared/types/discovery').DiscoveryResult[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(DISCOVERY_RESULTS_KEY, JSON.stringify(results));
}

export function loadDiscoveryResults(): import('@/shared/types/discovery').DiscoveryResult[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(DISCOVERY_RESULTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is import('@/shared/types/discovery').DiscoveryResult =>
        !!r && typeof r === 'object' &&
        typeof (r as Record<string, unknown>).control_id === 'string' &&
        Array.isArray((r as Record<string, unknown>).objective_ids)
    );
  } catch {
    return [];
  }
}

export function clearDiscoveryResults(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(DISCOVERY_RESULTS_KEY);
}

/**
 * Convert discovery facts (already shaped as InterviewFact) into the
 * answer/provenance/confidence maps AssessmentPage uses for prefill.
 * Questions with existing answers are NOT overwritten (existing takes priority) —
 * same precedence rule as applyHarvestFacts.
 */
export function applyDiscoveryFacts(
  discoveryFacts: InterviewFact[],
  existingAnswers: Record<string, string>
): Omit<HarvestPrefillResult, 'sources'> & {
  attestations: Record<string, FactAttestation>;
} {
  const answers: Record<string, string> = {};
  const provenances: Record<string, string> = {};
  const confidences: Record<string, InterviewFact['confidence']> = {};
  const attestations: Record<string, FactAttestation> = {};

  for (const f of discoveryFacts) {
    if (existingAnswers[f.question_id] !== undefined) continue; // existing wins
    answers[f.question_id] = f.answer;
    provenances[f.question_id] = f.provenance;
    confidences[f.question_id] = f.confidence;
    // GO-2: boundary drafts confirmed in the Discovery confirm/correct step
    // arrive with their attestation already written — carry it through.
    if (f.attestation) attestations[f.question_id] = f.attestation;
  }
  return { answers, provenances, confidences, attestations };
}

// FC-MU-3: the live consents of an imported / API-run readiness record ride
// the same consume-once handoff as the rows and facts, so a re-export keeps them.
const DISCOVERY_CONSENTS_KEY = 'muster-discovery-consents';

type ReadinessConsent = import('@/shared/types/readinessResult').ReadinessConsent;

export function storeDiscoveryConsents(consents: ReadinessConsent[]): void {
  if (typeof localStorage === 'undefined') return;
  if (consents.length === 0) {
    localStorage.removeItem(DISCOVERY_CONSENTS_KEY);
    return;
  }
  localStorage.setItem(DISCOVERY_CONSENTS_KEY, JSON.stringify(consents));
}

export function loadDiscoveryConsents(): ReadinessConsent[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(DISCOVERY_CONSENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is ReadinessConsent =>
        !!c && typeof c === 'object' &&
        typeof (c as Record<string, unknown>).consented_by === 'string' &&
        typeof (c as Record<string, unknown>).tenant_id === 'string' &&
        Array.isArray((c as Record<string, unknown>).scopes) &&
        (c as Record<string, unknown>).auth_tier === 'device-code'
    );
  } catch {
    return [];
  }
}

export function clearDiscoveryConsents(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(DISCOVERY_CONSENTS_KEY);
}
