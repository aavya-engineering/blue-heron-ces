# REQ-MUSTER-DISCOVERY-STATE-BLINDNESS — filed against DISCOVERY-1/-2 (from ces-tester, 2026-07-28)

**Boundary note:** requirement doc with evidence, not a patch. Surfaced by the GP-DEMO-2
wiring-spec exploration of `muster-api/src/services/discoveryService.ts` (read-only).

## Finding

DISCOVERY-1's posture derivation is **presence-based only**: a registry `get_command`
that exits 0 with non-empty matching stdout yields `derived_posture: met` (confidence
high); empty yields `unknown`. The executor **never parses returned state values**.
Consequently it cannot distinguish:

- a Conditional Access policy with `state: enabled` (enforced) from
  `state: enabledForReportingButNotEnforced` (report-only) — e.g. the real
  `MA.L2-3.7.5.remote-mfa` registry command deliberately creates report-only;
- an enabled DLP compliance policy from a disabled one;
- generally: *configured-and-enforcing* from *present-but-inert*.

## Why it matters

A presence-credited control that an assessor would fail (report-only CA is the
canonical case) is a **false met** at evaluation time. The GP-DEMO-2 evaluation demo's
strongest narrative beat ("looks configured ≠ configured — Muster reads it the way
your C3PAO will") is EXACTLY this discrimination — currently only EO's assessment
layer performs it (EO correctly reads enforcement state; see the GP-DEMO-1 needle
runs). Until discovery gains state depth, the evaluation demo's trap beat pivots to
decoy-name credit denial (see `docs/demo/EVAL-CONFIGS.md` T5), which stays within the
presence contract.

## Ask (for DISCOVERY-2 / Muster owners to scope)

Per-entry optional `state_predicate` in the registry walk (e.g. jsonpath + expected
value, reusing the verification vocabulary Stamper's execute already carries per
entry), so discovery can derive `met | present_not_enforced | unknown`. The
`present_not_enforced` middle state is the sales- and assessor-relevant reading.

## Evidence pointers

- `discoveryService.ts` posture rule (presence/empty/degraded), wiring-spec 2026-07-28.
- GP-DEMO-1 needle runs: EO distinguishes state (38 met baseline includes enforcement
  checks) while the driven planner path and discovery layer do not.
