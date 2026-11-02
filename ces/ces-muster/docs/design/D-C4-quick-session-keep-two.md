# Decision D-C4 — Keep QuickSession and AssessmentPage as two capture surfaces

**Status:** ACTIVE (recorded 2026-07-27) · **Goal:** G-MUSTER-PL-1, sub-gate C4
**Decider:** execution-time engineering call (the goal document delegates C4 to
"final call at execution"; keep-two is an explicitly acceptable terminal state
per `docs/goals/G-MUSTER-PL-1.md` Open decisions item 2 and `docs/context/REVIEW.md`
C4 "Done looks like").

## The call

QuickSession (`src/features/quick/QuickSession.tsx`) is **kept** as a distinct
capture surface alongside AssessmentPage (`src/features/assessment/AssessmentPage.tsx`).
It is NOT folded in, and NO third capture surface is introduced.

## Why this is the right engineering call (not "replicating code as an easy out")

The MANDATORY ENGINEERING NOTE forbids duplicating code as an easy out. The test
of whether keep-two violates it is: **is the drift-prone core forked, or do the
two surfaces share one core and differ only in thin capture UI?** Here it is the
latter — every expensive, correctness-bearing dependency is already single-sourced:

- **Service inventory:** QuickSession imports `SERVICE_OPTIONS` from AssessmentPage
  (`QuickSession.tsx` line 16) — one source of truth for the stack tiles.
- **Question graph:** both call `loadQuestionGraph(...)` from
  `@/features/interview/questionGraphService` — no forked graph.
- **Engagement/party creation:** both call `createEngagement(...)` from
  `@/features/intake/engagementService` and write the same `AssessedParty` /
  `InterviewSession` Dexie shapes (`@/shared/db/schema`).
- **Scoring + export:** both funnel through the **single** export pipeline
  `executeExportAndDownload(...)` → `scoreFacts(...)` → the vendored
  `deriveActionStatuses` cascade → `buildStatusPayload(...)`. There is exactly one
  scoring path and one StatusPayload builder (C1's single production entry-point).

What is QuickSession-local is only its own form state and a ~10-line inline
fact-construction (yes/no/unknown → confidence). That is thin presentation glue,
not a replicated engine. Folding would either **lose** the deliberately different
concierge/single-pass UX ("CONCIERGE / SINGLE PASS", all questions on one page,
immediate export — distinct from AssessmentPage's guided/tabbed, discovery-first,
adaptive, draft/attestation flow) or require adding a large "quick mode" feature to
AssessmentPage — net churn with no reduction in the drift surface that actually
matters, which is already unified.

## What this preserves / does not change

- **`quick-session-nav` behavior preserved.** The header nav button
  (`data-testid="quick-session-nav"`, `App.tsx`) still routes to the QuickSession
  view; no test was retired. No e2e test references the quick-session route (grep,
  this goal), so nothing is silently broken.
- Two thin capture UIs, one shared core, one export/scoring path. Any future
  divergence risk is confined to presentation, and the single shared `SERVICE_OPTIONS`
  import keeps the one field-level list that both need from drifting.

## Revisit trigger

Fold (or retire QuickSession) if either surface begins forking core logic —
a second scoring path, a second StatusPayload shape, or a private copy of
`SERVICE_OPTIONS`/the question graph. As long as the core stays single-sourced,
two thin capture UIs are the correct, lower-churn design.
