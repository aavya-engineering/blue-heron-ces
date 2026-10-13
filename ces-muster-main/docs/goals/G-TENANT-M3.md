# Goal Document — G-TENANT-M3

**Provenance:** Founder-directed. M0 interface gate passed 2026-07-10 (founder review of
`ces-tenant`'s `src/*.ts` interfaces: approved as ratified). ces-tester promoted to named
consumer by founder direction 2026-07-10. This brief authored 2026-07-10, distributed from the
`ces-strategy` session that executed the M0 interface work. Self-contained — a fresh session in
this repo needs nothing outside this file, the design doc, and `ces-tenant`'s `README.md` +
`src/*.ts` (read-only, in the sibling repo).

## Job

`muster-api/src/services/tenantKeysService.ts`'s `resolveTenantKeys()`
(lines 50-107) solves the same "given a tenant slug, resolve credentials and endpoints" problem
Stamper and ces-eo solve, a third time, independently, with a materially different transport: pure
`fetch()`-based HTTP against Microsoft Graph and the OAuth token endpoint, no PowerShell, no
process spawning (design doc §1, item 3). It still reads the *same* underlying tenant-config
convention Stamper produces
(`{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/<slug>.json`), via a vendored copy of
`ces-shared`'s `TenantConfig.ts`/`resolveTenantJsonPath` under
`muster-api/src/vendored/ces-shared/`. This goal cuts muster-api's `tenantKeysService` over to
resolving tenants via `ces-tenant`'s HTTP surface instead of hand-constructing plan-data paths and
loading tenant JSON directly.

## Must-NOTs (scope fence)

- Do not continue constructing `{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/<slug>.json` paths
  inside `tenantKeysService.ts` (the `resolveTenantJsonPath` logic) after this milestone. Tenant
  resolution must go through `ces-tenant`'s HTTP surface exclusively (design §6, per-consumer
  requirement for muster-api).
- Do not attempt to mint cert-assertion tokens locally in muster-api. This is already correctly
  out of scope today (explicit code comments at `tenantKeysService.ts:3-7` and
  `harvest.ts:94,113`: "cert-assertion token minting not implemented in muster-api") — this goal
  must not accidentally take on that responsibility while restructuring the surrounding code. If
  the founder later wants that responsibility delegated through `ces-tenant`'s HTTP surface, that
  is a separate decision (design §6), not implied by this milestone.
- Do not silently retire `muster-api/src/vendored/ces-shared/` as part of this migration. Whether
  the vendored copy is retired at M3 or kept as a fallback is an **explicit open decision** (design
  §8, item 5) that this goal must surface to the founder, not resolve unilaterally. Flag it in the
  implementation log as an open question with both options stated; do not delete the vendored
  directory or the `vendor-manifest.json`/`check-vendor-drift.mjs` tracking for it without an
  explicit founder go-ahead captured in this goal's log.
- Do not give the browser-bundled top-level React app (the separate `vite.config.ts`-driven build
  at the ces-muster repo root, distinct from `muster-api/`) a direct Node-package import of
  `ces-tenant`. Design doc §7 is explicit: a browser consumer cannot import a Node package safely;
  anything the browser app needs must go through HTTP, same as `ces-shared` was vendored/isolated
  rather than imported. This goal's scope is `muster-api` (the Node/Express service) only.
- Do not add hand-built plan-data path construction anywhere else in muster-api as a workaround
  while this migration is in progress — if `ces-tenant`'s HTTP surface is temporarily unavailable
  or incomplete, that blocks this goal; it does not license a new hand-rolled resolver.

## Acceptance Gate

1. `tenantKeysService.ts` no longer independently constructs
   `{CES_PIPELINE_ROOT}/Stamper/plan-data/<slug>/<slug>.json` paths — it resolves tenants purely
   via calls to `ces-tenant`'s HTTP surface (design §5, M3 gate, quoted verbatim: "muster-api no
   longer independently constructs... paths itself; it resolves tenants purely via HTTP").
2. The public contract `resolveTenantKeys(slug: string | undefined): TenantKeys` (or its HTTP-
   surface-backed equivalent) preserves the existing behavior recorded in `ces-tenant`'s
   `http-surface.ts` doc comments: slug given → resolve from tenant config, missing file throws
   `tenant_not_found`; no slug → env-var fallback (`GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID`), missing
   env throws `degraded`. Existing muster-api callers of `resolveTenantKeys` must not observe a
   behavior change from this migration alone.
3. muster-api's existing test suite passes with zero regressions.
4. The vendored-`ces-shared` retirement question is explicitly logged as open in this goal's
   implementation log, with both options stated (retire now vs. keep as fallback) and no default
   action taken without founder sign-off.
5. Encoding gate: `grep -c 'â€'` returns 0 on every file touched by this goal.

## Preconditions

- **Blocked on M1 shipping.** This goal does not start until `ces-stamper`'s cutover
  (`ces-stamper/docs/goals/G-TENANT-M1.md`) and `ces-tenant`'s M1 implementation
  (`ces-tenant/docs/goals/G-TENANT-1.md`) are complete — muster-api's HTTP surface consumption
  depends on `ces-tenant` having a real implementation behind its interfaces, not just the M0
  interface definitions. Do not begin implementation work under this goal until that precondition
  is confirmed closed.

## Pointers (read-only — do not copy content into new files)

- Design doc: `ces-stamper/docs/design/tenant-manager-extraction.md` — §1 item 3 (the
  independent-third-implementation finding), §2.4 point 2 (the HTTP surface's design rationale,
  including why muster-api gets HTTP rather than a direct Node import despite being pure Node/
  Express), §5 (M3 gate detail, quoted above), §6 (muster-api's specific per-consumer
  requirements), §8 item 5 (the vendored-ces-shared open decision this goal must surface, not
  resolve).
- Ratified interfaces (sibling repo, read-only): `ces-tenant/src/http-surface.ts`
  (`TenantHttpKeyProvider`, `TenantKeys`, `TenantKeysErrorCode`) — the exact contract this
  migration targets.
