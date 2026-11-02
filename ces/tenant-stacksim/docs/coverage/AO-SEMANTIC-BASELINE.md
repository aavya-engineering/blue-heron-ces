# AO semantic baseline (M0) — 95 AO commands against the pre-fix sim

Generated 2026-09-27 for GOAL-AO-SIM-COVERAGE M0 / SIMFIX FIX-S2.

**Sources (both read-only):**
- *Table rating* — ces-tester's structural review, `ces-tester/.worktrees/tester/docs/context/REVIEW.md`
  "Appendix — per-command stacksim coverage" (derived by reading code, **never executed**).
- *Observed* — the executed run of AO's own 95-op matrix
  (`ces-ao/test/integration/ao95.matrix.stacksim.test.ts`, 2026-09-27, `ces-ao/docs/AO-95-OP-MATRIX.md`)
  against this sim's dist at `9170eb8` (the pre-fix build, `m365_azure` profile, emitted tenant object as is).
  That run IS the empirical smoke M0 asks for: every op's real get/set text went through the real shims into
  the sim, and PASS means the read returned data or the write was observed by its paired read.

**Result:** table said Y for 18 ops; the executed run observed Y for 19. 21 rows disagree and are
marked CORRECTED — later milestones work from the *Observed* column.

Observed legend: `Y` = semantically served; `N (key unbound)` = the tenant object lacked the source key so AO
refused to send; `N (no semantic effect/data)` = ran clean but returned no data / the write was not visible to
the paired read; `N (sim error)` = the sim returned an error.

| Op | Table rating | Observed | Table vs observed | Observed detail (AO matrix reason) |
|---|---|---|---|---|
| A-01 | partial | N (key unbound) |  | tenant value unbound: resources.m365_license_sku_id — `REQ-tenant-stacksim-ao-source-keys` |
| A-02 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| A-03 | Y | N (no semantic effect/data) | CORRECTED | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| A-04 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| A-05 | partial | N (key unbound) |  | tenant value unbound: resources.loa_group_id — `REQ-tenant-stacksim-ao-source-keys` |
| A-06 | partial | N (key unbound) |  | tenant value unbound: resources.loa_group_id — `REQ-tenant-stacksim-ao-source-keys` |
| A-07 | N | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| A-08 | partial | Y | CORRECTED | live read returned tenant data; evidence row conforms; denies proven |
| A-09 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| A-10 | partial | N (sim error) |  | sim error: Invoke-RestMethod : The remote server returned an error: (500) Internal Server Error. At <ces>/tenant-stacksim\psmodules\Microsoft.Grap — `REQ-tenant-stacksim-graph-fidelity` |
| A-11 | partial | Y | CORRECTED | live read returned tenant data; evidence row conforms; denies proven |
| A-12 | partial | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| A-13 | Y | Y |  | live read returned tenant data; evidence row conforms; denies proven |
| A-14 | Y | N (key unbound) | CORRECTED | tenant value unbound: resources.named_location_id — `REQ-tenant-stacksim-ao-source-keys` |
| A-15 | Y | Y |  | live read returned tenant data; evidence row conforms; denies proven |
| A-16 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| A-17 | partial | N (key unbound) |  | tenant value unbound: resources.admin_group_id — `REQ-tenant-stacksim-ao-source-keys` |
| A-18 | Y | Y |  | live write changed the state its paired read observes; evidence row conforms; denies proven |
| A-19 | Y | Y |  | live write changed the state its paired read observes; evidence row conforms; denies proven |
| A-20 | Y* | N (no semantic effect/data) | CORRECTED | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| B-01 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| B-02 | Y | Y |  | live read returned tenant data; evidence row conforms; denies proven |
| B-03 | partial | Y | CORRECTED | live read returned tenant data; evidence row conforms; denies proven |
| B-04 | partial | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| B-05 | Y | N (no semantic effect/data) | CORRECTED | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| B-06 | partial | N (key unbound) |  | tenant value unbound: resources.it_helpdesk_phone — `REQ-tenant-stacksim-ao-source-keys` |
| B-07 | partial | N (key unbound) |  | tenant value unbound: resources.device_compliance_ca_policy_id — `REQ-tenant-stacksim-ao-source-keys` |
| B-08 | N | N (key unbound) |  | tenant value unbound: resources.android_app_protection_policy_id — `REQ-tenant-stacksim-ao-source-keys` |
| B-09 | N | N (key unbound) |  | tenant value unbound: resources.android_app_protection_policy_id — `REQ-tenant-stacksim-ao-source-keys` |
| B-10 | partial | Y | CORRECTED | live read returned tenant data; evidence row conforms; denies proven |
| B-11 | partial | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| B-12 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| B-13 | Y | N (sim error) | CORRECTED | write applied; post-state read failed on the sim: state read failed: Select-Object : Property "value" cannot be found. At line:21 char:152 + ... s' -OutputType PSObject \| Select-Object -Expa — `REQ-tenant-stacksim-graph-fidelity` |
| B-14 | N | N (sim error) |  | write applied; post-state read failed on the sim: state read failed: Select-Object : Property "value" cannot be found. At line:21 char:162 + ... s' -OutputType PSObject \| Select-Object -Expa — `REQ-tenant-stacksim-graph-fidelity` |
| C-01 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| C-02 | N | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| C-03 | Y | N (sim error) | CORRECTED | sim error: get-then-set aborted before the write: state read failed: az : az-shim error: The remote server returned an error: (500) Internal Server Error. At line:3 char:4 — `REQ-tenant-stacksim-azure-fidelity` |
| C-04 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| C-05 | Y | Y |  | live read returned tenant data; evidence row conforms; denies proven |
| C-06 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| C-07 | Y | Y |  | live read returned tenant data; evidence row conforms; denies proven |
| C-08 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| C-09 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-azure-fidelity` |
| C-10 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| D-01 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| D-02 | partial | N (no semantic effect/data) |  | output is only the IPPS connection banner (Organization / ConnectionUri); Get-DlpCompliancePolicy and Search-UnifiedAuditLog returned nothing — `REQ-tenant-stacksim-m365-compliance` |
| D-03 | N | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-m365-compliance` |
| D-04 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| D-05 | N | N (key unbound) |  | tenant value unbound: resources.cui_site_id — `REQ-tenant-stacksim-ao-source-keys` |
| D-06 | N | Y | CORRECTED | live write changed the state its paired read observes; evidence row conforms; denies proven |
| D-07 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| D-08 | partial | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| D-09 | N | N (key unbound) |  | tenant value unbound: resources.cui_group_id — `REQ-tenant-stacksim-ao-source-keys` |
| D-10 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| D-11 | Y* | N (sim error) | CORRECTED | sim error: CUI label 'CUI//SP-CTI' not found At line:16 char:109 + ... t 1; if (-not $l) { throw "CUI label 'CUI//SP-CTI' not found" }; Set- ... + ~~~~~~~~~~~~~~~~~~~~~~~~ — `REQ-tenant-stacksim-m365-compliance` |
| E-01 | partial | N (key unbound) |  | tenant value unbound: resources.audit_log_retention_days — `REQ-tenant-stacksim-ao-source-keys` |
| E-02 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| E-03 | partial | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| E-04 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| E-05 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| E-06 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| E-07 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| E-08 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| E-09 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| E-10 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| F-01 | Y | Y |  | live read returned tenant data; evidence row conforms; denies proven |
| F-02 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| F-03 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| F-04 | partial | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| F-05 | partial | Y | CORRECTED | live read returned tenant data; evidence row conforms; denies proven |
| F-06 | partial | Y | CORRECTED | live read returned tenant data; evidence row conforms; denies proven |
| F-07 | partial | N (key unbound) |  | tenant value unbound: resources.admin_portal_ca_policy_id — `REQ-tenant-stacksim-ao-source-keys` |
| F-08 | partial | Y | CORRECTED | live write changed the state its paired read observes; evidence row conforms; denies proven |
| F-09 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| F-10 | partial | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| F-11 | Y | N (key unbound) | CORRECTED | tenant value unbound: resources.firewall_name — `REQ-tenant-stacksim-ao-source-keys` |
| F-12 | partial | N (key unbound) |  | tenant value unbound: resources.firewall_name — `REQ-tenant-stacksim-ao-source-keys` |
| F-13 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-azure-fidelity` |
| F-14 | N | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-azure-fidelity` |
| G-01 | N | N (key unbound) |  | tenant value unbound: resources.training_roster_path — `REQ-tenant-stacksim-ao-source-keys` |
| G-02 | partial | N (key unbound) |  | tenant value unbound: resources.training_enforcement_group_id — `REQ-tenant-stacksim-ao-source-keys` |
| G-03 | partial | N (key unbound) |  | tenant value unbound: resources.cui_group_id — `REQ-tenant-stacksim-ao-source-keys` |
| G-04 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| G-05 | N | N (key unbound) |  | tenant value unbound: resources.training_roster_path — `REQ-tenant-stacksim-ao-source-keys` |
| G-06 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| G-07 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| G-08 | Y | N (no semantic effect/data) | CORRECTED | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |
| H-01 | N | Y | CORRECTED | live write changed the state its paired read observes; evidence row conforms; denies proven |
| H-02 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| H-03 | partial | N (no semantic effect/data) |  | write applied but the paired read shows no change on the sim (pre == post) — `REQ-tenant-stacksim-graph-fidelity` |
| H-04 | N | Y | CORRECTED | live write changed the state its paired read observes; evidence row conforms; denies proven |
| H-05 | N | N (no semantic effect/data) |  | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-m365-compliance` |
| H-06 | N | Y | CORRECTED | live write changed the state its paired read observes; evidence row conforms; denies proven |
| H-07 | partial | N (key unbound) |  | tenant value unbound: resources.backup_vault_name — `REQ-tenant-stacksim-ao-source-keys` |
| H-08 | Y | N (no semantic effect/data) | CORRECTED | read ran clean but the sim returned no data for it — `REQ-tenant-stacksim-graph-fidelity` |

## Corrected rows

A-03, A-08, A-11, A-14, A-20, B-03, B-05, B-10, B-13, C-03, D-06, D-11, F-05, F-06, F-08, F-11, G-08, H-01, H-04, H-06, H-08

- Rated Y, observed N: the table trusted the resolver's existence; the run shows the key was unbound, the write was not
  visible to the paired read, the seed existed only inside the coverage harness (A-20, D-11), or the op hit the wrong
  object. A-03 is the worst case: `Remove-MgUser -UserId <UPN>` deleted **user-1**, not the named user (SIMFIX FIX-S1).
- Rated partial/N, observed Y: the read already returns data or the write is already visible (the review under-rated them).
