# AS-IS — ces-stamper — 2026-07-04 (commit a0d6ae1)

Evidence-cited engineering baseline for **ces-stamper** — the TypeScript execution engine that
translates mission plans into M365/Azure GCC High changes (PowerShell/Graph/ARM/IPPS channels),
captures hashed evidence, and drives the GUI/CLI. Read-only audit; zero product/config/test change.
Every score cites current `file:line` or command output at this commit (the 2026-07-01
`docs/context/SPEC_RECON.md` map was verified, not trusted — two of its claims are **corrected below**:
"Winston structured logging" and a fixed "6-yr retention field").

---

## 1. Identity

| Field | Value |
|---|---|
| Package | `ces-stamper` · `version 0.1.0` (`package.json:4`) · `type: module`, license `PROPRIETARY` |
| Purpose | CMMC L2 orchestration engine for M365/Azure GCC High — plan→execute→evidence |
| Source size | 22,843 src LOC (ts, excl. tests) · 14 test files · 0.6 test-files/1k LOC (`measurements-2026-07-04.md`) |
| Entry points | CLI `bin: stamper → dist/cli/index.js`; library exports: config, session, PowerShell adapter, registry, schema (`package.json` `exports`) |
| HTTP surface | Express GUI server, 12 route files (`src/server/routes/*.ts`); mounted in `src/server/GuiServer.ts:296-344`; `express.json({limit:'5mb'})` |
| Execution channels | PowerShell (Graph/EXO/IPPS/**ARM**), API, Bicep, CLI, ManualGate adapters (`src/adapters/*`) |
| Persistence | Evidence artifacts + metadata via `EvidenceStore` → ces-shared unified repo (tenant-isolated) |
| Test runner | jest (ESM via ts-jest), `jest.config.cjs` — **no coverage/threshold config** |
| Supply chain | 0 production vulnerabilities (`npm audit --omit=dev`) |

---

## 2. Scorecard

| # | Dimension | Level | One-line justification |
|---|---|---|---|
| 01 | Concept & Requirements | **L1** | Product intent in README; no personas / `US-`/`REQ-` IDs / acceptance criteria in-module |
| 02 | Architecture & Design | **L2** | 4 ADRs + adapter/stack-provider seam (ADR-003); no machine-enforced dependency check in CI |
| 03 | API & Contracts | **L1** | 12 routes, **0 versioned**, request bodies not schema-validated; 1 contract test; cross-module schema DRAFT |
| 04 | Security | **L1** | Cert app-only auth + cert-exists check + dryRun-default, but plaintext `--cert-password` flag, **no route authN**, unescaped PS template interpolation |
| 05 | Testing | **L1** | 14 files (unit + 1 contract tier); no coverage measured/gated; adapters/translators largely untested |
| 06 | Packaging & Release | **L1** | Builds via `npm ci`+lockfile, but version frozen at scaffold `0.1.0`, **no CHANGELOG** |
| 07 | CI/CD | **L1** | CI on push+PR runs build+test only; no lint / typecheck / coverage / `npm audit` gate |
| 08 | Configuration | **L1** | Central `StamperConfig` with fail-fast validation, but **49 `process.env` reads across 10 files** |
| 09 | Observability | **L1** | Strong evidence audit trail (who/what/when/hash), but logging is `console.*` sprawl; **winston imported yet unused**; silent `catch {}` swallows |
| 10 | Documentation | **L2** | README (purpose/run/test) + 4 numbered ADRs + GCC High setup; no CI doc-presence gate |
| 11 | Data & Persistence | **L2** | Single repo layer, SHA-256 hash on every evidence record, tenant identity, Zod retention/WORM fields; no enforced WORM/migration gate |
| 12 | Deployment & Operations | **L1** | Bootstrap script + README GCC High setup + rollback code, but no environment matrix / tested rollback / runbook |

Compact: `01 L1 · 02 L2 · 03 L1 · 04 L1 · 05 L1 · 06 L1 · 07 L1 · 08 L1 · 09 L1 · 10 L2 · 11 L2 · 12 L1`.

---

## 3. Evidence

### SPEC-01 Concept & Requirements — L1
- **Met (R1):** product intent of record — `README.md:1-9` (`# Enclave Stamper` + `## Overview`) names problem/outcome.
- **Gap:** no personas, no `US-`/`REQ-` story IDs, no acceptance criteria inside the module (grep for `US-`/`REQ-` in `src`/README → none). Requirements traceability lives in the shared spec library, not this module.

### SPEC-02 Architecture & Design — L2
- **Met (R1/R2/R3):** `docs/adr/ADR-001..004` (identity model, unified persistence, **stack-provider seam ADR-003**, reserved capabilities); one-responsibility module with declared public surface (`package.json` `exports`); domain reaches IO through the `IEngineAdapter` seam (`src/adapters/IEngineAdapter.ts`) and `getActiveStackProvider` (`src/config/StamperConfig.ts:6,26-39`) — endpoints resolved behind the seam, not inlined.
- **Gap (R4, L3):** no `madge --circular` / dependency-cruiser / restricted-path check in CI (`.github/workflows/ci.yml` runs only `npm ci` + `npm test`) — dependency rules are documented, not machine-enforced. Caps below L3.
- **Strength:** stack-provider seam (ADR-003) is a real, exercised abstraction (Microsoft GCC-High reference provider), keeping cloud endpoints/conventions out of engine internals.

### SPEC-03 API & Contracts — L1
- **Gap (R1):** 0 of 12 route files carry a version segment/header (`measurements-2026-07-04.md`; grep `/v1|/v2` in routes → none).
- **Gap (R2/R3):** HTTP request bodies are not schema-validated at the boundary — routes `JSON.parse(fs.readFileSync(...))` tenant/plan files (`src/server/routes/assess.routes.ts:37,167,885`, `baseline.routes.ts:94`) rather than `safeParse`-ing request input; Zod schemas exist for artifacts (`src/types/schema.types.ts`, `ces-artifacts.types.ts`) but are not bound to endpoints.
- **Partial strength:** one cross-module contract test exists (`tests/directive-migration.contract.test.ts`); the stamper↔eo schema contract is DRAFT (`docs/stamper-eo-schema-contract.md`, per measurements).

### SPEC-04 Security — L1
- **Finding (R3 automatic-fail):** plaintext `--cert-password <password>` CLI flag **still present** — `src/cli/index.ts:371`; the value is interpolated into a PowerShell arg at `src/cli/index.ts:410-413` (`ConvertTo-SecureString -String "${options.certPassword}" -AsPlainText`), guarded only by a `console.warn`.
- **Finding (R1):** **no authentication middleware on any route** — grep `requireAuth|bearer|x-api-key|authorization` over `src/server` → zero; `GuiServer` mounts all 12 routers unauthenticated (`src/server/GuiServer.ts:296-344`). (Localhost GUI, but authN is defaults-off.)
- **Injection surface (unguarded):** `interpolateVariables()` does naive `String(value)` substitution of `{key}`/`${key}` into command templates with **no shell/PS escaping** (`src/adapters/PowerShellAdapter.ts:1597-1609`); the resolved string is executed via `spawn('powershell.exe', ['-ExecutionPolicy','Bypass','-Command', script])` (`:1620-1629`). Plan-derived commands and runtime-captured values reach the shell verbatim.
- **Strengths (record explicitly):** cert-based **app-only** auth with certificate-existence validation (`src/config/StamperConfig.ts:124-128`); `Connect-*` use certificate thumbprint + service principal, never passwords (`PowerShellAdapter.ts:1564-1586`); `dryRun` is enforced first across **every** adapter (APIAdapter/BicepAdapter/CLIAdapter/IPPSAdapter/ManualGate/PowerShell all short-circuit on `dryRun`, e.g. `PowerShellAdapter.ts:134,636`, `APIAdapter.ts:35`) and `dryRun` defaults true in `fromTenantConfig` (`StamperConfig.ts:261`).

### SPEC-05 Testing — L1
- 14 test files: unit tier (`tests/unit/*` — StamperConfig, PowerShellAdapter, PlanTranslator, DependencyResolver, EvidenceStoreIdentity, retryWithBackoff, …), registry tier (`tests/registry/CommandRegistry.test.ts`), one contract test (`tests/directive-migration.contract.test.ts`). No golden/integration/E2E tier named.
- **Gap (coverage):** `jest.config.cjs` has no `collectCoverage`/`coverageThreshold`; no module can produce or gate a coverage number (`measurements-2026-07-04.md`). Ratio 0.6 test-files/1k LOC.
- **Gap:** `APIAdapter`, `BicepAdapter`, `CLIAdapter`, and the translators have no colocated unit tests (only `PowerShellAdapter` among adapters is tested).

### SPEC-06 Packaging & Release — L1
- **Gap (R1):** `version` frozen at scaffold `0.1.0` (`package.json:4`) despite large feature history.
- **Gap (R3):** no `CHANGELOG.md` in the module (confirmed absent).
- **Partial (R4):** CI installs from committed lockfile with `npm ci` and pinned Node 24 (`.github/workflows/ci.yml`).

### SPEC-07 CI/CD — L1
- **Met (R1):** workflow triggers on `push` (master, g0-safety-net) + `pull_request` (`.github/workflows/ci.yml:6-9`).
- **Gap:** only two run steps — `npm ci` and `npm test` (build happens via root pretest). **No** lint gate, typecheck (`tsc --noEmit`) gate, coverage gate, or `npm audit` gate. The `lint` script (`eslint src`, `package.json`) has **no eslint config file** present (no `.eslintrc*`/`eslint.config.*`/`eslintConfig`), so lint is effectively unconfigured.

### SPEC-08 Configuration — L1
- **Strength:** single central config class `StamperConfig` with **fail-fast** `validateConfig()` throwing an aggregated field-level error (`src/config/StamperConfig.ts:111-134`), plus `ensureDirectories()` and a stack-aware default resolver.
- **Gap (R3):** **49 `process.env` reads across 10 files** (grep count) — outside the config layer: `APIAdapter.ts`, `SessionManager.ts`, `EvidenceReadinessAnalyzer.ts`, `GuiServer.ts`, and routes `assess/execute/variables`; even `StamperConfig.clientName` reads `process.env.CLIENT_NAME` directly (`:232`). Config is not Zod-schema-validated (manual `if`-checks), capping fail-fast at L2 intent.

### SPEC-09 Observability — L1  *(corrects recon "Winston structured logging (10+ files)")*
- **Correction:** `winston` is a declared dependency (`package.json`) but has **zero call sites** in `src` (grep `winston|createLogger` → none). Application logging is `console.*` sprawl across 20+ files (`PowerShellAdapter`, `SessionManager`, `StamperEngine`, routes, reporting, …). This trips SPEC-09.R2's explicit "logger imported but unused" and "no `console.*` sprawl" checks.
- **Silent swallowing:** numerous `catch { /* best-effort */ }` blocks discard errors (e.g. `PowerShellAdapter.ts:425,466,478,495,539,605,759,1073,1140,1167`), against R (no silent error swallowing).
- **Strength (audit trail, R4):** every evidence record carries a structured audit envelope — `metadata.{controlIds, timestamp, executorIdentity, commandExecuted, sha256Hash, moduleVersions, environment, pre/postState}` (`src/utils/structuredEvidence.ts:436-447`) — a genuine who/what/when/outcome trail for privileged capture actions.

### SPEC-10 Documentation — L2
- **Met (R1):** `README.md` present with purpose/run/test coverage — `## Overview`, `## Installation`, `## Usage` (Execute/Dry-Run/Validate), `## Development` (Build/Watch/Testing), `## GCC High Setup`, `## Evidence Storage`, `## Architecture`.
- **Met (R3):** four numbered ADRs with Context/Decision/Status/Consequences (`docs/adr/ADR-001..004`).
- **Gap (L3):** no CI presence-check enforcing README/ADR completeness; runbook coverage is partial (README GCC High Setup, not a dedicated `docs/runbooks/stamper.md`).

### SPEC-11 Data & Persistence — L2  *(strongest dimension)*
- **Met (R1):** all evidence reads/writes go through `EvidenceStore` → ces-shared unified repo, tenant-scoped by ces identity (`src/evidence/EvidenceStore.ts:81-88`); content stays a file, metadata in the repo.
- **Met (R3, integrity):** SHA-256 content hash computed at write time for every artifact — `EvidenceStore.ts:62,114` via `HashingService.computeFileHash` (`src/evidence/HashingService.ts:6-11`); the inline evidence path also hashes rawResponse (`structuredEvidence.ts:399`). Covered by `tests/unit/EvidenceStoreIdentity.test.ts`.
- **Retention (corrects recon "6-yr field"):** retention is a **parameterized, Zod-validated** field, not a fixed 6-year literal — `retention_days: z.number().int().min(0)` and `worm_retention_days: z.number().int().min(365)` (`src/types/ces-artifacts.types.ts:82,118,448`); passed through `EvidenceStore.storeArtifact(retentionDays)` into `metadata.retention_days` (`EvidenceStore.ts:47,75`).
- **Gap (L3):** no enforced WORM immutability at the storage layer and no versioned migration gate — integrity is hash-detectable, not tamper-prevented. Blob path stamping avoids 409 overwrite (`structuredEvidence.ts:454-457`) but is not object-lock.

### SPEC-12 Deployment & Operations — L1
- **Partial (R1):** `bootstrap` CLI command wraps `New-TenantBootstrap.ps1` (`src/cli/index.ts:365-428`); README `## GCC High Setup` documents connect steps; `connect` guidance emitted at `cli/index.ts:540`.
- **Rollback code exists** (`src/rollback/RollbackHandler.ts`, `enableRollback` config default-on `StamperConfig.ts:106`) but no documented, exercised rollback procedure.
- **Gap:** no environment matrix (dev/CI/live) doc, no `docs/runbooks/stamper.md` with the four required sections.

---

## 4. Contracts

| Seam | Direction | Shape / locator | Validation status |
|---|---|---|---|
| Mission plan (directive) schema | consumes (from planner) | `src/types/schema.types.ts`, translators `src/translators/PlanTranslator.ts` | Zod-typed; migration covered by `tests/directive-migration.contract.test.ts` |
| Stamper→EO evidence/directive schema | exposes (to EvidenceOps) | `docs/stamper-eo-schema-contract.md` | **DRAFT** — no dual-sided contract test binding producer+consumer |
| Structured evidence artifact | exposes (to EO / blob store) | `StructuredEvidence` (`src/types/schema.types.ts`), built in `structuredEvidence.ts:410-448` | SHA-256 hashed + metadata; no published JSON Schema/version segment |
| Command registry entries | internal | `*.registry.json` + Zod `command-registry.types.ts` | Zod-validated on load (`src/registry/CommandRegistry.ts`) |
| Stack-provider capabilities | consumes (from ces-shared) | `getActiveStackProvider` (ADR-003), `StamperConfig.ts:26-39` | typed capability object; default `microsoft-gcc-high` |
| ces-shared unified repository | consumes | `EvidenceStore` → `repo.put(EVIDENCE_META_COLLECTION,...)` | tenant-isolated by ces identity; no schema gate on collection |
| HTTP GUI API | exposes | 12 routers, `GuiServer.ts:296-344` | **unversioned, no request-schema validation, no authN** |

---

## 5. Watchlist

- **ARM channel is new this session** (`PowerShellAdapter.buildGCCHighConnection` — `needsAz` regex `:1551`, `Connect-AzAccount -ServicePrincipal … -Environment AzureUSGovernment` + `Set-AzContext -Subscription $azSubscription` `:1581-1586`; `SessionManager.ts:412-414`; `StamperConfig.subscriptionId :171-173`). Lightly tested; its injection/permission-error paths will move SPEC-04/05 scores as coverage lands.
- **`--cert-password` flag + no route authN + unescaped PS interpolation** are the security items most likely to be remediated by a future G-goal; each is an SPEC-04 automatic-fail / hard gap today (flagged, not fixed, per G-SPEC-2 read-only scope). Not a *live* secret exposure — a CLI-input surface — so no session pause required.
- **Coverage & lint are unmeasurable/unconfigured today** (no jest coverage config, no eslint config file). Adding `@vitest/coverage`-equivalent + eslint config + CI gates would immediately reprice SPEC-05 and SPEC-07.
- **Version `0.1.0` + missing CHANGELOG** — the first real release bump will move SPEC-06.
- **Winston dependency is dead weight** — either wire it as the single structured-logging path (raising SPEC-09) or drop it; current `console.*` sprawl + silent `catch {}` is the standing SPEC-09 deferral.
- **Recon (`SPEC_RECON.md`, 2026-07-01) is stale** on two stamper claims corrected here: "Winston structured logging (10+ files)" (actually unused) and a fixed "6-yr retention field" (actually a parameterized `retention_days`/`worm_retention_days≥365` Zod field).
