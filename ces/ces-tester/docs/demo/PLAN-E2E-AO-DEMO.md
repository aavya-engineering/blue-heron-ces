# Plan: End-to-End CES Demo with AO Beat (GP-DEMO-3)

**Date:** 2026-08-29 (rev 2 — founder ruling applied; rev 2.1 — FD-5 ruled, plan FULLY APPROVED)
**Status:** **APPROVED — EXECUTE.** FD-1 / FD-3 / FD-4 stand as recommended; **FD-2 OVERRULED**
and replaced by the all-Playwright mandate below. **FD-5 RULED (founder, 2026-08-29):**
(a) ces-tester owns the Microsoft.Graph rollup shim (`assets/psmodules-shim/Microsoft.Graph/`,
APPENDED to PSModulePath — never `enableStacksimMode`'s wholesale replacement);
(b) sim cert enters the founder's store via the Stamper GUI's own `POST /api/prereqs/import-cert`,
Playwright-driven — **[M0 CORRECTION: that route kills its own PowerShell child in ~24 ms
(REQ-STAMPER-PREREQ-ROUTES-KILL-OWN-CHILD, HIGH); M0 used FD-5's stated fallback (i), a
ces-tester-side import. The driver still tries the GUI path first so the ruled path resumes
when the sibling bug is fixed. Cert `2F916D65470F7E8DD5B8ABB2860757E0A21F2323`
(`CN=ces-tester-sim`) is installed until demo close.]**; (c) ports: Stamper GUI :3000, AO GUI :3001. Citations live in the companion
`docs/demo/E2E-GROUNDING-EVIDENCE.md`.
**Branch:** `gp-demo-3` (new, off `gp-demo-1`)
**Home:** `ces-tester` (write boundary: this repo only)
**Not to be confused with** root `PLAN.md` (foundational, line-referenced, untouched).

> **Founder ruling, 2026-08-29:** *"stamper has a ui. go find it. and i want eo and ao driven
> same way. figure it out. i want playwright to drive it all."* Playwright drives **all four**
> legs from the user's perspective — Muster wizard, Stamper GUI, EO SPA, AO GUI. The CLI is
> permitted **only** for invisible setup/arming steps outside the demo frame, **never** as the
> demo surface for a beat. A leg may be demoted only by proving it undrivable server-side,
> with file:line evidence, and marking it **BLOCKED-NEEDS-FOUNDER** — never by silent fallback.

## Acronym legend

| Term | Meaning |
|---|---|
| **AO** | AdminOps — `../ces-ao`, the admin-operations console (95-command registry) |
| **EO** | Evidence Ops — `../ces-eo`, live assessment + SSP/POA&M generation |
| **T1–T5** | The 5 ground-truth tenant configs in `docs/demo/EVAL-CONFIGS.md` (`eval-bare`, `eval-identity-first`, `eval-half-configured`, `eval-mostly-hardened`, `eval-decoys`) |
| **P1–P9, N1–N2** | The 11 discovery probes per eval config (P = positive, N = negative control) |
| **DISCOVERY-1** | Muster's presence-based posture executor, driven by `mu discovery --sim` |
| **SPRS** | Supplier Performance Risk System score (one-SPRS rule: Muster owns the headline) |
| **CA** | Conditional Access (policy) |
| **MFA** | Multifactor Authentication |
| **REQ** | Requirement doc filed in `docs/requirements/` against a sibling — never a sibling patch |
| **HIL** | Human-in-the-loop (founder review gate) |
| **SoD** | Separation of Duties — AO's `sodTier` field; Tier 3 = two-person approval |
| **A-18** | AO command "Default User Permission Lockdown" (Tier 2, get-then-set, **zero params**) |
| **A-02** | AO command "User Offboarding — Disable" (Tier 2, get-then-set, 1 param) — runner-up |
| **WORM** | Write-Once-Read-Many — `adminops_evidence` is append-only; re-`put` on an id throws |
| **Beat 0–5** | Demo narrative beats; Beats 0–4 exist today, Beat 5 (AO) is new |

## Objective

Extend the existing ces-tester demo harness with (a) an **AO beat** proving admin-op
evidence is auto-collected, (b) a **single e2e entry point with a config parameter**,
(c) a **`--watch` visibility toggle** (headless default), and (d) a **reusable PROMPT
artifact** — then execute it live once, successfully, with evidence retained.

## Context summary

**This is an extension, not a rebuild.** Already built and passing: `demo:run` Beats 0–4
(`demo-command.ts:189`); `demo:eval` T1–T5 read-gate, **5/5 PASS** (`b352dd4`); the Muster
Playwright driver, false-fail partitioning, preflight, reset, unified dashboard.

**True delta:** AO beat, e2e entry + config param, watch mode, PROMPT artifact, and
Playwright drivers for the three legs not yet UI-driven (Stamper GUI, EO SPA, AO GUI).

### Grounded findings

All findings are verified from source (path + line) and live in the companion appendix
**`docs/demo/E2E-GROUNDING-EVIDENCE.md`** — split out to keep this plan readable. The plan
references them as "finding #N". The load-bearing ones, in one line each:

- **#1** EO has a real Playwright-drivable SPA on :4002 (verdict reversed from "unverified").
- **#2** AO evidence lands in SQLite `{CES_PIPELINE_ROOT}/ces.db`, **not** the file path its
  own docstring claims; the returned `evidencePath` is a locator string.
- **#3/#8** The AO GUI executes through the same governed engine as the CLI and **can**
  perform a live write (client-controlled `dryRun` + a Live-Execution toggle).
- **#4** A-18 is the AO command: Tier 2, zero parameters, sim `set` PASS with a ledger mutate.
- **#5** A live AO write fails closed on a missing cert file (relative `sim/<slug>.pfx`).
- **#6** Evidence rows are written on *every* path including dry-run, and persistence
  failure is silently swallowed — a green run does not prove collection.
- **#6b** **AO does not capture real pre/post state today** — both reads pass `dryRun=true`,
  so the captured state is a stub string even on a live apply. Shapes what the beat may claim.
- **#7** Sim mode is three inherited env vars — the mechanism that makes the all-GUI
  mandate work without any in-frame CLI.
- **#9-#11** Watch-mode plumbing already reaches `chromium.launch`; `better-sqlite3` and
  `ces-shared` resolve via the hoisted `node_modules`; tenant state persists across serve
  restarts, so AO can take its own serve window.

## Constraints (hard)

- **Write boundary: `ces-tester` only.** stacksim / muster / stamper / eo / ao / tenant are
  consumed over existing CLI/HTTP surfaces as-is. Any sibling gap → a REQ doc in
  `docs/requirements/`. If the demo cannot work without a sibling write →
  **BLOCKED-NEEDS-FOUNDER**, do not plan the write.
- Windows PowerShell 5.1 (`powershell.exe`) for every Stamper spawn.
- Gates: `npx tsc --noEmit` clean + `npm test` clean before every commit.
- No pushes without founder say-so. Small green slices on a feature branch.
- Honesty rules carry forward: never fabricate an "after"; never show a regression.

---

## Founder-decision items — RULED 2026-08-29

### FD-1 — "Executes successfully" vs Stamper's non-determinism — **APPROVED**
Stamper's execute is `partial` under load (`REQ-STAMPER-ROTATING-VERIFY-FAIL`); iteration 5
measured +8 and −10 on identical runs, so "successfully" is defined *before* the run:
scope the Stamper beat to the proven `demo-dib-small` MFA remediation (`IA.L2-3.5.3`);
success = EO-after live, no regression, every failed task confined to `KNOWN_FALSE_FAILS`
(`partitionFailures().unexpected` empty). Residual failures printed on screen, never hidden.
*(Rejected: requiring `executeStatus === 'complete'` — unreachable until GP-STAMPER-1 lands;
dropping the beat — it is the demo's payoff.)*

### FD-2 — SUPERSEDED BY FOUNDER RULING: Playwright drives all four legs

The earlier "Playwright-where-UI-exists" recommendation is withdrawn. I went and found the
Stamper GUI as directed. **Per-leg verdict — all four legs are DRIVABLE; nothing is BLOCKED:**

| Beat | Leg | Surface | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Muster wizard | :5173 SPA | **DRIVABLE — already proven** | `drive-muster.ts` ships today |
| 2 | **Stamper GUI** | `stamper gui --port <n>` (default 3000), `GuiServer.start` | **DRIVABLE — but needs the FD-5 workaround** | `ces-stamper/src/cli/index.ts:455-476` |
| 3 | EO SPA | :4002, `EO_PORT` | **DRIVABLE** | `EoServer.ts:268-271`; `#connectBtn`, `#assessBtn` |
| 5 | AO GUI | `ao gui --port <n>` (default 3000) | **DRIVABLE** | `ces-ao/src/cli/index.ts:15-22` |

**Why Stamper's GUI can express the whole remediation run** (the item most at risk):
- `POST /api/translate` accepts `{ missionPlan, manifest, output, tenant, … }` where the
  first two are **filesystem paths** read server-side
  (`src/server/routes/translate.routes.ts:53-65,98,126`). ces-tester hands it the paths the
  Muster wizard just produced — no upload plumbing needed.
- `GET /api/execute` is a **Server-Sent Events stream** (`execute.routes.ts:155`) taking
  `?tenant=<slug>&dryRun=<bool>`. `isDevMode = !tenant || tenant === 'dev' ||
  dryRunParam === 'true'` (`:206`) — so a real slug with `dryRun=false` performs a **live,
  ledger-recorded execute**. Note the query default is `'false'` (`:192`), i.e. live.
- Tenant config resolves through `resolveTenantJsonPath(tenant)` (`:218-220`) — the same
  registry record ces-tester already creates via `createEphemeralSimTenant`.
- SSE `connection_log` events (`:244-260`) give Playwright a real completion signal instead
  of a sleep.

Extra Stamper facts that shape the driver: the Translate card starts `.card-locked`
(`public/index.html:4433`, CSS `:318-321` = `pointer-events:none`) and unlocks only on an
Assess run — so **Assess becomes a real, visible demo beat**, not a workaround. The Translate
button has **no id** (`:4460` → `button[onclick="doTranslate()"]`). **[M0 CORRECTION]**
Execute defaults do NOT mean a live run: the GUI force-sets the target to `dryrun` on the
initial `dev` selection and never restores it (first M0 attempt: "Complete" in 0.7 s, zero
mutations; REQ-STAMPER-GUI-EXEC-TARGET-STICKY-DRYRUN). M4 must
`selectOption('#execTargetSelect','tenant')` **and assert it stuck**.
Completion = `#cardStatus4` reads `Complete` on the terminal SSE `{type:'done'}`
(`:9123`; `execute.routes.ts:2473`). `/api/execute` is **single-flight** (`:167-171`), so the
driver must never reload mid-run. `auto` mode raises no approval gates.

**Why the GUI legs reach tenant-stacksim** (finding #7): sim mode is three inherited env
vars, set before the server starts and inherited by every PowerShell child (neither spawn
site passes an `env` option). ces-tester spawns each GUI server with `mergeSimLaunchEnv(...)`
already applied. This is invisible setup, not a demo surface — squarely inside the founder's
carve-out. **No in-frame CLI remains.**

`stamper gui` does also expose its own `--stacksim [url]` flag (`cli/index.ts:454-477`), which
would normally be the sanctioned arming path. **We cannot use it here:** it calls
`enableStacksimMode`, which *replaces* `PSModulePath` wholesale
(`ces-tenant/src/impl/stacksim.ts:144-145`), clobbering the shim directory FD-5 requires.
Env-only arming it is.

**Residual GUI-specific hazards, designed around rather than demoted:**
- **AO driver ordering is mandatory** — `openCommandForm()` resets state every time
  (`public/index.html:1024-1026`: `liveToggle.checked=false; liveTenant.value='dev';`). So:
  open the A-18 form **first** → click `#liveExecToggle` (its `onchange` un-hides the tenant
  box) → **then** fill `#liveTenantInput` with the sim slug and assert it → `#executeBtn`.
  Filling the tenant first is silently wiped. Skipping the toggle silently dry-runs — and
  with the toggle off the front-end hardcodes tenant `'dev'` (`:1193`), so a GUI dry-run
  against the sim is structurally impossible; the sim leg *must* be the live one.
- The DOM renders only 4 fields — not `commandExecuted`, `evidencePath`, or the hashes. Take
  those from `page.waitForResponse('/api/execute/A-18')` (still the browser's own traffic,
  not a CLI fallback) plus the `ces.db` row. Assert `#resultStatusBadge` = `SUCCESS` and
  `#evidenceOutcomeBadge` = `automated_success`; **do not** anchor on `#resultOutput`, which
  reads `No output available` on an empty-stdout PATCH.
- `CES_AO_AUTH_TOKEN` must be **unset** so loopback is trusted without a header
  (`AoServer.ts:99`); `AoServer.start` also calls `open()`, popping a real browser window
  beside Playwright's — harmless, but expect it under `--watch`.
- The cert-file gate (finding #5) applies to the GUI path too (`GetThenSetExecutor` reuses
  the same auth chain), so the placeholder `sim/<slug>.pfx` must sit relative to the **GUI
  server's** cwd, not ces-tester's.
- AO's evidence panel has two rendering bugs (finding #8) → the demo asserts on fields that
  do render and on the `ces.db` row; REQs filed regardless.
- **Port collision:** both GUIs default to **3000**. Assign **Stamper GUI 3000** (already in
  `DEMO_PORTS`) and **AO GUI 3001**; both accept `--port`. The founder said AO on 3000 —
  since the demo is strictly serial they *could* share it, but a lingering Stamper server
  would then block AO, so separate ports are the safer call. **Flagging, not deciding.**

### FD-3 — AO beat shape — **APPROVED**
**A-18 executed live through the AO GUI** — Tier 2 (no approval flow), **zero parameters**,
templates confirmed, and stacksim's own coverage report shows `set` PASS with a ledger
mutate. Narrative: "lock down default user permissions — nobody but an admin creates apps or
tenants; the evidence collects itself." Proof = AO evidence row in `ces.db` with
`stateChanged:true` + a resolved `commandExecuted` + a `sha256Hash`, AND a stacksim ledger
mutation in AO's window (**not** pre/post-state, which are stubs — finding #6b). *(Runner-up A-02 "User Offboarding — Disable": warmer story, but its `{upn}`
must match a seeded user. Rejected for now: a Tier-3 two-person approval showcase — strong
governance story, but a 2-step flow through an undriven code path in a demo that must succeed
on the first run; revisit in a later iteration.)*

### FD-4 — "Different configurations per run" for the FULL chain — **APPROVED**
Tension I surfaced: Stamper's remediation is proven only on `demo-dib-small` (the wizard
answer map targets its MFA gap); T1–T5 are discovery-gate configs on their own slugs with
no Stamper path. Ruling: config registry = `demo-dib-small` (full chain, default) + T1–T5
(selectable; read-gate and AO beats run, Stamper beat reported `n/a — no proven remediation
path for this config`, never silently skipped). Gap: `demo-dib-small` has no
`expected_discovery` ground truth → **M2 calibrates one** via the GP-DEMO-2 attempt-3
live-adjudication pattern (that took 4 attempts; budgeted).
*(Rejected: full chain on any T-config with a relaxed Stamper predicate — unproven, and
risks failing the one live run.)*

---

### FD-5 — NEW, NEEDS A RULING: Stamper's GUI Connect gate blocks Execute under stacksim

Chasing the all-Playwright mandate surfaced a genuine blocker on the Stamper leg. It is
**client-side, and it has a clean ces-tester-side fix** — so per your ruling I am designing
around it rather than demoting the leg, but the fix needs your call.

**The chain:** `executeFromMatrix()` refuses unless `tenantConnectionState === 'connected'`
(`public/index.html:7703-7708`, repeated `:7739-7742`). That state is set only when
`/api/connect` reaches `phase:'done'` with zero error rows (`:6384-6397`). `/api/connect`
first runs a prerequisite check and bails with `prereq_blocked` — **no `done`** — if a
required module is missing (`connect.routes.ts:130-144`). `Microsoft.Graph` is
`required: true` (`ces-shared/src/prereq/PrerequisiteChecker.ts:30-37`) and the check runs
through the **shadowed** `PSModulePath`. **I verified directly: `tenant-stacksim/psmodules/`
ships `Microsoft.Graph.Applications`, `.Authentication`, `.Users` … but no bare
`Microsoft.Graph` rollup.** Every other required module resolves. So Connect fails → Execute
is unclickable.

- **Option A:** add a stub `Microsoft.Graph` manifest to `tenant-stacksim/psmodules/`.
  Smallest change and it fits the existing shim convention — but it is a **SIBLING WRITE**,
  which the write boundary forbids. Would ship as a REQ for the founder to apply, not by me.
- **Option B (RECOMMEND):** ces-tester owns a stub module directory
  (`assets/psmodules-shim/Microsoft.Graph/Microsoft.Graph.psd1`) and **appends** it to
  `PSModulePath` in the arming env. Entirely inside our boundary, no sibling edit, and it
  keeps the sim's own shim set authoritative. Requires env-only arming (above).
- **Rejected:** `page.evaluate(() => tenantConnectionState = 'connected')`. Server-side
  nothing objects, but it is exactly the not-as-a-user bypass the mandate forbids.

**Second, separable requirement — a real certificate.** Connect also runs
`Get-ChildItem Cert:\CurrentUser\My\<thumbprint>` (`PrerequisiteChecker.ts:156-172`), so the
sim record's placeholder `SIMTHUMBPRINT…` can never match, and `StamperConfig` additionally
requires all four auth fields with a cert file that exists (`StamperConfig.ts:114-133`) —
tenant-JSON values **override** env, so ces-tester's synthetic-`.env` trick does not transfer
to the GUI. The demo therefore needs a self-signed sim cert generated and imported into
`Cert:\CurrentUser\My`, and a sim tenant record authored with an **absolute** `cert_path`.
That touches your machine's certificate store, so I am flagging rather than assuming:
**(i)** a ces-tester setup script does it, or **(ii)** drive the GUI's own
`POST /api/prereqs/import-cert` (`connect.routes.ts:257-291`) — GUI-native, fits the mandate.
I recommend **(ii)** with **(i)** as fallback.

## Milestones

| # | Milestone | Size | Depends on |
|---|---|---|---|
| **M0** | **Drivability spike — now the biggest de-risking step (founder-directed).** Prove each GUI, by hand, in a headed browser, and capture the selectors: (a) tenant state survives a serve stop/start; (b) **the FD-5 blocker clears** — with the ces-tester `Microsoft.Graph` shim appended to `PSModulePath` and a real imported sim cert, `/api/connect` reaches `phase:'done'` with zero error rows, then `stamper gui` performs assess → translate → live execute and streams SSE to `{type:'done'}`; (c) `ao gui` spawned the same way, with the Live-Execution toggle on and the sim slug typed over `dev`, performs a real write; (d) the **cert placeholder** (finding #5) relative to each GUI's cwd gets past `AuthChain`; (e) the resulting `adminops_evidence` row has `stateChanged:true` and the stacksim ledger shows the mutation. Output: a selector inventory feeding M3–M5. Throwaway scripts, no committed code. **Gate: any leg that fails after workarounds → STOP, mark BLOCKED-NEEDS-FOUNDER with file:line, file a REQ. Never silently fall back to CLI.** | **L** | FD-1/3/4 |
| **M1** | `src/demo/watch-mode.ts` + `--watch` threaded to `drive-muster.ts:132` (add `slowMo`) and `needle-run.ts`. Headless stays default. | S | — |
| **M2** | `src/demo/e2e-configs.ts` — config registry (FD-4 Option A) + calibrate `demo-dib-small` ground truth from a live discovery read. | M | M0 |
| **M3** | `src/demo/gui-servers.ts` — spawn/stop helpers for the Stamper and AO GUI servers with `mergeSimLaunchEnv` + run-scoped `CES_PIPELINE_ROOT` + cert placeholder + correct cwd; plus `src/demo/ao-leg.ts` + `src/demo/ao-evidence.ts` (evidence-row snapshot/diff, ledger delta). Artifact-judged, never exit-code-judged. | M | M0 |
| **M4** | The three new Playwright drivers — `src/demo/stamper-ui-driver.ts` (translate → live execute → SSE completion), `src/demo/eo-ui-driver.ts` (connect → assess), `src/demo/ao-ui-driver.ts` (slug override → Live-Execution toggle → A-18 → execute). Shared browser/watch options. **The Playwright drive is the user-perspective layer, never the data source:** structured numbers still come from each module's API/SSE exactly as `runEoLeg` does today — never DOM-scraped. All run headless by default, headed under `--watch`. | **L** | M0, M1, M3 |
| **M5** | `src/demo/e2e-run.ts` + `demo:e2e` CLI — Beats 0–5, config param, watch flag, success predicate, evidence to `runs/e2e/<runId>/`. | M | M1–M4 |
| **M6** | `docs/demo/PROMPT-E2E-AO-DEMO.md` — the reusable prompt artifact. | S | M5 |
| **M7** | **The live run.** One successful `demo:e2e` on a quiet box, all four legs Playwright-driven; evidence retained; iteration log updated. | M | M5, M6 |

## File Inventory

| File | Action | Detail |
|---|---|---|
| `src/demo/watch-mode.ts` | CREATE | `resolveWatchMode(argv) → { headless, slowMo }`; `--watch` ⇒ `{headless:false, slowMo:250}` |
| `src/demo/e2e-configs.ts` | CREATE | `E2E_CONFIGS` registry: id, slug, `fullChain: boolean`, `expectedDiscovery`, `aoCommand` |
| `assets/psmodules-shim/Microsoft.Graph/Microsoft.Graph.psd1` | CREATE | FD-5 Option B — stub rollup manifest appended to `PSModulePath` so Stamper's Connect prereq passes under stacksim |
| `src/demo/sim-tenant-record.ts` | CREATE | author the `kind:'sim'` registry record with all four auth fields and an **absolute** `cert_path` (tenant JSON overrides env — `StamperConfig.ts:249-252`) |
| `src/demo/stamper-prereqs.ts` | CREATE | generate/import the self-signed sim cert, preferring the GUI-native `POST /api/prereqs/import-cert` |
| `src/demo/gui-servers.ts` | CREATE | spawn/stop `stamper gui --port 3000` and `ao gui --port 3001` with `mergeSimLaunchEnv`, run-scoped `CES_PIPELINE_ROOT`, cert placeholder, module-root cwd; readiness probe per server |
| `src/demo/stamper-ui-driver.ts` | CREATE | Playwright: `#tenantSelect` → `#gateAllowBtn` (Connect) → fill `#configMissionPlanPath` + `#configManifestPath` → `#btnAssess` (unlocks Card 3) → `button[onclick="doTranslate()"]` → `#btnExecuteMatrix` → await `#cardStatus4` = `Complete`; read reports from `#resultsContent .report-links a` |
| `src/demo/ao-ui-driver.ts` | CREATE | Playwright: type sim slug over the `dev` default **and assert it**, flip "Live Execution (dryRun: OFF)", select A-18, EXECUTE, read the panel fields that render correctly |
| `src/demo/ao-leg.ts` | CREATE | `runAoLeg(opts): AoLegResult` — orchestrates GUI server + `ao-ui-driver` + evidence/ledger assertions; self-gating like `eo-leg.ts` |
| `src/demo/ao-evidence.ts` | CREATE | `readAoEvidence(dbPath, tenantId)` — better-sqlite3 read of `adminops_evidence` scoped by `tenantId`, newest by `created_at`; pure parse/assert split out for unit test |
| `docs/requirements/REQ-AO-GUI-EVIDENCE-PANEL-FIELD-MISMATCH.md` | CREATE | GUI reads `evidence.verdict` (nonexistent) and compares `outcome` to `'SAT'` (never equal) — finding #8 |
| `docs/requirements/REQ-AO-SIM-CERT-PATH-UNRESOLVABLE.md` | CREATE | sim records carry a relative `cert_path` to a file that does not exist; `--apply` fails closed — finding #5 |
| `docs/requirements/REQ-STACKSIM-NO-MICROSOFT-GRAPH-ROLLUP-SHIM.md` | CREATE | FD-5: no bare `Microsoft.Graph` module under `psmodules/`, so Stamper's Connect prereq fails under stacksim |
| `docs/requirements/REQ-AO-GETTHENSET-PRESTATE-IS-STUB.md` | CREATE | **highest-value finding**: pre/post-state reads pass `dryRun=true`, so captured state is a stub string even on a live apply — finding #6b |
| `src/demo/eo-ui-driver.ts` | CREATE | Playwright: `#tenantConnectSelect` → `#connectBtn` → `#assessBtn`, await `#assessStatus`; `cwd: eoRoot` |
| `src/demo/e2e-run.ts` | CREATE | `runE2eDemo()` — Beats 0–5 orchestration + success predicate |
| `src/muster-driver/drive-muster.ts` | MODIFY | L132 `chromium.launch({ headless, slowMo })`; add `slowMo?` to `DriveMusterOptions` (L39-47) |
| `src/demo/needle-run.ts` | MODIFY | L62 + L232 — accept/thread `WatchMode` instead of bare `headless` |
| `src/cli/demo-command.ts` | MODIFY | `demoModules()` L62-69 add `ces-ao` + `ces-eo` + `ces-muster`; `DEMO_PORTS` L55-60 add `{name:'ao-gui',port:3001}`; add `runDemoE2eCommand` |
| `src/cli/index.ts` | MODIFY | L29 usage string; L343 add `case 'demo:e2e'` |
| `src/demo/scenario-registry.ts` | MODIFY | add `'e2e'` to `DemoScenarioId` (L9) + `DEMO_SCENARIOS` (L16) |
| `src/results/unified-dashboard.ts` | MODIFY | Beat 5 (AO) row + AO evidence entries in `evidence[]` |
| `tests/demo-ao-leg.test.ts` | CREATE | pure parse/predicate tests, no spawns |
| `tests/demo-ao-evidence.test.ts` | CREATE | evidence-row shape + pre-state presence |
| `tests/demo-watch-mode.test.ts` | CREATE | argv → `{headless, slowMo}` |
| `tests/demo-e2e-configs.test.ts` | CREATE | registry validity, `fullChain` flags |
| `tests/demo-e2e-run.test.ts` | CREATE | success-predicate truth table (injected deps) |
| `docs/demo/PROMPT-E2E-AO-DEMO.md` | CREATE | the reusable prompt artifact (M6) |
| `docs/requirements/REQ-AO-EVIDENCE-PATH-DOCSTRING-STALE.md` | CREATE | finding #2 above |
| `package.json` | MODIFY | add `better-sqlite3` (+ `@types/better-sqlite3`) |
| `docs/demo/DEMO-ITERATION-LOG.md` | MODIFY | GP-DEMO-3 section after the live run |

## Success predicate (WRITE THIS DOWN BEFORE THE RUN — FD-1 Option A)

`demo:e2e --config demo-dib-small` returns 0 **iff all of**:

1. Preflight OK — all builds fresh (incl. `ces-ao`), all 5 ports free.
2. Seed OK — tenant materialized, serve ready on :4390.
3. **Ground truth** — discovery diff PASS: every probe's `derived_posture` matches
   `expectedDiscovery`; `readOnly === true` (ledger delta 0 during the walk).
4. **Muster wizard** — mission plan + tenant manifest artifacts produced.
5. **Stamper** — execute ran; `partitionFailures(failedTaskIds).unexpected.length === 0`;
   ledger snapshot written. **[M0 FLAG — cannot pass as written on the GUI leg:** live GUI
   execute failed 30/110 vs 10/110 (= exactly KNOWN_FALSE_FAILS) on prior CLI runs of the
   byte-identical plan; the ~20 extras are `Unresolved manifest/runtime variables` errors
   `partitionFailures` cannot map to a task id. **M2 opens with the 30-vs-10 reconciliation;
   this predicate line is written only after root cause is isolated.]**
6. **EO** — before and after both live (`liveAssessmentCount > 0`);
   `controlsMet(after) >= controlsMet(before)` (no regression).
7. **AO** — in the run-scoped `ces.db`, the `adminops_evidence` row count **increased** in
   AO's window, and the newest row scoped by **`tenant_id`** (`sim-tenant-<slug>`;
   `tenant_slug` is NULL — M0 correction) carries, at **`data.evidence.metadata.*`** (NOT
   `data.metadata.*` — M0 correction), `stateChanged === true`, a resolved
   `commandExecuted`, and a `sha256Hash`; **and** the stacksim ledger shows ≥ 1 entry with
   `type === 'mutate'` inside AO's window (the ledger records reads too — raw length deltas
   are contaminated; filter `type==='mutate'` in every ledger assertion).
   **Do NOT assert on `preStateOutput`/`postStateOutput` — they are stubs (finding #6b), and
   the beat must not narrate pre-state capture.** All of the above are required together: a
   dry-run also writes a row, and persistence failure is silently swallowed (finding #6).
8. Unified dashboard rendered with Beat 5 present.
9. Gates: `npx tsc --noEmit` and `npm test` clean.

**Stipulated:** quiet box (no parallel agents/builds/suites — the iteration-5 regression was
load-induced). Any item failing → honest partial + reason on screen, exit non-zero. **Never
fabricate; never show a regression.**

## Risks

| Risk | Mitigation |
|---|---|
| **FD-5 unresolved ⇒ the Stamper GUI leg cannot run at all** | M0(b) is the gate; Option B keeps the fix inside ces-tester. If it fails, mark BLOCKED-NEEDS-FOUNDER — do not bypass the gate in JS |
| `stamper gui --stacksim` looks like the right arming path but clobbers the shim | Use env-only arming (`mergeSimLaunchEnv` + shim append); never combine the two |
| Stamper GUI needs a real cert in `Cert:\CurrentUser\My` | FD-5 second item — founder picks GUI-native import vs setup script |
| Both GUIs default to :3000 | Stamper 3000, AO `--port 3001`; add to `DEMO_PORTS` |
| Every GUI leg is unproven end-to-end from ces-tester | **M0 is the gate** — spike all four first; STOP + REQ on failure, never build on an assumption |
| `CES_PIPELINE_ROOT` default `C:\CES_Pipeline` is shared global state | Point it at a run-scoped dir per run; never assert against the global DB |
| **`--apply` fails closed on the missing sim `.pfx`** (finding #5) | Run-scoped cwd + placeholder `sim/<slug>.pfx`; **M0 gate (b)**. File the REQ regardless |
| A green AO run does not prove evidence landed (finding #6) | Predicate 7 asserts row-count delta + `stateChanged` + ledger — never the exit code |
| **Narrating "pre-state evidence" would be false** (finding #6b) | Beat says "evidence of the change was auto-collected"; talk track must not claim pre-state. REQ filed |
| Chosen AO command mutates `authorizationPolicy`, which is discovery probe P8 | AO runs last (Beat 5), after the discovery gate and EO-after — no cross-contamination. Keep that ordering |
| `better-sqlite3` is a native module | Already hoisted in `ces/node_modules`; verify import in M0 |
| GUI servers spawned outside their module root serve 404s | Always spawn with `cwd` = that module's root |
| EO env fragility (`PSModulePath` shadowing) | Reuse `buildEoChildEnv` (`eo-leg.ts:74-104`) verbatim — do not re-derive |
| `demo-dib-small` ground-truth calibration may take several attempts | Budgeted as its own milestone (M2); GP-DEMO-2 needed 4 |
| Stamper partial execute on the day | FD-1 Option A predicate; quiet-box stipulation in the PROMPT artifact |

## Out of scope

- **Any write to a sibling repo.** Findings become REQ docs here.
- Making Stamper's execute deterministic — that is GP-STAMPER-1's.
- DISCOVERY-2 / state-parsing (`REQ-MUSTER-DISCOVERY-STATE-BLINDNESS` stands).
- Tier-3 two-person approval flow (deferred by the FD-3 ruling).
- `TALK-TRACK*.md` narrative rewrites and the pending talk-track HIL.
- Pushing to any remote.
- Touching root `PLAN.md`.

## Acceptance criteria

- [ ] **FD-5 ruled on** (Stamper Connect-gate shim + cert), before any M1 work.
- [ ] M0 drivability spike passes for all four GUIs, or the failing leg is marked
      BLOCKED-NEEDS-FOUNDER with file:line and a REQ is filed.
- [ ] `demo:e2e [--config <id>] [--watch]` exists; headless is the default.
- [ ] **All four legs are Playwright-driven**; no beat's demo surface is a CLI.
- [ ] `--watch` visibly opens all four UIs in sequence.
- [ ] AO beat proves auto-collection: evidence row with pre- and post-state, `stateChanged`,
      **and** a stacksim ledger mutation.
- [ ] `docs/demo/PROMPT-E2E-AO-DEMO.md` runs the whole scenario from a cold start.
- [ ] **One successful live run**, evidence retained under `runs/e2e/<runId>/`.
- [ ] `npx tsc --noEmit` + `npm test` clean.
- [ ] `DEMO-ITERATION-LOG.md` updated with the real result — including anything that failed.

---
Rev 2 — founder ruling applied. FD-1/FD-3/FD-4 approved as written; FD-2 replaced by the
all-Playwright mandate; **FD-5 raised and awaiting a ruling**. Evidence appendix:
`docs/demo/E2E-GROUNDING-EVIDENCE.md`. Branch `gp-demo-3`, starting with M0.
