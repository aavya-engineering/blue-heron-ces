# /goal G-MUSTER-P1 — saved prompt

> Saved 2026-07-05. Derived from `ces-planner/docs/PLANNER_V2_PLAN.md` §6 Phase-1 row
> (plan produced by G-PLANNER-2, user-approved 2026-07-05). Second of the Muster
> sequence **P0 → P1 → P2, entry-gated**. **Do not run before the G-MUSTER-P0
> completion record exists** (`scre-muster/docs/GOAL_COMPLETION_G-MUSTER-P0.md`) with
> the Phase-0 go-gate field evidence recorded. CODE goal — output = working software
> evolving the sibling repo `C:/Users/mhsut/DevProjects/scre-muster`.
> Brutal critic = separate agent; HIL user
> approval is the final gate. Re-run: paste the fenced block into a Claude session,
> cwd `C:/Users/mhsut/DevProjects/ces`.

```
/goal G-MUSTER-P1 COMPLETE WHEN scre-muster is a hosted multi-party platform —
muster-api backend, Claude-API adaptive interview + chat coach with offline fallback,
Graph harvest, nudge engine, full Contract CRUD, sub-management actions, first-class
Individual-Contractor flow, standalone SPRS — with modes (a) and (c) live and
instrumented against their budgets, a separate-agent brutal critic records PASS, AND
the user has explicitly approved completion (HIL gate, DONE-WHEN #14 — no approval,
no completion).

ENTRY CRITERIA (check mechanically BEFORE any work; if ANY fails, STOP and report
which evidence is missing — never waive the gate):

E1. scre-muster/docs/GOAL_COMPLETION_G-MUSTER-P0.md exists and records explicit HIL
    approval with a date.
E2. Its PHASE0_GATE_EVIDENCE section records all five measurements, each meeting
    its bar: (a) ≥ 5 real subs assessed; (b) ≥ 50 interview facts; (c) calibration
    high ≥ 85% and medium ≥ 65% correct; (d) mode-(b) actuals ≤ 2 hrs/sub per the P0
    timing instrumentation; (e) on-prem/OT share measured. Quote each value in the run
    log. Any miss → STOP: per the plan, tighten guardrails/tooling and re-measure; do
    not start the backend.

CONTEXT (scope = PLANNER_V2_PLAN.md §6 Phase-1 row; read the plan only for
rationale — numbers here are authoritative):

IN SCOPE: muster-api (Node + Express, Prisma + PostgreSQL, JWT + RBAC roles prime /
sub / bhd_operator / assessor-read-only, Postgres RLS keyed to party_id + tenant_id);
Claude-API adaptive interview + in-app chat coach with offline fallback (trigger:
three consecutive failed/timeout Claude calls OR a browser offline event → static
QuestionGraph degraded mode, answers queued in Dexie; resync posts queued answers,
retro-assigns confidence, routes low-confidence/high-weight facts to the HIL queue
BEFORE score release); GCC High Graph probes + OAuth consent (Approach A harvest,
provenance-badged tile pre-fill); nudge engine (T+3/7/14 reminders, stall detection,
escalation digests) + EngagementProgress; full Contract CRUD over the 14-field entity;
sub-management action surface (send-nudge-now, mark-abandoned, disposition
ready/validate/convert-to-enclave, schedule reassessment, opt-out) over
SubEngagementRecord/Disposition/NudgeEvent with the 8-state lifecycle taxonomy;
Individual-Contractor flow first-class (distinct navigation, no
Cohort/Wave/RollUp/RiskRegister/nudge, Contracts attach to the contractor party,
prime_ref = null); SPRS calc standalone. Modes (a) and (c) go LIVE —
mode (a) budget 0 BHD hours post-onboarding per cycle; mode (c) budget ≤ 30 min per
escalation instance [validate with BHD].

OUT OF SCOPE (hard — any appearing is a critic FAIL): Approach C (CaptureRecipe/
snippets), the full A→C→B router, continuous assurance / drift alerts, non-M365
vendor playbooks.

HIL ESCALATION THRESHOLD (exact): a ConfigFact with confidence === 'low' AND
weight >= 3 auto-routes to the BHD advisor queue; any sub-initiated "Flag for advisor
review" escalates regardless of weight [validate with BHD].

VENDORING DISCIPLINE (KEEP it green): the P0 CI drift check and parity checklist stay
green throughout; any re-pin bumps DERIVATION_VERSION.md / KNOWLEDGE_VERSION.md and
re-runs the full parity suite before merge.

GUARDRAILS: FCA-safe (conservative score, unknown never passes, disclaimer) holds
across AI-derived and harvested facts. Pricing: outputs remain Tier-1 SCRE
deliverables, never CRS memos, never quote-binding gap reports; LOE stays
assisted-not-automatic.

TOUCH-BUDGET INSTRUMENTATION: mode-(a): BHD touch events logged server-side per
engagement to evidence 0 hours post-onboarding; mode-(c): per-escalation advisor
timing captured in the HIL queue so ≤ 30 min actuals are measurable. Both feed the
Phase-1 go-gate (on-prem/OT share from ≥ 20 sub records; > ~30% "yes/unsure" promotes
Approach C).

DONE-WHEN (all must hold):

1. Entry criteria E1–E2 verified with all five gate values quoted before any code
   was written.
2. muster-api boots with migrations applied; `npm test` green repo-wide (web + api).
3. RLS proven: automated test shows a party's JWT cannot read another party's rows
   (cross-tenant query denied at the database layer).
4. RBAC per role: prime (roster read + nudge/dispose), sub (self only), bhd_operator
   (full write), assessor (read-only) — one authorization test each.
5. Adaptive interview runs on the Claude API with per-fact provenance + confidence
   badges; the chat-coach panel renders beside it.
6. Offline fallback test: simulated Claude outage (3 failures) drops to the static
   graph with Dexie queuing; reconnection resyncs, retro-assigns confidence, and
   routes qualifying facts to the HIL queue before score release.
7. HIL threshold exact: unit tests show confidence 'low' + weight 3 routes, 'low' +
   weight 2 does not, and a sub-initiated flag always routes.
8. Graph/OAuth harvest pre-fills tiles with machine facts marked auto-detected
   provenance (mock-tenant integration test acceptable).
9. Nudge engine fires T+3/7/14 and stall detection under simulated clock; escalation
   digest generates; EngagementProgress tracks the 8-state lifecycle.
10. Full Contract CRUD (API + UI) on the 14-field entity; engagement_kind immutability
    preserved; individual_contractor engagements render no roster/roll-up/nudge UI and
    attach Contracts directly to the contractor party (tests each).
11. SPRS standalone endpoint matches the vendored calculator on a fixture set; parity
    checklist + CI drift check still green.
12. Touch instrumentation live: mode-(a) touch-event log and mode-(c) per-escalation
    timer produce queryable actuals; FCA guardrails re-verified (unknown never passes
    via AI/harvest paths).
13. Brutal critic (separate agent) verdict PASS recorded; any FAIL fixed and re-run.
14. HIL user-approval gate (LAST): after critic PASS, STOP and present — what shipped,
    gate-evidence status (Phase-1 C-gate inputs: on-prem/OT share vs. the >~30%
    trigger, mode-(a) pilot hours, HIL queue volume, calibration vs. Phase-0 bars),
    and budget actuals. On explicit approval, write
    scre-muster/docs/GOAL_COMPLETION_G-MUSTER-P1.md with a PHASE1_GATE_EVIDENCE
    section recording ALL FOUR Phase-1 exit conditions with measured values: (a) the
    C-gate decision (on-prem/OT share from ≥ 20 sub records vs. the > ~30% trigger,
    or a written override); (b) mode-(a) pilot BHD hours post-onboarding (bar: 0);
    (c) HIL queue volume vs. advisor capacity; (d) calibration vs. the Phase-0 bars
    (high ≥ 85% / medium ≥ 65% — no regression). G-MUSTER-P2 entry verifies each of
    the four. No approval, no completion.

BRUTAL CRITIC PASS (mandatory; separate agent or session — no self-certification):
attacks (1) SCOPE CREEP vs. the §6 OUT list — any CaptureRecipe, router, continuous-
assurance, or non-M365 playbook code is a numbered defect; (2) PARITY/ACCURACY — the
vendored spine still produces identical outputs after the backend refactors and SPRS
standalone matches it; (3) GATE INTEGRITY — entry evidence was quoted, not asserted;
the HIL threshold matches the exact condition; no gate waived or self-certified.
FAIL blocks completion until fixed and re-run to PASS.

OUTPUT & CONSTRAINTS:

- This goal file: ces-planner/docs/_goal-muster-p1.md (EXISTS — do not modify on run).
- Output: evolved C:/Users/mhsut/DevProjects/scre-muster +
  docs/GOAL_COMPLETION_G-MUSTER-P1.md on approval.
- HARD CONSTRAINT: ces-planner/ and ces-eo/ are READ-ONLY vendoring sources — this
  goal run must NEVER edit them; verify `git status` in ces/ is untouched at close.
- Label every BHD business assumption [validate with BHD] at point of use.
```
