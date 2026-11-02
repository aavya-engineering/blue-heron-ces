# REQ: ces-shared — typed parse output for ManualMissionPlanSchema

**Filed by:** ces-stamper flow-through session, T4 (MS-R1 / N-14), 2026-09-27
**Status:** OPEN — low priority; does not block Stamper (workaround in place)
**Target:** `ces-shared/src/types/mission-plan.contract.ts`

## What

`ManualMissionPlanSchema` is declared as `z.ZodType<Record<string, unknown>>`, so its parse output
(and the exported `ManualMissionPlan` type) is untyped. The envelope pieces that would let a consumer
recover the type are not exported: `CesPlanMeta` and `OutputsBlockSchema` are module-private, and
`mission-plan.bodies.ts` sub-schemas (`CheckSchema`, `NormativeControlSchema`, …) are not reachable
through the `./types/mission-plan` package export.

## Why it matters

After T4, Stamper validates with the shared schema (plus Stamper-only `.superRefine` rules), but has to
declare the parsed shape itself as a TypeScript interface (`CESPlanMeta`, `CESManualMissionPlan` in
`ces-stamper/src/types/ces-artifacts.types.ts`) and cast the schema's output to it. That interface is a
type-level mirror of the shared envelope; it can drift silently if the envelope changes.

## Acceptance test

- `z.infer<typeof ManualMissionPlanSchema>` exposes `ces.cesId`, `outputs.human_readable_mission_plan.steps`
  and `outputs.tenant_manifest` with their shared types (a type-level test in ces-shared compiles).
- Optionally export `CesPlanMetaSchema` (or its inferred type) from `./types/mission-plan`.

When this lands, Stamper deletes `CESPlanMeta` / `CESManualMissionPlan` and the cast.
