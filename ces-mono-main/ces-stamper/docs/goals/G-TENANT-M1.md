# Goal Document — G-TENANT-M1

**Provenance:** Founder-directed. M0 interface gate passed 2026-07-10 (founder review of
`ces-tenant`'s `src/*.ts` interfaces: approved as ratified). ces-tester promoted to named
consumer by founder direction 2026-07-10. This brief authored 2026-07-10, distributed from the
`ces-strategy` session that executed the M0 interface work. Self-contained — a fresh session in
this repo needs nothing outside this file, the design doc, and `ces-tenant`'s `README.md` +
`src/*.ts` (read-only, in the sibling repo).

## Job

Stamper is the extraction's model and first consumer (design doc §5, M1; §1: "Stamper's tenant-
connection code is the model... Stamper becomes the first consumer of the new package, not a
rewrite"). This goal cuts Stamper over: `SessionManager`, `StacksimMode`, and the three competing
path resolvers in `src/config/paths.ts` / `src/server/GuiServer.ts` / (indirectly)
`ces-shared/src/storage/node.ts` are replaced with Stamper consuming the `ces-tenant` package
internally. Stamper's own working code was the source of truth for what M0 extracted as
interfaces; this goal makes Stamper prove those interfaces are sufficient by actually running on
top of them.

This is a co-owned milestone with `ces-tenant/docs/goals/G-TENANT-1.md` (that repo's M1
implementation goal) — the package must be implemented before or alongside this cutover; they
gate each other.

## Must-NOTs (scope fence)

- Do not construct `plan-data/` paths via `src/config/paths.ts`'s `__dirname`-relative logic once
  cut over — this is the exact internal inconsistency the design doc names (§2.1: Stamper "has two
  different ideas of where `plan-data/` is" today). All path resolution must go through
  `ces-tenant`'s registry API exclusively (design §6, per-consumer requirement for Stamper).
- Do not call `enableStacksimMode()` directly post-cutover. Must request a `kind: 'sim'` tenant
  from the `ces-tenant` registry instead (design §6). The CLI's `--stacksim` flag
  (`src/cli/index.ts:459-467`) becomes a request for a `kind: 'sim'` registry entry, not a direct
  call into a Stamper-owned env-mutation function.
- Do not maintain a second, parallel implementation of `SessionManager`/`StacksimMode` logic
  alongside the `ces-tenant`-backed path "just in case" — this is a cutover, not an additive
  option. Stamper's own code should shrink; if it doesn't, the cutover isn't done.
- Do not touch evidence-storage path resolution (`plan-data/<slug>/evidence/`,
  `ces-shared/src/storage/node.ts`) — that stays outside `ces-tenant`'s scope fence (design §3) and
  outside this goal.
- Do not expand scope to the sovereign endpoint table or a reach/tier probe — those are named
  new-scope work for `ces-tenant` itself (design §2.2, §2.5), not something this cutover goal
  should backfill into Stamper.
- Do not skip the `PowerShellAdapter.ts:1505-1590` `buildGCCHighConnection()` sweep (see Acceptance
  Gate below) — the M0 log already flagged this as an M1 consolidation target; leaving it
  unswept means Stamper ends this milestone with two independent implementations of the same
  hardcoded connection literals, which defeats the point of the cutover.

## Acceptance Gate

1. **Zero regressions in the existing 217-test suite.** `npm test` must show the same 14 pre-
   existing suites (`tests/unit/*.test.ts`, `tests/registry/CommandRegistry.test.ts`,
   `tests/directive-migration.contract.test.ts`) passing with the same 216 passed / 1 skipped / 217
   total baseline the design doc records as the M1 gate (§5).
2. **The 19 characterization tests added at M0 also pass, unmodified in intent.**
   `tests/unit/SessionManager.test.ts` (16 tests) and `tests/unit/StacksimMode.test.ts` (3 tests)
   were written at M0 specifically to pin the behavior being moved (design §5's M1 note: "the M1
   gate as stated is necessary but not sufficient... recommend adding direct unit coverage for the
   extracted package's session/stacksim logic as part of M1"). These must still pass once the code
   underneath them is backed by `ces-tenant` — if the cutover changes observable behavior, that is
   a regression, not an acceptable deviation, unless the founder explicitly signs off on the
   behavior change.
3. **New direct package coverage exists for the cutover itself** — tests that exercise Stamper's
   own code calling into `ces-tenant`'s `TenantSessionFactory`, `StacksimModeController`, and
   registry API (not just `ces-tenant`'s internal suite, which is a separate gate in the sibling
   goal). This closes the M0 log's noted gap that the pre-cutover suite "would not by itself catch
   a behavioral regression in the exact code being moved."
4. **The `PowerShellAdapter.ts:1505-1590` `buildGCCHighConnection()` branch is swept.** Per the
   design doc's inventory (§1, corroborated in the M0 implementation log): this function is a
   second, independent implementation of the same hardcoded GCC High/USGov literals
   `SessionManager.buildConnectCommand()` encodes. Post-cutover, both call sites must converge on
   one `ces-tenant` `ConnectionProfile` consumer — either `buildGCCHighConnection()` is refactored
   to call the same `ces-tenant`-backed path `SessionManager` now uses, or it is deleted in favor
   of a single call site. Leaving two independent hardcoded-literal implementations after this
   milestone is a gate failure, not a deferred cleanup item.
5. Combined test-suite total (236-test baseline established at M0: 217 original + 19
   characterization) must show zero regressions; new tests added for items 3–4 above are additive
   on top of that 236.
6. Encoding gate: `grep -c 'â€'` returns 0 on every file touched by this goal.

## Preconditions

- M0 interface gate passed 2026-07-10 (founder review of `ces-tenant`'s interfaces) — satisfied,
  this goal may start.
- Depends on `ces-tenant`'s M1 implementation (`ces-tenant/docs/goals/G-TENANT-1.md`) landing far
  enough to be consumable — these are co-owned, not strictly sequential; coordinate rather than
  block silently if the package-side work is incomplete.

## Pointers (read-only — do not copy content into new files)

- Design doc: `docs/design/tenant-manager-extraction.md` (this repo) — §1 (why Stamper is the
  model), §2.1–§2.5 (what moves), §5 (M1 gate detail, quoted above), §6 (Stamper's specific
  per-consumer requirements), §7 (Windows/PowerShell coupling risk — relevant since this cutover
  is what makes that coupling explicit at a package boundary for the first time).
- Ratified interfaces (sibling repo, read-only): `ces-tenant/src/registry.ts`,
  `connection.ts`, `auth.ts`, `session-surface.ts` — in particular `TenantSessionFactory` and
  `StacksimModeController`, the two surfaces Stamper's cutover consumes directly.
- M0 implementation log (this repo's own IMPLEMENTATION_LOG.md, or `ces-tenant/docs/M0-RECORD.md`
  for the migrated copy) — for the exact characterization-test inventory and the
  `PowerShellAdapter.ts` sweep note this gate depends on.
