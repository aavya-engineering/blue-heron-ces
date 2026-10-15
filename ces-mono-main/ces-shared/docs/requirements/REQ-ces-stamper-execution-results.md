# REQ: ces-stamper adoption of ExecutionResultsManifest contract

**From:** ces-shared (MS-R9)  
**To:** ces-stamper  
**Date:** 2026-09-26  
**Priority:** P2  

## What changed

`ces-shared/types/execution-results` now exports `ExecutionResultsManifestSchema` (Zod)
and the `ExecutionResultsManifest` TypeScript type. This is the shared contract for the
Muster→Stamper execution-results boundary.

## What Stamper must do

Stamper's `ExecutionResultsCollector.buildManifest()` currently emits a shape that is
close but not conformant:

1. **Add `contractVersion`** — emit `"1.0.0"` (matches
   `EXECUTION_RESULTS_CONTRACT_VERSION`).
2. **Add `planId`** — the plan ID that seeded this run. Without it Muster cannot
   correlate results back to the plan.
3. **Add `cesId`** — optional but required for cross-module traceability.
4. **Lowercase verdicts** — Stamper uses `SAT`/`NOT_SAT`/`PROVISIONAL`; the contract
   expects `sat`/`not_sat`/`provisional`/`not_applicable`. Map with `.toLowerCase()` or
   a lookup table.

## Acceptance

`ExecutionResultsManifestSchema.parse(builtManifest)` succeeds without throwing.

## Reference

- Schema: `ces-shared/src/types/execution-results.contract.ts`
- Tests: `ces-shared/src/types/execution-results.contract.test.ts`
- Export: `ces-shared/types/execution-results`
