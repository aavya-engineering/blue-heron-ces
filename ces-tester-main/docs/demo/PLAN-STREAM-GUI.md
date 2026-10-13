# Plan: Stream the LIVE GUI "when it makes sense" (GP-DEMO-5 streamgui)
**Date:** 2026-09-07
**Status:** READY FOR IMPLEMENTATION

## Objective
Extend the just-built in-slide mirror so a real UI operation is streamed into the slide's right
third wherever it is meaningful — founder decision 11. Two changes: (a) the Config/Stamper GUI
streams live (decision 8's no-live-Config rule lifted), and (b) `muster-readiness` streams the
Muster SPA operating on real data. Honesty guards survive both.

## Context Summary
- **Mirror today (IMPLEMENTATION_LOG "GP-DEMO-5 in-slide mirror"):** `PaneMirror`
  (`screencast-mirror.ts`) attaches ONE CDP session to the VISIBLE pane (`pane.session.raw`) and
  fans it out on a single hard-coded route `GET /mirror`; `slide-render.ts` L401 emits a hard-coded
  `<img src="/mirror">` for any driven `theatrical`/`readout` slide when `mirrorActive`. `theatrical`
  and `readout` render identically.
- **Config runs BACKSTAGE:** `op-registry.ts` `prepare()` opens a second, headless, never-displayed
  `backstage` session (`openAppPane({headless:true})`); `stamper-translate/execute-op.ts` drive it,
  never the pane. All pane+backstage work is serialized through one queue.
- **(b) substrate exists:** `muster-auto-analysis-op.ts` drives `ctx.pane.page` via
  `driveMusterImportDiscovery(...)` (real CLI walk → readiness-result → SPA file-import seam, never
  the fixture button). `muster-readiness-op.ts` only spawns the CLI and ends with
  `pane.goto(readoutHtml(...))`; `armingFor()` gives it NO `withMuster` surface.
- **Constraints:** V4 render lock (non-mirror slides byte-identical); A8 no-orphan-connection
  teardown; honesty guards (decision 9/11: judge by `result.report`/artifact, never a badge; real
  CLI data into the SPA, never the fixture button; no fabricated progress). Windows/PS5.1; ports
  4500/4390/3000/3001/4002/4173.

## Architecture Decisions
- **(a) Add a SECOND screencast on the backstage session — do NOT move Config onto the pane.**
  Decisive reason: `stamper-execute`'s execute-only fast path exists *only because nothing else ever
  navigates backstage* (its op header) — a warm `stamper-translate` leaves exactly the connected+
  outputPath state execute-only needs. On the shared visible pane that state is clobbered by every
  intervening op, so every execute degrades to the ~12-min full flow. Moving Config to the pane also
  breaks the warm-concurrency and visible-state guarantees and re-exposes the Config GUI on the
  streamed surface. So `PaneMirror` (already source-agnostic) is reused as a second instance bound to
  `backstage.session.raw`, exposed on `GET /mirror/backstage`, and a Config slide points its `<img>`
  at that route via a new `SlideOp.mirrorSource`.
- **(a) Config timing — two honest patterns, founder picks per-deck.** (1) *Warm execute:* the
  `/mirror/backstage` screencast shows backstage's REAL current state — mid-run if the ~13-min warm
  execute is still in flight when the Config slide is reached, or the completed report if done.
  Neither is fabricated (the op pill shows running/done); §8 record-replay is OUT OF SCOPE; no blank
  "seed" is ever replayed as live (the frame is captured at SUBSCRIBE time from the page's real
  current state — never seeded blank at attach). Constraint: a warm execute must not be crossed by a
  live-streamed op on a later slide (shared single queue — see A3 step 3). (2) *Live execute (proof/
  combined default):* execute runs on-slide with the execute-only fast path (a live translate
  immediately precedes it), streaming the real GUI *operating in-sync* at the cost of a ~13-min
  hold-card. Recommend (2) for the streamgui proof; (1) for a shorter customer show. Either way the
  stream is the real Config GUI, never a card.
- **(b) `muster-readiness` GAINS the SPA drive+import — it is NOT aliased to `muster-auto-analysis`.**
  It keeps its distinct RE identity (four-value posture doctrine, `NO_SCORE_LINE`, the degraded
  "evaluation unavailable" path, ledger read-only proof, standalone beat) and REUSES the shared
  `driveMusterImportDiscovery` seam. `muster-auto-analysis` requires a prior `muster-connect-tenant`
  and lands inside the 5-act sequence; `muster-readiness` is standalone, so aliasing would drag in
  preconditions and framing that do not fit.
- **`mirrorSource` is an explicit catalog field, not derived from `target`.** Where an op *drives* is
  not the same as which tool it targets; encode it once, stamp it at load.

## Implementation Steps (slices — one commit each, prefix `GP-DEMO-5 streamgui:`)

### A1 — Backstage streamable source (infra, inert by default)
1. `deck-model.ts`: add `SlideOp.mirrorSource?: 'pane'|'backstage'`.
2. `op-catalog.ts`: add `OpCatalogEntry.mirrorSource` (REQUIRED, compile-forced across all 14):
   `'backstage'` for `stamper-translate`/`stamper-execute`, `'pane'` for the other 12. **No `mirror`
   flip yet** (stamper stays `readout`).
3. `deck-validate.ts`: stamp `SlideOp.mirrorSource` from the catalog at load (default `'pane'` for
   op-less slides) — mirror of how `mirror` is stamped.
4. `slide-render.ts`: pick the `<img>` src to `/mirror/backstage` **only when
   `slide.op.mirror === 'theatrical' && mirrorSource === 'backstage'`**; every other mirrored slide
   (including a `readout` stamper slide) keeps `src="/mirror"`. **This is what keeps A1 genuinely
   inert (P1-1):** `slideMirrors()` (slide-render L191-192) returns true for `theatrical` OR
   `readout`, so if the src were routed by `mirrorSource` alone, a stamper `readout` slide (e.g.
   `ces-pain-story.xlsx`'s warm stamper beat) would begin streaming the live Config GUI the moment A1
   lands — the A2/A3 behaviour arriving before the catalog flip, the headed proof, and the doc
   updates, inverting the catalog-flip-with-streaming-code gate. Gating on `theatrical` too means
   nothing streams backstage until A2/A3 flip `mirror`. `mirrorSource:'pane'` and any `readout` slide
   render byte-identical markup (`src="/mirror"`) → **no golden re-baseline**.
5. `slides-server.ts`: add `backstageMirror?: PaneMirror` option + `GET /mirror/backstage` route
   (subscribe/unsubscribe, 404 when unwired); dispose it in `stop()` before `server.close()` (A8).
6. `show-run.ts`: construct `backstageMirror` (a second `PaneMirror`) when `mirrorActive`; pass to
   `startSlidesServer` and into `makeShowOps` deps. **P2-1:** give this instance a `ScreencastConfig`
   sized for the LANDSCAPE backstage (`BACKSTAGE_GEOMETRY` 1280×900), not the portrait
   `DEFAULT_SCREENCAST` (maxWidth 640) — a 1280-wide Stamper GUI encoded at 640 wide is ~2× downscaled
   text; pick a width that stays legible letterboxed into the right third. **P2-2:** register
   `backstageMirror.dispose` as a disposer, and pin its order relative to `ops.dispose` (which closes
   backstage): CDP detach after `backstage.close()` is caught and `dispose()` is idempotent, so this
   is ordering hygiene — dispose the mirror before/independently of backstage close.
7. `op-registry.ts`: accept the backstage mirror in `MakeShowOpsDeps`; in `prepare()`, after
   `backstage = await openBackstage()`, call `backstageMirror?.attach(backstage.session.raw)`.
8. `show-command.ts`: thread the backstage mirror into `makeShowOps`.
- **Acceptance:** tsc; npm test (grows from 814) incl. a unit test that a synthetic
  `theatrical`+`backstage` slide renders `src="/mirror/backstage"`, that a stamper `readout` slide
  (catalog unchanged this slice) still renders `src="/mirror"`, and that a `'pane'` slide is
  byte-identical; an integration test that `/mirror/backstage` serves MJPEG AND `server.stop()`
  resolves with an open backstage subscriber, `subscriberCount → 0` (A8); `demo:show --check` green
  all decks; acts harness green. **Inertness gate: no shipped deck streams backstage after A1** (all
  stamper slides are still `readout` → `src="/mirror"`).

### A2 — Config `stamper-translate` streams LIVE
1. `op-catalog.ts`: `stamper-translate.mirror` `readout` → `'theatrical'` (mirrorSource already
   `'backstage'`); confirm `live` mode is authorable (hold-card ladder covers ~5 min).
2. **Keep** `stamper-translate-op.ts`'s live-mode `ctx.pane.goto(readoutHtml(...))` — under mirror
   the pane card is invisible (stream source is backstage) but it is the only Config surface under
   `--pane-window` rehearsal. The op keeps driving `backstage`; the GUI now streams because the slide
   subscribes `/mirror/backstage`.
3. **Stale-doctrine comment sweep (behaviour unchanged, wording only):** `screencast-mirror.ts`
   header ("source is ALWAYS the visible pane… keeps decision 8 true"); `stamper-translate-op.ts`
   header + its `backstage`-absent error's doctrine citation; catalog `shows` string ("The
   Configuration GUI is never on stage"). The ops still REFUSE to drive the pane — only the doctrine
   citation changes.
4. Docs: `docs/demo/OP-CATALOG.md` + root `DEMO-ACTS-DOSSIER.md` — flip the translate act's
   mirror/status, and note the decision-11 doctrine reversal wherever they reference no-live-Config.
   **P2-4:** also correct `docs/demo/DEMO-ACTS-CONCEPT.md` L244 ("RE and Config: NO live product
   demo") and L558 ("all five acts ship `mirror:none` under decision 8"), left stale by decision 11 —
   same doctrine-defect reason as the other docs (do it once here, covering all three flipped acts).
- **Acceptance:** all A1 gates + a **headed** `demo:show` on the streamgui proof deck (A0 below)
  proving the real Stamper Configuration GUI streams operating in the right third on a translate-live
  slide, **with the Stamper text judged legible** at the chosen backstage `ScreencastConfig` width
  (P2-1).

### A3 — Config `stamper-execute` streams its REAL backstage state (warm)
1. `op-catalog.ts`: `stamper-execute.mirror` `readout` → `'theatrical'`.
2. Execute runs WARM by default (~13 min; the founder's stated preference, and it keeps execute's
   wall time off the stage). On its slide the `<img src="/mirror/backstage">` streams backstage's real
   current state — mid-run or completed. **Empirical check in this slice:** confirm a frame arrives
   when a subscriber connects to an idle/finished backstage page (S1 spike says headless emits after a
   visual change, so a finished-idle page may emit nothing on `startScreencast`).
   **Fallback is seed-on-SUBSCRIBE, never seed-on-attach (P1-2):** `attach` runs in `prepare()` on a
   blank, never-navigated backstage page, so a `captureScreenshot`-on-attach seed would capture a
   BLANK page and replay it later as if live — the exact fabricated-live-stream the founder forbids.
   Instead, in `screencast-mirror.ts`, if `lastFrame` is undefined when a client subscribes, capture
   the page's CURRENT frame at subscribe time (`cdp.send('Page.captureScreenshot')`) so the subscriber
   always sees the real present state, never a stale blank. (Alternative: start the backstage
   screencast at attach, keeping `lastFrame` fresh, at the cost of ~13 min of unwatched encoding —
   subscribe-time capture is cheaper and equally honest.)
3. **Warm-execute ordering rule (P1-6):** a warm `stamper-execute` occupies the single serialized
   queue (`op-registry.ts` serialize) from prep for ~13 min, so it MUST NOT be crossed by any
   live-streamed op on a later slide — the later op would queue behind execute and its slide's stream
   would show backstage doing execute work under the wrong narration. A deck that streams execute warm
   therefore makes execute the ONLY streamed Config beat (translate, if present, is warm+earlier to
   feed the fast path and is authored as slide content, not live-streamed). A deck that wants
   translate's GUI streamed operating live uses the all-live pattern (A0 below), not warm execute.
4. Keep the live-mode readout card write (same rationale as A2).
5. Stale-doctrine sweep for `stamper-execute-op.ts` header + error citation; docs update for the
   execute act (OP-CATALOG.md + dossier), stating §8 record-replay is out of scope.
- **Acceptance:** all gates + headed proof on a minimal `demos/streamgui-execute-warm.xlsx` (title +
  execute-warm slide, an earlier warm translate authored as slide content for the fast path, **no
  live op crossing it**): on the execute-warm slide the real Stamper GUI (mid-run or completed report)
  streams in the right third; op pill shows running/done honestly; a subscriber connecting to a
  finished-idle backstage still receives the real current frame (subscribe-time seed), never a blank.
  (The all-live execute-streaming path is proven separately in B2's combined loop.)

### B1 — `muster-readiness` streams the Muster SPA operating
1. `op-registry.ts` `armingFor()`: add `muster-readiness` to the `withMuster` predicate (arm the SPA
   preview :4173).
2. `muster-readiness-op.ts`: after the CLI writes the artifact, on the **success path**:
   **(a) navigate the pane to the SPA first — `await ctx.pane.page.goto(ctx.armed.musterBaseUrl)`
   (P1-3).** `driveMusterImportDiscovery` (`muster-ui-driver.ts` L136-150) does NO navigation — it
   clicks `navDiscovery`, sets the file input, and waits for `boundary-confirm-panel`; only the FIRST
   Muster beat (`driveMusterConnect`, `page.goto(baseUrl)`) navigates. `muster-auto-analysis` works
   only because `muster-connect-tenant` navigated earlier in the 5-act sequence. `muster-readiness` is
   standalone, so without this explicit `goto` the import clicks into a non-SPA page and times out.
   **(b) import via `driveMusterImportDiscovery(ctx.pane.page, outPath)` and END ON THE SPA** (boundary
   panel) — **do NOT** finish with `pane.goto(readoutHtml)`, which would wipe the SPA off the streamed
   pane and fail decision 11(b). The readout card renders ONLY on the degraded/unavailable path
   (CLI/SPA not built, bad artifact). Keep the four-value tally, `NO_SCORE_LINE` and ledger proof in
   the log/facts.
3. `op-catalog.ts`: `muster-readiness.mirror` `readout` → `'theatrical'`; `mirrorSource` stays
   `'pane'` (SPA drives the visible pane). Modes `live/staged` (drop `warm` — matches
   `muster-auto-analysis`; a warm SPA drive shows a stale panel, and honesty wants the import visibly
   happening). ~80s CLI+import runs LIVE on-slide, hold-card covers it (consistent with
   `muster-auto-analysis` at ~85s). Verify `deck-validate` accepts the new `live/staged` set and
   rejects `warm` for this op (mode-∈-catalog-modes validation).
4. **Stale-doctrine sweep for `muster-readiness-op.ts` — B1 inverts this file hardest (P1-4):** its
   header (L9-25: "do not turn this op into a Muster UI drive… a live RE walk is a SEPARATE op"; fact
   1: "it does not walk a Muster interface") now describes the opposite of what the op does — rewrite
   it. Fold in the same file's now-false neighbours: `armingFor`'s "muster-readiness… adds NO surface"
   comment (`op-registry.ts` L144-146), and `makeMusterReadinessOp`'s docstring describing `warm`
   (L390-395), which B1 drops. Inverted doctrine wording is treated as a defect in this repo.
5. **Mode-compat sweep:** grep `demos/*.xlsx` for a `warm` `muster-readiness` slide; the only
   invocation (`muster-readiness-demo.xlsx`) is `live`, so nothing shipped breaks — but confirm and
   fix any offender in THIS slice or `--check all decks` reds.
6. **Acts-harness reconcile (P1-5) — `ACT-HARNESS.md` in the File Inventory:** `ACT-HARNESS.md` L125
   pins **MR6: "warm and live both complete."** Dropping `warm` makes MR6 unsatisfiable and would red
   B1's own "acts harness green" gate. Update MR6 to a live-only check, update the `--full`
   port/group table (L36) so `muster-readiness` is armed for `:4173` now (it gains `withMuster`), and
   update the harness's `muster-readiness` act DEFINITION (the synthetic-deck act) to `live` and to
   arm/expect the SPA import. Prior gap analyses in this file forced an `ACT-HARNESS.md` MODIFY row
   into every slice of the last two plans; carry it here.
7. **Tests to update by name (P2-3):** `demo-show-op-registry.test.ts` (L232 pins
   `armingFor(['muster-readiness']) → {withMuster:false}` — flip to true) and cross-check
   `demo-acts-roster.test.ts` (L65 group-arming); plus the muster-readiness op unit test (success
   path ends on the SPA via injected fake pane/CDP seam, degraded path still renders the card).
8. **Verify (flagged residual):** does `driveMusterImportDiscovery` land the import on a fresh SPA
   with no prior `muster-connect-tenant` manifest? This is a genuinely-open SPA-behaviour question
   (separate from the P1-3 `goto`, which is a concrete gap now closed). If the import needs a manifest,
   add a minimal manifest fill inside the op or document the precondition — decide from the live check.
9. Docs: OP-CATALOG.md + dossier for `muster-readiness` (mirror/status; honesty guard: real CLI data
   imported, never the fixture button).
- **Acceptance:** all gates (incl. acts harness green with the reconciled MR6) + headed proof: the
  `muster-readiness` slide shows the Muster SPA operating with this run's real imported result
  (boundary panel visible, fixture `discovery-summary` absent) in the right third; degraded path
  still renders the "unavailable" card.

### A0 / B2 — streamgui proof deck + final combined headed loop
**The queue-ordering rule that makes the proof honest (P1-6):** warm ops all fire at prep and every
op — live pane work AND backstage work — shares ONE serialized queue (`op-registry.ts` serialize;
`show-run.ts` warm-at-prep L404-408). A warm `stamper-execute` (~13 min) started at prep therefore
sits in the queue while the deck runs, and any live-streamed op on a later slide would queue behind
it — its slide's stream showing the wrong op under the narration, and its wall time inflated. So the
proof/combined deck uses **NO warm ops for streamed beats: every streamed op is LIVE-on-slide, placed
in narration order.** The single queue then processes them in the same order the audience sees, each
op completing on its slide (hold-card) before the next slide's op starts — no stream ever shows the
wrong op, and `stamper-execute` gets its execute-only fast path because a live `stamper-translate`
immediately precedes it and leaves backstage connected + `#outputPath` populated.
1. Author `demos/streamgui-proof.xlsx` in **narration order, all streamed beats LIVE**: title →
   `muster-readiness` **live** (SPA, ~80s, `mirrorSource:'pane'`) → `stamper-translate` **live**
   (backstage GUI, ~5 min, `/mirror/backstage`) → `stamper-execute` **live** (backstage GUI, fast
   path ~13 min from translate's state, `/mirror/backstage`). Introduce it in **A2** as title +
   translate-live only (nothing crosses it); extend in **B1** (add the muster-readiness-live slide)
   and **A3** (add the execute-live slide right after translate). A3's own warm-execute headed proof
   uses a SEPARATE execute-warm-only deck (no live op crossing) — the two A3 acceptance clauses cover
   both the warm-stream path and this all-live path.
2. **Founder tradeoff to surface, not decide silently:** the founder asked that execute "still runs
   warm." Warm execute keeps ~13 min off the stage but (i) streams backstage's real end/mid state,
   not the operation in-sync, and (ii) forbids a live-streamed op on any later slide. The all-live
   proof deck streams execute's GUI *operating in-sync* at the cost of a ~13-min on-stage hold-card.
   Recommend all-live for the combined proof; let the founder pick per-deck. No fabrication either
   way — warm shows the real current state, live shows the real operation.
3. Final loop: a **headed** `demo:show` on `streamgui-proof.xlsx` proving Config GUI streaming AND
   Muster SPA streaming both appear in the right third, in-sync with their slides, with clean A8
   teardown (ports 4500/4390/3000/3001/4002/4173 freed) and both `PaneMirror` instances disposed.
   Verification-only slice (log commit).

## File Inventory
| File | Action | Target |
|------|--------|--------|
| src/demo/show/deck-model.ts | MODIFY | add `SlideOp.mirrorSource?: 'pane'\|'backstage'` |
| src/demo/show/op-catalog.ts | MODIFY | `OpCatalogEntry.mirrorSource` (required, all 14); flip `mirror` for the 3 ops; mode edits |
| src/demo/show/deck-validate.ts | MODIFY | stamp `mirrorSource` at load |
| src/demo/show/slide-render.ts | MODIFY | route `<img>` src to `/mirror/backstage` only when `mirror==='theatrical' && mirrorSource==='backstage'` (L391-402 region) |
| src/demo/show/slides-server.ts | MODIFY | `backstageMirror` option + `GET /mirror/backstage` + dispose (L85-92, L196-208, L263-274) |
| src/demo/show/show-run.ts | MODIFY | construct second `PaneMirror` w/ landscape `ScreencastConfig` (P2-1); register/pin its disposer (P2-2) (L262, L342-349) |
| src/demo/show/op-registry.ts | MODIFY | `armingFor` +muster-readiness; attach backstage mirror in `prepare()` (L137-154, L245-250) |
| src/demo/show/show-command.ts | MODIFY | thread backstage mirror into `makeShowOps` |
| src/demo/show/screencast-mirror.ts | MODIFY | stale-doctrine header; **seed `lastFrame` at SUBSCRIBE via `Page.captureScreenshot`** when undefined (P1-2, A3) — never seed-on-attach |
| src/demo/show/ops/stamper-translate-op.ts | MODIFY | stale-doctrine header + error citation (behaviour unchanged) |
| src/demo/show/ops/stamper-execute-op.ts | MODIFY | stale-doctrine header + error citation |
| src/demo/show/ops/muster-readiness-op.ts | MODIFY | `pane.goto(:4173)` then SPA import; end on SPA; card only on degraded path; header + `warm` docstring sweep (P1-4) |
| docs/demo/OP-CATALOG.md | MODIFY | mirror/status for the 3 flipped acts; decision-11 reversal |
| DEMO-ACTS-DOSSIER.md | MODIFY | mirror/status for the 3 acts; note no-live-Config reversal |
| docs/demo/DEMO-ACTS-CONCEPT.md | MODIFY | L244/L558 decision-11 reversal (P2-4) |
| docs/demo/ACT-HARNESS.md | MODIFY | MR6 → live-only; `--full` port/group table +`:4173` for muster-readiness (P1-5) |
| src/demo/acts/* (harness) | MODIFY | muster-readiness act def → `live`, arm/expect SPA import (P1-5) |
| demos/streamgui-proof.xlsx | CREATE | all-live narration order: muster-readiness-live, translate-live, execute-live (P1-6) |
| demos/streamgui-execute-warm.xlsx | CREATE | A3 warm-path proof: title + execute-warm, no live op crossing |
| demos/muster-readiness-demo.xlsx | MODIFY (if needed) | remove any `warm` muster-readiness slide |
| tests | CREATE/MODIFY | src-route gate (theatrical+backstage vs readout stays `/mirror`); `/mirror/backstage` serve+teardown (A8); `demo-show-op-registry.test.ts` L232 (`withMuster` true); `demo-acts-roster.test.ts` L65; muster-readiness SPA-end + degraded-card |

## Testing Strategy
- Unit: `<img>` src gate (`theatrical`+`backstage` → `/mirror/backstage`; `readout`+`backstage` and
  any `pane` → `/mirror`, byte-identical); catalog required-field compile force; `deck-validate`
  stamping + mode-set (`muster-readiness` accepts `live/staged`, rejects `warm`).
- Integration: `/mirror/backstage` serves MJPEG and tears down A8-clean with an open subscriber;
  `muster-readiness-op` success path lands on the SPA boundary panel (fake CDP/pane seam, no browser)
  and the degraded path still renders the card.
- Per-slice gates: `npx tsc --noEmit` + `npm test` (baseline ~814, grows) + `demo:show --check` green
  ALL decks + acts harness green + a real **headed** `demo:show` proving the specific GUI streams in
  the right third.

## Out of Scope
- §8 record-replay (recording backstage during warm prep and replaying it) — named, not built.
- Moving Config off the backstage session onto the pane (rejected — see Architecture Decisions).
- Aliasing `muster-readiness` to `muster-auto-analysis` (rejected).
- The T1 `theatrical-page.ts` glide/typed-cadence decorator (pre-existing out-of-scope item).
- AO/EO/the 5 Muster GUI acts (already theatrical) and `simstack-create`/`destroy` (no GUI — stay
  `readout`).
- Amending THREAD_HANDOFF decision text (founder's to reconcile; this plan cites the annotations).

## Acceptance Criteria
- [ ] A1 INERT: `/mirror/backstage` exists, serves MJPEG, tears down A8-clean; `mirrorSource` stamped;
      backstage src routed only on `theatrical`+`backstage`, so **no shipped deck streams backstage
      after A1** (stamper still `readout` → `/mirror`); non-backstage slides byte-identical (no golden
      re-baseline).
- [ ] A2: `stamper-translate` `theatrical`; real Config GUI streams operating live on-slide (headed);
      Stamper text legible at the backstage `ScreencastConfig` width.
- [ ] A3: `stamper-execute` `theatrical`; on an execute-warm-only deck the real backstage state
      (mid-run or completed) streams; a subscriber to a finished-idle backstage gets the real current
      frame (subscribe-time seed), never a blank; §8 record-replay stays out of scope.
- [ ] B1: `muster-readiness` `theatrical`; `pane.goto(:4173)` then import; SPA operating with real
      imported result streams (fixture button never touched); success path ends on the SPA, degraded
      path on the card; `withMuster` armed; MR6 reconciled live-only; no warm-mode deck offender.
- [ ] Stale-doctrine wording swept — the 3 flip slices AND `muster-readiness-op.ts`'s header/`warm`
      docstring/`armingFor` comment; OP-CATALOG.md + dossier + DEMO-ACTS-CONCEPT.md + ACT-HARNESS.md
      updated with the decision-11 reversal.
- [ ] Final loop: one headed run on the all-live `streamgui-proof.xlsx` streams BOTH Config GUI and
      Muster SPA in the right third, each in-sync with its slide (no cross-stream desync); all ports
      freed on exit, both `PaneMirror` instances disposed.
- [ ] Every slice: tsc + npm test + `--check` all decks + acts harness green.
