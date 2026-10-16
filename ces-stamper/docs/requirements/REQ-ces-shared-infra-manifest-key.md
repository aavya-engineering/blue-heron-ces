# REQ: Reconcile infrastructure manifest key name (ces-shared) — CLOSED

**Filed by:** ces-stamper flow-through session (2026-09-26)
**Status:** CLOSED 2026-09-27 — ces-shared S3 `b9b1ace` made `infrastructure` the canonical key and accepts `infrastructure_manifest` as a deprecated alias (normalized onto `infrastructure`). Stamper T4 `d668c16` reads the canonical key at every infra parse site (CLI, translate route, baseline route) through the shared `InfraManifestSchema`. Acceptance verified by `tests/unit/SharedMissionPlanDelegation.test.ts` ("reads the canonical infrastructure key", "normalizes the deprecated infrastructure_manifest alias onto infrastructure").
**Blocks:** Full contract alignment between Muster → Stamper infra manifest path
**Note (2026-09-27):** The CLI dual-prefix *filename* handling landed at `8d5c364` (T1), not `d6bee47` as previously stated. This REQ is about the JSON *key* inside the MP envelope, which is a separate issue.

## What

The shared contract in `ces-shared/src/types/mission-plan.contract.ts` uses the key
`infrastructure` for the infrastructure manifest inside the mission plan envelope.
Stamper's internal schemas and code use `infrastructure_manifest` (with underscore suffix).

This mismatch means Stamper cannot directly destructure the shared type's
`infrastructure` key without a rename, and any future contract enforcement will
silently drop the infra manifest or require a mapping shim.

## Evidence

- Shared: `ManualMissionPlanSchema.outputs.infrastructure` (mission-plan.contract.ts)
- Stamper: `CESOutputsBlockSchema.tenant_manifest` + separate `infrastructure_manifest`
  parameter in `PlanTranslator.translateFile()` and CLI `--manifest` heuristic
- CLI heuristic (`src/cli/index.ts:275-289`) already handles both `infrastructure-manifest`
  and `infra-manifest` filename prefixes, but the JSON key inside the MP envelope is the issue.

## Why it matters

When Muster writes a plan with `outputs.infrastructure`, Stamper won't find it at
`outputs.infrastructure_manifest`. The current workaround is that infra manifests are
passed as a separate file, but contract alignment should use a single canonical key.

## Acceptance test

A ces-shared unit test round-trips a mission plan with the infrastructure manifest
under the canonical key name, and Stamper's parser finds it at that key without
a rename shim.

## Recommendation

Pick one canonical key (`infrastructure` or `infrastructure_manifest`) in the shared
contract and update all consumers. `infrastructure` (the shorter form) is already in
the shared schema; Stamper should adopt it.
