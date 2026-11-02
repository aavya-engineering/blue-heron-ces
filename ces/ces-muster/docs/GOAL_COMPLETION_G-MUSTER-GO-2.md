# GOAL COMPLETION - G-MUSTER-GO-2: The Answer Engine (walking skeleton, M1-M5)

**Date completed:** 2026-07-11.
**Founder HIL approval:** granted 2026-07-11 ("approve") - DONE-WHEN 9 satisfied. This
document exists only because of that approval.
**Commits:** `f1666fb` (M1-M5 implementation) + `3613789` (brutal-critic P0 fixes) +
`48fae07` (missed fixture pathspec), branch g-muster-p1, all pushed.
**Goal document:** docs/goals/G-MUSTER-GO-2.md (unchanged; this doc records execution
against it).

## DONE-WHEN disposition (all nine)

1. **M1 gate - HOLDS.** Fixture-drafted boundary (bnd-001..003 from
   DISCOVERY_RESULTS_FIXTURE via rule-based `inferBoundaryDrafts`); edited fields persist
   as corrected (`operator_interview`); unedited persist `discovery-inferred`, unattested.
   Tests: `src/features/interview/__tests__/boundaryInference.test.ts` (6 tests).
2. **M2 gate - HOLDS.** Archetype prefills carry `archetype-default` until overridden;
   an override replaces the source with a human-entered one. Tests:
   `src/features/assessment/__tests__/archetypePrefill.test.ts` (4 tests).
3. **M3 gate - HOLDS.** Upload path == fixture path asserted as deep equivalence
   (synthesized facts AND boundary drafts, timestamps normalized), plus wrapped-flavor
   parse and loud-failure cases. Tests:
   `src/features/discovery/__tests__/importEquivalence.test.ts` (4 tests).
4. **M4 gate - HOLDS.** No unconfirmed draft contributes to a passing score - asserted on
   the REAL production scoring path (`scoreFacts` with the knowledgeLoader Node mock);
   attestation record shape asserted exactly:
   `drafted by [source], confirmed by [name] on [date]`. Tests:
   `src/features/scoring/__tests__/draftGates.test.ts`.
5. **M5 gate - HOLDS.** A drafts-only session scores IDENTICALLY to the facts-absent
   session (real path); drafts prune; unknown still never prunes, never passes. Same
   test file; pruner cases included.
6. **Guardrail survival - HOLDS.** `noNetworkCalls.test.ts` extended over every new SPA
   surface (boundary inference, confirm processing, archetype prefill, import parse) -
   green. FCA suite extended per M5 - green. A > C > B routing suites green with the four
   new provenance strings in test data (`classOfFact` attested-tier upgrades:
   discovery-inferred -> A, document-extracted -> C, archetype-default / interview-
   extracted -> B; unconfirmed drafts -> B fallback unchanged).
7. **check:drift 32/32, build clean, lint 0** - all exit 0; vendored spine untouched.
   Final boards: web 267/267, e2e 9/9 (five-tabs updated for the confirm step).
8. **Brutal critic (separate agent) - PASS on round 2.** Round 1 = FAIL with two
   REPRODUCED P0s, both fixed same-day (see Deviations/Findings below). Round 2 re-ran
   the exploits against `3613789` and confirmed them dead; zero residual defects.
9. **HIL approval - GRANTED 2026-07-11.** This document is the record.

## The architecture decisions of record

- **Q4/Q6 (data model): EXTEND, not version.** `InterviewFact` gains optional
  `FactAttestation { drafted_by, confirmed_by, confirmed_on }`
  (src/shared/types/engagement.ts). Draft-ness = draft provenance string + absent
  attestation. `draftSemantics.ts` is the single boundary module
  (isUnconfirmedDraft / scorableFacts / attestationRecord / confirmFact).
- **Draft scoring semantics: EXCLUSION, not coercion.** Unconfirmed drafts are filtered
  from scoring inputs (`scorableFacts` inside `scoreFacts`, and in `exportPipeline`
  BEFORE routing) - coercing to unknown would deduct, which is a contribution.
- **Boundary is intent:** the boundary cluster is EXCLUDED from discovery auto-synthesis
  (`discoveryFactJoin.ts`) - discovery evidence only ever DRAFTS the boundary via rung 1;
  a machine never asserts intent into the scorable tier.
- **ONE model verified:** the critic's second-bank/second-store/second-provenance hunt
  came back CLEAR (localStorage handoff keys are seams into the same store; DRAFT_PROVENANCES
  is additive to the existing router).

## Deviations / findings (honest record)

1. **Brutal-critic round 1 = FAIL (two reproduced P0s), fixed in `3613789`:**
   - D1: `confirmFact`/`processBoundaryDecisions` accepted a blank `confirmedBy` -
     attestation laundering (a blank-name "confirmed" discovery-inferred draft became
     class A and outranked a human 'no'). Fix: named-human invariant enforced at BOTH
     pure chokepoints (throw on blank/whitespace; stored name trimmed); UI gating is
     never trusted.
   - D2: `exportPipeline` routed unfiltered facts - unconfirmed drafts leaked verbatim
     into `StatusPayload.interview_facts`, and routing-before-filtering let a draft
     group-winner shadow a human fact out of scoring. Fix: exclusion BEFORE routing;
     status-payload schema gains the full-record attestation object so confirmed drafts
     export schema-valid.
   - D3/D4: negative-path regression tests added for both; the runtime invariant lives at
     the chokepoint (type-level hardening deferred as P2).
2. **Schema tightening (readiness-result/1.0.0):** `attestation` now REQUIRES all three
   fields - a partial attestation is not an attestation. Done same-day as the schema's
   own landing; no external consumers existed.
3. **M6 (rung 4, interview-parsing fixture pass) DEFERRED** - explicitly deferrable per
   the goal; not required for DONE-WHEN.
4. **Test-of-record updates:** groupByCluster "six clusters" -> seven (the boundary
   cluster joins THE bank); five-tabs e2e traverses the new confirm step, leaving drafts
   unconfirmed (they prune, never score - the pruning-parity assertion is unchanged).
5. **`48fae07`:** src/__fixtures__/archetypes.ts was untracked after `f1666fb` (missed
   pathspec; fresh clone would not build) - caught by the critic's working-tree check.

## What this unblocks

- **G-MUSTER-READINESS-1 M2+** (readiness exporter + manifest capture; M3 report; M4 BHD
  weights validation - NOTE: M4 now carries the FILED weight-table discrepancies from
  the EO-STAB M2 parity check, ces-eo/docs/design/readiness-report-contract.md).
- **G-MUSTER-PLAN-2 M1** (import seam superset - the readiness-result.v1 payload rides
  the same synthesizeFactsFromDiscovery + pruneByCoverage seam, now with facts[] +
  attestation semantics defined).
- The attestation record format and draft provenance strings the readiness-result.v1
  payload's `facts[]` cite are now implemented, not just specified.

## Open threads for successors (not defects)

- Archetype CONTENT (the real 4-6 archetypes) - founder-blocked by design (Q3);
  mechanism ships with fixtures.
- Live rung-2 extraction / rung-4 parsing engines - sibling/muster-api dependencies per
  founder decision 2 (execution-locus policy).
- Rung 5 (value-of-information ranker) - blocked on the plan-generator sibling
  dependency; FD-PLANNER-OUTPUTS resolved port/vendor, which is G-MUSTER-PLAN-2 M2
  territory.
- In-interview confirm affordance: confirmation currently happens in the Discovery
  confirm/correct step; a per-question confirm button inside the interview (for drafts
  arriving via archetype/import paths) is a natural GO-3 / READINESS-1 M2 refinement.
