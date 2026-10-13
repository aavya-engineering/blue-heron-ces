# Goal Document - G-MUSTER-PLAN-2: Plan mode dual-input (adaptive answers + readiness payload)

**Date:** 2026-07-11 - **Type:** /goal.
**Provenance:** founder directive 2026-07-11 working-system program
(ces-strategy/docs/context/VAULT.md, section A item 2; lane analysis
ces-strategy/docs/context/masterplan/muster-modes.md secs 2, 4; master plan
ces-strategy/docs/MASTER-PLAN-2026-07-11.md).

## Job

Ship MUSTER-PLAN: the mode that collects discovery via adaptive answering and outputs what
Planner outputs today (Mission Plan, manifests, SI Baseline, policy docs - the artifact
contracts), and that MUST ALSO ACCEPT a muster-readiness payload (readiness-result.v1) and
produce the same outputs from it. Two milestones:

- **M1 - payload import seam (S-M once the schema exists).** The seam is already decided
  and half-built: GO-1 open-decision-1 chose import-file mode; GO-2 M3 makes script-upload
  == import-file one mechanism. Plan mode ingests readiness-result.v1 by feeding
  `observations[]` through the SAME `synthesizeFactsFromDiscovery` + `pruneByCoverage`
  seam the fixture flavor uses (discoveryFactJoin.ts; factCoveragePruner is now
  confidence-tiered), and `facts[]` (already-attested rows) go straight into the fact
  store with provenance preserved. This is GO-2 M3 plus a manifest/facts superset - build
  it as that, not as a parallel path.
- **M2 - Planner-equivalent outputs (L; behind FD-PLANNER-OUTPUTS).** HONESTY GAP recorded
  by the lane: Muster's export pipeline today outputs StatusPayload JSON + evidence
  package + rollup CSV only - none of the Planner artifact generators exist in ces-muster,
  and the vendored spine is read-only (drift-gated). The founder decision
  (FD-PLANNER-OUTPUTS in the master plan) picks: port Planner's generators into Muster
  (consume, not fork) vs run Planner as the artifact backend. Execute whichever is
  decided; this is the single largest build in the two-mode directive.

  **RESOLVED 2026-07-11 (FD-PLANNER-OUTPUTS, founder HIL decision, FINAL):** port/vendor
  ces-planner's proven generators into Muster under the vendoring-with-drift-check
  discipline (ces-spine precedent) - NOT run Planner as the artifact backend. M2 is
  unblocked in definition: the output architecture is decided, and M2 execution proceeds
  as a port of Planner's generators, drift-gated exactly as the existing vendored spine
  is, once its precondition (G-MUSTER-READINESS-1 M1 + GO-2 M3) lands.

## Must-NOTs

- NO forking ces-planner - it is read-only; consume or port per the founder decision, never
  diverge a copy.
- NO second fact store, question bank, or provenance model (GO-2's mandatory engineering
  note is binding here).
- NO second ingestion path: payload observations ride the same seam as fixtures; a
  parallel synthesize/prune lane is an automatic defect.
- FCA invariants hold at the seam: unknown never prunes, never passes; unconfirmed drafts
  render as drafts everywhere and never count as met.
- NO network in the SPA; import-file stays zero-connectivity by design.
- Do not overload EngagementKind with mode semantics.

## Acceptance gate (objectively checkable)

1. Given a readiness-result.v1 fixture, plan mode produces boundary-draft behavior and
   downstream artifacts IDENTICAL to the canned-fixture path - equivalence asserted in a
   test (the GO-2 M3 gate pattern, extended to the full payload).
2. Given the same facts entered via the adaptive path, the artifact set is equivalent
   (dual-input equivalence asserted in a test).
3. attested `facts[]` from the payload appear in the fact store with their original
   provenance strings (asserted).
4. M2: the decided output architecture produces the Planner artifact contracts (Mission
   Plan, manifests, SI Baseline, policy docs) from both input kinds; contract shape
   verified against Planner's own output for one reference engagement.
5. All suites green (web/e2e/drift); zero-network guardrail still green.

## Preconditions

- G-MUSTER-READINESS-1 M1 (the schema) - hard dependency.
- G-MUSTER-GO-2 M3 executed (import==upload seam exists).
- M2 only: FD-PLANNER-OUTPUTS decided (master plan, Founder Decision Points).

## Pointers

- src/features/assessment/adaptiveEngine.ts (adaptive lane), discoveryFactJoin.ts,
  factCoveragePruner.ts (the seam)
- docs/GOAL_COMPLETION_G-MUSTER-GO-1.md (staging wiring: DiscoverySubTab ->
  synthesizeFactsFromDiscovery -> AssessmentPage mount-effect)
- docs/goals/G-MUSTER-GO-2.md (M3 gate; rung-5 plan-generator dependency note)
- ces-strategy/docs/context/masterplan/muster-modes.md sec. 2 (mode architecture) and
  dep 6 (output-owner decision)
- ces-strategy/docs/MASTER-PLAN-2026-07-11.md (FD-PLANNER-OUTPUTS)
