# eval-fresh-gap — GP-DEMO-3 simsstack live-validation evidence (FULL GREEN)

**Date:** 2026-08-31 · **Branch:** gp-demo-3 · **Verdict: FULL GREEN — Muster-right AND Stamper-right-confirmed-by-after-truth.**

## Legend
- **P1** `AC.L2-3.1.11` session-timeout CA · **P5** `MA.L2-3.7.5` remote-maint CA (the two the plan is designed to flip)
- **N1** `AC.L2-3.1.12` named-location · **N2** `IA.L2-3.5.4` phishing-strength (authored "negative controls")
- **clause 3** before-truth discovery gate · **clause 5** Stamper known-false-fail partition · **clause 6** EO before/after no-regression · **clause 10** post-remediation Muster re-read vs after-truth
- **cycle 1 / cycle 2** the two live post-remediation reads (calibrate run + clean run) that make the after-truth `live-adjudicated`

## Muster leg (before-truth) — PASS
`demo:eval --config eval-fresh-gap` run twice (runIds eval-1788149615094, eval-1788149705387):
both PASS, schemaValid, read-only (ledger mutate delta 0), 0 mismatches, and the two reads were
byte-identical over 329 observations = STABLE. Muster reads the BEFORE posture right.

## Pin-transfer verdict — TRANSFERRED (no new pin)
Calibrate run `gpd3-freshgap-cal` taxonomy = 13 failures, all ⊆ the existing
`GUI_LEG_KNOWN_FALSE_FAILS` (verification class + capture-cascade class). Clause 5 PASS. No new
entry classified, no per-config keying needed.

## Contract correction (SPEC §4 re-examine, never quietly change)
The cycle-1 (`--calibrate`) post-remediation re-read diverged from the authored §2.2 after-truth on
N1 + N2: both read **met**, not `unknown`. Mechanism (airtight): the ONE plan's producer tasks
`AC.L2-3.1.12.named-location` + `IA.L2-3.5.4.auth-strength` COMPLETE and create a `namedLocations`
+ `authenticationStrengthPolicies` object (ledger `create`); DISCOVERY-1's N1/N2 probes GET the
same registry entry id the plan SET (paired get/set on one entry). ⇒ the plan flips FOUR probes
(P1, P5, N1, N2). After-truth corrected + re-stamped `live-adjudicated`; committed e867282; SPEC §5
amendment records it and flags the negative-control narrative change for the founder.

## Clean run `gpd3-freshgap-clean` (cycle 2, NO --calibrate) — exit 0, all clauses PASS
- clause 3 (before-truth): PASS — 329 observations, read-only.
- clause 5 (Stamper): PASS — 96/110 completed, 13 failures all in the calibrated known set.
- clause 6 (EO): PASS — before 38/110 met, after 56/110 met (no regression; +18).
- clause 10 (after-truth): PASS — every probe matched the live-adjudicated after-truth, read-only,
  `provenance: live-adjudicated`, mismatches []. Cycle 2 reproduced cycle 1 → two identical live
  reads back the map.
- All other clauses (1,2,4,7,8,9) PASS. `satisfied: true`, `calibrating: []`.

## Files
- `e2e-result.CLEAN.json` — the green clean-run verdict artifact (judged, not the exit code alone).
- `discovery-before-result.CLEAN.json` / `discovery-after-result.CLEAN.json` — clause 3 / clause 10 reads (clean run).
- `discovery-after-result.CALIBRATE-cycle1.json` — the cycle-1 post-remediation read that corrected the contract.
- `stamper-failure-taxonomy.CALIBRATE.json` — the pin-transfer evidence.

Full run trees (gitignored) live at `runs/e2e/gpd3-freshgap-cal/` and `runs/e2e/gpd3-freshgap-clean/`.
