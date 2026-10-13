# REQ-EO-ASSESSMENT-SCOPE-POINTER-CRASH

**Filed by:** ces-tester (GP-DEMO-3, M7 live run)
**Date:** 2026-08-29
**Against:** `ces-eo`
**Severity:** HIGH — on the default environment, `GET /api/assessment` and `GET /api/sprs`
return **500 permanently** for a tenant once more than one EO storage root has ever written
to the same repository. Every consumer that reads an assessment through the API — including
ces-tester's demo legs and any EO UI panel that fetches the snapshot — is dead on that box
until the database is cleaned.
**Status:** OPEN — ces-tester is boundary-bound and will NOT patch this. Worked around
on our side by giving every EO process its own run-scoped `CES_PIPELINE_ROOT`.

## Summary

`AssessmentStore.loadLatest()` (`ces-eo/src/eo/assessment/AssessmentStore.ts:61-72`) lists the
`eo_assessments` collection for a `tenantId` and sorts by `generatedAt`:

```ts
const records = this.repo
  .list<AssessmentSnapshot>(ASSESSMENTS_COLLECTION, { tenantId })
  .filter((r) => r.id !== this.scopePointerId());      // <- excludes only THIS root's pointer
...
  .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));   // <- line 70, throws
```

The collection holds two kinds of record:

1. **Snapshots** — `data` is an `AssessmentSnapshot` (has `generatedAt`).
2. **Scope pointers** — id `eo_assessments:scope:<storageRoot>`, `data` is `{ tenantId }`
   only (written by `save()`, lines 52-56). **No `generatedAt`.**

The filter removes only the pointer whose id matches **this store's own** `storageRoot`. Every
pointer written by a *different* storage root survives into the sort, and
`b.generatedAt.localeCompare(...)` throws `TypeError: Cannot read properties of undefined
(reading 'localeCompare')`. The route has no try/catch, so Express renders a 500.

Because ADR-002 moved persistence from `eo-storage/assessments/*.json` into the unified
repository at `{CES_PIPELINE_ROOT}/ces.db`, `STORAGE_ROOT` no longer isolates anything: it only
changes the **pointer id**. So a fresh storage root does not give a fresh view — it adds one
more poison record to the shared database.

## Evidence (measured live, 2026-08-29)

**Reproduction** — boot ces-eo against the default `CES_PIPELINE_ROOT`, run one assess, then
read the snapshot back:

```
assess status 200 ... {"type":"assess_done"}
GET /api/assessment -> 500
GET /api/sprs        -> 500

TypeError: Cannot read properties of undefined (reading 'localeCompare')
    at <anonymous> (ces-eo\src\eo\assessment\AssessmentStore.ts:70:37)
    at Array.sort (<anonymous>)
    at AssessmentStore.loadLatest (ces-eo\src\eo\assessment\AssessmentStore.ts:70:8)
    at <anonymous> (ces-eo\src\eo\server\routers\assessment-router.ts:497:36)
```

**The poisoned state** — `C:\CES_Pipeline\ces.db`, collection `eo_assessments`: **72 records**,
roughly half of them scope pointers, e.g.

```
id = eo_assessments:scope:C:\Users\mhsut\AppData\Local\Temp\eo-sim-storage-Ib2Swf
data = {"tenantId":"00000000-0000-0000-0000-000000000000"}      <- no generatedAt
```

They accumulate one per EO run because `ces-tester`'s own `eo-leg.ts` (and anything else that
boots EO with a temp storage root) gets a fresh directory each time — a perfectly legitimate
use of a documented env var.

**Control:** a fresh, empty `CES_PIPELINE_ROOT` (exactly one pointer in the database) returns
`200` from both routes on the same code path — which is what identifies the foreign pointers,
and nothing else, as the cause.

**Blast radius beyond this demo:** the older `demo:run` needle's EO leg reads the same routes,
so it is broken on any box whose global database has accumulated pointers. Nothing warns; the
assess itself still reports success on screen, and only the read-back fails.

## Ask

Any one of these closes it; the first is the smallest:

1. **Exclude every pointer record from the snapshot query**, not just this root's — e.g. filter
   on `r.id.startsWith(`${ASSESSMENTS_COLLECTION}:scope:`)`, or defensively skip records whose
   `data.generatedAt` is missing before sorting.
2. **Store scope pointers in their own collection** (e.g. `eo_assessment_scopes`) so a snapshot
   query can never see them.
3. **Make the sort total-order safe** — treat a missing `generatedAt` as the epoch rather than
   throwing — and return 404/empty rather than 500 when nothing sortable remains.

A regression test worth having: save from two different `storageRoot`s under one repository,
then `loadLatest()` from each — today the second read throws.

## What ces-tester did instead (no sibling write)

`src/demo/e2e-run.ts` now gives **each EO beat its own run-scoped `CES_PIPELINE_ROOT`**
(`runs/e2e/<runId>/eo-pipeline-{before,after}`), so each EO process sees exactly one scope
pointer — its own. This is an environment choice inside our own boundary (the demo plan's risk
table already called for run-scoped pipeline roots), not a patch to the defect. Sharing one
pipeline root across the two EO beats would reintroduce the crash on the second beat, so the
per-beat split is load-bearing for as long as this REQ is open.
