# Plan: In-slide app area — T1.5 CDP screencast mirror
**Date:** 2026-09-07 · **Rev 2** (gap review 2026-09-07: 0 P0, 3 P1, 7 P2 — all addressed below)
**Status:** READY FOR RE-VERIFY → FOUNDER APPROVAL GATE (not auto-build)
**Commit prefix:** `GP-DEMO-5 mirror:` (one commit per slice, S1..S7)

**Slice legend** (coined here): **S1** MJPEG route + screencast capture · **S2** right-third `<img>` + gated `.body-mirror` + `SlideOp.mirror` field · **S3** `mirror:none|theatrical` catalog + loader resolution · **S4** injected per-app narrow reflow · **S5** minimal branded cursor overlay in-frame · **S6** default flip + `--pane-window` escape hatch · **S7** presenter/nav confirmation + final pain-story loop.

## Objective
Render the live CES app **inside the slide's right third** (16:9 stage) by streaming the backstage-driven pane's rendered frames as MJPEG into an `<img>`, retiring the separate second window as the default while keeping a `--pane-window` rehearsal fallback. Mechanism is DEMO-ACTS-CONCEPT §6 recommendation (b), founder decision 7 (2026-09-06). No re-derivation — this plan implements the locked design.

## Context Summary
- **From DEMO-ACTS-CONCEPT §6:** mechanism (b) CDP screencast → MJPEG over the existing `slides-server.ts` (`node:http`, no new dep) → `<img>` in the right third; reflow-not-rescale via `addInitScript`; mirror is **per-act opt-in** (`mirror:none|theatrical`).
- **From THREAD_HANDOFF (2026-09-06):** decision 7 (FD-1 re-decided: in-slide mirror replaces the window; keep `--pane-window`), decision 8 (Config/Stamper acts stay `mirror:none` — backstage Config work must NEVER surface).
- **Verified against real code (load-bearing, differs from the concept's loose wording):**
  - **The mirror source is the visible `pane`, NOT the `backstage` session.** AO/EO/Muster GUI ops drive `pane` (`op-registry.ts` L276 passes `pane` in `ctx`; the GUI ops navigate it). Only Stamper/Config ops drive the separate headless `backstage` session (`op-registry.ts` L211-212, L246-250). `backstage` is a *different `chromium.launch()` process* with no CDP session attached to the mirror route — so decision 8 holds **structurally**; `mirror:none` is belt-and-braces slide-layout gating on top.
  - `DEFAULT_SLIDES_PORT = 4500` (`show-command.ts` L42). Ports to avoid: 3000/3001/4390/4002/4173 (+ muster-api 4000).
  - `.body-split .cards{flex:1.15}/.images{flex:1}` already exists and is locked (`slide-render.ts` L537) — the mirror is a *new sibling variant* `.body-mirror`, not a reuse of `.body-split`.
  - **No T1 cursor/theatrical layer exists yet** (zero `addInitScript`/`screencast`/`theatrical` in `src/`). S5 scopes a minimal overlay and flags the T1 dependency.
- **Constraints:** Windows-only, PS5.1. Gates per slice: `npx tsc --noEmit` + `npm test` (baseline ~790, grows) + `demo:show --check` green on all existing decks (byte-identical non-mirror slides) + acts harness green. A headed pain-story `demo:show` may be running — do not kill it.

## Implementation Steps (7 independently-green slices)

### S1 — MJPEG route on the slides server + screencast capture on the pane
1. **Spike first (§6.4):** a throwaway probe asserting one `Page.screencastFrame` arrives from the pinned Playwright's **headless** Chromium. If headless yields no frames, fall back to a headed window parked off-screen at negative coords (`--window-position=-2000,0`) which screencasts unconditionally. **Windows caveat (P2):** negative-coord placement interacts with Windows display scaling (the reason §6.3(c)'s overlay illusion was rejected) and an off-screen window can still be grabbed by screen-share — if the fallback is taken, record this caveat in the spike outcome and prefer the headless path. Record the outcome in the S1 commit message.
2. **`src/demo/show/screencast-mirror.ts` (CREATE)** — a `PaneMirror`:
   - `subscribe(res: http.ServerResponse): void` — adds `res` to a `Set`, tracked for teardown; immediately writes `lastFrame` if present (screencast is change-driven — an idle page emits nothing, so a late `<img>` would sit blank without this replay); on first subscriber calls `start()`, on last `req`-close calls `stop()`.
   - `push(jpeg: Buffer)` — stores `lastFrame`, fans out to subscribers. **Backpressure:** if `res.write(...) === false`, skip that client until its `'drain'` (last-frame-only, never queue — a queued client is the §6.4 memory leak).
   - `attach(page: import('playwright').Page)` — `const cdp = await page.context().newCDPSession(page)`; `start()` = `cdp.send('Page.startScreencast', { format:'jpeg', quality:75, maxWidth:640, maxHeight:1080, everyNthFrame:1 })`; `cdp.on('Page.screencastFrame', async ({data, sessionId}) => { this.push(Buffer.from(data,'base64')); await cdp.send('Page.screencastFrameAck',{sessionId}); })` — **ack every frame or the stream stalls after ~a few frames**. `stop()` = `cdp.send('Page.stopScreencast')`. `dispose()` detaches the CDP session and destroys all tracked subscriber responses. **`dispose()` MUST be idempotent (P2):** it is called from `server.stop()` (step 3) AND as its own disposer in `show-run.ts` (step 4), and `server.stop()` is itself a disposer — so `dispose()` fires ≥2×; guard with a `disposed` flag.
   - MJPEG frame write helper: header once (`multipart/x-mixed-replace; boundary=frame`, `Cache-Control: no-store, no-cache`, `Connection: close`), then per frame `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: N\r\n\r\n<bytes>\r\n`.
3. **`slides-server.ts` (MODIFY)** — add `mirror?: PaneMirror` to `SlidesServerOptions`; add route `if (req.method==='GET' && route==='/mirror')` (route name `/mirror` — task text wins; concept's `/pane-stream` is an alias) that writes the multipart head and calls `opts.mirror.subscribe(res)`; on `req.on('close')` remove the subscriber. **Teardown (blind spot / A8):** in `stop()`, after ending SSE `clients`, also `opts.mirror?.dispose()` — `node:http` `server.close()` blocks on active connections, so open MJPEG responses MUST be destroyed or the run hangs on exit.
4. **`show-run.ts` (MODIFY)** — construct the `PaneMirror` **before** `startSlidesServer` (server starts L249, pane opens L307), pass it in `startSlidesServer({... mirror})`, and after the pane opens call `mirror.attach(pane.session.raw)`. Push the mirror's `dispose` onto the disposer list.

**Acceptance S1:** spike documented; `tsc` + `npm test` green; (a) a unit test drives `PaneMirror` with a fake CDP session (frames in → multipart bytes out, ack sent, backpressure skip verified, `dispose()` destroys subscribers and is idempotent under repeat calls); (b) **a `/mirror` server-teardown integration test** (analog of `tests/demo-show-server.test.ts` L194-201, which proves the SSE pattern matters) — open a real `/mirror` HTTP subscriber, assert `server.stop()` **resolves** (does not hang) and the subscriber response is destroyed / `clientCount`-equivalent for mirror drops to 0; (c) `demo:show --check` unchanged.

### S2 — right-third `<img>` + gated `.body-mirror` + `SlideOp.mirror` field (render only, no producer)
1. **`deck-model.ts` (MODIFY)** — add `readonly mirror?: 'none' | 'theatrical'` to `SlideOp` (L147-167), optional so every construction site still compiles. No loader change yet.
2. **`slide-render.ts` (MODIFY, `renderSlideHtml` ~L360-376 + `SHOW_CSS`):** add a mirror body branch **gated** on `slide.op.opId !== undefined && slide.op.mode !== 'staged' && slide.op.mirror === 'theatrical'`. When gated on, render the right-third: `<div class="body body-mirror"><div class="cards">…</div><div class="mirror"><img class="mirror-img" src="/mirror" alt="live app"></div></div>`. CSS: `.body-mirror .cards{flex:1;min-width:0} .body-mirror .mirror{flex:0 0 calc(33.33*var(--u));display:flex;align-items:center;justify-content:center;min-height:0} .mirror-img{max-width:100%;max-height:100%;object-fit:contain;background:var(--navy-deep);border:1px solid var(--hair);border-radius:calc(.6*var(--u))}` (`object-fit:contain` + navy ground because the box ratio won't exactly match 0.59). Content region narrows 85u→~51.7u — an authoring cost, noted in Out of Scope.
   - **Precedence (P2):** `renderSlideHtml` returns early for an `html`-body slide (L355-357) **before** the image/cards body logic. Pin the rule: an `html` body **wins** over the mirror branch (author chose a full graphic; the mirror `<img>` is suppressed on that slide). Add a one-line unit assertion for a slide carrying both `html` and a `theatrical` op.
3. **`slide-render.ts` `buildDeckView` (~L412) (MODIFY) — blind spot 1:** a mirrored slide gets `holdHtml: ''`. Otherwise `draw()` swaps `slide.html`→`holdHtml` when a live op runs >2.5s (`slide-render.ts` L849), removing the mirror `<img>` at exactly the moment the audience should watch the app. The mirror **is** the hold surface; `draw()` already no-ops on empty `holdHtml`.
4. **`show-run.ts` / mirror activation gate:** thread a `mirrorActive` boolean (see S6) so the render gate is `… && mirror==='theatrical' && mirrorActive`. In S2 default `mirrorActive` from an interim `--mirror` opt-in flag (added in `show-command.ts`) so the path is runnable headed before the S6 default flip.

**Acceptance S2:** `tsc` + `npm test` green; **direct `renderSlideHtml` unit tests** with hand-constructed slides prove (a) a `theatrical` slide emits `.body-mirror` + `<img src="/mirror">`, (b) a `none`/absent/`staged` slide is **byte-identical** to today. (`--check` can't cover the split — `withStagedOps` forces `mode:'staged'`, and the gate excludes staged, so existing decks stay byte-identical *by construction* but the split path is never exercised in `--check`; unit tests compensate.)

### S3 — `mirror:none|theatrical` catalog + loader resolution (the producer)
1. **`op-catalog.ts` (MODIFY)** — add a **required** `mirror: 'none' | 'theatrical'` field to `OpCatalogEntry` (P2: required, not optional — matching the file's compile-forced `Record<DemoOpId,…>` pattern so all 14 entries must declare it). Set `theatrical` for `ao-registry`, `ao-make-change`, `eo-review`, `eo-show-change-captured`, and the Muster GUI acts (`muster-connect-tenant`, `-auto-analysis`, `-consent-and-attest`, `-adaptive-interview`, `-generate-sprs-mp`). Set **`none`** for `stamper-translate`, `stamper-execute` (Config — decision 8), `muster-readiness` (CLI/terminal, no GUI yet), `simstack-create`, `simstack-destroy`.
2. **`xlsx-loader.ts` / `deck-validate.ts` (MODIFY)** — when resolving `SlideOp`, stamp `mirror` from the resolved catalog entry (default `none`). Resolving at **load time** means `--check` and the live render read the same value.
3. **Readout authoring rule (P1-1 producer side) — the 5 `mirror:none` readout ops.** `muster-readiness`, `simstack-create`, `simstack-destroy`, `stamper-translate`, `stamper-execute` each render an `htmlDataUrl` outcome card to `ctx.pane` (op-catalog `shows`/preconditions L175/L315/L334/L356/L377). Under mirror-default (S6) that card lands in the **headless, unseen** pane. Record in each catalog entry's `shows`/note and in `demos/README.md` the rule: **the op's audience-facing outcome must be authored as slide content on its live slide (an `html` cell or F/B/D cards), because in mirror-default mode the pane readout is not visible.** See Out of Scope for the full scope and the `--pane-window` / `mirror:'readout'` alternatives.

**Acceptance S3:** `tsc` + `npm test` green; loader test asserts an `ao-registry` slide resolves `mirror:'theatrical'` and a `stamper-execute` slide resolves `mirror:'none'`; catalog test asserts all 14 entries declare `mirror`; `demo:show --check` still green on all decks. **Note (wording, P2 — not a regression):** the right-third split appears on AO/EO slides only once mirror is **active** — under the interim `--mirror` flag (S2/S3) and, after S6, by default; `--pane-window`/`mirrorActive=false` gates it off. The S7 loop verifies the split on the real pain-story deck.

### S4 — injected per-app narrow reflow (reflow, not rescale)
1. **`app-pane.ts` (MODIFY)** — in mirror-mode pane open (S6), before first navigation, `page.addInitScript(reflowScript)` (runs before page scripts, on every navigation, per-frame). The pane's mirror viewport is fixed **640×1080** (portrait right-third), not `viewport:null`, so the GUIs lay out at 640px and the mirror maps 1:1 with no rescale blur.
2. **Reflow script (per app, keyed on `location.port`):** appends a `<style>` on `DOMContentLoaded`. These four sibling GUIs set **no CSP** (verified §6.4/§7), so an injected `<style>` is safe; if a future app sets `style-src`, fall back to `sheet.insertRule` (CSSOM, ungoverned).
   - **AO :3001** — `#main{grid-template-columns:1fr !important;max-width:none !important}` (verified: `ces-ao/public/index.html` L74 `max-width:1320px`, L78 `grid-template-columns:380px 1fr`, `<div id="main">` L707).
   - **EO :4002** — `#main{grid-template-columns:1fr !important;max-width:none !important}` (concept cites `260px 1fr` — **verify against `ces-eo`'s real index.html during this slice**, adjust selector if it differs).
   - **Muster :4173** — **no injected CSS.** `.page{max-width:860px;margin:0 auto}` is a *cap*, not a width; at a 640px viewport the fluid column lays out ≤640 by construction (§7.5). Verify visually in the headed check; adjust padding only if cramped.
   - **Stamper :3000** — irrelevant: Config drives `backstage`, never `pane`, and is never mirrored.

**Acceptance S4:** `tsc` + `npm test` green; a headed `--mirror` `demo:show` shows the AO GUI single-column and legible in the right third (reflow, not blur). **Re-run the acts harness** — AO/EO flows now execute against the reflowed single-column layout (they already run at 620px today, so risk is bounded, but visibility-dependent waits can shift; confirm green).

### S5 — minimal branded cursor overlay in-frame
1. **`app-pane.ts` reflow init-script (MODIFY, or a sibling init-script)** — add ~40 lines injecting a branded cursor dot (BHD navy `#1a2332` core + gold `#f5b74a` ring, `docs/demo/design/brand/BHD-BRAND.md`) via the **same `addInitScript` channel** as reflow, tracking the page's own `mousemove`/`mousedown` (§1.2 technique). `position:fixed; z-index:2147483647; pointer-events:none`; set `el.style.left/top` (CSSOM, not inline `<style>`), click-pulse via `el.animate()`.
2. **Dependency note (T1):** Playwright `click()` dispatches a real `mousemove` to the target over CDP, so the dot **already jumps to each click target and pulses** even without T1's cadence layer — real value now, not dead code. Only `fill()` is invisible (instantaneous DOM assignment). Full glide/typing theater needs the T1 `theatrical-page.ts` decorator (`mouse.move(...,{steps})` + `keyboard.type`), which does **not exist yet** — flag it, do not build it here.

**Acceptance S5:** `tsc` + `npm test` green; headed `--mirror` run shows the branded dot appear and pulse at each click target inside the mirrored frame.

### S6 — default flip + `--pane-window` escape hatch
1. **`show-command.ts` (MODIFY)** — `--pane-window` boolean flag. **Default:** `mirrorActive = true`, pane opens **headless** with the 640×1080 mirror viewport + reflow/overlay init-scripts (no OS window). **`--pane-window`:** restores today's behavior — pane opens headed at `DEFAULT_APP_GEOMETRY` (620×1000, `app-pane.ts` L23), AND sets `mirrorActive = false` so no dead `<img>` renders (the mirror route simply gets no subscribers). Retire the interim `--mirror` flag (fold into the default). Both flags are boolean → **not** added to `FLAGS_WITH_VALUES` (they consume no value); confirm the positional-deck parser still resolves the `.xlsx`.
2. **`show-run.ts` / `app-pane.ts` (MODIFY)** — branch `openAppPane` on mirror-vs-window: mirror → `chromium.launch({headless:true})` + `newContext({viewport:{width:640,height:1080}})` + init-scripts; window → existing `openPositionedUiPage` headed path unchanged. Thread `mirrorActive` into the render gate and into whether `mirror.attach` runs.
3. **`app-pane.ts` stale comment (P2)** — `PaneOptions.headless` (L72) reads "Headless is for tests only — an operator run is headed by definition." The default flip makes an operator run headless-and-mirrored; update the comment so it does not mislead the next reader.
4. **`docs/context/THREAD_HANDOFF.md` (MODIFY) — P1-3, binding-doc amendment.** Decision 7 (L108-110) reads verbatim "…MJPEG on the slides server, **backstage-session-driven**, injected reflow…". That clause **inverts** this plan's verified linchpin: the mirror sources the **visible `pane`**, because mirroring backstage would (a) capture none of the AO/EO/Muster acts (they drive `pane`) and (b) put the Config GUI on stage (violating decision 8). Amend the clause to "**visible-pane-driven; Config runs in the separate backstage process and is never mirrored**," citing the decision-7 correction. Same failure class as the act-harness plan's THREAD_HANDOFF/decision-9 amendment — a binding doc must not describe an architecture the code contradicts, or a future agent re-introduces the doctrine breach. (THREAD_HANDOFF.md is in this project root — writing it is in-boundary.)

**Acceptance S6:** `tsc` + `npm test` green; default `demo:show <deck>` renders the app in-frame with no second window; `demo:show --pane-window <deck>` restores the two-window behavior byte-for-byte with today; `demo:show --check` green on all decks either way; THREAD_HANDOFF decision 7 no longer says "backstage-session-driven."

### S7 — presenter/nav confirmation + final pain-story loop
1. **Presenter/nav (confirm, no code):** the mirror `<img>` is inert content; keydown→POST `/nav` and the SSE state stream are untouched. One headed confirmation that next/prev/first/last/exit still drive the deck with the mirror active.
2. **Final loop step (mandatory):** run `demos/ces-pain-story.xlsx` (has warm+live `ao-registry`) **headed**, default (mirror) mode. Confirm: (a) the **AO GUI mirrors in the right third**, reflowed and legible, cursor dot visible on clicks; (b) a **Config act is confirmed NOT mirrored** (no split on the Stamper slide, no Config GUI anywhere on screen); (c) **the Config/RE outcome is still communicated (P1-1)** — the `mirror:none` op's result reaches the audience via authored slide content (not the invisible headless pane); if the deck relies only on the pane readout, that is the regression P1-1 warns of — flag it, do not pass the loop on it; (d) `demo:show --check demos/ces-pain-story.xlsx` still PASS; (e) the acts harness still green.

**Acceptance S7:** all five (a)-(e) confirmed; iterate S2-S6 if any fails (this is a build→verify loop, not a linear pass).

## File Inventory
| File | Action | Lines / Functions Affected |
|------|--------|----------------------------|
| `src/demo/show/screencast-mirror.ts` | CREATE | `PaneMirror` (subscribe/push/attach/start/stop/dispose); MJPEG frame writer |
| `src/demo/show/slides-server.ts` | MODIFY | `SlidesServerOptions.mirror` (L56-77); `/mirror` route (near L177); `stop()` mirror.dispose (L230-238) |
| `src/demo/show/show-run.ts` | MODIFY | construct+pass `PaneMirror` (before L249), `mirror.attach(pane.session.raw)` (after L307), disposer; `mirrorActive` thread |
| `src/demo/show/app-pane.ts` | MODIFY | `PaneOptions` mirror viewport + init-scripts; `openAppPane` mirror-vs-window branch (L69-97); reflow + cursor init-scripts |
| `src/demo/show/slide-render.ts` | MODIFY | `.body-mirror` branch in `renderSlideHtml` (L360-376); `SHOW_CSS` `.body-mirror`/`.mirror-img`; `holdHtml:''` for mirrored in `buildDeckView` (~L412) |
| `src/demo/show/deck-model.ts` | MODIFY | `SlideOp.mirror` field (L147-167) |
| `src/demo/show/op-catalog.ts` | MODIFY | per-act `mirror:'none'|'theatrical'` |
| `src/demo/show/xlsx-loader.ts` / `deck-validate.ts` | MODIFY | resolve+stamp `SlideOp.mirror` from catalog at load |
| `src/cli/show-command.ts` | MODIFY | `--pane-window` (+ interim `--mirror`) flag, `mirrorActive`, default flip (L42-152) |
| `docs/context/THREAD_HANDOFF.md` | MODIFY (S6) | decision 7 (L108-110): "backstage-session-driven" → "visible-pane-driven; Config never mirrored" (P1-3) |
| `demos/README.md` | MODIFY (S3) | readout authoring rule for the 5 `mirror:none` readout ops (P1-1) |
| `tests/**` (mirror, render, loader, teardown) | CREATE/MODIFY | `PaneMirror` fake-CDP test (incl. idempotent dispose); **`/mirror` server-teardown integration test** (P1-2, analog of `demo-show-server.test.ts` L194-201); `renderSlideHtml` split byte-identity + html-body precedence tests; loader mirror-resolution + all-14-declare-mirror catalog test |

## Architecture Decisions
- **Mirror source is `pane`, never `backstage`.** Config runs in a separate Chromium process with no CDP session on the mirror route → decision 8 holds structurally; `mirror:none` gates the slide layout as a second barrier.
- **Screencast lifecycle follows MJPEG subscriber count.** The `<img>` exists only on mirrored slides, so entering/leaving a slide connects/closes the MJPEG stream, which starts/stops the screencast for free — per-slide teardown with no slide-event plumbing.
- **Reflow, not rescale.** Fixed 640×1080 mirror viewport + `addInitScript` narrow layout so 1360px grids lay out at 640px and map 1:1 (no downscale blur). `object-fit:contain` + navy ground on the `<img>`.
- **No new dependency.** MJPEG over the existing `node:http` slides server; repo has no `ws` and needs none.

## Testing Strategy
- Unit: `PaneMirror` against a fake CDP session (frame→multipart, ack-every-frame, backpressure skip, dispose destroys subscribers); `renderSlideHtml` split-vs-byte-identical; loader `mirror` resolution.
- `demo:show --check` on every existing deck each slice (byte-identical non-mirror slides — trivial by construction since the gate excludes `staged`; the split path is unit-tested, not `--check`-tested).
- Real headed `demo:show` proving in-right-third render (S4/S5/S7); acts harness re-run at S4 and S7.

## Out of Scope
- The T1 `theatrical-page.ts` decorator (glide/typed cadence) — S5 ships only the overlay DOM and flags the dependency.
- T2 terminal-theater and T3 new acts (separate GP-DEMO-5 slices).
- Record/replay (DEMO-ACTS-CONCEPT §8 — unrelated).
- **Readout loss on the default path — FIVE `mirror:none` ops, not just Config (P1-1).** In mirror-default mode (S6) the pane is headless and a `mirror:none` slide renders no `<img>`, so **any** op that navigates `ctx.pane` to an `htmlDataUrl` outcome card lands it where no one sees it. This affects `muster-readiness` (RE — the "no readiness score" beat, decision 5), `simstack-create` (the "deliberate gap shown" beat), `simstack-destroy`, `stamper-translate`, and `stamper-execute` — not only Config. Scoped mitigation (default, no doctrine change): **the op's outcome is authored as slide content** (an `html` cell or F/B/D cards on the op's live slide) — an authoring rule stamped into the catalog `shows` and `demos/README.md` in S3, verified in S7(c). The `--pane-window` rehearsal path still shows the pane readout for debugging. **Founder-visibility alternative (NOT default, needs approval to extend the `none|theatrical` surface):** a third `mirror:'readout'` value could stream the pane's readout-only data-URL into the right third — doctrine-safe even for Stamper, because in mirror mode the pane **never** shows the Config GUI (that work is on the separate `backstage` process; the pane only ever navigates to the result card). Flagged for the founder gate; do not build by default.
- Editorial: split slides lose content width (85u→~51.7u); shorter card text is an authoring rule, not a renderer change.

## Acceptance Criteria
- [ ] The live app renders inside the slide's right third (headed slides window, mirrored app in-frame) in default mode.
- [ ] `demo:show --check` stays PASS on all existing decks; non-mirror slides render byte-identically.
- [ ] Mirrored slides do NOT flip to the hold card mid-op (mirror stays visible).
- [ ] `mirror:none|theatrical` is per-act; Config (Stamper) is `none` and its GUI never appears in the mirror.
- [ ] AO/EO GUIs reflow legibly at ~640px (not downscaled); Muster verified legible with no injected CSS.
- [ ] Branded cursor dot rides inside the mirrored frames on clicks.
- [ ] `--pane-window` restores today's two-window behavior for rehearsal.
- [ ] Presenter nav (next/prev/first/last/exit) unaffected with the mirror active.
- [ ] The 5 `mirror:none` readout ops' outcomes still reach the audience via authored slide content on the default path (P1-1).
- [ ] `server.stop()` / teardown leaves no orphaned Chromium, MJPEG connection, or listening port — **proven by the `/mirror` server-teardown integration test**, not asserted (P1-2).
- [ ] THREAD_HANDOFF decision 7 amended to "visible-pane-driven; Config never mirrored" (P1-3).
- [ ] Final loop: `ces-pain-story.xlsx` headed shows AO mirrored in the right third + a Config act confirmed NOT mirrored; `--check` PASS; acts harness green.
