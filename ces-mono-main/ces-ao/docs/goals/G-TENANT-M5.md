# Goal Document — G-TENANT-M5

**Provenance:** Founder correction 2026-07-10: "AO needs the tenant manager as well" — supersedes
the G-TENANT-DEFERRED note (deleted; its "no current tenant-connection code" premise was an
unresearched assumption, disproven by direct recon of this repo and by `tenant-stacksim`'s coverage
inventory, which replays AO calls today — 139 of the 523 inventoried calls are AO-sourced,
`tenant-stacksim/coverage/inventory.json`, `counts: { stamper: 348, eo: 36, ao: 139 }`). M0
interface gate passed 2026-07-10 (founder review of `ces-tenant`'s `src/*.ts` interfaces: approved
as ratified). This brief authored 2026-07-10, distributed from the `ces-strategy` session that
executed the M0 interface work. Self-contained — a fresh session in this repo needs nothing outside
this file, the design doc, and `ces-tenant`'s `README.md` + `src/*.ts` (read-only, in the sibling
repo).

## Job

ces-ao connects to tenants today — but with a different coupling shape than ces-eo's. It does
**not** carry a duplicate `SessionManager.ts`; instead it **deep-imports Stamper's internals
cross-package** (`"ces-stamper": "*"` workspace dependency, `ces-ao/package.json`):

- `src/execution/AuthChain.ts:9` — `import { SessionManager } from 'ces-stamper/core/session'`;
  `AuthChain.ts:67` constructs `new SessionManager(tenantConfig as ClientConfig, dryRun)` per
  request.
- `src/execution/AuthChain.ts:4` — `import { StamperConfig } from 'ces-stamper/config/stamper'`;
  `AuthChain.ts:63` builds it via `StamperConfig.fromTenantConfig(mergedConfig)`.
- `src/execution/CommandExecutor.ts:36` — `import { PowerShellAdapter } from
  'ces-stamper/adapters/powershell'`; `CommandExecutor.ts:107` instantiates it with the
  StamperConfig + SessionManager pair for every command execution.

That coupling is to Stamper's *internal module layout*, not to a published contract — which means
**M1 (moving `SessionManager` out of Stamper into `ces-tenant`) breaks or destabilizes AO's imports
directly**. AO is not a "future consumer when needs materialize"; it is a live consumer of the exact
code M1 relocates.

On config-path resolution, AO reads tenant config through **its own chain spanning multiple
conventions** — including one the design doc's three-convention survey (design §2.1) didn't have in
scope:

- `src/config/ClientConfig.ts:11-13` curries `resolveTenantJsonPath(slug, process.cwd())`
  (`ces-shared/config`) — resolving `<cwd>/plan-data/<slug>/<slug>.json`. This is
  **cwd-anchored**: a fourth root-resolution strategy, distinct from all three the design doc
  catalogued (legacy `~/.stamper/tenants/`, `CES_PIPELINE_ROOT/Stamper/plan-data/`, and Stamper's
  `__dirname`-relative `paths.ts`). Where tenant config resolves from depends on the directory the
  AO server/CLI was launched from; ces-ao carries its own `plan-data/` directory in-repo. The
  server middleware `src/server/middleware/tenantLoader.ts:13-14` loads every request's tenant
  through this path.
- `ces-shared`'s resolver itself falls back to the nested legacy path
  `~/.stamper/tenants/<slug>/<slug>.json` (`ces-shared/src/config/TenantConfig.ts:147-151`).
- `src/execution/invokeCommand.ts:48-58` (`resolveTenantConfig`) adds AO's **own third probe**: the
  flat legacy `~/.stamper/tenants/<slug>.json` (line 55) — the exact flat path named in the A9
  hazard (design §2.1), the one `tenant-stacksim`'s `--tenantprobe-flat` writes to. This resolver
  feeds both the CLI (`src/cli/index.ts:71`) and the MCP server (`mcp/ao-mcp-server.mjs:101`).

On endpoints: `AuthChain.ts:23-40` (`resolveStackEndpoints`) resolves cloud-endpoint defaults
through `ces-shared/stack`'s `getActiveStackProvider(tenantConfig)` (default stack
`microsoft-gcc-high`) and merges them into `TenantConfig.endpoints` before building StamperConfig —
AO already has the stack-provider seam the design doc's §2.2 says must be *newly designed* for
`ces-tenant`. But the merged endpoints feed only StamperConfig; the imported `SessionManager`'s
`buildConnectCommand()` still hardcodes GCC High literals (design §2.2), so AO's endpoint seam stops
short of the session layer.

On session breadth: AO's engine router (`src/execution/AdapterRouter.ts:29-66`, `determineEngine`)
maps its 8 domains (A–H) across **all six engines** — `mgraph`, `az`, `spo`, `exchange`, `ipps`,
`teams` (plus `manual_gate` for Tier 3) — so AO exercises every session type SessionManager
supports. The stacksim coverage inventory confirms the real surface: AO's 139-call slice breaks
down as graph-cmdlet 80, other 16, exo-cmdlet 14, invoke-mggraphrequest 12, az-cmdlet 8,
ipps-cmdlet 6, spo-cmdlet 3 (95 read / 44 write), against a 95-command registry
(`src/registry/ao-commands.registry.json`).

On sim-mode: **zero** matches for `stacksim`/`StacksimMode`/`simMode` in `ces-ao/src` — the same
gap ces-eo had pre-M2. Yet stacksim's coverage inventory replays AO's calls, so AO-against-sim is a
real, exercised scenario that AO itself cannot express today.

This goal cuts ces-ao over to `ces-tenant`: the deep imports of Stamper internals are replaced by
`ces-tenant`'s session-factory surface, and AO's multi-convention config-path chain is replaced by
`ces-tenant`'s registry API.

## Must-NOTs (scope fence)

- Do not keep importing `ces-stamper/core/session`, `ces-stamper/config/stamper`, or
  `ces-stamper/adapters/powershell` "temporarily" via re-exports Stamper leaves behind after M1.
  The whole point is that AO stops depending on Stamper's internal module layout; session/config
  construction must come from `ces-tenant`'s surfaces. (If `PowerShellAdapter` specifically remains
  Stamper-owned rather than extracted, that one import may stay — but the SessionManager and
  StamperConfig it is fed must be obtained through `ces-tenant`, and the deviation must be logged.)
- Do not keep `invokeCommand.ts:48-58`'s hand-rolled three-step path chain (override →
  cwd-anchored resolver → flat `~/.stamper` fallback). Tenant resolution goes through
  `ces-tenant`'s registry exclusively; in particular the flat `~/.stamper/tenants/<slug>.json`
  probe (line 55) must be deleted, not preserved as a fallback — it is the A9 collision path.
- Do not keep `ClientConfig.ts:11-13`'s `process.cwd()`-anchored resolution or
  `tenantLoader.ts:13-14`'s use of it. Launch-directory-dependent config resolution is exactly the
  root-resolution drift the registry exists to end.
- Do not hand-roll sim-mode. AO has no StacksimMode equivalent (confirmed: zero matches in
  `ces-ao/src`); the sim capability arrives by consuming `ces-tenant`'s `StacksimModeController` /
  `kind: 'sim'` registry path, same as ces-eo's M2 (design §5, M2 gate).
- Do not discard the stack-provider endpoint seam (`AuthChain.ts:23-40`). It is AO's real,
  working prior art for design §2.2's endpoint-table scope — reconcile it with `ces-tenant`'s
  connection-profile surface (consume, or migrate into, per what M1 actually shipped), don't
  silently drop it or fork a second endpoint story.
- Do not expand scope into AO's governance domain — SoD tiers, Tier-3 approvals
  (`ApprovalStore`/`ManualGateAdapter`), get-then-set write safety, evidence
  emission/persistence — none of that is tenant connection; it all stays AO-owned (design §3).

## Acceptance Gate

1. `src/execution/AuthChain.ts` no longer imports from `ces-stamper/core/session` or
   `ces-stamper/config/stamper`; execution context is built from `ces-tenant`'s
   `TenantSessionFactory` (session surface) and connection-profile resolution. Grep for
   `ces-stamper/core/session` and `ces-stamper/config/stamper` across `ces-ao/src` returns zero
   live imports.
2. `invokeCommand.ts`'s `resolveTenantConfig` (lines 48-58) and `ClientConfig.ts`'s cwd-curried
   `resolveTenantJsonPath` (lines 11-13) are deleted or reduced to thin delegations into
   `ces-tenant`'s registry API. Grep for `.stamper` in `ces-ao/src` and `ces-ao/mcp` returns no
   live path construction (comments/docs referencing the legacy path are fine).
3. All three entry points — HTTP server (`tenantLoader` middleware), CLI (`src/cli/index.ts`), and
   MCP server (`mcp/ao-mcp-server.mjs`) — resolve tenants through the same `ces-tenant` registry
   call path; no entry point retains a private fallback chain.
4. ces-ao's existing test suite passes with zero regressions. Baseline, confirmed by direct run
   2026-07-10: **171/171 passing** (`npm test`, vitest; recorded in
   `ces-ao/session-ces-ao-2026-07-10.md`). Re-establish and quote the live number in this goal's
   implementation log before any code changes land, same discipline as M1/M2.
5. New coverage exists demonstrating AO can execute against a `kind: 'sim'` tenant via
   `ces-tenant`'s registry + `StacksimModeController` — grounded in the fact stacksim's inventory
   already replays AO's 139-call surface, so the sim path is testable end-to-end, not hypothetical.
6. Encoding gate: grepping every file touched by this goal for the two-character UTF-8 mojibake
   marker (a-circumflex U+00E2 followed by euro sign U+20AC — the corrupted-smart-quote signature)
   returns 0 matches.

## Preconditions

- **Blocked on M1 shipping.** This goal does not start until `ces-stamper`'s cutover
  (`ces-stamper/docs/goals/G-TENANT-M1.md`) and `ces-tenant`'s M1 implementation
  (`ces-tenant/docs/goals/G-TENANT-1.md`) are both complete. Note AO's exposure is sharper than the
  other consumers': because AO deep-imports the very modules M1 relocates, M1 landing without this
  goal leaves AO pinned to whatever compatibility shims Stamper retains — coordinate so that window
  stays short.
- **Parallel-safe with M2/M3/M4.** No ordering dependency on the ces-eo, muster-api, or
  tenant-stacksim cutovers; only M1 gates this work.

## Pointers (read-only — do not copy content into new files)

- Design doc: `ces-stamper/docs/design/tenant-manager-extraction.md` — §2.1 (path conventions +
  the A9 hazard AO's flat-path fallback touches), §2.2 (endpoint-table scope AO's stack seam
  overlaps), §2.4 (PowerShell session-factory surface this milestone consumes), §5 (M5, corrected
  2026-07-10), §6 (ces-ao per-consumer requirements, corrected 2026-07-10).
- Ratified interfaces (sibling repo, read-only): `ces-tenant/src/session-surface.ts`
  (`TenantSessionFactory`, `StacksimModeController`), `ces-tenant/src/registry.ts` (registry query
  API for resolving tenant config by slug), `ces-tenant/src/connection.ts` (connection profiles /
  endpoint resolution — the surface AO's `resolveStackEndpoints` seam reconciles with).
- Coverage evidence: `tenant-stacksim/coverage/inventory.json` (523 items; `source: "ao"` slice =
  139) — the ground truth for AO's replayed command surface.

## Implementation Log (2026-07-11 — executed)

**Baseline (gate 4, re-established by direct run BEFORE any code change):** `npm test` (vitest
4.1.9) = **171/171 passing, 11 files** — matches the 2026-07-10 recorded baseline.

**What shipped:**

- `src/tenant/aoTenants.ts` (NEW) — AO's single ces-tenant integration point, mirroring
  `ces-stamper/src/tenant/stamperTenants.ts`: `FileTenantRegistry` singleton;
  `loadTenantConfigBySlug()` (the one slug→config path all three entry points use);
  `AO_CONSUMER = { module: 'ces-ao', purpose: 'adminops tenant resolution/session' }` (ratified
  2026-07-10 amendment); `requestAoStacksimMode()` (registry-verified `kind:'sim'` +
  `StacksimEnvironment` controller, refuses live slugs); one-time forward migration of
  `<ces-ao>/plan-data/<slug>/<slug>.json` into the registry root (package-root-anchored, never
  `process.cwd()` — logged deviation, same as Stamper's M1 seed).
- `src/execution/AuthChain.ts` — both deep imports deleted. `createExecutionContext()` now returns
  `{ executionConfig: AoExecutionConfig, sessionFactory: TenantSessionFactory }` built from
  ces-tenant's `PersistentSessionFactory` with AO's consumer identity bound at construction.
  Stack-provider endpoint seam (`resolveStackEndpoints`) KEPT and reconciled by consumption:
  ces-tenant's sovereign endpoint table is still NEW-SCOPE (per its README), so the seam remains
  the source of AO's endpoint defaults, documented as the thing the package's connection-profile
  work later replaces. Live-run credential validation parity (fail-closed cert/id checks) retained
  from the deleted StamperConfig path.
- `src/execution/CommandExecutor.ts` — **logged deviation per the goal's carve-out:** the ONE
  remaining Stamper deep import is `ces-stamper/adapters/powershell` (`PowerShellAdapter` was not
  extracted by M1). The config+session pair fed to it are ces-tenant-built; the structural bridge
  is documented at the construction site.
- `src/execution/invokeCommand.ts` — `resolveTenantConfig()` (override → cwd resolver → flat
  `~/.stamper` probe) DELETED, including the A9 flat path. Resolution is
  `loadTenantConfigBySlug()`; `tenantConfigPath` survives only as an explicit operator-supplied
  file (no construction, no probing).
- `src/config/ClientConfig.ts` — cwd-curried `resolveTenantJsonPath()` and the file loader
  deleted; reduced to the `ClientConfig` type alias.
- `src/server/middleware/tenantLoader.ts`, `src/server/routes/execute.routes.ts`,
  `src/cli/index.ts` (+ MCP via `dist/execution/invokeCommand.js`) — all three entry points on the
  same registry call path. CLI gains `--stacksim [url]` on `exec` (delegates to
  `requestAoStacksimMode`).
- `package.json` — `"ces-tenant": "file:../ces-tenant"` (workspace-adjacent sibling repo, same as
  Stamper M1); root `package-lock.json` picks up the one dep line.
- `test/simTenant.test.ts` (NEW, gate 5) — 4 tests: consumer identity; ephemeral `kind:'sim'`
  create + env mutation through `StacksimModeController` (injected env/PSHOME/fetch seams);
  live-slug refusal (A9 guard); full pipeline execution against a registry-resolved sim tenant
  (only the PowerShell boundary mocked, same policy as the E2E suite).
- `test/stackSelection.test.ts` — the `createExecutionContext` describe updated to the new return
  shape; asserted endpoint values unchanged (same merged literals the retired StamperConfig
  carried), plus `gccHighEndpoints` true/false per stack.

**Gate results (all run for real, 2026-07-11):**

1. grep `ces-stamper/core/session|ces-stamper/config/stamper` in `src/` → 2 matches, both
   comments; **zero live imports**. PASS.
2. grep `\.stamper` in `src/` + `mcp/` → 3 comment/doc matches, **no live path construction**;
   grep `process.cwd` in `src/` → comments only. PASS.
3. HTTP (`GET /api/tenant?tenant=dev` → 200 via registry, unknown slug → 404), CLI
   (`ao exec A-08 --tenant dev --json` dry-run success, registry-resolved with one-time
   plan-data migration logged), MCP (initialize handshake OK; `ao_execute` flows through the same
   `invokeAoCommand`). No private fallback chains remain. PASS (live smokes recorded in
   `session-ces-ao-2026-07-11.md`).
4. `npm test` → **175/175 passing, 12 files** (171 baseline preserved + 4 new sim tests; the only
   baseline edits are the stackSelection surface rename with identical asserted values). `tsc`
   clean; `npm run build` clean. PASS.
5. `test/simTenant.test.ts` exercises registry + `StacksimModeController` + full AO pipeline
   against `kind:'sim'`. PASS.
6. Encoding grep (U+00E2+U+20AC marker) on all touched files → 0 matches everywhere. PASS.
