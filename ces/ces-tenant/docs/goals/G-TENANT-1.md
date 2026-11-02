# Goal Document — G-TENANT-1

**Provenance:** Founder-directed. M0 interface gate passed 2026-07-10 (founder review of
`ces-tenant`'s `src/*.ts` interfaces: approved as ratified). ces-tester promoted to named
consumer by founder direction 2026-07-10. This brief authored 2026-07-10, distributed from the
`ces-strategy` session that executed the M0 interface work. Self-contained — a fresh session in
this repo needs nothing outside this file, `docs/M0-RECORD.md`, `README.md`, `src/*.ts`, and the
design doc pointer below.

## Job

`ces-tenant` is the single, common `TenantManager` package for CES: registry of tenant records
(`kind: 'live' | 'sim'`), connection-profile/endpoint resolution, the auth-strategy seam, and the
two client surfaces (PowerShell session-factory, HTTP token/endpoint provider) every CES module
uses to connect to a tenant. M0 shipped interfaces only — `src/registry.ts`, `connection.ts`,
`auth.ts`, `session-surface.ts`, `http-surface.ts`, `probe.ts`, `launch-context.ts`, `index.ts` —
no implementation logic anywhere in `src/`. This goal is M1: **implement** the package against
those ratified interfaces, as Stamper's co-owned cutover milestone (design doc §5, M1).

Read the ratified interfaces directly (`src/*.ts` in this repo) before writing implementation
code — every interface member already carries a doc comment citing the exact Stamper/EO/
muster-api/tenant-stacksim file:line it was extracted from, or is marked NEW-SCOPE if it is not
grounded in existing behavior. Do not re-derive the shapes from Stamper's source; the interfaces
are the contract now.

## Must-NOTs (scope fence)

- Do not implement anything not already named by an M0 interface. If implementation reveals a gap
  the interfaces didn't anticipate, that is a scope question for the founder, not a inline
  addition — extend the interface file first (as its own reviewed change), then implement.
- Do not implement the sovereign endpoint table (`connection.ts`'s `ConnectionProfile` beyond the
  current hardcoded GCC High/USGov literals) or a live-tenant reach/tier probe
  (`probe.ts`'s `probeReach`) as anything other than what the current hardcoded values /
  NEW-SCOPE placeholder already specify — both are explicitly named new design work in the
  design doc (§2.2, §2.5, §7), not part of this extraction milestone's behavior-preserving scope.
- Do not accumulate module-specific convenience methods. Design doc §3's test applies to every
  new method: "would a module *other than the one requesting this* also need it, purely for the
  purpose of connecting to a tenant?" If no, it does not belong here.
- Do not persist raw secret material anywhere — credential fields are references only
  (thumbprint, cert path, app/tenant IDs), matching current practice across all four researched
  repos (design doc §2.3).
- Do not add a device-code auth strategy or any other auth family not already named in
  `auth.ts`'s `AuthStrategy` union — none is grounded in current code.
- Do not move any code out of `ces-stamper`, `ces-eo`, `ces-muster`, or `tenant-stacksim`. That is
  each consumer's own milestone (M1 for Stamper co-owns the cutover *from Stamper's side*; this
  goal is the package-side implementation those cutovers will import — see
  `ces-stamper/docs/goals/G-TENANT-M1.md`). Do not reach into sibling repos to delete or refactor
  their code from this repo.
- Do not skip the `child_process` mock-seam work item (see Preconditions below) — it is scoped
  into this goal explicitly, not deferred.

## Acceptance Gate

1. **This package's own suite is green.** `npm run build` (tsc, clean) and `npm test` (vitest)
   pass with the M0 baseline (1 suite / 6 shape-check tests) either retained or superseded by real
   implementation tests that exercise every exported interface's concrete implementation —
   `TenantSessionFactory`, `StacksimModeController`, `TenantHttpKeyProvider`,
   `TenantRegistryLifecycle`, `TenantLaunchContextProvider` at minimum. Shape-check-only tests are
   not sufficient once real logic exists behind an interface.
2. **The design doc's M1 gate is met for this package's half of the cutover:** the registry read
   path implements the documented back-compat order (design §2.1 point 2 — new location, then
   `CES_PIPELINE_ROOT/Stamper/plan-data/<slug>/<slug>.json`, then legacy
   `~/.stamper/tenants/<slug>.json`, first hit wins, one-time forward migration), every migrated
   record is stamped `kind: 'live'` or `kind: 'sim'` per design §2.1 point 3 (no record may be
   missing `kind` post-migration), and the A9 hazard's structural fix (physically separate sim/live
   namespace under the new root, design §2.1) is implemented, not just documented.
3. **The `child_process` mock-seam work item is delivered.** The M0 implementation log
   (`docs/M0-RECORD.md` in this repo, migrated from the originating `ces-strategy` session) records
   that `StacksimMode.enableStacksimMode()`'s success path (env mutation via
   `queryPsHomeModules()`, which spawns a real `powershell.exe`) and `SessionManager`'s persistent-
   process lifecycle (`spawnPersistentProcess`, `queueCommand`, `sendCommand`, retry loops) were
   NOT exercised by M0's characterization tests because ces-stamper's jest/ESM setup could not mock
   `child_process`. This goal must inject `queryPsHomeModules` (and the equivalent spawn-point in
   the session-factory implementation) as a constructor/parameter seam so the env-mutation success
   path and the spawn/retry logic can be tested without a live `powershell.exe` round-trip. Gate:
   at least one test in this package's suite exercises the mocked-success path for both
   `StacksimModeController.enableStacksimMode()` and `TenantSessionFactory`'s connect/execute path.
4. Encoding gate: grep for the UTF-8 mojibake marker (the three-character sequence produced when a curly quote or em-dash is double-decoded: lowercase a-circumflex + euro sign) returns 0 hits on every file touched by this goal.

## Preconditions

- M0 interface gate passed 2026-07-10 (founder review) — satisfied, this goal may start.
- Co-owned with `ces-stamper/docs/goals/G-TENANT-M1.md` — the two milestones ship together. This
  package's implementation and Stamper's consumption cutover are the same M1 milestone from two
  sides; do not consider this goal complete until Stamper's cutover (that sibling goal file) can
  actually consume the implementation delivered here.

## Pointers (read-only — do not copy content into new files)

- Design doc: `ces-stamper/docs/design/tenant-manager-extraction.md` — §5 (milestones), §6
  (per-consumer requirements), §7 (risks, including the Windows/PowerShell coupling and version-
  skew risks that bear on this implementation), §8 (open decisions — in particular #1, the new
  registry root path, and #3, semver policy, both of which this implementation must pick a default
  for if the founder has not yet resolved them; log the choice as a deviation, do not block).
- Ratified interfaces: this repo's own `src/registry.ts`, `src/connection.ts`, `src/auth.ts`,
  `src/session-surface.ts`, `src/http-surface.ts`, `src/probe.ts`, `src/launch-context.ts`,
  `src/index.ts`.
- M0 record: `docs/M0-RECORD.md` (this repo) — the verbatim migrated implementation log recording
  what M0 delivered and the untestable-without-source-change notes that motivate this goal's
  mock-seam requirement.

---

## ADDENDUM 2026-07-10 — interface amendment: caller identity + status surface (founder-approved, rides with this goal)

Two additions to the ratified interfaces, made HERE (before any M1-M5 consumer wires up —
cheap now, painful later), motivated by G-TENANT-M6 (the stateful tenant service, queued
after M1; see docs/goals/G-TENANT-M6.md):

1. **Caller identity:** every connection/session/token request carries
   `consumer: { module: string; purpose: string }`. Doc-comment the invariant: requests
   without a consumer are rejected in service mode and logged in library mode. Without
   this, M6's activity-by-module is impossible.
2. **Status/activity read surface:** add the interface for querying connection status and
   activity (per tenant × engine service × module; append-only activity entries). The
   library implementation may return only its own process's view; M6's service lights up
   the full picture behind the SAME interface — consumers wire it once.

Amend the interface files + the contract tests accordingly; log both as ratified-amendment
(founder, 2026-07-10), not silent edits.
