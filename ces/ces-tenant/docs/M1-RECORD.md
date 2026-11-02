# M1 — TenantManager Package-Side Implementation

**Date:** 2026-07-10
**Goal:** `docs/goals/G-TENANT-1.md` (co-owned with `ces-stamper/docs/goals/G-TENANT-M1.md` —
this record covers the package side only; Stamper's consumption cutover is the sibling goal's
deliverable and was NOT executed from this repo, per the project write boundary).
**Plan reference:** `ces-stamper/docs/design/tenant-manager-extraction.md` §5 (M1), §2.1–§2.4,
§7, §8 (open decisions #1 and #3, defaults picked below).

## What was implemented (all under `src/impl/`, exported from `src/index.ts`)

| Implementation | Interface | Ported from |
|---|---|---|
| `FileTenantRegistry` (`impl/registry.ts`) | `TenantRegistryLifecycle` | Read path per design §2.1 point 2; migration precedent `ces-stamper/src/server/GuiServer.ts:94-181`; field mapping `ces-shared/src/config/TenantConfig.ts:68-136`; sim record conventions `tenant-stacksim/src/config/SimTenantConfig.ts:65-157` |
| `PersistentSessionFactory` (`impl/session-factory.ts`) | `TenantSessionFactory` | `ces-stamper/src/core/SessionManager.ts` (whole orchestration layer, incl. `retryWithBackoff` from `ces-stamper/src/utils/retryWithBackoff.ts`) |
| `StacksimEnvironment` (`impl/stacksim.ts`) | `StacksimModeController` + `TenantLaunchContextProvider` | `ces-stamper/src/core/StacksimMode.ts` (`enableStacksimMode`, `queryPsHomeModules`, `warnIfSimUnreachable`, case-insensitive env dedup) |
| `PlanDataTenantHttpKeyProvider` + `TenantKeysError` (`impl/http-provider.ts`) | `TenantHttpKeyProvider` | `ces-muster/muster-api/src/services/tenantKeysService.ts:14-107`; endpoint literals `ces-shared/src/stack/providers/microsoftGccHigh.ts:13-19` |
| `ENGINE_SESSION_MAP` (`impl/engine-map.ts`) | `EngineSessionMap` (concrete constant) | `ces-shared/src/session/constants.ts:3-12` |
| Internal: `impl/paths.ts`, `impl/secret-ref.ts`, `impl/tenant-file.ts` | — | `ces-shared/src/storage/node.ts:14-21` + `contract.ts:13-19`; `ces-shared/src/config/secretRef.ts`; `ces-shared/src/config/TenantConfig.ts` |

NOT implemented, per the goal's must-NOTs: `TenantReachProbe` (`src/probe.ts` remains the
NEW-SCOPE placeholder), the sovereign endpoint table (`ConnectionProfile` stays a
documentation-of-literals shape; `buildConnectCommand()` keeps the hardcoded GCC High/USGov
literals verbatim), no device-code auth, no code moved out of any sibling repo, no
module-specific convenience methods.

## Acceptance gates

**Gate 1 — package suite green.** `npm run build` (tsc): clean, exit 0. `npm test`:

```
 Test Files  5 passed (5)
      Tests  53 passed (53)
   Duration  349ms
```

M0's 1 suite / 6 shape-check tests retained; 4 new suites / 47 new tests exercise every
concrete implementation (`registry.test.ts` 16, `session-factory.test.ts` 16,
`stacksim.test.ts` 8, `http-provider.test.ts` 7).

**Gate 2 — design §2.1 M1 registry gate.** Implemented and tested:
- Back-compat read order: `<registry root>/{live|sim}/<slug>.json` → `CES_PIPELINE_ROOT/
  Stamper/plan-data/<slug>/<slug>.json` → `~/.stamper/tenants/<slug>.json` (flat, the gate's
  named path; the nested `<slug>/<slug>.json` variant `resolveTenantJsonPath()` honors is
  also read, after flat). First hit wins.
- One-time forward migration on read: raw JSON copied to the new root (source left in place —
  back-compat READS, not writes), stamped `kind: 'live'` or `'sim'`. Sim provenance detected
  via tenant-stacksim's emitted `tenant.environment: 'gcc-high-sim'` marker
  (`SimTenantConfig.ts:119-123`). A new-root record missing `kind` (or contradicting its
  namespace) is refused as a stamping bug, not served (design §2.1 point 3).
- A9 structural fix: `live/` and `sim/` are physically separate directories under the new
  root; a slug present in both throws rather than guessing; `listByKind` filters strictly on
  the stamped `kind` field (a mis-filed record appears in neither list);
  `createEphemeralSimTenant` refuses to shadow a live slug; `teardownEphemeralSimTenant`
  refuses live slugs and only ever deletes from `sim/`.

**Gate 3 — child_process mock seams delivered.**
- `PersistentSessionFactory` takes `options.spawnFn`; `session-factory.test.ts` drives the
  full connect/execute SUCCESS path (host-ready marker, init script with module imports +
  connect command + `STAMPER_SESSION_CONNECTED`, marker-protocol result parsing, session
  state transitions) against a fake in-memory host — no `powershell.exe`.
- `StacksimEnvironment` takes `options.queryPsHomeModules` (plus injectable env/fetch);
  `stacksim.test.ts` drives `enableStacksimMode()`'s SUCCESS path (all three env mutations,
  case-insensitive key dedup, serverUrl precedence) with no spawn.

**Gate 4 — encoding.** The goal's mojibake grep (gate 4 pattern, not reproduced here so this
record does not trip its own gate) returns 0 matches on every file touched by this goal —
verified at commit time.

## Deviations / defaults picked (logged, not blocking, per the goal's pointer note)

1. **Open decision §8.1 (new registry root): defaulted to `~/.ces/tenants/`** with a
   `CES_TENANT_ROOT` env override. Rationale: the founder's 2026-07-10 decision moved
   Stamper's canonical tenant configs to repo-anchored plan-data and away from the
   `C:\CES_Pipeline` default, so anchoring the NEW neutral root on `CES_PIPELINE_ROOT` would
   couple it to a convention already being retired; `~/.ces/` mirrors the oldest operator
   convention (`~/.stamper/`) without the Stamper name. Founder can flip via env override or
   by revising before Stamper cutover.
2. **Open decision §8.3 (semver): policy documented in README** — pre-1.0: minors carry
   milestones/breaking changes, patches are safe fixes; consumers pin exact. M1 = 0.2.0.
3. **Legacy read (c) also honors the nested `~/.stamper/tenants/<slug>/<slug>.json` variant**
   after the gate's named flat path. The nested layout is real legacy
   (`TenantConfig.ts:148`, `GuiServer.ts:110-125`); reading only flat would strand records
   the current resolvers can still see.
4. **HTTP provider endpoint fallback is the GCC High reference-stack literals only**
   (ported from `microsoftGccHigh.ts:13-19`), not the full multi-stack provider registry —
   porting the stack registry would exceed the tenant-connection scope fence, and the
   sovereign endpoint table is named new work (design §2.2). A tenant JSON with a non-default
   `stack` and missing endpoint fields falls back to GCC High literals instead of that
   stack's provider; acceptable because every researched consumer of this path targets the
   Microsoft stack.
5. **Info-level console chatter from `SessionManager` was reduced** (kept: warnings, errors,
   the identity log; injected `logger` seam added). Observable command/protocol behavior is
   unchanged; if Stamper's cutover characterization tests assert log lines, reinstate via the
   `logger` option rather than editing call sites.
6. **`ENGINE_SESSION_MAP` concrete constant added** — M0 deliberately declared only the type
   shape; consumers need the value, it is grounded verbatim in
   `ces-shared/src/session/constants.ts:3-12`, and the `EngineSessionMap` interface names it.
7. **`createEphemeralSimTenant` persists the opaque `seedRef` as a `stacksim_seed` key** in
   the raw record so the orchestrator's reference travels with the record; the registry never
   interprets it (interface's "reference, not shape" contract).

## Co-owned milestone status

This package side is complete and consumable: `TenantSessionFactory`,
`StacksimModeController`, `TenantRegistryLifecycle`, `TenantHttpKeyProvider`, and
`TenantLaunchContextProvider` all have constructible, tested implementations importable from
the package root. Stamper's cutover (`ces-stamper/docs/goals/G-TENANT-M1.md`) can now consume
them; per that goal's precondition note the two ship together — the M1 milestone as a whole
is not done until the Stamper-side cutover lands (its own session, its own repo).

---

## 2026-07-10 — Ratified amendment: caller identity + status/activity surface (G-TENANT-1 addendum)

Executed the goal file's "ADDENDUM 2026-07-10" section (founder-approved, motivated by
G-TENANT-M6, `docs/goals/G-TENANT-M6.md` — added to this repo with this commit). Logged here
as a RATIFIED AMENDMENT (founder, 2026-07-10), not a silent edit.

**Interface changes:**

1. **Caller identity** — new `src/consumer.ts` exports `ConsumerIdentity { module, purpose }`.
   Every connection/session/token request surface now carries an optional trailing
   `consumer` parameter: `TenantSessionFactory.ensureConnected/execute/connectMgGraph/
   connectIPPS`, `TenantHttpKeyProvider.resolveTenantKeys`, and
   `TenantLaunchContextProvider.getSimLaunchEnv`. The invariant is doc-commented at
   `ConsumerIdentity` and each amended method: requests without a consumer are REJECTED in
   service mode (M6) and LOGGED in library mode. `StacksimModeController.enableStacksimMode`
   was deliberately NOT amended — it is process-env mutation, not a connection/session/token
   request; registry lifecycle methods likewise.
2. **Status/activity read surface** — new `src/status-surface.ts` exports
   `TenantStatusSurface` (async `getConnectionStatus()` + `getActivity(filter?)`),
   `TenantActivityEntry`/`TenantActivityInput`/`TenantActivityFilter`,
   `TenantConnectionStatusEntry`, and the write-half `TenantActivityRecorder`
   (`recordActivity()` — the ONLY mutation; the ledger is append-only by construction).
   Dimensions per the addendum: tenant x engine service (SessionType) x module.

**Implementation (library mode = own-process view, per the addendum):**

- New `src/impl/status.ts`: `InProcessTenantStatus` implements both halves. Append-only
  in-memory ledger (reads return snapshot copies; no update/delete/clear surface);
  `attachSessionSource()` lets a per-tenant `PersistentSessionFactory` feed the
  tenant x engine-service status rows. M6's service replaces it behind the SAME
  `TenantStatusSurface` — consumers wire it once.
- `PersistentSessionFactory`, `PlanDataTenantHttpKeyProvider`, and `StacksimEnvironment`
  each gained `consumer` (construction-time identity; per-request param overrides) and
  `activity` (recorder) options, plus `tenantSlug` on the session factory for the tenant
  dimension. Each amended request records exactly one ok/error entry (`execute`'s internal
  ensure-connected call intentionally does not double-record) and warns through the injected
  logger when no consumer is resolvable (the library-mode half of the invariant);
  `consumer: null` is recorded so unattributed traffic stays visible. Error details are
  truncated to 300 chars; never raw credential material.
- Verbatim M1 behavior preserved: amended public methods delegate to unamended `*Core`
  private ports; observable command/protocol behavior unchanged.

**Gates (actual results):** `npm run build` (tsc) clean; `npm test` (vitest) 6 files /
75 tests passed — the 53 pre-amendment tests untouched and green, plus 22 new contract
tests (`src/__tests__/status.test.ts` new; caller-identity/activity blocks added to
`interfaces.test.ts`, `session-factory.test.ts`, `http-provider.test.ts`,
`stacksim.test.ts`). Encoding gate: mojibake-marker grep = 0 hits on every touched file.
