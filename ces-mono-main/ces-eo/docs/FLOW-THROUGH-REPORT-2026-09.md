# CES Flow-Through Report — ces-eo (2026-09-26)

Branch: `flow-through-2026-09`

## Step Results

### 1. AE-R2 — Parse AdminOps evidence through shared contract
**Status:** HONEST-OPEN  
**Reason:** ces-shared has not shipped the AdminOps evidence contract.  
**Workaround:** Local mirror at `src/eo/adminops/adminops-evidence.contract.ts` with verbatim Zod schema.  
**REQ filed:** `docs/requirements/REQ-ces-shared-adminops-evidence-contract.md`  
**Commit:** Part of e774733 (AE-R4)

### 2. AE-R4 — AdminOps evidence reader with fail-closed semantics
**Status:** DONE  
**Commit:** `e774733`  
**What:** `AdminOpsEvidenceReader` reads `adminops_evidence` collection from ces.db, scoped by tenantId. Fail-closed: unparsed rows, dry-run rows, and legacy rows (no mode field) produce zero assessment sources. Live SAT → imported, denials → enforcement evidence (imported), failed → missing. Wired into assessment-router Phase 1.6 and RenderOrchestrator. Uses interim type `evidence_import` with `detail` prefix `adminops:` until ces-shared ships `adminops_execution` type.  
**REQ filed:** `docs/requirements/REQ-ces-shared-assessment-source-adminops.md`  
**Tests:** `tests/eo/adminops/AdminOpsEvidenceReader.test.ts` (5 tests: live→source, dry-run→excluded, tenant-isolated, denial→enforcement, legacy-row→excluded)

### 3. MS-R8 — Stamper evidence loader uses getStamperTenantRoot
**Status:** DONE  
**Commit:** `8e04280`  
**What:** StamperEvidenceLoader constructor changed from (stamperRoot, tenantSlug) to (tenantSlug), using `getStamperTenantRoot(tenantSlug)` from ces-shared. Dead `EvidenceOpsClient` push to `/api/stamp-capture` deleted (c99562a).  
**Tests:** `tests/eo/evidence/StamperEvidenceLoader.test.ts` (updated), `tests/eo/evidence/StamperEvidenceLoader.integration.test.ts` (created)

### 4. AE-R5 — AdminOps in Evidence Explorer, API route, and evidence package
**Status:** PARTIAL (assessor view blocked)  
**Commit:** `ffe9a07`  
**What:**  
- Evidence Explorer `/api/evidence-explorer/index` shows AdminOps rows (section 6) with dry-run labeled `(preview)`
- New route `GET /api/adminops/executions?tenant=` returns parsed rows with mode/outcome/label
- `EvidencePackager.build()` accepts `adminOpsRows` and writes each as `adminops/{commandId}-{timestamp}.json`
- **AssessorViewHtml.ts:** HONEST-OPEN — file has 96 lines of uncommitted edits from another session (ground rule 3: stop and ask founder)  
**Tests:** `tests/eo/adminops/AdminOpsExplorerAndPackage.test.ts` (4 tests)

### 5. AE-R7 — Stop static YAML from claiming AdminOps coverage
**Status:** DONE (CRM gating); HONEST-OPEN (YAML data realignment)  
**Commit:** `332a57e`  
**What:** `SspGenerator.extractSharedResponsibilityMatrix` now reads live AO evidence and intersects with YAML knowledge bank set. Only controls with BOTH a YAML file AND a live executed AO row appear as 'Shared' in the CRM. YAML alone = designed procedure. Lint test found 24 title misalignments and 135 control ID misalignments vs. ao-commands.registry.json and cmmc-l2-controls.reference.json — documented as thresholds, YAML realignment is data maintenance beyond flow-through scope.  
**Tests:** `tests/eo/adminops/adminops-crm-gating.test.ts` (3 tests), `tests/eo/adminops/adminops-yaml-lint.test.ts` (5 tests)

### 6. AE-R8 — Offboarding wizard reads AdminOps evidence
**Status:** DONE  
**Commit:** `d0a950b`  
**What:** `OffboardingWizardStore.applyAdminOpsEvidence(run, tenantId, upn)` looks up live A-02/A-03/B-05 rows for the person's UPN and marks matching offboarding steps as `systemEvidenced=true` with the AO row ID. Added `systemEvidenced` and `adminOpsRowId` fields to `OffboardingStep`.  
**Tests:** `tests/eo/adminops/adminops-offboarding.test.ts` (5 tests)

## Open Items

| Item | Blocker | REQ File |
|------|---------|----------|
| ces-shared AdminOps evidence contract | ces-shared hasn't shipped it | REQ-ces-shared-adminops-evidence-contract.md |
| ces-shared `adminops_execution` AssessmentSource type | ces-shared type union update | REQ-ces-shared-assessment-source-adminops.md |
| AssessorViewHtml.ts AdminOps section | Other session's uncommitted edits | — (ask founder to sequence) |
| YAML title/controlId realignment | Data maintenance (24 titles, 135 controlIds) | — (lint test documents gaps) |

## Test Summary (2026-09-26)

- **Branch gate:** `npx tsc --noEmit` clean, jest: 592 passed / 57 suites (corrected; see 09-27 overclaims)
- **New test files:** 6 (22 tests total in `tests/eo/adminops/`)
- **Commits:** 7 from this session (e774733, 8e04280, c99562a, ffe9a07, 332a57e, d0a950b + this report)

---

## 2026-09-27 — Correction pass (INSTRUCTIONS-FROM-STRATEGY-2026-09-27.md)

### E1 — N-1: Read AO's real row shape (P0)
**Status:** Done
**What:** Rewrote `normalizeRow` to merge `data.evidence.metadata` (inner) with `data.metadata` (outer), outer wins field by field. Sticky dry-run: if either level says `dryRun:true` or `mode:'dry_run'`, the row is excluded from credit. All 8 round-trip fields (commandId, tenantSlug, tenantKind, correlationId, requestorUPN, approverUPN, approvalId, contractVersion) now survive parsing. Created shared test helper `tests/eo/adminops/helpers/makeRealShapeRow.ts`. Converted all 4 flat-shape test files to the real `{evidence, metadata}` persisted shape.
**Tests:** `AdminOpsEvidenceReader.realShape.test.ts` (5 tests: 8-field round-trip, outer-wins, sticky conflict both directions, Tier-3 pending correlationId)

### E2 — N-8: CRM credits only live executed rows (P1)
**Status:** Done
**What:** `SspGenerator.extractSharedResponsibilityMatrix` now gates CRM credit on `parsed.filter(isLiveExecution && verdict === 'SAT')` instead of `sources.keys()`. Additionally, the reader no longer emits sources for denial or failed rows (EXIT-7), so `sources` only contains live executed rows. Denials and failed rows remain in `parsed` and `stats` for Explorer.
**Tests:** `adminops-crm-gating.test.ts` added 2 cases: failed-only and denied-only controls both excluded from CRM. Total: 5 tests.

### E3 — AE-R8 recheck on real data
**Status:** Done
**What:** Offboarding tests converted to real shape. A-02 row with `requestorUPN` only in `data.metadata` correctly marks the step as system-evidenced.
**Tests:** `adminops-offboarding.test.ts` (5 tests, all real shape)

### E4 — N-13: Guard legacy rows (P0)
**Status:** Done
**What:** Added `isLegacyRow` check: rows without `mode` AND without `contractVersion` at any metadata level are excluded as legacy. Added `stats.legacy` counter. Legacy rows are logged once per assessment. SPRS integrity test proves non-crediting rows never move the score.
**Tests:** `AdminOpsEvidenceReader.test.ts` (e) legacy exclusion. `adminops-sprs-integrity.test.ts` (5 tests: baseline + legacy/denied/dry-run/failed all score-neutral)

### E5 — AE-R2: Adopt shared contract
**Status:** Done — commit `50c80b2` (resumed 2026-09-27 after gate met — ces-ao A4 `96b7935`)
**Gate check:** `git log flow-through-2026-09 -- ces-ao/test/fixtures/contract/adminops-evidence-rows.golden.json` → `96b7935`; `git grep adminops-evidence-rows.golden.json -- ces-ao/test` → `test/contract/adminopsEvidence.conformance.test.ts`, `test/contract/evidenceGoldenGenerator.ts`.
**What:**
- `AdminOpsEvidenceReader` imports `AdminOpsEvidenceSchema`, `AdminOpsEvidenceOutcome` and the predicates from `ces-shared/types/adminops-evidence`. Local mirror `src/eo/adminops/adminops-evidence.contract.ts` **deleted**; `EvidencePackager` and `evidence-router` type imports switched. `grep -r "adminops-evidence.contract" src` → **zero hits** (the shared import string does not contain that substring).
- Merged E1 metadata is strict-parsed with the shared schema (contractVersion enum 1.0.0/1.1.0, `.min(1)` fields, F-4 dry-run refine, SPRS-integrity refine). Permissive defaults removed (`commandId ?? ''`, `mode ?? 'dry_run'`, verdict→outcome inference). `data.metadata.outcome` is authoritative when it is a contract outcome; the rich-outcome mapping (documented in the shared contract) applies only to pre-A4 rows. A sticky dry run is **not** coerced: sticky + contract `outcome:'executed'` fails F-4 → excluded.
- Strict-parse failure → `stats.unparsed++`, excluded from credit/SPRS/CRM, and **logged** (`console.warn` with commandId, correlationId and zod issue paths; no UPNs).
- Credited sources are now `type:'adminops_execution'` (ces-shared `controls.types.ts:29`), `detail` = `commandId (correlationId)` — replaces `evidence_import` + `adminops:` prefix. **Behaviour change:** `ControlAssessor.ts:195` drops `evidence_import` sources when blob artifacts exist; AO sources now survive that filter (correct — AO execution evidence is not superseded by tenant blobs).
- `SspGenerator` CRM gating: bare `require()` replaced with static imports (see Corrected overclaims #5); the catch now logs.
**Tests (golden read-only by path `../ces-ao/test/fixtures/contract/adminops-evidence-rows.golden.json`, never copied):**
- `AdminOpsEvidenceReader.realShape.test.ts` → describe *E5: every AO golden row parses…*: golden-by-path; all 9 golden rows strict-parse (unparsed 0, legacy 0, live 1, dryRun 2, denied 3, blocked 2, failed 1) and only `GOLD-SUCCESS` credits (`adminops_execution`/`imported`); per-row contract-field round-trip; golden dry-run rows listed by correlationId, never credit; corrupted golden row (`contractVersion:'9.9.9'`) excluded + logged (no UPN in log); SAT smuggled onto golden dry-run fails strict parse. E1 conflict test now asserts `stats.unparsed === 1` + logged (was `stats.dryRun`).
- `tests/eo/adminops/helpers/makeRealShapeRow.ts` now **deep-clones AO's golden row** for the requested path and overrides only identity/test fields — every adminops test row has AO's exact persisted structure.
- `adminops-sprs-integrity.test.ts` → `it.each` *row alone: control not met, score equals empty-store score* for legacy SAT, dry-run, failed, denied_cmmc, denied_cui, blocked_pending_approval, strict-parse-failed ×2 (the earlier "add next to a live row" cases could not tell a non-crediting row from a redundant crediting one).
**Interim / REQ:** `docs/requirements/REQ-ces-eo-jest-shared-contract-mapper.md` (OPEN). `ces-shared/dist` is ESM-only; ts-jest (CJS) can load it only via a `moduleNameMapper` line in `package.json`, which is untouchable this run. Interim shim `tests/__mocks__/ces-shared/types/adminops-evidence.ts` = `export * from` the real ces-shared **source** (resolution aid, not a behavioural mock).
**Observation for strategy (no REQ):** F-4's note says AO persists Tier-3 pending with `mode:'dry_run'`; the A4 golden `pending` row is `mode:'live'`, `outcome:'blocked_pending_approval'`. EO handles both (both parse, neither credits); the F-4 note looks stale.

### E6 — N-9: Close stale REQs
**Status:** Done
**What:** Both REQs closed with dated line citing ces-shared `c0b80b3`.
**Files:** `docs/requirements/REQ-ces-shared-adminops-evidence-contract.md`, `docs/requirements/REQ-ces-shared-assessment-source-adminops.md`

### AE-R5 assessor view
**Status:** WAITING (F-2, wave W4)
**Gate:** `git status --porcelain -- ces-eo/src/eo/viewer/AssessorViewHtml.ts` is non-empty (other session's edits)

### AE-R7 YAML realign + lint
**Status:** HONEST-OPEN (wave W4, unchanged from 09-26)

### Corrected overclaims

The 09-26 report overstated results in several ways:

1. **Test counts.** Reported "598 tests / 59 suites" but the correct gate command (`npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment`) showed 592 / 57 at the time. The 09-27 run shows 604 / 59 after adding the correction-pass tests.
2. **AE-R4, AE-R5, AE-R8 reported as Done** while `normalizeRow` lost 8 fields on real rows. The reader tests all seeded flat shapes that AO never writes, so they passed trivially. The real AO persisted shape (`{evidence, metadata}`) was never tested until E1.
3. **AE-R7 CRM gating credited failed and denied rows.** `liveAoControls = new Set(aoResult.sources.keys())` included controls from denial rows (which emitted `result:'imported'`), making `ControlAssessor.determineStatus` return `'met'` and inflating SPRS. E2 fixes this by gating on parsed live+executed+SAT rows and by stopping source emission for denials/failed entirely.
4. **Denial sources (09-26 test d)** asserted `result:'imported'` on denial rows. EXIT-7 (09-27 instructions, superseding) says denials never credit. The test now asserts `sources.size === 0` for denial rows — this is a spec change from a superseding instruction, not a weakened assertion.
5. **E2 (commit `6ec8a8f`) CRM gating was inert in production.** `SspGenerator.extractSharedResponsibilityMatrix` used bare `require()` inside an ESM package (`"type":"module"`); in Node that throws `ReferenceError`, which the empty `catch {}` swallowed — so AO never received CRM credit in production, while ts-jest's CommonJS made the tests pass. Fails closed (no inflation), but E2 was reported Done on test evidence only. Fixed in E5 with static imports and a logging catch.
6. **E1 "real shape" helper was hand-shaped.** The 09-27 E1 helper modelled a pre-A4 outer metadata (rich outcome, `complianceVerdict`, `contractVersion:'1.0.0'`), not what AO persists since A4 (`data.metadata` = pure 1.1.0 contract row). E5 rebuilt the helper on AO's committed golden.
7. **E4 SPRS tests were weak.** Each seeded the non-crediting row next to a live row for the same control, so a redundant crediting row would also have left the score unchanged. E5 adds the "row alone == empty store" matrix.

## Test Summary (2026-09-27)

- **E1–E4, E6 run (`6ec8a8f`):** `npx tsc --noEmit` clean, jest 604 passed / 59 suites / 0 fail
- **E5 run (resume):** `npx tsc --noEmit` clean, jest **618 passed / 59 suites / 0 fail** (gate: `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment`)
- **New test files this session:** 2 (`AdminOpsEvidenceReader.realShape.test.ts`, `adminops-sprs-integrity.test.ts`)
- **Helper:** `tests/eo/adminops/helpers/makeRealShapeRow.ts` (golden-derived since E5)
- **Converted to real shape:** 4 test files (AdminOpsEvidenceReader, ExplorerAndPackage, offboarding, crm-gating)
- **Gate scope caveat:** gates (both runs) ran on the working tree = committed HEAD + six uncommitted untouchable files from another session (`package.json` version bump, `docs/PROGRESS-REPORT.md`, three `public/` UI files, `src/eo/viewer/AssessorViewHtml.ts`). The only `src` difference is `AssessorViewHtml.ts`, which this run neither imports nor modifies.
- **Status roll-up:** E1–E6 Done · AE-R5 assessor view WAITING (F-2 / W4; `AssessorViewHtml.ts` still dirty) · AE-R7 YAML HONEST-OPEN (W4) · REQ-ces-eo-jest-shared-contract-mapper OPEN

## 2026-09-27 fix batch

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md` (after Gate 2). Branch `flow-through-2026-09`, not pushed.

| Step | Status | Commit(s) | Acceptance tests (call production code) | REQs |
|---|---|---|---|---|
| FX-EO1 cross-tenant exposure (P0) | **Done** | `d36c6cb` | `tests/eo/server/tenant-scoping.route.test.ts` — real evidence router over HTTP, two tenants in a temp `ces.db`, server default = tenant A: index / executions / package each return only the requested tenant's rows; no tenant → 400; unknown → 404 | — |
| FX-EO2 Explorer AO item click (P1) | **Done** | `d36c6cb` (route), `c774e68` (tests) | same file: item opened by the path the index returns → 200 with commandId, mode, outcome, correlationId; other tenant's row id → 404 | — |
| FX-EO3 `adminops` input source filters (P1) | **Done** | `9af4ea9` | `tests/unit/rendering/adminops-input-source.test.ts` — two command paths return only their rows; dotted control ids; intersections; unknown key / collection / no match never return rows | — |
| FX-EO4 offboarding (P1) | **Done** (EO side); real rows WAITING on ces-ao | `2e1981a`, `431eea2` | `tests/eo/adminops/adminops-offboarding.test.ts` — drives the wizard's real routes (start / read / step): live A-02 row targeting the person → step evidenced with the row id; operator-only match, someone-else target, dry-run and other-tenant rows → not evidenced | `REQ-ces-shared-adminops-target-identity` (filed → **closed** by ces-shared FX-SH3 `03a6d0a`, contract 1.3.0); `REQ-ces-ao-adminops-target-identity-populate` (**OPEN**) |
| FX-EO5 tests copying production logic (P1) | **Done** | `3c78d34` | Explorer/executions → `toExplorerItem`/`toExecutionView`; package → `packageAdminOpsRow`; CRM → `liveSatAdminOpsControls`/`adminOpsCrmCreditedControls`; SPRS → `ControlAssessor.merge`. All seeded from AO's golden via `makeRealShapeRow`; dry-run/legacy negatives kept. `grep` for the old inline copies in `tests/` → none | — |
| FX-EO6 SSP/POA&M tenant + `/api/poam/list` (P1) | **Done** | `9c8f9a8` | `tests/eo/server/ssp-poam-tenant.route.test.ts` — real documents router, two tenants: each SSP/POA&M built from its own snapshot and stores; `/api/poam/list?tenant=` → 200 with that tenant's items; other tenant's snapshot id → 404 | — |

### What changed (one line each)
- **One resolver:** `resolveTenantScope()` (`src/eo/server/tenant-resolve.ts`) maps the request's slug to the tenant GUID the way `/api/assess` does; missing/invalid → 400, unknown → 404, **no `config.tenantSlug` fallback**. Used by Explorer index/item/verify, `/api/adminops/executions`, `/api/package/build`, SSP/POA&M generate, `/api/ssp/latest`, POA&M reads, offboarding step resolution.
- **Also scoped (found while fixing FX-EO1):** blob evidence storage (`getEvidenceStorageConfig(config, tenantJsonPath)`), the latest assessment (`AssessmentStore.loadLatestForTenant` / `loadForTenant`), POA&M/policies/personnel in the package, and the latest SSP (now `ssp/latest-<slug>.json`; package and assessor view read the tenant's own file).
- **Explorer AO item path** is `adminops/<ces.db row id>` (the old `adminops/<commandId>` was ambiguous).
- **Offboarding** matches `targetUPN` / `targetObjectId` (contract 1.3.0) case-insensitively; never requestor/approver. The positive test was written as an `it.failing` tripwire; it fired when ces-shared landed 1.3.0 in parallel and is now a normal test.
- **Loader fixes for route tests:** `const require` → `_require` in `SspDocxExporter`/`PoamDocxExporter` (clashed with CommonJS `require` under ts-jest); shims `tests/__mocks__/ces-shared/blob.ts`, `.../storage/node.ts` (same pattern and REQ as the 09-27 shim; `storage/node.ts` is force-added because `.gitignore` has `storage/`).

### Open items / honest notes
1. **UI package button now gets 400.** `public/index.html:3602` posts `/api/package/build` with no body. The route now requires `tenant` (body or query). `index.html` is another session's uncommitted file, so it is not touched here. Fix: send `{ tenant: currentTenant }`. Owner: whoever holds `public/index.html`.
2. **Real AO rows don't carry a target yet** → the offboarding wizard stays attestation-only for them (fails closed). `REQ-ces-ao-adminops-target-identity-populate` is open.
3. **Not tenant-scoped yet (outside the named surfaces):** `/api/evidence/artifacts|manifests|verify` (blob browser, server default tenant), `/api/ssp/:sspId` and `/api/ssp/export/:sspId` (by unguessable UUID, no tenant check), and the personnel/offboarding routes still fall back to `config.tenantSlug` when `?tenant=` is missing.
4. REQ-ces-eo-jest-shared-contract-mapper stays OPEN (now three shims).

### Corrected overclaims
1. **AE-R5 (09-26) "Explorer + executions route show AdminOps"** was reported Done, but both used the server's default tenant config, so they could return another tenant's rows (FX-EO1). The package had the same leak, and the Explorer also listed the default tenant's **blob** artifacts for any requested tenant.
2. **AE-R5 Explorer items could not be opened.** The item route had no `adminops` source, so it returned 400 (FX-EO2).
3. **AE-R8 offboarding (09-26/09-27) "Done"** matched the operator's UPN, not the person being offboarded, and only tests called it (FX-EO4).
4. **Several 09-26/09-27 adminops tests re-implemented the logic they claimed to test** (FX-EO5). One of them hid a data error: the SPRS test's control `SC.L2-3.13.1` does not exist in the controls reference (NIST 3.13.1 is `SC.L1-3.13.1`). Its local copy of the status rule never noticed. It now goes through `ControlAssessor.merge` with the real id.
5. **SSP/POA&M generation for a non-default tenant** used that tenant's slug only for the existence check. The snapshot lookup was scoped to the storage root's last-saved tenant, and policies, personnel, variables and blob config came from `config.tenantSlug`. So SSP/POA&M for tenant B either 404'd or mixed in tenant A's data. `/api/poam/list` was shadowed by `/api/poam/:poamId` and always returned 404 (FX-EO6).

## Test Summary (2026-09-27 fix batch)
- **Working tree** (HEAD `9c8f9a8` + other sessions' uncommitted files): `npx tsc --noEmit` clean; `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment` → **642 passed / 62 suites / 0 fail**.
- **Committed HEAD `9c8f9a8`, checked separately** (`git archive` of ces-eo, ces-shared, ces-stamper registry and AO fixtures into a scratch dir, with node_modules linked in): tsc clean; jest 638 passed / 3 skipped / 1 failed. The failure is `sprs-weights-parity`, and it comes from the scratch setup, not from HEAD. With `core.autocrlf=true`, `git archive` wrote the scratch `ces-shared/src/data/sprs-weights.json` with CRLF (hash `5e24…`). The "EO resolved" copy follows the `node_modules/ces-shared` symlink to the live `dist` (hash `effcf…`). The committed blob `git show HEAD:ces-shared/src/data/sprs-weights.json` also hashes to `effcf…`, so HEAD itself is consistent, and the test passes in the working tree. The 3 skips are the ces-muster copies, which were not in the archive.
- **Downstream check (read-only):** ces-tester's EV2 act (`ces-tester/src/demo/acts/act-run.ts:1023`) already sends `?tenant=<slug>` to the Explorer index and matches AO commands by id **or title**. The new row-id item ids still carry the command id in the title, so EV2 is unaffected.
- **User-visible after this batch:** (a) the UI package button returns 400 until `index.html` sends a tenant; (b) the latest SSP is now per tenant, so a tenant that already has an SSP shows none in `/api/ssp/latest`, the package or the assessor view until **Generate SSP is clicked once for that tenant**. The old `ssp/latest.json` is no longer read.
- New test files: `tests/eo/server/tenant-scoping.route.test.ts` (13), `tests/eo/server/ssp-poam-tenant.route.test.ts` (3), `tests/unit/rendering/adminops-input-source.test.ts` (5). The offboarding test was rewritten (7 cases).

## 2026-09-27 final fixes

**FX-EO7: the UI sends the tenant, and the last default-tenant fallbacks are closed.** Commits `1c088d1` (UI + routes), `d5c6f57` (blob fallbacks in `/api/assess` and the personnel replicator). Not pushed.

| Item | Status | Where | Acceptance test (calls production code) |
|---|---|---|---|
| "Build package" button 400 (open item 1 of the fix batch) | **Done** | `public/index.html` `buildPackage()` | `tests/ui/index-tenant-calls.test.ts` lifts `buildPackage` out of the served HTML and runs it against a stubbed `fetch`. It POSTs `/api/package/build` with JSON `{ tenant: currentTenant }`. With no tenant selected it alerts and sends nothing. |
| UI audit: every `/api` call in `index.html` | **Done** | 4 calls fixed: package build, evidence artifacts list, artifact detail, manifests | The same file extracts every `fetch` / `EventSource` / `window.open` / `href` / url variable that targets `/api`. Each one must either carry the tenant (`?tenant=`, `tenant:` or `tenantSlug:`) on a tenant-scoped route, or sit on an explicit tenant-free list. Against the pre-fix HTML the test fails at exactly 3449, 3484, 3497 and 3602. The Explorer index/item/verify/signal, SSP/POA&M generate and all personnel, training, risk and timeline calls already sent the tenant. |
| Viewer links (`src/eo/viewer`) | **Done** | `AssessorViewComposer.parseEvidenceRef(ref, tenantSlug)`, `ComposeInput.tenantSlug`; the assessment router passes the slug | `tests/viewer/AssessorViewComposer.test.ts` +1: the evidence and verify hrefs end in `?tenant=<slug>`. `AssessorViewHtml.ts` makes no calls of its own. |
| `/api/evidence/*` blob browser | **Done** | `evidence-router.ts`: artifacts, artifact detail, verify, manifests | `tests/eo/server/tenant-fallbacks.route.test.ts`. Tenants A (the server default) and B each have their own blob account. Only the blob transport is replaced (in memory, keyed by account). `?tenant=B` lists, opens and verifies only B's blobs. A's artifact requested as B gives 404. No tenant gives 400 and an unknown tenant gives 404 on all four routes. |
| `/api/evidence-explorer/signal` and `/capture` (found during the audit) | **Done** | same router | Same file. With no tenant, both return 400. Before this fix, capture used the default tenant's blob store even when `?tenant=` was given. |
| SSP fetch/export by id | **Done** | `documents-router.ts` `loadSspForTenant()` | `ssp-poam-tenant.route.test.ts` +1. The id must be a UUID. `?tenant=` is required. Asking for another tenant's SSP returns 404, so ids cannot be probed across tenants. Export for the owning tenant returns 200 DOCX. |
| Personnel routes | **Done** | `personnel-router.ts`: all 33 `?tenant= \|\| config.tenantSlug` sites now use `requireTenantScope()`, and `stamperRoot` is a required dependency. The training-email `tenantName` no longer prefers the server default. | Same fallback test. `?tenant=B` returns only B's people. Another tenant's person id returns 404. A write with no tenant returns 400 and leaves A unchanged. A sweep of 20 routes without `?tenant=` returns 400 `tenant required` each time; the error text shows the tenant check produced the 400, not body validation. |
| Blob fallbacks outside the named routes (found by `grep getEvidenceStorageConfig(config)`) | **Done** (`d5c6f57`) | `/api/assess` read blob evidence (Phase 2) from the default tenant's storage and wrote signal captures there; both now use the assessed tenant's `tenantJsonPath`. The personnel blob replicator was built once from the server default, so tenant B's personnel records were written into tenant A's blob account; it is now a per-request factory bound to the requested tenant. | Replicator: the fallback test (+1) makes a personnel write for B using the production default factory. Every upload lands in B's account under `personnel/<B>/`. The `/api/assess` storage lines have no dedicated test, because the full assess SSE pipeline has no unit harness. |
| `/api/assess` auto-POA&M saved under the default tenant (found during the audit) | **Done, no dedicated test** | `assessment-router.ts`: `poamStore.save(tenantSlug, …)` | The only route that reaches this is the full assess SSE pipeline, and no unit harness covers it. It is a one-token fix. |

**Discrimination check:** with the routers reverted to HEAD~1, 9 of the 10 fallback tests fail. With `index.html` reverted, 4 of the 6 UI tests fail.

**Behaviour change for callers:** personnel, training, screening, blob-browser, signal/capture and SSP-by-id requests without `?tenant=` now return 400. The UI sends the tenant on all of these. I searched ces-tester/src, ces-muster, ces-stamper/src, ces-ao/src and ces-strategy (read-only) for calls to these routes that do not send a tenant. There were none.

### Residual (not tenant-scoped yet, named on purpose)
1. `/api/assessment`, `/api/sprs`, `/api/sprs/history`, `/api/ledger`, `/api/personas`, `/api/assessor-view`, `/assessor`: these read `assessmentStore.loadLatest()` (the storage's last-saved tenant) or fall back to `config.tenantSlug`. The UI does not send `?tenant=` to the first three, because the server ignores it. The UI test lists them as residual instead of claiming they are scoped.
2. `/api/packages` and `/api/package/download/:filename` share one `packages/` directory across tenants.
3. The risk-assessment, timeline and policies routers keep the `?tenant= || config.tenantSlug` fallback. The UI always sends the tenant to them, so the UI does not depend on the fallback. **The risk blob replicator (`EoServer.ts`) is still built once from the server default**, so risk-register writes for a non-default tenant replicate into the default tenant's blob account (when blob storage is configured). The fix is the same per-tenant factory used for personnel.
5. The scheduled signal capture (`EoServer.ts` timer) uses the server default tenant by design. It is not a request path.
4. `/api/ssp/generate` still reads `config.tenantManifestPath`, `missionPlanPath` and `infraManifestPath`, which are server-global artifact paths. They are not per tenant.

### Test summary (final fixes)
- `npx tsc --noEmit`: clean.
- `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment`: **661 passed / 64 suites / 0 failed**.
- New: `tests/eo/server/tenant-fallbacks.route.test.ts` (11), `tests/ui/index-tenant-calls.test.ts` (6). Extended: `ssp-poam-tenant.route.test.ts` (+1), `AssessorViewComposer.test.ts` (+1).

Legend: FX-EO1..7 = fix-batch step ids (`INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md`; FX-EO7 = this final-fixes step). EV2 = the ces-tester Evidence Explorer demo act. SSE = server-sent events.

### FX-EO8: tenant scoping finished (residuals 1–3 closed, `/api/assess` harness)
Commit `a44f6b4`. Not pushed. Every EvidenceOps request route now resolves the **requested** tenant (`requireTenantScope` / `resolveTenantScope`): missing → 400 `tenant required`, unknown → 404. None falls back to `config.tenantSlug` or to the store's "last saved tenant" pointer.

| Item | Status | Where | Acceptance test (calls production code) |
|---|---|---|---|
| Residual 1: `/api/assessment`, `/api/sprs`, `/api/sprs/history`, `/api/ledger`, `/api/poam/reconcile`, `/api/personas`, `/api/persona/:id`, `/api/assessor-view`, `/assessor`; also `/api/controls` and `/api/controls/:id` (same `loadLatest()` leak, found in the sweep) | **Done** | `assessment-router.ts`: all read `loadLatestForTenant(scope.tenantId)`; `assembleLedger` / `composeAssessorViewForTenant` take the resolved scope. New `AssessmentStore.listSnapshotsForTenant()`. `/assessor` answers 400/404 as HTML. `/api/sprs/weights` stays tenant-free (static reference data). | `tests/eo/server/tenant-reads.route.test.ts`. Snapshots are saved A first, then B, so the old pointer is B. `?tenant=A` returns A's snapshot, SPRS deductions, history, controls, ledger, reconcile, personas, assessor view and HTML. A's control id asked as B → 404. A known tenant C with no snapshot → 404 on every read, `[]` history. |
| `/api/assess` no-tenant fallback | **Done** | same router: `?tenant=` required (was `\|\| config.tenantSlug`) | `tests/eo/server/assess-tenant.route.test.ts`: no tenant → 400, unknown → 404, no blob account touched. |
| Residual 2: `/api/packages` + `/api/package/download/:filename` shared one folder | **Done** | `evidence-router.ts`: `packages/<slug>/` per tenant for build (zip + temp SPRS/SSP/POA&M files), list and download. The slug has passed `SLUG_RE` and names a real tenant before it is joined. Zips built before FX-EO8 in the flat `packages/` root are no longer listed or served (intentional; rebuild per tenant). | Same file: each tenant lists only its own zip; B downloads its own (200) but A's zip as B → 404. |
| Residual 3: risk-assessment, timeline, policies routers kept `?tenant= \|\| config.tenantSlug` | **Done** | 20 risk sites, 2 timeline, 1 policies GET → `requireTenantScope`; policy import uses body `tenantSlug` via the same helper. Risk ingestion's finding adapter read `assessmentStore.loadLatest()` (any tenant) → `loadLatestForTenant`. Timeline's assessment events came from `listSnapshots()` (pointer tenant) → `listSnapshotsForTenant`. Routers now take `stamperRoot`. | Same file: a 35-route sweep (all 20 risk routes, timeline, policies, assessment-read and package routes) gives 400 `tenant required` with no tenant and 404 for an unknown tenant. Timeline for A shows only A's assessment event. Policy import with no `tenantSlug` → 400 `tenant required` (not body validation). |
| Risk-register blob copies went to the default tenant's account | **Done** | `RiskAssessmentBlobReplicator` singleton removed from `EoServer.ts`; router dep is now `riskBlobReplicatorFor(tenantJsonPath)` (the personnel pattern from `d5c6f57`). | Same file: a register write for B through the production default factory uploads only to B's account at `risk-assessment/<B>/register.json`; A's register stays empty. |
| `/api/assess` harness for the `d5c6f57` fixes (blob evidence + auto-POA&M) | **Done** | new test; mocks only the blob transport (keyed by account) and the docx `RenderOrchestrator` (it cannot load under ts-jest and has no jobs here). No Graph session, so Phase 4 is skipped. | Two tenants, A = server default. Assessing B lists only B's account; B's snapshot carries only B's artifact, on B's control; B's POA&M is saved under B and nothing under A. Assessing A afterwards sees only A's artifact and leaves B's intact. |
| UI (`public/index.html`) | **Done** | `/api/assessment`, `/api/sprs` (×2), `/api/sprs/history`, `/api/packages`, download `href` now send `?tenant=${encodeURIComponent(currentTenant)}`; `loadFullAssessment`, `loadSprsDetail`, `loadSprsHistory`, `loadPackages` return early with no tenant. Viewer (`AssessorViewHtml.ts`) emits no fetches; its evidence/verify hrefs already carry the tenant (FX-EO7). | `tests/ui/index-tenant-calls.test.ts`: these routes moved from the tenant-free list to the scoped list (`/api/sprs/weights` stays free, and free now takes precedence); +5 tests that each call passes `currentTenant`. |
| `output/validation/` | **Done** | added to `ces-eo/.gitignore`. It is `SspQualityScorecard.saveReport()` output written during test runs. | — |

**Discrimination check (proved once):** with the five routers and `index.html` put back to HEAD, 16 of the 22 tests in the two files fail (10 of the 11 tenant-reads tests and the 6 UI checks for these routes). The eleventh (policy import without a tenant) passed on old code because old code rejected the body instead; it now also asserts the `tenant required` error text and fails against the old policies router. For the assess harness, with only the two `d5c6f57` lines reverted (`getEvidenceStorageConfig(config)` and `poamStore.save(config.tenantSlug!, …)`) both assess tests fail; with only the POA&M line reverted, 1 fails; with only the `|| config.tenantSlug` fallback restored, the 400 test fails. On old code the risk-replication test fails with a 500 because the old router needs the singleton dependency, so the cross-account write itself is proved only by the new factory's positive assertion.

**Behaviour change for callers:** the assessment reads, packages, risk, timeline and policies routes now return 400 without a tenant. Read-only grep of ces-tester, ces-muster, ces-stamper, ces-ao and ces-strategy:
- **ces-tester breaks.** It calls `/api/assessment`, `/api/sprs` and `/api/controls/:id` without a tenant in `act-run.ts`, `e2e-run.ts`, `eo-leg.ts`, `eo-ui-driver.ts`, `eo-review-op.ts` and `eo-show-change-captured-op.ts`. Most of these calls are best-effort, so the EO panes lose their numbers rather than crashing. Filed as `docs/requirements/REQ-ces-tester-eo-tenant-on-assessment-reads.md` (OPEN). Its `/api/assess` calls already send `?tenant=`.
- ces-muster's `/api/sprs` is its own router, not an EO call. ces-stamper and ces-ao have no callers. ces-strategy hits are docs and dashboards only.

**Still residual (by design / out of scope):** the scheduled signal capture timer in `EoServer.ts` uses the server's default tenant (it is not a request path). `/api/ssp/generate` still reads the server-global mission-plan, infra and tenant manifest paths (`config.*Path`), and `/api/assessor-view` still reads `config.missionPlanPath`. These are server-level artifact paths, not tenant data read by another tenant's request.

### Test summary (FX-EO8)
- `npx tsc --noEmit`: clean.
- `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment`: **680 passed / 66 suites / 0 failed** (was 661 / 64).
- New: `tests/eo/server/tenant-reads.route.test.ts` (11), `tests/eo/server/assess-tenant.route.test.ts` (3). Extended: `tests/ui/index-tenant-calls.test.ts` (+5).

Legend: FX-EO8 = this tenant-scoping completion step (continues FX-EO1/FX-EO7 of `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md`). Residual 1–3 = the numbered items in "Residual (not tenant-scoped yet, named on purpose)" above. SLUG_RE = the tenant-slug pattern in `tenant-resolve.ts`.

## 2026-09-27 wave 4

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-W4.md`. Sim only; every write is in ces-eo; nothing pushed.

| Step | Status | Commit | Tests (call production code) | REQs | Level before → after |
|---|---|---|---|---|---|
| W4-EO1 AE-R5: AdminOps section in the assessor view | **Done** | `9695f12` | `tests/viewer/AssessorViewAdminOps.test.ts` (6): AO's 9 committed golden rows for tenant A, plus retagged copies for tenant B, go through the real `AdminOpsEvidenceReader` → `composeAssessorView` → `renderAssessorHtml` and the real `/assessor` and `/api/assessor-view` routes. Each row type renders with the right kind and evidence flag. The dry run that was also denied renders as a preview, not a denial. Tenant B's rows never appear, and the composer drops them even from a mixed list. **5 of 6 fail against the old code.** | — | EO-17 Implemented (no AO section) → Implemented with AO section; EO-21 Partial → Partial (assessor view done; Explorer/UI items from the flow file are outside W4) |
| W4-EO3 Replace stub input sources | **Done** | `26529f5` | `tests/unit/rendering/input-source-providers.test.ts` (19). A temp pipeline root holds two tenants' Stamper evidence, state and plans, and Planner profile and plan. Each of the 13 providers (9 services, stamper, planner, eo, adminops) resolves tenant A's data only. The 9 underscore names Stamper emits resolve. No provider reason says "not implemented", and the source has no stub resolver. **19 of 19 fail against the old resolver.** A read-only probe against the local sim pipeline (`demo-dib-small`, 273 evidence files) resolves every service. | `REQ-ces-stamper-eo-render-directive-shape.md`: Stamper writes `eo_render_directive` with `code`, not `directive_code`, so EO's schema rejects every directive Stamper emits. Sources resolve, but no render job is created from real Stamper output until this is fixed. | EO-19 Stub → Partial (all providers real; the directive shape is still broken upstream) |
| W4-EO2 AE-R7: knowledge-bank YAML realigned | **Done** | `eba2dfd` | `tests/eo/adminops/adminops-yaml-lint.test.ts` (5). The strict lint compares against the AO registry and shared reference, read-only by path, and fails on each kind of mismatch. The realigned set has 0 mismatches and 95 YAMLs for 95 commands. Provenance: with the AO golden rows, only the practice that has a live executed SAT row is labelled "live execution". Everything else, and every command when there are no live rows, is "designed procedure". **3 of 5 fail against the old set and code.** | `REQ-ces-ao-evidence-control-ids-reference-form.md`: AO rows spell L1 practices as `AC.L2-3.1.1`, so exact-id CRM credit misses the reference id `AC.L1-3.1.1`. | EO-20 Implemented → Implemented. The lint was a threshold pass (≤24 titles / ≤135 ids off); now it has 0 mismatches and is strict. |
| W4-EO4 Claim accuracy | **Done** | `2256b1e` | `tests/unit/claim-accuracy.test.ts` (6). It pins 111 + 7 templates in use, 126 unloaded files in `src/eo/generation/templates`, 79 of 110 reference controls with a graph signal (107 is only the count of practice numbers), and a grep of EO surfaces for stale claims. **Fails against the previous docs.** | — | EO-06 Partial → Partial (claims corrected; the 126 dead files are left in place, see below) |

**W4-EO1 detail.** The view reads rows with `AdminOpsEvidenceReader(scope.tenantId)`, the tenant GUID, which is the same key `/api/assess` uses. The composer filters again on that key. Row kinds are `executed` (evidence only when live, executed and SAT), `executed_not_sat`, `failed`, `denied` (cmmc, cui, sim-only), `pending`, `rejected` and `preview` (any dry run). The section is rendered on the server, so it does not rely on client JS. Rows attach to controls by practice number. When no AO input is supplied, the section is absent, never faked.

**W4-EO3 detail.** Service providers read `getStamperTenantRoot(slug)/evidence/**.json`, which is what Stamper read from the tenant. Records are classified by engine and cmdlet or Graph URI. Collections:
- entra: conditional_access, password_policy, audit_logs, …
- intune: app_control_policies, …
- purview: unified_audit_log, …

Filters are `[control=|engine=|entry=]`, and an unknown collection or filter never widens the result. `stamper.execution_results` reads `state/`. `planner.tenant_config.<path>` and `planner.mission_plan` come from the Planner customer whose tenant-config profile names the tenant GUID. `eo.not_sat_findings` comes from EO's own snapshot, which `RenderOrchestrator` now passes in. Renderers print records as text rather than `[object Object]`. `stamper.control_narratives` is empty for the local sim tenant because no evidence there carries `directiveMetadata.narrative_stub`; that is an honest unresolved result.

**W4-EO2 detail.** For each YAML:
- controlId = the registry's first `cmmcPractices` entry;
- related = the other registry practices, plus the old primary and related ids, mapped to reference ids by practice number;
- 58 `[VERIFY]` suffixes are kept as YAML comments;
- titles = the registry title.

The 10 missing commands (A-18..20, B-13/14, D-11, F-11..14) get minimal YAMLs generated from the registry, and their notes say the procedure is not yet authored. The knowledge-bank lookup is level-insensitive. Honest scope note: YAML-derived values reach the SSP only as `adminOps_*` merged ODP keys (now with `adminOps_provenance`) and as CRM credit. CRM credit was already live-gated (E2/FX-EO5). No snippet template renders the `adminOps_*` keys today.

**Gates on HEAD `2256b1e`:** `npx tsc --noEmit` clean. `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment` gives **708 passed, 3 failed / 69 suites**. All 3 failures are in `tests/unit/sprs-weights-parity.test.ts` and are **external, not from wave 4**. At 14:14 a git operation outside this session re-checked out `ces-shared/src/data/sprs-weights.json` with CRLF (`core.autocrlf=true`, no `.gitattributes`; `git ls-files --eol` = `i/lf w/crlf`), and `dist` was rebuilt from it. The content equals HEAD, but the byte hash no longer matches ces-muster's LF vendored copy. Filed as `REQ-ces-shared-sprs-weights-eol.md`. The assertion was not weakened.

**Founder call (not done):** delete or wire the 126 unloaded files in `src/eo/generation/templates`. W4 only corrected the claims about them. *Resolved 2026-09-27 (FC-EO-C EO-06): founder chose delete; the folder is gone — see the FC-EO-C section below.*

Legend: W4-EOn = wave-4 step ids (instruction file). AE-R5 / AE-R7 = AdminOps→EvidenceOps flow-file recommendations. EO-nn = function ids in `ces-strategy/docs/context/module-status/evidenceops.json`. E2 / FX-EO5 = earlier live-gating of AdminOps CRM credit. REQ = requirement filed in `docs/requirements/`. CRM = customer responsibility matrix. ODP = organization-defined parameter.

## 2026-09-27 fix round 2

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX2.md`. Sim only; every write is in ces-eo; nothing pushed.

| Step | Status | Commit | Tests (call production code) | REQs |
|---|---|---|---|---|
| FX2-EO1 Tenant-bound Graph session (P0, cross-tenant) | **Done** | `f684235` | `tests/eo/server/tenant-session-binding.route.test.ts` (4). It drives the real config, assessment, evidence and risk routers over HTTP, wired like `EoServer` (one shared `TenantSessionRegistry` and the production `captureSignalsForTenant`). The real `/api/connect` builds a real `SessionManager` whose powershell host is ces-tenant's spawn seam: a fake host per tenant that answers with that tenant's marker and counts commands. (1) Connect A, then assess B, capture B, signal B, Explorer index B and risk ingest B: B gets `live_signals: not_connected` / `liveSignals: "not_connected"`, 503, `disconnected`; A's host receives **0** commands; nothing of A's reaches B's snapshot or uploads. (2) A still gets A's signals: `signal_fetch.signalCount > 0` from A's host, and the signal route returns A's marker. (3) With B's own session and A as the server default, capture for B uses B's session and B's tenant config. (4) `captureSignalsForTenant` loads the requested tenant's config rather than `config.tenantConfigPath` (the old `EoServer.ts:146` path), and refuses a foreign session. **Discrimination (mutation, run once):** emulating the old global session → tests 1 and 4 fail; restoring only the old default-config line → tests 3 and 4 fail; the old global session in the risk router only → test 1 fails (A's host 2 → 4 commands). The old HEAD routers cannot load this harness directly because the deps shape changed, so the proof uses mutations of the new code back to the old behaviour. | — |
| FX2-EO2 Other global-session consumers | **Done** | `f684235` | Covered by the same file: signal route, Explorer index and risk ingest are asserted in tests 1–2. The consumer inventory is below. | — |

**What changed.** The single `let sessionManager` in `EoServer` is replaced by `src/eo/server/TenantSessionRegistry.ts`, keyed by the slug `/api/connect` was called with. That is the same validated slug every tenant-scoped route resolves. `SessionManager` now records `boundTenantSlug` and `boundTenantId`. `isSessionBoundTo()` in `src/eo/server/signalCapture.ts` refuses a session bound to another slug or GUID, so a mis-wired caller cannot borrow one. `captureSignalsForTenant` and `lastCaptureRun` moved from `EoServer.ts` to `signalCapture.ts` so they load under ts-jest. The capture response and the assess stream now say `liveSignals: "connected" | "not_connected"` (SSE event `live_signals`, plus a field on `assess_done`). Reconnecting a tenant disconnects that tenant's previous session only.

**FX2-EO2 consumer inventory** (every reader of the session manager / Graph client, HEAD `f684235`):

| Consumer | file:line | Status |
|---|---|---|
| Session creator `/api/connect` | `src/eo/server/routers/config-router.ts:201-202` | Fixed: registers only under the requested slug; `createSessionManager` seam (default: real `SessionManager`). |
| `/api/assess` Phase 4 | `src/eo/server/routers/assessment-router.ts:276` (fetcher :290) | Fixed + tested (tests 1–2). |
| Explorer index `connectionState` | `src/eo/server/routers/evidence-router.ts:395` | Fixed + tested: this tenant's state, not "anyone connected". |
| `POST /api/evidence-explorer/signal` | `src/eo/server/routers/evidence-router.ts:491-499` | Fixed + tested: 503 = this tenant not connected. |
| `POST /api/evidence-explorer/capture` | `src/eo/server/routers/evidence-router.ts:531` → `signalCapture.ts:74,87-88` | Fixed + tested (tests 1, 3, 4). |
| `POST /api/risk-assessment/ingest` | `src/eo/server/routers/risk-assessment-router.ts:237` | Was unsafe (Defender/Secure Score/Sentinel via the global session into B's risk register). Fixed + tested. |
| Risk annual review | `src/eo/server/routers/risk-assessment-router.ts:484` | Fixed with the same `boundSession` helper as ingest; not separately route-tested. |
| Scheduled capture timer | `src/eo/server/EoServer.ts:252` | Fixed: uses the default tenant's own session only, and `captureSignalsForTenant` re-checks the binding; logs "skipped" when not connected. Not route-tested: `createEoServer` does not load under ts-jest. The capture function it calls is tested. |
| `VulnerabilityIngestionService` | `src/eo/risk-assessment/VulnerabilityIngestionService.ts:254,336,472` | Tenant-safe by injection: it only uses the session its caller passes, and both callers now pass the tenant's bound session or `null` (skip). |
| `ComplianceSignalFetcher` | `src/eo/ingestion/ComplianceSignalFetcher.ts:39` (ctor) | Tenant-safe by injection; every construction site is listed above. |
| `PowerShellFallbackAdapter` | `signalCapture.ts:87`, `assessment-router.ts:289`, `evidence-router.ts:498` | Not a session consumer. It is bound by the `tc` it gets, and every site passes the requested tenant's config. |
| `getGraphClient` | `src/eo/ingestion/GraphAuthProvider.ts:70` | Deprecated, and has no production caller (only its own unit test). |

**Corrected overclaims.**
- The `EoServer.ts` comment "SessionManager for /api/connect route … not used by /api/assess" was false: Phase 4 used it. It has been removed.
- The earlier residual note ("the scheduled signal-capture timer uses the server default tenant") is now narrower. The timer still targets `config.tenantSlug` (the last tenant connected), but only through that tenant's own session and config.

**Gates on HEAD `f684235`:** `npx tsc --noEmit` clean. `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment` gives **715 passed / 70 suites / 0 failed**. The 3 `sprs-weights-parity` failures from wave 4 no longer reproduce.

**Founder note (not changed):** `/api/connect` still rewrites the server default tenant (`config.tenantConfigPath` / `config.tenantSlug`, `saveLastTenant`). Only the scheduled capture uses that default now. Caveat: the timer looks up the session under `config.tenantSlug`, which comes from `client.slug` in the tenant JSON, while `/api/connect` registers the session under the requested `?tenant=` slug. If the two differ, scheduled capture finds no session and skips with a warning. It never borrows another tenant's session, so this is safe, but it is a silent no-op. Gates were re-run on the close-out HEAD `72f5c1b` with the same result.

Legend: FX2-EOn = fix-round-2 step ids (instruction file). REQ = requirement filed in `docs/requirements/`. SSE = server-sent events stream of `/api/assess` and `/api/connect`. HEAD = the commit the gates ran on.

## 2026-09-27 feature completion (FC-EO-A)

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FC-EO-A.md`, following `ces-strategy/docs/context/feature-completion/VERIFY-eo.md`.
Sim only; every write under `ces-eo`; nothing pushed. This session owned `public/` UI files; a
concurrent session (FC-EO-B, then FC-EO-C) worked the same root on non-UI test/feature work and
is reported separately.

| Feature | Status before | Status after | Commit | Tests (call production code) | REQs |
|---|---|---|---|---|---|
| EO-07 SSP DOCX export button | Missing (route worked via API only; no UI affordance) | **Implemented** | `01cc09f` | `tests/ui/ssp-docx-export-button.test.ts` (6): drives a real `documents-router` server end to end — generates a real SSP, lifts `exportSspDocx()` unmodified out of the served HTML, invokes it, and fetches the URL it opens. Asserts a real DOCX (zip magic bytes, `wordprocessingml` content-type) for the selected tenant, 404 for another tenant's SSP, and no-op without a tenant or generated SSP. Fail-first confirmed by reverting `public/index.html` alone (6/6 failed). | — |
| EO-16 Policy store screen | Missing (generic imported-policy list had no UI surface at all — the existing "Policy" tab is a different, personnel-specific set of rendered documents) | **Implemented** (list/view only — the API has no per-document edit endpoint) | `071ea06`*, review fix `738f04b` | `tests/ui/policy-store-screen.test.ts` (5): drives a real `policies-router` server; lifts `loadPolicyStore()` unmodified out of the served HTML; seeds BOTH tenants with distinct policies and proves each tenant's query returns its own and never the other's (the original version seeded only tenant A, making "B never sees A's" vacuous — caught in advisor review, fixed before close-out). `tests/ui/index-tenant-calls.test.ts` updated (now recognizes `/api/policies` as tenant-scoped). Fail-first confirmed by reverting `public/index.html` alone (5/5 new-test failures). | — |
| EO-19 Render orchestration, `entra_audit_logs` end-to-end | Partly (Stamper's directive shape was already fixed, W4-ST4/`97180ec`; no ces-eo test proved the full loader→orchestrator→render path, and the renderer's doc-comment/REQ still described the stale `adminops.change_log` design) | **Implemented** | `86a2790`, review fix `738f04b` | `tests/unit/rendering/render-pipeline.test.ts`, "EO-19: RenderOrchestrator end-to-end" describe block (3): a real Stamper evidence fixture carrying the actual `EO_RENDER_SIA` / `input_sources: ['entra_audit_logs']` shape is parsed by the real `StamperEvidenceLoader` and rendered by the real `RenderOrchestrator` (no mocks) — `state: 'rendered'`, a real DOCX (zip magic bytes), render status written back to the evidence file, **and a resolver check proving `entra_audit_logs` actually resolved to the specific fixture record** (the original assertion only checked `state: 'rendered'`, which the renderer also returns when a source is unavailable — a vacuous pass caught in advisor review; discrimination proven once by mutating the fixture to a non-matching command/entryId and watching the new assertion fail, then reverting) — plus an honest "renders with a notice" case (renamed from a false "state: failed" label) proving `entra_audit_logs` genuinely fails to resolve with no evidence present. Fail-first confirmed: the whole test file failed to even load before the `_require` fix below (`RenderOrchestrator` could not be imported). | `REQ-ces-stamper-eo-render-directive-shape.md` marked **ANSWERED** (ces-stamper's side already carries the fix; this was a stale-status close-out, not new cross-module work). |

**EO-19 side fix (found while writing the fail-first test).** `BaseDocxRenderer.ts`, `PersonnelPolicyRenderer.ts` and `RiskAssessmentRenderer.ts` each declared `const require = createRequire(import.meta.url)`. Under ts-jest's CommonJS transform this collides with the `require` identifier the CJS module wrapper already injects (`Identifier 'require' has already been declared`), so `RenderOrchestrator` — which imports all three — could never be loaded in a real test; every prior test that touched it used `jest.mock('.../RenderOrchestrator', ...)` instead (see FX2/FX-EO8 sections above and `tests/eo/server/tenant-reads.route.test.ts`, `tenant-session-binding.route.test.ts`, `assess-tenant.route.test.ts`, `AssessorViewAdminOps.test.ts` — those mocks are untouched and still pass). Renamed to `_require`, the pattern already used correctly elsewhere in the same codebase (`SspDocxExporter.ts`, `PoamDocxExporter.ts`, `SprsCalculator.ts`). No behavior change under real ESM/`tsc --noEmit` (clean before and after); this only unblocks loading the module under the test transform.

**\*EO-16 commit note (process hazard, not a content problem).** `ces-eo` is a shared git working tree/index across concurrent sessions in the same run (this session, FC-EO-B on training/screening/risk tests, and later FC-EO-C on EO-06). This session staged `public/index.html`, `tests/ui/index-tenant-calls.test.ts` and `tests/ui/policy-store-screen.test.ts` for EO-16 and then hit a race: FC-EO-B ran its own `git add` + plain `git commit -m` (no pathspec) for its EO-12 `TrainingStore` work while this session's EO-16 changes were still sitting staged in the shared index, so the plain commit swept up both sessions' staged files into one commit, `071ea06 "FC-EO-B EO-12: TrainingStore logic tests + de-dupe defect fix"`. Verified with `git show --stat 071ea06`: all three EO-16 files are present with the expected line counts, content is correct and on `main`, nothing was lost — only the commit message and hash are shared with unrelated work. No history rewrite was attempted (forbidden on a shared branch); this note is the record of what happened. **Lesson for future concurrent sessions in the same tree: commit with an explicit trailing pathspec (`git commit -m "..." -- <files>`) even when nothing else appears to be staged, since another session's `git add` can land in the shared index between your `add` and your `commit`.**

**Gates on HEAD `86a2790`:** `npx tsc --noEmit` clean. `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment` → **792 passed / 78 suites / 0 failed** (includes this session's new tests plus concurrent sessions' committed work in the same tree at the time of the run). **Gates re-run on close-out HEAD `738f04b`** (after the advisor-review fixes below): **858 passed / 84 suites / 0 failed**.

**HONEST-OPEN:** none for this session's three steps — all three completed to their "Done when" criteria.

**Founder items:** none new. EO-19's cross-module REQ was closed as a stale-status update (ces-stamper's fix already existed); no founder decision needed there.

Legend: FC-EO-A = this session's id in the feature-completion plan. FC-EO-B / FC-EO-C = concurrent sessions in the same root (training/screening/risk tests; EO-06 template deletion) reported separately. EO-nn = feature ids from `ces-feature-surfacing-2026-09-27.xlsx`. REQ = requirement filed in `docs/requirements/`. HEAD = the commit the gates ran on.

## 2026-09-27 feature completion (FC-EO-C)

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FC-EO-C.md` (founder decisions 3 and 7 in
`ces-strategy/docs/context/feature-completion/DECISIONS-2026-09-27.md`). Sim only; every write under
`ces-eo`; nothing pushed. Ran concurrently with FC-EO-A (UI) and FC-EO-B (training/screening/risk tests).

| Feature | Status before | Status after | Commit | Tests (call production code) | REQs |
|---|---|---|---|---|---|
| EO-06 Delete the unloaded generation-template set | Partly (126 never-loaded files in `src/eo/generation/templates`; founder chose delete) | **Done** | `beaebf9` | `tests/eo/generation/at-role-based-snippets.test.ts` (4, new) renders the live AT snippets through the real `SnippetTemplateEngine`; 3/4 failed before the fix. `tests/unit/claim-accuracy.test.ts` now pins: folder absent, no source reference, every `.hbs` under `src/` is one of the 111 + 7 loaded templates. | — |
| AO-16 AdminOps approver-token issuer | Partly (AO verifies tokens; no production issuer; founder decision 7: issuer in EO, BHD operator only) | **Done** (API; no CLI — EO has none; UI not added) | `f55bf96` | `tests/eo/approver-tokens/ApproverTokenIssuer.test.ts` (16) + `tests/eo/server/approver-token.route.test.ts` (9). Tokens from the production issuer are **accepted by ces-ao's real `verifyApproverToken`** (read-only import); tampered signature, forged payload, expired and wrong-secret tokens are refused by it; every refusal proven; the evidence row is read back from a real temp `ces.db` and contains neither the token nor its payload/signature. Mutation check: disabling the role check and the TTL cap failed 3 tests. | `REQ-ces-ao-approver-token-tenant-binding.md`, `REQ-ces-shared-worm-approver-token-mints.md` |

**EO-06 detail.** Before deleting, the scenario-split files (AT 3.2.3 cui-handlers / privileged, CM 3.4.1
azure / m365, CM 3.4.8 applocker, plus their base files) were read against the live snippets. Findings:
(1) **live defect fixed** — `AT.L2-3.2.2.hbs` and `AT.L2-3.2.3.hbs` had swapped bodies (3.2.2, role-based
training, rendered the insider-threat body; 3.2.3, insider threat, rendered the role-based body); bodies and
procedure ids AT-002/AT-003 swapped back. (2) Ported into the role-based body only generic curriculum
language: a CUI-handler track (CUI Basic vs. Specified, sensitivity labels/DLP, approved storage and
transmission, disposal), separate admin accounts, break-glass procedures, retrain on role change. None of the
old files' invented specifics (policy ids such as CA-030, compliance counts, dated reviews, percentages) — a
test pins their absence. (3) Azure-Policy and AppLocker variants **not** ported: there is no tenant flag to
condition them on, so they would be unconditional false claims (the live CM 3.4.8 snippet describes WDAC).

**AO-16 design.** `POST /api/approver-tokens?tenant=<slug>` body `{ approverUpn, approverDisplayName?, ttlSeconds? }`;
`GET /api/approver-tokens/mints?tenant=<slug>` lists that tenant's mint evidence. Code:
`src/eo/approver-tokens/ApproverTokenIssuer.ts`, `ApproverTokenMintLog.ts`, `src/eo/server/routers/approver-token-router.ts`.
- **Operator auth:** header `x-ces-principal` with a token signed with `CES_EO_OPERATOR_SECRET` carrying role
  `bhd-operator`, verified by ces-shared's `createHs256PrincipalVerifier`. No dev-principal fallback (loopback
  without a token is 401). The operator secret must differ from `CES_AO_PRINCIPAL_SECRET` — otherwise every
  operator token would itself be a valid AO approver token — and the route refuses (503) if they match.
- **Token:** signed with ces-shared's exported `signPrincipalToken` (no crypto copied; no ces-shared REQ needed)
  and `CES_AO_PRINCIPAL_SECRET`; claims `sub`, `upn` = approver, `tid` = tenant GUID, `roles: ['ao-approver']`,
  `jti` = mint id, plus AO's `iss`/`aud` when `CES_AO_PRINCIPAL_ISSUER`/`_AUDIENCE` are set. Lifetime default
  15 min, hard max 30 min.
- **Refusals:** non-operator (401 no token / bad signature; 403 unverified or wrong role), operator auth not
  configured or secret reuse (503), AO secret missing/short (503), missing (400) / unknown (404) tenant, empty
  (400) or non-UPN (400) approver, operator minting for themselves (403), non-integer/≤0 (400) or excessive
  (400) lifetime.
- **Evidence:** collection `eo_approver_token_mints`, tenant-scoped, fresh UUID per mint: who (operator UPN +
  subject id), for whom, tenant slug + GUID, issuedAt, expiresAt, ttl, iss/aud. Written **before** the token
  is returned; if the write fails, no token is issued. The token is never stored.

**Gates on HEAD `f55bf96`:** `npx tsc --noEmit` clean; `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment`
→ **858 passed / 84 suites / 0 failed** (includes concurrent sessions' committed work at the time).

**HONEST-OPEN:** none — both steps met their "Done when".

**Open follow-ups (REQs filed, not blocking):**
- `REQ-ces-ao-approver-token-tenant-binding.md` — AO's `verifyApproverToken` ignores `tid`, so a token minted
  for tenant A could approve a tenant-B request until ces-ao checks it (plus: require `ao-approver` role, log `jti`).
- `REQ-ces-shared-worm-approver-token-mints.md` — make the mint collection repo-level WORM (EO's class is
  append-only by construction, but the repository does not enforce it for this collection).
- UI: none added. FC-EO-A had committed its UI work, so one issuer section was permitted but was left out to
  keep this step's scope to the security path; a UI would need an operator-token input.

**Founder items:** (1) how BHD operators get their EO operator token (today: any holder of
`CES_EO_OPERATOR_SECRET` can sign one — an Entra-backed verifier is the natural next step, same
`PrincipalVerifier` shape); (2) who holds `CES_AO_PRINCIPAL_SECRET` and `CES_EO_OPERATOR_SECRET` in a
deployment; (3) confirm the lifetime numbers (15 min default / 30 min max) and the self-mint refusal.

Legend: FC-EO-A/B/C = the three concurrent feature-completion sessions in this root. EO-06 / AO-16 = feature ids
from `ces-feature-surfacing-2026-09-27.xlsx`. REQ = requirement filed in `docs/requirements/`. HONEST-OPEN =
blocked step with reason + REQ. WORM = write-once-read-many (append-only). UPN = user sign-in name. `tid` / `jti`
= token claims for tenant id / token id. HEAD = the commit the gates ran on.

## 2026-09-27 feature completion (FC-EO-B)

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FC-EO-B.md`, following `ces-strategy/docs/context/feature-completion/VERIFY-eo.md`
(EO-12/EO-13/EO-15 sections). Sim only; every write under `ces-eo`; nothing pushed. Ran concurrently with FC-EO-A
(`public/` UI, not touched by this session) and FC-EO-C (EO-06/AO-16) in the same root/repo.

| Feature | Status before | Status after | Commit | Tests (call production code) | REQs |
|---|---|---|---|---|---|
| EO-12 Training system of record | Partial (code existed; zero logic tests — only the tenant-gate 400 sweep touched training routes) | **Implemented** | `071ea06`, `84773e3`* | `tests/eo/personnel/TrainingStore.test.ts` (21): catalog load/save, `computeRequiredCourses` role/screening-state gating, `addCompletion`/`removeCompletion`, `getTrainingStatus` (overdue/expiringSoon), `isControlMet`, tenant isolation. `tests/eo/personnel/TrainingEmailHelper.test.ts` (9): assignment-email text generation. `tests/eo/server/training-screening.route.test.ts` (training half, 8 of 15): assign/complete/overdue-clears-on-completion, future-date and empty-courseIds validation, unknown-person 404, tenant isolation, no-`?tenant=`->400 sweep — all against the real `personnel-router` over HTTP. | — |
| EO-13 Screening system of record incl. CUI acknowledgment PDF | Partial (code existed; zero logic tests beyond the tenant-gate sweep; PDF generation untested) | **Implemented** | `bb7eadb` | `tests/eo/personnel/ScreeningElementStore.test.ts` (9): load/save, `loadAll`'s not-started default, `areElementsOneToSixComplete`, `getReadiness` (packageComplete true only on all-7-complete + AO approve), tenant isolation. `tests/eo/screening/generateCuiAcknowledgmentPdf.test.ts` (5): reloads the generated bytes with `pdf-lib` (an existing runtime dependency) and reads the AcroForm text fields back (the function writes person/org data into form fields, not drawn page text) — confirms the right person/tenant data lands in the right fields, two people don't cross-contaminate, and the expected field set is present. `tests/eo/server/training-screening.route.test.ts` (screening half, 7 of 15): element CRUD, element-6 CUI template substitution with real person/tenant data, element-7 AO sign-off sequencing (blocked until 1-6 complete; AO-cannot-be-subject), tenant isolation. | — |
| EO-15 Risk assessment (register CRUD, vulnerability ingest, auto-score, annual review + document generation) | Partial (code existed; only SI-family signal-evaluator coverage existed — `RiskAssessmentStore`/ingest/auto-score/annual-review untested) | **Implemented**; one formula check flagged unverifiable, not a defect (see below) | `4e32933`, `eae47e7` (sentinel-severity defect fix, see below) | `tests/eo/risk-assessment/RiskAssessmentStore.test.ts` (15): config, register CRUD, annual-review state, snapshot immutability (second create for the same year throws), ingestion-run log, tenant isolation. `tests/eo/risk-assessment/VulnerabilityIngestionService.test.ts` (11): plan_output ingest (create/dedupe/update-on-change/disabled) needs no session; Defender-for-Cloud + Secure-Score + Sentinel ingest via a fake `SessionManager` (an `execute()` stub only — sim only, no PowerShell process spawned, nothing reaches a real or non-localhost endpoint); PS-noise/JSON-repair recovery; `ingestAll` aggregation with partial failures; tenant isolation. `tests/eo/risk-assessment/SecureScoreAutoScorer.test.ts` (12): pins the NIST SP 800-30 Rev 1 composite risk matrix cell-by-cell, `autoScoreRegister` per source type, skip-if-manual/already-scored, sentinel severity fix (below), tenant isolation. `tests/eo/risk-assessment/RiskAssessmentRenderer.test.ts` (5): the annual review's two DOCX documents (VFS-POL-011 procedure, VFS-DOC-001 report) render end-to-end from real store data — current-register vs. frozen-snapshot selection by year, empty-register first run, tenant isolation. | none filed; one formula-verification caveat (below) |

**\*EO-12 commit note (process hazard, not a content problem — same root cause as FC-EO-A's EO-16 note above,
happened twice, in both directions).** `TrainingStore.test.ts`'s own de-dupe fix was committed correctly under
`071ea06`, but that commit ALSO swept in three of FC-EO-A's concurrently-staged EO-16 files (see FC-EO-A's note
above — their content is correct, just under my commit message). While fixing that, `git reset --soft HEAD~1`
assumed my commit was still `HEAD`; a `ces-ao` session had already committed on top of it in the interim, so the
reset briefly undid `ces-ao: AO-04 pin A-03's rendered command to the requested UPN` instead of splitting my
commit. Caught immediately via `git log`; the AO commit object was still reachable by hash (`reset --soft` never
deletes commits), so `git reset --soft 21d0b4c` (the AO commit's own hash) restored history exactly — verified by
`git log --oneline` and by re-running `TrainingStore.test.ts` (21/21 green after restoration). No history was
rewritten past that point and no data was lost. Then, separately, `TrainingEmailHelper.test.ts` and
`training-screening.route.test.ts` were staged and about to be committed with an explicit pathspec (the safe
pattern) when a `ces-ao` session's own plain `git commit -m "..."` (no pathspec) landed first and swept up my two
already-staged files into ITS commit, `84773e3 "ces-ao: AO-03 UI auto-fill..."` — verified via `git show --stat
84773e3`; content and behavior are correct and on `main`, only the commit boundary is shared. Every commit after
that point in this session used an explicit trailing pathspec and none were swept again. **Net: this confirms
FC-EO-A's lesson needs to be a plan-level rule, not a per-session habit — the explicit-pathspec `git commit -m
"..." -- <files>` protects the AUTHOR from committing someone else's staged work, but does nothing to protect
that author's own already-staged work from a DIFFERENT session's plain `git commit` sweeping it up first. There is
no fully race-proof fix available to a single session in a shared index; the only real fix is every session using
the explicit-pathspec form, all the time, with no exceptions** (worth stating as a standing rule in future
feature-completion instruction files, not just a lesson learned after the fact).

**Formula-verification caveat (EO-15, `NistScoringMatrix.ts`).** Per instructions ("pin the current scoring
formula in a test; if it looks wrong against the security-risk method the code cites, report it — do not
redesign it"): grepped this repo for an actual copy of NIST SP 800-30 Rev 1 Appendix I / Table I-2 to check the
code's 5x5 composite-risk matrix against a primary source — none exists in `docs/` or `src/` (only citations of
the table, not its contents). The matrix was instead compared against the assistant's own recall of the published
table and appears to match cell-for-cell. That recall is not independently verifiable from anything in this repo,
so this is reported as **"no defect found, but unverified against a primary source"** rather than a confirmed
pass — a founder/SME spot-check against the actual NIST SP 800-30 Rev 1 PDF would close this out. The matrix is
pinned as-is either way; nothing was changed.

**Defect found and fixed (EO-12).** `TrainingStore.addCompletion` never de-duplicated by `courseId` — it just
pushed onto the `completions` array. Re-completing a course after its prior completion expired (e.g. an annual
training refresher) left the stale, expired record as the FIRST array match; `getTrainingStatus` and
`isControlMet` both use `Array.find()`, so the course stayed reported as overdue/not-current forever despite a
fresh completion having just been recorded. Fixed: `addCompletion` now removes any existing completion for the
same `courseId` before pushing the new one. Fail-first proven (the assertion failed against unpatched code,
receiving 2 completion records instead of 1); no assertion weakened.

**Defect found and fixed (EO-15).** `VulnerabilitySourceSchema`'s `sentinel_alert` variant
(`risk-assessment.types.ts`) had no `severity` field, and `VulnerabilityIngestionService
.ingestSentinelIncidents` never populated one on the entries it creates (`source: {type, incidentId, title}`
only) — yet `SecureScoreAutoScorer.deriveScoring`'s sentinel_alert branch read `(source as any).severity`, which
was therefore always `undefined` by construction. Every Sentinel-sourced risk entry silently auto-scored
moderate/moderate regardless of the incident's real severity (a "critical" Sentinel incident got the same score
as a "low" one). Fixed: added optional `severity` to the `sentinel_alert` variant in both
`shared/types/risk-assessment.types.ts` and the router's own duplicate schema in `server/validation-schemas.ts`
(Zod strips unknown keys, so both copies need it or a POSTed severity would silently vanish), populated it at
ingest in `VulnerabilityIngestionService.ingestSentinelIncidents`, and `SecureScoreAutoScorer.deriveScoring` now
reads the typed field (no more `as any`). Fail-first proven: before the fix, a high-severity Sentinel fixture
scored moderate/moderate in both the store-level auto-score test and an ingest-level end-to-end test; after the
fix both score very_high/very_high. `sentinel_incidents` ingestion is disabled by default in
`RiskAssessmentConfigSchema` (`enabled: z.boolean().default(false)`), so this was latent rather than actively
misscoring production data, but is now fixed rather than left open.

**Pinned, not a defect (EO-12).** `TrainingStore.computeRequiredCourses`: the `targetRoles` wildcard/role match
sits INSIDE the loop over `required_for_roles`, so a course with an empty `required_for_roles` array never gets
assigned even if `targetRoles` says `'*'`. Latent today — every course in both the shipped default catalog and
this session's test fixtures has a non-empty `required_for_roles` — so this was pinned as current behavior and
called out rather than changed; it is unclear which field is meant to take precedence, which is a product
decision, not a bug fix, absent founder input.

**Gates on HEAD `eae47e7`:** `npx tsc --noEmit` clean; `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim
live-assessment` → **860 passed / 84 suites / 0 failed** (this session's own gate run before its last commit;
concurrent sessions may have added further commits in this tree afterward — see the orchestrator's own close-out
gate for the true final HEAD count).

**HONEST-OPEN:** none — all three steps (EO-12, EO-13, EO-15) met their "Done when" criteria from the instruction
file: each covers happy path, validation, and tenant isolation (EO-12/EO-13) or all four required logic areas
incl. tenant isolation (EO-15), with fail-first proof where a defect existed and plain coverage tests where the
code was already correct. The one EO-15 defect the tests exposed (Sentinel severity) was fixed, not deferred.

**Founder items:**
1. EO-15 NIST matrix — no in-repo primary source exists to verify the composite-risk table against; a founder/SME
   check against the actual NIST SP 800-30 Rev 1 PDF would convert "no defect found" into a confirmed pass.
2. Process: the shared git index/working-tree race across concurrent feature-completion sessions bit both this
   session and FC-EO-A, in both directions, even with explicit-pathspec commits on one side of each incident. No
   data was lost either time (verified via `git show --stat` on the swept-together commits) and no history was
   rewritten, but a plan-level rule (every session, every commit, pathspec form) would close the gap that a
   single session's own discipline cannot close alone.

Legend: FC-EO-A/B/C = the three concurrent feature-completion sessions in this root. EO-12/13/15 = feature ids
from `ces-feature-surfacing-2026-09-27.xlsx`. REQ = requirement filed in `docs/requirements/`. HONEST-OPEN =
blocked step with reason + REQ. HEAD = the commit the gates ran on.

## 2026-09-28 feature completion (FC-EO-D)

Founder decision 2026-09-27 #4: push automatic-signal coverage above 79/110. Instruction file:
`INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-EO-D.md`.

| Item | Before → After | Commit | Tests | REQs |
|---|---|---|---|---|
| EO-03 step 1: feasibility table | none → all 31 uncovered controls assessed in `docs/SIGNAL-COVERAGE-2026-09-28.md` (6 buildable, 25 ruled out, reasons grouped) | `6b581af` | — | — |
| EO-03 step 2: build feasible signals | 79/110 → **85/110**. New signals for AT.L2-3.2.1, AT.L2-3.2.3, AU.L2-3.3.5, PS.L2-3.9.2, RA.L2-3.11.2 and SC.L2-3.13.7. They sit in an EO-owned registry overlay merged into the Microsoft registry the mapper evaluates. `fetchCoverageSignals()` is wired into `fetchAllSignals()`, uses read-only GETs and one read-only advanced-hunting query, and pages every collection. | `6b581af` | `tests/mapping/evaluators/coverageEvaluators.test.ts` (25) and `tests/mapping/signalCoverageOverlay.test.ts` (10). **Fail-first:** before the production files existed, both suites failed (module not found) and the claim-accuracy count test failed. | `REQ-ces-shared-signal-registry-overlay.md`, plus `REQ-tenant-stacksim-{training-user-coverage, users, security-incidents, lifecycle-workflows, run-hunting-query, vpn-device-configurations}.md` |
| EO-03 step 3: pin the count and update docs | the claim test counted the raw shared file (79) → it now pins shared = 79 **and** effective = 85, and names the six added ids. The historical-doc banners now say 85 of 110. | `6b581af` | `tests/unit/claim-accuracy.test.ts` | — |

**Integrity rules held in every new evaluator:** a failed read → `not_assessed`; an empty read → `not_met`; `met` only
on observed state that covers the whole requirement; partial evidence → `partial`. Tests cover each case. The fixtures
are hand-authored in the documented Graph v1.0 and SDK response shapes; no live tenant was read.

**Deliberately not counted:** the shared registry keys `mediaDisposalEvaluator` under the non-reference id
`MP.L2-3.8.3`. Re-keying it would add +1, but it returns met when managed devices merely exist, which is SAT on
capability. It is filed in the ces-shared REQ.

**Side fix:** `SignalToControlMapper` named its local `createRequire` result `require`. That shadowed `require`, and
under the jest `import.meta` shim constructing the default mapper threw a TDZ error (`Cannot access 'require' before
initialization`). The variable is renamed to `req`. The new overlay tests construct the default mapper and exercise
this path.

**Gates on HEAD `6b581af`:** `npx tsc --noEmit` is clean, and `npx jest --no-coverage --testPathIgnorePatterns
eo-live-sim live-assessment` gives **895 passed / 86 suites / 0 failed**. The live-sim smoke
(`tests/integration/eo-live-sim.test.ts`, outside the gate) also passed: 2/2.

**HONEST-OPEN:** none against the exit criteria. Open follow-ups, recorded in the table doc:
- **F1:** field names and task-definition ids have not been checked against a live GCC High tenant. The sim REQs cover
  the sim side.
- **F2:** `fetchExpandedSignals()` is never called, and the `updateRings` and `users` signal ids are never fetched.
  This affects existing verdicts, so it is left for a separate change.
- **F3:** AU.L2-3.3.9 needs Exchange and Purview role-group reads.
- **F4:** unpaged list cmdlets.

Legend: FC-EO-D = this session. EO-03 = the workbook feature id (signal coverage). SAT / NOT_SAT = satisfied / not.
F1–F4 = follow-ups listed in `docs/SIGNAL-COVERAGE-2026-09-28.md`. REQ = requirement file in `docs/requirements/`.
HONEST-OPEN = a blocked step, with its reason and REQ.

## 2026-09-28 feature completion (FC-EO-E)

Founder decisions 2026-09-28 #5 (operators prove identity to the EO token issuer with Microsoft Entra ID sign-in,
operator role from a group) and #7 (keep the 15-minute default, 30-minute cap and no self-issue). Instruction file:
`INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-EO-E.md`.

| Item | Before → After | Commit | Tests | REQs |
|---|---|---|---|---|
| Step 1: Entra operator sign-in | Operators proved identity with an HS256 token signed with the shared `CES_EO_OPERATOR_SECRET` → operators present an Entra ID token or access token. `EntraOperatorVerifier.ts` checks the RS256 signature against the operator tenant's signing keys (fetched by `kid`, cached, refresh rate-limited), plus issuer, audience, `exp`/`nbf`, and `tid` = the configured operator tenant. It grants `bhd-operator` only when `groups` contains the configured group id. Groups overage is refused. The HS256 path is now a dev fallback only: off unless `CES_EO_OPERATOR_DEV_FALLBACK=1`, refused when Entra config is also present, loopback only, and its principal is marked `dev-unverified`. The issuer accepts that principal only with the router's explicit `allowDevOperator`. Mint evidence and the mint response record `operatorAuth` (`entra` / `dev-hs256-unverified` / `verified-token`). | `f3ec3b9` | `tests/eo/approver-tokens/EntraOperatorVerifier.test.ts` (13), `tests/eo/server/approver-token-entra.route.test.ts` (11). They cover: a valid operator mints and AdminOps' real `verifyApproverToken` accepts the token; wrong tenant → 401; missing group → 403; expired → 401; bad signature (same `kid`, different key) → 401; wrong audience → 401; HS256 token under Entra → 401 `unsupported_alg`; keys unavailable → 503. **Fail-first:** the new modules did not exist; mutating the verifier (drop the `tid` check, grant the role regardless of group) fails 4 tests. | `REQ-ces-shared-principal-verify-reasons.md` (`wrong_tenant` reason) |
| Step 2: token rules kept | 15 min default, 30 min cap and no self-issue were already built → unchanged. Every existing assertion is kept. The HS256 route suite now runs under the dev flag, and 3 cases were added: no flag → 503, flag plus Entra → 503 misconfigured, non-loopback → 403. The rules are also asserted through the Entra route (self-issue 403, 31 min → 400). | `f3ec3b9` | `tests/eo/approver-tokens/ApproverTokenIssuer.test.ts`, `tests/eo/server/approver-token.route.test.ts`. **Fail-first:** "no dev flag → 503" failed against the pre-change router, which minted with the secret alone. | — |
| Step 3: issuer UI | No UI → standalone page `public/approver-tokens.html`. The operator signs in with Microsoft (authorization code + PKCE; no library; ID token held in memory only), picks the tenant and approver, and gets the token once with a copy button. The page shows the tenant's recent mints (who, for whom, issued, expiry, sign-in mode), never tokens. New public `GET /api/approver-tokens/config` carries tenant id, client id and endpoints, and no secrets. | `1962077` | `tests/ui/approver-token-issuer-page.test.ts` (8). It lifts the page functions from the served HTML and drives the **real router** with locally signed Entra tokens: mint → shown once, AdminOps accepts it, the mints table lists it without the token; non-group → refused and no token shown; expired → 401; 31 min → 400. The PKCE start and the code-exchange completion (state and nonce checks) run against stubbed browser globals. **Fail-first:** the page did not exist; mutating the nonce check or the token display fails 2 tests. | — |

**Gates on HEAD `1962077`:** the check ran on a `git archive` snapshot of HEAD, because the shared working tree carries
another session's uncommitted EC files that do not yet load under jest. `npx tsc --noEmit` is clean.
`npx jest --no-coverage --testPathIgnorePatterns eo-live-sim live-assessment` gives **933 passed / 89 suites / 0
failed**. The previous figure was 895 / 86; this change adds 38 tests and 3 suites.

**Operator deployment configuration:** set `CES_EO_OPERATOR_ENTRA_TENANT_ID` (BHD operator tenant GUID),
`CES_EO_OPERATOR_ENTRA_CLIENT_ID` (EO app registration) and `CES_EO_OPERATOR_ENTRA_GROUP_ID` (operator group object id).
Optional: `CES_EO_OPERATOR_ENTRA_AUDIENCE` (defaults to the client id), `CES_EO_OPERATOR_ENTRA_AUTHORITY_HOST` (defaults
to `login.microsoftonline.com`; GCC High uses `login.microsoftonline.us`) and `CES_EO_OPERATOR_ENTRA_ISSUER` (defaults to
`https://<host>/<tenant>/v2.0`). `CES_AO_PRINCIPAL_SECRET` is still required for signing.
The app registration needs:
- the SPA redirect URI `https://<eo-host>/approver-tokens.html`;
- a `groups` claim in the ID token (`groupMembershipClaims`: SecurityGroup, or assigned groups only);
- no client secret.

Do not set `CES_EO_OPERATOR_DEV_FALLBACK` in a deployment.

**HONEST-OPEN:**
- **O1: groups overage.** A user in more than about 200 groups gets a Graph pointer instead of `groups`. That case is
  refused, not resolved. The fix is to emit assigned groups only, or to add a Graph lookup.
- **O2: interactive sign-in not exercised offline.** The redirect to Microsoft and a real token exchange were not run.
  The flow is tested only against stubs. A live check needs the app registration.
- **O3: the service bearer sits in front of the page's API calls.** EO's `CES_EO_AUTH_TOKEN` gate
  (`authMiddleware.ts`) allows remote `/api/*` calls only with the service bearer, which a browser page does not hold.
  From a remote browser the page therefore works only if a proxy adds the bearer, or if the approver-token routes are
  exempted from the service gate now that operator auth covers them. `EoServer.ts` was not changed: it carries
  FC-EO-F's uncommitted edits in the shared tree.
- **O4: no nav link.** `public/index.html` has no link to the issuer page yet. FC-EO-F is editing that page, so the
  link is deferred to avoid sweeping their changes into this commit.

Legend: FC-EO-E = this session. FC-EO-F = the parallel EO session (Evidence Collector wiring). O1–O4 = the open items
above. PKCE = Proof Key for Code Exchange. REQ = requirement file in `docs/requirements/`. HONEST-OPEN = blocked or
unproven, with its reason.

## 2026-09-28 feature completion (FC-EO-F)

Evidence Collector milestone M4a (EO wiring), per `ces-strategy/docs/context/evidence-collector/PLAN.md` step 4 and
`../ces-ec/docs/requirements/REQ-ces-eo-ec-wiring.md`. EC itself (M1–M3) was already built and tested by a prior EC
session; this closes the loop on EO's side so **EO-22 → complete**.

| Item | Before → After | Commit | Tests | REQs |
|---|---|---|---|---|
| EC proxy routes | `public/index.html`'s `page-ec` called `/api/ec/health\|runs\|findings`; `src/eo/server` had zero matching routes and no nav entry — unreachable and back-end-less. → `server/routers/ec-router.ts` proxies all three to `EC_URL` (open, matching EC's own auth), plus a new `/api/ec/ingest` (bearer added server-side, never sent to the browser). EC-down → `503 {status:'unreachable'}`, kept distinct from EC's own `degraded` status (e.g. secret unset), which now passes through unmodified instead of being folded into "unavailable". Nav entry added ("Evidence Collector" tab); runs/findings now also forward the current tenant. | `db68008`, `32ece57` | `tests/eo/server/ec-proxy.route.test.ts` (8, real router + a fake EC on an ephemeral port over HTTP — no `supertest`, matching this repo's `listen(0)` + `fetch` pattern), `tests/ui/ec-status.test.ts` (6 — 4 for `refreshEcStatus` lifted from the served HTML, 2 proving the nav tab and its click-handler branch exist, added on review since EO-22 names "reached from the nav" as its own acceptance line). **Fail-first:** the router module did not exist. | — |
| Upload form / ingest | No upload path existed for manual evidence (control ids, source, role, file). → an "Upload Evidence" card on the EC page posts multipart to `/api/ec/ingest`, which EO base64-encodes and forwards to EC's `POST /api/ingest` as JSON with the bearer attached. Deviation from the REQ's suggested "15 MB `express.json` limit on that route": the form is multipart (matching EO's existing personnel-attachment uploads), so no JSON size limit applies there — a dedicated memory-storage `multer` instance caps the decoded upload at EC's own 10 MB ingest ceiling instead. | `db68008` | `ec-proxy.route.test.ts` (forwarding, 400 on missing fields/file, 503 with no secret, asserts `verdict` is never sent). **Fail-first:** route did not exist. | — |
| Control detail / evidence, verdict-neutral | `ControlAssessor.merge`'s `ecFindings` param was always `[]` from the caller — EC evidence never reached control detail. → `evidence/EcEvidenceReader.ts` (HTTP client, strict-parsed against `EcEvidenceItemSchema`, never throws) reads EC items for the assessed tenant in `/api/assess`; `merge()` takes them as a new trailing param and appends their sources **after** computing each control's status from every other source — a structural guarantee, not just a convention of the `result:'no_query'` value used, that a manual upload never flips a verdict either way. Uploaded items now show in a control's `sources` (new `ec_capture` badge, neutral colour — not painted red like a real miss). **Deliberately NOT added to `evidenceArtifactIds`** (review fix, `32ece57`): that array also feeds `SspGenerator`'s directive-SPRS "verified artifact" check (`DirectiveSprsCalculator`) and the SSP narrative's "Evidence:" line (`SnippetTemplateEngine`) — both would read an EC upload as *verified*, a claim EO can't back for evidence nobody has reviewed. `sources` has no such consumer, so it's the only place an EC item surfaces outside `ControlAssessor`. | `db68008`, `32ece57` | `tests/eo/assessment/ControlAssessor.ecItems.test.ts` (9 — not_assessed stays not_assessed, met stays met, not_met stays not_met, both with and without an EC item; multi-control items via `sources`; `evidenceArtifactIds` proven byte-identical with/without an EC item; `sources_merged` only when items exist; `automationSource` unaffected; `SprsCalculator.calculate()` output proven byte-identical with/without an EC item, since it reads only `.status` — checked by reading `SprsCalculator.ts` directly, and `DeterminationLedger.ts` by grep, neither reads `sources`/`evidenceArtifactIds`), `tests/eo/evidence/EcEvidenceReader.test.ts` (11 — bearer attached, tenant/controlId forwarding, malformed-row exclusion with a warning, empty store, EC unreachable, `readItemContent`). **Fail-first, verified by reverting `ControlAssessor.ts` alone:** 4 of 7 original `ControlAssessor.ecItems` tests failed without the change (met-control-gets-ec-source, multi-control ids, `sources_merged` label, EC-source-visible-in-detail). | `REQ-ces-shared-assessment-source-present-for-review.md` (P3, cosmetic — a distinct "present for review" result value instead of reusing `no_query`) |
| Evidence package | `EvidencePackager.build` had no path for EC items. → an optional `ecEvidenceItems` param (`{item, content}[]`, fetched via `EcEvidenceReader.readItems`/`readItemContent` in `/api/package/build`) zips each item under `evidence/ec/<controlId>/<itemId>-<filename>`, sha256 taken from the item's own hash in the integrity manifest. | `db68008`, `32ece57` | `tests/eo/packager/EvidencePackager.ecItems.test.ts` (3 — entry path present in the raw zip bytes [zip entry names are always stored uncompressed, so this proves the write without a zip-reading dependency this repo doesn't have]; first-controlId-as-directory [renamed on review — `EcEvidenceItemSchema.controlIds` is contractually non-empty, so the "unlinked" fallback this test originally claimed to exercise isn't reachable via this path]; no-items regression). **Fail-first:** the param and archiving branch did not exist. | — |
| Dead code | `discovery/EvidenceImporter.ts` was `@deprecated`, zero non-self callers, superseded by blob-based evidence. → deleted. | `db68008` | Proven by `tsc --noEmit` staying clean with the file gone (nothing imported it) — same proof style VERIFY-eo suggested for this item. | — |
| Config | No `EC_URL` / `EVIDENCE_OPS_SECRET` in `EoConfig`. → both added (`EC_URL` default `http://127.0.0.1:4001`; `EVIDENCE_OPS_SECRET` optional, unset ⇒ EC-authenticated reads/writes fail closed empty/503, never open). Documented in `README.md`. | `db68008` | Covered indirectly by every EC test above (each constructs `EoConfig`-shaped deps). | — |

**Gates on HEAD `32ece57`:** `npx tsc --noEmit` clean. `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim
live-assessment` gives **969 of 970 tests passed, 93 of 94 suites passed** (1 test / 1 suite failing — see P1 below,
pre-existing and unrelated). Up from FC-EO-E's 933/89 all-passing; this work adds 37 tests and 5 suites, all passing;
the total suite count also reflects the concurrent FC-SH/FC-EO-E work landed on `main` in between.

**HONEST-OPEN:**
- **P1 — pre-existing, not caused by this change:** `tests/unit/claim-accuracy.test.ts` ("85 of 110 reference controls
  have an automated (graph) signal...") fails: it expects the **shared** ces-shared `control-signal-registry` alone to
  hold 79 graph-signalled controls ("unchanged by this module"), but the checked-out `ces-shared` dist now holds 85 —
  `FC-SH step 3: promote EO signal overlay; fix 13 L1/L2 registry duplicates` (commit `cb00a20`, a concurrent session)
  promoted EO's overlay into the shared asset itself — ces-shared moved to 2.8.0. This test file lives in ces-eo (in
  this session's write boundary), but the fix is not: it requires retiring/updating `eoRegistryOverlay.ts` against
  the new shared baseline, which is 2.8.0-adoption work assigned to a dedicated follow-up session, per explicit
  strategy direction mid-session. Confirmed unrelated to this session's own changes: no file this session touched
  relates to signal registries, and the failure reproduces identically with none of this session's diffs present.
  Left as the one acceptable gate failure, not fixed here, per that direction.
- No HONEST-OPEN against this session's own M4a exit criteria — every step above has a passing fail-first test.

Legend: FC-EO-F = this session. EC = Evidence Collector (a separate module — `../ces-ec`, already built/tested by an
earlier EC session; this session only wires EO to it). M1–M4a = plan milestones in `evidence-collector/PLAN.md`.
P1 = the pre-existing/unrelated open item above. REQ = requirement file in `docs/requirements/`. HONEST-OPEN = blocked
or unproven, with its reason.

## 2026-09-28 feature completion (FC-EO-G)

Founder decisions 16–19 (2026-09-28): BHD has no Microsoft tenant, so the Entra operator sign-in from FC-EO-E cannot be
configured. Operators now prove identity to the approver-token issuer with **passkeys registered on the EvidenceOps
machine**. The Entra verifier stays in the code, off unless configured. The dev HS256 path is unchanged. Instruction
file: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-EO-G.md`.

| Item | Before → After | Commit | Tests | REQs |
|---|---|---|---|---|
| Step 1: passkey operator identity | Operator identity came only from Entra (not configurable) or the dev HS256 token → WebAuthn passkeys verified by `@simplewebauthn/server` 14 (new dependency; no WebAuthn crypto written here). `PasskeyOperatorStore.ts` keeps, in EO's CES store under the fixed scope `bhd-operators`: passkeys (operator id, display name, the operator's own address, credential id, public key, sign counter, created, last used, revoked), one-time enrollment codes (SHA-256 only), and an append-only evidence trail. `PasskeyOperatorService.ts` requires user verification on registration and sign-in and binds the RP id to the EO host (`localhost` on-box) and the exact origin. The signature counter must advance when non-zero. The `bhd-operator` role comes from holding an enrolled, unrevoked passkey. Passkey mode is on only when `CES_EO_OPERATOR_PASSKEY_ORIGIN` is set. It is refused alongside Entra or the dev fallback (fail closed), and unsafe settings are refused: off-box plain http, an IP as RP id, a path in the origin, an RP id that does not cover the host, a session TTL over 15 min. | `3c6622a` | `tests/eo/approver-tokens/PasskeyOperatorAuth.test.ts` (5): mode selection, misconfiguration refusals, unsafe settings, and a passkey mint records the credential id and is refused without one. | `REQ-ces-shared-worm-operator-passkey-events.md` (WORM for the evidence collection) |
| Step 2: enrollment | No enrollment path → **first operator:** `npm run operator:enroll -- --name "<display name>" --upn <own address>` runs on the EO box. It writes straight to the CES store (no network port) and prints a one-time link `…/approver-tokens.html#enroll=<code>`. The code is valid 10 minutes, single use, and stored hashed. **Later operators:** a signed-in operator creates the code on the issuer page (`POST /api/approver-tokens/passkeys/enrollment-codes`). **List/revoke:** on the page, or `npm run operator:passkeys -- list` / `-- revoke <credentialId>`. Revocation is immediate: every session use re-reads the passkey record, so a revocation from the page or from the separate command process ends open sessions at once. Code issued, passkey enrolled and passkey revoked are each an evidence record naming who acted (local command, or operator + credential). | `3c6622a` | `tests/eo/server/approver-token-passkey.route.test.ts` (17, real router over HTTP, software authenticator). Covers: expired code (before and after the ceremony started), used code, unknown code, enrollment without UV or from the wrong origin, operator-issued code → second operator enrolls, list never exposes public keys, revoke from the page and from the command both end the open session, evidence `by` fields. | — |
| Step 3: sign-in → operator session → mint | Mint required an Entra token → a passkey assertion against a single-use challenge yields an opaque operator session: ≤ 15 min, held in memory by hash only, sent as `x-ces-principal`. The mint route accepts it in place of the Entra token. The rules are kept: 15 min default, 30 min cap, no self-issue (compared against the operator's enrolled address). The mint evidence now records `operatorAuth: 'passkey'` and `operatorCredentialId`. In passkey mode every issuer route is loopback-only. | `3c6622a` | The route suite: enroll → sign in → mint, **accepted by AdminOps' real `verifyApproverToken`**. Refused: unknown passkey; wrong origin; wrong RP; UV missing; exact replay (challenge single use); cloned authenticator (counter did not advance); revoked passkey; expired session (15 min); made-up session; remote (non-loopback) sign-in and mint; self-issue; 31 min. **Fail-first:** the modules did not exist. Mutations were also run: turning off `requireUserVerification` fails 2 tests; turning off both counter checks fails 1. | — |
| Step 4: issuer page | Page supported Entra and dev-token only → `public/approver-tokens.html` uses passkey sign-in when the server reports `mode: 'passkey'`. It has inline base64url ↔ ArrayBuffer conversion (no CDN or library). Enrollment reads the code from the URL fragment, which is never sent to a server, and then drops it from the address bar. Section 4, "Operators and passkeys", adds an operator (one-time code + link shown once) and lists passkeys with Revoke. The session token lives in memory only. Sign-out ends the server session. | `3c6622a` | `tests/ui/approver-token-passkey-page.test.ts` (4). The page functions are lifted unmodified from the served HTML and drive the **real routes**, with `navigator.credentials` backed by the software authenticator. Covers: CLI code → enroll → passkey sign-in → mint (AdminOps accepts); add a second operator from the page → they enroll and mint; list, then revoke → their open page session is refused at once; revoking your own passkey signs the page out; used code and no-UV refusals are shown. The FC-EO-E page test (8) still passes unchanged. | — |

**Gates on HEAD `3c6622a`:** the shared working tree carries FC-EO-H's uncommitted signal-registry edits, which fail 4
suites there, so the gate ran on a `git archive` snapshot of HEAD with sibling modules and `node_modules` junctioned in
(the FC-EO-E method). `npx tsc --noEmit` is clean. `npx jest --no-coverage --testPathIgnorePatterns eo-live-sim
live-assessment` gives **995 of 996 tests passed, 96 of 97 suites passed**. The one failure is
`tests/unit/claim-accuracy.test.ts`: P1 from FC-EO-F, owned by FC-EO-H and expected red until it lands. FC-EO-G adds 26
tests in 3 suites plus a test kit, all passing. No test reaches the network. The root `package-lock.json` change adds
`@simplewebauthn/server` and its dependencies. It also syncs the lock's ces-shared workspace entry from 2.7.0 to 2.8.0;
ces-shared's `package.json` was already 2.8.0.

**Operator setup (on the EvidenceOps machine):**
1. **Configure EO.** In the EO environment (`ces-eo/.env` or the shell that starts EO):
   - Set `CES_EO_OPERATOR_PASSKEY_ORIGIN=http://localhost:5004`. This must be the exact origin the page is opened from.
     Use `localhost`, not `127.0.0.1`: browsers do not accept an IP as a passkey RP id.
   - Keep `CES_AO_PRINCIPAL_SECRET` set, as before.
   - Do **not** set the `CES_EO_OPERATOR_ENTRA_*` variables or `CES_EO_OPERATOR_DEV_FALLBACK`. Either one makes the
     configuration ambiguous, and EO then refuses all mints with 503.
   - Start or restart EO (`npm run eo` from the ces root).
2. **Enroll the first operator.** In `ces-eo`, with the same environment (the same `CES_PIPELINE_ROOT` / ces.db as the
   server), run `npm run operator:enroll -- --name "<display name>" --upn <operator's own address>`. Within 10 minutes,
   open the printed link in a browser on the same machine and click **Register passkey**. Windows Hello (PIN or
   biometric) satisfies user verification. Then click **Sign in with passkey**.
3. **Add more operators.** A signed-in operator uses section 4 → *Add an operator* (name + their own address) to create
   a one-time code + link, valid 10 minutes, and hands it over. The new operator opens the link on the EO machine and
   registers a passkey. The same step adds a second device for an existing operator: issue a code with the same
   address.
4. **Revoke a passkey.** Use section 4 → **Revoke**, or on the box run `npm run operator:passkeys -- list`, then
   `npm run operator:passkeys -- revoke <credentialId>`. Revocation takes effect immediately and ends that passkey's
   open sessions. If every passkey is lost, step 2 still works as recovery.

**HONEST-OPEN:**
- **G1: no real authenticator run.** Everything is proven with a software authenticator (real P-256 keys, real
  `@simplewebauthn/server` verification). A browser with Windows Hello against a running EO has not been exercised. A
  one-time live check on the EO box is needed: steps 1–2 above, then a mint.
- **G2: sessions are held in the process.** Sign-in challenges and operator sessions live in EO's memory, so a restart
  signs every operator out. This is by design (≤ 15 min sessions). It also assumes a single EO process.
- **G3: counter-less passkeys.** Many platform and synced passkeys always report counter 0. The WebAuthn rule applies
  the counter check only when a counter is non-zero, so for those passkeys replay protection comes from the single-use
  challenge alone (tested).
- **G4: WORM for the evidence trail.** The class is append-only by construction, but enforcement at the repository
  level needs ces-shared → `REQ-ces-shared-worm-operator-passkey-events.md`.
- **G5: RP id is bound to `localhost`.** If EO is ever served under a host name, the RP id changes and operators must
  re-enroll.
- **Carried from FC-EO-E:** O4 (no nav link from `public/index.html`) is still open. O3 (the service bearer in front of
  remote page calls) does not apply in passkey mode, which is loopback-only by design.

**Founder decisions surfaced:**
- **D1: enrollment takes `--upn` as well as `--name`.** The no-self-issue rule compares the approver against the
  operator's address, and a passkey carries no address. Without `--upn` the rule would be vacuous. The instruction's
  example showed `--name` only.
- **D2: passkey mode must be enabled explicitly** with `CES_EO_OPERATOR_PASSKEY_ORIGIN`. It is not the silent default,
  for two reasons: the existing "nothing configured → 503" assertions are kept, and the exact origin cannot safely be
  guessed from request headers.
- **D3: operators are flat.** Any enrolled operator can add operators and revoke any passkey, including their own.
  Every such action is evidence.
- **D4: the local command can always issue a code**, even after operators exist. This is the recovery path, and it
  needs a shell on the EO box.

Legend: FC-EO-G = this session. FC-EO-H = the parallel EO session (signal-registry overlay / claim-accuracy). FC-EO-E /
FC-EO-F = earlier EO sessions. G1–G5 = the open items above; D1–D4 = decisions for the founder; O3/O4, P1 = items
carried from the FC-EO-E / FC-EO-F sections. WebAuthn / passkey = public-key sign-in with a device or security key. RP
id = WebAuthn relying-party id. UV = user verification (PIN or biometric at the authenticator). WORM = write once, read
many. REQ = requirement file in `docs/requirements/`. HONEST-OPEN = blocked or unproven, with its reason.

## 2026-09-28 feature completion (FC-EO-H)

Adopts ces-shared 2.8.0 (FC-SH, `cb00a20` + `9d873cd`), which promoted FC-EO-D's overlay into the shared registry and
fixed the L1/L2 duplicate keys — this is P1 from FC-EO-F/FC-EO-G, expected red until this session landed. Instruction
file: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-EO-H.md`.

| Item | Before → After | Commit | Tests | REQs |
|---|---|---|---|---|
| Step 1: drop the signal-registry overlay | The 6 overlay controls (AT.L2-3.2.1, AT.L2-3.2.3, AU.L2-3.3.5, PS.L2-3.9.2, RA.L2-3.11.2, SC.L2-3.13.7) lived only in `eoRegistryOverlay.ts`, merged by `effectiveRegistry.ts` → both files deleted; `SignalToControlMapper` loads the shared registry directly (no merge branch). `claim-accuracy.test.ts` was red on main (expected shared = 79; shared was already 85) → now asserts shared = effective = 85, with a new fail-first proof the overlay files/refs are gone. | `b254768` | `tests/unit/claim-accuracy.test.ts` (+3 tests). `tests/mapping/signalCoverageOverlay.test.ts` renamed to `signalCoverage.test.ts`, dropping its now-dead merge-mechanics tests, keeping the fetcher/end-to-end coverage. | `REQ-ces-shared-signal-registry-overlay.md` closed. |
| Step 2: 12 orphaned evaluators from the dropped L2 duplicates | Each dropped duplicate's reference (L1) control already had its OWN distinct evaluator (verified directly against the shared asset), so none of this is a coverage loss. Deleted 11 of the 12 CHANGELOG-named evaluators as dead code (`cuiAccessEvaluator`, `transactionTypesEvaluator`, `externalConnectionsEvaluator`, `sharepointSharingEvaluator`, `mfaEvaluator`, `authenticationEvaluator`, `boundaryProtectionEvaluator`, `publicNetworkEvaluator`, `flawRemediationEvaluator`, `maliciousCodeProtectionEvaluator`, `secureScoreEvaluator`) plus `mediaDisposalEvaluator` (MP.L2-3.8.3's former evaluator, orphaned the same way though not in the CHANGELOG's 12). `manualGateEvaluator` (the 12th name) kept — still heavily used, never itself orphaned. New invariant test proves every registry-named evaluator resolves (nothing silently loses an assessable control) and pins the evaluator-registry dead-code inventory. | `b254768` | `tests/unit/claim-accuracy.test.ts` (+3 tests), `src/eo/mapping/__tests__/SignalToControlMapper.test.ts` (removed 2 describe blocks of deleted code, added 1 proving deletion), `tests/assessment/evaluators/regression.test.ts` (removed 3 tests of deleted code). | New `REQ-ces-shared-dead-evaluator-coverage-gap.md` filed (see HONEST-OPEN below). |
| Step 3a: AO approver-token REQ | Asks 1–3 verified done on `ces-ao` main: ask 1 → `f3f89fb` (`TOKEN_TENANT_MISMATCH`); asks 2–3 → `6c51626` (`APPROVER_ROLE_REQUIRED`, `approverTokenId`). | — (ces-ao's commits) | — | `REQ-ces-ao-approver-token-tenant-binding.md` closed. |
| Step 3b: ces-shared REQs re-verified | Signal-registry overlay promotion and duplicate fix confirmed directly against the shared asset (see step 1). WORM confirmed: `DEFAULT_WORM_COLLECTIONS` includes `eo_approver_token_mints`. | — (ces-shared's commits `cb00a20`, `9d873cd`) | — | `REQ-ces-shared-signal-registry-overlay.md`, `REQ-ces-shared-worm-approver-token-mints.md` closed. |
| Step 3c: six tenant-stacksim signal REQs | `tenant-stacksim` commit `05532d0` added resolvers for all six (training-user-coverage, users, security-incidents, lifecycle-workflows, run-hunting-query, vpn-device-configurations). Re-ran each against the LIVE, already-running sim (never restarted) rather than trusting the commit message: added a `coverageSignals` diagnostic entry to the existing `/api/evidence-explorer/signal` route (same pattern as `identitySignals` etc.), then a new live-sim test connects a sim tenant and asserts each REQ's literal acceptance criterion — a `success` signal with non-empty data — directly. | `8b81d60` | `tests/eo/server/tenant-session-binding.route.test.ts` (+1, route-level fail-first with the existing fake-session-host harness). `tests/integration/eo-live-sim-coverage.test.ts` (new, 2 tests, real sim, outside the gate): both pass in ~10s. | All six `REQ-tenant-stacksim-*.md` closed. |

**Gates on the committed HEAD (`8b81d60`):** `npx tsc --noEmit` clean. `npx jest --no-coverage --testPathIgnorePatterns
eo-live-sim live-assessment` gives **992 passed / 97 suites / 0 failed** (was 969/970 passing on FC-EO-F's HEAD with
the one expected P1 failure; FC-EO-G's snapshot gate separately showed 995/996 with the same one failure). Coverage
stays pinned at 85/110 (the number does not change — it moves from "shared 79 + overlay 6" to "shared 85 alone", per
the founder's decision-4 direction already executed by FC-EO-D). `tests/integration/eo-live-sim-coverage.test.ts` (new,
outside the gate) also passed: 2/2, against the tenant-stacksim sim already running at 127.0.0.1:4390 — confirmed still
up and unrestarted afterward.

**Assessable-control list, before → after this session — computed, not inferred:** diffed
`ces-shared/src/data/control-signal-registry.json` at the pre-FC-SH commit (`cb00a20^`) against the current asset
(`cb00a20`, unchanged since), both filtered to the 110 reference control ids:

```
reference control count: 110
BEFORE (shared registry alone) graph-signalled reference controls: 79
BEFORE (what EO actually evaluated: shared 79 + EO overlay 6)   : 85 — sorted id list
AFTER  (shared registry alone, current — no overlay)            : 85 — sorted id list
SET DIFFERENCE (before-effective vs after)                      : []   <- identical sets
non-reference keys BEFORE (13): AC.L2-3.1.1, AC.L2-3.1.2, AC.L2-3.1.20, AC.L2-3.1.22, IA.L2-3.5.1, IA.L2-3.5.2,
  MP.L2-3.8.3, SC.L2-3.13.1, SC.L2-3.13.5, SI.L2-3.14.1, SI.L2-3.14.2, SI.L2-3.14.4, SI.L2-3.14.5
non-reference keys AFTER (0): (none)
```

The set of 85 reference controls with an automated (graph) signal is byte-for-byte identical before and after this
session — the empty set difference is the proof. What moved is *where* the 6 promoted controls' entries live (EO
overlay → shared registry, verified the 85-id lists match exactly) and *which evaluator functions exist* in EO's
`evaluatorRegistry` (12 dead functions removed; the 13 non-reference duplicate keys are cleanly gone with no
reference-id sibling affected). The manual-gate/provisional set covering the remaining 25 controls is unaffected by
this session (`tests/unit/ssp/controls-completeness.test.ts`, unchanged). Proven ongoing by
`tests/unit/claim-accuracy.test.ts`'s three new assertions: (a) shared registry alone = 85, matching what
`SignalToControlMapper` evaluates; (b) every registry-named evaluator resolves; (c) the dead-evaluator inventory
contains exactly the 3 known pre-existing (unrelated) names, not a growing list.

**HONEST-OPEN:**
- **New finding, out of this session's scope:** the invariant test added for step 2 surfaced 3 evaluators
  (`dlpEvaluator`, `riskDetectionPostureEvaluator`, `vulnerabilityPostureEvaluator`) that are built with real signal
  logic and tested (`tests/assessment/evaluators/si-risk-vuln-coverage.test.ts`) but were never wired into the shared
  registry — predating this session and unrelated to the ces-shared 2.8.0 duplicate cleanup. Not fixed here: wiring
  them requires a ces-shared change (registry assignment), outside this module's write boundary, and a feasibility
  check (would a promotion regress an existing `required: true` signal, the same caution applied to
  `mediaDisposalEvaluator`). Filed as `REQ-ces-shared-dead-evaluator-coverage-gap.md`. The claim-accuracy test pins
  this exact 3-name list so a NEW dead evaluator (a real regression) would fail the gate.
- No HONEST-OPEN against this session's own exit criteria — every step above has a passing fail-first test, and both
  ces-ao/ces-shared REQ closures and all six tenant-stacksim REQ closures were independently re-verified against the
  actual code/live sim, not taken on the CHANGELOG's word.

Legend: FC-EO-H = this session. FC-SH = the ces-shared feature-completion session (2.8.0). P1 = the pre-existing,
cross-session-expected failure named in the FC-EO-F and FC-EO-G sections above. REQ = requirement file in
`docs/requirements/`. HONEST-OPEN = blocked or unproven, with its reason.
