# REQ: ces-muster: PLAN-3 plan content still Partial or Missing (MU-10 remaining ops)

**Filed by:** ces-muster (W4-MU2, 2026-09-27)
**Target:** ces-muster (self), per goal `docs/goals/G-MUSTER-PLAN-3.md`
**Priority:** P2
**Status:** HONEST-OPEN. These are milestone-sized deliverables outside Wave 4's scope, not defects.

After W4-MU1 the Plan tab's hand-off is complete: MP, TM and Infra Manifest are pushed, and the TCP is built.
These MU-10 operations are still not done:

| Operation | Level | What is missing | PLAN-3 milestone |
|---|---|---|---|
| SI Baseline | **Implemented (FC-MU, 2026-09-27)** | All 26 SIT questions are interview nodes (18 enum, 8 typed input: F9 closed). 7 of 26 derive for the m365_azure reference fixture; the rest are asked. Proven by `muster-api/tests/plan.siBaseline.complete.test.ts`. | M1 follow-up (done) |
| CUI Boundary + BTC inputs | Missing | No `cuiBoundaryAdapter.ts` / `btcAdapter.ts`. `compileGapSet` gets `null` for both. | M2 |
| Control Assessment + Traceability + validator | Missing | Not vendored. | M4 |
| 21 policy documents | Missing | Templates are vendored under `public/templates/policies/`. No renderer. | M5 |

## Acceptance
The gates for each milestone as written in `docs/goals/G-MUSTER-PLAN-3.md` (M2 a–d, M4 a–d, M5 a–d).

## Note found in W4
The M1 precedence rule is that a *derived* SIT answer beats an interview residue answer for the same question.
SIT-020 derives to `m365_azure` whenever M365 stacks are declared, so an operator who answers "m365_sentinel"
or "m365_only" in the interview is overridden. The UI prunes derived questions, so today this only shows up in
tests that answer every node. Revisit it when M2 lands: an explicit operator answer should probably win over a
medium-confidence derivation.

**Resolved 2026-09-27 (FC-MU, MU-10):** the founder default is that an explicit operator answer always beats a
derivation. It is implemented in the compile (`planCompileService.ts`) and in interview pruning
(`AssessmentPage.tsx`). An "I'm not sure" answer never overrides a derivation.
