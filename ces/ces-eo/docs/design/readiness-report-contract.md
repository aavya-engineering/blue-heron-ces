# READINESS-REPORT DATA CONTRACT (G-EO-STAB-1 M2)

**Date:** 2026-07-11. **Status:** PUBLISHED; parity check RUN - BLOCKING DISCREPANCIES
FOUND AND FILED (see section 3). **UPDATE 2026-07-25: RESOLVED - see section 3a
(GP-SPRS-PARITY-1 verification + standing guard).**
**Provenance:** ces-strategy/docs/MASTER-PLAN-2026-07-11.md (goal roster, one-SPRS rule);
ces-eo/docs/goals/G-EO-STAB-1.md M2; muster consumer spec
ces-muster/docs/goals/G-MUSTER-READINESS-1.md M3.

## 1. The contract

The Muster customer readiness report (SPRS now / gaps / SPRS after) consumes:

- **The SPRS number - NEVER from EO.** `sprs_now` and `sprs_after` both come from
  Muster's `computeSprs` (ces-muster/src/features/scoring/sprsCalc.ts), per the
  program-wide one-SPRS rule. EO's three SPRS-adjacent implementations
  (`SprsCalculator`, `DirectiveSprsCalculator`, `SprsValidator`) are never the
  customer number.
- **Matrix / per-objective detail - from EO, consume-when-available:**
  - `GET /api/ledger` - the unified per-objective determination ledger (digital
    evidence + non-digital PS/AT readiness + mission-plan dispositions), served by
    `src/eo/server/routers/assessment-router.ts`.
  - `GET /api/assessment` - the latest assessment snapshot (same router).
  - The readiness report does NOT block on these: SPRS + gaps suffice
    (G-MUSTER-READINESS-1 must-NOT: "NO rebuilding EO's results matrix"; matrix panel
    is consume-when-available).
- **Transport:** Muster's SPA is zero-network; EO data reaches the report via
  muster-api or an exported artifact, never a direct SPA fetch.

## 2. Parity-check method (one-time, at contract time - run 2026-07-11)

Compared Muster's `WEIGHT_TABLE` (sprsCalc.ts, 31 requirements from the question
graph) against `ces-shared/src/data/sprs-weights.json` (110 controls, the table EO's
`SprsCalculator` loads via `ces-shared/data/sprs-weights`). Join key: NIST ref
(`3.x.y`). Scoring-rule shape agrees (start 110, floor -203, full deduction for
not-met; Muster additionally treats partial/unknown as full deduction - conservative
FCA rule; EO applies partial credit for the 2 partial_credit entries).

## 3. RESULT: FAILED - 14 of 31 overlapping controls disagree on weight

| Requirement | Muster sprsCalc.ts | ces-shared sprs-weights.json (EO) |
|---|---|---|
| AC.L2-3.1.6 | 3 | 1 |
| AC.L2-3.1.12 | 3 | 5 |
| AC.L2-3.1.14 | 3 | 5 |
| IA.L2-3.5.5 | 3 | 1 |
| PS.L2-3.9.2 | 3 | 1 |
| CM.L2-3.4.1 | 3 | 5 |
| CM.L2-3.4.2 | 3 | 5 |
| CM.L2-3.4.7 | 3 | 5 |
| RA.L2-3.11.1 | 3 | 5 |
| AU.L2-3.3.1 | 3 | 5 |
| AU.L2-3.3.2 | 3 | 5 |
| IR.L2-3.6.2 | 5 | 3 |
| IR.L2-3.6.3 | 3 | 1 |
| MP.L2-3.8.9 | 1 | 3 |

Both tables claim DoD Assessment Methodology provenance (Muster: "v2.13 tables";
ces-shared: v1.2.1 per SprsCalculator's doc comment). At least one is wrong per
control. **Nobody adjudicates this from memory: it goes to the BHD weight
validation** that Muster's sprsCalc.ts:9 already mandates before any customer-facing
use ("[validate with BHD: verify weights against current methodology]").

**Filed to:** G-MUSTER-READINESS-1 M4 (its gate wording anticipates exactly this:
"validation outcome recorded - pass, or blocking discrepancies filed"). This table is
the filing.

**Consequences until resolved:**
1. No customer-facing SPRS number ships (M4 was already the gate; it is now a RED
   gate with named discrepancies, not a formality).
2. The one-SPRS rule stands unchanged - the discrepancy does not move the number's
   OWNERSHIP (Muster's calculator), it questions the number's INPUTS (the weight
   table).
3. Likely resolution shape (BHD decides): a single weight source - Muster adopting
   `ces-shared/data/sprs-weights` (or a corrected successor) so the family has ONE
   table, with sprsCalc keeping its conservative partial/unknown rule. The two
   different DoD-methodology version claims (v2.13 vs v1.2.1) should be reconciled to
   the current official table in the same pass.

## 3a. RESOLUTION (verified 2026-07-25, GP-SPRS-PARITY-1)

The RED was resolved the day after filing, in two coordinated moves neither side of
the original dispute "won":

1. **ces-shared `40b43ca` (2026-07-12):** `sprs-weights.json` REGENERATED from the
   governing methodology (DoD AM v1.2.1 + 32 CFR 170.24; reference
   ces-strategy/docs/SPRS-SCORING-METHODOLOGY.md) as schema `sprs-weights/2.0.0`.
   Both prior tables were wrong against the methodology; the "v2.13" provenance claim
   is retired. Machine-verified official cross-check: 44x5 + 14x3 + 51x1 = 313
   deductible, floor -203, 110 requirements (3.12.4/SSP unscored prerequisite).
2. **Muster (2026-07-12):** the inline `WEIGHT_TABLE` in sprsCalc.ts is RETIRED; both
   Muster calculators (SPA `src/features/scoring/sprsCalc.ts` and
   `muster-api/src/services/sprsCalc.ts`) import a vendored copy of the canonical
   table, pinned by SHA-256 in `ces-muster/vendor-manifest.json` and enforced by
   `npm run check:drift`.

**2026-07-25 re-verification (EO side):** all four reachable copies byte-identical —
ces-shared src, ces-shared dist (what EO's `require.resolve` actually loads), and both
Muster vendored copies — SHA-256 `effcf570…ca3d86a`, equal to both vendor-manifest
pins. Each of the 14 §3 disputes now carries a single adjudicated weight (several
resolved to neither disputed value, confirming regeneration rather than table-picking):
3.1.6=1, 3.1.12=5, 3.1.14=1, 3.5.5=1, 3.9.2=5, 3.4.1=5, 3.4.2=5, 3.4.7=5, 3.11.1=3,
3.3.1=5, 3.3.2=3, 3.6.2=5, 3.6.3=1, 3.8.9=1.

**Standing guard (EO):** `tests/unit/sprs-weights-parity.test.ts` fails the EO suite
if the methodology invariants break on the table EO loads (catches a stale ces-shared
dist/), if an adjudicated weight changes, or if any sibling copy / manifest pin drifts
from EO's resolved table (sibling checks skip when the checkout is absent).

**Remaining formality (Muster's court, filed not fixed per the write boundary):**
G-MUSTER-READINESS-1's gate 6 ("M4 validation outcome recorded") has no recorded
outcome in its goal doc yet, although the sprsCalc.ts:9 validation mandate it referred
to is gone. Muster should record the 2.0.0 adoption as that outcome.

Consequence lifted: the section-3 "no customer-facing SPRS number ships" block is no
longer sourced from THIS discrepancy. Whether BHD wants a human sign-off on top of the
machine-verified cross-check before shipping remains a founder/Muster-M4 call.

## 4. What EO must keep stable while the contract stands

- `GET /api/ledger` and `GET /api/assessment` response shapes on assessment-router
  (additive changes fine; breaking changes are an EO-STAB follow-on with a Muster
  heads-up).
- The 2 partial_credit entries stay EO-internal (Muster's conservative rule ignores
  partial credit by design).
