# REQ — tenant-stacksim: serve `/security/incidents` (Defender XDR incidents with alerts)

- **Filed by:** ces-eo (FC-EO-D, EO-03, 2026-09-28)
- **Target:** tenant-stacksim (`../tenant-stacksim`)
- **Status:** DONE (2026-09-28, verified by FC-EO-H) — `tenant-stacksim` commit `05532d0` added the
  collection-GET resolver (distinct from AO's item-level `Get-MgSecurityIncident`). Re-run against the
  live (already-running) sim: `tests/integration/eo-live-sim-coverage.test.ts` yields a `success` signal
  `securityIncidents` with non-empty `value[]` (seeded with `alerts[]` from 2 sources).

## Why
EO-03 added an automatic signal for **AU.L2-3.3.5**. EvidenceOps reads it through the Graph PowerShell shim as
`Invoke-MgGraphRequest -Method GET -Uri '/v1.0/security/incidents?$expand=alerts&$filter=createdDateTime ge <iso>'`, paging with `@odata.nextLink` for GET collections.
The sim does not serve it today, so on the live-sim path the read comes back as `error` and the control is
`not_assessed`. The integrity rule holds, but the signal is never exercised end to end.

## Ask
- The shim answers `Invoke-MgGraphRequest` for this relative `/v1.0/...` URI (method GET) from the sim store.
- Seed data in the documented Graph v1.0 shape: `value[]` of `{ id, displayName, createdDateTime, status, alerts: [{ id, serviceSource, detectionSource }] }` (honour `$expand=alerts` and a `createdDateTime ge` filter).
- The seed should include at least one record that makes the evaluator reach `met` and one that does not.

## Acceptance
An EO live-sim capture (`tests/integration/eo-live-sim.test.ts`) yields a `success` signal `securityIncidents` with non-empty data.
Shape reference: `ces-eo/tests/fixtures/signal-coverage/`.
