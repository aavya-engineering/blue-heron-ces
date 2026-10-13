# eval-decoy-maze — GP-DEMO-3 simsstack live-validation evidence (FULL GREEN)

**Date:** 2026-09-02 · **Branch:** gp-demo-3 · **Verdict: FULL GREEN — Muster-right AND Stamper-right-confirmed-by-after-truth.**

## Legend
- **P1** `AC.L2-3.1.11` · **P5** `MA.L2-3.7.5` (plan flips) · **P2** `AC.L2-3.1.14`/`SC.L2-3.13.7` · **P3** `AC.L2-3.1.15` (decoy-named, pinned honest-open) · **P9** `AC.L1-3.1.20` (held by seed) · **N1** `AC.L2-3.1.12` · **N2** `IA.L2-3.5.4`
- **clause 3/5/6/10** = before-truth gate / Stamper known-fail partition / EO no-regression / post-remediation re-read
- **cycle 1 / cycle 2** = calibrate-run + clean-run post-remediation reads

## Muster leg (before-truth) — PASS, STABLE
`demo:eval --config eval-decoy-maze` ×2 (runIds eval-1788211652633, eval-1788211740950): both PASS,
read-only, 0 mismatches; the two reads byte-identical over 329 observations. Muster gives ZERO
credit for the five decoy-named CA policies (anti-halo) — reads what is required, not what is there.

## Pin-transfer verdict — TRANSFERRED (no new pin)
Calibrate run `gpd3-decoymaze-cal`: 13 failures, all ⊆ `GUI_LEG_KNOWN_FALSE_FAILS`. Clause 5 PASS.

## Contract correction (from THIS config's own evidence)
The cycle-1 re-read diverged from the authored §2.1 after-truth ONLY on N1 + N2 (unknown→met) — the
same four-probe-flip mechanism fresh-gap established (plan producer tasks create the namedLocation +
auth-strength objects; SPEC §5). Corrected + re-stamped `live-adjudicated` (commit on gp-demo-3).
Crucially, the clause-10 mismatch set was EXACTLY {N1, N2}: decoy-maze's distinct teaching points
were CONFIRMED live — P2/P3 stayed `unknown` (remediation ≠ completeness — three of five decoyed
controls remain open after the plan) and P9 stayed `met`.

## Clean run `gpd3-decoymaze-clean` (cycle 2, NO --calibrate) — exit 0, all clauses PASS
- clause 3 (before-truth): PASS — 329 observations, read-only.
- clause 5 (Stamper): PASS — 96/110 completed, 13 failures all in the calibrated known set.
- clause 6 (EO): PASS — before 38/110 met, after 56/110 met (+18, no regression).
- clause 10 (after-truth): PASS — every probe matched the live-adjudicated after-truth, read-only,
  `provenance: live-adjudicated`, mismatches []. Cycle 2 reproduced cycle 1.
- `satisfied: true`, `calibrating: []`, no non-pass/n-a clause.

## Files
- `e2e-result.CLEAN.json` — green clean-run verdict artifact.
- `discovery-before-result.CLEAN.json` / `discovery-after-result.CLEAN.json` — clause 3 / clause 10 reads.
- `discovery-after-result.CALIBRATE-cycle1.json` — cycle-1 read that corrected the contract.
- `stamper-failure-taxonomy.CALIBRATE.json` — pin-transfer evidence.

Full run trees (gitignored): `runs/e2e/gpd3-decoymaze-cal/`, `runs/e2e/gpd3-decoymaze-clean/`.
