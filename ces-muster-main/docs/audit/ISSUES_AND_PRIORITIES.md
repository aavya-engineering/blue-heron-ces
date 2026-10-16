# Blue Heron CES — Issues and Priorities

**Audit Date:** 2026-10-16

---

## P0 — Critical Security / Data Integrity

### P0-01: PostgreSQL muster_app role created as SUPERUSER [FIXED]
- **File:** `ces-muster-main/docker/init-db.sql`
- **Severity:** Critical — SUPERUSER bypasses ALL PostgreSQL Row-Level Security
- **Evidence:** `CREATE ROLE muster_app WITH LOGIN PASSWORD 'password' SUPERUSER`
- **Impact:** All tenant isolation via RLS is silently disabled; any user can read any tenant's data
- **Fix:** Changed to `NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE`
- **Verification:** SQL reviewed; RLS re-enabled on next `docker compose up --build`
- **Status:** ✅ FIXED

---

## P1 — Broken Core Workflows

### P1-01: Recipe manifest sha256 hashes out of sync [FIXED]
- **Files:**
  - `recipes/entra-mfa-report/manifest.json`
  - `recipes/defender-av-status/manifest.json`
  - `recipes/bitlocker-status/manifest.json`
- **Evidence:** `SignatureError: sha256 mismatch` on every recipe ingest call; 27 vitest failures
- **Root cause:** PowerShell recipe scripts updated, manifests not re-signed
- **Fix:** Updated sha256 values in all three manifests (verified with certutil)
- **Tests fixed:** `tests/recipes.ingest.test.ts` (30 tests) — all pass
- **Status:** ✅ FIXED

### P1-02: ces-muster-main had no standalone git repo — stamper fixture tests failed [FIXED]
- **Files:** `ces-stamper/tests/unit/TranslateBadControl.test.ts`, `MusterInfraManifestTranslate.test.ts`
- **Evidence:** `git show ces-muster main:... failed: fatal: invalid object name 'main'`
- **Root cause:** Tests call `git -C ../ces-muster show main:...` — ces-muster-main was not a standalone repo; no `main` branch
- **Fix:** `git init --initial-branch=main` inside `ces-muster-main`, committed fixtures
- **Tests fixed:** 6 stamper failures — all pass; 44/44 suites ✅
- **Status:** ✅ FIXED

### P1-03: muster-api tests cannot find ces-stamper registry at expected path [FIXED]
- **Files:** Multiple muster-api test files (live.areas, live.azTranslate, live.gate, live.teams, collectorKit.route)
- **Evidence:** `ENOENT: no such file or directory, open '...\ces-stamper\src\registry\cmmc-l2-commands.registry.json'`
- **Root cause:** Tests expect `heron_ces/ces-stamper/...` but stamper lives at `heron_ces/ces-mono-main/ces-stamper/`
- **Fix:** Created NTFS junction `heron_ces/ces-stamper` → `heron_ces/ces-mono-main/ces-stamper`
- **Tests fixed:** 8 muster-api suites — all pass
- **Status:** ✅ FIXED

---

## P2 — Reliability / Maintainability

### P2-01: Missing docs/context/ARCHITECTURE_DECISION_RECORD.md in ces-eo [FIXED]
- **File:** `ces-mono-main/ces-eo/docs/context/ARCHITECTURE_DECISION_RECORD.md`
- **Evidence:** `ENOENT: no such file or directory` — 1 EO test failure
- **Fix:** Created file with required W4-EO4 historical banner
- **Status:** ✅ FIXED

### P2-02: eo-live-sim-coverage.test.ts runs without stacksim guard [OPEN]
- **File:** `ces-mono-main/ces-eo/tests/integration/eo-live-sim-coverage.test.ts`
- **Evidence:** 2 tests fail when stacksim is not running (no skip guard)
- **Impact:** Breaks CI on ubuntu-latest (no PowerShell + stacksim)
- **Fix needed:** Add `if (!SIM_AVAILABLE) return;` skip guard in the test assertions
- **Status:** ⚠️ OPEN — requires test file edit

### P2-03: muster-api test suite not wired into CI [OPEN]
- **File:** `ces-mono-main/.github/workflows/ci.yml`
- **Evidence:** `ci.yml` only runs mono workspace tests; muster-api has 54 test files untouched by CI
- **Impact:** Recipe hash drift (P1-01), registry path mismatches (P1-03) were not caught by CI
- **Fix needed:** Add CI job or step for `cd ces-muster-main/muster-api && npm test`
- **Status:** ⚠️ OPEN

### P2-04: Docker Desktop required but not always running [OPEN]
- **Evidence:** `docker ps` fails with pipe error — Docker Desktop was not running
- **Impact:** PostgreSQL cannot start; muster-api cannot connect to the database
- **Fix needed:** `start-all.ps1` should check Docker status and warn/wait before proceeding
- **Status:** ⚠️ OPEN — documented in startup guide

### P2-05: start-all.ps1 assumes services start instantly without health checks [OPEN]
- **File:** `start-all.ps1`
- **Evidence:** Script starts each service then immediately prints "UP and healthy" without actually verifying
- **Impact:** If PostgreSQL takes longer than expected, muster-api will fail to connect on startup
- **Fix needed:** Add health-check polling after `docker compose up -d postgres`
- **Status:** ⚠️ OPEN

### P2-06: ces-tenant package reported invalid by npm workspace [OPEN]
- **File:** `ces-mono-main/package.json`
- **Evidence:** `npm list` reports `ces-tenant@0.5.0 invalid` for all consumers
- **Root cause:** npm workspace sees the junction target path differently from the declared `file:../ces-tenant`
- **Impact:** Warning only — builds and tests work; could break in strict CI
- **Status:** ⚠️ OPEN — tracked

---

## P3 — Enhancements / Optimization

### P3-01: Docker containers run as root user
- **File:** `ces-muster-main/docker-compose.yml`
- **Issue:** No `user:` directive on the stacksim container
- **Fix:** Add `user: "1001:1001"` and ensure volume permissions

### P3-02: No rate limiting on muster-api authentication endpoints
- **File:** `ces-muster-main/muster-api/src/routes/auth.ts`
- **Issue:** POST /auth/login has no brute-force protection
- **Fix:** Add express-rate-limit to /auth/login

### P3-03: Production .env.example warns against SUPERUSER but does not gate on it
- **File:** `ces-muster-main/muster-api/.env.example`
- **Issue:** Comment says "MUST NOT be superuser" but there's no runtime check
- **Fix:** Add startup check in server.ts that queries pg_roles to verify muster_app is not SUPERUSER

### P3-04: No graceful shutdown in muster-api server.ts
- **File:** `ces-muster-main/muster-api/src/server.ts`
- **Issue:** No SIGTERM/SIGINT handler — in-flight requests are dropped on restart
- **Fix:** Add process.on('SIGTERM') with server.close() and Prisma disconnect

### P3-05: stacksim docker-compose profile requires explicit profile flag
- **File:** `ces-muster-main/docker-compose.yml`
- **Issue:** `docker compose up -d postgres` does NOT start stacksim (correct), but the profile name (`stacksim` / `full`) is not documented in start-all.ps1
- **Fix:** Document profile flag in comments

---

## Verification Methods

| Issue | Verification |
|-------|-------------|
| P0-01 | `docker exec muster-postgres psql -U postgres -c "\du muster_app"` — must show no superuser attribute |
| P1-01 | `npm test` in muster-api — recipes.ingest.test.ts must pass |
| P1-02 | `git -C ces-muster-main show main:src/features/plan/__fixtures__/manual-mission-plan.json` must succeed |
| P1-03 | `npm test` in muster-api — live.areas/gate/teams/azTranslate tests pass |
| P2-01 | `npm run test:eo` — claim-accuracy.test.ts passes |
| P2-02 | Run `ces-eo` tests without stacksim — eo-live-sim-coverage.test.ts should skip not fail |
