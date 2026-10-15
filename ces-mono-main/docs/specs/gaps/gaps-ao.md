# GAP — ces-ao — Ideal (CES profile) vs As-Is

**Method:** `docs/G-SPEC-3-plan.md` · **As-is baseline:** `docs/specs/as-is/as-is-ao.md` (commit a0d6ae1) ·
**Targets:** `docs/specs/ideal/ces-profile.md` · **Core R#:** `docs/specs/ideal/core/SPEC-01..12.md`
**Scope guard:** READ-ONLY. This report diffs and prioritizes; it changes nothing.

AO is the strongest module overall (mostly L2), but Security is L1 and carries the module's — and the
product's — single highest-severity open finding. A gap is flagged only where `as-is < target`
(SPEC-00.R6); the two `*(target, not yet met)*` dimensions (SPEC-05, SPEC-07) are the expected standing
stretch gaps and are cross-referenced, not re-raised as AO-owned.

---

## Cell disposition (12 dimensions)

| # | Dimension | Target | As-is | Disposition |
|---|---|---|---|---|
| 01 | Concept & Requirements | L3 | L2 | **GAPPED** (R12 traceability not enforced) |
| 02 | Architecture & Design | L2 (L3 on R4/R8/R10) | L2 | **GAPPED** (minor: R4 dep-check; R8/R10 are seam/EO-owned) |
| 03 | API & Contracts | L2 (L3 on R5/R7) | L2 | **GAPPED** (minor: R1 unversioned `/api`; R5/R7 are stamper↔EO-owned) |
| 04 | Security | **L3** | L1 | **GAPPED** (P0 injection + P1 no server auth) |
| 05 | Testing | L3 *(not yet met)* | L2 | **GAPPED** (DUP → SPEC-05 stretch / coverage goal) |
| 06 | Packaging & Release | L2 | L1 | **GAPPED** (frozen 0.1.0, no CHANGELOG) |
| 07 | CI/CD | L3 *(not yet met)* | L2 | **GAPPED** (DUP → SPEC-07 stretch / CI-gates goal) |
| 08 | Configuration | L3 | L1 | **GAPPED** (hardcoded port, no schema, no `.env.example`) |
| 09 | Observability | L2 | L1 | **GAPPED** (no request IDs, no structured logger) |
| 10 | Documentation | L2 | L1 | **GAPPED** (mandatory README absent) |
| 11 | Data & Persistence | L3 (mandatory) | L2 | **GAPPED** (DUP → G10-WORM / G8(b); enforcement is ces-shared-owned) |
| 12 | Deployment & Operations | L2 | L1 | **GAPPED** (no runbook, no manual-step register) |

No cell is WAIVED for AO — every profile waiver (`SPEC-03.R2/R3`, `SPEC-04.R1/R9/R10`) is scoped to the
offline Planner, not AO's live servers.

---

## STANDOUT STRENGTH — exemplary, meets/exceeds target (SPEC-04)

**paramsHash-bound two-person Separation-of-Duties approval, at parity across all three surfaces.**
This is the reference implementation of the profile's `SPEC-04` CES tightening ("for Tier-3 actions the
two-person SOD approval MUST bind to the canonical params hash before any live call") and it is done
*better* than the requirement asks:

- Approval binds to a canonical SHA-256 of the inputs (`ApprovalStore.ts:42-47`, `:77`); a pre-live
  re-check rejects a different command or any drifted parameter (`ManualGateAdapter.ts:47-72`, esp.
  `paramsHash !== hashInputs` at `:67`).
- Approver ≠ requestor is enforced (`ApprovalStore.ts:113-117`); the approval is single-use, consumed
  only on a genuine LIVE run (`CommandExecutor.ts:216-224`).
- The Tier-3 gate reaches CLI (`cli/index.ts:110-124`), GUI (`approvals.routes.ts` + `public/index.html`
  modal), and MCP (`ao-mcp-server.mjs:59-83`) — **no surface can bypass it**.
- Reinforced by dryRun-default everywhere (`invokeCommand.ts:65`, `execute.routes.ts:92`,
  `ao-mcp-server.mjs:98`), get-then-set writes (`GetThenSetExecutor.ts:6-14`), an MCP live-write
  hard-block (`ao-mcp-server.mjs:23,98-107`), and stdio request serialization that closes the
  approve→execute race (`ao-mcp-server.mjs:166-180`).

This design MEETS/EXCEEDS the L3 target for the SoD CES requirement and should be treated as the
cross-module exemplar. It is undermined only by the two Security findings below (auth + injection), which
sit *upstream* of the gate on the same server — hence Security still floors at L1.

---

## Findings by severity

### P0 — security-critical on a live path (fix-next)

**GAP-ao-04.R8-01 — Unescaped PowerShell template interpolation → live-tenant command injection.**
User/config inputs are flattened to strings with **no escaping, quoting, or allowlist** — `String(value)`
at `ParameterMapper.ts:40` (config-sourced) and `:48` (user inputs) — then substituted raw into the
command template by `interpolateVariables` (`ces-stamper/src/adapters/PowerShellAdapter.ts:1604-1605`,
plain `result.replace(new RegExp(...), String(value))`), wrapped as a script and executed
(`PowerShellAdapter.ts:1615-1617`, via `TemplateRegistry.ts` command strings, e.g. the
`Remove-MgUser -UserId '{targetUPN}'` shape at `TemplateRegistry.ts:297`). A value such as
`x'; Remove-Item C:\ -Recurse; '` breaks out of the surrounding quotes and runs attacker-chosen
PowerShell against the live GCC High tenant. No `inject|escape|sanitize|quote` test exists in `test/`.
- **Violates:** `SPEC-04.R8` — profile marks injection guards **mandatory L3 for AO** (`ces-profile.md`
  SPEC-04: "AO's `TemplateRegistry` PowerShell/shell template substitution: every interpolated value
  passes an escaping/allowlist guard, **verified by test**"). Currently L1.
- **Severity:** P0. **Effort:** M.
- **Shared root cause:** identical class to the Stamper injection surface — AO *borrows the exact adapter*
  (`CommandExecutor.ts:36` imports `PowerShellAdapter` from ces-stamper). The escaping/allowlist guard
  belongs in that shared adapter so one fix covers both modules. See `docs/specs/gaps/gaps-shared-root.md`
  and the Stamper gap for the paired manifestation; this AO row remains a live AO finding.
- **Remediation sketch:** introduce a single PowerShell-argument escaping/quoting (or parameterized
  invocation / allowlist) primitive in the shared adapter; route *all* interpolated values through it;
  add breakout-attempt tests to both AO and Stamper. Pairs with `SPEC-05.R9`/`SPEC-04.R8` (injection
  guards test-covered) and is the natural anchor for a "shared injection guard" candidate goal.

### P1 — blocks the product's own safety claims

**GAP-ao-04.R1-01 — No authentication on the AO HTTP server.**
`AoServer.start` mounts only `express.json` + routers — no auth/session/API-key middleware
(`AoServer.ts:83-106`); `tenantLoader` resolves a tenant slug but performs zero authZ
(`middleware/tenantLoader.ts:4-25`). Anyone who can reach the port can drive
`POST /api/execute/:commandId` and the approvals API (`execute.routes.ts`, `approvals.routes.ts` —
"**no auth**" per as-is Contracts table).
- **Violates:** `SPEC-04.R1` (server-side authN) — the profile's R1 waiver is scoped to the offline
  Planner only; AO runs a live server, so R1 applies. Target L3, currently L1.
- **Severity:** P1 (P0-adjacent: compounds GAP-ao-04.R8-01 — an unauthenticated caller reaches the
  injection surface directly). **Effort:** M.
- **Not deduped:** G8(c) and Phase-3 G12 add auth for the **EO** server only (`CES_EO_AUTH_TOKEN`); the
  **AO** server has no equivalent. This is a new, AO-owned finding. An env-gated bearer gate modeled on
  EO's `authMiddleware.ts` is the obvious pattern to port.

### P2 — engineering-maturity debt (compounding cost)

**GAP-ao-01.R12-01 — CMMC traceability documented but not enforced.**
Every command carries `cmmcPractices` threaded to evidence `controlIds` (`RegistryBridge.ts:42`,
`EvidenceEmitter.ts:46,114-115`), but no test/CI asserts every command maps to a live requirement — a
mistagged or orphaned command would not fail the build (as-is §01 "Not L3").
- **Violates:** `SPEC-01.R12` (mandatory L3 — the compliance product's traceability spine). Target L3,
  as-is L2. **Severity:** P2. **Effort:** M. Remediation: a build-time assertion that every registry
  `cmmcPractices` entry resolves against the EO determination-ledger / assessment-objective set.

**GAP-ao-06.R1-01 — Version frozen at `0.1.0`, hand-duplicated in three sites.**
`0.1.0` is hardcoded in `package.json`, `health.routes.ts:6`, and `cli/index.ts:12` — they can drift and
never move on release. **Violates:** `SPEC-06.R1` (semver movement) + `SPEC-06.R10` (version self-report
via health). Target L2, as-is L1. **Severity:** P2. **Effort:** S. Remediation: single source of version
(read `package.json`), surface build commit on `/api/health`.

**GAP-ao-06.R3-01 — No CHANGELOG.**
No `CHANGELOG.md` (`find` → none). **Violates:** `SPEC-06.R3`; EO's `CHANGELOG.md` v0.2.0 is the named
exemplar to match. **Severity:** P2. **Effort:** S.

**GAP-ao-08.R4-01 — Hardcoded port + no validated config schema.**
Port `3000` is hardcoded (`cli/index.ts:15`); steering env vars (`AO_MCP_ALLOW_APPLY`, `NODE_ENV`,
`CES_PIPELINE_ROOT`) are undocumented and unvalidated; no Zod schema at startup.
**Violates:** `SPEC-08.R4` (validated/defaulted config field — profile names AO's port explicitly) and
`SPEC-08.R1/R2/R8` (converge on the `EoConfig` Zod-validate-and-throw pattern). Target L3, as-is L1.
**Severity:** P2. **Effort:** M. Remediation: an `AoConfig` modeled on `ces-eo/.../EoConfig.ts`.

**GAP-ao-08.R7-01 — No `.env.example` matrix.**
No documented variable matrix. **Violates:** `SPEC-08.R7` (documented matrix at L2 — each workspace ships
a `.env.example`). **Severity:** P2. **Effort:** S. (Pairs with GAP-ao-10.R1-01.)

**GAP-ao-09.R3-01 — No request/correlation IDs; no structured logger.**
Operational logging is ~4 raw `console` calls (`AoServer.ts:33,76,103`; `execute.routes.ts:148`); no
request IDs, no structured logger (unlike Stamper's winston). **Violates:** `SPEC-09.R3` (request IDs) +
`SPEC-09.R1` (converge logging posture). Target L2, as-is L1. **Severity:** P2. **Effort:** M.
- **Note — R4 audit MEETS target:** the per-action `StructuredEvidence` trail (SHA-256, `controlIds`,
  `executorIdentity`, UTC, tenant-isolated, idempotent — `EvidenceEmitter.ts:37-59,93-127`) already
  satisfies `SPEC-09.R4` (privileged-action audit). The gap is only the request-ID/logging floor (R1/R3).

**GAP-ao-10.R1-01 — Mandatory module README absent.**
No `README.md` in `ces-ao` (`find` → none), despite rich `docs/context/*` pipeline artifacts.
**Violates:** `SPEC-10.R1` (mandatory per module; profile names `ces-ao` as a current R1 gap). Root
`session-*.md` / planning `.md` are explicitly forbidden from satisfying R1 (`SPEC-10.R6`). Target L2,
as-is L1. **Severity:** P2. **Effort:** S. One README (purpose / run / test) also lifts SPEC-08 and
SPEC-12 off L1.

**GAP-ao-12.R2-01 — No runbook / manual-step register / deploy automation.**
Starting, operating, and recovering the three surfaces is tribal (no runbook, no README). CES's
irreducible live-tenant manual steps (cert auth, admin-consent grants, GCC High egress config) are not
captured. **Violates:** `SPEC-10.R2` (runbook) + `SPEC-12.R4` (manual-step register, **tightened to
mandatory L3**). Target L2, as-is L1. **Severity:** P2. **Effort:** M. Overlaps GAP-ao-10.R1-01 (README)
— cluster together.

### P3 — polish / consistency

**GAP-ao-02.R4-01 — No enforced dependency-cycle check.**
Clean numbered-module layering exists but nothing enforces it (as-is §02 "no automated
layering/dependency check"). **Violates:** `SPEC-02.R4` — the profile waives only the *tooling choice*
(madge vs dependency-cruiser), **not** the requirement to have an enforced check. **Severity:** P3.
**Effort:** S. Cross-cutting (all modules) → belongs in a shared CI-gate goal, not AO alone. The R8/R10
Architecture L3 tightenings target the stamper↔EO seam and `EoServer.ts` route/LOC budget — **not
AO-owned**; no AO finding.

**GAP-ao-03.R1-01 — Unversioned HTTP API.**
`AoServer` exposes `/api/*` with no `/v1` segment or version header (as-is §03: grep `/v1` → none).
**Violates:** `SPEC-03.R1` (profile requires a `/v1` mount or version header on each of the four
servers, AO named). **Severity:** P3. **Effort:** S. The R5 (contract-diff gate) and R7 (hard
stamper↔EO contract gate) L3 tightenings are EO/seam-owned — **not AO findings**.

---

## Deduped — cross-referenced, not re-raised

| Cell | Item | Owner / cross-ref |
|---|---|---|
| 05 Testing | No coverage tooling (`@vitest/coverage-v8` absent) or threshold gate | **DUP** → `SPEC-05` stretch target (profile-acknowledged standing gap; "today no module has coverage tooling") + the coverage candidate-goal. Cross-cutting all modules; not AO-owned. |
| 07 CI/CD | No coverage / dependency-audit / explicit lint+typecheck gates | **DUP** → `SPEC-07` stretch target + the CI-gates candidate-goal (pairs with SPEC-05). AO's single test gate meets the pre-SaaS L2 floor; the L3 delta is the standing stretch gap. |
| 11 Data | WORM / append-only not code-enforced (in-place mutation should throw) | **DUP** → Phase-3 **G10-WORM** + **G8 finding (b)** (deferred w/ written risk acceptance) + `gaps-shared-root.md`. Enforcement lives in ces-shared `CesRepository`, not AO. AO correctly *uses* it (tenant-isolated, idempotent, canonical SHA-256 — `ApprovalStore.ts`, `EvidenceEmitter.ts`); the residual L3 gap is not AO-owned. |
| 11 Data | RSA-PSS evidence signing absent (hash-only integrity) | **DUP** → Phase-3 **G11-SIGNING** + **G8 finding (a)** (deferred w/ risk acceptance). Not AO-owned. |

**Punchlist dedup:** `docs/specs/gaps/punchlist-import.csv` (extracted from `cesPunchlist.xlsx`) contains
only high-level buckets ("Ensure AO can handle multiple stacks", "add security and auth best practices",
"add functional test cases for every major use case"). No punchlist row maps 1:1 to an AO finding above at
finding granularity; the auth/test/security themes are already carried by the specific findings and are
not separately re-raised.

---

## Roll-up for AO

- **P0 × 1** — `GAP-ao-04.R8-01` (PowerShell injection; shared root w/ Stamper) — escalated to the user.
- **P1 × 1** — `GAP-ao-04.R1-01` (no server auth; compounds the P0).
- **P2 × 8** — `01.R12-01`, `06.R1-01`, `06.R3-01`, `08.R4-01`, `08.R7-01`, `09.R3-01`, `10.R1-01`,
  `12.R2-01`.
- **P3 × 2** — `02.R4-01`, `03.R1-01`.
- **DUP × 4** — 05 coverage, 07 CI gates, 11 WORM (G10/G8b), 11 signing (G11).
- **Exemplar strength** — paramsHash-bound two-person SoD approval at three-surface parity
  (SPEC-04 CES requirement, meets/exceeds L3).
