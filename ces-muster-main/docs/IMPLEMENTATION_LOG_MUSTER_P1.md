# Implementation Log — G-MUSTER-P1 Phase 1
**Date:** 2026-07-06
**Plan Reference:** PLAN.md — G-MUSTER-P1 Phase 1: muster-api Scaffold (Implementation Steps 1–13, File Inventory)

## Files Created

| File | Notes |
|------|-------|
| `muster-api/package.json` | Node package, all deps per step 1; no `"type": "module"` (CJS) |
| `muster-api/tsconfig.json` | NodeNext, strict, esModuleInterop, skipLibCheck; rootDir=src, excludes tests/ |
| `muster-api/.env.example` | DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN=8h, PORT=4000 |
| `muster-api/prisma/schema.prisma` | 8 models, 6 enums, @@map snake_case table names |
| `muster-api/prisma/migrations/001_init/migration.sql` | Full CREATE TABLE DDL + RLS ENABLE/FORCE + CREATE POLICY for parties/interview_sessions/contracts; ALTER ROLE postgres BYPASSRLS |
| `muster-api/src/lib/prisma.ts` | Prisma singleton exported as `db` |
| `muster-api/src/lib/jwt.ts` | `mintToken(payload, options?)` + `verifyToken(token)` |
| `muster-api/src/middleware/auth.ts` | `bearerAuth` + `requireRole(...roles)` |
| `muster-api/src/routes/auth.ts` | POST /auth/login (Zod+bcryptjs) + GET /auth/me (bearerAuth) |
| `muster-api/src/app.ts` | Express factory: JSON parser, /auth router, 404+error handlers |
| `muster-api/src/server.ts` | Entry point: dotenv/config + app.listen(PORT) |
| `muster-api/tests/jwt.test.ts` | 4 JWT unit tests (no @prisma/client import) |
| `muster-api/tests/rbac.test.ts` | 4 RBAC middleware tests, req.user mocked directly (no @prisma/client) |

## Files Modified

| File | Change |
|------|--------|
| `vite.config.ts` (ces-muster root) | Added `'muster-api/**'` to `test.exclude` array |

## Test Results

### muster-api (`npm test` from `muster-api/`)
```
 ✓ tests/rbac.test.ts (4 tests)
 ✓ tests/jwt.test.ts  (4 tests)

 Test Files  2 passed (2)
       Tests  8 passed (8)
```

### ces-muster root (`npm test` from `ces-muster/`)
```
 Test Files  16 passed (16)
       Tests  91 passed (91)
```

### Vendored diff
`git diff --stat src/vendored/` — empty (no changes).

### `prisma generate`
Succeeded: Generated Prisma Client (v5.22.0) to `node_modules/@prisma/client`.

## Deviations from Plan

1. **`vitest.config.ts` added** — Not in the plan's File Inventory. Added to prevent Vitest from traversing up to the ces-muster `vite.config.ts` and to establish an isolated test root. File is minimal (`defineConfig({})`). The tests pass without it on this machine but the file guards against parent-config pickup in other environments.

2. **No `"type": "module"` in package.json** — Plan specifies `module: NodeNext` in tsconfig but does not explicitly require ESM in package.json. CommonJS was chosen for `bcryptjs` (CJS-only) and `jsonwebtoken` (CJS primary) compatibility. NodeNext + CJS gives the TypeScript strict-module-resolution benefits without native-ESM interop friction on Windows.

3. **Contract field count: 15 total, 14 "named" fields** — Plan states "14 named fields." Enumeration lists 15 fields including `id`. Resolution: `id` is the auto-generated PK and is not counted as a "named" field per convention; the 14 named fields are `party_id, engagement_id, contract_number, program_name, cage_code, uei, contracting_office, co_name, award_date, pop_start, pop_end, cmmc_level_required, cui_categories, created_at`.

4. **Prisma field types use `String` (maps to TEXT) for UUIDs, not `@db.Uuid`** — Migration SQL uses `UUID` type directly (correct). The Prisma schema uses `String` for id/FK fields which Prisma maps to TEXT. This discrepancy only surfaces when running migrations against a live DB. No live DB is required for Phase 1 and tests do not exercise this path. Will reconcile in a later phase if needed.

5. **RLS on `interview_sessions` and `contracts` uses subquery through `parties`** — These tables have no direct `tenant_id` column; the plan's "keyed to `current_setting('app.tenant_id')::uuid`" is implemented via `party_id IN (SELECT id FROM parties WHERE tenant_id = ...)`.

6. **`mintToken` accepts optional `{ expiresIn? }` override** — Required for the "expired token throws" test case (4th jwt test). This is an additive parameter that is not a breaking change.

## Open Items

- `prisma generate` warns: `Update available 5.22.0 → 7.8.0` — not addressed in Phase 1.
- `npm audit`: 4 advisories (2 moderate, 1 high, 1 critical), ALL in the dev toolchain only (`vitest → vite-node → vite → esbuild`). No runtime dependency (`express`, `jsonwebtoken`, `bcryptjs`, `zod`, `@prisma/client`) has a finding — the production surface is clean. Tracked fix: bump to `vitest@4` in a later phase.
- Deferred to Phase 2 (tracked landmine): add `@db.Uuid` to every UUID field in `schema.prisma` so a future `prisma migrate` against a live DB does not generate a spurious TEXT→UUID migration.
- No live DB smoke test for `POST /auth/login` (requires DB + seeded user). Smoke test deferred to Phase 2 when a DB is provisioned.
- `src/vendored/**` untouched — confirmed via `git diff --stat src/vendored/` returning empty.

## Brutal-Critic Remediation (Stage 5, 2026-07-06)

Critic verdict was FAIL (2 blockers, 2 majors, 3 minors). Remediation applied and all gates re-run green (muster-api 8/8, `tsc` build exit 0, ces-muster 91/91, vendored diff empty):

- **BLOCKER 1 — JWT_SECRET weak default (`src/lib/jwt.ts`):** removed the `?? 'dev-secret-for-testing'` fallback; module now throws `JWT_SECRET environment variable is required` at load if the var is absent. Tests supply `JWT_SECRET` via `test.env` in `vitest.config.ts`.
- **BLOCKER 2 — unguarded async login handler (`src/routes/auth.ts`):** wrapped the `POST /auth/login` body in `try/catch` forwarding to `next(err)`; a DB rejection now reaches the Express error handler instead of crashing the process.
- **MAJOR 3 — postgres BYPASSRLS footgun:** documented the "app role must not be `postgres` / must not have BYPASSRLS" requirement in both `migration.sql` (header comment above `ALTER ROLE`) and `.env.example`.
- **MAJOR 4 — missing tenant-context helper:** added `withTenant(tenantId, fn)` to `src/lib/prisma.ts` — a transaction that issues `set_config('app.tenant_id', $1, true)` (bound parameter, injection-safe) so RLS resolves. Carries a `TODO(Phase 2)` to wire it into the request pipeline from the JWT `tenant_id` claim.
- **MINOR 5 — audit mischaracterization:** clarified above (dev-toolchain only).
- **MINOR 6 — `@db.Uuid` drift:** tracked as a Phase 2 open item above.
- **NIT 7 — undeclared `vitest.config.ts`:** noted in the plan File Inventory addendum.

## Brutal-Critic Second Pass (Stage 5 re-run, 2026-07-06)

Verdict: **PASS-WITH-NITS**. All 7 prior findings confirmed CLOSED on disk except MINOR 6 (`@db.Uuid`), which is correctly still OPEN and tracked for Phase 2. Gates re-run independently: muster-api 8/8, `tsc` exit 0, ces-muster 91/91, vendored diff empty. Highest-risk fix (`withTenant` `$executeRaw` parameterization + `is_local=true`) verified correct. Three new nits:

- **NIT C — no `start` script (FIXED):** added `"start": "node dist/server.js"` to `muster-api/package.json`.
- **NIT A — JWT_SECRET throw path has zero test coverage (Phase 2):** the guard cannot be reached because `test.env` always injects the var and module-load code runs once per worker. Track: add a separate Vitest project with `env:{}` asserting the import throws, or accept + document.
- **NIT B — `withTenant` has no callers / no compile-time enforcement (Phase 2):** when wiring Phase 2 routes, add an ESLint `no-restricted-imports` rule banning direct `db` use in route files so business logic must go through `withTenant`.
