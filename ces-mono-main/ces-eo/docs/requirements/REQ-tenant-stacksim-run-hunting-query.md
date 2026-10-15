# REQ — tenant-stacksim: serve `/security/runHuntingQuery` (advanced-hunting read query (TVM recency))

- **Filed by:** ces-eo (FC-EO-D, EO-03, 2026-09-28)
- **Target:** tenant-stacksim (`../tenant-stacksim`)
- **Status:** DONE (2026-09-28, verified by FC-EO-H) — `tenant-stacksim` commit `05532d0` added the
  POST special-case. Re-run against the live (already-running) sim:
  `tests/integration/eo-live-sim-coverage.test.ts` yields a `success` signal `tvmAssessmentRecency`
  with non-empty data.

## Why
EO-03 added an automatic signal for **RA.L2-3.11.2**. EvidenceOps reads it through the Graph PowerShell shim as
`Invoke-MgGraphRequest -Method POST -Uri '/v1.0/security/runHuntingQuery'`, paging with `@odata.nextLink` for GET collections.
The sim does not serve it today, so on the live-sim path the read comes back as `error` and the control is
`not_assessed`. The integrity rule holds, but the signal is never exercised end to end.

## Ask
- The shim answers `Invoke-MgGraphRequest` for this relative `/v1.0/...` URI (method POST) from the sim store.
- Seed data in the documented Graph v1.0 shape: response `{ schema: [...], results: [{ DeviceId, DeviceName, LastAssessed }] }` for the query `DeviceTvmInfoGathering | summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName`. This is a POST that reads only; it must not mutate the sim store.
- The seed should include at least one record that makes the evaluator reach `met` and one that does not.

## Acceptance
An EO live-sim capture (`tests/integration/eo-live-sim.test.ts`) yields a `success` signal `tvmAssessmentRecency` with non-empty data.
Shape reference: `ces-eo/tests/fixtures/signal-coverage/`.
