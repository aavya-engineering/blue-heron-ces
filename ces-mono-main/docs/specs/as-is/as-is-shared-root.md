# AS-IS — ces-shared + root — 2026-07-04 (commit a0d6ae1)

Evidence-cited engineering baseline for the **shared spine** (`ces-shared`) plus the **monorepo
root** (workspace config, build/test scripts, CI, hygiene) and the **cross-module contract
inventory**. Scored against SPEC-01..12 and the SPEC-00 maturity model (L0 Absent · L1 Ad hoc ·
L2 Systematic · L3 Enforced). Read-only audit: zero product/config/test changes. Every non-L0
score cites a current `file:line` or the shared measurement pass (`measurements-2026-07-04.md`);
the 2026-07-01 recon was treated as a stale map, not evidence.

Scope note: `ces-shared` is a **library** (no HTTP surface, no ports), so SPEC-03/09 are scored
against its *contract* and *audit/persistence* roles, not against network endpoints. Deployment/CI
requirements are scored against the **root**, which owns the aggregate build+test contract and the
single CI gate.

---

## Identity

| Attribute | Value | Evidence |
|---|---|---|
| Shared package | `ces-shared` v**0.1.0**, `type: module`, `PROPRIETARY` | `ces-shared/package.json:2-4,46` |
| Shared src size | **2,811** LOC (ts/tsx, excl. tests); **11** test files | `measurements-2026-07-04.md:15` |
| Shared public surface | 34-subpath `exports` map (`./config`, `./config/ces`, `./persistence/node`, `./stack`, `./crypto`, `./types/*`, `./data/*`) | `ces-shared/package.json:6-41` |
| Barrel | `src/index.ts` re-exports only config/launcher/blob; everything else is subpath-only | `ces-shared/src/index.ts:4-19` |
| Runtime dep | `better-sqlite3 ^12.10.0` (the only prod dep); 0 prod vulns | `ces-shared/package.json:53-55`; `measurements-2026-07-04.md:45` |
| Strict TS | `strict: true`, `NodeNext`, declaration+maps, tests excluded from build | `ces-shared/tsconfig.json:9,3-5,13-16,19` |
| Monorepo | `cmmc-workspace` (private), **5** npm workspaces (shared/stamper/eo/ao/planner) | `package.json:1-10` |
| Root scripts | `build:core` (5-way build), `pretest` (builds shared+stamper), aggregate `test`, `sync-ui-assets`, dev runners on ports 5001-5004 | `package.json:11-31` |
| CI | `.github/workflows/ci.yml` — one job, two run steps: `npm ci` + `npm test` | `ci.yml:31-39` |
| Root hygiene gaps | **No** root `README.md`, **no** root eslint/prettier/tsconfig, **no** root `engines` | root `*.md` listing (no README); `package.json` (no engines) |
| Shared crypto | `canonicalSha256` / `canonicalJsonStringify` (order-stable SHA-256) | `ces-shared/src/crypto/canonicalHash.ts:29-36` |
| Persistence | `CesRepository` (better-sqlite3, WAL) → `{CES_PIPELINE_ROOT}/ces.db` | `ces-shared/src/persistence/CesRepository.ts:9,17-19,90` |
| ADRs | ADR-001 identity · ADR-002 persistence · ADR-003 stack seam · ADR-004 reserved capabilities | `docs/adr/ADR-00{1..4}-*.md` |

---

## Scorecard

| # | Dimension (SPEC) | Level | One-line justification |
|---|---|:--:|---|
| 01 | Concept & Requirements | **L1** | Ad hoc product/plan docs (`DESIGN.md`, `PLAN_V2.md`) but no canonical intent-of-record, no stable `US-`/req IDs, no traceability gate. |
| 02 | Architecture & Design | **L2** | 4 numbered immutable ADRs, module map, written dependency direction, centralized shared package; not L3 — no machine dependency check (R4) and seams not all ratified (R8). |
| 03 | API & Contracts | **L1** | Real both-sides validators for config/stack seams, but the flagship stamper↔EO contract is **DRAFT/unratified** (R7), collections are untyped `unknown`, and there is no versioned contract inventory or diff gate. |
| 04 | Security | **L2** | Centralized config + `secretRef` (no plaintext secrets), lockfile-pinned `npm ci`, 0 shared prod vulns; not L3 — no CI `npm audit` gate (R11), no SBOM (R13). |
| 05 | Testing | **L1** | Strong unit + characterization + contract tests (102 green), but **coverage is not measured anywhere** (no `@vitest/coverage-v8`) and no threshold — caps below R7 (L2). |
| 06 | Packaging & Release | **L1** | Version **frozen at 0.1.0**, no `CHANGELOG.md`, no release artifacts/signing/SBOM; only the internal workspace-link "channel" exists, undocumented. |
| 07 | CI/CD | **L1** | Build+test gates present (`npm ci`+`npm test`), but **no lint, typecheck, coverage, audit, or golden-diff gate** — the two unmet L2 requirements (R3 lint, R4 typecheck) cap it. |
| 08 | Configuration | **L2** | One config layer, fail-fast `validateCesConfig`, typed+resolvers, env→config precedence; not L3 — hardcoded dev ports in root scripts (R4) and no enforced "no stray env reads" gate. |
| 09 | Observability | **L1** | No structured logger/correlation-ID/audit framework in the shared layer; only `createdAt/updatedAt` row timestamps. Not systematically addressed. |
| 10 | Documentation | **L1** | Rich `docs/` + ADRs (strength), but **no `ces-shared` README and no root README** — the mandatory per-module README (R1, L2) is unmet, capping the cell. |
| 11 | Data & Persistence | **L2** | `CesRepository` single scope-enforced choke point; empty scope throws (R6/R7 at L3, tested). Gaps: no numbered migrations (R2), no WORM guard (R4), no retention job (R5) — the reasons it is not L3. |
| 12 | Deployment & Operations | **L1** | `build:core` install path exists, but no deploy/install runbook, no rollback, no documented backup/restore for `ces.db` + blobs. |

Compact: **01 L1 · 02 L2 · 03 L1 · 04 L2 · 05 L1 · 06 L1 · 07 L1 · 08 L2 · 09 L1 · 10 L1 · 11 L2 · 12 L1.**

---

## Evidence

### SPEC-01 Concept & Requirements — L1
Product/plan docs exist at root (`DESIGN.md`, `PLAN_V2.md`, `PLAN_UI.md`) and a rich ideal-spec
library under `docs/specs/`, but there is no single canonical intent-of-record for the spine, no
personas/`US-` story IDs, and no enforced requirement→test traceability matrix (SPEC-01.R9/R10, L3
targets). Ad hoc, not systematic → **L1**.

### SPEC-02 Architecture & Design — L2 (strength)
- **Architecture of record + ADRs (R1/R7):** four numbered ADRs (`docs/adr/ADR-001..004`), each
  cited from the code they govern (`CesRepository.ts:7` → ADR-002; `StackProvider.ts:10` → ADR-003;
  `cesConfig.contract.ts:5` → ADR-001). ADRs are additive/immutable.
- **Dependency direction declared (R3) + centralized cross-cutting (R6):** the shared barrel is the
  single home for config/crypto/persistence/stack; `CesRepository.ts:2-3` states "NODE-ONLY … Do NOT
  import from FE/browser code," and consumers pull the shared implementation (e.g. AO imports
  `canonicalSha256 from 'ces-shared/crypto'`, `ApprovalStore.ts:8`) rather than forking it.
- **Public surface declared (R11):** `package.json:6-41` exports map is the surface; consumers use
  subpaths (`ces-shared/crypto`, `ces-shared/config/ces`). One minor deep-import into `dist` exists
  in a demo script (`ces-eo/scripts/gen-assessor-demo.mts`) — not enforced against.
- **Not L3:** no machine dependency check (madge/dependency-cruiser) in CI (R4, L3 target); not every
  seam resolves to a ratified contract (R8, L3 — the stamper↔EO contract is DRAFT); no god-file LOC
  budget lint (R10, L3).

### SPEC-03 API & Contracts — L1
The spine is where cross-module contracts live, and the picture is mixed:
- **Validated seams (good):** `validateCesConfig` (`cesConfig.contract.ts:69-121`) throws
  `CesConfigError` and rejects duplicate customerName/tenantSlug; `validateStackCapabilities`
  (`StackProvider.ts:70-107`) is invoked on every `StackRegistry.register` (`:114-116`). These are
  real both-sides contracts with a validator at the boundary.
- **Unratified flagship (finding):** the stamper↔EO directive-metadata contract is **DRAFT** —
  `ces-eo/docs/stamper-eo-schema-contract.md:4` reads `Status: DRAFT (pending Stamper team
  confirmation)`, dated 2026-04-20. SPEC-03.R7 (L3) requires ratified, not DRAFT.
- **Untyped persistence contract:** `CesRepository` stores `data: unknown` (`CesRepository.ts:36,155`),
  so collection payload shapes are not schema-checked at the boundary — each store casts.
- No contract version/changelog discipline, no contract-diff gate, no maintained endpoint/contract
  manifest. Inconsistent across the surface → **L1**.

### SPEC-04 Security — L2
- **No plaintext secrets / centralized config (R3/R4/R5):** `src/config/secretRef.ts` (+ test)
  provides secret *references* resolved through the config layer; product config is typed and
  centralized (`cesConfig.contract.ts`).
- **Reproducible tree (R12):** CI installs with `npm ci` from lockfile (`ci.yml:32`); `ces-shared`
  reports **0** production vulnerabilities (`measurements-2026-07-04.md:45`).
- **Not L3:** no CI dependency-audit gate (R11, L3) — `npm audit` runs nowhere in the pipeline
  (`measurements-2026-07-04.md:50`); no SBOM (R13, L3).

### SPEC-05 Testing — L1
- **Strengths:** 11 shared test files / 102 tests green (`measurements-2026-07-04.md:15,71-72`);
  named tiers incl. characterization (`persistence/CesRepository...` + `storage/PipelineStorage.characterization.test.ts`)
  and contract tests (`config/cesConfig.contract.test.ts`); deterministic via injectable clock
  (`CesRepository.ts:72-74,92`).
- **Cap:** coverage is **not measured** — `ces-shared` has no coverage tooling and no threshold
  (`measurements-2026-07-04.md:30`); SPEC-05.R7 (measure every run, L2) is unmet, so the cell cannot
  reach L2. → **L1**.

### SPEC-06 Packaging & Release — L1
`ces-shared` is frozen at **0.1.0** (`package.json:3`) with no `CHANGELOG.md` (R1/R3 unmet); no
signed/retained release artifacts, no SBOM (R5/R6, L3). The de-facto distribution channel is npm
workspace symlinking (`package.json:4-10`), undocumented (R7). A reproducible build path exists
(`build:core`, `package.json:22`) but versions do not move. → **L1**.

### SPEC-07 CI/CD — L1 (headline root finding)
`ci.yml` runs exactly two steps — `npm ci` (`:32`) and `npm test` (`:39`). Met: R1 (push+PR
triggers, `:7-10`), R2 build (pretest builds shared+stamper, `package.json:24`), R5 test gate. The
golden SSP reference test rides inside `npm test` (partial R8). **Absent:** lint gate (R3, L2),
typecheck-as-gate (R4, L2), coverage gate (R6), audit gate (R7), explicit golden-diff gate (R8),
branch protection (R9), promotion path (R10), artifact retention (R11). Two unmet **L2** requirements
(R3, R4) cap the cell at **L1** (`measurements-2026-07-04.md:64-69`).

### SPEC-08 Configuration — L2 (strength)
- **One validated config layer, fail-fast (R1/R2):** `validateCesConfig` throws structurally on bad
  input (`cesConfig.contract.ts:69-121`); typed `CesConfig` returned to consumers.
- **Centralized env access + no hardcoded store path (R3/R5):** `resolvePipelineRoot` takes env as a
  pure input with `env → config.pipelineRoot` precedence (`cesConfig.contract.ts:200-206`);
  `getCesDbPath` derives from the resolved root (`CesRepository.ts:17-19`).
- **Secrets referenced (R9):** `config/secretRef.ts`.
- **Not L3:** dev ports are hardcoded in root scripts (`package.json:13-16`, 5001-5004), tripping the
  "no hardcoded ports" L3 requirement (R4); no gate enforces "zero env reads outside config."

### SPEC-09 Observability — L1
The shared layer carries no structured logger, correlation-ID propagation, or audit-record framework
(those live in module servers, e.g. Stamper's Winston setup — out of this scope). Persistence rows
carry `createdAt/updatedAt` (`CesRepository.ts:161-190`) but that is provenance metadata, not an
observability path. Not systematically addressed at the spine/root → **L1**.

### SPEC-10 Documentation — L1
- **Strength:** four ADRs, `docs/context/MODULE_MAP.md`, `docs/NAMING-CONVENTION.md`, and the full
  `docs/specs/` ideal+as-is library.
- **Cap:** SPEC-10.R1 (README per module, L2) is unmet — there is **no `ces-shared/README.md` and no
  root `README.md`** (root `*.md` listing shows `DESIGN.md`/`PLAN_*` but no README). One mandatory L2
  requirement unmet → **L1**.

### SPEC-11 Data & Persistence — L2 (strength, isolation at L3)
- **Single persistence layer (R1):** all persistent CES objects flow through one `CesRepository`
  with a memoized per-file factory (`CesRepository.ts:283-307`); no scattered `new Database()` in
  feature code — collections are the interface (`adminops_approvals`, `adminops_evidence`,
  `eo_personnel`, etc.: `ces-ao/src/execution/ApprovalStore.ts:15`,
  `EvidenceEmitter.ts:14`, `ces-eo/src/eo/personnel/PersonnelStore.ts:15`).
- **Tenant isolation enforced at L3 (R6/R7):** `scopeClause` throws `CesScopeError` on an empty scope
  (`CesRepository.ts:120-143`), so every `get/list/update/delete` must name a scope — unscoped reads
  are impossible by construction; asserted by `CesRepository.test.ts` (two-tenant no-leak, per
  `ces-ao/test/cesIdentity.test.ts:89-115`). The `findById`/`listAll` escape hatches are documented
  as capability-keyed admin-only (`:241-262`).
- **Integrity hashing available (R3):** `canonicalSha256` gives order-stable content hashes
  (`canonicalHash.ts:29-36`), consumed for AO SoD `paramsHash` (`ApprovalStore.ts:8,46,77`).
- **Gaps vs the L3-mandatory CES target (why not L3, and the ladder tension):** schema is applied by
  an inline idempotent `CREATE TABLE IF NOT EXISTS`, **not** numbered forward-only migrations (R2);
  the repository exposes generic `update()`/`delete()` on *every* record — **no WORM/append-only
  guard** for integrity-critical classes (R4, L3); and **no retention job** enforces the 6-year CUI
  window (R5, L2). Isolation is the strength; WORM + retention + migrations are the open work.

### SPEC-12 Deployment & Operations — L1
Root supplies an install/build path (`npm ci`; `build:core`, `package.json:22`) and an artifact
migrator (`scripts/migrate-artifacts.mjs`), but there is no per-module deploy/install runbook (R1),
no rollback procedure (R2), and no documented+exercised backup/restore for `ces.db` + the local blob
store (R6). Target is L2 (pre-SaaS) — as-is is **L1**.

---

## Contracts — cross-module seam inventory

Every cross-module seam owned by or passing through the spine, with the side that produces it, the
side that consumes it, where its schema lives, and whether it is validated on **both** sides.

| Seam | Producer | Consumer | Schema / contract artifact | Validated both sides? |
|---|---|---|---|---|
| CES identity / customer↔tenant binding | operator `ces.config.json` (Planner-authored) | EO / AO / Stamper via `ces-shared/config/ces` | `cesConfig.contract.ts:38-121` (`validateCesConfig`, throws; dup keys rejected) | **Yes** — validator at load boundary; consumers get typed `CesConfig` |
| Stack-provider seam (ADR-003) | stack providers (`stack/providers/microsoftGccHigh.ts`, `exampleStub.ts`, GCC High endpoints) | subsystems resolving stack capabilities | `StackProvider.ts:40-107` (`validateStackCapabilities`) | **Yes** — `StackRegistry.register` validates on registration (`:114-116`) |
| Canonical hash / SoD `paramsHash` | `ces-shared/crypto` `canonicalSha256` | AO `ApprovalStore` (SoD binding), EO `EvidenceCaptureService` | `canonicalHash.ts:29-36` (shared pure fn) | **Yes (by construction)** — single shared impl, no forked copy |
| `CesRepository` collections (`adminops_approvals`, `adminops_evidence`, `eo_personnel`, …) | AO/EO stores writing records | same stores reading records | persistence contract = `CesRecordInput`/`CesRecord`, but `data: unknown` (`CesRepository.ts:32-49`) | **No** — payload shape untyped at the boundary; each store casts. Isolation *is* enforced (scope), payload schema is not |
| stamper↔EO directive-metadata (evidence) | Stamper evidence files (`directiveMetadata`) | EO assessment/narrative generation | `ces-eo/docs/stamper-eo-schema-contract.md` — **Status: DRAFT**, v1.0, 2026-04-20 (`:4`) | **No / asymmetric** — EO validates `directive` values on consume; producer has no shared validator; **contract unratified** (SPEC-03.R7 gap) |
| Mission-plan schema (Planner→Stamper) | Planner plan artifacts | Stamper ingest | shapes live in module code (`ces-planner` / `ces-stamper` types), **not** in the shared package | **No** — implicit cross-boundary shape; not centralized in `ces-shared` |
| Shared UI design system (`ces-ui.css` + brand assets) | `ces-shared/ui/ces-ui.css` (single re-themed source) | each module `public/` via `scripts/sync-ui-assets.mjs` | copy-sync manifest (`sync-ui-assets.mjs:21-30`) | **No automated check** — one canonical source (strength) but copies can drift; no guard asserting parity |

**Contract strengths:** the config and stack seams are genuine both-sides validated contracts; the
canonical-hash and UI-CSS seams have a single source of truth by construction/sync. **Contract
findings:** (1) the stamper↔EO seam is **DRAFT/unratified** and validated only on the consumer side;
(2) `CesRepository` payloads cross the boundary as `unknown`; (3) the mission-plan and UI-sync seams
have no boundary schema/parity check.

---

## Watchlist — items likely to move a score

- **CI uplift (SPEC-07 → could reach L2/L3):** adding lint (`--max-warnings 0`), `tsc --noEmit`,
  coverage-threshold, and `npm audit` gates to `ci.yml` would clear the R3/R4 cap and lift both
  SPEC-07 and SPEC-05. This is the single highest-leverage change for the root.
- **Coverage tooling (SPEC-05):** `@vitest/coverage-v8` is absent, so no shared coverage number
  exists today (`measurements-2026-07-04.md:30`); installing it + a threshold is a small, additive
  change that unblocks measurement.
- **Ratify the stamper↔EO contract (SPEC-02.R8/R03.R7):** moving
  `stamper-eo-schema-contract.md` out of DRAFT with a producer-side validator would lift the
  contract dimension and close the only truly-implicit high-traffic seam.
- **WORM + retention on `CesRepository` (SPEC-11 → L3 target):** the repo exposes generic
  `update`/`delete` and no retention job; a WORM guard for integrity-critical collections + a 6-year
  disposal path are the tracked gaps to the L3-mandatory persistence target (G10/G11 territory).
- **Root README + `ces-shared` README (SPEC-10):** two missing mandatory READMEs are the only thing
  capping SPEC-10 below L2.
- **Unfreeze versions + changelogs (SPEC-06):** `ces-shared` at 0.1.0 with no changelog; moving to
  SemVer + a `CHANGELOG.md` is the near-term packaging target.
- **UI-sync drift guard:** `sync-ui-assets.mjs` copies the canonical `ces-ui.css` into each module —
  a CI parity check would turn this from convention into an enforced contract.
- **`StamperConfig.subscriptionId`** was recently added (`ces-stamper/src/config/StamperConfig.ts:47`)
  for the ARM channel; not a shared-layer change but noted as an in-flight config-surface expansion
  that the stack-endpoints seam (`StackCloudEndpoints.arm`, `StackProvider.ts:19`) anticipates.
