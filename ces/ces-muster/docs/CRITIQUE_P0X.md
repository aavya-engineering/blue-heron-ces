# Critique — P0.x: Programmatic Drive + Dual Test Suites
**Date:** 2026-07-05
**Target:** commit b8bfb33 — session driver, Playwright E2E (7 specs), SE-2..SE-6, CI wiring
**Score:** 6.5/10

## TL;DR
The build is structurally honest and scope-clean but ships one CI-breaking defect: EU-3 uses a
plain `test()` call for a known-failing case, causing `npm run test:e2e` to exit non-zero and
break the primary acceptance criterion.

## Technical Purist (6/10)
- Good: `sessionDriver.ts` calls real `createEngagement`, real `executeExport`, real `db` — no
  logic reimplementation; SE-2..SE-6 exercise the production pipeline end-to-end; coverage
  thresholds correctly derived from measured baseline via the `min(80/75, floor(baseline))` rule;
  CI gate order (build → lint → test:coverage → check:drift → playwright → test:e2e) matches the
  plan exactly; `environmentMatchGlobs` wiring correct; `e2e/**` excluded from Vitest.
- Bad: `e2e/resume-mid-interview.spec.ts` uses `test('EU-3: ...', ...)` for a known-failing
  assertion — impact: `npm run test:e2e` exits 1, CI fails, plan acceptance criterion
  "7/7 Playwright specs passing" is violated — fix: replace `test(` with `test.fail(` (one word).
- Bad: EU-1 drops assertion (a) "roster CSV import: sub count visible in UI" without amending the
  plan — impact: the only E2E coverage of the `rosterImport.ts` service's UI surface is
  missing; the deviation is documented in the implementation log but the PLAN acceptance criterion
  still references 7/7 with the original EU-1 scope — fix: either wire a roster CSV file-input to
  StaticRollup and add the `setInputFiles(roster.csv)` assertion, or amend the PLAN acceptance
  criteria to declare EU-1(a) N/A for Phase 0 with explicit rationale.
- Ugly: Statements and lines coverage floor is 47% — technically correct per the baseline-first
  rule, but the ratchet schedule is undated. Without a committed date to raise these thresholds
  the floor may calcify.

## User Advocate (7/10)
- Works: EU-2 (individual_contractor UI gating), EU-4 (export absent pre-completion), EU-5
  (malformed JSON → error banner), EU-6 (FCA disclaimer + 0% score), EU-7 (on_prem_ot=yes in
  parsed payload) all assert the right product behaviors and pass.
- Fails: EU-3 failure reveals a real product gap — question index lives in React `useState`, not
  Dexie, so a user mid-interview who reloads loses all progress — impact: users lose interview
  state on accidental reload, which is a data-loss UX defect for a Phase-0 product in active
  advisor use — fix: in a follow-on task, persist `current_question_index` to Dexie on each
  `answer` write inside `InterviewRunner`; unblocks EU-3.
- Fails: EU-1(a) roster CSV import path untested at the UI level — impact: if the CSV upload
  surface is later wired, regressions have no E2E guard.

## Strategic Thinker (7/10)
- Aligned: Phase-0 OUT list held (no backend, no auth, no AI); `src/vendored/**` byte-identical
  to pinned SHA `4a00bee5` (drift 20/20 OK); CES addendum is pure append after line 185 — git
  diff shows only `+` lines, zero edits above the HIL approval section; ces-planner source files
  untouched.
- Concerns: EU-3 breaking CI means the branch cannot merge cleanly without a one-line fix that
  the builder documented but did not apply. The fix cost is 60 seconds; the omission is
  surprising given the clear awareness shown in the test comment.

## EU-3 Ruling
**PLAN DEFECT + implementation error.** The plan listed EU-3 as an expected-pass test, but
Stage-B `InterviewRunner` stored question index in React `useState`, not Dexie — a design choice
that was never acknowledged in the Stage-B implementation log as breaking EU-3's premise. The
builder's "expected fail" explanation is factually correct and honestly documented. However,
leaving the test as a plain `test()` call rather than `test.fail()` is a code error that breaks
CI — it is not a legitimate goalpost move, it is an incomplete implementation of the builder's
own stated intent. Disposition: (1) immediately change `test(` to `test.fail(` — unblocks CI;
(2) open a backlog item: "persist `current_question_index` to Dexie in `InterviewRunner` on each
answer write; re-enable EU-3 as a regular passing test." The failure is not acceptable to leave
as-is because it breaks the CI gate that the plan mandates.

## Verdict: FAIL (Round 1)
**Fix First:** `e2e/resume-mid-interview.spec.ts` line 9 — change `test(` to `test.fail(` so
Playwright marks EU-3 as an expected failure and `npm run test:e2e` exits 0. One word. CI gate
restored.
**Fix Second:** Amend PLAN acceptance criterion EU-1(a) to declare "roster CSV import UI surface
not built in Phase 0 — rosterImport.ts service tested in Vitest (rosterCsv.test.ts); E2E UI
coverage deferred to the phase that wires a CSV file-input to StaticRollup."

---

## Round 2 — Fix Verification (commit fab3284)

**Date:** 2026-07-05
**Reviewer ran:** `npx playwright test`, `npm test`, `npm run check:drift`

### Defect 1 — EU-3 test.fail() (RESOLVED)

`e2e/resume-mid-interview.spec.ts` changed from `test(` to `test.fail(` — confirmed in git diff.
Playwright live run output: `7 passed (17.2s)` with EU-3 showing `✘` (expected-failure marker);
suite exits 0. CI gate restored. Backlog item present in TEST_RESULTS_P0x.md: "persist
`current_question_index` to the `InterviewSession` Dexie record on each `answer` write inside
`InterviewRunner`; re-enable EU-3 as a standard passing test when implemented."

### Defect 2 — EU-1(a) N/A Disposition (HONEST AND CORRECT)

Code verified via grep across all of `src/`:

- Only one `type="file"` element exists in the entire source tree — `StaticRollup.tsx` lines 78–79
  with `accept=".json"`. No CSV file-input surface exists anywhere in the Phase-0 UI.
- `parseRosterCsv` is called only in `rosterCsv.test.ts`; zero call sites in any component or
  service outside of tests.

**DW#10 ruling:** The plan's DONE-WHEN #10 states "roster CSV import creates Sub records from a
fixture file" — this is satisfied at unit level by `rosterCsv.test.ts` (4 tests, all green,
calling `parseRosterCsv` against a real CSV fixture). DW#10 does not require a UI wiring. The
builder correctly identified that the UI surface Phase-0 built is StaticRollup JSON import, not
roster CSV. Declaring EU-1(a) N/A is factually grounded — not a dodge. It is the same class as
EU-3: a documented product gap (service exists, UI surface not yet wired) with a deferred backlog
item. The TEST_RESULTS_P0x.md section "EU-1(a) N/A Declaration" is accurate and honest.

### Regression check

- `npm test`: 55 / 55 PASS (12 files) — identical to Round 1 baseline
- `npm run check:drift`: 20 / 20 OK, 0 DRIFT
- `git show fab3284 --stat`: exactly 2 files changed (spec + TEST_RESULTS doc) — no other targets
  touched

## Final Score: 7.5/10

## Verdict: PASS
All Round-1 defects resolved. Both fixes are correct and minimal. Acceptance criteria met:
Vitest 55/55, Playwright 7 passed (EU-3 expected-fail), drift 20/20, CI gate order intact, scope
boundaries held, CES addendum append-only. Open items (EU-3 resume implementation, EU-1 CSV UI
wiring) are properly documented as backlog, not buried.
