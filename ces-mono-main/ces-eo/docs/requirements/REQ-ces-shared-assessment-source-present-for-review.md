# REQ: AssessmentSource.result — add a "present for review" value

**Target:** ces-shared
**Filed by:** ces-eo (FC-EO-F, Evidence Collector M4a wiring)
**Date:** 2026-09-28
**Priority:** P3 — cosmetic/semantic; current workaround is safe

## What

Add a result value to `AssessmentSource.result` in `ces-shared/src/types/controls.types.ts:32`
that means "evidence exists but is unreviewed/unverified" — distinct from every current value:

```
'exists' | 'missing' | 'error' | 'no_query' | 'imported' | 'enforced'
```

Suggested addition: `'unreviewed'` (or similar).

## Why

`ces-eo/src/eo/evidence/EcEvidenceReader.ts` (`ecItemsToSources`) maps each EC evidence item
(a manual upload / attestation, never verdict-bearing per the Evidence Collector contract) to
an `AssessmentSource` with `type: 'ec_capture'`. It deliberately uses `result: 'no_query'`
because that is the one existing value `ControlAssessor.determineStatus` treats as neither
positive (`exists`/`imported`) nor negative (anything else, when other sources exist) — the
correct behavior for a manual upload, which must never auto-satisfy or demote a control.

But `'no_query'` is semantically borrowed: it's meant to mean "we did not check" (see
`SignalToControlMapper.ts`, used when a signal evaluator has nothing applicable to query), not
"a human uploaded something for someone else to check." `ces-eo/public/index.html`'s
`buildTaskActionDetail` has to special-case `type === 'ec_capture' && result === 'no_query'`
to avoid painting a manual upload with the same neutral/no-signal styling a real "nothing was
queried" case gets, which is a symptom of the missing distinct value.

## Acceptance test

1. `npx tsc --noEmit` passes in ces-eo after adopting the new value.
2. `ControlAssessor.determineStatus` treats the new value the same as `no_query` today
   (neither positive nor negative) — no behavior change, only a clearer label.
3. `ecItemsToSources` emits the new value instead of `no_query`; the UI's `ec_capture`
   special-case in `buildTaskActionDetail` can be simplified to just checking `type`.

## Current EO workaround

`EcEvidenceReader.ecItemsToSources` uses `result: 'no_query'`, which is functionally correct
(verified by `tests/eo/assessment/ControlAssessor.ecItems.test.ts`) but not self-documenting.
`public/index.html`'s `buildTaskActionDetail` special-cases `type === 'ec_capture'` to render a
neutral badge instead of the default "not positive => red" one.

## Status

**Open.**
