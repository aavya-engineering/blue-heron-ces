# BUG — IA.L2-3.5.3 set command rejected by the injection guard (RESOLVED)

**Filed:** 2026-07-25 (GP-STAMPER-1 M2) — retroactive record; the defect was found by
ces-tester on 2026-07-10 but never filed in this repo (cross-root write boundary).
**Status:** RESOLVED — fixed 2026-07-11 by `5252d90` (G-STAMPER-STAB-1 M1,
"fix plan-wide variable poisoning"); regression-pinned in
`tests/unit/PowerShellAdapter.test.ts` (generic pins from STAB-1 M1 + a
registry-grounded IA.L2-3.5.3 pin added by GP-STAMPER-1 M2).

## Symptom (as found by ces-tester's clean-tenant-mfa-baseline scenario)

Executable-plan task `step_task_IA.L2-3.5.3_*` ("Multifactor Authentication
(IA.L2-3.5.3)", engine `mgraph`) failed every run with:

> PowerShell injection guard: parameter "powershell_commands" contains a disallowed
> metacharacter (";") and was rejected before command execution.

Downstream, the scenario's `expected_state` assertion failed ("policy caPolicy-1 is
enabled but has no MFA grant control") because the MicrosoftAuthenticator enable
never executed. Deterministic, reproduced across every tester gate run 07-10 →
07-11 morning. Evidence: `../../ces-tester/runs/gate-run-{1,2}/` and
`session3-verify-{1,2}/` (execution reports 2026-07-11T15:03Z), plus
`ces-tester/docs/context/IMPLEMENTATION_LOG.md` M2 "External Blocker" section.

## Root cause

Two defects composed; the registry template itself was CORRECT:

1. **Variable poisoning (ManifestReader.generateVariables):** the Mission Plan's
   `desired_config` blocks were flattened wholesale into the plan-wide variables
   map — including the `powershell_commands` ARRAY, whose stringified value is the
   command text itself.
2. **Non-placeholder-gated sanitization (PowerShellAdapter.interpolateVariables):**
   every variables-map entry was pushed through `sanitizePowerShellValue`, whether
   or not the template referenced it. The stringified command array contains a
   legitimate `;` — the separator inside the registry set_command's hashtable
   literal `@{'@odata.type'='#microsoft.graph...';state='enabled'}` — so the guard
   (correctly denylisting `;` in parameter VALUES) rejected the task.

The guard was right; feeding it command text as if it were a parameter value was
the bug. Not a template-authoring defect (ces-tester's initial hypothesis) and no
guard loosening was needed or done.

## Fix (already landed)

`5252d90` (2026-07-11 11:39 CDT): `generateVariables()` flattens scalars only
(arrays/objects stay under the namespaced `config_intent.<id>` entry), and
`interpolateVariables()` is placeholder-driven — only a variable the template
actually references is sanitized/substituted. Guard behavior for genuinely
referenced values is unchanged (breakout payloads still throw).

## Why the tester kept seeing it after the fix

The tester's last failing re-runs (`session3-verify-{1,2}`, 2026-07-11T15:03Z =
10:03 CDT) predate the 11:39 CDT fix commit. Every later tester gate run has the
task passing: freshest evidence `../../ces-tester/runs/gp-m1-gate-1/`
(execution report 2026-07-26T00:49Z) — plan still contains the IA.L2-3.5.3 task
with the unchanged MicrosoftAuthenticator template, task NOT among that run's 10
failures (all of which are known stacksim sim-fidelity classes, not this bug),
scenario `clean-tenant-mfa-baseline` result: **pass**.

## Regression pins

- `tests/unit/PowerShellAdapter.test.ts` "does NOT throw on an unreferenced
  array-valued variable" + "unreferenced plan-metadata objects" + "STILL throws
  when the template actually substitutes" (STAB-1 M1, generic mechanism).
- Same file, "the real IA.L2-3.5.3 registry set_command survives interpolation
  intact under a poisoned-shape variables map" (GP-STAMPER-1 M2, pins the actual
  registry entry `IA.L2-3.5.3.mfa-authenticator` end-to-end through
  `interpolateVariables`).
