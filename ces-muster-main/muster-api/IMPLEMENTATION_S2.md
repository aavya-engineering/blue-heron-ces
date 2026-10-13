# Implementation Log — S2 Nudge Engine

**Date:** 2026-07-07
**Plan Reference:** PLAN-p1-build.md → Slice S2; task spec "G-MUSTER-P1 Slice S2"

## Files Created

| File | Purpose |
|---|---|
| `src/services/nudgeService.ts` | Pure nudge engine (evaluate + escalationDigest) |
| `src/routes/nudges.ts` | POST /nudges/tick and POST /nudges/digest with Zod validation |
| `tests/nudge.engine.test.ts` | 14 tests covering DONE-WHEN #9 |
| `WIRING_S2.md` | Exact lines for orchestrator to add to app.ts |

## Verification Results

- `npx tsc --noEmit` — clean (no output)
- `npm test` — 122 passed, 1 skipped (14 new nudge tests + 108 pre-existing)
- `npx eslint src --ext ts --max-warnings 0` — clean (no output; ESLint not in devDependencies, ran via npx)

## Changes Made

- `src/services/nudgeService.ts` — `createNudgeService(db, nowFn)` with two methods:
  - `evaluate(engagementId | null, now)`: scans invited/in_progress parties, fires t3/t7/t14 NudgeEvents per idle threshold, stall-detects >14 days in_progress via `createLifecycleService` transition
  - `escalationDigest(engagementId, now)`: one NudgeEvent(escalation/digest) for all stalled parties + mode-c TouchEvent via `createTouchService`
- `src/routes/nudges.ts` — `createNudgesRouter(db)` factory; POST /tick + POST /digest; Zod schemas; default export; NOT wired into app.ts per spec
- `tests/nudge.engine.test.ts` — 14 tests across 4 describe blocks targeting DONE-WHEN #9
- `WIRING_S2.md` — import + mount lines for app.ts

## Deviations from Plan

1. **`nowFn` in factory used as default for method params, not as the sole clock**: `evaluate` and `escalationDigest` both declare `now: Date = nowFn()`. Internal services (lifecycleService, touchService) are created per-call with `() => now` so they use the same simulated clock as the explicit `now` parameter. The factory `nowFn` is therefore reachable (used as default value) rather than being the sole clock source.

2. **`NudgeEvent.party_id` for escalation digest**: the schema requires a non-nullable `party_id`. For a digest that covers N stalled parties, `party_id` is set to the first stalled party's ID. The full party list is in `payload.party_ids`. Logged as [validate with BHD] in the source.

3. **`tenant_id` in digest TouchEvent**: `touchSvc.record` requires a `tenantId` argument. No tenantId is passed to `escalationDigest`. Resolved by reading `tenant_id` from the first stalled party record (already fetched). Would need adjustment if parties could span tenants (not a current concern).

4. **`channel: 'email'` on t3/t7/t14/stall NudgeEvents**: channel is required in the schema and not specified in the plan. Used `'email'` as the placeholder with a `[validate with BHD]` comment.

5. **Stall transition uses `SYSTEM_USER_ID = 'system'`**: `lifecycleService.transition` requires a `byUserId`. No user context is available in the tick. Passed `'system'` as a sentinel; mockDb does not enforce the FK.

## Testing Notes

Tests cover all four scenarios from DONE-WHEN #9 verbatim:
- T+3/7/14 fire exactly once each as the clock advances — 6 tests (3 "fires" + 3 "idempotent re-tick")
- Stall detection flips lifecycle to stalled after >14 days and fires stall nudge once — 3 tests (including invited guard)
- Escalation digest aggregates stalled parties + records mode-c TouchEvent — 3 tests
- Fresh party (activity now) fires nothing — 2 tests (last_activity_at present and null/fallback)

Test count: 14 new. Suite total: 122 passed, 1 skipped (pre-existing live-DB skip in rls.test.ts).

## Open Items

- `channel` value for t3/t7/t14/stall needs BHD confirmation (currently `'email'`).
- `party_id` on digest NudgeEvent is a schema design gap; BHD review needed.
- Stall recovery path (stalled → in_progress) resets the nudge clock naturally (new last_activity_at) but prior t3/t7/t14 nudges still exist in the DB — a second pass would not re-fire them. BHD should confirm whether re-engagement resets the nudge history.
