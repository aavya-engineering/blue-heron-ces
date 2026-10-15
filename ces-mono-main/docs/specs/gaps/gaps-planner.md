# GAP — ces-planner — Ideal (CES profile) vs As-Is

**Method:** G-SPEC-3 mechanical cell diff (`docs/G-SPEC-3-plan.md`). Target level per dimension from
`docs/specs/ideal/ces-profile.md`; as-is levels + evidence from `docs/specs/as-is/as-is-planner.md`
(commit `a0d6ae1`). Disposition per cell = **MEETS** (as-is ≥ target) / **WAIVED** (profile cites a
Planner offline waiver → `N/A`) / **GAPPED** (as-is < target). Findings only on GAPPED cells, IDs
`GAP-planner-<SPEC-NN.R#>-<seq>`. Dedup vs `docs/G8-findings.md`, `docs/G8-completion.md`,
`ces-strategy/docs/ces-roadmap-phase3-goals.md`, `docs/specs/gaps/punchlist-import.csv`.

> Read-only report. Fixes nothing. **Punchlist dedup note:** `cesPunchlist.xlsx` was extracted to
> `punchlist-import.csv`; its rows are backlog titles (no per-module IDs), so cross-refs below cite the
> matching row text.

## Disposition matrix

| # | Dimension | Target | As-is | Disposition | Findings |
|---|---|---|---|---|---|
| 01 | Concept & Requirements | L3 | L2 | **GAPPED** | 1 |
| 02 | Architecture & Design | L2 (L3 on R4,R8,R10) | L2 | **GAPPED** (base MEETS; R4 L3-tighten gapped) | 1 |
| 03 | API & Contracts | L2 (L3 on R5,R7) | L1 | **GAPPED** (REST surface WAIVED) | 1 |
| 04 | Security | L3 | L1 | **GAPPED** (auth/session/transport + injection/secrets WAIVED/N-A) | 2 |
| 05 | Testing | L3 *(stretch)* | L1 | **GAPPED** | 3 |
| 06 | Packaging & Release | L2 | L1 | **GAPPED** | 1 |
| 07 | CI/CD | L3 *(stretch)* | L1 | **GAPPED** | 3 |
| 08 | Configuration | L3 | L1 | **GAPPED** | 2 |
| 09 | Observability | L2 | L1 | **GAPPED** | 2 |
| 10 | Documentation | L2 | L2 | **MEETS** | 0 (1 nit) |
| 11 | Data & Persistence | L3 (MANDATORY) | L2 | **GAPPED** | 1 |
| 12 | Deployment & Operations | L2 | L1 | **WAIVED** (offline SPA, no server to deploy/operate) | 0 |

**Findings by severity: P0:0 · P1:2 · P2:14 · P3:1** (17 total).

---

## Strengths that MEET or exceed target (report is not all-negative)

- **SPEC-11 Data & Persistence — the module's spine.** 7 versioned Dexie migrations, compound
  tenant-scoping indexes (`[customerId+baselineId]`), a shared DB-name contract from `ces-shared`, and
  **CI-run real-IndexedDB integration tests** proving tuple-scoped reads hide another customer's
  baseline as "not found" (`as-is-planner.md:108-111`). At L2 vs an L3-mandatory bar — one migration
  (leaky legacy reads, below) from target.
- **SPEC-10 Documentation — MEETS L2.** README + rich module `CLAUDE.md` + 4 ADRs + purposeful inline
  rationale (`as-is-planner.md:104-106`). *Nit (not a gap):* stale path typo `decsriptions/` in the
  README structure block; no doc-lint gate. Neither drops the cell below target.
- **SPEC-02 base MEETS L2.** Clean feature-based layering, single-source path aliases, 4 ADRs
  (`as-is-planner.md:56-60`). Only the R4 L3-tightening (enforced dep-cycle check) is unmet.
- **SPEC-01/03 enforced seams.** The Stamper directive contract is **compile-time + vitest enforced**
  (`'Excluded'`/`'exclude'` provably unassignable) — an L3-grade seam already in place
  (`as-is-planner.md:64,122`).

---

## GAPPED cells — findings

### SPEC-01 — Concept & Requirements (L2 → L3)
- **GAP-planner-01.R12-01** — No machine-checked traceability from CMMC practice → requirement → code/
  test; requirements live as prose, so nothing enforces the compliance product's own traceability
  claim. *Evidence:* `as-is-planner.md:54`. **Severity P2** (maturity/enforcement debt; traceability
  exists at doc level, gap is enforcement). **Effort L.** *Sketch:* build a requirement→test matrix
  anchored on the existing characterization tests (baselineValidator/postureGenerator/gapCompiler),
  fail CI on an unlinked in-scope practice. *Cross-cutting:* the obligation source is the EO
  determination ledger (see `ces-eo` gaps) — coordinate, don't duplicate.

### SPEC-02 — Architecture & Design (base L2 MEETS; R4 tightened to L3 — GAPPED)
- **GAP-planner-02.R4-01** — No enforced dependency-cycle / import-boundary check fails the build;
  feature/shared boundaries hold by convention only. Profile waives the *tool choice* but **not** the
  requirement to have an enforced check. *Evidence:* `as-is-planner.md:60`. **Severity P2.**
  **Effort S.** *Sketch:* add a madge/dependency-cruiser gate to CI over `src/features/*` ↔ `src/shared`.
  (R8/R10 L3-tightenings target the stamper↔EO seam and the `EoServer` route/LOC budget — **N/A for
  Planner**, owned by `ces-eo`/`ces-stamper`.)

### SPEC-03 — API & Contracts (L1 → L2; REST surface WAIVED)
> **WAIVED (`N/A`):** the dev-server-only artifact routes (`/api/list-artifacts`, `/api/save-artifact`,
> …) — profile SPEC-03 waives R2/R3 for the offline SPA's dev routes; path-safety still owed (see
> SPEC-04). R5/R7 contract-diff + stamper↔EO ratification tightenings are `ces-eo`/`ces-stamper` scope.
- **GAP-planner-03.R2-01** — The primary artifact-validation path is deliberately permissive: AJV is
  constructed `strict:false, strictSchema:false, strictTypes:false, validateSchema:false`, and when a
  schema fails to compile the service falls back to permissive validation and `validate()` returns
  `{ valid: true }` by default — **schema-invalid artifacts can silently pass**. *Evidence:*
  `as-is-planner.md:65` (`validators.ts:14-22,48,90,110-124`). **Severity P1** (artifact/contract
  integrity on a live generate→persist path). **Effort M.** *Sketch:* construct AJV strict, fail-closed
  on schema-compile failure (return `{valid:false}` with the compile error), keep an explicit opt-out
  only for a named legacy schema. *Not owned by G8/phase-3/punchlist — new.*

### SPEC-04 — Security (L1 → L3)
> **WAIVED (`N/A` for Planner):** server-side authN (R1), session (R9), transport (R10) — offline SPA,
> no runtime backend (profile SPEC-04 waiver, `docs/saas-readiness.md`). The dryRun-first, Key-Vault
> secret-store, and injection-guard tightenings target live-tenant modules (Stamper/AO) — **N/A for
> Planner** (no live tenant, no `spawn`, no secret material).
- **GAP-planner-04.R14-01** — Dev-server artifact routes `JSON.parse` request bodies with no schema
  check and rest path-safety on ad-hoc `startsWith(customersDir)` string guards rather than a resolved-
  path-root containment check (profile keeps the R14 path-root check owed even for waived dev routes).
  *Evidence:* `as-is-planner.md:66,72` (`vite.config.ts:136,207,261,271`). **Severity P2** (dev-only
  surface, not shipped in prod bundle — but the one non-waived security obligation on these routes).
  **Effort S.** *Sketch:* replace `startsWith` with `path.resolve` + relative-containment guard;
  schema-validate the parsed bodies.
- **GAP-planner-04.R12-01** — No Content-Security-Policy configured for the SPA shell. *Evidence:*
  `as-is-planner.md:73`. **Severity P3** (offline/static SPA → low blast radius; profile L3 bar still
  expects it). **Effort S.** *Sketch:* add a CSP `<meta>`/header to `index.html`. *(The missing `npm
  audit` CI gate from the same evidence line is scoped once under SPEC-07.R7-01, cross-referenced here.)*

### SPEC-05 — Testing (L1 → L3, declared stretch / *target not yet met*)
- **GAP-planner-05.R7-01** — No coverage tooling installed and no threshold; `npx vitest run --coverage`
  cannot run without a dependency, so coverage is unmeasurable (the 0.3 files/1k-LOC ratio is the only
  proxy). *Evidence:* `as-is-planner.md:81` (`measurements-2026-07-04.md:23-38`). **Severity P2.**
  **Effort S** (install) **+ M** (baseline). *Sketch:* add `@vitest/coverage-v8`, set a starting
  threshold. *Cross-cutting:* profile notes **no CES module** has coverage tooling — pair with the
  workspace-wide coverage goal (SPEC-05/07 stretch); a shared candidate goal, not Planner-only.
- **GAP-planner-05.R9-01** — The entire wizard/UI/Zustand-store surface (`src/features/*/components`,
  stores) is untested — 11 test files over 40,341 LOC, the lowest ratio of the five modules.
  *Evidence:* `as-is-planner.md:80`. **Severity P2.** **Effort L.** *Sketch:* add store + critical-flow
  component tests (SIT→RRT→MPT wizard happy paths). *Cross-ref punchlist:* "add functional test cases
  for every major use case" / "identify internal tests we could perform".
- **GAP-planner-05.R5-01** — No golden-artifact coverage for Planner's generated outputs; profile
  mandates the EO `ssp-golden-reference` pattern for **every** artifact generator, including Planner
  posture/proposal outputs. *Evidence:* profile SPEC-05 (`ces-profile.md:117-119`); characterization
  suites exist but are not goldens (`as-is-planner.md:77`). **Severity P2.** **Effort M.** *Sketch:*
  promote the postureGenerator/proposalGenerator/gapCompiler characterization fixtures to committed
  golden references with a diff-gate.

### SPEC-06 — Packaging & Release (L1 → L2)
- **GAP-planner-06.R1-01** — Version is a hardcoded static `1.0.0` in two places
  (`package.json:3`, `config.ts:5-8`) with no `CHANGELOG.md`, no release script, no semver automation.
  Profile: unfreeze the version and add a changelog, with **EO as the exemplar**. *Evidence:*
  `as-is-planner.md:86`. **Severity P2.** **Effort S.** *Sketch:* add `CHANGELOG.md`, single-source the
  version, adopt semver on release. *Cross-cutting* with Stamper/AO (same profile R1/R3 tightening).

### SPEC-07 — CI/CD (L1 → L3, declared stretch / *target not yet met*)
> A real test gate exists (`ci.yml:38-39` runs `npm test` on every push/PR). The gaps are the missing
> quality gates. Profile scopes R10/R12 (env promotion / deploy metrics) to L2 while pre-SaaS — those
> are met/N-A, not gaps.
- **GAP-planner-07.R3-01** — `lint` (`eslint --max-warnings 0`), typecheck, and `build` scripts exist
  but none run in CI. *Evidence:* `as-is-planner.md:90` (`package.json:9,11`, `ci.yml:31-39`).
  **Severity P2.** **Effort S.** *Sketch:* add lint + `tsc` + `vite build` steps to `ci.yml` (no new
  tooling). *Cross-ref punchlist:* "Scan CES for dead code".
- **GAP-planner-07.R6-01** — No coverage gate in CI. **Severity P2.** **Effort S.** *Sketch:* add a
  coverage-threshold step once SPEC-05.R7-01 lands. *Pairs with SPEC-05; cross-cutting coverage goal.*
- **GAP-planner-07.R7-01** — No `npm audit` (dependency-audit) gate in CI, so the current 0-prod-vuln
  posture is unenforced. *Evidence:* `as-is-planner.md:73,90`. **Severity P2.** **Effort S.** *Sketch:*
  add `npm audit --omit=dev` as a blocking step. *(This is the audit gate cross-referenced from
  SPEC-04. Phase-3 G12 modernizes CI Node actions but does **not** add coverage/audit gates — related,
  not a dup.)*

### SPEC-08 — Configuration (L1 → L3)
> Profile scope for Planner: Vite build-time config is an accepted variant; **path-resolving or
> server-touching** config must move behind a validated layer (R1, R5).
- **GAP-planner-08.R5-01** — `STAMPER_BASE_PATH = '../stamper/plan-data/vfsgov-xtra'` is a hardcoded
  cross-module path carrying an explicit `// TODO: derive tenant slug automatically from TCP
  primary_domain`, consumed directly in UI. *Evidence:* `as-is-planner.md:95` (`config.ts:19-20`,
  `GeneratedArtifactsPanel.tsx:8,134`). **Severity P2.** **Effort M.** *Sketch:* derive the tenant slug
  from TCP `primary_domain` through a validated config accessor. *(Profile SPEC-08 names this same TODO
  explicitly — Planner-owned; new, not in G8/phase-3.)*
- **GAP-planner-08.R1-01** — No environment-variable schema, no config validation, no layered/
  overridable config; the only runtime input is `import.meta.env.DEV`. *Evidence:* `as-is-planner.md:96`
  (`config.ts:4,12`). **Severity P2.** **Effort M.** *Sketch:* route any path-resolving/server-touching
  config through a Zod-validated layer (mirror the `EoConfig` convergence pattern for the SPA-relevant
  subset); ship a `.env.example`.

### SPEC-09 — Observability (L1 → L2)
- **GAP-planner-09.R1-01** — ~44 ad-hoc `console.*` calls across non-test source; no structured logger,
  no telemetry, no correlation IDs. Profile: Planner's console posture converges to R1+R2. *Evidence:*
  `as-is-planner.md:100`. **Severity P2.** **Effort M.** *Sketch:* introduce a thin structured logger
  shim, replace ad-hoc console calls.
- **GAP-planner-09.R6-01** — **No React error boundary** anywhere in `src` — an unhandled render error
  blanks the SPA silently. *Evidence:* `as-is-planner.md:101` (grep `ErrorBoundary|componentDidCatch` →
  0). **Severity P2** (resilience/observability; not integrity). **Effort S.** *Sketch:* add a top-level
  `ErrorBoundary` that logs and renders a fallback.

### SPEC-11 — Data & Persistence (L2 → L3, MANDATORY)
- **GAP-planner-11.R6-01** — Ownership is enforced on tuple-scoped reads but **legacy no-tuple read
  helpers remain intentionally leaky**, so silent cross-customer IndexedDB leakage is still possible;
  the integration test characterizes (does not yet block) this. Profile marks tenant isolation an L3
  hard gate, mandatory in every posture. *Evidence:* `as-is-planner.md:111`
  (`dbHelpers.ownership.integration.test.ts:1-6`). **Severity P1** (tenant-isolation integrity on a live
  read path; mitigated by single-operator offline scope and the fact it is deliberately characterized —
  the strongest P0 candidate but not remote-exploitable). **Effort M.** *Sketch:* migrate remaining
  legacy readers to the `ownedOrUndefined` tuple helpers; make no-tuple reads throw. *Cross-ref
  punchlist:* "Add test for matching Cust/SI ID on all persistent object reads" and "Ensure CES can
  handle multiple customers" — punchlist rows are titles only, so this finding scopes them concretely.
- **WORM / RSA-PSS signing / content-hash / 6-yr retention — DUP → G8 + phase-3 G10/G11.** These L3
  integrity tightenings target the **evidence store** (Stamper/EO blobs + determinations), not the
  Planner's plan/IndexedDB working store. Owned by `docs/G8-findings.md` (a/b/d), `G8-completion.md`
  (deferred w/ risk acceptance), and phase-3 **G10-WORM** / **G11-SIGNING**. **Not re-scoped for
  Planner.**

### SPEC-12 — Deployment & Operations (L1 → L2) — **WAIVED**
Offline static SPA: no server to deploy or operate, so L2 deploy/rollback/env-matrix/health-check
requirements are `N/A` by design (`as-is-planner.md:113-116`; profile SPEC-12 operator-local scope).
The R4 manual-step register and R6 evidence-blob backup tightenings target the live-tenant EO/AO/Stamper
path — **not Planner**. *Residual nit (not a gap):* a one-line "build & serve the static bundle" note
would formalize the remainder; below the finding bar.

---

## Dedup ledger

| Theme | Finding(s) | Status |
|---|---|---|
| Evidence WORM / signing / content-hash / retention | (SPEC-11) | **DUP → G8 (a/b/d) + phase-3 G10/G11** — not re-scoped |
| Legacy no-tuple read leakage | GAP-planner-11.R6-01 | Partial punchlist overlap ("matching Cust/SI ID on all reads"); scoped here (punchlist = title only) |
| Coverage tooling / thresholds | GAP-planner-05.R7-01, 07.R6-01 | Cross-cutting stretch (profile: no CES module has it); pair into a workspace coverage goal |
| CI quality gates (lint/typecheck/build/audit) | GAP-planner-07.R3-01/R7-01 | New for Planner; phase-3 G12 only bumps Node actions (related, not dup) |
| Version unfreeze + CHANGELOG | GAP-planner-06.R1-01 | Cross-cutting (EO exemplar); new for Planner |
| Permissive AJV validation | GAP-planner-03.R2-01 | New — not in G8 (eo/stamper/ao/shared scope) / phase-3 / punchlist |
| STAMPER_BASE_PATH TODO | GAP-planner-08.R5-01 | Named in profile SPEC-08; Planner-owned; new |
