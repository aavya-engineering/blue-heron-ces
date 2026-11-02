# M5 Coverage Plan — T1/PROTECT-first (GP-TESTER-1 M3)

**Date:** 2026-07-25. **Strategy alignment:** grow scenario coverage along the
**T1 PROTECT tier first** — the 36 controls with PVA ≥ 11 in
`ces-strategy/rfi/analysis/control-value-add.md` ("the 36 highest-value controls deserve
regression coverage first", GP-TESTER-1). Tracked against tenant-stacksim's 523-call
inventory (`tenant-stacksim/coverage/inventory.json`: 348 stamper / 36 eo / 139 ao items,
control IDs embedded in item ids, `classification: read|write`).

## The T1 PROTECT set (36 controls, source of truth: control-value-add.md)

3.1.1, 3.1.2, 3.1.5, 3.1.12, 3.1.13, 3.1.17, 3.1.18, 3.2.1, 3.3.1, 3.3.5, 3.4.1, 3.4.2,
3.4.5, 3.4.6, 3.4.7, 3.4.8, 3.5.1, 3.5.2, 3.5.3, 3.5.10, 3.6.1, 3.6.2, 3.7.5, 3.8.3,
3.8.7, 3.9.2, 3.11.2, 3.12.3, 3.13.1, 3.13.5, 3.13.6, 3.13.11, 3.14.1, 3.14.2, 3.14.4,
3.14.6

Per `ces-value-add-by-control.md`: 35/36 machine-observed, **21 machine-configurable
end-to-end** — those 21 are the scenario-assertable frontier (a scenario needs a
pipeline-written, sim-persisted state to assert on). 3.2.1 (awareness training) is
SYS-class (EO TrainingStore) — out of tester scope by design.

## Current T1 coverage (the 4 shipped scenarios)

| Scenario | T1 controls exercised (assert level) |
|---|---|
| clean-tenant-mfa-baseline | **3.5.3** (expected_state: auth-method configs; mid-pipeline directive) |
| exo-protection-baseline | **3.14.2** (ATP for SPO/Teams/ODB), 3.13.x TLS hardening; **3.6.1** mid-pipeline |
| teams-external-baseline | **3.13.1** (external federation boundary); 3.13.14 mid-pipeline |
| zz-deliberate-fail-atp | deliberate-fail harness proof (3.14.2 inverted; 3.6.1 mid-pipeline) |
| audit-logging-baseline | **3.3.1** (expected_state: Get-AdminAuditLogConfig -> UnifiedAuditLogIngestionEnabled; AU.L2-3.3.1 mid-pipeline) — added GP-TESTER-1 M3 batch |
| remote-maintenance-mfa-baseline | **3.7.5** (expected_state: CMMC-RemoteMaintenance-MFA CA policy state; MA.L2-3.7.5 mid-pipeline) — added GP-TESTER-1 M3 batch, **PENDING-LIVE-SMOKE** (created-CA-policy read parity, below) |

Distinct T1 controls with expected_state assertions today: **5** (3.5.3, 3.14.2, 3.13.1,
**+3.3.1, +3.7.5**). 3.3.1 uses the proven exchange-singleton arg-state mechanism
(same as exo's Get-TransportConfig / Get-AtpPolicyForO365 — high confidence). 3.7.5 is
grounded in the real inventory write cmdlet (`stamper:MA.L2-3.7.5.remote-mfa:set`) and a
confirmed persisted mutate objectType (`identityConditionalAccessPolicy`), but it is the
FIRST scenario to assert a pipeline-**created** (not seeded) CA policy through the GET
`/v1.0/identity/conditionalAccess/policies` read path — a live end-to-end smoke is needed
to confirm the create-write objectType surfaces in the read collection (`caPolicies`) with
`displayName`/`state` before a red there is read as a regression rather than a
write->read collection-parity gap (A8-class). Scenario is schema-valid + glob-discovered
now; only its live green is pending. Both new scenarios are unit-guarded (every shipped
scenario file schema-validates in `tests/scenarioFile.test.ts`).

## Mechanism: coverage report (M5 task 1)

Build `src/results/coverage-report.ts` + `ces-tester coverage` CLI:
1. Load `tenant-stacksim/coverage/inventory.json` (path via `--inventory`, default
   sibling; read-only).
2. For each retained run, parse `runs/<id>/*/ledger-snapshot.json`; match ledger `source`
   (cmdlet/URI) against inventory `commandText`; an inventory item is EXERCISED when any
   scenario's run produced a matching ledger entry (mutate → write item; read-serve →
   read item).
3. Emit `coverage/coverage-report.json` + a dashboard section: exercised/total by source
   (stamper/eo/ao), by classification, by control family, and the T1-tier cut;
   `manual_only`-class exclusions listed as known-untested (per PLAN.md M5 task 3).

## Next scenario batch (T1-first candidates, sim-assertable named-cmdlet/URI state)

1. ~~`audit-logging-baseline` — 3.3.1: unified audit log enable
   (Set-AdminAuditLogConfig-class exchange session state).~~ **SHIPPED (GP-TESTER-1 M3).**
2. ~~`remote-maintenance-mfa-baseline` — 3.7.5: CMMC-RemoteMaintenance-MFA CA policy
   (New-MgIdentityConditionalAccessPolicy).~~ **SHIPPED (GP-TESTER-1 M3), pending live
   read-parity smoke (see coverage table note).**
3. `entra-access-baseline` — 3.1.1/3.1.2/3.5.1/3.5.2: CA policy state + user/group
   access via Graph URIs (sim persists caPolicies; M1-era precedent exists) — inherits
   the same created-CA-policy read-parity open question as 3.7.5; sequence after that
   smoke confirms.
4. `device-hardening-baseline` — 3.1.18/3.4.2: Intune MDM enrollment restriction +
   config-profile state via Graph.
5. `remote-access-baseline` — 3.1.12/3.1.13: CA remote-session controls + legacy-auth
   block.
6. `least-priv-pim-baseline` — 3.1.5: PIM eligible-vs-active role state (watch: PIM
   tasks appear in the rotating known-red set — sequence AFTER
   REQ-STAMPER-ROTATING-VERIFY-FAIL resolves, or accept flaky-flagged).

Each: same wrapper schema, `lanes:["sim"]`, real question IDs, mid-pipeline directive
check for its headline control, expected_state via named-cmdlet/URI resolve with
`ledger_object_type` set (divergence evidence), added by file-drop (glob run-all —
no code changes).

## Baseline measurement (2026-07-26, `ces-tester coverage` — tool shipped with this plan)

First run of `src/results/coverage-report.ts` over all 28 retained runs (14,179 ledger
entries) vs inventory generatedAt 2026-07:

- **Items exercised: 234/523** — stamper 144/348, eo 24/36, ao 66/139.
- **T1 PROTECT exercised (execution-level): 25/36.** Unexercised 11: 3.1.13, 3.2.1
  (SYS-class, by design), 3.5.1, 3.5.10, 3.6.2, 3.8.3, 3.11.2, 3.12.3, 3.13.5, 3.13.6,
  3.14.1 — the priority list for inventory/scenario work.
- **T1 PROTECT asserted (a scenario verifies the outcome): 3/36** — the gap the
  scenario batch above closes. Exercised≠asserted: a full-plan execute touches many
  controls whose outcomes nothing yet checks.
- `manual_only` classifications in this inventory version: 0 (PLAN.md's "20 exclusions"
  predates this inventory revision; the report carries the bucket and will surface them
  if a later inventory adds the classification).

Report artifact: `coverage/coverage-report.json` (regenerate with `ces-tester coverage`).

## Sequencing & constraints

- **Blocker awareness:** the rotating Stamper verification-failure class
  (REQ-STAMPER-ROTATING-VERIFY-FAIL) makes any new named-cmdlet assertion
  luck-sensitive; the dashboard's flake table (M4) is the tracking instrument. Add
  scenarios freely; expect flaky flags until that REQ resolves, and treat a
  post-resolution all-green as the real M5 coverage stamp.
- **stacksim S-gate deliverables:** consume as they land (GP-TESTER-1 launch-gate note);
  re-check `tenant-stacksim/BACKLOG.md` at each session start.
- **manual_only exclusions:** carried as known-untested in the coverage report, never
  silently dropped.
