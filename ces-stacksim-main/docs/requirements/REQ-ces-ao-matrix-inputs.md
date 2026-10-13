# REQ-ces-ao-matrix-inputs — six AO matrix rows that only AO can close

- **From:** tenant-stacksim (SIMFIX FIX-S4, 2026-09-27)
- **To:** ces-ao (`test/integration/opInputs.ts`, `test/integration/matrixClassify.ts`, registry command text, and the REQ files the matrix test checks)
- **Status:** OPEN
- **Evidence:** AO's own matrix (`AO_STACKSIM_IT=1 npx vitest run test/integration/ao95.matrix.stacksim.test.ts`, no `AO_MATRIX_WRITE`) against tenant-stacksim master: **PASS 84 · HONEST-OPEN 11 · FAILING 0** (was 19/76/0). Rendered in `tenant-stacksim/docs/coverage/AO-95-OP-RERUN-2026-09-27.md`.

## What

On these rows the sim does what a real tenant does; the input, the command text or the classifier decides the outcome.
Each one PASSes in the sim's own self-certification (`npm run coverage:ao`, `docs/coverage/AO-SEMANTIC-COVERAGE.md`)
with a correct input, except E-07 (command text).

| Op | Cause | Ask |
|---|---|---|
| A-05 | `opInputs` targets `sim.user4` for A-05, but A-02 (earlier in the run) already disabled `sim.user4`. Disabling a disabled user changes nothing - on a real tenant too. | Give A-05/A-06 their own user, e.g. `sim.inactive1@simtenant.onmicrosoft.us` (seeded, enabled). |
| A-20 | `policyDisplayName: 'Sim CA Policy 1'` names ONE policy, so the dedupe correctly does nothing. | Use `Sim Duplicate CA Policy` (the seeded pair: one enabled, one disabled). |
| F-08 | `driftResourceId: 'caPolicy-1'` is a Conditional Access policy id, not an ARM resource id; `az resource update --ids caPolicy-1` is a 404 (as on Azure). | Use a seeded ARM id, e.g. `/subscriptions/sim-sub/resourceGroups/sim-rg/providers/Microsoft.Storage/storageAccounts/simstorage1` with `driftProperty: supportsHttpsTrafficOnly`, `expectedValue: true`. |
| H-01 | `incidentId: 'alert-1'` is an alert id. `Get-MgSecurityIncident -IncidentId alert-1` is now an honest 404 (it used to act on a singleton regardless of the id - the wrong-object class SIMFIX FIX-S1 removed). | Use `incident-1` (seeded new high-severity incident). |
| D-02 | `NO_DATA_OBSERVED['D-02']` in `matrixClassify.ts` forces HONEST-OPEN whatever the output. The sim returns both DLP policies and DLP audit rows; AO's captured stdout shows only the IPPS connection banner because the first object written to the pipeline (`Organization`/`ConnectionUri`) sets the table columns and the later objects render under those columns as blanks. | Make the command emit its own output (`... | ConvertTo-Json` or `Out-String` per statement) and drop the `NO_DATA_OBSERVED` override. |
| E-07 | `-Operations Add member to role,Activate role` is unquoted: PowerShell binds `-Operations 'Add'` and the rest as positional arguments (real EXO rejects them). | Quote the names: `-Operations 'Add member to role.','Activate role'` (the sim holds `Add member to role.` records). |

## Also needed for AO's own test to go green

`ao95.matrix.stacksim.test.ts` asserts every HONEST-OPEN op is named in the REQ file its family maps to. With the sim
fixed, A-05, B-08, H-01 now map to `REQ-tenant-stacksim-graph-fidelity` and F-08 to `REQ-tenant-stacksim-m365-compliance`,
which do not list them, so the second `it` fails even though every verdict is PASS/HONEST-OPEN and FAILING is 0.
Either point those rows at this REQ / `REQ-ces-ao-paired-reads.md`, or apply the input fixes above (then only the
paired-read rows remain).

## Acceptance

AO's matrix with the fixes above: A-05, A-20, F-08, H-01, D-02, E-07 PASS; the REQ-naming assertion green.
