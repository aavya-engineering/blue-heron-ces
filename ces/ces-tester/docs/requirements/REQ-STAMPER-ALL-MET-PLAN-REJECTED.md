# REQ-STAMPER-ALL-MET-PLAN-REJECTED — Stamper rejects Muster's all-met Mission Plan (`steps: []` fails a Stamper-only `min(1)`)

- **Status:** CLOSED 2026-09-27 (fix batch FX-TE2). Answered by ces-stamper FX-ST1 `6c8571c` (the `steps` min(1)
  refinement now applies only to plans with no `control_directives`). ces-tester re-ran X1 against it: the
  all-met case translates in directive mode, every consumed field lands, 110 directives, validate > 0, no
  implement. The `KNOWN_UPSTREAM_OPEN` entry and both `test.fails` markers are removed; the evidence test
  now asserts acceptance. Filed 2026-09-27, flow-through X1 / MS-R3.
- **Owner:** ces-stamper (step T4 — contract adoption / body validation delegated to ces-shared)
- **Filed by:** ces-tester, branch `flow-through-2026-09`
- **Unblock condition:** `PlanTranslator.translate()` accepts a Mission Plan that ces-shared's
  `ManualMissionPlanSchema` accepts and whose `control_directives[]` are all `validate`/`manual`
  with `steps: []` — i.e. the all-met plan Muster's real generator emits. When that holds, the two
  `test.fails` markers in `tests/contract/muster-stamper.contract.test.ts` flip red; remove the
  `KNOWN_UPSTREAM_OPEN` entry and the `test.fails` on the all-met test, and close this REQ.

## Evidence (real upstream output, not a fixture)

Input: `ALL_MET_CASE` in `src/flow/muster-plan-cases.ts` — every requirement in Muster's
requirements store reported `met`. Plan produced by Muster's real generator
`ces-muster/src/features/plan/tenantManifestAdapter.ts#buildPlanArtifacts` (ces-muster `179260c`).

| Stage | Result |
|---|---|
| Muster generator | `steps: []`, 110 `control_directives` (104 `validate`, 6 `manual`) |
| ces-shared `ManualMissionPlanSchema` (dist, ces `d668c16`) | **accepts** (`steps` is optional, no minimum) |
| ces-stamper `PlanTranslator.translate` (src, ces `d668c16`) | **throws** `Mission plan validation failed: outputs.human_readable_mission_plan.steps: Array must contain at least 1 element(s)` |

Source of the rejection: `ces-stamper/src/types/ces-artifacts.types.ts:196`,
`refineHumanPlan` → `refineWith(z.array(z.any()).min(1), plan.steps, …)` — a Stamper-only refinement
layered on top of the shared schema.

## Why it matters

A customer whose readiness posture is fully met gets a plan Stamper cannot translate, so the
"validate everything" run (the re-assessment path) is impossible. The shared contract and Stamper
disagree, which is the exact divergence the ces-shared contract (MS-R1) exists to remove. This is
the `min(1)` risk the 2026-09-27 instructions asked X1 to settle: it is real.

## Requested change

Drop the `steps` `min(1)` refinement (or make it conditional on at least one `implement`
directive). Directive-mode translation already handles `validate`/`manual` without steps.
