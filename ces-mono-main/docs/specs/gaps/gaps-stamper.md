# GAP — ces-stamper — Ideal (CES profile) vs As-Is

**Series:** G-SPEC-3 (diff) · **Method:** `docs/G-SPEC-3-plan.md` · **Target levels:** `docs/specs/ideal/ces-profile.md`
**As-is baseline:** `docs/specs/as-is/as-is-stamper.md` (commit a0d6ae1) · **Read-only report; fixes nothing.**

A cell is **GAPPED** only where `as-is < target` (SPEC-00.R6). Cells at-or-above target are **MEETS**.
Findings already owned by an existing track (G8 risk-acceptances, Phase-3 G9–G14, punchlist) are
**DUP→<ref>** — cross-referenced, not re-raised. Evidence pointers cite the as-is baseline's `file:line`.

## Disposition matrix (12 cells)

| # | Dimension | Target | As-is | Disposition | New findings |
|---|---|---|---|---|---|
| 01 | Concept & Requirements | L3 | L1 | **GAPPED** | 1 (P2) |
| 02 | Architecture & Design | L2 (L3 on R4/R8/R10) | L2 | **GAPPED** (L3 tightening) | 1 (P2) |
| 03 | API & Contracts | L2 (L3 on R5/R7) | L1 | **GAPPED** | 3 (P2×2, P3×1) |
| 04 | Security | L3 | L1 | **GAPPED** | 3 (**P0×1**, P1×2) + 1 DUP |
| 05 | Testing | L3 *(stretch)* | L1 | **GAPPED** | 2 (P2) |
| 06 | Packaging & Release | L2 | L1 | **GAPPED** | 2 (P3) |
| 07 | CI/CD | L3 *(stretch)* | L1 | **GAPPED** | 3 (P2×2, P3×1) |
| 08 | Configuration | L3 | L1 | **GAPPED** | 3 (P2×2, P3×1) |
| 09 | Observability | L2 | L1 | **GAPPED** | 3 (P2) |
| 10 | Documentation | L2 | L2 | **MEETS** (base) / one R2 tightening gap | 1 (P3) |
| 11 | Data & Persistence | L3 (MANDATORY) | L2 | **GAPPED** | 0 new — all **DUP→G8/G10/G11** |
| 12 | Deployment & Operations | L2 | L1 | **GAPPED** | 2 (P2) |

**New-finding tally: P0:1 · P1:2 · P2:15 · P3:6 (24 total).** DUP references: SPEC-11 WORM + signing,
SPEC-04.R4 Key Vault secret store.

---

## Findings

### SPEC-01 — Concept & Requirements — GAPPED (L1 → L3)

**GAP-stamper-01.R12-1** — No in-module CMMC practice→requirement→test traceability. No personas, no
`US-`/`REQ-` story IDs, no acceptance criteria inside the module; traceability lives only in the shared
spec library, not enforced here. Profile makes R12 mandatory L3 (the compliance product's spine).
- Evidence: as-is §SPEC-01 (`README.md:1-9`; grep `US-`/`REQ-` in `src`/README → none).
- Severity **P2** · Effort **M** · Remediation: add an in-module requirement→test matrix anchored on
  CMMC practice IDs and the `ces-planner` characterization / EO golden-SSP anchor tests (profile R10).

### SPEC-02 — Architecture & Design — GAPPED on the L3 tightening (base L2 MEETS)

Base L2 is met (4 ADRs, adapter/stack-provider seam ADR-003, declared public surface). Gap is only the
R4 L3 tightening.

**GAP-stamper-02.R4-1** — No machine-enforced dependency-cycle / restricted-path check in CI; dependency
rules are documented, not enforced. Profile tightens R4 to L3 (tool choice waived, the *gate* is not).
- Evidence: as-is §SPEC-02 gap (`.github/workflows/ci.yml` runs only `npm ci` + `npm test`).
- Severity **P2** · Effort **S** · Remediation: add a `madge --circular` (or dependency-cruiser)
  blocking step to CI.
- Note: the stamper↔EO seam ratification (profile R8/R9 L3) is tracked under **GAP-stamper-03.R7-1**
  (cross-ref) to avoid duplicate ownership. The R10 route/LOC budget targets EO's `EoServer.ts`, not
  stamper's 12-route GUI — not a stamper gap.

### SPEC-03 — API & Contracts — GAPPED (L1 → L2, L3 on R5/R7)

**GAP-stamper-03.R2-1** — HTTP request bodies are not schema-validated at the boundary; routes
`JSON.parse(fs.readFileSync(...))` tenant/plan input rather than `safeParse`-ing it, and existing Zod
artifact schemas are not bound to endpoints. (Also satisfies SPEC-04.R6 input-validation.)
- Evidence: as-is §SPEC-03 (`assess.routes.ts:37,167,885`, `baseline.routes.ts:94`).
- Severity **P2** · Effort **M** · Remediation: bind a Zod `safeParse` guard at each route boundary;
  reject on failure.

**GAP-stamper-03.R7-1** — stamper↔EO schema contract is DRAFT, not ratified, and not bound by a
dual-sided producer+consumer contract test. Profile tightens R7 to a hard L3 gate because evidence flows
across this seam. Cross-refs SPEC-02.R8/R9.
- Evidence: as-is §Contracts (`docs/stamper-eo-schema-contract.md` = **DRAFT**).
- Severity **P2** · Effort **M** · Remediation: ratify the contract (out of DRAFT) and add a two-sided
  contract test validating the stamper producer (`DirectiveMetadata`/`RegistryEntrySnapshot`) and the EO
  consumer against it.

**GAP-stamper-03.R1-1** — 0 of 12 route files carry a version segment/header. Profile requires a `/v1`
mount or version header on each server surface.
- Evidence: as-is §SPEC-03 R1 (grep `/v1|/v2` in routes → none).
- Severity **P3** · Effort **S** · Remediation: mount routers under `/v1` or add a version header
  (internal localhost GUI today → low urgency).

### SPEC-04 — Security — GAPPED (L1 → L3)  ⚠ contains the module's only P0

**GAP-stamper-04.R8-1** — **[P0] Unescaped PowerShell interpolation into `spawn`.**
`interpolateVariables()` does naive `String(value)` substitution of `{key}`/`${key}` into command
templates with **no shell/PS escaping**, and the resolved string is executed via
`spawn('powershell.exe', ['-ExecutionPolicy','Bypass','-Command', script])`. Plan-derived commands and
runtime-captured values reach the shell verbatim — a command-injection surface on the live-tenant
execution path. Profile marks R8 mandatory L3 (highest-severity CES injection surface).
- Evidence: as-is §SPEC-04 (`PowerShellAdapter.ts:1597-1609` substitution; `:1620-1629` spawn).
- Severity **P0** · Effort **M** · Remediation: pass an escaping/allowlist guard over every
  interpolated value before it reaches the command string, **verified by test** (pair with SPEC-05.R9).

**GAP-stamper-04.R3-1** — **[P1] Plaintext `--cert-password` CLI flag (named secrets finding).**
The plaintext `--cert-password <password>` option is still present and its value is interpolated into a
PowerShell `ConvertTo-SecureString -String "${options.certPassword}" -AsPlainText` arg, guarded only by
a `console.warn`. Under SPEC-04.R3 the mere presence of this flag is an **automatic fail**; the CES
profile names it an explicit anti-target that MUST be removed.
- Evidence: as-is §SPEC-04 (`src/cli/index.ts:371` flag; `:410-413` interpolation).
- Severity **P1** · Effort **S** · Remediation: remove the flag; resolve cert material from Azure Key
  Vault / managed identity (no plaintext secret path).

**GAP-stamper-04.R1-1** — **[P1] No authentication middleware on any route.** All 12 GUI routers mount
unauthenticated; grep `requireAuth|bearer|x-api-key|authorization` over `src/server` → zero. Profile R1
is defaults-on; a surface that is only "secure" when nobody forgot fails R1/R15. (Distinct from G8-(c),
which is the *EO* server; stamper's GUI has no auth story and is **not** covered by G8/G12.)
- Evidence: as-is §SPEC-04 R1 (`GuiServer.ts:296-344`).
- Severity **P1** · Effort **M** · Remediation: add auth middleware defaults-on with fail-safe deny;
  document any deliberately-public route.

**DUP — SPEC-04.R4/R5 central secret store (Key Vault).** Cert/secret material does not resolve from a
central store, and there are 49 scattered `process.env` reads. Secret-ref plumbing for
`certThumbprint`/`account_key` and strict-secrets enforcement were closed in **G8-(e)**; Key-Vault-backed
resolution is **G11-SIGNING / G12-PRODUCTIONIZE** roadmap. The scattered-env-read count is raised once as
a config gap under **GAP-stamper-08.R3-1** (cross-ref SPEC-04.R5). → **DUP→G8-(e) / G11 / G12**; not
re-raised here.

**Strengths that MEET target (record explicitly):** cert-based **app-only** auth with certificate-existence
validation (`StamperConfig.ts:124-128`); `Connect-*` uses thumbprint + service principal, never passwords
(`PowerShellAdapter.ts:1564-1586`); **dryRun enforced first across every adapter** and default-true in
`fromTenantConfig` (`StamperConfig.ts:261`) — the CES dryRun-first tightening is satisfied.

### SPEC-05 — Testing — GAPPED (L1 → L3, cited stretch target)

**GAP-stamper-05.R7-1** — No coverage tooling or threshold; `jest.config.cjs` has no
`collectCoverage`/`coverageThreshold`, so no coverage number can be produced or gated. Ratio 0.6
test-files/1k LOC. (Expected standing gap per profile.)
- Evidence: as-is §SPEC-05 (`jest.config.cjs`; `measurements-2026-07-04.md`).
- Severity **P2** · Effort **M** · Remediation: enable coverage collection + per-workspace thresholds
  (pairs with SPEC-07.R6).

**GAP-stamper-05.R9-1** — Execution adapters and translators are largely untested: `APIAdapter`,
`BicepAdapter`, `CLIAdapter`, and the translators have no colocated unit tests (only `PowerShellAdapter`
among adapters is tested). This is the live-tenant blast radius.
- Evidence: as-is §SPEC-05 gap.
- Severity **P2** · Effort **M** · Remediation: adapter/route unit floors sized to CES risk; include the
  SPEC-04.R8 injection-guard test.

### SPEC-06 — Packaging & Release — GAPPED (L1 → L2)

**GAP-stamper-06.R1-1** — `version` frozen at scaffold `0.1.0` despite a large feature history.
- Evidence: as-is §SPEC-06 (`package.json:4`).
- Severity **P3** · Effort **S** · Remediation: adopt semver; bump on real releases (EO is the exemplar).

**GAP-stamper-06.R3-1** — No `CHANGELOG.md` in the module.
- Evidence: as-is §SPEC-06 (confirmed absent).
- Severity **P3** · Effort **S** · Remediation: add `CHANGELOG.md` matching EO's v0.2.0 exemplar.

### SPEC-07 — CI/CD — GAPPED (L1 → L3, cited stretch target)

**GAP-stamper-07.R6-1** — No coverage gate in CI; only `npm ci` + `npm test` run.
- Evidence: as-is §SPEC-07 (`.github/workflows/ci.yml`).
- Severity **P2** · Effort **S** · Remediation: add a blocking coverage gate (pairs with SPEC-05.R7).

**GAP-stamper-07.R7-1** — No dependency-audit gate (`npm audit`/osv) in CI. (Also SPEC-04.R11.) Note:
`npm audit --omit=dev` currently reports 0 production vulns, but nothing *gates* on it.
- Evidence: as-is §SPEC-07 gap.
- Severity **P2** · Effort **S** · Remediation: add an `npm audit` step failing on high/critical.

**GAP-stamper-07.R3-1** — Lint + typecheck are not explicit gates, and the `lint` script (`eslint src`)
has **no eslint config file** present, so lint is effectively unconfigured.
- Evidence: as-is §SPEC-07 (no `.eslintrc*`/`eslint.config.*`).
- Severity **P3** · Effort **S** · Remediation: add an eslint config + `tsc --noEmit` typecheck gate.

### SPEC-08 — Configuration — GAPPED (L1 → L3)

Strength: single central `StamperConfig` with fail-fast `validateConfig()` (`StamperConfig.ts:111-134`).
Gaps are the scatter + the manual (non-Zod) validation.

**GAP-stamper-08.R3-1** — 49 `process.env` reads across 10 files outside the config layer (`APIAdapter`,
`SessionManager`, `EvidenceReadinessAnalyzer`, `GuiServer`, routes); even `StamperConfig.clientName`
reads `process.env.CLIENT_NAME` directly. Profile convergence target is `EoConfig`. (Cross-ref
SPEC-04.R5.)
- Evidence: as-is §SPEC-08 (`StamperConfig.ts:232`; grep count).
- Severity **P2** · Effort **M** · Remediation: route all env access through a single validated config
  entry point modeled on `EoConfig`.

**GAP-stamper-08.R2-1** — Config is not Zod-schema-validated (manual `if`-checks), capping fail-fast at
L2 intent. Profile requires schema-validation-at-startup-that-throws (inherently L3).
- Evidence: as-is §SPEC-08.
- Severity **P2** · Effort **M** · Remediation: define a Zod `StamperConfigSchema` with
  `safeParse`-and-throw field-level errors.

**GAP-stamper-08.R7-1** — No `.env.example` enumerating the variables the config consumes (profile L2
documented-matrix target).
- Evidence: as-is §SPEC-08 (absent).
- Severity **P3** · Effort **S** · Remediation: ship `.env.example`.

### SPEC-09 — Observability — GAPPED (L1 → L2)

Strength that MEETS: the R4 privileged-action audit trail — every evidence record carries a structured
envelope (`controlIds, timestamp, executorIdentity, commandExecuted, sha256Hash, moduleVersions,
environment, pre/postState`, `structuredEvidence.ts:436-447`).

**GAP-stamper-09.R2-1** — `winston` is a declared dependency with **zero call sites**; application
logging is `console.*` sprawl across 20+ files. Trips R2's "logger imported but unused" + "no
`console.*` sprawl" checks. Profile names stamper the *reference* logging posture the other modules
converge onto.
- Evidence: as-is §SPEC-09 (grep `winston|createLogger` → none).
- Severity **P2** · Effort **M** · Remediation: wire winston as the single structured-logging path (or
  drop the dep and choose one logger).

**GAP-stamper-09.R6-1** — Numerous silent `catch { /* best-effort */ }` blocks discard errors, against
the no-silent-swallow rule (R6/R8).
- Evidence: as-is §SPEC-09 (`PowerShellAdapter.ts:425,466,478,495,539,605,759,1073,1140,1167`).
- Severity **P2** · Effort **M** · Remediation: log/handle each caught error; emit a failure signal
  rather than swallowing.

**GAP-stamper-09.R3-1** — No request/correlation IDs at the server edge or forwarded across the
EO→Stamper capture boundary (profile floor headline).
- Evidence: as-is §SPEC-09 / ces-profile SPEC-09 floor (CES has none today).
- Severity **P2** · Effort **M** · Remediation: assign a correlation ID at each server edge and forward
  it across the capture boundary.

### SPEC-10 — Documentation — MEETS base (L2 = L2); one R2 tightening gap

Base MEETS: README with purpose/run/test (R1) and four numbered ADRs with Context/Decision/Status/
Consequences (R3) — `docs/adr/ADR-001..004`.

**GAP-stamper-10.R2-1** — No dedicated `docs/runbooks/stamper.md`; runbook coverage is partial (README
"GCC High Setup" only). Profile makes README **and** runbook (R1+R2) mandatory per module.
- Evidence: as-is §SPEC-10 gap.
- Severity **P3** · Effort **S** · Remediation: author `docs/runbooks/stamper.md` with the required
  operational sections (cross-ref SPEC-12.R1).

### SPEC-11 — Data & Persistence — GAPPED (L2 → L3 MANDATORY) — all findings DUP

Strongest dimension; base integrity is strong and MEETS several requirements. The only shortfall to the
L3-mandatory target is code-enforced immutability, which is already owned:

**DUP — code-enforced WORM / immutability at the storage layer.** Integrity is hash-*detectable*, not
tamper-*prevented*; blob path-stamping avoids 409 overwrite (`structuredEvidence.ts:454-457`) but is not
object-lock. This is the **G8-(b)** written risk-acceptance (immutability is a deployment-config
guarantee today) and the **G10-WORM** goal (code-enforced immutability headers + read-back verification).
→ **DUP→G8-(b) / G10.** Includes the profile-R4 "in-place mutation must throw, asserted by test" item.

**DUP — RSA-PSS Key Vault evidence signing.** Not present; integrity rests on SHA-256 hashing, not a
signature. → **DUP→G8-(a) / G11-SIGNING.**

**Strengths that MEET target (record explicitly):** all reads/writes go through `EvidenceStore` →
ces-shared tenant-scoped repo (`EvidenceStore.ts:81-88`); SHA-256 content hash on every artifact
(`EvidenceStore.ts:62,114` via `HashingService`, tested by `EvidenceStoreIdentity.test.ts`);
**parameterized, Zod-validated retention** (`retention_days`, `worm_retention_days ≥ 365`,
`ces-artifacts.types.ts:82,118,448`) — not a hardcoded literal; tenant isolation enforced. The tenant-tests
EUT suite is the standing enforcement surface (R6/R7).

### SPEC-12 — Deployment & Operations — GAPPED (L1 → L2)

**GAP-stamper-12.R4-1** — No manual-step register. CES has irreducible manual live-operation steps
(certificate-based auth setup, tenant admin-consent grants, GCC High endpoint/egress config); profile
tightens R4 to L3-mandatory and an unregistered manual step is a hard fail. This is also where
SPEC-01.R9-waived live-tenant ACs land.
- Evidence: as-is §SPEC-12 (bootstrap wraps `New-TenantBootstrap.ps1` `cli/index.ts:365-428`; connect
  guidance `cli/index.ts:540`, but no register).
- Severity **P2** · Effort **M** · Remediation: author a manual-step register capturing each gating step.

**GAP-stamper-12.R1-1** — No environment matrix (dev/CI/live) doc, and no documented/exercised rollback
procedure although rollback code exists (`RollbackHandler.ts`, `enableRollback` default-on
`StamperConfig.ts:106`).
- Evidence: as-is §SPEC-12.
- Severity **P2** · Effort **M** · Remediation: document the env matrix + an exercised rollback runbook
  (cross-ref SPEC-10.R2).

---

## Dedup ledger

| Gap area | Owner | Reference |
|---|---|---|
| SPEC-11 code-enforced WORM / immutability | G8 risk-acceptance + Phase-3 goal | `docs/G8-findings.md` (b), `docs/G8-completion.md`, `ces-roadmap-phase3-goals.md` **G10** |
| SPEC-11 RSA-PSS Key Vault signing | G8 risk-acceptance + Phase-3 goal | `docs/G8-findings.md` (a), **G11-SIGNING** |
| SPEC-04.R4 Key Vault secret store | G8 (secret-ref) + Phase-3 | `docs/G8-completion.md` (e), **G11 / G12-PRODUCTIONIZE** |
| Hash determinism (canonical JSON) | Closed in G8 | `docs/G8-completion.md` (d) — not re-raised |
| SPEC-04.R1 stamper GUI authN | **Not** covered by G8-(c) (EO-only) | New finding GAP-stamper-04.R1-1 |
| Multi-stack capability / dead-code sweep (punchlist) | Punchlist / G13-G14 | `punchlist-import.csv`; SPEC-02 stack seam already MEETS |

Punchlist dedup note: `punchlist-import.csv` was extractable and reviewed. Its stamper-relevant rows
("vsc - stamper", multi-stack support, dead-code scan, artifact IDs, auth/security best-practices) map to
architecture/roadmap themes already dispositioned above (stack seam MEETS; security items raised as
SPEC-04 findings; artifact-ID work is done per as-is SPEC-11). No stamper finding above duplicates an
open punchlist task's ownership.
