# REQ: ces-muster — Infrastructure Manifest via Tenant Config Profile (MS-R7)

**Filed by:** ces-muster (flow-through MS-R7, 2026-09-26)
**Target module:** ces-muster (self — PLAN-3 milestone M3)
**Priority:** P2 (Phase 5)
**Status:** RESOLVED by W4-MU1 (commit 299cac2, 2026-09-27). It had been retired to the backlog earlier on
2026-09-27 and deferred to W4 per founder decision F-5. Acceptance 1 and 3 are met in Muster. Acceptance 2
(0 unresolved variables in a stacksim dry run) is ces-stamper W4-ST2, which consumes
`src/features/plan/__fixtures__/infrastructure-manifest.json`.
Self-filed (not cross-module). Depends on PLAN-3 M3 (TCP input surface).

## What

Produce the Infrastructure Manifest (or an explicit `infrastructure_model` +
variables block) for m365_azure sessions once the Tenant Config Profile (TCP)
input lands in PLAN-3 M3. The infra manifest feeds Stamper's translate step so
it doesn't depend on a manual variable seed.

## Why

Today, for sessions with infrastructure beyond M365 (e.g. m365_azure), the
vendored generators produce an infrastructure manifest only when `tenantConfig`
is non-null. Muster currently passes `tenantConfig: null` because the TCP input
surface (PLAN-3 M3) hasn't been built yet. Stamper's translate step needs either
the infra manifest or manually-seeded variables — the flow assessment flagged
this as a dependency gap.

## Depends On

- **PLAN-3 M3 (Tenant Config Profile):** The TCP surface collects the Azure
  infrastructure parameters (subscription, resource groups, networking model)
  that feed the infra manifest generator. No code exists yet.

## Acceptance Test

1. For an m365_azure session with a TCP filled in, Muster emits an infra
   manifest that passes `CESInfrastructureManifestSchema`.
2. A Muster-generated fixture run through stacksim dry-run has 0
   unresolved-variable warnings.
3. The Plan tab shows the Infrastructure Manifest document in the doc list
   (it already conditionally renders when `artifacts.infrastructureManifest`
   is non-null — see `planCompileService.ts:160`).

## Muster's Current State (HONEST-OPEN)

The generator and conditional rendering are already wired. The blocker is
PLAN-3 M3: until the TCP input surface exists, `tenantConfig` stays null and
no infra manifest is produced. This is an internal Muster dependency, not a
cross-module one.
