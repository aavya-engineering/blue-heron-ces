# M6 — The Stateful Tenant Service (v1: auth-state-only)

**Date:** 2026-07-11
**Goal:** `docs/goals/G-TENANT-M6.md` (founder-directed 2026-07-10; open decision 1 resolved by
founder 2026-07-11: **v1 = auth-state-only** — the resolution section in the goal file).
**Builds on:** M1 (`docs/M1-RECORD.md`) and the ratified 2026-07-10 caller-identity +
status-surface amendment (commit f9d75b4) — the service WRAPS the library implementations,
it does not fork them.

## Planning decisions (open decisions 2 and 3, resolved at this goal's planning stage)

- **Decision 2 — service lifecycle: user-run command only, `npm run serve` /
  `ces-tenant serve` (bin).** Why: (a) it mirrors tenant-stacksim's `serve`, the goal's own
  named in-family precedent; (b) the daemon is "the most sensitive process on the machine"
  (design requirement 5) — implicit auto-spawn by whichever module runs first makes its
  existence non-obvious to the operator and adds ownership/shutdown edge cases; (c) degrade-
  never-block means an explicit start costs nothing — when it is not running, every module
  works via the library path. Auto-start can be revisited at v2 without interface change.
- **Decision 3 — status view: single self-contained HTML page at `GET /status`** (server-
  rendered, zero external assets), alongside the JSON API (`/api/status`, `/api/activity`)
  which gives console users the same data via curl. Why: the founder's ask was a visual
  ("show connection status and activity"); a self-contained page has no build step and no
  asset exposure on a sensitive localhost daemon. Carries the v1 honesty banner: activity is
  self-reported by modules, not centrally enforced (per the 2026-07-11 resolution).
- Default port **4690** (`DEFAULT_TENANT_SERVICE_PORT`) — adjacent-but-distinct from
  stacksim's 4390; clients override via `CES_TENANT_SERVICE_URL`.

## What was implemented (all under `src/service/`, exported from `src/index.ts`)

| Piece | File | Role |
|---|---|---|
| Wire protocol | `service/protocol.ts` | JSON shapes, defaults, redaction contract (`AuthStateSummary.holdsToken`, never material) |
| Auth-state store | `service/auth-state.ts` | v1 heart: register/claim per tenant x engine service, scope + expiry matching, redacted listings |
| Daemon | `service/server.ts` | `TenantServiceDaemon`: plain `node:http`, binds 127.0.0.1 ONLY (not configurable), wraps `FileTenantRegistry` + `PlanDataTenantHttpKeyProvider` + `StacksimEnvironment` with ITS ledger (`InProcessTenantStatus`) so the daemon holds the cross-module picture |
| Status view | `service/status-html.ts` | Self-contained HTML: tenant x engine service x module matrix + recent activity |
| Client | `service/client.ts` | `TenantServiceClient`: implements `TenantRegistryLifecycle`, `TenantLaunchContextProvider`, `TenantStatusSurface`, `TenantActivityRecorder` exactly; async mirror of `resolveTenantKeys` (see deviations); auth register/claim |
| Transport selection | `service/surfaces.ts` | `connectTenantSurfaces()`: health-probe, service transport when up, library transport otherwise — same call sites both ways |
| CLI | `service/cli.ts` | `ces-tenant serve [--port N]` (decision 2), graceful SIGINT/SIGTERM stop |

Service-mode invariant enforced (amendment `consumer.ts`): mutating/connection-class requests
without `consumer: { module, purpose }` are rejected 400 `consumer_required` (library mode
warns; service mode rejects — both now exist and behave per the doc comment).

## Acceptance gates (all tested in `src/__tests__/service.test.ts`, real daemon on an ephemeral 127.0.0.1 port)

1. **Same suite, both transports** — `contractSuite()` (sim lifecycle / token resolution incl.
   `TenantKeysError` code rehydration / launch-context incl. live refusal) runs verbatim
   against the library transport and the service transport.
2. **Auto-connect, one interactive auth event** — module A signs in once (counted spy),
   registers bearer auth state; module B claims it and receives the token; interactive
   events = 1. Scope/expiry semantics covered (exact engine-service scope beats tenant-wide;
   expired state never handed out). *Approximation note:* the "two module processes" are two
   `TenantServiceClient` instances speaking real localhost HTTP to one daemon from the test
   process — the transport boundary is real, the OS-process boundary is not.
3. **Kill-the-daemon** — the SAME `connectTenantSurfaces()` call returns service transport
   while up and library transport after `daemon.stop()`, and `resolveTenantKeys`/registry
   reads succeed both times. No code change at the call site.
4. **Ledger** — scripted two-module run produces per-module (`ces-muster`, `ces-tester`) and
   per-service (`sessionType: 'graph'`) entries; PUT/PATCH/DELETE on `/api/activity` answer
   405 `append_only`; grep-able no-credentials assertion: seeded `evidence_storage.account_key`
   and a registered bearer token appear in NO response from `/api/status`, `/status`,
   `/api/activity`, `/api/tenants/*` (evidenceStorage is stripped from wire records; auth
   state summarized as `holdsToken`).
5. **Status view** — JSON + HTML matrix renders one live-kind and one sim-kind tenant with
   kind badges, auth state, per-module aggregation, and the self-reported banner.

**Test totals:** `npm test` → 7 files, 86 tests, all passing (75 baseline from M1+amendment,
11 new). `npm run build` clean. Real-daemon smoke: `node dist/service/cli.js serve --port 4691`
→ `/health` `{"ok":true,"mode":"auth-state-only",...}`, `/status` HTTP 200.

## Deviations / notes

1. **`TenantHttpKeyProvider.resolveTenantKeys` is synchronous in the ratified interface**, which
   no HTTP transport can implement. NOT silently changed. The service client ships an async
   method of the same name/semantics (incl. `TenantKeysError` rehydration), and
   `connectTenantSurfaces()` exposes `resolveTenantKeys` as async in BOTH transports so call
   sites are transport-agnostic. **v2 amendment candidate for the founder:** make the ratified
   signature `Promise<TenantKeys>` before M3 (muster-api) wires up.
   **RESOLVED (founder, 2026-07-11): ratified signature amended to `Promise<TenantKeys>`** —
   breaking, released as **0.4.0**; `TenantServiceClient` now implements `TenantHttpKeyProvider`
   exactly; muster-api (which had adopted at M3, commit 8e591b6 in ces-muster) updated in the
   same coordinated change: `tenantKeysService.resolveTenantKeys` is async and the three
   `harvest.ts` call sites await it. No other repo calls `resolveTenantKeys` directly
   (stamper/eo/ao/tester consume the already-async surfaces), verified by grep.
2. **Auth handover path:** raw bearer material leaves the daemon ONLY via `POST /api/auth/claim`
   (localhost, per-OS-user, consumer-attributed, ledger-recorded). Requirement 5 says "never
   raw tokens where avoidable" — for auth-state-only handover it is not avoidable by
   definition (v2's session proxy is the design that avoids it). Status/activity/registry
   responses are redacted by construction.
3. **Gate 2's process boundary** is approximated (see gate 2 note above). A true two-OS-process
   demo rides naturally with the first real consumer adoption (M2/M3), when a second module
   actually connects.
4. **`GET /api/tenants` requires `?kind=`** — the ratified registry surface is `listByKind`;
   an unfiltered list would be new surface the interfaces do not name.
5. **Registry reads over the service return records without `evidenceStorage`** (it can carry
   resolved secret material and is outside the scope fence). Library-transport reads are
   unchanged. Flagged here because it is an observable transport difference.

## Follow-ups

- Founder: v2 amendment decision on async `resolveTenantKeys` (deviation 1) — cheapest before
  M3 (muster-api) adopts.
- Consumer adoption (M2–M5) flips modules to `connectTenantSurfaces()` by configuration; the
  Stamper cutover goal (`ces-stamper/docs/goals/G-TENANT-M1.md`) is still the open co-owned
  half of M1 and now has the service transport available to it as well.
- v2 candidates, explicitly deferred by the 2026-07-11 resolution: daemon-owned engine
  sessions (full session proxy), centrally-enforced ledger, warm-session sharing.
