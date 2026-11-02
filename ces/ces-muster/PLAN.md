# Plan: Write the punchlist goal document (closes REVIEW.md's 11 in-scope items)

**Date:** 2026-07-10 (rev 2 — gap-analysis findings addressed)
**Status:** READY FOR IMPLEMENTATION (deliverable is the goal DOCUMENT, not code)

## Objective
Write a new `/goal` document, `docs/goals/G-MUSTER-PL-1.md`, that sequences REVIEW.md's
11 in-scope loose ends (C1-C4, H1-H3, K1-K4) into checkable milestones, following the
GO-1/GO-2 heading precedent, so ces-muster closes every remaining item completable
inside its own repo.

## Context Summary
- **From Review (docs/context/REVIEW.md):** sole item source — 11 in-scope (CODE
  C1-C4, HARDENING H1-H3, HOUSEKEEPING K1-K4), 13 excluded X1-X13 with reasons, plus a
  "resolved since logged" ledger. C1 is the four-goal-old PARTIAL. H1/C4/C1 each carry
  a genuinely open either/or call.
- **From Module Map (docs/context/MODULE_MAP.md):** binding 10-section heading
  skeleton (mirrors GO-1's H1-H10) and per-item code surfaces; milestone grouping is
  this task's job — natural seams are CODE/HARDENING/HOUSEKEEPING.
- **Prior PLAN.md content** (the completed GO-2 goal-writing plan) is preserved in
  git at `ac659f2`, not lost by this overwrite — precisely K1's point.
- **Fresh fact (not yet in any artifact):** the founder lifted the commit hold; the
  tree is fully committed/pushed (`1444299` rename, `3030785` GO-1 impl, `ac659f2`
  docs/goals). **X1 is resolved** — state so explicitly, don't repeat stale hold
  language. **K1's overwrite-risk half is now covered by git history** — cite git
  instead of a copy, but justify the departure explicitly (finding 3, below); K1's
  archive-convention half (a VAULT.md note) still stands.
- **Constraints:** must not re-audit (REVIEW.md is sole item source); must not pull
  any X-item into scope; must not collide with GO-2 (written, unexecuted, owns X3's
  rungs); must follow the MODULE_MAP.md skeleton; keep the goal doc lean relative to
  GO-1/GO-2 (~200-320 lines each).

## Implementation Steps
1. **`docs/goals/G-MUSTER-PL-1.md` (CREATE)** — write the goal document using the
   MODULE_MAP.md 10-section skeleton:
   - H1 title + Date + Type `/goal` with justification: REVIEW.md's 11 items are a
     bounded, enumerable, already-audited set (not open-ended iteration) — a defined
     stopping point is exactly what makes `/goal` fit over `/loop`. Placement:
     `docs/goals/`, GO-1/GO-2 precedent. ID: `G-MUSTER-PL-1` (does not collide with
     GO-1/GO-2; "PL" = punchlist series, distinct from the numeric P0-P2 series and
     the GO series).
   - H2 MANDATORY ENGINEERING NOTE — founder line verbatim; concretize per
     MODULE_MAP.md line 23-25: C1 wires the EXISTING vendored cascade (no
     reimplementation, `src/vendored/ces-spine/` stays read-only); C4 consolidates to
     ONE capture surface (or records a decision to keep two, not silently forks a
     third); H1 ends with ONE enforcing validator agreeing with ONE schema.
   - H2 Objective — one paragraph per MODULE_MAP.md line 26-28: zero loose ends
     completable inside ces-muster; every remaining open item is GO-2's, a sibling's,
     or founder/BHD-gated, and the goal doc says so via the Non-goals ledger.
   - H2 Why now — GO-1 closed, GO-2 written/queued; cite REVIEW.md's own counts
     (11 in-scope / 13 excluded) as the freshness signal; name C1 surviving four goals
     as a "tolerated deviation" (cite `docs/GOAL_COMPLETION_G-MUSTER-P0.md`). Do NOT
     import GO-1's 41.6%/87.3% coverage numbers — not this goal's metric.
   - H2 Milestones — group the 11 items into milestones along REVIEW.md's own bucket
     seams: **M1 CODE** (C1-C4), **M2 HARDENING** (H1-H3), **M3 HOUSEKEEPING**
     (K1-K4). Keep C1 prominently first inside M1 (oldest, most load-bearing item).
     **Gate decomposability (binding, resolves finding 1):** each milestone's
     *Gate:* is a labeled list of one **per-item sub-gate per member item** (e.g.
     M1 has *Sub-gate C1/C2/C3/C4:*, each restating that item's REVIEW.md "Done
     looks like" column as its own independently pass/fail test/command/artifact);
     milestone gate = "all sub-gates pass." A single item's failure (esp. C4's
     open-decision item) must never mask C1's status. Do not soften/merge sub-gates
     into vague prose.
     **K1 sub-gate (resolves finding 3):** REVIEW.md's literal column specifies a
     physical archived copy (`PLAN.md` renamed to
     `docs/context/PLAN-G-MUSTER-GO-2-goalwriting.md`). The sub-gate text must
     state and justify the git-citation substitution in-line — e.g. "departs from
     REVIEW.md's literal physical-copy instruction; substitutes
     `git show ac659f2:PLAN.md` as archive-of-record because the commit hold
     lifted this session (fresh fact, post-dates REVIEW.md), plus a one-line
     VAULT.md convention note (step 2)" — a cited departure, not a silent drop,
     under the critic's gate-softening attack surface (DONE-WHEN 3d).
     **K4 sub-gate (resolves finding 4):** K4 (delete stale
     `DevProjects\scre-muster` folder, restart dev tooling) is filesystem-only,
     outside the repo tree — no repo test is possible. Sub-gate = honest non-repo
     attestation: a dated `session-ces-muster-*.md` entry recording the deletion,
     paired with a captured directory listing showing the old path absent and dev
     tooling serving from the new path — explicitly labeled manual verification,
     not a disguised automated gate.
   - H2 DONE-WHEN — numbered, must include: (1) full board green — web + api + e2e +
     drift + build + lint, GO-1 wording precedent; (2) standing guardrails
     re-asserted — zero-network SPA (`noNetworkCalls.test.ts`), FCA unknown-never-
     prunes/never-passes, vendored spine untouched (drift check exit 0); (3) brutal
     critic PASS, separate agent, no self-certification, attacking: (a) any of the
     11 items silently dropped vs REVIEW.md, (b) any second implementation
     (duplicate validator/capture surface/cascade path), (c) any X-item scope creep
     (X3/X4-X6/X7/X10-X11/X13 pulled in), **(d) gate-softening (resolves finding
     2): diff every shipped sub-gate's wording against REVIEW.md's literal "Done
     looks like" column and flag weakened/vaguer/narrower phrasing — K1's
     git-citation departure and K4's non-repo attestation must each carry the
     explicit in-gate justification specified above, not a silent substitution**;
     (4) HIL user approval LAST — on approval, write
     `docs/GOAL_COMPLETION_G-MUSTER-PL-1.md`, which must additionally **verify the
     X1-resolution commit hashes (`1444299`, `3030785`, `ac659f2`) exist on origin**
     (`git branch -r --contains <hash>` or equivalent, run at completion-doc time,
     not assumed from session narrative) before stating X1 resolved; no approval,
     no completion.
   - H2 Non-goals — the X1-X13 ledger by reference (per MODULE_MAP.md line 44-46):
     GO-2's milestones (X3), sibling engines (X4-X6), founder/BHD decisions (X2, X7,
     X10-X11, X13), field obligations (X8-X9, X12). **State X1 explicitly as
     RESOLVED** (commits `1444299`/`3030785`/`ac659f2`, this session) rather than
     listing it as a live exclusion — do not carry forward REVIEW.md's now-stale
     framing of X1 as founder-only-blocked.
   - H2 Open decisions — the three genuinely two-way calls, stated as calls (not
     pre-decided): H1 ajv-vs-close-the-deviation; C4 fold-vs-keep QuickSession; C1's
     BHD-flagged cascade behavior row (BHD checklist row 2 — wire-up proceeds as
     engineering, the `not_met`-outranks-`met` precedence stays a BHD business call).
   - H2 Dependencies — none on siblings by construction (the scope rule excluded
     everything sibling-blocked already); note commit-hold governance is now moot
     (X1 resolved) rather than restating it as a live dependency.
   - H2 Grounding — files cited: `docs/context/REVIEW.md` (item source),
     `docs/FEATURE_STATE-2026-07-10.md`, the four
     `docs/GOAL_COMPLETION_G-MUSTER-{P0,P1,P2,GO-1}.md`,
     `docs/BHD_VALIDATION_CHECKLIST.md`, `docs/goals/G-MUSTER-GO-{1,2}.md`, both
     session logs, plus per-item code paths verbatim from REVIEW.md's Source column
     and MODULE_MAP.md's "Key code surfaces" section.
2. **`docs/context/VAULT.md` (MODIFY, minimal)** — add one line under Guardrails or
   Artifact discipline recording the archival convention: pipeline artifacts
   (PLAN.md, docs/context/*.md) are archived-by-git — post-2026-07-10 (commit hold
   lifted), the prior content of any overwritten pipeline artifact is recoverable
   from git history (e.g. `git show ac659f2:PLAN.md`), so no separate copy step is
   required going forward. State this same framing inside the goal doc's K1 gate
   wording too, so the two files agree.

## File Inventory
| File | Action | Lines/Functions Affected |
|------|--------|--------------------------|
| docs/goals/G-MUSTER-PL-1.md | CREATE | new file, ~150-200 lines, 10-section skeleton |
| docs/context/VAULT.md | MODIFY | add 1-2 line archival-convention note (Guardrails or Artifact discipline section) |

## Architecture Decisions
- **Goal ID `G-MUSTER-PL-1`:** avoids collision with the numeric P-series and the
  GO-series; "PL" reads unambiguously as "punchlist."
- **Milestone grouping by REVIEW.md bucket, not effort/file overlap:** the buckets
  are already audited and stable; regrouping would re-litigate REVIEW.md's own
  structure, which this task is forbidden from re-auditing.
- **Sub-gates, not compound gates:** decomposing each milestone gate per-item
  (finding 1) trades a few extra lines for a critic-checkable, non-maskable signal
  per item — direct tradeoff accepted given C1's history of being tolerated/hidden.
- **K1 cites git, does not duplicate the archive copy, but must say so in-gate:**
  the fresh fact makes a physical copy redundant; the explicit justification
  requirement (finding 3) is what keeps this from reading as a silent drop.

## Testing Strategy
Not applicable — documentation-writing task, no code paths. Downstream "test" is the
goal's own brutal-critic pass (now four attack surfaces, including gate-softening).
For this writing task: manual cross-check that every C1-C4/H1-H3/K1-K4 item appears
in exactly one milestone with its own labeled sub-gate, every X1-X13 appears in
Non-goals (X1 marked resolved), and K1/K4 sub-gates carry explicit justification text.

## Out of Scope
- Re-auditing the codebase for additional loose ends beyond REVIEW.md's 11 — forbidden
  per REVIEW.md's own framing and MODULE_MAP.md's item-source section.
- Executing any of the 11 items (wiring C1, threading C2's partyId, etc.) — this task
  only writes the goal document.
- Pulling any X1-X13 item into milestone scope, including X3 (GO-2's rungs).
- Deciding H1/C4/C1's open either/or calls on the goal-writer's own authority — they
  are recorded as open decisions, not resolved, in the goal doc.
- Rewriting or reopening GO-1 or GO-2's own goal documents.

## Acceptance Criteria
- [ ] `docs/goals/G-MUSTER-PL-1.md` exists, follows the MODULE_MAP.md 10-section
      skeleton, and does not collide with `G-MUSTER-GO-1`/`G-MUSTER-GO-2` IDs or scope.
- [ ] All 11 items (C1-C4, H1-H3, K1-K4) appear in exactly one milestone; C1 is
      prominent (named first) within M1, reflecting its four-goal-old PARTIAL status.
- [ ] Each milestone's *Gate:* is decomposed into one labeled per-item sub-gate per
      member item, milestone gate defined as "all sub-gates pass" — no compound check.
- [ ] K1's sub-gate states and justifies its departure from REVIEW.md's literal
      physical-copy column (git-citation substitution, fresh-fact rationale); K4's
      sub-gate is an honest non-repo attestation (session-log entry + directory
      listing), explicitly labeled manual verification.
- [ ] X1 is explicitly stated resolved (commit hashes cited); X2-X13 referenced in
      Non-goals by ID with blocking-reason category, X3 flagged as GO-2's own scope.
- [ ] Open decisions section names exactly three calls: H1 (ajv vs close deviation),
      C4 (fold vs keep QuickSession), C1 (BHD cascade-behavior row).
- [ ] DONE-WHEN includes full-board-green, guardrail re-assertion, brutal-critic PASS
      with **four** named attack surfaces (silent drop, second implementation,
      X-scope-creep, gate-softening), and HIL-approval-last gating
      `docs/GOAL_COMPLETION_G-MUSTER-PL-1.md` — completion doc must verify the
      X1 commit hashes (`1444299`, `3030785`, `ac659f2`) exist on origin first.
- [ ] `docs/context/VAULT.md` carries a one-line archival-convention note consistent
      with the goal doc's K1 gate wording. No item silently dropped or X-item pulled in.
