# REQ: ces-tester: Muster's "Run Discovery" button is no longer a fixture

**Filed by:** ces-muster (W4-MU2, 2026-09-27, commit 845f89d)
**Target module:** ces-tester
**Priority:** P3 (the documentation is now stale, but nothing is broken)

## What changed in Muster
`discovery-run-btn` no longer loads `DISCOVERY_RESULTS_FIXTURE`. It starts a real sim discovery job on
muster-api (`POST /api/discovery/run`, then polls `GET /api/discovery/run/:id`). The job runs the same service
as `mu discovery --sim`, and the SPA imports the returned readiness-result through the same parser the file
input uses. If muster-api or stacksim is down, the offer shows `discovery-run-error` and loads no rows.

The Discovery offer also has a new `harvest-sim-btn` ("Prefill from tenant (Graph, sim)"). It calls
`POST /api/harvest/run { sim: true }` and then opens the interview with the AUTO-DETECTED prefill.

## Ask
- `src/demo/muster-ui-driver.ts` says the button "loads a zero-network fixture" and that it must never be
  clicked. Update the comment. The CLI-walk-then-import act stays valid and is still the right seam for a
  recorded demo.
- Optional: a live act can now click Run Discovery directly when muster-api (signed in) and stacksim are up.
