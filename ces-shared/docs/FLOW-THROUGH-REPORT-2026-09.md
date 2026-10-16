# Flow-Through Report — ces-shared (2026-09)

**Branch:** `flow-through-2026-09`  
**Date:** 2026-09-26  
**Baseline:** 124 tests, tsc clean  
**Final:** 181 tests, tsc clean  

## Steps

### 1. AE-R2 — AdminOps evidence contract (P0)
**Status:** DONE  
**Commit:** `c0b80b3`  
**Files:**
- `src/types/adminops-evidence.contract.ts` — Zod schema, 7-value outcome enum, mode/dryRun, superRefine never-inflate invariant
- `src/types/adminops-evidence.contract.test.ts` — 25 tests (7 outcome paths, 7 never-inflate negatives, version gate, required fields, predicates)
- `src/types/controls.types.ts` — widened `AssessmentSource.type` (+`adminops_execution`) and `.result` (+`enforced`) per EO REQ
- `package.json` — added `zod ^3.25.76`, export entries for all 3 contracts

**Tests:**
- `AdminOpsEvidenceSchema` — `accepts a conforming live-execution row`, `...dry-run row`, `...denied_cmmc row`, `...denied_cui row`, `...blocked_pending_approval row`, `...approval_rejected row`, `...failed row`
- Version gate — `rejects unknown contractVersion`, `rejects missing contractVersion`
- Required fields — `rejects missing commandId`, `rejects missing tenantId`, `rejects empty controlIds`, `rejects unknown outcome`
- SPRS integrity — `rejects dry_run mode with non-dry_run outcome`, `rejects dryRun=true with non-dry_run outcome`, `rejects dry_run outcome with SAT verdict`, `rejects denied_cmmc with SAT`, `rejects denied_cui with SAT`, `rejects blocked_pending_approval with SAT`, `rejects approval_rejected with SAT`, `rejects failed with SAT`
- Predicates — `isLiveExecution`, `isDryRun`, `isDenial`, `isBlocked`

**Acceptance:** ces-shared schema test passes. EO REQ filed and addressed (`adminops_execution` + `enforced`). AO conformance test (covering all execution paths through `AdminOpsEvidenceSchema.parse`) is in ces-ao's instructions (AE-R3). Both ces-ao and ces-eo typecheck (`npx tsc --noEmit`) against the widened `controls.types.ts`.

**Notes:**
- The 15→7 outcome mapping (AO's rich `EvidenceOutcome` → normalized contract enum) is documented in JSDoc on `AdminOpsEvidenceOutcome` for ces-ao AE-R3 to implement.
- EO already has a local mirror at `src/eo/adminops/adminops-evidence.contract.ts`; it should delete that and import from `ces-shared/types/adminops-evidence` once the build is available.

### 2. MS-R1 — Mission-plan contract (P0)
**Status:** DONE  
**Commit:** `08e50bb`  
**Files:**
- `src/types/mission-plan.contract.ts` — `ManualMissionPlanSchema`, `TenantManifestSchema`, `InfraManifestSchema`, `ControlDispositionSchema`, `ControlDirectiveSchema`, `StamperAction` (5 values), `StamperDirective` (9 values), version gate
- `src/types/mission-plan.contract.test.ts` — 22 tests (rewritten: local fixtures, `toEqual` round-trip assertions, no skip guards)
- `src/types/__fixtures__/muster-mission-plan.json` — copied from ces-muster fixture
- `src/types/__fixtures__/muster-tenant-manifest.json` — copied from ces-muster fixture
- `src/types/__fixtures__/legacy-mission-plan.json` — copied from ces-tester demo plan

**Tests:**
- `ManualMissionPlanSchema` — inline fixture parse, round-trip (controls[] + control_directives[] survive), cesId preservation, customerId/siBaselineId preservation, unknown version rejection, wrong artifact rejection, empty controls accepted, empty directives accepted
- Real fixtures — Muster-generated MP fixture, legacy tester demo plan fixture (with cesId)
- `TenantManifestSchema` — Muster fixture parse, wrong artifact rejection, unknown version rejection
- `ControlDispositionSchema` — all 5 StamperAction values, unknown action rejection, inheritance metadata preservation
- `ControlDirectiveSchema` — all 9 directive values, unknown directive rejection, inheritance metadata preservation

**Acceptance:** ces-shared test parses both the Muster-generated MP + TM fixture and the legacy ces-planner (tester demo) fixture. Unknown `ces.version` is rejected. `toEqual` round-trip assertions on all real fixtures prove no keys are stripped.

**Schema hardening (post-initial-commit):**
- Added `.passthrough()` to every `z.object()` in the contract (`CesPlanMeta`, `CesManifestMeta`, `CesInfraMeta`, `OutputsBlockSchema`, `ManualMissionPlanSchema`, `TenantManifestSchema`, `InfraManifestSchema`, `MilestoneSchema`, `ControlDispositionSchema`, `ControlDirectiveSchema`, `ScopeExclusionSchema`, `HumanReadableMissionPlanSchema`) — prevents `z.object()` from stripping keys not yet in the schema (future Muster fields survive round-trip at every nesting level).
- Added `kind` (`capability-absent` | `prohibition`) and `requires_rr_validation` to `ScopeExclusionSchema` — present in Muster fixture data.
- **Passthrough bodies**: `inputs`, `steps`, `disposition_summary`, and tenant-manifest body are validated as `z.record(z.any())` or `z.any()` — the contract validates the envelope and known typed fields but does not constrain the body shape. This is intentional: Muster's body evolves faster than the shared contract.

### 3. MS-R4 — Inheritance metadata (P1)
**Status:** DONE (combined with MS-R1)  
**Commit:** `08e50bb` (same as MS-R1)

**Acceptance:** `ControlDispositionSchema` carries `inheritance_rationale`, `fedramp_package_id`, `requires_stamper_verification`. `ControlDirectiveSchema` carries those plus `tenant_variant`. CES envelope carries `cesId`, `customerId`, `siBaselineId`, `customerName`. Round-trip tests confirm no Muster field silently lost.

**Notes:** Muster emitting these fields and Stamper consuming them are in their own sessions' instructions.

### 4. MS-R8 — getStamperTenantRoot as canonical read path (P1)
**Status:** DONE  
**Commit:** `f220571`  
**Files:**
- `src/storage/node.ts` — JSDoc on `getStamperTenantRoot` and `getStamperTenantSubdir`

**Acceptance:** `getStamperTenantRoot(slug)` and `getStamperTenantSubdir` are exported via `ces-shared/storage/node` (export existed before this work). JSDoc declares them the single read path. EO already adopted it (commit `8e04280`). Stamper already deleted the dead push client (commit `c99562a`).

**Notes:** The full acceptance test ("EO test with CES_PIPELINE_ROOT set to a temp dir loads evidence that Stamper wrote") is in ces-eo's instructions.

### 5. MS-R9 — Execution-results contract (P2)
**Status:** DONE  
**Commit:** `a6d3915`  
**Files:**
- `src/types/execution-results.contract.ts` — `ExecutionResultsManifestSchema`, `ControlExecutionResultSchema`, normalized verdict enum (sat/not_sat/provisional/not_applicable), `contractVersion` gate, `cesId`/`planId`, `summarizeResults` helper
- `src/types/execution-results.contract.test.ts` — 8 tests

**Tests:**
- `ControlExecutionResultSchema` — conforming result, all 4 verdicts, all 10 directives, unknown verdict rejection
- `ExecutionResultsManifestSchema` — conforming manifest, unknown contractVersion rejection, missing planId rejection, cesId preservation
- `summarizeResults` — counts verdicts correctly

**Acceptance:** ces-shared schema test passes. The full acceptance test ("muster-api ingests a fixture and plan directive statuses update") is in ces-muster's instructions.

**Notes:** Stamper's existing `ExecutionResultsCollector.buildManifest` produces a shape close to this contract but lacks `contractVersion`, `planId`, and `cesId`, and uses uppercase verdicts (SAT/NOT_SAT). The mapping is documented in JSDoc on `ExecutionVerdict`.

## REQ files filed against siblings

- `docs/requirements/REQ-ces-stamper-execution-results.md` — Stamper's `ExecutionResultsCollector.buildManifest()` needs `contractVersion`, `planId`, `cesId`, and lowercase verdicts to conform to the shared contract. Stamper's own instructions (MS-R2) cover the action-mapping work but do not mention these fields.

## Open items

- **Schema strictness on AE-R2**: `AdminOpsEvidenceSchema` has a `superRefine` that rejects rows where a non-live outcome carries a SAT verdict. Any pre-AE-R3 evidence rows written by the current AO (which stamps dry runs as SAT) will fail to parse. This is intentional — it forces AO to fix the data before EO trusts it. But it means the switchover is not backward-compatible: AO must deploy AE-R3 (the 15→7 mapping + dry-run flag) before EO can safely import and parse existing evidence files.
- **Stamper conformance**: `REQ-ces-stamper-execution-results.md` filed. Stamper's writer needs 4 changes (see REQ).

## 2026-09-27

**Baseline:** 181 tests, tsc clean (end-of-day 09-26)  
**Final:** 218 tests (17 files), tsc clean  
**Commits this session:** `dcb3b08` (S1), `aac576b` (S1 follow-up), `8697ecd` (S2), `b9b1ace` (S3), `2e168a6` (S4)

### S1 — N-3: rebuild `dist` + freshness guard (P0)
**Status:** Done  
**Commits:** `dcb3b08`, `aac576b`  
**Files:**
- `src/dist-freshness.test.ts` — 6 tests across 3 contracts (mission-plan passthrough round-trip, adminops-evidence version+F-4, execution-results version)

**Tests:**
- `dist freshness — mission-plan`: `dist/types/mission-plan.contract.js contains passthrough calls`, `built ManualMissionPlanSchema preserves unknown keys (round-trip)`
- `dist freshness — adminops-evidence`: `exports SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS with 1.0.0 and 1.1.0`, `built schema accepts dry-run with denied_cmmc (F-4)`, `built AdminOpsEvidenceSchema rejects unknown contractVersion`
- `dist freshness — execution-results`: `exports EXECUTION_RESULTS_CONTRACT_VERSION`, `built ExecutionResultsManifestSchema rejects unknown contractVersion`

**Acceptance:** `grep -c passthrough dist/types/mission-plan.contract.js` > 0. Freshness test fails when dist is deleted or stale (hardened in `aac576b` to catch S2 contract changes).

### S2 — N-11: fix dry-run invariant per F-4 (P0)
**Status:** Done  
**Commit:** `8697ecd`  
**Files:**
- `src/types/adminops-evidence.contract.ts` — bumped to 1.1.0, added `SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS`, rewrote superRefine per F-4
- `src/types/adminops-evidence.contract.test.ts` — 10 new tests under `F-4 dry-run invariant`

**Tests (under `F-4 dry-run invariant`):**
- Accepts: `denied_cmmc`, `denied_cui`, `blocked_pending_approval` with dry-run
- Rejects: `executed`, `approval_rejected`, `failed` with dry-run
- Rejects: any dry-run with SAT verdict
- Backward compat: `1.0.0` row parses, `1.1.0` row parses, unknown version rejected with path-bearing issue

**Acceptance:** All F-4 acceptance criteria met. Dry-run with `denied_cmmc` parses; dry-run with `executed` rejected; dry-run with SAT rejected. Both `1.0.0` and `1.1.0` accepted.

### S3 — N-12: canonical infrastructure key (P1)
**Status:** Done  
**Commit:** `b9b1ace`  
**Files:**
- `src/types/mission-plan.contract.ts` — `InfraManifestSchema` rewritten with `superRefine` + `transform` for alias normalization
- `src/types/mission-plan.contract.test.ts` — 5 new tests under `N-12 infrastructure_manifest alias`

**Tests (under `N-12 infrastructure_manifest alias`):**
- `parses an envelope with the canonical infrastructure key`
- `parses an envelope with the deprecated infrastructure_manifest key`
- `accepts both keys when values are identical`
- `rejects both keys when values differ`
- `rejects an envelope with neither key`

**Acceptance:** Envelope with either key parses to the same object under `infrastructure`. Both keys with different values rejected.

### S4 — N-14: typed body schemas (P1)
**Status:** Done  
**Commit:** `2e168a6`  
**Files:**
- `src/types/mission-plan.bodies.ts` — `ManualStepSchema`, `TenantManifestBodySchema`, `InfrastructureBodySchema` + 18 sub-schemas
- `src/types/mission-plan.bodies.test.ts` — 15 tests (fixture parsing + negatives)
- `src/types/__fixtures__/stamper-mission-plan.json`, `stamper-tenant-manifest.json` — copied from ces-stamper fixtures

**Tests:**
- `ManualStepSchema — fixture coverage`: parses all Stamper steps, round-trips without key loss, rejects missing fields, preserves Stamper-only optionals
- `TenantManifestBodySchema — fixture coverage`: parses/round-trips Muster TM body, parses/round-trips Stamper TM body, rejects missing manifest_id
- `InfrastructureBodySchema`: parses minimal body, round-trips, preserves infrastructure_model, preserves passthrough keys, rejects malformed variable_map, rejects malformed registry_coverage

**Muster vs Stamper disagreements recorded:**
- `tenant_identity`: Muster omits it; Stamper uses a flat shape (`tenantId`, `domain`, `tenant_name`). Schema accepts both typed and record forms via `z.union`.
- `boundary_zones`: Muster omits it; Stamper uses array-of-records. Schema accepts both typed and array forms via `z.union`.
- `section`, `resource_type`, `layer`, `tech_ref` on ManualStep: Stamper-only (infra plan enrichment). All optional.
- `sentinel_workspace`, `sentinel_resource_group`, `log_analytics_workspace_id` on EvidenceMonitor: Stamper-only. All optional.
- `control_id`, `config_key`, `approval_status` on DriftPolicy: Stamper-only (per-control exception registry). All optional.

**Acceptance:** Muster fixtures, legacy fixture, and Stamper fixtures all parse through typed bodies. Negative tests confirm rejected malformed input with path-bearing issues.

### S5 — N-9: reconcile inbound REQs (P1)
**Status:** Done

| Source | REQ file | Status | Commit(s) |
|--------|----------|--------|-----------|
| ces-muster | `docs/requirements/REQ-ces-shared-mission-plan-contract.md` | Satisfied | `08e50bb` (MS-R1 contract) + `2e168a6` (S4 typed bodies) |
| ces-eo | `docs/requirements/REQ-ces-shared-adminops-evidence-contract.md` | Satisfied | `c0b80b3` (AE-R2 contract) |
| ces-eo | `docs/requirements/REQ-ces-shared-assessment-source-adminops.md` | Satisfied | `c0b80b3` (`controls.types.ts:29` widened) |
| ces-ao | `docs/requirements/REQ-shared-adminops-evidence-contract.md` | Superseded | by `c0b80b3` |
| ces-ao | `docs/requirements/REQ-shared-adminops-evidence-dryrun-invariant.md` | Satisfied | `8697ecd` (S2 F-4 invariant fix) |
| ces-stamper | `docs/requirements/REQ-ces-shared-infra-manifest-key.md` | Satisfied | `b9b1ace` (S3 canonical key) |
| ces-stamper | `docs/requirements/REQ-ces-shared-mission-plan-contract.md` | Satisfied | `08e50bb` (MS-R1 contract) |
| ces-stamper | `docs/requirements/REQ-ces-shared-execution-results-contract.md` | Satisfied | `a6d3915` (MS-R9 contract) |

**Outbound (still open):** `docs/requirements/REQ-ces-stamper-execution-results.md` — Stamper step T3 closes it.

### Corrected overclaims

The 09-26 report (steps 1–5) treated the mission-plan and adminops-evidence contracts as consumer-ready. In fact:

1. **`dist/` was stale.** `dist` was built before `.passthrough()` landed (`cd28588`, `e87f4fc`). `grep -c passthrough dist/types/mission-plan.contract.js` returned 0. Every symlinked consumer importing from `ces-shared/dist/` got the old schema that stripped unknown keys, making the round-trip assertions meaningless in practice. Fixed by S1 (`dcb3b08`).
2. **Dry-run invariant rejected legitimate denials.** The `superRefine` in `adminops-evidence.contract.ts` rejected `denied_cmmc`, `denied_cui`, and `blocked_pending_approval` outcomes on dry-run rows, but ces-ao's AdminOps correctly produces these (a CUI-scope denial is a legitimate dry-run outcome, not a failure). Fixed by S2 (`8697ecd`) per founder decision F-4.
3. **Body schemas validated nothing.** `z.record(z.any())` on steps, tenant_manifest, and infrastructure bodies meant that syntactically wrong payloads would silently parse. Muster and Stamper "adopting" the contract got no type safety on the body. Fixed by S4 (`2e168a6`).

## 2026-09-27 fix batch

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md` (after Gate 2).
**Baseline:** 218 tests (17 files), tsc clean. **Final:** 241 tests (18 files), tsc clean; dist rebuilt after the final commit. Package `2.2.3` → `2.3.0`.

### FX-SH1 — sim-only refusal outcome (P2)
**Status:** Done  **Commit:** `2e07bc2`  **REQ closed (ces-shared side):** `ces-ao/docs/requirements/REQ-shared-adminops-evidence-sim-refusal-outcome.md`
- `src/types/adminops-evidence.contract.ts`: contract `1.1.0` → `1.2.0`; `SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS` = `1.0.0, 1.1.0, 1.2.0`;
  new outcome `denied_sim_only` — never SAT, allowed on dry-run rows, counted by `isDenial()`, and only valid on rows declaring 1.2.0+
  (a 1.0.0/1.1.0 row carrying it is rejected on path `outcome`).
- Tests (`adminops-evidence.contract.test.ts`, `describe('FX-SH1 denied_sim_only outcome (contract 1.2.0)')`): 1.2.0 row parses with verdict ≠ SAT;
  dry-run variant parses; SAT rejected (live + dry); pre-1.2.0 rows with it rejected; every pre-existing outcome on 1.0.0 and 1.1.0 rows still parses.
  `dist-freshness.test.ts`: built schema accepts a 1.2.0 `denied_sim_only` row and `isDenial` is true.
- Sibling impact (read-only runs against rebuilt dist): ces-eo adminops tests 48/48 green. **ces-ao golden conformance test goes red (10 tests)** because it
  pins `'1.1.0'` (`test/contract/adminopsEvidence.conformance.test.ts:89`) and the committed golden carries 1.1.0 — the drift guard working as designed.
  Filed **`docs/requirements/REQ-ces-ao-adminops-evidence-1-2-0-adoption.md`** (regenerate golden, drop literal pin, switch A5 rail to `denied_sim_only`).

### FX-SH2 — typed plan parse output (P2)
**Status:** Done  **Commit:** `42c2cb0`  **REQ closed:** `ces-stamper/docs/requirements/REQ-ces-shared-mission-plan-typed-output.md`
- `src/types/mission-plan.contract.ts`: `ManualMissionPlanSchema` annotated `z.ZodType<ManualMissionPlanParsed, z.ZodTypeDef, ManualMissionPlanInput>`
  (named interfaces — keeps declaration emit under TS7056) instead of `z.ZodType<Record<string, unknown>>`. Exported `CesPlanMetaSchema`,
  `CesManifestMetaSchema`, `CesInfraMetaSchema`, `OutputsBlockSchema` + inferred types; `export *` of `mission-plan.bodies.ts` so `CheckSchema`,
  `NormativeControlSchema`, … are reachable via `ces-shared/types/mission-plan`. `ManualMissionPlan` keeps its name (now the typed input shape).
- Type-level test `src/types/mission-plan.typed-output.test.ts`: `expectTypeOf` + `@ts-expect-error` assertions, enforced by compiling the file with
  `tsc -p tsconfig.typetest.json` from inside the test (main tsconfig excludes `*.test.ts`). Negative control: restoring the old `Record` annotation
  makes that compile fail. Runtime half parses the Stamper fixture and reads `ces.cesId` / `steps` / `tenant_manifest` with no cast.
- `dist-freshness.test.ts`: built `.d.ts` contains `interface ManualMissionPlanParsed` and no `Record<string, unknown>` annotation; built module
  exports the envelope schemas. dist rebuilt after the final commit.
- Sibling impact (read-only `tsc --noEmit`): ces-stamper clean, ces-muster/muster-api clean. Stamper may now delete `CESPlanMeta` /
  `CESManualMissionPlan` and its cast (their call).

### FX-SH3 — new REQs from this batch
**Status:** Done (2 REQs implemented; 1 named REQ never filed — not needed). Checked read-only from 11:27 to ~11:47 (several polls).

| Source | REQ | Status | Commit | Tests |
|---|---|---|---|---|
| ces-eo (FX-EO4) | `ces-eo/docs/requirements/REQ-ces-shared-adminops-target-identity.md` | Done — AdminOps evidence **1.3.0**: optional `targetUPN` / `targetObjectId` (user the command acted on, not the operator); every prior version parses | `03a6d0a` | `describe('FX-SH3 target identity …')` (4 tests) + dist-freshness (fields not stripped). Evidence: EO's `it.failing` tripwire in `adminops-offboarding.test.ts` flipped to passing against rebuilt dist; EO has since closed the REQ. |
| ces-stamper (FX-ST4) | `ces-stamper/docs/requirements/REQ-ces-shared-execution-results-executable-plan-id.md` (filed this batch, not in the watch list) | Done — execution-results **1.1.0**: optional `executablePlanId`; `contractVersion` literal → enum `SUPPORTED_EXECUTION_RESULTS_VERSIONS` (1.0.0, 1.1.0) | `82f39da` | `describe('FX-SH3 executablePlanId …')` (4 tests) + dist-freshness. muster-api `plan.results.test.ts` 3/3 and tsc clean against rebuilt dist. |
| ces-stamper (FX-ST3) | `REQ-ces-shared-execution-results-vocabulary.md` | Not filed — Stamper's session log says every value mapped honestly (MET→sat, NOT MET→not_sat, implement→automated, validate→validation, manual→manual_gate), so no REQ | — | — |

**Outbound REQs filed this batch (sibling tests pin old version literals — drift guards working as designed):**
- `docs/requirements/REQ-ces-ao-adminops-evidence-1-2-0-adoption.md` — ces-ao: regenerate golden (10 tests red, pinned `'1.1.0'`), switch
  A5 rail to `denied_sim_only`, populate `targetUPN`/`targetObjectId` on A-02/A-03/B-05.
- `docs/requirements/REQ-ces-stamper-execution-results-1-1-0-adoption.md` — ces-stamper: `tests/directive-migration.contract.test.ts:337`
  pins `'1.0.0'` (1 test red); drop the local `executablePlanId` widening.

### Corrected overclaims
1. **09-27 S4 "TS7056 fixed" hid a regression.** The fix annotated `ManualMissionPlanSchema` as `z.ZodType<Record<string, unknown>>`, which erased
   the typed bodies from the parse output — consumers validated against typed schemas but received `Record<string, unknown>` and had to cast
   (Stamper re-declared the envelope as an interface). The S4 claim that consumers got body type safety held only at runtime. Fixed by FX-SH2.
2. **"Sim-only refusals are denials" was only true by convention.** AO wrote them as `denied_cmmc` with a free-text rationale, so a CMMC-gate denial and
   a safety-rail refusal were indistinguishable to EO/SPRS consumers. Now a distinct machine-readable outcome (FX-SH1), pending AO adoption (REQ above).


## 2026-09-27 wave 4

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-W4.md`.
**Baseline:** 241 tests (18 files), tsc clean. **Final:** 286 tests (21 files), tsc clean, dist rebuilt, dist-freshness green. Package `2.3.0` → `2.6.0`. Nothing pushed.

### W4-SH1 — authenticated request principal (P0)
**Status:** Done  **Commit:** `32a07d5` (2.4.0)  **REQ closed (ces-shared side):** `ces-ao/docs/requirements/REQ-shared-http-request-principal.md`
- New `src/http/requestPrincipal.ts`, exported as `ces-shared/http/principal`:
  - `requirePrincipal(opts)` middleware (`:237`) and `getRequestPrincipal(req)` (`:221`) return `{ subjectId, upn, displayName?, roles, tenantId?, verified, source, expiresAt? }`.
  - The token travels in the `x-ces-principal` header, which leaves `Authorization` free for the service bearer token.
  - It is verified by `createHs256PrincipalVerifier` (`:126`). The verifier is local-only (no network or JWKS), pins the algorithm to HS256 (`none` and HS512 are rejected), compares signatures in constant time, checks exp/nbf with clock skew, and can check issuer and audience.
  - Claims map the way Entra ID names them (`oid|sub`, `upn|preferred_username`, `name`, `roles`, `tid`), so an Entra verifier can later implement the same `PrincipalVerifier` interface.
- The principal is stored in a module-private WeakMap (`:218`). It is never read from body, query, or `req.cesPrincipal`.
- When nothing is configured, it fails closed: 401 everywhere, loopback included. Unlike bearerAuth, it does not trust loopback.
- Local dev must opt in explicitly with `devPrincipal`. That principal applies only to loopback requests with no token and is marked `verified:false, source:'dev-unverified'`. An invalid token from loopback is still 401, so there is no quiet fallback to the dev principal. `requiredRoles` returns 403 when the role is missing. `principalPostureLine()` gives a startup log line. `REQUEST_PRINCIPAL_VERSION = 1.0.0`.
- Tests: `src/http/requestPrincipal.test.ts` has 29 cases, all calling production code:
  - a valid token yields the principal and roles;
  - missing, expired, not-yet-valid, tampered, wrong-secret, malformed, wrong-issuer, wrong-audience, missing-claims, `alg:none` and HS512 each return 401 with a reason;
  - a body `approverUPN: other@` is ignored in favour of the token's UPN;
  - a forged `req.cesPrincipal` is ignored;
  - the dev principal is loopback-only;
  - the service token and principal token work on the same request.

  The `dist-freshness` test imports the built module and checks the package export. Negative control: removing the alg pin and the loopback check turns 3 tests red.
- **Level:** "authenticated approver" (AdminOps finding 7, `adminops.md:66`) went from **Missing** (no per-user identity in ces-shared) to **Implemented** on the ces-shared side. It is still **Partial** end to end until ces-ao W4-AO3 takes the approver from `getRequestPrincipal(req).upn`.

### W4-SH2 — infra-manifest body ready for Muster to emit (P1)
**Status:** Done  **Commit:** `5368ea4` (2.5.0)  **Outbound REQ:** `docs/requirements/REQ-ces-muster-infra-manifest-emit.md`
- **Gap analysis (read-only, ces-stamper and ces-muster):**
  - The shared `InfrastructureBodySchema` already matched Stamper's JSON schema and its consumers: `translate.routes.ts:110-160` (reads `infrastructure_model` and merges `stamper_variable_map` string values), `baseline.routes.ts:124-131`, and `BaselineProvisioner.ts:12` (14 required non-empty keys).
  - The gaps were in the **variable block**:
    - Muster's generator emits `fwSubnetCidr`, `identitySubnetCidr` and `peSubnetCidr`. Stamper's network registry resolves `firewallSubnetCidr`, `workloadSubnetCidr` and `bastionSubnetCidr`.
    - `firewallName`, `publicIpName` and `vmName/vmImage/vmSize`, which Stamper's registry needs, were untyped passthrough keys.
- **Changes:**
  - `mission-plan.bodies.ts` adds typed optional variables and `INFRA_VARIABLE_ALIASES` (`fwSubnetCidr` → `firewallSubnetCidr`), plus `normalizeInfraVariableMap()` and `STAMPER_PROVISIONING_REQUIRED_VARIABLES`.
  - `InfraManifestSchema` copies the alias onto the canonical name and rejects conflicting values. Manifests without the alias parse exactly as before.
- **Fixture:** `src/data/infra-manifest.example.json`, exported as `ces-shared/data/infra-manifest-example`. It is a golden-style m365_azure manifest: canonical `infrastructure` key, ISO date-time, `infrastructure_model`, all 7 sections, and a consistent registry coverage of 18 ids.
- **Tests:** `src/types/infra-manifest.example.test.ts` has 9 cases:
  - the fixture parses unchanged;
  - it meets Stamper's refinements;
  - every BaselineProvisioner key is non-empty;
  - the canonical subnet and resource names are present;
  - coverage and depends_on are consistent;
  - a Muster-shaped alias normalizes, a conflict is rejected, and the Sentinel-only shape parses unchanged.

  Plus a dist-freshness test. Negative control: against the pre-SH2 `mission-plan.contract.ts`, 2 tests fail.
- **Sibling checks (read-only, against rebuilt dist):**
  - ces-stamper: `SharedMissionPlanDelegation` + `CliInfraManifestPrefix` 19/19 green; `tsc --noEmit` clean.
  - Stamper's own `CESInfrastructureManifestSchema` (from its dist) parses the example; 0 BaselineProvisioner keys are missing.
  - The only infra-registry variables not in the map are `breakGlassUPN`, `operatorUPN`, `appId` and `cisoEmail`. They are tenant-manifest identity variables and out of scope.
  - muster-api `tsc --noEmit` clean.
  - Stamper has no on-disk infra-manifest fixture. `tests/fixtures/infrastructure-manifest_*.json` is actually an executable plan, so its "existing fixtures" are the inline ones in `SharedMissionPlanDelegation.test.ts`.
- **Level:** the MS-R7 infra-manifest contract went from **Partial** (the body was typed, but the variable names diverged between Muster and Stamper and there was no target example) to **Implemented** on the shared side. Muster emission (W4-MU1) is still open; see the REQ.

### W4-SH3 — Wave 4 REQs
**Status:** Done. The REQ directories of ces-ao, ces-eo, ces-stamper, ces-muster and ces-tester were polled read-only at the start and end of the run.

| Source | REQ | Status | Commit | Tests |
|---|---|---|---|---|
| ces-ao | `REQ-shared-http-request-principal.md` | Done — W4-SH1 | `32a07d5` | 29 + dist-freshness |
| ces-eo | `2026-07-10-ces-shared-requestlogger-skip-paths.md` (OPEN since 07-10, targets ces-shared) | Done — `requestLogger(service, { skipPaths })`; a skipped path still gets and echoes `x-request-id`; zero-option call unchanged | `64abc62` (2.6.0) | `src/observability/requestLogger.test.ts` (3; the skip test fails on the old code) + dist-freshness |
| ces-eo | `REQ-ces-eo-jest-shared-contract-mapper.md` | Deferred — it targets ces-eo's own `package.json`, and there is nothing to do on the ces-shared side | — | — |
| ces-stamper | `REQ-ces-shared-mission-plan-typed-output.md` | Already done (FX-SH2 `42c2cb0`). The file still says OPEN, so Stamper should close it | — | — |
| all others | ao/eo/stamper/muster `REQ-(ces-)shared-*` | Already CLOSED in earlier waves | — | — |

No new Wave 4 REQ against ces-shared appeared during the run. ces-tester has none.

**Outbound:** `docs/requirements/REQ-ces-muster-infra-manifest-emit.md` (ces-muster: emit the canonical key, `infrastructure_model`, the canonical subnet and resource variables, and target the example).

## 2026-09-28 feature completion (FC-SH)

**Baseline:** package 2.7.0, tsc clean. **Final:** 370 tests (+41 new this session), tsc clean,
package **2.8.0**.
Full detail (before/after per step, commits, REQs, downstream asks) is in `CHANGELOG.md` under the
same heading. Summary:

| # | Step | REQ answered | Status |
|---|---|---|---|
| 1 | Secret references (Infra Manifest + Tenant Manifest provisioning_inputs) | `../ces-muster/docs/requirements/REQ-ces-shared-im-secret-values.md`, `REQ-ces-shared-export-provisioning-vars.md` | Done |
| 2 | Principal token id (`jti` → `tokenId`, v1.1.0) | `../ces-ao/docs/requirements/REQ-ces-shared-principal-token-id.md` | Done |
| 3 | Signal registry (6 overlay entries promoted, 13 L1/L2 duplicates resolved) | `../ces-eo/docs/requirements/REQ-ces-shared-signal-registry-overlay.md` | Done |
| 4 | EC launcher (real entry point, configurable, opt-in autostart) | `../ces-ec/docs/requirements/REQ-ces-shared-ec-launcher.md` | Done |
| 5 | Append-only mint store (`eo_approver_token_mints` in `DEFAULT_WORM_COLLECTIONS`) | `../ces-eo/docs/requirements/REQ-ces-shared-worm-approver-token-mints.md` | Done |

**Outbound:** `docs/requirements/REQ-ces-stamper-secret-reference-resolution.md` (resolve
`SecretReference` at Configure time, never persist the value),
`docs/requirements/REQ-ces-stamper-ec-launcher-adoption.md` (fix the `../eo` cwd bug in
`GuiServer.ts:304`, decide on `CES_EC_AUTOSTART`).

## Legend
- AE-Rn / MS-Rn = recommendation n in the AdminOps→EvidenceOps / Muster→Stamper flow assessments
- N-n = new finding in grand plan §7.2
- F-n = founder decision (§7.4)
- S1–S5 = step ids for ces-shared (this file's 09-27 section)
- W4-SH1–W4-SH3 = step ids in `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-W4.md` (wave 4)
- HS256 = HMAC-SHA256 token signature; JWKS = JSON Web Key Set (remote signing keys); UPN = user principal name
- FX-SH1–FX-SH3 = step ids in `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md` (2026-09-27 fix batch)
- SAT = satisfied verdict; SPRS = government supplier score; TS7056 = TypeScript "inferred type exceeds maximum length" error
- P0/P1/P2 = priority (blocks flow / needed for trustworthy operation / clean-up)
- SAT = "satisfied" compliance verdict
- SPRS = Supplier Performance Risk System score
- EO = EvidenceOps, AO = AdminOps
- MP = Manual Mission Plan, TM = Tenant Manifest
- W1–W4 = waves (stabilize, adopt, prove, loops)
- G1–G3 = gates between waves
