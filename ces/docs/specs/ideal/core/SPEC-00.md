# SPEC-00 — Agentic SDLC Method (v1.0)

## Intent

This meta-spec defines *how* the ideal specification library (SPEC-01..12) is authored, scored,
and consumed by agents across the software lifecycle from concept to deployment. It fixes three
things that every downstream spec and every G-SPEC audit depends on: (1) the **maturity model**
(L0–L3) that every requirement is tagged against, (2) the **scoring rules** G-SPEC-2 uses to
assign a level to each `(module × dimension)` cell with cited evidence, and (3) the **consumption
protocol** by which an agent turns a spec into a spec-first task, a definition-of-done, and a
pass/fail gate. The maturity ladder is modeled on recognized capability-maturity ladders: it treats
L3 "Enforced" the way **SLSA** treats build-integrity levels (a claim is only as strong as the
mechanism that makes tampering/regression detectable), and it targets the outcomes **DORA /
Accelerate** identifies as predictive of delivery performance (version control, automated testing,
deployment automation, continuous integration, trunk-based flow) rather than subjective "quality."
The intent is a rubric with **no interpretation debates**: two agents scoring the same repo against
the same requirement must reach the same verdict from evidence alone.

## Requirements

### Maturity model

- **SPEC-00.R1** — *[L2]* The maturity of any requirement is scored on a fixed four-level ladder,
  and no other levels exist: **L0 Absent** — the requirement is not addressed anywhere in the module;
  **L1 Ad hoc** — partially present, inconsistent, or undocumented (works by convention, not
  guarantee); **L2 Systematic** — present, documented, and applied consistently across the whole
  module (a reviewer can point to the pattern and confirm it holds everywhere it should); **L3
  Enforced** — a machine mechanism (CI gate, schema validation at a boundary, or an automated test)
  fails the build/PR if the requirement is violated, so silent regression is impossible.
  *Verify:* every score emitted by G-SPEC-2 is one of exactly `L0|L1|L2|L3`; any other token is a
  malformed score and is rejected.

- **SPEC-00.R2** — *[L2]* The levels are **cumulative**: a cell at level Ln satisfies every
  requirement tagged Ln and every lower-tagged requirement (Ln-1 … L1) in that dimension. A module
  cannot be scored L3 on a dimension while any L1- or L2-tagged requirement in that dimension is
  unmet. *Verify:* for any cell scored Ln, confirm no requirement tagged ≤ Ln in that dimension is
  unmet in the evidence; if one is, the cell's score is capped at (lowest-unmet-tag − 1).

- **SPEC-00.R3** — *[L3]* An **L3 claim is invalid without a named enforcing mechanism**: the
  evidence for any L3 score MUST cite the concrete gate — a CI workflow line, a schema/validator
  invocation at a boundary, or a test that asserts the property — such that if that mechanism were
  deleted, a subsequent audit would detect the drop. A "documented policy" or "code review habit" is
  never L3. *Verify:* the L3 evidence entry contains a path+locator to an executable check (e.g.
  `.github/workflows/ci.yml:NN`, `schema.types.ts:NN`, `foo.test.ts:NN`); if it points only to prose
  (README/ADR/comment), downgrade to at most L2.

### Scoring rules

- **SPEC-00.R4** — *[L2]* **No evidence, no score above L0.** Every score of L1 or higher MUST carry
  ≥1 cited piece of evidence that is independently checkable: either a `file:line` reference in the
  repo or captured command/tool output (e.g. a test run, `npm audit`, a grep result). Assertions
  without a locator are not evidence. *Verify:* each non-L0 cell in the G-SPEC-2 matrix has at least
  one evidence citation resolving to a real file:line or a reproducible command; uncited cells are
  treated as L0.

- **SPEC-00.R5** — *[L2]* A cell is scored **per requirement first, then rolled up**: the agent
  assigns pass/fail to each requirement in the dimension (each with its own evidence), and the cell
  level = the highest Ln such that all requirements tagged ≤ Ln pass (per R2). The rollup, not a
  gestalt impression, sets the cell. *Verify:* the cell score equals the deterministic rollup of its
  per-requirement verdicts; a cell level unsupported by the underlying requirement verdicts is
  incorrect.

- **SPEC-00.R6** — *[L2]* **"Meets ideal" is defined relative to the CES profile target, not to
  L3.** A cell meets the ideal iff `as-is level ≥ CES-profile target level` for that dimension. A
  dimension the profile targets at L2 is fully conformant at L2; exceeding the target is not required
  and not a gap. *Verify:* for each dimension, compare the scored as-is level to `ces-profile.md`'s
  stated target; flag a gap only when as-is < target.

- **SPEC-00.R7** — *[L2]* **Waivers are explicit and scoped.** A requirement excluded for a module
  MUST be named with a rationale in `ces-profile.md`; a waived requirement is scored `N/A` (excluded
  from rollup), never silently passed. The profile may only *tighten* (raise a dimension target, add
  a CES-specific requirement) or *waive* (exclude a named requirement with rationale) — it never
  re-tags an existing core requirement's level. *Verify:* every `N/A` in the matrix maps to a named
  waiver in the profile; any un-waived requirement scored `N/A` is a scoring error.

- **SPEC-00.R8** — *[L2]* **Scores are reproducible.** Given the same repo commit and the same
  spec+profile versions, re-scoring MUST yield the same cell levels; each evidence citation MUST
  include enough locator detail (path + line or exact command) to re-verify without re-investigation.
  *Verify:* spot-check ≥5 cells by following only their cited evidence; each verdict must be
  reconstructable from the citation alone with no additional interpretation (acceptance-criterion 3
  of G-SPEC-1).

### How agents consume SPEC-01..12

- **SPEC-00.R9** — *[L2]* **Spec-first task framing.** Before implementing in a dimension, an agent
  loads the relevant core spec + the CES profile overlay and frames the task against specific
  requirement IDs (the target level for that dimension sets the bar). Work items reference the
  `SPEC-NN.Rk` they advance. *Verify:* a task/plan touching a dimension cites the governing
  `SPEC-NN` requirements and the profile target level it is working toward.

- **SPEC-00.R10** — *[L2]* **Conformance checklist = definition-of-done.** A change in a dimension is
  "done" only when the relevant spec's Conformance checklist items (up to the profile target level)
  pass, each answered yes/no with the same evidence discipline as scoring (R3/R4). *Verify:* the
  change's DoD enumerates the checklist items it satisfies with citations; unchecked in-scope items
  mean not-done.

- **SPEC-00.R11** — *[L2]* **Artifact-driven pipeline stages.** Agentic work proceeds through the
  fixed stages **vault → review → plan → gap → execute → critique**, each stage consuming and
  emitting a durable artifact rather than ephemeral chat: recon/context (vault), as-is review,
  PLAN.md, gap matrix (as-is vs profile target), implementation, and post-hoc critique. Each stage's
  output is the next stage's input. *Verify:* for a completed goal, the chain of artifacts exists and
  links forward (e.g. recon → PLAN → gap report → implementation log → critique), no stage skipped
  without rationale.

- **SPEC-00.R12** — *[L2]* **The profile overlays targets; the core defines the ladder.** Agents read
  target levels *only* from `ces-profile.md` and requirement definitions/level-tags *only* from the
  core specs; the two are never conflated. Not every dimension targets L3 — the profile states each
  target with a one-line rationale (e.g. deployment may target L2 pre-SaaS). *Verify:* the profile
  states exactly one target level per SPEC-01..12 dimension with a rationale; the core specs contain
  the level tags; neither duplicates the other's role.

- **SPEC-00.R13** — *[L2]* **Requirements are verifiable, never aspirational.** Every requirement in
  every core spec (and every profile tightening) states a check that resolves to a boolean from repo
  evidence — a threshold, a presence/absence grep, a passing gate — not a subjective quality claim.
  *Verify:* each `SPEC-NN.Rk` contains a "Verify" clause an agent can execute against the repo to a
  yes/no; any requirement lacking one is malformed and must be revised before use.

- **SPEC-00.R14** — *[L3]* **The library is versioned and amended, never silently edited.** Each spec
  carries a version (`vX.Y`) and changes land as changelog lines; a requirement's meaning or level
  tag does not change under a stale version. *Verify:* git history for any edited spec shows a version
  bump and a changelog entry (`docs/specs/ideal/README.md` amendment policy); a substantive edit with
  no version/changelog change is non-conformant.

## Anti-patterns

- **Gestalt scoring** — assigning a cell level by overall impression instead of rolling up
  per-requirement verdicts (violates R5). Symptom: a cell level no underlying requirement supports.
- **Prose-backed L3** — citing a README/ADR/comment/"we always review this" as the enforcement for
  an L3 claim (violates R3). If deleting the citation wouldn't fail a build, it isn't L3.
- **Uncited pass** — marking a requirement met with no `file:line`/command locator (violates R4).
- **Ideal-inflation** — treating L3 as the universal bar and reporting gaps against L3 where the
  profile targets L2 (violates R6). Manufactures false gaps.
- **Silent waiver** — skipping a requirement without a named, rationale-bearing waiver in the profile
  (violates R7); the inverse, scoring a waived requirement as a pass, is equally wrong.
- **Ladder-skipping** — claiming Ln while an Ln-1 requirement in the dimension is unmet (violates R2).
- **Stage-skipping** — implementing without the upstream artifacts (no recon, no plan, no gap)
  (violates R11); produces unverifiable, unframed changes.
- **Aspirational requirement** — a spec line with no executable Verify clause ("logging should be
  good") (violates R13); cannot be scored and poisons the whole dimension.
- **Silent amendment** — editing a requirement's meaning/level in place without a version bump or
  changelog line (violates R14); makes historical scores non-reproducible.

## Conformance checklist

- [ ] Every emitted score is exactly one of `L0|L1|L2|L3` (or `N/A` with a waiver). — R1, R7
- [ ] No cell is scored Ln while a requirement tagged ≤ Ln in its dimension is unmet. — R2, R5
- [ ] Every L3 score cites an executable enforcement mechanism (CI line / schema / test), not prose. — R3
- [ ] Every non-L0 score carries ≥1 checkable evidence citation (`file:line` or command output). — R4
- [ ] Each cell level equals the deterministic rollup of its per-requirement verdicts. — R5
- [ ] "Gap" is flagged only where as-is level < CES-profile target level. — R6
- [ ] Every `N/A` maps to a named waiver with rationale in `ces-profile.md`. — R7
- [ ] ≥5 spot-checked cells are reconstructable from their citations alone, no re-interpretation. — R8
- [ ] Tasks/plans in a dimension cite the governing `SPEC-NN.Rk` and the profile target level. — R9
- [ ] The change's definition-of-done enumerates satisfied checklist items with citations. — R10
- [ ] The goal's artifact chain (vault→review→plan→gap→execute→critique) exists and links forward. — R11
- [ ] The profile states exactly one target + rationale per dimension; core holds the level tags. — R12
- [ ] Every requirement consumed has an executable Verify clause. — R13
- [ ] Edited specs show a version bump + changelog line. — R14

## CES profile hooks

- SPEC-00 is **method, not dimension**: `ces-profile.md` does **not** assign it a per-dimension
  target level. Its requirements are unconditionally binding on every G-SPEC-2 audit and every
  agent consuming the library — the profile cannot waive R1–R14.
- The profile's only interfaces to this meta-spec are the ones R6/R7/R12 define: it supplies the
  **target level per dimension** (consumed by R6), the **named waivers** (consumed by R7), and any
  **CES-specific tightenings** (new requirements added under a dimension, which then obey R2–R5
  like any core requirement). It never re-tags or re-levels a core requirement (R7, R12).
- Reproducibility/evidence discipline (R3, R4, R8) is the mechanical backbone for CES's
  evidence-integrity posture (hashing, WORM intent, 6-year retention): audit scores are themselves
  evidence and must meet the same citation bar as the product's compliance evidence.
