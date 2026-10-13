# G-MUSTER-PLAN-3 — Findings & filed requirements

**Started:** 2026-09-07 (M0). Living document — one entry per finding, newest milestone last.
Each finding records what was discovered, the evidence, the decision taken, and (where it
concerns a sibling repo) the requirement filed against it. Per the write-boundary rule, siblings
are **read** here and **written up** here; nothing is changed in a sibling repo.

**Legend (coined labels used below):**
- **F1…Fn** — findings in this document.
- **Gate (a)…(d)** — the objectively-checkable gates of a milestone, as numbered in
  `G-MUSTER-PLAN-3.md`.
- **`validateArtifactAlignment`** — Planner's cross-artifact consistency check
  (`ces-planner/src/features/mpt/services/validator.ts`); the only output gate Planner's own
  pipeline runs. Vendored by this goal at M4.

---

## M0 findings

### F1 — The vendored Planner OUTPUT SCHEMAS are stale relative to the vendored generators; they are not the operative contract

**Discovered:** 2026-09-07, building M0 gate (a) (mission plan "validates against
`public/schemas/planner/CES MPT Manual Mission Plan schema.json`").

**What I found.** The unforked, drift-pinned `generateManualPlan` produces a Manual Mission Plan
that does **not** validate against the shipped schema — and neither does **Planner's own reference
output**. This is not a Muster defect; it is a pre-existing inconsistency in `ces-planner`,
faithfully carried into Muster by vendoring.

**Evidence.**
- Muster-generated plan vs `public/schemas/planner/CES MPT Manual Mission Plan schema.json`: FAILS.
- Planner's own reference `ces-planner/customers/VFS GCC High G5 M365 + Foundation + Sentinel/
  outputs/manual-mission-plan_manual-2026-04-22T20-03-50-346Z.json` vs the **same** schema: FAILS,
  identically.
- Muster's shipped schema is **byte-identical** to Planner's `dist/schemas/…` (the deployed
  variant). The `decsriptions/CES_13_Schemas_canonical_v4/…` variant is **stricter still**
  (851 errors against the reference).
- Failure classes (all present in Planner's own output):
  - top-level `additionalProperties: false` violated by generator-emitted `inputs.
    infrastructure_configuration` and `ces.cesId`;
  - `outputs_block.required` demands a nested `tenant_manifest` the manual plan never carries
    (the Tenant Manifest is a **separate** artifact in Planner's pipeline);
  - `human_plan.additionalProperties: false` violated by `disposition_summary`,
    `session_control_advisory`, `wireless_access_path_advisory`, `fedramp_inheritance_advisory`;
  - after relaxing `additionalProperties` and dropping the `tenant_manifest` requirement,
    **41 residual errors remain** against Planner's own reference: `steps[].control_coverage`
    `minItems: 1` the generator no longer honors, and `controls[].stamper_action` enum values the
    generator outgrew (e.g. `Inherited-FedRAMP`, `Met-By-Prohibition`, `N-A-Capability-Absent`,
    `Non-Stack`). The schema is stale **in kind**, not in two spots.

**Why this is dispositive.** Planner's own pipeline (`ces-planner/src/features/mpt/hooks/
useMissionPlanGenerator.ts`) **never JSON-schema-validates its outputs** — its only output gate is
`validateArtifactAlignment(manualPlan, proposal, manifest, …)` (cross-artifact consistency). The
JSON output schemas are not enforced anywhere in Planner and were aspirational/documentation
artifacts when this goal was written. Planner could not ship reference outputs that fail a hard
gate — because there is no such gate.

**Decision.** Gate (a)'s schema clause is discharged by **reference-parity**, not JSON-schema
validation. `src/features/plan/missionPlanContract.ts` encodes the CORE contract the generator
unconditionally emits (ces spine · inputs · `outputs.human_readable_mission_plan{plan_id,
plan_mode, target_level, milestones[], steps[], assessor_alignment_notes, control_directives[]}`
· `cost_proposal_sow`). `planParity.test.ts` asserts that core against **Planner's VFS reference
first** (self-verification — a wrong core fails the reference before it fails Muster), then against
Muster's output. The e2e asserts the same core keys on the downloaded file. This is the honest,
stronger gate: it proves "Muster produces what Planner produces," which is the goal's true intent
(equivalence), and it is not a fork of the generator or a hand-authored schema.

**Not done (deliberately):** the shipped schema files are left in place, unmodified. Rewriting them
into generator-accuracy would be authoring a new contract; the operative contract is
`validateArtifactAlignment`, vendored at M4, which will supersede this parity check for
cross-artifact consistency.

**Requirement filed against `ces-planner` (read-only sibling — not changed here):**
> **REQ-PLANNER-SCHEMA-DRIFT (from ces-muster, 2026-09-07):** Planner's shipped output JSON
> schemas (`dist/schemas/*`, `decsriptions/CES_13_Schemas_canonical_v4/*`) do not validate
> Planner's own generator output (verified against the VFS reference). Either regenerate the
> schemas from the current generators, or mark them non-normative. Muster consumes the generators
> (unforked) and gates on reference-parity + `validateArtifactAlignment`, so this does not block
> Muster; it is a provenance defect in the vendored source of truth that will mislead any consumer
> who trusts the schemas.

**Goal-doc addendum:** a dated addendum should be added to `G-MUSTER-PLAN-3.md` M0 gate (a)
recording this discharge (the gate text itself is left unchanged, per the surface-don't-rewrite
rule). Founder may veto the reinterpretation.

---

### F2 — techRefIndex and FedRAMP-table wires carry; the FedRAMP wire is a deliberate no-op for the M0 thin baseline

**Discovered:** 2026-09-07, M0 gate (b).

The two arguments M0 adds to the one compile (`buildTechRefIndex(techRef)` → `compileTaskCatalog`
arg 7; the FedRAMP inheritance table → `compileGapSet` arg 8) trigger on different inputs, so they
are proven **separately** (`planWires.test.ts`):
- **techRefIndex** enriches every task with a `tech_ref` block — proven end-to-end through the
  adapter: with the shipped tech ref, the produced mission plan carries `tech_ref`; without it,
  it does not.
- **FedRAMP table** only changes the gap set for a `cloud_only` SI baseline with valid
  `fedramp_package_ids` and zero physical facilities — **none of which the M0 5-field baseline
  supplies**. So for the default Plan surface it is a correct no-op. Its wire is proven at the
  vendored-compiler boundary with a crafted SI baseline that triggers inheritance, using the exact
  table the SPA ships — producing an `Inherited-FedRAMP` disposition that is absent when the table
  is null. The Muster inputs that would activate it (package IDs, facility counts) arrive with the
  full SI derivation at **M1**.

---

### F3 — cesId is not stamped onto the artifact (Planner-reference parity)

**Discovered:** 2026-09-07, M0.

Passing `cesId` into the generator path stamps `ces.cesId` on the artifact — a field **Planner's
own reference output does not carry**. That divergence would break M1 gate (c) / DONE-WHEN 3
(field-for-field equivalence). Decision: `planCompileService` does **not** pass `cesId`; the tenant
slug used for download filenames is read straight off the readiness manifest, never injected into
the artifact. Asserted in `planParity.test.ts`.

---

### F4 — The SI Baseline generator emits NO validation_warnings for thin input; M0 honesty is carried by Muster, not the generator

**Discovered:** 2026-09-07, M0.

M0's "labels every defaulted field honestly" claim assumed the generator's `validation_warnings`
would list the defaulted fields (target level / CUI presence / boundary strategy). It does not —
for thin M0 input, `generateSIBaseline` produces an **empty** `validation_warnings`. Decision:
Muster tracks its own defaulted inputs (it knows exactly what it did not supply) and surfaces them
on the Plan tab (`plan-defaulted-inputs`, and `PlanCompileResult.defaultedInputs`), independent of
the generator. M1's full SI derivation + interview link-back shrinks this list to the genuine
residue. This is an M0 honesty mechanism, working; it is **not** a gap left open.

---

## M1 findings

### F5 — The SI Baseline schema is stale too; gate (b) discharged via equivalence

**Discovered:** 2026-09-08, M1 gate (b).

Same pattern as F1: `public/schemas/planner/CES SIT Strategic Intent Baseline.schema.json` does
**not** validate Planner's own latest VFS SI baseline (`si-baseline_..._mo9gr1pv_...json`, 15
errors — `additionalProperties`, and `regulated_data_notes`/`assessment_route` type mismatches
where the generator emits arrays/objects the schema types as strings). The schema is stale
relative to the vendored generator, exactly as the mission-plan schema is.

**Decision.** Gate (b) is discharged by the M1 **equivalence** test (`siEquivalence.test.ts`):
field-for-field equality with Planner's stored VFS baseline (except `generated_on`) is strictly
stronger than conformance to a stale schema. No schema amendment; no generator fork.

### F6 — The primed SI Question Bank has 26 questions, not the goal's "31"

**Discovered:** 2026-09-08, M1.

`primed SI Question Bank.yaml` contains **26** questions (ids: G-01…G-08, S-11/12/13/16/20,
SIT-020…025, S-24…S-30), not 31. The computed coverage denominator is **26**; the gate-(a)
coverage test asserts `N of 26`. Gate text in `G-MUSTER-PLAN-3.md` M1 is left unchanged (same
surface-don't-rewrite rule as F1); the completion doc will state the computed 26.

### F7 — M1 derivation surface is modest; the SI generator drops infra_model/license_tier/user_count

**Discovered:** 2026-09-08, M1.

Two facts bound what M1 can honestly derive into the SI baseline:
1. Muster's current inputs are the declared service inventory, the preamble snapshot, the manifest
   and the L2 readiness engine — so only target level, deployment posture, tenant model,
   infrastructure model and license tier are observable now. CUI presence, boundary strategy and
   the operations postures are genuine residue until BTC/TCP derivation (M2/M3) or the interview.
   The reference-context coverage is **5 of 26** — computed, honest, and extensible (the
   derivation is a table in `siDerivation.ts`; M2/M3 add rows).
2. The vendored `generateSIBaseline` never writes `si_baseline.dependencies.{infrastructure_model,
   license_tier, user_count}` — those SIT questions' `sets_its_fields` point at paths the generator
   drops (the compilers read them with defaults downstream). So deriving them prunes the interview
   question correctly but does not change the SI baseline; equivalence (gate c) holds regardless.

### F8 — M1 live-interview residue capture: DELIVERED (enum residue live in the interview)

**Discovered:** 2026-09-08, M1, while wiring gate (d). **Resolved:** 2026-09-08 (founder chose the
F8 follow-up).

The SIT plan-input residue is now live in the adaptive interview — one graph, one pruner, one fact
store, per the goal's "one capture surface":
- `src/features/interview/siPlanInputNodes.ts`: the 12 enum-optioned SIT fields as static
  `QuestionNode`s (`SI_PLAN_INPUT_NODES`), spread into `QUESTION_GRAPH`. cluster `'plan-input:si'`
  (labelled "Plan Inputs"); every node carries `plan_input {contract, field}` and
  `mapped_requirements: []`.
- **Why static-in-QUESTION_GRAPH, not fetched:** `scoreFacts` resolves a fact's requirements via
  `node?.mapped_requirements ?? ['scre.'+id]` — a fact with NO node synthesizes a fake requirement
  and leaks into the score. Putting the SIT nodes in the graph (with `[]`) closes that on BOTH
  scoring paths. Static also preserves the RR graph's documented zero-fetch /
  renderToStaticMarkup-safe design (DW#3b/DW#5). Drift from the bank+schema is caught by the parity
  test (`siLiveResidue.test.ts`).
- `AssessmentPage` prunes the residue with `deriveSitFacts({selectedStacks: selectedServices})` —
  the SAME context the compile uses (`session.selected_stacks`), so interview-pruning and compile
  never disagree — and answered residue lands in `session.facts`, which `planCompileService` reads
  back (capture-loop test in `siLiveResidue.test.ts`).
- **Plan-input nodes are OPTIONAL for finishing** a readiness assessment (`complete` counts only
  non-`plan_input` nodes): readiness never requires plan inputs; answering sharpens the plan. This
  also means no optionless-node can ever brick Finish.
- Score-leak defended on both paths (`requirementStatuses`/SPRS and `mapFactsToRRTAnswers`, the
  `scoreFacts` path — `mapFactsToRRTAnswers` was exported for the test). The `fca-unknown` e2e
  (all-unknown → 0%) is a live probe and stays green.

**Observed flake (not a regression):** `resume-mid-interview.spec` failed once under 8-worker load
on the post-reload progress-note (10s timeout race between the async graph reload and the resume
restore), then passed on retry and in two full re-runs. Pre-existing reload timing sensitivity; the
F8 change adds only a synchronous derivation and 12 nodes. Not modified (touching an unrelated
spec's timing is out of scope); noted for future attention.

### F9 — Numeric/text SIT residue stays Plan-tab-only (radioRow is enum-only)

**Discovered:** 2026-09-08, F8.

`radioRow` renders radio options only. The non-enum SIT residue — counts (`S-11` users/endpoints,
`SIT-022` user count, `SIT-024/025` facility/equipment counts), free text (`G-03` cui_types,
`G-04` regulated_data_notes, `G-06` timing goal object) — has no enum to render, so those questions
are NOT live interview nodes; they remain Plan-tab-only via `defaultedInputs` (zero extra code —
computed from answered facts, so uncaptured residue keeps showing honestly). A text/number input
widget in the interview is the next bounded step **only if** the founder wants full in-interview
capture of those fields; the plan is honest without it (they show as unanswered inputs).

---

### External gate not runnable here

**M0 gate (d)** — `ces-tester demo:show --check` accepting `muster-show-mp` against this build — is
a **ces-tester** gate in a sibling repo. It cannot be run from ces-muster and that repo must not be
modified from here. It is tracked as the cross-repo dependency it is
(`REQ-TESTER-MUSTER-SHOW-MP-2026-09-08`); ces-muster's obligation is to ship the plan surface with
the §4 testids, which M0 does. Strategy flips `REGISTERED_ACTS` on tester's `--check` result.
