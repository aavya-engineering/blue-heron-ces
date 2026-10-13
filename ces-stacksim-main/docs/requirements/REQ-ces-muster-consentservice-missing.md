# REQ-ces-muster-consentservice-missing — muster-harvest.test.ts fails on tenant-stacksim master (sibling module resolution)

- **From:** tenant-stacksim (FC-SIM-2, 2026-09-28)
- **To:** ces-muster (`muster-api/src/services/consentService.ts`)
- **Status:** CLOSED (FC-SIM-3, 2026-09-28) — see "Resolution" below. No ces-muster action needed; this was
  tenant-stacksim's test to fix, not a ces-muster regression.
- **Evidence:** `tests/integration/muster-harvest.test.ts` (tenant-stacksim), all 5 scenario cases, on a **clean tenant-stacksim `master` checkout** (verified with `git stash` — the failure is present with zero tenant-stacksim changes applied).

## What

`tests/integration/muster-harvest.test.ts` spawns a harvest runner (`harvest-runner.mts`) that dynamically imports
`ces-muster/muster-api/src/services/consentService.ts` by absolute path. As of 2026-09-28 ~12:30–12:40 local, that
file does not exist in the `ces-muster` checkout this repo sits beside:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'C:\...\ces-muster\muster-api\src\services\consentService.ts' imported from
...\harvest-runner.mts
```

`ces-muster`'s own git log at the same time shows an in-flight session (FC-MU-3) actively refactoring this exact
area ("retire the client-secret harvest routes", `git status` showing `liveAccess.ts` / `liveDiscoveryRun.ts` /
`idTokenVerifier.ts` modified within the same minute). This looks like a sibling-repo file this session's concurrent
FC-MU-3 work moved or renamed mid-refactor, not a tenant-stacksim regression — `git stash` on tenant-stacksim (removing
every FC-SIM-2 change) reproduces the identical failure, so no code in this session's diff caused it.

## Ask

Once FC-MU-3 lands, confirm `consentService.ts` (or whatever it was renamed to) is at a stable path and re-run
`npx vitest run tests/integration/muster-harvest.test.ts` here. If the harvest runner should import a different
module post-refactor, file the exact new path back so tenant-stacksim's harness can be updated.

## Acceptance

`npx vitest run tests/integration/muster-harvest.test.ts` (tenant-stacksim) passes all 5 scenario cases again.

## Resolution (FC-SIM-3, 2026-09-28)

FC-MU-3 landed (Muster commit `e8b0547`, founder decision 2026-09-28 #9): `consentService.ts` and the
client-secret harvest routes are permanently retired, not renamed — device-code consent
(`POST /api/harvest/run { live: true, engagement_id, consent_id }`) is the only live path now. Confirmed by
reading `muster-api/src/routes/harvest.ts` (read-only): the **sim** path (`{ sim: true }`) never used consent at
all — it always builds its Graph client against the hardcoded `SIM_GRAPH_BASE` constant
(`http://127.0.0.1:4390/v1.0`, not overridable by request or env — muster-api's own
`muster-api/tests/harvest.sim.test.ts` asserts this). The old test's device-code exchange against a
scenario-specific `loginBase` was solving a problem the current harvest route no longer has.

`tests/integration/muster-harvest.test.ts` was reworked to mirror muster-api's own `harvest.sim.test.ts` pattern
instead: mount Muster's real, unmodified `createHarvestRouter()` (from `routes/harvest.ts`) on a real Express app,
mint a `bhd_operator` JWT with Muster's real `mintToken`, inject `simProbe = async () => true` (the same test seam
`createHarvestRouter`'s own suite uses, so the route never pings the real shared dev sim on :4390), and stub
`fetch` to redirect calls to `SIM_GRAPH_BASE` toward this scenario's own ephemeral stacksim instance — every other
fetch (including the runner's own call into the local harvest route) passes through untouched. No consentService,
no device-code, no client-secret path — the retired surface is gone from this test entirely, and the harvest
route, `runHarvest`, `realGraphClient`, and the JWT auth middleware all run as unmodified Muster production code.

All 5 scenario cases pass (`npx vitest run tests/integration/muster-harvest.test.ts`), and `npm test` is fully
green (187/187) on tenant-stacksim `master`.
