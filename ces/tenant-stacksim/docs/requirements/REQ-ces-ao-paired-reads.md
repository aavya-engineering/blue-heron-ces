# REQ-ces-ao-paired-reads — five AO commands whose own read cannot observe their write

- **From:** tenant-stacksim (SIMFIX FIX-S2/S4, 2026-09-27)
- **To:** ces-ao (registry get_command text for the ops below)
- **Status:** OPEN
- **Evidence:** AO matrix rerun (`tenant-stacksim/docs/coverage/AO-95-OP-RERUN-2026-09-27.md`) and the sim's self-certification
  (`tenant-stacksim/docs/coverage/AO-SEMANTIC-COVERAGE.md`): the set runs clean and the sim records the change, but the
  command's paired GET does not read the field the set changed, so `stateChanged` stays false. A real tenant behaves the same.

| Op | What the set changes (and the sim now stores) | What the paired GET reads | Ask |
|---|---|---|---|
| A-07 | the user's per-user MFA requirement (`perUserMfaState`) + the Authenticator method policy state | the user's authentication METHODS (none are added) | Read the requirement (real Graph: `/beta/users/{id}/authentication/requirements`; the sim stores it as `perUserMfaState` on the user, readable with `Get-MgUser -UserId {upn} -Property perUserMfaState`) or the Authenticator configuration state. If AO adopts the beta URI, file a REQ back and the sim will serve it. |
| B-05 | wipe / retire queued on each of the user's devices (`managementState` wipePending/retirePending, `deviceActionResults`) - Intune keeps the record until check-in | Id, DeviceName, OperatingSystem, ManagedDeviceOwnerType, ComplianceState | Add `ManagementState` (and/or `DeviceActionResults`) to the projection. |
| B-08 | adds the app to the Android app-protection policy | Id, DisplayName, IsAssigned, AppGroupType of both policies | Read the policy's apps: `Get-MgDeviceAppManagementAndroidManagedAppProtectionApp -AndroidManagedAppProtectionId {id}`. |
| C-09 | the `Password Rule Settings` directory setting values (BannedPasswordList, LockoutThreshold) | authorization policy + `az ad auth password-policy show` | Read `Get-MgDirectorySetting | Where-Object DisplayName -eq 'Password Rule Settings' | Select-Object -ExpandProperty Values`. |
| D-03 | opens compliance case + hold, revokes sessions, disables the user | the DLP audit search | Read the case/hold (`Get-ComplianceCase -Identity 'CUI-Exfil-{incidentId}'; Get-CaseHoldPolicy -Case ...`) or the user's AccountEnabled. Note also `-CaseType eDscovery` is misspelled (real EXO: `eDiscovery`). |

## Acceptance

AO's matrix: each row's paired read changes after the set (`stateChanged=true`) - PASS.
