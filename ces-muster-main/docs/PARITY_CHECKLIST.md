# Parity Checklist — postureGenerator characterization tests

**Test file:** `src/vendored/ces-spine/services/__tests__/postureGenerator.characterization.test.ts`
**Run date:** 2026-07-05
**Vitest version:** 2.1.9
**Result:** 1 test file, 10 tests — all PASS

---

## Test suite results

### describe: `generateReadinessPosture — answer classification (determineRequirementStatus)`

| # | Test | Status |
|---|------|--------|
| 1 | classifies each answer-value branch to its observed status | PASS |

### describe: `generateReadinessPosture — mergeStatuses precedence`

| # | Test | Status |
|---|------|--------|
| 2 | applies not_met > partial > unknown > met precedence across same-requirement answers | PASS |

### describe: `generateReadinessPosture — control_status_summary (computeControlStatusSummary)`

| # | Test | Status |
|---|------|--------|
| 3 | counts statuses and resolves level from si_baseline.target | PASS |
| 4 | defaults level to L2 when no target level present | PASS |

### describe: `generateReadinessPosture — key_findings (deriveKeyFindings)`

| # | Test | Status |
|---|------|--------|
| 5 | emits high not_met finding + medium unknown finding with impacted requirement ids | PASS |
| 6 | escalates not_met finding to critical when more than 5 are not met | PASS |
| 7 | substitutes the low "no significant findings" placeholder when there are none | PASS |

### describe: `generateReadinessPosture — empty input + envelope shape`

| # | Test | Status |
|---|------|--------|
| 8 | produces placeholder requirement_results and low finding for empty answers | PASS |
| 9 | stamps a stable envelope with shape-matched non-deterministic fields | PASS |
| 10 | omits cesId when not supplied and includes it when supplied | PASS |

---

## Known behavioral quirks (documented in tests)

- `mergeStatuses` returns `unknown` when either side is `unknown`, so a lone boolean-true (`met`) answer is swallowed back to `unknown`. This is captured as an intentional characterization (not a bug fix).
- Evidence-only fallback (`met`) is also swallowed back to `unknown` by the merge, but evidence refs are still recorded correctly.

---

## Vitest output

```
 ✓ src/vendored/ces-spine/services/__tests__/postureGenerator.characterization.test.ts (10 tests) 6ms

 Test Files  1 passed (1)
       Tests  10 passed (10)
    Start at  18:07:47
    Duration  1.42s
```
