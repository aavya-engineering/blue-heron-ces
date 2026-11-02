# CES runbook

How to operate a CES build made by `bootstrap.ps1`: start and stop each server, find the logs, back up and restore `ces.db`, keep it from growing without bound, manage the tenant registry, run the leaver flow, rotate secrets, and fix common failures. Refreshed 2026-11-01 by H1 (handoff agent 1) for the PH-13 code (BHD's last fix wave) and the contractor monorepo. For first-time setup read `GUIDE.md`; this file is the day-to-day reference.

Conventions:
- `<Root>` is the folder the monorepo is cloned to and that you pass to `bootstrap.ps1 -Root`: `C:\ces-nb`. The workspace is `<Root>\ces` (ces-mono, with ces-tenant, ces-muster, ces-tester and tenant-stacksim in folders inside it). Commands below run from `<Root>\ces` unless a `cd` says otherwise.
- `<PKG>` is the run package `<Root>\pkg\ces-muster-run` (the harness scripts). The kit is `<Root>\handoff`. (In BHD's module repos the kit is `<PKG>\handoff` instead; the scripts handle both.)
- Ports, components and builds come from `handoff.manifest.yaml`; every setting is described in `config.schema.yaml`; every secret is listed, by name only, in `secrets.inventory.yaml`. This file does not repeat their values.
- Work against the **simulator** (tenant-stacksim) first. A live GCC High tenant (Microsoft 365 Government Community Cloud High) needs your own tenant or a scoped guest account with the least-privilege Graph permissions listed in `secrets.inventory.yaml`.

## Operating rules
- **Two-person approval is OFF by default.** `CES_TWO_PERSON_APPROVAL=1` turns it on (use `1`; see KNOWN-ISSUES KI-14).
- **No module is loopback-only by design; tokens gate access.** Always set each module's token (KI-01 lists the current exceptions).
- **Recurring cost is off by default.** Any AO command that starts a recurring charge needs two operator confirmations: DP-1, a cost acknowledgement sent with the request (the op id, the monthly estimate shown and the price date), and DP-2, the confirmation typed at run time, exactly `<op id> <monthly figure>`. Both are defined in `ces-ao/src/execution/CostGate.ts`.
- **AI paths are off for live tenants.** The simulator build does not need an AI key.
- **The HELD items stay held:** the Global Administrator registry entry `AC.L2-3.1.2.role-assign`, the Teams Administrator grant and the SharePoint `Sites.FullControl.All` grant. Tenant init (Stamper step E0) reports them as held; do not grant them.
- **An empty read is not evidence.** A Stamper evidence read that succeeds but returns nothing (empty text, `null`, `[]`, `{}`, `{"value":[]}`) records its controls NOT_SAT with outcome `evidence_not_shown` (`judgeEvidenceRead`, `ces-stamper/src/adapters/PowerShellAdapter.ts`). Expect honest score drops where a tenant has nothing to show.

## Start and stop each server

Each server runs in the foreground: give it its own PowerShell window, set its variables in that window, and stop it with Ctrl+C. To stop one started in the background, stop **only the process you started** (`Stop-Process -Id <pid>`; find the pid with `Get-NetTCPConnection -LocalPort <port> -State Listen`). Never stop a process you did not start: another build may own it.

Secrets come from the environment (simulator and dev) or from the module-secret store (see "Secrets rotation"). A store value wins over the environment for every name the store holds. For the simulator, generate throwaway values in the window, for example `$env:CES_EO_AUTH_TOKEN = [guid]::NewGuid().ToString('N')`; never write them to a file.

| Server (component id) | Start | Port and bind | Health check |
|---|---|---|---|
| Simulator (`tenant-stacksim`) | `cd tenant-stacksim`; `node bin/stacksim.mjs scenario s1-mach`; `node bin/stacksim.mjs serve m365_azure --slug s1-mach --port 4390` | 4390 (`--port`), every interface (`--host` names one) | `POST http://127.0.0.1:4390/ledger` answers |
| muster-api (`muster-api`) | `cd ces-muster\muster-api`; set `JWT_SECRET` and `PORT`; `node dist/server.js` | `PORT`, default 4000 (the e2e run uses 4011), all interfaces | `GET /` answers |
| EO (`ces-eo`) | `cd ces-eo`; set `EO_PORT`, `REGISTRY_PATH` (`..\ces-stamper\src\registry\cmmc-l2-commands.registry.json`), `STORAGE_ROOT`, `TENANT_SLUG`, `COMPLIANCE_REPO_PATH`, `CES_EO_AUTH_TOKEN`; `node dist/eo/index.js` (built) or `node ..\node_modules\tsx\dist\cli.mjs src/eo/index.ts` (what the e2e run uses) | `EO_PORT`, default 4002; bind address `CES_EO_BIND` (default all) | `GET /api/health` with the token gives 200; without it, 401 |
| EC (`ces-ec`) | `cd ces-ec`; set `EC_PORT`, `EC_HOST`, `EVIDENCE_OPS_SECRET`, `CES_EC_PRINCIPAL_SECRET`, `CES_EVIDENCE_CATALOG_PATH` (`..\ces-muster\src\features\plan\engine\data\evidence-catalog\evidence-catalog-release-0.json`); `node ..\node_modules\tsx\dist\cli.mjs src/index.ts` | `EC_PORT`, default 4001; `EC_HOST`, default every interface | `GET /api/health` answers |
| AO (`ces-ao`) | set `CES_AO_AUTH_TOKEN`, `CES_NO_OPEN=1`, and for the leaver flow `CES_AO_PUBLIC_URL` (optionally `CES_BHD_NOTICE_MAILBOX`, `CES_AO_LEAVER_TICK_MIN`, `CES_AO_LEAVER_TENANTS`); `node ces-ao\dist\cli\index.js gui --port 3000` | `--port`, default 3000 (the e2e run uses 3001); bind address `CES_AO_BIND` (default all) | `GET /api/health` gives 200; `GET /api/commands` without the token gives 401 |
| Stamper GUI (`ces-stamper`) | set `CES_STAMPER_AUTH_TOKEN`, `CES_NO_OPEN=1`; `node ces-stamper\dist\cli\index.js gui --port 3000` (add `--stacksim` to run against the simulator) | `--port`, default 3000 (clashes with AO; KI-16), all interfaces | `GET /` answers |
| Tenant service (`ces-tenant`, optional) | `cd ces-tenant`; set `CES_TENANT_AUTH_TOKEN` (needed for network callers); `node dist/service/cli.js serve --port 4690` | `--port`, default 4690; every interface (`CES_TENANT_BIND` names one) | `GET /health` answers |
| Muster UI (`ces-muster`, dev server) | `cd ces-muster`; `npm run dev` | 5173, localhost only (KI-01; `npm run dev -- --host 0.0.0.0` for other hosts) | the page loads |

All of these are started and stopped for you by `verify\smoke.ps1` (one at a time, simulator first) and by `<PKG>\scripts\mx-e2e.ps1` (the whole Muster -> Stamper -> EO flow). Both refuse to start while a port they need is held, and neither ever stops a process it did not start.

## Logs

| What | Where |
|---|---|
| Bootstrap | `<Root>\out\bootstrap\bootstrap.json` (summary: toolchain, repo HEADs, build order, every step's exit code) and `<Root>\out\bootstrap\<step>.out` / `.err` |
| Smoke check | `<Root>\out\smoke\smoke.json` and `<Root>\out\smoke\logs\<component>.out` / `.err` |
| Unit gate | `<Root>\out\unit-gate.json` (the failing tests not in `known-failures.json`) and `<Root>\out\unit\<suite>.log` |
| End-to-end run | `<Root>\out\steps.json` (each E-step's exit code and times), `<Root>\out\logs\<step>.out` / `.err`, `<Root>\out\verify.json`, `<Root>\out\summary.json` |
| Acceptance (one scenario) | `<Root>\out\acceptance.json` (each expected-results row, and the SHA-256 of each file it read) |
| Proof round (four scenarios) | `<Root>\out\round\round.json` and `<Root>\out\round\<slug>\` (each scenario's acceptance, verify, summary, steps and unit-gate files, copied after it ran) |
| Deliverables of one run | `<Root>\out\ssp.json`, `ssp.docx`, `poam.json`, `eo-package.zip`, `GAPS-<slug>.md`, `scorecard-<slug>.json`; `<Root>\out\ui\<surface>\<variant>\` for the watched UI runs (video and trace) |
| A server you start yourself | its console; redirect it (`node ... > server.out 2> server.err`) when you need a file |

E-steps (E1 to E9, plus E8.5, E8.6, E7B, E8B, E8F and EU; under `-Harness tester` also E0, E6X, E7A, E7S, E8R and E9A) are the steps of `<PKG>\scripts\mx-e2e.ps1`; its header lists them. To rerun from a step, pass `-From <step>`; E7 needs E1's start time in `steps.json`, so after a failed E1 rerun from E1.

## ces.db: backup, restore, growth

`ces.db` is one SQLite database shared by every module, at `<CES_PIPELINE_ROOT>\ces.db`. `CES_PIPELINE_ROOT` defaults to `%LOCALAPPDATA%\CES\pipeline`; the e2e run uses `<Root>\pl`. It runs in WAL mode (write-ahead log), so a live database is three files: `ces.db`, `ces.db-wal` and `ces.db-shm`. Every row is tagged with its tenant, and every read must name its scope (`ces-shared/src/persistence/CesRepository.ts`).

What is not in `ces.db`: evidence files (only their hashes are), Stamper plans and execution results, EC upload files, EO validation files, the tenant registry, the module-secret store, generated deliverables under `<Root>\out`, and reference data in the repos.

**Backup (offline, the simple way).** Stop every CES server. Copy `ces.db`, `ces.db-wal` and `ces.db-shm` together to the backup folder. Start the servers again.

**Backup (online).** SQLite's backup API copies a consistent snapshot while servers run. From `<Root>\ces`:
```powershell
node -e "const D=require('better-sqlite3'); new D(process.argv[1],{readonly:true}).backup(process.argv[2]).then(()=>console.log('backup done'))" "<CES_PIPELINE_ROOT>\ces.db" "<backup folder>\ces-<date>.db"
```
The result is a single file with no `-wal` or `-shm`.

**Restore.** Stop every CES server. Move the current `ces.db`, `ces.db-wal` and `ces.db-shm` aside (do not leave an old `-wal` next to a restored file). Copy the backup in as `ces.db`. Start the servers.

**Growth and pruning.** Evidence and audit collections are append-only (write-once, read-many: the `DEFAULT_WORM_COLLECTIONS` list in `CesRepository.ts`); the API cannot delete their rows, by design (KI-05).
- *Simulator and dev:* when the file gets large (check with `(Get-Item <CES_PIPELINE_ROOT>\ces.db).Length`), stop the servers, back up as above, then move the three files to an archive folder. The next server start creates an empty `ces.db`. The e2e run does not need old rows: EO reads only the current run's AdminOps rows (`CES_EO_ADMINOPS_SINCE`).
- *Live:* do not delete. Evidence retention is a product property; plan disk for it and back up on a schedule.

## Tenant registry

Each tenant CES can reach has one record file under `CES_TENANT_ROOT` (default `%USERPROFILE%\.ces\tenants`; the e2e run uses `<Root>\tenants`). Simulator and live records sit in separate folders, so they cannot collide (`ces-tenant/src/impl/paths.ts`):
- `<CES_TENANT_ROOT>\sim\<slug>.json` for simulator tenants (made, for example, when Stamper or AO starts with `--stacksim`);
- `<CES_TENANT_ROOT>\live\<slug>.json` for live tenants.

List them with `Get-ChildItem <CES_TENANT_ROOT> -Recurse -Filter *.json`. Muster keeps its own tenant list in `ces.db` as well; the two can differ. A live record names its app registration and certificate by reference; the certificate itself is in the Windows certificate store (inventory entry `tenant-app-certificate` in `secrets.inventory.yaml`). Never copy a live record between machines; create it on the machine that will use it.

## Leaver flow (AdminOps, PH-13)

The leaver flow ends a departed person's access only after a tenant administrator confirms (CMMC objective PS.L2-3.9.2[b]: access is terminated consistent with personnel actions). "Approve first, then act":
1. **Detect.** `POST /api/leaver/scan {tenant}` reads the tenant for enabled users whose `employeeLeaveDateTime` has passed (Graph permission `User-LifeCycleInfo.Read.All`). An operator or HR feed can also start one: `POST /api/leaver/flows {tenant, upn, employeeLeaveDateTime?, reason?}`. One flow per leaver, never two.
2. **Ask.** CES records one confirmation request per tenant administrator (the tenant's leaver setting `adminRecipients`, else the tenant record's `tenantAdminContacts`), each with its own single-use link `<CES_AO_PUBLIC_URL>/leaver/confirm/<flowId>?t=<token>`. Only the token's SHA-256 is kept on the flow. Mail is **not sent**: it goes to AO's simulated outbox (`GET /api/leaver/outbox`; KI-18).
3. **Act.** Opening the link only shows a page (mail scanners fetch links). The administrator's confirm (`POST` with `decision: confirm`) runs AdminOps op **A-22**, leaver access termination (disable the account, revoke sessions, remove group memberships and direct licences, delete MFA methods), through the governed pipeline, with evidence for EvidenceOps. A used link answers 409; `decline` closes the flow.
4. **Tell.** A done notice goes to the administrators, and to `CES_BHD_NOTICE_MAILBOX` only when the customer opted in (setting `notifyBhdOnDone`, default **off**).
5. **Never drop it.** With no confirmation: one reminder after `reminderAfterMinutes` (default 1440 = 24 h), then an escalation at `confirmWindowMinutes` (default 4320 = 72 h), which EvidenceOps turns into a finding. A late confirm still works for 7 more days. Nothing touches the tenant before a confirm.

Settings per tenant: `GET` / `PUT /api/leaver/settings`. Advance reminders and escalations with `POST /api/leaver/tick`, or set the timer (`CES_AO_LEAVER_TICK_MIN` and `CES_AO_LEAVER_TENANTS`; off by default). With `CES_TWO_PERSON_APPROVAL=1` the flow waits for that approval, then `POST /api/leaver/flows/:id/resume`. Every `/api/leaver/*` route needs the AO bearer token; the confirm route does not (its link token is the gate). Code: `ces-ao/src/leaver/` and `ces-ao/src/server/routes/leaver.routes.ts`.

## Secrets rotation

The module secrets (module tokens, principal secrets, `JWT_SECRET`, `EVIDENCE_OPS_SECRET`, `CES_EO_OPERATOR_SECRET` and `CES_MUSTER_SECRETS_TOKEN`) live in one DPAPI-protected file (Windows Data Protection API), default `%ProgramData%\CES\secrets\module-secrets.dpapi`, or the path in `CES_MODULE_SECRETS_PATH`. You create it yourself; BHD never sends a value.

1. **Create or rotate the store.** `powershell -ExecutionPolicy Bypass -File ces-shared\scripts\New-CesModuleSecrets.ps1 [-Path <store>] [-Force]`. `-Force` replaces an existing store. The default scope is CurrentUser: run it as the account that runs the services (for a service, its virtual account or gMSA, group managed service account), or the services cannot read it. Its ACL step grants read to `NT SERVICE\CES` by default (`-ServiceAccount` changes it; `-NoAcl` skips it, for a dev folder only).
   Since PH-7 it also mints `CES_MUSTER_SECRETS_TOKEN` as a muster-api JWT (`-MusterTenantId <tenant_id>`, `-MusterTokenHours`, default 8).
2. **Renew the muster-api token** before each operating session, because the JWT expires (KI-02): `powershell -ExecutionPolicy Bypass -File <Root>\handoff\lib\Set-MusterSecretsToken.ps1 -Path <store> -Ces <Root>\ces -TenantId <tenant_id>`. `bootstrap.ps1 -ModuleSecretsPath <store>` runs steps 1 (only when the store is absent) and 2. The ces-tenant daemon's `CES_TENANT_AUTH_TOKEN` is not in the store; set it in the environment of the daemon and its clients.
3. **Restart every CES server.** Old tokens stop working at once.

The store fails closed (servers refuse to start) when it was made for another account or machine, the service was re-created, the profile was deleted, or the VM was restored from a generalized image. The fix is step 1 with `-Force`, then steps 2 and 3. Rotation dates, and which accesses BHD revokes after acceptance, are fixed in `ACCEPTANCE.md`. Every other secret (tenant certificate, storage keys, access grants) is in `secrets.inventory.yaml` with its own creation and rotation rule.

## Common failures

| Symptom | Cause and fix |
|---|---|
| `bootstrap.ps1`: `FAIL <tool>: want ..., found ...` | Install the toolchain version in `handoff.manifest.yaml`. Node is pinned exactly (also in `.nvmrc`). |
| `bootstrap.ps1`: `HEAD ... is not the manifest commit` | An existing clone sits elsewhere. Commit or stash your work, then rerun with `-Checkout`. |
| `bootstrap.ps1`: `fetch-<repo>` fails | The commit is not on the origin (KI-04). In the monorepo bootstrap never fetches. |
| `bootstrap.ps1`: `contractor monorepo: pass -Root ...` | Pass the monorepo folder itself (`C:\ces-nb`) as `-Root`. |
| `bootstrap.ps1`: `the monorepo folder was exported from ..., not the manifest commit` | `SOURCES.json` and the pinned manifest disagree: this monorepo was built for another release. Clone the one BHD linked. |
| `npm ci` "not in sync" | A stale lockfile (KI-03). |
| `REFUSE port <n> is held by pid <p>` (smoke, e2e) | Another process owns the port. Stop it yourself if it is yours; the scripts never kill processes. |
| "could not find a part of the path" | The path is over 260 characters (KI-08). Use a short root. |
| A step exits non-zero but its output file is complete | Node 24 abort on exit (KI-09). |
| Stamper gets 401 resolving the initial password from muster-api | The JWT expired, or `-TenantId` does not match the operator that compiled the plan (KI-02). Rerun `Set-MusterSecretsToken.ps1`. |
| A Stamper task is NOT_SAT with `evidence_not_shown` | Its evidence read returned nothing. That is the rule (an empty read is not evidence), not a crash; check that the tenant really has the object. |
| A leaver flow never completes | Nobody confirmed. Read the link from `GET /api/leaver/outbox` (simulator) and check `adminRecipients`; with none on record the request is recorded undeliverable and the flow escalates. |
| A server refuses to start: "module secrets ... unprotect failed" | The store was made for another account or machine. Regenerate it (Secrets rotation, step 1 with `-Force`). |
| E7 fails with "needs E1's start in steps.json" | Rerun `mx-e2e.ps1` from E1. |
| One stacksim determinism test fails in the unit gate | KI-07. Rerun. |
| A Stamper Jest file exits 1 with every test passed | KI-20 (EPERM in teardown on Windows). |
| verify check V10 fails ("written outside the workspace") | A process wrote to `C:\CES_Pipeline`, `%USERPROFILE%\.ces`, `%USERPROFILE%\.stamper` or `%LOCALAPPDATA%\CES` during the run. Find it in `<Root>\out\outside-*.json`; usually a server started by hand without `CES_PIPELINE_ROOT` / `CES_TENANT_ROOT`. |

## Legend
- **H1**: the handoff agent that refreshed this file. **PH-n**: a BHD fix wave. **A-22**: the AdminOps leaver op (`ces-ao/src/registry`). **NOT_SAT**: Stamper's "not satisfied" verdict. **PS.L2-3.9.2[b]**: a CMMC Level 2 assessment objective (personnel security). **CMMC**: Cybersecurity Maturity Model Certification.
- **AO / EO / EC**: AdminOps (`ces-ao`, governed change commands), EvidenceOps (`ces-eo`, evidence, assessment and SSP), Evidence Collector (`ces-ec`, evidence uploads). **Stamper** (`ces-stamper`): the configuration executor. **Muster** (`ces-muster`): data collection and plan writing.
- **DP-1 / DP-2**: the two cost-gate confirmations, defined in `ces-ao/src/execution/CostGate.ts` (above, "Operating rules").
- **E-step (E1, E2, ...)**: a step of `<PKG>\scripts\mx-e2e.ps1`. **V10**: a verify check in `<PKG>\scripts\verify.mjs`.
- **KI-nn**: a known issue in `KNOWN-ISSUES.md`.
- **WAL**: SQLite write-ahead log. **WORM**: write once, read many. **DPAPI**: Windows Data Protection API. **gMSA**: group managed service account. **JWT**: JSON Web Token. **SSP**: system security plan.
- **GCC High**: Microsoft 365 Government Community Cloud High.
