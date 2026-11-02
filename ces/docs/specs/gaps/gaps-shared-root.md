# GAP — ces-shared + monorepo root — ideal vs as-is

**Method:** `docs/G-SPEC-3-plan.md` · **As-is baseline:** `docs/specs/as-is/as-is-shared-root.md` (commit a0d6ae1)
· **Target levels:** `docs/specs/ideal/ces-profile.md` · **Requirements:** `docs/specs/ideal/core/SPEC-01..12.md`
· **Read-only:** this report plans; it fixes nothing.

Disposition rule (SPEC-00.R6): a cell **MEETS** iff `as-is ≥ target`; **WAIVED** = profile-cited `N/A`;
otherwise **GAPPED** with findings `GAP-shared-<SPEC-NN.R#>-<seq>`. Severity P0–P3 (plan §3); effort S/M/L.
Findings already owned by an existing track are **DUP→<ref>**, not re-raised.

## Cell dispositions (12/12)

| # | Dimension | Target | As-is | Disposition |
|---|---|:--:|:--:|---|
| 01 | Concept & Requirements | L3 | L1 | **GAPPED** |
| 02 | Architecture & Design | L2 (L3 on R4/R8/R10) | L2 | **GAPPED** (base MEETS; L3 tightenings unmet) |
| 03 | API & Contracts | L2 (L3 on R5/R7) | L1 | **GAPPED** |
| 04 | Security | L3 | L2 | **GAPPED** |
| 05 | Testing | L3 | L1 | **GAPPED** |
| 06 | Packaging & Release | L2 | L1 | **GAPPED** |
| 07 | CI/CD | L3 | L1 | **GAPPED** |
| 08 | Configuration | L3 | L2 | **GAPPED** |
| 09 | Observability | L2 | L1 | **GAPPED** |
| 10 | Documentation | L2 | L1 | **GAPPED** |
| 11 | Data & Persistence | L3 (MANDATORY) | L2 | **GAPPED** |
| 12 | Deployment & Operations | L2 | L1 | **GAPPED** |

**No cell MEETS outright**, but four dimensions carry real strengths at their current level (see §Strengths).
**No P0.** The two P1s are the DRAFT stamper↔EO contract and the missing WORM guard on `CesRepository`.

---

## Findings

### SPEC-01 — Concept & Requirements (L1 → L3) GAPPED

**GAP-shared-01.R12-01** — No canonical intent-of-record for the spine and no *enforced* requirement→test
traceability. Product/plan docs (`DESIGN.md`, `PLAN_V2.md`) exist but there are no stable `US-`/req IDs and no
traceability gate (as-is §SPEC-01). SPEC-01.R12 is tightened to mandatory L3 (profile §SPEC-01).
- Severity **P2** · Effort **L**
- Remediation: publish a spine intent-of-record with stable req IDs; stand up a requirement→test matrix gate.
  The *enforcement surface* (CMMC practice→objective→test) is the EO determination ledger — **cross-ref gaps-eo**;
  the root owns the ID scheme + the CI matrix check.

### SPEC-02 — Architecture & Design (L2 base MEETS; L3 tightenings GAPPED)

Base L2 is met (four immutable ADRs, declared dep direction, centralized shared package — see §Strengths). The
profile tightens R4/R8/R10 to L3; two are shared-root, one is module-owned.

**GAP-shared-02.R4-01** — No machine dependency-cycle check (madge/dependency-cruiser) runs in CI; dep direction
is asserted only in prose (as-is §SPEC-02). SPEC-02.R4 tightened to enforced L3 (tool choice waived, gate not).
- Severity **P2** · Effort **S** · *High-leverage root gate.*
- Remediation: add a dependency-cycle/allowed-direction check to `ci.yml` (`--max-warnings 0` semantics).
- R8 (ratify stamper↔EO seam) → **DUP→GAP-shared-03.R7-01**. R10 (route/LOC budget on `EoServer.ts`) → EO-owned,
  **cross-ref gaps-eo**.

### SPEC-03 — API & Contracts (L1 → L2, L3 on R5/R7) GAPPED

**GAP-shared-03.R7-01** — **FLAGSHIP.** The stamper↔EO directive-metadata contract is **DRAFT/unratified** and
validated only on the EO consumer side. `ces-eo/docs/stamper-eo-schema-contract.md:4` = `Status: DRAFT (pending
Stamper team confirmation)`, dated 2026-04-20; producer has no shared validator (as-is §SPEC-03, Contracts row 5).
SPEC-03.R7 tightened to a hard L3 gate; cross-links SPEC-02.R8.
- Severity **P1** (evidence flows this seam → attestation readiness) · Effort **M**
- Remediation: move the doc to `ratified`; add producer-side Zod (`DirectiveMetadata`/`RegistryEntrySnapshot`)
  + consumer validation against the shared schema; both-sides contract test.

**GAP-shared-03.R8-02** — `CesRepository` stores `data: unknown` (`CesRepository.ts:36,155`); collection payload
shapes are not schema-checked at the boundary — each store casts (as-is §SPEC-03, Contracts row 4). SPEC-03.R8
(contract is single source of truth) / SPEC-11.R1.
- Severity **P2** · Effort **M**
- Remediation: introduce per-collection payload schemas (or a generic typed `CesRecord<T>` with registered
  validators) validated on write; keep scope enforcement untouched.

**GAP-shared-03.R5-03** — No versioned contract inventory and no contract-diff gate; nothing blocks a breaking
seam change (as-is §SPEC-03). SPEC-03.R5 tightened to L3 (profile cites EO's prior unguarded `confidence` removal).
- Severity **P2** · Effort **M**
- Remediation: maintain a shared contract manifest + a CI diff gate that fails on breaking change without a major bump.

**GAP-shared-03.R8-04** — The mission-plan schema (Planner→Stamper) lives in module code, not in `ces-shared`;
implicit cross-boundary shape, no boundary schema (as-is §SPEC-03, Contracts row 6).
- Severity **P2** · Effort **M**
- Remediation: centralize the mission-plan shape in `ces-shared` with a both-sides validator.
- R1 (unversioned `/api/*` on Stamper/EO/AO servers) → module-owned, **cross-ref gaps-stamper/gaps-eo/gaps-ao**.

### SPEC-04 — Security (L2 → L3) GAPPED

**GAP-shared-04.R13-01** — No SBOM is produced for any release (as-is §SPEC-04). SPEC-04.R13 / SPEC-06.R6 at L3.
- Severity **P3** · Effort **M**
- Remediation: emit a CycloneDX/SPDX SBOM in the release job (pair with the audit gate below).
- R11 (CI dependency-audit gate) → **DUP→GAP-shared-07.R7-04** (same gate, raised under CI). dryRun-default /
  injection guards / the plaintext `--cert-password` option → Stamper/AO-owned, **cross-ref gaps-stamper/gaps-ao**.
  `secretRef` (no plaintext secrets) already **MEETS** — see §Strengths.

### SPEC-05 — Testing (L1 → L3, standing target-not-yet-met) GAPPED

**GAP-shared-05.R7-01** — **No coverage tooling is installed anywhere in the fleet** (`@vitest/coverage-v8`
absent) and no threshold exists; there is no coverage number to gate on (as-is §SPEC-05; `measurements-2026-07-04.md:30`).
SPEC-05.R7 (measure every run) unmet → caps the cell.
- Severity **P2** · Effort **M** · *Fleet-wide, high-leverage — unblocks the CI coverage gate.*
- Remediation: add `@vitest/coverage-v8` + per-workspace threshold config (additive, no product change).
- Golden-artifact coverage for non-EO generators (R5) → module-owned, **cross-ref gaps-stamper/gaps-eo**.
  Strong shared unit/characterization/contract tiers (102 green) already **MEET** the tier requirements — §Strengths.

### SPEC-06 — Packaging & Release (L1 → L2) GAPPED

**GAP-shared-06.R1-01** — `ces-shared` version **frozen at 0.1.0** with **no `CHANGELOG.md`** (`package.json:3`);
the same freeze pattern spans the fleet (as-is §SPEC-06). SPEC-06.R1/R3 (versions must move, changelog per module).
- Severity **P2** · Effort **S** · *High-leverage root pattern (EO's `CHANGELOG.md` v0.2.0 is the exemplar).*
- Remediation: adopt SemVer bumps + a `CHANGELOG.md` in `ces-shared`; replicate across the four modules.

**GAP-shared-06.R7-02** — The de-facto distribution channel (npm workspace symlinking) is undocumented
(as-is §SPEC-06). SPEC-06.R7 satisfied via a *declared* internal linkage channel (profile).
- Severity **P3** · Effort **S**
- Remediation: write down the internal workspace linkage channel with a pointer to `docs/saas-readiness.md`.
- R10 (version self-report on `/api/health`) → module servers, **cross-ref gaps-eo/gaps-ao/gaps-stamper**.

### SPEC-07 — CI/CD (L1 → L3, standing target-not-yet-met) GAPPED — **HEADLINE ROOT**

`ci.yml` runs exactly two steps (`npm ci`, `npm test`). Met: R1 triggers, R2 build, R5 test gate, R8 partial
(golden SSP rides inside `npm test`). The following gates are **absent** — each is a single root-level fix that
lifts the whole fleet at once.

**GAP-shared-07.R3-01** — No **lint** gate (`--max-warnings 0`). SPEC-07.R3 (L2) unmet → caps the cell.
Severity **P2** · Effort **S**. Remediation: add an eslint gate step (root config).

**GAP-shared-07.R4-02** — No **typecheck** gate (`tsc --noEmit` as an explicit step). SPEC-07.R4 (L2) unmet → caps
the cell. Severity **P2** · Effort **S**. Remediation: add a project-references `tsc --noEmit` gate.

**GAP-shared-07.R6-03** — No **coverage-threshold** gate. SPEC-07.R6 (L3). Severity **P2** · Effort **M**
(depends on **GAP-shared-05.R7-01**). Remediation: fail CI below per-workspace thresholds once tooling lands.

**GAP-shared-07.R7-04** — No **dependency-audit** gate; `npm audit` runs nowhere (`measurements-2026-07-04.md:50`).
SPEC-07.R7 / **also closes SPEC-04.R11**. Severity **P2** · Effort **S**. Remediation: add `npm audit` with a
declared severity floor.

**GAP-shared-07.R9-05** — No branch protection asserted for the gate. SPEC-07.R9. Severity **P3** · Effort **S**.

**GAP-shared-07.R11-06** — No build/test artifact retention. SPEC-07.R11 (L2). Severity **P3** · Effort **S**.
- R10 (env promotion) / R12 (deploy metrics) → **WAIVED to L2 while pre-SaaS** (profile §SPEC-07) — `N/A`.

### SPEC-08 — Configuration (L2 → L3) GAPPED

One validated, fail-fast config layer already exists (`validateCesConfig`) — **MEETS** at L2, see §Strengths. The
L3 delta:

**GAP-shared-08.R4-01** — Dev ports 5001-5004 are hardcoded in root scripts (`package.json:13-16`). SPEC-08.R4
(no hardcoded ports, L3). Severity **P3** · Effort **S**. Remediation: move ports behind defaulted config fields.

**GAP-shared-08.R7-02** — No `.env.example` matrix per workspace enumerating consumed variables. SPEC-08.R7 (L2).
Severity **P3** · Effort **S**. Remediation: ship a `.env.example` per workspace.

**GAP-shared-08.R3-03** — No gate enforces "zero env reads outside the config layer." SPEC-08.R3 (L3).
Severity **P2** · Effort **M**. Remediation: add a lint/grep gate for stray `process.env`. Module env-read cleanup
(Stamper ~44 reads, AO port 3000) is the EoConfig-convergence work → **cross-ref gaps-stamper/gaps-ao**.

### SPEC-09 — Observability (L1 → L2) GAPPED

**GAP-shared-09.R3-01** — The spine ships no shared correlation-ID / structured-logger / audit-record primitive;
persistence rows carry only `createdAt/updatedAt` provenance (as-is §SPEC-09). SPEC-09.R3 (request/correlation IDs)
+ R4 (privileged-action audit) at L2.
- Severity **P2** · Effort **M**
- Remediation: add a shared correlation-ID helper + an audit-record writer for privileged AO/EO actions. Per-server
  edge wiring and the winston-posture convergence are module-owned → **cross-ref gaps-eo/gaps-ao/gaps-stamper**.

### SPEC-10 — Documentation (L1 → L2) GAPPED

**GAP-shared-10.R1-01** — No `ces-shared/README.md` (purpose/run/test), the mandatory per-module README
(as-is §SPEC-10). SPEC-10.R1 (L2, mandatory).
- Severity **P2** · Effort **S** · Remediation: author `ces-shared/README.md` (+ a minimal runbook, R2).

**GAP-shared-10.R1-02** — No **root `README.md`** and no single onboarding entry point (as-is §SPEC-10).
SPEC-10.R1/R4.
- Severity **P2** · Effort **S** · Remediation: author the root README as the monorepo onboarding entry.
- ADRs + `docs/context` + `docs/specs` library already **MEET** R3 — see §Strengths. `session-*.md`/planning `.md`
  are forbidden from satisfying R1–R3 (SPEC-10.R6).

### SPEC-11 — Data & Persistence (L2 → L3 MANDATORY) GAPPED

Tenant isolation is already enforced at L3 and content hashing is available — **MEETS** those, see §Strengths.
The L3-mandatory gaps:

**GAP-shared-11.R4-01** — `CesRepository` exposes generic `update()`/`delete()` on **every** record; there is **no
WORM/append-only guard** for integrity-critical collections — in-place mutation of a committed evidence record does
not throw (`CesRepository.ts` §SPEC-11). SPEC-11.R4 tightened to L3-mandatory (profile).
- Severity **P1** (evidence-integrity claim / attestation readiness) · Effort **M**
- Remediation: mark integrity-critical collections append-only; make mutation throw; corrections become superseding
  versions; assert with a test. **Distinct from** blob-WORM: **DUP-adjacent→G8(b)/G10-WORM** cover blob-upload
  immutability, *not* the SQLite repository guard — this finding is the repo-layer gap and remains open.

**GAP-shared-11.R2-02** — Schema is applied by inline `CREATE TABLE IF NOT EXISTS`, not numbered forward-only
migrations (as-is §SPEC-11). SPEC-11.R2 (L2).
- Severity **P2** · Effort **M** · Remediation: add a numbered migration runner. **Cross-ref punchlist**
  "Harden CES persistence - DB" / "Harmonize CES persistence".

**GAP-shared-11.R5-03** — No retention job enforces the 6-year CUI window (as-is §SPEC-11). SPEC-11.R5 tightened to
6 years, cited-in-config, with an enforcement path (profile).
- Severity **P2** · Effort **M** · Remediation: add a config-driven lifecycle/disposal job for CUI-classed records.
- Backup/restore (R8) → **DUP→GAP-shared-12.R6-02**. RSA-PSS signing (beyond R3 content-hash) → **DUP→G8(a)/G11**.

### SPEC-12 — Deployment & Operations (L1 → L2) GAPPED

**GAP-shared-12.R1-01** — No per-module deploy/install runbook (as-is §SPEC-12). SPEC-12.R1 (L2).
Severity **P2** · Effort **M** · Remediation: write install/deploy runbooks off the existing `build:core` path.

**GAP-shared-12.R6-02** — No documented, exercised backup/restore for `ces.db` **and** the local blob store
(as-is §SPEC-12). SPEC-12.R6 tightened to include evidence blobs + post-restore hash re-verification (profile;
pairs SPEC-11.R8).
- Severity **P2** · Effort **M** · Remediation: document + exercise a backup→restore round-trip that re-verifies
  content hashes.

**GAP-shared-12.R2-03** — No rollback procedure (as-is §SPEC-12). SPEC-12.R2. Severity **P3** · Effort **M**.

**GAP-shared-12.R4-04** — No manual-step register for the irreducible live-tenant manual steps (cert-auth setup,
admin-consent grants, GCC High egress config). SPEC-12.R4 tightened to mandatory L3; this register is where the
SPEC-01.R9-waived ACs land (profile).
- Severity **P2** · Effort **M** · Remediation: create the manual-step register; cross-link waived SPEC-01.R9 ACs.

---

## Strengths (recorded — the spine's already-good work)

- **CesRepository scope enforcement at L3 (SPEC-11.R6/R7):** empty scope throws `CesScopeError`
  (`CesRepository.ts:120-143`); unscoped reads are impossible by construction; two-tenant no-leak test asserted.
- **`secretRef` / centralized config (SPEC-04.R3/R4/R5):** no plaintext secret path; typed centralized product config.
- **EoConfig-style validators (SPEC-08.R1/R2):** `validateCesConfig` fail-fast + typed `CesConfig`; the stack-provider
  seam validates on every `StackRegistry.register`. Genuine both-sides contracts.
- **Canonical hashing (SPEC-11.R3):** `canonicalSha256` order-stable content hashing (fixes the old G8(d) key-order bug).
- **ADRs (SPEC-10.R3 / SPEC-02.R1/R7):** four numbered immutable ADRs cited from the code they govern.
- **Strong shared test tiers (SPEC-05.R1):** 102 green unit/characterization/contract tests, deterministic via
  injectable clock.

## Dedup ledger

| Item | Owner | This report |
|---|---|---|
| RSA-PSS evidence signing | G8(a) risk-accepted / G11 | not re-raised (beyond SPEC-11.R3 content-hash) |
| Blob-upload WORM immutability | G8(b) risk-accepted / G10-WORM | repo-layer WORM raised as 11.R4-01 (distinct); blob path cross-ref |
| EO endpoint auth + tenant `?tenant=` | G8(c) / gaps-eo | module-owned, cross-ref |
| Hash key-order determinism | G8(d) — FIXED | now a strength (canonicalSha256) |
| Stamper env-reads / AO port 3000 / cert-password / injection guards | gaps-stamper, gaps-ao | cross-ref |
| `/api` versioning, EoServer LOC budget, health version | gaps-eo/gaps-ao/gaps-stamper | cross-ref |
| Persistence hardening / DB | punchlist ("Harden/Harmonize CES persistence") | cross-ref 11.R2-02 |

Punchlist dedup: `punchlist-import.csv` was ingested; its rows are business/roadmap buckets (naming, pricing,
stacks, persistence hardening) — only the persistence-hardening row maps to a spec cell (11.R2-02), cross-referenced.
