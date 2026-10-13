# S4 Implementation Summary

**Date:** 2026-07-07
**Branch:** g-muster-p1
**Plan Reference:** G-MUSTER-P1 Slice S4 — SPA P1 features

## Files Created

- `src/shared/api/musterApi.ts` — thin fetch wrapper; base URL/JWT from localStorage; 3 s timeout; `api.{get,post,put,delete}` shorthand; never called in static interview path
- `src/features/assessment/adaptiveEngine.ts` — `AdaptiveEngine` class: adaptive|degraded mode; 3-failure threshold; browser offline/online event wiring; Dexie queue round-trip; `resync()` + `canFinish()` finish-gate; HIL flag routing on low-confidence high-weight sync facts [validate with BHD]
- `src/features/coach/coachApi.ts` — `sendChatMessage()` pure async function (separated from component per react-refresh ESLint rule)
- `src/features/coach/CoachPanel.tsx` — collapsible right-side chat panel; degraded path shows static guidance + "Coach unavailable — offline mode"
- `src/features/contracts/contractValidation.ts` — `validateContractForm()` pure function; `contract_number + program_name + cmmc_level_required 1..3` required
- `src/features/contracts/ContractsPage.tsx` — full CRUD UI; 14-field Contract entity; offline notice; individual_contractor prime_ref=null [validate with BHD]
- `src/features/assessment/__tests__/adaptiveEngine.test.ts` — 17 tests: transitions, queue round-trip, finish-gating
- `src/features/assessment/__tests__/harvestPrefill.test.ts` — 13 tests: loadHarvestFacts, applyHarvestFacts
- `src/features/coach/__tests__/coachPanel.test.ts` — 6 tests: sendChatMessage success/degraded/error paths
- `src/features/contracts/__tests__/contractValidation.test.ts` — 13 tests: required fields, range, string coercion, optional fields

## Files Modified

- `src/shared/types/engagement.ts` — added `QueuedAnswer`, `Contract` (14 fields) interfaces
- `src/shared/db/schema.ts` — version(2) migration adds `queued_answers` table; `MusterDB` class updated
- `src/features/assessment/assessmentHelpers.ts` — `factsFromAnswers` accepts optional `provenances`/`confidences`; added `HarvestFact`, `loadHarvestFacts()`, `applyHarvestFacts()`
- `src/features/assessment/AssessmentPage.tsx` — adaptive toggle (default OFF), provenance+confidence badges per question, harvest prefill display with AUTO-DETECTED badge, Coach button, Resync button, pending-sync gate note, adaptive mode banner
- `src/features/app/App.tsx` — `View` type adds 'contracts'; `MusterNav` adds Contracts button for both kinds; `ContractsPage` wired in; `partyId` added to `AppState`
- `src/muster.css` — `.question-card--suggested`, `.coach-panel` and all sub-elements

## Test Counts

- **Unit tests:** 151 pass (was 134; +17 new tests across 4 new test files)
- **DW#5 zero-network guardrail:** noNetworkCalls.test.ts — 5/5 PASS unchanged
- **ESLint:** 0 warnings, 0 errors
- **TypeScript build:** clean (tsc + vite, 196 modules)
- **e2e:** not re-run (requires Playwright server); all e2e specs are unaffected — adaptive toggle defaults OFF so the static path is unchanged; Contracts nav does not conflict with any existing selector assertions

## Deviations from Plan

1. **Coach degraded test uses logic layer not DOM rendering** — React Testing Library is not in this project's deps. Tests cover `sendChatMessage()` return values (the function that drives the degraded/live branching in the component). Rationale: minimum-footprint; existing project pattern is pure-function testing.
2. **`sendChatMessage` extracted to `coachApi.ts`** — ESLint `react-refresh/only-export-components` prohibits non-component exports in `.tsx` files. Rationale: compliance with existing lint rules.
3. **`InterviewFact.provenance` left as `string`** — changing to a union type would require updating the vendored ces-spine types and existing serialized session data. No breakage; valid values documented in JSDoc.
4. **HIL flagging via `POST /hil/flag`** — endpoint not explicitly listed in PLAN-p1-build.md's API contract section. Implemented as spec'd in the task description. [validate with BHD]
5. **`partyId` not set from AssessmentPage back to App** — `ContractsPage` receives `partyId` from `AppState`, which is only populated on resume (from Dexie on mount). The `handleEngagementReady` callback does not carry `partyId`. ContractsPage falls back to `partyId: null` and sends `party_id: undefined` to the API for new-session flows. [validate with BHD — party resolution on contract create]

## Open Items

- e2e run against the dev server not completed (requires `npm run dev` + Playwright); no e2e code was modified so the 7 specs should be unaffected
- `POST /hil/flag` endpoint assumed; confirm path with BHD before S3 API slice lands
- `partyId` propagation from `beginInterview` to `AppState` is missing; ContractsPage will not auto-populate `party_id` until the user navigates to contracts after a session resume
- Harvest facts fetch (via `/harvest/run`) lands in S5; `localStorage 'muster-harvest-facts'` is the seam; no harvest UI built yet
