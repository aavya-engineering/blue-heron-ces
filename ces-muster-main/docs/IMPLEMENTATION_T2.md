# Implementation Log — T2: A→C→B Per-Objective Fact Router

**Date:** 2026-07-07
**Plan Reference:** G-MUSTER-P2 Slice T2 — DONE-WHEN #4 and #5

---

## Files Created

| File | Purpose |
|------|---------|
| `src/features/scoring/factRouter.ts` | Pure fact-router module: classOf, mergeExplanation, routeFacts |
| `src/features/scoring/__tests__/factRouter.test.ts` | 28 unit + integration tests (DONE-WHEN #4+#5) |
| `docs/WIRING_T2.md` | One-paragraph integration note + exact call-site change (deferred to T3/T5) |

---

## Changes Made

- `[src/features/scoring/factRouter.ts:new]` — Created pure router module. Exports:
  - `ProvenanceClass` type alias (`'A'|'C'|'B'`)
  - `classOf(provenance)` — maps provenance string to tier class
  - `MergeExplanation` interface — `{ question_id, winner, suppressed[] }`
  - `mergeExplanation(group)` — audit helper returning winner + suppressed for one objective group
  - `routeFacts(facts)` — groups by `question_id`, picks one winner per group via A>C>B precedence + FCA within-class conservatism (`'no' > 'unknown'|'unsure' > 'yes'`, then most-recent-wins for ties)
  — FCA guardrails: lower class can never override higher class; within-class 'no' beats 'yes'
  — `[validate with BHD: machine-harvested current state (A) outranks captured point-in-time evidence (C), so A 'yes' beats C 'no']`

- `[src/features/scoring/__tests__/factRouter.test.ts:new]` — 28 tests in 6 describe blocks:
  - `classOf` (5 tests) — A/C/B mapping, unknown falls to B
  - `routeFacts — precedence` (5 tests, DONE-WHEN #4) — A>C>B, C>B absence fallthrough, only-C, only-B, only-unknowns-never-passes
  - `routeFacts — conservative merge` (5 tests, DONE-WHEN #5) — B/C cross-class, B/A cross-class, A-yes-beats-C-no (BHD note), within-class 'no' over 'yes', recency tiebreak
  - `mergeExplanation` (2 tests) — winner reference identity, empty suppressed for single-fact group
  - `routeFacts — multi-objective` (2 tests) — independent per-objective resolution, empty input
  - `routeFacts → scoreFacts integration` (1 test, DONE-WHEN #4 last bullet) — mixed-provenance routing feeds REAL scoreFacts; merged score ≤ naive all-B score; routing collapse verified by unique-id assertion

- `[docs/WIRING_T2.md:new]` — Exact call-site one-liner for `exportPipeline.ts` lines ~23-26; deferred to T3/T5.

---

## Deviations from Plan

None. All DONE-WHEN #4 and #5 bullets are exercised verbatim. No changes were made to `src/features/export/` — the wiring is documented in `docs/WIRING_T2.md` and deferred as specified.

---

## Verification Results

| Step | Result |
|------|--------|
| `npm test` | PASS — 197/197 (169 baseline + 28 new) |
| `npx eslint src/features/scoring --ext ts --max-warnings 0` | PASS — 0 warnings, 0 errors |
| `npm run build` | PASS — tsc + vite build, 196 modules |

---

## Open Items

- T3/T5: wire `routeFacts` into `src/features/export/exportPipeline.ts` per `docs/WIRING_T2.md` — one additive insertion, no signature changes.
- BHD validation: rationale tag `[validate with BHD: machine-harvested current state outranks captured point-in-time evidence]` embedded in both `factRouter.ts` and test file comment for the A-yes-beats-C-no case.
