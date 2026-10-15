# Goal Document — G-TENANT-M2

**Provenance:** Founder-directed. M0 interface gate passed 2026-07-10 (founder review of
`ces-tenant`'s `src/*.ts` interfaces: approved as ratified). ces-tester promoted to named
consumer by founder direction 2026-07-10. This brief authored 2026-07-10, distributed from the
`ces-strategy` session that executed the M0 interface work. Self-contained — a fresh session in
this repo needs nothing outside this file, the design doc, and `ces-tenant`'s `README.md` +
`src/*.ts` (read-only, in the sibling repo).

## Job

ces-eo currently carries `src/eo/core/SessionManager.ts` (631 lines), a near line-for-line
duplicate of Stamper's `SessionManager.ts` — same `SessionState`/`PSResult` interfaces, same
timeout/retry constants, same `STAMPER_*` protocol markers, same `buildConnectCommand()` strings
for all six session types, same `spawn('powershell.exe', ...)` call against the same shared
`ces-shared/scripts/session-host.ps1` (design doc §1, item 2). It additionally has **two**
independent, hardcoded readers of Stamper's tenant config path — `src/eo/config/EoConfig.ts:33-35`
and `src/eo/config/MigrationHelper.ts:11-13` — both still pointed at the path Stamper itself
deprecated in favor of the `plan-data/`-anchored convention (design §2.1). This goal deletes the
duplicate `SessionManager.ts` and both stale path readers, and cuts ces-eo over to consuming
`ces-tenant`.

## Must-NOTs (scope fence)

- Do not keep `src/eo/core/SessionManager.ts` as a parallel implementation "for compatibility."
  Delete it (or reduce it to a thin re-export if some external caller genuinely cannot be updated
  in this pass — log that as a deviation, do not treat it as the default). The whole point of this
  milestone is that ces-eo stops independently maintaining ~500 lines of duplicated session/
  process/auth logic (design §5, M2).
- Do not keep `EoConfig.ts:33-35` or `MigrationHelper.ts:11-13` reading
  `~/.stamper/tenants/<slug>.json` directly. Both must resolve tenant config exclusively through
  `ces-tenant`'s registry API (design §6, per-consumer requirement for ces-eo).
- Do not leave `StamperEvidenceLoader.ts`'s evidence-directory logic
  (`path.join(stamperRoot, 'plan-data', tenantSlug, 'evidence')`) untouched under the assumption
  it's "close enough" to the tenant-config resolution being fixed here — it's a different concern
  (evidence storage, explicitly out of `ces-tenant`'s scope per design §3) and should keep working
  as-is; do not fold it into this migration or break it while touching adjacent config code.
- Do not implement sim-mode logic by hand. ces-eo has zero existing StacksimMode equivalent
  (confirmed: zero matches for `stacksim`/`simMode`/`isLive`/`isSim` anywhere in `ces-eo/src` as of
  the design doc's research pass) — the sim-mode capability this milestone gains is a side effect
  of consuming `ces-tenant`'s `StacksimModeController`, not something to build locally (design §5,
  M2 gate: "ces-eo gains sim-mode capability it does not have today as a side effect, since none of
  its own code needs to implement that seam anymore").
- Do not expand scope into CMMC/SSP-generation logic while touching this code — that's ces-eo's own
  domain and stays entirely outside `ces-tenant`'s concern (design §3).

## Acceptance Gate

1. `src/eo/core/SessionManager.ts` is deleted or reduced to a thin pass-through with no independent
   session/process/auth logic of its own; ces-eo's session handling is backed by `ces-tenant`'s
   `TenantSessionFactory`.
2. `EoConfig.ts:33-35` and `MigrationHelper.ts:11-13` no longer construct
   `~/.stamper/tenants/<slug>.json` paths directly — both resolve via `ces-tenant`'s registry API.
   Grep for the literal string `.stamper` and `tenants` in both files returns no hardcoded
   path-join construction after this change (imports/comments referencing the legacy path for
   documentation purposes are fine; live path construction is not).
3. ces-eo's existing test suite passes with zero regressions. (Coding-expert: pull the exact
   current suite count via `npm test` before starting, same discipline the design doc's M1 gate
   used for Stamper — 217/216/1 was the concrete number cited there; ces-eo's equivalent concrete
   baseline must be established and quoted in this goal's implementation log before any code
   changes land.)
4. New coverage exists demonstrating ces-eo can run against a `kind: 'sim'` tenant via
   `ces-tenant`'s registry + `StacksimModeController` — this is the "gains sim-mode as a side
   effect" claim made concrete and testable, not just asserted.
5. Encoding gate: grepping for the UTF-8 mojibake marker (lowercase a-circumflex, U+00E2,
   immediately followed by the euro sign, U+20AC) returns 0 matches on every file touched by this
   goal — including this goal file itself. (This line originally embedded the literal marker, a
   known template flaw; fixed as part of this goal so the file passes its own gate.)

## Preconditions

- **Blocked on M1 shipping.** This goal does not start until `ces-stamper`'s cutover
  (`ces-stamper/docs/goals/G-TENANT-M1.md`) and `ces-tenant`'s M1 implementation
  (`ces-tenant/docs/goals/G-TENANT-1.md`) are both complete — ces-eo's duplicate code is being
  replaced by the same package Stamper just proved out, not a separate integration path. Do not
  begin implementation work under this goal until that precondition is confirmed closed.

## Pointers (read-only — do not copy content into new files)

- Design doc: `ces-stamper/docs/design/tenant-manager-extraction.md` — §1 item 2 (the duplication
  finding, with exact line citations for `EoConfig.ts`/`MigrationHelper.ts`), §5 (M2 gate detail,
  quoted above), §6 (ces-eo's specific per-consumer requirements), §2.4 (the PowerShell session-
  factory surface this milestone consumes).
- Ratified interfaces (sibling repo, read-only): `ces-tenant/src/session-surface.ts`
  (`TenantSessionFactory`, `StacksimModeController`), `ces-tenant/src/registry.ts` (registry query
  API for resolving tenant config by slug).

---

## Implementation log — executed 2026-07-11

**Baseline (established BEFORE any code change, per gate 3):** `npm test` = 49 suites passed,
**549 passed / 3 skipped / 552 total** tests, zero failures. `npm run validate-snippets` =
**111/111 templates passed**.

**Precondition check:** M1 confirmed shipped — shared-repo commit `ccebc1f` ("ces-stamper
G-TENANT-M1: Stamper cutover — consume the ces-tenant package") and ces-tenant repo commits
`6ecd5f4` (M1 implementation) + `f9d75b4` (ratified 2026-07-10 amendment). Started only after
confirming both.

**What changed:**

- `package.json` — added `"ces-tenant": "file:../ces-tenant"` dependency (exact-path sibling,
  same convention as ces-stamper) + jest `moduleNameMapper` entries for `ces-tenant` and the
  `ces-shared/config|session|storage` source paths the cutover test transitively loads.
- `src/eo/core/SessionManager.ts` — 631-line duplicate orchestration layer deleted; replaced by a
  ~90-line shim extending `ces-tenant`'s `PersistentSessionFactory` (same pattern Stamper's M1
  cutover proved). Keeps ces-eo's historical call shapes (`new SessionManager(tenantConfig)`,
  `execute(engineName, ...)` with `ENGINE_SESSION_MAP` mapping, `ensureConnected()` defaulting to
  'graph', `isConnected()`), no independent session/process/auth logic remains. Consumer identity
  `{ module: 'ces-eo', purpose: 'evidence collection' }` bound at construction (ratified
  amendment 2026-07-10).
- `src/eo/config/EoConfig.ts` — `stamperTenantConfigPath()` no longer constructs the legacy
  `~/.stamper/tenants/` path; it now resolves through `FileTenantRegistry.get()` (which owns
  back-compat reads + one-time forward migration) and returns the registry's canonical
  `registryRecordPath()`. Kept synchronous because `EoServer.ts`/`config-router.ts` call it
  synchronously — safe since `FileTenantRegistry.get()` is file-backed with no awaits (its whole
  body executes synchronously at call time). `loadEoConfig()` became async and resolves
  slug-to-config and available-tenant listings via `registry.get()`/`listByKind()`; sole caller
  (`src/eo/index.ts`, already async) updated. Plan-data manifest auto-discovery
  (`getStamperPlanDataRoot`) intentionally untouched — evidence/plans concern, out of
  ces-tenant's scope (design §3), same reasoning as the `StamperEvidenceLoader.ts` must-NOT.
- `src/eo/config/MigrationHelper.ts` — `validateOrMigrateTenantConfig()` rewritten over the
  registry API (async; zero existing callers, verified by grep, so the signature change breaks
  nothing). No hardcoded tenant-directory construction remains.
- `tests/unit/tenant-cutover.test.ts` — NEW, 5 tests: (1) SessionManager shim drives ces-tenant's
  factory through the injected spawn seam (marker protocol, GCC High connect command, ces-eo
  consumer identity on every activity entry); (2) `stamperTenantConfigPath()` forward-migrates a
  plan-data record into the registry root; (3) `loadEoConfig()` auto-resolves via the registry;
  (4) `validateOrMigrateTenantConfig()` loads registry-resolved records and lists availability
  from the registry; (5) gate-4 sim-mode: `kind: 'sim'` record created via
  `createEphemeralSimTenant()`, resolved by ces-eo's own config readers, env mutated by
  `StacksimEnvironment` (`StacksimModeController`), and ces-eo's SessionManager executing against
  the sim tenant's credentials — no ces-eo-local sim logic anywhere.

**Deviation (logged per the must-NOT's escape clause):** `SessionManager.ts` is a thin
ces-tenant-backed shim rather than an outright file deletion, and `stamperTenantConfigPath` /
`saveLastTenant` keep their export names. Reason: `src/eo/server/` (EoServer.ts + the new
routers/ split) carries a large UNRELATED uncommitted refactor from another session that this
session was explicitly fenced from touching; those files import `SessionManager`,
`stamperTenantConfigPath` and `saveLastTenant` by name. The shim IS the compat surface the goal's
gate 1 permits ("deleted or reduced to a thin pass-through with no independent
session/process/auth logic of its own"). No parallel implementation exists.

**Gate results (all actual, run 2026-07-11):**

1. PASS — duplicate orchestration deleted; session handling backed by ces-tenant's
   `TenantSessionFactory` (`PersistentSessionFactory`).
2. PASS — `grep -n "\.stamper" src/eo/config/EoConfig.ts src/eo/config/MigrationHelper.ts`
   returns no matches; no `tenants` path-join construction in either file (verified by grep;
   remaining `tenants` hits are the ces-tenant registry-API calls themselves).
3. PASS — `npm test`: 50 suites passed, 554 passed / 3 skipped / 557 total (baseline 549 passed
   intact, +5 new cutover tests, zero regressions). `npm run validate-snippets`: 111/111.
4. PASS — gate-4 sim-mode test above (`tenant-cutover.test.ts`, sim-mode describe block).
5. PASS — mojibake-marker grep returns 0 on every touched file (including this goal file, whose
   own gate line previously embedded the literal marker and was fixed here).
