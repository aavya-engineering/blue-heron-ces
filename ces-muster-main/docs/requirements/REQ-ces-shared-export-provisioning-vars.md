# REQ: ces-shared: export STAMPER_PROVISIONING_REQUIRED_VARIABLES on the public subpath

**Filed by:** ces-muster (W4-MU1, 2026-09-27)
**Target module:** ces-shared
**Priority:** P3
**Status:** DONE (2026-09-28, FC-MU-4).

`STAMPER_PROVISIONING_REQUIRED_VARIABLES`, `INFRA_VARIABLE_ALIASES` and `normalizeInfraVariableMap` are declared
in `src/types/mission-plan.bodies.ts` (2.5.0). They are not re-exported from `ces-shared/types/mission-plan`,
which is the only mission-plan subpath in `package.json` `exports`. Muster's acceptance test
(`muster-api/tests/plan.fullSession.infra.contract.test.ts`) therefore has to carry its own copy of the list.

**Ask:** re-export them from `mission-plan.contract.ts`, the same way the body schemas are re-exported. Then
Muster can import the list and drop its copy.

## Closed (2026-09-28, FC-MU-4)
Already satisfied: `mission-plan.contract.ts` does `export * from './mission-plan.bodies.js'` since 2.5.0/FX-SH2,
so `STAMPER_PROVISIONING_REQUIRED_VARIABLES` was reachable from `ces-shared/types/mission-plan` all along
(ces-shared's own FC-SH changelog re-verified this with a new test rather than re-exporting). Muster's side was
the actual gap: `plan.fullSession.infra.contract.test.ts` still carried its own hardcoded 14-variable array.
Dropped in commit `2a5ef63` — the test now does
`import { STAMPER_PROVISIONING_REQUIRED_VARIABLES } from 'ces-shared/types/mission-plan'` and iterates that list
directly. `muster-api` test suite green (51 files, 424 passed, 3 pre-existing skips).
