# Goal Document - G-MUSTER-READINESS-1: Readiness payload + readiness mode + customer report

**Date:** 2026-07-11 - **Type:** /goal.
**Provenance:** founder directive 2026-07-11 working-system program
(ces-strategy/docs/context/VAULT.md, section A item 1; lane analysis
ces-strategy/docs/context/masterplan/muster-modes.md sections 1-3; master plan
ces-strategy/docs/MASTER-PLAN-2026-07-11.md).

## Job

Ship MUSTER-READINESS: a mode whose output is a READINESS RESULT (detailed log of
discovery findings from a session that may be self-hosted, independent, or
collaborative-with-BHD) plus a customer-ready readiness report (SPRS now / gaps / SPRS
after fixing gaps). Four milestones:

- **M1 - readiness-result.v1 schema (S).** Spec + JSON-schema the payload per the
  muster-modes lane proposal (normative text: muster-modes.md sec. 1; summarized in the
  master plan appendix). Top level: `schema_version`, `manifest` (mode / auth_tier /
  tenant{slug,kind} / operator / optional bhd_presence / engagement ids / timing),
  `observations[]` (DiscoveryResult row + ran_entry_ids[] + raw_capture_ref +
  derived_posture + objective_coverage A/B/C + residual_must_have[]), `facts[]`
  (InterviewFact shape + GO-2 attestation extension), `derived` (sprs_now, gaps[],
  sprs_after), `provenance` (registry versions, coverage dataset id, engine, generated_at).
  Design rule: the payload IS the import-file format - one schema for canned fixture,
  admin script upload, ces-tester run, and BHD session. This milestone is deliverable #1
  of all mode work and blocks G-MUSTER-PLAN-2, G-DISCOVERY-1, and the tester schema slot.
  It depends on nothing - do it first.
- **M2 - readiness-mode path + exporter (M).** Readiness mode = a PATH through the
  existing five-tab shell (Situation -> Discovery(run) -> GO-2 rung-1 confirm/correct ->
  Readiness tab), not a new app. New work: `readinessResultService.ts` exporter beside
  statusPayloadService.ts following the exportPipeline pattern (Dexie -> routeFacts ->
  score -> build -> download), plus manifest capture (mode / auth_tier / operator) in the
  Situation tab.
- **M3 - customer readiness report (M).** On-screen: ReadinessTab extension (SPRS-after +
  gap table). Export: download via the export pipeline (self-contained HTML per house
  style, or existing JSON + print view). Content: (1) SPRS now from `computeSprs`,
  counting ONLY attested/observed non-draft facts; (2) gap list two-tier - registry-fixable
  rows showing the fix path (set_command entry labels) vs collect-list rows for B/C
  documentary residuals (residual_must_have wording per
  registry-objective-coverage-2026-07-10.md:21-24); (3) SPRS after, labeled explicitly as
  a PROJECTION conditional on remediating the registry-fixable gaps. Provenance badge on
  every fact line; GO-2 M4 exact draft-labeling strings; FCA disclaimer footer.
- **M4 - BHD weights validation (S).** sprsCalc.ts:9 carries "[validate with BHD] verify
  weights ... before any customer-facing use" - that validation is REQUIRED before this
  report ships to a customer. Record the validation outcome in the goal completion doc.

## Must-NOTs

- NO second SPRS implementation. `sprs_now` and `sprs_after` both come from Muster's
  parity-proven `computeSprs` (src/features/scoring/sprsCalc.ts); `sprs_after` is a
  re-run projection, never presented as a score the org has. EO's calculators are never
  called for the number.
- NO second payload format, ever. Fixture, script-upload, tester, and BHD-session flavors
  all validate against the one schema.
- NO new engagement kind. `mode` is a session/manifest attribute; EngagementKind
  (`prime_and_subs | individual_contractor`) stays untouched.
- NO network in the SPA (noNetworkCalls.test.ts guardrail stands); import-file bypasses
  ces-tenant by design.
- NO rebuilding EO's results matrix - ReadinessTab keeps consuming ResultsMatrixArtifact[];
  the report needs only SPRS + gaps, so the matrix panel is consume-when-available
  (EO packaging is G-EO-STAB-1 M2 territory).
- Unconfirmed drafts NEVER contribute to a passing score or an unlabeled report line.
- Raw command output never inline in the payload - `raw_capture_ref` pointers only.

## Acceptance gate (objectively checkable)

1. A JSON-schema file for `readiness-result/1.0.0` exists in-repo; a test validates at
   least: one canned fixture, one script-upload-shaped fixture, and one tester-shaped
   fixture against it (green).
2. Readiness mode export produces a file that VALIDATES against the schema, with manifest
   fields populated from the Situation-tab capture.
3. The report renders SPRS now, the two-tier gap list, and SPRS after with the word
   "projection" (or the agreed exact label) present - asserted in a test.
4. A test asserts that adding an unconfirmed draft fact does NOT raise `sprs_now`.
5. All existing suites stay green (web/e2e/drift boards); no new P0s.
6. M4 validation outcome recorded (pass, or blocking discrepancies filed).

## Preconditions

- Commit the uncommitted 2026-07-11 divergence fixes (confidence-tiered pruner,
  on_prem_ot seam) before starting (muster-modes.md item 7).
- M1: none further. M2/M3: G-MUSTER-GO-2 M1-M5 executed (attestation record format, draft
  provenance strings, never-passes guardrails that `facts[]` and the report labels cite).

## Pointers

- ces-strategy/docs/context/masterplan/muster-modes.md (normative payload text, secs 1-3)
- src/features/export/statusPayloadService.ts, exportPipeline.ts (exporter pattern)
- src/features/scoring/sprsCalc.ts (the one calculator)
- src/__fixtures__/discoveryResults.ts, src/shared/types/engagement.ts (row shapes)
- docs/goals/G-MUSTER-GO-2.md (M3 import==upload, M4 attestation strings)
- ces-strategy/docs/data/registry-objective-coverage-2026-07-10.json (planner_gen2_feed)
- ces-strategy/docs/MASTER-PLAN-2026-07-11.md appendix (payload summary)
