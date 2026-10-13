# REQ: ces-muster: live (non-sim) tenant discovery (MU-03 live op)

**Filed by:** ces-muster (W4-MU2, 2026-09-27)
**Target:** ces-muster (self). Founder-gated.
**Priority:** P2
**Status:** BUILT, GATED, OFF BY DEFAULT (FC-MU-2, commit `f3f9b83`, 2026-09-28). The founder decision of
2026-09-27 lifted the block: device-code, opt-in per engagement, consent recorded in the readiness record.
All three acceptance items are met, proven by fakes in `muster-api/tests/live.gate.test.ts`:
(1) the decision is recorded in ces-strategy `DECISIONS-2026-09-27.md` #5;
(2) `engagements.live_access_enabled` is the per-engagement opt-in, and the consent lands in `live_consent` and
in the readiness-result `manifest.consent`;
(3) the read-only test proves no `set_command` reaches the session and the envelope says `tenant.kind: live`.
**Still open:** it has never run against a real tenant (no test may do that). It needs a registered public-client
app (`MUSTER_LIVE_CLIENT_ID`) and a founder-run smoke test. FC-MU-3 step 5 (2026-09-28, founder decision #14) added separate read-only
device-code consents for Exchange Online, Purview and Azure (`POST /api/live/engagements/:id/consent {area}`), each
recorded (`live_area_consents`, migration 007) and carried in the readiness record (`manifest.consents[]`); the live walk
routes `exchange`, `ipps` and `az` entries to their area's session (proof `muster-api/tests/live.areas.test.ts`).
FC-MU-5 (2026-09-28, founder decisions round 4) closed the two gaps FC-MU-3 left: Teams is a fifth area with its own
consent (`live.teams.test.ts`), and the 7 registry Azure CLI reads run live as Azure PowerShell translations
(`liveAzTranslate.ts`, `live.azTranslate.test.ts`; Stamper's registry untouched). EXO / Purview / ARM / Teams have no
read-only delegated scope: the read-only guarantee there is the get-only executor, the command gate, and (FC-MU-5
step 1) a consent recorded only for a Global Reader (plus subscription-wide read for Azure; `live.readerRole.test.ts`).
Still open: registry `{placeholders}` are not resolved on the live path (`REQ-muster-live-variable-resolution.md`). The ID token is verified before any consent is recorded (step 4). `mu discovery` (the CLI) stays sim-only. The SPA has no
live-run UI yet. How to enable it is in `docs/FLOW-THROUGH-REPORT-2026-09.md` § FC-MU-2.

## What
`mu discovery` and `POST /api/discovery/run` only run against the local stacksim sim. The CLI refuses without
`--sim`. The route and service target the `SIM_URL` constant (`127.0.0.1:4390`) and a session that loads only
the sim psmodules (`muster-api/src/services/simDiscoveryRun.ts`, `liveSimSession.ts`). A read-only walk of a
real customer tenant is not possible.

## Why it is open
- W4 ground rule 1 (sim only: nothing may reach a real tenant or a non-localhost Microsoft endpoint) and
  FD-LIVE-SMOKE both forbid building or exercising a live path in this wave.
- A live run needs customer consent and an auth tier (device-code or cert-app-only) that no Muster flow
  captures yet.

## What exists already (so the work is small once unblocked)
- `muster-api/src/services/discoveryWiring.ts` `sessionFromFactory()` adapts a ces-tenant
  `TenantSessionFactory` into the executor's `DiscoverySession`. The executor is read-only by construction:
  it only ever runs `get_command`.
- `simDiscoveryRun.runSimDiscovery` is the single run path (probe → walk → zero-writes → envelope). A live
  variant would swap the session and drop the ledger check, because a live tenant has no sim ledger.

## Acceptance (when unblocked)
1. The founder records the lift of sim-only for discovery, including the allowed auth tier.
2. The live run is opt-in per engagement and records consent in the readiness manifest.
3. A read-only guarantee test proves no `set_command` is reachable, and the envelope says `tenant.kind: live`.
