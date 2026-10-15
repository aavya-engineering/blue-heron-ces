// Minimal, plain-object fixture builders for characterization tests.
// These intentionally only populate the fields the pure functions under test
// actually read — they are NOT complete schema-valid artifacts.

import type { RRTAnswer } from '@/features/rrt/types';
import type { SIBaseline } from '@/shared/types/artifacts';

/** Build a minimal RRTAnswer; caller supplies mapped_requirements + answer. */
export function makeAnswer(
  partial: Partial<RRTAnswer> & { mapped_requirements: string[]; answer: unknown },
): RRTAnswer {
  return {
    question_id: 'q',
    provenance_class: 'client_assertion',
    ...partial,
  } as RRTAnswer;
}

/**
 * Build a partial SIBaseline carrying only operations/scope/dependencies/target
 * fields. Cast to SIBaseline for the functions under test, which defensively
 * read via optional chaining and never touch the unset fields.
 */
export function makeSIBaseline(parts: {
  operations?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  target?: Record<string, unknown>;
}): SIBaseline {
  return {
    si_baseline: {
      operations: parts.operations ?? {},
      scope: parts.scope ?? {},
      dependencies: parts.dependencies ?? {},
      target: parts.target ?? {},
    },
  } as unknown as SIBaseline;
}
