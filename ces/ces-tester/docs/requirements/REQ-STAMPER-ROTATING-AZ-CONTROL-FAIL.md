# REQ-STAMPER-ROTATING-AZ-CONTROL-FAIL — rotating Azure NSG/NET control false-FAILs in Stamper execute (from ces-tester, 2026-09-07)

**From:** ces-tester · **To:** ces-stamper / tenant-stacksim (founder routes) · **Status:** FILED
**Boundary note:** ces-stamper and tenant-stacksim are read-only from this repo. This is a
requirement doc with reproduction evidence, not a patch. Founder adjudicates ownership
(Stamper template vs stacksim sim-fidelity) — same disposition as its parent REQ.

**Relationship to [REQ-STAMPER-ROTATING-VERIFY-FAIL.md](REQ-STAMPER-ROTATING-VERIFY-FAIL.md):**
this is the SAME rotating-verification phenomenon (that REQ's "load-induced extras"),
now **localized to the Azure networking control family** (`AZ-NSG-*`, `AZ-NET-*`) and
observed through the GP-DEMO-5 acts-test harness's `stamper-execute` SE3 check rather than
the run-all scenario legs. Filed separately because it is a distinct, enumerable control
family with its own three-run rotation evidence and its own skip-list disposition.

## Defect (observed, 3 independent full `demo:acts-test --full` runs)

Each full run of the same 110-task `demo-dib-small` plan against a freshly-armed stacksim
tenant surfaces **exactly one unexpected `AZ-NSG-*` / `AZ-NET-*` control failure** that is
NOT on the harness skip list (`GUI_LEG_KNOWN_FALSE_FAILS`, `src/demo/e2e-run.ts:811`). The
failing member **rotates run to run** — never the same control twice in a row:

| Run id | Ended (UTC) | SE3 unexpected failure | expected (pinned & fired) | stale skips (pinned, did NOT fire) |
|---|---|---|---|---|
| `acts-full-1`   | 2026-09-06T21:27 | **AZ-NSG-005** | 12 | AZ-NET-002, AZ-NSG-003, AZ-NET-003, AZ-NET-004 (4) |
| `g-full`        | 2026-09-06T22:12 | **AZ-NSG-004** | 13 | AZ-NSG-003, AZ-NET-003, AZ-NSG-002 (3) |
| `full-accept-2` | 2026-09-07T03:17 | **AZ-NET-005** | 12 | AZ-NET-002, AZ-NSG-003, AZ-NET-003, AZ-NET-004 (4) |

(Source: `runs/acts-test/<run>/acts-report.json`, group `stamper-execute`, check `SE3`.
Underlying `failed_tasks` live in each run's
`runs/show/<run>/pipeline/Stamper/plan-data/demo-dib-small/plans/execution-report-*.json`.)

## The rotation is two-sided — which is why individual pins do not converge

The AZ networking family already has a stable pinned core in `GUI_LEG_KNOWN_FALSE_FAILS`:
`AZ-NET-002`, `AZ-NET-003`, `AZ-NET-004`, `AZ-NSG-002`, `AZ-NSG-003` (all
"Command exited with non-zero code" / compound-message sim-coverage false-FAILs, pinned
across m7-run2/run4). But across these three runs:

- **Unexpected side (fails but not pinned):** `AZ-NSG-005`, `AZ-NSG-004`, `AZ-NET-005`
  each appear once — higher-numbered siblings of the already-pinned controls.
- **Stale-skip side (pinned but does NOT fail this run):** 3–4 of the pinned AZ entries
  pass on any given run, and *which* ones pass also rotates (`AZ-NET-002`/`AZ-NSG-002`
  float in and out).

So the failing subset of the AZ-NSG/AZ-NET family is a **moving window**, not a fixed set.
Adding `AZ-NSG-004/005` and `AZ-NET-005` to the pin list would not stabilize it: next run
a different sibling floats in, and the newly-pinned ones become stale skips. This matches
the parent REQ's finding that the extras are **load/timing-sensitive**, not deterministic.

## No-pin rule vindicated 3× (do NOT pin these for green)

Pinning the first observed member (`AZ-NSG-005`) would have **greened `g-full`**, which
actually failed on a *different* control (`AZ-NSG-004`) — masking a genuine, distinct
failure. `full-accept-2` then failed on a third (`AZ-NET-005`). Three consecutive runs,
three different unexpected members: the acts-harness's no-pin discipline (surface the honest
red as `act-red`, never pin to force green) is empirically correct. These are reported
truthfully as a single accepted Stamper `act-red` per run, and the `--full` acceptance
criterion is defined as *exactly one* such AZ-family red with zero harness-defect.

## Two independent observers agree the state is really missing

Same mechanism as the parent REQ: when one of these tasks fails verification, the setting
genuinely did not persist against the sim (stacksim ledgers the `mutate`, but a later
independent `resolve` returns the property unset). Discriminating **poisoned/malformed Set
emitted by Stamper** from **stacksim named-cmdlet arg-state persistence dropping args under
load** requires Stamper-side command logs not carried in the execution report — that
diagnosis belongs to the Stamper stabilization goal, exactly as the parent REQ concluded.

## Ask

1. **Adjudicate ownership** of the `AZ-NSG-*` / `AZ-NET-*` networking family: Stamper
   template variable-poisoning vs stacksim sim-fidelity/persistence-under-load. The parent
   REQ (`REQ-STAMPER-ROTATING-VERIFY-FAIL`) is the umbrella; this narrows the live instance
   to the Azure networking controls.
2. **Do not ask ces-tester to pin these for green.** The measuring instrument reports them
   honestly; a per-control pin would falsify the next run. If the family is confirmed a sim
   coverage gap, the correct fix is at source (stacksim named-cmdlet evidence surface for
   the NSG/NET cmdlets), after which ces-tester re-verifies and removes the whole family
   from the skip list at once.
3. **Prune the stale pins** once adjudicated: the 3–4 stale skips per run indicate several
   currently-pinned AZ entries no longer fail on a quiet machine and could be un-pinned —
   but only together with the source fix, not piecemeal (they rotate).

## Reproduction

`node bin/ces-tester.mjs demo:acts-test --full --run-id <id>` in ces-tester; inspect
`runs/acts-test/<id>/acts-report.json` → group `stamper-execute` → check `SE3`
(`unexpected` list) across two runs — the unexpected member differs. Retained evidence:
`runs/acts-test/{acts-full-1,g-full,full-accept-2}/`.
