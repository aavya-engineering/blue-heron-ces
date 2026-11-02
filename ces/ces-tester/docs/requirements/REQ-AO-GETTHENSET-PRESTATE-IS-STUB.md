# REQ-AO-GETTHENSET-PRESTATE-IS-STUB

**Filed by:** ces-tester (GP-DEMO-3, M0 drivability spike)
**Date:** 2026-08-29
**Against:** `ces-ao` (with a contributing behaviour in `ces-stamper`'s `PowerShellAdapter`)
**Severity:** HIGH — AdminOps' headline evidence claim ("get-then-set captures pre- and
post-state") is not true today. Every `get-then-set` evidence record carries a literal
placeholder string where the real tenant state should be, **including on a live apply**.
**Status:** OPEN — ces-tester is boundary-bound and will NOT patch this.

## Summary

`GetThenSetExecutor` captures pre-state and post-state by calling
`adapter.execute(task, variables, true)` — the third argument is `dryRun`, **hardcoded
`true`** on both calls. `PowerShellAdapter.execute` short-circuits on `dryRun` and returns a
stub without running anything. So `metadata.preStateOutput` and `metadata.postStateOutput`
are the constant string `[dry-run] PowerShell commands validated`, no matter what actually
happened to the tenant.

The comment immediately above the pre-state call states the **opposite** intent — "run it
live even in dryRun so the operator sees the real current state" — so this reads as a bug,
not a design choice.

## Evidence (measured on a LIVE apply, not a dry run)

A-18 "Default User Permission Lockdown" executed through the AdminOps GUI against a
stacksim tenant, Live Execution toggle ON, `dryRun: false`. The write genuinely landed —
the sim's `authorizationPolicy` changed and the stacksim ledger recorded a mutation:

```
authorizationPolicy BEFORE: {"allowedToCreateApps":true,  "allowedToCreateSecurityGroups":true,  "allowedToCreateTenants":false, ...}
authorizationPolicy AFTER:  {"allowedToCreateApps":false, "allowedToCreateSecurityGroups":false, "allowedToCreateTenants":false}
ledger mutations: 95 -> 96 (delta 1)
```

The evidence record persisted for that same execution:

```json
"metadata": {
  "commandExecuted": "Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/authorizationPolicy' -Body @{ defaultUserRolePermissions=@{ allowedToCreateApps=$false; ... } }",
  "sha256Hash": "0190614b68378817340dec14fad65f836c4630d410c7a712123f88bf0e6498a5",
  "stateChanged": true,
  "preStateOutput":  "[dry-run] PowerShell commands validated",
  "postStateOutput": "[dry-run] PowerShell commands validated"
}
```

`stateChanged: true` and `commandExecuted` are **real**. `preStateOutput` and
`postStateOutput` are **stubs**. A real pre-state would have shown
`allowedToCreateApps: true`; a real post-state, `false`.

The AO server's own log shows the three-call shape and the hardcoded dry-run flags:

```
[PowerShellAdapter] execute(A.A-18) — legacy single-command path, dryRun=true    <- pre-state (stub)
[PowerShellAdapter] execute(A.A-18) — legacy single-command path, dryRun=false   <- the real apply
[PowerShellAdapter] execute(A.A-18) — legacy single-command path, dryRun=true    <- post-state (stub)
```

## Code path

| File | Line | Detail |
|---|---|---|
| `ces-ao/src/execution/GetThenSetExecutor.ts` | 62-63 | comment: "run it live even in dryRun so the operator sees the real current state" |
| `ces-ao/src/execution/GetThenSetExecutor.ts` | 64 | pre-state: `adapter.execute(task, variables, true)` — `true` is `dryRun` |
| `ces-ao/src/execution/GetThenSetExecutor.ts` | 87 | post-state: same hardcoded `true` |
| `ces-stamper/src/adapters/PowerShellAdapter.ts` | 134-156 | returns `stdout: '[dry-run] PowerShell commands validated'` without executing |
| `ces-stamper/src/adapters/PowerShellAdapter.ts` | 302, 639, 1206 | both adapter paths short-circuit on `dryRun` |
| `ces-ao/src/execution/CommandExecutor.ts` | 326 | `stateChanged = applied = setResult.success` — this one IS real |

## Impact

- **Compliance/audit:** a `get-then-set` evidence record is meant to be the artifact that
  proves what the tenant looked like before and after an admin action. Right now it proves
  neither. An assessor reading `preStateOutput` gets a placeholder.
- **ces-tester / GP-DEMO-3:** the AO demo beat must NOT narrate pre-state capture. The
  demo's success predicate deliberately asserts on `stateChanged`, `commandExecuted`,
  `sha256Hash`, the WORM row's existence, and an independent stacksim ledger mutation —
  and explicitly **does not** assert on `preStateOutput`/`postStateOutput`. The honest
  claim is "evidence of the change was auto-collected", not "pre-state was captured".
- This contradicts the ces-tester vault's summary of AO ("get-then-set pre-state evidence"),
  which should be corrected once this is fixed.

## Suggested fix (for ces-ao to apply — NOT applied by ces-tester)

Pass `false` for the pre/post-state reads so the GET actually runs, matching the stated
intent — the pre/post tasks are reads, so running them live is safe even inside a dry run
(that is precisely what the comment argues). Guard on the task being a read if extra safety
is wanted. Add a test asserting `preStateOutput` differs from `postStateOutput` for a
command that changes state.

## Cross-reference

- `docs/demo/E2E-GROUNDING-EVIDENCE.md` finding #6b
- `docs/demo/PLAN-E2E-AO-DEMO.md` FD-3 and success predicate item 7
- Evidence: `runs/m0-spike/m0-001/ao/evidence-row.json`, `.../execute-A-18-response.json`, `.../ao-gui.log`
