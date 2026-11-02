# REQ: ces-muster: resolve registry {placeholders} on the live discovery path

**Filed by:** ces-muster (FC-MU-5, 2026-09-28)
**Target:** ces-muster (self). Needs a founder decision on where the values come from.
**Priority:** P2
**Status:** OPEN

## What
Muster's live discovery walks Stamper's registry `get_command` text verbatim. 75 of the 201 runnable get_commands
(62 `az`, 12 `mgraph`, 1 `ipps`, counted 2026-09-28) contain `{placeholders}` such as `{subscriptionId}`,
`{resourceGroup}` and `{lawWorkspaceName}`. Nothing on the live path fills them in, so on a real tenant those reads
reach the service with the literal braces and fail. The executor then records them as `unknown`: the result is
honest, but the check did not run.

This was already true before FC-MU-5 for every live area. FC-MU-5 step 2 carries the placeholders through
unchanged: 4 of the 7 translated Azure CLI reads contain them.

## Why it is open
The values are tenant-specific infrastructure names. Muster has no live source for them yet. Candidates:
- the Infra Manifest / Tenant Config Profile the interview already builds (resource group, workspace name);
- the Azure consent's `subscription_id` (FC-MU-5 step 1), already recorded;
- a read-only lookup (for example, list the Log Analytics workspaces in the consented subscription).

## Acceptance
- A live run substitutes each placeholder from a named source, or records the entry as unavailable with the reason
  "unresolved variable `<name>`". It never sends literal braces.
- A test (fakes only) proves both paths, and proves the sim path is unchanged.
