# Flow-Through Report — ces-ao (2026-09)

**Branch:** `flow-through-2026-09`
**Instructions:** `INSTRUCTIONS-FROM-STRATEGY-2026-09-26.md` (superseded by `-27.md`)

## Step status (AE-R1..R3 — per 09-26 instructions)

| Step | ID | Status | Commit | Test names | Notes |
|---|---|---|---|---|---|
| 1 | AE-R1 | **DONE** | `6ca33c4`, `5127124`, `fc5e24b` | `commandExecutionE2E.test.ts` (86 dry-run + 9 Tier-3 live), `cmmcExecutorGate.test.ts` (CMMC deny, CUI deny, clean pass, deny persistence read-back) | Dry-run → outcome `dry_run`, verdict `NOT_APPLICABLE`; denials → `denied_cmmc`/`denied_cui`; `metadata.dryRun` + `metadata.mode` on every row; `dryRun` required in `EvidenceArtifactOptions` |
| 2 | AE-R2 | **DONE** | `e0745f9` | `evidenceContractConformance.test.ts` (19 mapping + 9 round-trip + 2 HONEST-OPEN skipped) | `normalizeOutcome` maps 17→7; `toContractRow` builds `AdminOpsEvidence`; `contractVersion: '1.0.0'` on every persisted row |
| 3 | AE-R3 | **DONE** | `e0745f9` | `commandExecutionE2E.test.ts` (9 Tier-3 pending tests now assert `blocked_pending_approval` evidence) | UUID execution IDs; pending + rejection evidence; tenant slug/kind; requestorUPN/approverUPN/approvalId; correlationId round-trip; persistence failure surfacing; execute route threads correlationId |

## Requirements filed

| File | Target | Status | Summary |
|---|---|---|---|
| `docs/requirements/REQ-shared-adminops-evidence-contract.md` | ces-shared | **SUPERSEDED** (`c0b80b3`) | Versioned Zod schema; adopted by AO in `e0745f9` |
| `docs/requirements/REQ-shared-adminops-evidence-dryrun-invariant.md` | ces-shared | Open (pending S2) | superRefine rejects valid dry-run-mode denials; 2 conformance paths skipped |
| `docs/requirements/REQ-shared-adminops-evidence-sim-refusal-outcome.md` | ces-shared | Open (P2) | Dedicated `denied_sim_only` outcome for sim rail refusals |

## Corrected overclaims

1. **09-26 report claimed 217/217 while 9 tests failed.** The AE-R2/R3 work modified `CommandExecutor.ts` to write pending-approval evidence but the E2E test still asserted "no evidence persisted." The 09-26 session overclaimed passing tests because the changes were in the working tree but not compiled/tested at report time. `e0745f9` inverted the assertion and all 245 pass.
2. **09-26 report marked AE-R2/R3 as "HONEST-OPEN — blocked on ces-shared"** after ces-shared had already shipped the contract in `c0b80b3`. The REQ file remained open despite the gate being met.
3. **AE-R1 commit hash `fc5e24b`** (report update) was omitted from the step-status table; only `6ca33c4`/`5127124` were listed.

## 2026-09-27

### A1 — N-2: verify the AE-R3 landing
**Status: DONE** (hash: `e0745f9`)

Ran gates on committed HEAD: `npx tsc --noEmit` clean, `npm test` 245/245 pass, 2 HONEST-OPEN skipped. `AoServer.ts` is dirty but untouchable (another session's UI work). All 9 Tier-3 halt cases assert exactly one persisted row with outcome `blocked_pending_approval`, verdict `NOT_APPLICABLE`.

### A2 — AE-R3: rejection, persistence-failure, correlation tests
**Status: DONE** (this commit)

Tests in `test/approvalRejection.evidence.test.ts`:
- Rejection evidence: creates Tier-3 request, rejects via `recordApprovalDecision`, reads back one evidence row with `outcome: 'approval_rejected'`, `verdict: NOT_APPLICABLE`, `mode: 'live'`, `dryRun: false` (F-4), `approverUPN`/`approvalId` set, `controlIds.length > 0`.
- Persistence failure: spies on `repo.put` to throw for `adminops_evidence`, asserts `evidencePersisted: false`, `evidenceError` matches, no exception escapes.
- Correlation round-trip: passes `correlationId` in `executeAoCommand` opts, asserts it on the result and on the persisted row.

Pre-test fixes:
- Threaded `controlIds` from `aoCommand.cmmcPractices` through `requestGateApproval` → `createApprovalRequest`.
- Widened `persistEvidenceArtifact`'s try to cover `getCesRepository()`, `repo.get()`, `loadCesConfig()` — any failure returns `evidencePersisted: false`, never throws.
- Threaded `evidenceError` through `CommandExecutor`'s `persistEvidence` closure and return type.
- Added `correlationId` to all error responses (403/400/500) in `execute.routes.ts`.
- Added count=1 assertion in E2E Tier-3 halt tests.

**Route-level addendum (2026-09-27 resume):** A2's acceptance asks for the rejection "through the **route**" and the correlation round trip via `POST /api/execute/:commandId`; the `00ce62c` tests drove the functions directly. Added `test/routes.evidence.test.ts` (routers mounted on an express app on `127.0.0.1:0`, sim tenant, PowerShell boundary mocked; no supertest since `package.json` is untouchable):
- `POST /api/approvals/:id/decision reject → one approval_rejected row, live, verdict ≠ SAT`
- `a self-approval (SoD violation) is refused with 409 and writes no evidence row`
- `POST /api/execute/:commandId echoes the body correlationId and persists it`

### A3 — N-9: correct the record
**Status: DONE** (this commit)

- Marked `REQ-shared-adminops-evidence-contract.md` as SUPERSEDED (shipped in `c0b80b3`, adopted in `e0745f9`).
- Fixed "(this commit)" → `e0745f9` in AE-R2/R3 rows.
- Added `fc5e24b` to AE-R1 commit list.
- Added "Corrected overclaims" section documenting the 09-26 overclaims.
- Verified `c0b80b3` exists: `flow-through AE-R2: AdminOps evidence contract + never-inflate invariant`.

### A4 — AE-R2: persisted contract row + golden
**Status: DONE** (golden commit: `96b7935`; un-skip + REQ close + report: `6f86d7e`)

Gate re-check on resume (2026-09-27, all three hold):
```
grep -c passthrough ces-shared/dist/types/mission-plan.contract.js  → 12
grep -c SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS ces-shared/dist/types/adminops-evidence.contract.js  → 2
git grep -n "F-4 dry-run invariant" flow-through-2026-09 -- ces-shared/src/types/adminops-evidence.contract.test.ts
  → flow-through-2026-09:ces-shared/src/types/adminops-evidence.contract.test.ts:212:describe('F-4 dry-run invariant', () => {
```
(Earlier this day the gate was unmet: 0 / 0 / no match. ces-shared S1 `dcb3b08`, S2 `8697ecd`, S1 follow-up `aac576b`.)

Work:
- `src/execution/EvidenceEmitter.ts` — persisted `data.metadata` **is** `toContractRow()` output (contract `1.1.0`), nothing else. `data.evidence` unchanged. AO-private fields moved: `executionId` → record id; `executorIdentity`, `sha256Hash`, local outcome, `complianceVerdict` → still in `data.evidence`; CES identity → sibling **`data.ces`** (keeps `customerName`, which `CesRecord` columns drop). `test/cesIdentity.test.ts` re-pathed `.metadata.ces` → `.ces`, assertions unchanged. Reversible; ces-eo's reader never read `metadata.ces`.
- `test/contract/evidenceGoldenGenerator.ts` — drives the real persist path (`executeAoCommand` + `ApprovalStore.recordApprovalDecision`) against a temp DB with a `kind:'sim'` loopback tenant; only the PowerShell boundary is mocked. 9 paths: success, failure, denied_cmmc, denied_cui, dry_run, dry_run+deny, pending, rejected, sim-only refusal.
- `test/fixtures/contract/adminops-evidence-rows.golden.json` — exact persisted `data` per path (identity-scanned: clean).
- `test/contract/adminopsEvidence.conformance.test.ts` (40 tests; corrected from "41" in the 09-27 fix batch) — per path: `AdminOpsEvidenceSchema` parse, expected outcome/mode/dryRun + contractVersion `1.1.0`, "pure contract row" (no metadata keys outside the schema), `data.ces` present; success is the only SAT row; rejected row has approver/approvalId; **drift test** regenerates and compares after `normalizeForDrift()` (ignores only `timestamp`/`executionTimestamp`/`decidedAt`/`createdAt`/`approvalId` values plus UUID and ISO-timestamp substrings).
- `scripts/write-evidence-golden.ts` — regenerates the golden (runs the conformance file with `AO_WRITE_EVIDENCE_GOLDEN=1`, since `vi.mock` only works inside vitest).
- Drift proof: appended `' PERTURBED'` to `verdictRationale` in `toContractRow` → `drift: regenerating through the real persist path reproduces the golden` failed on all 9 rows; reverted (not committed).
- `test/evidenceContractConformance.test.ts` — the two `it.skip('HONEST-OPEN: dry-run-mode …')` cases are un-skipped and pass (`dry-run-mode CMMC denial (F-4)`, `dry-run-mode blocked_pending_approval (F-4)`); added `dry-run-mode CUI denial (F-4)` and `dry-run-mode approval_rejected is refused (F-4: a rejection is a live-mode row)`. No `it.skip` remains in `test/`.
- REQ closed: `docs/requirements/REQ-shared-adminops-evidence-dryrun-invariant.md` → CLOSED against ces-shared S2 `8697ecd`.

Golden path table (persisted `metadata`):

| Path | outcome | mode | dryRun | verdict |
|------|---------|------|--------|---------|
| success | executed | live | false | SAT |
| failure | failed | live | false | NOT_SAT |
| denied_cmmc | denied_cmmc | live | false | NOT_APPLICABLE |
| denied_cui | denied_cui | live | false | NOT_APPLICABLE |
| dry_run | dry_run | dry_run | true | NOT_APPLICABLE |
| dry_run+deny | denied_cmmc | dry_run | true | NOT_APPLICABLE |
| pending | blocked_pending_approval | live | false | NOT_APPLICABLE |
| rejected | approval_rejected | live | false | NOT_APPLICABLE |
| sim-only refusal | denied_cmmc (until REQ-…-sim-refusal-outcome) | live | false | NOT_APPLICABLE |

Downstream detection: `git -C <ces-mono> log flow-through-2026-09 --oneline -- ces-ao/test/fixtures/contract/adminops-evidence-rows.golden.json` → `96b7935`.

### A5 — sim-only rail
**Status: DONE** (this commit)

New file: `src/execution/SimOnlyRail.ts`
- `isStacksimModeActive(env)`: true when `STACKSIM_SERVER_URL` is loopback AND first `PSModulePath` segment contains `Microsoft.Graph.Authentication`. Both `--stacksim` flag and inherited env satisfy the same predicate.
- `checkSimOnlyRail(kind, endpoints, env)`: refuses non-sim tenants when `CES_AO_SIM_ONLY=1`; always refuses sim tenants with non-loopback http(s) endpoints.
- Wired into `CommandExecutor` at Step 1.4 (before CMMC gate). Refusals write deny evidence.
- Tests in `test/simOnlyRail.test.ts`: (a) predicate true for injected env, (b) false for absent/real/non-loopback, (c) sim with real endpoints refused, (d) SIM_ONLY=1 refuses live tenant + writes evidence.

**Server-side `'dev'` fallback:** already absent — execute route rejects missing tenant (400). `plan-data/dev/dev.json` has no explicit `kind`, so `detectLegacyKind` classifies it as `'live'` → refused under `CES_AO_SIM_ONLY=1`. No server-side code path defaults to `'dev'`.

**UI-side `'dev'` fallback:** `public/index.html` (untouchable) defaults to `'dev'` in several places. **WAITING-on-founder.**

**GetThenSetExecutor dry-run:** the rail runs before GetThenSetExecutor is reached. A tenant refused by the rail never enters the executor. For allowed tenants, the dry-run get-half is called with `dryRun=true` (`GetThenSetExecutor.ts` Phase 1), and ces-stamper's `PowerShellAdapter.execute` short-circuits on `dryRun` (`PowerShellAdapter.ts:134`, stub pre-state, no invocation) — so a dry run makes **no network read** on any tenant (re-verified read-only on 2026-09-27 resume; the earlier "get-half read is permitted" wording overstated it). Side observation for W4: the same `dryRun=true` get call on **live** runs means live pre/post-state is a stub, not a real read — not a safety issue, but the pre-state evidence is not real (to be raised in W4 with the tester §2.x work).

REQ filed: `docs/requirements/REQ-shared-adminops-evidence-sim-refusal-outcome.md` (P2 — dedicated `denied_sim_only` outcome; workaround: `denied_cmmc` with descriptive rationale).

### Gates (committed HEAD after A1-A5)

- After A5 (`c627c8a`): `npx tsc --noEmit` clean; `npm test` 261 passed, 2 skipped (20 files).
- After A4 golden (`96b7935`): `npx tsc --noEmit` clean; `npm test` 301 passed, 2 skipped (21 files).
- After A4 un-skip (`6f86d7e`): `npx tsc --noEmit` clean; `npm test` 305 passed, 0 skipped (21 files).
- After the A2 route-level tests (final commit): `npx tsc --noEmit` clean; `npm test` 308 passed, 0 skipped (22 files).
- All gate runs were made with the six untouchable dirty files present in the shared tree (they cannot be isolated without stashing, which is forbidden).

### Corrected overclaims (2026-09-27)

- The 09-26 report said AE-R2/AE-R3 were blocked on ces-shared after ces-shared had already shipped the contract (`c0b80b3`); corrected in A3.
- The 09-26 working tree broke 9 Tier-3 tests while the report claimed 217/217; corrected by `e0745f9` and verified in A1.
- The ces-ao 09-27 session log (earlier turn) listed `7b9d5ed`, `52f6c2f` and `aac576b` as ces-ao commits. They are not: `7b9d5ed`/`52f6c2f` are ces-stamper commits and `aac576b` is ces-shared. The ces-ao commits that day were `00ce62c` (A1–A3) and `c627c8a` (A5), then `96b7935` (A4 golden) and the A4 follow-up.
- The same earlier turn claimed E3 ("no uncommitted flow-through file") while `session-ces-ao-2026-09-27.md` was untracked. It is committed with the A4 follow-up. The remaining untracked files (`INSTRUCTIONS-FROM-STRATEGY-2026-09-26.md`, `INSTRUCTIONS-FROM-STRATEGY-2026-09-27.md`, `INSTRUCTIONS-FROM-TESTER-2026-09-26.md`, `GOAL-FULL-FUNCTIONALITY-2026-09-26.md`) are inbound instruction files authored by other sessions, deliberately left for their authors / the founder to commit.
- A2 was marked Done in `00ce62c` although its route-level acceptance (reject through the route; correlation via `POST /api/execute`) had no route test; closed by `test/routes.evidence.test.ts`.
- A5's GetThenSetExecutor note said the dry-run get-half read "is permitted"; in fact no read happens on dry run (see A5).

### Dev fallback

- **Server-side:** no `'dev'` fallback found in `src/`. The execute route requires `tenant` in the body (400 if missing). `CommandExecutor` receives the tenant config from the route — no fallback.
- **UI-side:** `public/index.html` defaults to `'dev'` in multiple places (lines 836, 857, 1034, 1202). This file is untouchable (another session's uncommitted work). **WAITING-on-founder** for the UI fix.

## 2026-09-27 fix batch

Instructions: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md` (after Gate 2; evidence
`ces-strategy/docs/context/module-status/adminops.md`). Every cited `file:line` was re-verified
against the code before acting.

| Step | Status | Commit | Acceptance tests (production code, passing) | REQs |
|---|---|---|---|---|
| FX-AO1 CUI boundary override (P0) | **DONE** | `523af3a` | `test/cuiOverride.test.ts` (3, through `executeAoCommand`); `test/ParameterMapper.test.ts` (+3 unit, 1 corrected) | none |
| FX-AO2 sim-only on by default (P0) | **DONE** | `acf9deb` | `test/simOnlyRail.test.ts` (a)-(d) unit + 5 through the executor | closed `REQ-shared-adminops-evidence-sim-refusal-outcome` |
| FX-AO3 lost evidence surfaced (P1) | **DONE** | `acf9deb` | `test/fixBatch.routes.test.ts` "FX-AO3" (4, through the real routers) | none |
| FX-AO4 approver identity (P2) | **DONE (execute path) / HONEST-OPEN (authentication)** | `acf9deb` | `test/fixBatch.routes.test.ts` "FX-AO4" (1, route level) | filed `REQ-shared-http-request-principal` |
| FX-AO5 report accuracy (P2) | **DONE** | `a87b15c` | n/a (see "Corrected overclaims" below) | none |

### FX-AO1 — CUI boundary override
`ParameterMapper.ts:55-58` merged request inputs last, so a request value overwrote the
checked tenant value, and an unresolvable `resources.*` source could be filled by the request
with no check at all. Now:
- A request value for a `source`d parameter never overrides a tenant-resolved value. It is
  ignored and logged (`console.warn`).
- A request value for a `resources.*` parameter is checked against the tenant's `cuiBoundary`,
  whether or not the tenant value resolved. Out of boundary means a `CuiBoundaryDenialError`,
  which the executor persists as `denied_cui`.

Tests (sim tenant, `cmmcMigrationExempt:false`, explicit allowlist):
- An unresolvable source filled out of boundary → `denied_cui` row, verdict not SAT, executor
  never called.
- A swap from an in-boundary tenant value to an out-of-boundary one → `denied_cui`.
- A legitimate in-boundary request runs against the tenant value.

### FX-AO2 — sim-only on by default
`SimOnlyRail.checkSimOnlyRail` decides in this order:
1. A `kind:'sim'` tenant runs only if all its endpoints are loopback.
2. `CES_AO_SIM_ONLY=1` refuses any non-sim tenant (lockdown beats opt-in).
3. Without `CES_AO_ALLOW_LIVE=1`, a non-sim tenant is refused.
4. With the opt-in, a tenant not explicitly `kind:'live'` (including no kind) is refused.
5. Otherwise the request is allowed.

The rail covers dry-runs too. Refusals persist deny evidence with the contract 1.2.0 outcome
`denied_sim_only`: ces-shared FX-SH1 landed it in `2e07bc2` during this batch, AO adopted it,
and that closes AO's REQ.

Tests:
- (a) No env set: a live tenant is refused through the executor, the deny row is persisted and
  the executor is never called. The dry-run variant is covered too.
- (b) Opt-in set but the tenant is not live: refused, with a row.
- (c) Opt-in and a live tenant: allowed, and the mocked `PowerShellAdapter.execute` is called.
- (d) Stacksim endpoints are allowed with any env.

The golden was regenerated at 1.2.0 with `npx tsx scripts/write-evidence-golden.ts`. The only
diffs are `contractVersion` (×9), the sim-only row's outcome, and volatile timestamps/ids.
ces-eo's `AdminOpsEvidenceReader.realShape.test.ts` (11 tests) passes against the new golden.
It was run read-only from ces-eo, against ces-eo's working tree (its reader file had
uncommitted changes), not its committed HEAD.

`dist/` is git-ignored. The MCP server (`mcp/ao-mcp-server.mjs`) and any CLI run from `dist/`
enforce the new default only after `npm run build`. It was rebuilt locally after `acf9deb`, and
`dist/execution/SimOnlyRail.js` carries `CES_AO_ALLOW_LIVE`.

Consequence: the web UI's `'dev'` default (a kind-less, hence `live`, record) and any live
tenant are refused with evidence unless the operator sets `CES_AO_ALLOW_LIVE=1` and marks the
record `kind:'live'`. The pipeline test files (`cmmcExecutorGate`, `commandExecutionE2E`) opt in
explicitly in their own `beforeEach`. There is no global opt-in, so the rail tests prove the
default.

### FX-AO3 — lost evidence surfaced
- `persistEvidenceArtifact` logs every failed write at error level with a stable prefix
  (`[EvidenceEmitter] EVIDENCE NOT PERSISTED:`). This one choke point covers the executor, the
  approval store, the CLI and MCP.
- `POST /api/execute/:id` returns `evidencePersisted` on every status (200/202/400/403/500). On
  a loss it adds `evidenceLost:true`, `evidenceError` and `evidenceWarning`, and logs an error.
- A failed rejection write is recorded on the approval (`evidenceError`). The decision
  response, `GET /api/approvals` and `GET /api/approvals/:id` then show
  `evidenceLost`/`evidenceWarning`.
- The UI rendering of these flags is in `public/index.html`, which is untouchable. The server
  now provides the data.

### FX-AO4 — approver identity
The execute path already took the approver from the approval record
(`consumedApproval.approverUPN`). Now a request-supplied `approverUPN` (body or inputs) is
explicitly ignored and logged. Route test: request → approve (approver B) → execute with a
forged `approverUPN` → the persisted `executed` row carries B and the forged value appears
nowhere in the row.

**HONEST-OPEN:** the decision route still takes `approverUPN` from the body. The shared bearer
middleware authenticates the service, not a user, so no authenticated approver exists to bind
to. Filed `docs/requirements/REQ-shared-http-request-principal.md`; not faked.

### Gates (committed HEAD)
- After `acf9deb`: `npx tsc --noEmit` clean; `npm test` 329 passed, 0 skipped (24 files).
- The run used the shared working tree. The untouchable dirty files (`public/*`,
  `src/server/AoServer.ts`, `package.json`, `collective-ces-ao.md`) were present, and ces-shared
  was at `42c2cb0`.

### Corrected overclaims (fix batch, from `adminops.md`)
- The report said the golden conformance file has **41** tests. It has **40**, both at `96b7935`
  and now (A4 section corrected inline).
- `docs/contracts/ADMINOPS-EVIDENCE-CONTRACT.md` said **v1.0.0** while the code emitted 1.1.0.
  The doc now says 1.2.0, adds `denied_sim_only`, and marks the dry-run superRefine
  HONEST-OPEN as closed.
- Two characterization tests asserted the defects and were **corrected, not weakened**:
  - `ParameterMapper.test.ts` asserted that a request overrides a tenant-sourced value (the
    CUI bypass).
  - `simOnlyRail.test.ts` asserted that a live tenant is allowed with no env set.
- The A5 section says a kind-less `dev` record is "refused under `CES_AO_SIM_ONLY=1`". Since
  FX-AO2 it is refused **by default**.
- Still open and not claimed as fixed:
  - `isStacksimModeActive()` is still not called from `src/`.
  - The web route has no dry-run/apply guard beyond the rail. The rail now blocks all non-sim
    tenants by default.
  - Pre/post state is a stub.
  - 26 commands have unresolvable sourced parameters.
  - A missing `requestorUPN` on a Tier-3 request returns HTTP 500.
  - Health reports `0.2.0`.

### Fix batch follow-up: contract 1.3.0 (FX-AO6)

Trigger: ces-shared bumped the AdminOps evidence contract to 1.3.0 (`2e07bc2` 1.2.0
`denied_sim_only`; `03a6d0a` 1.3.0 optional `targetUPN`/`targetObjectId`) and filed
`ces-shared/docs/requirements/REQ-ces-ao-adminops-evidence-1-2-0-adoption.md`. Baseline before
the fix: 10 failed / 63 passed in the two conformance files (golden and a pinned literal at 1.2.0).

- **Status: DONE**, commit `980e115`.
- Rows emit the live `ADMINOPS_EVIDENCE_CONTRACT_VERSION` (1.3.0). The conformance test asserts
  against that constant; the pinned `'1.2.0'` literal is gone. No assertion was weakened: the test
  now also checks each path's expected `targetUPN`.
- Target identity: `src/execution/TargetIdentity.ts` reads only the command's declared parameters,
  using an allowlist. `targetUPN` comes from `targetUPN` (12 commands, incl. A-03/B-05) or `upn`
  (A-01/A-02/A-07). It applies to every executor row (denials and pending included) and to
  approval-store rejections. Operator identities (`operatorUPN`, `adminUPN`, `breakGlassUPN`,
  `serviceAccountUPN`) and `deviceId` are never mapped.
- `targetObjectId` stays unpopulated because no registry command carries a user object id. This
  is not faked.
- Golden: regenerated only with `npx tsx scripts/write-evidence-golden.ts`. There are still 9 paths.
  All rows are at 1.3.0, and `success` and `rejected` now carry `targetUPN`.
- Tests: new `test/targetIdentity.contract13.test.ts` (5 tests) runs the real registry A-02, A-03
  and B-05 through `executeAoCommand`:
  - The A-02 live executed row carries the disabled user's `targetUPN`, which is not the requestor.
  - The sim-only refusal row parses as `denied_sim_only` at 1.3.0, and its verdict is not SAT.
- Gates on `980e115`: `npx tsc --noEmit` clean; `npm test` 334/334 (25 files); `dist/` rebuilt
  (`npm run build`, git-ignored).
- Downstream check (read-only): `ces-eo`: `npx jest --no-coverage tests/eo/adminops` passed
  7/7 suites, 51/51 tests, against the new golden. It ran on ces-eo's working tree and nothing in
  ces-eo was edited.
- REQ: ces-shared's `REQ-ces-ao-adminops-evidence-1-2-0-adoption` is satisfied, with asks 1–4 done
  (the `denied_sim_only` switch was already in `acf9deb`). ces-shared owns that file and should
  mark it closed. ces-ao did not edit it.
- Contract doc `docs/contracts/ADMINOPS-EVIDENCE-CONTRACT.md` updated to 1.3.0.

## Legend

- AE-Rn = AdminOps → EvidenceOps recommendation n (from strategy flow-through plan)
- A1–A5 = step ids from 09-27 instructions
- N-n = new finding (grand plan §7.2)
- F-n = founder decision (grand plan §7.4)
- S1/S2 = ces-shared step ids
- P0 = blocks the flow
- SAT = "satisfied" compliance verdict
- SPRS = Supplier Performance Risk System score
- REQ = requirement file for another module
- HONEST-OPEN = path known to be incomplete, transparently documented with blocking reason
- WAITING = gate not yet met
- FX-AOn = step ids in `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md` (FX-AO6 = contract-1.3.0 adoption follow-up); FX-SHn = ces-shared's fix-batch step ids
- CUI = Controlled Unclassified Information

## 2026-09-27 final fixes

FX-AO7 closes the three UI items that were WAITING-on-founder. `public/index.html` and
`src/server/AoServer.ts` were carried forward in `a4dbb44` and are now in scope for this session.

| # | Item | Status | Proof |
|---|------|--------|-------|
| 1 | UI `'dev'` tenant default (old lines 836/857/1034/1202) | **DONE** | `test/guiTenantSelection.test.ts` (a) |
| 2 | `evidencePersisted:false` shown only as a log line | **DONE** | `test/guiTenantSelection.test.ts` (b) |
| 3 | REQ-AO-GUI-NO-CORRELATION-ID (filed by ces-tester) | **DONE** | `test/guiCorrelation.routes.test.ts` + (c) |

**1. Explicit tenant, no default.**
- New `GET /api/tenants` (`src/server/routes/tenant.routes.ts`) returns `{ tenants: [{slug, kind}], liveAllowed }`.
  It lists the ces-tenant registry's `sim` and `live` records, with sim first, and returns no secrets.
- `liveAllowed` mirrors the SimOnlyRail order: `CES_AO_SIM_ONLY=1` beats `CES_AO_ALLOW_LIVE=1`, and
  with no opt-in the server is sim-only. The rail in the executor still enforces this.
- The hidden `#liveTenantInput` (`value="dev"`) is replaced by an always-visible `#tenantSelect`,
  filled from `/api/tenants`. It starts on an empty "— select tenant —" option.
  When the server is sim-only, live tenants are labelled "refused: server is sim-only".
- `getSelectedTenant()` returns `''` when nothing is selected, and there is no fallback.
- `executeCommand()` and the F-11/F-12 `checkFirewallState()` probe do not call `/api/execute`
  without a tenant. Instead they show a **NO TENANT** block in the result panel or pre-check badge.
- `openCommandForm()` no longer resets the tenant. `loadTenantConfig()` skips when no tenant is
  selected. Changing the tenant reloads the config and refills the `source` parameters.
- Server refusals render as a **REFUSED** badge with a red banner that quotes the server's reason.
  This covers `denied_*` outcomes, including the sim-only rail message that names
  `CES_AO_ALLOW_LIVE=1`, and route-level 4xx errors carried in the top-level `error`.
  Before this fix, a 4xx showed "No output available".

**2. Evidence loss is a prominent error.**
- A red `#evidenceLostBanner` (`role="alert"`) in the result panel shows `evidenceWarning` and the
  cause whenever the response has `evidencePersisted === false` or `evidenceLost`.
- The banner renders before the Tier-3 202 `pending_approval` early return, so every response shape
  is covered. It is cleared on the next healthy result.
- In the approvals modal, each row flagged `evidenceLost` shows an inline banner.
- An approve/reject decision whose evidence was lost shows `#approvalsEvidenceBanner`.
- Server strings are set through `textContent`, never inserted as HTML.

**3. correlationId per execution.**
- `newCorrelationId()` returns `ao-ui-<uuid>`. It uses `crypto.randomUUID()`, and falls back to a
  `getRandomValues` v4 UUID where `randomUUID` is missing. That happens on plain-http remote access,
  which is not a secure context.
- A fresh id is sent on every `/api/execute` call: EXECUTE and the firewall state probe.
- The result panel shows `correlationId: …`, using the server's echo when there is one.
- `test/guiCorrelation.routes.test.ts` drives the **real UI `executeCommand`** (the index.html scripts
  in `node:vm`) against the real execute router on 127.0.0.1:0. It asserts that the persisted
  `adminops_evidence` row has `metadata.correlationId` equal to the UI-generated id.
- ces-tester can now key EV2 on correlationId. ces-tester owns
  `REQ-AO-GUI-NO-CORRELATION-ID.md` and should mark it closed. ces-ao did not edit it.

**Test approach.** No jsdom: the repo has no DOM dependency, and the monorepo lockfile is shared.
`test/uiHarness.ts` extracts the inline `<script>` blocks from `public/index.html` and compiles them
unmodified in `node:vm` against a small DOM stub. A syntax error in the served page therefore fails
the suite.

A mutation check confirmed the tests catch regressions. I re-introduced a `'dev'` fallback, dropped
`correlationId` from the execute body and disabled the evidence banner. That made 11 of the 22 new
tests fail. I then restored the file.

The old `guiTenantSelection.test.ts` mirror test asserted the `'dev'` fallback. It has been replaced.

**Gates.** `npx tsc --noEmit` is clean. `npm test` passes 353/353 across 26 files. `dist/` was
rebuilt with `npm run build` (it is git-ignored). Sim-only throughout: `CES_AO_ALLOW_LIVE` was never
set, and the `isLiveAllowed` test uses an injected env map.

Legend addition: FX-AO7 = this final UI fix batch (tenant selection, evidence-loss display, UI correlationId).
## 2026-09-27 wave 4

Instructions: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-W4.md`. Sim only throughout: the new stacksim suites set
`CES_AO_SIM_ONLY=1`, delete `CES_AO_ALLOW_LIVE`, and refuse to start unless `isStacksimModeActive(process.env)` is
true. Nothing was pushed.

| Step | Status | Commits | Acceptance tests |
|---|---|---|---|
| W4-AO1 real before/after state | **DONE** | `cde655f`, `97838b9`, plus the read-path follow-up in the final commit | `test/getThenSet.realState.test.ts` (17, unit); `test/integration/realState.stacksim.test.ts` (12, stacksim) |
| W4-AO2 bind tenant-sourced parameters | **DONE** (13 of 32 sourced commands bind on stacksim) + **HONEST-OPEN** for the other 19 → `REQ-tenant-stacksim-ao-source-keys` | `cde655f`, `d5d47e8` | `test/sourceBindings.test.ts` (37) |
| W4-AO3 authenticated approvers | **DONE** (gate met: `32a07d5` W4-SH1) | `a9e7f5b`, UI half in `4ba1da0` | `test/approvalPrincipal.routes.test.ts` (6); `test/uiHooks.test.ts` (approvals block) |
| W4-AO4 95-op readiness | **DONE**: matrix PASS 19 / HONEST-OPEN 76 / FAILING 0; hooks on every command form | `4ba1da0`, `d5d47e8` | `test/uiHooks.test.ts` (110); `test/integration/ao95.matrix.stacksim.test.ts` (2, stacksim) |

**Gates on the committed HEAD:**
- `npx tsc --noEmit` is clean.
- `npm test`: 525 passed and 14 skipped, across 30 files. The 2 integration files are skipped because they are opt-in.
- With `AO_STACKSIM_IT=1`, `npx vitest run test/integration` passes 14/14. The matrix run takes about 70 s, and each op
  takes about 0.4-2 s.

### W4-AO1: real before/after state

- **Before:** `GetThenSetExecutor` issued both state reads with the adapter's `dryRun=true`. Stamper's
  `PowerShellAdapter` then returned its placeholder `"[dry-run] PowerShell commands validated"`, so that string was every
  persisted pre/post state. `stateChanged` meant only "the set ran".
- **After: the reads are real.**
  - Reads run with `dryRun=false`, through a reader. On a live run the reader is the live adapter. On a dry run it is a
    separate adapter built from a non-dry context, so the session really connects.
  - Each snapshot is marker-delimited compact JSON (`ConvertTo-Json -Depth 8 -Compress`), so Format-Table truncation cannot
    hide a change.
- **After: the comparison is real.** `stateChanged` is `pre !== post`. It is left undefined when either snapshot is
  missing and is never guessed. The new metadata fields are `setApplied` and `stateReadError`.
- **After: the safety rules.**
  - Every state read first passes a read-only guard, `readOnlyViolation`. The guard refuses mutating verbs in command
    position, `Invoke-Mg<Action>`, and non-GET REST calls. A unit test proves that every registry get-then-set
    `get_command` passes it.
  - A dry run sends only the guarded read.
  - A live write whose pre-read fails is aborted (never blind-write).
  - If a dry-run reader cannot be built (for example, no cert file), the pre-state is recorded as unavailable, with the
    reason.
- **Stacksim proof.**
  - One working write op per domain that has one: A-18, B-09, D-06, E-01, F-08 and H-01. Each records `pre != post` and
    `stateChanged=true`, and the stacksim store itself changed.
  - Idempotent re-runs of A-18 and F-08 record `pre == post` and `stateChanged=false`.
  - A dry run reads the seeded state and leaves the store untouched.
  - No persisted row contains the placeholder.
  - B-09 and E-01 bind here only because this one test supplies two REQ-proposed keys. The MAM policy ids that B-09 uses are
    NOT seeded objects: the sim materialises a stub object on B-09's write, and that stub is the change B-09's read
    observes. The test header says so.
  - A dry run of a read-only op (A-13) also does the real read: the seeded CA policy appears, and no placeholder does.
- **Read path (follow-up after the advisor review).** Dry runs of the 51 read-only ops still went through the adapter's
  dry-run branch, so the placeholder was persisted as `rawResponse`. The matrix showed this on 45 rows. Now:
  - A dry run of a read-only op does the real read, through the same non-dry reader and read-only guard.
  - If the guard refuses the command, or no reader can be built, nothing runs, `rawResponse` is empty, and
    `stateReadError` says why.
  - The matrix classifier now fails any response, state or row output that carries the placeholder. The final run shows
    0 rows with the placeholder.
  - The contract golden was regenerated with `scripts/write-evidence-golden.ts`. Only the dry-run row changed: its
    `rawResponse` is empty and its hash is the hash of the empty string. ces-eo's `tests/eo/adminops` and
    `AssessorViewAdminOps` suites were run read-only and passed (8 suites, 57 tests).
  - The other golden rows' pre/post fields still come from the mock adapter, as before W4; the row shape is unchanged.
- **Mutation check:** against the pre-W4 executor, 10 of the 11 original stacksim tests fail.
- **Domains with no state-changing write on the sim today:** C and G.
  - C: C-03 fails because the az-shim returns 500. C-02, C-06, C-09 and C-10 show pre == post.
  - G: G-02 needs `training_enforcement_group_id`.
  - Both are in the matrix with their REQs.
- **Level:**
  - AO-12 Dry-run preview goes P → I for write ops, which now show the real current state.
  - AO-17 Evidence capture stays I, but its pre/post and `stateChanged` are now real.

### W4-AO2: bind tenant-sourced parameters

- `src/execution/SourceBindings.ts` is one table covering every registry `parameter.source`. A test proves that no source is
  missing.
- **Resolution order:**
  1. The literal path (back-compat).
  2. The Stamper tenant object's `resources.<snake_case>` or `subscription.*` keys (founder decision 2026-09-26).
  3. A platform constant. This applies only to the built-in Entra role template ids, which are identical in every tenant.
- **Unknown values:** if a required value is supplied by neither the tenant record nor the request, AO raises
  `UnboundSourceError`, records a `failed` evidence row, and the route returns 400. Nothing is sent to the tenant. Before
  this, a command could go out with an unsubstituted `{placeholder}`.
- **CUI boundary:**
  - Literal `resources.*` sources keep the FX-AO1 check.
  - Azure resources mapped from camelCase sources (`keyVaultName`, `sentinelWorkspaceName`, `backupVaultName`) are now
    boundary-checked too.
  - Directory ids and UPNs keep their previous, unchecked behaviour.
- **Result against the stacksim `m365_azure` tenant object as emitted:** 13 of 32 sourced commands bind: A-09, A-10, A-11,
  A-15, A-19, C-03, C-05, F-08, F-13, F-14, H-01, H-02 and H-03.
- **The other 19 are HONEST-OPEN:**
  - The ops are A-01, A-05, A-06, A-14, A-17, B-06, B-07, B-08, B-09, D-05, D-09, E-01, F-07, F-11, F-12, G-01, G-02, G-03
    and G-05. H-07 joins them after W4-AO4 made it sourced.
  - Their missing keys are proposed in `docs/requirements/REQ-tenant-stacksim-ao-source-keys.md`.
  - The test reads that REQ, so every missing key must be listed there against its op.
- **Mocked suites updated:**
  - `commandExecutionE2E` now carries a complete tenant object. Its old camelCase `resources` keys never matched any source
    path, so those params had been silently unbound.
  - The `cmmcExecutorGate` sim case carries A-01's two keys.
- **Level:** AO-03 Tenant resolve / auto-fill stays P. Server-side binding is done, but the UI's readonly-field auto-fill
  still reads `tenantConfig[param.source]`, not the table.

### W4-AO3: authenticated approvers

- **Gate:** `git log main --grep W4-SH1` returns `32a07d5` (ces-shared `http/principal` 2.4.0).
- **Decision route:** `POST /api/approvals/:id/decision` now runs behind `requirePrincipal`, configured in
  `src/server/principal.ts`.
  - `CES_AO_PRINCIPAL_SECRET` sets the HS256 secret; issuer and audience are optional.
  - `CES_AO_DEV_PRINCIPAL_UPN` sets an explicit dev principal, accepted on loopback only.
  - With nothing configured, every decision gets 401 (fail closed).
- **Recorded approver:** the principal's UPN. A body `approverUPN` is ignored and logged. The approval also records
  `approverSubjectId`, `approverVerified` and `approverPrincipalSource`.
- **Execute route:**
  - When a principal token is sent, the route verifies it; an invalid token gets 401.
  - With a valid token, the principal becomes the requestor (`requestorAuthenticated`), so SoD compares two authenticated
    identities.
  - A Tier-3 execute with no requestor now gets 400 (it was 500).
- **Tests:** all 6 fail against the pre-W4 routes.
  - An unauthenticated decision gets 401, and no row or decision is recorded.
  - An unconfigured server gets 401.
  - An authenticated approval records the principal, and the executed row carries it.
  - An authenticated requester approving their own request gets 409.
  - A bad token on execute gets 401.
- **UI:** the approver enters a sign-in token (`approver-token`), sent as `x-ces-principal`. A 401 shows a "sign-in
  required" message.
- **Level:** AO-16 Two-person approval goes P → I.
- This closes the AO side of `REQ-shared-http-request-principal`; ces-shared should mark it closed.
- **Breaking for API and UI callers:** a decision sent the old way (body `approverUPN`, no token) now gets 401. Filed as
  `docs/requirements/REQ-ces-tester-approval-principal.md`, which explains how to authenticate in sim runs.

### W4-AO4: 95-op readiness

- **UI hooks** (`docs/contracts/AO-UI-TEST-HOOKS.md` v1.0.0):
  - `cmd-<ID>` on every command, and `param-<name>` on every declared parameter.
  - Hooks on the form, tenant, live toggle and execute button.
  - Hooks on the firewall pre-check and its confirm modal.
  - Hooks on the approvals modal, including `approve-<id>` and `reject-<id>`.
  - `result-panel` carries `data-state` (`idle|blocked|executed|dry_run|denied|pending_approval|failed`), plus
    `data-outcome`, `data-verdict`, `data-approval-id` and `data-correlation-id`.
  - `test/uiHooks.test.ts` renders all 95 commands through the real inline scripts. All 110 tests fail against the previous
    `index.html`.
- **UI bugs fixed on the way:**
  - The SAT badge and verdict now read `complianceVerdict`.
  - The "85 commands" count is now derived from the registry.
  - A-09 and A-11 parameters have no `type`. They rendered no field and a label of "undefined"; both now render.
- **The 95-op matrix** (`test/integration/ao95.matrix.stacksim.test.ts`, which generates `docs/AO-95-OP-MATRIX.md`):
  - **Path:** every op goes over HTTP through the real execute and approvals routers (approvals are
    principal-authenticated), then the executor, PowerShell, and the in-process stacksim.
  - **Runs per op:** a dry run and a live run. Tier-3 ops go pending first; self-approval gets 409, then a second person
    approves and the live run follows. One rejection is also proven.
  - **Sim-only deny:** on a `kind:'live'` record, 95/95 ops return `denied_sim_only`.
  - **CMMC deny:** on an L1 tenant, every L2 op returns `denied_cmmc`.
  - **CUI deny:** on an out-of-boundary L2 tenant, C-03, C-05, E-01, F-11 and F-12 return `denied_cui`; Tier-3 ops stop at
    SoD first.
  - **Evidence rows:** each request's own row is read back by correlationId and schema-validated. All ~470 requests wrote
    exactly one conforming row.
- **Result: PASS 19 / HONEST-OPEN 76 / FAILING 0.**
  - PASS: A-08, A-11, A-13, A-15, A-18, A-19, B-02, B-03, B-10, C-05, C-07, D-06, F-01, F-05, F-06, F-08, H-01, H-04 and
    H-06.
- **HONEST-OPEN by REQ** (all tenant-stacksim):

| REQ | Ops | Main cause |
|---|---|---|
| `REQ-tenant-stacksim-ao-source-keys` | 20 | tenant-object keys not emitted |
| `REQ-tenant-stacksim-graph-fidelity` | 32 | `-UserId '<UPN>'` resolves to `user-1` (on the sim, **A-03 hard-deleted `user-1`, not the requested user**); a POST to a collection breaks its GET (B-13, B-14); the roleEligibilityScheduleRequests POST returns 500; seed gaps |
| `REQ-tenant-stacksim-azure-fidelity` | 4 | az keyvault returns 500; F-13 and F-14 writes are not visible in the read |
| `REQ-tenant-stacksim-m365-compliance` | 20 | `Search-UnifiedAuditLog` returns nothing for every record type; DLP, label, case and PnP gaps |

- **AO-side fixes found by the loop:**
  - C-06 now loads `System.Web` before calling `Membership.GeneratePassword`. On PS 5.1 it failed on every tenant.
  - The A-10 role definition id is now tenant-derived; it was a hardcoded GUID.
  - The H-07 vault and resource group were empty string literals, so H-07 could not succeed anywhere. They are now
    tenant-sourced.
- **Levels:**
  - AO-18 UI result goes P → I.
  - AO-20 Stacksim / sim-only rail goes P → I: the harness exists and all 95 ops ran under sim-only.
  - The 19 PASS ops are now **sim-proven**. Before W4, AO's own suite had run no op against stacksim.
  - The other 76 ops keep their prior level, with the blocking REQ recorded per op.
- **Still open (not in W4 scope):**
  - A read that returns no data is still verdict `SAT`, because of the verdict logic's exit-code rule. The matrix does not
    count these reads as PASS.
  - The web route has no apply guard.


### W4-AO5 follow-up

Closes the two "still open" items above plus ces-eo's control-id REQ. Sim only; nothing pushed.

| Item | Status | Commit | Acceptance test (proven failing on the old code) |
|---|---|---|---|
| 1. Empty read ⇒ SAT (P0) | **DONE** | `4c7b8d5` | `test/emptyRead.verdict.test.ts` (8): 7 empty shapes (no output, whitespace, `null`, `[]`, `{}`, `""`, Graph `{"value":[]}`) persist a schema-valid live row with verdict `NOT_SAT` that ces-eo's `liveSatAdminOpsControls` (imported read-only) does not credit; a read with data stays SAT and credited. Old code: 7/7 SAT. |
| 2. Control ids in reference form (P1) | **DONE** | `d452655` | conformance test "every controlId on every golden row is a ces-shared reference control id". Old golden: 5 rows carried `AC.L2-3.1.1`. |
| 3. Apply guard on the web route (P1) | **DONE** | `2498c34` | `test/applyGuard.routes.test.ts` (8): a live apply without `confirmApply` = command id → 428, executor never called, refusal row persisted; with it → runs live; dry runs unguarded; the served UI sends it only from the Live toggle. |

- **Item 1:** `EvidenceEmitter.isEmptyReadResult` + `buildEvidenceArtifact({ readOp })`. The outcome stays `executed`
  (the read ran); only the verdict is demoted, with rationale "Read returned no data ...". The contract has no
  inconclusive verdict, so `NOT_SAT` is used → `REQ-ces-shared-adminops-evidence-inconclusive-verdict`. Trade-off: an
  empty list that means "no violations found" is now also `NOT_SAT`, per the P0 rule. "Read" = the single-command
  path minus set-only commands (0 of 95 registry commands are set-only there today; a test pins that a set-only
  write with empty output stays SAT — review follow-up commit).
- **Item 2:** the registry was already 104/104 reference-form (pinned by `registryValidation`); the L2 spelling came from
  test fixtures and the golden generator. All five `AC.L2-3.1.1` golden rows now carry `AC.L1-3.1.1`. The golden was
  regenerated with `scripts/write-evidence-golden.ts`; nothing else in it changed except volatile fields.
- **Item 3:** `src/execution/ApplyGuard.ts`, wired into `execute.routes.ts` after input validation. The refusal row is
  live, contract outcome `failed`, verdict `NOT_APPLICABLE`, local outcome `denied_apply_guard` (no contract outcome yet;
  same REQ). Existing live route tests and the stacksim matrix now send the confirmation.
  → `REQ-ces-tester-execute-apply-confirmation` for direct live POSTs (UI-driven runs are unaffected).
- **ces-eo, read-only** (`npx jest --no-coverage tests/eo/adminops tests/viewer/AssessorViewAdminOps.test.ts`) on the
  final golden: 56/57. The one failure is `adminops-yaml-lint.test.ts:103`, which pins the old spelling
  `['AC.L2-3.1.1']` → `REQ-ces-eo-golden-control-id-reference-form` (a one-literal change).
- **Gates at HEAD:** `npx tsc --noEmit` clean; `npm test` 32 files passed, 2 skipped (stacksim), 543 tests passed,
  14 skipped.
- **Levels:** evidence score integrity (empty read) moves from defect to fixed; the web-apply safety rail now matches
  CLI/MCP.

Legend:
- **W4-AO1..AO4:** the wave-4 steps in the instruction file.
- **PASS / HONEST-OPEN / FAILING:** matrix statuses, defined in the matrix doc.
- **SoD:** separation of duties.
- **pre / post:** the get-then-set state snapshots.
- **I / P:** Implemented / Partial functionality levels, from the module-status AO-nn ids.
- **REQ:** a requirement file for another project.
- **W4-AO5:** the follow-up items (empty read, control-id form, web apply guard) from the strategy orchestrator.
- **confirmApply:** request field that must equal the command id for a live web apply.

## 2026-09-27 fix round 2

Source: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX2.md` (founder-approved, after the post-Wave-4 re-assessment).
Sim only; live flags stayed off; nothing pushed.

| Step | Status | Commit | Acceptance tests (each proven failing on the old code) |
|---|---|---|---|
| FX2-AO1: CLI + MCP approvals need a verified approver (P0) | **DONE** | `d53d42f` | `test/verifiedApprover.cliMcp.test.ts` (19). Old code: 8 fail; the real `ao approve --approver <name>` process approved. The old MCP server (HEAD `.mjs` + old `dist/`) also approved a typed `approverUPN`, checked by hand over stdio. |
| FX2-AO2: banner-only output is not data (P1) | **DONE** | `4a2f122` | `test/bannerOnly.verdict.test.ts` (10; old code: 7 fail) + `test/integration/bannerOnly.stacksim.test.ts` (4, opt-in; old code: 4/4 SAT) |
| FX2-AO3: firewall pre-check reads the wrong field (P1) | **DONE** | `435d738` | `test/firewallPrecheck.ui.test.ts` (5; old HTML: 5/5 fail) + `test/integration/firewallPrecheck.stacksim.test.ts` (1, opt-in) |

**FX2-AO1.** `src/execution/VerifiedApprover.ts` holds the one decision path for the CLI and MCP. It verifies a signed
principal token (`ces-shared/http/principal`, HS256) with the web route's own posture: `CES_AO_PRINCIPAL_SECRET` and
optionally `_ISSUER` / `_AUDIENCE`, from `aoPrincipalOptionsFromEnv`. There is no dev-principal fallback. It records the
token's UPN, subject id, `verified:true` and `source:'token'`.
- **CLI:** `ao approve <id>` takes the token from `CES_AO_PRINCIPAL_TOKEN` or `--principal-token`. The logic is in
  `src/cli/approveCommand.ts`.
- **MCP:** `ao_approve` requires `principalToken`, the approver's own token. It does not fall back to a token in the
  server's env. Tool dispatch moved to `src/mcp/aoMcpTools.ts`; the `.mjs` is now transport only.
- **Refused:** a typed `--approver` / `approverUPN` (even alongside a valid token), no token, no secret configured, a
  bad or expired token, and self-approval. In every case the approval stays `pending`.
- **Structural change:** `ApprovalStore.recordApprovalDecision` now takes an `ApproverPrincipal` object (upn +
  subjectId + a consistent `source`/`verified` pair), never a string. A test pins its only callers: `VerifiedApprover`
  and the web decision route.
- **Operator setup** is documented in the CLI help (`ao approve --help`), the MCP tool description and `README.md`.
- **Caveat:** an MCP caller is an agent. "Second person" over MCP is only as strong as the control over who holds a
  given principal token.

**FX2-AO2.** `EvidenceEmitter.stripSessionBanners` runs before the empty-read decision. `rawResponse` is kept verbatim.
It strips:
- the Stamper success sentinel;
- a table or list whose columns are all connection fields, including at least one field found only on connection
  objects (`ConnectionUri`, `ExchangeEnvironmentName`, ...). Generic columns such as Name, State or Id never qualify, so
  real data is not demoted;
- the EXO V3 module notice;
- the Graph welcome text.

After stripping, the existing W4-AO5 logic applies: remaining `[]` or `{value:[]}` counts as empty, and remaining text
counts as data.
- **D-02 on stacksim:** now `NOT_SAT` with the empty-read reason, through the production executor.
- **95-op stacksim matrix:** live SAT rows went from 72 to 39. PASS / HONEST-OPEN counts are unchanged (19 / 76, 0
  FAILING); the matrix classifier already treated these as no-data.

**FX2-AO3.** `public/index.html` `checkFirewallState` now reads `result.result.stdout`. The stacksim run showed a second
defect: the executor's state capture pipes the get_command through `ConvertTo-Json`, and F-11/F-12's get_command
already ends in `ConvertTo-Json`, so the snapshot is a JSON string that holds the object. The pre-check unwraps one
level. The unit test's mocked boundary reproduces that double encoding, and the fix was proven necessary: with the
field path alone, 3 tests fail.

**Corrected overclaims**
- **W4-AO5 item 1 ("an empty read is never SAT") held only in its unit test.** That test's mocked adapter omitted the
  `STAMPER_EXECUTION_SUCCESS` sentinel, which real sessions leave in `stdout` on this path. On stacksim, every empty read
  was still SAT: A-12, C-01 and D-01 had output `"STAMPER_EXECUTION_SUCCESS\r\n"` and verdict SAT. FX2-AO2 fixes this;
  33 of the 95 live stacksim rows moved from SAT to NOT_SAT.
- **W4-AO4 "hooks on the firewall pre-check"** (line ~504): the hooks existed, but before FX2-AO3 the badge could only
  show STATE UNKNOWN (or REFUSED). The hooks were present, but the pre-check never worked.

**Open follow-ups (not fixed here, AO-internal)**
- **E-06:** a PowerShell `Count` table showing `0` is still counted as data (SAT). The matrix treats it as no data. It is
  the tabular form of an empty list. Demoting it is a policy call, like W4-AO5's "no violations found" trade-off:
  **founder decision**.
- **Double-encoded state snapshots:** any get_command that already ends in `ConvertTo-Json` (F-11, F-12, others) gets
  its pre/post snapshot double-encoded in evidence. Before/after comparison still works because it compares strings. A
  cleaner capture belongs in `GetThenSetExecutor`, but changing it moves persisted snapshots, so it is left for a
  scoped change.
- **Write-op verdicts:** 19 write ops are HONEST-OPEN ("write applied but the paired read shows no change") yet have a
  SAT live verdict. That is outside this round's scope.

**REQs:** one new: `REQ-ces-mono-mcp-approver-principal`. The root `.mcp.json` launcher needs `CES_AO_PRINCIPAL_SECRET`
(and `npm run build` first) whenever it enables apply; today it has `AO_MCP_ALLOW_APPLY=0`, so `ao_approve` is blocked anyway.

**Founder decision (from FX2-AO1):** there is no production token issuer. `signPrincipalToken` has no non-test caller, and
the web UI takes a pasted token. Approver tokens can only be minted by whoever holds `CES_AO_PRINCIPAL_SECRET`. Until
someone decides who holds it, and how each approver gets their own token (for example an Entra-backed verifier), CLI and
MCP approvals are refused by design.

**Unverified edit:** `scripts/verify-safety-gate.mts` was moved to the token path but not executed, because its tenant
config is non-sim with real endpoints. It is also not type-checked by `tsc --noEmit`, because `scripts/` is outside
`include`.

F-11/F-12 on stacksim still need `resources.firewall_name`, which is already in
`REQ-tenant-stacksim-ao-source-keys`; the stacksim pre-check test adds it the same way the realState test does. No other
module calls `ao approve --approver` or MCP `ao_approve`. Two root docs still show the old form, `docs/specs/as-is/as-is-ao.md` and
a 07-03 session log. They are outside ces-ao, so they were not touched.

**Gates at HEAD:** `npx tsc --noEmit` clean. `npm test`: 35 files passed, 4 skipped (stacksim opt-in); 579 tests passed,
19 skipped. With `AO_STACKSIM_IT=1`, the 4 stacksim files pass 19/19 (95-op matrix, realState, banner, firewall
pre-check).

Legend:
- **FX2-AO1..AO3:** the steps in the fix-round-2 instruction file.
- **SoD:** separation of duties.
- **Principal token:** an HS256 signed identity token (`x-ces-principal`) verified with `CES_AO_PRINCIPAL_SECRET`.
- **Sentinel:** the `STAMPER_EXECUTION_SUCCESS` line the Stamper session appends.
- **SAT / NOT_SAT:** satisfied / not-satisfied verdicts.
- **HONEST-OPEN:** blocked, with the reason and REQ recorded.

## 2026-09-27 feature completion (FC-AO)

Ran `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FC-AO.md` (four steps named in `ces-strategy`'s
`docs/context/feature-completion/PLAN.md` Wave FC-1). Per-feature status:

| ID | Status before | Status after | Commit | Tests |
|---|---|---|---|---|
| AO-22 | Stub (`200 {status:'queued'}`, did nothing) | Implemented (`410 {error:'gone: use POST /api/execute/:commandId'}`) | `270156d` | `test/commandsRoute.legacy.test.ts` (3) |
| AO-04 | Partial (evidence row's `targetUPN` proven; rendered command text not) | Implemented (rendered A-03 get/set commands proven to carry only the requested UPN) | `21d0b4c` | `test/targetIdentity.renderedCommand.test.ts` (3) |
| AO-03 | Partial (server bypass closed; UI auto-fill still read the raw tenant object, blank for 13 snake_case-bound commands) | Implemented (`GET /api/tenant/bindings`, UI reads the resolved map) | `84773e3` | `test/tenantAutoFill.ao03.test.ts` (5) |
| AO-20 | Stub (`isStacksimModeActive()` defined, never called; no GUI/MCP entry point) | Implemented (fail-closed in `CommandExecutor.ts`; displayed via `GET /api/tenants` + `ao_execute`) | `53b8c6a` | `test/ao20.stacksimModeDisplay.test.ts` (6) + 3 new cases in `test/simOnlyRail.test.ts` |

**Unplanned prerequisite (commit `34cddb1`):** `test/sourceBindings.test.ts` had 3 pre-existing
failures at the session's start, reproduced against unmodified HEAD — not caused by this
session's work. The concurrently-running SIMFIX session added `resources.m365_license_sku_id`
(and `baseGroupId`'s key) to `tenant-stacksim/src/config/SimTenantConfig.ts` mid-flight
(uncommitted, a separate nested git repo), flipping the "this source is currently unbound"
premise two tests hardcoded. Fixed by cloning the tenant and deleting the sources under test
before asserting, so the tests pin AO's own unbound-value error path rather than the sim's
current data completeness. Required for the full-suite gate (X-E2) even though not one of the
four named steps.

**AO-20 blast radius:** wiring `isStacksimModeActive()` into `CommandExecutor.ts`'s fail-closed
rail meant every existing test that runs a `kind:'sim'` tenant through the production executor
now needed this process routed to stacksim too — 12 test files updated via a new shared helper
(`test/stacksimEnv.ts`), no assertions weakened.

**Git incident (recorded in the session log in detail):** this shared `ces-mono` tree runs
several module sessions concurrently against one git index. Commit `84773e3` (AO-03, plain
`git commit`, no pathspec) swept in two FC-EO-B files staged at the same moment
(`ces-eo/tests/eo/personnel/TrainingEmailHelper.test.ts`,
`ces-eo/tests/eo/server/training-screening.route.test.ts`) — confirmed via `git show --stat`
on all commits; only that one was affected. No data was lost (matches the precedent FC-EO-B's
own session log records for the same date); not rewritten, per the founder's no-history-rewrite
rule. Every commit after this incident used an explicit pathspec
(`git commit -m "..." -- <files>`), and `git status --short` / `git diff --cached --stat` were
checked immediately before every subsequent commit to confirm only this session's files were
staged.

**Not in scope (per instructions, unchanged):** AO X1 write-verdict policy, E-06 count-0,
approver token issuer, and the AO-04..AO-11 domain op-level gaps (100% BLOCKED-ON-SIM, waiting
on the SIMFIX session per Wave FC-2) — no REQs filed for these since they are founder-decision
or cross-session items already tracked in `ces-strategy`'s `VERIFY-ao.md`.

**REQ filed (AO-20 consequence):** `docs/requirements/REQ-ces-mono-mcp-stacksim-routing.md` —
the AO-20 fail-closed check means the root `.mcp.json` `ces-adminops` launcher (env is only
`{AO_MCP_ALLOW_APPLY:"0"}`, no `STACKSIM_SERVER_URL`/`PSModulePath`) now has every MCP
`ao_execute` against a `kind:'sim'` tenant refused as launched today; `ao gui` also has no
`--stacksim` equivalent (only `ao exec` does), so a browser session needs the shell it was
started from to already have stacksim env exported. Not a code defect — fail-closed is the
point — but it needs a launcher/operator fix outside ces-ao's write boundary. Verified by
reading (not running): the 4 opt-in `test/integration/*.stacksim.test.ts` files already call
the production `requestAoStacksimMode()` against real `process.env` and self-check
`isStacksimModeActive(process.env)` before running (`stacksimHarness.ts`), so they need no
update for this change.

**Gates at HEAD:** `npx tsc --noEmit` clean. `npm test`: 39 files passed, 4 skipped (stacksim
opt-in, not run per instructions); 599 tests passed, 19 skipped (618 total) — up from the
session's starting baseline of 579 passed/19 skipped (598 total; +20 net new tests across the
four features and the sourceBindings fixture fix). Not pushed.

Legend (this section only, beyond the file's existing legend above): **FC-AO** = this
session's id in the feature-completion plan · **AO-nn** = feature ids from
`ces-feature-surfacing-2026-09-27.xlsx` · **SIMFIX** = the concurrent tenant-stacksim fix
session · **BLOCKED-ON-SIM** = needs a tenant-stacksim change, tracked by a REQ in
`ces-ao/docs/requirements/` · **X1** = the write-verdict-ignores-`stateChanged` finding in
`ces-strategy`'s `VERIFY-ao.md`.
- **REQ:** a requirement file for another project.

## 2026-09-28 feature completion (FC-AO-2)

Instructions: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-AO-2.md`. Founder decisions 2026-09-27 #7 (approver tokens
issued by EO, tenant-scoped), #8 (X1) and #9 (E-06). Sim only: every sim run used AO's in-process stacksim
(`tenant-stacksim/dist`, built 2026-09-28 from master `a710cd1`); the running sim on 127.0.0.1:4390 was not touched.

| Step | Item | Before | After | Commit | Tests (fail-first) |
|---|---|---|---|---|---|
| 1 | Approver token tenant binding (P0) | `verifyApproverToken` ignored `tid`: a token minted for tenant A could approve a tenant-B Tier-3 request on web, CLI and MCP | `recordApprovalDecision` (the one path all three surfaces use) refuses a token principal whose `tid` is missing or differs from the approval's tenant: `TOKEN_TENANT_MISMATCH` (web 403, CLI exit 1, MCP throw); nothing is recorded. The approval records `approverTenantId`. | `f3f89fb` | `test/approverTenantBinding.test.ts` 15 (store, web, CLI, MCP; cross-tenant, no-`tid` and same-tenant). 9 refusal cases fail without the check. |
| 2 | X1: write with no observed change | Every live write that exited 0 was SAT, even when its paired read showed no change | SAT -> NOT_SAT (`NO_OBSERVED_CHANGE_RATIONALE`) only when the set was applied, `stateChanged === false`, and the idempotency class is always-mutate (`unsafe_requires_gate`, `unsafe`). Idempotent classes (`get-then-set`, `evidence-only`, `best_effort`, `safe`) unchanged; a missing snapshot is not "no change". Matrix classifier FAILs any idempotent op carrying the X1 rationale. | `8ee8a6c` | `test/x1.writeVerdict.test.ts` 9 (Tier-3 through a real approval; every idempotent class). 2 demotion cases fail without the executor wiring. |
| 3 | E-06: a count of 0 | A `Measure-Object` `Count` table showing `0` was data (SAT) | Output that is only zero counts (single-column `Count` table, `Count : 0`, JSON `{Count:0}`) is an empty read -> NOT_SAT, `EMPTY_READ_RATIONALE`. Non-zero, multi-column, or anything else is data. On the sim E-06 returns a count of 2 and stays PASS/SAT (proven by fixture: E-06's real sim stdout with the count at 0). | `581378e` | `test/emptyRead.verdict.test.ts` +10 (incl. the real registry E-06). 5 zero-count cases fail pre-fix. |
| 4 | tenant-stacksim REQs against AO | 11 ops HONEST-OPEN on AO's side (inputs, command text, paired reads, a classifier override); matrix REQ-listing assertion red | Paired reads read the changed field: A-07 Authenticator configuration state, B-05 `ManagementState`, B-08 the policy's apps, C-09 `Password Rule Settings` values, D-03 case + hold + `AccountEnabled` (`eDiscovery` spelled right). D-02 emits its own JSON per statement; E-07 quotes `-Operations` and searches the `AzureActiveDirectory` record type. Inputs: A-05/A-06 `sim.inactive1`, A-20 the duplicate pair, F-08 an ARM id, H-01 `incident-1`; D-02 `NO_DATA_OBSERVED` override removed. | `1aa6094` | `test/fcAo2.simReqs.test.ts` 14 (12 fail on the old templates/inputs; E-07 checked with the real PowerShell parser); `test/bannerOnly.verdict.test.ts` +2 |
| 5 | 95-op matrix | PASS 84 · HONEST-OPEN 11 · FAILING 0 (second assertion red) | **PASS 94 · HONEST-OPEN 1 · FAILING 0**, both assertions green; 0 wrong-object writes (A-03 deleted exactly `user-5`); 43 live writes all `stateChanged=true`; no op demoted by X1; every PASS op's live verdict is SAT | `c4a4263` | `docs/AO-95-OP-MATRIX.md` regenerated |

**AO defect found on the way (step 4).** `stripSessionBanners` treated every non-blank line after a connection table's
header as a table row. D-02's new JSON output follows the IPPS connection row with no blank line, so D-02's real DLP
data was stripped and judged an empty read. Rows now stop at a line that starts a JSON value or runs past the table
width. Fail-first: the 2 new `bannerOnly.verdict` cases fail on the old stripper.

**Premise changes in the opt-in sim suites.** `bannerOnly.stacksim.test.ts` asserted that D-02 is banner-only and that
A-12/C-01/D-01 return nothing on the sim. Both are no longer true (D-02 fixed here; the three reads fixed by SIMFIX). The
file now asserts the current behaviour (D-02's data after the banner is SAT, the banner kept verbatim; A-12/C-01/D-01
SAT) and keeps a sim-backed empty-read proof: A-12 after every guest is removed from the sim store is NOT_SAT with the
empty-read reason. The banner-only rule stays pinned by the unit fixture. `realState.stacksim.test.ts` (F-08, H-01)
was red on the fixed sim for input reasons and is green with the step-4 inputs.

**Per-domain status (Implemented = every op proven on the sim):**

| Feature | Domain | Matrix | Status |
|---|---|---|---|
| AO-04 | A Identity & Access | 20/20 PASS | Implemented |
| AO-05 | B Devices | 13/14 PASS (B-08 HONEST-OPEN) | Partly — B-08's read is real-Graph-correct; the sim lacks `Get-MgDeviceAppManagementAndroidManagedAppProtectionApp` |
| AO-06 | C Credentials & Config | 10/10 PASS | Implemented |
| AO-07 | D Data Protection | 11/11 PASS | Implemented |
| AO-08 | E Audit & Monitoring | 10/10 PASS | Implemented |
| AO-09 | F Security Posture | 14/14 PASS | Implemented |
| AO-10 | G Personnel & Training | 8/8 PASS | Implemented |
| AO-11 | H Incident Response | 8/8 PASS | Implemented |

**REQs.** Filed: `docs/requirements/REQ-tenant-stacksim-ao-paired-read-endpoints.md` (B-08 read; optional A-07 beta
per-user requirement URI), `docs/requirements/REQ-ces-shared-principal-token-id.md` (expose `jti` so AO can link each
decision to EO's mint record — ces-eo REQ ask 3). Marked MET: AO's four REQs against tenant-stacksim (source keys,
azure/graph fidelity, m365 compliance). Answered here but living in other roots (not edited — outside this root):
tenant-stacksim `REQ-ces-ao-matrix-inputs.md`, `REQ-ces-ao-paired-reads.md` (all but B-08), `REQ-ces-ao-source-paths.md`
(informational, no AO change needed: SourceBindings already tries every key; all sources bind), and ces-eo
`REQ-ces-ao-approver-token-tenant-binding.md` ask 1 (done), ask 2 (roles gate, not done — see below), ask 3 (blocked on the
ces-shared REQ).

**Not done, by choice (founder list):** (a) the explicit loopback dev principal (`CES_AO_DEV_PRINCIPAL_UPN`, web only,
recorded `verified:false`) carries no tenant and is not tenant-bound; (b) requiring `roles` to include `ao-approver`
(ces-eo REQ ask 2) would refuse every token not minted by EO's issuer; (c) X1 by design leaves write-shaped ops of class
`get-then-set`/`evidence-only` untouched, so a no-change write of those classes stays SAT.

**Gates on the final HEAD:** `npx tsc --noEmit` clean; `npm test` and `AO_STACKSIM_IT=1` sim suites (4 files) — counts in
the session log `session-ces-ao-2026-09-28.md`. Nothing pushed.

## 2026-09-28 feature completion (FC-AO-3)

Instructions: `INSTRUCTIONS-FROM-STRATEGY-2026-09-28-FC-AO-3.md`. Founder decision 10 (round 2, 2026-09-28):
`docs/context/feature-completion/DECISIONS-2026-09-28.md` #10. Continues FC-AO-2's "not done, by choice" list above —
items (a) and (b) there are exactly this session's steps 2 and 1.

| Step | Item | Before | After | Commit | Tests (fail-first) |
|---|---|---|---|---|---|
| 1 | Only `ao-approver`-role principals approve | Any verified token principal (or the dev loopback principal) could decide an approval regardless of role — FC-AO-2's step-1 tenant check was the only gate | `ApprovalStore.assertApproverRole` (new; `recordApprovalDecision` calls it before the tenant check, before the approval is even fetched) refuses a principal whose `roles` do not include `ao-approver`: `APPROVER_ROLE_REQUIRED` (web 403, CLI exit 1, MCP throw); nothing recorded. `VerifiedApprover.verifyApproverToken` now carries the token's `roles` through; the dev principal is constructed with the role (`principal.ts`). | `6c51626` | `test/approverRoleRequired.test.ts` 11 (store, web, CLI, MCP). 7 of 11 fail against the pre-change code. |
| 2 | Dev loopback approver tied to a tenant | `CES_AO_DEV_PRINCIPAL_UPN` decided on ANY tenant — `assertApproverTenant` explicitly exempted `source !== 'token'` | New `CES_AO_DEV_PRINCIPAL_TENANT`; `withDevApproverTenant` (principal.ts) attaches it as the dev principal's `tenantId` before the decision reaches the store; `assertApproverTenant` no longer exempts the dev source, so it gets the identical fail-closed check a token gets. UPN configured with no tenant configured now fails closed (`TOKEN_TENANT_MISMATCH`, web only — the dev principal never reaches CLI/MCP). | `6c51626` | `test/devApproverTenantBound.test.ts` 7 (web + the `withDevApproverTenant` unit). 7 of 7 fail against the pre-change code. |
| 3 | Record the approver token id | `ApprovalRequest` had no field for the token's `jti`; `RequestPrincipal` did not expose it either (ces-eo REQ ask 3, blocked on ces-shared) | ces-shared 2.8.0 (already committed) exposes `tokenId` on `RequestPrincipal`; `VerifiedApprover` carries it through and `recordApprovalDecision` persists it as `approverTokenId` on every decision — explicit `null` (not absent) when the approver carried none (the dev principal always has none). Also written into the AO-private evidence metadata (`StructuredEvidence.metadata.approverTokenId`, `StamperTypes.ts`) on BOTH the rejection path (`ApprovalStore.ts`) and the executed-row path (`CommandExecutor.ts`, mirroring how `approverUPN` already flows from `consumedApproval` there) — NOT the shared `AdminOpsEvidence` contract row, which is version-locked in ces-shared and unchanged. | `6c51626`, executed-row half in `f9ee756` | `test/approverTokenId.test.ts` 10 (store decisions + rejection evidence with/without jti; web/CLI/MCP surface checks; an approve-then-execute test proving the EXECUTED row also carries it). 9 of 10 fail against the pre-change code (store/evidence); the executed-row case fails 1/1 on its own revert. |
| 4 | Rebuild `dist` | — | `npm run build` (run twice — once after `6c51626`, again after `f9ee756` added the `CommandExecutor.ts` line, which the first build predated); verified `dist/execution/ApprovalStore.js`, `dist/execution/CommandExecutor.js` and `dist/server/principal.js` carry `approverTokenId` / `APPROVER_ROLE_REQUIRED` / `withDevApproverTenant` so the MCP server (which imports `dist/`) enforces steps 1-3 in full, including the executed-row half. `dist/` is gitignored — nothing to commit. | n/a | grep on the built output (above) |
| 5 | 95-op matrix | PASS 94 · HONEST-OPEN 1 (B-08) · FAILING 0 | **PASS 95 · HONEST-OPEN 0 · FAILING 0** — B-08 now PASSes; closed independently by the parallel tenant-stacksim session while this one was in flight (matrix run `mmulk40yp` on ces-mono `00eb329`), not by any change in this session. Steps 1-3 touch only the approval-decision path, not the sim ops the matrix exercises, so the matrix move is coincidental timing, not this session's work. | (docs commit) | `docs/AO-95-OP-MATRIX.md` regenerated |

**Step 3, executed evidence (initially scoped out, then added).** The first pass recorded `approverTokenId` only on
the rejection evidence and reasoned that the executed-row path was "X1 territory" and out of scope. On review that
reasoning didn't hold: X1 lives in `EvidenceEmitter.deriveVerdict`/`buildEvidenceArtifact`, not in the one line needed
here (`CommandExecutor.ts`, right before `persistEvidence`, after the verdict is already computed); and `approverUPN`
already flows from `consumedApproval` into that same evidence object, so the token id belongs there for the same
reason. For an APPROVED decision the executed row is the only evidence there is, so leaving it out there while the
rejection path carried it was an asymmetry, not a real scope boundary. Added: `if (consumedApproval) evidence.metadata
.approverTokenId = consumedApproval.approverTokenId ?? null;`, proven by a new approve-then-execute test in
`test/approverTokenId.test.ts` (fails on its own revert). The shared `AdminOpsEvidence` contract row is unaffected
either way — this is the same AO-private `StructuredEvidence.metadata` extension used for the rejection path.

**REQs closed.** `docs/requirements/REQ-tenant-stacksim-ao-paired-read-endpoints.md` (B-08 PASS, closed by the parallel
session, not by us — see step 5) and `docs/requirements/REQ-ces-shared-principal-token-id.md` (ces-shared 2.8.0 ships
`tokenId`, consumed by step 3) both marked CLOSED with evidence, in this root.

**Answered but not edited (lives in another root — see FC-AO-2's note on the same pattern):** ces-eo's
`REQ-ces-ao-approver-token-tenant-binding.md`, whose asks 2 and 3 FC-AO-2's session log logged as "not done" — ask 2
("require `roles` to include `ao-approver`") is exactly this session's step 1; ask 3 (`jti` on the decision) is
exactly this session's step 3. Both are now satisfied. ces-eo's own session should close that file; not edited here
(outside this root's write boundary).

**No HONEST-OPEN items this session.** Every step (1-4) reached Done: fail-first test, production code, passing,
committed. The matrix is 95/0/0, better than the "94/1/0 or better" exit bar.

**Founder-visible items from this session:**
- FC-AO-2's still-open items are unchanged by this session: AO-16 (production token issuer / who holds
  `CES_AO_PRINCIPAL_SECRET`, `docs/requirements/REQ-ces-mono-mcp-approver-principal.md`) and X1's policy question
  (`VERIFY-ao.md`) remain FOUNDER-DECISION, out of this session's step list.

**Gates:** `npx tsc --noEmit` clean; `npm test` 677 passed / 20 skipped (was 649/20 at session start); `AO_STACKSIM_IT=1`
sim suites (4 files) 22/22 — run on the tree that became commit `f9ee756` (working tree was clean immediately after).
The close-out commit that adds this paragraph and the `dist` rebuild proof is docs/build-only; no source changed
after the gates above, so they were not rerun for it. Nothing pushed.
