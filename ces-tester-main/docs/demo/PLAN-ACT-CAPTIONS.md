# Plan: Per-Action Narration Captions for Every Demo-Act
**Date:** 2026-09-07
**Status:** READY FOR IMPLEMENTATION

## Objective
Give every demo-act a running, human narration on the surface it drives: as an act performs each
meaningful step, a short ms2-voice caption describes what is happening ("Now we run the real
discovery walk against that tenant"). Captions are TESTER-owned code, honest to the REAL action, in
the founder's voice, and gated by the ms2-voice linter.

## Context Summary
- **From THREAD_HANDOFF / dossier:** outward names only — Readiness Evaluation (Muster),
  Configuration (Stamper), Operations (AO), Assessment (EO); stacksim keeps its name. Honesty guards
  (A.5) bind every caption: never narrate the fixture "Run Discovery" button, never claim a readiness
  score, judge Stamper by the on-disk report not the badge, the sim MFA gap is *report-only, never
  missing*, and `muster-adaptive-interview` must not pre-narrate a question-count drop (it is
  measured; a tie is reported).
- **From mechanism read:** `theatrical-page.ts` already renders a CSSOM HUD via
  `paneHud`/`hudScript`/`hudTicker` on a page's `evaluate` surface. Pane ops call
  `hudSurfaceOf(ctx.pane)`; the two Stamper ops call `hudSurfaceOf(ctx.backstage)` and stream
  `/mirror/backstage`. Caption rendering reuses this exact pattern as a **second, top band**.
- **Verified:** the drafted caption corpus (all acts) was linted this session with
  `voice_lint.py` — **exit 0, zero [tell]**, one non-blocking [style] specificity warning
  (expected: captions hold run numbers out). Sentence-cv 0.426 / paragraph-cv 0.324 both clear the
  uniformity floors.
- **Constraints:** static caption strings only — no run-value interpolation (numbers stay in the
  status HUD/log, which already source them from APIs). Best-effort throughout (a caption never fails
  an op). Windows; tsc + npm test clean; no pushes.

## Architecture Decisions
- **Seam on `OpDriveContext`, wired in `op-registry.run()`.** Add `caption?: (text: string) =>
  Promise<void>` (optional, matching the `artifact?` precedent so test fakes compile unchanged). The
  runner builds it bound to the surface the op drives.
- **Captions render on the surface the op drives — never both.** Pane ops get
  `ctx.caption` bound to `hudSurfaceOf(pane)`. The two Stamper ops render captions themselves against
  `hudSurfaceOf(ctx.backstage)` using the exported `paneCaption` primitive (a *warm* stamper op runs
  concurrently with slides 1..N, so a pane-bound caption would paint over an unrelated surface —
  the dishonesty the guards forbid).
- **Second HUD band, top of pane.** A distinct fixed element `__mirror_caption` at `top:14px`
  (bottom status HUD keeps `bottom:14px`), same navy/gold CSSOM styling, `pointer-events:none`,
  `textContent` only, a short `el.animate()` fade on replace. Legible, does not cover the portrait
  app content below it.
- **One navigation timing rule (all 14 ops):** for `goto`, emit the caption AFTER navigation
  resolves (a page load wipes the injected band); for click/fill/select, emit IMMEDIATELY BEFORE the
  verb so it paints during the ~450ms theatrical glide — the caption reads as/just before its action.
- **One typed corpus module.** `CAPTIONS: Record<DemoOpId, ...>` (same totality trick as
  `OP_IMPLEMENTATIONS`) so a future op cannot ship captionless. Captions grouped by real branch
  (warm / live / self-heal / degraded), not one flat list.

## Implementation Steps
1. **`src/demo/show/theatrical-page.ts`** — add `CAPTION_ID`, `captionScript(text|null)` (clone of
   `hudScript`, positioned top, fade via `el.animate`), and `paneCaption.show/hide` (clone of
   `paneHud`). No change to existing HUD.
2. **`src/demo/show/captions.ts`** (NEW) — export `CAPTIONS: Record<DemoOpId, {...named strings /
   branch arrays}>` transcribed verbatim from the tables below, and `ALL_CAPTIONS: string[]`
   (flattened, for the lint corpus + test). Strings static only.
3. **`src/demo/show/op-registry.ts`** — in `run()`, build `caption` bound to `hudSurfaceOf(pane)`
   (best-effort: `paneCaption.show` + `ctx.log('  caption: '+text)`), pass it into the
   `OpDriveContext`. Add `caption?` to the `OpDriveContext` interface.
4. **Each of the 14 op files** — insert `await ctx.caption(CAPTIONS[id]...)` at each meaningful step
   per the tables, honoring the navigation timing rule. Stamper ops instead call
   `paneCaption.show(hudSurfaceOf(ctx.backstage), CAPTIONS[id]...)`. **Verify each caption against the
   op's real steps before wiring** (they were drafted from the op source + dossier, but the coder
   confirms).
5. **`scripts/lint-captions.mjs`** (NEW) + **`package.json`** — import `ALL_CAPTIONS`, write one
   caption per blank-line-separated paragraph to a scratch `.md`, spawn
   `python ~/.claude/skills/ms2-voice/voice_lint.py <file>`, exit non-zero unless the linter exits 0.
   Wire as `demo:captions-lint`.
6. **Tests** (`tests/demo-show-captions.test.ts`, NEW) — (a) a fake `TheatreSurface` asserts an op
   (e.g. `ao-registry`) evaluates `captionScript` payloads in order; (b) pure test that every
   `DemoOpId` has a non-empty caption set.

## File Inventory
| File | Action | Lines/Functions Affected |
|------|--------|------------------------|
| src/demo/show/theatrical-page.ts | MODIFY | +`CAPTION_ID`, `captionScript()`, `paneCaption` (after `paneHud`, ~L257) |
| src/demo/show/captions.ts | CREATE | `CAPTIONS`, `ALL_CAPTIONS` |
| src/demo/show/op-registry.ts | MODIFY | `OpDriveContext` (+`caption?`), `run()` wiring (~L285-308) |
| src/demo/show/ops/ao-registry-op.ts | MODIFY | 3 caption calls |
| src/demo/show/ops/ao-make-change-op.ts | MODIFY | 3 caption calls |
| src/demo/show/ops/eo-review-op.ts | MODIFY | warm/live-walk/self-heal calls in `assessInPane`/`browseInPane`/`runEoReviewOp` |
| src/demo/show/ops/eo-show-change-captured-op.ts | MODIFY | 4 calls (incl. no-flip line) |
| src/demo/show/ops/muster-readiness-op.ts | MODIFY | success + degraded calls |
| src/demo/show/ops/muster-connect-tenant-op.ts | MODIFY | 3 calls |
| src/demo/show/ops/muster-auto-analysis-op.ts | MODIFY | 4 calls |
| src/demo/show/ops/muster-consent-and-attest-op.ts | MODIFY | 4 calls |
| src/demo/show/ops/muster-adaptive-interview-op.ts | MODIFY | 4 calls (no asserted drop) |
| src/demo/show/ops/muster-generate-sprs-mp-op.ts | MODIFY | 5 calls |
| src/demo/show/ops/simstack-create-op.ts | MODIFY | 4 calls |
| src/demo/show/ops/simstack-destroy-op.ts | MODIFY | 3 calls |
| src/demo/show/ops/stamper-translate-op.ts | MODIFY | `paneCaption` on backstage; warm+live sets |
| src/demo/show/ops/stamper-execute-op.ts | MODIFY | `paneCaption` on backstage; warm+live sets |
| scripts/lint-captions.mjs | CREATE | corpus dump + voice_lint subprocess gate |
| package.json | MODIFY | `demo:captions-lint` script |
| tests/demo-show-captions.test.ts | CREATE | ordered-emit + non-empty tests |

## Caption Scripts Per Act (verbatim — lint-verified corpus)

**simstack-create** — 1) This is the tenant the whole demo runs on. It looks like the estates we
actually walk into every week. 2) The registry record is real — four authorization fields, a live
certificate path, and an endpoint that answers when we ask it. 3) Here is the gap we are going to
chase. An MFA policy exists. It has sat in report-only mode for six months, and nobody ever flipped
it to enforced. 4) That describes most environments we assess. The control was configured once and
then quietly left half-finished.

**simstack-destroy** — 1) When the demo ends, this tenant goes away. 2) We remove the registry
record and stop the sim serve. 3) Every screenshot and every artifact from this run stays on disk.
The environment is disposable. The proof of what we did is not.

**muster-readiness** — *success:* 1) The first question any contractor asks is simple. Where do we
actually stand right now? 2) This is a read-only walk of the tenant. It reads configuration and
writes nothing back, and in a moment we will prove that rather than ask you to trust it. 3) While
the evaluation runs, we are filling in how it was done — the session kind, the authorization tier,
and who operated it. 4) It gives us a posture on every control. It does not hand us a score, and I
am not going to invent one. That number comes later, from the Assessment. *degraded:* 5) The
readiness evaluator is not built on this machine, so this beat steps aside honestly rather than
showing you a figure it never computed.

**muster-connect-tenant** — 1) Before we assess anything, we declare how we are assessing it. 2)
Session kind, authorization tier, the operator, the tenant — all stated up front. 3) This looks like
paperwork. It is the thing that makes a readiness result defensible instead of an opinion.

**muster-auto-analysis** — 1) Now we run the real discovery walk against that tenant. 2) This is the
actual command-line evaluation. The app also ships a quick-tour button that loads canned data, and
we never touch it here. 3) What lands on screen came from this tenant, in this run. 4) Every control
it resolves on its own is one fewer question a human has to sit and answer later.

**muster-consent-and-attest** — 1) Nothing gets scanned that you have not authorized. 2) Here is the
part that carries legal weight. A machine can infer where the boundary sits. It cannot attest to it.
3) A named person confirms the boundary, and the confirm button stays disabled until that name is
filled in. 4) Your system security plan carries False Claims Act exposure. This is where that
protection actually lives.

**muster-adaptive-interview** *(no asserted drop — the comparison is described, the delta is
measured)* — 1) This is the interview, and I want you to watch the number of questions. 2) We run it
two ways. One branch has already seen the discovery results; the other starts cold. 3) Then we
compare how many questions each branch still has to ask, and read the difference straight off the
screen. 4) Whatever is left is the set a machine cannot resolve on its own — intent, boundary, who
owns a control.

**muster-generate-sprs-mp** — 1) This is the number your program office asks about. 2) We finish the
interview and export the readiness result the tool produced. 3) We read the SPRS figure out of that
exported file, so the number is the one the tool actually computed. 4) Only fully met controls count
toward it. Partial and unknown deduct in full, because a score you cannot stand behind in an audit
is worse than a low one. 5) Alongside it comes the mission plan — the remediation work, ordered and
ready for Configuration to execute.

**stamper-translate** *(backstage surface)* — *warm:* 1) While we were talking, the plan has been
compiling in the background. 2) Configuration is turning the findings into concrete, ordered tasks
aimed at this specific tenant. 3) What matters is the task list that comes out the other side, and
that is what you are looking at. *live:* 4) Right now Configuration is compiling the mission plan
into executable tasks. 5) Each finding becomes an ordered step written against this tenant.

**stamper-execute** *(backstage surface)* — *warm:* 1) The remediation itself already ran, back
during setup. It takes minutes, and I would rather spend them talking to you than watching a progress
bar. 2) What you are seeing is the report it wrote to disk — tasks attempted, tasks applied, tasks
failed. 3) We judge that file, and we leave the status badge alone. The badge has read Complete over
a report that said partial, so we stopped trusting it. 4) The failures it lists are known simulator
artifacts, and we call them out by name rather than quietly filter them. *live:* 5) Configuration is
applying the plan against the tenant right now, one task at a time. 6) This runs for minutes, so
settle in. The honest version of this beat takes real time.

**ao-registry** — 1) This is the Operations console, and we are about to run a governed command
against the live sim tenant. 2) We pick the command out of the registry and submit it. 3) It writes
its own evidence record as it runs, so there is a trail for every action.

**ao-make-change** — 1) Now we submit the fix through the same governed path. 2) This command
changes the tenant authorization policy — the MFA object we have been circling all along. 3) Same
console, same evidence trail. The change is captured the moment it happens.

**eo-review** — *warm:* 1) The assessment itself runs during setup. It is the slow part, and it is
honest work, so we pay for it off stage. *live walk:* 2) This is the Assessment result, and we are
going to read it the way an assessor does. 3) Start with the whole picture — every control, sorted
into met, not met, partial, and not assessed. 4) Now we open one family and filter it down to what
came back not met. 5) This is the SPRS score the assessment produced, with the deductions that built
it. *self-heal:* 6) The assessment is not on screen yet, so we are going to run it live right now
rather than fake a result.

**eo-show-change-captured** — 1) We remediated a moment ago. Now we assess the same tenant again, so
the after-picture is freshly measured. 2) We captured the before-state earlier and wrote it to disk,
so this comparison rests on two recorded snapshots. 3) Then we walk to the exact control and read
what moved — the status, and the SPRS score, treated as two separate facts. 4) If the control did
not move, we say so plainly. A demo that narrates a flip that never happened is the one thing this
harness exists to prevent.

## Testing Strategy
- `npx tsc --noEmit` clean; `npm test` clean.
- New unit test: a fake `TheatreSurface` records `evaluate` payloads; assert `ao-registry` emits its
  captions in order and that `captionScript` produced them (proves op→band wiring).
- New pure test: every `DemoOpId` key in `CAPTIONS` is present and non-empty.
- `demo:show --check` on an existing deck exits 0 (captions never touch load/registration).
- **Gate: `demo:captions-lint`** dumps `ALL_CAPTIONS` and runs `voice_lint.py`; ship requires
  **exit 0** (zero [tell]). Re-run after any caption edit.

## Sequencing / Collision Note
Coding agent **afecf7f8** is editing `slide-render.ts` + `app-pane.ts` (wider frame + dedup). This
feature centers on `theatrical-page.ts`, `op-registry.ts`, the 14 ops, and new `captions.ts`, and
**deliberately does not modify `app-pane.ts`** (it reuses the existing exported `hudSurfaceOf`). It
imports `escapeHtml` from `slide-render.ts` (read-only, unchanged). **Sequence this build to start
after afecf7f8 finishes** to avoid any shared-import churn; if a merge lands first, re-read
`app-pane.ts` to confirm `hudSurfaceOf` still exports as used.

## Out of Scope
- No new deck columns / xlsx primitives — captions are TESTER code, not deck cells (REQ 4a; confirmed:
  no step-primitives in decks).
- No run-value interpolation into captions (numbers stay in the status HUD/log).
- No changes to the bottom status HUD, the tickers, the mirror, or `--pane-window` behavior.
- No edits to `app-pane.ts`, `slide-render.ts`, or root `PLAN.md`.

## Acceptance Criteria
- [ ] `ctx.caption()` seam on `OpDriveContext`, wired in `op-registry.run()`, best-effort, optional.
- [ ] Top caption band (`__mirror_caption`) renders via CSSOM/`textContent`/fade, distinct from the
      bottom HUD, not covering the app.
- [ ] All 14 acts emit ordered captions at real steps; Stamper ops render on the backstage surface.
- [ ] Navigation timing rule honored (goto → after; click/fill → before).
- [ ] Captions honest & outward-named; adaptive-interview asserts no drop; simstack says report-only;
      stamper-execute judges the report; no fixture-button narration; no invented score.
- [ ] `tsc` + `npm test` + `demo:show --check` clean; caption emit/non-empty tests pass.
- [ ] `demo:captions-lint` exits 0 (voice lint clean).
