# Goal — G-MUSTER-FULL-1: every Muster functionality Implemented, tested, and feeding Stamper

**Date:** 2026-09-26 · **Type:** `/goal` (bounded, ordered milestones, each with an objective gate).
**Source assessment:** `ces-strategy/docs/context/module-status/muster.json` + `muster.md` (read both
first; functionality IDs MU-01..MU-20 below refer to them). **Builds on, does not replace:**
`docs/goals/G-MUSTER-PLAN-3.md` (its M2–M5 are adopted here verbatim as milestones F2–F5, with their
gate text and addenda) and `docs/goals/G-MUSTER-PLAN-3-FINDINGS.md` (F1–F9).

You are an agent working **only inside `C:/Users/mhsut/DevProjects/ces/ces-muster`**. Read the
recent `session-ces-muster-*.md` logs, `collective-ces-muster.md`, `PLAN.md`, and
`docs/goals/G-MUSTER-PLAN-3*.md` before acting.

---

## Current state (from the 2026-09-26 assessment at HEAD ff8656c)

- Implemented: MU-01 intake, MU-04 boundary confirm, MU-05 adaptive interview, MU-07 scoring,
  MU-08 readiness tab, MU-09 exports, MU-11 quick session, MU-12 contracts, MU-13 session sync,
  MU-14 rollup (static), MU-15 coach, MU-16 platform/RBAC/RLS, MU-17 HIL/touch, MU-18 annuity
  engine, MU-20 delivery portal (API only).
- **Partial:** MU-02 discovery in SPA ("Run" = canned `DISCOVERY_RESULTS_FIXTURE`,
  `DiscoverySubTab.tsx:23`); MU-03 executor (CLI, sim-only — acceptable, keep it sim-only);
  MU-06 harvest prefill (SPA reads `muster-harvest-facts`, nothing writes it; SPA never calls
  `/api/harvest`); MU-10 Plan tab (5/26 SI inputs derived; BTC/CUI/TCP hard-wired `null` in
  `tenantManifestAdapter.ts:168-183`; infra manifest never produced; M2–M5 absent; no Stamper
  hand-off); MU-19 collector kit (`collectorKitService.ts:43` has no route/CLI/UI entry).
- Tests: root vitest 321/321; muster-api 301 pass / 1 env-fail (`discovery.live-sim` GATE 5,
  stacksim :4390 unreachable) / 3 skip (live RLS). Playwright e2e (10 cases) not run in assessment.
- **Muster → Stamper:** plan artifacts are browser downloads only; Stamper's `POST /api/translate`
  reads server-side file paths and Zod-validates with `CESManualMissionPlanSchema`
  (`ces-stamper/src/types/ces-artifacts.types.ts:326`). No test proves Muster's plan passes it.

## Target state

Every MU functionality is **Implemented** (entry wired to real logic + real data path + error
handling), each has unit tests and — for web-ui functionalities — at least one e2e case, and a
Muster-generated Manual Mission Plan + Tenant Manifest is **proven acceptable to Stamper's
translator contract** and **retrievable by a machine** (not only a browser download). Sim-only
paths stay sim-only and are labelled as such.

---

## Milestones (in order — do not start one before the previous gate is green)

### F0 — Test hygiene baseline
**Build.** Make `tests/discovery.live-sim.test.ts` and `discovery.cli.live-sim.test.ts` skip (not
fail) when the stacksim server is not reachable (probe the URL, not just files). Run
`npm run test:e2e` once and record the baseline in the session log.
**Gate.** `npx tsc --noEmit` (root and `muster-api/`), `npm test` (root), `npm test` (muster-api),
`npm run test:e2e`, `npm run check:drift`, `npm run lint` all green with stacksim DOWN; live-sim
cases pass with stacksim UP.

### F1 — Stamper contract parity for plan artifacts (MU-10)
**Build.** Vendor Stamper's `CESManualMissionPlanSchema` + tenant-manifest reader contract (Zod
types from `ces-stamper/src/types/ces-artifacts.types.ts`) into `src/vendored/ces-stamper/`,
pinned in `vendor-manifest.json` (byte-for-byte modulo imports; `check:drift` covers it). Add
`stamperContractParity.test.ts`: Muster's generated MP (and TM) for the reference fixture parse
under the vendored schema; `control_directives[]` non-empty with valid `stamper_action`/directive
values. Record any mismatch as a finding and fix on the Muster side (never edit ces-stamper).
**Gate.** Parity test green; a deliberately corrupted MP fails it; drift green.

### F2 — PLAN-3 M2: CUI Boundary + BTC adapters (MU-04, MU-10)
Exactly `G-MUSTER-PLAN-3.md` M2 build + gate (a)–(d). Adds: the 9-field CUI Boundary Output
Contract emitted from confirmed drafts only.

### F3 — PLAN-3 M3: Tenant Config Profile → Infrastructure Manifest (MU-10)
Exactly PLAN-3 M3 build + gate (a)–(d). The `infra-manifest` Stub operation becomes Implemented.

### F4 — PLAN-3 M4: Control Assessment, Traceability, cross-artifact validator (MU-10)
Exactly PLAN-3 M4 build + gate (a)–(d) (incl. RBAC: `sub` cannot fetch Control Assessment).

### F5 — PLAN-3 M5: 21 policy documents, markdown (MU-10)
Exactly PLAN-3 M5 build + gate (a)–(d).

### F6 — Persist and deliver plan artifacts (MU-10, MU-13, MU-20)
**Build.** Persist generated plan artifacts (Dexie table + sync to muster-api, reusing the
`/api/sessions/sync` pattern or a sibling `/api/plans` route); register them with the existing
delivery portal (`/api/delivery/artifacts`) so an operator or Stamper-side tool can fetch them by
engagement; add `mu plans export --engagement <id> --out <dir>` writing
`manual-mission-plan_<slug>_<ts>.json` + `tenant-manifest_<slug>_<ts>.json` to a directory (the
file-path form Stamper's `/api/translate` consumes). Muster does not call Stamper.
**Gate.** API tests for persist/list/fetch with RBAC + RLS; CLI test writes both files and they
pass F1's parity test; e2e: generate in the Plan tab → artifacts listed via API.

### F7 — Real discovery in the SPA (MU-02, MU-03)
**Build.** Replace the canned fixture behind "Run discovery" with a call to a new sim-only API
route that runs the existing executor (`runDiscovery`) against stacksim and returns the
readiness-result envelope; the fixture remains only as an explicit "sample" mode, labelled.
Remove the duplicate envelope builder (`discoveryEnvelope.ts` vs SPA `buildReadinessResult`) by
extracting one shared builder.
**Gate.** Unit tests for the route (sim unavailable → 503, not fixture); e2e (stacksim up):
Run → confirm → interview shows fewer questions than manual branch; one envelope builder.

### F8 — Harvest seam (MU-06)
**Build.** The SPA calls `/api/harvest` (consent status + run) and writes the result into the fact
store with `auto_detected` provenance; delete the orphaned localStorage read or make the harvest
flow the single writer of it. Real Graph stays behind configured secrets; tests use the mock client.
**Gate.** Unit + e2e (mock API): harvest facts appear as AUTO-DETECTED and prune questions;
failed probe yields no fact (FCA).

### F9 — Collector kit entry point (MU-19)
**Build.** `GET /api/recipes/collector-kit` (+ `mu recipes kit`) returning the signed read-only
script + manifest; Discovery tab offers the download next to "import results".
**Gate.** API + CLI tests; e2e: kit download link present; kit output round-trips through
the import path (`executorImportEquivalence`).

### F10 — Operator surfaces for API-only functionality (MU-16, MU-17, MU-18, MU-20)
**Build.** A minimal operator view (role `bhd_operator`) listing engagements/parties with lifecycle
state, the HIL queue (resolve), nudge/reassessment status, and delivery grants — reading the
existing routes only. Registry fix paths (`registryFixPaths.ts`) regenerated by a script from the
live Stamper registry, with a drift test that fails when the snapshot is stale.
**Gate.** Component tests per panel; e2e against a mock API; registry-snapshot drift test green.

---

## Acceptance per milestone (summary)
Every milestone: new tests exist and pass; full gate set (`npx tsc --noEmit` ×2, `npm test` ×2,
`npm run test:e2e`, `npm run check:drift`, `npm run lint`) green; score disclosure asserted on any
new surface (no SPRS on plan/policy surfaces); session log updated with commands run and counts.

## Ground rules
- **Sim-only.** Never connect to a real tenant or the internet in tests; live paths only against
  local stacksim (`--sim`). Real Graph/Anthropic calls only behind env config, never in CI tests.
- **Write boundary = `ces-muster` only.** ces-stamper, ces-planner, ces-shared, ces-tester are
  read-only; needs against them are filed as requirements in this repo and reported.
- **Vendor, don't fork or rewrite** (founder engineering note in PLAN-3). One compile, one bank,
  one fact store, one provenance model.
- **Small green commits** on a branch; never force-push; never rewrite shared history.
- **No personal identity** (names, emails, handles) in code, docs, commits' content or artifacts.
- **HONEST-OPEN reporting:** every milestone completion doc states what is still open, what was
  defaulted, computed coverage numbers, and any gate reinterpretation (as PLAN-3 addenda do).
- No `npm install` that rewrites lockfiles unless a milestone adds a dependency (then commit it).

## Exit criteria (DONE-WHEN)
1. F0–F10 gates green; the full gate set green with stacksim down and live-sim green with it up.
2. `muster.json` re-assessed: every MU-nn **Implemented**, each with ≥1 unit test and each web-ui
   functionality with ≥1 e2e case; `unmapped_tests` ≤ shell-nav only.
3. A Muster-generated MP + TM for the reference fixture passes the vendored Stamper contract and
   is exportable to a directory by CLI (F1 + F6).
4. `docs/GOAL_COMPLETION_G-MUSTER-FULL-1.md` written with per-milestone evidence and open items;
   brutal-critic PASS on: silent default, second bank, second compile, score leak, fixture
   masquerading as live.

## Legend
MU-nn = Muster functionality IDs from the 2026-09-26 assessment · F0–F10 = milestones of this
goal · M0–M5 = milestones of `G-MUSTER-PLAN-3` · F1–F9 in PLAN-3 FINDINGS are *findings* (not
these milestones — cite them as "PLAN-3 F5" to avoid collision) · MP = Manual Mission Plan ·
TM = Tenant Manifest · SI/SIT = Strategic Intent baseline/question bank · BTC = Boundary Topology
Confirmation · TCP = Tenant Config Profile · HIL = human-in-the-loop · RLS = row-level security ·
FCA = False Claims Act guardrails · HONEST-OPEN = report open items explicitly, never as done.
