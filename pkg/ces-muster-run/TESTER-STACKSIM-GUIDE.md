# ces-tester and ces-stacksim: what they do, how to build and use them

Blue Heron Defense, CES team. Revision 2026-10-24. Written from the code at the pins in `pins.json` (ces-tester `62d1db5`, ces-stacksim `71c073c`) and corrected against what actually ran in our fresh-folder proof runs. Citations are `repo:path:line`.

## 1. Layout (read this first)

Neither repo works as a flat clone. Both expect the nested layout (`ces-mono:WORKSPACE.md:5-14`):

```
<WS>/ces/            ces-mono (ces-shared, ces-stamper, ces-ao, ces-eo, ces-ec, ces-planner, tenant-tests)
  ces-tenant/
  ces-muster/        (+ muster-api/)
  ces-tester/
  tenant-stacksim/   <- the ces-stacksim repo, cloned under THIS folder name (mandatory)
```

- Sibling paths are hard-coded: stacksim reads `../ces-stamper`, `../ces-eo`, `../ces-ao`, `../ces-muster`, `../tenant-tests` and `../node_modules/tsx` (`ces-stacksim:src/coverage/InventoryExtractor.ts:64-66`); ces-ao imports `../../tenant-stacksim/src/config/SimTenantConfig.js`; muster-api finds the sim at `../../tenant-stacksim` and Stamper's registry at `../../ces-stamper/src/registry` relative to its own `dist` (`ces-muster:muster-api/src/services/liveSimSession.ts:37`, `simDiscoveryRun.ts:61`). `STACKSIM_ROOT` and `STAMPER_REGISTRY_ROOT` override the last two.
- ces-muster does not declare `@types/node`. Its `tsc` only passes when nested, because TypeScript then finds `<WS>/ces/node_modules/@types/node` in the parent folder.
- Integration tests skip silently when a sibling folder is missing, so a green `npm test` in the wrong layout proves nothing.
- Clone with `git -c core.longpaths=true -c core.autocrlf=false`. Without `longpaths`, cloning ces-mono fails on Windows ("Filename too long" under `ces-planner/decsriptions/...`). With `autocrlf=true`, several tests fail falsely: Muster fixture freshness, the sprs-weights parity tests (Muster and EO), and the stacksim `aoops-scenario` load (a CRLF `.mjs` with a shebang). `bootstrap.ps1` does both.

## 2. Builds the shipped bootstrap skips

Both CLIs load only from `dist/` (`ces-stacksim:bin/stacksim.mjs:13`, `ces-tester:bin/ces-tester.mjs:9`). ces-mono's own `scripts/bootstrap.ps1` installs and tests but does **not** build tenant-stacksim, ces-tester, muster-api or the Muster SPA, does not seed a sim, and uses `npm install` (which rewrites five lockfiles). Use this package's `bootstrap.ps1` instead; its build order is:

1. ces-tenant: `npm ci`, `npm run build` (everything else links it with `file:`)
2. ces-mono root: `npm ci`, `npm run build:core` (ces-shared, ces-stamper, ces-ao, ces-eo, ces-planner)
3. tenant-stacksim: `npm ci`, `npm run build`
4. ces-tester: `npm ci`, `npm run build`
5. ces-muster: `npm ci`; muster-api: `npm ci`, `npm run build` (makes `dist/cli/bin.js`, the `mu` CLI); ces-muster: `npm run build` (SPA)

## 3. ces-stacksim (package name `tenant-stacksim`)

**What it is:** a fake Microsoft 365 GCC High tenant. Unmodified Stamper, AO, EO and Muster code runs against it, and every create, change and read lands in an append-only ledger.

**Profiles:** `m365_only`, `m365_sentinel`, `m365_azure` (the shared G5 tenant, seed set `gcc-high-g5`, `profiles/m365-azure.json`: users, CA policies, devices, compliance policies, a Log Analytics workspace, VNets, NSGs, Key Vault and more).

**Scenarios (`scenarios/`):** `muster-bare`, `muster-partial`, `muster-configured`, `muster-mfa-disabled`, `muster-mfa-report-only` (each declares expected facts for only four questions: `iam-001`, `iam-004`, `ep-001`, `ep-002`), `demo-dib-small` (a fictional 13-seat company, generated from its `.config.json`; do not hand-edit), `aoops-g5` (AO's 95 commands). The MX run uses **`muster-partial`**: device enrollment and compliance exist, but no CA policy enforces MFA.

**Seeding vs serving:**
- `node bin/stacksim.mjs scenario <name>` wipes and seeds tenant `<name>`.
- `node bin/stacksim.mjs serve m365_azure --slug <name> --port 4390` serves it. **`serve` never seeds**, and neither `up` nor `serve` reseeds an existing tenant. Use `scenario` to reset.
- `node bin/stacksim.mjs up` seeds `sim-m365-azure` once and serves it. The live-sim test suites (muster-api, ces-eo) spawn `serve` and report 0 met on a fresh clone unless a tenant was seeded first; the unit gate (`scripts/run-tests.mjs`) starts `up` for them.
- State lives in `tenant-stacksim/.stacksim/tenants/<slug>/` (run the CLI from the repo root).

**Port 4390 is fixed.** Muster hard-codes `http://127.0.0.1:4390` (`ces-muster:muster-api/src/services/liveSimSession.ts:28`, `routes/harvest.ts:34`).

**HTTP surface on :4390:** `/resolve` (used by the fake PowerShell modules), `/ledger` (POST a filter, get `{data:[{ts,type,objectType,objectId,actor,source,sessionType,...}]}`; seed rows have `sessionType: "seed"`, reads have type `read-serve`), `/evidence`, the Graph facade `/v1.0/*` and `/beta/*`, fake OAuth, a live inspector at `/`, and `/_faults` for injecting 429, 503 and malformed responses.

**Fake PowerShell modules (`psmodules/`):** Az.*, Microsoft.Graph.*, ExchangeOnlineManagement, MicrosoftTeams, SharePoint/PnP, plus an `az` CLI shim in `azshim/`. To point a process at the sim: replace `PSModulePath` (every casing) with the sim modules plus `$PSHOME\Modules`, put `azshim` first on `Path`, and set `STACKSIM_SERVER_URL=http://127.0.0.1:4390`. `scripts/mx-helpers.mjs sim-env` gets exactly that from ces-tenant (`StacksimEnvironment.getSimLaunchEnv`).

**Other commands:** `seed`, `query-ledger`, `query-evidence`, `verify-doc`, `inventory`, `coverage`, `coverage-ao`; npm scripts `build`, `test`, `stacksim`, `demo`, `demo:reset`, `demo:build`, `coverage:ao`.

**Prerequisites:** Node 20+ (no engines field), Windows PowerShell 5.1 for anything that runs the fake modules.

## 4. ces-tester

**What it is:** the orchestrator that runs CES tools against the sim: reseed stacksim, register an ephemeral sim tenant in ces-tenant, obtain a Mission Plan, run Stamper `translate` then `execute --mode auto`, and compare expected tenant state against the ledger (`ces-tester:src/cli/run-scenario-command.ts:102-289`). It also hosts the demo engine, a Command Center on :4600, a catalog and dashboards.

**Scenarios:** baselines (`clean-tenant-mfa-baseline`, `audit-logging-baseline`, `exo-protection-baseline`, `remote-maintenance-mfa-baseline`, `teams-external-baseline`), the harness self-test `zz-deliberate-fail-atp` (meant to fail), and Muster discovery evaluations under `scenarios/eval/*`.

**CLI:** `run-m2`, `run-scenario <file> [--keep-on-failure]`, `run-all`, `dashboard`, `coverage`, `demo:preflight|reset|run|dashboard|eval|e2e|show|acts-test`, `catalog`, `center`.

**Ports:** 4390 sim, 5173 ces-planner, 3000 Stamper GUI, 3001 AO GUI, 4002 EO, 4173 Muster SPA preview, 4600 Command Center. The demo ports collide with ces-mono's launcher ports (5001-5004).

**Prerequisites:** Node 20+, `better-sqlite3` (native), Playwright 1.61 with `npx playwright install chromium` for the demos, Windows PowerShell 5.1 (Stamper always runs under `powershell.exe`). Environment: `CES_ROOT`, `CES_TENANT_ROOT`, `CES_PIPELINE_ROOT`, `CES_TESTER_FLOW_LIVE=1` (opt-in flow tests), `JWT_SECRET`, `SMOKE=1`.

### What `run-m2` really proves

`run-m2` is the only tester scenario that uses Muster, and it is **a shim with canned answers**: `src/flow/muster-plan-gen.cli.ts` calls Muster's `buildPlanArtifacts` directly with answers from the scenario file and `tenantConfig: null`. It never runs discovery, never goes through muster-api, and writes only the MP and TM. Its PASS checks three things about MFA. **The Stamper report underneath is PARTIAL: 110 tasks, 87 completed, 23 failed.** Do not read its PASS as "Muster to Stamper works".

The MX run replaces the shim with a real Muster user path: `mu discovery --sim`, then the headless runner `overlay/ces-muster/scripts/mx/plan-from-discovery.ts`, then muster-api's `/api/plan/push`. It reuses the tester's Stamper wiring (ces-tenant sim registration, sim-only env, synthetic Stamper env file, stdin newline for the execute preflight).

## 5. Where things get written

- **Stamper defaults to `C:\CES_Pipeline`** on Windows (`ces-mono:ces-shared/src/storage/contract.ts:25`): `ces.db`, `Stamper/plan-data/<slug>/state/execution-results-*.json` and more. Set **`CES_PIPELINE_ROOT`** to keep it in your workspace; it is honoured everywhere (`ces-shared/src/storage/node.ts:29`, `ces-tenant/src/impl/paths.ts:37-41`). The MX scripts set it to `<WS>\pl`.
- **ces-tenant's registry defaults to `~/.ces/tenants`** (`ces-tenant/src/impl/paths.ts:51-54`). Set **`CES_TENANT_ROOT`**; the MX scripts use `<WS>\tenants`.
- EO's compliance repo defaults to `./compliance-repo` relative to its working directory (inside `ces-eo`). Set `COMPLIANCE_REPO_PATH`.
- EO's SSP DOCX export also writes a validation report to `ces-eo/output/validation/` inside the clone (no setting for it).
- Some unit suites write through the same defaults; the unit gate sets `CES_PIPELINE_ROOT` and `CES_TENANT_ROOT` to `<WS>\out\unit\` for every suite.
- Verify check V10 confirms `C:\CES_Pipeline`, `~/.ces` and `~/.stamper` are untouched by a run.

## 6. Pitfalls we hit (and the fix in this package)

| Symptom | Cause | Fix |
|---|---|---|
| `Could not find a part of the path` from PowerShell | Windows PowerShell 5.1 cannot open paths over 260 characters | Short `-Root` (for example `C:\mx`); the scripts use short folder names (`pl`, `st`) |
| `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and a non-zero exit after `mu discovery` printed `"ok":true` | Node 24 on Windows aborts on exit while a handle closes | E2 accepts the run when `ok:true` was printed and the file exists; the raw exit code is recorded in `steps.json` |
| EO `POST /api/ssp/generate` returns 500 "Templates directory not found ... dist" | EO's `dist` build has no `data/` folders | Run EO from source: `tsx src/eo/index.ts` (as EO's own live-sim test does) |
| `GET /api/ssp/export/:id` returns `{"error":"tenant required"}` | The export route needs the tenant | Add `?tenant=<slug>` |
| EO's SSP has no Tenant Manifest content | EO auto-finds only a fixed `tenant-manifest.json`; Muster writes timestamped names | Set `TENANT_MANIFEST_PATH` to the pushed TM before starting EO |
| Live-sim suites report 0 met | The sim tenant was never seeded | `node bin/stacksim.mjs up` (or `scenario <name>`) first |

## 7. Stale or wrong docs at the pins

- The stacksim README says "no 429s", but `/_faults` injects them; it references a retired Muster `consentService`, points to docs that do not exist, gives the old GitHub home, and never says the folder must be named `tenant-stacksim`.
- In the tester README and `package.json`, "Muster" often means ces-planner. The README lists `src/runner`, which does not exist. A comment names the wrong script path. `scripts/polish-stock-core-content.mjs` contains hard-coded workstation paths.
- The pinned tester demo plan dates from 2026-08-30 and was produced by Planner, not Muster.
- The tester dossier's AS OF block names a branch and commit not in the repo (K3 below).

## 8. Known failing tests at the pins

`known-failures.json` lists 4 failing tests from 3 defects. The unit gate passes when the failures are a subset of that list.

| ID | Suite | Test | Cause |
|---|---|---|---|
| K1 | ces-muster | `cesSharedParity` (2 tests) | Vendored ces-shared copies carry notice `Ref: BHD-CES-MUSTER-2026A`; canonical carries `Ref: BHD-CES-MONO-2026A` |
| K2 | ces-eo | `claim-accuracy` (1 test) | Reads `ces-eo/docs/context/ARCHITECTURE_DECISION_RECORD.md`, which is not in the repo |
| K3 | ces-tester | `demo-acts-docs-check` (1 test) | Rule DD11: the AS OF block names branch `gp-demo-4` and commit `ae6fa85`, not in this repo's history |

## Legend

| Term | Meaning |
|---|---|
| sim | ces-stacksim |
| MP / TM | Mission Plan / Tenant Manifest |
| EO / AO | ces-eo (EvidenceOps) / ces-ao (AdminOps) |
| CA | Conditional Access |
| K1–K3 | Known failing contractor tests (`known-failures.json`) |
| MX | The Muster-on-the-sim run this package documents |
| V10 | The verify check that nothing was written outside the workspace |
| `<WS>` | Workspace root |
