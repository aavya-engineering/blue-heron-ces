# REQ-STAMPER-CLI-NO-RESULTS-MANIFEST — `stamper execute` (CLI) writes no execution-results manifest

- **Status:** CLOSED 2026-09-27 by ces-stamper FX-ST6 (`9a482aa`); proven live by ces-tester FX-TE4
- **Filed:** 2026-09-27, flow-through fix batch FX-TE3 / MS-R9
- **Owner:** ces-stamper
- **Filed by:** ces-tester, branch `flow-through-2026-09`
- **Unblock condition:** the CLI `execute` path builds the same manifest the server route builds
  (`ExecutionResultsCollector.buildManifestForPlan`, shared `ExecutionResultsManifest` 1.1.0) and writes
  it to `<CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/execution-results-<planId>.json` (or prints
  its path). ces-tester can then close the loop inside `run-scenario` itself instead of a second
  execution through the GUI server.

## Evidence (ces monorepo `487ad97`, read-only)

- The manifest is built and written only in the GUI server's SSE route:
  `ces-stamper/src/server/routes/execute.routes.ts:2348-2356` (`buildManifestForPlan` →
  `execution-results-${plan.plan_id}.json` in `tenantStateDir`, plus an `execution_results_manifest` event).
  `ExecutionResultsCollector.recordControlResult` is called only from that file.
- Non-test files under `ces-stamper/src` that mention `buildManifestForPlan` or `ExecutionResultsCollector`:
  only `core/ExecutionResultsCollector.ts` and `server/routes/execute.routes.ts` — nothing under `src/cli/`.
  The X2 run `ft-te2-x2-1` (`stamper translate` + `stamper execute --mode auto`
  on stacksim) left only `execution-report-*.json|md` in its state dir, no `execution-results-*.json`.

## Why it matters

MS-R9's loop (Stamper results → Muster directive status) works only when Stamper is driven through its
GUI server. Any CLI-driven run — ces-tester's scenarios, `run-m2`, scripted/CI runs — produces nothing
Muster can ingest. FX-TE3 therefore proves the loop through the server route
(`tests/flow/results-loop.flow.test.ts`), not through the scenario's CLI execution.

## Boundary

ces-tester did not change ces-stamper (write boundary).

## Closure (2026-09-27, ces-tester FX-TE4)

- **Fix:** ces-stamper `9a482aa` (FX-ST6). CLI `execute --tenant <slug>` (and `translate --execute`)
  builds the manifest with `ExecutionResultsCollector.buildManifestForPlan` through the new shared
  `core/ExecutionResultsPublisher.ts`. It writes the manifest to
  `<CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/execution-results-<planId>.json`. When
  `CES_MUSTER_API_URL` is set, it delivers the manifest to Muster `POST /api/plan/results` and
  records the outcome in `execution-results-<planId>.delivery.json`.
- **Proof:** `tests/flow/cli-results-delivery.flow.test.ts` (opt-in `CES_TESTER_FLOW_LIVE=1`), run live
  on 2026-09-27 against ces monorepo `8da49c2` and ces-muster `af57228`: **5/5 pass** in about 8.5 min.
  The run used stacksim, a temp `CES_PIPELINE_ROOT`, and a local muster-api (`createApp`, `mintToken`
  token). There were three CLI executions of the Muster-generated plan (110 directives), each with
  its own STORAGE_ROOT:
  - dry run: manifest with 110 results, parses with the ces-shared `ExecutionResultsManifestSchema`;
    delivery `skipped` (dry_run); 0 ledger mutations; Muster still 110/110 pending;
  - live: delivery `delivered`, HTTP 200. Muster's `/plan/status` went to 110/110 reported
    (sat 81, not_sat 29, 0 unmatched) with no tester POST. Exactly one results POST reached Muster,
    and it was Stamper's. The run made 55 ledger mutations;
  - live with Muster stopped: delivery `failed` (ECONNREFUSED). Exit code 0 and report status
    `partial`, the same as the delivered run. The manifest and `.delivery.json` remain, and the saved
    report's `resultsManifest.delivery.status` is `failed`.
