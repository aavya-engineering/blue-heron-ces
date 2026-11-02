# What's new in this handoff (2026-11-01)

This handoff replaces the per-module repositories and the Muster run package sent in October. Everything now comes in this one repository, at one set of commits recorded in `SOURCES.json`.

## How you receive CES
- **One private monorepo** (`ces-contractor`) instead of six repositories. The modules sit as plain folders under `ces\` (see `START-HERE.md`), and the run package sits under `pkg\ces-muster-run\`.
- **A refreshed handoff kit** in `handoff\`:
  - **`GUIDE.md`** (new): the step-by-step human guide;
  - **`SCENARIO-STEPS.md`** (new): what one end-to-end run does, step by step;
  - **`PUNCH-LIST.md`** (new): every open item, with an owner and a priority;
  - **the reference files**, all brought up to date: the manifest (pinned commits), `config.schema.yaml` (7 new settings), `secrets.inventory.yaml`, `contracts.yaml`, `RUNBOOK.md`, `ACCEPTANCE.md` (now the four-scenario proof round, with the V1-V131 checks) and `KNOWN-ISSUES.md`.
- **All test data is fictional.** The customer is "Example Defense Co" (`edcgov.example`) and every tenant id is a fixed fake.

## What CES does now that it did not in October
- **Stamper depth: registry breadth across all 14 CMMC families.**
  - About 30 new configuring entries, plus many re-aimed or newly tagged ones.
  - Uncovered assessment objectives fell from 140 to 3.
  - Every new entry has a simulator test that sets the value and reads it back.
  - Recurring-cost Azure items stay cost-gated and off by default.
- **An empty read is never evidence.**
  - A read that succeeds but returns nothing is now "not met" (`evidence_not_shown`), on both the CLI and the GUI.
  - Reads whose honest answer can be zero now print an explicit count.
  - Reads that looked for the wrong object were fixed.
- **Leaver flow** (CMMC PS.L2-3.9.2), approve first, then act:
  - AdminOps detects a leaver and emails the tenant admins a single-use confirm link.
  - On confirm it runs the new op A-22: disable the account, revoke sessions, remove groups, licences and MFA.
  - It sends a done notice. A BHD copy goes only if the customer opts in.
  - If nobody confirms, it escalates.
  - On the simulator the mail goes to a simulated outbox.
- **Access review:** a quarterly review of the CUI group. Unanswered reviews default to Deny and are applied automatically.
- **Audit-failure alerting** (AU.L2-3.3.4): a verified alert policy now configures and proves it. A placeholder recipient never counts.
- **AdminOps:**
  - every operation either applies on the simulator or is explained;
  - a hollow "applied" result now fails closed;
  - the simulator now refuses a null target, instead of creating a fake object.
- **EvidenceOps:**
  - adding Stamper's evidence to the record no longer stalls the server (worst case 12 s → under 1 s);
  - rejected uploads return clear errors;
  - manual-gate records are marked in the explorer.
- **Muster:** the readiness-file import is proven, with refusal checks, and an AI-off check is added.
- **Watched screen runs:** four root causes fixed: Playwright version, a sign-in setting, the comparison score, and a contrast failure. The EO and Muster screen runs now get further, but are not yet equal to their twins (punch list).

## Where it stands
- **Proof rounds:** the latest finished round (R-F10) and the round testing this exact code (R-F11, results in `PUNCH-LIST.md` "R-F11 results") are both in `PUNCH-LIST.md`.
- **The build kit itself is being tested now from a fresh clone.** Fixes will come as commits to this repository. Watch it for updates.
- **Open work** is in `PUNCH-LIST.md`. Start with the P1 rows marked "contractor".

## Legend
- **CMMC**: the DoD Cybersecurity Maturity Model Certification. Level 2 has 110 practices and 320 assessment objectives.
- **CUI**: Controlled Unclassified Information.
- **A-22**: AdminOps' leaver operation.
- **R-F10 / R-F11**: BHD proof rounds. Each runs the four simulated customers end to end.
- **P1**: punch-list priority "blocks correctness or acceptance".
- **Twin**: the headless API run a watched screen run must match.
