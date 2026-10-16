// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import {
  EXECUTION_RESULTS_CONTRACT_VERSION,
  type ExecutionResultsManifest as SharedExecutionResultsManifest,
  type ExecutionVerdictType,
  type ExecutionDirectiveType,
} from 'ces-shared/types/execution-results';

/**
 * The verdict words the execute path records (execute.routes.ts). Every
 * `recordControlResult` call site uses one of these — tests/unit/
 * ExecutionResultsVocabulary.test.ts guards that no bare literal slips in.
 * SPRS-style handlers (prohibition, inheritance, eo-tooled, renderable) say
 * MET / NOT MET; registry tasks say SAT / NOT_SAT.
 */
export const ResultVerdict = {
  SAT: 'SAT',
  NOT_SAT: 'NOT_SAT',
  MET: 'MET',
  NOT_MET: 'NOT MET',
  PROVISIONAL: 'PROVISIONAL',
  NOT_APPLICABLE: 'N/A',
} as const;
export type ResultVerdictValue = (typeof ResultVerdict)[keyof typeof ResultVerdict];

/** SPRS-style pass/fail → MET / NOT MET. */
export function metVerdict(passed: boolean): ResultVerdictValue {
  return passed ? ResultVerdict.MET : ResultVerdict.NOT_MET;
}

/**
 * FX-ST3: Stamper verdict word → shared ExecutionVerdict.
 * MET/NOT MET are SPRS words for the same outcome as SAT/NOT_SAT.
 */
const VERDICT_TO_SHARED: Record<string, ExecutionVerdictType> = {
  'SAT': 'sat',
  'MET': 'sat',
  'NOT_SAT': 'not_sat',
  'NOT MET': 'not_sat',
  'NOT_MET': 'not_sat',
  'PROVISIONAL': 'provisional',
  'N/A': 'not_applicable',
  'NOT_APPLICABLE': 'not_applicable',
};

/**
 * FX-ST3: directive value recorded on the execute path → shared ExecutionDirective.
 * The per-control directive map carries the Mission Plan's control_directives[]
 * words (implement / validate / manual) alongside Stamper's own
 * (automated / validation / nonstack / document-* / inherit-fedramp / eo-tooled / skip).
 */
const DIRECTIVE_TO_SHARED: Record<string, ExecutionDirectiveType> = {
  'implement': 'automated',
  'automated': 'automated',
  'validate': 'validation',
  'validation': 'validation',
  'manual': 'manual_gate',
  'manual_gate': 'manual_gate',
  'document-absence': 'document-absence',
  'document-prohibition': 'document-prohibition',
  'document-renderable': 'document-renderable',
  'inherit-fedramp': 'inherit-fedramp',
  'eo-tooled': 'eo-tooled',
  'nonstack': 'nonstack',
  'skip': 'skip',
};

export function toSharedVerdict(v: string): ExecutionVerdictType | undefined {
  return VERDICT_TO_SHARED[v] ?? VERDICT_TO_SHARED[v.toUpperCase()];
}

export function toSharedDirective(d: string): ExecutionDirectiveType | undefined {
  return DIRECTIVE_TO_SHARED[d] ?? DIRECTIVE_TO_SHARED[d.toLowerCase()];
}

/** Every Stamper-side directive word the mapping knows (for tests / docs). */
export const KNOWN_RESULT_DIRECTIVES: readonly string[] = Object.keys(DIRECTIVE_TO_SHARED);

/** Internal record — Stamper's own words, mapped only at the manifest boundary. */
export interface RecordedControlResult {
  controlId: string;
  directive: string;
  verdict: string;
  outcome: string;
  evidencePath?: string;
  timestampUtc: string;
}

/**
 * The manifest Stamper emits: the shared execution-results contract (1.1.0+),
 * which carries the optional `executablePlanId` (FX-ST4 / FX-ST5).
 */
export type ExecutionResultsManifest = SharedExecutionResultsManifest;

/** The bits of an executable plan the manifest needs. */
export interface ManifestPlanRef {
  plan_id: string;
  variables?: Record<string, unknown>;
  ces?: { cesId?: string } & Record<string, unknown>;
}

const TRANSLATED_PREFIX = 'translated-';

/**
 * FX-ST4 / MS-R13: the Mission Plan's bare `plan_id` — what Muster's
 * POST /api/plan/results matches on. PlanTranslator records it as
 * `variables._source_plan_id`; plans translated before that fall back to
 * stripping the `translated-` prefix of the executable id.
 */
export function sourcePlanIdOf(plan: ManifestPlanRef): string {
  const recorded = plan.variables?._source_plan_id;
  if (typeof recorded === 'string' && recorded.length > 0) return recorded;
  return plan.plan_id.startsWith(TRANSLATED_PREFIX) ? plan.plan_id.slice(TRANSLATED_PREFIX.length) : plan.plan_id;
}

/**
 * Collects per-control execution results during a run and builds
 * a manifest suitable for persistence and SSE emission.
 */
export class ExecutionResultsCollector {
  private results: Map<string, RecordedControlResult> = new Map();

  /**
   * Record a control-level execution result.
   * If controlId is null or empty, logs a warning and returns without recording.
   */
  recordControlResult(
    controlId: string | null,
    directive: string,
    verdict: string,
    outcome: string,
    evidencePath?: string
  ): void {
    if (!controlId) {
      console.warn('ExecutionResultsCollector: skipping record — controlId is null/empty');
      return;
    }

    this.results.set(controlId, {
      controlId,
      directive,
      verdict,
      outcome,
      evidencePath,
      timestampUtc: new Date().toISOString(),
    });
  }

  /**
   * Build the final manifest with results sorted by controlId ascending.
   * Verdicts and directives are mapped to the ces-shared vocabulary here (the
   * manifest boundary). A word with no mapping is passed through unchanged and
   * warned about, so the shared schema rejects it visibly instead of it being
   * silently re-labelled.
   */
  buildManifest(runId: string, tenantSlug: string, planId: string, cesId?: string, executablePlanId?: string): ExecutionResultsManifest {
    const sorted = Array.from(this.results.values()).sort((a, b) =>
      a.controlId.localeCompare(b.controlId)
    );

    return {
      contractVersion: EXECUTION_RESULTS_CONTRACT_VERSION,
      runId,
      planId,
      ...(executablePlanId ? { executablePlanId } : {}),
      cesId,
      tenantSlug,
      completedAt: new Date().toISOString(),
      totalControls: sorted.length,
      results: sorted.map(r => {
        const verdict = toSharedVerdict(r.verdict);
        const directive = toSharedDirective(r.directive);
        if (!verdict) console.warn(`ExecutionResultsCollector: no shared verdict for "${r.verdict}" (${r.controlId})`);
        if (!directive) console.warn(`ExecutionResultsCollector: no shared directive for "${r.directive}" (${r.controlId})`);
        return {
          ...r,
          verdict: (verdict ?? r.verdict) as ExecutionVerdictType,
          directive: (directive ?? r.directive) as ExecutionDirectiveType,
        };
      }),
    };
  }

  /**
   * FX-ST4: build the manifest for an executable plan. `planId` is the source
   * Mission Plan's bare id (Muster's key); the executable id is kept in
   * `executablePlanId`.
   */
  buildManifestForPlan(runId: string, tenantSlug: string, plan: ManifestPlanRef): ExecutionResultsManifest {
    return this.buildManifest(runId, tenantSlug, sourcePlanIdOf(plan), plan.ces?.cesId, plan.plan_id);
  }
}
