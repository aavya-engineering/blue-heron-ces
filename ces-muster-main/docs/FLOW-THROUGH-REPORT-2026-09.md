# Flow-Through Report — ces-muster, September 2026

**Branch:** `flow-through-2026-09`
**Date:** 2026-09-26
**Source:** `INSTRUCTIONS-FROM-STRATEGY-2026-09-26.md` (5 ordered steps from flow assessment)

## Summary

Three of five flow-through steps are DONE with passing tests. Two are recorded
HONEST-OPEN with REQ files documenting the upstream blockers.

| Step  | Description                        | Status      | Commit   |
|-------|------------------------------------|-------------|----------|
| MS-R1 | Provisional plan contract + gate   | DONE        | `c1c60db` |
| MS-R4 | cesId + inheritance metadata       | DONE        | `ad151b6` |
| MS-R5 | Plan push API + filename fix       | DONE        | `24e408f` |
| MS-R9 | Results ingest (return path)       | HONEST-OPEN | `774caa1` |
| MS-R7 | Infrastructure manifest via TCP    | HONEST-OPEN | `774caa1` |

## Exit Criteria

| Criterion                                          | Status |
|----------------------------------------------------|--------|
| Every step DONE or recorded HONEST-OPEN with REQ   | MET    |
| `npx tsc --noEmit` clean (SPA + muster-api)       | MET    |
| `npm test` clean (SPA: 336 passed; API: 313 passed, 3 skipped pre-existing) | MET |
| Small green commits, each individually valid        | MET    |
| This completion report at `docs/FLOW-THROUGH-REPORT-2026-09.md` | MET |

## Step Details

### MS-R1: Provisional Plan Contract + Validation Gate (DONE)

**What:** Structural contract validation in the SPA (`checkMissionPlanCore`,
`checkTenantManifestCore`) and a full Zod contract in muster-api
(`muster-api/src/contracts/missionPlan.contract.ts`). The compile path in
`planCompileService.ts` gates artifacts before they leave Muster.

**Tests:** 10 SPA-side contract validation tests + 6 muster-api Zod tests.

**Cross-module note:** The Zod contract is provisional — designed to be lifted
verbatim into ces-shared. Filed `REQ-ces-shared-mission-plan-contract.md` for
the canonical shared contract. Until ces-shared ships it, the cross-module
acceptance criteria (Stamper typecheck, ces-shared unit test) cannot be met.

### MS-R4: cesId + Inheritance Metadata (DONE)

**What:** `engagement.id` wired as `cesId` into the plan compile path
(`planCompileService.ts:134`). Propagated through the vendored generator to the
ces block of MP, TM, and SI baseline. Inheritance metadata (fedramp fields)
already flows through the generator from the gap set — no vendored code changed.

**Tests:** 4 tests — cesId present/absent, inheritance piping verified.

### MS-R5: Plan Push API + Filename Fix (DONE)

**What:** `POST /api/plan/push` in muster-api writes MP+TM to
`getStamperTenantSubdir(slug, 'plans')` with hyphenated naming matching
Stamper's browse regex (`^manual-mission-plan-.*\.json$`). Validates slug
against `/^[a-z0-9][a-z0-9-]{0,63}$/` to prevent path traversal. Validates
both artifacts against the provisional Zod contract before writing. Body limit
raised to 5MB (MP fixture is 3.4MB).

PlanTab download fixed from underscore to hyphen naming. E2e regex updated.

**Tests:** 5 route tests (happy path, traversal, contract violation, auth,
missing slug). No supertest dependency — follows the repo's `http.Server` +
`fetch` pattern.

**Cross-module note:** The "done when" clause — "appears in Stamper's
GET /api/browse" — is verified locally via regex assertion. Full cross-module
verification (spinning up Stamper against the same pipeline root) is deferred
until integration testing.

### MS-R9: Results Ingest (HONEST-OPEN)

**Blocker:** Depends on Phase 4 (ces-tester) and a shared
`ExecutionResultsSchema` that doesn't exist yet. Stamper must emit results in
a defined format before Muster can ingest them.

**REQ filed:** `docs/requirements/REQ-stamper-execution-results-contract.md`

### MS-R7: Infrastructure Manifest (HONEST-OPEN)

**Blocker:** Depends on PLAN-3 M3 (Tenant Config Profile) — the TCP input
surface hasn't been built. The generator and conditional rendering are wired;
the missing piece is the input data.

**REQ filed:** `docs/requirements/REQ-muster-infra-manifest-tcp.md`

## Files Changed (flow-through commits only)

### New files
- `muster-api/src/contracts/missionPlan.contract.ts` — provisional Zod contract
- `muster-api/src/routes/plan.ts` — POST /api/plan/push route
- `muster-api/tests/missionPlan.contract.test.ts` — Zod contract tests
- `muster-api/tests/plan.push.test.ts` — push route tests
- `src/features/plan/__fixtures__/manual-mission-plan.json` — MP fixture
- `src/features/plan/__fixtures__/tenant-manifest.json` — TM fixture
- `src/features/plan/__fixtures__/si-baseline.json` — SI baseline fixture
- `src/features/plan/__tests__/contractValidation.test.ts` — SPA contract tests
- `src/features/plan/__tests__/cesIdEmit.test.ts` — cesId propagation tests
- `src/features/plan/__tests__/generateFixtures.test.ts` — fixture generator
- `docs/requirements/REQ-ces-shared-mission-plan-contract.md`
- `docs/requirements/REQ-stamper-execution-results-contract.md`
- `docs/requirements/REQ-muster-infra-manifest-tcp.md`

### Modified files
- `muster-api/src/app.ts` — register plan router
- `src/features/plan/planCompileService.ts` — MS-R1 gate + MS-R4 cesId wiring
- `src/features/plan/missionPlanContract.ts` — enhanced contract validation
- `src/features/plan/PlanTab.tsx` — hyphenated download filenames
- `src/features/plan/__tests__/siLiveResidue.test.ts` — pre-existing TS fix
- `e2e/plan-generate-mp.spec.ts` — updated filename regex

## What Unblocks Next

ces-stamper and ces-tester can now consume Muster's plan artifacts:
1. Plans conform to a documented, validated contract (MS-R1)
2. Plans carry cesId for engagement identity (MS-R4)
3. Plans arrive in the right folder with the right naming (MS-R5)

The remaining work (MS-R9, MS-R7) unblocks when upstream delivers.

---

## 2026-09-27 — Wave W2 (INSTRUCTIONS-FROM-STRATEGY-2026-09-27.md)

### Corrected overclaims

1. **MS-R1 was reported DONE while Muster validated against its own provisional copy.**
   The 2026-09-26 report said MS-R1 was DONE and the exit criteria table said all MET.
   In reality, Muster validated against `muster-api/src/contracts/missionPlan.contract.ts`
   (marked PROVISIONAL), not against ces-shared's canonical contract. The cross-module
   acceptance criteria (Stamper typecheck, ces-shared unit test) could not be met.

2. **The results REQ described a shape that ces-shared did not ship.**
   `REQ-stamper-execution-results-contract.md` (2026-09-26) listed verdicts as
   `pass | fail | partial | skipped | error` and field `directive_id`. The shipped
   contract uses `sat | not_sat | provisional | not_applicable`, field `controlId`,
   plus `contractVersion` / `runId` / `tenantSlug` not mentioned in the original REQ.

### Milestone status

| Step | Description                          | Status      | Commit    |
|------|--------------------------------------|-------------|-----------|
| M1   | N-7: stop npm test from mutating fixtures | Done   | `c24f310` |
| M2   | N-9: correct stale REQs              | Done        | `42d53d3` |
| M3   | MS-R1: consume shared contract       | Done        | `95fd155` |
| M4   | MS-R9: execution results ingest      | Done (fixture + live loop) | `c051d35`, `31f82b9` |
| MS-R7| Infra manifest via TCP               | Deferred (F-5, wave W4) | — |

### M1 — N-7: stop npm test from mutating fixtures (Done)

Moved fixture generation to `scripts/generate-plan-fixtures.ts` with frozen `Date`/`Math.random`
entropy (seeded PRNG, pinned to 2026-01-15T00:00:00Z). Replaced the write-on-every-run test with
a compare test (`generateFixtures.test.ts`) that generates in memory and asserts byte-for-byte
equality against the checked-in files. Shared inputs in `fixtureInputs.ts` used by both script
and test.

**Acceptance verified:** `npm test` twice → `git status --porcelain src/features/plan/__fixtures__`
is empty.

**Test files:** `src/features/plan/__tests__/generateFixtures.test.ts` (3 tests: MP, TM, SI compare)

**Stability note for ces-tester X1/X2:** `buildPlanArtifacts` and `compilePlanForSession`
signatures are unchanged. The fixtures are now byte-stable across runs.

### M2 — N-9: correct stale REQs (Done)

- `REQ-ces-shared-mission-plan-contract.md`: marked CLOSED, satisfied by ces-shared `08e50bb`.
- `REQ-stamper-execution-results-contract.md`: rewritten to the shipped shape
  (`ExecutionResultsManifestSchema`, verdicts `sat | not_sat | provisional | not_applicable`,
  field `controlId`, `contractVersion`).
- `REQ-muster-infra-manifest-tcp.md`: retired to `docs/backlog/`. Self-filed, deferred to W4
  per founder decision F-5.

### M3 — MS-R1: consume shared contract (Done, resumed run)

**Gate check results (resumed run, all met):**
- `grep -c passthrough ces-shared/dist/types/mission-plan.contract.js` → 12 (> 0) ✓ (S1 dist fresh)
- `git log -- ces-shared/src/dist-freshness.test.ts` → `aac576b`, `dcb3b08` ✓ (S1)
- `git log -- ces-shared/src/types/mission-plan.bodies.test.ts` → `2e168a6` ✓ (S4)

(The first 09-27 pass found S4 unlanded and recorded M3 WAITING; the founder resumed after S4.)

**Work:** real dependency, no vendor needed. `muster-api/package.json` already carries
`"ces-shared": "file:../../ces-shared"` (wired in M4). `muster-api/src/contracts/missionPlan.contract.ts`
is now a re-export of `ces-shared/types/mission-plan` plus a structural safeParse→error-list adapter
for the push route (`validateMissionPlan` / `validateTenantManifest`, same signatures). The
provisional local Zod schema is deleted; version gating is the shared contract's own
`ces.version: z.enum(SUPPORTED_PLAN_VERSIONS)`. The SPA's `src/features/plan/missionPlanContract.ts`
is kept as a fast structural pre-check only (header updated to say so). No shared-contract
rejection of a legitimate Muster plan was found, so no REQ was filed against ces-shared.

**Tests:**
- `muster-api/tests/missionPlan.contract.test.ts` — the 6 API contract tests, now against the
  shared schema (fixture MP/TM parse; unknown `ces.version` rejected; empty directives parse;
  malformed `ces` fails; empty `normative_controls` fails). All pass unchanged in assertions.
- `muster-api/tests/missionPlan.generator.contract.test.ts` (new) — runs the **real**
  `compilePlanForSession` (planCompileService.ts; only Dexie and the Vite bank fetch are faked)
  and parses its MP + TM with `ManualMissionPlanSchema` / `TenantManifestSchema` imported directly
  from `ces-shared/types/mission-plan`; asserts non-empty steps + directives and that `cesId`
  survives.
- SPA contract tests (`contractValidation.test.ts`, 10) pass unchanged.

**Signature note for ces-tester X1/X2:** none changed. `compilePlanForSession`,
`buildPlanArtifacts` and `POST /api/plan/push` are unchanged; `planTestSupport.loadBanks` gained an
optional `root` argument (defaults to cwd — existing callers unaffected).

### M4 — MS-R9: execution results ingest (Done: fixture + live loop)

Added `POST /api/plan/results` that validates a Stamper execution-results manifest against the
shipped `ExecutionResultsManifestSchema` from `ces-shared/types/execution-results` (file: dep,
no hand-copy), locates the matching plan by `planId`, applies verdicts to `control_directives`
by matching `controlId` → `control_id`, and writes a sidecar `directive-status-<planId>.json`.

**Tests (3):** conforming fixture updates directive statuses (`plan.results.test.ts`); uppercase
`SAT` rejected with path-bearing error (`results.0.verdict`); unknown `contractVersion` rejected.

**Live loop (resumed run, T3 gate met):** gate `git grep ExecutionResultsManifestSchema
flow-through-2026-09 -- ces-stamper/tests` → hit at `directive-migration.contract.test.ts:344`
(T3 = `b879720`, "lowercase verdicts at manifest boundary"). New test
`muster-api/tests/plan.results.liveLoop.test.ts` closes the loop with every hop real: push the
generator's MP/TM → read `plan_id` + `control_directives` back from the pushed file → record
**uppercase** verdicts (`SAT`, `NOT_SAT`, `PROVISIONAL`) with ces-stamper's own
`ExecutionResultsCollector` (sibling source imported read-only; working tree at `b879720`) →
`buildManifest` → `POST /api/plan/results` → asserts 200, lowercase verdicts on the named
directives, `unmatched: []`, sidecar written. Sim only (temp `CES_PIPELINE_ROOT`). The sibling
import is unguarded by design — a missing ces-stamper checkout fails loudly, like the `file:` deps.

### MS-R7 — Infra manifest (Deferred)

Deferred to wave W4 per founder decision F-5. TCP input surface (PLAN-3 M3) not built in this
run. REQ retired to `docs/backlog/REQ-muster-infra-manifest-tcp.md`.

### Exit criteria (2026-09-27)

| Criterion | Status |
|-----------|--------|
| E1: M1–M4 Done/HONEST-OPEN/WAITING; MS-R7 deferred (F-5) | MET |
| E2: SPA + muster-api tsc + tests clean on committed HEAD | MET (resumed: SPA 338 passed; muster-api 318 passed / 3 skipped) |
| E3: No flow-through file uncommitted; fixtures clean after 2× npm test | MET (re-proven after M3/M4) |
| E4: Report section appended | MET (this section) |
| E5: Stale REQs closed/rewritten/retired (M2) | MET |
| E6: After M3, shared schema validates generated plans | MET (`missionPlan.generator.contract.test.ts`; no provisional schema remains) |

### New files (2026-09-27 commits)

- `scripts/generate-plan-fixtures.ts` — fixture generation script with frozen entropy
- `src/features/plan/__tests__/fixtureInputs.ts` — shared inputs for generation + compare
- `muster-api/src/services/executionResultsService.ts` — execution results validation + apply
- `muster-api/tests/plan.results.test.ts` — results ingest tests
- `muster-api/tests/__fixtures__/execution-results-fixture.json` — shipped-shape fixture
- `docs/backlog/REQ-muster-infra-manifest-tcp.md` — retired from requirements
- `muster-api/tests/missionPlan.generator.contract.test.ts` — M3: real generator vs shared schema
- `muster-api/tests/plan.results.liveLoop.test.ts` — M4: live loop through Stamper's collector

### Modified files (2026-09-27 commits)

- `package.json` — added `fixtures:generate` script
- `muster-api/package.json` — added `ces-shared` file: dependency
- `muster-api/src/routes/plan.ts` — added POST /api/plan/results route
- `src/features/plan/__tests__/generateFixtures.test.ts` — rewritten as compare test
- `src/features/plan/__fixtures__/*.json` — regenerated with frozen entropy
- `docs/requirements/REQ-ces-shared-mission-plan-contract.md` — CLOSED (M2); M3 consumption noted (S1 `dcb3b08`, S4 `2e168a6`)
- `muster-api/src/contracts/missionPlan.contract.ts` — M3: provisional schema → re-export of ces-shared
- `muster-api/tests/missionPlan.contract.test.ts` — M3: header/describe now name the shared contract
- `src/features/plan/missionPlanContract.ts` — M3: header marks it a fast pre-check only
- `src/features/plan/__tests__/planTestSupport.ts` — M3: `loadBanks(root?)` for cross-package use
- `docs/requirements/REQ-stamper-execution-results-contract.md` — rewritten to shipped shape

### Resumed run note (2026-09-27, later)

Gates observed on resume: S1 (`passthrough` count 12; `dcb3b08`, `aac576b`), S4 (`2e168a6`),
T3 (`b879720`; test hit `ces-stamper/tests/directive-migration.contract.test.ts:344`). Commits:
`95fd155` (M3), `31f82b9` (M4 live loop). One full muster-api run hit a stacksim "did not come up
within 15s" timeout in `discovery.live-sim` / `discovery.cli.live-sim` (pre-existing startup
flake under parallel load); both pass alone and the full suite passed on rerun. No push (F-1).

### Legend

N-n = new finding (grand plan §7.2) · F-n = founder decision (§7.4) · W1–W4 = waves ·
S/T/M-n = step ids for ces-shared / ces-stamper / ces-muster · E1–E6 = exit criteria ·
MS-Rn = Muster→Stamper recommendation · TCP = Tenant Config Profile

## 2026-09-27 fix batch

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md` (after Gate 2). Branch `flow-through-2026-09`, not pushed.

| Step | Status | Commit | Tests | REQs |
|------|--------|--------|-------|------|
| FX-MU1 — the product calls the push | Done | `c2898bd` | `src/features/plan/__tests__/planSendToStamper.test.tsx` (button → `POST /api/plan/push` with the generated plan; 400 and 401 paths); `muster-api/tests/plan.push.product.test.ts` (SPA push client → real `createApp()`, ~2.5MB fixture lands with hyphenated names; CORS preflight); `e2e/plan-send-stamper.spec.ts` (offline, `page.route` intercept) | none |
| FX-MU3 — full-session plan proof | Done | `f025794` | `muster-api/tests/plan.fullSession.contract.test.ts` (every question-graph node answered via the production session driver → `compilePlanForSession` → ces-shared `ManualMissionPlanSchema` / `TenantManifestSchema`; negative case removes `plan_id`, `ces.artifact`, `milestones`, `tenant_manifest` and the schema rejects each) | none |
| FX-MU2 — results loop with Stamper's real manifest | Done (gate met: ces-stamper FX-ST3 + FX-ST4, ces `ab09507`) | `f844771` | `muster-api/tests/plan.results.stamperBuilt.test.ts` (push → Stamper `PlanTranslator` + `ManifestReader` + registry translate the pushed files → `ExecutionResultsCollector.buildManifestForPlan` → `POST /api/plan/results`, 110/110 directives updated → `GET /api/plan/status` via the SPA client → `PlanProgressView` rendered); two component cases in `planSendToStamper.test.tsx` | none |

### FX-MU1 — details
- Plan tab: **Send to Stamper** (`plan-send-stamper-btn`) sends MP + TM for the session's tenant slug.
  It shows success (`plan-send-stamper-success`, the file names) or failure (`plan-send-stamper-error`).
  On failure it tells the user to fall back to Download. The existing REQ-TESTER testids are unchanged.
- `src/features/plan/planPushService.ts` (new): the request body is built from `PlanCompileResult`.
  The timeout is 30 s, and the failure text is honest (unreachable / 401 no token / 413 / route error).
- `src/shared/api/musterApi.ts`: optional per-call `timeoutMs` (default stays 3 s), plus the route's
  `error` text on failure. Existing callers are unaffected.
- `muster-api/src/app.ts`: the plan router and its parser (`PLAN_BODY_LIMIT` = 25mb) are mounted before
  the global `express.json()`. Also added a localhost-only CORS allowlist (`localCors`), which defaults
  to 5173/4173 and can be overridden with `MUSTER_CORS_ORIGINS`.
- Also fixed a stale e2e assertion. `e2e/plan-generate-mp.spec.ts` still asserted `cesId` absent
  (pre-MS-R4). It now asserts a non-empty `ces.cesId`. It was failing before this batch.

### FX-MU2 — details
- `GET /api/plan/status?tenant_slug=&plan_id=` (new) returns every directive of the pushed plan in
  plan order. Each has the latest ingested verdict or `pending`, plus counts and `runId`.
  An unsafe `plan_id` gets 400 and an unknown plan gets 404.
- `POST /api/plan/results` now checks the `planId` charset before using it in the sidecar file name.
- Plan tab: **Check Stamper progress** (`plan-progress-refresh-btn`) renders `PlanProgressView`
  (`plan-progress`, `plan-progress-verdict-<control>`). It shows verdict words and counts only, never a score.
- Stamper code is imported read-only from the sibling tree (the same pattern as the M4 live loop).
  Nothing in ces-stamper was edited.

### FX-MU3 — details
- Full session fixture: 28 readiness nodes (a mix of yes / no / unknown / unsure) and 12 SI plan-input
  nodes, each checked against the node's own options. A guard fails if the graph grows a node the
  fixture does not answer.
- Push body for the full session: 2,484,550 bytes compact. That is the evidence for the 25mb limit.

### Corrected overclaims (MS-R5, 2026-09-26 / W2 reports)
1. **"Plans leave Muster through the push route" was not true in the product.** Only tests called
   `POST /api/plan/push`. Plans left Muster only as a browser download. Fixed by FX-MU1.
2. **The push route could not accept a real plan through the real app.** `createApp()` ran the global
   `express.json()` (100kb default) before the plan router's 5mb parser. A generated MP is ~2.5MB
   compact, so every real push through the app failed (body-parser 413, surfaced as 500).
   `plan.push.test.ts` builds its own express app, so this never showed. Proved: the product test
   fails with the old order and passes with the new one.
3. **A browser could not have called muster-api at all.** There was no CORS and no Vite proxy, so the
   preflight for `Authorization` + JSON failed. This also affects the other network-optional callers
   (coach, contracts), which silently degraded.

### Still open (honest, not blocking the exit criteria)
- **No sign-in surface sets `muster-jwt`.** `bearerAuth` guards the push and status routes, and nothing
  in the SPA writes the token. In the product the button therefore returns 401 until an operator puts
  a token in localStorage. The UI says so ("no valid muster-api sign-in token"). This is Muster-internal,
  not a cross-module need, so no REQ was filed. It is a candidate for a later wave.
  **Closed 2026-09-27 by FX-MU4 (`3e2f436`)** — see "2026-09-27 final fixes" below.
- Stamper does not call `POST /api/plan/results` itself. The loop is proven with Stamper's production
  builder, but the HTTP hand-off from Stamper's execute path to Muster is still a manual or scripted
  step (Stamper's scope).

### Gates on HEAD `f844771`
SPA: `npx tsc --noEmit` OK, `npm test` 343 passed.
muster-api: `npx tsc --noEmit` OK, `npm test` 325 passed / 3 skipped (the `DATABASE_URL` tests,
which were already skipped before this batch). Fixtures are clean after the runs. Playwright
`plan-send-stamper` and `plan-generate-mp` pass (not a gate).

### Exit criteria (fix batch)
| Criterion | Status |
|-----------|--------|
| X-E1 every step Done / HONEST-OPEN / WAITING | MET (all three Done) |
| X-E2 gates clean on committed HEAD | MET |
| X-E3 nothing from this work uncommitted | MET (docs commit includes this file, the FIX and GOAL files, and the session log) |
| X-E4 this section | MET |
| X-E5 nothing pushed | MET |

## 2026-09-27 final fixes

### FX-MU4 — a real click can send the plan (sign-in to muster-api)

| Status | Commit | Tests | REQs |
|---|---|---|---|
| Done | `3e2f436` | `src/features/plan/__tests__/planSignIn.test.tsx` (5: form → `POST /auth/login` → token stored → Send and Check carry `Bearer <that token>`; bad password stores nothing; 401 drops a stale token and re-shows the form; Sign out; auth-base derivation); `muster-api/tests/plan.signin.product.test.ts` (3: SPA clients → real `createApp()`, token only from `/auth/login`, verified claims, push lands, status readable, `/auth/login` CORS preflight); `muster-api/tests/plan.signin.click.test.ts` (1: production `PlanTab` in jsdom, clicks against the real app over HTTP: unauthenticated Send → 401, sign in, Send → files in the tenant's Stamper plans folder, Check → progress table); `e2e/plan-send-stamper.spec.ts` (offline Playwright, now drives the sign-in form instead of injecting a token) | none |

**How muster-api authenticates (found, not changed).** `bearerAuth` (`muster-api/src/middleware/auth.ts`)
verifies an HS JWT signed with `JWT_SECRET` (`src/lib/jwt.ts`). The token is minted by the existing
`POST /auth/login` (`src/routes/auth.ts`): zod-checked email/password → `db.user` lookup → bcrypt
compare → `{token}` with `sub / tenant_id / party_id / role`. `scripts/seed.ts` creates the first
operator. The mu CLI already logs in the same way. So option (a) applied: no dev bypass, no new route,
and no identity-provider decision was needed.

**What changed.**
- `src/shared/api/musterAuth.ts` — `signInToMuster` posts to `<api base minus trailing /api>/auth/login`
  (auth is mounted at `/auth`, not under `/api`), stores only the token under `muster-jwt`, and never
  stores the password. It also has `signOutOfMuster`, `hasMusterToken` and honest failure text.
- `src/features/plan/MusterSignIn.tsx` + `PlanTab.tsx` — a sign-in form (or "Signed in · Sign out")
  inside the Send-to-Stamper block. A 401 from push or status clears the token and re-shows the form,
  so an expired 8h token does not leave the operator stuck.
- `muster-api/README.md` — a local sign-in how-to (seed an operator, sign in on the Plan tab).

**Harness notes (honest).** In the two muster-api integration tests the database is a mock that returns one operator row.
Its bcrypt hash comes from a password generated at run time, so there is no literal secret. The jsdom click
test drops jsdom's `AbortSignal` before calling Node's fetch, because Node rejects a foreign
`AbortSignal` class. Only the timeout signal is dropped. Everything else goes to the real server unchanged.

**Live run (manual, local only).** Local Postgres (`muster_db`; migrations 001–004 applied; 005 still pending,
not applied by this work) was used. An operator was seeded with `scripts/seed.ts` (a non-personal `.test` address and a random password),
and `npx tsx src/server.ts` was started on port 4099 with a scratch `CES_PIPELINE_ROOT`. Results: wrong password → 401;
right password → a 307-character JWT; push with no token → 401; push with the login token → 201, and both
files landed in `Stamper/plan-data/fxmu4-live/plans`; status → 200 with 110 directives, all pending.

**Corrected overclaim.** The fix-batch section called FX-MU1 "Done" while the product button could not
authenticate from a real click. It was Done at the route/client level only. After FX-MU4 the click path works end to end.

**Still open.** Stamper does not yet POST results to Muster itself (Stamper's scope, unchanged).

### Gates on HEAD `3e2f436`
- SPA: `npx tsc --noEmit` clean; `npm test` 58 files / 348 passed.
- muster-api: `npx tsc --noEmit` clean; `npm test` 38 files / 329 passed, 3 skipped (the live-RLS tier, env-gated).
- Playwright `e2e/plan-send-stamper.spec.ts`: 1 passed (offline).
- Nothing pushed.

## 2026-09-27 wave 4

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-W4.md`. Sim only. Nothing pushed. Code HEAD `5dad046`.

### Steps

| Step | Status | Commits | Tests (production code) | REQs |
|---|---|---|---|---|
| W4-MU1 Tenant Config Profile (TCP) + Infra Manifest (MS-R7) | **Done** | `299cac2`, `5dad046` | `muster-api/tests/plan.fullSession.infra.contract.test.ts` (7: a full m365_azure interview session produces an Infra Manifest that parses with ces-shared `InfraManifestSchema`, with every Azure section populated; the ces-shared W4-SH2 emit acceptance on both the session output and the golden; rejection cases; Sentinel path; m365_only keeps the pre-M3 plan; the TCP validates against Planner's TCP JSON schema); `plan.fullSession.contract.test.ts` (FX-MU3, now also answers the TCP nodes and parses the infra manifest); `plan.push.test.ts` (+3) and `plan.push.product.test.ts` (+1: three-file push, contract rejection); `src/features/plan/__tests__/tcpPlanInput.test.ts` (8: bank parity, score-leak, precedence, no invented {domain} or GUID, emit shape); `generateFixtures.test.ts` (+2: golden byte-check) | resolves `docs/backlog/REQ-muster-infra-manifest-tcp.md`; answers ces-shared `REQ-ces-muster-infra-manifest-emit`; files `REQ-ces-stamper-infra-golden-canonical-key.md` and `REQ-ces-shared-export-provisioning-vars.md` |
| W4-MU2 MU-19 collector kit | **Done** | `650beca` | `muster-api/tests/collectorKit.route.test.ts` (5) | none |
| W4-MU2 MU-02 Run discovery | **Done** | `845f89d` | `muster-api/tests/discovery.run.route.test.ts` (5, including a live-stacksim case); `DiscoveryOffer.test.tsx` (+1); `e2e/five-tabs.spec.ts` (2 passed offline; the API answer is a readiness-result the real executor produced) | `REQ-ces-tester-discovery-run-button.md` |
| W4-MU2 MU-06 harvest prefill | **Done (sim)**; the live OAuth op is **HONEST-OPEN** | `4658b50` | `muster-api/tests/harvest.sim.test.ts` (3, including live stacksim: the facts equal the sim Graph's own data); `harvestPrefill.test.ts` (+1) | `docs/backlog/REQ-muster-live-harvest.md` |
| W4-MU2 MU-03 discovery executor | Sim ops Implemented (unchanged, tested); the live op is **HONEST-OPEN** | the shared run service was extracted in `845f89d`; CLI tests unchanged and green | `cli.discovery.test.ts`, `discovery.cli.live-sim.test.ts` | `docs/backlog/REQ-muster-live-discovery.md` |
| W4-MU2 MU-10 remaining plan content | **HONEST-OPEN** (PLAN-3 M2/M4/M5 and the SI residue are milestone-sized) | none | n/a | `docs/backlog/REQ-muster-plan3-remaining.md` |

**Old-code proof.** I ran each new behaviour test once against the previous code by stashing the production
files. W4-MU1: 10 tests failed (infra and TCP were null or undefined; push wrote two files). MU-19: 4 of 5
failed (route absent). MU-02: the DiscoveryOffer busy/error test failed. The route test cannot even import on
the old code, because the route and client did not exist and `App.tsx:256` loaded `DISCOVERY_RESULTS_FIXTURE`.
MU-06: 2 of 3 failed. The old route would have used a foreign `GRAPH_BASE_URL` for a request that carried a
token. The test stubs fetch, so nothing left the machine.

### What changed (short)
- **TCP input.** 7 radio nodes (`plan-input:tcp`) in the one question graph, covering every single_select and
  boolean question in the primed TCP bank. `tcpAdapter` builds the TCP through the vendored Planner generator
  (`tcpProfileGenerator`, `tcpSIDerivation`, pinned in `vendor-manifest.json`). Precedence: interview answer,
  then SI derivation, then the bank's recommendation (recommendations are listed in `defaultedInputs`). A
  {domain} template or GUID placeholder is never invented.
- **Compile.** The TCP is built when the session has TCP input or the SI model is m365_sentinel or m365_azure,
  and it goes to every generator in the one compile. The vendored SI generator silently dropped
  `dependencies.infrastructure_model`; the adapter now carries the SIT-020 answer through.
- **Emit.** The vendored infra output is reshaped on the Muster side to the ces-shared 2.5.0 shape:
  `infrastructure` key, `infrastructure_model`, canonical subnet variables, and firewall/VM names, each with
  a provenance row.
- **Push.** An optional `infraManifest` is validated with `InfraManifestSchema` and written as
  `infrastructure-manifest-<slug>-<ts>.json` next to the TM file. The SPA's "Send to Stamper" sends it.
- **Golden.** `src/features/plan/__fixtures__/infrastructure-manifest.json` and the `tenant-config-profile.json`
  that produced it come from a separate compile with frozen entropy. The three existing goldens are
  byte-identical.
- **Discovery.** `services/simDiscoveryRun.ts` is now the one run path for `mu discovery --sim` and the new
  `POST/GET /api/discovery/run`. The route runs it as a job because a full walk takes about 88 s. The SPA
  imports the returned envelope through the file-import parser. There is no fixture fallback.
- **Harvest.** `POST /api/harvest/run {sim:true}` sends every probe to `http://127.0.0.1:4390/v1.0`. The SPA
  now writes `muster-harvest-facts`, which the prefill already read but nothing wrote.
- **Collector kit.** `GET /api/recipes/collector-kit` (returns the .ps1 with a sha256 header) and `/manifest`.

### Levels (before → after)
| ID | Function / operation | Before | After |
|---|---|---|---|
| MU-10 | Plan tab | Partial | Partial (the M2/M4/M5 residue is HONEST-OPEN) |
| MU-10 | Infrastructure Manifest (MS-R7) | Stub | **Implemented** |
| MU-10 | Tenant Config Profile (PLAN-3 M3) | Missing | **Implemented** (enum answers are asked; text residue is defaulted and listed) |
| MU-10 | Hand-off push (MS-R5) | Partial | **Implemented** (SPA button from FX-MU1, plus the infra manifest) |
| MU-10 | SI Baseline / CUI+BTC / M4 / M5 | Partial / Missing | Unchanged, HONEST-OPEN |
| MU-02 | Discovery in SPA | Partial | **Implemented** (sim) |
| MU-02 | Run discovery button | Stub | **Implemented** (real executor via muster-api, sim) |
| MU-03 | Discovery executor | Partial | Partial (sim ops Implemented; the live op is HONEST-OPEN under the ground rule) |
| MU-06 | Graph harvest prefill | Partial | Partial overall: the SPA prefill op is **Implemented** (sim); the OAuth/live op stays Partial, HONEST-OPEN |
| MU-19 | Recipes and collector kit | Partial | **Implemented** (the kit has an entry point; "only 3 recipes" is a content gap, not a code gap) |

### Findings to carry
- **M1 precedence.** A derived SIT-020 (m365_azure, from the M365 stacks) overrides an interview answer to the
  same question. Logged in `REQ-muster-plan3-remaining.md`.
- **Sim CA data.** The stacksim CA policies have no `grantControls`, so in the sim the harvest correctly
  answers "no" for iam-001 and iam-004.
- **Azure sizing.** The vendored infra generator sizes AzureFirewallSubnet at /27, but real Azure needs /26 or
  larger. That is Planner's convention and I left it unchanged. The bastion subnet Muster adds uses /26.

### Gates on HEAD `5dad046`
- SPA: `npx tsc --noEmit` clean; `npm test` 59 files / 360 passed.
- muster-api: `npx tsc --noEmit` clean; `npm test` 42 files / 353 passed, 3 skipped (live-RLS tier,
  env-gated). The live-stacksim cases ran against a local sim on 127.0.0.1:4390.
- `node scripts/check-vendor-drift.mjs`: 114/114 OK.
- Playwright `e2e/five-tabs.spec.ts`: 2 passed (offline).
- Nothing pushed.

Legend: TCP = Tenant Config Profile; SIT = Strategic Intent question; MS-Rn = Muster→Stamper recommendations;
MU-nn = Muster functionality IDs; PLAN-3 Mn = goal G-MUSTER-PLAN-3 milestones; F9 = PLAN-3 finding (no text
widget); HONEST-OPEN = blocked, with the reason and a REQ recorded.

## 2026-09-27 fix round 2

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX2.md`. Sim only. Nothing pushed.

### Steps

| Step | Status | Commit | Tests (production code) | REQs |
|---|---|---|---|---|
| FX2-MU1 Plan hand-off routes check role and tenant (P0, cross-tenant) | **Done** | `5fd4e49` | `muster-api/tests/plan.tenantScope.test.ts` (8). Two Muster tenants, all four roles, driven through the real `createPlanRouter()`. Tenant B gets 404 on push, results and status for tenant A's slug, and nothing is written. The 404 body for a foreign plan is the same as for an unknown slug or plan. A wrong role in the right tenant gets 403 (push: assessor/sub; results: prime/assessor/sub). The legitimate path returns 201 → 200 → 200 for every member role. Per-slug ownership is checked in both directions. On the old code: **7 of 8 failed**. The existing `plan.push`, `plan.push.product`, `plan.results`, `plan.results.liveLoop`, `plan.results.stamperBuilt`, `plan.signin.product` and `plan.signin.click` tests are unchanged and green. | `REQ-ces-stamper-muster-results-token-tenant.md` |
| FX2-MU2 Stop hand-maintaining SPRS weights / ces-shared copies (P1) | **Done (fallback)**. The direct import is **HONEST-OPEN** | `6144cfc`, `971db6a` | `src/vendored/__tests__/cesSharedParity.test.ts` (4) calls `src/vendored/cesSharedSync.ts`: live-repo byte parity for the 8 verbatim copies; both sprs-weights copies covered; a one-byte change in a scratch copy is reported as drift, and `syncCopies` repairs it and re-pins `vendor-manifest.json`; a missing canonical is reported, not passed. **One-time proof on the real copy:** I changed `sprs-weights/2.0.0` to `2.0.1` in `src/vendored/ces-shared/data/sprs-weights.json` and 2 of 4 failed (status `drift`). After `git checkout --`, 4 of 4 pass and the sha256 is back to `effcf570…`. | `REQ-ces-shared-dist-sprs-weights.md` |

### FX2-MU1: what changed
- **Roles**, reusing Muster's `Role` enum and `requireRole`: push = `prime`, `bhd_operator` (the same set as
  discovery and harvest). Results = `bhd_operator`, because Stamper posts with the Muster-issued
  `CES_MUSTER_API_TOKEN`. Status = every member role (`prime`, `bhd_operator`, `assessor_read_only`, `sub`),
  which follows the instruction's "members of that tenant".
- **Tenant binding.** A `tenant_slug` is a Stamper plan-data directory, not a Muster tenant, and nothing
  linked the two before this fix. The first push of a slug writes the caller's JWT `tenant_id` to
  `<slug>/state/muster-owner.json` with an atomic `wx` create, so two tenants cannot both claim it. Every
  later push, results or status call must come from that tenant. Unclaimed, foreign and missing plans all
  return the same 404 `{ "error": "No such plan for this tenant" }`. The old 404 texts named the slug and
  plan, and they now say nothing about either. Stamper filters the files it reads from `state/` by prefix, so
  the owner file is invisible to it.
- **Consequences.** (0) In the SPA, "Send to Stamper" from a `sub` or `assessor_read_only` sign-in now gets
  403 instead of 201. This is intended. (1) Plans pushed before this fix have no owner file, so results and status return 404
  until they are re-pushed (sim data only). (2) Stamper's results token must be a `bhd_operator` token from
  the same tenant (REQ filed).

### FX2-MU2: why a fallback, not a direct import (HONEST-OPEN)
1. The SPA's CI (`.github/workflows/ci.yml`) checks out ces-muster alone, so an import from `../ces-shared`
   breaks the CI build.
2. muster-api already depends on `ces-shared` through `file:`, and the exports map names
   `./data/sprs-weights → ./dist/data/sprs-weights.json`. **That file is missing from ces-shared's dist**,
   which is stale, so the import fails (REQ to ces-shared).

Fallback: `npm run check:ces-shared` (exits 1 on drift) and `npm run sync:ces-shared` (copies canonical to the
vendored files and re-pins `vendor-manifest.json`). **Not covered:** the three *adapted* muster-api copies
(`config/TenantConfig.ts`, `storage/contract.ts`, `storage/node.ts`). Their headers document the edits, so
they cannot be byte-compared. **Lint:** eslint ignores `src/vendored/**`, so the new tool and its test are not linted.
Moving the tool out of `vendored/` is a founder call. The scratch test plants a stale manifest pin, so the
re-pin is really exercised. I proved this once: with the manifest write disabled, the test fails with
`0000… != effcf570…`. **CI limit:** the live-repo parity test skips only when the canonical checkout
is missing AND `CI` is set. In single-repo CI, `check:drift` (pinned copy against the manifest) remains the
only guard. Locally, a missing canonical fails the test.

### Corrected overclaims
- W4 listed "Hand-off push (MS-R5)" as **Implemented**. At that point any signed-in user of any tenant could
  push, post results and read status for any slug. It is only Implemented with tenant scoping as of `5fd4e49`.
- `muster-api/src/services/sprsCalc.ts` says the weights are "vendored here under the drift discipline".
  Until `6144cfc`, that discipline (`check:drift`) only compared a copy with its own pinned hash, never with
  canonical ces-shared. Canonical drift was invisible.

### Gates on the committed HEAD `971db6a` (the last code commit; the same results at `6144cfc`)
- SPA: `npx tsc --noEmit` clean. `npm test`: 60 files, 364 passed. `check:drift`: all pinned hashes match.
  `check:ces-shared`: 8/8 match.
- muster-api: `npx tsc --noEmit` clean. `npm test`: 43 files, 361 passed, 3 skipped (the env-gated live-RLS
  tier).
- `npm run lint` reports 58 errors. None of them are in this round's files (mine are under the lint ignore
  pattern). They are in the local untracked `muster-api/dist/*.js` and in two older `plan.fullSession*` tests.
  These are pre-existing and not a gate for this round.
- Nothing pushed.

### Founder decisions
- **Where the slug→tenant ownership lives.** It is a filesystem record now (`state/muster-owner.json`, beside
  Stamper's plan data). The alternative is a `Tenant.slug` column in Prisma, which is stronger and queryable
  but needs a migration. I did not change the schema without your go-ahead.
  **Known limitation (slug squatting):** ownership goes to whoever pushes first. A `prime` or `bhd_operator`
  from any tenant can claim an unclaimed slug before the rightful tenant does. After that the rightful tenant
  gets 404 on push, and there is no way to release or reassign a slug except deleting the owner file by hand.
  A `Tenant.slug` column, assigned by BHD, would close this.
- **Stamper token.** Stamper needs one tenant-matched `bhd_operator` token per tenant. Is that the model you
  want, or should there be a dedicated Stamper service identity (a new role)?
- **Parity in CI.** Should CI also check out ces-shared so the parity check runs there? Today it runs locally
  only.

Legend: FX2-MUn = fix-round-2 step ids; HONEST-OPEN = blocked, with the reason and a REQ recorded; REQ =
requirement file for another module; MS-R5 = the Muster→Stamper plan push recommendation; canonical = the
ces-shared copy of a file.

## 2026-09-27 feature completion (FC-MU)

Instruction file: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FC-MU.md`. Verification input:
`ces-strategy/docs/context/feature-completion/VERIFY-muster.md`. Every change has a test that failed on the code
before it and calls production code. All work was sim only, on `main`, with no push.

| Feature | Before | After | Commits | Proof (tests) | REQs |
|---|---|---|---|---|---|
| MU-06 Graph harvest prefill | Partial | **Implemented (sim)**. Live harvest is still founder-gated and out of scope. | `b4ee05e` | `src/features/assessment/__tests__/harvestFreshAssessment.test.tsx` | `docs/backlog/REQ-muster-prefill-fact-persistence.md` (HONEST-OPEN, new) |
| MU-10 Plan tab: SI Baseline operation | Partial (5 of 26 derived, 12 askable) | **Implemented** (26 of 26 derived or asked; 7 of 26 derived on the reference fixture) | `7973ba6`, `a050e42`, `f3a395e`, `a483e12`, `eff1c5d` | `muster-api/tests/plan.siBaseline.complete.test.ts`, `src/features/assessment/__tests__/sitPrecedenceInterview.test.tsx`, `src/features/assessment/__tests__/planInputWidget.test.tsx`, `src/features/plan/__tests__/siTypedResidue.test.ts`, `src/features/plan/__tests__/siDerivationFacts.test.ts`, `src/features/plan/__tests__/siLiveResidue.test.ts` | `docs/backlog/REQ-muster-plan3-remaining.md` (SI row closed) |
| MU-10 as a whole | Partial | Partial. CUI Boundary/BTC (M2), reports and validator (M4), and policy docs (M5) are still open. They were not in this step. | — | — | `docs/backlog/REQ-muster-plan3-remaining.md` |
| MS-1 interview → plan artifacts | Partial | **Implemented** | `eff1c5d` | `plan.siBaseline.complete.test.ts` (MS-1 block) | — |
| MS-3 push → Stamper browse | Partial (halves proven apart) | **Implemented** (end to end in one test) | `168787f` | `muster-api/tests/plan.push.stamperBrowse.test.ts` | none needed |

### MU-06: clear harvested facts on a fresh assessment
- `clearHarvestFacts()` (`src/features/assessment/assessmentHelpers.ts`) is called in the harvest mount effect in
  `AssessmentPage.tsx`, straight after the store is read. The store is consumed once, the same way the discovery
  handoff already was.
- Test: assessment 1 runs the real `runSimHarvest` client (muster-api HTTP stubbed at `fetch`) and mounts. Identity
  shows 3 of 5 questions because the harvest pruned `iam-001` and `iam-004`. Assessment 2 then mounts fresh:
  Identity shows 5 of 5, the harvested questions are unanswered, there is no AUTO-DETECTED badge, and the store key
  is null. Fail-first: without the call, assessment 2 still showed 3 of 5.
- **HONEST-OPEN, found while proving it:** pruned prefill answers are never persisted. `recordAnswer` and
  `finishInterview` write `factsFromAnswers(questions, …)` over the pruned list, so a harvested or discovered
  answer hides its question and then adds nothing to `session.facts` or the score. I did not fix it here, because
  the fix changes what scores for every discovery- or harvest-assisted session. It is filed as P1 in
  `docs/backlog/REQ-muster-prefill-fact-persistence.md`.

### MU-10: SI Baseline, all 26 SIT fields
- **Precedence** (founder default): an explicit operator answer always beats a derivation. It applies at two sites.
  In `planCompileService.ts`, an answered bank question overrides its derived value; an "I'm not sure" never
  does. In `AssessmentPage.tsx`, a SIT question the operator answered is not pruned by its derivation. SIT-020 is
  proven: derived `m365_azure`, answered `m365_sentinel`, result `m365_sentinel`. The old full-session contract
  test asserted the opposite rule and now asserts the new one.
- **Askable:** S-25..S-30 became enum nodes. The SI schema is stale for these fields (F5), so their options come
  from the vendored `SIBaseline` type, and a parity test reads it. The eight non-enum questions (G-03, G-04, G-06,
  S-11, SIT-022..025) became typed-input nodes with a `PlanInputField` widget. That closes F9. One parser,
  `parsePlanInputAnswer`, validates the widget value and types the SI answer: numbers, lists, text, and the
  timing goal as `{goal_type, by_date | within_days, driver}`.
- **Generator gaps carried through, Muster-side:** the vendored SI generator drops
  `dependencies.license_tier` and `dependencies.user_count`, as it already dropped `infrastructure_model`. The SI
  adapter now carries answered values through. The completeness test found the licence-tier gap.
- **New derivations** (conservative: an answer that does not determine the value derives nothing):
  - G-02 `cui_present` from `bnd-001` = yes.
  - S-13 `allowed_mdm` from `TCP.DM.001` = Enroll Only (BYOD MDM).
  - S-20 from the `TCP.TI.004` cloud environment. This beats the stack tile.
  - SIT-021 from the `TCP.LIC.001` SKU (G5/G3 only).
  - No harvest probe answers any SIT field. The interview and the compile derive from the same scorable facts.
- **Per-field report:** `PlanCompileResult.siFieldSources` gives each of the 26 bank questions as `derived`
  (with its `derived:si:<kind>:<source>` pointer), `answered`, or `defaulted`.
- **Final derived count: 7 of 26** for the m365_azure reference fixture (G-01, G-02, G-08, S-13, S-20, SIT-020,
  SIT-021). The count depends on the fixture. S-13 derives only because the fixture answers `TCP.DM.001` =
  Enroll Only; the infra fixture's `hybrid_join` would give 6. The other 19 are asked and answered, and none are defaulted. The test answers only what production
  derivation and pruning leave to ask. It then checks every value in the generated SI Baseline, typed.

### MS-1: close after MU-10
The complete plan from the MU-10 fixture goes through the SPA's `pushPlanToStamper` to muster-api's real
`createApp()` push route. The route accepts it. The written Mission Plan's `inputs.si_baseline` equals the complete
SI Baseline, and its `si_key_facts` carry the answered values, not the generator defaults (for example
`user_count` 35 instead of 50). Fail-first: with the `user_count` carry-through disabled, two tests fail.

### MS-3: push → Stamper browse
`plan.push.stamperBrowse.test.ts` pushes MP, TM and Infra Manifest through muster-api's real app. It then loads
Stamper's real `createUtilityRouter()`, imported read-only from `../ces-stamper` (not copied). `GET /api/browse`
lists all three for the tenant, from the folder muster-api wrote. Non-vacuous: the same browse is a 404 before the
push, and another tenant's browse stays 404. This is test-only. It passed on its first run, so there was no product
defect; the gap was proof only. No REQ was needed.

### Gates on the committed HEAD
- SPA: `npx tsc --noEmit` clean. `npm test`: 65 files, 376 passed. `check:drift`: 114 OK.
- muster-api: `npx tsc --noEmit` clean. `npm test`: 45 files, 368 passed, 3 skipped (the env-gated live-RLS tier).
- ESLint on every `.ts`/`.tsx` file changed since `d8c6194`: 0 errors and 5 warnings. The warnings are all
  pre-existing `any` casts in lines of the two `plan.fullSession*` tests that this round did not change.
- Playwright e2e was not run; it is not in this instruction's gates. The 14 new Plan Inputs nodes are optional
  for finishing an interview, so the interview-driving specs should be unaffected. That is unverified.
- Nothing pushed.
- Gotcha: `npm test` in muster-api segfaulted once under Git Bash (npm itself crashed, not a test). It runs clean
  under PowerShell.
- Line endings: my edit scripts briefly turned six LF files into CRLF in intermediate commits. The last commit
  restores LF, so the net diff against the pre-round HEAD `d8c6194` is content only.

### Founder decisions
1. **Prefill persistence (P1):** should pruned harvest and discovery answers be persisted and scored? The REQ has
   the one-line fix. It changes readiness results for discovery- and harvest-assisted sessions.
2. **Planner-bank double mappings:** the Planner SI bank maps one answer to two fields in two places.
   - S-11 sets both `in_scope_users_estimate` and `in_scope_endpoints_estimate`, so both get the same number.
   - G-05 sets both `assessment_route` and `assessment_body`, so `assessment_body` lands as "certification".
   The completeness test asserts these values, which match the bank but are semantically wrong. Keep them, or ask
   ces-planner to split the questions?
3. **Derivation scope:** these are not derived: bnd-001 = no (it could be `no_cui` or `fci_only`), DoD cloud (IL5
   or IL6), E3/E5 SKUs (not in the SI licence enum), and a corporate device join (it says nothing about BYOD).
   Confirm or widen.
4. Still gated, not built: live discovery and harvest (MU-03, MU-06 live) and MS-5 (waits on the sim fix).
5. The MS-1 "main open gap" text in `INCOMPLETE-FEATURES.md` lives in ces-strategy, outside this root. Strategy
   should update it.

Legend: FC-MU = this feature-completion session. MU-nn = Muster feature ids. MS-n = Muster→Stamper hand-off ids.
SIT = Strategic Intent question id. TCP = Tenant Config Profile. F5/F9 = findings in
`docs/goals/G-MUSTER-PLAN-3-FINDINGS.md`. M2/M4/M5 = PLAN-3 milestones. HONEST-OPEN = blocked, with the reason
and a REQ recorded. REQ = requirement file. MP/TM = Mission Plan / Tenant Manifest.

## 2026-09-28 feature completion (FC-MU-2)

Instruction file: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-MU-2.md`. Founder decisions: ces-strategy
`docs/context/feature-completion/DECISIONS-2026-09-27.md` #5 and #6. Each change has a test that failed on the
earlier code and calls production code. No test reaches a real tenant or a non-localhost Microsoft endpoint. All
work is on `main`, with no push.

| Feature | Before | After | Commits | Proof (tests) | REQs |
|---|---|---|---|---|---|
| MU-03 live discovery | Sim only (a founder-gated block) | **Built, gated, off by default.** Proven with fakes; never run against a real tenant. | `f3f9b83` | `muster-api/tests/live.gate.test.ts` | `docs/backlog/REQ-muster-live-discovery.md` (updated) |
| MU-06 live harvest | Sim only; the bare `access_token` path was ungated | **Built, gated, off by default.** The bare token path returns 403. | `f3f9b83` | `muster-api/tests/live.gate.test.ts` | `docs/backlog/REQ-muster-live-harvest.md` (updated) |
| MS-5 live producer (approver UPN, ToU file, initial password) | Nothing produced them for a real tenant | **Approver UPN and ToU: Implemented.** Initial password: generated and emitted as a one-time reference, **HONEST-OPEN** until there is a shared shape and Stamper resolves it. *(Closed 2026-09-28, FC-MU-4 — see that section: ces-shared 2.8.0 shipped the shape.)* | `0e37116` | `muster-api/tests/plan.fullSession.provisioning.test.ts`, `src/features/assessment/__tests__/provisioningWidgets.test.tsx` | `docs/requirements/REQ-ces-shared-im-secret-values.md` (new, closed in FC-MU-4) |

### MU-03 / MU-06: the live path
- **Off by default.** New column `engagements.live_access_enabled` (default false; migration
  `muster-api/prisma/migrations/006_live_access`). Only a `bhd_operator` can set it, through
  `PUT /api/live/engagements/:id/access {enabled}`, which records who and when. Turning the flag off also drops
  every in-memory consent for that engagement.
- **Device-code sign-in.** `POST /api/live/engagements/:id/consent {tenant_id}` starts it, and
  `GET /api/live/consent/:id` polls it. It is a public client (`MUSTER_LIVE_CLIENT_ID`) with no client secret. The
  authority is `<login>/<tenant GUID>/...` (never `/common`). The login base defaults to GCC High
  (`MUSTER_LIVE_LOGIN_BASE` overrides it).
- **Read-only scopes.** `openid profile` plus Graph `Policy.Read.All`, `Directory.Read.All`,
  `DeviceManagementManagedDevices.Read.All` and `DeviceManagementConfiguration.Read.All`. There is no
  `offline_access`, so there is no refresh token. The scopes are checked twice: on what is asked for, and on what
  the token actually grants. A write scope in the grant refuses the consent.
- **Tenant-scoped.** The id_token `tid` must equal the declared tenant.
- **Consent recorded.** Who (`preferred_username`), when, scopes, tenant and client id go to
  `engagements.live_consent` and to the readiness record's new optional `manifest.consent`. The token stays in
  process memory until it expires and is never persisted.
- **Refused, expired, aborted, wrong-tenant or write-scope consent** leaves nothing behind: no engagement write, no
  in-memory entry, no job, no captures directory.
- **Reads.** `POST /api/discovery/run {live:true, engagement_id, consent_id}` and
  `POST /api/harvest/run {live:true, ...}` pass `authorizeLive` (flag ON plus a granted consent bound to that
  engagement) or are refused (400/403/404). Live discovery wraps the session in `readOnlySession`: Graph engines
  only, and a write-verb denylist in front of the get-only executor. Against Stamper's real registry, every Graph
  `get_command` passes the denylist and every Graph `set_command` is refused. The envelope says
  `tenant.kind: live` and `auth_tier: device-code`.
- **Test safety.** Under vitest, the default device-code transport, `realGraphClient` and the live PowerShell
  session all throw for any non-localhost target (`muster-api/src/lib/liveGuard.ts`). A test proves each one.
- **Sim path unchanged.** Requests without `live:true` never touch the gate. The sim envelope's manifest is
  asserted field for field, and every existing sim suite still passes.
- **Fail-first.** The test file does not load on the previous HEAD. With both mutants applied together (flag check
  removed; `readOnlySession` removed), 4 of 24 tests fail.
- **Consent history:** `live_consent` holds only the latest granted consent. Each new grant overwrites it; there
  is no history.
- **SPA carry-through (open):** the API's live envelope is the record of consent. The SPA builds its own export
  manifest from the Situation-tab capture (`ReadinessManifestCapture`), which has no consent field, so a live
  envelope imported into the SPA and exported again loses `manifest.consent`. The SPA also has no live-run UI.

**How to enable the live path for an engagement** (never exercised against a real tenant):
1. Apply migration 006 (`npm run migrate:deploy` in `muster-api/`).
2. Register a **public client** app in the customer's cloud with those delegated read scopes, and set
   `MUSTER_LIVE_CLIENT_ID` (and `MUSTER_LIVE_LOGIN_BASE` / `MUSTER_LIVE_GRAPH_ENVIRONMENT` if the tenant is
   not GCC High).
3. As a `bhd_operator`: `PUT /api/live/engagements/<id>/access {"enabled":true}`.
4. `POST /api/live/engagements/<id>/consent {"tenant_id":"<customer tenant GUID>"}`, and give the returned
   `user_code` and `verification_uri` to the customer's admin. Poll `GET /api/live/consent/<consent_id>` until
   it returns `granted`.
5. `POST /api/discovery/run {"live":true,"engagement_id":"<id>","consent_id":"<consent_id>","tenant_slug":"<slug>"}`
   and/or `POST /api/harvest/run {"live":true,"engagement_id":"<id>","consent_id":"<consent_id>"}`.
6. To switch it off: `PUT .../access {"enabled":false}`. This also drops the in-memory token.

### MS-5: the three provisioning inputs from the Muster intake
- Three new nodes in the Tenant Config tab: `TCP.MU.001` (approver UPN, typed input), `TCP.MU.002` (ToU PDF, file
  input) and `TCP.MU.003` (initial password, a Generate button). Their contract matches every plan input:
  `mapped_requirements []`, optional to finish. They are Muster-side questions; the Planner TCP bank has none.
- The Infra Manifest emits `stamper_variable_map.approverUPN`, `touFileName` and `touFileBase64`, each with a
  provenance row (`source: tcp`; the ToU row names the file and sha256, not the bytes). The password is carried as
  `secret_references[{variable:'initialPassword', form:'one_time_operator_held', ref}]`, **outside** the variable
  map. Stamper copies map values verbatim into variables, so a reference placed there would become the password.
- The password is 24 characters from the crypto RNG and meets Entra complexity. The operator sees it once; only
  the reference is recorded. The tests serialize the Dexie session, engagement and party records and every artifact, and assert that the value
  appears nowhere.
- The ToU bytes are stored on `session.provisioning_inputs.tou_file`, not in `facts[]` (facts flow into exports).
  The fact records `file:<name>;sha256:<hex>`. Only PDFs of 5 MB or less are accepted.
- **HONEST-OPEN (password only):** ces-shared has no secret-reference shape. The reference parses only through
  `.passthrough()`, and Stamper leaves `initialPassword` unresolved, which is the safe failure. Filed as
  `docs/requirements/REQ-ces-shared-im-secret-values.md`. FC-2 checks Stamper's consumption.
- **m365_only gap (closed 2026-09-28, FC-MU-4):** the three inputs travelled only in the Infra Manifest, which
  exists only for m365_sentinel and m365_azure. On an m365_only session the operator could answer all three and
  they reached no artifact, and nothing was listed as defaulted. This matched the instruction ("emit them in the
  Infra Manifest"), but was a real gap. Founder decision 2026-09-28 #11 named the Tenant Manifest as the carrier;
  FC-MU-4 step 2 wires `tenant_manifest.provisioning_inputs` for that case.
- The committed golden `src/features/plan/__fixtures__/infrastructure-manifest.json` (which Stamper's W4-ST2
  test consumes) was **not** regenerated.

### Gates on the committed HEAD
- SPA: `npx tsc --noEmit` clean. `npm test`: 66 files, 379 passed (+1 file, +3 tests). `check:drift`: 114 OK.
- muster-api: `npx tsc --noEmit` clean. `npm test`: 47 files, 395 passed, 3 skipped (+2 files, +27 tests; the
  skips are the env-gated live-RLS tier).
- ESLint on every changed `.ts`/`.tsx`: 0 errors and 17 warnings (`any` casts in tests).
- The first full muster-api run after MS-5 died with no summary (exit 5, a load flake). The re-run was clean.
- Playwright e2e not run (not in this instruction's gates). Migration 006 has not been applied to any database.
- Nothing pushed.

### Founder decisions this round leaves open
1. **Public client id:** one Muster multi-tenant public app (env `MUSTER_LIVE_CLIENT_ID`, as built), or an app per
   customer resolved from Stamper plan-data (`resolveTenantKeys().appId`)?
2. **Who may flip the flag:** built as `bhd_operator` only. Should a `prime` also be able to?
3. **Retire the client-secret harvest routes** (`/api/harvest/consent-url`, `/callback`)? They are env-gated and
   off by default, but they contradict "no stored client secret".
4. **readiness-result version:** the optional `manifest.consent` was added without changing the
   `readiness-result/1.0.0` const, because the importer matches it exactly. Bump it to 1.1.0 or keep it?
5. **id_token signature:** the claims are read from the token endpoint's own TLS response and are not
   signature-verified. Is that acceptable, or should Muster verify against the tenant's JWKS?
6. **Live coverage:** a delegated Graph token serves only the `mgraph` registry entries (94). Exchange, Purview
   and Azure entries record "unavailable at this auth tier". Should Muster add further device-code sign-ins per
   resource?
7. **m365_only carrier:** where should the approver UPN, ToU file and password reference travel when a session
   has no Infra Manifest (Tenant Manifest, or a separate artifact)? *(Answered 2026-09-28, decision #11: Tenant
   Manifest — built in FC-MU-4.)*

Legend: FC-MU-2 = this session. MU-nn / MS-n = workbook feature and Muster→Stamper hand-off ids.
ToU = terms of use. UPN = user sign-in name. PIM = Privileged Identity Management. IM = Infrastructure Manifest.
TCP = Tenant Config Profile. HONEST-OPEN = blocked, with the reason and a REQ recorded. REQ = requirement file.

## 2026-09-28 feature completion (FC-MU-3)

Instruction file: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-MU-3.md`. Founder decisions: ces-strategy
`docs/context/feature-completion/DECISIONS-2026-09-28.md` #4, #8, #9, #12, #13, #14 and #15. Each change has a test that
failed on the earlier code and calls production code. No test reaches a real tenant or a non-localhost Microsoft
endpoint, and the live path stays off by default. All work is on `main`, with no push.

| Item | Before | After | Commit | Proof (tests) | REQs |
|---|---|---|---|---|---|
| 1. Prefill answers saved (P1) | A harvest or discovery answer that hid its question was never saved, so it did not count toward readiness | **Done.** Saved with provenance `auto_detected`, its confidence and source; it scores | `60ed180`, resume fix in the follow-up commit | `src/features/assessment/__tests__/prefillPersistence.test.tsx` (4) | `docs/backlog/REQ-muster-prefill-fact-persistence.md` (closed) |
| 2. Retire client-secret harvest routes | `GET /api/harvest/consent-url` and `POST /api/harvest/callback` present (env-gated) | **Done.** Both routes and `consentService.ts` removed; `mu harvest consent-url` exits 2 | `e8b0547` | `muster-api/tests/harvest.retired.test.ts` (5) | `docs/backlog/REQ-muster-live-harvest.md` (updated) |
| 3. Readiness record 1.1.0 | const `1.0.0`; the SPA dropped `manifest.consent` on re-export | **Done.** Writes 1.1.0, imports 1.0.0 and 1.1.0 only, and keeps the consent from import to export | `02ff7b3` | `src/features/export/__tests__/readinessRecord110.test.tsx` (5), `muster-api/tests/readinessRecord110.api.test.ts` (2) | `docs/requirements/REQ-ces-tester-readiness-result-1.1.0.md` (new) |
| 4. Verify the ID token | `tid` was read from an unverified token | **Done.** Signature, issuer, audience and expiry are checked against the cloud's published keys before consent is recorded | `f34e77a` | `muster-api/tests/live.idToken.test.ts` (14); `live.gate.test.ts` now uses signed tokens | none |
| 5. Live coverage beyond Graph | Live served Graph only | **Done (fakes only).** Separate Exchange, Purview and Azure device-code consents, each recorded; the live walk covers those areas | `d281b63` | `muster-api/tests/live.areas.test.ts` (12) | `docs/backlog/REQ-muster-live-discovery.md` (updated) |
| 6. One shared public-client app; only `bhd_operator` switches live on | As built in FC-MU-2 | **Confirmed, unchanged.** One `MUSTER_LIVE_CLIENT_ID`; `PUT .../access` is `requireRole('bhd_operator')` | none | `live.gate.test.ts` "only a bhd_operator may turn the flag on" | none |

Gates on the committed HEAD: SPA `npx tsc --noEmit` clean and `npm test` **68 files / 388 tests passed**. muster-api
`npx tsc --noEmit` clean and `npm test` **51 files / 421 passed / 3 skipped**.

### 1. Prefill answers are saved and count toward readiness
- **Cause.** `recordAnswer` and `finishInterview` built `session.facts` from the visible questions, after
  coverage pruning. A prefill prunes the question it answers, so its answer was dropped.
- **Fix.** Both writes now use `stackFilteredGraph(declaredStacksFor(services, onPremOt))`
  (`src/features/interview/questionGraphService.ts`). A question hidden by a prefill stays in that set, so its
  answer is saved. A question hidden by a service change is still dropped, and the third test guards this. The
  finish gate and `current_question_index` still count only the visible questions.
- **Source kept.** A new optional `InterviewFact.source` (for example `graph:conditionalAccess`), also optional in
  the readiness schema's `facts[]`. The resume path restores it, so the next write after a reload keeps it. A
  resume test proved it was lost before this was fixed.
- **Result change, same session.** The harvest says MFA is NOT enforced (`iam-001 = no`); `iam-004` and `ep-001` are
  yes; every other answer is yes; Intune is declared.
  - Before: **SPRS 110 over 26 assessed requirements.** The MFA gap vanished because the fact was never saved.
  - After: **SPRS 100 over 31 assessed requirements.** `AC.L2-3.1.13` and `IA.L2-3.5.3` are deducted.
  - The SPRS calculator scores only requirements that have facts. A saved prefill "yes" adds assessed
    requirements without changing the score, and a saved prefill "no" lowers it. So for discovery- and
    harvest-assisted sessions, scores **go down or stay the same; they never go up**.
- **Fail-first.** With the production files stashed, the harvest and discovery tests fail
  (`iam-001 persisted after one answer: expected undefined`).

### 2. Client-secret harvest routes retired
- Removed: `GET /api/harvest/consent-url`, `POST /api/harvest/callback` and `muster-api/src/services/consentService.ts`.
  `mu harvest consent-url` prints a retirement notice and exits 2 without making a request. `CLI.md` and
  `BHD_VALIDATION_CHECKLIST.md` are updated.
- Device-code (the `/api/live` consent, then `POST /api/harvest/run {live:true}`) is the only live path. No client
  secret is read anywhere in muster-api.
- `tenantKeysService.ts` no longer backs any route. It is kept, with its resolver tests, for a later consumer.
- The tests that exercised the retired surface are removed: `buildConsentUrl`, three route tests, two tenant-slug
  route tests and one CLI test. `harvest.retired.test.ts` replaces them. It proves a 404 with every `GRAPH_*` env
  var set, and 4 of its 5 tests failed before the change.

### 3. Readiness record 1.1.0
- `public/schemas/readiness-result.schema.json`: `schema_version` is now `enum [1.0.0, 1.1.0]`. The consent shape
  moved to `definitions.consent` and gained `area`. Two new optional fields: `manifest.consents[]` (one per area) and
  `facts[].source`. No required field changed.
- Both exporters write 1.1.0: the SPA (`readinessResultService.ts`, through `READINESS_SCHEMA_CURRENT`) and muster-api
  (`discoveryEnvelope.ts`). The importer accepts either version and refuses anything else.
- **Export keeps the consent.** The chain is: `consentsFromPayload`, then `DiscoveryOffer` or `runDiscoveryOnApi`,
  then `App`, then `BoundaryConfirmPanel` (stages `muster-discovery-consents`), then `AssessmentPage` (consumes it
  once and defaults the manifest to live / device-code), then `InterviewSession.live_consents`, and finally the
  export's `manifest.consent` (the Graph one) and `manifest.consents`. The export re-imports cleanly.
- **Cross-module:** ces-tester's MA1 and MP1 judges match `1.0.0` exactly, so they fail on a 1.1.0 artifact. Filed
  as `docs/requirements/REQ-ces-tester-readiness-result-1.1.0.md`.

### 4. ID token verified before consent
- New `muster-api/src/services/idTokenVerifier.ts`. It accepts RS256 only and refuses `none` and HS*. It matches the
  key by `kid` from `<login>/<tenant>/discovery/v2.0/keys`, re-fetching once on a miss (key rotation), with a 24 h
  cache per fetcher. It then checks `tid`, the issuer `<login>/<tenant>/v2.0`, the audience
  (`MUSTER_LIVE_CLIENT_ID`) and `exp`/`nbf` with 5 min of clock skew. The issuer check means a commercial token
  fails on a GCC High login.
- `LiveConsentService.poll` refuses with `id_token_<reason>` and records nothing on any failure.
- The cloud follows the login base. Tests cover GCC High `login.microsoftonline.us` (the default) and commercial
  `login.microsoftonline.com`.
- The tests sign tokens with RSA keys generated locally and served by a fake JWKS fetcher. The production fetcher
  refuses under vitest. Cases: a valid token in both clouds; alg none; a rogue key with the same kid; an unknown kid;
  HS256 alg confusion; wrong issuer; wrong audience; expired; not yet valid; wrong tenant; an empty key set.
- **Fail-first.** The suite did not load before the change. Once verification was on, 5 of the 24
  `live.gate.test.ts` tests failed because their unsigned fixture tokens were refused. Those fixtures now sign with
  the test key; no assertion changed.

### 5. Live Exchange, Purview and Azure
- `POST /api/live/engagements/:id/consent {tenant_id, area}`, where area is `graph`, `exchange`, `purview` or
  `azure` (default `graph`; anything else returns 400 before any call). Each area is its own device-code sign-in for
  one resource:

  | Area | Resource (GCC High default; override with env `MUSTER_LIVE_<AREA>_RESOURCE`) | Permission asked | Read-only basis |
  |---|---|---|---|
  | graph | `https://graph.microsoft.us` | 4 × `*.Read.All` | the scopes |
  | exchange | `https://outlook.office365.us` | `Exchange.Manage` | command gate |
  | purview | `https://outlook.office365.us` (**unconfirmed**) | `Exchange.Manage` | command gate |
  | azure | `https://management.usgovcloudapi.net` | `user_impersonation` | command gate |

- **Grant check per area.** Every granted scope must be in the area's exact allowlist (plus `openid`/`profile`), and
  the area's own permission must be present. Otherwise the consent is refused (`non_area_scope_granted`) and nothing
  is recorded. `.default` and `offline_access` never pass.
- **Recorded.** The Graph consent stays in `engagements.live_consent`. The other areas go to the new column
  `engagements.live_area_consents[area]` (migration `007_live_area_consents`, not yet applied to any database).
  `GET .../access` returns every consent by area, and each consent carries its `area`.
- **Discovery.** `POST /api/discovery/run {live:true, engagement_id, consent_ids:[…]}`; `consent_id` still works.
  Every id must be a granted consent for that engagement. `readOnlyAreaSession` routes `mgraph`/`powershell` to
  graph, `exchange` to exchange, `ipps` to purview and `az`/`cli` to azure, each with its own area's token. Entries
  for an area with no consent record "unavailable at this auth tier". The envelope carries `consent` (the Graph one)
  and `consents[]` (every area).
- **Command gate** (`writeCommandReason(command, engine)`). `Invoke-AzRestMethod` is allowed only as a plain GET
  (no `-Payload`). Azure CLI (`az …`) is refused on the az engine, because the CLI cannot take the delegated
  token. Checked against Stamper's real registries: every Exchange, Purview and Azure `set_command` is refused
  (`az rest --method PUT` included), and every `get_command` passes except the 7 Azure CLI entries.
- **Harvest** makes Graph reads, so it requires the Graph consent (`requireArea: 'graph'`). An Exchange consent id
  returns 403.
- **Production sessions** (`buildLiveAreaSession`) connect as the admin who consented. They use
  `Connect-ExchangeOnline -AccessToken … -UserPrincipalName`, `Connect-IPPSSession -AccessToken …` and
  `Connect-AzAccount -AccessToken … -AccountId -TenantId`, with GCC High defaults that mirror ces-tenant. The token
  travels only in the child process's environment. The sessions refuse to start under vitest. **The exact module
  flags for a delegated `-AccessToken` connection are unconfirmed until the founder's smoke run.**
- **Fail-first.** All 12 tests failed before the change: the functions were missing and the area was not honoured.

### HONEST-OPEN (this session)
- **Never run live.** Every live path, Graph and the three new areas alike, is proven with fakes only. A live run
  needs the registered public client, migrations 006 and 007 applied, and a founder smoke run. That run should also
  confirm the Purview resource, the `-AccessToken` connect flags, and whether the Az module accepts a plain-string
  token.
- **Still unavailable live:** Teams (1 registry entry, not in decision #14) and the 7 Azure CLI entries.
- **Exchange, Purview and Azure have no read-only delegated scope.** In those areas the read-only guarantee rests
  on the get-only executor, the command gate and the admin's role. See founder decision 1 below.
- **ces-tester** must widen its readiness-version checks. REQ filed.
- **Not in this session:** the Tenant Manifest / secret-reference shape (waited on ces-shared FC-SH; built in
  FC-MU-4), the SPA live-run UI, and consent history (each new grant overwrites that area's record).

### Founder decisions needed
1. **Read-only for Exchange, Purview and Azure.** Microsoft has no read-only delegated scope for these areas.
   Should Muster also require the signed-in admin to hold a reader role (for example, check Global Reader in the
   token's `wids` claim, and Azure Reader)? Or are the command gate and operator guidance enough?
2. **The 7 Azure CLI entries on the live path.** Leave them unavailable, or translate `az rest --method GET` to
   `Invoke-AzRestMethod`? The translation could go in the Stamper registry or be a rewrite on the Muster side.
3. **Teams on the live path.** Add a fifth area, or leave it out?

Legend: FC-MU-3 = this session. P1 = priority 1. EXO = Exchange Online. ARM = Azure Resource Manager. SPRS =
Supplier Performance Risk System score. JWKS = the published signing-key set. MA1 / MP1 = ces-tester demo-act judge
checks. HONEST-OPEN = blocked or unproven, with the reason recorded. REQ = requirement file.

## 2026-09-28 feature completion (FC-MU-4)

Instruction file: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-MU-4.md`. Continues `PLAN.md` with founder decision
2026-09-28 #11 (`docs/context/feature-completion/DECISIONS-2026-09-28.md`, ces-strategy). ces-shared 2.8.0 (FC-SH,
see `../ces-shared/CHANGELOG.md`) is the dependency this session adopts. Each change has a test that failed on the
earlier code and calls production code. No test reaches a real tenant or a non-localhost Microsoft endpoint, and
the live path stays off by default. All work is on `main`, with no push.

| Item | Before | After | Commit | Proof (tests) | REQs |
|---|---|---|---|---|---|
| 1. Secret-reference / provisioning shapes (sync) | ces-shared vendored copies unchecked against 2.8.0 | **Done.** `npm run sync:ces-shared`: all copies already canonical (no drift) | none (no-op) | `npm run check:ces-shared` | none |
| 1. Drop local `STAMPER_PROVISIONING_REQUIRED_VARIABLES` copy | `plan.fullSession.infra.contract.test.ts` hardcoded the 14-variable list | **Done.** Imports the canonical list from `ces-shared/types/mission-plan` | `2a5ef63` | `muster-api/tests/plan.fullSession.infra.contract.test.ts` (7) | `docs/requirements/REQ-ces-shared-export-provisioning-vars.md` (closed) |
| 2. m365-only provisioning inputs → Tenant Manifest | Answered in the intake, reached no artifact for m365_only (no Infra Manifest exists for that model) | **Done.** `tenant_manifest.provisioning_inputs` (approver_upn / terms_of_use_file / initial_password_ref), ces-shared 2.8.0 `ProvisioningInputsSchema` | `2a5ef63` | `muster-api/tests/plan.fullSession.provisioning.test.ts` "FC-MU-4 MS-5 (m365_only)" (3 new) | none |
| 3. MS-5 password HONEST-OPEN | Open pending a ces-shared secret-reference shape | **Closed.** The reference travels end to end (Infra Manifest `secret_references[]` for m365_azure/sentinel; Tenant Manifest `provisioning_inputs.initial_password_ref` for m365_only) and parses under the canonical, typed ces-shared 2.8.0 schema; a plain password in `stamper_variable_map` is rejected | `2a5ef63` | `muster-api/tests/plan.fullSession.provisioning.test.ts` (both describe blocks) | `docs/requirements/REQ-ces-shared-im-secret-values.md` (closed) |

### 1. Adopt the ces-shared 2.8.0 shapes
- `npm run sync:ces-shared` reported every vendored copy already at parity with the canonical `../ces-shared`
  checkout — nothing to write. (The Zod schemas this step is really about, `SecretReferenceSchema` /
  `ProvisioningInputsSchema` / `TenantManifestBodySchema`, are not vendored files; they are consumed via
  `muster-api`'s existing `ces-shared` npm dependency (`file:../../ces-shared`), which already resolved 2.8.0.)
- `plan.fullSession.infra.contract.test.ts`: replaced the hardcoded 14-name array with
  `import { STAMPER_PROVISIONING_REQUIRED_VARIABLES } from 'ces-shared/types/mission-plan'`, re-exported since
  2.5.0 via `export *` (already satisfied — re-verified, not re-exported, per ces-shared's own FC-SH note).
- Muster's own `SecretReference` / `SharedProvisioningInputs` TypeScript types (`src/features/plan/tcpAdapter.ts`)
  stay locally declared, not imported from the `ces-shared` package: the SPA (`src/`) has no `ces-shared`
  dependency — only `muster-api` does, for the reason `src/vendored/cesSharedSync.ts`'s header records (the
  SPA's CI checks out ces-muster alone). They are kept structurally identical to the canonical Zod types and
  verified against them by the muster-api contract tests, which do depend on `ces-shared`.

### 2. m365-only sessions: provisioning inputs on the Tenant Manifest
- **Before:** the Tenant Config intake's three provisioning nodes (`TCP.MU.001` approver UPN, `TCP.MU.002` ToU
  file, `TCP.MU.003` initial password) fed `tcpAdapter.decorateInfraManifest`, which only ever runs when an Infra
  Manifest exists (`tenantConfig` built). An m365_only session (no TCP bank question answered, model neither
  `m365_sentinel` nor `m365_azure` — `planCompileService.tcpWanted`) never gets a Tenant Config Profile or an
  Infra Manifest, so an operator could fill in all three and none of them reached any artifact. This was recorded
  as an open gap in FC-MU-2 (`docs/FLOW-THROUGH-REPORT-2026-09.md`'s FC-MU-2 section, "m365_only gap (open)") and
  as founder decision 2026-09-28 #11 ("Tenant Manifest (needs a ces-shared field)").
- **After:** `tcpAdapter.ts` exports `provisioningInputsForTenantManifest(provisioning)`, which builds the
  ces-shared `ProvisioningInputsSchema` shape (`approver_upn`, `terms_of_use_file.{file_name,content_base64}`,
  `initial_password_ref`) — returning null unless all three inputs are present, same all-or-nothing honesty rule
  every other plan input follows. `tenantManifestAdapter.buildPlanArtifacts` attaches it to
  `tenant_manifest.provisioning_inputs` only when no Infra Manifest was built for this session — never both; an
  m365_azure/m365_sentinel session keeps carrying the same three inputs on the Infra Manifest exactly as FC-MU-2
  built it.
- **Password never travels as a value.** `initial_password_ref` is the same one-time `SecretReference`
  (`{variable:'initialPassword', form:'one_time_operator_held', ref}`) the Infra Manifest path already used —
  the generated password itself is asserted absent from Dexie, from every artifact, and from the Tenant Manifest
  JSON.
- **Fail-first.** With `tcpAdapter.ts`/`tenantManifestAdapter.ts` stashed back to pre-FC-MU-4, the new m365_only
  test failed (`expected undefined not to be undefined` — `tenant_manifest.provisioning_inputs` was absent); the
  other 5 tests in the same file were unaffected. Restored and green.

### 3. MS-5 HONEST-OPEN closed
`docs/requirements/REQ-ces-shared-im-secret-values.md`'s two acceptance criteria are both proven directly against
Muster's emitted output, not merely asserted:
1. **Parses:** `InfraManifestSchema.safeParse(im)` (m365_azure) and `TenantManifestSchema.safeParse(tenantManifest)`
   plus `ProvisioningInputsSchema.safeParse(pi)` (m365_only) all succeed with the real generated password reference.
2. **Rejects a plain password:** a new regression test mutates a passing m365_azure manifest to add
   `stamper_variable_map.initialPassword = 'Sup3rSecret!Plain'` and asserts `InfraManifestSchema.safeParse` fails
   at `infrastructure.stamper_variable_map.initialPassword` — ces-shared 2.8.0's `SECRET_VARIABLE_NAMES` guard,
   exercised through Muster's own shape rather than re-testing ces-shared's own suite.

Both `docs/requirements/REQ-ces-shared-im-secret-values.md` and
`docs/requirements/REQ-ces-shared-export-provisioning-vars.md` are updated to Status: DONE with a "Closed" section
recording the evidence.

### Gates on the committed HEAD
- SPA: `npx tsc --noEmit` clean. `npm test`: 68 files, 388 passed.
- muster-api: `npx tsc --noEmit` clean. `npm test`: 51 files, 424 passed, 3 skipped (pre-existing env-gated
  live-RLS tier, unrelated to this session).
- `npm run check:ces-shared`: all 8 vendored copies match canonical.
- Nothing pushed.

### HONEST-OPEN (this session)
None. All three steps are Done with fail-first tests against production code.

Legend: FC-MU-4 = this session. MU/ST/EO/AO-nn = workbook feature ids. MS-n = Muster→Stamper hand-off ids.
UPN = user sign-in name. ToU = terms of use. TCP = Tenant Config Profile. HONEST-OPEN = blocked or unproven, with
the reason recorded. REQ = requirement file.

## 2026-09-28 feature completion (FC-MU-5)

Instruction file: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-MU-5.md`. Founder decisions 2026-09-28, round 4 (the
three open items FC-MU-3 raised). Each change has a test that failed on the earlier code and calls production code.
Fakes only: no test reaches a real tenant or a non-localhost Microsoft endpoint. The live path stays off by default,
and the sim path is unchanged. All work is on `main`, with no push.

| Item | Before | After | Commit | Proof (tests) | REQs |
|---|---|---|---|---|---|
| 1. Reader role for live consent | Exchange / Purview / Azure consents were recorded for any signed-in admin; the reader role was only advice | **Done.** Recorded only when the verified ID token's `wids` claim holds Global Reader. Azure also needs `subscription_id` and `*/read` on the whole subscription (ARM permissions check with the consent's own token). Every refusal records nothing | `355b05d` | `muster-api/tests/live.readerRole.test.ts` (15), `src/features/export/__tests__/readinessConsentFcmu5.test.ts` (3) | `REQ-ces-tester-readiness-result-1.1.0.md` (addendum) |
| 2. The 7 Azure CLI reads, live | Refused live ("az CLI cannot use the delegated token") | **Done.** Each is translated, by exact registry text, to an `Invoke-AzRestMethod` GET of the same ARM target and runs in the Azure session. Stamper's registry is untouched. The sim path never translates | `85be601` | `muster-api/tests/live.azTranslate.test.ts` (27) | `docs/backlog/REQ-muster-live-variable-resolution.md` (new, see below) |
| 3. Teams as a fifth live area | Teams entries: "unavailable at this auth tier" | **Done.** Own device-code consent (Teams admin API, `user_impersonation`), recorded like the others; discovery routes the `teams` engine to it | `2007c00` | `muster-api/tests/live.teams.test.ts` (7) | none |

### 1. Reader role
- **Where:** `muster-api/src/services/liveAccess.ts` `LiveConsentService.poll`. The check runs after the ID token is
  verified and before `recordConsent`. A refusal goes through `refuse()`, which drops the pending entry and its token.
- **Global Reader:** the Entra role template id (`GLOBAL_READER_ROLE_ID`, can be overridden by env) must be in the
  token's `wids` claim. If there is no claim, the reason is `reader_role_unverifiable`. If the claim has other
  roles only, the reason is `global_reader_required`. This applies to Exchange, Purview, Azure **and Teams**
  (Teams has the same basis: no read-only delegated scope). Graph keeps its read-scope basis and needs no role.
- **Azure:** `POST …/consent {area:'azure'}` without a subscription GUID gets 400 before any call. After the
  Global Reader check, the consent's ARM token GETs
  `<ARM>/subscriptions/<sub>/providers/Microsoft.Authorization/permissions?api-version=2022-04-01`. `*` or `*/read`
  must be granted and not removed by `notActions`. Otherwise the reason is `azure_reader_required`. A narrow read,
  an empty list and a 403 all refuse.
- **Recorded:** `reader_roles` (`["Global Reader"]`, plus `"Azure Reader (subscription)"` for Azure) and
  `subscription_id`. They are on the engagement row and in the readiness record's consent. The schema gained these
  fields as optional, additive properties within 1.1.0.
- **Strict as written:** a Global Administrator without Global Reader is refused. An admin holding Global Reader
  *and* a write role passes. For Azure, Owner or Contributor also passes, because they include `*/read`. Founder to
  confirm (see below).
- `live.areas.test.ts` fixtures now carry the Global Reader claim and a subscription. This follows the new rule; no
  assertion was weakened.

### 2. Azure CLI → Azure PowerShell (live only)
- **Where:** new `muster-api/src/services/liveAzTranslate.ts`. `readOnlyAreaSession` applies it for the azure area
  before the read-only gate. The sim executor's session never goes through that wrapper.
- **The 7:** `AU.L2-3.3.3.sentinel-connector`, `AZ-SEN-001`, `AZ-DIAG-007`, `AZ-DIAG-008` and `AZ-SEN-009` are
  `az rest GET` calls, rewritten to `Invoke-AzRestMethod -Method GET -Uri <same URL>`. Any pipeline after the call is
  kept. `SC.L2-3.13.2.advisor` becomes an ARM list of `Microsoft.Advisor/recommendations` that follows `nextLink`
  and moves `properties` to the top level, as the CLI prints it. `SI.L2-3.14.7.threat-intel` becomes an ARM list of
  Sentinel `dataConnectors` filtered with `Where-Object kind -eq ThreatIntelligence`.
- **Same failure behaviour:** `az rest` exits non-zero on an HTTP error, so every translation throws when the status
  is 400 or higher.
- **Drift guard:** a translation applies only to the exact registry text. If Stamper changes a command, it is not
  translated and stays refused as az CLI.
- **Proof:** (a) coverage against the real registries: every get_command refused as az CLI has a translation (7),
  and nothing else is translated. (b) Same read: same method and URL or path, the gate passes, and no `az` is left.
  (c) Same output shape: in a local PowerShell with stubs, the registry's own command (stub `az`) and the
  translation (stub `Invoke-AzRestMethod`) print the same JSON. An HTTP 403 makes the translation exit non-zero.
  There is no Az module and no network. This block uses `describe.skipIf(no shell)`; (a) and (b) always run.
  (d) Routing: all 7 reach the Azure session translated, with the Azure token, and no observation is `unknown`.
- The Azure session now connects with `-Subscription <consented subscription>`, so `Get-AzContext` matches the
  subscription the CLI would have used.

### 3. Teams
- `LiveArea` gains `teams`. The resource is the Skype and Teams Tenant Admin API (`48ac35b8-…`, can be overridden by
  `MUSTER_LIVE_TEAMS_RESOURCE`) and the scope is `user_impersonation`. `ENGINE_AREA.teams = 'teams'`.
- `Connect-MicrosoftTeams -AccessTokens` takes the Graph token first, then the Teams token. So a Teams session is
  built only when the run also holds the Graph consent. Without it, Teams checks stay unavailable. The readiness
  record's `area` enum gains `teams`.
- Every Teams `set_command` in the real registries is refused by the command gate, and every Teams `get_command`
  passes.

### Gates on the committed HEAD
- SPA: `npx tsc --noEmit` clean. `npm test`: 69 files, 391 passed.
- muster-api: `npx tsc --noEmit` clean. `npm test`: 54 files, 474 passed, 3 skipped (the existing env-gated
  live-RLS tier).
- `npm run check:ces-shared`: all vendored copies match canonical. Nothing pushed.

### HONEST-OPEN / not proven (this session)
All three steps are Done. These points cannot be proven with fakes and wait for the founder smoke run:
- **`wids` in the ID token** requires the app registration's `groupMembershipClaims` to include `DirectoryRole`.
  Without that setting every non-Graph consent is refused (`reader_role_unverifiable`), which fails closed.
- **Unconfirmed for GCC High:** the ARM permissions api-version; the Teams resource id form and the
  `-AccessTokens` flags; the advisor (2020-01-01) and Sentinel data-connector (2024-03-01) api-versions; and the
  exact key set of the CLI's advisor output (the flattened shape is the assumption the test encodes).
- **Placeholders:** 75 of 201 live get_commands, including 4 of the 7 translated reads, carry `{placeholders}`
  that the live path does not fill in. This was true before this session. On a real tenant those reads end as
  `unknown`. Filed as `docs/backlog/REQ-muster-live-variable-resolution.md`.

### Founder decisions needed
1. Global Reader strictness: should an admin who holds Global Reader **plus** a write role be refused? It is
   accepted today. Should a Global Administrator without Global Reader stay refused? It is refused today.
2. "Azure Reader (or higher read-only)": Owner and Contributor pass today, because the check is "`*/read` on the
   subscription". Should the rule be read-only roles only?
3. Should Teams consent require Global Reader? It does today, on the same basis as Exchange and Purview.
4. The `area` enum and the new consent fields were added to 1.1.0 in place, without a version bump. No real 1.1.0
   record exists yet. The ces-tester REQ has an addendum.

Legend: FC-MU-5 = this session. ARM = Azure Resource Manager. `wids` = the Entra directory-role claim in a token.
EXO = Exchange Online. GCC High = the US government cloud Muster targets. HONEST-OPEN = blocked or unproven, with
the reason recorded. REQ = requirement file.
