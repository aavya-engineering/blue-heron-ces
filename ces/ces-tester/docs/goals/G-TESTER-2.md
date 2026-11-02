# Goal Document - G-TESTER-2: M3 scenario engine + driver hardening + real-tenant smoke lane

**Date:** 2026-07-11 - **Type:** /goal.
**Provenance:** founder directive 2026-07-11 working-system program
(ces-strategy/docs/context/VAULT.md, section B; lane analysis
ces-strategy/docs/context/masterplan/tester-stacksim.md; cross-cutting orderings O1/O2 in
ces-strategy/docs/context/masterplan/cross-cutting.md; master plan
ces-strategy/docs/MASTER-PLAN-2026-07-11.md).

ces-tester is the program's measuring instrument: objective gates (i) and (ii) are
verdicts THIS repo produces. M0/M1/M2 are COMPLETE and re-verified on ces-tenant 0.4.0;
next unblocked milestone is M3.

## Job

- **M3 - scenario schema + run-all + verifier (L; ~1.5-2 weeks honest residual - the M2
  pass pre-built answer-map.ts, mid-pipeline-assertion.ts, and results writers).**
  Contents per PLAN.md:277-303 plus two schema insurances that must go in BEFORE the
  schema freezes (cross-cutting O1 - reserving is S now, re-versioning later is M):
  1. Scenario JSON schema + loader/validator, INCLUDING (a) a reserved
     `muster.readiness_payload` block (fixture-file ref, consumed once readiness-result.v1
     exists) and (b) an explicit `lanes: ["sim","live"]` field so dual-tenant parity is
     declared, not implied.
  2. Generalized answer-map resolution keyed to REAL question IDs (BTC.ID.001-style, not
     sit.* abbreviations) and control_directives-shaped assertion paths (recorded M2
     lessons, IMPLEMENTATION_LOG.md:242).
  3. Glob run-all, serial, with --keep-on-failure.
  4. Structured verifier: expected_state via stacksim /resolve, expected_evidence via
     Stamper local evidence + stacksim /evidence (founder-accepted re-sourcing),
     diverged_commands from a real /ledger query.
- **Driver hardening carryovers (in-M3):** keep the direct /api/save-to-stamper
  page.request call (GeneratedArtifactsPanel UI bug workaround - file the planner bug);
  keep the dev-server readiness check (localhost-vs-127.0.0.1 binding is load-bearing).
  The driver TARGET stays the Planner wizard for gate (i) - retarget to MUSTER-PLAN mode
  when its UI ships is follow-on work, NOT in this goal's gate (master plan sec. 1
  clarification).
- **M-LIVE - real-tenant smoke lane (M-L total; behind FD-LIVE-SMOKE):**
  1. Live launcher branch in stamper-launcher: for kind:'live' tenants simply OMIT the sim
     env bundle (StacksimEnvironment refuses live slugs by design) (S).
  2. Reversible-write policy doc + RUNNER ENFORCEMENT (M): SMOKE- name prefix; scenario
     creates-then-deletes its own objects; NEVER PATCH pre-existing objects; hard
     allowlist of touched object types (Conditional Access report-only/disabled-state,
     Exchange transport rules, Key Vault per PLAN.md:353-356); Stamper incremental (not
     auto) mode for first runs. Gate (ii) must not run without this.
  3. Live verification adapter (M): answer the SAME assertions via real Graph/module reads
     REUSING Stamper's session surfaces via ces-tenant - no second Graph client
     (one-implementation rule). No /ledger on live: result.json keeps shape with
     ledger-dependent fields null.
  4. First slice: Stamper-only live smoke (seedless translate+execute+verify) - achievable
     without the Muster leg; a FULL live chain waits on muster-api production harvest
     tokens (ces-muster-side M, out of this goal).

## Must-NOTs

- Do NOT declare gate (i) green on a scenario that silently dodges the known Stamper
  variable-poisoning failure (the "IA.L2-3.5.3" red assertion): until G-STAMPER-STAB-1 M1
  lands, carry it as a NAMED known-red; a retargeted bridge scenario is acceptable only if
  labeled as such.
- No live run outside the reversible-write policy; no wipe concept on live; live
  expected_state assertions must be self-contained on objects the scenario itself creates
  (never ambient tenant state).
- fault_injection blocks are sim-only, ever.
- Kind-INVARIANT blocks (scenario_id, target_level, muster.answer_map,
  mid_pipeline_assertions, stamper.execution_mode, expected_state assertion LIST,
  result.json shape) must be bit-identical across sim and live lanes.
- No second Graph client for live verification (reuse ces-tenant session surfaces).
- M4 dashboard and M5 coverage report are OUT of this goal (NICE-TO-HAVE for the gate).

## Acceptance gate (objectively checkable)

1. Schema exists with `muster.readiness_payload` and `lanes` fields; validator rejects a
   malformed scenario in a test.
2. Run-all executes 4 scenarios including ONE deliberate FAIL; verdicts are correct
   (3 green + the deliberate FAIL red) - the PLAN.md M3 gate.
3. After G-STAMPER-STAB-1 M1: >=3 scenarios end-to-end GREEN against stacksim via run-all
   (objective gate i evidence), diverged_commands from a real /ledger query.
4. M-LIVE: reversible-write policy doc committed + runner refuses a live scenario that
   violates the allowlist (asserted in a test); Stamper-only live smoke run recorded green
   (objective gate ii first slice).
5. Suite green; runs/ artifacts retained for the loop's integration heartbeat.

## Preconditions

- M3: none (READY now). Item 3 of the gate: G-STAMPER-STAB-1 M1 landed.
- M-LIVE: FD-LIVE-SMOKE decided; real GCC High test tenant record present in ces-tenant
  live registry; G-STAMPER-STAB-1 M5 connect probes green.
- Housekeeping (optional, S): vitest ^3 bump; probeSimReady swap when ces-tenant ships it.

## Pointers

- ces-strategy/docs/context/masterplan/tester-stacksim.md (secs 2, 4, 6, 7 - sizing,
  known-red, live-lane needs, parity semantics)
- PLAN.md:277-303 (M3), 353-365 (M6 live design), 96-127 (schema today)
- docs/PHASE0_FINDINGS.md (question IDs, stdin protocol, evidence re-sourcing)
- docs/context/IMPLEMENTATION_LOG.md:150-157, 233-242 (M2 walking skeleton + lessons)
- ces-strategy/docs/MASTER-PLAN-2026-07-11.md (FD-LIVE-SMOKE; gate (i) Muster-leg
  clarification)
