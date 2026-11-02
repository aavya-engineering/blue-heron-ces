# REQ-STAMPER-DIST-STALE — Stamper's runnable `dist/` predates the flow-through contract work in `src/`

- **Status:** CLOSED 2026-09-27 (fix batch FX-TE2). Answered by ces-stamper FX-ST2 `2932e92` (dist rebuilt +
  `findStaleDist` start-up guard; the built CLI exits 3 on a stale dist). Verified read-only at run time:
  `findStaleDist(ces-stamper)` = `[]` (dist/cli/index.js built 2026-09-27 11:47, after FX-ST5 `b90602a`).
  X2 re-run `ft-te2-x2-1` against that dist: **PASS** (3/3 assertions; Stamper 110 tasks, 97 completed,
  13 failed — same split as `ft-x2-2`, outside this scenario's assertions). Filed 2026-09-27, flow-through X2 / MS-R10.
- **Owner:** ces-stamper
- **Filed by:** ces-tester, branch `flow-through-2026-09`
- **Unblock condition:** `ces-stamper/dist/` is rebuilt from the committed `src/` that carries MS-R2
  (`3b43e84`), MS-R1/R4/R9 (`6020f68`) and T4 (`d668c16`), and a freshness check (like ces-shared's
  `dist-freshness.test.ts`) keeps it from drifting again. ces-tester then re-runs
  `run-scenario scenarios/clean-tenant-mfa-baseline.json` against the rebuilt dist and records it.

## Evidence

| File | mtime (2026-09-27 check) |
|---|---|
| `ces-stamper/dist/cli/index.js` | 2026-09-09 21:01 |
| `ces-stamper/dist/translators/PlanTranslator.js` | 2026-09-09 21:01 |
| `ces-stamper/dist/types/ces-artifacts.types.js` | 2026-09-09 21:01 |
| `ces-stamper/src/translators/PlanTranslator.ts` | 2026-09-26 23:10 |
| `ces-stamper/src/types/ces-artifacts.types.ts` | 2026-09-27 10:32 |

Every Stamper runtime path ces-tester drives (`node ces-stamper/dist/cli/index.js translate|execute`,
`src/stamper-launcher/launch.ts`) runs the 09-09 build. So:

- X1 (`tests/contract/muster-stamper.contract.test.ts`) proves the **src** contract (it imports the
  `.ts` sources), and
- X2 (`run-scenario clean-tenant-mfa-baseline`, PASS on 2026-09-27) proves the **dist** runtime.

They are not the same code. X2 passed on the 09-09 dist for this scenario's plan (Automated and
Non-Stack rows only), but nothing proves the dist handles every change made in src since (e.g. the
T4 body validation, the all-met `steps` refinement in REQ-STAMPER-ALL-MET-PLAN-REJECTED). A plan could
pass X1 and still behave differently at runtime.

## Boundary

ces-tester did not rebuild the sibling (write boundary). Rebuilding is the owner's action.
