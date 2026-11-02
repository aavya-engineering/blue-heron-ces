# REQ — tenant-stacksim: serve `/users` (directory users with licence/enabled fields)

- **Filed by:** ces-eo (FC-EO-D, EO-03, 2026-09-28)
- **Target:** tenant-stacksim (`../tenant-stacksim`)
- **Status:** DONE (2026-09-28, verified by FC-EO-H) — `tenant-stacksim` commit `05532d0` added a
  disabled leaver user (user-12) so this collection GET (and personnel-action residual-access checks)
  has a real subject. Re-run against the live (already-running) sim:
  `tests/integration/eo-live-sim-coverage.test.ts` yields a `success` signal `directoryUsers` with
  non-empty `value[]`.

## Why
EO-03 added an automatic signal for **AT.L2-3.2.1, AT.L2-3.2.3 and PS.L2-3.9.2**. EvidenceOps reads it through the Graph PowerShell shim as
`Invoke-MgGraphRequest -Method GET -Uri '/v1.0/users?$select=id,userPrincipalName,accountEnabled,userType,assignedLicenses&$top=999'`, paging with `@odata.nextLink` for GET collections.
The sim serves only item-level `/v1.0/users/*` (no collection GET with `$select`) today, so on the live-sim path the read comes back as `error` and the control is
`not_assessed`. The integrity rule holds, but the signal is never exercised end to end.

## Ask
- The shim answers `Invoke-MgGraphRequest` for this relative `/v1.0/...` URI (method GET) from the sim store.
- Seed data in the documented Graph v1.0 shape: `value[]` of `{ id, userPrincipalName, accountEnabled, userType, assignedLicenses[] }` (honour `$select`), including a disabled account.
- The seed should include at least one record that makes the evaluator reach `met` and one that does not.

## Acceptance
An EO live-sim capture (`tests/integration/eo-live-sim.test.ts`) yields a `success` signal `directoryUsers` with non-empty data.
Shape reference: `ces-eo/tests/fixtures/signal-coverage/`.
