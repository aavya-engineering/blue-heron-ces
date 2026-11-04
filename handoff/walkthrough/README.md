# CES Demo Commander: Muster to EvidenceOps, one button per step

One web page, the **Demo Commander**, that walks you through every screen action of one complete CES flow on the simulated tenant (no real Microsoft tenant, no Azure), in 23 steps. Each step has a button. When you press it, Playwright drives the real module screen in one of four browser windows (Muster, Stamper, AdminOps, EvidenceOps) that stay open side by side, and the page shows the step's purpose, what it does, why it matters, and links to what it produced.

You set the pace. Nothing runs until you press a step's button (or **Next step**). One step runs at a time. The page never moves on by itself.

## Before you start

This builds on the earlier handoff. Your clone at `C:\ces-nb` must be:

1. at commit "Update 3: the Demo Commander" or later (`git pull --ff-only`, GUIDE section 6.5);
2. bootstrapped (`handoffootstrap.ps1`), with `node C:\ces-nb\pkg\ces-muster-run\scripts\handoff\check.mjs` exiting 0;
3. able to run the one-command harness on the simulator (GUIDE section 8, `mx-e2e.ps1`).

If any of these is not done yet, do it first, in that order.

## Quick start (one machine, the tested path)

1. **Free the kit ports.** Stop your own CES modules and the harness first (the Demo Commander and the harness share ports; run one at a time). A module left running is "attached" and used as it is, and a Stamper started with a token fails Health.
2. **Start:** `powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\walkthrough\Start-Mine.ps1`. This launcher starts every module from the built clone `C:\ces-nb\ces` on its kit port with the settings the walkthrough needs (simulator only), seeds a Muster operator, writes `config.local.json` (gitignored), then starts the page on port 4600 and opens `http://127.0.0.1:4600/`. `-NoOpen` skips the browser; `-Keep` keeps the last run's data.
3. **Run:** when the **Health** panel is all green, press **Prepare simstack**, then **Next step** for each step. The steps take about 15 minutes in total; with reading, plan for 30 to 45 minutes.
4. **Stop:** press **Stop modules** on the page (header, right of Next step), or run `powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\walkthrough\Stop-Mine.ps1`. Either one stops the page and only the modules the launcher started, newest first; `Stop-Mine.ps1 -Status` shows each port (free, ours, someone else's).

**Window layout.** Prepare places the four module windows in the left four fifths of the screen and leaves the right fifth for the page. Window places come from `pane.windows` in `config.mine.json`; when it is absent the launcher measures the screen. On a small screen, set `pane.windows` by hand.

**Network.** The page listens on every interface, like the CES modules. Pass `--host 127.0.0.1` to `server.mjs` to keep it on this machine; Windows may show a firewall prompt for `node.exe` (allow private networks only).

**Known limits.**

- Step 13, "Add a user (AdminOps)", shows **not yet drivable**: the add-user operation needs the license and base group from the tenant record, and no screen writes the pushed Tenant Manifest's values there yet. The page shows how to do it by hand; it is on the PUNCH-LIST, and next phase we will plan that screen with you.
- The EvidenceOps operator token the launcher writes lasts one hour. Past that, press Stop modules, run Start-Mine.ps1 again, and start from Prepare.
- Prepare installs a throwaway simulator certificate in your user certificate store.

**If something fails, send us:** a screenshot of the Health panel, `runs\<run id>\walkthrough-pass.json`, the failed step's folder under `runs\<run id>\steps\`, the console output, your commit id, OS and shape (blank any tokens).

## Two shapes

The page runs in one of two shapes, chosen by the config (the page header names the target and the shape):

- **Shape A, kit ports**: the page runs on the machine that runs the modules, on their kit ports, and shares their tenant and pipeline folders. The quick start above is shape A. To drive modules you started yourself, use `config.example.kit.json` (see "What you need" and "Set up").
- **Shape B, remote addresses**: the page runs on any machine with the built `ces-tester` and reaches the modules only over HTTP(S) at the addresses you give, path prefixes included (for example `https://<host>/muster`, `/stamper`, `/ao`, `/eo`, `/stacksim` behind one reverse proxy). `config.example.contractor.json`. See "Shape B" below. Shape B was proven against a local copy of a path-prefix layout, not yet against your host; next phase, we will run it with you there.

Code comments cite BHD design notes that are not shipped; they are not needed to run the page.

## What you need

- The CES modules running on this machine on their kit ports (handoff `README.md`, port table): simulator 4390 serving scenario `s1-mach`, muster-api 4011, Muster screens 4173, Stamper 3000, AdminOps 3001, EvidenceOps 4002, Evidence Collector 4001.
- The walkthrough must run on the same machine as the modules: it shares their tenant folder (`CES_TENANT_ROOT`) and pipeline folder (`CES_PIPELINE_ROOT`), and Stamper reads the plan files from disk.
- The built clone (`ces-tester\dist` present) and Playwright's Chromium (handoff `KNOWN-ISSUES.md` KI-24).
- Settings for the walkthrough run:
  - AdminOps and Stamper without their token variables (loopback callers need none, KI-01). The engine's AdminOps and Stamper drives send no token.
  - EvidenceOps without `CES_EO_AUTH_TOKEN`, with `CES_EO_OPERATOR_DEV_FALLBACK=1` and a `CES_EO_OPERATOR_SECRET` (simulator only, KI-15). The EvidenceOps console page the engine drives sends no token. The operator token for the access screen goes in the config.
  - muster-api with `CES_EO_URL` and `CES_EO_AUTH_TOKEN` (any value when EvidenceOps runs without a token) so the push reaches EvidenceOps, and with `MUSTER_CORS_ORIGINS` naming the Muster screens' address when it is not `http://localhost:4173`.
  - An operator account on muster-api (`npx tsx scripts/seed.ts --email <login> --password <password>` in `ces-muster\muster-api`).

## Set up

1. Copy `config.example.kit.json` to `config.local.json` and fill in the folders, the operator login, the EvidenceOps operator token, and the fictional people (from `pkg\ces-muster-run\customers\s1-mach\document-reviews.json`). `config.local.json` stays on this machine (it is in `.gitignore`); nothing in it is ever sent to the page.
2. `config.schema.json` explains every field. The server refuses to start when one is missing.
3. For modules behind one reverse proxy with a path per module, use shape B (below).

## Shape B: modules at remote addresses

```powershell
cd C:\ces-nb\handoff\walkthrough
node server.mjs --config config.example.contractor.json
```

- **What it does.** For each of Muster, Stamper, AdminOps and EvidenceOps the server opens a small forwarder on this machine (`127.0.0.1`, a port the system picks). The browser windows open each module through its forwarder, so every module sits at the root of its own address, as on the kit ports. That is what lets the consoles' `/api/...` calls, the newer screens at `/app/`, live progress (Server-Sent Events) and downloads work behind path prefixes. The forwarders send each request on to the module's real address (`urls` in the config) over HTTPS.
- **Certificates.** A self-signed host certificate goes in `tls.caFile` (a PEM file next to the config; `*.pem` is gitignored). Export it once from a browser (open the host, view its certificate, export it as Base-64 PEM to `contractor-host-cert.pem` next to the config). `tls.ignoreErrors: true` is the fallback (shown yellow). Nothing process-wide is changed.
- **The four values (Setup panel).** Shape B needs four values the module owners hold: the Stamper bearer token (`CES_STAMPER_AUTH_TOKEN`), the EvidenceOps bearer token (`CES_EO_AUTH_TOKEN`), a Muster operator login and password on your muster-api, and an EvidenceOps operator token for the access screen. When one is missing the page shows a **Setup** panel above Health with one masked field each and who owns it. Saving writes them into `config.local.json` on this machine only (gitignored) and checks health again; they are never shown back, logged, or written into any step output. If you started the server with another config file, it creates `config.local.json` from it (it refuses when one already exists: then start with `--config config.local.json`).
- **Tokens stay on this machine.** The Stamper and EvidenceOps forwarders add the bearer token to each request, and they answer only the walkthrough's own browser windows (a per-run key header), because they carry that token.
- **Per step, what it waits on.** A step that needs a value or a module that is not answering shows "Waits on" in the step list and the step text, and its button stays off. The simulator steps run as soon as the simulator answers. The flow runs in order: a later step also waits on what an earlier step waits on.
- **Outputs** come from the browser (screenshots, downloads such as the SSP and Muster exports) and from the modules' own answers saved as JSON (the Stamper execution report, the EvidenceOps assessment and SPRS). The run folder has no links into module folders.
- **Prepare simstack** in shape B only reads the simulator's answers (it writes no tenant record and links nothing). The tenant must already be registered with your modules; the readout says whether Stamper and AdminOps list it.

## Run

```powershell
cd C:\ces-nb\handoff\walkthrough
node server.mjs --config config.local.json
```

Open `http://127.0.0.1:4600/`. The server listens on every interface (like the CES modules); `--host 127.0.0.1` keeps it on this machine, `--port` changes the port.

1. Check the **Health** panel. Every required item must be green before any button works.
2. Press **Prepare simstack**. It checks the simulator serves the configured scenario, finds or writes the tenant record, links the run folder to your tenant, pipeline and storage folders, and opens the browser windows.
3. Press **Next step** (or a step's own button) for each step, in order. On the kit layout the steps run for about 15 minutes in total (measured on s1-mach); with reading time, plan for 30 to 45 minutes. Each step shows its expected time.
4. Stop with Ctrl+C in the server window, or `node scripts\stop-server.mjs`. Both close the browser windows and remove the run folder links.

Outputs of each step are under `runs\<run id>\steps\<step id>\`, linked from the page. `runs\<run id>\walkthrough-pass.json` records every step: when it started, how long it took, its status, its outputs and any error.

**Careful with clean-up:** while a server runs, `runs\<run id>\tenant-root`, `pipeline` and `storage` are links (junctions) into your module folders. The server removes them when it stops, and removes any left behind by a killed server when it starts. Never delete a `runs` folder with Windows PowerShell 5.1 `Remove-Item -Recurse` while a link is still inside it: it follows links.

## What a step can show

- **done**: the screen action finished and its outputs are linked.
- **not yet drivable**: the screen the step needs does not do it yet on this build. The page shows how to do it by hand. Next phase, we will plan the missing screen with you.
- **Findings**: a step that finished but whose result has items worth reading (for example a task the Stamper run could not apply).

## Files

| File | What it is |
|---|---|
| `server.mjs` | The page's server: health, Prepare, one route per step, the live view (MJPEG), step outputs. |
| `engine.mjs` | Loads ces-tester's compiled demo engine and runs its acts against your running modules. |
| `prepare.mjs` | Prepare simstack. |
| `steps\*.mjs` | The screen drives the engine has no act for (Muster sign-in to push, AdminOps A-01 and the newer console, EvidenceOps access to assessor view). |
| `content\steps.json` | The text for each step. |
| `public\` | The page. |
| `remote.mjs` | Shape B: the run shape, the HTTPS client (`tls.caFile`), the per-module forwarders. |
| `steps\remote.mjs` | Shape B versions of the simulator readout and the two Stamper steps (no module folder needed). |
| `scripts\fixture.mjs` | BHD's test stand-in for your running modules (kit ports, `s1-mach`). `--prefixed` adds tokens on Stamper and EvidenceOps and an HTTPS proxy that copies a path-prefix layout. You do not need it when your modules are up. |
| `scripts\stop-server.mjs` | Stops a running server cleanly. |
| `Start-Mine.ps1`, `Stop-Mine.ps1`, `scripts\mine.mjs` | The launcher: start (attach or start per port), stop (only what it started), status. Data and logs in `runs\mine\`. |
| `config.mine.json` | The launcher's profile (kit ports, headed windows, slow motion 400 ms, `s1-mach`); the launcher adds the run-only values in `config.local.json`. |
| `scripts\content-lint.mjs` | Checks the step text in `content\steps.json`. |

## Not in this walkthrough

- The leaver flow (AdminOps A-22) has no screen yet; it runs through its routes (`KNOWN-ISSUES.md` KI-18).
- The prime and subcontractor rollup board belongs to another engagement kind.
