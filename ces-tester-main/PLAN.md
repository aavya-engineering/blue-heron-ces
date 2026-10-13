# PLAN — Left content pane wraps too early (mirror-pane dead-gap fix)

**Task (founder, live demo:show of ces-pain-story-v2):** The left content column
(`.smain`) wraps far too early — a wide dead gap sits between the text and the app
(mirror) pane. Move the content column's right edge RIGHT so it runs to a small fixed
buffer just before the app pane's left edge.

## Root cause (REVIEW.md, P0 — confirmed)

`src/demo/show/slide-render.ts:725` — `.pane:has(.pane-view){flex:0 0 auto;}`.
`flex-basis:auto` sizes `.pane` from its content's **max-content** width. That comes from
`.mirror-img` (L756: `height:100%;width:auto;aspect-ratio:auto 736/1080`). During the
max-content pass the img's `height:100%` is **indefinite**, so the browser cannot derive
width from height×ratio and falls back to the img's **raw captured pixel width** (much
larger than the rendered width). `flex-shrink:0` then pins `.pane` at that oversized
width. `.pane-view{justify-content:flex-end}` (L729) right-aligns the correctly-sized
image inside that too-wide box → the dead gap appears **inside `.pane`, left of the
image**, and `.smain` (flex:1) cannot reclaim it.

Text wrap-caps (candidate b) and the `.shalf` gap (candidate c) are **ruled out** — all
split-slide elements already have `max-width:none` overrides.

## The fix (one line)

Give the pane box itself a **definite aspect-ratio** so its width is computed from its
(already-definite) height, not from descendant intrinsic sizing:

```
.pane:has(.pane-view){flex:0 0 auto;aspect-ratio:736/1080;}   /* + 1-line why-comment */
```

`.pane` inherits full stage height via the `.body`→`.shalf`→`.pane` flex column, so
`height × (736/1080)` yields the exact frame width. The gap collapses; `.smain` (flex:1)
expands to fill the reclaimed width, leaving only the intended `.shalf` gap
(`calc(3*var(--u))`) before the frame — i.e. "a small width less than the left edge of
the app pane." `.mirror-img`'s own `aspect-ratio:auto 736/1080` stays (becomes a no-op).

## Scope / blast radius

- **Only the mirror/theatrical in-slide path** is affected — `:has(.pane-view)` matches
  only when a live mirror frame is present. Static image panes (`.pane>.images`),
  `.body-image-only`, `.body-full-bleed`, `.body-html` paths are untouched by construction.
- **Golden fixture:** `tests/fixtures/show-page-baseline.html` (byte compare,
  `tests/demo-show-theme.test.ts:31`) renders a staged slide with no mirror, so **nothing
  visually changes** — but the shared `<style>` block's bytes change, so the fixture must
  be **regenerated**. This is expected (shared-CSS text edit), not a scope breach.

## File Inventory

- `src/demo/show/slide-render.ts` — add `aspect-ratio:736/1080;` + comment at L725. (edit)
- `tests/fixtures/show-page-baseline.html` — regenerate after the CSS change. (regen)
- `docs/context/IMPLEMENTATION_LOG.md` — append execution log. (append)

## Verification gates

1. `npx tsc --noEmit` → 0 errors.
2. `npm test` → all green (regenerate the golden fixture; confirm the diff is CSS-text-only,
   no structural/content change).
3. `node bin/ces-tester.mjs demo:show --check demos/ces-pain-story-v2.xlsx` → PASS (10 slides).
4. Founder re-runs headed `demo:show demos/ces-pain-story-v2.xlsx` → `.smain` now runs to
   the small fixed buffer before the mirror frame on split/theatrical slides (4 & 8).

## Notes

- The currently-running demo (bg `b8oovkron`) uses the OLD build — the fix appears only on
  a fresh relaunch after rebuild.
- No git commit / no push (founder's explicit step). Do not touch session-*.md.
