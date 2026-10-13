# REQ-STAMPER-CLI-EXECUTE-LENIENT-RESOLUTION

**Filed by:** ces-tester (GP-DEMO-3, M2-entry diagnostic)
**Date:** 2026-08-29
**Against:** `ces-stamper`
**Severity:** HIGH — the CLI `execute` command silently runs commands that still contain
unresolved `{placeholder}` text and reports them **completed**. Every CLI-driven execution
of a plan missing manifest variables produces false passes: the command reaches the target
(live tenant or stacksim) with literal `{approverUPN}`-style garbage in its payload, and
neither the operator nor the execution report learns that anything was unresolved.
**Status:** OPEN — documented and worked around on the ces-tester side (variable seeding);
NOT patched (write boundary).

## Summary

Stamper has two variable-resolution paths with opposite failure semantics:

- **GUI** (`src/server/routes/execute.routes.ts:216-223, 296-303`): for any real tenant an
  `ExecutionContext` is built and `ExecutionContext.resolve()`
  (`src/core/ExecutionContext.ts:99-120`) **throws** `Unresolved manifest variables: ...` /
  `Unresolved runtime variables: ...` before the command executes. Strict, honest.
- **CLI** (`src/cli/index.ts:84-90`): `stamper execute <plan>` never constructs an
  `ExecutionContext` (no `--tenant` option exists on the command), so
  `PowerShellAdapter.resolveCommand` (`src/adapters/PowerShellAdapter.ts:1281-1295`) falls
  back to legacy `interpolateVariables` / `resolveTemplate`
  (`src/utils/templateResolver.ts:27-51`, non-strict), which substitutes only keys present
  in `plan.variables` and **leaves any missing key's placeholder as literal text, with no
  error, no warning, no report annotation**.

The same plan therefore yields materially different results by drive mode. Measured on the
byte-identical 110-task plan `translated-mplan_ms5bolq6_vavmkac`: CLI = 100 completed /
10 failed; GUI = 80 completed / 30 failed. Of the 30, 23 are `Unresolved manifest
variables` and 6 are `Unresolved runtime variables` — i.e., the GUI surfaced ~20 latent
false passes the CLI had been recording as completions since July.

## Evidence (measured)

1. **Executed literal placeholder, counted as completed.**
   `C:/CES_Pipeline/Stamper/plan-data/dev/evidence/access_control/ac.l2-3.1.4.pim-approval.json`
   (mtime 2026-07-29 ≈ 00:22 UTC — the CLI needle-run window) contains the executed
   command text
   `$approverId=(Get-MgUser -Filter "userPrincipalName eq '{approverUPN}'").Id; ...`
   — the literal `{approverUPN}`, twice. The matching CLI execution report
   (`execution-report-2026-07-29T00-08-03.json`, ces-tester
   `runs/demo/needle-verify-2/stamper-storage/state/translated-mplan_ms5bolq6_vavmkac/`)
   lists this task as completed.
2. **Same plan, GUI leg, same task:** fails honestly with
   `Unresolved manifest variables: approverUPN. Ensure tenant manifest provides these
   values.` (ces-tester
   `runs/m0-spike/m0-001/pipeline/Stamper/plan-data/demo-dib-small/plans/execution-report-2026-08-29T21-17-32.json`).
3. **Plan parity verified:** both legs' plan files carry identical `plan_id` and identical
   168-key `variables` maps (only `_translated_at` differs), ruling out plan drift as the
   cause of the 30-vs-10 delta.

## Why this matters beyond the sim

Against a live tenant the CLI path would send Graph/Azure/Exchange requests whose filter
strings, UPNs, resource names, and body fields contain literal `{braces}` — at best failing
noisily server-side, at worst matching nothing and "verifying" against empty results. The
execution report gives the operator no signal that resolution failed. The strict GUI path
proves Stamper already owns the correct behavior; the CLI just never wires it up.

## Requested change (either satisfies)

1. **Parity (preferred):** have CLI `execute` build the same `ExecutionContext` merge the
   GUI route uses (`VARIABLE_DEFAULTS` + tenant `variables.json` + `plan.variables`) so
   unresolved variables fail the task before execution, with the same error strings.
   A `--tenant <slug>` option (mirroring the GUI's tenant scoping) would give it the
   variable store and state/evidence dirs the GUI already uses.
2. **Minimum:** after legacy interpolation, refuse to execute (or at minimum flag in the
   report and stderr) any command whose resolved text still matches `/\{\w+\}/` for a name
   listed in the sub-command's `variables_required`/`variables_runtime`.

## Workaround in ces-tester (until fixed)

The demo/testing harness seeds all operationally required variables into the tenant
`variables.json` before translate (see `docs/context/M2-ENTRY-FINDINGS.md`), so both paths
resolve fully and the strict/lenient divergence is moot for seeded runs. CLI-derived
known-failure baselines are treated as drive-mode-specific, not canonical.
