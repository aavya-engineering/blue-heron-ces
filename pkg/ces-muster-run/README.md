# Muster run on the simulator (MX package)

Blue Heron Defense, CES team. Revision 2026-10-24.

This package makes Muster run end to end on the CES simulator, headless, from fresh clones at pinned commits:

**sim discovery → Mission Plan + Tenant Manifest (+ Infrastructure Manifest) → Stamper translate and execute on the sim → EO assessment → SSP (JSON and DOCX) and POA&M.**

Your repositories are not changed. `bootstrap.ps1` clones them at the pins in `pins.json`, copies in one new file (`overlay/`), applies three small patches (`patches/`), builds, runs the unit gate, runs the end-to-end flow, and checks the result (`verify.json`). We ran it ourselves on fresh folders until it passed twice; the evidence is in `expected-outputs/`.

This package supplements the 10-21 muster-shift package (`muster-shift/`). It does not replace it. The muster-shift backlog (MG-01 to MG-28) is still the parity work list; this package closes the items needed to run, and updates their status in `GAP-ANALYSIS.md` section 4.

## Reading order

1. **`BRING-MUSTER-CURRENT.md`**: the runbook. Start here. It narrates exactly what the scripts run, step by step, with the expected output and exit criterion for each, and a troubleshooting table.
2. **`TESTER-STACKSIM-GUIDE.md`**: what ces-tester and ces-stacksim do, and how to build and use them (corrected against what actually runs).
3. **`GAP-ANALYSIS.md`**: Muster vs Planner, from the code, and the status of each backlog item after this run.
4. **`POSTGRES-SETUP.md`**: the full UI path with a database. Not needed for this run, and not executed by us.

## Quick start (Windows)

```powershell
# Windows PowerShell 5.1, Node 20+, git with access to the blue-heron-defense-CES org.
# Use a SHORT root: Windows PowerShell 5.1 cannot open paths longer than 260 characters.
powershell -ExecutionPolicy Bypass -File bootstrap.ps1 -Root C:\mx
# Done when it prints "DONE: all checks pass" and C:\mx\out\verify.json has "pass": true.
```

On macOS or Linux, `bash bootstrap.sh --root ~/mx` runs everything up to and including the unit gate. The end-to-end run needs Windows PowerShell 5.1, because Stamper and the simulator's fake PowerShell modules run under `powershell.exe`.

## What "known to work" means

- Two fresh-folder runs of `bootstrap.ps1` passed all eleven checks (V1 to V11). One attempt between them stopped on a network error while cloning, before anything ran.
- **Stamper is PARTIAL by design of today's code:** 110 tasks, 87 completed, 23 failed on the sim. Every failed task is listed by name in `expected-outputs/summary.json` and in the runbook. A run passes when it stays within 2 tasks of that baseline. The failures are follow-up work.
- **Readiness numbers are provisional.** Discovery's "met" still means "the read returned output" (backlog item MG-02, deferred). Treat every readiness count in this run as provisional until MG-02 lands.
- The SSP is produced by EO after Stamper runs, so it describes the sim as implemented.

## Files

| File | Contents |
|---|---|
| `BRING-MUSTER-CURRENT.md` | Runbook: steps E1 to E9, checks V1 to V11, troubleshooting, Track A / Track B |
| `TESTER-STACKSIM-GUIDE.md` | ces-tester and ces-stacksim: purpose, layout, builds, commands, pitfalls, stale docs |
| `GAP-ANALYSIS.md` | Muster vs Planner gap analysis, trimmed; backlog status after this run |
| `POSTGRES-SETUP.md` | Database setup for the SPA "Send to Stamper" path (not executed by us) |
| `bootstrap.ps1` / `bootstrap.sh` | One-command setup (see the runbook, section 2) |
| `pins.json` | Pinned commits, patch list, overlay list |
| `known-failures.json` | The 4 contractor unit tests that fail at the pins (K1 to K3), used by the unit gate |
| `overlay/ces-muster/scripts/mx/plan-from-discovery.ts` | The headless discovery-to-plan runner (new file, copied in) |
| `patches/mx-01..03-*.diff` | Three ces-muster patches (`git diff` output; apply with `git apply`) |
| `scripts/mx-e2e.ps1` | The end-to-end run, steps E1 to E9, for `-Scenario <slug>` (any scenario the simulator has; default `muster-partial`). With `-Harness tester`, ces-tester runs E1 to E8F (`run-scenario --scenario <slug>` = `scenarios/muster/<slug>-e2e.json`) and writes `out/tester-run.json` and `out/coverage-ao.json`, which verify checks as V23 and V26. Synthetic-customer W2: E7B (one more EO assess, `out/eo-assess-7b.json`) runs under both harnesses and E8 builds from it; E6X (S3 re-injection) and E7A (AdminOps, `out/adminops-e7a.json`) run under `-Harness tester` only |
| `scripts/verify.ps1` + `verify.mjs` | Checks V1 to V49, V54 and V58 (V45 to V48: AdminOps evidence rows, write windows, E7B drift, no forced-run revert); writes `out/verify.json` and `out/summary.json`. The baseline is `expected-outputs/<slug>/summary.json` (`scripts/expected-outputs.mjs`) |
| `scripts/v49-scope.mjs` | V49 (identity scan of a synthetic customer): the scanned roots and tokens for one slug |
| `scripts/overrides-gate.mjs` | E6 (W1): all twelve operator keys in the pushed TM `tenant_identity` = "overrides: not needed" (the overrides file is not read); any missing = E6 fails with the list, unless `MX_ALLOW_OVERRIDES=1` (transition aid; never `initialPassword`). Log `out/logs/E6-overrides.json`. `initialPassword` is minted per run into the Stamper environment (`STAMPER_INITIAL_PASSWORD`) |
| `sim-overrides.json`, `customers/<slug>/sim-overrides.json` | DEPRECATED (W1): read only by the transition aid above; to be deleted |
| `scripts/check-answers.mjs` | Checks `customers/<slug>/interview-answers.json`: schema, register ids, provenance, identity |
| `customers/<slug>/` | A synthetic (fictional) customer: `customer.json` (organisation and roster), `interview-answers.json` (the interview answers), `org-content.json` (organisation content) |
| `scripts/run-tests.ps1` / `.sh` + `run-tests.mjs` | The unit gate |
| `scripts/mx-helpers.mjs` | Sim tenant registration and launch env, SSE reader, plan push, ledger snapshot |
| `scripts/mint-token.mjs` | Mints a muster-api bearer token (no database needed) |
| `scripts/bundle.mjs` | Phase 3 evidence bundle: the twelve items into `out/runs/<run-id>/evidence/raw` and a path-rewritten, re-hashed, identity-scanned `shared` copy, each with `manifest.json` |
| `scripts/identity-scan.ps1` | Identity and local-path scan (also inside DOCX/ZIP); extra tokens from `<WS>\nb-tools\scan-tokens.txt` |
| `scripts/capture-evidence.ps1` | Retired: now calls `bundle.mjs` (and copies the shared bundle to `-Dest`) |
| `expected-outputs/` | Per scenario: `expected-outputs/<slug>/{summary.json, verify.json, hashes.json, bundle/, proof-runs/}`; `muster-partial` keeps its files at the folder root. Our evidence: `summary.json` (the baseline), the last green run's verify results, steps, unit gate, Stamper report, logs, SHA-256 hashes, the TM and IM, and both green runs' `verify.json`. The MP, SSP and POA&M ship as hashes and summaries only; your run regenerates them |

## Legend

| Code | Meaning |
|---|---|
| MX | This run and package |
| MP / TM / IM | Mission Plan / Tenant Manifest / Infrastructure Manifest |
| SI Baseline / TCP | Strategic Intent Baseline / Tenant Config Profile |
| SSP / POA&M | System Security Plan / Plan of Action and Milestones |
| EO | ces-eo (EvidenceOps), which produces the SSP |
| E1–E9 | End-to-end steps (runbook section 3) |
| V1–V11 | Verify checks (runbook section 4); V12–V44 later checks; V49 / V58 = synthetic-customer identity scan / fictional banner |
| S1 / `s1-mach` | Synthetic customer 1, a fictional machining subcontractor |
| K1–K5 | Known contractor-repo defects (runbook section 6) |
| N-01–N-07 | Run-enabling gaps (`GAP-ANALYSIS.md` section 3) |
| MG-nn | Items in the muster-shift backlog (`muster-shift/01-GAP-BACKLOG.md`) |
| `<WS>` | Your workspace root (the `-Root` you passed) |
| sim | ces-stacksim, the simulated Microsoft 365 GCC High tenant |
