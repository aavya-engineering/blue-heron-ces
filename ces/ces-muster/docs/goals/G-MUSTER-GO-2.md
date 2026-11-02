# Goal Document — G-MUSTER-GO-2: The Answer Engine

**Date:** 2026-07-10 · **Type:** `/goal`, not `/loop`. The design's "repeating ez-button
loop" is *product runtime behavior*, not process iteration — it must not pull this toward
`/loop`. The bounded cut is the design's own, from its "Where this lands in G-MUSTER-GO-1"
section (restated in this goal's words, not invented): rung 1 (infer+confirm), rung 3
(archetypes), and auth-ladder tier 2 (= GO-1's import-file mode) are checkable early
milestones; rung 4 is the largest build, behind them; rung 5 is blocked on an unbuilt
plan-generator. That mirrors GO-1's M1–M6 core / M7-stretch shape — a defined stopping
point, so a `/goal` fits.

**Placement note:** `ces-muster/docs/goals/G-MUSTER-GO-2.md`, in the `docs/goals/`
directory G-MUSTER-GO-1 established (sibling precedent: `tenant-stacksim/docs/goals/
G-STACKSIM-1.md`). This file is **G-MUSTER-GO-1's direct successor** — see "Relationship
to G-MUSTER-GO-1" below.

---

## MANDATORY ENGINEERING NOTE — top-level constraint, applies to every milestone below

**"DO NOT REPLICATE CODE AS AN EASY OUT — DO THE RIGHT THING FROM A SOFTWARE ENGINEERING
POV."** (founder, verbatim, carried from G-MUSTER-GO-1.) For this goal, the design's
standing engineering note is binding: **one question-graph store with one provenance model
serves all five rungs — the rungs are *fillers* of the same schema, not five parallel
question systems.** Concretely: rung 1 consumes the Discovery tab's existing results
(GO-1's M-milestones built them) — the new work is inference rules and the confirm/correct
UI, not a second discovery lane; rung 2 builds in the existing `src/features/contracts/`
lane; rungs 3–4 refactor the **existing question bank** into the adaptive graph rather than
authoring a second bank. A second question bank, fact store, or provenance model found
anywhere in this goal's output is an automatic brutal-critic defect (DONE-WHEN #8).

---

## Objective

Give every fact Muster needs **one ordered, best-first resolver chain** — *discover →
infer-and-confirm → extract-from-document → archetype-default → ask-the-human* — run by one
engine working the question list biggies-first, best available resolver per fact, falling
down the chain only as needed, repeating: each pass shrinks the next. All resolvers fill
the same fact store under one provenance model; every auto-drafted answer ends in named
human attestation before it counts.

## Why now (grounded in computed numbers)

The numbers are GO-1's, reused verbatim (per `docs/registry-objective-coverage-2026-07-10.md`
and `docs/plannergen2ideas.md`, ces-strategy): running the Stamper registries' 201 runnable
get_commands reads live state on **96 of 110 controls (87.3%)** and plausibly evidences
**~133 of 320 objectives (41.6%, ±10–15)**. The other **150 objectives (46.9%)** sit on
get-covered controls but are definitional/procedural/physical/human-activity — documents
and attestations, not commands. **37 (11.6%)** sit on 14 manual-only controls with no
readable surface at all.

GO-1 built the discovery-first skin over the ~42% machines can answer. This goal is the
honest majority: the ~6-in-10 residual differs **in kind** — Strategic Intent and the CUI
boundary are questions about intent, business reality, and information flows no get_command
sees, and today's answer to them is blank-field recall, the most expensive elicitation
format there is. The chain replaces recall with confirmation (rung 1), reading (rung 2),
priors (rung 3), conversation (rung 4), and deferral of the plan-invariant (rung 5).

**Illustrative-numbers rule (binding on gates):** the design's ez-button example (61/12/5)
is **illustrative**, not computed — it MUST NOT appear in any gate or drift test; only the
computed figures above (41.6%/87.3%/150/37, 96/110, ~133/320, 201) are gate-citable.

## The flow — user-visible behavior

The user experiences **one repeating loop with an ez-button, not modes**:

> "I can answer N of these automatically — press the button."
> → "Some need your documents — upload them."
> → "The rest need you."

(Counts computed at runtime; the design's 61/12/5 rendering is illustrative — see above.)
Each pass drafts what it can, asks the human to confirm/correct rather than recall, and
shrinks the next pass. GO-1's five tabs are the UX **skin** over this loop — the Discovery
tab is the ez-button's first press, not a separate philosophy. Two engineering truths from
the design: **intent is per-question, execution is method-batched** (one tenant sweep, one
document extraction, one interview — not N of each); **resolver availability is
environmental** — the auth tier the customer clears determines which chain-heads are live,
and chains degrade per-command, never all-or-nothing.

## Relationship to G-MUSTER-GO-1

Founder decisions, 2026-07-10, recorded in `docs/context/REVIEW.md` — transcribed here as
**binding fact, not options; this goal does not re-decide them**:

1. **GO-1 completes as-is.** G-MUSTER-GO-1's walking skeleton stands as implemented
   (critic PASS); this goal (G-MUSTER-GO-2) is its **successor** and owns rungs 1–5. GO-1's
   completion doc (`docs/GOAL_COMPLETION_G-MUSTER-GO-1.md`) is written on GO-1's own final
   approval, independent of GO-2's progress. GO-2 does not reopen, amend, or re-gate GO-1's
   M1–M6.
2. **muster-api + sibling-block live AI.** Walking-skeleton milestones run on canned
   fixtures (GO-1's M3 pattern). Network/AI-touching resolver execution lives in muster-api
   where feasible; live extraction/AI engines are filed as sibling dependencies (mirrors
   GO-1 open-decision-2 precedent). The SPA stays zero-network.
3. **Drafts prune, never pass.** An unconfirmed draft (archetype default, inferred
   boundary, extracted answer) DOES prune/defer questions, but renders as a draft
   everywhere — including in readiness math — and NEVER counts as met until a named human
   attests. Unknown still never prunes at all.

**Scope note (this document's own claim):** GO-2's engine covers **every question Muster
asks** — discovery included, as chain-head — not only the residual. The design doc's
"Companion to" conflict is fixed only by its own surgical header edit (authoritative for
its scope claim); this section states GO-2's scope independently, and neither document's
wording overrides the other on a later edit.

## The resolver chain — rungs, provenance, and the draft/attested boundary

### The rungs (best first), each with its existing lane

- **Rung 1 — Infer from footprints, then confirm (don't ask).** Discovery can't see the
  CUI boundary as *intent*, but it sees its evidence (labels, DLP policies, site
  permissions, security groups, gov-cloud tenancy); Muster **drafts the boundary** and asks
  for correction, not creation. *Design's implementation note:* consumes the same discovery
  results the Discovery tab already produces (G-MUSTER-GO-1 M-milestones); the new work is
  the inference rules (footprint → boundary-draft) and the confirm/correct UI. No new
  tenant access needed.
- **Rung 2 — Read documents, not people.** The contract (DFARS 252.204-7012 clause, DD-254
  CUI categories, CDRLs, period of performance), SSPs, diagrams: extraction drafts, the
  human confirms. *Design's implementation note:* `src/features/contracts/` already exists
  as a lane — a home waiting; the confirm step makes imperfect extraction acceptable.
- **Rung 3 — Archetype priors.** First adaptive question: "Which of these looks most like
  you?" — prefilling dozens of long-tail defaults; adaptive answering probes only
  deviations. *Design's implementation note:* the Capability Taxonomy and Implementation
  Patterns domain knowledge files are the raw material for archetype definitions (located —
  see Grounding); prefills carry `source: archetype-default` provenance until individually
  confirmed or overridden — priors, not facts.
- **Rung 4 — Interview, not form.** Conversational intake parses free-text into the
  structured store; the question bank stops being the UX and becomes the **schema**.
  *Design's implementation note:* `src/features/coach/` points in this direction; parsed
  fields carry `source: interview-extracted` provenance and surface in the same
  confirm/correct UI as rungs 1–2. AI-assisted parsing enters here.
- **Rung 5 — Ask only what changes the plan.** Provisional plan with declared unknowns;
  remaining questions ranked by value-of-information; plan-invariant fields deferred to
  SSP-drafting time. *Design's implementation note:* requires a plan generator that accepts
  marked assumptions — none exists in Muster; filed as a sibling dependency (below).
  **Rung 5 has no milestone in this goal.**

### Draft vs. attested — the FCA guardrail, uniform across rungs

Founder decision 3 (above) is the semantics; the design's guardrail section is the record
format: every inferred, extracted, archetype-defaulted, or parsed answer ends in human
attestation — *drafted by [discovery inference / document extraction / archetype default /
interview parsing], confirmed by [name] on [date]*. Nothing auto-drafted converts silently;
unconfirmed drafts render as drafts everywhere, including readiness math. The ladder
reduces **typing**, never **accountability**.

### Provenance mapping — resolver sources onto the existing A > C > B router

Source of truth: `src/features/scoring/factRouter.ts` and its tests (`factRouter.test.ts`,
`factRouterDiscoveryPassthrough.test.ts`). The real values as implemented today:

| factRouter reality (verbatim from code) | Value |
|---|---|
| Tier type | `ProvenanceClass = 'A' \| 'C' \| 'B'` |
| Precedence | `CLASS_RANK = { A: 0, C: 1, B: 2 }` (lower = higher precedence) |
| `classOf('auto_detected')` | `'A'` — machine-harvested current state |
| `classOf('captured')` | `'C'` — recipe-captured point-in-time evidence |
| `classOf(anything else)` | `'B'` — conservative fallback (incl. `operator_interview`, `ai_adaptive`) |
| Within-class merge | conservative answer first: `'no'` (0) > `'unknown'`/`'unsure'` (1) > `'yes'`/other (2); tie → most recent `recorded_at` |
| Discovery passthrough today | `synthesizeFactsFromDiscovery` emits `provenance: 'auto_detected'` (class A) with `answer: 'unsure'` for unknown-confidence — routes identically to a human unsure (tested) |

Mapping of the design's four resolver provenances onto that router (the target state this
goal's gates assert; extending `classOf` is part of open decision Q4/Q6 below):

| Resolver provenance | Rung | Tier while an unconfirmed draft | Tier once attested | Rationale |
|---|---|---|---|---|
| `discovery-inferred` | 1 | B (today's `classOf` fallback for any unrecognized string) | A-equivalent | Derived from `auto_detected` discovery evidence; confirmation upgrades it to the evidence's own class |
| `document-extracted` | 2 | B (same fallback) | C-equivalent | Point-in-time evidence read from a captured document — the `captured` class's own definition |
| `archetype-default` | 3 | B | B (human-confirmed answer) | A prior, not evidence; attestation makes it a human answer, never machine-class |
| `interview-extracted` | 4 | B | B (human-confirmed answer) | Parsed human speech is still a human answer |

Two invariants the table must never break (regression-gated in M5): **A > C > B precedence
survives every new provenance string** (unrecognized → B is correct conservative behavior),
and **no draft, whatever its tier, counts as met until attested** — draft tier affects
*pruning order and display*, never *pass/fail*. Unknown never prunes, never passes.

## Milestones — walking skeleton, objectively checkable

**Numbering disambiguation (binding):** milestone numbers (M1–M6) and rung numbers (1–5)
are **two separate schemes sharing numerals by coincidence**. Every milestone names which
rung(s) it implements, or "no corresponding rung" for cross-cutting ones. "M4" ≠ "rung 4."

**M1 — Rung 1: infer + confirm.** *(Implements rung 1.)* Boundary draft generated from
GO-1's canned discovery fixture; confirm/correct UI over the drafted fields. *Gate:* a unit
test asserts a drafted boundary from the fixture; edited fields persist as corrected,
unedited fields persist as `source: discovery-inferred, unattested`.

**M2 — Rung 3 mechanism: archetype selection.** *(Implements rung 3 — mechanism only;
content is a non-goal, see below.)* A fixture archetype set drives a selection UI;
selecting one prefills `source: archetype-default` fields, each individually overridable.
*Gate:* a unit test asserts prefills carry archetype-default provenance until overridden;
an override replaces it with a human-entered source.

**M3 — Auth-ladder tier 2 / import-file mode.** *(Feeds rung 1's fact store; not itself a
rung.)* A script-upload results file is ingested via GO-1's import-file mechanism
(open-decision-0/1: script-upload and import-file are one mechanism) and populates the same
fact store rung 1 reads. *Gate:* the upload path produces boundary-draft behavior
**identical** to M1's canned-fixture path — equivalence asserted in a test, not described.

**M4 — Draft rendering + attestation record format.** *(Cross-cutting; NO corresponding
rung — do not confuse with "rung 4," which is interview parsing, deferred to M6.)* Every
drafted fact from M1–M3 renders as a draft everywhere it appears, including readiness math;
confirming writes *"drafted by [source], confirmed by [name] on [date]"*. *Gate:* a test
asserts an unconfirmed draft never contributes to a passing score; a second test asserts
the exact attestation string shape.

**M5 — Never-passes scoring guardrail.** *(Cross-cutting regression gate; no rung.)*
Extends the FCA suite for the draft semantics: drafts prune/defer questions but never count
as met; unknown still never prunes. *Gate:* a session containing only unconfirmed drafts
scores **identically** to the same session with those facts absent.

**M6 (stretch, explicitly deferrable) — Rung 4: interview-parsing fixture pass.**
*(Implements rung 4 — the only milestone that does; rung 5 has none.)* A canned transcript
fixture parses into structured facts with `source: interview-extracted` provenance,
surfacing in the M4 confirm/correct UI. Behind M1–M5; **not required for DONE-WHEN if
scoped out.** No live AI parsing — fixture only (founder decision 2).

Five core milestones plus one deferrable stretch — GO-1's M1–M6 + M7-stretch shape. Every
gate runs on canned data; no live engine call exists in ces-muster at this goal's completion.

## DONE-WHEN (all must hold for the walking-skeleton scope, M1–M5; M6 only if kept)

1. M1 gate holds: fixture-drafted boundary; edited fields persist corrected, unedited
   persist `discovery-inferred, unattested`.
2. M2 gate holds: archetype-default provenance until override; override replaces source.
3. M3 gate holds: upload path ≡ fixture path, asserted as equivalence.
4. M4 gate holds: no unconfirmed draft contributes to a passing score; attestation record
   shape asserted exactly.
5. M5 gate holds: drafts-only session scores identically to the facts-absent session.
6. Guardrail survival, asserted not assumed: `noNetworkCalls.test.ts` extended over every
   new SPA surface (rungs 1–3 UI) and green; the FCA suite extended per M5 and green;
   A > C > B routing suites green with the new provenance strings present in test data.
7. `npm run check:drift`, `npm run build`, `npm run lint` all exit 0; vendored spine
   (`src/vendored/**`) untouched.
8. Brutal critic (separate agent, no self-certification) records PASS, attacking
   specifically: (a) any path where a draft crosses the draft/attested boundary without a
   named-human attestation record; (b) any second question bank, fact store, or provenance
   model — automatic numbered defect per the engineering note; (c) FCA breach: any
   construction where unknown prunes, unknown passes, or an unconfirmed draft counts as met.
9. HIL user approval (last gate) — on approval, write
   `ces-muster/docs/GOAL_COMPLETION_G-MUSTER-GO-2.md`. No approval, no completion.

## Non-goals (out of scope for this goal)

- **Rung 5 in any form** — value-of-information ranker and its plan-generator (see below).
- **Live rung-2 extraction engine** — extraction beyond canned fixtures; the gov-cloud-safe
  engine choice (Q2) is a sibling dependency.
- **Live rung-4 AI parsing** — M6, if kept, runs on a transcript fixture only.
- **Archetype *content* authorship** — the 4–6 archetypes encode business judgment and need
  founder review (Q3); M2 ships the mechanism against a fixture set.
- **Auth-ladder tiers 1, 3, and 4** — device-code sign-in, the Secure-Score-class lite
  tier, and cert app-only; only tier 2 (script-upload = import-file) is in scope (M3).
- **Reopening GO-1's M1–M6** — founder decision 1.

## Open design decisions (goal-internal; none block M1–M5 fixture work)

1. **Q1 — Rung-1 inference rules: rule-based first.** Carrying the design's own
   recommendation: rule-based footprint mapping first (auditable and cheap); AI-assisted
   inference later if ever, and then in muster-api per the execution-locus policy below.
2. **Q4 + Q6 (paired) — provenance schema and chain data model.** Extend the existing
   answer store or version it; and where each fact's chain order lives (per-question in the
   graph vs. per question-class defaults with overrides). This goal's data-model decision,
   made together before M1 lands its provenance strings; the mapping table above is the
   acceptance shape either way.
3. **Q5 — auth-ladder build order: script-upload first.** Carrying the design's
   recommendation: script-upload is the smaller build and is literally GO-1's import-file
   mode (open-decision-0 records the equivalence); device-code is the smoother demo,
   later. M3 implements this.
4. **Execution-locus policy (RESOLVED by founder decision 2 — policy, not an open
   question):** network/AI-touching resolver execution lives in muster-api where feasible;
   live engines are sibling dependencies; the SPA stays zero-network. No milestone may
   weaken `noNetworkCalls.test.ts`.
5. **Rung-3 mechanism/content split.** The mechanism (selection UI, archetype-default
   provenance, override path) is milestone-able now and is M2; the content (the real 4–6
   archetypes) is founder-blocked, filed as dependency/non-goal — NOT a blocker on M2.
6. **Q2/Q3 scope clarification (binding):** the gov-cloud-safe extraction constraint (Q2)
   and archetype authorship (Q3) block only **live** rung-2/rung-3 work — no fixture-based
   milestone in this goal. Do not misread them as blocking M1-level work.

## Dependencies on siblings (filed as requirements, not built here)

- **Plan generator accepting marked assumptions (rung 5's prerequisite).** None exists in
  Muster; rung 5 requires one that accepts marked assumptions and reports which inputs it
  is sensitive to. Filed sibling-style per GO-1's Dependencies precedent (likely
  ces-eo/ces-planner territory); rung 5 stays out until this ships.
- **Gov-cloud-safe extraction/AI engines for live rungs 2 and 4.** Q2 is "a real
  constraint, not a detail" (design, verbatim): if customer contracts transit an extraction
  engine, the choice must be government-cloud-safe. Live extraction and conversational
  parsing are sibling/muster-api dependencies per founder decision 2; this goal's fixtures
  deliberately defer them.
- **Secure-Score-class lite auth tier (auth-ladder tier 3) — parked, explicitly.** No
  landing spot in any rung or milestone here; a non-goal-for-now, not a dangling thread.
  If a deal needs a same-day coarse posture snapshot, that is a future goal's scope.

## Grounding — files cited

- `ces-muster/docs/design/residual-elicitation-ladder.md` — "The Answer Engine," the source
  design (resolver chain, auth ladder, FCA guardrail, engineering note, six open questions).
- `ces-muster/docs/context/REVIEW.md` — the three P0 founder decisions of 2026-07-10
  transcribed above; the P1/P2 findings this document closes.
- `ces-muster/docs/goals/G-MUSTER-GO-1.md` — predecessor goal; format precedent; source of
  the verbatim figures (41.6%/87.3%/150/37, 96/110, ~133/320, 201) and open-decision-0.
- `ces-muster/src/features/scoring/factRouter.ts` + `src/features/scoring/__tests__/factRouter.test.ts`,
  `factRouterDiscoveryPassthrough.test.ts` — real A>C>B values in the provenance table.
- `ces-muster/src/features/interview/discoveryFactJoin.ts` (`synthesizeFactsFromDiscovery`)
  — discovery-fact synthesis rung 1 builds on.
- `ces-muster/src/features/contracts/` (rung 2's lane), `src/features/coach/` (rung 4's
  lane), `src/features/interview/questionGraph.ts` (the bank rungs 3–4 refactor),
  `src/features/interview/__tests__/noNetworkCalls.test.ts` (the zero-network guardrail
  every new SPA surface must extend).
- **Capability Taxonomy / Implementation Patterns (rung 3's raw material) — located.**
  Bounded one-pass search across ces-strategy and ces-eo (read-only), 2026-07-10:
  `ces-strategy/analysis/product-analysis-planner.md` documents both as Planner knowledge
  banks — `/data/domain Capability Taxonomy.yaml` (line 160) and
  `/data/domain Implementation Patterns.yaml` (line 157), i.e. in the ces-planner product's
  data directory. No match in ces-eo. Per the bounded-search rule the YAMLs themselves were
  not walked; ces-planner is read-only for edits, so archetype definitions derived from
  them must live in ces-muster (or a fixture) — consumed, not forked.
- `ces-strategy/docs/registry-objective-coverage-2026-07-10.md`,
  `ces-strategy/docs/plannergen2ideas.md` — the computed coverage numbers (via GO-1).
