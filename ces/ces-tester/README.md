# ces-tester

CES cross-tool test orchestrator: drives Muster's real wizard UI (Playwright), invokes
Stamper's real CLI (`--stacksim` mode), and consumes tenant-stacksim over its existing
CLI/HTTP interface to run declarative JSON scenarios end-to-end (seed → Muster → Stamper →
verify), with a static HTML results dashboard.

**Windows-only.** Every Stamper invocation runs under Windows PowerShell 5.1
(`powershell.exe`), never pwsh. Any future CI must use a Windows runner.

- Plan: `PLAN.md` (milestone ladder M0–M5; M6/M7 deferred lanes)
- Goal: `docs/goals/G-TESTER-1.md` (DOC, Gate Ledger, Run Protocol)
- External gates: S1/S2 block M1, S3 blocks M2 — tracked in `../tenant-stacksim/BACKLOG.md`
- Boundary: tenant-stacksim is a standalone sibling entity — consumed via its CLI/HTTP
  interface only, never imported or modified from here.

## Layout (target, per PLAN.md)

```
src/cli | runner | stacksim-client | muster-driver | stamper-launcher | verifier | results
scenarios/*.json   (ces-tester-owned wrapper format embedding a stacksim seed block)
runs/<run-id>/     (generated, gitignored)
dashboard/         (static, self-contained HTML)
```

## Muster end to end: `muster-e2e` (and the `run-m2` shim)

`run-m2` is a **canned-answer shim**: it builds the Mission Plan from fixed answers with Muster's
generator, never runs discovery or muster-api, and its PASS checks MFA only. Do not read it as
"Muster to Stamper works". The real path is the `muster-e2e` scenario type:

```
node bin/ces-tester.mjs run-scenario scenarios/muster/muster-partial-e2e.json --root <WS> --package-root <run package> [--skip-forced-run] [--skip-ao] [--dry-run]
node bin/ces-tester.mjs coverage:ao [--stacksim-root <dir>] [--out <file>]
```

It reseeds and serves stacksim `muster-partial`, runs `mu discovery --sim`, the headless runner,
the push through muster-api, Stamper translate + execute, the EC upload, EO connect + assess +
SSP/POA&M, the tester's comparison (readiness facts, post-Stamper state, sim ledger), the
bundle, the forced run and stacksim `coverage-ao`. It writes the run package's `<WS>/out` layout
plus `out/tester-run.json` and `out/coverage-ao.json`; `--dry-run` prints the steps and writes
nothing. `scenarios/muster/` has its own schema (`schemas/muster-e2e.schema.json`) and is not part
of `run-all`.

## Command Center

A localhost-only web UI for browsing the unified catalog, launching runs, and managing
runnables.

```
node bin/ces-tester.mjs center          # starts on http://127.0.0.1:4600
node bin/ces-tester.mjs center --port 5000
```

**Views:**
- **Catalog** — every scenario, deck, act, and pipeline with summary, modes, modules,
  and last-run status. Filter by kind, mode, or status. Click a row for full detail
  including recent runs, cross-links (acts↔decks), and CLI commands.
- **Runs** — run history from `runs/index.jsonl`, filterable by status. View logs,
  delete/restore run output.
- **Coverage** — acts not in any deck, acts with no test file, last-status-by-kind
  breakdown.

**Launching:** Select a runnable and mode, confirm in the modal, and the Center spawns the
existing CLI command as a child process. Only one run at a time (409 if busy). The active
run bar shows status, a Stop button kills the process tree, and log lines stream via SSE.

**Safety model:** localhost-only (127.0.0.1, no 0.0.0.0). Origin check rejects requests
from other origins. Delete operations archive to `.trash/` and can be restored. Retire
marks a runnable hidden-by-default without deleting anything.

**CLI catalog commands:**
```
node bin/ces-tester.mjs catalog              # list all runnables
node bin/ces-tester.mjs catalog --json       # JSON output
node bin/ces-tester.mjs catalog:check        # validate catalog integrity
node bin/ces-tester.mjs runs:backfill        # import historical runs/ dirs
```

## Dev

```
npm install
npm run build
npm test
```

Smoke test (requires Playwright browsers installed):
```
SMOKE=1 npx vitest run tests/center-smoke.test.ts
```
