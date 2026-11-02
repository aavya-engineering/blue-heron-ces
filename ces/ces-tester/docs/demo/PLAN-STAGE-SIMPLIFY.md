# Plan: STAGE-SIMPLIFY (item 2) + CHIP OUTWARD LABELS (item 3)
**Date:** 2026-09-07
**Status:** READY FOR IMPLEMENTATION

## Objective
Land the two founder-directed `slide-render.ts` asks from `INSTRUCTIONS-FROM-STRATEGY-2026-09-07.md`. **Critical finding:** item 2 (stage-simplify) is **already shipped** in GP-DEMO-6 (commits `de93466`, `b078732`). The only remaining implementation work is item 3 (chip outward labels + stacksim suppression).

## Context Summary
- **Already done (item 2), verify — do NOT re-do:** `railHtml`/`.rail` removed (comment at slide-render.ts L175 says so; confirmed in `git show HEAD`). `.chrome` (L851-863) holds only `#dots` + `#navbtns` (Prev/Next/Exit) + hidden `#pos` — no op/mode pills, clock, or kbd hints. Dwell bar (`.dwell`) kept. App pane is **50/50 full-height** via `.shalf`/`.smain`/`.pane` (all `flex:1`), L344/L608-628.
- **Reconciliation answer (prompt's 33%→50% question):** already resolved. No `.body-mirror`/`body-split`/`33.33` exists anywhere in `src/`; the mirror renders through `.shalf`/`.pane` at 50%. Nothing to change.
- **Remaining (item 3):** `chipsHtml` (L162-166) still prints raw enum text. Fixture title chips render `stacksim`, `eo`, `eo` — the visible proof it's undone.
- **Constraints:** Windows-only. Values in xlsx unchanged; loader/enum/op-ids/`--check` untouched. Reference render: `../ces-strategy/scripts/preview_demo.py` (`CHIP_LABELS`/`CHIP_SUPPRESS`) — read-only.

## Tensions (mandatory flags)
- **Item 2 removes locked V4 elements** (rail, chrome cluster) — founder-approved via `REQ-TESTER-STAGE-SIMPLIFY.md` (routed, approved 2026-09-06). Already executed; flag recorded for the record.
- **Item 3 reverses the 2026-09-05 founder note** ("stacksim keeps its chip; product not plumbing") — cited in `chipsHtml`'s comment and test L432. Superseded by the 2026-09-06 outward-naming policy + the 2026-09-07 INSTRUCTIONS drop. **The chip REQ itself is PROPOSED/not-routed — implementation authority is the INSTRUCTIONS drop, not the REQ.**

## PRECONDITION (hygiene — blocks the slice)
`slide-render.ts` and `show-page-baseline.html` are **already dirty** with the unrelated GP-DEMO-6 on-air-overlay change (source+fixture, consistent). These are the exact two files the chip commit touches. **File-level `git add` would fold that foreign hunk in.** Before this slice: the pending on-air-overlay work must be committed by its owner (or the parent explicitly decides otherwise). Never `git add -A`/`.`/`-p`.

## Implementation Steps (one slice — commit `GP-DEMO-5 simplify: chip outward labels + suppress stacksim`)
1. **`src/demo/show/slide-render.ts` — `chipsHtml` (L162-166):** add `const CHIP_LABELS = {muster:'Readiness Evaluation', stamper:'Configuration', ao:'Operations', eo:'Assessment'}`. Filter `stacksim` out **before** mapping; render `chip chip-${t}` class unchanged (keeps class-based tests green) with inner text `CHIP_LABELS[t] ?? escapeHtml(t)` (raw-text fallthrough). Rewrite the comment: cite 2026-09-06 outward-naming + 2026-09-07 drop; drop the "unfiltered" line.
2. **Title-path guard (L250):** change `tools.length === 0 ? ''` to guard on the **rendered chip string** (`chipsHtml(tools) === '' ? ''`) so a stacksim-only tool set emits no empty `title-chips` container (REQ item 3 line). Content path (L327) already guards on `chips === ''` — leave it.
3. **Stat-row decision (see Architecture Decisions):** make the title "N tools" count the **rendered chips**, not `tools.length`.

## File Inventory
| File | Action | Lines/Functions Affected |
|------|--------|------------------------|
| src/demo/show/slide-render.ts | MODIFY | `chipsHtml()` L162-166; title guard L250; stat-row L232-233 |
| tests/demo-show-render.test.ts | MODIFY | **L143 only** (`>stamper<`→`>Configuration<`) is a real assertion change. L430-433 = comment/doctrine-rot rewrite only — that deck has stamper+ao (no stacksim), so its "2 tools" count and `chip-stamper`/`chip-ao` class assertions are UNCHANGED. |
| tests/fixtures/show-page-baseline.html | MODIFY (re-baseline) | embedded deck JSON only |

## Architecture Decisions
- **Stat-row count = rendered chips, not `tools.length`.** REQ is silent; counting the suppressed stacksim would project "N tools" above N−1 chips. Count what shows. (No render-test edit needed — that deck has no stacksim.)
- **Keep `chip-${t}` CSS classes** (only inner text maps) so styling and class-based assertions survive.

## Testing Strategy / Gates (this slice)
- `npx tsc --noEmit` clean; `npm test` (~825) green.
- **Re-baseline the golden fixture deliberately:** `demo-show-theme.test.ts` L150 does a manual `toBe(norm(baseline))` — no env-flag regen. Regenerate by rendering the test's own `fixtureDeck` (deckTools `[stacksim, eo]`) through `renderShowHtml` and overwriting `tests/fixtures/show-page-baseline.html`. **Expected diff = embedded deck JSON only, exactly three display edits:** (a) title `chip-stacksim">stacksim` span **removed**; (b) both `chip-eo">eo` (title-chips + slide-2 eyebrow) → `chip-eo">Assessment`; (c) title stat-row `<span class="big">2</span>` → `1` (rendered-chip count decision). **The raw `"tools":["stacksim","eo"]` JSON arrays REMAIN** — that is `RenderedSlide.tools` data (passed through untouched), not display; a reviewer grepping "zero stacksim" must not flag them. **Zero CSS/shell lines change.** Reject any diff beyond these.
- `demo:show --check` green on **all 10 decks** in `demos/`.
- `demo:acts-test` harness green.

## Final Loop (after the slice)
`demo:show --check` all decks + a **headed** `demo:show demos/ces-pain-story-v2.xlsx`: confirm the simplified shell (no rail, no op/mode/clock/hints; dots+nav+dwell present), outward chips (Readiness Evaluation / Configuration / Operations / Assessment, zero stacksim), and the 50/50 full-height app pane rendering on a mirrored-op slide.

## Out of Scope
- Re-doing item 2 (already shipped) — verify only.
- Loader enum, `op`/`op mode` ids, `--check` contract, `make-demo-xlsx.mjs` generator renames (REQ "Related" — not asked), presenter-band op/mode surfacing, gold-budget relitigation, `demos/README.md` (dirty — flag, don't edit).
- Any CSS change (item 3 is text-mapping only).

## Acceptance Criteria
- [ ] Chips render Readiness Evaluation / Configuration / Operations / Assessment; unrecognized value falls through to raw text.
- [ ] `stacksim`/`tenant-stacksim` chip suppressed everywhere; `stacksim, muster` row → one chip (Readiness Evaluation); `stacksim`-only → no chip container.
- [ ] Loader/enum/op-ids/`--check` unchanged; xlsx values untouched.
- [ ] Item 2 verified present (rail gone; op/mode/clock/hints gone; dots+nav+dwell kept; pane 50/50 full-height).
- [ ] Golden fixture re-baselined with the exact JSON-only diff above; all gates green.
