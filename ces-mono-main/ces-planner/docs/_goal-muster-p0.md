# /goal G-MUSTER-P0 — saved prompt

> Saved 2026-07-05. Derived from `ces-planner/docs/PLANNER_V2_PLAN.md` §6 Phase-0 row
> (plan produced by G-PLANNER-2, user-approved 2026-07-05). First of the three-goal Muster
> build sequence **P0 → P1 → P2, entry-gated** — G-MUSTER-P1 must not run before this
> goal's completion record exists. CODE goal — output = working software in the NEW
> sibling repo `C:/Users/mhsut/DevProjects/scre-muster` (this goal creates it).
> Brutal critic = separate agent (no self-certification); HIL user approval is the final
> gate. Re-run: paste the fenced block into a Claude session, cwd
> `C:/Users/mhsut/DevProjects/ces`.

```
/goal G-MUSTER-P0 COMPLETE WHEN the scre-muster repo exists as a working Phase-0
concierge MVP (mode (b) only): a BHD advisor can run a full concierge assessment —
engagement-kind intake → scope-lite → static-graph interview → conservative score →
StatusPayload JSON export → static roll-up import — in a browser with zero backend,
the vendored derivation spine provably matches ces-planner, a separate-agent brutal
critic records PASS, AND the user has explicitly approved completion (HIL gate,
DONE-WHEN #14 — no approval, no completion).

ENTRY CRITERIA (check mechanically BEFORE any work; if any check fails, STOP and
report the failure — do not waive):

E1. ces-planner/docs/PLANNER_V2_PLAN.md exists AND its "HIL approval" section records
    APPROVED with a date. Quote the approval line in the run log.
E2. C:/Users/mhsut/DevProjects/scre-muster either does not exist, or exists only from a
    prior partial run of this goal (reconcile in place — never scaffold a duplicate).

CONTEXT (scope = the PLANNER_V2_PLAN.md §6 Phase-0 row; the plan is read-only
rationale — the numbers below are authoritative here):

IN SCOPE: scre-muster/ repo scaffold (Vite + React + TS, lint + unit tests); Muster Web
SPA with Dexie session-only persistence; engagement-kind intake (required first setup
question, persisted as Engagement.engagement_kind: 'prime_and_subs' |
'individual_contractor', immutable after creation); scope-lite intake INCLUDING the
on-prem/OT question (per-sub answer persisted for share measurement); static
QuestionGraph interview; vendored
deriveActionStatuses() + M365 knowledge banks + assessment AJV schemas at a pinned CES
commit; StatusPayload JSON export; StaticRollup.tsx RAG board + pending-subs CSV;
Contract entity in types (the 14-field §3.2 shape) + roster CSV import. Mode (b) only,
budget ≤ 2 hrs BHD touch per sub per cycle [validate with BHD].

OUT OF SCOPE (hard — any appearing in the repo is a critic FAIL): backend or API of
any kind, auth, AI copilot / Claude API calls, OAuth/API harvest, capture snippets,
nudge engine, modes (a) and (c).

VENDORING DISCIPLINE (this goal CREATES it): copy deriveActionStatuses(), the M365
knowledge banks, and the StatusPayload/posture AJV schemas from ces-planner at ONE
pinned commit; record that SHA in DERIVATION_VERSION.md and KNOWLEDGE_VERSION.md; port
ces-planner's derivation unit tests to run against the vendored copy (the parity
checklist); add a CI drift check failing on any vendored-file divergence from the
pinned commit. No live imports from ces/ or ces-planner/ — ever.

GUARDRAILS: FCA-safe scoring — conservative score, unknown NEVER passes, self-assessed-
indicator disclaimer on every result screen. Pricing: outputs are Tier-1 SCRE
deliverables, never CRS memos, never quote-binding gap reports; LOE stays
assisted-not-automatic (no NOT_MET→hours calculator in this repo).

TOUCH-BUDGET INSTRUMENTATION: capture mode-(b) session timing (advisor start/stop per
segment) in the session export, so field actuals vs. the ≤ 2 hr/sub budget are
measurable — this feeds the Phase-0 go-gate evidence (≥ 5 real subs, ≥ 50 interview
facts, calibration high ≥ 85% / medium ≥ 65%, on-prem/OT share measured).

DONE-WHEN (all must hold):

1. Entry criteria E1–E2 verified and quoted in the run log before any file was written.
2. Repo scaffold: scre-muster is a git repo; `npm run build`, `npm run lint`, and
   `npm test` all green.
3. Engagement-kind intake: first setup screen persists engagement_kind; a unit test
   proves post-creation mutation is rejected (immutable); a component test proves
   individual_contractor renders NO roster UI and no roll-up navigation.
4. Scope-lite includes the on-prem/OT question; the answer is persisted per assessed
   party and appears in the StatusPayload export (share is computable downstream).
5. Static QuestionGraph interview completes end-to-end in the browser on Dexie
   session-only storage; a test or CI assertion proves ZERO network calls to any API
   origin; "I'm not sure" records unknown.
6. Vendored spine present with DERIVATION_VERSION.md + KNOWLEDGE_VERSION.md recording
   the single pinned CES commit SHA.
7. Parity checklist: ces-planner's derivation unit tests pass unmodified against the
   vendored copy (identical inputs → identical outputs); checklist file lists each
   check PASS.
8. CI drift check exists and fails on any vendored-file divergence from the pinned
   commit (demonstrated with an intentional diff, then reverted).
9. StatusPayload JSON export downloads and validates against the same AJV schema
   vendored into the repo (validation asserted in a test).
10. StaticRollup.tsx renders ≥ 2 imported StatusPayload files into a RAG board and
    exports the pending-subs CSV; Contract types match the 14-field shape (field-name
    test) and roster CSV import creates Sub records from a fixture file.
11. Mode-(b) timing instrumentation works: a recorded session shows captured segment
    times in the export, making actuals-vs-≤2hr measurable.
12. FCA guardrails: unit test proves an unknown fact can never yield a passing
    objective; conservative score and disclaimer text present on the result screen.
13. Brutal critic (separate agent) verdict PASS recorded; any FAIL fixed and re-run
    to PASS first.
14. HIL user-approval gate (LAST): after critic PASS, STOP and present — what shipped,
    gate-evidence status (the ≥5-subs / ≥50-facts / calibration / ≤2hr-actuals /
    on-prem-share evidence is FIELD data gathered after ship: report the collection
    plan and instrumentation readiness), and budget actuals so far. On explicit
    approval, write scre-muster/docs/GOAL_COMPLETION_G-MUSTER-P0.md recording the
    approval date plus a PHASE0_GATE_EVIDENCE section (fields for the five gate
    measurements, filled as concierge sessions run). No approval, no completion.

BRUTAL CRITIC PASS (mandatory; separate agent or session — the executor may NOT
self-certify): the critic attacks (1) SCOPE CREEP vs. the §6 OUT list — any backend,
auth, AI, harvest, snippet, nudge, or mode (a)/(c) code present is a numbered defect;
(2) PARITY/ACCURACY — the vendored spine produces byte-identical outputs and the parity
tests are ces-planner's real tests, not weakened rewrites; (3) GATE INTEGRITY — entry
criteria were actually checked, timing instrumentation is real (not stubs), and no gate
was waived or self-certified. FAIL blocks completion until every defect is fixed and
the critic re-runs to PASS.

OUTPUT & CONSTRAINTS:

- This goal file: ces-planner/docs/_goal-muster-p0.md (EXISTS — do not modify on run).
- Output: the C:/Users/mhsut/DevProjects/scre-muster repo (created/reconciled by this
  goal) + docs/GOAL_COMPLETION_G-MUSTER-P0.md on approval.
- HARD CONSTRAINT: ces-planner/ and ces-eo/ are READ-ONLY vendoring sources — this goal
  run must NEVER edit them; verify `git status` in ces/ is untouched at close.
- Label every BHD business assumption [validate with BHD] at point of use.
```
