# Critique — G-MUSTER-P0
**Date:** 2026-07-05
**Target:** ces-muster Phase-0 Concierge MVP (Stage A + Stage B)
**Score:** 6.0/10

## TL;DR
The scaffold and vendoring are solid, but two end-to-end paths — the StatusPayload download and the timing persistence — are broken stubs that fail their own DW criteria.

## Technical Purist (6/10)
- Good: Parity test is byte-identical to ces-planner (only import path changed); drift check is self-contained and verified fail→pass; AJV schema validation on StatusPayload construction passes; immutability guard throws correctly; build/lint/test/drift all green.
- Bad: `downloadStatusPayload` defined but never called — `handleExport` in `App.tsx` is an empty no-op (lines 82-85); no download happens in production. — DW#9 says "exports downloads"; the export does not download. — Fix: wire `handleExport` to load the session from Dexie, call `scoreFacts`, and invoke `downloadStatusPayload`.
- Bad: `TimingContext` accumulates segments in React state; `InterviewRunner.tsx` writes `timing_segments: []` to Dexie at session creation (line 53) and never writes it again; `buildStatusPayload` reads from Dexie and gets `[]` every time. The timing test passes hardcoded segments directly to `buildStatusPayload`, bypassing the broken pipe. Implementation log admits the gap ("does not yet persist timing_segments back to the InterviewSession Dexie record automatically"). — DW#11 says "a recorded session shows captured segment times in the export"; it does not. — Fix: in `InterviewRunner`, consume `TimingContext` segments via `useTimingContext()` and write them to Dexie before calling `onComplete`.
- Bad: `IndividualContractor.test.tsx` creates a local `MusterShellFragment` mirror instead of importing the exported `MusterNav` from `App.tsx`. If production logic changes, this test cannot catch the regression. — Impact: DW#3b provides weaker assurance than claimed. — Fix: import `MusterNav` from `@/features/app/App` and test it directly.
- Ugly: None — no scope creep found; no backend, auth, AI, OAuth, or mode (a)/(c) code.

## User Advocate (7/10)
- Works: Engagement intake (prime/contractor), scope-lite with on-prem/OT persisted, static question graph (25 questions, 6 clusters), conservative score with FCA guardrail, disclaimer text on result screen, RAG board and CSV export in StaticRollup, TimerBar UI functional in browser.
- Fails: Export button does nothing in the running app — the advisor clicks "Export StatusPayload" and no file downloads. — Impact: the primary data handoff artifact cannot leave the tool. — Fix: see Defect 1.
- Fails: Timing data recorded by the advisor during a session is lost — it accumulates in UI state but never persists. Every export payload shows empty `timing_segments`. — Impact: the ≤2hr/sub go-gate evidence is unmeasurable. — Fix: see Defect 2.

## Strategic Thinker (7/10)
- Aligned: Yes. Scope is clean — no backend, no AI, no auth, no harvest, no nudge. Vendoring discipline is correct. Parity is real (byte-identical test, SHA-pinned, self-contained drift check). The Phase-0 charter ("static-graph interview → conservative score → StatusPayload export") is architecturally in place.
- Concerns: Two broken flows are not cosmetic — they block the go-gate evidence gathering (timing) and the field handoff (export). These are P0 deliverables, not Stage C backlog. The declared open items are correctly scoped as Stage C work, but the export and timing wiring are Stage B items that were not closed.

## Stage B Deviation Ruling
**TOLERATED.** `scoreFacts` calling `generateReadinessPosture` directly (bypassing the full `deriveActionStatuses` 6-step cascade) is acceptable for Phase 0. The complete-when criteria require "static-graph interview → conservative score," which is delivered. The cascade is correctly vendored and parity-proven at the `generateReadinessPosture` level. The skip is scoped to Stage C where runtime YAML pattern loading is feasible. DW#5 and DW#12 are satisfied by the implemented path.

## Verdict: FAIL

**Defect 1 (DW#9):** `downloadStatusPayload` never called — `src/features/app/App.tsx` `handleExport` is a no-op; export button produces no file. Fix: wire `handleExport` to build and download the payload.

**Defect 2 (DW#11):** Timing segments never reach Dexie — `src/features/interview/InterviewRunner.tsx` writes `timing_segments: []` at session creation and never updates it; every export has empty timing. Fix: read `useTimingContext().segments` in `InterviewRunner` and write to Dexie before `onComplete`.

**Defect 3 (DW#3b):** `src/features/intake/__tests__/IndividualContractor.test.tsx` tests a local mirror function, not the real `MusterNav` export from `App.tsx`. Fix: import and render `MusterNav` directly.

**Fix First:** Wire the export button — advisors cannot hand off data without it.
**Fix Second:** Persist timing segments to Dexie — go-gate evidence is unmeasurable without it.

---

## Round 2 — Re-review after critic fixes (commits 87d4bbb + 28da395)
**Date:** 2026-07-05
**Score:** 7.5/10

### Fix Verification

**Defect 1 (DW#9 — export no-op): CLOSED**
`App.tsx:handleExport` is now `async` and calls `executeExportAndDownload(state.sessionId)` (line 85). `exportPipeline.ts` implements two functions: `executeExport` (Dexie → scoreFacts → buildStatusPayload, returns payload) and `executeExportAndDownload` (calls executeExport then `downloadStatusPayload`). The wiring is real. `exportWiring.test.ts` calls `executeExport` directly — the identical codepath App.tsx exercises, minus the browser Blob download which cannot be tested in Node. Test uses `fake-indexeddb`, seeds real Dexie records (engagement + party + session with facts and timing), and asserts a schema-valid payload with correct field values. Not hollow.

**Defect 2 (DW#11 — timing never persisted): CLOSED**
`InterviewRunner.tsx` now imports `useTimingContext` (line 5) and destructures `segments` from it (line 32). On session completion (the final `recordAnswer` call), it writes `timing_segments: segments` to Dexie (line 80) alongside facts and status. `timing.test.ts` replaced with a Dexie-backed round-trip test using `fake-indexeddb`: seeds sessions with timing segments, reads them back, calls `buildStatusPayload`, asserts segments flow through. Three tests cover: 2-segment round-trip, empty-segment round-trip, all-four-segment types. Not hollow — the test exercises the exact Dexie layer the production pipe uses.

**Defect 3 (DW#3b — mirror component): CLOSED**
`IndividualContractor.test.tsx` now imports `MusterNav` from `@/features/app/App` and renders it with `renderToStaticMarkup`. Tests confirm `rollup-nav` absent for `individual_contractor` and present for `prime_and_subs`. The `roster-section` test uses a predicate helper mirroring `App.tsx`'s state condition — the correct approach since `roster-section` is App state-gated, not a `MusterNav` concern. Real component is now tested.

### No-Regression Checks
- Build: PASS (tsc + vite, 0 errors)
- Lint: PASS (0 warnings)
- Tests: 39/39 PASS (10 test files, up from 9 — `exportWiring.test.ts` is new)
- Drift check: 19/19 OK, 0 DRIFT
- Scope creep in fix commits: none — new files are `exportPipeline.ts`, `exportWiring.test.ts`, and minor edits to `App.tsx`, `InterviewRunner.tsx`, `IndividualContractor.test.tsx`, `timing.test.ts`. No backend, auth, AI, or out-of-scope code introduced.

### Deviation Ruling: unchanged
Stage B scoring deviation (facts → `generateReadinessPosture` directly, cascade deferred to Stage C) remains TOLERATED.

## Final Verdict: PASS

All three Round 1 defects are genuinely closed. No regressions. No new scope creep. All DW#1–12 criteria satisfied. Gate clears for HIL approval (DW#14).
