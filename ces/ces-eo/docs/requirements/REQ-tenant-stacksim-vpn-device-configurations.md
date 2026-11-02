# REQ — tenant-stacksim: serve `/deviceManagement/deviceConfigurations` (Intune VPN profiles in deviceConfigurations)

- **Filed by:** ces-eo (FC-EO-D, EO-03, 2026-09-28)
- **Target:** tenant-stacksim (`../tenant-stacksim`)
- **Status:** DONE (2026-09-28, verified by FC-EO-H) — `tenant-stacksim` commit `05532d0` seeded a VPN
  `deviceConfiguration` (`enableSplitTunneling: false`). Re-run against the live (already-running) sim:
  `tests/integration/eo-live-sim-coverage.test.ts` confirms a `*VpnConfiguration` profile carrying
  `enableSplitTunneling` is present via `Get-MgDeviceManagementDeviceConfiguration`.

## Why
EO-03 added an automatic signal for **SC.L2-3.13.7**. EvidenceOps reads it through the existing Graph PowerShell shim cmdlet
`Get-MgDeviceManagementDeviceConfiguration` (signal `deviceConfigurations`).
The sim seeds no VPN profile (`*VpnConfiguration`) in this collection today, so on the live-sim path the read errors or has no VPN data and the control is
`not_assessed` / `not_met`. The integrity rule holds, but the signal is never exercised end to end.

## Ask
- The `Get-MgDeviceManagementDeviceConfiguration` shim returns the seeded VPN profiles.
- Seed data in the documented Graph v1.0 shape: add at least one `#microsoft.graph.windows10VpnConfiguration` with `enableSplitTunneling` to the existing collection (served via `Get-MgDeviceManagementDeviceConfiguration`, where the property sits under `AdditionalProperties`).
- The seed should include at least one record that makes the evaluator reach `met` and one that does not.

## Acceptance
An EO live-sim capture (`tests/integration/eo-live-sim.test.ts`) yields a `success` signal `deviceConfigurations` with non-empty data.
Shape reference: `ces-eo/tests/fixtures/signal-coverage/`.
