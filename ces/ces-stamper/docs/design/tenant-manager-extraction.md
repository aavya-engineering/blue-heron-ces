# TenantManager Extraction — Design Document

Status: proposed | Author: (agent-drafted for founder review) | Date: 2026-07-10

## 1. Verdict / Decision Record

**Decision (founder, fixed constraint, not reopened here):** Stamper's tenant-connection code is the
model. There will be ONE common `TenantManager` implementation, shipped as a shared package, consumed
by every CES module that needs to connect to a tenant (live or sim). Extraction is strangler-style:
pull the interface out of Stamper's existing working code; Stamper becomes the first consumer of the
new package, not a rewrite.

This document's job is not to re-argue that decision — it's to show the decision is *feasible*, define
the package's scope, and lay out the extraction milestones.

**Feasibility: the pattern has been solved three times, independently, already.** That's the strongest
evidence this is extractable, not speculative:

1. **Stamper** — `src/core/SessionManager.ts` (700 lines): certificate-thumbprint auth
   (`buildConnectCommand()`, lines 392-432), persistent `powershell.exe` process spawning
   (`spawnPersistentProcess()`, lines 459-526), a `SessionType` union + `ENGINE_SESSION_MAP` (partially
   already factored into `ces-shared/src/session/constants.ts:1-12`). Tenant config resolution is split
   across `src/config/paths.ts`, `src/server/GuiServer.ts`, and `ces-shared/src/storage/node.ts` (three
   overlapping resolvers — see §2).
2. **ces-eo** — `src/eo/core/SessionManager.ts` (631 lines) is, per direct comparison, a **near
   line-for-line duplicate** of Stamper's SessionManager: same `SessionState`/`PSResult` interfaces,
   same timeout/retry constants, same `STAMPER_*` protocol markers, same `buildConnectCommand()` strings
   for all six session types including identical GCC High/USGov flags, same
   `spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', ...])`
   call pointed at the same shared script (`ces-shared/scripts/session-host.ps1`). Roughly 500+ lines of
   duplicated session/process/auth logic across the two files. ces-eo additionally has **two** separate,
   independently-hardcoded readers of Stamper's tenant config path
   (`src/eo/config/EoConfig.ts:33-35` and `src/eo/config/MigrationHelper.ts:11-13`), both still pointed
   at the path Stamper itself deprecated (see §2). This is the second, unrelated implementation solving
   the same problem — and solving it worse, by drifting onto a stale convention.
3. **muster-api** — `muster-api/src/services/tenantKeysService.ts` (`resolveTenantKeys()`, lines 50-107)
   solves the identical problem — "given a tenant slug, resolve credentials and endpoints" — a third
   time, independently, with a materially different transport: no PowerShell, no process spawning, pure
   `fetch()`-based HTTP against Microsoft Graph and the OAuth token endpoint
   (`muster-api/src/services/consentService.ts:58-94`). It still reads the *same* underlying config
   convention Stamper produces (`{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/<slug>.json`, via a
   vendored copy of `ces-shared`'s `TenantConfig.ts`/`resolveTenantJsonPath`), confirming that config
   convention is the de facto contract even where the runtime differs completely.

Three independent teams/contexts hand-rolled tenant/credential/session resolution and converged on the
same underlying config shape while diverging on transport (PowerShell vs HTTP) and on path-resolution
correctness (ces-eo silently went stale). That's the proof: the problem is well-understood and
stable enough to extract, and the cost of *not* extracting is compounding (ces-eo's drift is already
observable, not hypothetical).

## 2. What lives in the TenantManager

### 2.1 Registry, with `kind: 'live' | 'sim'` as a first-class discriminator from day one

**Current state has no discriminator at all.** `ces-shared/src/config/TenantConfig.ts:15-49` defines the
`TenantConfig` interface consumed by both Stamper and ces-eo — it has no `kind`, `mode`, `sim`, or
`live` field anywhere. Sim-ness today is entirely an out-of-band property of *how the process
environment was mutated before the session was spawned* (see §2.4), not a property of the tenant
record itself. This is a real gap the package must close, not an existing feature to preserve.

**Two path conventions exist for tenant config storage, with an unresolved split:**

- **Legacy:** `~/.stamper/tenants/<slug>.json` (or `~/.stamper/tenants/<slug>/`) — home-directory-anchored,
  Stamper-specific by name. Defined via `os.homedir()` + `.stamper` + `tenants` joins in
  `ces-stamper/src/server/GuiServer.ts:95-118` (with a migration sentinel at
  `~/.stamper/.migrated-tenant-tree`, `GuiServer.ts:95`) and independently reconstructed (not reused) in
  `ces-eo/src/eo/config/EoConfig.ts:33-35` and `ces-eo/src/eo/config/MigrationHelper.ts:11-13`.
- **Current (repo/pipeline-anchored):** `<CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/<slug>.json`, via
  `ces-shared/src/storage/node.ts:53-59` (`getStamperPlanDataRoot()` → `getStamperTenantRoot()` →
  `getStamperTenantSubdir()`), where `CES_PIPELINE_ROOT` defaults to `C:\CES_Pipeline` on Windows
  (`ces-shared/src/storage/contract.ts:16`). Stamper migrated to this in commit `e5f61b3` ("unify
  tenant-config resolution on repo plan-data/"), with a one-time copy routine
  `migrateToTenantTree()` in `GuiServer.ts:94-181`.
- **A third, independent resolver inside Stamper itself:** `ces-stamper/src/config/paths.ts:10-20`
  computes `plan-data/<slug>/` relative to `__dirname` (the ces-stamper repo root), **not** via
  `CES_PIPELINE_ROOT`. This is a *different* root-resolution strategy from `ces-shared/storage/node.ts`
  for what is nominally the same directory — they only coincide if the repo happens to live under
  `CES_PIPELINE_ROOT/Stamper`. This is the internal inconsistency proof point (independent of the
  cross-repo duplication in §1): Stamper itself has two different ideas of where `plan-data/` is.
- **ces-eo has not caught up to the migration at all** — `EoConfig.ts` and `MigrationHelper.ts` still
  hardcode the pre-migration `~/.stamper/tenants/<slug>.json` path Stamper no longer treats as source of
  truth. (ces-eo's `StamperEvidenceLoader.ts:26` *did* correctly move to
  `path.join(stamperRoot, 'plan-data', tenantSlug, 'evidence')` — so even within ces-eo, the two coupling
  points disagree with each other.)

**Migration plan:**
1. New neutral root: `~/.ces/tenants/<slug>.json` (or `<CES_PIPELINE_ROOT>/tenants/<slug>.json` if the
   founder prefers pipeline-anchoring over home-dir-anchoring — this is an open decision, §8) — a name
   that doesn't imply "Stamper" once every module is a consumer.
2. **Back-compat reads**, not writes: TenantManager's registry read path tries, in order: (a) new
   location, (b) `CES_PIPELINE_ROOT/Stamper/plan-data/<slug>/<slug>.json` (current Stamper convention),
   (c) `~/.stamper/tenants/<slug>.json` (legacy). First hit wins; a one-time migration copies forward to
   the new location (mirroring the existing precedent in `GuiServer.ts:94-181`, which already knows how
   to copy `<slug>.json` plus `evidence/`, `plans/`, `logs/`, `state/` subdirs and rewrite
   `.stamper`-referencing paths inline).
3. **Every migrated record must be stamped with `kind: 'live'`** unless it was sourced from
   `tenant-stacksim`'s emitted config (§2.4), in which case `kind: 'sim'`. Because no `kind` field exists
   today, this is new metadata, not a preserved one — treat any record missing `kind` post-migration as
   a bug in the migration, not a valid state.
4. **Hazard, confirmed from source, not hypothetical:** `tenant-stacksim`'s `init-tenant` command
   (`tenant-stacksim/src/config/SimTenantConfig.ts:123-145`, `writeSimTenantConfig()`) writes to the
   *same* flat legacy path, `~/.stamper/tenants/<slug>.json`, when invoked with `--tenantprobe-flat`.
   This was tightened (opt-in flag added) specifically because it used to write unconditionally — see
   `tenant-stacksim/BACKLOG.md:40,43`, which documents this exact hazard under the label **"A9"**:
   > "`TenantProbe` hardcodes that directory with no override. A9 accepted this for manual use
   > (sim-unique slugs), but repeated automated scenario runs must not pollute real Stamper config."

   This is a live, named hazard (not this doc's invention) — sim-generated and live tenant configs can
   land in the identical directory, indistinguishable except by filename convention, with zero `kind`
   field to disambiguate. The migration MUST fix this: sim-sourced records get `kind: 'sim'` and, ideally,
   a physically separate namespace under the new root (e.g. `~/.ces/tenants/sim/<slug>.json` vs
   `~/.ces/tenants/live/<slug>.json`) so accidental collision is structurally impossible, not just
   metadata-tagged.

### 2.2 Connection profiles / endpoint resolution

**No sovereign endpoint table exists today** — this needs to be said plainly per the hard requirements:
searching Stamper for `GCC`, `DoD`, `sovereign`, `endpoint`-table-like constructs turned up no
`CLOUD_ENDPOINTS`/`SOVEREIGN_MAP`/similar construct. What exists instead:

- Endpoints are **hardcoded per-session-type inside `SessionManager.buildConnectCommand()`**
  (`ces-stamper/src/core/SessionManager.ts:392-432`, duplicated in
  `ces-eo/src/eo/core/SessionManager.ts:330-364`), fixed to GCC High/USGov only: `-Environment USGov`,
  `-ExchangeEnvironmentName O365USGovGCCHigh`, the literal Purview URL
  `https://ps.compliance.protection.office365.us/powershell-liveid/`, `-Environment AzureUSGovernment`,
  `-Region ITAR` + `https://${tenantName}-admin.us.sharepoint.us`, `-TeamsEnvironmentName TeamsGCCH`.
  There is no commercial/GCC(non-High)/DoD branch in this function at all.
- A **per-tenant `endpoints` object** exists in the `TenantConfig` schema
  (`ces-shared/src/config/TenantConfig.ts:22-29`: `graph`, `login`, `compliance_uri`, `exchange_env`,
  `azure_auth`, `arm`) and is populated with USGov defaults in Stamper's `dotenvLoader.ts:23-26` — but
  **`buildConnectCommand()` never reads `tenantConfig.endpoints`**; it uses hardcoded literals instead.
  The schema field is vestigial today.
- The only environment branch found anywhere is a two-way ternary in
  `ces-stamper/src/cli/index.ts:393`: `env === 'gcchigh' ? 'GCCHigh' : 'Commercial'`.

**Implication for the package:** there is nothing to "extract" for a sovereign endpoint table because
none exists — this must be *newly designed* as part of TenantManager, using the already-defined (but
currently unused) `TenantConfig.endpoints` shape as the starting schema, and `buildConnectCommand()`
equivalents must be changed to actually read from it instead of hardcoding GCC High/USGov. Call this out
to the founder as new scope, not pure extraction (see §8).

### 2.3 Auth broker (strategy pattern)

Grounded auth mechanisms actually observed:
- **Cert app-only** — the only mechanism SessionManager.ts / ces-eo's SessionManager use:
  `-CertificateThumbprint` passed to each `Connect-*` cmdlet
  (`ces-stamper/src/core/SessionManager.ts:403-427`). Only `certThumbprint` is consulted by
  `buildConnectCommand()`; `TenantConfig.certPath` (`ces-shared/src/config/TenantConfig.ts:19`, sourced
  from `auth.cert_path` in tenant JSON) is present in the schema but not read by SessionManager itself —
  cert *lookup* is delegated to each PowerShell module's own `CurrentUser\My` cert-store resolution
  (explicit code comment, SessionManager.ts ~418-423, describing a deliberate move away from an older
  explicit `Get-ChildItem Cert:\` fetch).
- **Client-secret / OAuth (muster-api only)** — `consentService.ts:58-94` does an authorization-code
  exchange against `login.microsoftonline.us/<tenant>/oauth2/v2.0/token` using `client_secret`. Note this
  is a *different* auth family from cert-based, despite `tenantKeysService.ts` also loading
  `certThumbprint` for the same tenant record — that field is loaded but never consumed for token minting
  in muster-api today (confirmed by explicit code comments at `tenantKeysService.ts:3-7` and
  `harvest.ts:94,113`: "cert-assertion token minting not implemented in muster-api").
- **Bearer passthrough (muster-api)** — `POST /harvest/run` also accepts an already-minted
  `access_token` directly from the caller (`muster-api/src/routes/harvest.ts:154-193`), bypassing tenant
  resolution for auth entirely.
- **No device-code flow was found anywhere in the researched repos.** If the founder wants device-code
  as a strategy, it is new scope, not extracted from existing code.
- **No-op-sim** — StacksimMode's env-mutation approach (§2.4) is the closest existing analog; it doesn't
  authenticate at all, it redirects module resolution so cmdlets never reach real Microsoft endpoints.

Store credential *references* only — thumbprints, cert paths, client/app IDs, tenant IDs — never secret
material. This matches current practice: nowhere in the researched `TenantConfig` schema or config
loaders does a raw secret get persisted to the tenant JSON files (muster-api's `client_secret` comes from
`GRAPH_CLIENT_SECRET` env var at request time, not from the tenant config file).

### 2.4 Two client surfaces

1. **PowerShell session-factory surface** (Stamper/EO's world): owns spawning persistent
   `powershell.exe` hosts and the marker-based stdio protocol currently in
   `SessionManager.spawnPersistentProcess()` (`ces-stamper/src/core/SessionManager.ts:459-526`) — no
   `-Version 5.1` flag is actually present in either Stamper's or ces-eo's spawn call today (the brief's
   assumption doesn't match source; the actual args are `['-NoProfile','-NonInteractive',
   '-ExecutionPolicy','Bypass','-File', SESSION_HOST_SCRIPT]`). Both point at the same underlying script,
   `ces-shared/scripts/session-host.ps1`, already shared — this surface mostly needs to absorb
   `SessionManager`'s TS orchestration layer, not the PS1 script (already extracted).
2. **HTTP token/endpoint provider surface** (muster-api and any non-PS consumer): given a tenant slug,
   return resolved credentials-by-reference + endpoint URLs (mirroring what
   `tenantKeysService.resolveTenantKeys()` does today, `muster-api/src/services/tenantKeysService.ts:50-107`),
   without spawning any process. muster-api is confirmed pure Node/Express (no browser bundling in
   `muster-api/` itself — `package.json` shows plain `tsx`/`tsc`, no webpack/vite; the browser-bundled
   piece is the *separate* top-level React app in the same ces-muster repo, not muster-api) — so
   muster-api itself could technically import a Node package directly. The founder's decision to make
   this an HTTP surface rather than a direct import stands regardless, per the fixed constraint (different
   runtime/service boundary), and is reinforced by the fact muster-api already deployed its own transport
   (`fetch`-based) independent of Stamper's PowerShell-based one — an HTTP surface is the natural fit for
   a service that's already all-HTTP internally.

The sim-vs-live seam that both surfaces must honor: `enableStacksimMode()`
(`ces-stamper/src/core/StacksimMode.ts:103`) does not touch SessionManager's API at all — it mutates
`process.env.PSModulePath` / `Path` / `STACKSIM_SERVER_URL` *before* the first SessionManager is
constructed, so that persistent PowerShell hosts inherit an environment where fake same-named modules
resolve first (doc comment, StacksimMode.ts:9-38). There is currently no branch inside SessionManager
itself — sim-ness is 100% external environment state. This is exactly the seam the registry's `kind`
field should make explicit and first-class: today "is this tenant sim or live" is answered by "did
something call `enableStacksimMode()` before this process started," which is fragile and
non-introspectable. ces-eo has **no equivalent of StacksimMode at all** (confirmed: zero matches for
`stacksim`/`simMode`/`isLive`/`isSim` anywhere in ces-eo/src) — it cannot run against sim today except by
accident of inherited `process.env` from a parent process. TenantManager fixes this gap for ces-eo as a
direct consequence of extraction, not a side effect.

### 2.5 Reach/tier probe

Grounded finding: **no existing "is this tenant reachable / what tier" probe was found** in any of the
four repos researched (Stamper, ces-eo, muster-api, tenant-stacksim) under that name or an equivalent.
The closest adjacent behavior:
- `StacksimMode.warnIfSimUnreachable()` (`ces-stamper/src/core/StacksimMode.ts:74`) does a best-effort
  health-check POST against `${serverUrl}/ledger` and warns (does not fail) if the sim server is
  unreachable — this is a sim-only reachability check, not a live-tenant tier/plan probe.
- muster-api's harvest probes (`muster-api/src/services/harvestService.ts`, `PROBES` table lines
  69-132) check specific Graph capabilities (conditional access, Intune devices, Defender compliance) on
  an already-authenticated tenant — this is evidence collection, not a pre-connection reach/tier check.

**Do not invent a reach/tier probe capability that isn't grounded.** If the founder wants one, it's new
scope for TenantManager to build (a natural home would be a thin wrapper combining
`warnIfSimUnreachable`'s pattern for sim with a lightweight Graph `/organization` call for live), but say
so explicitly as new, not extracted.

## 3. What does NOT live in it

Explicit scope fence — TenantManager owns *tenant connection*, nothing else:

- **No competitive-intel registries** (that's `ces-strategy`'s domain — see this very repo's
  `competitors/` tree — unrelated to tenant connectivity).
- **No evidence storage.** `ces-shared/src/storage/node.ts` already owns `plan-data/<slug>/evidence/`
  path resolution and should keep doing so; TenantManager's registry is about *who/how to connect*, not
  where evidence artifacts land once connected. `StamperEvidenceLoader.ts` and evidence-directory logic
  stay outside TenantManager.
- **No business/domain logic specific to any one module** — no CMMC control mapping (Stamper), no SSP
  generation (ces-eo), no harvest probe tables (muster-api). Those all consume a connected
  session/token from TenantManager and do their own thing with it.
- **God-module risk, named explicitly:** the moment TenantManager starts accumulating
  module-specific convenience methods ("give me a Graph client pre-configured for CMMC evidence
  pulls," "give me the SSP narrative endpoint set"), it has become a second monolith and defeated the
  entire boundary principle it exists to serve. The test for any proposed addition: "would a module
  *other than the one requesting this* also need it, purely for the purpose of connecting to a tenant?"
  If no, it doesn't belong here.

## 4. Package identity

**Recommendation: standalone sibling package/repo, `ces-tenant`. Not a subpath of `ces-shared`.**

Grounded argument: `ces-shared` is real package tooling in the narrow technical sense —
`ces-shared/package.json` has proper `exports` subpaths (`~30` entries, e.g. `"./config":
"./dist/config/TenantConfig.js"`), a `tsc` build, and a `vitest run` test script — but it is explicitly
**workspace-internal, not independently versioned or published**: `"license": "PROPRIETARY"`, no
`private`/`publishConfig` fields of its own (those live on the *workspace root* `package.json`, not
ces-shared's), and its own README states it is "not published to npm," consumed only via the npm
workspace mechanism. Consumption is inconsistent even within that workspace:
- Stamper: `"ces-shared": "*"` — resolved by workspace hoisting to a real symlink
  (`node_modules/ces-shared` → `link: true`, confirmed in root lockfile).
- ces-eo: `"ces-shared": "file:../shared"` — a **stale path** (`../shared` is an empty stub); only works
  in practice because workspace resolution overrides the literal specifier. This is exactly the kind of
  silent-drift risk (§1) that a package boundary is supposed to prevent, and it's already happening
  *inside* ces-shared's own consumption.
- ces-muster: not a workspace member at all — hand-vendored copy under
  `muster-api/src/vendored/ces-shared/`, pinned by SHA in `vendor-manifest.json` and checked by
  `scripts/check-vendor-drift.mjs`.
- tenant-stacksim: zero dependency, by explicit design (`SimTenantConfig.ts:15-19`: "not imported from
  ces-shared — tenant-stacksim stays standalone with zero cross-package dependency").

So "subpath of ces-shared" would buy TenantManager nothing beyond what a new sibling gets for free: it
would still be workspace-hoisted for the two workspace members (Stamper, EO), still be irrelevant to the
two non-workspace members (muster-api, tenant-stacksim) who either vendor or opt out entirely, and it
would additionally couple TenantManager's release cadence to ces-shared's much broader surface area
(crypto, persistence, http, observability, blob, launcher — none of which TenantManager needs). A new
sibling `ces-tenant` costs the same to wire up as a new ces-shared subpath would, and avoids dragging
TenantManager's versioning into ces-shared's.

The one place "subpath" would have won is if ces-shared were the family's actual npm-publish boundary —
it isn't; it's a workspace convenience, not a release artifact. Given that, there's no lever a subpath
pulls that a sibling repo doesn't also have available.

## 5. Extraction plan

- **M0 — Interface definition, no behavior change.** Define `TenantManager`'s TypeScript interfaces
  (registry record shape incl. `kind`, connection-profile shape, auth-strategy interface, both client
  surfaces) purely by reading Stamper's current behavior (SessionManager.ts, StacksimMode.ts, the three
  path resolvers in §2.1). No code moves yet. Gate: interface reviewed and accepted by founder before any
  extraction commit. **GATE PASSED 2026-07-10** (founder review of ces-tenant interfaces: approved as ratified).
- **M1 — Stamper cutover.** Stamper's `SessionManager`/`StacksimMode`/path-resolution logic is moved into
  the new package and Stamper is refactored to consume it internally.
  **Gate: Stamper's existing test suite, confirmed by direct run today — `npm test` → 14 test suites, 217
  total tests, 216 passed / 1 skipped** (the brief's "216 tests" figure is correct for *passing* tests;
  the complete, precise number to gate on is **217 total / 216 passing / 1 skipped, zero regressions**).
  Note for the implementing engineer: none of the 14 existing test files
  (`tests/unit/*.test.ts`, `tests/registry/CommandRegistry.test.ts`,
  `tests/directive-migration.contract.test.ts`) directly targets `SessionManager.ts` or
  `StacksimMode.ts` today — there is no `SessionManager.test.ts`. The M1 gate as stated (zero
  regressions in the existing 217) is necessary but not sufficient; recommend adding direct unit
  coverage for the extracted package's session/stacksim logic as part of M1, since the current suite
  would not by itself catch a behavioral regression in the exact code being moved.
- **M2 — EO cutover.** ces-eo's ~500-line duplicate `SessionManager.ts` and its two independent
  stale-path readers (`EoConfig.ts:33-35`, `MigrationHelper.ts:11-13`) get deleted/thinned to a
  TenantManager dependency. Gate: ces-eo's implicit coupling (hardcoded `~/.stamper/tenants/` path,
  currently already stale relative to Stamper's own migration) becomes an explicit package dependency;
  ces-eo gains sim-mode capability it does not have today as a side effect, since none of its own code
  needs to implement that seam anymore.
- **M3 — muster-api HTTP surface.** `tenantKeysService.resolveTenantKeys()`
  (`muster-api/src/services/tenantKeysService.ts:50-107`) is replaced by calls to (or a thin HTTP-facing
  wrapper around) TenantManager's HTTP surface. Gate: muster-api no longer independently constructs
  `{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/<slug>.json` paths itself; it resolves tenants purely via
  HTTP. Whether muster-api's vendored `ces-shared` copy (`muster-api/src/vendored/ces-shared/`,
  tracked by `vendor-manifest.json` + `check-vendor-drift.mjs`) is retired at this milestone or kept as a
  fallback is a §8 open decision.
- **M4 — tenant-stacksim integration.** `init-tenant`'s `writeSimTenantConfig()`
  (`tenant-stacksim/src/config/SimTenantConfig.ts:123-145`) is changed to emit through TenantManager's
  registry API rather than writing JSON directly to `~/.stamper/tenants/<slug>.json` /
  `plan-data/<slug>/<slug>.json`. Stamper's `--stacksim` flag
  (`ces-stamper/src/cli/index.ts:459-467`, which calls `enableStacksimMode()`) becomes TenantManager's
  native `kind: 'sim'` registry path instead of a separate env-mutation function Stamper owns. Gate:
  the A9 hazard (§2.1) is structurally closed — sim and live records cannot collide in the same
  directory because they're namespaced by `kind` at the registry level, not by convention.
- **M5 — ces-ao cutover.** *(Corrected 2026-07-10, founder: "AO needs the tenant manager as
  well" — supersedes the earlier "adopts when needs materialize" framing, which rested on an
  unresearched assumption; recon of ces-ao shows it connects to tenants today by deep-importing
  Stamper's internals — `SessionManager` from `ces-stamper/core/session`
  (`ces-ao/src/execution/AuthChain.ts:9`), `StamperConfig` from `ces-stamper/config/stamper`
  (`AuthChain.ts:4`), `PowerShellAdapter` from `ces-stamper/adapters/powershell`
  (`CommandExecutor.ts:36`) — plus a cwd-anchored config resolver and a flat
  `~/.stamper/tenants/<slug>.json` fallback (`invokeCommand.ts:48-58`); tenant-stacksim's
  coverage inventory already replays AO's 139-call slice of the 523-call total.)* ces-ao's
  deep imports of Stamper internals and its multi-convention path chain are replaced by
  `ces-tenant`'s session-factory surface and registry API. Gate: zero live imports of
  `ces-stamper/core/session` / `ces-stamper/config/stamper` in ces-ao and no `~/.stamper` path
  construction, with AO's 171-test suite green (see `ces-ao/docs/goals/G-TENANT-M5.md`).
  Blocked on M1 only; parallel-safe with M2–M4. *(ces-tester was originally parked here too;
  promoted to a named consumer 2026-07-10 by founder direction — see §6.)*
- **M6 — the stateful tenant service (queued 2026-07-10, founder-directed).** ces-tenant grows a
  second delivery mode: a local, per-user daemon implementing the SAME ratified interfaces behind
  the HTTP surface — one interactive sign-in per engagement shared by all modules (auto-connect),
  plus connection status and an append-only activity ledger by module × engine service
  (observability-as-provenance). Precedent: tenant-stacksim's single-writer `serve`. Modules flip
  in-process → service by configuration as they adopt; library fallback if the daemon is down
  (degrade, never block). Requires the caller-identity + status-surface interface amendment that
  rides with G-TENANT-1 (ratified amendment, founder 2026-07-10). Full goal:
  `ces-tenant/docs/goals/G-TENANT-M6.md`. Blocked on M1; parallel-safe with M2–M5.

## 6. Per-consumer sibling requirements

- **Stamper** — must not construct `plan-data/` paths via its own `src/config/paths.ts` `__dirname`-relative
  logic once migrated; must go through TenantManager's registry API exclusively (this also resolves
  Stamper's own internal two-resolver inconsistency, §2.1). Must not call `enableStacksimMode()` directly
  post-M4; must request a `kind: 'sim'` tenant from the registry instead.
- **ces-eo** — must not read `~/.stamper/tenants/*.json` directly (`EoConfig.ts`, `MigrationHelper.ts`)
  once migrated — must go through TenantManager's registry API. Must not maintain its own
  `SessionManager.ts` process-spawning/auth logic post-M2 — must consume TenantManager's PowerShell
  session-factory surface.
- **muster-api** — must not construct Stamper plan-data paths itself
  (`tenantKeysService.ts`'s `resolveTenantJsonPath` logic) post-M3 — must call TenantManager's HTTP
  surface. Must not attempt to mint cert-assertion tokens locally (already true today — explicitly
  deferred per its own code comments) — that responsibility either stays out of scope for muster-api or
  is delegated through the HTTP surface, founder's call.
- **tenant-stacksim** — must emit tenant configs through TenantManager's config-emission API post-M4, not
  by hand-constructing JSON matching the schema by convention (`SimTenantConfig.ts` today explicitly
  documents matching-by-convention rather than by dependency). May continue to have zero *code*
  dependency on TenantManager if the founder wants to preserve tenant-stacksim's current
  zero-cross-package-dependency design goal (`SimTenantConfig.ts:15-19`) — this is a real tension between
  "adopt the package" and "stay standalone," flagged as an open decision (§8), not resolved by this doc.
- **ces-tester** *(promoted from M5 to named consumer, 2026-07-10, founder: "ces-tester needs a
  tenant too")* — the test orchestrator consumes the registry from day one rather than growing its
  own variant. Its needs, from `ces-tester/PLAN.md` (interface contract + M0/M1): (a) **ephemeral
  per-scenario sim tenants** — create `kind: 'sim'` from an embedded seed/scenario reference, query,
  and tear down cleanly per run (this is stacksim work item S3, config isolation, expressed as
  interface: short-lived sim tenants must leave no residue in the registry); (b) **query/filter by
  kind** with the invariant that the orchestrator can never accidentally target a `kind: 'live'`
  tenant; (c) the **reach/ready probe** (§2.5) — its M1 CLI-write→HTTP-read ready-check becomes a
  probe consumption instead of hand-rolled polling; (d) a **launch-context surface**: the env bundle
  Stamper's `--stacksim` injection needs (module path, server URL), requestable per sim tenant, so
  the orchestrator launches Stamper without owning that knowledge. Must not pre-build bespoke
  session/auth/config-path logic — consuming these interfaces IS its tenant story.
- **ces-ao** *(corrected 2026-07-10, founder: "AO needs the tenant manager as well" — the original
  entry here said "no current tenant-connection code was in scope for this research"; that was an
  unresearched assumption, now disproven by direct recon)* — ces-ao connects to tenants today, with
  a third coupling shape distinct from both EO's (duplicate) and muster-api's (vendored): it
  **deep-imports Stamper's internal modules cross-package** via a `"ces-stamper": "*"` workspace
  dependency — `SessionManager` from `ces-stamper/core/session`
  (`ces-ao/src/execution/AuthChain.ts:9,67`), `StamperConfig` from `ces-stamper/config/stamper`
  (`AuthChain.ts:4,63`), `PowerShellAdapter` from `ces-stamper/adapters/powershell`
  (`CommandExecutor.ts:36,107`). This makes AO directly exposed to M1: relocating SessionManager
  breaks AO's imports unless shimmed. Requirements: must not import Stamper's session/config
  internals post-M5 — must consume `ces-tenant`'s PowerShell session-factory surface. Must not
  resolve tenant config through its current chain — a **cwd-anchored**
  `resolveTenantJsonPath(slug, process.cwd())` (`ces-ao/src/config/ClientConfig.ts:11-13`, a
  fourth root-resolution strategy beyond the three in §2.1, used by the `tenantLoader` middleware)
  plus its own flat legacy `~/.stamper/tenants/<slug>.json` fallback
  (`invokeCommand.ts:48-58`, line 55 — the A9 flat path, feeding both the CLI and the MCP
  server) — must go through TenantManager's registry API exclusively. Its
  `resolveStackEndpoints()` stack-provider seam (`AuthChain.ts:23-40`, via `ces-shared/stack`) is
  existing prior art for §2.2's endpoint-table scope and must be reconciled with the
  connection-profile surface, not forked. AO exercises all six session types (engine router
  `AdapterRouter.ts:29-66`; stacksim inventory: 139 AO calls across graph/exo/ipps/az/spo +
  invoke-mggraphrequest) and has zero sim-mode capability today (no StacksimMode equivalent in
  `ces-ao/src`) — sim capability arrives via `kind: 'sim'` + `StacksimModeController`, same as
  ces-eo's M2. See `ces-ao/docs/goals/G-TENANT-M5.md`.

## 7. Risks

- **Windows/PowerShell 5.1 coupling.** Correction to the brief's framing: neither Stamper's nor ces-eo's
  current spawn call actually passes `-Version 5.1` (verified by direct read of both
  `spawnPersistentProcess()` implementations — the args are `-NoProfile -NonInteractive -ExecutionPolicy
  Bypass -File <script>`, no version pin). The real coupling is structural, not a version flag: both spawn
  `powershell.exe` as a named executable (Windows PowerShell, not `pwsh`/PowerShell 7+), and the shared
  `session-host.ps1` script may itself carry version assumptions not inspected in this research pass
  (worth a follow-up read before M1 lands). The package must keep the PowerShell session-factory surface
  as an explicitly Windows-only client surface, cleanly separated from the HTTP surface, so a non-Windows
  consumer (muster-api) never transitively pulls in a `child_process.spawn('powershell.exe', ...)` code
  path. This separation is realistic given muster-api already has zero PowerShell dependency today.
- **Browser cannot consume a Node package directly.** Grounded in `ces-muster`'s existing vendoring
  setup: `muster-api/src/vendored/ces-shared/storage/node.ts` carries an explicit header comment,
  *"Node-only storage resolver... do NOT import from FE/browser code"* — confirming the ces-muster repo
  already treats Node-only code as something that must be vendored/isolated rather than imported into
  its browser-bundled top-level React app (a separate `vite.config.ts`-driven build at the ces-muster
  repo root, distinct from `muster-api/`). muster-api itself is pure Node/Express and could import a Node
  package directly, but the *sibling* browser app in the same repo cannot — if TenantManager scope ever
  expands toward anything the browser app needs, the same vendoring-or-HTTP choice ces-muster already
  made for `ces-shared` applies again. Recommend HTTP-only for anything browser-adjacent; never assume
  Node-package import is safe just because "ces-muster" is the target.
- **Version skew across repos.** No monorepo spans all five repos — `ces-shared`'s actual npm workspace
  covers only `ces-stamper`, `ces-eo`, `ces-ao`, `ces-planner` (root `package.json:4-10`); `ces-muster`
  and `tenant-stacksim` are separate git repos entirely, one vendoring by SHA pin
  (`vendor-manifest.json` + `check-vendor-drift.mjs`), one deliberately zero-dependency. TenantManager
  inherits this same fragmented distribution problem — there is no existing mechanism that would give it
  lockstep versioning across all five consumers for free. Already-observed evidence this bites in
  practice: ces-eo's `package.json:18` `"ces-shared": "file:../shared"` is stale today and only
  "works" because workspace hoisting silently papers over it — a real package (not workspace-hoisted)
  wouldn't get that free pass.
- **The "A9 migration."** Found — this refers to a hazard entry in the sibling `ces-strategy` repo's
  planning doc `ces-strategy/docs/ces-tester-decisions-2026-07-10.md`, not a code artifact in any of the
  five repos researched. Quoting `tenant-stacksim/BACKLOG.md:40,43`, which cross-references it:
  > "Priority: pre-first-repeated-run (gates ces-tester M2) · (Decision 5; inventory A9)" ... "TenantProbe
  > hardcodes that directory with no override. A9 accepted this for manual use (sim-unique slugs), but
  > repeated automated scenario runs must not pollute real Stamper config."

  A9 is the named hazard of sim-generated tenant configs landing in the same directory as real
  (`~/.stamper/tenants/`) ones, addressed partially today by tenant-stacksim's `--tenantprobe-flat` opt-in
  gate (no longer unconditional writes). This is precisely the hazard the `kind` discriminator (§2.1) is
  meant to close permanently and structurally rather than by opt-in flag discipline. There is no separate
  "A9 migration" work item beyond what this document's M4 milestone already covers — the founder should
  treat closing A9 as the concrete, testable acceptance criterion for M4, not a separate initiative.
- **Design gaps this doc surfaced that are new work, not extraction:** the sovereign endpoint table
  (§2.2) and the reach/tier probe (§2.5) don't exist in any researched repo today. Both are reasonable
  things for TenantManager to own, but scoping and estimating them is new design work, not a
  copy-and-wrap of existing logic — don't let M1-M4 timelines assume these are "just moving code."

## 8. Open decisions for the founder

1. **New tenant-registry root path.** `~/.ces/tenants/` (home-dir-anchored, mirrors the legacy Stamper
   convention) vs. `<CES_PIPELINE_ROOT>/tenants/` (pipeline-anchored, mirrors the current Stamper
   convention and resolves the paths.ts/storage/node.ts split cleanly). This doc does not pick one —
   it's a real tradeoff between "matches most-recently-established Stamper precedent" and "matches
   oldest, most-familiar-to-operators precedent."
2. **Package registry/publishing mechanism.** npm private registry, git dependency (tag/commit pin), or
   path/workspace dependency for local dev (matching how `ces-shared` is consumed by workspace members
   today, with the caveat that this mechanism has already shown drift risk — ces-eo's stale `file:../shared`
   path). Given `ces-muster` and `tenant-stacksim` sit outside any workspace, a workspace-only mechanism
   won't reach them — muster-api will need either a real published/git-pinned dependency for its HTTP
   surface package, or continue vendoring. Not resolved here.
3. **Semver policy.** No versioning policy exists for `ces-shared` today beyond a bare `"version":
   "0.2.0"` field with no changelog discipline enforced across consumers (a `CHANGELOG.md` exists but its
   consumption/enforcement wasn't verified). TenantManager needs an explicit policy given it will be
   relied on by a Windows-PowerShell surface and an HTTP surface with different consumer risk profiles.
4. **Repo ownership.** Who owns `ces-tenant` day-to-day — is it Stamper's maintainer (since Stamper is
   the model and first consumer), or a neutral owner given it's meant to serve five modules equally? Not
   resolved here.
5. **muster-api's vendored ces-shared fallback fate.** At M3, does muster-api's
   `muster-api/src/vendored/ces-shared/` (SHA-pinned, drift-checked) get retired in favor of pure HTTP
   calls to TenantManager, or does it stay as a fallback/offline path? The existing drift-check mechanism
   (`scripts/check-vendor-drift.mjs`) is real infrastructure the founder may want to keep for other
   vendored pieces even if TenantManager itself moves to HTTP-only for muster-api.
6. **tenant-stacksim's zero-dependency design goal vs. M4 adoption.** `SimTenantConfig.ts:15-19`
   currently treats "zero cross-package dependency" as a deliberate architecture decision. M4 as
   described asks tenant-stacksim to consume TenantManager for config emission — this is a direct
   reversal of that stated goal and needs explicit founder sign-off, not just an extraction-plan
   milestone assumption.
   **RESOLVED 2026-07-11 (founder), third option:** tenant-stacksim stays zero-dependency and
   tenant-ignorant; **ces-tester owns sim-tenant registration** through TenantManager's registry
   (it already consumes the package and orchestrates every sim scenario). stacksim's `init-tenant`
   direct-write path is deprecated-for-orchestrated-use (kept as a standalone-dev convenience).
   Recorded in `tenant-stacksim/docs/goals/G-TENANT-M4.md` (resolution section) and
   `ces-tester/docs/goals/G-TENANT-ADOPT.md` (2026-07-11 addendum).

7. *(Added 2026-07-11.)* **M6 daemon v1 session ownership — RESOLVED 2026-07-11 (founder):
   auth-state-only.** The v1 stateful service holds tokens/cert context/device-code sessions;
   modules skip sign-in but run their own engine workers. Full session proxy deferred as possible
   v2. Recorded in `ces-tenant/docs/goals/G-TENANT-M6.md` (resolution section). Note two other
   deviations already picked-with-defaults during G-TENANT-1 (registry root `~/.ces/tenants/` with
   `CES_TENANT_ROOT` override → resolves item 1's default; pre-1.0 pin-exact semver → resolves
   item 3's default) — founder-flippable, logged in `ces-tenant/docs/M1-RECORD.md`.
