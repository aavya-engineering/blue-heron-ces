# REQ: ces-mono root MCP launcher (and any other externally-launched AO GUI/MCP process) — stacksim routing (from ces-ao, FC-AO / AO-20, 2026-09-27)

**Target:** the ces-mono root `.mcp.json` (`ces-adminops` entry), and whoever operates `ao gui` outside a shell
that already has stacksim env exported.
**Filed by:** ces-ao, feature completion (FC-AO / AO-20). ces-ao did not edit the root file (write boundary).

## What changed in ces-ao
- `CommandExecutor.ts` now calls `isStacksimModeActive()` (`src/execution/SimOnlyRail.ts`) before executing any
  `kind:'sim'` tenant record: it checks that `STACKSIM_SERVER_URL` is a loopback URL AND `PSModulePath`'s first
  segment contains a directory literally named `Microsoft.Graph.Authentication` (the stacksim shim marker). If
  either is missing, the sim-kind execution is refused fail-closed (`denied_sim_only` outcome, evidence persisted)
  — regardless of the tenant record's own `kind`/`endpoints`.
- This is enforcement that did not exist before today: previously a `kind:'sim'` tenant with loopback endpoints
  executed on ANY process, whether or not that process was actually wired to the stacksim PowerShell shims.

## Requirement
1. **Root `.mcp.json` (`ces-adminops` entry):** today its `env` is only `{ "AO_MCP_ALLOW_APPLY": "0" }` — it does
   not set `STACKSIM_SERVER_URL` or `PSModulePath`. As launched today, **every MCP `ao_execute` call against a
   `kind:'sim'` tenant will be refused** with `denied_sim_only` (visible on the `ao_execute` response's new
   `stacksimModeActive: false` field — see AO-20's display surfacing). Whoever operates this launcher needs to
   either (a) set `STACKSIM_SERVER_URL` (a loopback URL, e.g. `http://127.0.0.1:4390`) and `PSModulePath` (first
   segment = the tenant-stacksim `psmodules/` checkout dir) in the launcher's `env` block before spawning
   `node ces-ao/mcp/ao-mcp-server.mjs`, or (b) have the launcher shell out through `ao exec ... --stacksim` style
   routing before starting the MCP process — whichever fits the deployment.
2. **`ao gui` has no `--stacksim` equivalent today** (`src/cli/index.ts`'s `gui` command takes only `-p/--port`;
   the `exec` command's `--stacksim` flag calls `requestAoStacksimMode()`, which is not wired into `gui`). An
   operator who runs `ao gui` and then selects a sim-kind tenant in the browser will see every execution refused
   unless `STACKSIM_SERVER_URL`/`PSModulePath` were already exported in the shell `ao gui` was launched from.
   VERIFY-ao.md (ces-strategy, AO-20 "Path to completion") already scopes a GUI-facing stacksim toggle as a
   separate, larger follow-up (its own step 2, sized opus) — not built in this pass, which was scoped to wiring +
   display only. This item records the operational consequence until that toggle lands.

## Not a code defect
Fail-closed is the intended behavior (AO-20's whole point is that a sim tenant on an unrouted process should NOT
silently execute). This REQ is about the launcher/operator configuration needed to make sim-kind execution actually
reachable again through the MCP and GUI entry points, now that the check exists.
