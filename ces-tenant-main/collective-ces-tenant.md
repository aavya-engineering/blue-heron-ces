# collective-ces-tenant.md

Status + next-steps capture for AI-based planning. Written 2026-07-25 from the session
logs (`session-ces-tenant-*.md`), git history, and the docs records. Assume the reader
has zero prior context.

## Goal (founder-calibrated 2026-07-25)

ces-tenant is the single tenant-connection layer for all of CES — **"connect
once, every module reuses it."** It owns exactly one problem: the registry of
tenant records (live and sim, physically separated), connection profiles, auth
strategies, and the two client surfaces (PowerShell session factory, HTTP
token/endpoint provider) through which Muster, Stamper, EO, AO, and tester all
reach a tenant. **Nothing else, by charter** — the scope fence rejects any
addition unless a module *other than the requester* would also need it purely
to connect. Its local daemon (port 4690) holds interactive auth state so a
human signs in once per engagement, no matter how many tools run, and exposes a
cross-module status/activity surface — with a hard redaction contract: token
material never appears anywhere observable. Interfaces are
**amendment-controlled**: no surface changes without founder ratification.

**Sim-transparency principle (founder, 2026-07-25):** through ces-tenant's
surfaces, interacting with the sim tenant must be **identical** to interacting
with the real tenant — same commands, same effects. A consuming tool should not
be able to tell (and must not care) which it is connected to; the only
difference lives inside the sim itself (no real compute, just data structures
tracking what has been done). ces-tenant is where that indistinguishability is
enforced: one connection surface, live or sim.

## What this module is

`ces-tenant` v0.4.0 — the CES family's **tenant manager**: one package that owns tenant
identity, registry, credentials/keys, PowerShell session lifecycle, and sim (stacksim)
launch context for every other CES module. Interfaces were ratified first (M0,
2026-07-10) and are amendment-controlled: **no silent interface changes** — amendments
are founder-ratified and marked `RATIFIED AMENDMENT (founder, <date>)` in the source.

- Location: `C:/Users/mhsut/DevProjects/ces/ces-tenant` — a **subdirectory of the shared
  `ces` git repo** (branch `master`), alongside sibling modules (ces-stamper, ces-muster,
  ces-tester, ces-eo, ces-ao, ces-shared, tenant-stacksim).
- Zero runtime dependencies (plain `node:http`). TypeScript, vitest (4.x), builds to
  `dist/` (untracked). Private remote exists: `founder/ces-tenant`, tags
  `v0.1.0`–`v0.4.0`.
- Bin: `ces-tenant` → `dist/service/cli.js` (`ces-tenant serve [--port N]`).

## Architecture (two transports, one surface)

Consumers call `connectTenantSurfaces()` (`src/service/surfaces.ts`) and get the same
ratified interfaces either way:

- **Library mode** — in-process impls under `src/impl/`: `FileTenantRegistry`,
  `PersistentSessionFactory` (Stamper SessionManager port, spawn injected),
  `StacksimEnvironment`, `PlanDataTenantHttpKeyProvider`, `InProcessTenantStatus`
  (own-process activity ledger).
- **Service mode** — localhost-only daemon (`src/service/server.ts`, binds 127.0.0.1,
  default port **4690**, override via `CES_TENANT_SERVICE_URL`), auth-state-only v1:
  register/claim interactive auth state across modules, `/status` HTML +
  `/api/status|activity|auth/*|keys|launch-env|tenants`. Activity ledger is append-only
  (mutation verbs → 405). Redaction contract: token material never appears in
  status/registry/activity responses (`holdsToken` boolean only); bearer material leaves
  the daemon only via `POST /api/auth/claim` (known v1 limitation).
- Transport selection: health-probe → service if up, else library. Daemon start is
  **explicitly user-run only** (`ces-tenant serve` / `npm run serve`) — no auto-spawn.

Key ratified surfaces (all exported from `src/index.ts`): `TenantRegistryLifecycle`,
`TenantSessionFactory`, `TenantHttpKeyProvider` (async since 0.4.0),
`TenantLaunchContextProvider`, `StacksimModeController`, `TenantStatusSurface` /
`TenantActivityRecorder`, `ConsumerIdentity`. Connection/session/token requests carry
`consumer: { module, purpose }` — missing consumer: service mode rejects
(`consumer_required`), library mode warns and records `consumer: null`.

Registry data: `~/.ces/tenants/{live|sim}/<slug>.json` (`CES_TENANT_ROOT` override),
with one-time forward migration from legacy Stamper paths. Live/sim physically
separated; sim detected via stacksim's `environment: 'gcc-high-sim'` marker; live-slug
teardown refused.

## Milestones done (records in `docs/`)

| When | What | Commit | Record |
|---|---|---|---|
| 07-10 | M0 interfaces ratified | `98cf6ae` | `docs/M0-RECORD.md` |
| 07-10 | M1 impls (0.2.0), 53 tests | `6ecd5f4` | `docs/M1-RECORD.md` |
| 07-10 | Amendment: caller identity + status surface (75 tests) | `f9d75b4` | M1-RECORD addendum |
| 07-11 | M6 v1 stateful service, auth-state-only (0.3.0), 86 tests | `19163aa` | `docs/M6-RECORD.md` |
| 07-11 | 0.4.0 BREAKING: `resolveTenantKeys` async; muster-api call sites coordinated | `212768d` | README + M6-RECORD |
| 07-11 | Working-system Step 0: symlink/versioning policy ratified, node_modules untracked, tags + remote | `8fe95fd` | README |
| 07-26 | GP-SHARED-M0-1 ces-tenant half (0.5.0): CMMC fields on `TenantRegistryRecord`, Case-B load rejection, `cmmcMigrationExempt`, G7 confirmed — ces-ao M4 type probe now passes on both siblings | `f6d423a` | `docs/goals/GP-SHARED-M0-1-TENANT.md` |

Suite at last green: **7 files / 94 tests**, `npm run build` + `tsc --noEmit` clean.

## Consumer adoption state

- **ces-muster (muster-api)** — ADOPTED (file dep `file:../../ces-tenant`, symlinked).
  Only direct `resolveTenantKeys` caller; updated to async in the 0.4.0 change
  (its own repo, commit in ces-muster, not pushed).
- **ces-tester / ces-eo / ces-ao / ces-stamper** — import ces-tenant but use only
  already-async surfaces; verified unaffected by 0.4.0 (grep + `tsc --noEmit` clean).
- **ces-stamper** — cutover NOT done (see next steps). M1 is co-owned and not complete
  as a milestone until Stamper lands.

Versioning policy (ratified): symlink consumers + **coordinated breaking bumps in one
serial pass** (O5 rule); minors = milestones/breaking, patches = safe fixes. Pin-exact is
aspirational until a registry/tarball flow exists. `npm run build` in ces-tenant is
enough for symlinked consumers to see new dist.

## Next steps (priority order)

1. **Stamper cutover** — execute `ces-stamper/docs/goals/G-TENANT-M1.md` from a
   **ces-stamper session** (project-root write boundary: this repo files requirements,
   it does not edit siblings). Sweep `PowerShellAdapter.buildGCCHighConnection()`; import
   via symlink/file dep per ratified policy; pass
   `consumer: { module: 'ces-stamper', purpose: ... }` at construction. Closes M1.
2. **Consumer adoption M2–M5** — flip remaining modules to `connectTenantSurfaces()` by
   config (muster-api pattern is the precedent). First real adoption should also serve as
   the true two-OS-process auto-connect demo (M6 gate 2 approximated this in one process).
   **Sibling-owned, not writable from here** (project-root write boundary): each module
   flips its own construction/config in its own repo; ces-tenant's side is already shipped
   (the ratified surface + muster-api precedent). Nothing agent-runnable remains in *this*
   root for M2–M5 beyond keeping the surface stable.
3. **v2 service (explicitly deferred by founder resolution)** — daemon-owned sessions /
   command proxy / centrally-enforced ledger; removes the auth/claim token-handover path
   and makes activity centrally attested rather than self-reported.
4. **`TenantReachProbe`** — NEW-SCOPE placeholder (`src/probe.ts`, design §2.5).
   **FOUNDER-GATED — amendment proposal filed 2026-07-26: `docs/goals/REQ-TENANT-REACHPROBE.md`.**
   Design §2.5 forbids inventing an un-grounded reach/tier probe without an explicit
   founder ask; the signature itself is a placeholder. Proposal recommends ratifying the
   grounded `probeSimReady` first and deferring the speculative live `probeReach`. Not
   self-amended (charter: surface changes are founder-only).
5. Housekeeping: session-log appends (07-10 addendum, 07-11 backfill) + new logs (07-25,
   07-26) + `collective-ces-tenant.md` COMMITTED 2026-07-26 (tree clean of tracked churn).
   `ces-tenant.code-workspace` deliberately left untracked — commit when the founder says so.

## Recent work — 2026-07-27 (registry-data migration spoke; unblocks AO Phase-2 flip)

Founder "complete all the spokes." Delivered the ces-tenant half of the CMMC
registry-data migration that gated ces-ao's Phase-2 strict flip
(`CMMC_STRICT_DEFAULT → true`), which was stuck at 0.0% audit coverage.

- **Code (`src/impl/tenant-file.ts`, commit `583a474`):** `parseTenantRecord` now
  DEFAULTS `kind:'sim'` records to `cmmcMigrationExempt: true` — ephemeral,
  pane-created sims are not real assessment targets, so they leave the Phase-2
  coverage denominator without each drifting sim file needing a hand-stamped
  marker. An **explicit** `cmmc_migration_exempt` (true OR false) always wins;
  live records unchanged. No ratified-interface signature changed (added a
  default value for an existing data field only). +1 unit test in
  `registry.test.ts` (default / explicit-wins / live-unaffected, via `get` +
  `listByKind`). Gates: build + `tsc --noEmit` clean, `npm test` **95/95**.
- **Data migration (`~/.ces/tenants`, machine-global — NOT this repo):** granted
  per-task by the founder this turn. 7 records classified: 5 sim (now exempt by
  the code default at read time — files untouched), `dev` (live placeholder →
  `cmmc_migration_exempt: true`, propagating AO's `plan-data/dev/dev.json`
  source decision into the stale seeded copy), `vfsgov-xtra` (live — the REAL
  Valor Forge GCC High CUI enclave; set `cmmc_level: "L2"` + `assessment_scope`
  {sub 668a730f…, rg-eo-prod} + `cui_boundary.resource_allowlist`
  [rg-eo-prod, vfsgov-vnet-eo, fw-cmmc, pip-fw-cmmc], all grounded in the record
  + `ces-stamper/docs/diagram-data/1-authorization-boundary.json`).
- **Result:** `npm run audit-cmmc-migration` (from ces-ao) = **100.0%** — 7 total,
  6 exempt (dev + 5 sim), 1 migrated (vfsgov-xtra). The AO one-line flip can now
  proceed.
- **Canonical-source drift filed (NOT edited — sibling write boundary):** the
  `~/.ces` copies are runtime-authoritative and won't regress (FileTenantRegistry
  serves the new-root record directly; re-seed skips existing slugs). But the
  canonical sources should be brought into line by their owning sessions:
  `ces-stamper/plan-data/vfsgov-xtra/vfsgov-xtra.json` needs the same
  cmmc_level/assessment_scope/cui_boundary; AO's dev source already carries the
  exempt flag.
- **Founder review flag:** the vfsgov-xtra **L2 posture + CUI boundary** is a
  real-tenant compliance decision made with judgment (overwhelming grounding, but
  it drives live SoD/CUI-boundary enforcement once the flip lands). Founder should
  ratify the exact boundary before/at go-live.

## Operating rules a planner MUST honor

- **Shared-repo git protocol:** commit via **pathspec only** (`git commit -- <paths>`),
  never `git add -A`, never switch branches (concurrent panes share the working tree).
  Never force-push shared branches.
- **Write boundary:** sessions write only in their own project root; cross-module needs
  are filed as requirements, not reached over — unless the founder's ask names the
  sibling destination explicitly (the 0.4.0 muster-api update was such a grant).
- **Interface discipline:** changes to ratified surfaces require founder ratification and
  a dated amendment marker + record entry.
- Encoding grep (mojibake check) must be 0 on touched files; per-file test counts via
  `vitest --reporter=verbose` (`--reporter=basic` exits 1 here).
- `tsconfig` **excludes tests** — `tsc --noEmit` stays green when a signature change
  breaks tests; run vitest to detect that.
- Session logs (`session-ces-tenant-<date>.md`) are the day-by-day memory — read most
  recent first before planning; append after each turn.

## Known gotchas

- Daemon options are construction options (`keysOptions` etc.), NOT instances — the
  daemon must wire its own ledger into them.
- `execute()` calls `ensureConnectedCore` internally to avoid double warn/record;
  amended publics delegate to unamended `*Core` privates (M1 behavior byte-identical).
- `GET /api/tenants` requires `?kind=` (ratified surface is `listByKind`; no unfiltered
  list). Registry wire records strip `evidenceStorage` (can carry resolved account_key).
- `ensureConnected`'s retry backoff (2s/4s) makes failure-path tests slow — test failure
  paths via `connectMgGraph`.
