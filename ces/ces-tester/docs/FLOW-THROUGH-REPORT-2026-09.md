# ces-tester — CES flow-through report (waves W2 → W3)

Instructions: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27.md` (supersedes the 09-26 file).
Branch: `flow-through-2026-09` in worktree `.worktrees/flow-through`. No push (F-1).

## 2026-09-27

### Summary

| Step | What | Status | Commit |
|---|---|---|---|
| X0 | Branch + worktree per F-6 | **Done** (2 deviations, below) | — (no files) |
| X1 | MS-R3 Muster-output contract test | **Done**, with one **HONEST-OPEN** case (all-met, upstream ces-stamper) | `96a6dfe` |
| X2 | MS-R10 move `clean-tenant-mfa-baseline` onto Muster | **Done** — live PASS against fresh stacksim | `cac1633` |
| X3 | AE-R6 AO → EO end to end on real rows | **WAITING (gate: AO A4 + EO E5 unmet; AO A5 + EO E1 met)** | — |
| X4 | This report | **Done** | this commit |

**G3 verdict: G3 open: X3 (waiting on AO A4 + EO E5), X1 all-met case (REQ-STAMPER-ALL-MET-PLAN-REJECTED).**

### X0 — Branch and worktree

- `main` does not exist locally (branches: `g-tester-1`, `gp-aoops-1`, `gp-demo-1/3/4`).
  **F-6 deviation: no local main; branch based on 6129b58; founder to confirm.** (The orchestrator
  relayed founder confirmation of this base for this run.)
- `git worktree add .worktrees/flow-through -b flow-through-2026-09 6129b58`;
  `git -C .worktrees/flow-through branch --show-current` → `flow-through-2026-09`.
- **Second deviation (npm install):** `package.json` depends on `"ces-tenant": "file:../ces-tenant"`,
  which from `.worktrees/flow-through` resolves to the non-existent `.worktrees/ces-tenant`. Instead of
  `npm install` (which would produce a broken link and lockfile churn), the worktree's `node_modules`
  is a directory **junction** to the main checkout's `node_modules` (read-only use; nothing in the
  main checkout changed). No dependency added; no lockfile change.
- HEADs recorded before and after: `gp-demo-4` = `gp-aoops-1` = `6129b58d44d1ef420437c73f4ff81c68a20fb5bb`
  (both unchanged at the end — see E7).
- Gates on the untouched base: `npx tsc --noEmit` clean; `npm test` 66 files / 878 tests pass.

### X1 — MS-R3: Muster-output contract test — Done (+1 HONEST-OPEN case)

**Upstream output obtained by:** option (b), a read-only in-process import of Muster's real generator
`ces-muster/src/features/plan/tenantManifestAdapter.ts#buildPlanArtifacts` — the one-compile builder
`planCompileService.compilePlanForSession` calls. (`planCompileService.ts` itself needs Dexie and the
Vite bank fetch, so the pure builder beneath it is the entry point; the banks are Muster's shipped
`ces-muster/public/knowledge/*` loaded by absolute path.) Option (a) was not used: muster-api's
`POST /api/plan/push` (`muster-api/src/routes/plan.ts:22-66`) stores a client-supplied plan; it does
not compile one, so it cannot be the generator.
Only generator **inputs** live in this repo (`src/flow/muster-plan-cases.ts`: SIT answers keyed by real
SI-bank question ids + readiness posture). No hand-built plan anywhere.
`vitest.config.ts` mirrors Muster's `@/` alias into `ces-muster/src` (resolution only).

**Upstream commits used:** ces-muster `179260c`; ces monorepo (ces-shared dist + ces-stamper src)
`d668c16` for the X1 commit run; re-verified green at the final gate run against ces monorepo `454120d` (ces-muster still `179260c`).

**Test file:** `tests/contract/muster-stamper.contract.test.ts` (21 tests). Pipeline per case:
ces-shared `ManualMissionPlanSchema` + `TenantManifestSchema` (dist) → Stamper
`ManifestReader.fromFile` → Stamper `PlanTranslator.translate` (directive mode, constructed as
`stamper translate` does: `mpControls` = MP `controls[]`, command registry loaded).

| Case | Muster output | shared MP / TM | Stamper translate | Consumed fields |
|---|---|---|---|---|
| gapful (mixed posture + no-mobile + removable-media-blocked) | 121 steps; Automated 76, Non-Stack 29, Met-By-Prohibition 3, N-A-Capability-Absent 2 | accept / accept | directive mode OK | all pass |
| FedRAMP-inherited (cloud_only, gcc_high, package id, 0 facilities, 0 equipment) | 127 steps; Inherited-FedRAMP 12 | accept / accept | directive mode OK | all pass; 12 `inherit-fedramp` tasks carry `_fedramp_package_id = F1234567890` |
| all-met (every requirement `met`) | **0 steps**; 104 validate + 6 manual | accept / accept | **throws** | **HONEST-OPEN** |

Named tests (per case): "ces-shared ManualMissionPlanSchema accepts Muster's Mission Plan",
"ces-shared TenantManifestSchema accepts Muster's Tenant Manifest", "Stamper ManifestReader reads the
Tenant Manifest", "Stamper translates it in directive mode and every consumed field lands"; plus
"the three cases together exercise all 5 Muster stamper_action values", "FedRAMP-inherited: the SI
package id reaches Stamper inheritance tasks", and the evidence test "all-met: the exact upstream
rejection is Stamper's steps min(1)".

Consumed-field assertions: for every Muster `controls[]` row, Stamper's
`variables._control_directives[control_id]` matches the action (Automated → implement|validate,
Non-Stack → manual (document-renderable for Stamper's 7 promoted ids), N-A-Capability-Absent →
document-absence, Met-By-Prohibition → document-prohibition, Inherited-FedRAMP → inherit-fedramp),
with a matching `_directive` task for the three task-bearing kinds; `plan.ces.cesId` equals Muster's
`ces.cesId`; `fedramp_package_id` is equal on Muster's `controls[]`, `control_directives[]` and
Stamper's task; every Muster control id is known to Stamper.

**Drift guard** (5 tests, on `structuredClone`s of generated output): rename
`control_directives[].control_id` and `controls[].stamper_action` → shared schema rejects; strip
`fedramp_package_id` (passes the passthrough schema) → consumed-field check fails; rename
`ces.cesId` → identity check fails; rewrite one Met-By-Prohibition → directive check fails.

**HONEST-OPEN — all-met (upstream, ces-stamper T4).** The `min(1)` risk is real. Muster's all-met plan
has `steps: []`; ces-shared accepts it; Stamper throws
`Mission plan validation failed: outputs.human_readable_mission_plan.steps: Array must contain at least 1 element(s)`
from its own refinement (`ces-stamper/src/types/ces-artifacts.types.ts:196`). The real assertion is
kept and marked `test.fails` ("[HONEST-OPEN REQ-STAMPER-ALL-MET-PLAN-REJECTED]"), so it turns red
the moment Stamper is fixed and the marker must be removed. REQ:
`docs/requirements/REQ-STAMPER-ALL-MET-PLAN-REJECTED.md` (owner ces-stamper; unblock condition stated).

### X2 — MS-R10: scenario moved to Muster — Done

- `scenarios/clean-tenant-mfa-baseline.json` gains `muster.plan_source`
  (`kind: "muster-generator"`, `requirement_results: [IA.L2-3.5.3 not_met]`, `ces_id`).
  `schemas/scenario.schema.json` gains the optional `plan_source` block (additive to the frozen v1
  schema). SIT answers come from the scenario's existing `answer_map` rows whose wizard is `sit`
  (G-01/G-02/G-07 — real SI-bank ids). `TCP.LIC.001` is a legacy planner-wizard row with no Muster
  generator input; it is logged as unmapped (licence tier falls to the generator default, G5).
- `src/cli/run-scenario-command.ts`: when `plan_source` is present, no ces-planner dev server and no
  wizard; `src/flow/muster-plan-source.ts` spawns vite-node on `src/flow/muster-plan-gen.cli.ts`, which
  runs the same real generator as X1, parses both artifacts with ces-shared's schemas, and writes
  `plans/manual-mission-plan-<slug>-<ts>.json` + `plans/tenant-manifest-<slug>-<ts>.json` (the
  muster-api push naming Stamper's picker reads). The other five scenarios keep the legacy path.
- Log line (run `ft-x2-2`): `PLAN SOURCE: ces-muster ces-muster/src/features/plan/tenantManifestAdapter.ts#buildPlanArtifacts @ 179260c (not ces-planner) -> manual-mission-plan-clean-tenant-mfa-baseline-2026-09-27T15-46-13-363Z.json`;
  `result.json` carries a `plan_source` provenance block.
- **SIM-ONLY guard** (`src/flow/sim-only-guard.ts`, `tests/flow-sim-only-guard.test.ts`): Stamper is
  not launched unless `STACKSIM_SERVER_URL` is loopback, the first `PSModulePath` entry is stacksim's
  psmodules, and no other entry exposes a real cloud module (Graph/Exchange/Az/Teams/SharePoint).
  Run log: `SIM-ONLY guard: Stamper env ok (STACKSIM_SERVER_URL=http://127.0.0.1:4390; ...)`.
  Stamper's execute log has 17 `graph.microsoft.us` strings — all are echoed command text
  (`Invoke-MgGraphRequest -Uri '...'`), resolved by stacksim's shim against the loopback server —
  and zero DNS/connection/AADSTS/login errors. Ledger snapshot: 403 local entries.
- **Result:** `node bin/ces-tester.mjs run-scenario scenarios/clean-tenant-mfa-baseline.json
  --stacksim-root <ces>/tenant-stacksim --stamper-root <ces>/ces-stamper --run-id ft-x2-2` →
  **PASS** (fresh `stacksim serve` started by the run; mid-pipeline IA.L2-3.5.3 exists;
  MicrosoftAuthenticator + Fido2 `enabled`; `set_sub_count` 66). Stamper's own summary: 97 completed,
  13 failed tasks (outside this scenario's assertions).
- **Tester bug found and fixed:** Stamper ran with cwd = `ces-stamper`, and the Muster plan's
  AU.L2-3.3.4 evidence command (`... | Export-Csv audit_failure_alerts.csv`) wrote into the sibling
  repo (run `ft-x2-1` rewrote the pre-existing, git-ignored `ces-stamper/audit_failure_alerts.csv` — 0 bytes after; prior size not recorded).
  `launch.ts` gained an optional `workDir`; run-scenario now runs Stamper inside the run workspace
  (`stamper-cwd/`). Run `ft-x2-2` confirmed the file lands there and the ces-stamper file is untouched.
  `git status` of ces-stamper / ces-muster / ces-shared / tenant-stacksim was identical before and after;
  ces-tenant and ces-planner show only changes dated before this session (07-26 / 09-07).
- Tests: `tests/flow-muster-plan-source.test.ts` (real generator via vite-node, offline),
  `tests/scenarioFile.test.ts` (+3 plan_source tests).
- **Finding:** the Stamper runtime ces-tester drives is `ces-stamper/dist` built 2026-09-09, while
  src carries MS-R2/T4 (09-26/27). X1 proves src, X2 proves dist. REQ:
  `docs/requirements/REQ-STAMPER-DIST-STALE.md` (owner ces-stamper).
- **Behaviour change to note:** `run-m2` (`src/cli/run-m2-command.ts`, `npm run tester`) is a thin wrapper
  over this scenario, so it now also sources its plan from Muster instead of ces-planner.
- Opt-in integration (not in `npm test`, needs PowerShell + stacksim): the `run-scenario` command above.

### X3 — AE-R6 — WAITING (gate: AO A4 + EO E5 unmet)

Gate check (read-only, ces monorepo branch `flow-through-2026-09`, 2026-09-27):

| Gate | Check | Result |
|---|---|---|
| AO A4 | `git log -- ces-ao/test/fixtures/contract/adminops-evidence-rows.golden.json` non-empty | **UNMET** (empty) |
| AO A5 | `git log -- ces-ao/test/simOnlyRail.test.ts` non-empty | met (`c627c8a`) |
| EO E1 | `git log -- ces-eo/tests/eo/adminops/AdminOpsEvidenceReader.realShape.test.ts` non-empty | met (`6ec8a8f`) |
| EO E5 | `ls-tree … ces-eo/src/eo/adminops/adminops-evidence.contract.ts` EMPTY | **UNMET** (local mirror still present) |
| EO E5 | `git grep -l "ces-shared/types/adminops-evidence" -- ces-eo/src` non-empty | **UNMET** (only hit is the mirror file itself) |

Not started (no fixture substitutes for AO's golden). EV2 re-pin in `src/demo/acts/act-run.ts` is
part of X3 and also waits. Resume with the instruction file's "Resume … from the first WAITING step".

### X4 — this report — Done

### Corrected overclaims

1. **ces-muster FLOW-THROUGH-REPORT ("What Unblocks Next": "ces-stamper and ces-tester can now consume
   Muster's plan artifacts … conform to a documented, validated contract").** True for gapful and
   FedRAMP plans; **false for an all-met posture**: Stamper rejects Muster's real all-met plan. Muster's
   own generator contract test asserts non-empty steps, so it never exercised this case.
2. **ces-stamper FLOW-THROUGH-REPORT T4 ("Stamper-only refinements kept (stricter than shared; not
   loosened): … `steps` ≥ 1 when present").** Keeping it is not neutral: real Muster output trips it.
   Shared and Stamper still disagree on a valid plan after T4.
3. **Premise that X1's green contract implies Stamper runtime correctness.** It proves Stamper *src*;
   the runtime is a 09-09 *dist* (REQ-STAMPER-DIST-STALE).

### Not attempted here

- **95-op AO suite — recorded as wave W4** (tester→AO §2.4–2.6). Not attempted in this wave.

### REQs filed (this wave)

| REQ | Owner | Unblock condition |
|---|---|---|
| `REQ-STAMPER-ALL-MET-PLAN-REJECTED.md` | ces-stamper (T4) | `translate()` accepts a shared-valid plan with `steps: []` and only validate/manual directives |
| `REQ-STAMPER-DIST-STALE.md` | ces-stamper | dist rebuilt from committed src + a freshness check |

No existing tester REQ was touched (E5).

### Exit criteria

| # | Criterion | State |
|---|---|---|
| E1 | X0–X4 Done / HONEST-OPEN / WAITING | X0 Done, X1 Done (+HONEST-OPEN case with REQ), X2 Done, X3 WAITING (A4, E5), X4 Done |
| E2 | tsc + npm test clean on committed HEAD | yes — `npx tsc --noEmit` clean; `npm test` 69 files / 909 tests pass (upstream at run: ces-muster `179260c`, ces monorepo `454120d`); re-run on the committed HEAD, see session log |
| E3 | no uncommitted flow-through file | yes (run outputs are under git-ignored `runs/`) |
| E4 | this file with `## 2026-09-27` | yes |
| E5 | touched stale REQs fixed; new REQs name owner + unblock | yes |
| E6 | no hand-built plan/row where real output was required | yes — X1/X2 plans from `buildPlanArtifacts`; X3 not started |
| E7 | gp-demo-4 / gp-aoops-1 untouched; main working tree unchanged | HEADs `6129b58` both; main checkout: only the untracked session log added (rule 8) |

### Legend

MS-Rn = Muster→Stamper recommendation n · AE-Rn = AdminOps→EvidenceOps recommendation n · X0–X4 =
ces-tester steps · A4/A5 = ces-ao steps · E1/E5 (gate rows) = ces-eo steps · E1–E7 (exit table) =
this instruction file's exit criteria · T4 = ces-stamper step · S4 = ces-shared step · M3 = ces-muster
step · F-1/F-6 = founder decisions · G3 = merge gate · W2–W4 = waves · MP/TM = Mission Plan / Tenant
Manifest · SIT = Strategic Intent question · EV2 = Evidence Explorer check in `act-run.ts` · HONEST-OPEN
= blocked, reason + REQ recorded · WAITING = gate not yet met.

## 2026-09-27 fix batch

Instructions: `INSTRUCTIONS-FROM-STRATEGY-2026-09-27-FIX.md` (adds to the 09-27 file). Branch
`flow-through-2026-09`, worktree `.worktrees/flow-through`. Not pushed.

### Gates (verified read-only; ces monorepo branch `flow-through-2026-09` at `487ad97`, ces-muster `5a3e382`)

| Gate | Commit | Check |
|---|---|---|
| ces-eo FX-EO1 (tenant scoping) | `d36c6cb` | `git log --grep FX-EO1` |
| ces-stamper FX-ST1 (all-met) / FX-ST2 (dist) | `6c8571c` / `2932e92` | `git log --grep`; `findStaleDist(ces-stamper)` = `[]` at run time |
| ces-stamper FX-ST3+ST4 / FX-ST5 (results 1.1.0) | `ab09507` / `b90602a` | `git log --grep` |
| ces-muster FX-MU2 (results loop) | `f844771` | `git -C ces-muster log --grep FX-MU2` |
| ces-ao FX-AO2 (sim-only default) / FX-AO6 (contract 1.3.0) | `acf9deb` / `980e115` | `git log --grep` |

**Dist freshness at run time** (per-file `.ts` vs `.js` mtime): ces-stamper 0 stale and ces-ao 0 stale, so
both are driven from `dist`. **ces-eo `dist` is stale** (20 files; the FX-EO1/2 reader and views are
missing) and **muster-api `dist` is stale** (it predates FX-MU2's `routes/plan.js`). Both are therefore
imported **from `src`**, in-process and read-only, so the proof runs the fixed code. Sibling working trees
were dirty from other sessions (ces-ao 6 paths, ces-eo 6, ces-stamper 9, ces-shared 2). Only three are in
`src`: an AO/Stamper `CES_NO_OPEN` browser-open gate and EO's assessor-view HTML. The runs exercise that
working tree.

### Summary

| Step | Status | Commit | Tests |
|---|---|---|---|
| FX-TE1 X3/AE-R6 AO → real ces.db → EO | **Done** (all assertions, including tenant scoping) | `b41d1ee` (+ refactor in `1f232bc`) | `tests/flow/ao-eo.flow.test.ts` 6/6 live |
| FX-TE2 X1 all-met + X2 re-run | **Done** | `36c2f49` | contract suite 21/21; `run-scenario` `ft-te2-x2-1` PASS |
| FX-TE3 results loop | **Done** (deviation + REQ below) | `1f232bc` | `tests/flow/results-loop.flow.test.ts` 4/4 live |
| X3 EV2 re-pin (base 09-27 file's X3 acceptance) | **Done**, keyed on ces.db row id (REQ below) | `e8f8f5a` | `tests/demo-acts-eo-verify-evidence.test.ts` 6/6 (seams; not run in a live demo) |

Both flow suites are opt-in integration (`CES_TESTER_FLOW_LIVE=1`, Windows PowerShell + tenant-stacksim).
In the default `npm test` they report skipped, like X2's `run-scenario`.

**Supersedes the `## 2026-09-27` section above** where it says "X3 WAITING", "X1 … HONEST-OPEN case"
and "G3 open: X3 …, X1 all-met case". **G3 verdict (tester side, after this batch): G3 green** — X1–X4
Done. The two open REQs are upstream (ces-stamper CLI manifest, ces-ao UI correlationId).

### X3 EV2 re-pin — Done (row id, not correlationId)

The base 09-27 file's X3 acceptance also asks to re-pin demo check **EV2** (`src/demo/acts/act-run.ts`,
D.15 `eo-verify-evidence`) to "the Explorer surfaces this run's AO row by correlationId". The old
deviation ("the Explorer has no adminops source") is obsolete after ces-eo AE-R5 + FX-EO1/2. EV2 now
requires the Explorer index to list `adminops:<rowId>` for the newest row AO wrote for the command into
**this run's** `ces.db`, and `/api/evidence-explorer/item` to open it to that row and command.
It keys on the **row id**, not correlationId: AO's web UI (the demo's drive path) sends no correlationId,
so a UI-driven row has none. REQ: `docs/requirements/REQ-AO-GUI-NO-CORRELATION-ID.md` (owner ces-ao).
Tests: the judge's seam test now serves index + item and adds two reds (another run's row for the same
command; an item that opens to another command). It was not run inside a live demo in this batch. The
demo's EO server runs from `src` (`npx tsx src/eo/index.ts`), so EO's stale `dist` does not affect it.
Not in this batch: the tester's pre-A4 AO fixture in `tests/demo-ao-evidence.test.ts` (hand-built
`automated_success` rows for the demo AO leg) is unchanged; FX-TE1 is the real-row proof.

### FX-TE1 — AO → real ces.db → EO — Done

`src/flow/ao-eo-flow.ts` materializes and serves tenant-stacksim. It registers two `kind:'sim'` tenants
(`ft-te1-tenant-a`, `ft-te1-tenant-b`) through the ces-tenant registry in a temp root, and boots
**ces-ao's real server** (`ao gui`, ces-ao/dist) with `CES_AO_SIM_ONLY=1` and `CES_AO_ALLOW_LIVE`
deleted. `simOnlyEnvViolations` checks the sim launch env before AO starts; the only extra PSModulePath
entry allowed is ces-tester's presence-only `Microsoft.Graph` stub. Each case is one
`POST /api/execute/:commandId` with its own correlationId. AO's executor runs the command's PowerShell
against stacksim (the ledger grows) and persists into the temp `CES_PIPELINE_ROOT/ces.db`.

The same DB is read back through ces-eo **production** code (src):
- `AdminOpsEvidenceReader`;
- the real evidence router over HTTP (`/api/evidence-explorer/index|item`, `/api/adminops/executions`),
  all `?tenant=`-scoped, with the server's default tenant deliberately set to B;
- the `/api/assess` scoring path (`ControlAssessor.merge` with the AO sources, then `SprsCalculator`).
  `/api/assess` itself needs a live discovery session, so the functions beneath it are called.

| Case | Command | Row (contract 1.3.0) | EO result |
|---|---|---|---|
| live A–H | A-18 B-02 C-07 D-04 E-02 F-01 G-08 H-08 | executed / live / SAT, requestorUPN set | visible; every control `imported`, in the CRM-credit set and `met`; `stats.live` = 8 |
| CMMC deny | C-05 (SC.L2-3.13.8) while tenant A's own temp record is L1 | `denied_cmmc` | visible, not credited, not met |
| Tier-3 pending | D-03 (IR.L2-3.6.1), no approvalId → HTTP 202 | `blocked_pending_approval`, `targetUPN` carried | visible, not credited |
| dry run | D-01 (MP.L2-3.8.2) | `dry_run` / `dry_run` | label `preview`, title `(preview)`; SPRS and every control status equal before and after |
| tenant B | A-13 on `ft-te1-tenant-b` | executed | only in B's reader and routes; absent from A's; a request with no tenant → 400 |

Command choice: a live spike over 19 zero-input candidates found 17 SAT on stacksim. B-13 needs an
input; G-01 fails on an unresolved `{trainingRosterPath}` placeholder (not needed here; noted only).

Honest limits:
- The deny needs an L1 posture. It is set by editing the run's own temp tenant record for that one
  request (AO re-reads the record per request) and restored afterwards.
- The AO rows are real, but the `met` statuses come from AO sources alone (no Stamper or blob evidence
  in this DB). SPRS here proves *differences* (the dry run changes nothing), not a realistic absolute score.

### FX-TE2 — X1 all-met + X2 re-run — Done

- `tests/contract/muster-stamper.contract.test.ts`: `KNOWN_UPSTREAM_OPEN` and both `test.fails` removed.
  The all-met case (Muster `steps: []`, 110 directives) now runs the full directive-mode consumed-field
  assertion and passes. The evidence test asserts Stamper **accepts** `steps: []`. 21/21.
- `run-scenario scenarios/clean-tenant-mfa-baseline.json --run-id ft-te2-x2-1` against the rebuilt
  Stamper dist: **PASS** 3/3 (IA.L2-3.5.3 directive exists; MicrosoftAuthenticator and Fido2 `enabled`).
  Stamper ran 110 tasks: 97 completed, 13 failed (the same split as `ft-x2-2`, outside the assertions).
  Plan from ces-muster `5a3e382`. No stale-dist exit from the Stamper CLI.
- Closed: `REQ-STAMPER-ALL-MET-PLAN-REJECTED` (by `6c8571c`) and `REQ-STAMPER-DIST-STALE` (by `2932e92`).

### FX-TE3 — results loop — Done

`tests/flow/results-loop.flow.test.ts` runs this chain:
1. the X2 scenario's Muster input → Muster's real generator;
2. **pushed** through muster-api's real app (`createApp` from src; JWT from muster-api's own `mintToken`,
   as its tests do);
3. Stamper `translate` (dist CLI) on the pushed files;
4. **live execute on stacksim through Stamper's production `GET /api/execute`** (dist server; cwd
   outside ces-stamper);
5. Stamper's own manifest file `…/state/execution-results-<planId>.json` → `POST /api/plan/results` →
   `GET /api/plan/status`.

Result: the manifest parses with ces-shared `ExecutionResultsManifestSchema` (1.1.0) and its `planId` is
Muster's bare `plan_id`. Before: 110/110 directives pending. After: 110/110 reported (sat 66, not_sat 20,
provisional 24), every verdict equals the manifest's, IA.L2-3.5.3 has a verdict, 0 unmatched. Stamper's
summary: 63 pass / 23 fail / 24 skip of 110. No session-connect failures. The `graph.microsoft.*` strings
in its log are echoed command text that stacksim's shims resolved.

**Deviation:** the instruction says "extend the Muster-sourced scenario". The scenario runs Stamper's CLI
`execute`, which writes **no** results manifest; only the server route does. So the loop is proven as a
flow test over the server route, not inside `run-scenario`. REQ:
`docs/requirements/REQ-STAMPER-CLI-NO-RESULTS-MANIFEST.md` (owner ces-stamper).

### Corrected overclaims

1. **This report's X1 row ("Done, with one HONEST-OPEN case").** It is now fully Done: the all-met case passes.
2. **"The results loop works" (the FX-MU2/FX-ST4 framing).** True only for Stamper's server path. A
   CLI-driven Stamper run produces nothing Muster can ingest (REQ-STAMPER-CLI-NO-RESULTS-MANIFEST).
3. **"EO reads AO rows" (EO's E-series tests).** EO's own tests re-seed AO's golden file; FX-TE1 is the
   first proof on rows AO wrote itself. It also shows ces-eo's `dist` is stale: an EO server started from
   dist lacks FX-EO1/2. This proof imports EO `src`.

### Sim-only and write boundary

Nothing left 127.0.0.1: stacksim on `:4390`, AO on `:3917`, Stamper on `:3927`, the EO router and
muster-api on ephemeral loopback ports. `CES_AO_ALLOW_LIVE` was never set. All run state lived in temp
dirs, deleted after the runs. The only writes outside this worktree were the tools' own git-ignored
state: tenant-stacksim `.stacksim/tenants/<slug>/` (as in X2) and the default ces-tenant registry dir,
touched by `run-scenario`'s existing register/teardown of its slug. No sibling source file was changed.

### REQs (this batch)

| REQ | Owner | State |
|---|---|---|
| `REQ-STAMPER-ALL-MET-PLAN-REJECTED.md` | ces-stamper | **CLOSED** (`6c8571c`; re-run 21/21) |
| `REQ-STAMPER-DIST-STALE.md` | ces-stamper | **CLOSED** (`2932e92`; re-run `ft-te2-x2-1` PASS) |
| `REQ-STAMPER-CLI-NO-RESULTS-MANIFEST.md` | ces-stamper | **OPEN**: CLI `execute` should write the same manifest as the server route |
| `REQ-AO-GUI-NO-CORRELATION-ID.md` | ces-ao | **OPEN**: the web UI's execute call should send a correlationId |

Noted, not filed: ces-eo and muster-api `dist` are stale relative to their fixed `src` (an owner build
step; their own gates run from src).

### Exit criteria

| # | Criterion | State |
|---|---|---|
| X-E1 | every step Done / HONEST-OPEN / WAITING | FX-TE1 Done, FX-TE2 Done, FX-TE3 Done (deviation + REQ); base-file X3 EV2 re-pin Done (row id + REQ) |
| X-E2 | tsc + npm test clean on the committed HEAD | yes: `npx tsc --noEmit` clean; `npm test` 69 files / 911 pass, 10 skipped (the two opt-in flow suites); see session log |
| X-E3 | nothing from this work left uncommitted | yes (instruction file and session log committed with this report) |
| X-E4 | this section | yes |
| X-E5 | nothing pushed | yes |

### Legend

FX-TE1..3 = this batch's tester steps · FX-EO/ST/MU/AO-n = the matching ces-eo / ces-stamper /
ces-muster / ces-ao fix steps · X-E1..5 = this instruction file's exit criteria · X1–X3 = the 09-27
tester steps · MS-Rn / AE-Rn = Muster→Stamper / AdminOps→EvidenceOps recommendation n · HONEST-OPEN =
blocked, reason + REQ · WAITING = gate not met · REQ = requirement for another module · SAT = satisfied
verdict · SPRS = government supplier score · CRM = customer responsibility matrix · EV2 = demo check 2 of
act D.15 `eo-verify-evidence` · G3 = merge gate.

## 2026-09-27 final fixes

Step FX-TE4 (ces-tester). Upstream fixes: ces-ao FX-AO7 `e53e708`, ces-stamper FX-ST6 `9a482aa`.
All work is sim-only: stacksim, temp `CES_PIPELINE_ROOT`, loopback only. `CES_AO_ALLOW_LIVE` and
`CES_MUSTER_ALLOW_REMOTE` were never set.

### 1. EV2 matched by correlationId — Done (REQ-AO-GUI-NO-CORRELATION-ID closed)

- FX-AO7 sends a fresh `ao-ui-<uuid>` on every web-UI execute. It lands on the persisted contract
  row at `data.metadata.correlationId`.
- EV2 (act D.15 `eo-verify-evidence`, `src/demo/acts/act-run.ts`) now keys on that id:
  1. this run's newest AO row for the command must carry an `ao-ui-` id that is unique in the DB;
  2. EO `/api/adminops/executions` must return exactly one row with that id;
  3. the Explorer index must list that row, and opening it must return the same id and command.
  The ces.db row id is now only the join to the Explorer item.
- Proof: `tests/demo-acts-eo-verify-evidence.test.ts`, 10 tests. The positive case asserts
  `EV2.evidence.correlationId`. EV2 fails on each of these: no id, a non-UI (API) id, another
  click's id, the same row id with a different id, an item that opens to a different id, and an
  item that opens to a different command.
- Collateral: FX-AO7 removed `#liveTenantInput`, and the demo's `ao-ui-driver` depended on it.
  - The driver now waits for the slug's `#tenantSelect` option, selects it, then arms the toggle.
  - It refuses to run if the slug did not stick; with no tenant selected, AO never calls
    `/api/execute`.
  - It reports the echoed correlationId (`tests/demo-ao-ui-driver.test.ts`).
- Limit: act D.15 was not run live in a browser in this batch.
- Commit `e01bab1`.

### 2 + 3. CLI results manifest and Stamper → Muster delivery — Done (REQ-STAMPER-CLI-NO-RESULTS-MANIFEST closed)

`tests/flow/cli-results-delivery.flow.test.ts` (opt-in `CES_TESTER_FLOW_LIVE=1`) runs this chain:
1. Muster's real generator produces the plan (X2 scenario input, 110 directives).
2. The plan is pushed through muster-api's real app on 127.0.0.1, with a token from muster-api's
   own `mintToken`.
3. Stamper `translate` (dist CLI).
4. Stamper CLI `execute --mode auto --tenant ft-te4-cli` runs on stacksim three times, each with
   its own STORAGE_ROOT, with `CES_MUSTER_API_URL=http://127.0.0.1:<port>` and
   `CES_MUSTER_API_TOKEN` set.

Live result (ces `8da49c2`, ces-muster `af57228`): **5/5 pass**, about 8.5 min.

| Run | Manifest (shared 1.1.0 schema) | Delivery record | Muster | Ledger mutations |
|---|---|---|---|---|
| dry run | 110 results, parses; `planId` = Muster's bare plan_id | `skipped` (dry_run) | unchanged, 110/110 pending | 0 |
| live | 110 results, parses | `delivered`, HTTP 200, loopback endpoint | 110/110 reported (sat 81 / not_sat 29), verdicts equal the manifest's, 0 unmatched. There was no tester POST; Muster saw exactly 1 results POST, Stamper's | 55 |
| live, Muster stopped | 110 results, parses, kept | `failed` (ECONNREFUSED); `.delivery.json` kept | (down) | 43 |

- The failed delivery did not fail the run: exit 0 and report `partial`, the same as the delivered
  run. The saved report records `resultsManifest.delivery.status = failed`.
- First live attempt: 4/5. The one failure was a harness bug: the test counted results POSTs with
  a `request` listener registered after Express's, which had already rewritten `req.url`. Fixed with
  `prependListener`; the re-run passed 5/5.
- Observed, not filed: the manifest's `runId` is the executable plan id (`translated-mplan_…`). It is
  not a per-run id, so repeated runs of one plan share a runId.
- Helpers: `executeWithStamperCli` and `parseCliReportPath` in `src/flow/results-loop-flow.ts`. Its
  now-false "CLI emits no manifest" note is corrected.

### 4. EO reads send the tenant — Done (FX-TE5; REQ-ces-tester-eo-tenant-on-assessment-reads satisfied)

- ces-eo FX-EO8 (`a44f6b4`) requires `?tenant=<slug>` on every route: no tenant is a 400, an unknown
  tenant is a 404, and there is no default. ces-tester read `/api/assessment`, `/api/sprs` and
  `/api/controls/:id` without one, so the EO panes would have shown no numbers.
- Grep of this worktree for every EO HTTP read (assessment, sprs, controls, ledger, personas,
  assessor-view, packages, evidence, explorer, adminops, personnel/training/screening, risk,
  timeline, policies, ssp, poam): 15 reads in 6 source files lacked a tenant. The adminops and
  evidence-explorer reads, and `/api/connect` / `/api/assess`, already sent one. The other routes
  are not called by ces-tester.
- Every EO read URL is now built by `eoTenantUrl()` (`src/demo/eo-tenant-url.ts`). It takes the slug
  the act or scenario already armed or assessed, URL-encodes it, and throws on a blank tenant, so
  there is no fallback. Sites:
  - `act-run.ts`: the EO3 judge and the D.16 BEFORE probe (`armed.slug`);
  - `e2e-run.ts`: the EO beat, extracted as `readEoBeatApi` (`opts.slug`);
  - `eo-leg.ts`: `fetchControl`, now exported (`opts.slug`);
  - `eo-ui-driver.ts`: the per-control reads (`ctx.slug`);
  - `eo-review-op.ts` (warm and live) and `eo-show-change-captured-op.ts` (`ctx.armed.slug`).
- Proof: the fake EO servers and pages in the tests enforce the FX-EO8 contract (400 or 404), and
  the new cases arm a slug other than the fixture default `demo-dib-small`, so a hard-coded
  fallback fails. Files: `tests/eo-tenant-reads.test.ts` (new), `tests/demo-acts-run.test.ts`,
  `tests/demo-show-eo-op.test.ts`, `tests/demo-eo-ui-driver.test.ts`. A mutation check dropped the
  tenant from each of the 6 source files in turn, and each time 1 to 4 tests failed.
- Live (`CES_TESTER_FLOW_LIVE=1`, stacksim only, ces `dd4c909`, which includes FX-EO8):
  `tests/flow/ao-eo.flow.test.ts` passed **6/6**. That suite reads ces-eo's production evidence
  routes and assessor from source, with the tenant scoped.
- The other two live suites do not read EO routes. They were run too:
  - `cli-results-delivery` passed 5/5.
  - `results-loop` first failed on a stale harness filter, not on EO. The filter counted FX-ST6's
    `<manifest>.delivery.json` sidecar as a second manifest. After the fix it passed 4/4 (about 6 min).
  - My first attempt ran all three files in parallel, and they collided on stacksim port 4390. They
    were re-run one at a time. Always run the flow files one at a time.
- The REQ file is in ces-eo and was not edited. **ces-eo can close it.**
- Commit `b7c3d29`.

### Corrected overclaims

1. **Fix-batch "Corrected overclaims" #2** ("the loop works only through the server path") is
   superseded: the CLI path now writes the manifest and delivers it itself.
2. **The fix-batch REQ table** listed both REQs as OPEN. Both are now CLOSED (see below).
3. **EV2 "matched by the ces.db row id"** is superseded: EV2 now matches by correlationId.

### REQs

| REQ | Owner | State |
|---|---|---|
| `REQ-AO-GUI-NO-CORRELATION-ID.md` | ces-ao | **CLOSED** (`e53e708`; EV2 re-pin `e01bab1`) |
| `REQ-STAMPER-CLI-NO-RESULTS-MANIFEST.md` | ces-stamper | **CLOSED** (`9a482aa`; FX-TE4 live 5/5) |
| `REQ-ces-tester-eo-tenant-on-assessment-reads.md` (in ces-eo) | ces-tester | **SATISFIED** (`b7c3d29`, FX-TE5). ces-eo can close it; its file was not edited here |

### Gates

`npx tsc --noEmit` is clean. `npm test`: 69 files / 919 pass, 15 skipped (the three opt-in flow
suites). Nothing was pushed.

After FX-TE5: `npx tsc --noEmit` is clean. `npm test`: 70 files / 933 pass, 15 skipped.

### Legend

FX-TE4 / FX-TE5 = tester fix steps · FX-AO7 / FX-ST6 / FX-EO8 = the ces-ao / ces-stamper / ces-eo
fix steps · EV2 = demo check 2 of act D.15 `eo-verify-evidence` · EO3 = the eo-review act's API
numbers check · D.16 = act `eo-show-change-captured` · REQ = requirement for another module ·
SAT = satisfied verdict.
