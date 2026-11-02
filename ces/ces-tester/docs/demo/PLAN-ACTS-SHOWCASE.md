# Plan: acts-showcase — every demo-act, all live, one per slide
**Date:** 2026-09-07
**Status:** READY FOR IMPLEMENTATION

## Objective
Build a new `demos/acts-showcase.xlsx` deck whose EVERY slide drives one live demo-act (no narration/staged filler), runs each IMPLEMENTED act at "demo-act pace" (slide holds until the act finishes, then auto-advances), in a precondition-valid order, against a tenant stood up and configured on stage.

## Context Summary
- **Hold-until-done mechanism (confirmed `show-run.ts` + `show-state.ts`):** a `live` op-slide starts `pending` → `slideDrivesOp` holds it with `dwellDeadline = null` (no auto-advance). `startOpFor` (`show-run.ts` L381-415) runs the op on slide entry; on completion it dispatches `op done`, and `deadlineFor` (`show-state.ts` L116-121) sets `dwellDeadline = now + dwell`. So the slide dwells its `duration` **after** the act completes, then `tick` advances. FD-3, exactly. **Use `op mode: live` + `duration (sec) = 3` on every slide.**
- **Tenant standup (grounded in `arm-sim.ts` L246-259):** arming unconditionally seeds `demo-dib-small` via `resetDemoDibSmallTenant` — the deliberately half-configured tenant (report-only MFA gap, `build-demo-scenario.mjs`). **No fully-configured seed exists.** Arming DOES fully stand up all five product surfaces (stacksim :4390, AO :3001, EO :4002, Stamper :3000, Muster SPA :4173) because this deck drives all of them. **Approach: configure-on-stage** — `simstack-create` presents the armed tenant + gap; the Config acts (`stamper-translate` → `stamper-execute`) remediate it live and early, so the tenant is fully configured by slide 4. Do NOT fabricate a config state.
- **Aliases are data-only** (`op-catalog.ts`): a deck cell must name a registered op id. `eo-verify-evidence`/`eo-browse-determinations` are expressed as `eo-review` + `land=` param.

## Implementation Steps
1. **`src/demo/show/ops/eo-show-change-captured-op.ts` (READ ONLY — verified, no change):** its "before" (`runDir/eo-before.json`) is written ONLY by the acts-test harness, never by a `demo:show` op. In this standalone deck it will run, re-assess the remediated tenant, show the post-remediation SPRS, and honestly log `EO_CHANGE_NO_RELIABLE_BEFORE` (no flip narrated). Acceptable and honest; talk track must NOT claim a flip. (Follow-on candidate, out of scope: a knob so a live `eo-review` persists `eo-before.json`.)
2. **`scripts/make-demo-xlsx.mjs` (MODIFY):** add `ACTS_SHOWCASE_ROWS` (the table below), `ACTS_SHOWCASE_COLUMNS = [...COLUMNS, 'params']`, an `actsShowcaseSheetRows()` emitting a 14th `params` cell (`r.params ?? ''`), `buildActsShowcaseDeck()` = `buildXlsx(ACTS_SHOWCASE_COLUMNS, actsShowcaseSheetRows(), 'acts-showcase')`, and a `DECKS` entry `{ id: 'acts-showcase', rows: ACTS_SHOWCASE_ROWS, build: buildActsShowcaseDeck }`. **Do NOT touch shared `COLUMNS`/`sheetRowsFor`** — that would change the committed `ces-overview`/`ces-pain-story` bytes and break their golden fixtures. `params` appended as a new header is read by name.
3. **Generate + gate:** `node scripts/make-demo-xlsx.mjs --deck acts-showcase demos/acts-showcase.xlsx`, then `node bin/ces-tester.mjs demo:show --check demos/acts-showcase.xlsx` must exit 0.

## The ordered act list (all `op mode: live`, `duration = 3`)
| # | op | params | 1-line talk track |
|---|---|---|---|
| 1 | `simstack-create` | — | Here's the tenant we'll work — a real estate whose MFA policy has sat in report-only for six months, never enforced. |
| 2 | `eo-review` | `land=sprs` | Assessment first: the compliance matrix, the identification-and-authentication gaps, and the SPRS number we start from. |
| 3 | `stamper-translate` | — | Configuration compiles the mission plan into exact, dependency-ordered remediation tasks for this tenant. |
| 4 | `stamper-execute` | — | Now it applies them against the tenant — we judge the execution report on disk, never the status badge. |
| 5 | `eo-show-change-captured` | — | We re-assess the remediated tenant and report exactly what moved — never a change the evidence doesn't show. |
| 6 | `muster-connect-tenant` | — | Readiness Evaluation opens by declaring how we assess — mode, authorization tier, operator, tenant. |
| 7 | `muster-auto-analysis` | — | The real read-only discovery walk runs and imports into the app — this tenant, this run, never the demo button. |
| 8 | `muster-consent-and-attest` | — | A named human attests the CUI boundary the machine inferred — nothing auto-drafted scores on its own. |
| 9 | `muster-adaptive-interview` | — | Watch the question count drop — discovery already answered most, so we don't ask your team again. |
| 10 | `muster-generate-sprs-mp` | — | The SPRS number you report, read from the exported result, plus the mission plan Configuration executes. |
| 11 | `muster-readiness` | — | A read-only readiness snapshot — four-value posture, no invented score, a zero-mutation ledger proving it only read. |
| 12 | `ao-registry` | — | Operations: the governed command registry — every tenant action catalogued with its approval tier, executed live. |
| 13 | `ao-make-change` | — | The same governed path submits the remediating change — it runs and it's recorded in one motion. |
| 14 | `eo-review` | `land=evidence` | The Evidence Explorer: the record that command wrote, filed as it ran, beside the assessment's own evidence trail. |
| 15 | `simstack-destroy` | — | The tenant goes away; the evidence stays. Disposable environment, permanent proof. |

**Order rationale (preconditions):** before-assessment (2) → sole remediator Stamper (3→4, adjacent gives execute its fast path) → after (5), so no A-18 mutation sits between before/after. Muster chain 6→10 is the proven stateful order (`mini-muster-gui`); `muster-readiness` (11) self-navigates so it is safe after. AO (12,13) precede `eo-review land=evidence` (14), which needs an earlier AO write. `simstack-destroy` last. Both AO slides default to command `A-18` — do not invent a second id (string param, no enum, fails live on stage).

## File Inventory
| File | Action | Lines/Functions Affected |
|------|--------|------------------------|
| scripts/make-demo-xlsx.mjs | MODIFY | +`ACTS_SHOWCASE_ROWS`, +`ACTS_SHOWCASE_COLUMNS`, +`actsShowcaseSheetRows()`, +`buildActsShowcaseDeck()`, +`DECKS` entry. Shared `COLUMNS`/`sheetRowsFor` untouched |
| demos/acts-showcase.xlsx | CREATE | generated (next pass; not this plan) |

No images (a missing `image` cell is a load-time error; none used).

## Architecture Decisions
- **All `live`, `duration=3`:** founder's "advance when the act is done" == live-hold-then-dwell. Operator may bump slides 3/4 (Config readout cards) to ~6-8s to linger.
- **Configure-on-stage, not a fake seed:** no fully-configured seed exists; the Config acts are the configuring, ordered early.
- **`eo-show-change-captured` degrades honestly** (no harness `eo-before.json`); it re-assesses and shows post-remediation SPRS without narrating an unproven flip.
- **16 acts, all represented:** all 14 registered op ids appear; the three `eo-review` "views" are configs — browse=`land=sprs` (2), verify=`land=evidence` (14); the warm `eo-assess` view is not a live-on-slide act — its work is the self-heal inside the live `eo-review`/re-assess.

## Testing Strategy
- `demo:show --check demos/acts-showcase.xlsx` exits 0 (forces staged; validates every op id, `live` mode, and `land=` param against the catalog). Zero warm ops ⇒ no >300 s warm-budget warning; translate-then-execute adjacency ⇒ no fast-path ordering warning.
- Optional live rehearsal requires all siblings built (`../ces-muster`, `../ces-stamper`, `../ces-eo`, `../ces-ao` dist).

## Runtime estimate
Sum of live act runtimes ≈ **23–25 min**. The Config pair dominates: `stamper-translate` ~5 min (308 s) + `stamper-execute` ~13 min (774 s, fast path) ≈ **18 min**. Muster walks add ~165 s (`muster-auto-analysis` ~85 s, `muster-readiness` ~80 s); everything else is seconds. **Tradeoff to surface to the founder:** this is the cost of "each act runs live on its slide." Warming the two Config ops would cut ~18 min of stage time but they'd fire at prep, breaking "runs each act on its slide" — the advance-when-done intent implies live, so live is recommended and the wall time is the stated cost.

## Out of Scope
- Generating/committing the `.xlsx` (plan-only this pass).
- Any code change to op implementations, `arm-sim.ts`, or a new fully-configured seed.
- Changing shared `COLUMNS`/`sheetRowsFor` or the two existing decks.
- Alias resolution; a real before/after `eo-before.json` capture in `demo:show` (follow-on).

## Acceptance Criteria
- [ ] `node bin/ces-tester.mjs demo:show --check demos/acts-showcase.xlsx` exits 0.
- [ ] Every slide has a `live` op; zero staged/narration-only slides.
- [ ] Precondition order valid (before→Stamper→after; muster chain; AO→evidence; destroy last).
- [ ] Deck regenerates from `make-demo-xlsx.mjs`; existing decks' bytes unchanged.
