# ces-tenant

TenantManager — the single, common tenant-connection package for CES. Owns
*tenant connection*: registry of tenant records (live and sim), connection
profiles, auth strategies, and the two client surfaces (PowerShell
session-factory, HTTP token/endpoint provider) that every CES module uses to
connect to a tenant. Nothing else.

## Status: M1 delivered + M6 v1 service (auth-state-only)

Two delivery modes ship from this package (goal `docs/goals/G-TENANT-M6.md`,
record: `docs/M6-RECORD.md`):

- **Library (in-process)** — the M1 implementations below, unchanged.
- **Service (local daemon)** — `npm run serve` starts the stateful tenant
  service on `http://127.0.0.1:4690` (localhost only, user-run only). v1 is
  **auth-state-only** (founder resolution 2026-07-11): the daemon holds auth
  state (register/claim per tenant × engine service) so sign-in happens once
  per engagement, plus the cross-module observability surface — status page
  at `/status`, JSON at `/api/status` and `/api/activity` (append-only
  ledger, self-reported in v1 via the caller-identity amendment). Modules
  still run their own engine processes; the full session proxy is a possible
  v2.

Consumers pick transport with one call — service when up, library when not
(degrade, never block):

```ts
import { connectTenantSurfaces } from 'ces-tenant';
const surfaces = await connectTenantSurfaces({
  consumer: { module: 'ces-stamper', purpose: 'translate run' },
});
// surfaces.registry / surfaces.launch / surfaces.status / surfaces.resolveTenantKeys(...)
// surfaces.service?.claimAuthState(slug) — auth-state auto-connect when the daemon is up
```

## M1 — package-side implementation

M0 (interfaces only) passed founder review 2026-07-10; M1 implements the
package against those ratified interfaces (`docs/goals/G-TENANT-1.md`,
record: `docs/M1-RECORD.md`). Every interface member remains documented at
its declaration site with the Stamper/EO/tenant-stacksim/muster-api file:line
behavior it codifies; the implementations under `src/impl/` are
behavior-preserving ports of those cited sources:

- `FileTenantRegistry` (`TenantRegistryLifecycle`) — back-compat read order
  (new root → `CES_PIPELINE_ROOT/Stamper/plan-data/` → legacy
  `~/.stamper/tenants/`), one-time forward migration with `kind` stamping,
  and the A9 structural fix: physically separate `live/` and `sim/`
  namespaces under the new root (`~/.ces/tenants/`, `CES_TENANT_ROOT`
  overridable).
- `PersistentSessionFactory` (`TenantSessionFactory`) — Stamper's
  `SessionManager` orchestration (persistent hosts, marker protocol, queue,
  stale/respawn retry) with the process-spawn point injected as a
  constructor seam so connect/execute is testable without `powershell.exe`.
- `StacksimEnvironment` (`StacksimModeController` +
  `TenantLaunchContextProvider`) — `enableStacksimMode()`'s env mutation with
  `queryPsHomeModules` injected as a seam, plus the same bundle as data for
  external launchers; refuses launch-env requests for live tenants.
- `PlanDataTenantHttpKeyProvider` (`TenantHttpKeyProvider`) — muster-api's
  `resolveTenantKeys()`, no `child_process` anywhere in its import graph.

Still NOT implemented, by design: `TenantReachProbe` (`src/probe.ts` stays a
NEW-SCOPE placeholder) and the sovereign endpoint table — both are named new
design work (design doc §2.2, §2.5), not extraction. No code has moved out of
Stamper, ces-eo, muster-api, or tenant-stacksim; their cutovers are their own
milestones (Stamper's is co-owned: `ces-stamper/docs/goals/G-TENANT-M1.md`).

## Versioning policy (open decision §8.3 — M1 default)

Pre-1.0 semver, strict for consumers: **minor versions carry milestones and
any breaking interface/behavior change (called out in the milestone record);
patch versions are fixes/internal only and always safe to take.** Consumers
should pin an exact version (the family has already observed loose-specifier
drift — design doc §4). 1.0.0 lands when the last planned cutover (M4)
completes.

**RATIFIED 2026-07-11 (HY-TENANT, working-system Step 0): symlink + coordinated
breaking bumps is the operative policy.** All five consumers ride `file:` deps,
which npm materializes as symlinks — every consumer tracks HEAD instantly, so
pin-exact is unenforceable until a registry/tarball flow exists (it remains the
aspiration, not the rule). The operative rule: any breaking change lands as ONE
coordinated serial pass that updates every consumer call site in the same
change (the 0.4.0 precedent), scheduled so no parallel lane touches consumers
mid-pass (cross-cutting O5). Remote (`founder/ces-tenant`, private) and
`v0.x.y` tags added 2026-07-11; tags are the pin surface once consumers move
off symlinks. Changes are logged per release in `docs/M1-RECORD.md`-style
milestone records until a CHANGELOG is warranted. M0 = 0.1.0, M1 = 0.2.0,
M6 v1 = 0.3.0. **0.4.0 (BREAKING, founder-ratified 2026-07-11):
`TenantHttpKeyProvider.resolveTenantKeys` returns `Promise<TenantKeys>`** —
consumers must `await`; muster-api's call sites were updated in the same
change. **0.5.0 (additive, founder-ratified 2026-07-26): CMMC scoping fields
on `TenantRegistryRecord`** (`cmmcLevel`/`assessmentScope`/`cuiBoundary`/
`cmmcMigrationExempt`, GP-SHARED-M0-1 ces-tenant half) plus load-time Case-B
rejection (`cmmc_level` set without `cui_boundary`); pre-migration records
load unchanged — no consumer updates required.

## Scope / boundary (design doc §3 — explicit scope fence)

TenantManager owns tenant connection: the registry (`kind: 'live' | 'sim'`
tenant records), connection-profile/endpoint resolution, the auth-strategy
seam, and the two client surfaces. It does **not** own:

- Competitive-intel registries (unrelated domain).
- Evidence storage — `ces-shared/src/storage/node.ts` keeps owning
  `plan-data/<slug>/evidence/` path resolution; TenantManager's registry is
  about *who/how to connect*, not where evidence artifacts land once
  connected.
- Any business/domain logic specific to one module — no CMMC control mapping,
  no SSP generation, no harvest probe tables. Consumers do their own thing
  with a connected session/token from TenantManager.
- Anything that would make this a second monolith. Test for any proposed
  addition: "would a module *other than the one requesting this* also need
  it, purely for the purpose of connecting to a tenant?" If no, it doesn't
  belong here.

## Consumers (planned, per extraction milestones)

- **ces-stamper** — first consumer (M1). The model this package is extracted
  from.
- **ces-eo** — M2. Currently has a near-duplicate `SessionManager.ts` and two
  independently stale tenant-config-path readers; both get retired in favor
  of this package.
- **ces-muster** (`muster-api`) — M3, via the HTTP surface.
- **tenant-stacksim** — M4, sim config emission through this package's
  registry API instead of hand-constructed JSON.
- **ces-tester** — named M0 consumer (founder direction, 2026-07-10; see
  `ces-tester/PLAN.md`). Its orchestrator needs ephemeral per-scenario
  `kind: 'sim'` tenant lifecycle (create/query/teardown,
  `TenantRegistryLifecycle` in `src/registry.ts`), kind-filtered registry
  queries so it never targets a live tenant (`listByKind`, same file), a
  sim-tenant ready-check (`probeSimReady`, `src/probe.ts`, NEW-SCOPE) instead
  of hand-rolled polling, and the sim launch-context env bundle
  (`TenantLaunchContextProvider`, `src/launch-context.ts`) so its
  `stamper-launcher` doesn't re-derive `StacksimMode`'s env mutation a second
  time. Adoption timing (which milestone actually wires ces-tester to this
  package) is not decided by this M0 deliverable — only the interface
  coverage is.
- **ces-ao** — M5, when tenant-connection needs materialize; not scheduled
  yet.

Consumers depend on **versions** of this package, not on a workspace-hoisted
path — see the design doc §4 for why this is a standalone sibling repo, not a
subpath of `ces-shared`.

## Build / test

```bash
npm run build   # tsc
npm test        # vitest run
npm run serve   # build + start the local tenant service (M6, port 4690)
```

## Design doc

See `docs/design.md` — a pointer to the authoritative design document,
`ces-stamper/docs/design/tenant-manager-extraction.md`, which this package's
interfaces are extracted from.

## License

PROPRIETARY — BHD-VFS
