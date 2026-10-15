# Automatic-signal coverage — feasibility of the 31 uncovered controls (FC-EO-D, EO-03, 2026-09-28)

**Result: 79/110 → 85/110** reference controls have an automated (graph) signal in the registry EvidenceOps evaluates.
Six controls were added; 25 were ruled out. Pinned by `tests/unit/claim-accuracy.test.ts`.

## The bar (applied to all 31)
A control counts only if a **read-only, tenant-scoped** read (Graph / Exchange / Purview / Azure / Defender / Sentinel) can
reach **SAT from observed tenant state alone**. Evidence that can only ever be partial is ruled out here, not built:
physical safeguards, off-tenant reporting, process documents and training *content* the tenant cannot see.
Manual evidence for ruled-out controls belongs to the Evidence Collector (EC), not to this work.

Integrity rules in every new evaluator (`src/eo/mapping/evaluators/coverage-evaluators.ts`):
- a failed or refused read → `not_assessed`;
- an **empty read → NOT_SAT** (`not_met`);
- `met` only on observed state covering the whole requirement, never on a licence, capability or intent;
- partial evidence → `partial`, never `met`.

## Where the signals live
- Originally shipped as an **EO-owned overlay** (`src/eo/mapping/eoRegistryOverlay.ts`, merged by
  `src/eo/mapping/effectiveRegistry.ts`) because the shared registry (`ces-shared/data/control-signal-registry`) was
  outside this module's write boundary. **Update (FC-EO-H, 2026-09-28):** ces-shared 2.8.0 promoted all six entries
  verbatim into the shared Microsoft registry itself (`REQ-ces-shared-signal-registry-overlay.md`, now closed) — the
  overlay and its merge are deleted; `SignalToControlMapper` loads the shared registry directly.
- Every overlay endpoint is actually fetched: `ComplianceSignalFetcher.fetchCoverageSignals()` is wired into
  `fetchAllSignals()`. It reads all pages via `Invoke-MgGraphRequest`, which returns flat Graph JSON. Users, role
  assignments and managed devices are re-read with paging under their own signal ids (`directoryUsers`,
  `roleAssignmentsAll`, `managedDevicesAll`), so existing evaluators' inputs are unchanged.
- The only POST is `security/runHuntingQuery`, an advanced-hunting **read query** (KQL, no mutation). The test asserts
  that every other read is a GET and that no mutating verb or cmdlet is used.

## Table — all 31

| # | Control | Candidate signal | API (read-only) | Verdict rule / why not | Result |
|---|---|---|---|---|---|
| 1 | AT.L2-3.2.1 security awareness | Attack-simulation training completions vs. the user population | `GET /v1.0/reports/security/getAttackSimulationTrainingUserCoverage` + `GET /v1.0/users?$select=id,userPrincipalName,accountEnabled,userType,assignedLicenses` | Population = enabled, licensed members (guests and unlicensed break-glass accounts are excluded). **met** = every one has a `completed` training ≤365 days old. Some → partial. None / empty report / empty population → not_met. If training runs in another LMS, the result is NOT_SAT and the evidence goes to EC. | **BUILT** `awarenessTrainingCoverageEvaluator` |
| 2 | AT.L2-3.2.2 role-based training | — | — | The training's *role-specific content* can't be seen in the tenant. Training records can't be tied to assigned security duties. At best partial. | ruled out |
| 3 | AT.L2-3.2.3 insider-threat awareness | Same report, completed trainings whose title contains "insider" | as #1 | **met** = every in-scope user completed an insider-titled training ≤365 days old. General awareness training does not count. Partial / not_met as #1. | **BUILT** `insiderThreatTrainingEvaluator` |
| 4 | AU.L2-3.3.5 correlate audit review/analysis/reporting | Defender XDR incidents that correlate alerts across sources | `GET /v1.0/security/incidents?$expand=alerts&$filter=createdDateTime ge <now−90d>` | **met** = ≥1 incident in 90 days whose alerts come from ≥2 distinct `serviceSource`s. Single-source only → partial. None, stale or empty → not_met. | **BUILT** `incidentCorrelationEvaluator` |
| 5 | AU.L2-3.3.8 protect audit information | Log workspace locks / RBAC | ARM locks | M365 unified-audit immutability is platform-inherited, so a read would be tautological. A workspace lock proves deletion protection only. Access and modification protection spans RBAC across services. Partial only. | ruled out |
| 6 | AU.L2-3.3.9 limit audit management to a subset of privileged users | Holders of audit-management rights | Entra `roleAssignments` + Exchange/Purview `Get-RoleGroupMember` | Audit-management rights are split three ways: Entra roles, Exchange RBAC role groups (whose members can include linked `TenantAdmins_*` groups; whether those resolve to users through `ExternalDirectoryObjectId` has not been checked on a live tenant) and Purview role groups. An Entra-only read cannot reach SAT. A sound signal needs all three resolved; see follow-up F3. | ruled out (follow-up F3) |
| 7 | CM.L2-3.4.4 security impact analysis | — | — | Impact analysis is a pre-change process. The tenant records changes (directory audits), not the analysis. | ruled out |
| 8 | IR.L2-3.6.2 track, document, report incidents | Incidents with assignment/classification | `/security/incidents` | Tracking and documentation are visible. Reporting to designated officials and authorities (for example the 72-hour DIBNet report) is off-tenant. Partial only. | ruled out |
| 9 | IR.L2-3.6.3 test IR capability | — | — | IR tests (tabletop and exercises) are not recorded in the tenant. Attack simulation is phishing training, not an IR test. | ruled out |
| 10 | MA.L2-3.7.1 perform maintenance | Update rings | Intune | Maintenance covers hardware, firmware and software records. Patching is one slice and is already evidenced under SI. Partial only. | ruled out |
| 11 | MA.L2-3.7.2 control maintenance tools/personnel | — | — | Procedural and physical. | ruled out |
| 12 | MA.L2-3.7.3 sanitize equipment for off-site maintenance | — | — | Physical. | ruled out |
| 13 | MA.L2-3.7.6 supervise uncleared maintenance personnel | — | — | Physical and procedural. | ruled out |
| 14 | MP.L1-3.8.3 sanitize media before disposal/reuse | Intune wipe | Intune | A remote-wipe *capability* is not sanitization of disposed media. The shared registry used to key `mediaDisposalEvaluator` under the non-reference id `MP.L2-3.8.3`, returning met when managed devices merely exist. **Deliberately not re-keyed or counted** at the time; see the REQ. **Update (FC-EO-H / ces-shared 2.8.0, 2026-09-28):** ces-shared re-keyed `MP.L1-3.8.3` to `manualGateEvaluator` (a real manual gate, not the capability evaluator); EO deleted the now-orphaned `mediaDisposalEvaluator` as dead code. Still not counted as automated coverage — correctly, now via a manual gate. | ruled out |
| 15 | MP.L2-3.8.4 mark media | Sensitivity labels with content marking | Purview labels | Covers digital files only. Physical media marking can't be observed. Partial only. | ruled out |
| 16 | MP.L2-3.8.9 protect backup CUI | Backup vault encryption | Azure | M365 has no customer backup store. Azure Backup encryption at rest is a platform default (tautological). Off-site backup media can't be observed. | ruled out |
| 17 | PE.L1-3.10.1 limit physical access | — | — | Physical. | ruled out |
| 18 | PE.L2-3.10.2 protect/monitor facility | — | — | Physical. | ruled out |
| 19 | PE.L1-3.10.3 escort/monitor visitors | — | — | Physical. | ruled out |
| 20 | PE.L1-3.10.4 physical access logs | — | — | Physical (badge systems are off-tenant). | ruled out |
| 21 | PE.L1-3.10.5 manage physical access devices | — | — | Physical. | ruled out |
| 22 | PE.L2-3.10.6 alternate work sites | Device compliance + CA | Intune/CA | The device half is already evidenced under AC/CM. Physical safeguarding at the site can't be observed. Partial only. | ruled out |
| 23 | PS.L2-3.9.1 screen individuals | — | — | HR screening is off-tenant. | ruled out |
| 24 | PS.L2-3.9.2 protect CUI during personnel actions | Lifecycle leaver/mover workflows + residual access of disabled accounts | `GET /v1.0/identityGovernance/lifecycleWorkflows/workflows?$expand=tasks`, `/v1.0/users`, `/v1.0/roleManagement/directory/roleAssignments` | **met** = an enabled **and scheduled** leaver workflow with a Disable/Delete-user-account task, plus an enabled, scheduled mover workflow, plus **no disabled account holding a directory role**. Mover missing → partial. No leaver, residual role or empty → not_met. | **BUILT** `personnelActionAccessEvaluator` |
| 25 | RA.L2-3.11.1 periodic risk assessment | Secure Score | Graph | A risk assessment is a documented process. Secure Score is platform posture, not a risk assessment. | ruled out |
| 26 | RA.L2-3.11.2 vulnerability scanning | Defender vulnerability-management assessment recency per device | `POST /v1.0/security/runHuntingQuery` (read query `DeviceTvmInfoGathering \| summarize LastAssessed = max(Timestamp) by DeviceId, DeviceName`) + paged `/v1.0/deviceManagement/managedDevices` | **met** = ≥1 device, every device assessed ≤7 days ago, and no managed Windows/macOS device missing from the assessment. Some stale or missing → partial. All stale or empty → not_met. The existing `/security/microsoft/vulnerabilities` read is *not* used: it maps to the threat-intelligence CVE catalogue, not tenant scan results. | **BUILT** `vulnScanRecencyEvaluator` |
| 27 | CA.L2-3.12.1 periodic control assessment | — | — | The assessment is EO's own output, not a tenant read. | ruled out |
| 28 | CA.L2-3.12.2 plans of action | — | — | The POA&M is EO data (poam module), not tenant state. | ruled out |
| 29 | CA.L2-3.12.3 continuous monitoring | Secure Score history | Graph | The platform computes it daily whatever the organization does. Counting it would be SAT on platform behaviour. | ruled out |
| 30 | CA.L2-3.12.4 system security plan | — | — | A document, which EO generates. | ruled out |
| 31 | SC.L2-3.13.7 prevent split tunneling | Intune VPN profiles | existing `GET /deviceManagement/deviceConfigurations` (SDK shape; the property is read from `AdditionalProperties` or flat) | **met** = ≥1 `*VpnConfiguration` profile and **every** one sets `enableSplitTunneling = false`. True or unset → not_met. No VPN profile → not_met (not evidenced). | **BUILT** `splitTunnelingEvaluator` |

**Ruled out, grouped (25):**
- **Physical (8):** PE ×6 (PE.3.10.6's device half is already covered under AC/CM), MA.3.7.3, MA.3.7.6.
- **Procedural, process or EO-owned documents (9):** CM.3.4.4, PS.3.9.1, RA.3.11.1, CA.3.12.1–.4 (for CA.3.12.3 the
  only read is a platform constant), MA.3.7.2, IR.3.6.3.
- **Partial-only reads (5):** AT.3.2.2, AU.3.3.8, IR.3.6.2, MA.3.7.1, MP.3.8.4.
- **Tautological or platform-inherited (1):** MP.3.8.9.
- **Capability, not state (1):** MP.3.8.3.
- **Needs a three-way RBAC read (1):** AU.3.3.9 (follow-up F3).

## Tests (fixtures: `tests/fixtures/signal-coverage/`, Graph v1.0 / SDK shapes, synthetic ids)
- `tests/mapping/evaluators/coverageEvaluators.test.ts`: verdicts on each fixture, plus failed → not_assessed,
  empty → not_met, partial ≠ met, and SDK vs flat shape.
- `tests/mapping/signalCoverage.test.ts` (renamed from `signalCoverageOverlay.test.ts` in FC-EO-H, 2026-09-28, when
  the overlay was retired): fetched endpoints, read-only commands, and end to end (fetcher → mapper → verdicts; all
  reads failing → no coverage control met). The overlay-merge-mechanics tests it used to carry are gone along with
  the overlay itself — coverage is now asserted directly against the shared registry.
- `tests/unit/claim-accuracy.test.ts`: the shared registry alone is **85** (post FC-EO-H / ces-shared 2.8.0; no
  overlay addition needed any more).
- `tests/integration/eo-live-sim-coverage.test.ts` (FC-EO-H): confirms all six signals come back `success` with
  non-empty data against the LIVE tenant-stacksim sim, closing the six `REQ-tenant-stacksim-*.md` REQs.

Fixtures are hand-authored in the documented response shapes. Before relying on these verdicts for a customer, run
one live read per signal against a REAL Microsoft tenant (follow-up F1) — the live-sim test above proves the sim
path, not a live GCC High tenant.

## Findings outside this step (not changed here)
- **F1:** field names and Lifecycle-Workflow task-definition ids follow Microsoft's documented shapes. They have not
  been confirmed against a live GCC High tenant, and the sim does not serve these reads yet (the tenant-stacksim REQs).
- **F2:** `fetchExpandedSignals()` is never called by `fetchAllSignals()`, so `directoryAudits`, `signInLogs`,
  `attackSimulations`, `authMethodsUsers`, `riskDetections` and `secureScore` are not fetched on the capture path.
  `vulnRemediationEvaluator` reads `updateRings` and `userDeviceIdentifyEvaluator` reads `users`, and nothing fetches
  either. These gaps change existing verdicts, so they are left for a separate, separately tested change.
- **F3:** AU.L2-3.3.9 could be built once EO reads Exchange and Purview role-group membership. Note that
  `PowerShellFallbackAdapter.runPurviewCommands` connects Purview cmdlets with `Connect-ExchangeOnline`, not
  `Connect-IPPSSession`.
- **F4:** list cmdlets called without `-All` (for example `Get-MgRoleManagementDirectoryRoleAssignment`) may return
  only the first page. The new signals page explicitly.
- **F5:** the SSP `MANUAL_GATE_CONTROLS` set (`src/eo/ssp/SnippetDataResolver.ts`) is about *narrative inputs*
  (policy reference, responsible role), not signal coverage. It still lists the six controls, which is correct: an
  automated signal does not write their SSP narrative.
