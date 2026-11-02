# REQ-STAMPER-ROTATING-VERIFY-FAIL — filed against the Stamper execute pipeline (from ces-tester, 2026-07-25)

**Boundary note:** ces-stamper / tenant-stacksim are read-only from this repo. This is a
requirement doc with reproduction evidence, not a patch. Founder routes it — most likely
into **GP-STAMPER-1 / G-STAMPER-STAB-1** scope, whose M1 the G-TESTER-2 acceptance gate
item 3 already waits on.

## Defect (observed, 6 independent runs, 2026-07-26 UTC)

Every full `translate+execute` of the same 110-task plan against a freshly wiped stacksim
tenant fails a **rotating subset of ~9–12 task verifications** with
`verification failed — Evidence validation failed`. The failing set overlaps but differs
run to run:

| Run (all same answers/plan shape) | failed | atp-enable in set? |
|---|---|---|
| gate-1 teams (serve died mid-run — separate issue, fixed harness-side) | 43 | yes |
| triage exo (isolated) | 10 | no |
| triage teams (isolated) | 10 | no |
| gate-2 exo | 12 | yes |
| gate-2 teams | 12 | yes |
| gate-2 zz | 9 | no |

Frequently-rotating members: `atp-enable`, `cui-label`, `tap-config`, `safe-attach`,
`anti-malware`/`malware-rule`, `dkim`/`anti-phish`, `dlp-policy`, `disable-inactive`,
`audit-enable`, `safe-links`, `member-add`.

## ADDENDUM (same day, 11 further executes on a quiet machine): it is TWO phenomena, not one rotation

Runs `gp-m2-gate-{1,2,3}` (11 execution reports, idle machine, evening): the failing set
is **bit-identical every time — a stable core of exactly 9 tasks**:

`MP.L2-3.8.1.cui-label`, `IA.L2-3.5.9.tap-config`, `SC.L2-3.13.13.safe-attach`,
`SI.L2-3.14.2.malware-rule`, `SC.L2-3.13.15.anti-phish`, `MP.L2-3.8.9.dlp-policy`,
`AC.L2-3.1.1.member-add` (non-zero exit, not evidence validation),
`AU.L2-3.3.1.audit-enable`, `SI.L2-3.14.3.safe-links`.

So the refined model:

1. **Deterministic core (9 tasks):** fail EVERY execute — a stable known-red set of
   task verifications that apparently cannot pass against the sim today (candidate
   causes: sim surface gaps for those cmdlets' evidence reads, or genuinely broken
   templates — the IA.L2-3.5.3 class). Diagnosable one-by-one; each is either a
   stacksim named-cmdlet/evidence surface item or a Stamper template item.
2. **Load-induced extras:** under machine load (the afternoon runs), ADDITIONAL tasks
   beyond the core fail — including sibling sub-tasks of core controls (`anti-malware`
   next to `malware-rule`, `dkim` next to `anti-phish`) and previously-passing tasks
   (`atp-enable`, `disable-inactive`). These are what made ces-tester's scenario
   verdicts luck-dependent; timing/timeout-sensitivity in the execute/verification
   path is the likely mechanism.

Consequence update: on a quiet machine, scenario verdicts on controls OUTSIDE the core
are stable (`gp-m2-gate-1/2`: 8/8 correct verdicts including the deliberate red;
`gp-m2-gate-3`: 3/3 correct, the 4th lost to a since-fixed tester driver bug, not a
verdict miss); under load they are not. The core 9 are a finite, enumerable work list.

## Two independent observers agree the state is really missing

When a task's verification fails, the setting genuinely did not persist — this is not a
picky validator:

- stacksim's ledger records the `mutate` (e.g. `Set-AtpPolicyForO365` mutate row,
  gate-2 exo, 01:43:20.803Z), **but** a later independent `POST /resolve`
  (`Get-AtpPolicyForO365`) returns state with `EnableATPForSPOTeamsODB: undefined`
  (ces-tester's structured verifier, 01:47:45 — 4.5 min later, same serve, same tenant,
  read logged in the same ledger).
- In runs where the same task's verification PASSES (gate-2 zz, triage exo), the same
  resolve returns the property correctly (`true`).

So either Stamper emits a malformed/poisoned Set for the affected tasks (consistent with
the known IA.L2-3.5.3 variable-poisoning class), or stacksim's named-cmdlet arg-state
persistence drops the args while still ledgering the mutate. Discriminating the two needs
Stamper-side command logs (not persisted into the execution report) — that diagnosis
belongs to the Stamper stabilization goal.

## Consequence for the program's measuring instrument

ces-tester scenario verdicts on named-cmdlet controls are luck-dependent: a scenario goes
red iff the rotation hits an asserted control. "3 green + 1 deliberate red" run-all
verdict-correctness (G-TESTER-2 acceptance item 2) is therefore **not reliably
achievable** until this class is fixed; carried as a NAMED known-red (extending the
IA.L2-3.5.3 precedent). ces-tester re-verifies automatically at GP-TESTER-1 M4 when
GP-STAMPER-1 lands.

## Reproduction

`node bin/ces-tester.mjs run-all --run-id <id>` in ces-tester (or any single
`run-scenario`); inspect `runs/<id>/*-workspace/stamper-storage/state/*/execution-report-*.json`
`failed_tasks` across two runs — the sets differ. Evidence retained under
`runs/gp-m1-gate-1/`, `runs/gp-m1-triage-*/`, `runs/gp-m1-gate-2/`.
