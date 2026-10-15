# Goal Document - GP-SPRS-PARITY-1: close the EO↔Muster SPRS weight-parity RED

**Status: EXECUTED 2026-07-25.** Named by founder ("run GP-SPRS-PARITY-1"); no prior
doc existed — authored at execution time from the filed discrepancy
(docs/design/readiness-report-contract.md §3, commit `380b45f`).

## Job

The G-EO-STAB-1 M2 parity check (2026-07-11) found 14 of 31 overlapping controls with
conflicting SPRS weights between Muster's inline `WEIGHT_TABLE` and
`ces-shared/data/sprs-weights` (EO's source), both claiming DoD AM provenance. It was
filed as a RED gate blocking any customer-facing SPRS number. This goal: determine the
current state, verify (or drive) resolution, and leave a mechanical guard so the RED
cannot silently return.

## What was found (investigation, all sibling access read-only)

The RED was already resolved in substance on 2026-07-12 — the day after filing — but
nothing recorded it and nothing guarded it:

- ces-shared `40b43ca`: canonical table regenerated from the methodology
  (v1.2.1 + 32 CFR 170.24) as `sprs-weights/2.0.0`; both prior tables had been wrong;
  machine-verified cross-check 44x5+14x3+51x1 = 313, floor -203, 110 requirements.
- Muster: inline table retired; both calculators (SPA + muster-api) import vendored
  copies of the canonical table, SHA-pinned in `vendor-manifest.json` with
  `npm run check:drift`.
- 2026-07-25 re-verification: all four copies (ces-shared src, ces-shared dist — the
  one EO's `require.resolve('ces-shared/data/sprs-weights')` actually loads — and both
  Muster vendored copies) byte-identical, SHA-256 `effcf570…ca3d86a`, matching both
  manifest pins. All 14 disputes carry single adjudicated weights.

## What was landed (in ces-eo)

1. `tests/unit/sprs-weights-parity.test.ts` (9 tests) — standing guard:
   methodology invariants on the table EO loads (catches stale ces-shared dist),
   partial-credit rules (3.5.3, 3.13.11), the 14 adjudicated weights pinned, and
   byte-identity of every reachable sibling copy + manifest pin (skip-if-absent).
2. `docs/design/readiness-report-contract.md` §3a — resolution record; header status
   flipped to RESOLVED.
3. This goal doc; session log turn; collective-ces-eo.md status updated.

## Acceptance gate (objectively checkable) — all met

1. Parity re-check run against current sources with evidence (hashes + per-control
   table) recorded in contract §3a. MET.
2. A guard test in EO's suite fails on any future weight drift or invariant break;
   suite green. MET (9/9 new, full suite green — see session log for numbers).
3. No writes outside ces-eo; Muster-side remainder FILED, not fixed. MET (see below).

## Filed against siblings (not fixed here — write boundary)

- **ces-muster:** G-MUSTER-READINESS-1 gate 6 ("M4 validation outcome recorded") still
  has no recorded outcome in the goal doc; record the sprs-weights/2.0.0 adoption
  (+ optional BHD human sign-off) as that outcome. Until then the customer-facing
  ship decision formally rests on that gate, not on any EO-side discrepancy.

## Must-NOTs honored

- One-SPRS rule unchanged: Muster's `computeSprs` remains the only customer-facing
  number; EO stays matrix/detail.
- No sibling writes; no force-push; commit pathspec-scoped.
