# AS-IS — ces-eo — 2026-07-04 (commit a0d6ae1)

EvidenceOps: the assessment + SSP/POA&M document-generation service (Express + `docx`). This
baseline is read-only analysis scored against SPEC-01..12 per the SPEC-00 maturity ladder
(L0 Absent / L1 Ad hoc / L2 Systematic / L3 Enforced). Every score cites current `file:line` or
command output on branch `g0-safety-net` at commit `a0d6ae1`; the 2026-07-01 `SPEC_RECON.md` map
was treated as stale and re-verified.

> **Two sharpest findings, surfaced up front:**
> 1. **Endpoint auth is OFF BY DEFAULT.** The bearer-token middleware is wired
>    (`src/eo/server/EoServer.ts:198`) but is a **no-op whenever `CES_EO_AUTH_TOKEN` is unset**
>    (`src/eo/server/authMiddleware.ts:39-46`) — the default deployment exposes all 104 `/api/*`
>    routes unauthenticated. Not a live-secret exposure, so no session pause per the G-SPEC-2
>    protocol; recorded here and escalated in the turn summary.
> 2. **Three production npm-audit vulnerabilities** — the ONLY module in the monorepo with audit
>    findings. `npm audit --omit=dev` in `ces-eo/`: `js-yaml <3.15.0` (moderate, quadratic-DoS),
>    `multer 1.0.0-2.1.1` (**high**, DoS via nested field names / aborted-upload cleanup),
>    `uuid <11.1.1` (moderate, buffer bounds). `npm audit fix` available for js-yaml/multer;
>    uuid needs `--force` (breaking). No CI gate runs `npm audit`, so these persist unflagged.
>    (Shared measurements attributed the high to js-yaml; the live run shows it is **multer**.)

---

## 1. Identity

| Property | Value |
|---|---|
| Package | `ces-eo` v`0.1.0` (`ces-eo/package.json:2-3`) |
| Description | "Continuous compliance evidence collection and drift monitoring for CMMC L2 on M365 GCC High" |
| Source size | 26,409 src LOC (ts/tsx, excl. tests) — shared measurements |
| Test files | 49 (`.test.ts`); suite 548 pass +3 skipped — shared measurements |
| Entry points | `dist/eo/index.js` (`main`); scripts `start:eo`, `dev:eo` (`package.json:8-13`) |
| HTTP server | `src/eo/server/EoServer.ts` — **4,100 lines**, single-file monolith, 104 route registrations |
| Default port | `4002` (`src/eo/config/EoConfig.ts:10`) |
| Doc engine | `docx@^8.5.0` via `SspDocxExporter`, `PoamDocxExporter`, `BaseDocxRenderer`, personnel/risk renderers |
| Persistence | file-based stores under `config.storageRoot` (per-tenant); `DeterminationLedger` unified spine |

---

## 2. Scorecard

| # | Dimension | Level | One-line justification |
|---|---|:--:|---|
| 01 | Concept & Requirements | **L1** | 548-test suite + persona views exist, but no numbered requirement register machine-linked to tests |
| 02 | Architecture & Design | **L1** | 4,100-line / 104-route monolith `EoServer.ts`; no ADRs, no machine-checked module boundaries |
| 03 | API & Contracts | **L1** | No API versioning, no OpenAPI, ad-hoc `{error}` JSON (not problem+json); Zod only on some routes |
| 04 | Security | **L1** | Auth off-by-default; 3 unremediated prod vulns; uploads to `os.tmpdir()` — security present, not default-on |
| 05 | Testing | **L2** | Golden SSP reference test + 548-test suite applied consistently; but coverage `--no-coverage`, no gate |
| 06 | Packaging & Release | **L1** | v0.1.0 + `CHANGELOG.md` present; no SemVer enforcement, no build provenance/release automation |
| 07 | CI/CD | **L1** | Single `npm test` gate; no lint/typecheck/coverage/audit gate |
| 08 | Configuration | **L2** | `EoConfig` Zod schema `safeParse` at startup, throws on invalid, typed immutable export — the exemplar |
| 09 | Observability | **L1** | 280 `console.*` calls, `winston` declared-but-unused; no structured logs, no correlation IDs |
| 10 | Documentation | **L1** | **No root README**; CHANGELOG + scattered `docs/` present, but no ADRs, no reference doc |
| 11 | Data & Persistence | **L1** | File-based per-tenant stores + SHA-256 evidence hashing, but no migrations, no enforced WORM in EO |
| 12 | Deployment & Operations | **L1** | `start:eo`/`dev:eo` scripts only; no rollback, no deploy runbook, no environments register |

---

## 3. Evidence

### 01 — Concept & Requirements — L1
- Broad behavioral coverage exists: 548-test suite (shared measurements) and persona-scoped views
  (`/api/personas`, `/api/persona/:id` — `EoServer.ts:961,973`) surface requirements by role.
- **Gap:** no numbered requirement register (`SPEC-NN.Rk`-style) whose IDs are machine-traced to
  tests; traceability is by convention, not enforced. → L1 (present, not systematic).

### 02 — Architecture & Design — L1
- The HTTP tier is a single 4,100-line file with 104 route registrations
  (`EoServer.ts` — `wc -l`, `grep .get/.post`), the antithesis of bounded C4 components.
- No ADRs: `docs/architecture/` holds narrative specs (`session-controlled-byod-narrative-spec.md`),
  not decision records; no dependency-rule linting.
- **Strength:** `DeterminationLedger` is explicitly **pure + additive** — composes the four
  historically-independent status worlds into one per-objective spine without mutating
  `ControlAssessor` (`src/eo/assessment/DeterminationLedger.ts:1-13`). → L1.

### 03 — API & Contracts — L1
- No API version segment/header anywhere: `grep -rE '/v1|/v2|api-version'` on routes → only Graph
  API URLs inside templates, none on EO's own surface (shared measurements confirm).
- No OpenAPI/swagger anywhere in `src` (`grep -rni openapi|swagger` → 0).
- Errors are ad-hoc `{ error: '...' }` JSON, not RFC 9457 problem+json
  (`authMiddleware.ts:48,55`; `sendError` helper used at ~279 sites).
- Partial request validation: 27 `z.`/`.parse` references in `EoServer.ts` — Zod on some bodies,
  not a uniform boundary contract. One cross-module contract `docs/stamper-eo-schema-contract.md`
  is status **DRAFT**. → L1.

### 04 — Security — L1
- **Auth off-by-default (primary finding):** middleware wired at `EoServer.ts:198` but
  `authMiddleware.ts:39` returns `next()` immediately when the token is empty/unset; the header
  comment states plainly "OFF BY DEFAULT ... existing local/dev/test behavior is unchanged"
  (`authMiddleware.ts:1-7`). GUI/static paths are never guarded even when enabled
  (`authMiddleware.ts:44`).
- **3 production vulnerabilities** (see banner) — `npm audit --omit=dev` output; only module with
  findings; no CI `npm audit` gate.
- Uploads land in `os.tmpdir()` (`EoServer.ts:216`) with a 10 MB `fileSize` limit and an
  extension allowlist (`EoServer.ts:221-233`) — **but no auto-cleanup of the tmp upload** (the
  aborted-upload cleanup gap is exactly the multer high CVE); `StorageCleanupService.cleanTempFiles`
  (`EoServer.ts:1402`) prunes `storageRoot`, not `os.tmpdir()`.
- **Strength:** when enabled, auth supports an optional `CES_EO_TENANT` pin returning 403 on tenant
  mismatch (`authMiddleware.ts:52-58`). → L1 (mechanisms exist but are not default-on).

### 05 — Testing — L2
- **Golden SSP reference test** (`tests/ssp/ssp-golden-reference.test.ts:1-12`): a structural
  characterization guard using explicit field-presence assertions so additive SSP fields cannot
  silently drop existing output — textbook Feathers golden-master.
- 548-test suite across 49 files, ratio 1.9 test-files/1k LOC (shared measurements) — applied
  consistently across assessment/ssp/poam/mapping.
- **Cap at L2:** `test = "jest --no-coverage"` (`package.json:11`) — coverage is neither measured
  nor threshold-gated (shared measurements confirm no coverage tooling/threshold in any module). No
  L3 enforcement mechanism. → L2.

### 06 — Packaging & Release — L1
- Versioned `0.1.0` and a maintained `CHANGELOG.md` (+ dated `CHANGELOG-2026-04-20.md`) exist.
- No SemVer gate, no build provenance/SLSA attestation, no release automation; `build` is bare
  `tsc` (`package.json:7`). → L1.

### 07 — CI/CD — L1
- `.github/workflows/ci.yml` runs only `npm ci` + `npm test` (shared measurements) — no lint,
  typecheck, coverage, `npm audit`, or golden-diff gate. A single test gate is L1 per SPEC-07. → L1.

### 08 — Configuration — L2 (exemplar)
- One config layer: `EoConfig.ts` defines a Zod `EoConfigSchema` (`EoConfig.ts:9-24`), reads env
  with safe defaults, `safeParse`s at startup and **throws a formatted error on invalid config**
  (`EoConfig.ts:167-172`), then returns a typed `EoConfig` object — fail-loud-and-early, the
  12-factor ideal.
- **Cap at L2, not L3:** the validation is a runtime startup boundary (a genuine schema-at-boundary
  mechanism per SPEC-00.R3), but config is not fully single-sourced — `authMiddleware.ts:20` reads
  `process.env.CES_EO_AUTH_TOKEN` directly outside the validated layer. No CI/test asserts the
  schema, so no build-fail enforcement. → L2.

### 09 — Observability — L1
- 280 `console.*` calls across `src` (`grep -rE 'console.(log|error|warn|info)'`) — unstructured,
  no severity taxonomy, no request/correlation ID threading.
- **`winston@^3.14.0` is declared in `package.json:29` but imported nowhere in `src`** (0 hits) — a
  dead dependency; logging is console-only.
- No centralized Express error handler (`grep 'app.use((err'` → 0); consistency comes from ~279
  `sendError` call sites, which is a real strength for uniform error *responses* but not for
  observability. → L1.

### 10 — Documentation — L1
- **No root README** in `ces-eo/` (`ls ces-eo/README.md` → not found) — the reference-doc corner of
  Diátaxis is absent for the largest HTTP surface in the repo.
- `docs/` has 12+ files (PROGRESS-REPORT, schema contracts, action plans) and a `CHANGELOG.md`, but
  no ADR directory; `docs/architecture/` holds narrative specs, not decision records. → L1.

### 11 — Data & Persistence — L1
- File-based stores keyed to `config.storageRoot` (Personnel/Training/Risk/Offboarding stores,
  `EoServer.ts:205-213`); per-tenant isolation via `storageRoot`; SHA-256 evidence hashing appears
  throughout SSP templates. `DeterminationLedger`/`PoamLedgerStore` provide a unified status spine.
- **Gap:** no schema migrations (JSON stores), no EO-enforced WORM/append-only, no stated retention
  mechanism inside EO (retention text lives in generated narratives, not enforcement). → L1.

### 12 — Deployment & Operations — L1
- `start:eo` (prod) and `dev:eo` (tsx) scripts exist (`package.json:9-10`); can be stood up locally.
- No rollback procedure, no deploy runbook, no named dev/CI/live environment register, no
  backup/restore drill. → L1.

### Recorded strengths (net)
1. **Golden SSP reference test** — no-drop structural guard on the flagship output.
2. **Zod-validated `EoConfig` with startup throw** — the config exemplar for the monorepo.
3. **548-test suite** — the densest behavioral coverage of any module by absolute count.
4. **`DeterminationLedger` unified spine** — pure/additive composition of four status worlds.
5. **~279 `sendError` call sites** — uniform error-response shape across the whole surface.

---

## 4. Contracts

| Seam | Direction | Validation status |
|---|---|---|
| Stamper→EO assessment schema (`docs/stamper-eo-schema-contract.md`) | consumed | **DRAFT** — not ratified while prod depends on it |
| Tenant config (`ces-shared/config` → `loadTenantConfig`) | consumed | Zod-validated in `EoConfig` (`EoConfig.ts:167`) |
| CMMC L2 controls / SPRS weights (`ces-shared/data/*`) | consumed | resolved via `require.resolve`, no runtime schema check |
| `/api/*` HTTP surface (104 routes) | exposed | **unversioned, partial Zod, auth off-by-default** |
| Evidence blob storage (`ces-shared/blob`) | consumed | stubbed virtually in tests; no boundary contract |
| SSP/POA&M `docx` artifacts | exposed | golden-reference structural test guards field presence |

---

## 5. Watchlist

- **Auth default posture** — flipping `CES_EO_AUTH_TOKEN` to required (or shipping a secure default)
  would move SPEC-04 off L1; currently a one-env-var gap between exposed and guarded.
- **The 3 npm-audit vulns** — `npm audit fix` clears js-yaml + multer today; uuid needs a breaking
  bump. Will change SPEC-04 the moment a G-goal remediates them.
- **`EoServer.ts` monolith** — 4,100 lines / 104 routes; any decomposition into routers changes
  SPEC-02 and enables per-route contract work (SPEC-03).
- **Coverage** — the suite is large but unmeasured; adding `@vitest`/jest coverage + a threshold is
  the single change that could take SPEC-05 toward L3.
- **Newly-added layers** (`DeterminationLedger`, POA&M lifecycle, persona views) are recent and
  additive — their tests are green now; watch for contract drift as the SSP consumes them.
- **`winston` dead dependency** — either wire structured logging (raises SPEC-09) or drop the dep.
