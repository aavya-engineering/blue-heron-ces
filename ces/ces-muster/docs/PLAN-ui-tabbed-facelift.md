# PLAN — G-MUSTER-UI: CES facelift + single-page tabbed assessment

**Date:** 2026-07-07 · **Branch:** `g-muster-ui` (off `g-muster-p1-scaffold`)
**Mandate:** (1) bring ces-muster into the CES "Instrument" design system (same `ces-ui.css`
the other four CES UIs adopted in G-UI-1..7); (2) replace the question-after-question
interview with **one page** whose questions are grouped into **tabs by cluster**, with
tabs/questions **derived from prior answers** (service inventory drives stack-conditional
questions).

## Current state (verified)

- Flow: `EngagementSetup` → `ScopeLite` → `InterviewRunner` (service inventory phase, then
  ONE question per screen, 20+ clicks) → `ResultScreen`. Separate `QuickSession` page is
  already single-page (flat list, no tabs, no styling).
- Question graph (`questionGraph.ts`): 23 static questions, each tagged `cluster`
  (identity / endpoint / policy / monitoring / data_protection / incident_response) and
  optionally `applicable_stacks` — already the exact derivation data tabs need.
- Persistence: Dexie. `InterviewSession.facts[]` + `current_question_index` persisted per
  answer; App on-mount resumes any `in_progress` session (e2e EU-3 asserts this).
- Styling: 100% inline styles, zero CES assets, default vite favicon/title.

## Slices (each an independently green commit)

### Slice 1 — CES design-system foundation (presentation only)
1. Vendor `ces-ui.css`, `ces-logo.svg`, `ces-favicon.svg` from `ces/ces-shared/ui/` into
   `public/`; register sha256 in `vendor-manifest.json` (drift check covers them).
2. `index.html`: title **CES Muster**, favicon → `ces-favicon.svg`, `<link>` ces-ui.css,
   pre-paint theme-restore inline script (localStorage key `ces-theme`, `data-theme` on
   `<html>` — same contract as ces-theme-toggle.js).
3. `App.tsx`: `MusterNav` → canonical `.ces-header` lockup (logo + "CES Muster" wordmark +
   "Blue Heron Defense — Muster" + version + React ThemeToggle). Keep `quick-session-nav` /
   `rollup-nav` testids and the conditional rollup logic (unit test DW#3b renders MusterNav).
   Add `.ces-footer`.
4. `src/muster.css` (app-level, token-consuming): form controls, tab rail, question panels.
Verify: `npm test` + `npm run test:e2e` green with NO test changes.

### Slice 2 — Single-page tabbed assessment (+ e2e rewrite, same commit)
1. New `src/features/assessment/AssessmentPage.tsx` replaces all three flow steps:
   - **Profile tab**: engagement kind, org name (placeholder "Acme Defense LLC", kept),
     UEI/CAGE, on_prem_ot (`name="on_prem_ot"`, kept), employee count, SSP, covers_m365,
     **service inventory checkboxes**. "Begin Interview →" validates (name + on_prem_ot),
     creates engagement + party + session(in_progress), starts `interview` timing segment,
     unlocks cluster tabs.
   - **Cluster tabs** (derived): filtered graph (`loadQuestionGraph(selectedServices)`)
     grouped by `cluster`; stack-conditional questions appear only when their service is
     checked (tabs derived from prior answers). Tab chip shows answered/total. Questions
     render as radio groups (`name=<question.id>`); every change upserts facts to Dexie
     (keyed by question_id) + `current_question_index` = answered count (schema unchanged).
   - **Action bar**: overall progress + **Finish** (enabled when all visible questions
     answered) → stop segment, status complete → ResultScreen.
   - **Resume**: App-mount logic unchanged; AssessmentPage with `existingSessionId`
     restores party/engagement/answers/services from Dexie and lands on question tabs.
2. Delete `EngagementSetup.tsx`, `ScopeLite.tsx`, `InterviewRunner.tsx`. Keep
   `engagementService`, `questionGraph(Service)`, timer, quick helpers (reused:
   `updateAnswer`, `computeStoppedSegments`).
3. Unit tests: new pure-helper tests (grouping, tab derivation, all-answered gate,
   fact upsert). Keep DW#3a/3b intact.
4. e2e rewrite (EU-1, EU-2, EU-3, EU-6, EU-7): drive profile tab → Begin Interview →
   per-tab radio answers → Finish. EU-3 resume asserts answers persist + progress count
   restored after reload (replaces "Question 4 of" assertion).
   `export-no-session` / `malformed-roster` expected untouched.

### Slice 3 — Restyle remaining views
`ResultScreen`, `StaticRollup`, `QuickSession`, `TimerBar` swap ad-hoc inline grays for
CES classes (`panel`, `btn-*`, `ces-titleblock`, `badge-*`, tokens). No logic change.

## Risks / notes
- MusterNav is rendered via `renderToStaticMarkup` in a node-env test — theme toggle must
  not touch `localStorage`/`document` at render time (effects only).
- `body::before` CUI designation rail is part of the design system — keep (consistent with
  the other four CES UIs).
- Changing services mid-interview recomputes visible questions; Finish gate counts only
  currently-visible questions; hidden answers are retained in state but excluded from
  final facts.
- QuickSession stays (concierge path) but inherits styling only.
