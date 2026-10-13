Executed from the `ces-strategy` session on 2026-07-10; migrated verbatim from that repo's `docs/context/IMPLEMENTATION_LOG.md` M0 section so `ces-tenant`'s history is self-contained.

---

# M0 — TenantManager Extraction: Interfaces + Package Skeleton + Characterization Tests
**Date:** 2026-07-10
**Plan Reference:** `ces-stamper/docs/design/tenant-manager-extraction.md` — Milestone M0 ("Interface
definition, no behavior change... Gate: interface reviewed and accepted by founder before any
extraction commit") plus the M1 "recommend adding direct unit coverage" prerequisite named in §5.
Hard scope limit honored: no code was moved out of `ces-stamper`; this task delivers interfaces,
a new sibling package skeleton, and characterization tests only.

Mid-task addition (founder direction relayed 2026-07-10): treat `ces-tester` as a NAMED M0 consumer,
not a future footnote — grounded against `ces-tester/PLAN.md`. Addressed by adding four interface
members/files (see below) rather than reworking anything already drafted; nothing drafted before
the addition needed to change to accommodate it.

## Files Created

**New repo `ces-tenant` (sibling of `ces-stamper`, `C:\Users\mhsut\DevProjects\ces\ces-tenant\`):**
- `package.json` — name `ces-tenant`, `type: module`, TypeScript + vitest (matches `ces-shared`'s
  precedent: vitest, not jest — `ces-shared/package.json` uses `"test": "vitest run"`, and
  `ces-stamper` is the jest outlier in the family, not the norm to copy for a brand-new package).
- `tsconfig.json` — `ES2022`/`NodeNext`, strict, verbatim structural match to
  `ces-shared/tsconfig.json` (same compiler options, same `rootDir: src` / `outDir: dist` shape).
- `README.md` — identity/scope/boundary. States M0 status explicitly (interfaces only, no
  implementation), quotes the design doc's scope fence (§3) for what does NOT live in the package,
  lists planned consumers per milestone (M1 Stamper, M2 EO, M3 muster-api, M4 tenant-stacksim, M5
  ces-ao), and names ces-tester as a named M0 consumer per the mid-task addition.
- `docs/design.md` — pointer back to the authoritative design doc
  (`ces-stamper/docs/design/tenant-manager-extraction.md`), does not duplicate its content.
- `src/registry.ts` — `TenantKind`, `TenantEvidenceStorageProfile`, `TenantSubscriptionProfile`,
  `TenantRegistryRecord` (the tenant record shape, extracted from
  `ces-shared/src/config/TenantConfig.ts:15-49` field-by-field, plus the new `kind: 'live' | 'sim'`
  discriminator per design §2.1); `TenantRegistryLifecycle` (added for ces-tester: ephemeral
  `kind: 'sim'` create/query/teardown + `listByKind` kind-filter guard).
- `src/connection.ts` — `SessionType`, `EngineSessionMap` (from `ces-shared/src/session/constants.ts:1-12`),
  `ConnectionProfile` (the currently-hardcoded GCC High/USGov literals inside
  `SessionManager.buildConnectCommand()`, `ces-stamper/src/core/SessionManager.ts:392-432`, named as
  fields), `PowerShellSpawnArgs` (verbatim spawn argv, `SessionManager.ts:468-473`, with the design
  doc's §7 correction preserved: no `-Version 5.1` flag actually present).
- `src/auth.ts` — `AuthStrategyKind`, `CertAuthStrategy`, `ClientSecretAuthStrategy`,
  `BearerPassthroughAuthStrategy`, `SimAuthStrategy`, `AuthStrategy` union, `AuthStrategyResolver<T>`
  (design §2.3's four grounded strategies; explicitly no device-code member — not found in any
  researched repo).
- `src/session-surface.ts` — `SessionState`, `PSResult` (verbatim from `SessionManager.ts:13-26`),
  `TenantSessionFactory` (public-method-only surface of `SessionManager`), `StacksimModeController`
  (wraps `enableStacksimMode()`, `ces-stamper/src/core/StacksimMode.ts:103-131`).
- `src/http-surface.ts` — `TenantKeys`, `TenantKeysErrorCode`, `TenantHttpKeyProvider` (extracted
  from `tenantKeysService.resolveTenantKeys()`,
  `ces-muster/muster-api/src/services/tenantKeysService.ts:14-107`).
- `src/probe.ts` — `TenantReachResult`, `TenantReachProbe` (design §2.5, explicitly marked NEW-SCOPE
  — no grounded reach/tier probe exists in any researched repo); `probeSimReady` method added for
  ces-tester (also NEW-SCOPE, but grounded against a real hand-rolled polling loop documented in
  `ces-tester/PLAN.md` M1 task 3, not fully speculative like the live-tenant probe).
- `src/launch-context.ts` — new file, added for ces-tester: `SimLaunchEnv` (the
  `PSModulePath`/`Path`/`STACKSIM_SERVER_URL` bundle `enableStacksimMode()` currently computes and
  mutates onto `process.env` in one step, `StacksimMode.ts:118-125`, re-expressed as a data value)
  and `TenantLaunchContextProvider` (`getSimLaunchEnv()` — lets an external process, ces-tester's
  `stamper-launcher`, request the bundle without duplicating `StacksimMode`'s env-mutation logic;
  doc comment requires implementations to refuse this for `kind: 'live'` tenants).
- `src/index.ts` — barrel re-exporting every type/interface above; no implementation logic anywhere
  in `src/`.
- `src/__tests__/interfaces.test.ts` — vitest smoke suite; compile-time-only shape checks (the real
  gate is `tsc --noEmit`, this suite exists so `npm test` is non-empty and green per the task's
  "possibly trivial" allowance).

**`ces-stamper` (test files only, no source or existing test file changes):**
- `tests/unit/SessionManager.test.ts` — new file, 16 tests.
- `tests/unit/StacksimMode.test.ts` — new file, 3 tests.

## Interface Summary (with source citations)

| Interface / type | File | Source citation |
|---|---|---|
| `TenantRegistryRecord`, `TenantKind` | `registry.ts` | `ces-shared/src/config/TenantConfig.ts:15-49`; `kind` is new (design §2.1) |
| `TenantRegistryLifecycle` | `registry.ts` | `ces-tester/PLAN.md` M1 tasks 2/4, Interface Contract Summary rows 1/3/4, M0 S3 precondition (ces-tester addition) |
| `SessionType`, `EngineSessionMap` | `connection.ts` | `ces-shared/src/session/constants.ts:1-12` |
| `ConnectionProfile` | `connection.ts` | `ces-stamper/src/core/SessionManager.ts:392-432` (hardcoded GCC High/USGov literals) |
| `PowerShellSpawnArgs` | `connection.ts` | `ces-stamper/src/core/SessionManager.ts:459-473` |
| `AuthStrategy` (cert/client-secret/bearer/sim) | `auth.ts` | `SessionManager.ts:403-427`; `ces-muster/muster-api/src/services/consentService.ts:58-94`; `ces-muster/muster-api/src/routes/harvest.ts:154-193`; `StacksimMode.ts:103-131` |
| `TenantSessionFactory`, `SessionState`, `PSResult` | `session-surface.ts` | `ces-stamper/src/core/SessionManager.ts` (public methods, lines 13-308) |
| `StacksimModeController` | `session-surface.ts` | `ces-stamper/src/core/StacksimMode.ts:103-131` |
| `TenantHttpKeyProvider`, `TenantKeys` | `http-surface.ts` | `ces-muster/muster-api/src/services/tenantKeysService.ts:14-107` |
| `TenantReachProbe.probeReach` | `probe.ts` | NEW-SCOPE, design §2.5 — no grounded equivalent found |
| `TenantReachProbe.probeSimReady` | `probe.ts` | NEW-SCOPE, `ces-tester/PLAN.md` M1 task 3 (ces-tester addition) |
| `TenantLaunchContextProvider`, `SimLaunchEnv` | `launch-context.ts` | `StacksimMode.ts:118-125`; `ces-tester/PLAN.md` M1 task 4, Interface Contract Summary row 3 (ces-tester addition) |

`PowerShellAdapter.ts:1505-1590`'s `buildGCCHighConnection()` branch (the verifier-flagged
extraction-inventory item) was read in full — its GCC High connect-string construction is a second,
independent implementation of the same literals `SessionManager.buildConnectCommand()` hardcodes
(Graph/EXO/IPPS/Az branches selected by regex on the command string). No separate interface was
added for it: `ConnectionProfile`/`AuthStrategy` already model the same underlying literals: this is
noted as an M1 consolidation target (both call sites should converge on one `ConnectionProfile`
consumer), not a new M0 interface.

## New Test Count

`ces-stamper`: 14 existing suites unchanged + 2 new suites (`SessionManager.test.ts`,
`StacksimMode.test.ts`) = 16 suites total. 217 existing tests unchanged + 19 new (16 + 3) = 236
total.

`ces-tenant`: 1 suite, 6 tests (all shape-check smoke tests; no implementation logic exists yet to
test).

## Gate Outputs (verbatim)

**Baseline, before any new test files (confirms the starting 217/216/1 figure from the design doc):**
```
Test Suites: 14 passed, 14 total
Tests:       1 skipped, 216 passed, 217 total
Snapshots:   0 total
Time:        2.877 s
```

**`ces-stamper` full suite, after adding `SessionManager.test.ts` + `StacksimMode.test.ts` (no
source or existing test file changes):**
```
Test Suites: 16 passed, 16 total
Tests:       1 skipped, 235 passed, 236 total
Snapshots:   0 total
Time:        2.224 s
```
217 original tests unchanged (216 passed / 1 skipped, zero regressions) + 19 new tests, all passing.

**`ces-tenant` — `npx tsc --noEmit`:**
```
(clean — exit 0, no output)
```

**`ces-tenant` — `npx vitest run`:**
```
 RUN  v4.1.10 C:/Users/mhsut/DevProjects/ces/ces-tenant

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  22:37:29
   Duration  194ms (transform 20ms, setup 0ms, import 34ms, tests 4ms, environment 0ms)
```

**Encoding grep `'â€'` across all new files (`ces-tenant/src`, `README.md`, `docs/`, `package.json`,
`tsconfig.json`, plus the two new `ces-stamper` test files) — exit 1 (no matches) in every case.**

## Deviations from Plan

- Chose vitest over jest for `ces-tenant`'s test runner, per the task's own instruction to look at
  `ces-shared`'s setup as precedent — `ces-shared` uses vitest (`"test": "vitest run"`), not jest;
  `ces-stamper`'s jest/ts-jest setup is the outlier within the family for a package with no ESM
  child-process-mocking constraints forcing that choice. Logged as a deviation only because the task
  brief said "vitest or jest matching family conventions" without picking one — this is the
  minimal-footprint reading of "family conventions" for a brand-new package with `ces-shared` as the
  named precedent.
- `PowerShellAdapter.ts:1505-1590`'s `buildGCCHighConnection()` (flagged in the task brief as part of
  the extraction inventory) was read and cited in `connection.ts`'s doc comments as corroborating
  evidence for the hardcoded-literal pattern, but did not generate its own separate interface — see
  "Interface Summary" table note above. Minimal-footprint decision: it is the same literals as
  `SessionManager.buildConnectCommand()`, not a materially different contract.
- `StacksimMode.test.ts`'s two new tests needed `__filename`/`__dirname` reconstructed via
  `fileURLToPath(import.meta.url)` (ts-jest ESM preset does not provide CJS `__dirname`) — matches
  the exact pattern already used in `SessionManager.ts:9-10` and `StacksimMode.ts:6-7` themselves, so
  this is idiomatic to the file, not a new pattern introduced.

## Untestable-Without-Source-Change Notes (for M1)

- `StacksimMode.enableStacksimMode()`'s SUCCESS path (env mutation of `PSModulePath`/`Path`/
  `STACKSIM_SERVER_URL`, `StacksimMode.ts:116-131`) is not reachable through the public surface in
  this test environment: it calls the private `queryPsHomeModules()`, which spawns a real
  `powershell.exe -NoProfile -NonInteractive -Command "Write-Output $PSHOME"` process. This repo's
  jest/ESM setup does not support `jest.mock('child_process')` (documented CJS-auto-mock limitation,
  `PowerShellAdapter.test.ts:6-8`, the pre-existing `it.skip` in that same file). Only the
  synchronous, no-spawn early-throw guard (missing module tree) is characterized here. Recommend for
  M1: either adopt `jest.unstable_mockModule` for `child_process` (unblocks the skipped
  `PowerShellAdapter` test too), or inject `queryPsHomeModules` as a constructor/parameter seam
  during the extraction move so the env-mutation success path can be pinned before it's moved.
- `SessionManager`'s persistent-process lifecycle (`spawnPersistentProcess`, `queueCommand`,
  `sendCommand`, keepalive timers, stale-connection retry loops in `execute()`) is all private and/or
  requires a live `powershell.exe` + `session-host.ps1` round-trip — not exercised by the new
  characterization tests, which stay on the dry-run/pure-function surface (`buildConnectCommand`,
  initial state, dry-run short-circuits). This is the same class of gap the design doc's M1 note
  already flags ("the M1 gate as stated is necessary but not sufficient"). Recommend the same
  mock-seam approach for M1 if deeper coverage of the spawn/retry logic is wanted before the move.
