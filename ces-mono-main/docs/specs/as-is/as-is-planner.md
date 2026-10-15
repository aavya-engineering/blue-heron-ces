# AS-IS — ces-planner — 2026-07-04 (commit a0d6ae1)

Evidence-cited engineering baseline for the **ces-planner** module, scored against the twelve
SPEC dimensions (SPEC-01..12) using SPEC-00's L0–L3 maturity model. Read-only audit: zero
product/config/test changes were made. Every non-L0 score cites current `file:line` or command
output at commit `a0d6ae1` (branch `g0-safety-net`); the 2026-07-01 recon (`docs/context/SPEC_RECON.md`)
was treated as a stale map, not evidence. Shared numbers are drawn from
`docs/specs/as-is/measurements-2026-07-04.md`.

> **No `ces-profile.md` exists in the repo yet.** SPEC-00.R6/R7 anchor "gap" and formal `N/A`
> waivers to that profile. Absent it, this baseline records raw as-is levels and marks
> **offline-by-design waivers inline** (auth/session/transport/deploy) as *correct-by-design, not
> debt* — to be promoted to formal `N/A` when the profile lands. No score here is inflated against
> an L3 bar the profile has not set.

## Identity

| Field | Value |
|---|---|
| Package | `ces-planner` v1.0.0 (`private: true`, `type: module`) — `ces-planner/package.json:1-5` |
| Description | "CMMC Compliance Tool — Strategic Intent, Readiness Recon, Mission Planning" (`package.json:6`) |
| Kind | Offline-first React 18 + TypeScript + Vite 6 SPA — **no runtime backend** |
| Src size | 40,341 LOC ts/tsx (excl. tests) — `measurements-2026-07-04.md:18` |
| Tests | 11 test files (0.3 files / 1k LOC — lowest of all modules) — `measurements-2026-07-04.md:18` |
| Entry points | `src/main.tsx` (SPA bootstrap), `src/App.tsx` (router) |
| Routes | Client routes `/`, `/dashboard`, `/sit`, `/rrt`, `/mpt` (React Router v6; `ces-planner/CLAUDE.md`) |
| "Ports" | **None in production.** Dev-server-only `/api/*` mirror routes exist solely inside the Vite plugin (`vite.config.ts:38-321`) and do not ship |
| Persistence | IndexedDB via Dexie, DB `CMMCComplianceTool`, 7 versioned schema migrations (`src/shared/db/schema.ts`) |
| Prod vulns | 0 (`npm audit --omit=dev`) — `measurements-2026-07-04.md:47` |

## Scorecard

| # | Dimension | Level | One-line justification |
|---|---|---|---|
| 01 | Concept & Requirements | **L2** | README + module CLAUDE.md + 4 ADRs document scope/features consistently; no enforced requirement traceability. |
| 02 | Architecture & Design | **L2** | Feature-based layering, path aliases, 4 ADRs; documented + consistent but no automated boundary/fitness gate. |
| 03 | API & Contracts | **L1** | No REST API by design (offline waiver); data contracts exist and one seam (Stamper directive) is compile+test enforced, but the primary AJV path is permissive and dev-route bodies are unvalidated. |
| 04 | Security | **L1** | 0 prod vulns + dev-route path-traversal guards, but permissive input validation and no security gate; auth/session/transport waived offline-by-design. |
| 05 | Testing | **L1** | High-quality characterization + Dexie integration + compile-time contract tests, but 0.3 file ratio, no coverage tooling, and large untested UI surface = not consistent across module. |
| 06 | Packaging & Release | **L1** | Vite build produces a bundle; version pinned static at 1.0.0, no changelog / release automation / semver discipline. |
| 07 | CI/CD | **L1** | One CI job runs `npm test` on every push/PR (real gate), but lint/typecheck/build/coverage/audit are all ungated despite scripts existing. |
| 08 | Configuration | **L1** | Central `config.ts`, but values hardcoded (`STAMPER_BASE_PATH` carries a TODO), no env schema/validation/layering. |
| 09 | Observability | **L1** | ~44 ad-hoc `console.*` calls, no structured logging, no telemetry, and no React error boundary. |
| 10 | Documentation | **L2** | Comprehensive README + module CLAUDE.md + 4 ADRs + inline rationale; consistent, but no doc-lint/link gate. |
| 11 | Data & Persistence | **L2** | 7 versioned Dexie migrations, compound indexes, tuple-ownership isolation proven by CI-run integration tests; legacy no-tuple reads still intentionally leaky (blocks L3). |
| 12 | Deployment & Operations | **L1** | Static build is the only artifact; no deploy pipeline/runbook/health checks — most ops requirements offline-waived. |

## Evidence

### 01 — Concept & Requirements — **L2**
- **Strength:** `ces-planner/README.md:1-40` documents purpose, the three-tool workflow (SIT→RRT→MPT), tech stack, and project structure; `ces-planner/CLAUDE.md` adds the artifact dependency chain (`Customer → SI Baseline → RR Question Set → Readiness Posture → Mission Plan`) and immutability rule.
- Package `description` states the domain intent (`package.json:6`); workflow stages are enumerated as a typed const (`src/shared/config.ts:34-50`).
- 4 ADRs capture requirement-shaping decisions (`docs/adr/ADR-001..004`).
- **Weakness / why not L3:** requirements are prose; no machine-checked traceability from a requirement to code/tests. No enforcing mechanism → capped at L2.

### 02 — Architecture & Design — **L2**
- **Strength:** feature-based organization (`src/features/{sit,rrt,mpt,customer,landing,cost-estimator,cui,...}` with `src/shared/` cross-cutting) — verified in the src tree; each feature carries `components/hooks/services/stores/types`.
- Path aliases `@/*`, `@/shared/*`, `@/features/*` declared once (`tsconfig.json` paths + `vite.config.ts:329-334`) keeping layering explicit.
- Architectural decisions are recorded: `ADR-001-ces-identity-model`, `ADR-002-unified-persistence`, `ADR-003-stack-provider-seam`, `ADR-004-reserved-stack-capabilities` (`docs/adr/`).
- **Weakness / why not L3:** no automated architecture fitness function (e.g. dependency-cruiser / import-boundary lint) fails the build on a layering violation; boundaries hold by convention → L2.

### 03 — API & Contracts — **L1** (REST surface offline-waived)
- **Offline waiver:** the module ships no HTTP API. The `/api/list-artifacts`, `/api/save-artifact`, `/api/delete-artifact`, `/api/download-artifact`, `/api/save-to-stamper` routes live only inside the Vite dev plugin (`vite.config.ts:40,120,159,196,250`) and are absent from the production bundle — correct-by-design, not a gap.
- **Strength (enforced seam):** the Stamper directive contract is guarded at compile time *and* runtime — `src/features/mpt/__tests__/stamperDirectiveContract.test.ts:4-10` asserts `'Excluded'`/`'exclude'` are never assignable to `StamperAction`/`StamperDirective`, backed by a vitest suite.
- **Weakness:** the primary artifact-validation path is deliberately permissive — `src/shared/validation/validators.ts:14-22` constructs AJV with `strict:false, strictSchema:false, strictTypes:false, validateSchema:false`; when a schema fails to compile the service "will use permissive validation" and `validate()` returns `{ valid: true }` by default (`validators.ts:48,90,110-124`). Schema-invalid artifacts can pass.
- **Weakness:** dev-route request bodies are `JSON.parse`d with no schema check (`vite.config.ts:207,261`); path safety rests on ad-hoc `startsWith(customersDir)` string guards (`vite.config.ts:136,271`).
- Rollup: contracts exist and one is enforced, but the dominant validation path is permissive and unenforced → **L1**.

### 04 — Security — **L1** (auth/session/transport offline-waived)
- **Offline waiver:** no authentication, authorization, session, or transport-security layer exists — and none should. A repo-wide word-boundary grep for `login|password|authenticate|authToken|Bearer` returns only compliance *content* (`src/features/rrt/components/RRTPreamble.tsx:163` describes a customer "password policy"), no auth code. Single-user offline SPA → correct-by-design.
- **Strength:** 0 production vulnerabilities — `npm audit --omit=dev` (`measurements-2026-07-04.md:47`).
- **Strength:** dev-route path-traversal guards reject writes/reads outside the customers root and the Stamper target (`vite.config.ts:136-140, 171-176, 271-275`).
- **Weakness:** input validation is permissive (see 03, `validators.ts:14-22`); no CSP configured; no `npm audit` gate in CI (`ci.yml` runs only `npm ci` + `npm test`, `.github/workflows/ci.yml:31-39`) so vuln posture is unenforced.
- Rollup: security present by convention, nothing enforced → **L1**.

### 05 — Testing — **L1**
- **Strength (quality):** characterization tests pin generator behavior as pure functions over fixtures — `src/features/mpt/services/__tests__/gapCompiler.characterization.test.ts:1-25` (+ `infraManifestGenerator`, `proposalGenerator.cost`, `rrt/postureGenerator`, `sit/baselineValidator` characterization suites).
- **Strength (persistence):** real-IndexedDB integration tests prove tuple-scoped reads never leak across customers — `src/shared/db/__tests__/dbHelpers.ownership.integration.test.ts:1-30` and `multiCustomer.integration.test.ts` (via `fake-indexeddb/auto`).
- **Strength (contracts):** compile-time type guards double as tests (`stamperDirectiveContract.test.ts`).
- **Weakness (breadth):** only 11 test files over 40,341 src LOC = **0.3 files / 1k LOC, the lowest of all five modules** (`measurements-2026-07-04.md:18`); the entire wizard/UI/store surface (`src/features/*/components`, Zustand stores) is untested.
- **Weakness (measurement):** no coverage tooling installed and no threshold config — `npx vitest run --coverage` cannot run without adding a dependency (`measurements-2026-07-04.md:23-38`).
- Rollup: excellent where present but not applied consistently across the module, and coverage is unmeasurable → **L1** (strong L1, blocked from L2 by breadth + no coverage).

### 06 — Packaging & Release — **L1**
- Build path exists: `build: "tsc && vite build"` with sourcemaps + manual vendor/state/db/validation chunks (`package.json:9`, `vite.config.ts:337-349`).
- **Weakness:** version is a hardcoded static string in two places (`package.json:3` = `1.0.0`; `src/shared/config.ts:5-8` `VERSION: '1.0.0'`, `SCHEMA_VERSION: '4.0'`) with no changelog, no release script, no semver automation, no artifact publishing. Present but ad hoc → **L1**.

### 07 — CI/CD — **L1**
- **Real gate:** `.github/workflows/ci.yml:38-39` runs `npm test` (the root aggregate contract, which includes the planner/fe suite) on every push to `master`/`g0-safety-net` and every PR; a failing test fails the job (`ci.yml:8-10`).
- **Weakness:** that is the *only* run step besides `npm ci` (`ci.yml:31-39`). Despite the module defining `lint` (`eslint … --max-warnings 0`) and `build` (`tsc && vite build`) scripts (`package.json:11,9`), **no lint, typecheck, build, coverage, or `npm audit` gate runs in CI** (`measurements-2026-07-04.md:63-70`).
- Rollup: a consistent test gate exists but the broader CI quality gates are absent → **L1**.

### 08 — Configuration — **L1**
- Central config module exists (`src/shared/config.ts`): `APP_CONFIG`, `PATHS`, `STORAGE_KEYS`, `WORKFLOW_STAGES`.
- **Weakness:** `STAMPER_BASE_PATH = '../stamper/plan-data/vfsgov-xtra'` is hardcoded with an explicit `// TODO: derive tenant slug automatically from TCP primary_domain` (`config.ts:19-20`), consumed directly in UI (`src/features/landing/components/GeneratedArtifactsPanel.tsx:8,134`).
- **Weakness:** the only runtime input is `import.meta.env.DEV` (3 uses), used to toggle DEV_MODE (`config.ts:4,12`); there is no environment-variable schema, no config validation, and no layered/overridable configuration.
- Rollup: configuration is centralized but hardcoded and unvalidated → **L1**.

### 09 — Observability — **L1**
- Logging is ~44 ad-hoc `console.*` calls across non-test source (grep `console\.` over `src`, excluding `.test.`), e.g. `validators.ts:48,54,56,90` and every dev-route error handler (`vite.config.ts:113,151,190,241,316`).
- **Weakness:** no structured logger, no telemetry/metrics, no correlation IDs, and **no React error boundary** (grep for `ErrorBoundary|componentDidCatch` over `src` → 0 hits) — an unhandled render error blanks the SPA silently.
- Rollup: logging by convention only → **L1**.

### 10 — Documentation — **L2**
- **Strength:** `ces-planner/README.md` (features, tech stack, project structure) + a rich module `ces-planner/CLAUDE.md` (data flow, artifact chain, state-management map, routing, dev-mode features) + 4 ADRs (`docs/adr/ADR-001..004`) + purposeful inline comments (e.g. the "G2 / dev-server artifact mirror" rationale in `vite.config.ts:11-13`, the AJV-leniency rationale in `validators.ts:12-13`).
- **Weakness / why not L3:** README project-structure block contains a stale/typo path (`decsriptions/`) and there is no doc-lint or link-check gate in CI; docs hold by discipline, not enforcement → **L2**.

### 11 — Data & Persistence — **L2** (strongest dimension)
- **Strength:** typed Dexie schema with **7 versioned migrations** (`grep -c 'this.version(' src/shared/db/schema.ts` → 7), compound indexes for tenant scoping (`[customerId+baselineId]`, `src/shared/db/schema.ts:53-67`), and a shared DB-name contract imported from ces-shared (`schema.ts:2` `PLANNER_DEXIE_DB_NAME`).
- **Strength (near-enforcement):** tuple-ownership isolation is proven by integration tests that run on real (fake) IndexedDB and are part of the CI `npm test` suite — `dbHelpers.ownership.integration.test.ts` asserts a tuple-scoped read "hides another customer's baseline as 'not found'"; identity helpers `ownedOrUndefined`/`ownedBaselineOrUndefined` gate reads (`schema.ts:17-22`).
- **Weakness / why not L3:** the same test file states it also "characterize[s] the still-leaky legacy (no-tuple) reads so a future migration changes them deliberately" (`dbHelpers.ownership.integration.test.ts:1-6`) — ownership is not yet enforced on *all* read paths, so silent cross-tenant leakage via legacy helpers is still possible → **L2**, not L3.

### 12 — Deployment & Operations — **L1** (ops offline-waived)
- **Offline waiver:** the module is a static offline SPA with no server to deploy or operate; health checks, runbooks, rollback, and uptime SLOs are not applicable by design.
- The only deployable artifact is the `vite build` bundle (`package.json:9`); there is no CI deploy step (`ci.yml` stops at test, `.github/workflows/ci.yml:38-39`), no environment/target definition, and no operational tooling.
- Rollup: a build exists but nothing beyond it; most requirements offline-waived, remainder ad hoc → **L1**.

## Contracts

| Seam | Direction | Definition | Validation status |
|---|---|---|---|
| Stamper directive (`StamperAction`/`StamperDirective`) | planner → stamper | `src/features/mpt/.../types` | **Enforced** — compile-time type guards + vitest (`stamperDirectiveContract.test.ts:4-10`) |
| Dexie DB name / collections | planner ↔ ces-shared | `PLANNER_DEXIE_DB_NAME` from `ces-shared/src/storage/DexieContract` (`schema.ts:2`) | Shared-source import; consistency by shared constant, no cross-repo schema test cited here |
| Pipeline file-artifact write path | planner (dev) → disk / stamper | `getPlannerArtifactDirectory`, `writeJsonArtifact`, `writeTextArtifact` from `ces-shared` (`vite.config.ts:5-13`) | Path-guarded (`startsWith` checks), **dev-server only** — not in prod bundle |
| CES JSON artifact schemas | internal (generator → store) | `/public/schemas/*` via `schemaLoader` (`validators.ts:3`) | **Permissive** — AJV `strict:false/validateSchema:false`; failed-compile schemas pass by default (`validators.ts:14-22,110-124`) |
| CES identity tuple | internal ownership gate | `cesTuple` (`ownedOrUndefined`, `ownedByCustomerOrUndefined`, `schema.ts:17-22`) | Tuple-scoped reads test-enforced; legacy no-tuple reads still leaky (see 11) |

## Watchlist

- **Coverage is unmeasurable today** (no `@vitest/coverage-v8`, no threshold) — installing coverage tooling + a CI threshold would move SPEC-05 and SPEC-07; the 0.3 file ratio is the current proxy (`measurements-2026-07-04.md:18,23-38`).
- **`STAMPER_BASE_PATH` TODO** (`config.ts:19-20`): deriving the tenant slug from TCP `primary_domain` would remove the last hardcoded cross-module path and lift SPEC-08.
- **Legacy no-tuple reads** (`dbHelpers.ownership.integration.test.ts:1-6`): the deliberate migration to close leaky reads is the single change that would take SPEC-11 toward L3.
- **CI is a single test gate** (`ci.yml:38-39`): wiring the existing `lint` (`--max-warnings 0`) + `tsc` build into CI would lift SPEC-07 with no new tooling.
- **No error boundary / structured logging**: adding either would move SPEC-09 off ad-hoc console logging.
- **Formalize offline waivers:** when `ces-profile.md` lands, the auth/session/transport (SPEC-04) and deploy/ops (SPEC-12) exclusions here should become named `N/A` waivers (SPEC-00.R7), and the REST-surface waiver under SPEC-03 likewise — so the low raw levels are read as correct-by-design, not debt.
