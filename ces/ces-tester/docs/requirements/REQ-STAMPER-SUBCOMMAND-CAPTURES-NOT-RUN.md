# REQ-STAMPER-SUBCOMMAND-CAPTURES-NOT-RUN

**Filed by:** ces-tester (GP-DEMO-3, M7 live run `m7-run1b`)
**Date:** 2026-08-29
**Against:** `ces-stamper`
**Severity:** MEDIUM-HIGH — 9 of 110 tasks failed on this in a single live execute, and the
failures are **structural**, not load-related: they reproduce on every run of the same plan.
**Status:** OPEN — ces-tester is boundary-bound and will NOT patch this. Worked around only
where a seeded value cannot misrepresent tenant state (see the last section).

## Summary

A task's strict `ExecutionContext.resolve()` throws
`Unresolved runtime variables: <names>. These should be produced by prior command captures.`
for variables whose producer capture **never ran**, in two distinct situations:

1. **The producer sub-command is skipped inside the SAME task.** An `evidence-only`
   sub-command (no `set_command`) and an idempotently-skipped `set` both bypass the capture
   step, so a later sub-command in the same task resolves against variables that can never
   have been produced.
2. **A producer in an EARLIER, COMPLETED task does not propagate.** `AC.L2-3.1.12` and
   `IA.L2-3.5.4` both completed in this run, yet their captured `namedLocationId` /
   `phishingResistantStrengthId` were still unresolved for the consuming tasks.

## Evidence (live, run `m7-run1b`, 2026-08-29, `dryRun=false`)

Case 1 — from the GUI server's own execute log:

```
[PowerShellAdapter] execute(step_task_AC.L1-3.1.1_...) — sub-command path, 11 sub-commands, dryRun=false
[PowerShellAdapter] [1/11] AC.L2-3.1.1.operator-discover — evidence-only (no set_command)
[PowerShellAdapter] [2/11] AC.L2-3.1.1.group-create      — engine=mgraph, phase=GET
[PowerShellAdapter] [3/11] AC.L2-3.1.1.member-add        — engine=mgraph, phase=GET
Error: Unresolved runtime variables: cuiGroupId, operatorUserId. These should be produced by prior command captures.
```

The registry says these two names ARE produced here:

```
operatorUserId  captured_by AC.L2-3.1.1.operator-discover   used_by AC.L2-3.1.1.member-add, AC.L2-3.1.2.role-assign, AC.L2-3.1.5.pim-eligible
cuiGroupId      captured_by AC.L2-3.1.1.group-create        used_by AC.L2-3.1.1.member-add, AC.L2-3.1.11.session-timeout, AC.L2-3.1.14.block-untrusted, AC.L2-3.1.18.mobile-ca, CM.L2-3.4.1.security-baseline
```

but `operator-discover` has no `set_command` (so the adapter logs `evidence-only` and moves
on) and `group-create`'s set is skipped because the seeded tenant already contains the
`CUI-Authorized-Users` group. **A capture that only runs on the SET path cannot survive an
idempotent tenant** — which is the normal case for a tenant that is already partly configured,
i.e. the product's whole target market.

Case 2 — `AC.L2-3.1.12` (producer of `namedLocationId`) and `IA.L2-3.5.4` (producer of
`phishingResistantStrengthId`) are **absent from the failed-task list**, i.e. they completed;
their consumers still failed:

```
step_task_AC.L2-3.1.14_... : Unresolved runtime variables: cuiGroupId, namedLocationId
step_task_SC.L2-3.13.7_... : Unresolved runtime variables: cuiGroupId, namedLocationId
step_task_AC.L2-3.1.15_... : Unresolved runtime variables: phishingResistantStrengthId
```

Full taxonomy: `runs/e2e/m7-run1b/stamper-failure-taxonomy.json` (9 of the run's 19 failures
are this class; the execute otherwise completed 91/110 with 74+ real store mutations).

## Why this matters beyond the demo

The strict path is the one the GUI uses for every real tenant. On any tenant where an object
already exists — the normal state of a customer mid-journey — the corresponding capture is
skipped and every downstream task that consumes it fails, even though the tenant is *more*
configured, not less. The lenient CLI path hides this by executing the literal
`{cuiGroupId}` text instead (REQ-STAMPER-CLI-EXECUTE-LENIENT-RESOLUTION), so neither path
tells the operator the truth.

## Ask

1. **Run captures on the GET/idempotent path too**, not only after a successful SET — the
   value being captured is a *read* of the object's identity, which is available either way.
2. **Run captures for `evidence-only` sub-commands** (they exist precisely to read state).
3. **Verify cross-task capture propagation** — case 2 shows a completed producer whose value
   never reached a later task in the same execution.
4. Failing all three: make the error name the producing sub-command and why it was skipped,
   so an operator can act on it.

## What ces-tester did (no sibling write)

- **Seeded** `operatorUserId` (`user-12` — the scenario's own Ray Dominguez record) and
  `cuiGroupId` (`group-1` — `generateGroups`' first group, named `CUI-Authorized-Users`) into
  the tenant variable store. Both are identities of objects the sim seed **already contains**,
  read from the sim's own generators, and the store merge is fill-missing-only, so a real
  capture still wins whenever one lands.
- **Deliberately did NOT seed** `namedLocationId` / `phishingResistantStrengthId`: those
  objects are created at runtime by the plan itself, so a seeded id could point at an object
  that does not exist. Their three consuming controls are pinned as known-false FAILs against
  this REQ instead, with the failure printed on screen.
