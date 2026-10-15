# /goal G-MUSTER-P2 — saved prompt

> Saved 2026-07-05. Derived from `ces-planner/docs/PLANNER_V2_PLAN.md` §6 Phase-2 row
> (plan produced by G-PLANNER-2, user-approved 2026-07-05). Third of the three-goal
> Muster build sequence **P0 → P1 → P2, entry-gated**. **Do not run before the
> G-MUSTER-P1 completion record exists** (`scre-muster/docs/GOAL_COMPLETION_G-MUSTER-P1.md`)
> with the Phase-1 C-gate decision recorded. This is a **CODE goal**: output = working
> software evolving the existing sibling repo `C:/Users/mhsut/DevProjects/scre-muster`.
> Brutal critic = separate agent; HIL user approval is the final gate. Re-run: paste the
> fenced block into a Claude session with cwd `C:/Users/mhsut/DevProjects/ces`.

```
/goal G-MUSTER-P2 COMPLETE WHEN scre-muster ships Approach C and the full assessment
composition — CaptureRecipe library + ingestion, the A→C→B per-objective router,
evidence package export, and continuous re-assessment with drift alerts (the Tier-3
annuity engine) — within the mode-(c) touch budget, a separate-agent brutal critic
records PASS, AND the user has explicitly approved completion (HIL gate, DONE-WHEN #13
— no approval, no completion).

ENTRY CRITERIA (check mechanically BEFORE any work; if ANY check fails, STOP and
report exactly which evidence is missing — this goal never waives its gate):

E1. scre-muster/docs/GOAL_COMPLETION_G-MUSTER-P1.md exists and records explicit HIL
    approval of G-MUSTER-P1 with a date.
E2. Its PHASE1_GATE_EVIDENCE section records the C-gate decision, satisfied one of two
    ways: (a) cohort-1 on-prem/OT share measured from ≥ 20 sub records with > ~30%
    "yes/unsure" — Approach C promoted; OR (b) a strategic override decision recorded
    IN WRITING (who decided, when, why). Quote the decision line in the run log. If
    neither exists, STOP — the gate cannot be inferred or self-declared.
E3. The same PHASE1_GATE_EVIDENCE section records the other three Phase-1 exit
    conditions, each meeting its bar: (a) mode-(a) pilot completed with 0 BHD hours
    post-onboarding; (b) HIL queue volume within advisor capacity; (c) calibration at
    or above the Phase-0 bars (high ≥ 85% / medium ≥ 65% — no regression). Quote each
    value in the run log. Any miss → STOP and report; never waive.

CONTEXT (scope is the PLANNER_V2_PLAN.md §6 Phase-2 row, verbatim — read the plan
read-only for rationale; the numbers below are authoritative here):

IN SCOPE: CaptureRecipe library — signed, read-only evidence-capture scripts — plus
the ingestion pipeline that turns recipe output into ConfigFacts with captured/
artifact-truth provenance; the A → C → B per-objective router (Approach A harvested
machine facts win over Approach C captured evidence, which wins over Approach B
interview answers; absence at one source falls through to the next); evidence package
export; continuous re-assessment + drift alerts — the Tier-3 annuity engine driving
the reassessment_due lifecycle state. Per the §6 gate row: snippet acceptance is
validated CONCIERGE-ASSISTED before any self-serve rollout (feature-flagged).

OUT OF SCOPE (hard — any of these appearing is a critic FAIL): additional intent packs
and additional vendor playbooks beyond M365 (Phase-3 content work).

VENDORING DISCIPLINE (KEEP it green): the CI drift check and parity checklist from P0
stay green throughout; any re-pin bumps DERIVATION_VERSION.md / KNOWLEDGE_VERSION.md
and re-runs the full parity suite before merge. ces-planner and ces-eo remain
read-only sources — never edited.

GUARDRAILS: FCA-safe scoring holds through router-merged results — the merged score
stays conservative, unknown never passes regardless of source, and the self-assessed-
indicator disclaimer remains on result screens and inside exported evidence packages.
Pricing: outputs remain Tier-1 SCRE deliverables, never CRS memos, never quote-binding
gap reports; evidence packages support the Tier-3 annuity, they do not become quoting
instruments; LOE stays assisted-not-automatic.

TOUCH-BUDGET INSTRUMENTATION: annuity-cycle touch must stay within the mode-(c)
budget — ≤ 30 minutes BHD touch per escalation instance [validate with BHD]. Extend
the P1 per-escalation timer to re-assessment cycles so each continuous-assurance cycle
produces queryable touch actuals; drift alerts that route to an advisor count against
this budget.

DONE-WHEN (all must hold):

1. Entry criteria E1–E3 verified — the C-gate decision and all three other Phase-1
   exit values quoted in the run log before any code was written.
2. CaptureRecipe library exists with ≥ 3 recipes; every recipe carries a verified
   signature (test: a tampered recipe is rejected) and is statically asserted
   read-only (test/lint: no write, delete, or configuration-change operations).
3. Ingestion pipeline converts recipe output into ConfigFacts with captured provenance
   and confidence, validated against the vendored AJV schemas (fixture test).
4. Router proven per objective by unit tests: an A fact outranks a C fact outranks a
   B answer for the same objective; absence at a source falls through to the next;
   an objective with only unknowns never passes.
5. Router-merged scores remain conservative: a test shows a low-confidence B answer
   cannot upgrade an objective a C capture marked failing.
6. Evidence package export produces a self-contained package (manifest + artifacts +
   provenance per fact) that validates against a committed manifest schema; the FCA
   disclaimer is embedded in the package.
7. Continuous re-assessment scheduler flips subs to reassessment_due on cadence, and a
   drift alert fires when a re-captured/re-harvested fact contradicts the recorded one
   (simulated-clock test).
8. Snippet acceptance gate honored: self-serve recipe execution sits behind a feature
   flag that stays OFF until concierge-assisted validation results are recorded in the
   repo (docs entry naming the sessions and outcomes).
9. Annuity-cycle touch instrumentation live: each re-assessment cycle and each
   drift-alert escalation produces a timed advisor-touch record queryable against the
   ≤ 30 min/escalation budget.
10. Parity checklist + CI drift check still green repo-wide; `npm test` green
    (web + api + recipes).
11. Modes (a)/(b)/(c) regression: the P1 test suites still pass — Phase-2 additions
    broke no Phase-0/1 behavior.
12. Brutal critic (separate agent) verdict PASS recorded; any FAIL fixed and re-run
    to PASS first.
13. HIL user-approval gate (LAST): after critic PASS, STOP and present — what shipped,
    gate-evidence status (C-gate decision honored, snippet concierge-validation
    results, drift-alert behavior), and budget actuals (annuity-cycle touch vs. ≤ 30
    min/escalation). On explicit approval, write
    scre-muster/docs/GOAL_COMPLETION_G-MUSTER-P2.md recording the approval date. No
    approval, no completion.

BRUTAL CRITIC PASS (mandatory; separate agent or session — no self-certification):
attacks (1) SCOPE CREEP vs. the §6 OUT list — any new intent pack or non-M365 vendor
playbook content is a numbered defect, as is any recipe that is not provably read-only;
(2) PARITY/ACCURACY — the vendored spine still produces identical outputs beneath the
router, and router merges never inflate a score above what the most conservative
source supports; (3) GATE INTEGRITY — the C-gate entry evidence was real and quoted
(promotion data or written override, never inferred), the snippet self-serve flag
stayed off until concierge validation was recorded, and no gate was waived or
self-certified. FAIL blocks completion until fixed and re-run to PASS.

OUTPUT & CONSTRAINTS:

- This goal file: ces-planner/docs/_goal-muster-p2.md (EXISTS — do not modify on run).
- Output: evolved C:/Users/mhsut/DevProjects/scre-muster +
  docs/GOAL_COMPLETION_G-MUSTER-P2.md on approval.
- HARD CONSTRAINT: ces-planner/ and ces-eo/ are READ-ONLY vendoring sources — this
  goal run must NEVER edit them; verify `git status` in ces/ is untouched at close.
- Label every BHD business assumption [validate with BHD] at point of use.
```
