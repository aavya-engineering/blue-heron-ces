# Phase-0 Findings — M0 Acceptance Gate Artifact

**Date:** 2026-07-10 · **Produced by:** G-TESTER-1 iteration 1 (three parallel read-only
inventory agents; full evidence in `docs/context/phase0/*.md`). Answers the 6 inventory items
from PLAN.md M0 plus the S1/S2/S3 gate status.

## Item 1 — Muster question banks: stable machine-readable IDs?
**YES.** All six banks (SIT/CUI/BTC/TCP/Policy/RRT, in **ces-planner**, not ces-muster) carry a
stable per-question `id` field with an explicit "preserve IDs" change-control rule. Examples:
`BTC.ID.001` (`ces-planner/public/data/primed BTC Question Bank.yaml:10`), `CUI.CAT.001`
(`primed CUI Boundary Question Bank.yaml:13`), `G-01` (`primed SI Question Bank.yaml:75`).
→ Answer-map keying by question ID (PLAN.md scenario schema) is viable as-is.

## Item 2 — Wizard DOM hook for Playwright?
**NO — markup addition needed (the known M0 risk).** Zero `data-question-id`/`data-testid`
attributes exist in any wizard component; only BTC renders the ID as visible text
(`BTCQuestionPage.tsx:168`). Proposed smallest change: one-line
`data-question-id={question.id}` on the question-card div in each of the six per-question page
components (SIT/BTC/CUI/TCP/Policy/RRT). Per PLAN.md "What This Plan Does NOT Do": this is a
small test-only markup change **proposed to Planner's repo**, not patched from here. **Action
required before M2.** Details: `docs/context/phase0/muster-findings.md` §2.

## Item 3 — `/api/save-to-stamper` alive?
**YES.** POST-only, dev-server-only Vite middleware (`ces-planner/vite.config.ts:250-321`,
inside `configureServer`). Payload `{artifacts:[{type,path}], targetDir}`; copies artifacts to
`<targetDir>/plans/<type>-<timestamp>.json` (default targetDir `../stamper/plan-data/vfsgov-xtra`
per `src/shared/config.ts:20`). Fallback if it ever disappears: the panel's browser-download
buttons (`/api/download-artifact` is dev-only too).

## Item 4 — Stamper `translate` → `execute` (auto) fully unattended?
**ALMOST — one stdin wrinkle.** The auto-mode task loop is prompt-free and does not depend on
the Planned stubs (`resume`/`report` are error-and-exit stubs, `ces-stamper/src/cli/index.ts:148-150,
224-226`). BUT `execute` always fires one preflight inquirer Y/n confirm with **no `--yes` flag**
(`cli/index.ts:101-108`); unattended runs must pipe a newline to stdin (defaults Y).
`translate --execute` is not a workaround — it hard-forces DRY_RUN (`cli/index.ts:338`).
Manual-gate tasks auto-approve when stdin is non-TTY (`ManualGateAdapter.ts:72-80`).
→ M1's stamper-launcher pipes stdin; optionally file a `--yes` feature request against ces-stamper.

### Item 4b — PS 5.1 provenance re-check (required by PLAN.md Tech Stack)
**CONFIRMED.** `ces-stamper/src/core/SessionManager.ts:463` reads
`const proc = spawn('powershell.exe', [` (with `-NoProfile -NonInteractive`) — same line number
as the inherited citation. Windows PowerShell 5.1, never pwsh. Provenance caveat in PLAN.md is
now independently discharged.

## Item 5 — Evidence Collector: stub vs real (recorded recommendation)
**RECOMMENDED: STUB.** The real EC does not exist in the current ces-eo checkout (no `src/ec/`,
no `start:ec` script, no `/api/stamp-capture` route; only a dist comment at `EoServer.js:1134`).
The stub contract is fully specified by Stamper's client: POST `/api/stamp-capture` + GET
`/api/health`, Bearer `EVIDENCE_OPS_SECRET`, payload/response shapes at
`ces-stamper/src/.../EvidenceOpsClient.ts:9-46,70-78`, fire-and-forget.
**Key wrinkle:** Stamper only emits stamp-captures from the GUI route
(`execute.routes.ts:2455`), never the CLI path ces-tester drives → Phase 1
`expected_evidence` assertions should source from **Stamper's local evidence + stacksim
`/evidence`**, not `capture_received`. Flagged for founder review — PLAN.md's schema example
uses `assert: "capture_received"`; M3's verifier design should honor this re-sourcing.

## Item 6 — `scenario` calling convention confirmed (not chosen)
**WORKS — no M0 blocker.** Live test (exit 0): materialized `{name, description, stance,
countOverrides, steps}` into a scratchpad tempdir, invoked
`stacksim scenario <name> --scenarios-dir <abs>`; wipe+seed+step-replay verified via `/ledger`.
Top-level `description` is **accepted** (PLAN.md's open sub-question answered).
Gotchas for M1's stacksim-client (full detail in `docs/context/phase0/stacksim-findings.md`):
1. CLI is **cwd-bound** — `profiles/` and tenant root derive from `process.cwd()`; spawn with
   cwd = stacksim repo root; tenant root lands at `<stacksim-repo>/.stacksim/tenants/<slug>`.
2. Invoke with the **bare name** — passing `foo.json` looks up `foo.json.json`.
3. Pass `--scenarios-dir` as an **absolute** path (relative resolves against cwd).
4. `steps` must PATCH seeded object IDs — arbitrary POST creates throw mid-scenario (exit 1,
   partial state).
5. `query-ledger`/`query-evidence` are HTTP-only (need running `serve`) — sequence:
   scenario → serve → query.

## External Gates S1/S2/S3 — status with evidence
Tracked in `tenant-stacksim/BACKLOG.md` (filed 2026-07-10, commit `3039ac4` there).

| Gate | Status | Evidence (2026-07-10) |
|---|---|---|
| S1 (single-writer seed/init-tenant) | **OPEN** | Direct code read: `tenant-stacksim/src/cli/commands/seed.ts:45-46` constructs ObjectStore/Ledger and writes directly; in-code comment acknowledges planned move |
| S2 (A8 plural/singular read-shape) | **OPEN** | `BACKLOG.md` S2 Status: OPEN; inventory A8 (no closure record anywhere in stacksim tracking) |
| S3 (init-tenant config isolation) | **OPEN** | `BACKLOG.md` S3 Status: OPEN; inventory A9 (TenantProbe hardcodes real `~/.stamper/tenants/`, no override) |

**Consequence (PLAN.md M0 gate rule):** M1 tasks 2–6 do **not** start until S1+S2 show CLOSED
in `tenant-stacksim/BACKLOG.md`; M2 additionally waits on S3. M1 task 1 (scaffold) executed —
not gate-blocked.

## M0 verdict
All 6 inventory items answered with citations; no M0 blocker found (item 6's escalation rule
not triggered). Actions surfaced — **founder HIL'd all four, 2026-07-10 (same day):**
1. **Planner markup — DONE.** `data-question-id` applied to all six wizard components in
   ces-planner (root-repo commit `0692c96`, tsc clean), with the convention filed as a standing
   requirement in the ces-muster repo (`DATA-QUESTION-ID-REQUIREMENT.md`, commit `28911a3`
   there) per founder direction. M2's markup precondition is closed.
2. **Stamper `--yes` flag — DECLINED.** Stdin-newline workaround only (recorded in PLAN.md M1
   task 4); revisit only if flaky.
3. **Evidence re-sourcing — ACCEPTED.** EC = stub; `expected_evidence` verifies against
   Stamper local evidence + stacksim `/evidence`; `capture_received` defers to the M7 EO lane
   (dated note added at PLAN.md's schema example).
4. **S1+S2 — being worked in another pane** (stacksim repo); this goal keeps watching
   `tenant-stacksim/BACKLOG.md` for the closure records.

**G-TESTER-1 state after this iteration: M0 COMPLETE · scaffold COMPLETE (build+test green) ·
BLOCKED-ON-STACKSIM (S1+S2) for all further milestones.**
