# Collective Status — ces-eo (Evidence Orchestrator)

> Snapshot date: 2026-07-25. Purpose: self-contained context for AI-based planning of the
> next goal in this module. Read this before proposing work; verify claims against the
> repo (commits cited) — this file is a snapshot, not a live source of truth.

## Goal (founder-calibrated 2026-07-25)

EO — the Evidence Orchestrator — is the *prove & document, continuously* stage
of CES: after remediation, it keeps the compliance claim true and provable over
time. It fetches signals from the tenant (its own observation channel,
independent of Stamper), maps them to NIST 800-171 control assessments, and
maintains the **DeterminationLedger** — the single per-objective source of
truth for "where do we actually stand." From that one truth it auto-manages the
POA&M lifecycle, renders persona-specific views, and generates the documents an
engagement ultimately exists to produce: the **SSP and the assessor-ready
submission package**. EO is why a CES customer is *always inspectable* — the
enclave story's "no-drift" promise made mechanical. On customer-facing SPRS it
deliberately defers to Muster's canonical `computeSprs` (One-SPRS rule); EO
owns the per-objective detail behind the number. (Former top open thread —
EO↔Muster SPRS parity RED — RESOLVED: verified + guarded 07-25 via
GP-SPRS-PARITY-1; see docs/design/readiness-report-contract.md §3a.)

## What this module is

ces-eo is the **Evidence Orchestrator** of the CES suite (CMMC L2 compliance platform).
It connects to a customer M365/Azure tenant (or the tenant-stacksim simulator), fetches
signals via PowerShell/Graph sessions, maps signals → NIST 800-171 control assessments,
maintains the DeterminationLedger (single per-objective source of truth), auto-manages
POA&M lifecycle, renders persona views / SSP / submission packages, and serves it all
from an Express server (`npm run eo`, entry `src/eo/index.ts`).

Siblings (read-only from here; file requirements, never write):
`../ces-shared` (schemas/methodology, e.g. sprs-weights/2.0.0), `../ces-tenant`
(tenant registry + session factory package, consumed since G-TENANT-M2),
`../ces-stamper` (provisioning; owns plan-data + tenant registry files),
`../ces-muster` (customer-facing readiness UI; owns the one true `computeSprs`),
`../ces-ao` (AdminOps Tier-3 approval loop), `../ces-strategy` (plans/market, branch
`g-ces-strategy` only), tenant-stacksim (standalone repo founder/ces-stacksim).

## Current status (as of last commit `b1ae8ee`, 2026-07-13)

**G-EO-STAB-1 is COMPLETE (M1–M4).** Goal doc: `docs/goals/G-EO-STAB-1.md`.

- **M1 (`4c84c19`, 07-11):** server split re-landed after founder GO (FD-EO-RELAND) —
  `EoServer.ts` 4,101 → 343 lines + 9 domain routers under `src/eo/server/routers/`,
  `eo-router-utils.ts`. Closes GAP-eo-02.R10-01. Includes the `/api/health` request-log
  exemption.
- **M2 (`380b45f`, 07-11):** readiness-report data contract published (in-repo docs) +
  SPRS parity check vs Muster — came back **RED, discrepancy filed** (check the contract
  note in docs/ for the filed discrepancy; EO's SPRS is matrix/detail only, never the
  customer-facing number).
- **M3 (`e928d7e`, 07-12):** registry-first tenant resolution in server routers; last
  deprecated `~/.stamper` path reader retired. Ephemeral ces-tenant sim tenants resolve
  via `/api/assess` with no plan-data file and no fallback.
- **M4 (`b1ae8ee`, 07-13):** first live-sim smoke, `tests/integration/eo-live-sim.test.ts`
  (238 lines): boots real EO server as a subprocess (tsx) against live tenant-stacksim,
  drives GET /api/connect (real powershell.exe → Graph shims) then GET /api/assess (SSE)
  to assess_done. Caught + fixed a real bug: undefined signal `endpoint` crashed the whole
  eval pass (0/110 controls, SPRS floor -203); guard in
  `src/eo/mapping/SignalToControlMapper.ts` (normalizePath) → absent endpoint normalizes
  to `''`. Live result: 22 signals → 119 controls evaluated, 106 live assessments,
  37 met / 36 not_met, SPRS -94.

**Health:** suite 50 suites / 562 passed green, `npx tsc --noEmit` clean,
`npm run validate-snippets` 111/111 (all as of `b1ae8ee`). No known P0s.

Earlier landed context still relevant: G-TENANT-M2 cutover (`5111245`) — EO consumes the
`ces-tenant` package; `SessionManager` is now a ~95-line shim over
`PersistentSessionFactory` with consumer identity `{ module: 'ces-eo' }`; EO unification
(DeterminationLedger + POA&M auto-close + persona views; `/api/ledger|poam/reconcile|persona/:id`).

## Standing rules / constraints (violating these is a P0)

- **One-SPRS rule:** Muster's `computeSprs` is the ONLY customer-facing SPRS. EO supplies
  matrix/detail views only.
- **Project-root write boundary:** work + commits stay inside ces-eo. Sibling needs get
  written up HERE as requirements, not applied over there.
- **Git:** no force-push ever; commit via pathspec/temp-index only (multi-pane index race
  bit this repo twice); no hard reset / git clean without founder ask.
- **Discovery engine is NOT this module's to build** — ownership question is
  FD-DISCOVERY-OWNER in ces-strategy/docs/MASTER-PLAN-2026-07-11.md; cross-cutting lane
  recommends a new sibling.
- Env: `ces-eo/.env` needs `REGISTRY_PATH`/`INFRA_REGISTRY_PATH` pointing into
  ces-stamper's registry (EO derives stamperRoot from REGISTRY_PATH).

## Known gotchas (from session logs)

- Jest maps `ces-tenant` to SOURCE (`../ces-tenant/src/index.ts`); runtime uses the
  hoisted `ces/node_modules/ces-tenant` symlink → dist. **Rebuild ces-tenant after
  package-side changes** or tests and runtime disagree.
- `EoConfig.stamperTenantConfigPath()` stays sync only because
  `FileTenantRegistry.get()` has a fully synchronous body. If get() ever gains a real
  await, the server call sites must go async (they are touchable now that the split
  landed).
- ts-jest trips on the docx/blob ESM transform if you import `createEoServer` in a test —
  run the server as a subprocess for integration tests (as eo-live-sim does).
- When launching tenant-stacksim, strip every PSModulePath casing from the child env
  first, else real Microsoft.Graph modules shadow the sim shims.
- `npm install` here operates at the workspace root (`ces/package.json` workspaces).

## Next steps (candidates for the next goal — planner's menu)

In-module:
1. **M5 (optional, S):** `.axis button.on` contrast fix, `src/eo/viewer/AssessorViewHtml.ts:34`
   (WCAG follow-up from the accessibility rounds). Trivial; could ride along with any goal.
2. ~~SPRS parity RED follow-up~~ **DONE 07-25 (GP-SPRS-PARITY-1):** RED was already
   resolved in substance on 07-12 (ces-shared 2.0.0 regeneration `40b43ca` + Muster
   vendored cutover); EO verified all 4 copies byte-identical and landed a standing
   guard test (`tests/unit/sprs-weights-parity.test.ts`). Remainder filed to Muster:
   record G-MUSTER-READINESS-1 M4 validation outcome.
3. **Config-router registry-native:** `POST /api/tenant-config` still goes
   path+loadTenantConfig; could take the record straight from the registry (open thread
   from G-TENANT-M2, unblocked since the split landed).
4. **Broaden live-sim coverage:** eo-live-sim smoke covers connect+assess only; ledger,
   POA&M reconcile, persona, SSP generation have no live-sim exercise. Also consider
   wiring the smoke into a repeatable harness vs drifted stacksim profiles (sim repo's
   next goal).

Cross-repo (file as requirements, owned elsewhere):
- Stamper cutover to ces-tenant (open half of tenant extraction; EO half done).
- ces-ao G-AO-CMMC-BOUND-1 parked on M0 schema fields in ces-shared/ces-tenant, then M4
  wiring; 33 registry mislabels need a data-fix.
- ces-ao still reads `C:\CES_Pipeline` while canonical tenant configs moved to
  ces-stamper/plan-data (`src/config/paths.ts` singleton) — open.
- Stacksim drifted-profiles goal (standalone repo).
- Unfiled Stamper bug found by G-TESTER-1: IA.L2-3.5.3.

## How to verify / run

- `npm test` (jest, expect 562+ green), `npx tsc --noEmit`, `npm run validate-snippets`.
- `npm run eo` boots the server (tsx). Live-sim integration test self-boots the sim;
  Windows-only, skips if sibling sim / psmodules / stamper registry absent.

## Pointers

- `docs/goals/G-EO-STAB-1.md` (completed goal + gates), `docs/goals/G-TENANT-M2.md`
- `session-ces-eo-2026-07-10.md`, `-11.md`, `-25.md` (day-by-day memory; 07-25 backfills
  the unlogged M1–M4 turns)
- `ces-strategy/docs/MASTER-PLAN-2026-07-11.md` (FD-EO-RELAND, FD-DISCOVERY-OWNER)
- `ces-strategy/docs/context/masterplan/eo.md` (verification record, endpoint inventory)
- `src/eo/server/` (EoServer + 9 routers), `src/eo/mapping/SignalToControlMapper.ts`,
  `tests/integration/eo-live-sim.test.ts`, `tests/unit/tenant-cutover.test.ts`
