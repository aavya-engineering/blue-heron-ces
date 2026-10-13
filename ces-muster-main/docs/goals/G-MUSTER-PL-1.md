# Goal Document — G-MUSTER-PL-1: The Punchlist (zero loose ends inside ces-muster)

**Date:** 2026-07-10 · **Type:** `/goal`, not `/loop`. The scope is REVIEW.md's 11
in-scope items (C1–C4, H1–H3, K1–K4) — a bounded, enumerable, already-audited set with a
defined stopping point, not open-ended iteration. That defined stopping point is exactly
what makes a `/goal` fit; a `/loop` would have no terminal state.

**Placement note:** `ces-muster/docs/goals/G-MUSTER-PL-1.md`, in the `docs/goals/`
directory G-MUSTER-GO-1 established (sibling precedent: `tenant-stacksim/docs/goals/
G-STACKSIM-1.md`). **ID:** `G-MUSTER-PL-1` — "PL" reads as *punchlist*, a distinct series
that collides with neither the numeric phase series (P0–P2) nor the GO series (GO-1
closed, GO-2 written and unexecuted; this goal does not touch GO-2's scope — see
Non-goals, X3).

**Item source (binding):** `docs/context/REVIEW.md` (2026-07-10 punchlist audit) is the
sole inventory. This goal selects and sequences from that list; it does not re-audit, and
it does not pull any X-item into scope.

---

## MANDATORY ENGINEERING NOTE — top-level constraint, applies to every milestone below

**"DO NOT REPLICATE CODE AS AN EASY OUT — DO THE RIGHT THING FROM A SOFTWARE ENGINEERING
POV."** (founder, verbatim, carried from G-MUSTER-GO-1/GO-2.) For this goal, concretely:

- **C1 wires the EXISTING vendored cascade** (`src/vendored/ces-spine/` — read-only,
  drift-guarded) into the runtime scoring path. No reimplementation of
  `deriveActionStatuses`, no copied cascade logic in `scoringService.ts` — consume the
  vendored function through its interface.
- **C4 consolidates to ONE capture surface** — QuickSession folds into AssessmentPage, or
  a decision to keep two is *recorded* (see Open decisions). What is forbidden is silently
  forking a third capture surface while "consolidating."
- **H1 ends with ONE enforcing validator agreeing with ONE schema** — whichever way the
  ajv-vs-structural call goes (see Open decisions), the terminal state is a single
  enforcer provably consistent with `muster-api/schemas/config-fact.schema.json`, never a
  second schema or a second live validator.

---

## Objective

Close every loose end completable inside ces-muster. When this goal's DONE-WHEN holds,
the 11 in-scope items of `docs/context/REVIEW.md` (CODE C1–C4, HARDENING H1–H3,
HOUSEKEEPING K1–K4) are done, and every remaining open item in the repo's orbit is one of
exactly three things — GO-2's own scope, a sibling-repo dependency, or a founder/BHD-gated
decision or field obligation — each named as such in the Non-goals ledger below, so that
nothing is silently dropped and nothing in-repo remains unowned.

## Why now

GO-1 is closed (critic PASS, completion doc written); GO-2 is written, critic-PASSED, and
queued for execution. The debt inventory is fresh: REVIEW.md (2026-07-10) counts exactly
**11 in-scope items and 13 excluded-with-reason** — an audited, stable list, not a guess.
The oldest item, C1, has now survived **four goals** as the feature inventory's only
PARTIAL — a P0 critic-ruled "tolerated deviation" (`docs/GOAL_COMPLETION_G-MUSTER-P0.md`)
that keeps getting tolerated. A punchlist goal is how it stops being tolerated. (GO-1's
coverage figures — 41.6%/87.3% — are deliberately not imported here; they are GO-1/GO-2's
metric, not this goal's. This goal's numbers are REVIEW.md's own counts: 11 and 13.)

## Milestones — objectively checkable, grouped by REVIEW.md's own buckets

Milestones follow REVIEW.md's audited bucket seams — CODE, HARDENING, HOUSEKEEPING — not
effort or file overlap; regrouping would re-litigate an audit this goal is forbidden from
reopening. **Gate rule (binding):** each milestone's gate is a labeled list of one
**per-item sub-gate** per member item, each independently pass/fail; the milestone gate is
"all sub-gates pass." No compound or merged gates — a single item's failure (especially
C4's open-decision item) must never mask another item's status, C1's above all.

**M1 — CODE (C1, C2, C3, C4).** C1 first: it is the oldest and most load-bearing item.

- *Sub-gate C1 (cascade wired live):* `src/features/scoring/scoringService.ts` invokes
  the vendored `deriveActionStatuses` cascade on real sessions (including the YAML
  pattern loading it needs); `cascadeParity.test.ts` still green; an integration test
  proves cascade output reaches the score a user sees. *Note:* BHD checklist row 2
  (cascade `not_met` outranks interview `met`) flags the BEHAVIOR for BHD review — the
  wire-up itself is engineering, completable in-repo (see Open decisions, item 3).
- *Sub-gate C2 (partyId threading):* a contract created mid-new-session carries the real
  `party_id` (today `App.tsx` line ~134 inits null, line ~160 populates on resume only);
  a unit test covers the new-session (non-resume) create path.
- *Sub-gate C3 (profile answers persisted):* the three AssessmentPage profile answers
  (`employee_count` / `has_ssp` / `covers_m365`, state lines 76–79) survive reload
  (resume restores them) and appear in the exported StatusPayload; export schema updated
  and AJV-validated.
- *Sub-gate C4 (one capture surface):* one capture surface (QuickSession folded into
  AssessmentPage) **or** a recorded decision to keep two; all e2e/unit suites green;
  `quick-session-nav` behavior preserved or intentionally retired with test updates.

*Gate M1:* all four sub-gates pass, each reported individually.

**M2 — HARDENING (H1, H2, H3).**

- *Sub-gate H1 (schema/validator agreement):* the schema file
  (`muster-api/schemas/config-fact.schema.json`) and the enforcing validator provably
  agree — either a test validates fixtures against BOTH, or ajv is the enforcer; the P2
  deviation note (D3, BHD checklist row 16 tag) is closed either way (see Open
  decisions, item 1).
- *Sub-gate H2 (live-Postgres tests routine):* a documented one-liner (npm script or
  README section) runs the muster-api suite with `DATABASE_URL` so the 3 env-gated live
  RLS tests execute; verification boards report the live tier explicitly instead of
  perpetual skips.
- *Sub-gate H3 (real-clock ticks):* a scheduler fires nudge/reassessment ticks on real
  wall-clock time for a configured tenant (operator-tenant-scoped through the existing
  `withTenant` pipeline), tested with fake timers; the simulated `--now` path unchanged.
  *Boundary held:* the cross-tenant GLOBAL tick stays excluded (X11, BHD checklist row
  21); cadence values stay `[validate with BHD]`.

*Gate M2:* all three sub-gates pass, each reported individually.

**M3 — HOUSEKEEPING (K1, K2, K3, K4).**

- *Sub-gate K1 (plan archival + convention):* **this sub-gate departs from REVIEW.md's
  literal "Done looks like" column, and says so here rather than silently substituting.**
  REVIEW.md specifies a physical archived copy (`PLAN.md` renamed to
  `docs/context/PLAN-G-MUSTER-GO-2-goalwriting.md`). This goal substitutes
  `git show ac659f2:PLAN.md` as the archive-of-record, because the commit hold lifted
  this session (a fresh fact post-dating REVIEW.md): the completed GO-2 writing plan is
  already immutable in git history at `ac659f2`, making a physical copy a duplicate.
  Sub-gate: (a) `git show ac659f2:PLAN.md` retrievably returns the GO-2 goal-writing
  plan, and (b) `docs/context/VAULT.md` carries a one-line archival convention stating
  pipeline artifacts are archived-by-git post-2026-07-10 — the convention half of
  REVIEW.md's column, unchanged. This is a cited departure subject to the critic's
  gate-softening attack surface (DONE-WHEN 3d), not a drop.
- *Sub-gate K2 (BHD-marker reconciliation):* every in-code `[validate with BHD]` marker
  (~45 across `src/` + `muster-api/src/` per the audit grep) maps to a row in
  `docs/BHD_VALIDATION_CHECKLIST.md`, with new rows added where missing; the checklist
  header notes the reconciliation date.
- *Sub-gate K3 (coverage artifact):* `npm run test:coverage` re-run once from the new
  path so `coverage/coverage-final.json` carries no stale `DevProjects\scre-muster`
  absolute paths (or the artifact deleted/gitignored if untracked).
- *Sub-gate K4 (post-move machine cleanup) — MANUAL VERIFICATION, explicitly:* K4 is
  filesystem-only, outside the repo tree — no repo test can gate it, and this sub-gate
  does not pretend otherwise. It is an honest non-repo attestation: (a) a dated entry in
  `session-ces-muster-*.md` recording the deletion of the stale
  `C:\Users\mhsut\DevProjects\scre-muster` folder, paired with (b) a captured directory
  listing showing the old path absent, and (c) dev tooling (`npm run dev`, editors)
  verified serving from `DevProjects\ces\ces-muster`. This is labeled manual
  verification, not a disguised automated gate.

*Gate M3:* all four sub-gates pass, each reported individually (K4 by attestation, as
labeled).

## DONE-WHEN (all must hold)

1. **Full board green** — web + api + e2e + drift + build + lint (GO-1 precedent
   wording): `npm test` (SPA), the muster-api suite (now including the live RLS tier per
   H2, reported explicitly), `npm run test:e2e`, `npm run check:drift` exit 0,
   `npm run build` exit 0, `npm run lint` exit 0.
2. **Standing guardrails re-asserted, not assumed:** zero-network SPA
   (`src/features/interview/__tests__/noNetworkCalls.test.ts` green over every touched
   surface); FCA — unknown never prunes, never passes, never inflates a score; vendored
   spine untouched (`src/vendored/**` unedited, drift check exit 0).
3. **Brutal critic PASS** (separate agent, no self-certification), attacking
   specifically: **(a) silent drop** — any of the 11 items (C1–C4, H1–H3, K1–K4) missing
   or quietly descoped vs REVIEW.md; **(b) second implementation** — any duplicate
   validator, capture surface, or cascade path, an automatic numbered defect per the
   engineering note; **(c) X-item scope creep** — any excluded item pulled in
   (X3/X4–X6/X7/X10–X11/X13 especially); **(d) gate-softening** — diff every shipped
   sub-gate's wording against REVIEW.md's literal "Done looks like" column and flag any
   weakened, vaguer, or narrower phrasing; K1's git-citation departure and K4's non-repo
   attestation must each carry the explicit in-gate justification written above — a
   justified departure passes, a silent substitution fails.
4. **HIL user approval LAST** — on approval, write
   `docs/GOAL_COMPLETION_G-MUSTER-PL-1.md`. The completion doc must additionally
   **verify at completion-doc time** that the X1-resolution commits `1444299`,
   `3030785`, and `ac659f2` exist on origin (`git branch -r --contains <hash>` or
   equivalent — run then, not assumed from session narrative) before stating X1
   resolved. No approval, no completion.

## Non-goals — the X1–X13 ledger (excluded by reference, nothing dropped)

Per `docs/context/REVIEW.md`'s excluded-with-reason table; IDs cross-reference that table
and are not restated in full here.

- **X1 — RESOLVED (not a live exclusion).** REVIEW.md logged the commit hold as
  founder-only; the founder lifted it this session and the pending set is
  committed/pushed: `1444299` (rename edits), `3030785` (GO-1 implementation), `ac659f2`
  (GO-2 docs/goals + audit docs). Stated here as resolved rather than carrying forward
  REVIEW.md's now-stale framing; the completion doc re-verifies the hashes on origin
  (DONE-WHEN 4). The parent-repo `ces/.gitignore` half remains outside ces-muster.
- **X3 — GO-2's own scope:** infer+confirm, archetype mechanism, script-upload/import-
  file, draft rendering + attestation, never-passes guardrail, interview-parsing fixture
  (`docs/goals/G-MUSTER-GO-2.md` M1–M6). Cross-referenced only; not double-booked here.
- **X4–X6 — sibling engines:** live discovery execution, live rung-2/rung-4
  extraction/AI engines, rung-5 value-of-information ranker — blocked on
  ces-stamper/ces-eo/ces-planner shipping callable interfaces first.
- **X2, X7, X10, X11, X13 — founder/BHD decisions:** duplicate-repo deletion (X2),
  auth-ladder tiers + archetype content (X7), cert-assertion token minting (X10),
  cross-tenant GLOBAL tick service-account design (X11), and the ~45 `[validate with
  BHD]` business assumptions themselves (X13 — K2 covers only the in-repo bookkeeping
  half, keeping the checklist complete).
- **X8, X9, X12 — field obligations:** `RECIPES_SELF_SERVE` enablement (concierge
  validation sessions recorded first), GCC High endpoint/real-tenant validation, and the
  open field-evidence obligations (confidence calibration, mode-(b) timing, C-gate
  shares, pilot evidence, HIL volume) — all require real engagements or real tenants;
  instrumentation is already shipped.

Also out of scope: re-auditing for items beyond REVIEW.md's 11; reopening GO-1's or
GO-2's goal documents; deciding the Open-decision calls below on this document's own
authority.

## Open decisions — genuinely two-way calls, recorded as calls (not pre-decided)

1. **H1 — adopt ajv, or close the structural-validator deviation.** Adding ajv to
   muster-api reverses P2's recorded self-contained-package tradeoff (must be flagged in
   the PR if chosen); keeping the hand-rolled validator requires a test proving it agrees
   with the schema, and recording it as the permanent design. *Recommendation:* keep the
   structural validator and add the both-ways fixture test (fixtures validated against
   schema AND validator), preserving the recorded tradeoff — but either terminal state
   satisfies sub-gate H1. Final call at execution; the BHD tag (checklist row 16) closes
   with the deviation note either way.
2. **C4 — fold QuickSession into AssessmentPage, or formally keep two surfaces.**
   *Recommendation:* fold — QuickSession already imports `SERVICE_OPTIONS` from
   AssessmentPage and a parallel capture surface is standing drift risk, which is the
   engineering note's point. Keep-two is acceptable only as a recorded decision with
   rationale and green tests; sub-gate C4 accepts either, never a silent third surface.
3. **C1 behavior — cascade precedence (BHD checklist row 2).** Whether cascade `not_met`
   outranks interview `met` is a business call and stays on the BHD checklist; it is not
   decided here. *Recommendation:* the wire-up proceeds now as engineering, shipping the
   vendored cascade's behavior as-is under the existing row-2 flag — C1 must not wait a
   fifth goal on a business answer the flag already tracks.

## Dependencies

None on sibling repos, by construction — REVIEW.md's scope rule already excluded
everything sibling-blocked (X4–X6), and every C/H/K item is completable with what is in
ces-muster today. Commit-hold governance, previously a standing constraint, is **moot**:
X1 resolved this session (hashes above); work lands in git normally. Founder/BHD inputs
named in Open decisions gate only the *choices* recorded there, not milestone start.

## Grounding — files cited

- `docs/context/REVIEW.md` — sole item source: the 11 in-scope items, 13 exclusions,
  resolved-since-logged ledger, and every per-item "Done looks like" column the
  sub-gates above restate.
- `docs/FEATURE_STATE-2026-07-10.md` — PARTIAL row (C1), SHIPPED caveats (H1, H3), RLS
  env-gate row (H2).
- `docs/GOAL_COMPLETION_G-MUSTER-P0.md` (C1's "tolerated deviation" ruling),
  `docs/GOAL_COMPLETION_G-MUSTER-P1.md` (DONE-WHEN #3, H2), `docs/GOAL_COMPLETION_G-MUSTER-P2.md`
  (deviation D3, H1; X8/X12 sources), `docs/GOAL_COMPLETION_G-MUSTER-GO-1.md`
  (record-survival caveat, K1).
- `docs/BHD_VALIDATION_CHECKLIST.md` — rows 2 (C1 behavior), 8/9/21 (H3/X11), 16 (H1),
  20 (X10); K2's reconciliation target.
- `docs/goals/G-MUSTER-GO-1.md`, `docs/goals/G-MUSTER-GO-2.md` — format precedent; X3's
  scope boundary.
- `session-scre-muster-2026-07-07.md` (Turn 1 next-candidates: C3, C4; Turn 4: X10;
  Turn 6: H2; Turn 8: X2), `session-ces-muster-2026-07-10.md` (Turn 1 open threads: K3,
  K4; final state: X1 history).
- Per-item code paths (verbatim from REVIEW.md Source column / MODULE_MAP key surfaces):
  `src/features/scoring/scoringService.ts` + `src/vendored/ces-spine/` +
  `cascadeParity.test.ts` (C1); `src/features/app/App.tsx` ~134/160 +
  `src/features/contracts/ContractsPage.tsx` (C2);
  `src/features/assessment/AssessmentPage.tsx` 76–79 +
  `src/features/export/statusPayloadService.ts` + export schema (C3);
  `src/features/quick/QuickSession.tsx` (C4); `muster-api/schemas/config-fact.schema.json`
  + `muster-api/src/services/recipeIngestService.ts` (H1); `muster-api/tests/rls.test.ts`
  + package scripts/README (H2); `muster-api/src/services/{nudgeService,reassessmentService}.ts`
  + server bootstrap + `withTenant` in `muster-api/src/lib/prisma.ts` (H3); `PLAN.md` +
  `docs/context/VAULT.md` (K1); `coverage/` (K3); filesystem-only old
  `DevProjects\scre-muster` folder (K4).
