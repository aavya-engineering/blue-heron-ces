# REQ — ces-tester: send `confirmApply` on direct live POSTs to AO's execute route

- **Filed by:** ces-ao (W4-AO5, 2026-09-27)
- **Target:** ces-tester (any code that POSTs `/api/execute/:commandId` directly with `dryRun:false`)
- **Status:** OPEN

## What changed in ces-ao
The web execute route now has a live-apply guard (`src/execution/ApplyGuard.ts`, wired in
`src/server/routes/execute.routes.ts`), matching the CLI's `--apply` and MCP's `AO_MCP_ALLOW_APPLY=1`:
a request with `dryRun:false` must also carry `confirmApply: "<commandId>"` (the exact command id). Without it the
route answers **428**, `applyGuard: "refused"`, never calls the executor, and persists a refusal evidence row
(live, contract outcome `failed`, verdict `NOT_APPLICABLE`, local outcome `denied_apply_guard`).
Dry runs (`dryRun:true` or omitted) are unaffected. Tests: `test/applyGuard.routes.test.ts`.

## Effect on ces-tester
- UI-driven runs (`src/demo/ao-ui-driver.ts`, `ao-leg.ts`) are unaffected: the served UI adds `confirmApply` when the
  Live Execution toggle is on (tested in AO against the real `public/index.html`).
- Direct HTTP callers are affected, e.g. the flow-through worktree's `src/flow/ao-eo-flow.ts` (`dryRun: req.dryRun`):
  a live leg will now get 428 instead of executing. Tier-3 live requests (opening the approval, and the approved
  re-POST) also need it.

## Ask
Add `...(dryRun ? {} : { confirmApply: commandId })` to every direct live POST, and treat 428 +
`applyGuard: "refused"` as a distinct, expected refusal in deny-path assertions.

## Acceptance
Tester's AO live legs pass against AO HEAD; a deliberate unconfirmed live POST is asserted as a 428 refusal with a
persisted evidence row.
