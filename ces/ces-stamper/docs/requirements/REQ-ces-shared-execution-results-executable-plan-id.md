# REQ: ces-shared — optional `executablePlanId` on the execution-results manifest

**Filed by:** ces-stamper flow-through session, FX-ST4 (MS-R13), 2026-09-27
**Status:** CLOSED 2026-09-27 — implemented by ces-shared `82f39da` (contract 1.1.0); adopted in ces-stamper FX-ST5 (local widening dropped, parse-retains test added)
**Target:** `ces-shared/src/types/execution-results.contract.ts` (`ExecutionResultsManifestSchema`)

## What

Since FX-ST4 (ces `ab09507`) Stamper's results manifest carries:

- `planId` — the Manual Mission Plan's bare `plan_id` (the key Muster's `POST /api/plan/results` matches), and
- `executablePlanId` — the executable plan id Stamper actually ran (`translated-<plan_id>`).

The shared schema is a plain (non-strict) `z.object`, so `executablePlanId` parses today and is **stripped**
from the parse output. Nothing breaks, but the field is not part of the contract, so a consumer cannot rely on it
and a future `.strict()` would reject Stamper's manifest.

## Requested change

Add `executablePlanId: z.string().min(1).optional()` to `ExecutionResultsManifestSchema`, and document that
`planId` is the Mission Plan `plan_id` (not the executable id).

## Acceptance test

- ces-shared: a manifest with `executablePlanId` parses and the field survives `parse()`.
- ces-stamper: `tests/unit/ExecutionResultsVocabulary.test.ts` keeps passing; Stamper then drops the local
  `& { executablePlanId?: string }` widening in `src/core/ExecutionResultsCollector.ts`.
