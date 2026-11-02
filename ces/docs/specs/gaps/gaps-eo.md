# GAPS — ces-eo — ideal (CES profile) vs as-is (2026-07-04)

**Method:** G-SPEC-3 mechanical cell diff. Each (EO × dimension) cell dispositioned
**MEETS** (`as-is ≥ target`) / **WAIVED** (profile citation) / **GAPPED** (`as-is < target`).
Findings `GAP-eo-<SPEC-NN.R#>-<seq>` carry statement · evidence pointer · severity (P0–P3) ·
effort (S/M/L) · remediation sketch. `DUP→<ref>` = already owned by an existing track
(G8 risk-acceptance, Phase-3 G9–G14, punchlist); those get a cross-reference, not a re-raise.

**Baseline:** `docs/specs/as-is/as-is-eo.md` (commit a0d6ae1). **Profile:** `docs/specs/ideal/ces-profile.md`.
**Dedup sources:** `docs/G8-findings.md`, `docs/G8-completion.md`,
`ces-strategy/docs/ces-roadmap-phase3-goals.md`, `docs/specs/gaps/punchlist-import.csv`.
EO is the lowest-scoring module: **all 12 cells GAPPED** (as-is L1 on 10 dims, L2 on SPEC-05/08).
No cell reaches its target, but requirement-level strengths that *do* meet ideal are recorded
per-cell and summarized at the end.

---

## Disposition matrix

| # | Dimension | Target | As-is | Disposition | Sharpest finding |
|---|---|:--:|:--:|:--:|---|
| 01 | Concept & Requirements | L3 | L1 | **GAPPED** | no CMMC obligation→req→test trace (mandatory L3) |
| 02 | Architecture & Design | L2 (L3 R4/R8/R10) | L1 | **GAPPED** | 4,100-line / 104-route `EoServer.ts` god-file |
| 03 | API & Contracts | L2 (L3 R5/R7) | L1 | **GAPPED** | stamper↔EO contract DRAFT; no versioning |
| 04 | Security | L3 | L1 | **GAPPED** | **auth off-by-default; 3 prod vulns (multer HIGH)** |
| 05 | Testing | L3 *(stretch)* | L2 | **GAPPED** | `--no-coverage`; no threshold/floors |
| 06 | Packaging & Release | L2 | L1 | **GAPPED** | no SemVer gate / provenance / SBOM |
| 07 | CI/CD | L3 *(stretch)* | L1 | **GAPPED** | single test gate; no audit/coverage/lint/type |
| 08 | Configuration | L3 | L2 | **GAPPED** | EoConfig exemplar but not single-sourced / CI-asserted |
| 09 | Observability | L2 | L1 | **GAPPED** | 280 `console.*`; winston dead-dep; no reqIDs/ops-audit |
| 10 | Documentation | L2 | L1 | **GAPPED** | **no root README** (R1 mandatory) |
| 11 | Data & Persistence | **L3 (MANDATORY)** | L1 | **GAPPED** | no WORM enforcement / no migrations in EO |
| 12 | Deployment & Operations | L2 | L1 | **GAPPED** | no runbook / rollback / manual-step register |

---

## SPEC-01 — Concept & Requirements — GAPPED (L1 → L3)

- **GAP-eo-01.R12-01** — No CMMC obligation → requirement → test mapping table; traceability is by
  convention, the determination ledger is not machine-linked to tests. This is the mandatory-L3
  headline for a compliance product. *Evidence:* `as-is-eo.md:61-66`. **P1 · L** — build an
  obligation→requirement→test matrix anchored on the EO determination ledger / assessment objectives
  and the golden SSP test; fail CI on any in-scope L2 practice with zero tests.
- **GAP-eo-01.R10-01** — No requirement→test traceability matrix (either direction); orphan
  requirements and untraced tests are undetectable. *Evidence:* `as-is-eo.md:64-66`. **P2 · L** —
  emit the matrix in CI; anchor on planner characterization tests + EO golden SSP reference.
- **GAP-eo-01.R3/R5-01** — No numbered `US-`/`REQ-` requirement register with stable IDs; capability
  intent lives in tests and persona views, not in identified requirements. *Evidence:*
  `as-is-eo.md:61-66`. **P2 · M** — author a versioned requirement register with unique IDs.
- **WAIVED (profile):** SPEC-01.R9 "no manual-only AC" is waived for EO live-tenant / GCC High
  behaviors that cannot run offline, satisfied by the SPEC-12.R4 manual-step register (profile
  SPEC-01 hook). Scores `N/A`, not a gap.

## SPEC-02 — Architecture & Design — GAPPED (L1 → L2; L3 on R4/R8/R10)

- **GAP-eo-02.R10-01** — `EoServer.ts` is a **4,100-line single-file monolith with 104 route
  registrations** and no LOC/route-count budget (profile tightens R10 to L3 with a ceiling EO
  violates). The canonical god-file; blocks per-route contract, coverage-floor, and auth work.
  *Evidence:* `as-is-eo.md:33,68`. **P2 · L** — set an enforced route/LOC ceiling; decompose into
  bounded routers. *(Watchlisted in as-is; enables SPEC-03/04/05 route work.)*
- **GAP-eo-02.R4-01** — No enforced dependency-cycle / forbidden-edge check (madge / dependency-cruiser)
  in CI (profile L3). *Evidence:* `as-is-eo.md:69`. **P2 · M** — add a CI dep-check gate (tool choice
  waived by profile, the gate is not).
- **GAP-eo-02.R7-01** — No ADRs; `docs/architecture/` holds narrative specs, not decision records.
  *Evidence:* `as-is-eo.md:70-71,141-143`. Cross-ref SPEC-10.R3. **P3 · M** — stand up `docs/adr/` with
  the Nygard template; back-fill the monolith/persistence/auth-seam decisions.
- **GAP-eo-02.R8/R9-01** — stamper↔EO seam has a contract but it is **DRAFT** while EO consumes it in
  prod (R8 named-contract present, R9 change-control not enforced). *Evidence:* `as-is-eo.md:170`.
  Cross-ref / DUP → **GAP-eo-03.R7-01**. **P1 · M** (tracked under 03.R7).

## SPEC-03 — API & Contracts — GAPPED (L1 → L2; L3 on R5/R7)

- **GAP-eo-03.R7-01** — `docs/stamper-eo-schema-contract.md` is **status DRAFT** yet a production EO
  code path depends on it; profile tightens R7 to a hard L3 gate (flagship). Evidence flows across
  this seam, so drift ships undetected. *Evidence:* `as-is-eo.md:82-84,170`. **P1 · M** — ratify the
  contract (status `ratified`), validate both stamper producer and EO consumer against it.
  Cross-ref SPEC-02.R8/R9, SPEC-05.R3.
- **GAP-eo-03.R1-01** — No API versioning: no `/v1` segment or version header on any of the 104
  `/api/*` routes. *Evidence:* `as-is-eo.md:77,173`. **P2 · M** — mount routes under `/v1` or add an
  `Accept-Version` header; enumerate-and-assert in a route test.
- **GAP-eo-03.R5-01** — No contract-diff gate; EO already shipped an **unguarded breaking change**
  (`confidence` field removed at v0.2.0). Profile requires the gate specifically because of this.
  *Evidence:* profile SPEC-03.R5 grounding; `as-is-eo.md:49` (v0.2.0 changelog). **P2 · M** — add a
  schema contract-diff gate that fails a breaking delta without a major bump.
- **GAP-eo-03.R2/R3-01** — No OpenAPI/schema per endpoint; Zod on some bodies only (27 refs), no
  both-sides validation. *Evidence:* `as-is-eo.md:78-83`. **P2 · L** — bind request/response schemas
  per route (pairs with R1 versioning + monolith decomposition).
- **GAP-eo-03.R4-01** — Errors are ad-hoc `{ error: '…' }` JSON (~279 `sendError` sites), not RFC 9457
  problem+json with stable codes. *Evidence:* `as-is-eo.md:80-81`. **P3 · M** — converge `sendError`
  on a problem+json shape with stable `code` (the uniform call-site is a strength; only the shape
  needs upgrading).
- **GAP-eo-03.R10-01** — No route/contract inventory manifest. *Evidence:* `as-is-eo.md:173`.
  **P3 · S** — generate a route manifest and drift-check it against registrations.

## SPEC-04 — Security — GAPPED (L1 → L3)  ⚠️ FLAGSHIP

> **Two findings escalated to the turn summary:** (1) endpoint auth is a no-op by default, exposing
> all 104 `/api/*` routes; (2) three unremediated production npm-audit vulns, including a **multer
> HIGH** on the live upload path.

- **GAP-eo-04.R11-01** — **[P0]** `multer 1.0.0-2.1.1` **HIGH** vuln (DoS via nested field names /
  aborted-upload cleanup) present in EO production deps — the aborted-upload-cleanup CVE maps exactly
  to EO's own no-tmp-cleanup gap. `npm audit fix` is available (non-breaking). The only monorepo
  module with audit findings; no CI audit gate catches it. *Evidence:* `as-is-eo.md:16-19,92-97`.
  **P0 · S** — `npm audit fix` to bump multer; add the SPEC-07.R7 audit gate so it cannot recur.
  *Not owned by any existing goal.*
- **GAP-eo-04.R11-02** — **[P1]** `js-yaml <3.15.0` (moderate, quadratic DoS) and `uuid <11.1.1`
  (moderate, buffer bounds) production vulns; uuid needs `--force` (breaking). No `npm audit` gate in
  CI. *Evidence:* `as-is-eo.md:16-19,92`. **P1 · S** — `npm audit fix` (js-yaml) + planned uuid major
  bump; add audit gate. Cross-ref SPEC-07.R7.
- **GAP-eo-04.R1-01 / R15** — **[P1]** **Auth off-by-default.** Bearer middleware is wired
  (`EoServer.ts:198`) but returns `next()` when `CES_EO_AUTH_TOKEN` is unset
  (`authMiddleware.ts:39-46`) — the default deployment exposes all 104 routes unauthenticated; static
  paths never guarded. Profile makes "auth no-op when token unset" an automatic R1/R15 fail; SPEC-04
  target is default-on. *Evidence:* `as-is-eo.md:87-91`. **P1 · M** — ship a secure default (fail
  closed when unconfigured) or require the token. **DUP → G8 finding (c)** (added env-gated,
  default-off, written risk acceptance) **+ Phase-3 G12** (productionize: enable
  `CES_EO_AUTH_TOKEN`/`CES_EO_TENANT`). *The env-gated switch exists; the SPEC-04 default-on
  requirement remains a standing gap and becomes **P0** on any network-exposed deploy.*
- **GAP-eo-04.R14-01** — **[P1]** Uploads land in `os.tmpdir()` (`EoServer.ts:216`) with a 10 MB cap +
  extension allowlist but **no auto-cleanup** of the tmp upload; `StorageCleanupService.cleanTempFiles`
  (`EoServer.ts:1402`) prunes `storageRoot`, not `os.tmpdir()`. Stale sensitive files + the multer
  cleanup CVE surface. *Evidence:* `as-is-eo.md:94-97`. **P1 · M** — cleanup on request end/abort;
  scope uploads to an allowed root under `storageRoot`.
- **GAP-eo-04.R6-01** — **[P2]** Input validation is partial — Zod on some route bodies only (27
  refs), not a uniform strict boundary contract. *Evidence:* `as-is-eo.md:82-83`. **P2 · L** — enforce
  strict-mode schema validation at every input boundary (pairs with SPEC-03.R2/R3).
- **GAP-eo-04.R9-01** — **[P2]** No rate limiting observed on the 104-route surface (no middleware in
  as-is). *Evidence:* `as-is-eo.md:173` (surface); not affirmatively confirmed in baseline —
  verify. **P2 · S** — add rate-limit middleware on mutating/expensive routes.
- **WAIVED (profile):** the SPEC-04 dryRun-first / Key-Vault-secret / injection-guard tightenings
  target **Stamper and AO**, not EO; the Planner R1/R9/R10 waiver is not EO. No EO-specific waiver.

## SPEC-05 — Testing — GAPPED (L2 → L3, *stretch target, not yet met*)

*Profile flags SPEC-05 as a standing gap: no module has coverage tooling today.*

- **GAP-eo-05.R7-01** — `test = "jest --no-coverage"`; coverage neither measured nor emitted.
  *Evidence:* `as-is-eo.md:107` (`package.json:11`). **P2 · S** — drop `--no-coverage`, add coverage
  config.
- **GAP-eo-05.R8-01** — No numeric coverage thresholds gated (L3). *Evidence:* `as-is-eo.md:108-109`.
  **P2 · M** — configure per-workspace thresholds. Cross-ref SPEC-07.R6.
- **GAP-eo-05.R9-01** — No adapter/route coverage floors for the 104 route registrations (the
  live-tenant blast radius; profile L3). *Evidence:* `as-is-eo.md:124` (profile hook). **P2 · M** —
  declare route-directory floors once the monolith is decomposed (SPEC-02.R10).
- **GAP-eo-05.R6-01** — No E2E tier/config for the primary flow (no playwright config observed).
  *Evidence:* baseline lists no E2E tier — verify. **P3 · M** — add one E2E happy-path with committed
  config.
- **MEETS:** SPEC-05.R5 — the **golden SSP reference test** (`tests/ssp/ssp-golden-reference.test.ts`)
  is the profile's named exemplar of R5 (`as-is-eo.md:102-106`). Strong; propagate the pattern to
  POA&M / Evidence.zip generators (that propagation is a Stamper/EO artifact-coverage task, not an EO
  gap here).

## SPEC-06 — Packaging & Release — GAPPED (L1 → L2)

- **GAP-eo-06.R5/R6-01** — No SemVer gate, no build provenance/SLSA, no release automation; `build` is
  bare `tsc`. *Evidence:* `as-is-eo.md:113-114`. **P3 · M** — add a release job (version check +
  provenance/SBOM). Cross-ref SPEC-04.R13.
- **GAP-eo-06.R10-01** — `/api/health` does not self-report module version + build commit (profile
  tightening). *Evidence:* `as-is-eo.md:152-155`. Cross-ref SPEC-09.R5. **P3 · S** — return
  version+commit on health.
- **MEETS:** R1/R3 — EO is versioned (`0.1.0`/changelog notes v0.2.0) with a maintained `CHANGELOG.md`;
  the profile names **EO as the packaging exemplar** the other modules must match
  (`as-is-eo.md:111-112`; profile SPEC-06).

## SPEC-07 — CI/CD — GAPPED (L1 → L3, *stretch target, not yet met*)

*CI is repo-level (`.github/workflows/ci.yml`) → these are largely **owned by gaps-shared-root**; the
per-workspace coverage/audit config is the EO-side piece. Listed here as the EO manifestation.*

- **GAP-eo-07.R7-01** — **[P1]** No dependency-audit gate — the missing gate that lets the multer HIGH
  and js-yaml/uuid moderates persist unflagged. *Evidence:* `as-is-eo.md:116-118`. **P1 · S** — add
  `npm audit --audit-level=high` step. Cross-ref SPEC-04.R11. **DUP → gaps-shared-root** (repo CI).
- **GAP-eo-07.R6-01** — No coverage gate. **P2 · M** — cross-ref SPEC-05.R8. **DUP → gaps-shared-root.**
- **GAP-eo-07.R3-01** — No lint gate (`--max-warnings 0`). **P2 · S** — promote to explicit gate.
  **DUP → gaps-shared-root.**
- **GAP-eo-07.R4-01** — No typecheck gate (`tsc --noEmit` strict). **P2 · S**. **DUP → gaps-shared-root.**
- **Note:** Phase-3 **G12** modernizes the CI workflow (Node-20 action bumps) but does **not** add
  coverage/audit/lint/type gates — those remain open.
- **MEETS:** R1/R5, and R8 by embedding (the golden SSP test runs inside `npm test`) — profile SPEC-07.

## SPEC-08 — Configuration — GAPPED (L2 → L3; EO is the exemplar)

- **GAP-eo-08.R3-01** — Config is not fully single-sourced: `authMiddleware.ts:20` reads
  `process.env.CES_EO_AUTH_TOKEN` **directly, outside** the validated `EoConfig` layer.
  *Evidence:* `as-is-eo.md:126-127`. **P2 · S** — route the auth token through `EoConfig`.
- **GAP-eo-08.R2-01 (enforcement)** — No CI/test asserts the schema, so validation is a runtime
  startup boundary but not build-fail-**enforced** → caps at L2 not L3. *Evidence:* `as-is-eo.md:128`.
  **P3 · S** — add a config-schema assertion test to CI.
- **GAP-eo-08.R7-01** — No `.env.example` enumerating the variables `EoConfigSchema` consumes.
  *Evidence:* profile SPEC-08 R7 target. **P3 · S** — ship `.env.example`. Overlaps Phase-3 G12
  reference-config item → cross-ref G12.
- **MEETS (exemplar):** R1/R2/R4 — `EoConfig.ts` (single Zod `EoConfigSchema`, `safeParse` at startup,
  **throws formatted error on invalid config**, typed immutable export, defaulted port) is the
  profile's **named convergence target** for the whole monorepo (`as-is-eo.md:120-125`). The dimension
  gap is enforcement + single-sourcing, not the mechanism.

## SPEC-09 — Observability — GAPPED (L1 → L2)

- **GAP-eo-09.R4-01** — **[P1]** No durable audit trail for privileged EO ops (tenant-config changes,
  evidence captures beyond hashing) — evidence is richly audited (SHA-256 + `executorIdentity`) but
  ordinary privileged ops leave no durable record. Profile floor headline. *Evidence:*
  `as-is-eo.md:130-137`; profile SPEC-09 R4. **P1 · M** — persist actor/action/timestamp/target/outcome
  for privileged ops.
- **GAP-eo-09.R1/R2-01** — **280 `console.*` calls** across `src`; **`winston@^3.14.0` declared but
  imported nowhere (dead dependency)**; no structured/leveled logging. *Evidence:* `as-is-eo.md:130-134`.
  **P2 · M** — either wire the winston logger (stamper is the reference posture) or drop the dep;
  replace `console.*` with leveled structured logs.
- **GAP-eo-09.R3-01** — No request/correlation IDs assigned at the edge or forwarded across the
  EO → Stamper capture boundary. *Evidence:* `as-is-eo.md:131`; profile floor. **P2 · M** — add
  request-ID middleware; forward in the capture header.
- **GAP-eo-09.R6/R8-01** — Scheduled signal-capture job keeps `lastCaptureRun` in memory with no
  failure metric — a restart erases history and a failed run is invisible. *Evidence:* profile SPEC-09
  anti-pattern (EO-named). **P2 · M** — persist last-run state; emit a failure metric.
- **GAP-eo-09.R7-01** — `EvidenceOpsClient` fire-and-forget POST swallows its rejection (a dropped
  capture surfaces as nothing). *Evidence:* profile SPEC-09 anti-pattern (EO-named). **P2 · S** —
  handle the rejection; log at error / retry.
- **GAP-eo-09.R5-01** — `/api/health` returns a constant 200; no dependency/readiness state.
  *Evidence:* profile SPEC-09 R5. **P3 · S** — reflect real readiness.

## SPEC-10 — Documentation — GAPPED (L1 → L2; R1+R2 mandatory)

- **GAP-eo-10.R1-01** — **No root `README.md` for `ces-eo`** — the reference-doc corner is absent for
  the largest HTTP surface in the repo (R1 mandatory per profile). *Evidence:* `as-is-eo.md:140-141`.
  **P2 · S** — add a README (Purpose / Run / Test). *Fresh (not owned by G8/Phase-3/punchlist).*
- **GAP-eo-10.R2-01** — No runbook (start/stop, health, common failures, escalation). *Evidence:*
  `as-is-eo.md:152-155`. **P2 · S** — add `docs/runbooks/ces-eo.md`.
- **GAP-eo-10.R3-01** — No ADR directory (`docs/architecture/` holds narrative specs). *Evidence:*
  `as-is-eo.md:141-143`. Cross-ref SPEC-02.R7. **P3 · M**.
- **WAIVED:** none — documentation applies to every module.

## SPEC-11 — Data & Persistence — GAPPED (L1 → **L3 MANDATORY**)  ⚠️ FLAGSHIP

- **GAP-eo-11.R4-01** — **[P1]** No WORM / append-only enforcement in EO: committed assessment
  determinations / evidence records in the file stores can be mutated in place; the repository exposes
  no throw on in-place edit. Evidence integrity is the core value proposition (L3-mandatory in every
  posture). *Evidence:* `as-is-eo.md:145-150`. **P1 · L** — make integrity-critical records append-only;
  corrections become superseding versions; assert in-place mutation throws by test.
  **DUP → G8 finding (b)** (code-enforced WORM deferred w/ written risk acceptance — deployment-config
  guarantee only today) **+ Phase-3 G10** (code-enforced WORM on evidence upload). EO's local
  determination/store append-only is within G10's remaining scope.
- **GAP-eo-11.R2-01** — No schema migrations for the JSON file stores; a fresh build cannot reproduce
  an evolved on-disk layout. *Evidence:* `as-is-eo.md:149-150`. **P2 · M** — add numbered forward-only
  migrations + an empty→head apply test. *Fresh.*
- **GAP-eo-11.R5-01** — No retention enforcement inside EO; the 6-year CUI retention lives as text in
  generated narratives, not as an enforced lifecycle/disposal job. *Evidence:* `as-is-eo.md:150`;
  profile SPEC-11 R5 (6 yr). **P2 · M** — declare retention in config; add a disposal job + test.
- **GAP-eo-11.R7-01** — Tenant resolution is partly a **client-supplied `?tenant=` query param**
  (ambiguous precedence). *Evidence:* `as-is-eo.md:145-146`; G8 finding (c). **P2 · M** — resolve
  active tenant through one documented resolver (authenticated identity precedence), reject
  unresolvable. **DUP → G8 finding (c)** (partly); cross-ref SPEC-11.R6/R7 owned by the EUT suite /
  gaps-shared-root.
- **MEETS:** R3 — evidence records carry a **canonical SHA-256 content hash** (order-stable via the G8
  `ces-shared/crypto` fix); the `DeterminationLedger` provides a unified, pure/additive status spine
  (`as-is-eo.md:145-148,161`). R6 empty-scope-throw is enforced at the `CesRepository`/EUT layer
  (cross-ref gaps-shared-root).

## SPEC-12 — Deployment & Operations — GAPPED (L1 → L2)

- **GAP-eo-12.R3/R5-01** — No deploy runbook, no rollback procedure, no named dev/CI/live environment
  register; only `start:eo`/`dev:eo` scripts. *Evidence:* `as-is-eo.md:152-155`. **P2 · M** — document
  deploy/rollback/env-matrix. **DUP → Phase-3 G12** (deployment-hardening runbook).
- **GAP-eo-12.R4-01** — No manual-step register for the irreducible live-tenant steps (cert auth,
  admin-consent grants, GCC High egress) — profile tightens R4 to L3; this is where SPEC-01.R9-waived
  ACs land. *Evidence:* profile SPEC-12 R4. **P2 · M** — author a manual-step register.
- **GAP-eo-12.R6-01** — No backup/restore drill that includes evidence blob artifacts and re-verifies
  content hashes post-restore. *Evidence:* `as-is-eo.md:152-155`. Cross-ref SPEC-11.R8. **P2 · M**.

---

## Findings by severity

**P0 (security-critical on a live path — fix next)**
- `GAP-eo-04.R11-01` — multer 1.x **HIGH** DoS in EO prod deps; `npm audit fix` available. *(fresh)*

**P1 (blocks the product's own claims / near-term need)**
- `GAP-eo-04.R1-01` — auth off-by-default exposes all 104 `/api/*` routes. *DUP→G8(c)/G12*
- `GAP-eo-04.R11-02` — js-yaml + uuid moderate prod vulns; no CI audit gate.
- `GAP-eo-04.R14-01` — tmp-dir uploads never cleaned (multer-CVE surface).
- `GAP-eo-01.R12-01` — no CMMC obligation→requirement→test traceability (mandatory L3).
- `GAP-eo-03.R7-01` — stamper↔EO contract DRAFT while consumed in prod.
- `GAP-eo-07.R7-01` — no dependency-audit CI gate. *DUP→gaps-shared-root*
- `GAP-eo-09.R4-01` — no durable audit trail for privileged EO ops.
- `GAP-eo-11.R4-01` — no WORM/append-only enforcement in EO. *DUP→G8(b)/G10*

**P2 (engineering-maturity debt, compounding cost)**
- `GAP-eo-02.R10-01` (4,100-line monolith), `GAP-eo-02.R4-01` (dep-cycle gate)
- `GAP-eo-03.R1-01` (no versioning), `GAP-eo-03.R5-01` (no contract-diff gate), `GAP-eo-03.R2/R3-01`
- `GAP-eo-04.R6-01` (partial input validation), `GAP-eo-04.R9-01` (no rate limiting)
- `GAP-eo-05.R7-01` / `R8-01` / `R9-01` (coverage: none/threshold/floors)
- `GAP-eo-07.R6-01` / `R3-01` / `R4-01` (coverage/lint/typecheck gates) *DUP→gaps-shared-root*
- `GAP-eo-08.R3-01` (auth token read outside EoConfig)
- `GAP-eo-09.R1/R2-01` (console sprawl + winston dead-dep), `R3-01` (reqIDs), `R6/R8-01`, `R7-01`
- `GAP-eo-10.R1-01` (no root README), `GAP-eo-10.R2-01` (no runbook)
- `GAP-eo-11.R2-01` (no migrations), `R5-01` (retention), `R7-01` (tenant resolution *DUP→G8(c)*)
- `GAP-eo-12.R3/R5-01` *DUP→G12*, `R4-01` (manual-step register), `R6-01` (backup/restore)

**P3 (polish / consistency)**
- `GAP-eo-01.R10-01`, `R3/R5-01`; `GAP-eo-02.R7-01`; `GAP-eo-03.R4-01`, `R10-01`
- `GAP-eo-05.R6-01`; `GAP-eo-06.R5/R6-01`, `R10-01`; `GAP-eo-07` MEETS-noted
- `GAP-eo-08.R2-01`, `R7-01`; `GAP-eo-09.R5-01`; `GAP-eo-10.R3-01`

## Requirement-level strengths that MEET ideal
1. **Golden SSP reference test** (SPEC-05.R5) — profile's named exemplar; no-drop structural guard.
2. **`EoConfig` Zod schema, validates-and-throws at startup** (SPEC-08.R1/R2/R4) — the profile's
   monorepo convergence target.
3. **548-test suite / 49 files** — densest behavioral coverage of any module by absolute count.
4. **Canonical SHA-256 evidence hashing + `DeterminationLedger` spine** (SPEC-11.R3) — order-stable
   integrity hashing (G8) and a pure/additive unified status spine.
5. **~279 uniform `sendError` call sites** — consistent error-response shape across the surface
   (upgrade the shape to problem+json under 03.R4 and this becomes a full MEETS).
6. **Packaging exemplar** (SPEC-06.R1/R3) — versioned + maintained `CHANGELOG.md`; the model the other
   three modules must match.

## Dedup ledger
- **DUP → G8 (written risk acceptance):** `04.R1` (auth env-gated, default-off, accepted),
  `11.R4` (code-enforced WORM deferred), `11.R7` (client-supplied `?tenant=` finding-c).
- **DUP → Phase-3 G9–G14:** `04.R1`+`08.R7` (G12 productionize / reference-config),
  `11.R4` (G10 WORM), `12.R3/R5` (G12 deployment-hardening runbook). G12 modernizes CI actions but
  does **not** add the audit/coverage/lint/type gates (`07.R3/R4/R6/R7` remain open).
- **DUP → gaps-shared-root (repo-level CI):** all of `SPEC-07` (workflow is repo-level; EO owns only
  the per-workspace coverage/audit config), and `11.R6` empty-scope enforcement (EUT suite).
- **Punchlist:** `punchlist-import.csv` was extracted per policy. Relevant EO-adjacent rows are
  coarse backlog buckets ("Scan CES for dead code" → overlaps `09.R1/R2` winston dead-dep;
  "Harden CES persistence - DB", "Ensure CES can handle multiple customers" → overlaps `11.R2/R6/R7`;
  "add functional test cases for every major use case" → overlaps `05`). These are cross-referenced,
  not re-raised as owned items — the punchlist rows are goals, not line-item findings.
```
