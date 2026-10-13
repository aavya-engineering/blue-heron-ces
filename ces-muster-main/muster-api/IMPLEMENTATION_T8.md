# Implementation Log — T8 RLS Bug Fix
**Date:** 2026-07-07
**Scope:** muster-api/ only — do not commit

## Files Changed

| File | Change |
|------|--------|
| `prisma/migrations/004_rls_missing_ok/migration.sql` | NEW — recreates 5 tenant_isolation policies with missing_ok=true |
| `src/lib/prisma.ts` | MODIFY — `withTenant` accepts optional `client` parameter (defaults to global `db`) |
| `tests/helpers/mockDb.ts` | MODIFY — adds `$transaction` passthrough and `$executeRaw` noop |
| `src/routes/hil.ts` | MODIFY — service built per-request inside `withTenant` |
| `src/routes/parties.ts` | MODIFY — party queries wrapped in `withTenant` |
| `src/routes/sessions.ts` | MODIFY — service built per-request inside `withTenant` |
| `src/routes/contracts.ts` | MODIFY — service built per-request inside `withTenant` |
| `src/routes/actions.ts` | MODIFY — each action branch wrapped in `withTenant` |
| `src/routes/touch.ts` | MODIFY — service built per-request inside `withTenant` |
| `src/routes/nudges.ts` | MODIFY — service built per-request inside `withTenant` |
| `src/routes/reassessment.ts` | MODIFY — services built per-request inside `withTenant` |
| `src/routes/engagements.ts` | MODIFY — all handlers wrapped in `withTenant` (engagement CRUD for uniformity; progress uses withTenant for parties) |
| `tests/rls.test.ts` | MODIFY — adds 2 new live tests: unscoped returns [] (004 proof) and positive visibility |

## Migration 004 Detail

Recreates all 5 `tenant_isolation` policies using `current_setting('app.tenant_id', true)` (missing_ok=true). The two-argument form returns NULL instead of raising Postgres error 42704 when the GUC is not set. NULL = tenant_id evaluates to NULL (not TRUE), so unscoped connections see zero rows — fail-closed, no crash.

Applied: `npx prisma migrate deploy` with superuser `postgresql://postgres:...`.

## `withTenant` Signature Change

Added optional third parameter `client: any = db`. The production behavior is identical (no caller passes it; defaults to global Prisma singleton). Routes pass the injected `db` from their factory so unit tests using mockDb work without a live Postgres connection.

## mockDb Additions

`$transaction<T>(fn)` — calls `fn(mockDb)`, passing mockDb itself as the transaction client. `$executeRaw(...args)` — returns `Promise.resolve()` (noop). These allow `withTenant(tenantId, fn, mockDb)` to run in unit tests: the RLS GUC setup is silently skipped and the service callback receives the same mockDb to query.

## Deviations from Plan

1. **`withTenant` third `client` argument**: The task example shows `withTenant(req.user!.tenant_id, fn)` (two args). The implementation uses three args `withTenant(req.user!.tenant_id, fn, db)` in routes to thread the injected db through. Without this, the global Prisma singleton would be used inside transactions even in unit tests that inject mockDb, breaking rbac.matrix.test.ts and cli.test.ts. The third-arg approach is the minimal-footprint solution that preserves the `withTenant` name and pattern while making it testable.
2. **`const engagement: any` and `const party: any`**: Added explicit `: any` annotations in engagements.ts GET /:id and parties.ts createPartyRouter GET /:id to resolve TypeScript inference issue where `withTenant<T>` inferred T as `{}` (not `any`) for direct `tx.model.method()` calls. Required for `npx tsc --noEmit` to pass clean.
3. **`parties.ts` engagement preflight checks on plain `db`**: The `engagement.findUnique` calls in `createPartiesRouter` handlers are NOT wrapped in `withTenant` (engagements has no RLS). Only the party-specific writes/reads are wrapped. This diverges from the "wrap everything" approach taken in `engagements.ts` but is more correct since the preflight 403/404 checks must be visible before entering the transaction.

## Live Smoke Outputs

```
mu login --email ops@bhd.local --password muster-ops-2026
→ {"token":"eyJ..."}  exit 0

mu hil queue
→ []  exit 0  (was: 500 Postgres 42704 error before 004)

mu nudges tick --now 2026-07-21T00:00:00Z
→ {"fired":[]}  exit 0  (was: 500 Postgres 42704 error)

mu engagements list
→ [{"id":"4bfa1ea9-...","tenant_id":"e5497bdb-...","engagement_kind":"prime_and_subs",...}]  exit 0

mu touch report --engagement 4bfa1ea9-bf53-419e-abfd-911870e73589
→ {"modeA":{"events":0,"totalMinutes":0},"modeC":{"events":0,"totalMinutes":0,"perEscalation":[]}}  exit 0
```

## Test Counts

| Run | Count |
|-----|-------|
| Unit suite (npm test) | **250 passed \| 3 skipped** (same as baseline) |
| Live RLS suite (`DATABASE_URL=muster_app npx vitest run tests/rls.test.ts`) | **19 passed** (16 static + 3 live incl. 2 new) |
| `npx tsc --noEmit` | **clean** |
| `npx eslint src --max-warnings 0` | **clean** |

## Open Items

- `nudges tick` with operator tenant_id scopes party visibility to that tenant only. [validate with BHD]: cross-tenant global tick would need a service-account token per the task note.
- RLS on `interview_sessions` and `contracts` uses subquery into `parties`; this is correct but slightly more expensive than a direct tenant_id column would be. No change needed now.
