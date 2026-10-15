# REQ — ces-shared: three EO evaluators are built but never registered (pre-existing, unrelated to the 2.8.0 cleanup)

- **Filed by:** ces-eo (FC-EO-H, 2026-09-28, while closing out the ces-shared 2.8.0 registry-duplicate cleanup)
- **Target:** ces-shared `src/data/control-signal-registry.json`
- **Status:** OPEN

## Context

FC-EO-H added an invariant test (`tests/unit/claim-accuracy.test.ts`, "dead-evaluator inventory is pinned...")
that lists every evaluator in EO's `evaluatorRegistry` that no shared registry entry references. While
verifying the 2.8.0 duplicate-key cleanup left no assessable control uncovered, that test surfaced three
evaluators that predate this session and are **unrelated** to the L1/L2 duplicate cleanup:

- `dlpEvaluator` (`src/eo/mapping/evaluators/sc-evaluators.ts`)
- `riskDetectionPostureEvaluator` (`src/eo/mapping/evaluators/si-evaluators.ts`)
- `vulnerabilityPostureEvaluator` (`src/eo/mapping/evaluators/si-evaluators.ts`)

All three have real signal-parsing logic and fixture-based tests
(`tests/assessment/evaluators/si-risk-vuln-coverage.test.ts`, `tests/assessment/evaluators/regression.test.ts`)
but no shared registry entry names them, so they never run against a live tenant.

`riskDetectionPostureEvaluator` and `vulnerabilityPostureEvaluator` were built under "G3 #3" to consume the
`riskDetections` (`/identityProtection/riskDetections`) and `vulnerabilities`
(`/security/microsoft/vulnerabilities`) signals with better severity/remediation-window logic than the
evaluators currently wired to `IA.L2-3.5.3` (`mfaMethodsEvaluator`) and `SI.L1-3.14.1`
(`flawRemediationL1Evaluator`). `dlpEvaluator` has DLP-policy-aware logic (with a sensitivity-label
fallback) more specific than whatever currently covers its intended control.

## Problem

The control-signal registry is a ces-shared asset (outside ces-eo's write boundary), so ces-eo cannot wire
these evaluators to a control id itself. Left as-is, this is inert but correct dead code; a future signal-
coverage pass should either promote these evaluators (replacing or supplementing a currently-registered one)
or retire them.

## Ask

For each of the three evaluators, either:
1. Assign it to the correct reference control id in the shared registry (verifying it does not regress the
   `required: true` signal an existing evaluator depends on — the same caution ces-eo applied when NOT
   re-keying `mediaDisposalEvaluator`/`MP.L2-3.8.3`), or
2. Confirm it is superseded and ces-eo should delete it as dead code.

## Acceptance

In ces-eo, `tests/unit/claim-accuracy.test.ts`'s "dead-evaluator inventory" test either shrinks (an
evaluator got promoted — update the pinned list) or ces-eo deletes the retired evaluator and its
now-pointless tests, removing it from the pinned list either way.
