# Sim fix report — 2026-09

## 2026-09-28 feature completion (FC-SIM-3)

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-SIM-3.md` (ces-strategy), continuing FC-SIM-2 below. Branch:
`master`. Nothing pushed. Single step: close the one HONEST-OPEN item FC-SIM-2 left behind
(`docs/requirements/REQ-ces-muster-consentservice-missing.md`) so `npm test` is fully green.

### Before -> after

| Item | Before | After |
|---|---|---|
| `tests/integration/muster-harvest.test.ts` | 5 FAIL — `ERR_MODULE_NOT_FOUND` for `ces-muster/muster-api/src/services/consentService.ts` (FC-MU-3 retired it, commit `e8b0547`) | **5/5 PASS** |
| `npm test` (this repo, on HEAD) | 182/187 passing (1 file failing) | **187/187 passing (32/32 files)** |
| `npm run build` | clean | clean |
| Structural coverage gate (`node bin/stacksim.mjs coverage`) | 503/523 PASS, 0 FAIL, 20 EXCLUDED | **503/523 PASS, 0 FAIL, 20 EXCLUDED** (unchanged — this step touched no resolvers) |
| Sim self-certification (`npm run coverage:ao`) | PASS 95 / HONEST-OPEN 0 / FAIL 0 | **PASS 95 / HONEST-OPEN 0 / FAIL 0** (unchanged) |
| `docs/requirements/REQ-ces-muster-consentservice-missing.md` | OPEN (informational, external) | **CLOSED** — resolution recorded in the REQ file itself |

### What changed and why

Read ces-muster's `muster-api/src/routes/harvest.ts` (read-only, per the write boundary) to find the CURRENT harvest
path rather than guessing. Two things had changed since the old test was written:

1. `consentService.ts` and the client-secret consent-url/callback routes are gone for good (FC-MU-3, founder
   decision 2026-09-28 #9) — device-code consent is the only *live* (non-sim) path now.
2. More importantly: the **sim** path (`POST /api/harvest/run { sim: true }`) never used consent in the first
   place. It has always built its Graph client against a hardcoded `SIM_GRAPH_BASE` constant
   (`http://127.0.0.1:4390/v1.0`) that is not overridable by request or environment — confirmed by muster-api's own
   `muster-api/tests/harvest.sim.test.ts`, which asserts exactly this as a safety property (FD-LIVE-SMOKE: sim mode
   can never drift to a real endpoint). The old test's device-code exchange against a scenario-specific `loginBase`
   was working around a constraint the current route doesn't have — it was solving yesterday's problem.

`tests/integration/muster-harvest.test.ts` was reworked to mirror muster-api's own `harvest.sim.test.ts` pattern:
mount Muster's real, unmodified `createHarvestRouter()` on a real Express app (express resolved via `createRequire`
rooted at the route file, since node_modules lives under `muster-api/`, not the test's temp dir), mint a
`bhd_operator` JWT with Muster's real `mintToken`, inject `simProbe = async () => true` (the same test seam
`createHarvestRouter`'s second parameter offers muster-api's own suite, so the route never pings the real shared
sim on :4390 — no restart of the shared sim needed for this fix), and stub `fetch` so the one thing the sim path
hardcodes — the Graph base URL — is redirected from `SIM_GRAPH_BASE` to each scenario's own ephemeral stacksim
instance. Every other fetch (including the runner's own call into the local Express app) passes through
untouched. `runHarvest`, `realGraphClient`, and the JWT auth middleware all run as unmodified Muster production
code — no consentService, no device-code, no client secret anywhere in this test now.

Fail-first proof: reverting the test file back to its pre-FC-SIM-3 content and re-running reproduces the identical
5 `ERR_MODULE_NOT_FOUND` failures on this exact tree (confirms the fix, not an unrelated environment change).

Commit: `d38fafe` ("FC-SIM-3: rework muster-harvest.test.ts for Muster's current sim harvest path"), plus this
docs-only follow-up commit recording the hash and the final gate re-run (see below).

### Gates run on committed HEAD

- `npm run build` — clean.
- `npm test` — **187/187 passing, 32/32 files** (re-run once more on `d38fafe`, the final code HEAD, to confirm —
  see "Final gate re-run" below).
- `node bin/stacksim.mjs coverage` — 503/523 PASS, 0 FAIL, 20 EXCLUDED (unchanged from FC-SIM-2; this step touched
  no resolvers, only the muster-harvest test harness).
- `npm run coverage:ao` — PASS 95 / HONEST-OPEN 0 / FAIL 0 (unchanged).
- Running the coverage gate and `coverage:ao` regenerates `coverage/inventory.json`, `coverage/coverage-report.json`,
  `coverage/ao-semantic-report.json`, and `docs/coverage/AO-SEMANTIC-COVERAGE.md`. Each diff's totals were
  unchanged (503/523/0/20 and 95/0/0, matching before this session) and no resolver or seed code was touched this
  turn; the only lines that moved were `generatedAt` timestamps (and one fixture's wall-clock-derived
  `createdDateTime`) — reverted with `git checkout --`, not committed, since nothing substantive changed.

### Final gate re-run (on `d38fafe`, after this section was first written)

`npm test` — **187/187 passing, 32/32 files**, confirmed directly on the committed `d38fafe` tree (not just the
pre-commit working copy). Build, the structural coverage gate, and `coverage:ao` were not re-run a second time
after `d38fafe`: no code changed between the gate runs above and this commit (only this report and the session log
changed, in the docs-only follow-up), so their results still hold.

### HONEST-OPEN

None. The one item FC-SIM-2 left open is closed (see above).

## 2026-09-28 feature completion (FC-SIM-2)

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-SIM-2.md` (ces-strategy), continuing the 2026-09-27 sim fix below.
Branch: `master`. Nothing pushed.

### Headline

| Measure | Before | After |
|---|---|---|
| AO's own 95-op matrix (read-only rerun from ces-ao) | PASS 84 · HONEST-OPEN 11 · FAILING 0 | **PASS 95 · HONEST-OPEN 0 · FAILING 0** |
| Sim self-certification, all 95 AO commands (`npm run coverage:ao`) | PASS 89 · HONEST-OPEN 6 · FAIL 0 | **PASS 95 · HONEST-OPEN 0 · FAIL 0** |
| Structural coverage gate (`node bin/stacksim.mjs coverage`) | 503/523 PASS, 0 FAIL, 20 EXCLUDED | **503/523 PASS, 0 FAIL, 20 EXCLUDED** (unchanged — the 7 new EO reads are exercised by this session's own fail-first tests, not the inventory-derived gate; see "Known limits" below) |
| Tests (`npx vitest run`, this repo, on HEAD) | 187 collected | **182/187 passing** — the remaining 5 (`tests/integration/muster-harvest.test.ts`) are pre-existing and external, not a regression from this work: reproduced identically on an unmodified `master` via `git stash`, root-caused to a concurrent `ces-muster` sibling-repo refactor (FC-MU-3) removing `consentService.ts` mid-session — see `docs/requirements/REQ-ces-muster-consentservice-missing.md`. `npm test` is **not** clean on HEAD for this reason; every other gate is. |

### Per-REQ: before -> after

| REQ | Before | After | Evidence |
|---|---|---|---|
| `../ces-ao/docs/requirements/REQ-tenant-stacksim-ao-paired-read-endpoints.md` (B-08) | HONEST-OPEN — no `Get-MgDeviceAppManagementAndroidManagedAppProtectionApp` resolver | **Done** — named-cmdlet resolver scoped to the named policy's apps via the existing `TARGET_PARAMS`/`resolveTargetedGet` sub-resource machinery | `src/resolvers/graphResolvers.ts`; test: `ResolverTable.test.ts` "FC-SIM-2: AO paired-read endpoints" |
| same REQ (A-07 optional per-user MFA) | 404 on the beta URI | **Done** — `GET /beta/users/{id\|upn}/authentication/requirements` -> `{perUserMfaState}` (dedicated `resolveUri` branch; the id sits mid-path, not trailing) | `src/resolvers/ResolverTable.ts`; same test file |
| `../ces-eo/docs/requirements/REQ-tenant-stacksim-training-user-coverage.md` | HONEST-OPEN — no resolver | **Done** — new URI-pattern resolver + seed keyed to real eligible users | `src/resolvers/graphResolvers.ts`, `src/seed/sets/gccHighG5.ts` |
| `REQ-tenant-stacksim-users.md` | Collection GET believed unserved | **Done (already worked)** — verified the bare `/v1.0/users` collection GET already resolves (inventory-derived); added the missing disabled account to the seed | test: "GET /v1.0/users (bare collection...)" |
| `REQ-tenant-stacksim-security-incidents.md` | HONEST-OPEN — no resolver, no embedded alerts | **Done** — new URI-pattern resolver; `alerts[]` seeded on both incidents (2 sources / 1 source, met/not-met) | same files |
| `REQ-tenant-stacksim-lifecycle-workflows.md` | HONEST-OPEN — no resolver, no collection | **Done** — new URI-pattern resolver + 3 seeded workflows (leaver+mover enforced, joiner not scheduled) | same files |
| `REQ-tenant-stacksim-run-hunting-query.md` | HONEST-OPEN — no resolver | **Done** — special-cased read-only POST handler, derives from seeded `managedDevices.lastTvmAssessed` | `src/resolvers/ResolverTable.ts` |
| `REQ-tenant-stacksim-vpn-device-configurations.md` | HONEST-OPEN — no VPN profile seeded | **Done** — `deviceConfiguration-vpn-1` added (flat + `AdditionalProperties`) | `src/seed/sets/gccHighG5.ts` |

Commit: `05532d0` ("FC-SIM-2: AO paired-read endpoints + EvidenceOps overlay signal reads").

### Also closed on AO's own side (no sim change needed, verified by re-extracting the inventory)

B-05, C-09, D-03 (`REQ-ces-ao-paired-reads.md`) and E-07 (`REQ-ces-ao-matrix-inputs.md`) were already fixed in AO's
`TemplateRegistry.ts` between 2026-09-27 and this session. `coverage/ao-semantic-expectations.json` was updated
from `honest-open` to `write`/`read` for these five rows — each flip verified against a genuine pre/post state
difference in `coverage/ao-semantic-report.json` first (never weakened blind). A-05, A-20, F-08, H-01, D-02
(`REQ-ces-ao-matrix-inputs.md`) were also independently closed on AO's side (`opInputs.ts` / `matrixClassify.ts`).
See `docs/requirements/REPLIES-2026-09-28.md` and `docs/coverage/AO-95-OP-RERUN-2026-09-28.md`.

### HONEST-OPEN

None from this session's own REQs — all 7 (1 AO + 6 EO) closed. One pre-existing, external, non-blocking item:

- **`docs/requirements/REQ-ces-muster-consentservice-missing.md`**: `tests/integration/muster-harvest.test.ts` (5
  cases) fails because a concurrent `ces-muster` session (FC-MU-3) is mid-refactor and its
  `muster-api/src/services/consentService.ts` does not currently exist at that path. Verified with `git stash` on a
  clean tenant-stacksim `master` — the failure reproduces identically with zero FC-SIM-2 changes applied, so it is
  not a regression from this work. Not fixable from tenant-stacksim's write boundary; filed back to ces-muster.

### Known limits (recorded, not hidden)

- `$filter=... ge ...` (used by EO's security-incidents read) is not a supported OData operator in this table's
  `applyODataEqFilter`/`parseODataEqFilter` (only `eq`, joined by `and`); it passes through unfiltered, same
  documented limit as every other unsupported `$filter` shape. Both seeded incidents are within the 90-day window
  regardless, so the correlation evaluator still sees the correct (unfiltered-but-otherwise-correct) data.
- The 7 new EO overlay-signal endpoints are not wired into `coverage/inventory.json`'s extraction (EoExtractor's
  regex is tailored to the OLDER per-endpoint `fetchX()` method shape; the new signals go through one generic
  `fetchGraphCollection()`), so `node bin/stacksim.mjs coverage`'s 523-item structural gate does not exercise them.
  They are proven instead by this session's own fail-first tests and (intended, see below) EO's own live-sim test.
  Extending EoExtractor was judged out of scope for this session (not required by any exit criterion; the REQs'
  own acceptance is EO's live-sim test) — noted here for whoever next touches EoExtractor.

### Sim restart (FC-SIM-2)

```
npm run build
node bin/stacksim.mjs scenario aoops-g5
node bin/stacksim.mjs serve m365_azure --slug aoops-g5 --port 4390
```

Prior session's stale process (PID 48612, started 2026-09-27, still holding the tenant lock) was stopped first; the
tenant was rebuilt fresh (`scenario aoops-g5` — a deterministic wipe + reseed) and served detached. Listening on
**127.0.0.1:4390**, PID **12676**, verified via `POST /ledger` (200, seeded records returned).

**Post-restart, read-only verification against the running sim:**
- `../ces-eo`: `npx jest tests/integration/eo-live-sim.test.ts` — reused this already-running sim on :4390 (did not
  spawn its own — confirmed the process count/PID was unchanged before and after) — **2/2 PASS**: connects a Graph
  session against the shims, streams a full live assessment (signals fetched, evaluated, non-zero controls
  assessed). This is the actual acceptance criterion the 6 EO REQs point at, and it ran against the exact sim other
  sessions now test against.
- `../ces-ao`: `AO_STACKSIM_IT=1 npx vitest run test/integration/ao95.matrix.stacksim.test.ts` was run twice BEFORE
  this restart (12:45 and 12:48, both against the working tree that became commit `05532d0`) — **PASS 95 /
  HONEST-OPEN 0 / FAILING 0** both times. It was not re-run against the restarted :4390 process: this test spawns
  and seeds its own ephemeral sim rather than using the shared one (the same pattern `eo-live-sim.test.ts` falls
  back to when :4390 is unreachable), so running it a third time would only re-prove the identical dist and would
  risk contending with the shared tenant for no benefit. That B-08 PASSed at all is itself proof the run exercised
  this session's new resolver code, not a stale build.
- `npm run coverage:ao` was independently re-run on the exact committed HEAD (`4ece263`) after the restart, as its
  own ephemeral sim on port 0 (never touches :4390): **PASS 95 / HONEST-OPEN 0 / FAIL 0**, matching AO's own matrix.
- Full `npx vitest run` was also re-run on committed HEAD: **182/187** (the 5 `muster-harvest.test.ts` failures are
  the pre-existing external issue above, unchanged).

## 2026-09-27 sim fix

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-SIMFIX.md` (ces-strategy) and `GOAL-AO-SIM-COVERAGE-2026-09-26.md` (ces-tester).
Branch: `master` (fast-forwarded from `gp-demo-1-stacksim-p02`; `gp-aoops-1` untouched). Nothing pushed.

### Headline

| Measure | Before (9170eb8) | After |
|---|---|---|
| AO's own 95-op matrix (read-only rerun from ces-ao) | PASS 19 · HONEST-OPEN 76 · FAILING 0 | **PASS 84 · HONEST-OPEN 11 · FAILING 0** |
| Sim self-certification, all 95 AO commands (`npm run coverage:ao`) | did not exist | **PASS 89 · HONEST-OPEN 6 · FAIL 0** |
| Structural coverage gate (`stacksim coverage`) | 498/523 PASS, 5 FAIL (inventory had drifted) | **503/523 PASS, 0 FAIL** (20 manual-only excluded) |
| Tests (`npm test`) | 152/153 (1 load-timing flake) | **177/177** |
| Wrong-object writes | A-03 deleted user-1 instead of the named user | **0** (proved by `src/resolvers/targets.test.ts`) |

### Per step

| Step | Status | Commit(s) | Proof |
|---|---|---|---|
| Git setup | Done | `603e0e3` (old 07-28 session log, as-is), `0e48add` (goal + instructions) | — |
| FIX-S1 wrong-user resolution | **Done** | `ebcaa2a` | `src/resolvers/targets.test.ts` (8 cases: user-3 deleted/updated by UPN with user-1 untouched; unknown UPN 404 for delete/update/action/read with the store byte-identical; URI PATCH by UPN; `$filter`; device/group/-Identity misses 404) |
| FIX-S2 goal M0 baseline | **Done** | `e2c6c62` (+ path scrub in `58903d5`) | `docs/coverage/AO-SEMANTIC-BASELINE.md` — 95 rows, 21 table ratings corrected against the executed run |
| FIX-S2 goal M1 foundation | **Done** (deviations below) | `ebcaa2a`, `745cc9b`, tests commit after `2891b3c` | `src/config/aoSourceKeys.test.ts`, `tests/integration/aoops-scenario.test.ts`, `src/resolvers/semantics.test.ts` (the four §3 resolver fixes + audit determinism), `docs/coverage/AO-SOURCE-TO-TENANT-KEY.md` |
| FIX-S2 goal M2–M5 (identity, devices, Azure, EXO/Purview/SPO/PnP) | **Done** | `ebcaa2a`, `745cc9b` | M6 run; AO rerun |
| FIX-S2 goal M6 self-certification | **Done** | `745cc9b`, `58903d5` | `npm run coverage:ao` → `coverage/ao-semantic-report.json`, `docs/coverage/AO-SEMANTIC-COVERAGE.md` |
| FIX-S3 six REQ files | 5 Done, 1 HONEST-OPEN | `58903d5` | `docs/requirements/REPLIES-2026-09-27.md` |
| FIX-S4 AO matrix rerun | **Done** — 0 FAIL, 0 wrong-object writes | `58903d5` | `docs/coverage/AO-95-OP-RERUN-2026-09-27.md` |
| FIX-S5 restart | **Done** | `58903d5` (README start command) | sim on `http://127.0.0.1:4390`, tenant `aoops-g5` |

### FIX-S1 audit (every resolver that could fall back to a default object)

| Path | Was | Now |
|---|---|---|
| Named-cmdlet writes with `-UserId/-GroupId/-ManagedDeviceId/-ConditionalAccessPolicyId/-NamedLocationId/-ApplicationId/-ServicePrincipalId/-DeviceCompliancePolicyId/-AlertId/-IncidentId/-DirectorySettingId/-…ManagedAppProtectionId/-AuthenticationMethodConfigurationId/-Site/-Identity` | ignored the argument; acted on `singletonId` (`user-1`, `nsg-1`, …) | resolved by id or the API's real alternate key (users: UPN; EXO: Identity/Name/DisplayName/Guid; SPO: Url); 404 when absent |
| Named-cmdlet reads with the same parameters | returned the whole collection (callers then fed every `.Id` into writes) | one object (or the target's scoped sub-resources); 404 when absent |
| `-Identity` read that matched nothing | returned the whole collection | 404 |
| URI `PATCH/DELETE /users/{id|upn}` etc. | PATCH upserted a phantom object keyed by the UPN; DELETE silently no-oped | resolves id/UPN; 404 when absent |
| URI collection GET with `$filter` | ignored (A-10's `foreach DELETE` would have removed every GA assignment) | `eq`/`and` applied (other operators pass through, documented) |
| `Get-Az*` with `-Name/-VaultName` | whole collection (F-11's `.Deallocate()` hit two firewalls) | the named resource; 404 when absent |
| `Set-Az*` with a resource object / pipeline input | object nested under a key and written onto `firewall-1`/`nsg-1` | persists that object onto the resource it names |
| `-Switch:$false` in PS 5.1 `$args` | stored `''` | real boolean |
| `-ErrorAction` passed to a shim | ignored (errors always printed) | honored like a real cmdlet |

Remaining by design: a named-cmdlet write that names no target at all (e.g. `Set-AdminAuditLogConfig`, `New-X` without a name)
still acts on the collection's well-known object — these are tenant singletons or creates, not a choice between objects.

### Deliberate changes (founder-visible)

1. **The G5 profile is `profiles/m365-azure.json`** (it now applies the `gcc-high-g5` seed set). No separate `gcc-high-g5.json`:
   ProfileLoader resolves profiles by stance, and AO's harness can only seed `m365_azure`. The goal's fictional
   "Harrow Ridge Precision / harrowridge.onmicrosoft.us" identity was **not** used — AO's matrix inputs name the existing
   `simtenant.onmicrosoft.us` users, groups and devices, so a second identity universe would never be exercised.
2. Existing objects keep every id and field value; the seed set only **adds** fields and objects, except: `sim-vnet-1` gains a
   workload subnet (`snet-cui-apps`) for AO F-13; `resources.cui_group_name` is `CUI-Authorized-Users` (was `Sim Group 1`, which
   named no seeded group — requested by AO's REQ).
3. Count-pinned tests updated with notes (users 5→11, CA policies 3→8, SeedEngine counts = generator + seed set).
4. New users get server-style ids (`user-<n>`), not their UPN; a duplicate UPN is a conflict. POST to a Graph collection creates
   `<singular>-<n>`. `az keyvault key rotate` creates a new key version. Az `*Config` cmdlets are client-side (as in Az.Network).
5. The coverage harness runs Stamper writes before reads (stamp, then verify) and fills placeholders from the tenant object.
6. `demo-dib-small` and every `muster-*` scenario build byte-identical state (scenarios opt in to seed sets explicitly).

### REQ outcomes (FIX-S3)

| REQ | Outcome | Proof |
|---|---|---|
| ces-ao `REQ-tenant-stacksim-ao-source-keys` | **Done** | `src/config/aoSourceKeys.test.ts`; all 20 rows bind in the rerun |
| ces-ao `REQ-tenant-stacksim-graph-fidelity` | **Done** sim side; A-05, A-20, H-01 → `REQ-ces-ao-matrix-inputs`; A-07, B-05, B-08 → `REQ-ces-ao-paired-reads` | rerun + `targets.test.ts` |
| ces-ao `REQ-tenant-stacksim-azure-fidelity` | **Done** (C-03, F-13, F-14); C-09 → `REQ-ces-ao-paired-reads` | rerun |
| ces-ao `REQ-tenant-stacksim-m365-compliance` | **Done** sim side; D-02, E-07, F-08 → `REQ-ces-ao-matrix-inputs`; D-03 → `REQ-ces-ao-paired-reads` | rerun + M6 |
| ces-stamper `REQ-tenant-stacksim-sim-tenant-secret-variables` | **Done** — `approver_upn`, `initial_password` (fake), `tou_file_base64` in every stance | `src/config/SimTenantConfig.test.ts` |
| ces-stamper `REQ-tenant-stacksim-bicep-deployment` | **HONEST-OPEN** — no producer (0 bicep registry entries) to model or prove against | `REPLIES-2026-09-27.md` |

REQs filed here (for ces-ao): `docs/requirements/REQ-ces-ao-source-paths.md`, `REQ-ces-ao-matrix-inputs.md`, `REQ-ces-ao-paired-reads.md`.

### AO rerun — the 11 HONEST-OPEN (all on AO's side)

A-05, A-20, F-08, H-01 (inputs name the wrong/used-up object), D-02 (classifier hard-code + banner-first output rendering),
E-07 (unquoted `-Operations`) → `REQ-ces-ao-matrix-inputs`. A-07, B-05, B-08, C-09, D-03 (the command's own read cannot observe
its write) → `REQ-ces-ao-paired-reads`. AO's suite's second assertion is red only because its REQ-naming rule expects A-05, B-08,
H-01, F-08 in the stacksim REQ files; the classifier itself reports 0 FAILING.

One honesty correction during the work: the first rerun showed **85** PASS because D-03's pre/post audit reads differed only by
rolling timestamps. Audit dates are now anchored to the hour; D-03 is honestly HONEST-OPEN and the rerun is **84**.

### What each module can re-test now

- **ces-ao:** rebuild against tenant-stacksim `master` dist and rerun `ao95.matrix.stacksim.test.ts`; apply
  `REQ-ces-ao-matrix-inputs` (6 rows) and `REQ-ces-ao-paired-reads` (5 rows) to reach 95.
- **ces-stamper:** flip the W4-ST2 `it.failing` (the three variables resolve); the coverage gate shows all 328 executable
  Stamper items PASS with honest not-founds (Stamper sets now run before its verifying gets).
- **ces-eo:** all 36 EO fetches PASS; Graph dates on `Get-Mg*` are now typed `[DateTime]` like the real SDK
  (ConvertTo-Json in PS 5.1 renders them as `\/Date(...)\/`, as on a real tenant).
- **ces-mono:** `ces-ao/docs/requirements/REQ-ces-mono-mcp-stacksim-routing.md` appeared during this work; it targets the
  ces-mono MCP launcher, not tenant-stacksim (no action here).
- **ces-tester / ces-muster:** unchanged scenarios build unchanged state; the shared sim on :4390 serves `aoops-g5`.

### FIX-S5 — running sim

```
npm run build
node bin/stacksim.mjs scenario aoops-g5
node bin/stacksim.mjs serve m365_azure --slug aoops-g5 --port 4390
```
Started 2026-09-27 (detached `Start-Process`, parent exited; verified alive and listening afterwards), port **4390**, PID **48612**. Nothing was listening on 4390
beforehand, so no other session's sim was stopped. `.stacksim/tenants/sim-m365-azure` (last written by another session today)
was left alone — it predates the seed set and `up` never reseeds; rebuild it only if its owner agrees.

### Known limits (recorded, not hidden)

- OData `$filter` / `-Filter`: only `eq` (joined by `and`) is applied; `startswith`, `any()`, `ne`, `or` pass through unfiltered.
- Audit-log records are a rolling fixture (dated from the top of the hour), not a history of every sim action.
- Bicep/ARM template deployment is not modelled (no producer yet).

## Legend

AO = ces-ao AdminOps (95 commands, families A–H) · EO = ces-eo EvidenceOps · FIX-S1…S5 = steps of the SIMFIX instruction file ·
M0…M6 = milestones of GOAL-AO-SIM-COVERAGE · HONEST-OPEN = not passing, reason + REQ recorded · REQ = requirement file for another
module · G5 = Microsoft 365 G5 (GCC High) licence · UPN = user sign-in name · SPO/PnP = SharePoint Online / PnP.PowerShell ·
UAL = unified audit log · MAM = mobile app protection · SKU = licence product id · OD-5/OD-6 = founder decisions in the goal file.
