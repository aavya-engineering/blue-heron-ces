# G-MUSTER-P1 Slice S1 — Implementation Summary

**Date:** 2026-07-07
**Branch:** g-muster-p1
**Status:** Complete — working tree left uncommitted for orchestrator

---

## Files Created / Changed

### Schema & Migration
- `prisma/schema.prisma` — Added `PartyLifecycle` enum (8 states), `lifecycle`+`last_activity_at` to Party, `HilItem` model, `TouchEvent` model
- `prisma/migrations/002_p1_domain/migration.sql` — DDL + RLS ENABLE/FORCE/POLICY for hil_items and touch_events

### Services (src/services/)
- `contractsService.ts` — CRUD over 14 contract fields; cmmc_level 1..3 validation; `updateEngagementKind` always throws
- `lifecycleService.ts` — 8-state transitions; Disposition rows for action-driven states (ready/validate/convert_to_enclave/reassessment_due); markAbandoned/optOut
- `hilService.ts` — `routeFact` with exact rule: (confidence='low' AND weight>=3) OR sub_flagged=true; `resolve` with advisor_minutes
- `touchService.ts` — `record(mode,kind,engagementId,tenantId,minutes)`; `report` with modeA aggregation and modeC perEscalation
- `sessionsService.ts` — upsert-by-id sync; get
- `progressService.ts` — per-party lifecycle summary with abandoned/opted_out override; counts per state

### Routes (src/routes/)
- `engagements.ts` — GET|POST /api/engagements, GET /api/engagements/:id, GET /api/engagements/:id/progress
- `parties.ts` — GET|POST /api/engagements/:engagementId/parties (createPartiesRouter) + GET /api/parties/:id (createPartyRouter) with sub self-only guard
- `contracts.ts` — GET|POST|PUT|DELETE /api/contracts, GET /api/contracts/:id; prime+bhd_operator write; bhd_operator-only delete
- `sessions.ts` — POST /api/sessions/sync (sub party_id guard), GET /api/sessions/:id
- `actions.ts` — POST /api/parties/:id/actions/:action; 7 actions mapped to lifecycleService/nudge placeholder
- `hil.ts` — GET /api/hil/queue, POST /api/hil/queue/:id/resolve, POST /api/hil/flag (sub-only)
- `touch.ts` — POST /api/touch/events, GET /api/touch/report

### App
- `src/app.ts` — Wired all 7 new route groups under /api; kept /auth unchanged

### Tests
- `tests/helpers/mockDb.ts` — In-memory fake: create/findUnique/findMany/update/updateMany/delete with key-value filtering; null-safe matching
- `tests/contracts.crud.test.ts` — 10 tests: all 14 fields, cmmc validation (0/4/1.5 rejected), CRUD, updateEngagementKind immutability
- `tests/rbac.matrix.test.ts` — 5 tests: prime roster-read 200, cross-tenant 403, sub self-only 403, bhd_operator write 201, assessor mutating 403; uses http.Server port-0 + native fetch
- `tests/hil.threshold.test.ts` — 11 tests: confidence=low+weight=3 routes, weight=2 does NOT, sub_flagged=true always routes (even confidence=high/weight=0), resolve captures timing
- `tests/lifecycle.test.ts` — 18 tests: all valid transitions, Disposition rows for action-driven states, terminal (convert_to_enclave) rejected, illegal transitions throw, markAbandoned/optOut
- `tests/touch.test.ts` — 5 tests: modeA aggregation, modeC perEscalation, mixed modes, HilItem-resolve context, zero baseline
- `tests/rls.test.ts` — 17 tests (1 skipped): static SQL assertions for ENABLE/FORCE/CREATE POLICY on all 5 tables; live skipIf(!DATABASE_URL) cross-tenant denial test

### Lint fix
- `src/lib/jwt.ts` — Added `// eslint-disable-next-line @typescript-eslint/no-unused-vars` for `_iat`/`_exp` destructure (pre-existing issue; `argsIgnorePattern` does not cover destructured vars)

---

## Test Counts

| Suite | Pass | Skip |
|---|---|---|
| muster-api (npm test) | 73 | 1 |
| repo root (npm test) | 151 | 0 |

---

## Deviations from Spec

1. **Root test count**: Spec said "confirm 102 passing" but root suite now has 151 tests. No regressions — count increased due to prior work in the same session.

2. **stalled→in_progress transition included** [validate with BHD]: Spec says "invited→in_progress→(stalled|complete)" and doesn't explicitly list stalled recovery. Added stalled→in_progress as a legal transition for workflow recovery.

3. **reassessment_due→in_progress included** [validate with BHD]: Spec says "any non-terminal→reassessment_due" but doesn't define outbound transitions from reassessment_due. Added reassessment_due→in_progress to allow cycle restart.

4. **Prime DELETE /api/contracts restricted to bhd_operator only** [validate with BHD]: Spec says "prime MAY create contracts... allow write on contracts within tenant" but doesn't address delete. DELETE is bhd_operator only as a conservative default.

5. **HIL queue visibility** [validate with BHD]: Spec does not specify which roles see the queue. Defaulted to bhd_operator, prime, assessor_read_only.

6. **eslint-disable on jwt.ts**: Pre-existing `_iat`/`_exp` unused-var warnings not suppressible by the existing `argsIgnorePattern` config (which only covers function args, not destructured vars). Added a comment-only disable on that line to satisfy `--max-warnings 0`.

7. **Route `db` param typed `any` with suppress comments**: Route factories receive `db: any` (injectable for tests). Suppressed with `eslint-disable-next-line @typescript-eslint/no-explicit-any` at each factory. Services use proper minimal interface types.

---

## Open Items

- S2: nudge tick evaluation (T+3/7/14, stall detection, escalation digest) is NOT implemented.
- S3: Claude adaptive interview + coach routes are NOT implemented.
- S5: M365 Graph harvest routes are NOT implemented.
- S6: SPRS scoring routes are NOT implemented.
- The `withTenant` helper in lib/prisma.ts is NOT yet wired into route handlers (Phase 2 per existing TODO in prisma.ts). Current routes pass tenant_id as a data field; RLS only enforces on a live DB with proper per-request SET LOCAL.
