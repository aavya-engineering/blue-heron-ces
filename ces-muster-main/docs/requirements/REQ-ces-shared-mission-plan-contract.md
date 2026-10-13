# REQ: ces-shared — Versioned Mission Plan Contract

**Filed by:** ces-muster (flow-through MS-R1, 2026-09-26)
**Target module:** ces-shared
**Priority:** P0 (blocks flow)

## Status: CLOSED (2026-09-27)

**Satisfied by:** ces-shared commit `08e50bb` (flow-through MS-R1 + MS-R4: mission-plan contract
with inheritance metadata). The canonical contract lives at
`ces-shared/src/types/mission-plan.contract.ts`, exported as `ces-shared/types/mission-plan`.

ces-shared S4 landed at `2e168a6` (typed body schemas, `ces-shared/src/types/mission-plan.bodies.ts`),
with S1's dist rebuild + freshness guard at `dcb3b08`.

Muster M3 consumed it (2026-09-27, resumed run): `muster-api` depends on `ces-shared` via
`file:../../ces-shared`; `muster-api/src/contracts/missionPlan.contract.ts` is now a re-export of
`ces-shared/types/mission-plan` plus a safeParse adapter; the provisional local schema is gone.
Proven by `muster-api/tests/missionPlan.generator.contract.test.ts` (real `compilePlanForSession`
output parses with the shared schema).

---

## Original Request (for history)

Create a versioned Zod contract in `ces-shared/src/types/mission-plan.contract.ts` defining:
- `ManualMissionPlanSchema` (ces meta with date-only generated_on, inputs, outputs with human_readable_mission_plan + cost_proposal_sow)
- `TenantManifestSchema` (ces meta with datetime generated_on, tenant_manifest body)
- `StamperDirectiveEnum` (the 9 directive values Stamper accepts)
- `ControlDirectiveSchema` (with inheritance fields: inheritance_rationale, fedramp_package_id, tenant_variant, requires_stamper_verification)
- `validateMissionPlan` / `validateTenantManifest` helpers that reject unknown `ces.version`
- Export from `ces-shared/types/mission-plan`
