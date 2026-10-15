# CES Profile — Ideal Specification Overlay (v1.0)

**Status:** authored 2026-07-04 · **Overlays:** `core/SPEC-01..12` · **Governed by:** `core/SPEC-00`
(maturity model, scoring rules R1–R14) · **Changelog:** see `README.md` amendment policy.

## What this file is (and is not)

This is a **thin overlay**, not a spec. Per SPEC-00.R7/R12 it does exactly three things and nothing
else: it (1) sets **one target maturity level per dimension** (consumed by SPEC-00.R6 — "meets ideal"
means `as-is ≥ target`), (2) records **CES-specific tightenings** (raise a dimension target or add a
new CES requirement, which then obeys SPEC-00.R2–R5 like any core requirement), and (3) records
**named waivers with rationale** (a waived requirement scores `N/A`, never a silent pass). It **never
re-tags or re-levels a core requirement** — level tags live only in the core specs. SPEC-00 (method)
is not a scored dimension and cannot be waived.

Targets encode CES realities: a CMMC L2 / GCC High, CUI-handling, evidence-integrity product built as
a TypeScript / Node npm-workspaces monorepo (`ces-shared`, `ces-stamper`, `ces-eo`, `ces-ao`,
`ces-planner`), with dryRun-first live-tenant execution and an offline-by-design Planner SPA. It is
**pre-SaaS / operator-local** today (`docs/saas-readiness.md`), which scopes the deployment and
distribution targets.

## Target levels at a glance (one screen)

| Dimension | Target | One-line rationale |
|---|---|---|
| SPEC-01 Concept & Requirements | **L3** | CMMC practice → requirement → test traceability must be *enforced*, not documented, because it is the compliance product's spine. |
| SPEC-02 Architecture & Design | **L2** (L3 on R4, R8, R10) | Baseline systematic; cross-module seam density (stamper↔EO, stack seam, EO monolith) forces enforced dep-checks, contract validation, and a route/LOC budget. |
| SPEC-03 API & Contracts | **L2** (L3 on R5, R7) | Servers are internal today; the stamper↔EO contract and the contract-diff gate must be machine-enforced because evidence flows across that seam. |
| SPEC-04 Security | **L3** | Live GCC High tenant execution: secrets, injection guards, and the dryRun gate must fail the build/PR, not rely on habit. |
| SPEC-05 Testing | **L3** *(target, not yet met)* | Golden coverage of generated compliance artifacts + coverage thresholds gated in CI; today **no module has coverage tooling or a threshold**. |
| SPEC-06 Packaging & Release | **L2** | Pre-SaaS, workspace-internal distribution; semver + changelog + reproducible build are systematic, external signing/SBOM is a targeted uplift. |
| SPEC-07 CI/CD | **L3** *(target, not yet met)* | CI is the enforcement organ; today it is a single test gate — coverage and dependency-audit gates are the named additions. |
| SPEC-08 Configuration | **L3** | `EoConfig` (Zod, validated-and-throws at startup) is the convergence target; schema-validation at the boundary is inherently L3. |
| SPEC-09 Observability | **L2** | Floor = request/correlation IDs + a durable audit trail for privileged AO/EO actions; systematic and consistent, not (yet) CI-gated. |
| SPEC-10 Documentation | **L2** | README + runbook per module (R1+R2 mandatory); `ces-shared`, `ces-eo`, `ces-ao` READMEs are currently missing. |
| SPEC-11 Data & Persistence | **L3 (MANDATORY)** | Evidence integrity *is* the product: content hashing, WORM/append-only, 6-year CUI retention, tenant isolation — mandatory in every posture. |
| SPEC-12 Deployment & Operations | **L2** | Product is **pre-SaaS / operator-local** (`docs/saas-readiness.md`); L3 deploy automation is deferred until hosted demand justifies it. |

Legend: a plain **L2/L3** is the dimension target consumed by SPEC-00.R6. "(L3 on Rn)" means the
dimension target is the base level but the named requirement is tightened to L3. "*(target, not yet
met)*" flags a deliberate stretch target — the current as-is is below it and that delta is a real gap,
not a scoring error.

---

## Per-dimension detail (tightenings + waivers)

Each entry cites the core spec's own **CES profile hooks** section as its ground.

### SPEC-01 — Concept & Requirements → target **L3**
Ground: `core/SPEC-01.md` profile hooks.
- **Tighten — R12 to mandatory L3 (CMMC traceability).** Every in-scope CMMC practice must trace to a
  requirement **and** a test; the obligation source is the EO determination ledger / assessment
  objectives. This is the dimension's headline and the reason the whole dimension targets L3.
- **Tighten — R10 anchored on real tests.** Traceability resolves to the `ces-planner`
  characterization tests (baselineValidator, postureGenerator, gapCompiler) and the EO golden SSP
  reference — these are the anchor tests the requirement→test matrix must land on.
- **Waive — R9 "no manual-only acceptance criterion", scoped.** Live-tenant / GCC High behaviors that
  cannot run in offline CI are satisfied by a **registered manual step** (ties to SPEC-12's manual-step
  register) instead of an offline test. Rationale: those behaviors require a live tenant; excluding
  them from the automated-AC rule is honest, and the manual-step register keeps them tracked. Score
  such ACs `N/A` against R9, covered under SPEC-12.R4.

### SPEC-02 — Architecture & Design → target **L2** (L3 on R4, R8, R10)
Ground: `core/SPEC-02.md` profile hooks.
- **Tighten — R8/R9 to L3 on the stamper↔EO seam.** `docs/stamper-eo-schema-contract.md` must be
  ratified (out of DRAFT) and both sides validated against it (cross-links SPEC-03.R7).
- **Tighten — R5 anchored on the stack-provider seam (ADR-003).** GCC High vs commercial endpoint
  resolution MUST flow through the stack seam as the mandated IO boundary (cross-refs SPEC-08). This
  is the convergence point for cloud-endpoint selection.
- **Tighten — R10 to L3 with a concrete budget.** A route-registration / LOC ceiling that `EoServer.ts`
  currently violates, making decomposition a tracked gap rather than a vibe.
- **Waive — R4 tooling choice only, not the gate.** The specific tool (madge vs dependency-cruiser) is
  left to the module; the requirement to have an *enforced* dependency-cycle check is **not** waived.

### SPEC-03 — API & Contracts → target **L2** (L3 on R5, R7)
Ground: `core/SPEC-03.md` profile hooks.
- **Tighten — R7 to a hard gate on stamper↔EO.** `docs/stamper-eo-schema-contract.md` moves from
  DRAFT v1.0 to `ratified`; the stamper producer (`DirectiveMetadata` / `RegistryEntrySnapshot` Zod
  schemas) and the EO consumer are both validated against it. Flagship SPEC-03 tightening.
- **Tighten — R1 across all four servers.** Stamper GUI, EO (`EoServer`), AO (`AoServer`) expose
  unversioned `/api/*`; the profile requires a `/v1` mount or version header on each.
- **Tighten — R5 to L3 (contract-diff gate).** Required specifically because EO already shipped an
  unguarded breaking change (`confidence` removal at v0.2.0).
- **Waive — R2/R3 for the Planner's dev-server-only artifact routes.** The Vite dev-server routes
  (`/api/list-artifacts`, `/api/save-artifact`, …) are not a production API surface. Rationale: the
  Planner is an **offline SPA with no runtime backend**; full schema/contract-test rigor does not
  apply. Score these routes `N/A` against R2/R3 — but path-safety is still owed (cross-ref SPEC-04).

### SPEC-04 — Security → target **L3**
Ground: `core/SPEC-04.md` profile hooks. This dimension targets L3 because it governs live GCC High
tenant execution; several requirements are raised to mandatory L3.
- **Tighten (new CES requirement) — dryRun-first live-tenant execution.** For modules that hit a live
  tenant (Stamper, AO), `dryRun` is the **enforced default**; live execution requires an explicit
  un-dry-run gate; for Tier-3 actions the two-person SOD approval MUST bind to the canonical params
  hash before any live call. This is a CES requirement addition on top of core AuthZ (R2/R15).
- **Tighten — R3/R4 to mandatory L3 (central secret store = Key Vault).** Cert/secret material
  resolves from Azure Key Vault / managed identity — no plaintext secret path, no secret-valued env
  var. **Explicit anti-target:** the plaintext `--cert-password <password>` CLI option
  (`ces-stamper/src/cli/index.ts:371`, still present) MUST be removed; while it exists this requirement
  fails. The ~44 scattered `process.env` reads in Stamper are a tracked R5 gap (see SPEC-08).
- **Tighten — R8 to mandatory L3 (injection guards).** Stamper's `CLIAdapter` `spawn()` on
  plan-derived commands and AO's `TemplateRegistry` PowerShell/shell template substitution: every
  interpolated value passes an escaping/allowlist guard, **verified by test**. Highest-severity CES
  injection surfaces.
- **Waive — R1/R9/R10 for `ces-planner` (offline SPA).** Server-side authN, session management, and
  related runtime-backend requirements are waived for the Planner where it runs as an **offline SPA
  with no runtime backend** (only Vite dev-server routes). Rationale: there is no server to
  authenticate against; the offline SPA design is the documented posture (`docs/saas-readiness.md`
  notes the Planner is an offline browser SPA). Score these `N/A` for Planner only — the dev-server
  artifact routes still owe the R14 path-root check.

### SPEC-05 — Testing → target **L3** *(target, not yet met)*
Ground: `core/SPEC-05.md` profile hooks. The L3 target is a deliberate, cited stretch: **today CI has
no coverage gate anywhere** (`docs/context/measurements-2026-07-04.md` — no module has coverage tooling
installed or a threshold). Reporting the delta as a gap is correct, not scoring error.
- **Tighten — golden-artifact coverage (mandatory L2+).** EO's `tests/ssp/ssp-golden-reference.test.ts`
  is the reference implementation of R5; the *same pattern* is required for every other artifact
  generator (POA&M, Evidence.zip, Planner posture/proposal outputs). The artifact **is** the product.
- **Tighten — R7/R8 coverage-threshold gating (target L3).** (1) turn off the `--no-coverage`
  defaults, (2) configure thresholds per workspace, (3) add the gate to `.github/workflows/ci.yml`.
- **Tighten — R9 adapter/route floors sized to CES risk.** Pointed at Stamper's execution adapters
  (APIAdapter / BicepAdapter / CLIAdapter / ManualGateAdapter, currently untested) and EO's ~98 route
  registrations — the live-tenant blast radius. Paired with SPEC-04.R8 (injection guards test-covered).
- **Note — R10 characterization-first is already partial.** Planner ships characterization tests;
  extend to Stamper/EO legacy seams before any refactor.

### SPEC-06 — Packaging & Release → target **L2**
Ground: `core/SPEC-06.md` profile hooks.
- **Scope — R7 via internal npm-workspace linkage channel.** CES is pre-SaaS: nothing publishes to a
  public registry (all workspace-internal under `cmmc-workspace`). R7 is satisfied by a **declared
  internal linkage channel**, written down (with a pointer to `docs/saas-readiness.md`), not implicit.
  R5/R6 provenance + SBOM are a targeted uplift, not a claim of current external signing.
- **Tighten — R1/R3 unfreeze versions + add changelogs.** Stamper/AO/EO/Planner move off frozen
  `0.1.0`/`1.0.0`; each gains a `CHANGELOG.md`. **EO is the exemplar** (`CHANGELOG.md` v0.2.0); the
  other three must match.
- **Tighten — R10 version self-report via health.** Server modules (Stamper GUI, EO, AO) return module
  version + build commit on `/api/health`, so a deployed live-tenant build is always identifiable
  (cross-refs SPEC-09.R5).
- **Note — R4 reproducible build already partly met** (`npm ci` on pinned Node 24 in CI); pair with
  SPEC-04.R11/R13 so audit + SBOM land in the same release job.

### SPEC-07 — CI/CD → target **L3** *(target, not yet met)*
Ground: `core/SPEC-07.md` profile hooks. CI is the dimension whose whole point is enforcement, so the
target is L3; today `.github/workflows/ci.yml` is a **single test gate**.
- **Tighten — add R6 (coverage) and R7 (dependency audit) as first-class blocking gates.** The two
  highest-value additions per the recon; pairs with SPEC-05's coverage target.
- **Tighten — promote R3 (lint) and R4 (typecheck) from build-embedded to explicit gates.**
- **Note — R8 golden-diff already partial** (EO golden SSP reference test runs inside `npm test`);
  keep it in the CI aggregate and add companion golden-diffs as deterministic renders land.
- **Waive/scope — R10 (env promotion) and R12 (deploy metrics) target L2 while pre-SaaS.** Rationale:
  CI is offline-only (no live-tenant / network / `mmdc` steps); multi-stage promotion is deferred (see
  SPEC-12 note + `docs/saas-readiness.md`). Score R10/R12 against L2, not L3.

### SPEC-08 — Configuration → target **L3**
Ground: `core/SPEC-08.md` profile hooks. Schema-validation-at-startup-that-throws is inherently an L3
mechanism, so the dimension targets L3, with `EoConfig` as the named convergence pattern.
- **Convergence target — `EoConfig`.** `ces-eo/src/eo/config/EoConfig.ts` (single Zod
  `EoConfigSchema` with defaults, `loadEoConfig()` doing `safeParse` and throwing a field-level error,
  one consolidated env-read entry point, defaulted `port`, exported `z.infer` type) is the pattern the
  other modules **MUST** converge on (R1, R2, R4, R8).
- **Tighten — Stamper.** Eliminate the ~44 scattered `process.env` reads (R3) and the hardcoded
  `STAMPER_BASE_PATH` TODO (`config.ts:19`, R5) by routing through a Zod-validated `StamperConfig`
  modeled on `EoConfig`.
- **Tighten — AO.** Replace the hardcoded port `3000` (`cli/index.ts:15`) with a defaulted, validated
  config field (R4).
- **Scope — Planner.** Vite build-time config is an accepted variant for the offline SPA; any
  server-touching or path-resolving config must move behind a validated layer (R1, R5).
- **Target — R7 documented matrix at L2:** each workspace ships a `.env.example` enumerating the
  variables its schema consumes.

### SPEC-09 — Observability → target **L2**
Ground: `core/SPEC-09.md` profile hooks. The floor is systematic (L2), not yet CI-gated.
- **Floor (headline) — request IDs (R3) + privileged-action audit (R4).** (1) Request/correlation IDs
  assigned at each server edge and forwarded across the EO → Stamper capture boundary (CES has none
  today). (2) A durable audit trail for privileged AO/EO actions — AO command executions and approval
  decisions, EO tenant-config changes and evidence captures — recording actor, action, timestamp,
  target, outcome. Extends the existing evidence audit (SHA-256 metadata, `executorIdentity`) to ops
  actions that leave no durable trail today.
- **Tighten — converge four logging postures onto one.** stamper (winston-used) is the reference; EO
  (winston-imported-but-unused), Planner (console), AO (near-nothing) converge to R1+R2.
- **Tighten — close two named silent-failure holes.** R6+R8 for EO's scheduled signal capture (persist
  `lastCaptureRun`, emit a failure metric) and R7 for `EvidenceOpsClient`'s fire-and-forget POST
  (handle the rejection; do not drop a capture silently).
- **Target — R5 health at L2:** EO/AO already expose `GET /api/health`; make it reflect real
  dependency/readiness state, not a constant `200`.

### SPEC-10 — Documentation → target **L2**
Ground: `core/SPEC-10.md` profile hooks.
- **Target — R1+R2 mandatory per module.** Every workspace (`ces-shared`, `ces-stamper`, `ces-eo`,
  `ces-ao`, `ces-planner`) carries a README (purpose / run / test) **and** a runbook, because each is
  independently runnable against operator or live-tenant surfaces. Baseline: only `ces-planner` and
  `ces-stamper` have READMEs today — `ces-eo`, `ces-ao`, `ces-shared` are R1 gaps.
- **Tighten — R6.** Root `session-*.md` logs and planning `.md` files are **forbidden** from
  satisfying any R1–R3 requirement.
- **Stretch (candidate L3) — R5 docs-with-code gate** on CES routes/CLI surfaces (EO/AO servers, `ao`
  CLI) once the README/runbook baseline closes.
- **Waive — none.** Documentation applies to every module, including the offline Planner.

### SPEC-11 — Data & Persistence → target **L3 (MANDATORY)**
Ground: `core/SPEC-11.md` profile hooks. Evidence integrity is the core value proposition, not a
feature — this dimension is L3-mandatory in every deployment posture.
- **Tighten — R3/R4 to L3 (content hash + WORM/append-only).** All CES evidence records (Stamper
  artifacts, EO assessment determinations, AO audit entries) carry a content hash and are append-only;
  corrections are superseding versions, never edits. Maps to CES goals G10 (WORM intent) and G11 (Key
  Vault signing). In-place mutation of a committed evidence record MUST throw, asserted by a test.
- **Tighten — R5 retention = 6 years for CUI.** Retention for CUI-classed evidence is **6 years**, with
  an enforcement path (lifecycle/disposal job), not merely a stored field. The period is cited in
  config, not hardcoded ad hoc.
- **Tighten — R6/R7 to L3 (tenant isolation non-negotiable).** `CesRepository` already throws on empty
  scope; the two-tenant no-leak test (R6) and the single documented resolver (R7) are a hard gate. The
  tenant-tests EUT suite is the enforcement surface.
- **Acknowledge (pre-SaaS scope, not a waiver).** At-scale isolation (DB-per-tenant vs row-level) and
  per-tenant cloud WORM storage are deferred per `docs/saas-readiness.md`; today's operator-local
  SQLite `ces.db` + local blob store satisfies R1–R8 at single-operator scale, and the L3
  integrity/isolation requirements above still apply to that local store.
- **Waive — none.** Integrity, retention, and isolation are mandatory everywhere.

### SPEC-12 — Deployment & Operations → target **L2**
Ground: `core/SPEC-12.md` profile hooks. **Cited waiver, not implicit:** CES is **operator-local /
pre-SaaS** per `docs/saas-readiness.md` — the EO/AO Express servers and Stamper run on a single
operator workstation with a local SQLite `ces.db` and local artifacts. The profile targets **L2**
(deploy / rollback / env-matrix / backup documented, consistent, exercised for the operator-local
model) rather than **L3** (containerized, automated promotion, orchestrated blue/green); L3 deploy
automation is deferred until hosted multi-tenant demand justifies it.
- **Tighten — R4 to L3 (manual-step register mandatory).** CES has irreducible manual steps gating live
  operation — certificate-based auth setup, tenant admin-consent grants, GCC High endpoint/egress
  configuration. These MUST be captured in a manual-step register (this is where SPEC-01.R9-waived ACs
  land); an unregistered manual step is a hard fail because it directly blocks live-tenant execution.
- **Tighten — R6 pairs with SPEC-11.** Backup/restore MUST include the evidence blob artifacts (not
  only `ces.db`) and re-verify evidence content hashes post-restore (SPEC-11.R3/R4/R8).
- **Acknowledge — R5 promotion is lightweight today** (documented `build:core` + release-checklist
  path, not a multi-stage orchestrator); the L2 target accepts this. Revisit at containerization
  (saas-readiness phase 1).
- **Waive — none outright.** The L2 target itself is the scoping mechanism; individual requirements are
  met at operator-local scale, with R4 and R6 tightened as above.

---

## How G-SPEC-2 and G-SPEC-3 consume this profile

- **G-SPEC-2 (score)** reads the target level per dimension here and applies SPEC-00.R6: a cell **meets
  ideal** iff `as-is ≥ target`. Waivers here map to `N/A` per SPEC-00.R7. Tightenings that add a CES
  requirement are scored like any core requirement (SPEC-00.R2–R5).
- **G-SPEC-3 (diff)** flags a **gap only where `as-is < target`** (SPEC-00.R6) — never against a blanket
  L3. The `*(target, not yet met)*` dimensions (SPEC-05, SPEC-07) are the expected standing gaps.
