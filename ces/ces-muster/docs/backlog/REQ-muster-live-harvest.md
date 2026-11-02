# REQ: ces-muster: live-tenant Graph harvest (MU-06 OAuth/consent op)

**Filed by:** ces-muster (W4-MU2, 2026-09-27)
**Target:** ces-muster (self). Founder-gated.
**Priority:** P2
**Status:** BUILT, GATED, OFF BY DEFAULT (FC-MU-2, commit `f3f9b83`, 2026-09-28). The founder chose
device-code over certificate assertion: a public client, no stored secret. `POST /api/harvest/run {live:true,
engagement_id, consent_id}` reads through `realGraphClient` with the consent's in-memory token. That token is
faked in `muster-api/tests/live.gate.test.ts`. The old bare-`access_token` path now returns 403. **Still open:**
not run against a real tenant, and there is no "facts match a direct Graph read" proof on a live tenant (that
needs the founder smoke run). The client-secret `consent-url`/`callback` routes and `consentService.ts` were RETIRED in FC-MU-3
(founder decision 2026-09-28 #9; proof `muster-api/tests/harvest.retired.test.ts`): device-code is the only live path. The follow-up below was done in FC-MU (`b4ee05e`).

The harvest prefill seam is closed for the sim (`POST /api/harvest/run { sim: true }` → stacksim Graph → the
`muster-harvest-facts` store → the interview prefill; commit 4658b50). The live path cannot be exercised or
extended in Wave 4:
- W4 ground rule 1 forbids any non-localhost Microsoft endpoint.
- `consentService` supports only a client secret. The certificate-assertion flow is not implemented
  (`routes/harvest.ts` callback comment).
- `realGraphClient` against a real tenant has only been tested with `MockGraphClient`.

**Acceptance (when unblocked):** the founder lifts sim-only for harvest; certificate-assertion token minting is
added; a consented live run writes the same store; and the facts match a direct Graph read, the same way the
sim test (`muster-api/tests/harvest.sim.test.ts`) checks them.

## Follow-up found in W4 (sim path)
`storeHarvestFacts` writes `muster-harvest-facts`, but `AssessmentPage` never clears it after the mount-time
prefill. The discovery store is cleared on consume (`clearDiscoveryFacts`), so a later fresh assessment does not
re-apply a stale run. Before W4 nothing wrote the harvest store, so this could not happen; now it can. Add the
matching clear-on-consume and a test.
