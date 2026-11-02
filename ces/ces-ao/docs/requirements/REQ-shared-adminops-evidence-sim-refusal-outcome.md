# REQ-shared-adminops-evidence-sim-refusal-outcome

> **STATUS: CLOSED (2026-09-27).** ces-shared FX-SH1 shipped `denied_sim_only` in contract
> 1.2.0 (`2e07bc2`). ces-ao adopted it in the 09-27 fix batch: the sim-only rail now writes
> `outcome: 'denied_sim_only'` (verdict NOT_APPLICABLE), the golden row `sim-only refusal`
> was regenerated at 1.2.0, and ces-eo's real-shape reader test passes against it. Kept
> below for history.

**Target module:** ces-shared
**Filed by:** ces-ao (A5 sim-only rail)
**Date:** 2026-09-27
**Priority:** P2 — does not block; workaround in place

## What

The `AdminOpsEvidenceOutcome` enum lacks a dedicated value for sim-only rail
refusals. When `CES_AO_SIM_ONLY=1` refuses a non-sim tenant, or a sim tenant
with non-loopback endpoints is refused, AO currently writes the evidence with
`outcome: 'denied_cmmc'` (the closest existing value), which conflates two
distinct denial reasons.

## Proposed addition

Add `'denied_sim_only'` to `AdminOpsEvidenceOutcome` (or `'denied_safety_rail'`).

## Current workaround

AO uses `denied_cmmc` with a descriptive `outcomeRationale` that names the rail
(`"CES_AO_SIM_ONLY=1 refuses non-sim tenant"` or `"Sim tenant has non-loopback endpoint"`).
The rationale string is not machine-parseable but sufficient for human audit review.

## Acceptance test

`AdminOpsEvidenceSchema.parse({ ..., outcome: 'denied_sim_only', ... })` succeeds.
