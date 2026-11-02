# REQ-STAMPER-GUI-EXEC-TARGET-STICKY-DRYRUN

**Filed by:** ces-tester (GP-DEMO-3, M0 drivability spike)
**Date:** 2026-08-29
**Against:** `ces-stamper`
**Severity:** MEDIUM — the Execute card's Target selector silently contradicts its own
markup. An operator who connects a real tenant and clicks Execute gets a **dry run** while
the UI gives no indication that anything was overridden. It fails safe, but it means a
remediation run can appear to succeed ("Complete") while having changed nothing.
**Status:** OPEN — worked around in the ces-tester driver; NOT patched (write boundary).

## Summary

`#execTargetSelect` is authored with `<option value="tenant" selected>` — the intended
default is a live, applying run. But the page loads with `#tenantSelect` on `dev`, and the
`dev` branch of the tenant-change handler force-sets `execTargetSelect.value = 'dryrun'`.
When the operator then picks a **real** tenant, the `else` branch never restores the target.
The selector is left stuck on **Dry Run** for the rest of the session unless the operator
notices and changes it by hand.

## Evidence (measured)

Fresh browser context, no stored preferences. After selecting the sim tenant and completing
Connect (`tenantConnectionState = connected`, zero error rows):

```
exec DEFAULTS as loaded: mode=auto target=dryrun     <- markup says "tenant"
```

Executing in that state:

```
EXECUTE -> #cardStatus4="Complete"; ledger mutations 21 -> 21 (delta 0)
```

`Complete`, in 0.7 s, with **zero** tenant mutations — a dry run presented identically to a
real one. After explicitly setting the target:

```
exec target after explicit set: tenant
EXECUTE -> #cardStatus4="Complete"; ledger mutations 21 -> 95 (delta 74)
```

Same button, same badge, 74 real mutations. Nothing in the UI distinguishes the two runs.

## Second, related observation: `#cardStatus4` overstates the result

In the live run above, the card read **`Complete`** while the execution report on disk read:

```
status: partial
summary: { total_tasks: 110, completed: 80, failed: 30, skipped: 0 }
```

`#cardStatus4` reflects only the terminal SSE `{type:'done'}` event, not the report's own
`status`. Any consumer judging success must read the execution report artifact, never the
badge. (ces-tester already judges artifacts, not badges — house rule — but this is worth
fixing for the operator reading the screen.)

## Code path

| File | Line | Detail |
|---|---|---|
| `ces-stamper/public/index.html` | 4534-4537 | `<select id="execTargetSelect">` with `<option value="tenant" selected>` |
| `ces-stamper/public/index.html` | 6200-6203 | `dev` branch: `selectedDryRun = true; targetSel.value = 'dryrun'` |
| `ces-stamper/public/index.html` | 6210+ | `else` (real tenant) branch — never restores the target |
| `ces-stamper/public/index.html` | 4731-4740 | `syncExecMode()` derives `selectedDryRun` from the select |
| `ces-stamper/public/index.html` | 9123 | `#cardStatus4` set to `Complete` on the terminal `done` event |

## Suggested fix (for ces-stamper to apply — NOT applied by ces-tester)

In the real-tenant branch, restore `execTargetSelect.value = 'tenant'` (and re-run
`syncExecMode()`), mirroring the `dev` branch's force-set. Better still, make the Target
visibly reflect the connection state — a connected real tenant should not silently sit in
Dry Run. Separately, derive `#cardStatus4` from the execution report's `status` so
`partial` is not rendered as `Complete`.

## Consequence for ces-tester (GP-DEMO-3)

This directly corrects a claim in `PLAN-E2E-AO-DEMO.md` FD-2: *"Execute defaults
(`#execModeSelect=auto`, `#execTargetSelect=tenant`) already mean a live applying run."*
They do not. The M4 Stamper driver must **explicitly select `tenant` and assert the value
stuck** before clicking Execute, exactly as the AO driver must assert its live-tenant slug.

## Cross-reference

- `docs/demo/PLAN-E2E-AO-DEMO.md` FD-2 (claim corrected), success predicate item 5
- `docs/context/IMPLEMENTATION_LOG.md` — GP-DEMO-3 M0, spike (b)
- Evidence: `runs/m0-spike/m0-001/stamper/spike-log.txt`, `.../06-execute.png`
