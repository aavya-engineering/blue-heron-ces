# Bring Muster current: run Muster end to end on the simulator

Blue Heron Defense, CES team. Revision 2026-10-24.

This runbook is written so that you, or your coding agent, can execute it top to bottom. It narrates exactly what the scripts in this package run; we executed the same scripts on fresh folders until they passed twice. Every step has a command, the expected output, an exit criterion, and a "rebuild it yourself" note.

**Simulator only.** Nothing here touches a real tenant. Your repositories are not modified on GitHub; all changes are local to your workspace.

## 0. Legend

| Code | Meaning |
|---|---|
| `<WS>` | Your workspace root, the `-Root` you pass (for example `C:\mx`) |
| `<SCN>` | The sim scenario slug, default `muster-partial` |
| E1–E9 | End-to-end steps (section 3) |
| V1–V11 | Verify checks (section 4) |
| K1–K5 | Known contractor-repo defects (section 6) |
| N-nn / MG-nn | Run-enabling gaps / muster-shift backlog items (`GAP-ANALYSIS.md`) |
| mx-01..03 | The three patches in `patches/` |
| MP / TM / IM | Mission Plan / Tenant Manifest / Infrastructure Manifest |
| SI Baseline / TCP | Strategic Intent Baseline / Tenant Config Profile |
| SSP / POA&M | System Security Plan / Plan of Action and Milestones |
| EO | ces-eo (EvidenceOps), which produces the SSP |
| SSE | Server-Sent Events (EO streams connect and assess progress this way) |
| Track A / Track B | Apply our patches / re-implement them from the intent text (section 7) |

## 1. Prerequisites

- **Windows** with **Windows PowerShell 5.1** (`powershell.exe`; `pwsh` is not needed). Stamper and the simulator's fake PowerShell modules run under `powershell.exe`, so the end-to-end run is Windows-only. On macOS or Linux, `bootstrap.sh` takes you through the unit gate only.
- **Node 20 or later** (we ran Node 24.12) and npm.
- **git** with read access to the `blue-heron-defense-CES` GitHub org.
- **Free ports** 4390 (sim), 4011 (muster-api), 4002 (EO), 4001 (EC). The e2e script frees them before it starts.
- **A short workspace root**, for example `C:\mx`. Windows PowerShell 5.1 cannot open paths longer than 260 characters, and Stamper's plan files have long names. The bootstrap warns when `-Root` is over 60 characters.
- No Postgres, Docker or pwsh. (The UI path with a database is in `POSTGRES-SETUP.md`.)

## 2. One command

```powershell
powershell -ExecutionPolicy Bypass -File bootstrap.ps1 -Root C:\mx
```

What it does, in order (logs in `<WS>\out\bootstrap\`):

1. **Prerequisites:** Node 20+, git, `powershell.exe`.
2. **Clone at the pins** in `pins.json`, nested, with `git -c core.longpaths=true -c core.autocrlf=false`: ces-mono to `<WS>\ces`, then ces-tenant, ces-muster, ces-tester inside it, and ces-stacksim as **`tenant-stacksim`**. Each repo is checked out as local branch `main` at its pin, and `git rev-parse HEAD` must equal the pin.
3. **Overlay and patches:** copies `overlay\ces-muster\scripts\mx\plan-from-discovery.ts` in, then for each patch runs `git apply --check` and `git apply` in `ces-muster`. Patches go in before the builds so `tsc` checks the patched code. A rerun skips patches that are already applied.
4. **Install and build** with `npm ci` (lockfiles as committed): ces-tenant (install, build), ces-mono (install, `build:core`), tenant-stacksim, ces-tester, ces-muster, muster-api (install, build), Muster SPA build.
5. **Unit gate:** `scripts\run-tests.ps1` (section 5).
6. **End to end:** `scripts\mx-e2e.ps1`, which ends with `scripts\verify.ps1`.

**Done when** it prints `DONE: all checks pass` and `<WS>\out\verify.json` has `"pass": true`. In our runs the whole thing took about 10 minutes on a fresh folder (clones, installs, builds, the unit gate and the end-to-end run).

Useful switches: `-SkipE2E` (stop after the unit gate), `-Scenario <name>` (another stacksim scenario). To rerun only the flow: `scripts\mx-e2e.ps1 -Root C:\mx [-From E5]`. To recheck only: `scripts\verify.ps1 -Root C:\mx`. To let ces-tester drive the same steps (P4.2), run `scripts\mx-e2e.ps1 -Root C:\mx -Harness tester`: it calls `node bin/ces-tester.mjs run-scenario scenarios\muster\muster-partial-e2e.json --root <WS> --package-root <package>` from `<WS>\ces\ces-tester`, then verify, which adds V23 (the tester record, including its ledger comparison) and V26 (stacksim `coverage-ao`).

## 3. The end-to-end steps

`scripts\mx-e2e.ps1` sets these for every step: `CES_PIPELINE_ROOT=<WS>\pl` (keeps Stamper out of `C:\CES_Pipeline`), `CES_TENANT_ROOT=<WS>\tenants` (keeps the tenant registry out of `~/.ces`), `STACKSIM_ROOT=<WS>\ces\tenant-stacksim`, `STAMPER_REGISTRY_ROOT=<WS>\ces\ces-stamper\src\registry`. Each step logs to `<WS>\out\logs\<step>.out|.err` and records its exit code and UTC start/end in `<WS>\out\steps.json`.

### E1. Seed and serve the sim

```powershell
cd <WS>\ces\tenant-stacksim
node bin/stacksim.mjs scenario muster-partial
node bin/stacksim.mjs serve m365_azure --slug muster-partial --port 4390     # background
```
- **Expected:** `stacksim serve: listening on http://127.0.0.1:4390`.
- **Exit criterion:** `POST http://127.0.0.1:4390/ledger` with body `{}` answers, and `.stacksim\tenants\muster-partial\` exists.
- **Rebuild it yourself:** `serve` never seeds; `scenario` wipes and seeds. Port 4390 is fixed because Muster hard-codes it (`ces-muster:muster-api/src/services/liveSimSession.ts:28`).

### E2. Discovery (a real Muster user path)

```powershell
cd <WS>\ces\ces-muster\muster-api
node dist/cli/bin.js discovery --sim --slug muster-partial --out <WS>\out\discovery-result.json
```
- **Expected:** one JSON line, `{"ok":true,...,"stats":{"entries":223,"ran":201,"manual_only_skipped":22,"degraded":5,"failed":1},"postures":{"met":57,"unknown":272,"not_met":0}}`.
- **Exit criterion:** the file exists and validates against `public/schemas/readiness-result.schema.json` (E3 re-validates it with Muster's own `parseReadinessResultFile`). The run itself asserts zero create/mutate ledger entries (`muster-api/src/services/simDiscoveryRun.ts:77-84`); V7 checks it again.
- **Note:** on Node 24 for Windows the process can print `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` after writing the file and exit non-zero. E2 counts the run as passed when `"ok":true` was printed and the file exists; `steps.json` keeps the raw exit code (`raw_rc`).

### E3. Readiness and compile (the headless runner, N-03)

```powershell
cd <WS>\ces\ces-muster
$env:MX_DISCOVERY='<WS>\out\discovery-result.json'; $env:MX_OUT='<WS>\out\plan'; $env:MX_SLUG='muster-partial'
node node_modules\vite-node\vite-node.mjs scripts/mx/plan-from-discovery.ts
```
- **Expected:** one `MX_RESULT {...}` line. Files in `<WS>\out\plan\`: `manual-mission-plan-<SCN>-<ts>.json` (about 2.8 MB), `tenant-manifest-<SCN>-<ts>.json`, `infrastructure-manifest-<SCN>-<ts>.json`, `si-baseline-<SCN>-<ts>.json`, `tcp-<SCN>-<ts>.json`, `readiness-posture-<SCN>-<ts>.json` (MG-12 hand-off envelopes the MP references by hash; E4 pushes them beside the MP), `readiness-result-<SCN>.json`, `plan-trace.json`.
- **Exit criterion:** exit 0; MP and TM written; both already passed ces-shared's `ManualMissionPlanSchema` and `TenantManifestSchema` inside the runner.
- **What it does** (the same functions, in the same order, as the browser app):
  1. `parseReadinessResultFile` and `discoveryResultsFromPayload` (`src/features/discovery/importReadinessResult.ts`), as the Discovery tab's import does.
  2. `createSession` (`src/driver/sessionDriver.ts`) on fake-indexeddb, as muster-api's full-session tests do.
  3. `synthesizeFactsFromDiscovery` + `inferBoundaryDrafts`/`processBoundaryDecisions` (no decisions, so drafts stay drafts) + payload facts, last write wins: `BoundaryConfirmPanel.tsx` `handleContinue`.
  4. `applyDiscoveryFacts` then `factsFromAnswers` over the stack-filtered graph: `AssessmentPage.tsx` mount effect and `finishInterview`. The session also gets `discovery_results`, `discovery_observations` (the executor's rows) and the readiness manifest.
  5. `compilePlanForSession` (`src/features/plan/planCompileService.ts`), then `buildReadinessResult` (`src/features/export/readinessResultService.ts`).
  The banks the SPA fetches from `/knowledge/...` are served from `public/` by a `fetch` shim. Declared stacks default to `m365_e5_gcc, microsoft_intune, microsoft_sentinel` (`MX_STACKS` overrides).
- **Rebuild it yourself:** run it from `ces-muster` so Vite's `@/` alias from `vite.config.ts` applies. It only type-resolves in the nested layout (`@types/node` comes from the parent `node_modules`). **It is discovery-only:** no operator answers the remaining interview questions, so their requirements compile to `implement` directives. That, plus MG-02, is why the readiness numbers are provisional.

### E4. Push to Stamper's plan-data (N-04)

```powershell
cd <WS>\ces\ces-muster\muster-api
$env:JWT_SECRET='<random>'; $env:PORT='4011'; node dist/server.js            # background; no DATABASE_URL
$token = node <pkg>\scripts\mint-token.mjs <WS>\ces                          # bhd_operator JWT, same secret
node <pkg>\scripts\mx-helpers.mjs push --api http://127.0.0.1:4011 --token $token --plans <WS>\out\plan --slug muster-partial --out <WS>\out\push-response.json
```
- **Expected:** `push: HTTP 201 {"pushed":["manual-mission-plan-muster-partial-<ts>.json","tenant-manifest-...","infrastructure-manifest-..."],"plansDir":"<WS>\\pl\\Stamper\\plan-data\\muster-partial\\plans"}`.
- **Exit criterion:** the three files exist in `<WS>\pl\Stamper\plan-data\<SCN>\plans\`.
- **Fallback:** if the push fails, the script writes the same three names directly and records `mode: direct-write` in `steps.json` (our runs used `mode: api`).
- **Rebuild it yourself:** `/api/plan` is mounted without a database (`muster-api/src/app.ts:88`); the route validates all three artifacts with the shared contract and writes them (`muster-api/src/routes/plan.ts:123-196`). Login needs Postgres; the token does not.

### E5. Stamper translate

The script first registers an ephemeral sim tenant and gets the sim launch env (`mx-helpers.mjs sim-env`: ces-tenant `createEphemeralSimTenant` and `StacksimEnvironment.getSimLaunchEnv`, the same calls as `ces-tester:src/cli/run-scenario-command.ts`). It writes `<WS>\out\sim-env.json` with `PSModulePath` (sim modules + `$PSHOME\Modules` only), `Path` (sim `azshim` first) and `STACKSIM_SERVER_URL`.

```powershell
# with the sim env applied; cwd <WS>\out\stamper-cwd
node <WS>\ces\ces-stamper\dist\cli\index.js translate <pushed MP> -m <pushed TM> --tenant muster-partial -o <WS>\out\executable-plan.json
```
- **Expected:** a layer summary, warnings for unresolved variables (for example `adminUserName`, `breakGlassUPN`, `approverUPN`: TCP answers a discovery-only run does not have), `Infra:` naming the pushed IM.
- **Exit criterion:** exit 0 and `executable-plan.json` written.

### E6. Stamper execute on the sim

```powershell
# same env and cwd; a synthetic Stamper env file as ces-tester writes it (STORAGE_ROOT=<WS>\out\st)
node <WS>\ces\ces-stamper\dist\cli\index.js execute <WS>\out\executable-plan.json --mode auto -e <WS>\out\stamper.synthetic.env   # stdin: one newline (the preflight confirm)
```
- **Expected:** `Total Tasks: 110`, `Completed (Stamper): 87`, `Failed: 23` (PARTIAL), report paths under `<WS>\out\st\state\translated-*\`.
- **Exit criterion:** an execution report exists (copied to `<WS>\out\execution-report.json`). V6 then compares it with the baseline.

### E7. EO assessment on the post-Stamper sim (N-05, N-06)

```powershell
# sim env applied, plus:
$env:REGISTRY_PATH='<WS>\ces\ces-stamper\src\registry\cmmc-l2-commands.registry.json'
$env:STORAGE_ROOT='<WS>\out\eo'; $env:TENANT_SLUG='muster-partial'; $env:EO_PORT='4002'
$env:COMPLIANCE_REPO_PATH='<WS>\out\eo-repo'
$env:TENANT_MANIFEST_PATH='<pushed TM>'                     # N-05
cd <WS>\ces\ces-eo; node ..\node_modules\tsx\dist\cli.mjs src/eo/index.ts   # background, from source
node <pkg>\scripts\mx-helpers.mjs sse --url "http://127.0.0.1:4002/api/connect?tenant=muster-partial" --stop connection_log:done --out <WS>\out\eo-connect.json
node <pkg>\scripts\mx-helpers.mjs sse --url "http://127.0.0.1:4002/api/assess?tenant=muster-partial" --stop assess_done --out <WS>\out\eo-assess.json
```
- **Expected:** EO prints `Auto-discovered mission plan: <pushed MP>`; connect reaches `connected_graph` then `done`; assess streams `signal_fetch` (29 signals), `signal_eval_done` (107 controls), `assess_summary` (usually 60 met, 20 not met, 30 not assessed; sometimes 50 / 30 / 30, see K5), `assess_done`.
- **Exit criterion:** `assess_done` reached and no event type ending in `_error`.
- **Rebuild it yourself:** run EO from source; its `dist` lacks `data/snippet-templates` and SSP generation then fails. EO auto-finds only a fixed `tenant-manifest.json` (`ces-eo/src/eo/config/EoConfig.ts:178-182`), hence `TENANT_MANIFEST_PATH`. Assess runs after Stamper, so the SSP describes the sim as implemented.

### E8. SSP and POA&M (N-07)

```powershell
$body = '{"tenantSlug":"muster-partial","assessmentId":"<assess_summary.snapshotId>"}'
Invoke-WebRequest -Method Post http://127.0.0.1:4002/api/ssp/generate -Body $body -ContentType application/json -OutFile <WS>\out\ssp.json
Invoke-WebRequest "http://127.0.0.1:4002/api/ssp/export/<sspId>?tenant=muster-partial" -OutFile <WS>\out\ssp.docx
Invoke-WebRequest -Method Post http://127.0.0.1:4002/api/poam/generate -Body $body -ContentType application/json -OutFile <WS>\out\poam.json
```
- **Expected:** SSP JSON (about 250 KB, 110 control implementations with the same met / not met / not assessed split as the assessment; `sourceArtifacts` = Mission Plan, Tenant Manifest, Infrastructure Manifest); DOCX (about 95 KB); POA&M JSON.
- **Exit criterion:** all three written without an HTTP error.
- **Known issue K4:** the SSP's system name is the fallback `<tenantId> System` and the boundary is "not yet documented" (section 6).

After E8 the script snapshots the ledger to `<WS>\out\ledger.json`, stops EO, muster-api and the sim, and frees the ports.

**Phase 3 additions (v2).** E8.5 starts ces-ec on port 4001 (`EVIDENCE_OPS_SECRET`, `CES_EVIDENCE_CATALOG_PATH`) and posts one upload tagged `form_id`/`emx_ids` for `AC.L1-3.1.1` (`<WS>\out\ec-upload.json`); it runs before E7 because EO reads EC items during assessment. E8 also saves EO's ledger (`eo-ledger.json`) and evidence package (`eo-package\`), and the sim ledger is now snapshotted at the end of E8. E8B (`scripts\bundle.mjs`) writes `<WS>\out\runs\<run-id>\evidence\raw\` and `shared\` (paths rewritten, also inside DOCX; hashed after rewriting; identity-scanned). E8F re-executes with `--force-fail SC.L2-3.13.15.anti-spam` into `<WS>\out\runs\forced\` (one assess, one SSP); `-SkipForcedRun` skips it. `verify.mjs` adds V13, V17, V20, V25 and V27.

### E9. Verify

```powershell
powershell -ExecutionPolicy Bypass -File <pkg>\scripts\verify.ps1 -Root <WS>
```
Writes `<WS>\out\verify.json` (each check, pass/fail, detail) and `<WS>\out\summary.json` (directive counts by type, posture counts, Stamper completed/failed and the failed task names, EO assessment counts, SSP sections and implementation counts). **Exit criterion:** every check passes.

## 4. Verify checks

| # | Check | What it proves |
|---|---|---|
| V1 | E1–E8 exit codes are 0 (`steps.json`) | Every step ran |
| V2 | The pushed MP and TM parse with ces-shared `ManualMissionPlanSchema` and `TenantManifestSchema` | The boundary contract holds |
| V3 | The MP has 110 control directives | Full CMMC L2 coverage (we saw 77 implement, 28 manual, 5 validate) |
| V4 | Provenance: the readiness result's observations equal the discovery file's (329 rows; 57 met, 272 unknown), every observation has non-empty `ran_entry_ids`, discovered (`auto_detected`) facts > 0, the MP's posture summary equals the requirement results the compile consumed (`plan-trace.json`), no `1970-01-01` dates, and the pushed MP is byte-identical to the runner's | The plan came from discovery, not from a shim |
| V5 | Stamper's picker regexes (`^manual-mission-plan[-_]`, `^tenant-manifest[-_]`, `^infra(structure)?-manifest[-_]`, `ces-stamper/src/server/routes/utility.routes.ts:283-285`) match every pushed file; IM present when E3 wrote one | Stamper's GUI would list exactly these |
| V6 | Translate exit 0; execute report exists with one task per directive; completed ≥ baseline − 2 and failed ≤ baseline + 2 (`expected-outputs/summary.json`: 87 / 23) | Stamper consumes the plan, at a stable PARTIAL level |
| V7 | Ledger: every non-seed write happened during E6 (Stamper); zero during E2 (discovery) | Discovery is read-only; EO assess is read-only |
| V8 | SSP: all top-level sections, the baseline's implementation count (110), `sourceArtifacts` includes Mission Plan and Tenant Manifest, DOCX is a real DOCX, POA&M exists. Status counts are reported against the baseline, not asserted (K5) | EO built the SSP from the pushed MP and TM (see K4 for name and boundary) |
| V9 | The MP EO auto-discovered is the pushed MP | The SSP is about this plan |
| V10 | `C:\CES_Pipeline`, `~/.ces` and `~/.stamper` have the same file count and newest mtime before and after | Nothing was written outside `<WS>` |
| V11 | Unit-gate failures are a subset of `known-failures.json` | The patches broke nothing else |

## 5. The unit gate

```powershell
powershell -ExecutionPolicy Bypass -File <pkg>\scripts\run-tests.ps1 -Root <WS>      # or: bash run-tests.sh <WS>
```
Runs `npm test` with a JSON reporter in ces-tenant, ces-shared, ces-stamper, ces-eo, ces-ao, ces-ec, ces-planner, tenant-stacksim, ces-tester, ces-muster and muster-api. It starts `stacksim up` for the live-sim suites when nothing answers on 4390, and stops it afterwards. Writes `<WS>\out\unit-gate.json`. **Passes** when the failing tests are exactly a subset of `known-failures.json` (K1 ×2, K2, K3). Expect about 4,700 passing tests.

## 6. Known issues (what "known to work" includes)

- **K1** ces-muster `cesSharedParity` (2 tests): the vendored ces-shared copies differ from canonical only in the notice `Ref:` line.
- **K2** ces-eo `claim-accuracy` (1 test): reads `docs/context/ARCHITECTURE_DECISION_RECORD.md`, which is not in the repo.
- **K3** ces-tester `demo-acts-docs-check` (1 test): the dossier's AS OF block names a branch and commit not in the repo.
- **K4** EO SSP system name and boundary do not come from the TM: `documents-router.ts` calls `generate` without `manifests`, and `extractBoundary` reads a top-level `boundary_zones` that Muster nests under `tenant_manifest` (and leaves empty, MG-08). The TM is loaded (`sourceArtifacts`) but its identity does not reach the SSP text.
- **Stamper PARTIAL (accepted).** 110 tasks, 87 completed, 23 failed. A run passes within ±2 of that. The 23 failed tasks, by registry entry:
  `AC.L2-3.1.1.member-add`, `AC.L2-3.1.10.screen-lock`, `AC.L2-3.1.11.session-timeout`, `AC.L2-3.1.14.block-untrusted`, `AC.L2-3.1.15.admin-mfa`, `AC.L2-3.1.16.wifi-profile`, `AC.L2-3.1.21.block-storage`, `AU.L2-3.3.1.audit-enable`, `CM.L2-3.4.2.asr-rules`, `CM.L2-3.4.6.least-functionality`, `CM.L2-3.4.7.wdac`, `CM.L2-3.4.9.install-control`, `IA.L2-3.5.5.disable-inactive`, `IA.L2-3.5.9.tap-config`, `IR.L2-3.6.1.malware-filter`, `MA.L2-3.7.5.remote-mfa`, `MP.L2-3.8.1.cui-label`, `MP.L2-3.8.9.dlp-rule`, `SC.L2-3.13.13.safe-attach`, `SC.L2-3.13.14.teams-external`, `SC.L2-3.13.15.anti-phish`, `SI.L2-3.14.2.anti-malware`, `SI.L2-3.14.3.safe-links`.
  Most are "verification failed — Evidence validation failed"; `SC.L2-3.13.14.teams-external` is "Command exited with non-zero code". They are follow-up work, not blockers for this run.
- **Readiness is provisional.** Discovery "met" means "the read returned output" (MG-02, deferred). The MP's embedded posture (5 met, 26 unknown over 31 routed requirements in our runs) and the SPRS numbers are provisional until MG-02 lands. With nothing `not_met`, the MP's `key_findings` stays the "Initial assessment findings pending" placeholder.
- **K5 EO assessment is not deterministic on the sim.** In one of our runs, the 10 controls EO evaluates only from the Conditional Access policy signal (`AC.L2-3.1.10`, `3.1.11`, `3.1.14`, `3.1.15`, `3.1.18`, `IA.L2-3.5.11`, `MA.L2-3.7.5`, `SC.L1-3.13.1`, `SC.L1-3.13.5`, `SC.L2-3.13.6`) came back `not_met` (50 / 30 / 30 instead of 60 / 20 / 30), with the same sim state, the same ledger reads and no error in EO's log. The likely cause is `ComplianceSignalFetcher.fetchAllSignals` running its signal batches in parallel (`Promise.all`) through one persistent PowerShell session, so one JSON parse can fail and the signal becomes empty (`ces-eo/src/eo/ingestion/ComplianceSignalFetcher.ts:740-760`, `:80-82`). Not fixed here; V8 does not assert status counts for this reason.
- **Same EO result before and after Stamper.** EO's assessment was the same before Stamper (our spike) and after Stamper's 46 sim writes; EO's signal set does not yet observe what Stamper changed on the sim.

## 7. Track A or Track B

**Track A (apply ours):** `bootstrap.ps1` does it. By hand: `git apply --check patches\mx-0N-*.diff` then `git apply` inside `ces-muster`, at commit `29ee828`.

**Track B (re-implement, then prove with the same verify):** implement each intent below in your own style, keep the overlay file (or write your own runner with the same inputs and outputs), then run `scripts\mx-e2e.ps1` and `scripts\verify.ps1`. V1–V11 must pass.

| Patch | Closes | Intent (what to implement) | Code |
|---|---|---|---|
| mx-01 `empty-read` | MG-01 | An empty read is not a pass. Carry the executor's `derived_posture` on the `DiscoveryResult` row (optional field), map it in `discoveryResultsFromPayload`, and in `synthesizeFactsFromDiscovery` synthesize answer `yes` (class A) only when the row's posture is `met`; any other posture gives `unsure`. Rows without a posture keep the confidence rule. Update the two equivalence tests that compare row shapes. | `src/shared/types/discovery.ts`; `src/features/discovery/importReadinessResult.ts:77-83`; `src/features/interview/discoveryFactJoin.ts:50-54`; `src/features/discovery/__tests__/payloadImportSeam.test.ts:84`; `executorImportEquivalence.test.ts:128-132` |
| mx-02 `real-posture` | MG-03 | The posture embedded in the MP is built from the real requirement results: `control_status_summary` = counts of met / partial / not_met / unknown, `generated_on` and `as_of_date` = the compile date (no 1970 dates). Regenerate the MP fixture (`npm run fixtures:generate`). | `src/features/plan/tenantManifestAdapter.ts:124-135`; `src/features/plan/__fixtures__/manual-mission-plan.json` |
| mx-03 `im-inference` | MG-05 | Infer `m365_azure` (and so an IM Stamper would provision) only from an Azure signal in the declared stacks (a tile matching `azure` or `sentinel`); otherwise `m365_only`. | `src/features/plan/siDerivation.ts:203-210` |
| overlay | N-03 | A headless runner: discovery file in, MP / TM / IM / SI Baseline / TCP / readiness result out, through the app's own functions (E3 lists them). | `overlay/ces-muster/scripts/mx/plan-from-discovery.ts` |

## 8. The loop, and troubleshooting

Run bootstrap, then (if needed) e2e, then verify. On a failure, find the failing check below, fix it, and rerun from the failing step (`mx-e2e.ps1 -From <E-step>` reuses earlier outputs). Stop when `verify.json` says `"pass": true`, or after 3 loops; then send BHD `<WS>\out\verify.json`, `<WS>\out\steps.json` and `<WS>\out\logs\`.

| Failing check / symptom | Likely cause | Fix |
|---|---|---|
| Bootstrap `clone` fails "Filename too long" | `core.longpaths` not applied | The bootstrap passes `-c core.longpaths=true`; check your git is 2.x for Windows |
| Bootstrap `clone` fails "Connection was reset" (or another network error) | Transient network failure | Rerun the same command with the same `-Root`: finished clones are reused and checked against the pins |
| Bootstrap `checkout` / HEAD is not the pin | A local clone already sits elsewhere | Use a fresh `-Root`, or check out the pin by hand |
| Bootstrap `apply-check-*` fails | ces-muster is not at `29ee828`, or was edited | Reset ces-muster to the pin (`git checkout -- .`) and rerun |
| Bootstrap `ci-*` fails | Node older than 20, or a registry / proxy issue | Check `node -v`; check npm can reach the registry |
| Any PowerShell "Could not find a part of the path" | Path over 260 characters | Use a shorter `-Root` |
| V1 / E1 fails | Port 4390 busy, or the scenario name is wrong | The script frees 4390; check `tenant-stacksim\scenarios\<SCN>.json` exists |
| V1 / E2 fails | Sim not seeded or not on 4390; Stamper registry not found | Check `E2-discovery.out`; `STAMPER_REGISTRY_ROOT` must point at `ces-stamper\src\registry` |
| V1 / E3 fails | Not nested (`@types/node`), or a patch not applied | Check `E3-plan.err`; run from `<WS>\ces\ces-muster` |
| V1 / E4 `mode: direct-write` | muster-api did not start or rejected the push | Check `E4-muster-api.err`, `push-response.json` (contract errors are listed) |
| V1 / E5 or E6 fails | Sim env not applied (real modules on `PSModulePath`) or sim down | Check `sim-env.json` and `E5-translate.out` / `E6-execute.out` |
| V1 / E7 fails | EO started from `dist`, port 4002 busy, or the tenant not registered | Run from source; check `E7-eo.out`, `eo-connect.json` |
| V1 / E8 fails | No `assess_summary`, or the export missing `?tenant=` | Check `eo-assess.json` |
| V2 / V3 | Generator changed | Compare with `expected-outputs/summary.json`; check `E3-plan.err` |
| V4 | The plan did not come from discovery (shim used, mx-02 missing, or observations not stored) | Confirm mx-01 and mx-02 are applied; check `out\plan\plan-trace.json` |
| V5 | Extra or renamed files in the plans folder | Clear `<WS>\pl\Stamper\plan-data\<SCN>\plans` and rerun from E4 |
| V6 | Stamper counts outside ±2 | Compare `summary.json` `stamper.failed_tasks` with section 6; a new failure is a regression |
| V7 | Writes outside E6 | Something else touched the sim; make sure no other tool uses port 4390 |
| V8 | SSP missing sections or counts off | Check `ssp.json`; `TENANT_MANIFEST_PATH` must be set before EO starts |
| V9 | EO picked another MP | Clear old files in the plans folder; rerun from E4 |
| V10 | `CES_PIPELINE_ROOT` / `CES_TENANT_ROOT` not set for a process | Run through `mx-e2e.ps1`, which sets both |
| V11 | A new unit-test failure | Read `out\unit-gate.json` `unexpected`; if it is in a patched area, the patch is at fault |

## 9. How this relates to the muster-shift backlog

This run supplements the 10-21 muster-shift package. It closes what is needed to *run* (N-01 to N-07) and three truthfulness items (MG-01, MG-03, MG-05) as reference patches. MG-02 stays open and deferred; everything else in `muster-shift/01-GAP-BACKLOG.md` remains your parity work list, with updated statuses in `GAP-ANALYSIS.md` section 4. When you land MG-02, expect V4's counts and V6's baseline to move; rerun and send us the new `summary.json`.
