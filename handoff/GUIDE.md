# CES contractor guide

The full, step-by-step guide for an engineer who has never seen CES. Read `START-HERE.md` (the one-page summary at the repository root) first. This guide covers what you have, how to set up a Windows machine, install, build, run the simulator and every module, run one scenario end to end, read the results, run the unit gate and the acceptance round, how to spend your first day, and how CES moves to a real GCC High tenant later.

Written 2026-11-01 by H1 (handoff agent 1) for the PH-13 code (PH-13 is BHD's last fix wave before the handoff). Facts were read from the code at that cut; where a fact lives in a kit file, this guide points to it rather than repeating it.

**Paths.** `<Root>` is where you clone the monorepo, and for now it **must be `C:\ces-nb`**: some test and harness files still hard-code that path (KNOWN-ISSUES KI-13 lists every one; PUNCH-LIST PL-114 makes them configurable). `bootstrap.ps1` and `check.mjs` accept any short root through `-Root`, but the UI end-to-end tests and some harness scripts do not. Short paths also matter on Windows (KI-08). The kit is `<Root>\handoff`, the code is `<Root>\ces`, the harness ("run package") is `<Root>\pkg\ces-muster-run` (written `<PKG>`).

---

## 1. What CES is, and what you have

CES (the BHD compliance engine) takes a small defense contractor's Microsoft 365 GCC High tenant to CMMC Level 2 (the DoD Cybersecurity Maturity Model Certification, 110 practices from NIST SP 800-171): it asks the customer questions, plans the tenant configuration, applies it, runs governed admin operations, collects evidence and writes the assessor's documents (SSP, POA&M, SPRS score).

### The modules (each two lines)

| Module | Folder | What it does |
|---|---|---|
| **Muster** (UI + `muster-api`) | `ces\ces-muster`, `ces\ces-muster\muster-api` | Collects the customer's data: questionnaire, interview answers, discovery of the tenant, the CUI boundary. It writes the plan (the Mission Plan, Tenant Manifest and Infrastructure Manifest) and pushes it to Stamper and EvidenceOps. It never receives results back: it only collects data and writes the plan. |
| **Stamper** | `ces\ces-stamper` (+ `ui`) | Applies the plan to the tenant: initialises the tenant (step E0), translates each plan directive into registry entries (PowerShell / Graph commands), runs them with a get-then-set pattern and records evidence per objective. CLI, GUI and API; a cost gate and manual gates stop for an operator. |
| **AdminOps (AO)** | `ces\ces-ao` (+ `ui`) | Runs about 98 governed admin operations (joiners, movers, leavers, device and group actions) with risk tiers, a sim-only rail, a CMMC scope gate and evidence for every call. Hosts the **leaver flow** (approve first, then act; RUNBOOK.md "Leaver flow"). |
| **EvidenceOps (EO)** | `ces\ces-eo` (+ `ui`) | Collects evidence on a schedule (collectors C1...C11), assesses all 110 practices and 320 objectives, and writes the SSP (JSON and DOCX), POA&M, SPRS score and the evidence package. Hosts uploads and document reviews for the non-technical controls. |
| **Evidence Collector (EC)** | `ces\ces-ec` | A small server that takes manual evidence uploads (files tagged with evidence-catalog ids), keeps them write-once and serves them to EO, which flags a tampered file. |
| **Simulator** (tenant-stacksim) | `ces\tenant-stacksim` | A fake GCC High tenant (Graph, Exchange, Intune, Azure, Purview answers) with four fictional customers. You build and prove everything against it first; it holds no real data. |
| **Tester** (ces-tester) | `ces\ces-tester` | Drives the whole flow end to end for a scenario (`-Harness tester`), including the AdminOps steps and the watched UI runs, and writes the run record the verify checks read. |

Shared pieces: `ces\ces-shared` (types, contracts, the SQLite store `ces.db`, secrets helpers, UI kit) and `ces\ces-tenant` (the tenant registry and PowerShell session factory; an optional auth-state daemon). The harness `<PKG>` holds `mx-e2e.ps1` (one scenario end to end), `run-tests.ps1` (the unit gate), `verify.mjs` (the V-checks) and the stored baselines.

### What is in the repository

| Path | What |
|---|---|
| `START-HERE.md` | the one-page summary |
| `handoff\` | this kit: the guide, runbook, acceptance, known issues, punch list, the manifest and schemas, `bootstrap.ps1`, `verify\` |
| `ces\` | the CES code (ces-mono), with `ces-muster\`, `ces-tester\`, `tenant-stacksim\`, `ces-tenant\` as plain folders |
| `pkg\ces-muster-run\` | the harness (run package) |
| `SOURCES.json` | which BHD repository, branch and commit each folder came from |

The current state of the work, decisions still owed, and who owns each item are in `PUNCH-LIST.md`. Symptoms you may hit while running are in `KNOWN-ISSUES.md`.

## 2. Rules that bind every change

- **Simulator first.** Build and prove against tenant-stacksim. A live tenant comes later (section 13).
- **No AI on live tenants.** muster-api's AI paths run only when `ANTHROPIC_API_KEY` is set, no live client is configured and `MUSTER_AI_SIM_ONLY=1`. The simulator build needs no AI key; BHD does not share one.
- **Two-person approval is off by default.** `CES_TWO_PERSON_APPROVAL=1` turns it on (use `1`, KI-14).
- **Recurring cost is off by default and needs two confirmations:** DP-1 (an opt-in for that item at plan time) and DP-2 (a typed confirmation at run time, exactly `<op id> <monthly figure>`). Automated DP-2 typing is for simulated tenants only.
- **HELD items stay held:** the Global Administrator registry entry `AC.L2-3.1.2.role-assign`, the Teams Administrator grant and SharePoint `Sites.FullControl.All`. Tenant init reports them as held.
- **No module is loopback-only; tokens gate access.** Every server listens on all interfaces by default (except the Muster vite dev server, KI-01). Always set each module's token.
- **An empty read is not evidence.** A read that succeeds but returns nothing scores NOT_SAT (`evidence_not_shown`).
- **Score changes are predicted first.** Any change that moves a control status or SPRS needs a written prediction compared with the next round before a new baseline (BHD's rule AR5; V99 enforces it).
- **No identity or secret in any file.** Fixtures are fictional ("SIMULATED CUSTOMER (FICTIONAL)", V58). `check.mjs` and the identity scan fail on a hit.

## 3. Prerequisites

A Windows 10/11 or Windows Server machine (a clean VM is best), plenty of free disk (allow at least 20 GB; an estimate), internet access to npm and GitHub.

| Tool | Version | Why | Check |
|---|---|---|---|
| Node.js | **24.12.0** exactly (`ces\.nvmrc`) | every package builds and tests with it | `node --version` |
| npm | 11.6.2 (ships with Node 24.12.0) | the lockfiles were written by it | `npm --version` |
| git | 2.52 or later | clone and pull | `git --version` |
| Windows PowerShell | 5.1 (built into Windows) | Stamper, AO and the tenant session factory run `powershell.exe`; all kit scripts target 5.1 | `powershell -NoProfile -Command "$PSVersionTable.PSVersion"` |
| Microsoft.Graph.Authentication | 2.35.1 exactly | **live tenants only** (KI-11); the simulator does not need it | `Get-Module -ListAvailable Microsoft.Graph.Authentication` |
| A Chromium browser for Playwright | the versions the repos pin | the watched UI runs (V73, V123-V125) | see step 6.3 |

The single source of these versions is `handoff\handoff.manifest.yaml` (`toolchain`); `bootstrap.ps1` checks them. `better-sqlite3` is a native module: `npm ci` downloads a prebuilt binary for Node 24 on Windows x64; if that fails (no internet to its release host), install the Visual Studio Build Tools (C++ workload) and rerun.

## 4. Get the code

```powershell
git clone -c core.autocrlf=false -c core.longpaths=true <link BHD sent you> C:\ces-nb
git -C C:\ces-nb ls-files --eol | Select-String 'i/lf\s+w/crlf'     # must print nothing
```
Put both `-c` options on the clone line itself. They keep line endings exactly as committed (KI-21) and allow paths over 260 characters. Git for Windows installs with `core.autocrlf=true` in its system settings, so a plain `git clone` checks out thousands of LF (Unix line ending) files as CRLF (Windows line ending) before any later `git config` can help; setting it afterwards does not rewrite those files. The second line lists any file whose line endings changed on checkout; it must print nothing. (Files committed with CRLF, such as `mx-e2e.ps1`, show as `i/crlf` and are correct.)

**If you already cloned without the `-c` options** and the check line prints files, either delete `C:\ces-nb` and clone again with the line above (simplest), or, when you have no local changes (this discards them), fix it in place and check again:
```powershell
cd C:\ces-nb
git config core.autocrlf false; git config core.longpaths true
git rm -r -q --cached .; git reset -q --hard HEAD
git ls-files --eol | Select-String 'i/lf\s+w/crlf'                 # must now print nothing
```
Then rerun `bootstrap.ps1` (6.1) if you had already built.

Delivery is only through the private GitHub organization and that link, never an emailed script or zip.

## 5. Configure the environment

You configure CES with environment variables (and, for long-running installs, a protected secrets file). Nothing needs configuring for the simulator acceptance run: the harness makes throwaway tokens in memory for each run.

- **Every setting** the code reads is in `handoff\config.schema.yaml`: name, which component reads it, default, allowed values, whether it is a secret, who owns it (BHD, contractor or operator), scope (dev, sim, live, all) and the file:line where it is read. `handoff\.env.example` is generated from it (secrets appear as `NAME=` with no value). Do not rely on a `.env` file being loaded (only Stamper has its own `dotenvLoader`): set variables in the PowerShell window that starts a server (`$env:NAME = 'value'`) or in the service definition.
- **Every secret** is in `handoff\secrets.inventory.yaml` by name only: what it is for, where it is stored, who creates it, how, and how to rotate it. You create all of them yourself (`sharedByBHD: false`). BHD shares only two access grants: your access to the GitHub organization and, if you have no tenant of your own, a scoped guest account in a GCC High tenant.
- **Module secrets for a standing install** (tokens, principal secrets, `JWT_SECRET`, `EVIDENCE_OPS_SECRET`, `CES_EO_OPERATOR_SECRET`, `CES_MUSTER_SECRETS_TOKEN`) live in one DPAPI-protected file (Windows Data Protection API) that you generate:
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\ces\ces-shared\scripts\New-CesModuleSecrets.ps1 -MusterTenantId <tenant_id>
  ```
  Default path `%ProgramData%\CES\secrets\module-secrets.dpapi` (or `CES_MODULE_SECRETS_PATH`). A value in the store wins over the environment. The muster-api token in it expires (8 h by default): renew it with `handoff\lib\Set-MusterSecretsToken.ps1` (RUNBOOK.md "Secrets rotation").
- **Settings you will touch first:**

| Setting | For | Default | Notes |
|---|---|---|---|
| `CES_PIPELINE_ROOT` | every module | `%LOCALAPPDATA%\CES\pipeline` | where `ces.db` and run files live; the harness uses `<Root>\pl` |
| `CES_TENANT_ROOT` | ces-tenant, EO, AO UI, tester | `%USERPROFILE%\.ces\tenants` | the tenant registry; the harness uses `<Root>\tenants` |
| `CES_STAMPER_AUTH_TOKEN`, `CES_AO_AUTH_TOKEN`, `CES_EO_AUTH_TOKEN`, `EVIDENCE_OPS_SECRET` (EC), `CES_TENANT_AUTH_TOKEN` | each server | unset = loopback callers only | the bearer tokens; always set them |
| `JWT_SECRET` | muster-api | none | signs muster-api sessions |
| `EO_PORT` / `CES_EO_BIND`, `EC_PORT` / `EC_HOST`, `CES_AO_BIND`, `CES_TENANT_BIND`, `PORT` (muster-api) | servers | see the manifest ports | `--port` flags for Stamper, AO, ces-tenant, stacksim |
| `CES_TWO_PERSON_APPROVAL` | AO, EO | off | `1` turns it on |
| `CES_AO_PUBLIC_URL` | AO leaver flow | `http://localhost:<port>` | the confirm-link base tenant admins reach |
| `CES_BHD_NOTICE_MAILBOX` | AO leaver flow | unset | BHD's role mailbox, used only when a customer opts in (`notifyBhdOnDone`, per tenant, default off) |
| `CES_AO_LEAVER_TICK_MIN`, `CES_AO_LEAVER_TENANTS` | AO leaver flow | off | optional timer for scan, reminders, escalations |
| `TARGET_TENANT_DOMAIN`, `CLIENT_NAME` | Stamper | a hard-coded real customer (KI-12) | **always set both** |
| `MX_STACKS` | harness | from the plan | S3 needs `m365_e5_gcc,microsoft_intune` (the acceptance scripts set it) |

## 6. Install and build

### 6.1 Bootstrap (one command)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\bootstrap.ps1 -Root C:\ces-nb
```
It (1) checks every toolchain version, (2) checks that each module folder is there and matches `SOURCES.json` (in the monorepo it clones nothing) and warns if `core.autocrlf` is on, (3) runs `npm ci` once per npm install root and then the build for every component in dependency order, failing fast with the last log lines, (4) optionally (`-ModuleSecretsPath <file>`) makes the module-secret store. The install roots are the ces-mono root `<Root>\ces` (one `npm ci` for all its workspaces) and each separate package: `ces-tenant`, `tenant-stacksim`, `ces-tester`, `ces-muster` and `ces-muster\muster-api`. It never runs `npm ci` inside a ces-mono workspace member such as `ces-stamper`, even though four of them still hold an old `package-lock.json` (PUNCH-LIST PL-115): npm would treat that folder as the workspace root and wipe the shared `node_modules`. It is idempotent: fix the cause and rerun, or rerun at any time (a rerun reinstalls and rebuilds; about the same time as the first run). `-NoProfile` keeps your own PowerShell profile out of the run. It never kills a process and never writes outside `<Root>` (except the store path you name). Logs: `<Root>\out\bootstrap\bootstrap.json` and `<step>.out` / `.err`.

### 6.2 Build order
`handoff\BUILD-ORDER.md` shows the order and the dependency graph (generated from the manifest): ces-tenant, then ces-shared (it runs the root `npm ci`), then the UI kit, then the servers (Stamper before AO, which links Stamper), the three UIs, the simulator, the tester, Muster and muster-api. The UI kit comes before the servers because `npm run build -w ces-stamper` (likewise `-w ces-eo` and `-w ces-ao`) also builds the UI workspace inside that folder, which imports the UI kit; the three UIs therefore build twice, which is harmless. To build one component by hand, run its `build` command from `handoff\handoff.manifest.yaml` in its folder, for example `npm run build -w ces-ao` from `<Root>\ces`. Use `cmd /c` or PowerShell 7 for commands chained with `&&` (Windows PowerShell 5.1 does not support `&&`).

### 6.3 Browsers for the watched UI runs
```powershell
cd C:\ces-nb\ces;            npx playwright install chromium
cd C:\ces-nb\ces\ces-muster; npx playwright install chromium
```
The two folders pin different Playwright versions, so each needs its own browser download.

### 6.4 Check the kit and smoke-test the servers
```powershell
node C:\ces-nb\pkg\ces-muster-run\scripts\handoff\check.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\verify\smoke.ps1 -Root C:\ces-nb
```
If another CES instance holds the manifest ports on this machine, add `-PortOffset <n>` (for example `-PortOffset 20000`) to move every smoke-test port by n; this option is new and has not been run yet (KI-17).
`check.mjs` exits 0 when the manifest, contracts, settings, secrets inventory, generated files and code agree and no secret or identity string is in the kit (checks (a)-(f), listed in its header). `smoke.ps1` starts each server one at a time (simulator first), waits until its port answers and the listening address matches the manifest, then stops only what it started. It refuses to run if a port it needs is held.

## 7. Run the simulator and each module by hand

You rarely need to: the harness starts everything for a run. To explore one module, start the servers in this order, each in its own PowerShell window with its variables set (RUNBOOK.md "Start and stop each server" has the exact commands, ports and health checks):

1. **Simulator:** `cd C:\ces-nb\ces\tenant-stacksim`; `node bin/stacksim.mjs scenario s1-mach`; `node bin/stacksim.mjs serve m365_azure --slug s1-mach --port 4390`.
2. **muster-api** (port 4000; the harness uses 4011) and the **Muster UI** (`npm run dev`, port 5173).
3. **EO** (`EO_PORT`, default 4002) and **EC** (`EC_PORT`, default 4001).
4. **Stamper GUI** (`gui --port 3000 --stacksim`) and **AO GUI** (`gui --port 3001`; both default to 3000, KI-16).

Stop each with Ctrl+C. Never stop a process you did not start.

## 8. Run one scenario end to end

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\pkg\ces-muster-run\scripts\mx-e2e.ps1 -Root C:\ces-nb -Harness tester -Scenario s1-mach
```
About 30 minutes. A browser window opens for the watched UI steps (step EU: paced, captioned, with video and trace); add `-UiHeadless` for an unattended rerun. The run refuses to start while one of its ports (4390, 4011, 4002, 4001, 3000, 3001, 4173) is held.

What happens, step by step (the header of `mx-e2e.ps1` is the full list):

| Step | What |
|---|---|
| E0 | tenant init on a clean simulated tenant: bootstrap record, grants (held ones held), preflight, baseline |
| E1 | build the scenario in the simulator |
| E2 | Muster discovery of the tenant, with the customer's interview answers |
| E3 | muster-api compiles the plan (`POST /api/plan/compile`) |
| E4 | Muster pushes the plan to Stamper and EvidenceOps |
| E5 | register the simulated tenant |
| E6 | Stamper translates and executes the plan (E6X: S3 re-injects its deficiencies) |
| E8.5 / E8.6 | an EC upload and document reviews |
| E7 | EvidenceOps assesses (three passes) |
| E7A / E7S | AdminOps operations, then the sweep of every AO command |
| E7B | EvidenceOps re-assesses after AdminOps (the authoritative score) |
| E8 / E8B | SSP, POA&M and the evidence package; the shared evidence bundle |
| E8F | a forced-failure run, to prove a failure is reported honestly |
| E8R / E9A | Stamper lifecycle commands; AO surfaces (MCP, CLI, refusals) |
| EU | the watched UI runs (Stamper, AO, EO, Muster) |
| E9 | the verify checks (V1 ... V131) |

The four scenarios are S1 `s1-mach`, S2 `s2-eng`, S3 `s3-def` (set `$env:MX_STACKS = 'm365_e5_gcc,microsoft_intune'` first) and mp `muster-partial` (ACCEPTANCE.md describes each). `-Harness mx` (the package's own driver) skips the AdminOps and tenant-init steps.

## 9. Read the results

All in `<Root>\out` (each run replaces the previous one; `verify\round.ps1` copies each scenario to `out\round\<slug>\`):

| File | What it tells you |
|---|---|
| `verify.json` | every V-check with pass / fail and a detail line; `pass` at the top is the verdict. ACCEPTANCE.md lists every V-check. |
| `summary.json` | the headline numbers: `eo_assess.sprs_score`, `eo_assess.controls_met`, Stamper task counts, plan size |
| `steps.json`, `logs\<step>.out` / `.err` | each step's exit code, times and log |
| `ssp.json`, `ssp.docx`, `poam.json` | the assessor deliverables (marked SIMULATED CUSTOMER (FICTIONAL)) |
| `eo-package.zip`, `eo-package\` | the evidence package with its integrity manifest |
| `GAPS-<slug>.md` | every gap: not met, not assessed, presence-only, documentary items, each with the module that owns the fix |
| `scorecard-<slug>.json` | the scorecard rows against the scenario thresholds |
| `ui\<surface>\<variant>\` | video, trace and screenshots of the watched UI runs |
| `unit-gate.json` | the unit gate result |

Compare a run with its stored baseline in `<PKG>\expected-outputs\<slug>\` (mp: `<PKG>\expected-outputs\`). `node <PKG>\scripts\dashboard.mjs --root C:\ces-nb` writes `<Root>\dashboard\proof-runs.html`, a self-contained page of proof-run history and flipped checks.

## 10. Run the unit gate

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\pkg\ces-muster-run\scripts\run-tests.ps1 -Root C:\ces-nb
```
It runs every package's suite (ces-tenant, ces-shared, ces-stamper, ces-eo, ces-ao, ces-ec, tenant-stacksim, ces-tester, ces-muster, muster-api) with the stores redirected inside `<Root>\out\unit`, starts the simulator for the live-sim suites if none is running, and passes when every failing test is listed in `<PKG>\known-failures.json` (that list is empty: the gate must pass with zero failures). Output: `<Root>\out\unit-gate.json` and `<Root>\out\unit\<suite>.log`. Run one package's tests with its `test` command from the manifest. Known flakes: KI-07, KI-20.

## 11. The acceptance test: one proof round

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\verify\round.ps1 -Root C:\ces-nb
```
The unit gate once, then all four scenarios end to end with the tester harness, each compared with `handoff\verify\expected-results.md`. About two hours. Pass = `<Root>\out\round\round.json` has `"pass": true`. ACCEPTANCE.md has the full definition of done (eight checks), the evidence to attach, the V-check list and the sign-off. At the cut the targets are drafts and some checks are known red (KI-06, KI-19, PUNCH-LIST "R-F11 results").

## 12. Your first day

1. Read `START-HERE.md`, this guide's sections 1-2, and skim `PUNCH-LIST.md` "Start here".
2. Clone, bootstrap, install the browsers, run `check.mjs` and `smoke.ps1` (sections 4-6). Expect about an hour, mostly `npm ci`.
3. Run the unit gate (section 10).
4. Run S1 end to end with the tester harness (section 8) and watch the UI steps. Open `out\verify.json`, `summary.json`, `ssp.docx` and `GAPS-s1-mach.md`.
5. Compare with `<PKG>\expected-outputs\s1-mach\` and with the R-F11 section of the punch list. Note every difference with its V-check id.
6. Pick your first P1 rows owned by "contractor" with the BHD owner. Before changing anything that moves a score, write the prediction (which controls move, by how much, why) and run the round to compare.
7. Keep a short log of what you changed, which checks moved, and why.

## 13. Moving to a real GCC High tenant (phase PH-L)

Live work comes after the simulator finish line (gate G-FSIM: every use case works on the simulator on all four scenarios and BHD accepts). It is BHD's phase PH-L. Do not point CES at a live tenant before BHD says so.

What you need:
- **A tenant:** your own GCC High tenant, or a scoped guest account BHD grants in its tenant (the only access BHD shares; removed at the revocation date in ACCEPTANCE.md).
- **An app registration with a certificate** (inventory entry `tenant-app-certificate`): you create it in that tenant; the certificate lives in the Windows certificate store, never in a file in the repo. Grant least-privilege Graph permissions only: start from the permissions the registry entries name (for example `User-LifeCycleInfo.Read.All` for the leaver read, `Policy.ReadWrite.ApplicationConfiguration` for the idle-timeout entry) and add only what a failing step proves it needs.
- **The Graph PowerShell module 2.35.1** exactly (KI-11), and `bootstrap.ps1 -Live`.

What stays held, and why: `AC.L2-3.1.2.role-assign` (Global Administrator), the Teams Administrator grant and `Sites.FullControl.All` are standing tenant-wide roles. BHD will decide them together in one decision at PH-L; until then CES reports them as held and never grants them.

What the simulator hides (prove each on the live tenant, PUNCH-LIST section 11): the PowerShell session families of some AO operations, the Purview connection, app-only eDiscovery, the Azure CLI / PnP operations (KI-23), the break-glass guided step (the customer creates the account; CES only verifies it), live discovery and harvest, setting ids built from documentation rather than read from a tenant, the Azure preflight wait (KI-22), and leaver mail (simulated only, KI-18).

Rules that do not change on a live tenant: AI stays off; two-person approval stays off unless the customer asks; every recurring cost needs DP-1 and a human-typed DP-2; Stamper's `TARGET_TENANT_DOMAIN` and `CLIENT_NAME` are set explicitly; `CES_EO_OPERATOR_DEV_FALLBACK` is never set; no CUI enters BHD systems (CES runs inside the customer environment).

## 14. Where things are

| Need | Look in |
|---|---|
| Ports, components, builds, commits | `handoff\handoff.manifest.yaml`, `README.md`, `BUILD-ORDER.md` |
| A setting or a secret | `handoff\config.schema.yaml`, `handoff\secrets.inventory.yaml`, `.env.example` |
| Versions exchanged between modules | `handoff\contracts.yaml` |
| Day-to-day operation, `ces.db` backup, leaver flow, rotation | `handoff\RUNBOOK.md` |
| A failure you hit | `handoff\KNOWN-ISSUES.md`, then RUNBOOK.md "Common failures" |
| What to work on | `handoff\PUNCH-LIST.md` |
| When you are done | `handoff\ACCEPTANCE.md` |
| A V-check's rule | `<PKG>\scripts\verify.mjs` and `verify-*.mjs` (search `'V<n>'`) |
| A Stamper registry entry | `ces\ces-stamper\src\registry\*.registry.json` |
| An AO operation | `ces\ces-ao\src\registry\` |

## Legend
- **H1**: the handoff agent that wrote this guide. **PH-n**: a BHD fix wave (PH-13 the last before handoff). **PH-L**: the live phase. **G-FSIM**: the simulator finish line. **R-Fn**: BHD proof round n. **AR5**: BHD's predict-then-compare rule for score changes.
- **CMMC**: Cybersecurity Maturity Model Certification. **NIST SP 800-171**: the 110 security requirements CMMC Level 2 assesses. **GCC High**: Microsoft 365 Government Community Cloud High. **CUI**: Controlled Unclassified Information. **DoD**: Department of Defense.
- **SSP**: system security plan. **POA&M**: plan of action and milestones. **SPRS**: Supplier Performance Risk System score.
- **AO / EO / EC**: AdminOps / EvidenceOps / Evidence Collector. **S1 / S2 / S3 / mp**: the four simulator scenarios. **V-nn**: a verify check. **E-step**: a step of `mx-e2e.ps1`. **C1...C11**: EvidenceOps collectors.
- **DP-1 / DP-2**: the cost-gate opt-in and typed confirmation. **NOT_SAT**: Stamper's "not satisfied" verdict. **DPAPI**: Windows Data Protection API. **JWT**: JSON Web Token. **MCP**: Model Context Protocol (AO's tool interface). **SPA**: single-page app. **KI-nn**: a known issue. **PL-nnn**: a punch-list row.
- **LF / CRLF**: Unix / Windows line endings; `core.autocrlf` is the git setting that converts between them on checkout (CES needs it off). **npm install root**: the folder where `npm ci` runs for a package and the packages it hosts (for ces-mono, `<Root>\ces` for all its workspaces). **Workspace member**: a folder listed in the ces-mono root `package.json` `workspaces`, installed from the root.
