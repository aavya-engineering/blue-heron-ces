# REQ: Stamper Execution Results Ingest (MS-R9)

**Filed by:** ces-muster (flow-through MS-R9, 2026-09-26, rewritten 2026-09-27)
**Target modules:** ces-muster (ingest), ces-stamper (lowercase emission fix — T3)
**Priority:** P2 (Phase 5)

## Status: OPEN — ingest built against fixture; live loop WAITING on ces-stamper T3

## Shipped Contract

The execution results contract shipped in `ces-shared/src/types/execution-results.contract.ts`:

- **`ExecutionResultsManifestSchema`**: `contractVersion` (literal `"1.0.0"`), `runId`, `planId`,
  `cesId` (optional), `tenantSlug`, `completedAt`, `totalControls`, `results[]`
- **`ControlExecutionResultSchema`**: `controlId`, `directive` (ExecutionDirective enum),
  `verdict` (ExecutionVerdict enum), `outcome`, `evidencePath?`, `timestampUtc`
- **`ExecutionVerdict`**: `sat | not_sat | provisional | not_applicable`
- **`ExecutionDirective`**: `automated | validation | manual_gate | document-absence |
  document-prohibition | document-renderable | inherit-fedramp | eo-tooled | nonstack | skip`
- **`summarizeResults(manifest)`**: returns `{ sat, notSat, provisional, notApplicable, total }`

## What Muster Does (M4)

Muster ingests a conforming manifest via `POST /api/plan/results`, validates with
`ExecutionResultsManifestSchema`, and updates directive statuses by matching `controlId` to
`control_id` in the stored plan's `control_directives[]`.

## What Remains

- **ces-stamper T3:** Stamper currently emits uppercase verdicts (`SAT`, `NOT_SAT`). T3 fixes
  emission to lowercase. Until then, Muster rejects uppercase as a contract violation (the Zod
  enum is lowercase-only). The live end-to-end loop requires T3.
- **Gate:** `git -C C:/Users/mhsut/DevProjects/ces/ces-stamper log flow-through-2026-09 --oneline -- tests/` shows execution-results test.

## Previous Version (corrected)

The 2026-09-26 version of this REQ described a shape that ces-shared did not ship:
- Listed verdicts as `pass | fail | partial | skipped | error` — shipped as `sat | not_sat | provisional | not_applicable`
- Listed field `directive_id` — shipped as `controlId`
- Did not mention `contractVersion`, `runId`, or `tenantSlug`

This rewrite reflects the actual shipped schema.
