# Requirement: `data-question-id` DOM hook convention (from ces-tester)

**Filed:** 2026-07-10 · **Source:** ces-tester phase-0 inventory
(`ces-tester/docs/PHASE0_FINDINGS.md` item 2) · **Founder-directed.**

## The convention

Every component that renders a wizard/assessment question card MUST expose the question's
stable bank ID as a DOM attribute on the card container:

```tsx
<div className="..." data-question-id={question.id}>
```

The ID is the machine-readable `id` field from the question bank (e.g. `BTC.ID.001`,
`CUI.CAT.001`, `G-01`) — the same key the answer records already use. This gives ces-tester's
Playwright driver one uniform selector (`[data-question-id="..."]`) across every CES question
UI. React passes `data-*` attributes straight to the DOM; the change is render-inert.

## Status elsewhere

ces-planner's six wizard components carry the attribute as of 2026-07-10
(SIT `QuestionPage.tsx`, BTC `BTCQuestionPage.tsx`, CUI `CUISectionPage.tsx`,
TCP `TCPSectionPage.tsx`, Policy `PolicySectionPage.tsx`, RRT `RRQuestionPage.tsx`).

## What Muster must accommodate

- Any Muster surface that renders question/objective cards (including the tabbed single-page
  assessment UI, and any future porting or replacement of the Planner wizards) must carry the
  same `data-question-id` attribute, sourced from the stable bank/objective ID.
- Applies to whichever checkout is active for Muster UI work (this repo and/or the standalone
  `scre-muster` checkout, currently branch `g-muster-p1`) — the convention travels with the
  component, not the repo.
- Question-bank change control must continue to **preserve IDs** when semantics are unchanged
  (the primed banks already state this rule) — the test harness's answer maps and selectors
  both key on these IDs.

## Why

ces-tester (G-TESTER-1) drives the real wizard UI headless via Playwright and resolves its
scenario `answer_map` entries by question ID. Without this attribute the driver has no stable
binding and every UI refactor silently breaks the end-to-end suite.
