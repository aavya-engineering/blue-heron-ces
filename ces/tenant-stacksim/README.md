# tenant-stacksim

CES Tenant Stack Simulator — a fake Microsoft GCC High tenant that lets **real,
unmodified** CES code run against it: Stamper stamping baselines, AO executing
commands, EO collecting evidence, and Muster harvesting tenant state. Every object
created/mutated/served is logged to an append-only ledger and held for later query.

**Status:** G-STACKSIM-1 (simulator), G-STACKSIM-2 (real-command coverage), and
G-STACKSIM-3 (partial-config scenarios + Graph REST facade) are complete.
Coverage: **503/523 real Stamper/EO/AO commands PASS, 0 FAIL** (20 excluded =
manual-only registry entries with no command to run).

Standalone repo (GitHub: `founder/ces-stacksim`). The directory must stay
physically inside `ces/` — the coverage harness and integration tests resolve the
sibling `ces-stamper` / `ces-eo` / `ces-ao` / `ces-muster` projects by relative path.

## Setup

```
npm install
npm run build        # bin/stacksim.mjs runs dist/, NOT src/ — rebuild after every src change
npm test
```

## Quick launch

```
npm run stacksim     # build + seed (first run only) + serve m365_azure on :4390
```

Wraps `stacksim up [profile] [--slug s] [--port n]`: seeds the tenant **only if it
doesn't exist yet** (scenario-built or mutated state survives relaunches), then serves
it and prints the endpoint map. Ctrl+C to stop.

Windows PowerShell 5.1 is assumed (the fake modules and coverage harness target it).

### Shared G5 / AdminOps tenant (the one other CES modules test against)

SIMFIX 2026-09-27: `profiles/m365-azure.json` now carries the **gcc-high-g5 seed set**
(`src/seed/sets/gccHighG5.ts`) - a Microsoft 365 G5 (GCC High) tenant with every object and
field AdminOps' 95 commands read or change, plus a deliberate gap for each detect-type command.
The tenant object (`buildSimTenantConfig`, stance `m365_azure`) carries a value for every AO
registry `source` (`docs/coverage/AO-SOURCE-TO-TENANT-KEY.md`). Start it fresh on the usual port:

```
npm run build
node bin/stacksim.mjs scenario aoops-g5                              # wipe + rebuild (the reset)
node bin/stacksim.mjs serve m365_azure --slug aoops-g5 --port 4390   # leave running
```

Gotcha: `stacksim up` / `serve` NEVER reseed an existing `.stacksim/tenants/<slug>` - a tenant
seeded before this change keeps the old (pre-G5) state. Rebuild with `scenario aoops-g5` (or
delete the old tenant folder and `up` again).

Semantic self-certification of all 95 AO commands (needs Windows PowerShell 5.1):
`npm run coverage:ao` -> `coverage/ao-semantic-report.json`, `docs/coverage/AO-SEMANTIC-COVERAGE.md`.

Fidelity rules worth knowing (SIMFIX FIX-S1): a cmdlet/URI that names its target (`-UserId`,
`-GroupId`, `-ManagedDeviceId`, `-Identity`, Az `-Name`, `/users/{id|upn}`) acts on exactly that
object or returns 404 - never a default object; `-ErrorAction` is honored by the shims.

### Demo tenant (sales / walkthrough)

```
npm run demo         # build + seed "Ridgeline Fabrication" (fictional 13-seat DIB shop) + serve on :4390
npm run demo:reset   # wipe + rebuild the demo tenant to pristine state (deterministic)
```

A realistic small-DIB-contractor tenant with deliberate findable gaps (MFA
stuck in report-only, an unencrypted shared shop-floor kiosk, a shared login
account) so a live Muster→Stamper→EO walkthrough looks like a real engagement.
To change the demo (staff, company, gap toggles) edit
`scenarios/demo-dib-small.config.json` and run `npm run demo:build` — never
edit the generated scenario directly (a drift-guard test enforces this).
Story, demo arc, and the full editing guide: `docs/demo/DEMO-PROFILE-STORY.md`.

## CLI

All commands: `node bin/stacksim.mjs <command>`. Profiles: `m365_only` |
`m365_sentinel` | `m365_azure` (JSON in `profiles/`). Tenant state lives in
`.stacksim/tenants/<slug>/` (`store.json`, `ledger.jsonl`, `evidence/`).

| Command | What it does |
|---|---|
| `init-tenant <profile> [--slug s] [--port n] [--emit-plan-data] [--plan-data-root dir] [--tenantprobe-flat]` | **Deprecated for orchestrated use** (G-TENANT-M4 resolution 2026-07-11): a standalone-dev convenience only — orchestrated runs register sim tenants through ces-tester (ces-tenant registry, `kind:'sim'`). Writes the tenant config real tools consume; `--plan-data-root ../ces-stamper` registers the sim in Stamper's tenant picker. backlog-S3: the flat `~/.stamper/tenants/` write (TenantProbe compat) is **opt-in** via `--tenantprobe-flat` — the real Stamper config dir is never touched by default, and opt-in callers own deleting their file per run. |
| `seed <profile> [--slug s]` | Seeds the deliberately **pre-Stamper** baseline state (~38 collections, deterministic ids `<singular>-1..n`). |
| `serve <profile> [--slug s] [--port n]` | Starts the single-writer HTTP server (default port 4390) — the process every client talks to. |
| `up [profile] [--slug s] [--port n]` | One-command launch: seed-if-missing + serve (`npm run stacksim` = build + `up`). Never re-seeds existing state. |
| `scenario <name> [--slug s] [--scenarios-dir d]` | Builds a named **partially-configured** tenant from `scenarios/<name>.json` (wipes + reseeds + replays mutation steps through the real resolver, ledger-recorded). Serve it afterwards. |
| `query-ledger [--type create\|mutate\|read-serve] [--id] [--actor] [--from] [--to]` | Query the ledger over HTTP. |
| `query-evidence [--object-type] [--from] [--to]` | Query held evidence snapshots. |
| `verify-doc [--slug s]` | The M6 DOC gate: runs real Stamper/EO/AO code paths end-to-end. |
| `inventory` | Re-extracts every distinct call from the real ces-stamper/ces-eo/ces-ao source into `coverage/inventory.json`. |
| `coverage` | Full coverage run: replays the entire inventory against a fresh tenant, writes `coverage/coverage-report.json`. The regression gate for any resolver/codegen change. |
| `coverage-ao` | (`npm run coverage:ao`) Semantic self-certification: every AO command's get/set/get on a fresh m365_azure tenant, judged against `coverage/ao-semantic-expectations.json`. |

## HTTP surface (`stacksim serve`)

- `POST /resolve` — the fake PowerShell modules' protocol (`{kind:'cmdlet'|'uri', ...}`).
- `POST /ledger`, `POST /evidence` — JSON-filter queries.
- `GET|POST|PATCH|DELETE /v1.0/*` and `/beta/*` — **Graph REST facade**: real Graph
  REST clients (e.g. Muster's harvest) point their base URL at
  `http://127.0.0.1:4390/v1.0` and get OData-shaped responses (`{value:[...]}`).
- `POST /{tenantId}/oauth2/v2.0/token` — **fake OAuth endpoint** (login.microsoftonline.us
  path shape). Accepts any grant/credential, returns a deterministic sim token.
  Nothing validates it — it exists so real token-acquisition *code paths* run, not to
  test authentication.
- `GET /` — **the inspector**: a self-contained, read-only live view (auto-refresh
  2.5s) of the served tenant — stance banner, ledger tape (recent events as colored
  ticks: create/mutate/read-serve), collection counts, ledger tail, armed fault rules.
  Observability only; it can mutate nothing. JSON behind it: `GET /_inspector/data`.
- `POST /_faults` — **deterministic fault injection** (backlog-S5). Body: array of
  `{target, kind, times?}` rules (`[]` clears). `target` = exact cmdlet name or URI
  path prefix; `kind` = `throttle` (429 + Retry-After) | `transient` (503) |
  `malformed` (200 with an unparseable body); `times` = fault the first N matching
  calls then pass through (default 1; `"always"` never passes). Rules also load at
  serve startup from `<tenantRoot>/faults.json`, which a scenario's `faultInjection`
  block writes — so a fault scenario is fully declared in one JSON file. Never random.

## PowerShell shadowing

`psmodules/` holds generated fakes of the real module names (Az.\*,
Microsoft.Graph.\*, ExchangeOnlineManagement, MicrosoftTeams, ...). Their cmdlets
POST to `/resolve`; the target comes from `$env:STACKSIM_SERVER_URL` (default
`http://127.0.0.1:4390`). `azshim/` shadows the real `az` CLI via PATH prepend.

Regenerate after codegen changes: `node dist/src/codegen/generatePsModule.js psmodules`.

Shadow recipe (what the coverage harness and Stamper's `--stacksim` mode both do):

```powershell
$env:PSModulePath = "<stacksim>\psmodules;$PSHOME\Modules"   # replace, don't append
$env:Path = "<stacksim>\azshim;$env:Path"                     # prepend
$env:STACKSIM_SERVER_URL = "http://127.0.0.1:4390"
```

## Using with Stamper

```
node bin/stacksim.mjs init-tenant m365_azure --plan-data-root ../ces-stamper
node bin/stacksim.mjs seed m365_azure
node bin/stacksim.mjs serve m365_azure          # leave running
# in ces-stamper:
npx tsx src/cli/index.ts gui --stacksim         # pick "sim-m365-azure" in the GUI
```

All **six** session types connect under `--stacksim`: graph, azure, exchange, purview,
teams, sharepoint — the full sign-in → connect → execute → disconnect lifecycle runs
on Stamper's real SessionManager (backlog-S4; verified by
`tests/integration/backlog-s4-full-lifecycle.test.ts`). SharePoint works because
Stamper's connect now passes `-CertificateThumbprint` (the SPO module does the
cert-store lookup internally), so the sim never touches a real certificate store.

## Using with Muster (state detection)

Scenarios freeze a tenant in a named partial-config state with a ground-truth answer
key. Shipped set (`scenarios/muster-*.json`): `muster-bare`, `muster-partial`,
`muster-configured`, `muster-mfa-disabled`, `muster-mfa-report-only`.

Scenario JSON shape:

```json
{
  "name": "...", "description": "...", "stance": "m365_azure",
  "countOverrides": { "managedDevices": 0 },
  "steps": [{ "kind": "uri", "method": "PATCH", "uri": "/v1.0/...", "body": {} }],
  "expectedFacts": { "iam-001": "no", "ep-001": "yes" }
}
```

`tests/integration/muster-harvest.test.ts` auto-globs `scenarios/muster-*.json` and,
per scenario, runs Muster's real `consentService.exchangeCode` (token via the sim's
OAuth endpoint) + `runHarvest` against the served tenant, asserting the harvested
facts match `expectedFacts`. Adding a scenario file adds a test case. When Muster
gains a probe: add a URI resolver entry if the path is new, a scenario knob, and an
`expectedFacts` row.

## What it deliberately is NOT

- **Not a security test environment** — tokens are fake and unvalidated everywhere;
  no OIDC discovery, no cert crypto.
- **No OData query semantics** — every GET returns the full collection; `$filter`,
  `$top`, and paging are ignored.
- **No network/error fidelity** — no throttling, no 429s, no latency.
- Unregistered Graph URIs 404 loudly rather than fabricating data.

## More

- `docs/goals/` — goal documents; `PLAN.md` — the original G-STACKSIM-1 milestone ladder.
- `docs/context/IMPLEMENTATION_LOG.md`, `LOOP_STATE.md` — build history per iteration.
- `session-tenant-stacksim-*.md` — day-by-day session logs (decisions, gotchas, why).
