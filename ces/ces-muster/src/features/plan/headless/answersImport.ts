// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// answersImport.ts — W1 (synthetic customers, PLAN §2.3): the headless runner's
// MX_ANSWERS input. A synthetic customer's interview-answers file
// (customers/<slug>/interview-answers.json, an InterviewFact[] with provenance
// 'operator_interview' and source 'synthetic-interview:<slug>') plays the
// interviewee; it is merged with the discovery-staged facts at the runner's
// facts seam (scripts/mx/plan-from-discovery.ts).
//
// Merge rule: an answer never overrides a decisive discovery verdict (a fact
// with a discovery provenance, a known confidence and an answer that is not
// 'unsure' / 'unknown'). It replaces an 'unsure' or a non-discovery fact for
// the same question (the staged one is dropped, the answer appended, so every
// last-fact-wins reader sees it), and it is appended where nothing answered.
// The merge works on facts, after factsFromAnswers, so answers whose ids are
// not graph nodes (the 15 Policy Inputs ODPs PI.ODP.*) survive.
//
// Operator values with no register row (org-content.json
// operator_values_without_register_row) become facts on `OPV.<stamperVar>`
// ids, read by derive/operatorValues.buildSuppliedOperatorValues.
import type { InterviewFact } from '@/shared/types/engagement';
import { OPERATOR_VALUE_FACT_PREFIX } from '@/features/plan/derive/operatorValues';

/** Provenances that mean "discovery read this from the tenant". */
const DISCOVERY_PROVENANCES = new Set(['discovery', 'auto_detected']);

const FACT_KEYS = new Set(['question_id', 'question_text', 'answer', 'provenance', 'confidence', 'recorded_at', 'source']);
const CONFIDENCES = new Set(['high', 'medium', 'low', 'unknown']);

export const ANSWERS_PROVENANCE = 'operator_interview';
export const answersSource = (slug: string): string => `synthetic-interview:${slug}`;

/** Parse and check an interview-answers file. Throws on the first violation. */
export function parseInterviewAnswers(text: string, slug: string): InterviewFact[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error('MX_ANSWERS: the answers file is not an array');
  const seen = new Set<string>();
  return raw.map((f, i) => {
    const at = `MX_ANSWERS[${i}]`;
    if (!f || typeof f !== 'object') throw new Error(`${at}: not an object`);
    const o = f as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!FACT_KEYS.has(k)) throw new Error(`${at}: unknown key ${k}`);
    for (const k of ['question_id', 'question_text', 'answer', 'recorded_at']) {
      if (typeof o[k] !== 'string' || (o[k] as string).trim() === '') throw new Error(`${at}: ${k} missing`);
    }
    if (o.provenance !== ANSWERS_PROVENANCE) throw new Error(`${at}: provenance must be ${ANSWERS_PROVENANCE}`);
    if (o.source !== answersSource(slug)) throw new Error(`${at}: source must be ${answersSource(slug)}`);
    if (!CONFIDENCES.has(o.confidence as string)) throw new Error(`${at}: bad confidence`);
    const id = o.question_id as string;
    if (seen.has(id)) throw new Error(`${at}: duplicate question_id ${id}`);
    seen.add(id);
    return o as unknown as InterviewFact;
  });
}

const isDecisiveDiscovery = (f: InterviewFact): boolean =>
  DISCOVERY_PROVENANCES.has(f.provenance) && f.confidence !== 'unknown' && f.answer !== 'unsure' && f.answer !== 'unknown';

export interface AnswersMerge {
  facts: InterviewFact[];
  /** Answer ids that filled an unanswered question. */
  added: string[];
  /** Answer ids that replaced an 'unsure' or non-discovery fact. */
  replaced: string[];
  /** Answer ids dropped because discovery decided the question. */
  keptDiscovery: string[];
}

/** Merge answers into the staged facts (rule in the header). */
export function mergeInterviewAnswers(staged: InterviewFact[], answers: InterviewFact[]): AnswersMerge {
  const added: string[] = [];
  const replaced: string[] = [];
  const keptDiscovery: string[] = [];
  const drop = new Set<string>();
  const accepted: InterviewFact[] = [];
  for (const a of answers) {
    const same = staged.filter((f) => f.question_id === a.question_id);
    if (same.some(isDecisiveDiscovery)) {
      keptDiscovery.push(a.question_id);
      continue;
    }
    if (same.length > 0) {
      drop.add(a.question_id);
      replaced.push(a.question_id);
    } else added.push(a.question_id);
    accepted.push(a);
  }
  return { facts: [...staged.filter((f) => !drop.has(f.question_id)), ...accepted], added, replaced, keptDiscovery };
}

/** The org-content operator values with no register row, as facts on OPV.<stamperVar>. */
export function operatorValueFactsFromOrgContent(orgContent: unknown, slug: string, recordedAt: string): InterviewFact[] {
  const block = (orgContent as { operator_values_without_register_row?: Record<string, unknown> } | null)
    ?.operator_values_without_register_row;
  if (!block || typeof block !== 'object') return [];
  return Object.entries(block)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v.trim() !== '')
    .map(([k, v]) => ({
      question_id: `${OPERATOR_VALUE_FACT_PREFIX}${k}`,
      question_text: `Operator value ${k} (org-content.json)`,
      answer: v as string,
      provenance: ANSWERS_PROVENANCE,
      confidence: 'high' as const,
      recorded_at: recordedAt,
      source: `synthetic-org-content:${slug}`,
    }));
}

/**
 * W5c2 (SC-5): the engagement profile the org-content `profile` block stands for on a synthetic
 * customer (what the operator types on the Profile tab: legal name, CAGE, UEI). It feeds PI.ORG.001
 * / 006 / 007, so the policy inputs profile's organization.legal_name / cage_code / duns_number are
 * no longer the runner's slug stub and empty. Null when the block names no organisation.
 */
export function partyFromOrgContent(orgContent: unknown): { name: string; cage?: string; uei?: string } | null {
  const p = (orgContent as { profile?: { org_name?: unknown; cage?: unknown; uei?: unknown } } | null | undefined)?.profile;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const name = str(p?.org_name);
  if (!name) return null;
  const cage = str(p?.cage);
  const uei = str(p?.uei);
  return { name, ...(cage ? { cage } : {}), ...(uei ? { uei } : {}) };
}
