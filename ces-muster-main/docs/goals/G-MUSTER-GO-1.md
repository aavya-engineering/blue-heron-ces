# Goal Document — G-MUSTER-GO-1: The Discovery-First "GO Flow"

**Date:** 2026-07-10 · **Type:** `/goal`, not `/loop`. This is a bounded flow rework with
five named tabs and objectively checkable, walking-skeleton acceptance gates per tab — not
open-ended iteration. A `/goal` fits; a `/loop` would not have a defined stopping point.

**Status (2026-07-10, founder decision):** GO-1 completes as-is — its walking skeleton
stands as implemented (critic PASS) and its completion doc is written on its own final
approval. Succeeded by `docs/goals/G-MUSTER-GO-2.md` ("The Answer Engine"), which owns
resolver-chain rungs 1–5 and does not reopen this goal's M1–M6.

**Placement note:** this file lives at `ces-muster/docs/goals/G-MUSTER-GO-1.md`, matching
the goals-directory convention already established at `tenant-stacksim/docs/goals/G-STACKSIM-1.md`
(`C:\Users\mhsut\DevProjects\ces\tenant-stacksim\docs\goals\G-STACKSIM-1.md`). ces-muster
itself had no `docs/goals/` directory before this file (its prior goal *definitions* —
G-MUSTER-P0/P1/P2 — were saved as `_goal-muster-p{0,1,2}.md` in the sibling repo
`ces-planner/docs/`, one level up; only the *completion records*,
`docs/GOAL_COMPLETION_G-MUSTER-P{0,1,2}.md`, live in ces-muster itself). Creating
`docs/goals/` here is the better fit going forward since G-MUSTER-GO-1 is ces-muster's own
scope, not a ces-planner-derived phase — this directory is the convention this goal adopts
for ces-muster, following the sibling precedent rather than inventing a new one.

---

## MANDATORY ENGINEERING NOTE — top-level constraint, applies to every milestone below

**"DO NOT REPLICATE CODE AS AN EASY OUT — DO THE RIGHT THING FROM A SOFTWARE ENGINEERING
POV."** (founder, verbatim.) Concretely, per the CES boundary principle (tools are standalone
entities; consumers reuse via interfaces, never copy):

- Discovery execution must **consume** an existing/engine-owned lane through a proper
  interface or package — never a copied command list. **Correction to prior planning
  docs:** `docs/plannergen2ideas.md` names `eo/discovery/DiscoveryEngine.ts` as the shipped
  precedent; that class **does not exist**. The only file at that path,
  `ces-eo/src/eo/discovery/EvidenceImporter.ts`, is marked `@deprecated` ("EO sources all
  evidence from Azure Blob Storage. Filesystem evidence import is no longer supported.").
  The live registry-get_command surface is `ces-stamper/src/registry/CommandRegistry.ts`
  reading `cmmc-l2-commands.registry.json` / `infra-cmmc-l2-commands.registry.json`
  (223 entries, 201 runnable). No live class today walks that registry and executes every
  get_command as a discovery pass — **this goal must not build one inside ces-muster**.
  Building it belongs to ces-stamper or ces-eo as a sibling requirement (see Dependencies).
  Muster's job is to consume that engine once it exists, via an interface.
- The SPRS scorer and Readiness results matrix are EO outputs consumed via API/artifact —
  not re-implemented. Live candidates: `ces-eo/src/eo/sprs/SprsCalculator.ts` and
  `ces-eo/src/eo/risk-assessment/NistScoringMatrix.ts` /
  `ces-eo/src/eo/ssp/SharedResponsibilityMatrixGenerator.ts`. Note ces-muster **already**
  has its own `src/features/scoring/sprsCalc.ts` and `muster-api/src/services/sprsCalc.ts`
  (parity-tested against the vendored spine per `docs/GOAL_COMPLETION_G-MUSTER-P1.md` DONE-WHEN
  #11). Readiness must not fork a third SPRS implementation — reuse Muster's existing
  parity-proven calculator for the SPRS number, and consume EO's results-matrix artifact
  (import/API) for the matrix view, rather than hand-building a matrix renderer against raw
  objective data.
- Question banks get **refactored** into one adaptive question graph with a single source of
  truth — not duplicated per branch (automated-residual vs. manual-full are the *same* graph
  pruned differently, not two graphs).
- No forked copies of registry or domain files into ces-muster.

---

## Objective

Rework Muster's engagement flow into five tabs — **Help → Situation → Discovery → (branch) →
Readiness** — so that discovery-first posture (run automated checks, then ask only for what
discovery can't see) replaces today's straight-to-interview flow, while preserving every
artifact contract Muster already ships.

## Why now (grounded in computed numbers)

Per `docs/registry-objective-coverage-2026-07-10.md` and `docs/plannergen2ideas.md`
(ces-strategy): running the Stamper registries' 201 runnable get_commands reads live state on
**96 of 110 controls (87.3%)** and plausibly evidences **~133 of 320 objectives (41.6%,
±10–15)**. The other **150 objectives (46.9%)** sit on get-covered controls but are
definitional/procedural/physical/human-activity — documents and attestations, not commands.
**37 (11.6%)** sit on 14 manual-only controls with no readable surface at all. Today Muster's
adaptive interview (`src/features/assessment/adaptiveEngine.ts`,
`muster-api/src/services/adaptiveInterviewService.ts`) and its Approach-A harvest lane
(`muster-api/src/routes/harvest.ts`, Graph OAuth) already ask/harvest toward the same 320-
objective spine; the Discovery tab's pitch to the user is precise because of these numbers:
running discovery first can plausibly retire ~4 in 10 objectives before a single interview
question is asked, and the residual collector — not a wizard — is honestly ~6 in 10 of the
engagement regardless of how good discovery gets.

## The flow — user-visible behavior

1. **Help tab** — overview and directions. New; no current tab plays this role
   (`src/features/app/App.tsx` today has `view: 'assessment' | 'result' | 'rollup' |
   'quick-session' | 'contracts'` — no help/orientation view exists).
2. **Situation tab** — up-front data: engagement kind (immutable, existing
   `engagementService.ts` / `IndividualContractor.test.tsx` behavior), scope-lite,
   on-prem/OT question (existing, per `docs/GOAL_COMPLETION_G-MUSTER-P0.md`). Renamed/
   repositioned, not rebuilt — this is today's intake step relabeled as tab 2 of 5.
3. **Discovery tab — offer.** Explain automated discovery with pros and cons, sourced from
   the numbers above:
   - *Pros:* ~133/320 objectives (41.6%) plausibly pre-answered; posture read on 96/110
     controls (87.3%) without an interview question; safe (read-only), fast.
   - *Cons:* requires tenant connectivity (Muster is offline-first today — see Open Design
     Decisions); does not replace the ~150 B-bucket document/attestation objectives or the
     37 C-bucket manual-only ones; "plausibly evidences" is not "assessor-accepted" — an
     advisor still reviews.
4. **If automated:**
   a. **Discovery sub-tab** — user watches execution (progress view over a discovery run).
   b. Then **residual adaptive answering** — the same adaptive question graph (see below),
      pruned by everything discovery already answered.
5. **If manual:** the full adaptive question graph, unpruned by discovery (still pruned by
   the tenant/services answers the user gives interactively — see below).
6. **Readiness tab** — SPRS score (Muster's existing parity-proven calculator, not
   reimplemented) plus EO's results matrix (consumed, not rebuilt — see Engineering Note).

"Augment where known and appropriate" — every step above reuses an existing Muster surface
(intake, adaptive engine, harvest lane, SPRS calc, result screen) rather than introducing a
parallel one; only Help, the Discovery offer/sub-tab, and the residual-pruning logic are net
new UI.

## Adaptive answering, defined

Muster already has an adaptive engine (`src/features/assessment/adaptiveEngine.ts`,
modes `'adaptive'` via `POST /interview/adaptive/next` and `'degraded'` static fallback;
`muster-api/src/services/adaptiveInterviewService.ts`). This goal does not replace that
engine — it **extends its pruning input**:

- **Starts by learning about the tenant and its services** — the existing Situation tab's
  scope-lite/on-prem-OT answers, plus (if the Discovery branch ran) the tenant/stack facts
  discovery observed, seed the graph's first pruning pass before any cluster-level question
  (identity, endpoint, policy — see `src/features/interview/questionGraph.ts`) is asked.
- **Pruning semantics:** an answered node (whether answered by a human or by a discovery
  fact) removes every question graph node whose `mapped_requirements` are already covered
  by that answer at equal-or-higher confidence, the same logic
  `src/vendored/ces-spine/services/bulkAnswerDerivation.ts` already implements for preamble-
  based bulk derivation. Discovery facts and human facts populate the **same fact store**
  (`InterviewFact` / session `facts`, per `src/shared/types/engagement.ts`) so the graph does
  not need to know which source produced a fact, only its confidence — this is the concrete
  form of "refactor question banks into ONE adaptive graph" from the engineering note: the
  automated and manual branches are the same graph, pruned by a different starting fact set.
- Confidence tiers follow the existing A > C > B router precedent already built for P2
  (`muster-api/src/services/*` factRouter path per `docs/GOAL_COMPLETION_G-MUSTER-P2.md`
  DONE-WHEN #4-5): a discovery-observed fact (Approach A/C-equivalent) prunes harder than a
  low-confidence interview answer; an unknown never prunes and never passes (FCA guardrail
  holds through this flow unchanged).

> **Design elaboration (added 2026-07-10, revised same day per founder unification):**
> how EVERY question gets answered — discoverable and residual alike — is designed in
> `docs/design/residual-elicitation-ladder.md` ("The Answer Engine"). One engine, one
> fact store: every fact carries an ordered resolver chain (discover →
> infer-and-confirm → extract-from-document → archetype-default → ask-the-human);
> the engine works the question list biggies-first, best resolver first, falling down
> the chain only as needed, in a repeating ez-button loop. The tabs in this goal are
> the UX skin over that loop — the Discovery tab is the ez-button's first press, not a
> separate philosophy. The design also defines the AUTH LADDER (delegated device-code
> sign-in → admin-run script + upload → cert app-only later at remediation time) so
> certificate friction cannot kill the read path pre-deal; which auth tier the customer
> clears determines which chain-heads are live, and the engine degrades per-command,
> never all-or-nothing. Adaptive answering as defined above = the ask-the-human tail of
> the chain operating over whatever the earlier resolvers could not fill.

## Milestones — walking skeleton, objectively checkable

**M1 — Help + Situation relabel (no new logic).** Tab shell renders 5 named tabs
(Help/Situation/Discovery/Readiness, with the Discovery branch as a sub-view); Situation tab
is the existing intake flow reachable at tab position 2. *Gate:* a Playwright spec navigates
all 5 tab labels by `data-testid`; existing P0 intake tests (`engagementKind.test.ts`,
`IndividualContractor.test.tsx`) still pass unmodified.

**M2 — Discovery offer screen, no execution.** Pros/cons copy sourced from the numbers above,
rendered from a single constants module (not hardcoded per-branch). Two buttons: "Run
Discovery" / "Skip to Manual." *Gate:* unit test asserts the pros/cons copy contains the
41.6%/87.3%/150/37 figures verbatim (regression guard against silent number drift); clicking
either button transitions to the correct next view.

**M3 — Discovery sub-tab against a CANNED results file (walking skeleton — no live
execution).** Discovery sub-tab consumes a fixture `discovery-results.json` (shape TBD by the
adaptive-graph data model decision below) shaped like what a future engine interface would
return, and renders a progress-then-summary view. *Gate:* a fixture file
(`src/__fixtures__/discoveryResults.ts` or similar) drives the sub-tab in a unit test with
zero network calls (extends the existing `noNetworkCalls.test.ts` guardrail); the summary
view shows per-control coverage counts matching the fixture.

**M4 — Residual pruning wired to the canned fixture.** Facts from the M3 fixture populate the
session fact store; the adaptive graph (existing engine) skips every question the fixture
already answers. *Gate:* a test session seeded with the fixture reaches `completeInterview`
with strictly fewer questions asked than the same session run through the manual branch
(same starting Situation answers, no discovery) — the pruning delta is asserted, not just
observed.

**M5 — Manual branch parity.** Manual branch runs today's existing adaptive interview
unchanged, just reachable from the new Discovery-offer "Skip" path. *Gate:* the P0/P1
end-user Playwright suite (`e2e/*.spec.ts`) passes unmodified through the manual branch.

**M6 — Readiness tab: SPRS + results matrix.** SPRS score renders from Muster's existing
calculator (no new implementation); results matrix renders from a consumed artifact
(imported file or API call — per the open design decision below), not from objective data
Muster recomputes itself. *Gate:* a fixture results-matrix artifact renders in the Readiness
tab; a unit test asserts the SPRS number shown equals `sprsCalc.ts`'s output for the same
fact set (parity, not reimplementation).

**M7 (stretch, explicitly deferrable) — live discovery execution**, gated on the sibling
dependency below (a real discovery-engine interface existing to call). Not required for this
goal's DONE-WHEN; M3-M4's canned-fixture skeleton is the completion bar.

## DONE-WHEN (all must hold for the walking-skeleton scope, M1–M6)

1. All 5 tabs (Help, Situation, Discovery [+ sub-tab], Readiness) are reachable and named
   by `data-testid` in the SPA; existing P0/P1/P2 regression suites (web + api) stay green.
2. Discovery offer screen's pros/cons content is sourced from one constants module and
   contains the cited coverage numbers, tested against silent drift (M2 gate).
3. Discovery sub-tab operates end-to-end against a canned fixture file with zero network
   calls (M3 gate) — no live engine call exists inside ces-muster at this goal's completion.
4. Residual adaptive answering measurably prunes fewer questions when seeded by discovery
   facts than the manual branch, using the SAME question graph/engine, not a second one
   (M4 gate; engineering-note compliance is a brutal-critic checkpoint, see below).
5. Manual branch is provably unchanged behavior (M5 gate: existing e2e suite green).
6. Readiness tab shows SPRS via the existing calculator (parity-tested, M6 gate) and a
   results matrix rendered from a consumed artifact, not recomputed.
7. `npm run check:drift`, `npm run build`, `npm run lint` all exit 0; vendored spine
   (`src/vendored/**`) untouched.
8. Brutal critic (separate agent, no self-certification) records PASS, attacking
   specifically: (a) any copied registry/command list or duplicated question bank found
   inside ces-muster — automatic numbered defect per the engineering note; (b) any second
   SPRS or matrix implementation; (c) FCA guardrail (unknown never prunes, never passes)
   holding through the discovery-seeded path.
9. HIL user approval (last gate) — on approval, write
   `ces-muster/docs/GOAL_COMPLETION_G-MUSTER-GO-1.md`. No approval, no completion.

## Non-goals (out of scope for this goal)

- Building a live discovery-execution engine (walking a registry and running get_commands
  against a real tenant) **inside ces-muster**. That capability, if it does not already
  exist as a callable interface elsewhere, is a sibling requirement (below), not this goal's
  work.
- Reimplementing SPRS scoring or the EO results matrix from raw objective data.
- Connected-mode tenant auth beyond what `muster-api/src/routes/harvest.ts` already does
  (Graph OAuth) — extending that lane, if chosen, is scoped narrowly to what M7 needs, and
  M7 is stretch/deferred.
- New vendor playbooks or intent packs beyond what P0-P2 already vendored.
- Changing the Contracts/Rollup/Quick-Session tabs' existing behavior.

## Open design decisions (must be resolved before M7, not before M1-M6)

0. **Auth tier for live discovery (added 2026-07-10, from the Answer Engine design).**
   Certificate app-only provisioning can take a change-controlled government-cloud shop
   days to weeks — deal-killing friction that must not gate the READ path. The design's
   auth ladder: delegated device-code sign-in (attended, nothing provisioned) →
   admin-run read-only script + upload (CES never holds credentials; lands on the
   import-file mode in decision 1) → cert app-only deferred to remediation time when
   Stamper genuinely needs to write. Open call: which of the first two ships first
   (script-upload is the smaller build; device-code the smoother demo). Interacts with
   decision 1 — script-upload and import-file are one mechanism.

1. **Connected vs. import-file mode.** Muster is offline-first by design today (zero
   external APIs except the existing OAuth harvest lane). Per `plannergen2ideas.md`, the
   smaller step is an **import-discovery-results-file mode** (Discovery sub-tab ingests a
   file the way `rosterImport.ts` ingests CSV today) rather than building a second connected
   mode. Recommendation: import-file, because it keeps one discovery implementation in the
   family and matches this goal's walking-skeleton M3 (canned fixture is literally this mode
   with a fixture instead of a real export). Final call belongs to the founder/BHD, not this
   goal.
2. **Where discovery execution lives.** The browser SPA cannot run PowerShell or hit
   registry get_commands directly. Two live candidates exist and neither is discovery-ready
   today: (a) `muster-api`'s existing `/harvest` lane (`harvestService.ts`, Graph OAuth,
   already a backend execution lane Muster owns) could grow a discovery mode; (b) a real
   engine service in ces-eo or ces-stamper (see Dependencies) that Muster calls over an
   interface. Given the Engineering Note's "consume, don't replicate" rule and that no such
   engine exists yet in either sibling repo, (b) is architecturally correct but has a
   prerequisite; (a) is faster but risks ces-muster becoming the discovery engine by
   accretion, which the engineering note forbids. Recommendation: block real execution (M7)
   on the sibling dependency below rather than build a shadow engine in muster-api.
3. **Adaptive-graph data model.** Today's graph is a static TS array
   (`src/features/interview/questionGraph.ts`, `QuestionNode[]` with `mapped_requirements`)
   plus a server-side adaptive service. The discovery-results fixture (M3) needs a shape
   that maps cleanly onto `mapped_requirements` so pruning (M4) is a lookup, not new
   inference — recommend the fixture carry `{ control_id, objective_ids[], confidence }`
   rows mirroring the coverage report's `covering_get_entry_ids` join
   (`docs/data/registry-objective-coverage-2026-07-10.json`,
   `planner_gen2_feed`/per-objective table in ces-strategy), so a future real engine's output
   format is decided once, not twice.

## Dependencies on siblings (filed as requirements, not built here)

- **ces-stamper or ces-eo:** a real, callable discovery-engine interface that walks the
  registries' 201 runnable get_commands read-only against a tenant and returns structured
  results. Today's closest artifact, `ces-eo/src/eo/discovery/EvidenceImporter.ts`, is
  `@deprecated`; no replacement exists. This goal's M7 (live execution) is blocked on this
  dependency shipping elsewhere first.
- **ces-eo:** a packaged, importable/callable form of the SPRS results matrix
  (`NistScoringMatrix.ts` / `SharedResponsibilityMatrixGenerator.ts`) that Muster's Readiness
  tab can consume via API or artifact import, rather than Muster inventing its own matrix
  renderer against raw objective data.
- **ces-stamper:** registry entries carrying `objective_ids[]` letter-level tags (coverage
  report recommendation 2, E1 effort) — without this, mapping discovery output onto
  Muster's `mapped_requirements` graph nodes stays a manual join instead of a lookup.

## Grounding — files cited

- `ces-muster/PLAN.md`, `ces-muster/docs/GOAL_COMPLETION_G-MUSTER-P0.md`,
  `docs/GOAL_COMPLETION_G-MUSTER-P1.md`, `docs/GOAL_COMPLETION_G-MUSTER-P2.md`
- `ces-muster/src/features/app/App.tsx` (current `View` union, no Help/Discovery/Readiness
  tabs today)
- `ces-muster/src/features/assessment/adaptiveEngine.ts`,
  `muster-api/src/services/adaptiveInterviewService.ts`
- `ces-muster/src/features/interview/questionGraph.ts` (static `QuestionNode[]`,
  `mapped_requirements`)
- `ces-muster/src/vendored/ces-spine/services/bulkAnswerDerivation.ts` (existing pruning
  precedent)
- `ces-muster/src/features/scoring/sprsCalc.ts`, `muster-api/src/services/sprsCalc.ts`
  (existing parity-tested SPRS calculators — reuse, don't refork)
- `ces-muster/muster-api/src/routes/harvest.ts`, `services/harvestService.ts` (existing
  backend execution/OAuth lane — nearest existing "engine call" surface)
- `ces-muster/muster-api/prisma/schema.prisma` (models: Tenant, User, Engagement, Party,
  InterviewSession, Contract, NudgeEvent, Disposition, HilItem, TouchEvent — no Discovery
  model exists yet)
- `ces-eo/src/eo/discovery/EvidenceImporter.ts` (deprecated — corrects
  `plannergen2ideas.md`'s `DiscoveryEngine.ts` citation)
- `ces-eo/src/eo/sprs/SprsCalculator.ts`, `ces-eo/src/eo/risk-assessment/NistScoringMatrix.ts`,
  `ces-eo/src/eo/ssp/SharedResponsibilityMatrixGenerator.ts`
- `ces-stamper/src/registry/CommandRegistry.ts`,
  `ces-stamper/src/registry/cmmc-l2-commands.registry.json`,
  `infra-cmmc-l2-commands.registry.json`
- `ces-strategy/docs/plannergen2ideas.md`, `ces-strategy/docs/registry-objective-coverage-2026-07-10.md`
- Goal-file convention precedent: `ces/tenant-stacksim/docs/goals/G-STACKSIM-1.md`;
  DONE-WHEN/brutal-critic/HIL prose style precedent: `ces-planner/docs/_goal-muster-p2.md`
