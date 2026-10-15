# AS-IS — ces-ao — 2026-07-04 (commit a0d6ae1)

AdminOps: the CMMC operations console. One governed execution engine
(`src/execution/invokeCommand.ts`) driven through three parallel surfaces — a CLI
(`src/cli/index.ts`), a single-file Express + static-SPA server (`src/server/AoServer.ts` +
`public/index.html`), and an MCP stdio server (`mcp/ao-mcp-server.mjs`) — over a 95-command
registry of Microsoft Graph / Azure / Purview PowerShell operations.

Read-only audit per the G-SPEC-2 scope guard: zero product/config/test changes. Every claim below
cites current `file:line` or the shared measurements doc (`measurements-2026-07-04.md`). The recon
(`docs/context/SPEC_RECON.md`, 2026-07-01) is stale and was NOT relied on.

---

## 1. Identity

| Field | Value | Evidence |
|---|---|---|
| Package | `ces-ao` | `ces-ao/package.json` (`"name": "ces-ao"`) |
| Version | `0.1.0` (frozen; also hardcoded) | `package.json`; `health.routes.ts:6`; `cli/index.ts:12` |
| Source size | 3,785 src LOC (ts/tsx, excl. tests) | `measurements-2026-07-04.md` §Source size |
| Tests | 11 test files, **171** tests, vitest | `measurements`; `grep it(/test( test/*.ts` |
| Entry points | CLI `ao` (`src/cli/index.ts`); HTTP server (`AoServer.start(port)`); MCP stdio (`mcp/ao-mcp-server.mjs`) | see files |
| Shared headless core | `src/execution/invokeCommand.ts` — CLI + MCP call the SAME engine | `invokeCommand.ts:3-4`, `65-81` |
| HTTP surface | 7 route patterns across `src/server/routes/*.ts` (health, tenant, commands, execute, approvals) | `measurements` §HTTP surface; `AoServer.ts:50-54` |
| Registry | `src/registry/ao-commands.registry.json` — **95** commands (up from 85; +A-19/20, D-11, F-13/14) | `grep -c '"id":'` = 95; `measurements` §HTTP |
| Port | operator-supplied, default 3000 | `cli/index.ts:17`; `AoServer.start(port)` |
| README | **MISSING** (no `README.md`, no `CHANGELOG.md`) | `find ces-ao -maxdepth 1 -iname README*/CHANGELOG*` → none |
| Prod vulns | 0 | `measurements` §Supply-chain |

---

## 2. Scorecard

| # | Dimension | Level | One-line justification |
|---|---|---|---|
| 01 | Concept & Requirements | **L2** | Every registry command carries `cmmcPractices`, threaded to evidence `controlIds`; consistent but no enforcing traceability gate. |
| 02 | Architecture & Design | **L2** | Clean numbered-module + adapter layering; one headless engine fanned to CLI/HTTP/MCP; documented in `MODULE_MAP.md`; no dependency-enforcement mechanism. |
| 03 | API & Contracts | **L2** | Thin route surface with consistent manual body validation + error→HTTP mapping; TS cross-module `CommandEntry` typing; no runtime schema, no API version (gap vs L3 R5/R7). |
| 04 | Security | **L1** | Standout SoD/approval design, but **no HTTP auth on the server** and **unescaped PowerShell template interpolation** — R8 injection guard (mandatory L3 for AO) is unmet. |
| 05 | Testing | **L2** | 171 tests run in CI via `npm test`; no coverage tooling installed and no threshold gate anywhere (gap vs L3). |
| 06 | Packaging & Release | **L1** | Version frozen at `0.1.0` (3 hardcoded sites); no `CHANGELOG.md`; no publish/artifact step (gap vs R1/R3 target). |
| 07 | CI/CD | **L2** | `.github/workflows/ci.yml` runs build+full suite on every push/PR and fails on red; single gate only (no lint/typecheck/coverage/audit) — meets pre-SaaS L2 target. |
| 08 | Configuration | **L1** | Tenant/CES config loaded consistently via ces-shared, but env vars undocumented, no config schema validation, no documented matrix (no README). |
| 09 | Observability | **L1** | Strong per-action audit (SHA-256 StructuredEvidence) + `/api/health`, but ~4 operational `console` calls, no request IDs, no structured logger (gap vs R1 floor). |
| 10 | Documentation | **L1** | Rich `docs/context/*` + dense inline comments, but the **mandatory per-module README is absent** (R1 unmet). |
| 11 | Data & Persistence | **L2** | All writes go through the tenant-isolated `getCesRepository()` with ces identity + idempotency + SHA-256; the WORM/isolation enforcement mechanism itself lives in ces-shared. |
| 12 | Deployment & Operations | **L1** | Safe operator-local run model (dryRun default, health check, MCP hard-block) but no runbook/README and no deploy automation — ops knowledge is tribal. |

Compact: `01 L2 · 02 L2 · 03 L2 · 04 L1 · 05 L2 · 06 L1 · 07 L2 · 08 L1 · 09 L1 · 10 L1 · 11 L2 · 12 L1`

---

## 3. Evidence

### 01 — Concept & Requirements — L2
- Every registry command declares CMMC provenance: e.g. F-13 lists `SC.L2-3.13.1[e][f][h], SC.L2-3.13.6[a][b]` (`ao-commands.registry.json:1525`); templates cite the practice they remediate (`TemplateRegistry.ts:761-763` D-11 → MP-3.8.2/3.8.4). 48 parameters carry a config `source` binding (`grep -c '"source"'` = 48).
- Traceability is threaded to output: `control_ids: aoCommand.cmmcPractices` (`RegistryBridge.ts:42`) → evidence `controlIds` (`EvidenceEmitter.ts:46`, `114-115`).
- **Not L3:** no test/CI asserts every command maps to a live requirement; a mistagged command would not fail the build.

### 02 — Architecture & Design — L2
- Numbered single-responsibility modules (`SodGate.ts:1` "Module 8", `CommandExecutor.ts:1` "Module 7", `ParameterMapper.ts:1` "Module 6") + an adapter borrowed from ces-stamper (`CommandExecutor.ts:36` imports `PowerShellAdapter`).
- One engine, three surfaces: CLI and MCP both call `invokeAoCommand` (`cli/index.ts:71`, `ao-mcp-server.mjs:101`); HTTP calls `executeAoCommand` (`execute.routes.ts:88`) — the SoD/dryRun/evidence pipeline is shared, not duplicated (`invokeCommand.ts:3-4`).
- Documented in `docs/context/MODULE_MAP.md`. **Not L3:** no automated layering/dependency check.

### 03 — API & Contracts — L2
- Validation is present and consistent on the write path: tenant + inputs type checks and required-param loop (`execute.routes.ts:40-52`, `77-85`); approvals validate `decision`/`approverUPN` (`approvals.routes.ts:48-56`); error→HTTP mapping is systematic (200/400/403/404/409/500/202, `execute.routes.ts:98-144`, `approvals.routes.ts:60-65`).
- Cross-module contract is compile-time only (`CommandEntry` from `ces-shared/types/registry`).
- **Gap vs L3 (R5/R7 tightening):** no runtime schema (no Zod at the boundary), and no API version segment/header anywhere (`measurements` §HTTP: grep `/v1` → none).

### 04 — Security — L1  ⚠ sharpest findings
- **No HTTP authentication.** `AoServer.start` mounts only `express.json` + routers; there is no auth/session/API-key middleware (`AoServer.ts:83-106`). `tenantLoader` resolves a tenant slug but performs no authZ (`middleware/tenantLoader.ts:4-25`). Anyone who can reach the port can drive `POST /api/execute/:commandId` and the approvals API.
- **Unescaped PowerShell template injection.** User inputs are flattened to strings with no escaping/quoting (`ParameterMapper.ts:40`, `48` — `String(value)`), then substituted raw into the command string via `interpolateVariables` (`ces-stamper/src/adapters/PowerShellAdapter.ts:1597-1609`, plain `result.replace(...,String(value))`) and run as a script (`PowerShellAdapter.ts:1615-1617`). A value such as `x'; Remove-Item C:\ -Recurse; '` injected into e.g. `Remove-MgUser -UserId '{targetUPN}'` (`TemplateRegistry.ts:297`) breaks out of the quoting. No `inject|escape|sanitize|quote` test exists (`grep` in `test/` → only an unrelated "escapes the sandbox" comment, `commandExecutionE2E.test.ts:96`). The CES profile marks SPEC-04.R8 (shell-injection guards) **mandatory L3 for AO** — directly unmet.
- **STRENGTHS (real, but they don't lift the dimension floor):**
  - *Params-hash-bound two-person SoD approvals.* Approval binds to a canonical SHA-256 of inputs (`ApprovalStore.ts:42-47`, `77`); pre-live re-check rejects a different command or drifted parameters (`ManualGateAdapter.ts:47-72`, esp. `paramsHash !== hashInputs` `:67`); approver≠requestor enforced (`ApprovalStore.ts:113-117`); approval is single-use, consumed only on a real LIVE run (`CommandExecutor.ts:216-224`).
  - *Three-surface SoD parity.* The Tier-3 gate reaches CLI (`cli/index.ts:110-124` `approve`/`approvals`), GUI (`approvals.routes.ts` + `public/index.html` modal), and MCP (`ao-mcp-server.mjs:59-83` `ao_approvals`/`ao_approve`).
  - *dryRun-default + get-then-set.* `dryRun` defaults true across CLI/HTTP/MCP/engine (`invokeCommand.ts:65`, `execute.routes.ts:92`, `ao-mcp-server.mjs:98`); writes never blind-fire — read→preview→set→verify (`GetThenSetExecutor.ts:6-14`).
  - *MCP live-write hard-block.* `dryRun:false` is silently forced back to true unless `AO_MCP_ALLOW_APPLY=1` (`ao-mcp-server.mjs:23`, `98-107`); `ao_approve` is likewise blocked without it (`:120-123`).
  - *MCP request serialization.* stdio requests are handled strictly in order via a promise queue to close an approve→execute race (`ao-mcp-server.mjs:166-180`).

### 05 — Testing — L2
- 171 tests, 11 files (`measurements`; `test/*.ts`), including an end-to-end path (`commandExecutionE2E.test.ts`) and the SoD/hash core (`ApprovalStore.test.ts`, `TemplateRegistry.test.ts`). Run in CI via the root `npm test` aggregate.
- **Gap vs L3:** `@vitest/coverage-v8` is absent, so no coverage number is producible and no threshold is gated anywhere (`measurements` §Coverage). `strict: true` (`tsconfig.json`) is a compile-time strength but is not a coverage control.

### 06 — Packaging & Release — L1
- Version frozen at `0.1.0` and duplicated in three hand-maintained sites (`package.json`; `health.routes.ts:6`; `cli/index.ts:12`) — they can drift.
- No `CHANGELOG.md` and no README (`find` → none). No publish/build-artifact step beyond `tsc`. Meets neither the R1 (semver movement) nor R3 (changelog) profile target.

### 07 — CI/CD — L2
- `.github/workflows/ci.yml` triggers on push (`master`, `g0-safety-net`) + all PRs, runs `npm ci` then `npm test` (build + full aggregate suite incl. ao), with `cancel-in-progress` concurrency; a red test fails the job (real enforcing mechanism).
- **Single gate only:** no lint, typecheck, coverage, or `npm audit` gate (`measurements` §CI gates). The pre-SaaS profile target for this dimension is L2 — met.

### 08 — Configuration — L1
- Tenant config resolved+loaded consistently via ces-shared (`execute.routes.ts:58-59`; `middleware/tenantLoader.ts:2`, `13-14`); CES identity via `loadCesConfig()` (`ApprovalStore.ts:11`, `74`).
- Env vars steer behavior but are undocumented and unvalidated: `AO_MCP_ALLOW_APPLY` (`ao-mcp-server.mjs:23`), `NODE_ENV` (`execute.routes.ts:152`), `CES_PIPELINE_ROOT` (`ApprovalStore.ts:5` comment). No config schema validation, no documented matrix (no README) — works by convention (R7 L2 target unmet).

### 09 — Observability — L1
- **STRENGTH — privileged-action audit:** every execution emits `StructuredEvidence` with a SHA-256 hash, `controlIds`, `executorIdentity: 'cse-ao-service'`, and UTC timestamp, persisted tenant-isolated + idempotently (`EvidenceEmitter.ts:37-59`, `93-127`). Get-then-set records pre/post state on the evidence (`CommandExecutor.ts:210-214`). `/api/health` present (`health.routes.ts:6`).
- **Gap:** operational logging is near-zero — ~4 non-CLI `console` calls (`AoServer.ts:33,76,103`; `execute.routes.ts:148`); the other 22 are CLI user output. No request/correlation IDs, no structured logger (no Winston, unlike Stamper). The profile's R1 floor (request IDs + structured logs) is unmet, capping the dimension at L1 despite the R2 audit strength.

### 10 — Documentation — L1
- Substantial pipeline artifacts (`docs/context/VAULT.md`, `MODULE_MAP.md`, `PLAN.md`, `IMPLEMENTATION_LOG.md`) and heavy inline comments (e.g. `ManualGateAdapter.ts:1-9`, `TemplateRegistry.ts:64` A-19 rationale).
- **R1 mandatory unmet:** no module `README.md` exists — the one required entry-point doc is absent. Docs are ad hoc, not the systematic per-module baseline the L2 target requires.

### 11 — Data & Persistence — L2
- All persistence goes through the shared isolated store: approvals `put`/`findById`/`listAll` on `adminops_approvals` with ces identity on every record (`ApprovalStore.ts:15`, `49-55`, `87`, `146-150`); evidence on `adminops_evidence`, tenant-scoped, idempotent (key `commandId:executionId`), SHA-256-hashed (`EvidenceEmitter.ts:14`, `98-127`).
- **L2, not AO-owned L3:** the isolation-throw + WORM enforcement mechanism the profile marks L3-mandatory resides in ces-shared `CesRepository`, tested there — AO consistently *uses* it but does not itself enforce it. Scored on AO's consistent, correct use.

### 12 — Deployment & Operations — L1
- Operator-local run model appropriate to the pre-SaaS L2 target: `ao gui` (`cli/index.ts:14-21`), auto-mkdir of plan-data (`AoServer.ts:90-93`), safe defaults (dryRun, MCP hard-block, health probe).
- **Gap:** no runbook, no README, no deploy automation, no documented manual-step register (R4 tightening) — starting/operating/recovering the three surfaces is tribal knowledge. Undocumented operation holds this below the L2 documented-operability bar.

---

## 4. Contracts

| Seam | Direction | Shape | Validation status |
|---|---|---|---|
| `CommandEntry` | consumes (ces-shared → AO) | `ces-shared/types/registry` translated in `RegistryBridge.ts:19-57` | Compile-time TS only (`strict`); no runtime schema |
| `PowerShellAdapter` | consumes (ces-stamper → AO) | `CommandExecutor.ts:36`, `107` | Interface contract; **inputs interpolated unescaped** (see §04) |
| `getCesRepository()` collections | consumes (ces-shared) | `adminops_approvals`, `adminops_evidence` (`ApprovalStore.ts:15`, `EvidenceEmitter.ts:14`) | Isolation/WORM enforced in ces-shared, not AO |
| CES identity | consumes | `resolveCesIdentity(loadCesConfig(), {tenantId})` (`ApprovalStore.ts:74`, `EvidenceEmitter.ts:108`) | Stamped on every record; not schema-validated at AO boundary |
| `POST /api/execute/:commandId` | exposes | `{tenant, inputs, dryRun?, requestorUPN?, approvalId?}` (`execute.routes.ts:37`) | Manual presence/type checks; **no auth** |
| `GET/POST /api/approvals[/:id][/decision]` | exposes | SoD decision `{approverUPN, decision, reason?}` (`approvals.routes.ts:45-57`) | Manual validation; SoD enforced in store; **no auth** |
| MCP tools | exposes | `ao_list_commands / ao_get_command / ao_execute / ao_approvals / ao_approve` (`ao-mcp-server.mjs:26-84`) | JSON-schema `inputSchema`; apply-gated by `AO_MCP_ALLOW_APPLY` |
| Tenant config | consumes | `resolveTenantJsonPath` + `loadTenantConfig` (`execute.routes.ts:58-59`) | Path resolution; no config schema validation |

---

## 5. Watchlist

- **SPEC-04 R8 (injection) — mandatory L3, currently L1.** Unescaped `String(value)` interpolation into live PowerShell (`ParameterMapper.ts:40/48` → `PowerShellAdapter.ts:1597-1609`) is the highest-severity open gap; fixing it is a future G-goal, not this audit. Escalated in this turn's summary.
- **No server auth — currently L1.** `AoServer` has zero authN/authZ; any future move off pure operator-localhost (or exposure of the port) makes this exploitable in concert with the injection surface.
- **Frozen `0.1.0` in three sites** (`package.json`, `health.routes.ts:6`, `cli/index.ts:12`) will drift; the profile's unfreeze+CHANGELOG target (SPEC-06) is in-flight backlog.
- **Coverage un-measurable** until `@vitest/coverage-v8` is added; SPEC-05 L3 target is blocked on a (deferred, read-only-scope-excluded) dependency add.
- **README absent** — a single mandatory doc would move SPEC-10 (and help SPEC-08/12) off L1.
- **AO write-command / MCP maturity** (registry grew 85→95, ARM channel F-13/F-14 + `source` auto-fill added this session) means the surface is actively expanding; re-audit after the next batch. The MCP approve→execute race fix (`ao-mcp-server.mjs:166-180`) is new — watch for regression if the stdio loop is refactored.
