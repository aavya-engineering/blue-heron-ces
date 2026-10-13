// Minimal, plain-object fixture builders for characterization tests.
// These intentionally only populate the fields the pure functions under test
// actually read — they are NOT complete schema-valid artifacts.
// VENDORED from ces-planner src/__fixtures__/builders.ts @ 4a00bee5d5e618cf55da2469ec12307ebc620418
// Import path adjustments: @/features/rrt/types -> @/vendored/ces-spine/types/rrt
//                          @/shared/types/artifacts -> @/vendored/ces-spine/types/artifacts

import type { RRTAnswer } from '@/vendored/ces-spine/types/rrt';
import type { SIBaseline } from '@/vendored/ces-spine/types/artifacts';

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
