# Goal Document - G-EO-STAB-1: EO stabilization - split re-land, readiness data surfaces, sim exercise

**Date:** 2026-07-11 - **Type:** /goal.
**Provenance:** founder directive 2026-07-11 working-system program
(ces-strategy/docs/context/VAULT.md, section B; lane analysis
ces-strategy/docs/context/masterplan/eo.md; master plan
ces-strategy/docs/MASTER-PLAN-2026-07-11.md).

## Job

Four milestones (dependency order per the lane: M1 first - everything in src/eo/server is
fenced behind it; M2 parallel; then M3 -> M4):

- **M1 - land the server-split commit (S). URGENT for fragility, not size. DONE
  (2026-07-11).** The split
  (EoServer.ts 4,101 -> 343 lines + eo-router-utils.ts + 8 routers, 4,530 new lines) is
  INTACT in the working tree, byte-identical to backup commit 18d55ad - which is reachable
  ONLY via reflog and becomes GC-eligible around 2026-08-09. Re-verified on this exact
  tree 2026-07-11: tsc clean, 50/50 suites, 554 passed / 3 skipped. One pathspec commit
  scoped to exactly: src/eo/server/EoServer.ts, src/eo/server/eo-router-utils.ts,
  src/eo/server/routers/. Requires FD-EO-RELAND go (review verdict already RE-LAND,
  session-ces-eo-2026-07-11.md:67-102).
  **RESOLVED 2026-07-11 (FD-EO-RELAND, founder HIL decision, FINAL): GO - ALREADY
  EXECUTED.** Landed as commit `4c84c19` (suite 554 green first, per the gate). M1 is
  DONE; M2-M4 are now unblocked on this milestone.
- **M2 - readiness-report data contract (S).** Publish/confirm the contract the Muster
  readiness report consumes: "SPRS number from Muster's parity-proven calc; matrix from EO
  GET /api/ledger + /api/assessment". Include a one-time EO-vs-Muster SPRS parity check at
  contract time - EO carries THREE SPRS-adjacent implementations (SprsCalculator,
  DirectiveSprsCalculator, SprsValidator); none of them is ever the customer number.
- **M3 - registry-backed tenant resolution in server routers (S-M).** Today
  `resolveTenantJsonPath()` (eo-router-utils.ts:52-63) looks in
  `<stamperRoot>/plan-data/<slug>/<slug>.json` then falls back to DEPRECATED
  `~/.stamper/tenants/` - ephemeral sim tenants created via the ces-tenant registry are
  INVISIBLE to /api/assess. Convert config-router/assessment-router to ces-tenant registry
  resolution (the documented M2-follow-up, fenced behind the split); remove the last
  deprecated-path reader.
- **M4 - first live sim smoke (M).** Boot tenant-stacksim (real server, not the fake
  127.0.0.1:9999 URL the gate-4 unit test uses), enable sim mode via StacksimEnvironment,
  run `npm run eo` and GET /api/assess for a sim tenant end-to-end - the EO HTTP server in
  the loop for the first time.
- **Optional M5 - .axis button.on contrast (S, NICE-TO-HAVE).** AssessorViewHtml.ts:34,
  measured 2.53:1; fix to >= 4.5:1 both themes.

## Must-NOTs

- NO hard reset / `git clean` / checkout -- in ces-eo before M1 lands - the working tree
  plus an expiring reflog entry are the only copies of the split.
- M1 commit must be staged+committed atomically with pathspecs (multi-pane git-index
  hazard already bit this repo once - mislabeled d1aa373).
- EO's SPRS implementations are NEVER the customer-facing number (one-SPRS rule:
  Muster's computeSprs). EO supplies matrix/detail views only.
- Do not build the discovery engine here as part of this goal - ownership is
  FD-DISCOVERY-OWNER (master plan); cross-cutting lane recommends a new sibling, with EO
  revival explicitly considered and not chosen.
- No force-push.

## Acceptance gate (objectively checkable)

1. M1: `git log` shows one pathspec-scoped split commit; `git status` clean for the three
   paths; tsc clean; 50/50 suites green post-commit.
2. M2: contract note committed (in-repo docs/) naming the exact endpoints and the parity
   check result (numbers match, or discrepancy filed).
3. M3: a test proves an ephemeral ces-tenant sim tenant is resolvable by /api/assess with
   NO file in plan-data and NO ~/.stamper fallback; grep shows the deprecated path reader
   gone.
4. M4: documented smoke run - real tenant-stacksim server URL, EO server booted, GET
   /api/assess returns a completed assessment for the sim tenant; steps + output recorded
   in the session log.
5. Suite green throughout (554+ tests); no known P0s.

## Preconditions

- M1: FD-EO-RELAND decided (go) - RESOLVED 2026-07-11, DONE (commit `4c84c19`). M3: M1
  landed - satisfied. M4: M3 landed + tenant-stacksim serving (stacksim S1-S5 are CLOSED -
  no stacksim-side blocker).
- Env: ces-eo/.env with REGISTRY_PATH/INFRA_REGISTRY_PATH into ces-stamper's registry
  (EO derives stamperRoot from REGISTRY_PATH); scenario harnesses must provide the same.

## Pointers

- ces-strategy/docs/context/masterplan/eo.md (verification record: integrity check vs
  18d55ad, suite runs, endpoint inventory)
- session-ces-eo-2026-07-11.md:67-102 (re-land review + commit proposal)
- src/eo/server/eo-router-utils.ts, src/eo/server/routers/assessment-router.ts
- tests/unit/tenant-cutover.test.ts:244-299 (the only sim exercise so far - unit-level)
- ces-strategy/docs/MASTER-PLAN-2026-07-11.md (FD-EO-RELAND, FD-DISCOVERY-OWNER)
