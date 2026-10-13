# Muster × ces-tenant — the tenant-connection resolution

**Date:** 2026-07-11 · **Status:** RESOLVED (founder question "will Muster need ces-tenant —
it has to talk to a tenant, right?" — answered and formalized; facts verified against source
same day) · **Audience:** any session working Muster's tenant-facing features (GO-2 Discovery
tab especially).

---

## The resolution, in one paragraph

Yes — and it already does. Muster consumes `ces-tenant` today (G-TENANT-M3, ces-mono commit
`8e591b6`): muster-api's `tenantKeysService` resolves tenants and credentials through the
package's HTTP token/endpoint surface, with caller identity `consumer: { module:
'ces-muster' }`. The architectural rule this document exists to pin: **the Muster SPA never
touches a tenant; muster-api is Muster's only tenant surface, and muster-api reaches tenants
only through ces-tenant.** No session may reintroduce hand-rolled tenant/credential
resolution anywhere in this repo.

## Why the split (and why it is permanent)

- The SPA is a browser app: it cannot hold PowerShell sessions, certificates, or secrets.
  Everything tenant-facing runs in muster-api (Node), which speaks HTTP Graph (the existing
  OAuth harvest lane).
- ces-tenant ships **two client surfaces** by design: a PowerShell session factory (used by
  Stamper/EO/AO) and an **HTTP token/endpoint surface** — the latter exists precisely for
  muster-api and ces-tester. Muster is a first-class consumer of the HTTP surface and will
  never need the PowerShell one.

## What GO-2 (discovery-first) consumes from ces-tenant

1. **Auth ladder** — the Discovery tab's no-cert onboarding (delegated device-code sign-in;
   admin-run-script upload as the zero-credential fallback) is ces-tenant auth-broker
   strategy work, consumed by muster-api. Muster does not implement auth flows; it requests
   them.
2. **The daemon (M6 v1, shipped: ces-tenant `19163aa`, v0.3.0, auth-state-only)** — it holds
   tokens; muster-api's Graph calls need tokens. This pairing gives the Discovery tab
   one-sign-in auto-connect essentially free: the human signs in once per engagement
   (wherever that happens first), the daemon holds the auth state, muster-api asks the
   daemon. If the daemon is down, muster-api falls back to its own delegated flow —
   degrade, never block.
3. **Registry/status reads** — tenant records (`kind: 'live' | 'sim'`) come from the
   registry; Muster's discovery against a SIM tenant (ces-tester scenarios, demos) is the
   same code path as live, selected by tenant kind.

## What deliberately does NOT touch ces-tenant

**The import-discovery-results-file mode.** Muster's offline-first heritage survives as the
mode where discovery results arrive as a file (produced elsewhere — an admin-run script, a
ces-tester run) and Muster ingests with zero connectivity. That path bypasses ces-tenant
entirely, by design, and must keep working with no daemon, no network, no tenant.

## Requirements on this repo (must-NOTs)

- muster-api must not construct tenant-config paths or mint credentials itself (M3 already
  removed this; do not regress). All resolution via ces-tenant's HTTP surface.
- The SPA must never receive raw tokens or credential material — muster-api brokers; the
  browser sees results, not secrets.
- The unbuilt **discovery engine** (registry-walking get_command executor — the GO-2 sibling
  dependency, still unowned) must NOT be built inside Muster; whoever builds it will consume
  ces-tenant for sessions/auth. Muster consumes the engine's results.

  **2026-07-11 founder override (FD-DISCOVERY-OWNER, FINAL):** the bullet above is
  superseded on ownership. The founder ratified the discovery engine as a **muster-api
  lane** (verbatim: "that is what Muster does — it should leverage existing known proven
  code to do it"), consuming ces-tenant's proven `PersistentSessionFactory` plus Stamper's
  registries as data — see `ces-muster/docs/goals/G-MUSTER-DISCOVERY-1.md`. The bullet's
  surviving intent is NOT voided, only relocated: Muster must never hand-roll session or
  auth logic of its own (the lane consumes ces-tenant's session factory exactly as
  prescribed, never a parallel implementation), and the **SPA still never touches
  tenants** — the lane lives entirely in muster-api; the browser continues to see only
  discovery results, never sessions, tokens, or registries.
- Version policy: pin-exact. Currently muster-api is on the 0.3.x line's M3 wiring; the
  approved **async `resolveTenantKeys` change (founder, 2026-07-11)** lands as ces-tenant
  0.4.0 and muster-api is the primary consumer coordinated in that change — expect that
  bump to arrive from the ces-tenant side with a coordinated PR touching
  `muster-api/src/services/tenantKeysService.ts` call sites.

## Open items tracked elsewhere (do not duplicate here)

- Async `resolveTenantKeys` execution — ces-tenant session (decided, not yet landed).
- Discovery-engine ownership — RESOLVED 2026-07-11 (muster-api lane; see override note
  above and `docs/goals/G-MUSTER-DISCOVERY-1.md`).
- Connected-vs-import-file default for the Discovery tab — GO-2 open design decision 1.

**Provenance:** founder Q&A 2026-07-11 in the ces-strategy program session; M3 state
verified against ces-mono `8e591b6` and muster drift-check 32/32; daemon state verified
against ces-tenant `19163aa`. Related: `docs/goals/G-TENANT-M3.md` (the landed cutover),
`docs/goals/G-MUSTER-GO-2.md` (the Answer Engine), `ces-stamper/docs/design/
tenant-manager-extraction.md` (the canonical tenant-manager design).
