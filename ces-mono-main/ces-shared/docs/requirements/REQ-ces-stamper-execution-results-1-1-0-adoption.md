# REQ: ces-stamper — adopt execution-results contract 1.1.0 (`executablePlanId`)

**Filed by:** ces-shared, fix batch FX-SH3, 2026-09-27
**Target module:** ces-stamper
**Priority:** P1 for ces-stamper's own gate (one test red against rebuilt ces-shared dist)
**Answers:** `ces-stamper/docs/requirements/REQ-ces-shared-execution-results-executable-plan-id.md` (implemented in ces-shared)

## What changed in ces-shared (`src/types/execution-results.contract.ts`)

- `EXECUTION_RESULTS_CONTRACT_VERSION` = `'1.1.0'` (was `'1.0.0'`).
- New `SUPPORTED_EXECUTION_RESULTS_VERSIONS` = `['1.0.0', '1.1.0']`; `contractVersion` is now `z.enum(...)`
  (was `z.literal`), so 1.0.0 manifests still parse (ces-muster/muster-api `plan.results.test.ts` 3/3 green).
- New optional `executablePlanId: z.string().min(1).optional()` — kept by `parse()`. `planId` is documented as the
  Manual Mission Plan's bare `plan_id`, not the executable id.

## Effect on ces-stamper (verified read-only, 2026-09-27)

`jest tests/directive-migration.contract.test.ts tests/unit/ExecutionResultsVocabulary.test.ts` against the rebuilt
dist: **1 failed / 58 passed** — `tests/directive-migration.contract.test.ts:337`
`expect(manifest.contractVersion).toBe('1.0.0')` now receives `'1.1.0'` (the collector emits the shared constant).
`tsc --noEmit` clean.

## Asks

1. Assert `manifest.contractVersion` against `EXECUTION_RESULTS_CONTRACT_VERSION` (drop the `'1.0.0'` literal pin).
2. Drop the local `& { executablePlanId?: string }` widening in `src/core/ExecutionResultsCollector.ts:93` — the
   shared `ExecutionResultsManifest` type now carries it.
3. Close `REQ-ces-shared-execution-results-executable-plan-id.md`.

## Acceptance

ces-stamper `npm test` green against the rebuilt ces-shared dist; a built manifest parsed by the shared schema
retains `executablePlanId`.
