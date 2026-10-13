// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// siBaselineAdapter.ts — G-MUSTER-PLAN-2 M2 (slice 1): produce the Planner SI
// Baseline artifact from Muster's own inputs, using the VENDORED, unforked
// ces-planner generator (src/vendored/ces-planner). This is the port decided
// by FD-PLANNER-OUTPUTS: consume Planner's proven generator, drift-checked,
// never re-implement it.
//
// The generator takes SITAnswers keyed by si_baseline.* paths. Muster's
// Situation tab + fact store already hold the substance (target level, CUI
// presence, boundary strategy, deployment posture, stacks); this adapter maps
// them onto SITAnswers and hands them to the generator unchanged. What Muster
// cannot yet supply, the generator's own defaults fill (target L2, unknown
// enums) — exactly as it does for a sparse Planner session.
//
// Zero network (pure data-in/data-out, like the generator).
import type { InterviewFact } from '@/shared/types/engagement';
import { generateSIBaseline } from '@/vendored/ces-planner/services/baselineGenerator';
import type { SIBaseline, SITAnswer } from '@/vendored/ces-planner/types/siBaseline';
import { sitProvenanceOf } from './siDerivation';
import { SI_INPUT_KIND_BY_ID, parsePlanInputAnswer } from '@/features/interview/siPlanInputNodes';

export interface SiBaselineInputs {
  /** SIT question answers already keyed to si_baseline.* paths. */
  answers: Record<string, SITAnswer>;
}

/** The SI question bank shape the generator reads (`ces.question_bank.questions`
 * with `sets_its_fields`). The real primed bank is loaded by compilerBanks. */
export interface SiQuestionBank {
  ces?: { question_bank?: { questions?: Array<{ id: string; sets_its_fields?: string[] }> } };
}

/**
 * Decode an InterviewFact.answer into a SITAnswer.raw_answer. M1's derived facts
 * are string enums; residue answers captured in the interview may encode lists
 * or numbers as JSON strings (the convention this decoder and the residue
 * capture path share). A bare string decodes to itself.
 */
function decodeAnswer(raw: string): SITAnswer['raw_answer'] {
  if (raw.length > 0 && (raw[0] === '[' || raw[0] === '{')) {
    try {
      return JSON.parse(raw) as SITAnswer['raw_answer'];
    } catch {
      /* fall through — treat as a plain string */
    }
  }
  return raw;
}

/** FC-MU (MU-10): the answer_type + typed raw_answer for a SIT fact. Non-enum
 * SIT questions (siPlanInputNodes input kinds) are typed by the same parser the
 * interview widget validates with; an unparseable legacy value falls back to the
 * plain decode (never dropped, never invented). Enum questions stay 'enum'. */
function typedAnswer(
  questionId: string,
  raw: string
): Pick<SITAnswer, 'answer_type' | 'raw_answer'> {
  const kind = SI_INPUT_KIND_BY_ID[questionId];
  if (kind) {
    const parsed = parsePlanInputAnswer(kind, raw);
    if (parsed.ok) {
      const answerType: SITAnswer['answer_type'] =
        kind === 'number' ? 'number' : kind === 'list' ? 'array' : kind === 'time_goal' ? 'structured_object' : 'string';
      return { answer_type: answerType, raw_answer: parsed.value as SITAnswer['raw_answer'] };
    }
  }
  return { answer_type: 'enum', raw_answer: decodeAnswer(raw) };
}

/**
 * G-MUSTER-PLAN-3 M1: build SITAnswers from InterviewFacts (derived SIT facts
 * from siDerivation + any residue answered in the interview), keyed by the
 * facts' question_id. Only facts whose question_id is a real SIT question are
 * mapped; provenance_class is recovered from derived facts' provenance string,
 * and interview-answered residue is a client_assertion. One fact store, one
 * bank — no invented answers.
 */
export function sitAnswersFromFacts(
  facts: InterviewFact[],
  bank: SiQuestionBank
): Record<string, SITAnswer> {
  const validIds = new Set((bank.ces?.question_bank?.questions ?? []).map((q) => q.id));
  const answers: Record<string, SITAnswer> = {};
  for (const f of facts) {
    if (!validIds.has(f.question_id)) continue;
    const provClass: SITAnswer['provenance_class'] = f.provenance.startsWith('derived:si:')
      ? sitProvenanceOf(f.provenance)
      : 'client_assertion';
    answers[f.question_id] = {
      question_id: f.question_id,
      ...typedAnswer(f.question_id, f.answer),
      captured_at: '1970-01-01T00:00:00.000Z',
      provenance_class: provClass,
    };
  }
  return answers;
}

function sit(
  questionId: string,
  raw: SITAnswer['raw_answer'],
  answerType: SITAnswer['answer_type'],
  provenance: SITAnswer['provenance_class']
): SITAnswer {
  return {
    question_id: questionId,
    answer_type: answerType,
    raw_answer: raw,
    // Stable timestamp: the generator only stamps generated_on (a date) itself;
    // captured_at is passthrough provenance, deterministic here for testability.
    captured_at: '1970-01-01T00:00:00.000Z',
    provenance_class: provenance,
  };
}

/** A questionBank stub the generator accepts: it maps each answer's
 * question_id to its si_baseline.* field path(s) via the bank's
 * `sets_its_fields` array (the shape generateSIBaseline.buildFieldMap reads). */
function questionBankFor(fieldByQuestion: Record<string, string>): unknown {
  return {
    ces: {
      question_bank: {
        questions: Object.entries(fieldByQuestion).map(([id, field]) => ({
          id,
          sets_its_fields: [field],
        })),
      },
    },
  };
}

/**
 * Build the SITAnswer set from Muster's plan-mode inputs. Only the fields
 * Muster genuinely knows are asserted (client_assertion / system_observation);
 * everything else is left to the generator's defaults — never invented.
 */
export function sitAnswersFromMuster(input: {
  targetLevel?: 'L1' | 'L2' | 'L3';
  cuiPresence?: 'no_cui' | 'fci_only' | 'cui_present' | 'cui_plus_other_sensitive' | 'unknown';
  boundaryStrategy?: 'single_enclave' | 'multiple_enclaves' | 'hybrid_boundary' | 'unknown';
  deploymentPosture?: 'cloud_only' | 'hybrid' | 'on_prem' | 'unknown';
  selectedStacks?: string[];
  /** Optional interview facts — reserved for richer future mapping (slice 2+). */
  facts?: InterviewFact[];
}): { answers: Record<string, SITAnswer>; fieldByQuestion: Record<string, string> } {
  const answers: Record<string, SITAnswer> = {};
  const fieldByQuestion: Record<string, string> = {};

  const add = (
    qid: string,
    field: string,
    raw: SITAnswer['raw_answer'],
    answerType: SITAnswer['answer_type'],
    provenance: SITAnswer['provenance_class'] = 'client_assertion'
  ) => {
    answers[qid] = sit(qid, raw, answerType, provenance);
    fieldByQuestion[qid] = field;
  };

  if (input.targetLevel) add('G-01', 'si_baseline.target.target_cmmc_level', input.targetLevel, 'enum');
  if (input.cuiPresence) add('G-02', 'si_baseline.target.cui_presence', input.cuiPresence, 'enum');
  if (input.boundaryStrategy)
    add('G-07', 'si_baseline.scope.boundary_strategy', input.boundaryStrategy, 'enum');
  if (input.deploymentPosture)
    add('G-08', 'si_baseline.scope.deployment_posture', input.deploymentPosture, 'enum', 'system_observation');
  // NOTE: this generator does not emit si_baseline.dependencies.infrastructure_model
  // (it is optional in the contract and unpopulated by the SI-Baseline generator).
  // Stack-derived infra selection belongs to the Tenant/Infra manifest generators
  // (slice 2), so selectedStacks is carried but not mapped to a dead field here.
  void input.selectedStacks;

  return { answers, fieldByQuestion };
}

/**
 * M0 (thin) path: produce the SI Baseline from the 5-field input via a
 * generated stub bank. Retained for the PLAN-2 tests; the M1 plan surface uses
 * buildSiBaselineFromAnswers with the real bank.
 */
export function buildSiBaseline(input: Parameters<typeof sitAnswersFromMuster>[0], cesId?: string): SIBaseline {
  const { answers, fieldByQuestion } = sitAnswersFromMuster(input);
  return generateSIBaseline(answers, questionBankFor(fieldByQuestion), 0, cesId);
}

/**
 * G-MUSTER-PLAN-3 M1: produce the SI Baseline from SITAnswers keyed by real SIT
 * question ids, using the REAL primed SI Question Bank (its sets_its_fields map
 * every answer to its si_baseline.* path). This is the single SI path the plan
 * surface uses.
 */
export function buildSiBaselineFromAnswers(
  answers: Record<string, SITAnswer>,
  bank: SiQuestionBank,
  cesId?: string
): SIBaseline {
  const si = generateSIBaseline(answers, bank, 0, cesId);
  // W4-MU1: the vendored SI generator builds `dependencies` from a fixed field
  // list and silently drops si_baseline.dependencies.infrastructure_model even
  // though the bank maps SIT-020 to it and every downstream compiler reads it
  // (gapCompiler / manifestGenerator / manualPlanGenerator default it to
  // m365_azure; infraManifestGenerator to m365_sentinel). Carry the answered
  // value through — Muster-side, the vendored body is untouched. Unanswered
  // stays absent (each compiler's own default applies, as before).
  const infraModel = answers['SIT-020']?.raw_answer;
  const deps = (si.si_baseline as { dependencies?: Record<string, unknown> } | undefined)?.dependencies;
  if (deps && typeof infraModel === 'string' && infraModel && deps.infrastructure_model === undefined) {
    deps.infrastructure_model = infraModel;
  }
  // FC-MU (MU-10): same gap for SIT-022 — the bank maps it to
  // si_baseline.dependencies.user_count (the schema and manualPlanGenerator's
  // si_key_facts read it; default 50) but the vendored generator never emits it.
  // Carry an answered count through; unanswered stays absent.
  // And for SIT-021 (dependencies.license_tier; manualPlanGenerator defaults g5).
  const licenseTier = answers['SIT-021']?.raw_answer;
  if (deps && typeof licenseTier === 'string' && licenseTier && deps.license_tier === undefined) {
    deps.license_tier = licenseTier;
  }
  const userCount = answers['SIT-022']?.raw_answer;
  if (deps && typeof userCount === 'number' && Number.isFinite(userCount) && deps.user_count === undefined) {
    deps.user_count = userCount;
  }
  return si;
}

export type { SIBaseline };
