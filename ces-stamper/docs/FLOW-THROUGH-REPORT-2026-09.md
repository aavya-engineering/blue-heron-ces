# Flow-Through Report — ces-stamper (2026-09-26)

**Branch:** `flow-through-2026-09`
**Base:** `stamper-bootstrap-grant-parity` (07a8a29)
**Tests before:** 253 passed, 0 failed
**Tests after:** 280 passed, 0 failed, 1 skipped
**tsc:** clean throughout

---

## Step 1: MS-R2 — Fix normalizeStamperAction (P0, step 0.2) — DONE

**Commit:** `3b43e84`
**What:** Fixed `normalizeStamperAction` to correctly map all 5 Muster action values. Unknown values now throw instead of defaulting to `automated`. Fixed failure-report label precedence to use the directive map before the raw `stamper_action`.

**Changes:**
- `src/types/ces-artifacts.types.ts` — added `nacapabilityabsent`, `metbyprohibition`, `inheritedfedramp` switch cases; default now throws
- `src/translators/PlanTranslator.ts:1658` — guarded empty-string call site
- `src/server/routes/execute.routes.ts:2379,2425` — flipped `controlDirectivesMap[cid]` before `mc?.stamper_action`

**Criteria detail:**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Muster values normalize correctly | PASS | 5 unit tests (maps N-A-Capability-Absent, Met-By-Prohibition, Inherited-FedRAMP, automated, nonstack) |
| Unknown values throw | PASS | 2 unit tests (unknown string + empty string) |
| controls[] → directive map (end-to-end) | PASS | 1 translateFile test: mpControls with Muster actions → correct `_control_directives` map |
| controls[] → tasks (end-to-end) | PASS | 1 translateFile test: AC.L2-3.1.18 with `N-A-Capability-Absent` → task with `_directive: document-absence` |
| Parse controls with CESMPControlSchema | DEFERRED to MS-R1 | Proper Zod parsing of Muster controls[] requires the shared contract (ces-shared MS-R1) |
| Failure-report label precedence | CODE-INSPECTED | `controlDirectivesMap[cid]` now precedes `mc?.stamper_action` at both failure-report sites; no route harness to unit-test the full HTTP path |

**Tests:** `tests/directive-migration.contract.test.ts` — 9 tests total in Muster-related describe blocks

---

## Step 2: MS-R1 — Shared plan contract — PARTIAL

**What:** Adopted ces-shared's `SUPPORTED_PLAN_VERSIONS` enum. Version gate rejects unknown `ces.version` before Zod parse. Private schemas (`CESManifestMetaSchema`, `CESPlanMetaSchema`) now use `z.enum(SUPPORTED_PLAN_VERSIONS)` on the version field. Private body schemas kept (shared bodies are `z.record(z.any())`; Stamper needs detailed validation).

**Changes:**
- `src/types/ces-artifacts.types.ts` — import `SUPPORTED_PLAN_VERSIONS`, version fields use enum
- `src/translators/PlanTranslator.ts` — version pre-check before Zod parse

**Criteria detail:**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Unknown version rejected | PASS | `rejects an unknown ces.version with a clear error` |
| Valid version 1.0.0 accepted | PASS | `accepts version 1.0.0` |
| Replace private schemas with shared | PARTIAL | Shared bodies are `z.record(z.any())`; Stamper keeps private body validation, adopts `SUPPORTED_PLAN_VERSIONS` |

**Tests:** `tests/directive-migration.contract.test.ts` — 2 version gate tests

---

## Step 3: MS-R4 — Carry Muster fields (cesId + fedramp_package_id) — DONE

**What:** `cesId` already flows through `buildCesIdentity` into the executable plan. Added `fedramp_package_id` to `CESMPControlSchema` and `CESControlDirectiveSchema`. `buildInheritanceTask` now carries `fedramp_package_id` in task args (`_fedramp_package_id`). Execution route prefers `taskFedrampPkgId` before tenant fallback. Filed `REQ-ces-shared-infra-manifest-key.md` for the `infrastructure` vs `infrastructure_manifest` key mismatch.

**Changes:**
- `src/types/ces-artifacts.types.ts` — added `fedramp_package_id` to both schemas
- `src/translators/PlanTranslator.ts` — `buildInheritanceTask` accepts + forwards `fedrampPackageId`; all 3 call sites pass it; directive synthesis forwards `mc.fedramp_package_id`
- `src/server/routes/execute.routes.ts` — reads `_fedramp_package_id` from task args, prefers it before tenant fallback

**Criteria detail:**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| EP carries ces.cesId | PASS | `executable plan carries ces.cesId from the mission plan` (test) |
| fedramp_package_id in task args | PASS | `inherit-fedramp task carries fedramp_package_id from the control (MS-R4)` (test) |
| execute.routes.ts prefers task's package id | CODE-INSPECTED | `fedrampPkgId` hoisted at line 855; used at lines 1027, 1033. No route-level integration test harness. |
| Infra manifest key mismatch | REQ FILED | `docs/requirements/REQ-ces-shared-infra-manifest-key.md` |

**Tests:** `tests/directive-migration.contract.test.ts` — 2 new tests (cesId propagation, fedramp_package_id)

---

## Step 4: MS-R5 — Plan picker accepts both _ and - separators — DONE

**Commit:** `a682837`
**What:** All plan file patterns now accept both `-` and `_` separators. Infra manifest also accepts Muster's `infra-manifest` prefix alongside the legacy `infrastructure-manifest`.

**Changes:**
- `src/server/routes/utility.routes.ts` — 3 regex fixes (browse, cleanup, auto-discovery) + `infra(?:structure)?` prefix
- `src/server/routes/execute.routes.ts:374` — regex instead of `startsWith`

**Criteria detail:**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Browse route accepts `_` | PASS | `finds Muster underscore-separated mission plan via pattern query` |
| Browse route accepts `_` (TM) | PASS | `finds Muster underscore-separated tenant manifest via pattern query` |
| Auto-discovery returns `_` files | PASS | `auto-discovery returns Muster underscore-separated files` |
| Frontend auto-select works | CODE-INSPECTED | `index.html:6780-6782` already consumes `plan-data-paths.missionPlan` — no change needed |

**Tests:** `tests/unit/PlanBrowseSeparator.test.ts` — 3 route tests

---

## Step 5: MS-R8 — Delete dead EvidenceOpsClient push — DONE

**Commit:** `c99562a`
**What:** Deleted the dead `EvidenceOpsClient` that pushed to `/api/stamp-capture` (EvidenceOps has no such endpoint). Verified all evidence lands under `getStamperTenantRoot(slug)`.

**Changes:**
- `src/integrations/EvidenceOpsClient.ts` — deleted (git rm)
- `src/server/routes/execute.routes.ts` — removed import and fire-and-forget push block

**Criteria detail:**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| EvidenceOpsClient deleted | PASS | `EvidenceOpsClient.ts no longer exists` |
| No stamp-capture references | PASS | `execute.routes.ts does not reference stamp-capture` |
| Evidence writes resolve under tenant root | PASS | `evidenceDirForTenant resolves under getStamperTenantRoot` |
| Evidence round-trip (write → read) | PASS | `evidence written to tenant dir is readable from the shared root` |

**Tests:** `tests/unit/EvidenceWritePath.test.ts` — 6 tests

**Note:** `GuiServer.ts` still references `EVIDENCE_OPS_SECRET` in another session's uncommitted edits — not touched. The `evidence_ops` SSE event handler in `index.html` is now orphaned (also in another session's edits).

---

## Step 6: MS-R6 — Converge GUI/CLI translate + route tests — DONE

**Commit:** `d6bee47` (route tests only; **correction:** CLI dual-prefix logic was uncommitted here — it landed at `8d5c364` on 09-27)
**What:** CLI translate now passes `mpControls` and `infraModelValue` to `PlanTranslator`, matching the GUI path. CLI infra manifest heuristic handles both `infrastructure-manifest` (legacy) and `infra-manifest` (Muster) prefixes.

**Changes:**
- `src/cli/index.ts` — loads mpControls from MP, extracts infrastructure_model from infra manifest (tries both prefixes), passes both to PlanTranslator

**Criteria detail:**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| CLI passes mpControls | CODE-INSPECTED | `cli/index.ts:260-273` — loads from MP JSON, passes to constructor |
| CLI passes infraModelValue | CODE-INSPECTED | `cli/index.ts:275-289` — tries both `infrastructure-manifest` and `infra-manifest` prefixes |
| 400 on missing missionPlan | PASS | route test |
| 400 on missing manifest | PASS | route test |
| Successful translate | PASS | route test |
| GUI/CLI task-id identity | PASS | route test (same PlanTranslator, same fixture → identical task IDs) |
| Dry-run GET /api/execute | HONEST-OPEN | Route requires a mounted Express app with full server wiring; no test harness available |

**Tests:** `tests/unit/TranslateRoutes.test.ts` — 4 route tests

---

## Step 7: MS-R9 — Emit execution results per shared contract — PARTIAL

**What:** Adopted ces-shared's `EXECUTION_RESULTS_CONTRACT_VERSION`. `ExecutionResultsCollector.buildManifest` now emits `contractVersion`, `planId`, and `cesId`. Both call sites in `execute.routes.ts` pass `planId` and `cesId`. `ExecutionResultsManifestSchema` updated with the new fields. Verdict casing not flipped — shared uses lowercase (`sat/not_sat`), Stamper still emits uppercase (`SAT/NOT_SAT`); the emitted manifest fails `safeParse` against the shared `ExecutionResultsManifestSchema` on `results[].verdict`.

**Changes:**
- `src/core/ExecutionResultsCollector.ts` — imports shared contract version, updated signature + manifest shape
- `src/types/ces-artifacts.types.ts` — added `contractVersion`, `planId`, `cesId` to `ExecutionResultsManifestSchema`
- `src/server/routes/execute.routes.ts` — both `buildManifest` calls pass `planId` and `cesId`

**Criteria detail:**

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Manifest emits contractVersion | PASS | `emits contractVersion and planId in the manifest` |
| Manifest emits planId | PASS | same test |
| Manifest emits cesId | PASS | same test (optional field) |
| Verdict casing (lowercase) | HONEST-OPEN | Shared uses `sat/not_sat`; Stamper private schema still uses uppercase `SAT/NOT_SAT`. Frontend may compare uppercase strings. Needs audit before flipping — emitted manifest does not conform to shared schema on this field. |

**Tests:** `tests/directive-migration.contract.test.ts` — 1 collector contract test

---

## Summary

| Step | ID | Status | Commit | Tests |
|------|------|--------|--------|-------|
| 1 | MS-R2 | DONE | 3b43e84 | 9 |
| 2 | MS-R1 | PARTIAL | 6020f68 | 2 |
| 3 | MS-R4 | DONE | 6020f68 | 2 |
| 4 | MS-R5 | DONE | a682837 | 3 |
| 5 | MS-R8 | DONE | c99562a | 6 |
| 6 | MS-R6 | DONE | d6bee47 | 4 |
| 7 | MS-R9 | PARTIAL | 6020f68 | 1 |

**Done:** 5 of 7 (27 new tests)
**Partial:** 2 of 7 (MS-R1: private body schemas kept; MS-R9: verdict casing not flipped)
**HONEST-OPEN remainders:** execute.routes.ts fedramp_package_id usage (code-inspected), verdict casing (MS-R9), infra manifest key (REQ filed)

## HONEST-OPEN inventory (remaining)

| Criterion | Reason | Path to resolution |
|-----------|--------|--------------------|
| MS-R9: Verdict casing | Shared uses lowercase `sat/not_sat`; Stamper private schema uses uppercase `SAT/NOT_SAT`; frontend may compare uppercase | Audit frontend verdict comparisons, then flip or add mapping |
| MS-R4: execute.routes fedramp_package_id | Code-inspected (taskFedrampPkgId → fedrampPkgId); no route integration test harness | Would need full server integration test |
| MS-R4: Infra manifest key | Shared uses `infrastructure`, Stamper uses `infrastructure_manifest` | REQ filed; pick canonical key in shared contract |
| MS-R1: Private body schemas | Shared bodies are `z.record(z.any())`; Stamper keeps detailed body validation | Replace when shared schemas gain detailed body types |
| MS-R2: Parse controls with CESMPControlSchema | Shared contract types now exist but full Zod parse not wired | Wire shared `ControlDispositionSchema` at parse boundary |
| MS-R6: Dry-run GET /api/execute | No test harness for full server routes | Would need integration test framework |
| MS-R2: Failure-report label precedence | Code-inspected, not unit-testable | Would need route-level integration test |
| MS-R5: Frontend auto-select | Code-inspected (already works) | No change needed |
| MS-R6: CLI passes mpControls/infraModelValue | Code-inspected (no CLI test harness) | Would need CLI integration test |

## REQ files filed

- `docs/requirements/REQ-ces-shared-mission-plan-contract.md` — blocks MS-R1 + MS-R4 (now resolved by ces-shared commits 08e50bb, a6d3915)
- `docs/requirements/REQ-ces-shared-execution-results-contract.md` — blocks MS-R9 (now resolved)
- `docs/requirements/REQ-ces-shared-infra-manifest-key.md` — infrastructure vs infrastructure_manifest key reconciliation

## Legend

- MS-Rn = Muster → Stamper recommendation n (from ces-strategy flow assessment)
- P0/P1/P2 = priority (blocks flow / needed for trustworthy operation / clean-up)
- HONEST-OPEN = step cannot pass; exact blocker and REQ file documented
- EP = Executable Plan
- MP = Mission Plan
- TM = Tenant Manifest
- REQ = requirement file for another module
- CESMPControlSchema = Zod schema for Muster's per-control plan data

---

## 2026-09-27 — W1→W2 wave flow-through (Instructions-From-Strategy-2026-09-27)

**Supersedes** the 09-26 session's open items. Driven by `INSTRUCTIONS-FROM-STRATEGY-2026-09-27.md` (from grand plan §7).

**Tests before:** 280 passed, 0 failed, 1 skipped
**Tests after:** 288 passed, 0 failed, 1 skipped (T1–T3); 303 passed, 0 failed, 1 skipped after T4 resume
**tsc:** clean throughout

### T1 — N-4: CLI dual-prefix infra manifest lookup (DONE)

**Commit:** `8d5c364`
**Files:** `src/cli/index.ts`, `tests/unit/CliInfraManifestPrefix.test.ts`

The CLI auto-discovery of infra manifest from `--manifest` now tries both `infrastructure-manifest` (legacy) and `infra-manifest` (Muster) filename prefixes. Four new tests verify both prefixes, preference order (legacy first), and missing-file behavior.

| Check | Result | Evidence |
|-------|--------|----------|
| Dual-prefix logic committed | PASS | `git show 8d5c364 -- src/cli/index.ts` |
| Test covers both prefixes | PASS | `CliInfraManifestPrefix.test.ts` (4 tests) |
| No document still cites `d6bee47` for this | PASS | REQ reworded, report corrected below |

### T2 — N-5: validate-file accepts canonical + legacy roots (DONE)

**Commit:** `649a216`
**Files:** `src/server/routes/utility.routes.ts`, `tests/unit/ValidateFileRoots.test.ts`

`/api/validate-file` and `/api/read-plan-file` now accept paths under either `getPlanDataRoot()` (legacy repo-relative `plan-data/`) or `getCesPipelineRoot()` (canonical `CES_PIPELINE_ROOT` env var). Traversal (`..`) rejected before root check.

| Check | Result | Evidence |
|-------|--------|----------|
| File under CES_PIPELINE_ROOT validates | PASS | `ValidateFileRoots.test.ts` test 1 |
| Path outside both roots rejected | PASS | `ValidateFileRoots.test.ts` test 2 |
| `..` traversal rejected | PASS | `ValidateFileRoots.test.ts` test 3 |

### T3 — N-6 / MS-R9: lowercase verdicts at manifest boundary (DONE)

**Commit:** `b879720`
**Files:** `src/core/ExecutionResultsCollector.ts`, `tests/directive-migration.contract.test.ts`

Added `normalizeVerdict` static method in `ExecutionResultsCollector` that maps `SAT→sat`, `NOT_SAT→not_sat`, `PROVISIONAL→provisional`, `N/A→not_applicable` at the `buildManifest` boundary only. Internal and frontend strings unchanged.

| Check | Result | Evidence |
|-------|--------|----------|
| `ExecutionResultsManifestSchema.safeParse(buildManifest(...)).success === true` | PASS | `directive-migration.contract.test.ts` — "buildManifest passes shared ExecutionResultsManifestSchema.safeParse (T3/E6)" |
| Internal verdict strings unchanged | PASS | grep shows `SAT/NOT_SAT/PROVISIONAL` still used in `src/` types and logic |
| Untouchable `public/` files not edited | PASS | no changes to `public/index.html` |

### T4 — MS-R1 / N-12: delegate body validation to ces-shared (DONE — resumed 2026-09-27)

**Commit:** `d668c16`
**Files:** `src/types/ces-artifacts.types.ts`, `src/cli/index.ts`, `src/server/routes/baseline.routes.ts`, `src/server/routes/translate.routes.ts`, `tests/fixtures/full-registry-mission-plan.json`, `tests/unit/SharedMissionPlanDelegation.test.ts`, `docs/requirements/REQ-ces-shared-mission-plan-typed-output.md`

*History:* first pass marked WAITING (S3 alias test absent, S4 bodies test uncommitted). Resumed once the gate was met:
`N-12 infrastructure_manifest alias` present in `ces-shared/src/types/mission-plan.contract.test.ts` (S3 `b9b1ace`),
`mission-plan.bodies.test.ts` committed (S4 `2e168a6`), `grep -c passthrough ces-shared/dist/types/mission-plan.contract.js` = 12 (dist fresh).

What changed:
- Stamper's private MMP / TM / IM / directive schemas are deleted. `CESManualMissionPlanSchema`, `CESTenantManifestSchema`,
  `CESTenantManifestBodySchema` and `CESInfrastructureManifestSchema` are now the ces-shared schemas plus Stamper-only
  `.superRefine` rules (no fork). `StamperDirectiveEnum` *is* the shared `StamperDirective`. Body types are aliases of the
  shared inferred types.
- Stamper-only refinements kept (stricter than shared; not loosened): milestones ≥ 1; milestone `exit_criteria` ≥ 1 non-empty;
  `steps` ≥ 1 when present; step `section` ∈ 7 infra sections; step `tech_ref` matches `CESStepTechRefSchema`; non-empty
  `dependencies` / asset `tags` strings; infra `ces.generated_on` is ISO date-time.
- Canonical `infrastructure` key read at all three infra parse sites (CLI, translate route, baseline route); ces-shared
  normalizes the deprecated `infrastructure_manifest` alias (ces-planner still emits the alias — it parses).
- Fixture correction: `tests/fixtures/full-registry-mission-plan.json` had `ces.artifact: "ces-manual-mission-plan"`; the
  shared literal (and every real producer — ces-planner / Muster `manualPlanGenerator.ts:308`) uses `manual_mission_plan`.
  Stamper-owned fixture fixed; not a legitimate-plan rejection, so no REQ.
- Previously Stamper stripped unknown keys; the shared schemas are `.passthrough()`, so Muster extras (e.g. `controls[]`,
  `advisories`) now survive parsing.

| Check | Result | Evidence |
|-------|--------|----------|
| Existing suite (≥ 280) passes | PASS | 303 passed / 1 skipped (288 before + 15 new) |
| Private body schemas gone (no duplicate definitions) | PASS | `SharedMissionPlanDelegation.test.ts` — "src/ contains no private MMP / TM / IM / directive schema definitions" |
| Muster fixture translates through the shared schema | PASS | "Muster manual-mission-plan fixture parses…", "Muster tenant-manifest fixture parses…", "Muster MMP + TM translate end-to-end through PlanTranslator" |
| Canonical key + alias | PASS | "reads the canonical infrastructure key", "normalizes the deprecated infrastructure_manifest alias onto infrastructure" |
| Stamper refinements not weakened | PASS | "rejects an empty milestones array (shared allows it)", "…empty exit_criteria", "…step section outside the seven infra sections", "…malformed step tech_ref", "…empty-string asset tag…", "…date-only generated_on…", "still rejects a non-canonical ces.artifact" |

New REQ filed: `REQ-ces-shared-mission-plan-typed-output.md` (OPEN, low priority) — shared `ManualMissionPlanSchema` is typed
`z.ZodType<Record<string, unknown>>` and `CesPlanMeta` is not exported, so Stamper keeps a *type-level* mirror
(`CESPlanMeta`, `CESManualMissionPlan`) and casts the parse output. No schema is duplicated; the type mirror goes when the REQ lands.

### MS-R6 dry-run execute route

**Status:** HONEST-OPEN (per F-2, 09-27)

`GuiServer.ts` carries another session's uncommitted edits (untouchable). No integration test harness for the full server routes. Stays HONEST-OPEN per founder decision.

### REQs closed or corrected (E5)

| REQ file | Status | Notes |
|----------|--------|-------|
| `REQ-ces-shared-mission-plan-contract.md` | CLOSED | ces-shared commits `08e50bb` + `a6d3915`; Stamper adopted at `6020f68` |
| `REQ-ces-shared-execution-results-contract.md` | CLOSED | ces-shared commit `a6d3915`; Stamper adopted at `6020f68` + `b879720` |
| `REQ-ces-shared-infra-manifest-key.md` | CLOSED | Reworded at T1 (dual-prefix at `8d5c364`, not `d6bee47`); closed against ces-shared S3 `b9b1ace` + Stamper T4 `d668c16` |
| `REQ-ces-shared-mission-plan-contract.md` (T4 note) | CLOSED (annotated) | Body delegation completed at `d668c16` (S4 `2e168a6`) |
| `REQ-ces-shared-mission-plan-typed-output.md` | OPEN (new) | Filed at T4; low priority, non-blocking |

### Corrected overclaims

1. **MS-R6 "CLI handles both prefixes" cited `d6bee47`.** The dual-prefix logic was uncommitted at the time of the 09-26 report. The correct commit is `8d5c364` (T1, 09-27). `REQ-ces-shared-infra-manifest-key.md` and the 09-26 report's MS-R6 row cited `d6bee47`; the REQ has been reworded with the correct hash.
2. **09-27 session log said flow-through was "fully executed."** At that point `src/cli/index.ts` was uncommitted — the flow-through was not fully executed. The CLI fix was uncommitted working-tree state, not a landed change.

### Summary

| Step | ID | Status | Commit | Tests |
|------|------|--------|--------|-------|
| T1 | N-4 | DONE | 8d5c364 | 4 |
| T2 | N-5 | DONE | 649a216 | 3 |
| T3 | N-6/MS-R9 | DONE | b879720 | 1 |
| T4 | N-12/MS-R1 | DONE | d668c16 | 15 |

**Done:** 4 of 4 (23 new tests, total 303)
**WAITING:** none (T4 resumed and done after S3 `b9b1ace` + S4 `2e168a6`)
**HONEST-OPEN:** MS-R6 dry-run route (per F-2)

### Exit criteria status

| # | Criterion | Met? |
|---|-----------|------|
| E1 | T1–T4 each Done / HONEST-OPEN / WAITING | YES (all four Done) |
| E2 | tsc + npm test clean on committed HEAD | YES (303 pass / 0 fail / 1 skip at `d668c16`) |
| E3 | No flow-through file uncommitted | YES (cli/index.ts at 8d5c364; report+REQs in this commit) |
| E4 | `## 2026-09-27` report section appended | YES (this section) |
| E5 | Stale REQs closed or corrected | YES — infra-key REQ closed after T4 (see REQs table) |
| E6 | `safeParse(buildManifest(...)).success === true` in committed test | YES (b879720) |

## 2026-09-27 fix batch

Driven by `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md` (re-assessment after Gate 2; flow files
`flow-muster-stamper.*` in ces-strategy). Adds to the 09-27 section above; its exit criteria still hold.

**Tests before:** 303 passed, 0 failed, 1 skipped · **Tests after:** 331 passed, 0 failed, 1 skipped (28 new) · **tsc:** clean.
**dist:** rebuilt from the working tree on 2026-09-27 (`grep -c nacapabilityabsent dist/types/ces-artifacts.types.js` = 1).

### FX-ST1 — MS-R11: accept Muster's all-met plan (DONE)

**Commit:** `6c8571c` · **Files:** `src/types/ces-artifacts.types.ts`, `tests/unit/AllMetMusterPlan.test.ts`,
`tests/fixtures/golden/muster-all-met.{manual-mission-plan,tenant-manifest,provenance}.json`

The Stamper-only `steps ≥ 1` refinement now applies only when the plan has no `control_directives[]` (legacy step
mode, where steps are the only thing to translate). A directive-mode plan with `steps: []` is valid. Golden fixture =
real output of Muster's `buildPlanArtifacts` (ces-muster `179260c`) for ces-tester's `ALL_MET_CASE` — the same input
ces-tester's X1 uses — generated read-only through ces-tester's `muster-plan-gen.cli.ts`; provenance recorded beside it.

| Check | Result | Evidence |
|---|---|---|
| Golden is the real all-met shape | PASS | "golden really is the all-met shape" — `steps: []`, 110 directives, only validate/manual |
| Shared + Stamper schemas accept | PASS | "ces-shared and Stamper schemas both accept it" |
| `PlanTranslator.translate` does not throw, 0 configuration tasks | PASS | "PlanTranslator.translate does not throw and yields 0 configuration tasks" (constructed as the CLI does) |
| Red before the fix | PASS | same file against HEAD `ces-artifacts.types.ts`: 4 of 6 fail with the min(1) error |
| Not loosened for step-mode plans | PASS | "a plan with NO directives and no steps is still rejected" |

**Answer to ces-tester `REQ-STAMPER-ALL-MET-PLAN-REJECTED`:** fixed at `6c8571c` (src); dist rebuilt. ces-tester can
drop `all-met` from `KNOWN_UPSTREAM_OPEN` and the `test.fails` marker, then close the REQ (its unblock condition).

### FX-ST2 — MS-R12: stale `dist/` (DONE)

**Commit:** `2932e92` · **Files:** `src/utils/distFreshness.ts`, `src/cli/index.ts`, `tests/unit/DistFreshness.test.ts`

`dist/` rebuilt (`npm run build`). Guard, two layers (`package.json` is another session's dirty file, so no
`prebuild`/`pretest` script was added — the start-up check is the runtime layer, the test is the gate layer):
- **Test:** `DistFreshness.test.ts` — built `normalizeStamperAction` maps `N-A-Capability-Absent` → `document-absence`
  and throws on an unknown value; every `src/**/*.ts` has a `dist` `.js` at least as new; checker unit tests on a temp tree.
- **CLI start-up:** the built CLI (`dist/cli/index.js`, the `stamper` bin) exits 3 with the stale file list when any src
  file is newer than its build output. `STAMPER_ALLOW_STALE_DIST=1` downgrades to a warning. Running from src (tsx) or a
  packaged install without `src/` is not checked.

| Check | Result | Evidence |
|---|---|---|
| `grep -c nacapabilityabsent dist/types/ces-artifacts.types.js` > 0 | PASS | 1 |
| Freshness test passes on a fresh build | PASS | 6/6 |
| Fails when src touched without rebuild (proved once) | PASS | `touch src/utils/retryWithBackoff.ts` → test fails "dist/ is stale … retryWithBackoff.ts (newer than dist)"; `node dist/cli/index.js --help` exit 3; with override exit 0; after `npm run build` exit 0 and 6/6 |

**Answer to ces-tester `REQ-STAMPER-DIST-STALE`:** dist rebuilt from src carrying MS-R2, MS-R1/R4/R9, T4 and this batch; the
freshness check keeps it from drifting. ces-tester can re-run `run-scenario scenarios/clean-tenant-mfa-baseline.json` and close.
**Side effect to know:** `npm test` in ces-stamper now goes red whenever any src file is edited without `npm run build`
(by design). The rebuilt dist also contains the other session's uncommitted `GuiServer.ts` edits (dist = working tree).

### FX-ST3 — results-manifest vocabulary (DONE)

**Commit:** `ab09507` · **Files:** `src/core/ExecutionResultsCollector.ts`, `src/server/routes/execute.routes.ts`,
`tests/unit/ExecutionResultsVocabulary.test.ts`

Mapped at the manifest boundary (`buildManifest`); internal words unchanged:

| Stamper word | Shared value |
|---|---|
| verdict `SAT`, `MET` | `sat` |
| verdict `NOT_SAT`, `NOT MET` | `not_sat` |
| verdict `PROVISIONAL` / `N/A` | `provisional` / `not_applicable` |
| directive `implement` | `automated` |
| directive `validate` | `validation` |
| directive `manual` | `manual_gate` |
| `automated`, `validation`, `nonstack`, `document-*`, `inherit-fedramp`, `eo-tooled`, `skip` | unchanged (already shared words) |

Every Stamper value has an honest shared equivalent — no HONEST-OPEN, no vocabulary REQ needed. Unknown words pass
through unchanged with a warning so the shared schema rejects them visibly. `execute.routes.ts` now records verdicts only
via `ResultVerdict` / `metVerdict()` (same strings as before).

| Check | Result | Evidence |
|---|---|---|
| Manifest from real execute-path values passes `ExecutionResultsManifestSchema.safeParse` | PASS | `it.each` over every `ResultVerdict` × every directive the execute path can record (literals parsed out of `execute.routes.ts` + every `_control_directives` value of two really-translated Muster plans + the shared plan enum) |
| Real translated plans | PASS | ces-muster fixture and all-met golden: 110 rows each through `buildManifestForPlan` → `success === true` |
| No bare verdict literal can bypass the mapping | PASS | source guard: no quoted verdict in any of the 14 `recordControlResult` calls; every `sprsValue` via `metVerdict()` |

Limit, stated plainly: the test drives the collector with the execute path's real *values* (parsed from the route source and
from really-translated plans), not by running the SSE execute route itself (no route harness — same gap as MS-R6).

### FX-ST4 — MS-R13: plan id mismatch (DONE)

**Commit:** `ab09507` · **Files:** `src/translators/PlanTranslator.ts`, `src/core/ExecutionResultsCollector.ts`,
`src/server/routes/execute.routes.ts`, `docs/requirements/REQ-ces-shared-execution-results-executable-plan-id.md`

`PlanTranslator` records `variables._source_plan_id = <Mission Plan plan_id>` (both translate paths). New
`ExecutionResultsCollector.buildManifestForPlan(runId, tenantSlug, plan)` emits `planId = <bare plan_id>` and
`executablePlanId = translated-<plan_id>`; both execute-route manifest sites use it. Plans translated before this change
fall back to stripping the `translated-` prefix. The state file name (`execution-results-<executable id>.json`) and
`runId` are unchanged. `buildManifest(runId, slug, planId, cesId)` keeps its signature (ces-muster's live-loop test calls
it; re-run green against this change).

| Check | Result | Evidence |
|---|---|---|
| Translate a Muster fixture → production builder → `planId === <Muster plan_id>` | PASS | "planId is the Muster plan_id; executablePlanId keeps the translated id" (ces-muster fixture + all-met golden) |
| Route uses the plan-aware builder | PASS | source guard: no `.buildManifest(` left in `execute.routes.ts`, ≥ 2 `.buildManifestForPlan(` |

**For ces-muster (FX-MU2 depends on this):** a real Stamper run now posts `planId` = the Manual Mission Plan `plan_id`, so
`POST /api/plan/results` matches. The executable id travels as `executablePlanId` (the shared schema strips it today — REQ
below). Muster's live-loop test passes a bare `planId` by hand; switching it to `buildManifestForPlan` on a translated plan
would cover the id path end to end.

### REQs

| REQ | Status | Notes |
|---|---|---|
| `REQ-ces-shared-execution-results-executable-plan-id.md` | OPEN (new, low) | make `executablePlanId` an optional contract field |
| ces-tester `REQ-STAMPER-ALL-MET-PLAN-REJECTED` | answered (owner closes) | fixed at `6c8571c` |
| ces-tester `REQ-STAMPER-DIST-STALE` | answered (owner closes) | rebuilt + guard at `2932e92` |
| `REQ-ces-shared-execution-results-vocabulary.md` | not filed | every value mapped honestly (FX-ST3) |

### Corrected overclaims

1. **T4 above says the `steps ≥ 1` refinement was kept and no legitimate plan was rejected.** It rejected Muster's real
   all-met plan (ces-tester X1). Now conditional on having no directives (FX-ST1).
2. **T3 / E6 above: "`ExecutionResultsManifestSchema.safeParse(buildManifest(...)).success === true`".** True only for the
   hand-picked `SAT/NOT_SAT/PROVISIONAL/N/A` inputs the test used. The real execute path also records `MET` / `NOT MET`
   and plan directives `implement` / `validate` / `manual`, which the shared schema rejected (strategy probe: 5/5 rows).
   Fixed in FX-ST3 with a test over the real values.
3. **09-26 Step 7 / MS-R9 "emit execution results per shared contract".** The manifest's `planId` was the executable id
   `translated-<plan_id>`, which Muster's ingest cannot match — a real run's results would 404. Fixed in FX-ST4.
4. **E2 above: "tsc + npm test clean on committed HEAD", read as runtime-proven.** The runnable `dist/` was the 09-09 build,
   so none of T1–T4 was in the code the `stamper` bin and ces-tester scenarios ran. Tests proved src only. Fixed in FX-ST2.

### Summary

| Step | Status | Commit | New tests |
|---|---|---|---|
| FX-ST1 (MS-R11) | DONE | `6c8571c` | 6 |
| FX-ST2 (MS-R12) | DONE | `2932e92` | 6 |
| FX-ST3 + FX-ST4 (MS-R13) | DONE | `ab09507` | 16 (one file) |

**HONEST-OPEN:** none new (MS-R6 dry-run route still HONEST-OPEN per F-2). **WAITING:** none. **Pushed:** nothing.

### Exit criteria

| # | Criterion | Met? |
|---|---|---|
| X-E1 | every step Done / HONEST-OPEN / WAITING | YES — all four Done |
| X-E2 | tsc + npm test clean on committed HEAD | YES — verified in a clean worktree at HEAD (see session log) |
| X-E3 | nothing from this work uncommitted | YES — instruction file, report, REQ, session log committed |
| X-E4 | this section | YES |
| X-E5 | nothing pushed | YES |

Legend: FX-STn = step ids in the FIX instruction file · X-En = its exit criteria · MS-Rn = Muster→Stamper recommendation n ·
T1–T4 / E1–E6 = the earlier 09-27 instruction file's steps / exit criteria · F-2 = founder decision (MS-R6 stays open) ·
golden = committed file of real upstream output.

### Fix batch follow-up: results 1.1.0 (FX-ST5)

- **Trigger:** ces-shared FX-SH3 (`82f39da`) bumped the execution-results contract to 1.1.0 (optional `executablePlanId`, `contractVersion` now `z.enum(['1.0.0','1.1.0'])`) and filed `ces-shared/docs/requirements/REQ-ces-stamper-execution-results-1-1-0-adoption.md` — 1 Stamper test red (`tests/directive-migration.contract.test.ts:337` pinned `'1.0.0'`).
- **Status:** Done — commit `b90602a`.
  - Collector already emitted `EXECUTION_RESULTS_CONTRACT_VERSION` and `executablePlanId` (`translated-<plan_id>`) next to the bare `planId` (FX-ST4); the local `& { executablePlanId?: string }` widening is dropped — the shared type now carries it.
  - Pinned test now asserts `contractVersion === EXECUTION_RESULTS_CONTRACT_VERSION` (and `!== '1.0.0'`), not weakened.
  - New test (`tests/unit/ExecutionResultsVocabulary.test.ts`): the production manifest, parsed by the shared 1.1.0 schema, retains `executablePlanId` and the bare Muster `planId`.
  - `REQ-ces-shared-execution-results-executable-plan-id.md` → CLOSED.
- **Gates:** `npx tsc --noEmit` clean; `npm run build` done (dist fresh); `npm test` 26 suites, 333 passed / 1 skipped. **Pushed:** nothing.

Legend: FX-ST5 = this follow-up step · FX-SH3 = ces-shared's contract-bump step · FX-ST4 = earlier Stamper plan-id step.

## 2026-09-27 final fixes

### FX-ST6 — CLI results manifest + Stamper→Muster delivery

- **Item 1 — REQ-STAMPER-CLI-NO-RESULTS-MANIFEST** (filed by ces-tester, `ces-tester/.worktrees/flow-through/docs/requirements/`): **Done** — commit `9a482aa`.
  - `stamper execute` and `stamper translate --execute` now build the manifest with the production builder (`ExecutionResultsCollector.buildManifestForPlan`, shared results contract 1.1.0) from the run's task states and write it to `<CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/execution-results-<executablePlanId>.json` — the same path the GUI route writes. The path is printed and recorded in the saved execution report (`resultsManifest`).
  - Task-state → record mapping uses the server's words: completed → SAT/`completed`, accomplished → SAT/`accomplished`, failed → NOT_SAT/`failed`, skipped → not recorded; directive = `_control_directives[cid] || 'automated'`. A control that any task failed stays NOT_SAT.
  - Tenant slug: new `execute --tenant <slug>` > `plan.ces.tenantSlug` > `variables.tenant_slug` > `TENANT_SLUG` env > `dev`. ces-tester's launcher passes no `--tenant`; its translate sets the plan tenant only if it passes `--tenant` to translate — add `--tenant <slug>` to the execute call to be explicit.
  - The manifest is written even when the run fails (before the exit-code decision).
  - The REQ file lives in ces-tester (write boundary): ces-tester should close it and can now run the loop inside `run-scenario`.
- **Item 2 — Stamper delivers results to Muster:** **Done** — same commit.
  - New shared module `src/core/ExecutionResultsPublisher.ts`, used by the GUI route (replaces its inline write) and both CLI paths: canonical write, then `POST <CES_MUSTER_API_URL>/api/plan/results` with body `{ tenant_slug, manifest }` and `Authorization: Bearer <CES_MUSTER_API_TOKEN>` (contract read from `ces-muster/muster-api/src/routes/plan.ts` + `middleware/auth.ts`, read-only).
  - Env: `CES_MUSTER_API_URL` (origin; trailing `/` or `/api` tolerated), `CES_MUSTER_API_TOKEN` (JWT Muster issued), `CES_MUSTER_ALLOW_REMOTE=1` (opt-in for non-localhost), `CES_MUSTER_TIMEOUT_MS` (default 10000). No secrets in code.
  - Delivery never throws or fails the run: outcome (`delivered` / `skipped` / `refused` / `failed`) is logged, written to `execution-results-<id>.delivery.json` beside the manifest, sent as SSE event `execution_results_delivery` (GUI) and added to the CLI report (plus a recommendation on failure). The manifest stays on disk for retry.
  - Not configured → `skipped` with an info log. Non-localhost (hostname not localhost / 127.0.0.1 / ::1) → `refused` unless opted in. Tenant slug not matching Muster's slug rule → `refused`.
  - **Decision:** dry runs (CLI `--dry-run`/`--dev`/`DRY_RUN`, GUI dev mode / `dryrun_log` / tenant `dev`) are **never delivered** (`skipped: dry_run`) — their SAT verdicts were not earned and would mark Muster directives met falsely. The manifest is still written.
- **Tests** (`tests/unit/ExecutionResultsPublisher.test.ts`, production code only): spawns the real CLI (`npx tsx src/cli/index.ts execute --dev --mode auto`, the mocked dry-run adapter path) → manifest at the canonical path passes `ExecutionResultsManifestSchema`; dry-run CLI with Muster configured → no request, `skipped`; delivery to a local `http` server → path `/api/plan/results`, Bearer header, JSON body `{tenant_slug, manifest}`; HTTP 500 and connection refused → `failed`, recorded, no throw, manifest on disk; non-localhost refused without opt-in (no network call), allowed with opt-in; no URL → skipped. The FX-ST3 vocabulary source guard now also covers the publisher.
- **Gates:** `npx tsc --noEmit` clean; `npm run build` (dist fresh); `npm test` 27 suites, 343 passed / 1 skipped. **Pushed:** nothing.
- **Open (not in this scope):** no live non-dry-run CLI → Muster run was done (stacksim + a running muster-api + a Muster-issued token needed); ces-tester owns that end-to-end proof. `runId` is still `plan.plan_id` on both paths (matches the existing GUI behaviour).

Legend: FX-ST6 = this fix step · FX-ST3 = earlier results-vocabulary step · MS-R9 = Muster recommendation 9 (Stamper results → Muster directive status) · SSE = server-sent events.

## 2026-09-27 wave 4

Instruction file: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-W4.md`. Code commit `07a2301` (all three steps; `cli/index.ts`
and `PowerShellAdapter.ts` carry changes for more than one step, so they were not split). Gate W4-MU1 met:
ces-muster `299cac2` (ces-muster is its own git repo, not ces-mono).

| Step | Status | Tests (new, production code) | REQs | Level before → after |
|---|---|---|---|---|
| W4-ST1 MS-R6 dry-run execute route | **Done** | `ExecuteRouteDryRun.test.ts` (2) | — | ST-13 Execute: Implemented (=), route tests 0 → 2 (on stacksim) |
| W4-ST2 consume Muster Infra Manifest | **HONEST-OPEN** (infra consumption done; criterion not met) | `MusterInfraManifestTranslate.test.ts` (4, incl. 1 `it.failing`) | `REQ-tenant-stacksim-sim-tenant-secret-variables.md` | ST-12 Translate: Implemented (=); the Infra Manifest is now merged by the translator for GUI and CLI (was a GUI-only post-merge; the CLI read only the model) |
| W4-ST3 rollback | **Done (scoped)** | `RunRollbackStacksim.test.ts` (1), `RollbackGuard.test.ts` (12) | — | Rollback: Stub → Implemented, scoped (Graph PATCH, sim-only) |
| W4-ST3 CLI resume/report | **Done** | `CliResumeReport.test.ts` (3) | — | ST-17: Stub → Implemented |
| W4-ST3 Bicep | **HONEST-OPEN** | — | `REQ-tenant-stacksim-bicep-deployment.md` | Stub (=) |

### W4-ST1 — dry-run `GET /api/execute` against stacksim
- `tests/helpers/stacksimHarness.ts` starts tenant-stacksim in process (its `dist` `startServe` + `SeedEngine`, temp tenant
  root; nothing is written into tenant-stacksim) and shadows PowerShell onto it (`PSModulePath`, `STACKSIM_SERVER_URL`).
- The test mounts the production `createExecuteRouter`, translates ces-muster's committed plan fixture with the production
  `PlanTranslator`, and streams a dry run for the sim tenant slug. It asserts: no `error` frame; the stream ends with `done`;
  no `connection_log` (no session opened); every failure is a document-renderable adequacy check (`renderable-*`, "Signal
  not adequate": real signals a fresh tenant lacks); the results manifest is written under the temp root with delivery
  `skipped`; the sim ledger records **no traffic at all**.
- **Proof against a broken route:** forcing the engine's `dryRun: false` makes the test fail in 20 ms (config validation
  error frame). File restored, diff empty.
- **Gotcha (disclosed):** a first proof attempt broke `isDevMode` instead. With a non-dev slug the route took the *live*
  path inside jest: it resolved `~/.ces/tenants/sim/sim-m365-azure.json`, and ces-shared's `session-host.ps1` spawned with
  the **real** Microsoft modules, because jest gives each test file a sandboxed `process.env` copy that never reaches
  ces-shared's spawn. The record's endpoints are localhost and its certificate thumbprint is fake (the lookup fails
  locally), but no-egress cannot be proven. The processes were killed after about 5 minutes. **Rule:** route tests must
  never take the live path in jest. The adapter now passes `{ env: process.env }` to its own spawn (identical in
  production). SessionManager (ces-shared) is not covered.

### W4-ST2 — Muster plan + Infra Manifest → translate → stacksim dry run
- `PlanTranslator.translate` now honours `options.infraManifest`, which it used to ignore:
  - The manifest is validated with the shared `InfraManifestSchema` (canonical `infrastructure` key or the deprecated
    alias; variable aliases normalized).
  - Its `infrastructure_model` scopes the registry when none was set.
  - Its `stamper_variable_map` is gap-filled at the lowest precedence (first write wins, as the GUI's old post-merge did).
  - Generated placeholders (e.g. the golden's `subscriptionId: sub_…`) are skipped with an `INFRA_MANIFEST:` warning.
  - `variables._infra_manifest_source` records the source.
- CLI `translate` passes the Infra Manifest it finds next to the Tenant Manifest. The GUI route passes it too, and its
  duplicate post-merge block is gone (one implementation). An invalid manifest is still a 400 in the GUI; the translator
  throws.
- New translate warnings come from `ExecutionContext.validateManifestContract`, which was dead code until now:
  `UNRESOLVED_VARIABLE:` (required, no source) and `UNRESOLVED_RUNTIME_VARIABLE:` (no capturing command in the plan).
- Execute route: the dry-run command display now also resolves with `VARIABLE_DEFAULTS`, as the live ExecutionContext does.
- `VARIABLE_MAPPING` gains `approverUPN ← approver_upn`.
- Test inputs, none hand-supplied:
  - ces-muster goldens read from **committed** `main` via `git show` (the Muster working tree had an in-flight edit).
  - The sim tenant record generated by tenant-stacksim's own `buildSimTenantConfig`, registered as `kind:'sim'` in a temp
    `CES_TENANT_ROOT`.
  - The real CLI translates; the production route dry-runs the result on stacksim.
- **Result:** `eoAppDisplayName` lands (only the Infra Manifest has it). The dry run is clean: no error, zero ledger
  traffic, and no `{placeholder}` left for any required variable outside the residual. **Residual `UNRESOLVED_VARIABLE`
  = exactly `approverUPN`, `initialPassword`, `touFileBase64`**: no Muster artifact, sim record or Stamper default produces
  them. Runtime variables `baselineTemplateId` and `breakGlassUserId` are reported but are not part of the criterion.
- **HONEST-OPEN:** the criterion "0 unresolved-variable warnings" is not met. An `it.failing` test holds the strict check
  and turns red when `REQ-tenant-stacksim-sim-tenant-secret-variables` lands; then flip it to `it`.
- **Proof:** with the CLI's Infra Manifest hand-off removed, 2 of 4 tests fail (`_infra_manifest_source` undefined; the
  residual gains `eoAppDisplayName`).
  The discriminating check is the translate-level `UNRESOLVED_VARIABLE` warning set. The dry-run placeholder scan only
  covers displayed set-commands (evidence-only displays are truncated to 200 characters), and it stayed green in this
  proof.
- Open: the rollback restore body drops `@odata.type`. Real Graph needs it on polymorphic
  `authenticationMethodConfigurations` PATCHes; the sim does not. The body must carry the resource's `@odata.type` from the
  pre-state before rollback is ever allowed off-sim.
- Observation (no REQ): Muster's golden Infra Manifest carries a generated placeholder for `subscriptionId`.

### W4-ST3 — rollback, resume, report, Bicep
- **Rollback (scoped):**
  - When a sub-command's SET runs, `PowerShellAdapter` derives an inverse from the pre-SET and post-SET GETs it already
    captures (`src/rollback/InverseOps.ts`).
  - `TaskRunner` records the op in the execution state (`applied_ops`, failed tasks included) with a sequence number.
  - `StamperEngine.rollback()` / `RollbackHandler.rollbackAppliedOps()` reverse every unreversed op newest first, mark
    each op reversed (or record its error) and record `state.rollback`. A second pass only retries failures.
  - New CLI command: `stamper rollback <plan>`.
  - **Covered:** `Invoke-MgGraphRequest -Method PATCH` whose GET returns JSON. The inverse PATCHes back the pre-run values
    of the properties that changed (OData annotations excluded). In the registry that is 3 of 5 PATCH entries (Fido2,
    MicrosoftAuthenticator, x509Certificate).
  - **Uncovered, reported as manual guidance and never skipped:** PATCH with a scalar GET (`AC.L2-3.1.20.spo-sharing`,
    `IA.L2-3.5.9.tap-config`), `New-*` (30), `Set-*` (5), Graph POST (15), `Update-`/`Enable-`/`Join-`, and legacy
    single-command tasks.
  - **Sim-only guard:** rollback executes only when `STACKSIM_SERVER_URL` is on loopback. Otherwise it refuses and
    executes nothing.
  - **Proof on stacksim:** a real (non-dry-run) engine run of verbatim registry sub-commands. A fault on the TAP URI fails
    the p0 task mid-run. The covered resources go from `enabled` back to the pre-run snapshot after rollback (read through
    the Graph facade). SharePoint sharing and the faulted TAP SET are reported as manual. `engine.rollback()` does not
    exist in the old code.
- **Resume:**
  - `stamper resume <plan>` loads the plan and its persisted state (same `CES_PIPELINE_ROOT` and tenant) and runs
    `execute(true)`.
  - On resume, `walkExecutionGraph` never re-runs completed or accomplished tasks, whatever their idempotency, and leaves
    their state untouched. Safe tasks used to re-run.
  - Resume refuses when there is no state or the plan already completed.
  - Proof: with that guard removed the test fails (0 of 3 tasks reported as "not re-run").
- **Report:** `stamper report <executable-plan-id> --tenant <slug> [--format json]` prints the results manifest summary:
  plan, run, tenant, completedAt, contract, and totals by verdict and by directive. It exits 1 when no manifest exists.
- **Bicep:** HONEST-OPEN. There are 0 bicep entries in either registry, no translator path emits one, and the sim has no
  ARM deployment resolver, so nothing could be proven sim-only.
- AWS: out of scope (founder).

### Gates and exit criteria
- Gates ran on the working tree and on a clean HEAD export (`git archive HEAD ces-stamper` plus junctions for
  `node_modules`, `ces-shared`, `ces-muster`, `tenant-stacksim`, `ces-tenant`): `npx tsc --noEmit` clean,
  `npm run build` ok, `npm test` 32 suites, 365 passed / 1 skipped.
- New external prerequisites for `npm test`: `tenant-stacksim/dist` built, `powershell.exe` available, and ces-muster
  `main` readable with git.

| Exit | Criterion | Met |
|---|---|---|
| W4-E1 | every step Done / HONEST-OPEN+REQ / WAITING | YES: ST1 Done; ST2 HONEST-OPEN + REQ; ST3 Done (rollback scoped, resume, report) with Bicep HONEST-OPEN + REQ |
| W4-E2 | tsc + test + build clean on HEAD | YES |
| W4-E3 | nothing uncommitted | YES (the docs commit follows the code commit) |
| W4-E4 | this section | YES |
| W4-E5 | nothing pushed | YES |

Legend: W4-STn / W4-En = step / exit ids in the W4 instruction file · W4-MU1 = ces-muster's Infra Manifest step (the gate) ·
MS-Rn = Muster→Stamper recommendation n · ST-nn = Stamper functionality id (module-status) · HONEST-OPEN = can't pass,
blocker + REQ recorded · stacksim = local simulated Microsoft tenant (tenant-stacksim) · TAP = Temporary Access Pass ·
p0 = critical task priority (abort on failure) · OData = the Graph API's metadata annotations (`@odata.*`).

### W4-ST4 follow-up — EO render directive shape + Muster golden re-key (DONE)
- **Trigger:** ces-eo `docs/requirements/REQ-ces-stamper-eo-render-directive-shape.md` (W4-EO3).
- **Two breaks, not one.** (1) Stamper wrote `code: '<control id>'`; EO's `RenderDirectiveSchema`
  (`ces-eo/src/shared/types/render.types.ts`) needs `directive_code` (an `EO_RENDER_*` code). (2) Stamper nested the block
  under `metadata`; EO's `StamperEvidenceLoader` reads `eo_render_directive` from the file's **top level**. Fixing only the
  field name would still start zero renders.
- **Fix:** new `src/evidence/eoRenderDirective.ts`: `EO_RENDER_DIRECTIVES` (the seven controls → the REQ's codes, input
  sources unchanged) and `buildDocumentRenderableEvidence()`, which the execute route now calls. `StructuredEvidenceSchema`
  carries `eo_render_directive` at the top level (`EoRenderDirectiveSchema`, `directive_code`). `code` is dropped: the only
  other reference is ces-ao's type mirror (`ces-ao/src/types/StamperTypes.ts`, `metadata.eo_render_directive.code`), which has
  no reader. It is now stale; this is a note for ces-ao, not a blocker. No `depends_on` is emitted: EO hard-codes POA&M before SSP.
- **Test:** `tests/unit/EoRenderDirectiveContract.test.ts` runs Stamper's production builder + `writeAndUploadEvidence` into
  a temp `CES_PIPELINE_ROOT`. It then runs **EO's production** `StamperEvidenceLoader` and `RenderOrchestrator`, imported
  read-only from `../ces-eo/src`, not a copy of the shape. All 7 directives parse, and all 7 emit `render_start` with no
  "No template registered" or version-mismatch failure. EO's `DIRECTIVE_CODES` covers every emitted code.
  Proof: with the builder reverted to the old shape (`code`, under `metadata`), 2 of 3 tests fail (0 directives loaded, 0 renders).
- **Level:** document-renderable → EO hand-off went from "broken (no render from real Stamper output)" to "contract-tested
  against EO's production code". It is not a shared ces-shared contract yet. EO's REQ suggests one; that is optional follow-up.
- **Muster golden re-key** (ces-muster `REQ-ces-stamper-infra-golden-canonical-key.md`, commit `5dad046`): the W4-ST2
  translate test already passed against the committed golden (it reads `main` via `git show`). The
  `infrastructure ?? infrastructure_manifest` fallback is tightened to `infrastructure`, and the deprecated key is asserted
  absent, so a regression can't hide.
- **Gates:** `npx tsc --noEmit` clean, `npm run build` ok, `npm test` 33 suites, 368 passed / 1 skipped.
- Legend: W4-ST4 = this follow-up item · W4-EO3 = ces-eo's wave-4 step that filed the REQ · POA&M = Plan of Action and
  Milestones · SSP = System Security Plan.

## 2026-09-27 fix round 2

Driven by `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX2.md` (post-Wave-4 re-assessment; evidence
`ces-strategy/docs/context/system-assessment/REVIEW-dataplane.md` P0-1 and `REVIEW-stamper.md`). Every cited
`file:line` was re-verified against current code first. Nothing pushed.

| Step | Status | Commit | Tests (production code, proven red first) |
|---|---|---|---|
| FX2-ST1 canonical SPRS weights | DONE | `2e9a47c` | `tests/unit/CanonicalSprsWeights.test.ts` (5) |
| FX2-ST2 plan intent is not SAT | DONE | `8c5e812` | `tests/unit/AssessPlanIntent.test.ts` (6) |
| FX2-ST3 bad control doesn't abort translate | DONE | `f92a80f` | `tests/unit/TranslateBadControl.test.ts` (1) |

### FX2-ST1 — canonical SPRS weights (DONE, `2e9a47c`)
- **Drift was larger than reported:** 94 of 110 entries in `src/registry/sprs-weights.json` differed from canonical
  `ces-shared/src/data/sprs-weights.json` (weight or `poam_allowed`), not just 3.2.1 / 3.1.20 / 3.13.13.
- **Fix:** new `src/core/sharedData.ts` (`resolveSharedDataPath`, the `createRequire(...).resolve('ces-shared/data/*')`
  pattern EO uses). `loadSprsWeights()` reads the canonical file, checks `schema_version` `sprs-weights/2.x`, and requires a
  boolean `poam_allowed` (no silent `true` default). The control reference was repointed too (it was identical today, so
  this was cheap): analyzer, translator, execute / evidence / utility routes, the GUI (`/api/cmmc-controls` instead of the
  static `/src/registry` copy) and the dev scripts. Both local copies are deleted. `computeSprsByCategory()` is now the one
  production SPRS roll-up that the Assess route sends.
- **Proof:** 3 of 4 tests failed on the old code (3.2.1 = 1 not 5, file present). Now 5 pass. The score test runs the
  production analyzer and roll-up, and 3.2.1 / 3.1.20 / 3.13.13 deduct 5 / 1 / 1.
- **Corrected overclaim:** `docs/EO_SCOPE_EXCLUSION_HANDOFF.md`, `STAMPER_SCOPE_HANDOFF.md` and `SCOPE_HANDLING_SPEC.md`
  named Stamper's own `sprs-weights.json` as the source. They now point to ces-shared.

### FX2-ST2 — Assess must not report plan intent as satisfied (DONE, `8c5e812`)
- **Before:** in directive mode, `implement` / `validate` (and any control missing from the directive list) were pushed to
  `satisfied` ("Automated evidence collection") without looking at discovery. A plan of 110 `implement` directives scored 110 SAT.
- **Now:** `classifyPlannedControl()` decides from what was read. **SAT** only when every matching registry entry was read
  from the tenant (`exists`), or has a recorded real post-state on disk (SAT evidence), with no NOT_SAT. An **empty read
  (`missing`) or NOT_SAT** is `wont_be_satisfied`. Anything unread is the new **`not_verified`** status, which is never SAT.
  **Dry-run records are never SAT:** the analyzer ignores them and the route's `hasValidEvidence` rejects them
  (`isDryRunRecord`).
- **SPRS:** `not_satisfied` now deducts `not_verified` and `will_be_satisfied` controls as well as NOT SAT. Only a proven
  control earns its points. `not_verified` is also reported on its own. The Assess payload carries `notVerified` /
  `notVerifiedControls`. The GUI counts them in the amber row, now labelled "Not Satisfied / Not Verified", and the control
  grid shows status `NOT_VERIFIED`. There is no CLI Assess surface.
- **Proof:** 6 of 6 failed on the old code (e.g. 109 SAT from an almost empty directive list). Now 6 pass: all-planned →
  0 SAT (implement and validate); a real read → SAT for that control; a recorded post-state → SAT, a dry-run record → not
  verified; missing / NOT_SAT → NOT SAT; planned-only deducts the canonical weight sum.
- **Corrected overclaims:** `FUNCTIONAL_DESCRIPTION.md` (analyzer categories), and the `docs/EO_SCOPE_EXCLUSION_HANDOFF.md`
  mapping table (added `not_verified → not_met`; earlier builds reported these as `satisfied`). Behaviour change: Assess
  SPRS numbers drop for any plan whose configuration controls were not read.

### FX2-ST3 — one bad control must not abort translate (DONE, `f92a80f`)
- **Real failure point:** before `buildControlDirectives` is reached, the shared `CESManualMissionPlanSchema` rejected the
  whole plan: `controls[].stamper_action` is a strict enum. `normalizeStamperAction` also threw at three more call sites.
- **Fix:** `quarantineBadControls()` runs before schema validation. A control with a missing / unknown `stamper_action`
  (or one failing the shared `ControlDisposition` contract) is removed from the plan and from `mpControls`, recorded as
  `ControlIssue`, and translated as a **manual-review directive** (manual task + `manual` in `_control_directives`). The
  translate result carries `CONTROL_ISSUE:` warnings, `controlIssues` (also in the translate route's JSON) and
  `plan.variables._control_issues`. Assess's MP classification falls back instead of throwing.
- **Proof:** on the old code the test threw "Mission plan validation failed". Now it uses ces-muster's committed golden
  (`git show main:`), with one control's action removed and one set to `Teleport-Compliance`. Translate succeeds, both
  controls are flagged (warning + issue row + `manual` directive + manual task), and the other 108 directives equal the
  unmodified run.

### Gates (HEAD)
`npx tsc --noEmit` clean · `npm run build` ok · `npm test` 36 suites, 380 passed / 1 skipped (full suite).

### Open items / founder decisions (no REQ needed: all are Stamper-internal)
- **Other plan-declared SATs:** in directive mode, `document-absence`, `document-prohibition`, `document-renderable` and
  `inherit-fedramp` are still counted satisfied from the directive alone. These are scope / inheritance determinations,
  not configuration intent, so FX2-ST2 left them alone. Should prohibition and renderable require a tenant read / EO render
  before SAT?
- **Plan-less / plan-aware Assess:** a control is SAT when *some* entries were read and none were missing
  (`checkedCount > 0`), and the route records `manual_only` entries without a `get_command` as `exists`. Tightening this
  changes the plan-less Assess numbers the GUI shows, so it is an observation, not changed here.
- **No route-level Assess test:** `/api/assess` takes the live session path, which tests must never take. Coverage is at
  the production analyzer + roll-up level.

| Exit | Criterion | Met |
|---|---|---|
| X-E1 | every step Done (red → green on production code) or HONEST-OPEN + REQ | YES: ST1, ST2, ST3 Done |
| X-E2 | tsc + test + build clean on the committed HEAD | YES |
| X-E3 | nothing from this work uncommitted | YES (docs commit follows the code commits) |
| X-E4 | this section | YES |
| X-E5 | nothing pushed | YES |

Legend: FX2-STn / X-En = step / exit ids in the FIX2 instruction file · SAT / NOT_SAT = satisfied / not-satisfied
verdict · SPRS = Supplier Performance Risk System score · canonical = the ces-shared copy of a reference data file ·
MP = Mission Plan · EO = EvidenceOps · HONEST-OPEN = can't pass, blocker + REQ recorded.

## 2026-09-27 feature completion (FC-ST)

Source: `../ces-strategy/docs/context/feature-completion/{PLAN.md, VERIFY-stamper.md}` (Wave FC-1). Scope for this
session: ST-11 only (ST-16, ST-18 are `Not in scope` per the FC-ST instruction file — founder decisions pending).

### ST-11 — gap-remediation plan reachable from the GUI (DONE, `311bc82`)
- **Before:** `GET /api/compute-gaps` (`src/server/routes/gaps.routes.ts:24`) and the real `GapAnalyzer`
  (`src/core/GapAnalyzer.ts`) were wired into `GuiServer.ts` and worked end-to-end from cached assess state, but
  nothing in the operator GUI ever called the endpoint (`grep -rn "compute-gaps" public/index.html` had no hits) and
  there were 0 tests for the route or the wiring. Rating: **Partial** (real backend, no UI caller, no tests).
- **After:** a "Compute Gaps" button in the Assess card (`public/index.html`) calls the real endpoint and renders
  `plan.gap_controls` — a priority-colored per-control list with per-entry gap status, plus a by-priority /
  manual-vs-automated summary strip. Rating: **Implemented**.
- **Integrity rule kept:** the empty-state text says "no gap entries in the cached assess state" rather than "all
  controls satisfied" — an empty `gap_controls` array is not a SAT claim (planned ≠ satisfied).
- **Tests (all calling production code, fail-first proven):**
  - `tests/unit/GapsUiBehavior.test.ts` — extracts the actual Compute Gaps script out of `index.html`, runs it via
    `new Function` with a real Node `http` fetch shim against a real `createGapsRouter` (real `GapAnalyzer`, real
    registry). This is the acceptance test: the UI code drives the real handler and renders its real response.
    Proven red first by `git stash push -- public/index.html`, confirming both cases failed
    ("Compute Gaps script block not found"), then `git stash pop`.
  - `tests/unit/GapsUiWiring.test.ts` — cheap syntactic grep backstop (button, function, render call, container all
    present in `index.html`).
  - `tests/unit/GapsRoute.test.ts` — supertest-style route coverage: 400 (missing tenant), 404 (no cached assess
    state), 400 (assess state missing `discoveryResults`), and a 200 that asserts `plan.summary` shape and that the
    plan was actually persisted to disk via the real `writeJsonArtifact` (`fs.existsSync(body.saved_to)`).
- **Gates:** `npx tsc --noEmit` clean · `npm run build` clean (no dist drift) · new tests: 3 suites, 10/10 passed.
- **Commit:** `311bc82`.

### ST-16, ST-18 — not in scope this session
Founder decisions pending per `VERIFY-stamper.md` (EC auto-start dead-code question; AWS Phase 0 Q1/Q2). Not
touched, per the FC-ST instruction file's "Not in scope" list.

### X-E2 — HONEST-OPEN: unrelated full-suite failure (not caused by this work)
`npm test` full suite: **38 suites passed, 1 failed** (`tests/unit/MusterInfraManifestTranslate.test.ts`) — 388
passed, 2 failed, 1 skipped, 391 total. The 2 failures are in a test this session never touched and that imports
nothing this session changed (`PlanTranslator`, `execute.routes.ts`, stacksim harness — none edited here).
- **Root cause (confirmed):** `tests/helpers/stacksimHarness.ts` runs `tenant-stacksim` from its **working-tree**
  `dist/` (`STACKSIM_ROOT/dist/src/...`), not a pinned/committed version. `git -C ../tenant-stacksim status --short`
  shows ~25 modified files uncommitted in flight (`src/config/SimTenantConfig.ts`, `src/resolvers/ResolverTable.ts`,
  `src/profiles/ProfileLoader.ts`, etc.) — an active concurrent SIMFIX session. `git -C ../tenant-stacksim log -3`
  shows no new commit; the drift is from that session's **uncommitted** working tree, picked up live by any test run
  in this repo while it's in flight.
- **What flipped:** the test's own header documents its `it.failing` "turns red once
  REQ-tenant-stacksim-sim-tenant-secret-variables lands" — i.e. once something starts producing `approverUPN`,
  `initialPassword`, `touFileBase64`. That's exactly what happened: the hard-coded `RESIDUAL` assertion now gets
  `[]` instead of the three names, and the paired `it.failing` "now passes" (which itself fails, since `it.failing`
  requires the test to still fail). This is very likely PLAN.md §3's Wave FC-2 Stamper follow-up ("MS-5 values flow
  into the executable plan") arriving early and uncommitted, from a parallel session, not a regression from ST-11.
- **Why not fixed here:** flipping this test (dropping `.failing`, asserting resolved values) against an
  **uncommitted, in-flight** dependency would assert against a moving target and could go stale the moment the other
  session commits or rebases. Ground rule 5 says never weaken an assertion to paper over this; the honest move is to
  flag it, not silently adapt the test to transient state.
- **HONEST-OPEN:** X-E2 is not fully green on `main` at the time of this commit, but the failure is external to this
  session's diff. Evidence: `../tenant-stacksim` `git status --short` (uncommitted), `../tenant-stacksim` `git log -3
  --oneline` (no relevant new commit), and the test's own file header. **REQ:** none filed against ces-stamper or
  ces-muster — this is a orchestrator-sequencing item: re-run `MusterInfraManifestTranslate.test.ts` once the SIMFIX
  session commits, and flip the tripwire (drop `.failing`, assert the three vars resolve in the written executable
  plan) as ces-stamper's half of MS-5 (PLAN.md Wave FC-2), in its own small commit.
- This session's own gates (tsc, build, and every file this session touched or added) are clean; only this
  pre-existing/concurrent test is red.

| Exit | Criterion | Met |
|---|---|---|
| X-E1 | ST-11 Done (fail-first, calls production code, passes); ST-16/ST-18 correctly out of scope | YES |
| X-E2 | tsc + test + build clean on the committed HEAD (full suite) | **HONEST-OPEN** — 1 unrelated pre-existing suite red (see above); this session's own tests/tsc/build are clean |
| X-E3 | nothing from this work uncommitted | YES (this docs commit + session log follow the code commit) |
| X-E4 | this section | YES |
| X-E5 | nothing pushed | YES |

Legend: FC-ST = this session's id in the feature-completion plan · ST-nn = Stamper feature ids from the workbook ·
X-En = exit criteria in the FC-ST instruction file · MS-5 = a Muster→Stamper hand-off id (Infra Manifest secret
variables) · SIMFIX = the tenant-stacksim sim-tenant fix another parallel session is running · SAT = satisfied
verdict · HONEST-OPEN = blocked, reason recorded (no REQ needed here — it's a sequencing note, not a cross-module
defect) · REQ = requirement filed against another module.

## 2026-09-28 feature completion (FC-ST-2)

Resolves the X-E2 HONEST-OPEN left by the 2026-09-27 session above: the "SIMFIX" session it flagged as in-flight,
uncommitted work has since landed on `tenant-stacksim` main as `ebcaa2a` (docs commit `58903d5` replies
`REQ-tenant-stacksim-sim-tenant-secret-variables` **Done**), so the moving target it warned against re-flipping the
tripwire against is now a fixed, committed one.

### MS-5 — the three Infra Manifest values now come from the sim — DONE (test-only; no production code changed)

**Before:** `tests/unit/MusterInfraManifestTranslate.test.ts` carried a hard-coded `RESIDUAL` assertion
(`approverUPN`, `initialPassword`, `touFileBase64` expected unresolved) paired with an `it.failing` strict criterion
— both had already flipped (residual now `[]`, `it.failing` "passing" = itself a failure) the moment
`tenant-stacksim` committed `ebcaa2a`, per last session's HONEST-OPEN.

**Investigation:** `src/shared/variable-map.ts` (`VARIABLE_MAPPING`) and `src/translators/PlanTranslator.ts:655-661`
already gap-fill `plan.variables` from `clientConfig.resources` for `approverUPN`←`approver_upn`,
`initialPassword`←`initial_password`, `touFileBase64`←`tou_file_base64` — this plumbing was built in the original
W4-ST2 work and needed no change. The only thing that changed is `tenant-stacksim`'s `buildSimTenantConfig()` now
emitting those three `resources` keys (confirmed: `../tenant-stacksim/dist/src/config/SimTenantConfig.js` already
built with them). So MS-5 was a test-only fix: turn the tripwire into a real assertion.

**What changed** (`tests/unit/MusterInfraManifestTranslate.test.ts`, commit `8adecea`):
- Dropped the stale `RESIDUAL` array / `it.failing` pair. Added a real `it` asserting
  `plan.variables.{approverUPN,initialPassword,touFileBase64}` equal the sim record's own
  `resources.{approver_upn,initial_password,tou_file_base64}` values (not hard-coded literals, so it tracks
  `tenant-stacksim` rather than re-diverging from it), plus the strict "0 unresolved-variable warnings" test as a
  plain `it` (was `it.failing`).
- Discovered `breakGlassUserId` is also now sim-supplied (same `tenant-stacksim` batch, `resources.break_glass_user_id`
  — not one of MS-5's three); updated the runtime-unresolved assertion from `['baselineTemplateId', 'breakGlassUserId']`
  to `['baselineTemplateId']` to match reality rather than leave a stale expectation.
- Added a secrets test per the instruction file's ground rule ("the password is never logged or written in plain
  text in evidence"): calls the real `buildStructuredEvidence()` with the real registry `set_command` template (read
  off the live dry run's own `sub_command` SSE event, not hand-typed) and the real resolved `plan.variables`
  (which does carry the live sim password), and asserts the persisted evidence record's `commandExecuted` stays on
  the unresolved `{initialPassword}` template — confirming the password only ever lives in plan/tenant variables
  (where it must, to be usable), never in a written compliance evidence file.
- **Fail-first proof (both new tests), evidence not left in the tree:**
  1. Temporarily rewrote the three `VARIABLE_MAPPING` entries to `'REMOVED_FOR_PROOF'` → all three
     MS-5-dependent tests (the new one, the flipped criterion, and the pre-existing "runs clean" dry-run test) went
     red; reverted with `git checkout -- src/shared/variable-map.ts`.
  2. Temporarily made `structuredEvidence.ts`'s `commandExecuted` resolve `{initialPassword}` against `variables`
     before persisting → the new secrets test went red; reverted with `git checkout -- src/utils/structuredEvidence.ts`.
  Both reverts verified clean (`git status --short` / grep for the proof markers) before the real commit.
- Investigated but did **not** change: the dry run's `sub_command` SSE event does carry the resolved password in its
  `command` field for operator-UI display (`execute.routes.ts:1408-1417`, pre-existing, commented as deliberate — "as
  the live ExecutionContext does"). That is not a compliance evidence file and is out of MS-5's scope; noted here for
  visibility, no REQ filed (not a defect, a pre-existing display-path design choice this session didn't touch).

**Tests:** `MusterInfraManifestTranslate.test.ts` — 5/5 passed (was 2 failed/2 passed/4 total). Full suite: 39 suites
passed, 391 passed, 1 skipped, 392 total (was 38 passed/1 failed, 388 passed/2 failed/1 skipped/391 total).

**Gates:** `npx tsc --noEmit` clean · `npm run build` clean (no dist drift) · `npm test` full suite green.

**Commit:** `8adecea` (test file + this session's instruction file).

### HONEST-OPEN / REQ

None. MS-5 is fully Done on the committed sim; no cross-module REQ needed (the producer-side REQ was already
answered "Done" by `tenant-stacksim`). ST-16 and ST-18 remain untouched, per `VERIFY-stamper.md` and founder
decisions — out of scope for this instruction file (MS-5 only).

| Exit | Criterion | Met |
|---|---|---|
| X-E1 | MS-5 Done (fail-first tests, call production code, pass) | YES |
| X-E2 | `npx tsc --noEmit` + `npm run build` + `npm test` clean on the committed HEAD (full suite) | YES |
| X-E3 | nothing from this work uncommitted (this file + session log included) | YES (this docs commit follows the code commit) |
| X-E4 | this section | YES |
| X-E5 | nothing pushed | YES |

Legend: FC-ST-2 = this session's id · MS-5 = the Muster→Stamper hand-off id this session closes (Infra Manifest
secret variables: approverUPN/initialPassword/touFileBase64) · X-En = exit criteria in the FC-ST-2 instruction file ·
SIMFIX = the tenant-stacksim sim-tenant fix session referenced by the 2026-09-27 section above (now landed as
`ebcaa2a`) · HONEST-OPEN = blocked, reason recorded · REQ = requirement filed against another module.

## 2026-09-28 feature completion (FC-ST-3)

Continues `../ces-strategy/docs/context/feature-completion/PLAN.md` with the founder's decisions of 2026-09-27
(`DECISIONS-2026-09-27.md` #2, "Build it" — the Evidence Collector). Verification detail:
`../ces-strategy/docs/context/feature-completion/VERIFY-stamper.md` (ST-16). Inputs: ces-shared 2.8.0
(`SecretReferenceSchema`, `ProvisioningInputsSchema`, `SECRET_VARIABLE_NAMES`) and ces-ec's EC-M2M3 session
(`../ces-ec/docs/requirements/REQ-ces-stamper-ec-autostart.md`, `../ces-shared/docs/requirements/REQ-ces-stamper-ec-launcher-adoption.md`,
`../ces-shared/docs/requirements/REQ-ces-stamper-secret-reference-resolution.md`).

### Step 1 — Evidence Collector auto-start (ST-16) — DONE, ST-16 → **Implemented**

**Before:** `GuiServer.ts:300-307` called `ensureEcRunning('http://localhost:4001', path.resolve(process.cwd(),
'../eo'))`, gated only on `EVIDENCE_OPS_SECRET` being set. `../eo` never existed as an EC module root (`ces-eo` has
no `src/ec/`); the call could never succeed. No test existed anywhere for this call site (`VERIFY-stamper.md`
confirmed 0 tests).

**After:** the check is extracted into `src/server/ecAutostart.ts` (`checkEcAutostart()`), every dependency
(`spawnFn`/`healthCheckFn`/`sleepFn`/`env`) injectable. `GuiServer.ts` now:
- always health-checks EC on startup (cheap, 2s timeout) — no more gating the check itself on a secret that is
  actually EC's own bearer-auth secret for its ingest/index routes, unrelated to whether Stamper should launch it;
- spawns EC only when unhealthy **and** `CES_EC_AUTOSTART=1` (ces-shared 2.8.0's `ensureEcRunning()` already made
  autostart opt-in and the spawn target configurable — this session's fix is the call site, not the launcher);
- relies on `ensureEcRunning()`'s own default cwd (`../ces-ec`, the real module root, resolved relative to Stamper's
  own `process.cwd()` at runtime) unless `CES_EC_CWD` overrides it — the wrong `../eo` string is gone entirely;
- surfaces the result (`already_running|started|autostart_disabled|failed`) in the startup log and on
  `GET /health` (`health.routes.ts` now takes an optional `getEcAutostartStatus` getter; response gained
  `evidenceCollector.autostart`).
- The retired Stamper→EC push (`/api/stamp-capture`, `EvidenceOpsClient`) was already fully removed by MS-R8
  (`c99562a`) and re-verified by `EvidenceWritePath.test.ts` — there was no orphaned `evidence_ops` SSE handler left
  in `public/index.html` to delete (checked by grep; none found).

**Tests:** `tests/unit/EcAutostart.test.ts` — one test per `EnsureEcRunningResult` state
(`already_running`/`autostart_disabled`/`started`/`failed`) plus a `CES_EC_CWD` override test, all with `spawnFn`
faked (no real process ever spawned) and `healthCheckFn`/`sleepFn` faked (no real HTTP call, no timer wait).

### Step 2 — Secret references (REQ-ces-stamper-secret-reference-resolution) — DONE

**Before:** no `SecretReference` handling existed in ces-stamper. A manifest carrying `secret_references[]` or
`provisioning_inputs` would leave the target variable (e.g. `initialPassword`) simply absent from `plan.variables`
unless a different, pre-existing path (the sim tenant record's plain `resources.initial_password`, still used
as-is by `MusterInfraManifestTranslate.test.ts` — unchanged this session) happened to supply it.

**After — translate/Configure time (`PlanTranslator.ts`):** `secret_references[]` (Infra Manifest) and
`provisioning_inputs` (Tenant Manifest, m365-only sessions — `ManifestReader.provisioningInputs` new getter) are
read and applied via the new `applySecretReferences()`:
- non-secret provisioning fields (`approver_upn`, `terms_of_use_file`) map straight onto the existing
  `approverUPN`/`touFileName`/`touFileBase64` variables (`VARIABLE_MAPPING`, no new names invented);
- every secret-bearing variable (`SECRET_VARIABLE_NAMES`, today just `initialPassword`) gets a safe sentinel token
  (`<<CES_SECRET:name>>`, `src/core/secretSentinel.ts`) in `plan.variables` — **never** the reference object, never a
  resolved value — plus reference metadata (`variable`/`form`/`ref` or `vault`/`name`, no `value`/`secret` field
  possible) recorded at `plan.variables._secret_references` for the execution layer to consume;
- `mergeInfraManifestVariables` gained an independent guard refusing a plain-string value for any
  `SECRET_VARIABLE_NAMES` key from the Infra Manifest's own `stamper_variable_map` (defense-in-depth: ces-shared's
  `InfraManifestSchema` already rejects this one layer up, at parse time — both layers are tested).

**After — execution time:** `SecretStore` (`src/core/SecretStore.ts`) holds `one_time_operator_held` values the
operator supplies via the new `POST /api/tenants/:slug/secrets` — in server memory only, cleared on restart, never
logged, never echoed back in the response. `SecretResolver` (`resolveSecretReference`/`buildSecretOverlay`) resolves
each reference or throws a named `SecretResolutionError` — never a blank value. `StamperEngine.loadPlan()` builds
the overlay from `plan.variables._secret_references` + `SecretStore.getAll(tenantSlug)` and passes it through
`TaskRunner` to `PowerShellAdapter.setSecretOverlay()`. `PowerShellAdapter`'s `executeViaSession()` — the single
choke point every sub-command execution already funneled through — applies the overlay immediately before the
command reaches the session/spawn boundary; every other copy of the resolved command (the `SubCommandStreamEvent`
sent to the GUI, `buildStructuredEvidence`, the plan file on disk) still carries the sentinel, never the real value.
An unresolved sentinel throws at that same boundary, blocking the task with a clear message instead of running with
a blank or literal-sentinel value.

**HONEST-OPEN:** `key_vault_secret` resolution has no live Azure Key Vault client in ces-stamper this session —
`resolveSecretReference` throws a clear, named error when no `keyVaultReader` is injected (never silently succeeds
with an empty value). `one_time_operator_held` is the form Muster's interim implementation actually emits today
(per `REQ-ces-stamper-secret-reference-resolution`), so this does not block the REQ's acceptance criteria. No REQ
filed — this is ces-stamper's own scope to pick up later (an injectable `keyVaultReader` is already the extension
point), not a cross-module blocker.

**Tests:** `SecretResolver.test.ts` (9), `SecretStore.test.ts` (9, including a "never touches disk" proof),
`SecretReferenceTranslate.test.ts` (10, using ces-shared's own `infra-manifest.example.json` fixture — which already
carries a real `secret_references` entry — plus a provisioning_inputs variant built from the existing synthetic
tenant manifest fixture), `PowerShellAdapterSecretOverlay.test.ts` (6, a fake session manager proving the resolved
value reaches only the object passed to `execute()`, never the caller's own resolved-command string, and that a
missing overlay entry throws before any fake spawn/session call happens).

**Commit:** `689178c`.

**Gates:** `npx tsc --noEmit` clean · `npm run build` clean · `npm test` full suite green (44 suites, 430 passed / 1
skipped / 431 total — was 39 suites / 392 total before this session; no load-related timeouts, full suite ran in
~20s).

| Exit | Criterion | Met |
|---|---|---|
| X-E1 | Every step Done (fail-first test, production code, passes) or HONEST-OPEN with a REQ | YES (step 2's Key Vault gap is HONEST-OPEN, no cross-module REQ needed — see above) |
| X-E2 | `npx tsc --noEmit` + `npm run build` + `npm test` clean on the committed HEAD (full suites) | YES |
| X-E3 | nothing from this work uncommitted (this file + session log + instruction file included) | YES (this docs commit follows the code commit `689178c`) |
| X-E4 | this section | YES |
| X-E5 | nothing pushed | YES |

Legend: FC-ST-3 = this session's id · ST-16 = the EC-auto-start feature id (`VERIFY-stamper.md`) · EC = Evidence
Collector (now a real standalone module, `ces-ec`, built by a parallel ces-ec session this same day) · MS-R8 = the
flow-through step that deleted Stamper's `/api/stamp-capture` push (commit `c99562a`) · SECRET_VARIABLE_NAMES =
ces-shared 2.8.0 list of variable names that must never carry a plain value (today: `initialPassword`) · sentinel =
the `<<CES_SECRET:name>>` placeholder token, safe to persist/log/display · overlay = the resolved secret values held
only in `PowerShellAdapter`'s instance memory for one execution run · X-En = exit criteria in the FC-ST-3
instruction file · HONEST-OPEN = blocked, reason recorded · REQ = requirement filed against another module.
