# REQ: ces-shared — Versioned Mission Plan Contract — CLOSED

**Filed by:** ces-stamper flow-through (MS-R1, MS-R4)
**Date:** 2026-09-26
**Closed:** 2026-09-27 — ces-shared commits `08e50bb` (MS-R1+R4) and `a6d3915` (MS-R9) landed the shared contract. Stamper adopted version gate at `6020f68`, fedramp_package_id at `6020f68`, cesId pre-existing.
**T4 note (2026-09-27):** body validation fully delegated at Stamper `d668c16` once ces-shared S4 `2e168a6` typed the bodies (N-14). Private MMP/TM/IM/directive schemas deleted; Stamper-only rules are `.superRefine` on the shared schemas.
**Blocks:** MS-R1 (Stamper adopts shared plan/manifest schemas), MS-R4 (Stamper carries cesId + fedramp_package_id)

## What

ces-shared must export a versioned Zod contract for:
- `ManualMissionPlan` (with `controls[]` carrying `stamper_action`, `inheritance_rationale`, `fedramp_package_id`, `tenant_variant`, `requires_stamper_verification`)
- `TenantManifest`
- `InfraManifest`
- `ControlDirective` (with the 5 Muster `StamperAction` values: `automated`, `N-A-Capability-Absent`, `Met-By-Prohibition`, `Inherited-FedRAMP`, `nonstack`)
- `contractVersion` / `schema_version` field that Stamper validates on load
- `cesId` / `customerId` identity fields

## Why

Stamper currently validates plans against its own private Zod schemas in `ces-artifacts.types.ts`. There is no shared contract with Muster. Version mismatches are silent. Muster fields like `cesId`, `fedramp_package_id` and `inheritance_rationale` are dropped because the private schema doesn't know about them.

## Evidence

- `ces-strategy/docs/context/module-status/flow-muster-stamper.json` — recommendations MS-R1, MS-R4
- `ces-stamper/src/types/ces-artifacts.types.ts` — private schemas that would be replaced
- `ces-muster/src/features/plan/planCompileService.ts` — Muster's output structure

## Acceptance test

- A ces-shared unit test parses a checked-in Muster-generated MP + TM fixture AND a legacy ces-planner fixture.
- `contractVersion` mismatch produces a clear Zod error, not a silent pass.
- The contract exports `cesId`, `fedramp_package_id`, `inheritance_rationale`, `tenant_variant`, `requires_stamper_verification`.
- Stamper and Muster both typecheck against the shared types (verified in each module's own session).

## Stamper adoption (what we'll do once this lands)

1. Replace `CESManualMissionPlanSchema`, `CESTenantManifestSchema`, `CESInfrastructureManifestSchema` imports with the ces-shared contract.
2. Add `contractVersion` validation at plan load time — reject unknown versions with a clear error.
3. Carry `cesId` into the executable plan (populate `_source_paths.cesId`).
4. Use the directive's `fedramp_package_id` before the tenant fallback in inherit-fedramp evidence.
