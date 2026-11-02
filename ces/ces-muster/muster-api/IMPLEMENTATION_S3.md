# Implementation Log — S3 Claude Routes

**Date:** 2026-07-07
**Plan Reference:** G-MUSTER-P1 Slice S3 — Claude-API adaptive interview + chat coach

## Files Created

| File | Purpose |
|------|---------|
| `muster-api/src/lib/claude.ts` | Lazy Anthropic singleton: `getClaude()` / `isDegraded()` |
| `muster-api/src/services/adaptiveInterviewService.ts` | Adaptive question sequencing + retro confidence |
| `muster-api/src/services/coachService.ts` | CMMC readiness chat coach |
| `muster-api/src/routes/interview.ts` | POST /interview/adaptive/next + /retro-confidence |
| `muster-api/src/routes/coach.ts` | POST /coach/chat |
| `muster-api/tests/adaptive.test.ts` | 13 tests: degraded, id-validation fallback, SDK error mapping |
| `muster-api/tests/coach.test.ts` | 12 tests: degraded, guardrail prompt, SDK error mapping, happy path |
| `muster-api/WIRING_S3.md` | Lines to add to app.ts (not applied per plan) |

## Test Results

- **108 passed, 1 skipped** (the RLS cross-tenant test — pre-existing skip, no DATABASE_URL)
- 25 new tests: 13 adaptive + 12 coach
- Pre-existing suite untouched

## npm install

```
npm install @anthropic-ai/sdk
```
Added 7 packages. No existing dependency conflicts.

## Deviations from Plan

1. **`remainingQuestions` in route body.** The plan's API contract shows body `{sessionId, priorFacts, stacks}` but the service takes `{priorFacts, stacks, remainingQuestions}`. Added `remainingQuestions` as a required Zod field on `/adaptive/next`. Rationale: the server has no embedded question bank; the SPA (which already tracks interview state) sends the remaining question list. The validation (returned id must be in remainingQuestions) relies on this field being present. [validate with BHD if the SPA should derive remaining questions differently]

2. **`getSystemPrompt()` method on coachService.** Added a zero-overhead accessor so tests can assert on the Tier-1 guardrail strings without parsing call args. Not in the plan; strictly additive and test-only in practice.

3. **`AdaptiveInterviewService` and `CoachService` type aliases exported.** Additive; supports future route DI patterns.

## Open Items

- Wire `interviewRouter` and `coachRouter` into `src/app.ts` per `WIRING_S3.md` before any runtime testing.
- `ANTHROPIC_API_KEY` must be set in the environment for live requests; absent key → all three endpoints return 503 `{degraded:true}`.
- `CLAUDE_MODEL` env var overrides the default `claude-opus-4-8`.
