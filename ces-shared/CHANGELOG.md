# Changelog — ces-shared

All notable changes to the shared spine. Format: [Keep a Changelog](https://keepachangelog.com/);
this project follows [SemVer](https://semver.org/). Dates are UTC.

## 2026-09-28 feature completion (FC-SH)

Continues `../ces-strategy/docs/context/feature-completion/PLAN.md` with the founder's decisions of
2026-09-27/28. All 5 steps Done (fail-first test, production code, passes) — none HONEST-OPEN.
Package **2.7.0 → 2.8.0**. 370 tests, +41 new this session (13+3+1+1+11+12 across the 5 steps' test
files, corrected after an initial miscount — see the session log), `tsc --noEmit` / `npm run build` /
`npm test` clean on the committed HEAD.

### 1. Secret references in manifests — before → after
**REQs answered:** `../ces-muster/docs/requirements/REQ-ces-shared-im-secret-values.md` (DONE),
`../ces-muster/docs/requirements/REQ-ces-shared-export-provisioning-vars.md` (already satisfied since
2.5.0/FX-SH2 via `export *`; re-verified with a new test rather than re-exporting).
- **Before:** `InfraVariableMapSchema`/`InfrastructureBodySchema` accepted only string values — no
  shape existed for "this is a reference, not a value." `stamper_variable_map.initialPassword` could
  silently carry a plain password with nothing to stop it.
- **After:** `SecretReferenceSchema` (`src/types/mission-plan.bodies.ts`) — discriminated union on
  `form`: `one_time_operator_held { variable, form, ref }` (Muster's emitted shape, unchanged) and
  `key_vault_secret { variable, form, vault, name }`; both variants `.strict()` so a stray
  `value`/`secret`/`password` key is a parse error, not a silent pass-through. New
  `InfrastructureBodySchema.secret_references?: SecretReference[]`.
  `InfraManifestSchema`'s existing `superRefine` now rejects a non-empty plain-string
  `stamper_variable_map.initialPassword` (or any variable a `secret_references[].variable` entry
  itself names) — `SECRET_VARIABLE_NAMES = ['initialPassword']` is exported for future additions.
  New `ProvisioningInputsSchema` (`approver_upn`, `terms_of_use_file { file_name, content_base64 }`,
  `initial_password_ref: SecretReference`) + `TenantManifestBodySchema.provisioning_inputs?`, for
  m365-only sessions that carry no Infra Manifest (founder decision 2026-09-28 #11). Field names reuse
  Stamper's own existing `VARIABLE_MAPPING` concepts (`approverUPN`, `touFileName`/`touFileBase64`,
  `initialPassword`) — no new naming invented. `infra-manifest.example.json` now carries a
  `secret_references` entry as Muster's target.
  Outbound: `docs/requirements/REQ-ces-stamper-secret-reference-resolution.md` (Stamper resolves at
  Configure time, never persists the value).
- **Commit:** see below. **Tests:** `src/types/secret-reference.test.ts` (13 tests, new file).

### 2. Token id (`jti`) — before → after
**REQ answered:** `../ces-ao/docs/requirements/REQ-ces-shared-principal-token-id.md` (DONE).
- **Before:** `createHs256PrincipalVerifier` discarded every claim not on `RequestPrincipal`
  (sub/oid, upn, name, roles, tid, exp) — a `jti` claim was silently dropped.
- **After:** `PrincipalClaims.jti?: string` → `RequestPrincipal.tokenId?: string`, populated only when
  `jti` is a non-empty string; never set on the dev-unverified principal.
  `REQUEST_PRINCIPAL_VERSION` **1.0.0 → 1.1.0**.
- **Tests:** 3 new in `src/http/requestPrincipal.test.ts` + 1 dist-freshness test.
- **Downstream:** ces-ao (FC-AO-2) persists `principal.tokenId` as `approverTokenId` on the approval
  and its decision evidence; it must not decode the JWT a second time itself.

### 3. Signal registry — before → after
**REQ answered:** `../ces-eo/docs/requirements/REQ-ces-shared-signal-registry-overlay.md` (DONE).
- **Before:** `src/data/control-signal-registry.json` had 119 keys; 13 were not reference control ids
  — an L2-tagged duplicate of an L1 reference control (`AC.L2-3.1.1` duplicating `AC.L1-3.1.1`, etc.,
  plus `MP.L2-3.8.3`). EO's 6-control coverage gain (79→85 of 110) lived only in an EO-owned overlay
  (`ces-eo/src/eo/mapping/eoRegistryOverlay.ts`), invisible to any other registry consumer.
- **After:** 107 keys, every one a reference control id (verified by a new general-purpose test, not
  a hardcoded list — it would have failed on all 13 before this change).
  - The 6 EO overlay entries (`AT.L2-3.2.1`, `AT.L2-3.2.3`, `AU.L2-3.3.5`, `PS.L2-3.9.2`,
    `RA.L2-3.11.2`, `SC.L2-3.13.7`) replace their `manualGateEvaluator` placeholders verbatim
    (same signals/evaluator EO already ships). Graph-signal coverage over the 110 reference controls
    is now **85** (79 pre-existing + 6 promoted), computed directly from the shared asset alone.
  - 12 of the 13 duplicates are **dropped, not merged** — several carry `required: true` graph
    signals the L1 evaluator never reads; merging them would turn a future 403 on that endpoint into
    a false `not_assessed` on a control that is assessable today. The reference-id (L1) sibling is
    untouched. Orphaned evaluator names EO should decide whether to fold in:
    `cuiAccessEvaluator` (AC.L2-3.1.1), `transactionTypesEvaluator` (AC.L2-3.1.2),
    `externalConnectionsEvaluator` (AC.L2-3.1.20), `sharepointSharingEvaluator` (AC.L2-3.1.22),
    `mfaEvaluator` (IA.L2-3.5.1), `authenticationEvaluator` (IA.L2-3.5.2),
    `boundaryProtectionEvaluator` (SC.L2-3.13.1), `publicNetworkEvaluator` (SC.L2-3.13.5),
    `flawRemediationEvaluator` (SI.L2-3.14.1), `maliciousCodeProtectionEvaluator` (SI.L2-3.14.2),
    `manualGateEvaluator` (SI.L2-3.14.4, was already manual — no loss), `secureScoreEvaluator`
    (SI.L2-3.14.5).
  - `MP.L2-3.8.3` (capability evaluator claiming SAT on "managed devices exist," not on
    sanitization — the REQ's explicit warning) is **not** re-keyed. It is replaced by
    `MP.L1-3.8.3: { signals: [{ type: 'manual' }], evaluator: 'manualGateEvaluator' }` under the
    correct reference id.
  - `google-workspace-control-signal-registry.json` checked for the same pattern: only 1 entry, no
    issue found — left untouched.
- **Tests:** `src/data/control-signal-registry.test.ts` (new file, 12 tests: L1/L2 mismatch guard,
  the 12-duplicates-dropped + siblings-intact check, the MP special case, the 6 overlay entries
  verbatim, the 85-of-110 pin, a shape-validation pass, dist-freshness).
- **Downstream:** ces-eo deletes `eoRegistryOverlay.ts` and `effectiveRegistry.ts`'s merge. Its
  `tests/unit/claim-accuracy.test.ts` will fail as-is against this version: line 58
  (`expect(automatedIn(shared).length).toBe(79)`) needs to become `85`, and line 63 (asserting the 6
  overlay ids are present in the effective mapper but absent from the shared registry) needs to drop —
  they are now present in both, by design. Line 67 (`practiceNumbers.size === 107`) is unaffected.

### 4. EC launcher — before → after
**REQ answered:** `../ces-ec/docs/requirements/REQ-ces-shared-ec-launcher.md` (DONE).
- **Before:** `spawnEc()` hardcoded `npx tsx src/ec/index.ts` — a path that does not exist in ces-ec
  — with `cwd` and `ecUrl` as the only configurable inputs, and would always try to spawn on any
  unhealthy check.
- **After:** `command`/`args` default to `npx tsx src/index.ts` (the real ces-ec entry, verified by
  `ces-ec/test/entry.test.ts`); `cwd` precedence is an explicit `cwd` → `env.CES_EC_CWD` →
  `../ces-ec` relative to the caller's `process.cwd()`. **Autostart is now opt-in**
  (`env.CES_EC_AUTOSTART === '1'`) — without it, an unhealthy EC is left alone
  (`'autostart_disabled'`, nothing spawned). `ensureEcRunning()` now returns
  `'already_running' | 'started' | 'autostart_disabled' | 'failed'` (was `Promise<void>`); the legacy
  two-positional-argument call shape (`ensureEcRunning(ecUrl, ecCwd)`) still works unchanged for
  callers that `await` without inspecting the result. Every dependency (`spawn`, the health check,
  `sleep`) is now injectable, so tests never touch the network or spawn a process.
  New types exported from the package barrel: `EnsureEcRunningOptions`, `EnsureEcRunningResult`,
  `SpawnFn`, `HealthCheckFn`, `SleepFn`.
  Outbound: `docs/requirements/REQ-ces-stamper-ec-launcher-adoption.md` — Stamper's own call site
  (`GuiServer.ts:304`) passes `../eo` as the EC cwd, which is wrong regardless of this fix, and must
  set `CES_EC_AUTOSTART=1` to keep its prior always-try-to-spawn behavior.
- **Tests:** `src/launcher/EcLauncher.test.ts` (new file, 11 tests: command/cwd defaults and
  precedence, already-running/spawn-then-healthy/timeout lifecycle, autostart-disabled, detached
  child, 2 backward-compat smoke tests).

### 5. Append-only mint store — before → after
**REQ answered:** `../ces-eo/docs/requirements/REQ-ces-shared-worm-approver-token-mints.md` (DONE —
ces-shared owns the evidence DB layer, `CesRepository`, so this is a direct fix, not a
who-should-own-it answer).
- **Before:** `DEFAULT_WORM_COLLECTIONS = ['adminops_evidence']` — EO's `eo_approver_token_mints`
  collection (who minted an AdminOps approver token, for whom, tenant, expiry) had no repository-level
  WORM protection; any repo-holding caller could `put`-over, `update`, or `delete` a mint record.
- **After:** `DEFAULT_WORM_COLLECTIONS = ['adminops_evidence', 'eo_approver_token_mints']`. `put`,
  `update`, and `delete` on the collection all throw `CesWormError` for every caller by default — no
  per-caller opt-in race.
- **Tests:** 1 new test in `src/persistence/CesRepository.test.ts` (put-over, update, delete all
  throw; matches the REQ's stated acceptance exactly).

## [2.7.0] - 2026-09-27

### Added
- Evidence Collector (EC) contract **1.0.0** (`ces-shared/types/evidence-collector`, M1 of
  `ces-strategy/docs/context/evidence-collector/PLAN.md`): `EcHealthSchema`, `EcRunSchema`,
  `EcFindingSchema`, `EcEvidenceItemSchema`, `EcLedgerEntrySchema`. Field names on the first
  three mirror what `ces-eo/public/index.html`'s EC status page already reads
  (`status`/`mode`/`startedAt`/`version`; `runId`/`startedAt`/`runType`/`status`/`artifactsWritten`;
  `findingId`/`checkId`/`detectedAt`/`severity`/`status`). `EcEvidenceItemSchema` is `.strict()`
  and carries no `verdict`/`dryRun` field — either key (or any other unknown key) is rejected,
  so a verdict can never sneak into EC's manual-intake record. `EcLedgerEntrySchema` is
  ledger-only (no `controlIds`, no `verdict`) so an index pass over Stamper's tree can never be
  promoted into a counted item — Stamper evidence that EO already loads is never double-counted.
  31 new tests + 5 JSON fixtures under `src/types/__fixtures__/`.
- `getEcModuleRoot()` / `getEcTenantRoot(slug)` in `storage/node.ts`: EC's own module storage
  root (`{pipeline root}/EvidenceCollector/storage`), keyed per tenant, with a traversal guard
  (rejects empty/whitespace slugs, `..` segments, path separators, and the same reserved-char
  set as `sanitizeCustomerName`). `'EvidenceCollector'` added to `CesModuleName`. 8 new tests.
- Everything above exported from the package barrel `src/index.ts` and a new subpath
  `./types/evidence-collector`. 4 new dist-freshness tests. 39 new tests total (286 -> 325).

## [2.6.0] - 2026-09-27

### Added
- `requestLogger(service, { skipPaths })`: exact paths (query ignored) whose completion log line is suppressed;
  skipped requests still get and echo `x-request-id`. Zero-option calls unchanged. (W4-SH3, ces-eo REQ 2026-07-10)

## [2.5.0] - 2026-09-27

### Added
- Infra Manifest example `ces-shared/data/infra-manifest-example` (`src/data/infra-manifest.example.json`): a
  golden-style m365_azure manifest for Muster to target. It parses with `InfraManifestSchema`, meets Stamper's
  refinements (ISO date-time `generated_on`, explicit `infrastructure_model`) and carries every variable the
  Stamper BaselineProvisioner and network registry resolve. (W4-SH2)
- `InfraVariableMapSchema`: typed optional `identitySubnetCidr`, `peSubnetCidr` (Muster's names), `firewallName`,
  `publicIpName`, `vmName`, `vmImage`, `vmSize` (required by Stamper's infra registry). Previously these were kept
  only as untyped passthrough keys.
- `INFRA_VARIABLE_ALIASES`, `normalizeInfraVariableMap()`, `STAMPER_PROVISIONING_REQUIRED_VARIABLES`.

### Changed
- `InfraManifestSchema` copies the deprecated `fwSubnetCidr` (Muster) onto `firewallSubnetCidr` (Stamper) when the
  canonical key is absent or empty, and rejects a manifest where both are set to different values. Manifests
  without the alias parse exactly as before.

## [2.4.0] — 2026-09-27

### Added
- `ces-shared/http/principal` (request-principal surface **1.0.0**, `REQUEST_PRINCIPAL_VERSION`): `requirePrincipal()`
  middleware + `getRequestPrincipal(req)` give a module server the **verified** principal of a request (subject id,
  UPN, display name, roles, tenant). Token in the `x-ces-principal` header, verified by the local-only
  `createHs256PrincipalVerifier` (alg pinned to HS256, timing-safe compare, exp/nbf with skew, optional iss/aud);
  `signPrincipalToken` for local issuers/tests. Principal stored in a private WeakMap — never derived from body,
  query or request properties. Fail closed when unconfigured; `devPrincipal` is explicit, loopback-only and marked
  `verified: false, source: 'dev-unverified'`; `requiredRoles` → 403. (W4-SH1, REQ-shared-http-request-principal from ces-ao)

## [2.3.0] — 2026-09-27

### Added
- AdminOps evidence contract **1.2.0**: outcome `denied_sim_only` (sim-only safety-rail refusal), valid only on
  rows declaring 1.2.0+; never SAT; `isDenial()` includes it. 1.0.0/1.1.0 rows parse unchanged. (FX-SH1)
- AdminOps evidence contract **1.3.0**: optional `targetUPN` / `targetObjectId` (user the command acted on,
  distinct from operator UPNs); all prior versions parse unchanged. (FX-SH3, REQ from ces-eo)
- Execution-results contract **1.1.0**: optional `executablePlanId`; `contractVersion` accepts 1.0.0 and 1.1.0
  (`SUPPORTED_EXECUTION_RESULTS_VERSIONS`). (FX-SH3, REQ from ces-stamper)
- Mission-plan contract: typed parse output for `ManualMissionPlanSchema` plus exported envelope schemas/types
  (`CesPlanMetaSchema`, `OutputsBlockSchema`, …). (FX-SH2)

## [0.2.0] — 2026-07-04

First tracked release. Supersedes the frozen `0.1.0` scaffold version; establishes changelog +
SemVer discipline (G-ENG-5) now that a CI gate exists to enforce it (G-ENG-3).

Baseline capabilities at this version:
- **CesRepository** — single scope-enforced persistence layer over better-sqlite3 (`ces.db`);
  throws on empty scope; tenant-isolated; collections keyed by capability id.
- **canonicalSha256** — key-order-stable hashing (backs AdminOps params-hash-bound approvals).
- **Stack-provider config seam** (ADR-003) — resolves GCC High / commercial cloud endpoints;
  `subscriptionId` added for the ARM channel.
- **Shared types + config validators** (fail-fast `validateCesConfig`), and the `ces-ui.css`
  design system synced to each module via `scripts/sync-ui-assets.mjs`.

### Changed
- Coverage is now measurable (`npm run test:coverage`); no threshold gate yet.
