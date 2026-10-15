# REQ: AssessmentSource type union — add adminops_execution

**Target:** ces-shared  
**Filed by:** ces-eo (flow-through-2026-09)  
**Date:** 2026-09-26  
**Priority:** P1 — needed for correct merge behavior

## What

Add `'adminops_execution'` to the `AssessmentSource.type` union in
`ces-shared/src/types/controls.types.ts:29`.

Current union:
```
'discovery' | 'blob_artifact' | 'ec_capture' | 'ec_drift' | 'manual' | 'policy_doc' | 'evidence_import'
```

Requested:
```
'discovery' | 'blob_artifact' | 'ec_capture' | 'ec_drift' | 'manual' | 'policy_doc' | 'evidence_import' | 'adminops_execution'
```

Also add result values for enforcement semantics:
```
'exists' | 'missing' | 'error' | 'no_query' | 'imported' | 'enforced'
```

## Why

`ControlAssessor.ts:193-196` drops `evidence_import` sources when blob artifacts exist
for the same control. Using `evidence_import` for AdminOps evidence means a blob upload
would silently discard AdminOps compliance signals.

AdminOps deny rows (CMMC gate, CUI boundary) are proof of enforcement, not proof of failure.
They need `result: 'enforced'` so `determineStatus` treats them as positive evidence
(enforcement = met), not negative (`missing` = not_met).

## Acceptance test

1. `npx tsc --noEmit` passes in ces-eo after importing the updated type.
2. `ControlAssessor.determineStatus` treats `result: 'enforced'` as positive (met).
3. `type: 'adminops_execution'` sources survive the blob-artifact filter.

## Current EO workaround

EO uses `type: 'evidence_import'` with `detail` prefixed `'adminops:'` to distinguish
AdminOps sources. The blob-artifact drop and enforcement semantics are documented as
known limitations in the flow-through report.

## Status

**Closed — 2026-09-27.** Satisfied by ces-shared commit `c0b80b3`
(`ces-shared/src/types/controls.types.ts:29`, `adminops_execution` + `enforced`).
EO continues using `evidence_import` as interim type until E5 adopts the shared contract.
