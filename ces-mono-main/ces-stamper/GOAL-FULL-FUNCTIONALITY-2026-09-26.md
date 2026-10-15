# GOAL — Stamper full functionality (issued 2026-09-26)

You are an engineering agent working **only inside `C:/Users/mhsut/DevProjects/ces/ces-stamper`**
(part of the ces-mono repo). Your job is to move every Stamper functionality to **Implemented,
with tests**, and to make the Muster → Stamper → EvidenceOps seams contract-tested. Read the
source assessment first: `C:/Users/mhsut/DevProjects/ces/ces-strategy/docs/context/module-status/stamper.json`
(read-only for you). Re-verify every claim in it against the code before acting on it; it is a
snapshot at commit `07a8a29`.

## Current state (from the 2026-09-26 assessment)
- `npm test`: 253 pass / 0 fail / 1 skip (17 suites). The tests cover helpers only (translator,
  PowerShellAdapter, DependencyResolver, CmmcComplianceAnalyzer, registry data). There are **0**
  HTTP/route tests. `src/server/routes/execute.routes.ts` (2,926 lines) and `assess.routes.ts`
  (1,285 lines) are untested.
- Implemented but untested: ST-03 prereqs, ST-04 preflight, ST-06 configure inputs, ST-09 baseline,
  ST-14 evidence browse, ST-15 reports.
- Partial: ST-11 compute-gaps (API only, no UI, 0 tests); ST-16 EO stamp-capture push (no receiver
  in ces-eo; EC auto-start points at `../eo` + `src/ec/index.ts`, neither of which exists); the
  ST-13 CLI execute (`src/tui/StamperTUI.ts`), which diverges from the GUI execute route.
- Stub: ST-17 CLI `resume`/`report`; rollback (`src/rollback/RollbackHandler.ts`, which only logs
  guidance); the Bicep adapter; the eo-tooled directive (`execute.routes.ts:33-143`, hard-coded not-met).
- Missing: ST-18 AWS (zero code), the Terraform engine, and the server routes `/api/discover` and
  `/api/rescan`, which dead UI code still calls.
- Contract defects:
  - `normalizeStamperAction` (`src/types/ces-artifacts.types.ts:545-571`) maps Muster's
    `N-A-Capability-Absent`, `Met-By-Prohibition` and `Inherited-FedRAMP` to `automated`.
  - Plan-aware Assess marks implement/validate controls "satisfied" without consulting discovery
    (`src/core/CmmcComplianceAnalyzer.ts:351-365,465-471`).
  - The results manifest mixes verdict vocabularies (SAT/MET/NOT MET/N/A/PROVISIONAL).
- 19 of 28 tests in `tests/directive-migration.contract.test.ts` assert in-file copies of logic.

## Target state
All ST-01…ST-17 are Implemented, and each carries route-level or unit tests that exercise product
code. ST-18 AWS is either Implemented to an agreed minimum (see M9) or explicitly de-scoped by the
founder in writing. The Muster→Stamper and Stamper→EO seams are covered by contract tests that run
real fixture artifacts. The full suite is green, offline, sim-only.

## Milestones (do them in order; each ends green)
**M0: Baseline.** Record `npx tsc --noEmit` status and the `npm test` pass count in a new
`docs/goals/GOAL-FULL-FUNCTIONALITY-log.md`. Add a route-test harness: supertest or an in-process
`express` app built from the router factories, with the ces-tenant `SessionManager` injected as a
fake or pointed at tenant-stacksim.
*Accept:* the harness boots the routers with no network access, and there is 1 smoke test per router (12 routers).

**M1: Muster→Stamper contract.**
- Fix `normalizeStamperAction` to map all five Muster `stamper_action` values
  (`Automated`, `Non-Stack`, `N-A-Capability-Absent`→document-absence,
  `Met-By-Prohibition`→document-prohibition, `Inherited-FedRAMP`→inherit-fedramp).
- Make unknown values an error, not a silent `automated`.
- Add fixture copies of a current Muster Manual Mission Plan and Tenant Manifest under
  `tests/fixtures/muster/`. Copy them; never read the sibling at test time.
- Rewrite the tautological directive-migration tests so they call product code.

*Accept:* ≥ 12 tests. The fixture parses with `CESManualMissionPlanSchema` and `CESTenantManifestSchema`; translate yields a plan whose per-control directives match the fixture's `control_directives`; every stamper_action value is covered.

**M2: Honest Assess.** In directive mode, derive "satisfied" from discovery results. Plan intent may
set the category, but a control with `missing > 0` must not be satisfied.
*Accept:* ≥ 6 analyzer tests, including implement+missing → not satisfied, and a route test for `/api/assess` against a fake session.

**M3: Execute route coverage + CLI parity.**
- Add route tests for `/api/execute`, `/api/approve` and `/api/abort` in dryrun or sim mode, covering
  every directive branch: implement, validate, manual/nonstack, document-absence,
  document-prohibition, document-renderable, inherit-fedramp, eo-tooled and skip.
- Either extract the per-directive handling into a shared module used by both the GUI route and
  `StamperTUI`, or retire the TUI loop. There must be one execution semantics.

*Accept:* ≥ 1 test per directive branch plus tests for approve, skip, abort and retry. The results manifest verdicts are normalized to one documented enum with a Zod schema, and a test asserts it.

**M4: EvidenceOps seam.** Decide, and record the decision in the goal log, between two options:
(a) remove the dead `/api/stamp-capture` push and the EC auto-start, documenting that EO consumes
`C:/CES_Pipeline/Stamper/plan-data/<slug>/{evidence,state}`; or (b) file a requirement for ces-eo
(write it in THIS root under `docs/`, never in ces-eo) and keep the client behind a feature flag.
Either way, add a contract test that pins the on-disk evidence and results-manifest shapes EO reads.
*Accept:* no code path targets a nonexistent endpoint or directory, and the shape tests pass.

**M5: eo-tooled.** Replace the hard-coded records with a real adequacy check against whatever EO
interface M4 settled on (file read or API). If no EO signal exists, emit an explicit `pending-eo`
outcome instead of fabricated narratives.
*Accept:* ≥ 5 tests (one per eo-tooled control).

**M6: Rollback + resume/report.** Implement `reverse_task` and `restore_snapshot` using the captured
pre-state (sim first). Implement CLI `resume <plan-id>` from StateManager state and `report <plan-id>`
from the stored results.
*Accept:* ≥ 8 tests, sim-only.

**M7: Untested implemented features.** Add route tests for ST-01, ST-03, ST-04, ST-06, ST-07, ST-08,
ST-09, ST-14 and ST-15. Label Preflight in the UI as granting permissions and require a confirm
step. Wire `/api/compute-gaps` into the UI or remove it.
*Accept:* ≥ 3 tests per functionality.

**M8: Hygiene.** Remove the dead `doDiscover`/`doRescan` UI code, the duplicate `/api/tenants-browse`,
and the orphan `config-variables.html` and `plan-variables.html` (or link them). Fix the cwd-relative
path in `evidence.routes.ts:33`. Unify `getPlanDataRoot()` with ces-shared storage. Move the legacy
root `run-log-*.json` files out of the tracked tree only with founder approval. Make README and
OPERATIONS_GUIDE match the code.
*Accept:* `tsc` is clean and a grep finds no reference to the removed items.

**M9: AWS (founder decision gate).** Stop and ask whether AWS is in scope. If yes, propose a minimum
(an adapter, session type, registry family, and stacksim or mocked coverage) before writing code.

## Ground rules
- **Sim-only.** Never connect to a real tenant, Graph, Azure, or any internet endpoint. Tests use
  fakes, dryRun, or tenant-stacksim on localhost. Do not run `stamper bootstrap`, preflight, baseline,
  or execute against a non-sim tenant.
- **Write boundary** is `ces-stamper/` only. Anything a sibling needs (ces-eo, ces-muster, ces-shared,
  ces-tenant) is written up as a requirement doc in this root and reported, never edited.
- Other sessions have uncommitted edits here. Do not overwrite or stage files you did not change.
- Work in small green commits: each one passes `npx tsc --noEmit` and `npm test` with a pass count ≥
  the previous one. Never force-push, and never rewrite history on shared branches.
- Do not run `npm install` in a way that rewrites the lockfile unless a milestone requires it and you
  record why.
- Put no personal names, emails or handles in code, docs, fixtures or commit bodies.
- **HONEST-OPEN reporting.** Report each milestone as done, partial, or blocked, with evidence
  (`file:line`, test names, counts). Do not mark anything Implemented without a test that exercises
  product code.

## Exit criteria
- Every ST-01…ST-17 is re-rated Implemented with `file:line` evidence and ≥ 1 product-code test.
  ST-18 is Implemented or de-scoped in writing.
- Route tests exist for all 12 routers. The Muster fixture contract and the EO shape contract tests
  pass.
- `npx tsc --noEmit` is clean, `npm test` is green and offline, and the skip count is ≤ 1 with a reason.
- The goal log lists each milestone, its commits, test deltas and open items.

## Legend
- **ST-xx** = Stamper functionality ID from `stamper.json`.
- **M0–M9** = milestones in this document.
- **MP** = Mission Plan.
- **EO** = EvidenceOps (ces-eo).
- **EC** = Evidence Collector.
- **sim / stacksim** = the tenant-stacksim local simulator.
- **HONEST-OPEN** = report the true state, including failures and gaps, with evidence.
- **Levels** (Implemented / Partial / Stub / Missing) are as defined in
  `ces-strategy/docs/context/module-status/AGENT-BRIEF.md`.
