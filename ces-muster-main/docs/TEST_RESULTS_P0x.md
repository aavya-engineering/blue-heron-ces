# Test Results — P0.x: Programmatic Drive + Dual Test Suites

**Date:** 2026-07-05
**Plan Reference:** G-MUSTER-P0x

---

## Vitest Suite

**Result:** 55 / 55 PASS (12 test files)

| File | Tests | Result |
|------|-------|--------|
| `src/vendored/ces-spine/services/__tests__/postureGenerator.characterization.test.ts` | 10 | PASS |
| `src/features/rollup/__tests__/contract.test.ts` | 3 | PASS |
| `src/features/rollup/__tests__/rosterCsv.test.ts` | 4 | PASS |
| `src/features/intake/__tests__/engagementKind.test.ts` | 2 | PASS |
| `src/features/interview/__tests__/noNetworkCalls.test.ts` | 5 | PASS |
| `src/features/timer/__tests__/timing.test.ts` | 3 | PASS |
| `src/features/export/__tests__/statusPayload.test.ts` | 5 | PASS |
| `src/features/scoring/__tests__/fcaGuardrails.test.ts` | 5 | PASS |
| `src/features/scoring/__tests__/cascadeParity.test.ts` | 7 | PASS |
| `src/features/intake/__tests__/IndividualContractor.test.tsx` | 3 | PASS |
| `src/features/export/__tests__/exportWiring.test.ts` | 3 | PASS |
| `src/driver/__tests__/sessionDriver.test.ts` | 5 | PASS |

New tests added in P0.x: SE-1 (appended to statusPayload.test.ts), SE-2 through SE-6 (sessionDriver.test.ts).

---

## Coverage

### Baseline (measured before thresholds set)

| Metric | Baseline |
|--------|----------|
| Statements | 47.41% |
| Branches | 74.91% |
| Functions | 67.08% |
| Lines | 47.41% |

### Threshold Rule Applied

- lines/statements/functions: `min(80, floor(baseline))`
- branches: `min(75, floor(baseline))`

### Thresholds Set

| Metric | Threshold |
|--------|-----------|
| lines | 47 |
| statements | 47 |
| functions | 67 |
| branches | 74 |

### Final Coverage (after all P0.x code added)

| Metric | Value |
|--------|-------|
| Statements | 48.68% |
| Branches | 76.97% |
| Functions | 69.04% |
| Lines | 48.68% |

All metrics above threshold. Suite passes with coverage enforcement.

---

## Playwright E2E Suite

**Result:** 7 / 7 PASS — EU-3 now passes (resume implemented)

**Target:** `vite preview` at `http://localhost:4173` (production build)
**Browser:** Chromium only

| ID | Spec | Description | Result |
|----|------|-------------|--------|
| EU-1 | `prime-and-subs-happy.spec.ts` | Full happy path: interview, StatusPayload download, rollup JSON import, CSV export | PASS |
| EU-2 | `individual-contractor.spec.ts` | individual_contractor variant — roster-section and rollup-nav absent | PASS |
| EU-3 | `resume-mid-interview.spec.ts` | Resume after reload — question index at position 4 (Dexie persistence) | PASS |
| EU-4 | `export-no-session.spec.ts` | Export button absent/disabled before interview completion | PASS |
| EU-5 | `malformed-roster.spec.ts` | Malformed JSON import — error banner visible, no RAG rows | PASS |
| EU-6 | `fca-unknown-display.spec.ts` | All unknown answers → FCA disclaimer visible, score 0% | PASS |
| EU-7 | `on-prem-ot-payload.spec.ts` | on_prem_ot=yes surfaces in exported StatusPayload | PASS |

### EU-3 Implementation Note

`InterviewRunner` now persists `current_question_index` to Dexie on every answer write. `App.tsx` on-mount checks for in-progress sessions and restores `view:'interview'` with the correct `partyId`/`sessionId`. On reload, `InterviewRunner` receives `existingSessionId`, loads facts + stacks + index from Dexie, then gates `loadQuestionGraph` behind a `resumeReady` flag to avoid the race where question loading resolves before the Dexie read completes.

### EU-1(a) N/A Declaration — Roster CSV Import UI Surface

**Finding:** Phase-0 SPA does not have a roster CSV file-input surface. `StaticRollup.tsx` exposes a single `<input type="file" accept=".json">` for JSON StatusPayload imports only. `parseRosterCsv` (`rosterImport.ts`) is untouched by the UI — it is only exercised in Vitest (`rosterCsv.test.ts`, 4 tests green).

**Disposition:** EU-1(a) "roster CSV import: sub count visible in UI" is N/A for Phase 0. There is no file-input surface Playwright can reach for CSV upload. EU-1 exercises the actual Phase-0 rollup surface (StaticRollup JSON import → RAG board → pending-subs CSV export). E2E UI coverage for roster CSV import is deferred to the phase that wires a CSV file-input to StaticRollup or a dedicated RosterUpload component.

---

## Vendored Drift Check

**Result:** 20 / 20 OK — 0 DRIFT

Pinned SHA: `4a00bee5d5e618cf55da2469ec12307ebc620418`

---

## Summary

| Suite | Result |
|-------|--------|
| Vitest (unit + integration) | 55 / 55 PASS |
| Playwright E2E | 7 / 7 PASS |
| Coverage thresholds | PASS (48.68% / 76.97% / 69.04% / 48.68% vs 47/74/67/47) |
| Vendored drift | 20 / 20 OK |
