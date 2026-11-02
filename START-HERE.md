# Start here: the CES contractor repository

This repository holds everything needed to build, run and prove **CES**, the BHD compliance engine: it takes a small defense contractor's Microsoft 365 GCC High tenant to CMMC Level 2 (the DoD's Cybersecurity Maturity Model Certification) by asking the customer questions, planning and applying the tenant configuration, running governed admin operations, collecting evidence and writing the assessor's documents. You build and prove it first against a **simulator** with four fictional customers; a real tenant comes later.

Cut 2026-11-01, after BHD's last fix wave (PH-13). Each folder's source commit is in `SOURCES.json`. What is new since October: **`handoff\WHAT-CHANGED.md`**.

> **Status of these instructions (2026-11-01):** the code is proven by BHD's proof rounds. BHD is now testing these build-kit steps from a fresh clone of this repository. Fixes arrive as commits here, so pull before you start and check `handoff\KNOWN-ISSUES.md` (KI-17).

## What you have

| Folder | What it is |
|---|---|
| `ces\ces-muster` (+ `muster-api`) | **Muster**: collects the customer's data (questions, interviews, tenant discovery, CUI boundary) and writes the plan. |
| `ces\ces-stamper` | **Stamper**: applies the plan to the tenant, command by command, with evidence per objective. |
| `ces\ces-ao` | **AdminOps**: about 98 governed admin operations (joiners, movers, leavers, devices), including the confirm-first leaver flow. |
| `ces\ces-eo`, `ces\ces-ec` | **EvidenceOps** and the **Evidence Collector**: evidence on a schedule and by upload, the assessment, SSP, POA&M and SPRS score. |
| `ces\tenant-stacksim` | **The simulator**: a fake GCC High tenant with four fictional customers (S1, S2, S3, mp). |
| `ces\ces-tester` | **The tester**: drives a whole scenario end to end, including the watched UI runs. |
| `ces\ces-shared`, `ces\ces-tenant` | shared types, contracts, the SQLite store `ces.db`, secrets helpers, UI kit; the tenant registry and PowerShell sessions |
| `pkg\ces-muster-run` | **the harness**: one scenario end to end (`mx-e2e.ps1`), the unit gate (`run-tests.ps1`), the verify checks (V1 to V131), stored baselines |
| `handoff\` | **the kit**: guide, runbook, acceptance, known issues, punch list, manifest, settings and secrets schemas, bootstrap and verify scripts |

## The first hour

Windows 10/11 or Server with Windows PowerShell 5.1, Node.js **24.12.0**, npm 11.6.2 and git 2.52+ (exact list: `handoff\handoff.manifest.yaml`).

**Clone to `C:\ces-nb`, exactly.** Some test and harness files still hard-code `C:\ces-nb` (the list is KNOWN-ISSUES KI-13; making them configurable is PUNCH-LIST PL-114). Until that lands, the clone must be at `C:\ces-nb`. `bootstrap.ps1` and `check.mjs` work at any short root (`-Root`), but the UI end-to-end tests and some harness scripts do not.

```powershell
git clone -c core.autocrlf=false -c core.longpaths=true <link BHD sent you> C:\ces-nb
git -C C:\ces-nb ls-files --eol | Select-String 'i/lf\s+w/crlf'     # must print nothing (line endings as committed, KI-21)
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\bootstrap.ps1 -Root C:\ces-nb
cd C:\ces-nb\ces; npx playwright install chromium; cd ces-muster; npx playwright install chromium
node C:\ces-nb\pkg\ces-muster-run\scripts\handoff\check.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\handoff\verify\smoke.ps1 -Root C:\ces-nb
```
The two `-c` options must be on the `git clone` line itself: Git for Windows installs with `core.autocrlf=true`, and setting it after the clone does not rewrite the files already checked out. **Already cloned without them?** If the check line prints anything, either delete the folder and clone again with the line above, or, if you have no local changes (this discards them), fix it in place:
```powershell
cd C:\ces-nb; git config core.autocrlf false; git config core.longpaths true; git rm -r -q --cached .; git reset -q --hard HEAD
```
then run the check line again. `bootstrap.ps1` is safe to rerun at any time; a rerun reinstalls and rebuilds.

Then run one scenario end to end (about 30 minutes; a browser window opens for the watched UI steps):
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\ces-nb\pkg\ces-muster-run\scripts\mx-e2e.ps1 -Root C:\ces-nb -Harness tester -Scenario s1-mach
```
and read `C:\ces-nb\out\verify.json`, `summary.json`, `ssp.docx` and `GAPS-s1-mach.md`.

Use `handoff\bootstrap.ps1` only. The older `pkg\ces-muster-run\bootstrap.ps1`, `pins.json` and `POSTGRES-SETUP.md` are superseded (KNOWN-ISSUES KI-10).

## Read next

0. **`handoff\SCENARIO-STEPS.md`**: what one end-to-end run does, step by step, for the three main scenarios.
1. **`handoff\GUIDE.md`**: the full guide: modules, rules, prerequisites, configuration, build, running each module, one scenario, results, unit gate, first day, and moving to a real GCC High tenant.
2. **`handoff\PUNCH-LIST.md`**: every open item with owner and priority; start with its P1 rows.
3. **`handoff\KNOWN-ISSUES.md`**: problems you will meet and their workarounds.
4. **`handoff\ACCEPTANCE.md`**: when the work is done: the four-scenario proof round (`handoff\verify\round.ps1`), the V-check list, the sign-off.
5. **`handoff\RUNBOOK.md`**: day-to-day operation: servers, logs, `ces.db` backup, the leaver flow, secrets rotation, common failures.

## Rules that never bend

- Simulator first; no live tenant until BHD says so.
- No AI on live tenants. Two-person approval is off by default. Any recurring Azure cost is off by default and needs two confirmations (DP-1 opt-in, DP-2 typed).
- The HELD items stay held: Global Administrator (`AC.L2-3.1.2.role-assign`), the Teams Administrator grant, SharePoint `Sites.FullControl.All`.
- An empty read is not evidence. Any score change is predicted before it is run.
- No secret value and no personal identity in any file; fixtures stay fictional. You create your own secrets (`handoff\secrets.inventory.yaml`); BHD shares access, never values.

## Legend
- **BHD**: Blue Heron Defense, the owner of CES. **PH-13**: BHD's last fix wave before this handoff.
- **CMMC**: Cybersecurity Maturity Model Certification. **GCC High**: Microsoft 365 Government Community Cloud High. **CUI**: Controlled Unclassified Information. **DoD**: Department of Defense.
- **SSP**: system security plan. **POA&M**: plan of action and milestones. **SPRS**: the DoD Supplier Performance Risk System score.
- **S1 / S2 / S3 / mp**: the simulator's fictional customers `s1-mach`, `s2-eng`, `s3-def`, `muster-partial`. **V1 to V131**: the verify checks (listed in ACCEPTANCE.md). **KI-nn**: a known issue (`handoff\KNOWN-ISSUES.md`). **PL-nnn**: a punch-list row (`handoff\PUNCH-LIST.md`). **DP-1 / DP-2**: the two cost-gate confirmations.
- **LF / CRLF**: Unix / Windows line endings. `core.autocrlf` is the git setting that converts between them on checkout; CES needs it off.
