# REQ: ces-shared — Execution Results Contract — CLOSED

**Filed by:** ces-stamper flow-through (MS-R9)
**Date:** 2026-09-26
**Closed:** 2026-09-27 — ces-shared commit `a6d3915` landed the shared contract. Stamper adopted at `6020f68` (contractVersion + planId + cesId) and `b879720` (lowercase verdict mapping). `ExecutionResultsManifestSchema.safeParse(buildManifest(...)).success === true` verified in test.
**Blocks:** MS-R9 (Stamper emits results per shared contract, Muster ingests them)

## What

ces-shared must export a versioned execution-results contract:
- `ExecutionResultsManifest` with normalized verdict enum + `cesId` + `planId`
- Per-control results with directive, verdict, outcome, evidence path
- Contract version for Muster to validate on ingest

## Why

Stamper already writes `execution-results-<planId>.json` via `ExecutionResultsCollector`, but the schema is private to Stamper (`ExecutionResultsManifestSchema` in `ces-artifacts.types.ts`). Muster has no ingest path. A shared contract lets Muster mark plan directives done and trigger reassessment.

## Evidence

- `ces-strategy/docs/context/module-status/flow-muster-stamper.json` — recommendation MS-R9
- `ces-stamper/src/types/ces-artifacts.types.ts:520-540` — existing `ExecutionResultsManifestSchema`
- `ces-stamper/src/core/ExecutionResultsCollector.ts` — current emitter

## Acceptance test

- A muster-api test ingests a fixture execution-results file and the plan's directive statuses update.
- Stamper emits results conforming to the shared schema after every run.
- Contract version mismatch produces a clear error on ingest.

## Stamper adoption

1. Replace `ExecutionResultsManifestSchema` with the ces-shared export.
2. Add `cesId` (from the plan's `_source_paths.cesId`) to results.
3. Emit `contractVersion` in results for Muster to validate.
