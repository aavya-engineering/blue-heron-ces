# Gate Override Record — G-MUSTER-P1 entry

**Date:** 2026-07-07
**Who decided:** the project owner (project owner / HIL authority), in-session directive:
"Push past the gate rows. Built out phase 1 then do phase 2."
**What is overridden:** G-MUSTER-P1 entry criterion E2, rows 3 and 4 of
PHASE0_GATE_EVIDENCE (confidence calibration and mode-(b) real timing), which remain
**pending real field sessions**. Rows 1/2/5 are structurally satisfied with synthetic
data (recorded 2026-07-06, user-authorized).

**Why:** owner decision to build the Phase-1 platform ahead of field validation so the
hosted capability exists when field sessions run; calibration and timing bars remain
OPEN OBLIGATIONS to be measured with real subs and recorded in PHASE1_GATE_EVIDENCE
before any P1→P2 *field* claims are made. This mirrors the written-override mechanism
the P2 gate (E2 option b) explicitly provides.

**Not waived:** FCA guardrails, vendoring discipline (drift + parity), RBAC/RLS proof
obligations, brutal-critic pass, and the HIL approval gates for the completion records
themselves. Calibration bars (high ≥ 85% / medium ≥ 65%) still apply to future field
data — no synthetic value may be presented as a field measurement.

---

## Addendum — G-MUSTER-P2 entry (same directive, recorded per CRITIQUE_P2 D1)

**What is overridden:** G-MUSTER-P2 entry criterion **E1** (a P1 completion record with
explicit HIL approval must exist before P2 work starts) and the measurement half of
**E2/E3** (C-gate share from ≥ 20 real subs; mode-(a) pilot hours; HIL queue volume;
field calibration).

**Basis:** the SAME owner directive of 2026-07-07 — "Push past the gate rows. Built out
phase 1 then do phase 2." — is a single written instruction ordering both phases in one
run, which necessarily precedes any P1 HIL approval. E2 is additionally satisfied via
its own option (b): a strategic override decision recorded in writing (who: the project owner; when: 2026-07-07; why: build the platform ahead of field validation).

**Not waived:** the P1 and P2 completion records BOTH remain DRAFT until explicit HIL
approval; the self-serve recipe flag stays OFF until concierge validation sessions are
recorded; all field measurements remain open obligations.
