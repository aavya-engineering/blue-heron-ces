# Plan: REQ-TESTER-DEMO-RICHNESS — demo:show contract extensions

**Date:** 2026-09-06 · **Branch:** `gp-demo-4` (confirmed `git rev-parse --abbrev-ref HEAD`)
**Status:** READY FOR IMPLEMENTATION (rev 2 — closes GAP_ANALYSIS.md P0-1 and P1-1…P1-13)
**Requirement:** `docs/requirements/REQ-TESTER-DEMO-RICHNESS.md` (filed by ces-strategy, founder-approved 2026-09-06)
**Reviewed by:** `docs/context/GAP_ANALYSIS.md` (2026-09-06) · **Related:** `docs/demo/DEMO-ACTS-CONCEPT.md`
**Root `PLAN.md` is FROZEN — this file is the work order.**

## Objective

Execute the six asks in REQ-TESTER-DEMO-RICHNESS so ces-strategy can author rich, multi-demo
decks against a stable, published `demo:show` contract: an `html` slide body, the remaining
demo-arc ops, a schema'd run report, per-op parameters with a published catalog, a deck-supplied
theme, and formally reserved presenter columns.

## Context Summary

- **From THREAD_HANDOFF.md (BINDING):** V4 design is LOCKED (`docs/demo/design/mockups/v4-final-hybrid.html`);
  pain-first narrative doctrine; stage naming Muster = **Readiness Evaluation (RE)**, Stamper =
  **Configuration (Config)**, AO = **Operations (Ops)**, EO = **Assessment**; **RE and Config get
  NO live product demo on stage — the hub-and-spoke drawing instead**; Ops and Assessment are LIVE.
- **From IMPLEMENTATION_LOG.md (GP-DEMO-4 `eo-review`):** the newest op pattern — op id declared in
  `deck-model.ts` (declaration layer stays runtime-free so `--check` needs no sibling), conditional
  arming via `armingFor`, `warm` pays the expensive half off-stage / `live` walks the result,
  self-heal instead of lying, narrated numbers come from the sibling's API not the DOM, headless
  end-to-end proof.
- **From GAP_ANALYSIS.md:** the review's central finding (P0-1) is that **`warm` is not "off
  stage"** — warm ops are dispatched fire-and-forget onto the *visible* app pane and run
  concurrently with slides 1..N. Slice 2b's **backstage session** is this plan's answer; see
  "The backstage decision" below.
- **Constraints:** Windows-only; every Stamper spawn is Windows PowerShell 5.1 (`powershell.exe`,
  never `pwsh`); siblings consumed read-only over existing CLI/HTTP/GUI surfaces — **never write to
  a sibling project root**; ports 4500 (slides) / 4390 (stacksim) / 5173 (ces-planner wizard, not
  used here) / 3000 (stamper gui) / 3001 (ao gui) / 4002 (eo); gates `npx tsc --noEmit` +
  `npm test` clean; small independently-green slices; no pushes without founder say-so.
- **Deck ownership:** the deck schema stays tester-owned. `demos/ridgeline-run.xlsx` is
  strategy's product — **never regenerate or edit it**, only `--check` it.

## The backstage decision (resolves GAP_ANALYSIS P0-1) — needs founder awareness, not a redesign

**The problem.** `show-run.ts` L288-307 awaits only `ops.prepare()` (arming). Warm ops are then
dispatched through `startOpFor(i)`, which is `void`-fire-and-forget (L275-285). The deck advances
to slide 1 immediately and warm ops keep running, serialized on the single pane queue
(`op-registry.ts` L142-152), **in the audience-visible app pane** (`app-pane.ts` L43: an operator
run is "headed by definition"). With `assessTimeoutMs: 900_000` and `executeTimeoutMs: 1_500_000`
(`stamper-ui-driver.ts` L136-141), a warm Stamper op would walk the **Config GUI on screen for
minutes** — the exact live Config demo THREAD_HANDOFF forbids.

**The decided mechanism: a BACKSTAGE session.** Doctrine-sensitive ops drive a **second,
headless, never-displayed** browser session, created by the ops runner during `prepare()` and torn
down with it. The visible pane is touched by these ops **only** on their `live` slide, and only to
render the outcome readout.

Why this and not the alternatives:

| Option | Verdict |
|---|---|
| Blank/park the visible pane during Config warm work | Fragile — the pane is one page; parking it fights the same queue and any glitch shows the GUI. |
| Await all warm ops before slide 1 | Changes pacing for every deck and puts a ~12-minute dead stare before slide 1. Rejected. |
| Move Config work off the browser entirely (Stamper CLI) | A different product surface with its own failure modes; `demo:show` has no Stamper CLI path today. Out of scope. |
| **Backstage headless session** | Chosen. Uses the existing `openAppPane({ headless: true })` seam; no new mechanism; nothing to display. |

**It does not violate finding 6** ("ops must never launch their own browser"): the backstage
session is created by the **runner** during arming — exactly as the AO/EO servers are — and handed
to the op through `OpDriveContext`. An op still never launches anything.

**Three things it buys beyond doctrine compliance:**
1. `eo-review`'s pane-state rule stops being fragile — a Stamper op can no longer navigate the
   visible pane away from a hydrated EO assessment.
2. `execute-only` becomes *honest and reliable* (see P1-10 handling in Slice 2c): the backstage
   page is the same page that translated, and nothing else ever touches it.
3. The visible pane shows only what the deck's narration promises.

**Founder-visibility items** (surface these; do not decide them inside a slice):
- **The `--check` prep-budget warning** makes a long warm chain visible before stage, but a
  presenter still commits to that wall time. Slice 2's budget line is the artifact to review.
- **"Surface score availability" is read as "state plainly that no readiness score exists."**
  Honest and evidence-backed (Slice 2a finding 3), but it changes what a deck beat may claim.
- **Deck themes can repaint the LOCKED V4 palette** (`navy`, `gold`, the text ramp). REQ 4b is
  founder-approved and postdates the 2026-09-05 lock; confirm token overrides are *inside* the
  lock rather than an exception to it.
- **Full-bleed `html` slides** (Slice 1, P1-13 handling) let a deck suppress V4 chrome on a slide
  authored with no narration fields. Confirm that is the intent of REQ ask 1.

## Standing rules for every slice

Run these gates at the end of **every** slice. A slice is not done until all pass:

```
cd C:\Users\mhsut\DevProjects\ces\ces-tester
npx tsc --noEmit
npm test
npm run build
node bin/ces-tester.mjs demo:show --check demos/ces-overview.xlsx
node bin/ces-tester.mjs demo:show --check demos/ces-pain-story.xlsx
node bin/ces-tester.mjs demo:show --check demos/ridgeline-run.xlsx
```

All three `--check` runs must exit **0**. Commit each slice on its own, **by explicit file list**.

**Hygiene (mandatory, every slice):**
- **NEVER** `git add -A` or `git add .` — name every path.
- **NEVER** stage or commit `session-ces-tester-*.md` (six are modified/untracked and will be
  swept up by a bulk add).
- Do not write outside `C:\Users\mhsut\DevProjects\ces\ces-tester`. Reading `../ces-muster`,
  `../ces-stamper`, `../ces-eo`, `../ces-ao`, `../tenant-stacksim` is fine.
- Append a section per slice to `docs/context/IMPLEMENTATION_LOG.md`.
- **Adding a canonical deck column is a SIX-site change, never one line** (GAP P2). Every slice
  that adds one must touch all six: `CANONICAL_COLUMNS` (which feeds `type CanonicalColumn`,
  `xlsx-loader.ts` L44) → `COLUMN_LABEL` (L47) → `HEADER_ALIASES` (L67) → `NormalizedRow` (L138) →
  `deck-validate.ts` L302 `coercedRows` key list → `schemas/demo-deck.schema.json`
  (`additionalProperties: false`).
- **New interface fields are OPTIONAL unless a fixture sweep is listed.** A non-optional field
  breaks every existing construction site in `tests/`; if a slice truly needs one, its File
  Inventory must name the fixture files it updates.

---

## Step 0 — commit the finished, uncommitted `eo-review` slice (DO THIS FIRST)

The working tree already contains a **finished but uncommitted** slice (GP-DEMO-4 `eo-review`).
No new work may start on top of it. Verify green, then commit it by explicit file list.

```
cd C:\Users\mhsut\DevProjects\ces\ces-tester
npx tsc --noEmit
npm test
npm run build
node bin/ces-tester.mjs demo:show --check demos/ces-overview.xlsx
node bin/ces-tester.mjs demo:show --check demos/ces-pain-story.xlsx
```

Expected: tsc clean, **488/488 tests pass across 43 files**, both `--check` runs exit 0
(8 slides/11 rows and 12 slides/14 rows respectively). If anything is red, fix it before
committing — do not commit a red slice.

Then commit exactly these paths (and nothing else). **One `git add` per line — the shells here are
PowerShell 5.1 and Git Bash, and cmd.exe's `^` continuation works in neither** (GAP P2):

```
git add src/demo/show/arm-eo.ts
git add src/demo/show/ops/eo-review-op.ts
git add src/demo/show/arm-sim.ts
git add src/demo/show/deck-model.ts
git add src/demo/show/op-registry.ts
git add src/demo/show/show-run.ts
git add tests/demo-show-eo-op.test.ts
git add tests/demo-show-op-registry.test.ts
git add docs/context/IMPLEMENTATION_LOG.md
git add docs/context/THREAD_HANDOFF.md
git status --short          # confirm NO session-ces-tester-*.md is staged
git commit -m "GP-DEMO-4: the eo-review live op (Assessment on stage) - warm assesses, live proves"
```

### Step 0b — commit the strategy drop separately

`demos/ridgeline-run.xlsx`, `demos/slides/*.png` and the REQ are ces-strategy's founder-approved
hand-off, not part of the `eo-review` slice. Separate commit so provenance stays separable:

```
git add demos/ridgeline-run.xlsx
git add demos/slides
git add docs/requirements/REQ-TESTER-DEMO-RICHNESS.md
git commit -m "demos: accept ces-strategy deck #1 (ridgeline-run) + REQ-TESTER-DEMO-RICHNESS filing"
node bin/ces-tester.mjs demo:show --check demos/ridgeline-run.xlsx   # must exit 0
```

### Step 0c — commit the planning artifacts (closes GAP P1-1)

This plan, the gap analysis and the acts concept are themselves untracked/modified and would keep
Step 0's Accept gate permanently red. They are the third commit, not a leak:

```
git add docs/demo/PLAN-DEMO-RICHNESS.md
git add docs/demo/DEMO-ACTS-CONCEPT.md
git add docs/context/GAP_ANALYSIS.md
git commit -m "docs: PLAN-DEMO-RICHNESS rev 2 (gap-analysis P0/P1 closed) + demo-acts concept"
```

**Accept (Step 0):** after 0, 0b and 0c, `git status --short` shows **only**
`session-ces-tester-*.md` entries. All three decks `--check` exit 0.

---

## Slice 1 — REQ ask 1: the `html` slide-body column *(highest priority)*

A self-contained HTML file, path-relative to `demos/`, rendered **in place of the auto-rendered
body**. Same path-escape rejection and same load-time-error-on-missing as `image`.

### Design decisions

- **`<iframe>`, not inlined HTML.** Inlining strategy's CSS into the page would bleed into the
  LOCKED V4 sheet (`SHOW_CSS`, module-private — do not import it). The iframe is
  `sandbox="allow-scripts"` **without** `allow-same-origin` — CSS animation and inline JS still
  run, but the document is opaque-origin and cannot reach the slides server's state or `/nav`.
  Verified: no CSP and no `X-Frame-Options` is set anywhere in `src/demo/show/`, so the frame is
  not blocked.
- **Served over the existing `/asset/<id>` route**, by id, never by path. Only `ASSET_TYPES` needs
  a `.html` entry.
- **Two render shapes, selected by what the author wrote — no new column** (closes GAP P1-13):
  - **Boxed** (default): the slide has narration fields, so the V4 head (eyebrow / number / chips /
    `<h1>`) is kept and the iframe fills the body region beside or instead of the cards.
  - **Full-bleed**: the slide has an `html` cell and **no `feature` title and no
    function/benefit/differentiator cards**. The head is suppressed and the iframe fills the whole
    stage. This is the `v2-keynote-dark.html` direction REQ ask 1 names — a branded full-slide
    graphic — reachable purely through the existing column contract.
  - **`runDeckCheck` must be relaxed accordingly**: `show-command.ts` L167 currently fails a slide
    whose render lacks `<h1>`. Widen to *"lacks `<h1>` **and** lacks `class="slide-html"`"*, and
    update the failure text to "rendered no title and no html body".
- **Precedence:** `html` wins over `image`; the loader emits a WARNING and drops that slide's
  image so the renderer has exactly one truth.
- **Offline lint (strengthened, closes GAP P1-7).** Assets are served **by id from a map, never by
  path** (`slides-server.ts` L84, L163-180), so a *relative* sub-asset (`<img src="logo.png">`, a
  local font, an external stylesheet) 404s on stage while `--check` exits 0 — a worse failure than
  a CDN URL. So the lint flags **every `src=` / `href=` whose value is not `data:`, `#`, or
  `about:`** — absolute and relative alike — as a WARNING naming the slide, the file and up to
  five offending references. Message: *"self-contained decks must inline every asset as a `data:`
  URI; `/asset/<id>` serves by id, so relative paths cannot resolve."*

### Implementation steps

1. **`src/demo/show/deck-model.ts`** — add `readonly html?: SlideImage;` to `SlideOp` (L92-100;
   L91 is the doc comment). Reuse the `SlideImage` shape verbatim (`id` / `rawValue` / `absPath`) —
   it is already the deck's id-addressable asset record and `slides-server.ts` keys its asset map
   off it. Update the doc comment: "`html` wins over `image`; both is a warning, never an error."
2. **`src/demo/show/xlsx-loader.ts`** — the **six-site** column addition for `html`. Aliases:
   `html`, `htmlbody`, `slidehtml`, `htmlfile`, `page`.
3. **`src/demo/show/deck-validate.ts`** —
   - Add `readonly readText?: (absPath: string) => string;` to `ValidateDeckOptions` (L77-82),
     defaulting to `fs.readFileSync(p, 'utf8')` (test seam, mirrors `fileExists`).
   - In Pass 1 (beside the `image` block, L269-284) resolve `html` with the **identical**
     path-fence + `fileExists` logic; messages use `COLUMN_LABEL.html`.
   - Add `html` to `CheckedRow` (L185-194) and to the `coercedRows` key list (L302).
   - In Pass 3 (`agreeOn` calls L339-343) resolve `html`; when present, mint an asset id via
     `assetIdFor` and push to `assets` exactly like an image.
   - **Precedence:** both resolved → warn
     `slide N: both "html" (<x>) and "image" (<y>) are set — html wins; the image is not rendered`
     and leave `op.images` **empty** for that slide.
   - **Offline lint:** `readText(htmlAbs)`, regex
     `/(?:src|href)\s*=\s*["']([^"']+)["']/gi`; warn for every captured value not matching
     `/^(data:|#|about:)/i`.
4. **`schemas/demo-deck.schema.json`** — add `"html": { "$ref": "#/definitions/text" }`.
5. **`src/demo/show/slide-render.ts`** — in `renderSlideHtml` (L276-338), before the `images`
   block (L306): when `slide.op.html` is set the body becomes
   `<div class="body body-html"><iframe class="slide-html" src="/asset/<encodeURIComponent(id)>" sandbox="allow-scripts" title="<escaped rawValue>" loading="eager"></iframe></div>`,
   cards and images skipped. When the slide **also** has no `feature` and no
   function/benefit/differentiator values, return the iframe wrapper alone (full-bleed) with
   `class="body body-html body-full-bleed"` and no head. Add to `SHOW_CSS`:
   `.body-html{padding:0;display:block;}`,
   `.slide-html{width:100%;height:100%;border:0;background:transparent;display:block;}`,
   `.body-full-bleed{position:absolute;inset:0;}`.
6. **`src/demo/show/slides-server.ts`** — add `'.html'` and `'.htm'` →
   `'text/html; charset=utf-8'` to `ASSET_TYPES` (L40-48).
7. **`src/cli/show-command.ts`** — relax the `runDeckCheck` title assertion (L167) per the
   full-bleed rule above.
8. **`demos/README.md`** — new `html` row in the column-contract table; alias line; an "HTML slide
   bodies" section covering self-contained-only (every asset a `data:` URI), the sandboxed iframe,
   boxed vs full-bleed, `html` beats `image` with a warning, missing file is a load-time error.
   **Also fix the stale `op` row** (L42, "Currently: `ao-registry`") to list `ao-registry, eo-review`.

### File Inventory

| File | Action | Target |
|---|---|---|
| `src/demo/show/deck-model.ts` | MODIFY | `SlideOp` L92-100 |
| `src/demo/show/xlsx-loader.ts` | MODIFY | six-site column addition (L29-42, L47-60, L67-125, L138-154) |
| `src/demo/show/deck-validate.ts` | MODIFY | `ValidateDeckOptions` L77-82, Pass 1 L200-308, Pass 3 L337-381 |
| `schemas/demo-deck.schema.json` | MODIFY | `normalizedRow.properties` |
| `src/demo/show/slide-render.ts` | MODIFY | `renderSlideHtml` L276-338, `SHOW_CSS` L386+ |
| `src/demo/show/slides-server.ts` | MODIFY | `ASSET_TYPES` L40-48 |
| `src/cli/show-command.ts` | MODIFY | `runDeckCheck` title assertion L167 |
| `demos/README.md` | MODIFY | column table, aliases, new section, stale `op` row |
| `tests/demo-show-xlsx-loader.test.ts` | MODIFY | + column/alias, missing-file error, escape rejection, both-given warning, offline lint (absolute **and** relative) |
| `tests/demo-show-render.test.ts` | MODIFY | + iframe with sandbox, cards suppressed, `<h1>` present when boxed, head suppressed when full-bleed |
| `tests/demo-show-command.test.ts` | MODIFY | + `runDeckCheck` passes a full-bleed slide with no `<h1>` |
| `tests/demo-show-server.test.ts` | MODIFY | + `/asset/<id>` serves `text/html` |
| `docs/context/IMPLEMENTATION_LOG.md` | MODIFY | append slice section |

### Accept (mirrors the REQ)

- [ ] A slide with `html: slides/foo.html` renders that document (iframe present, cards absent).
- [ ] A missing html file is a **load-time error** (exit 2), parity with `image`.
- [ ] A path escaping `demos/` is rejected with the same message shape as `image`.
- [ ] `--check` validates existence; all three decks still exit 0.
- [ ] `html` + `image` on one slide → the html renders, the image does not, one warning printed.
- [ ] A narration-free html slide renders **full-bleed** and still passes `runDeckCheck`.
- [ ] A deck html file carrying a relative or absolute external reference produces a `--check`
      warning naming it.

---

## Slice 2 — REQ ask 2: register the remaining demo-arc op ids

Three new ids: `muster-readiness`, `stamper-translate`, `stamper-execute`. Split into four
independently-green sub-slices (**2.0 → 2a → 2b → 2c**), each with its own commit and gates.

### Findings that force the design (verified in this repo, 2026-09-06)

1. **`ces-planner` ≠ `ces-muster`.** `src/muster-driver/*` (Playwright, port 5173 Vite) drives
   **ces-planner**'s wizard. The real **ces-muster** readiness executor is a headless CLI:
   `node <musterRoot>/muster-api/dist/cli/bin.js discovery --sim --slug <slug> --out <path>`.
   `GuiServerKind` is a closed `'stamper' | 'ao'` union — **there is no ces-muster GUI starter and
   no ces-muster selectors anywhere in ces-tester.** `muster-readiness` uses the CLI: no browser,
   no port, nothing to arm beyond the stacksim serve.
2. **THREAD_HANDOFF is BINDING: RE and Config get NO live product demo on stage.** None of these
   three ops walks a Muster or Stamper interface in front of the audience. They do the real work
   on the **backstage session** (see "The backstage decision") and, on the `live` slide, render an
   **outcome readout** into the visible pane using the existing `htmlDataUrl()` mechanism
   (`op-registry.ts` L122-124).
3. **No Muster readiness SCORE is produced or read by ces-tester today.** `mu discovery` yields
   `observations[].derived_posture`; Muster's own SPRS machinery
   (`muster-api/src/services/sprsCalc.ts`, `mu sprs`) is never invoked here, and every `sprsScore`
   in `src/` is **EO's** detail score. The REQ asks to *"surface score availability"* — the op
   surfaces exactly that: **no readiness score is available from DISCOVERY-1**, and says so.
4. **DISCOVERY-1 is presence-based** (`e2e-run.ts` L1403-1406,
   `REQ-MUSTER-DISCOVERY-STATE-BLINDNESS`): `IA.L2-3.5.3` reads `met` before remediation because
   the policy exists but is report-only. The op must **never** narrate "finds the MFA gap".
5. **The posture domain has FOUR values, not two** (closes GAP P1-12).
   `../ces-muster/public/schemas/readiness-result.schema.json` L92-95 permits
   `met`, `not_met`, `partial`, `unknown`. ces-tester's two-value expectation
   (`e2e-configs.ts` L28, enforced `eval-run.ts` L89) is a *pinned expectation*, not the wire
   contract, and the retained run happens to contain only two. **The readout tallies all four**,
   plus an `other` bucket for any value the schema gains later. An on-stage tally that silently
   drops postures is precisely the dishonesty these guards exist to prevent.
6. **`mu discovery` can exit `3221226505`** (`0xC0000409`, Windows libuv teardown) *after* writing
   a complete, Ajv-valid artifact. Judge the artifact, not the exit code (`eval-run.ts` L297,
   `e2e-run.ts` L1435). `WINDOWS_LIBUV_TEARDOWN_EXIT` is **not exported** (`e2e-run.ts` L644) and
   `eval-run.ts` already restates the bare literal — Slice 2a **exports it** and switches both call
   sites, rather than making a third copy.
7. **Ops must never launch their own browser.** Compose the exported flow
   (`runStamperUiFlow(page, ctx)`), never the `driveStamperUi` / `create*Driver` wrappers. The
   backstage session is created by the **runner**, not by an op — the rule is intact.
8. **Importing `e2e-run.ts` into an op is SAFE** (GAP, "Verified"). Playwright is already
   statically in `--check`'s import graph (`show-command.ts` L32 → `show-run.ts` L39 →
   `ui-page.ts` L25) and no module in that graph has top-level side effects. The runtime-free rule
   is scoped to the **declaration layer** (`deck-model.ts` L33-38), which stays untouched.
9. **Two Stamper traps, both must survive into the ops:**
   - **Sticky dry-run** (`REQ-STAMPER-GUI-EXEC-TARGET-STICKY-DRYRUN`) — the GUI forces
     `#execTargetSelect` to `dryrun` and never restores it; a first attempt reports "Complete" in
     0.7 s with **zero mutations**. `runStamperUiFlow` L335-345 already sets `tenant` and throws if
     it did not stick. Do not weaken that.
   - **`#cardStatus4` is narrative only** — M0 measured badge `Complete` while the on-disk report
     read `partial` (80/110). **Judge `result.report`, never the badge.**
10. **`seedPlanVariables` must run BEFORE translate** (`stamper-plan-variables.ts` L373) or ~23
    tasks fail on variables the manifest cannot supply, and the seed is consumed **at translate
    time** — it cannot be compensated later. `runStamperUiFlow` step 5 already does it.
11. **Two false-fail id spaces.** The GUI leg is judged against
    `GUI_LEG_KNOWN_FALSE_FAILS` (`e2e-run.ts` L811-856, exported, typed
    `readonly string[] | undefined`), **not** `partitionFailures(...)` from `known-false-fails.ts`
    (the CLI-registry judge; `e2e-run.ts` L1173-1178 says so). Never pin a raw `step_task_*` id —
    its suffix regenerates every translation.
12. **Measured durations** (`stamper-ui-driver.ts` `DEFAULTS` L136-141): connect ~3 s
    (`connectTimeoutMs` 180 s), **assess ~5 min**, translate ~0.1 s for 110 tasks,
    **execute ~7 min**. Both stamper ops are `warm`-first.

### Sub-slice 2.0 — groundwork: fixture, sibling-root flags, and the artifact seam

`demo:show` never runs the planner wizard, so it has no mission plan / manifest — and the Stamper
GUI cannot be configured without one. Fix with a checked-in, tester-owned fixture.

1. **The manifest question is already answered** (closes GAP P2): `#configManifestPath` receives
   the **tenant** manifest (`drive-muster.ts` L215-216 → `e2e-run.ts` L1107, L1157-1158 →
   `stamper-ui-driver.ts` L293-294, selector defined L66). The infrastructure manifest is produced
   but **never consumed anywhere in ces-tester** — zero hits for `configInfraManifestPath`. Copy
   the tenant one; do not copy the infrastructure one.
2. Copy from **`runs/e2e/m7-run5/artifacts/plans/`** (note: the `artifacts/plans/` subdirectory,
   not the run root) to the tracked destination:
   - `assets/demo-plan/demo-dib-small/mission-plan.json` ← `manual-mission-plan-2026-08-30T00-51-59-646Z.json`
   - `assets/demo-plan/demo-dib-small/manifest.json` ← `tenant-manifest-2026-08-30T00-51-59-654Z.json`
   - `assets/demo-plan/README.md` — provenance: source run, date, tenant slug, the commit that
     produced it, and the rule *"regenerate by re-running `demo:e2e` and re-copying; never
     hand-edit."*
   **`runs/` is git-ignored** (`.gitignore` L3) and `git ls-files runs` returns zero — the source
   exists on this machine only, which is exactly why the tracked `assets/` copy is the deliverable.
   Scan both files for banned identifiers before committing.
3. **`src/demo/show/show-run.ts`** — `ShowRunOptions` gains `readonly musterRoot?: string;`
   (`eoRoot` L60 / `stamperRoot` L62 already exist). **`ShowOpContext` gains
   `readonly artifact?: (absPath: string) => void;`** (L66-72) — declared HERE, one slice before
   the ops that call it, so 2a/2b/2c compile independently (closes GAP P1-3). It is a no-op until
   Slice 3 supplies a recorder.
4. **`src/cli/show-command.ts`** — add `--muster-root`, `--stamper-root`, `--eo-root` via the
   existing `root(flag, name)` helper (L100-101), wire them into the returned object (L103-116),
   **and add all three to `FLAGS_WITH_VALUES` (L120-127)** — a value-taking flag missing from that
   set gets mistaken for the deck path. Closes GP-DEMO-4 open item E2.
5. **`src/cli/index.ts`** — extend the `demo:show` usage string (L38-39).

**Accept 2.0:** `parseShowArgs` test covers all three new flags including the "never mistakes a
flag value for the deck" case; fixture files exist with provenance; `ShowOpContext.artifact?`
compiles with no consumer; three decks `--check` exit 0.

### Sub-slice 2a — `muster-readiness` (RE, evaluated for real, shown as a readout)

**`src/demo/show/ops/muster-readiness-op.ts`** (NEW). No browser, no server, no new port — so it
needs no backstage session.

- Spawn: `node <musterRoot>/muster-api/dist/cli/bin.js discovery --sim --slug <ctx.armed.slug>
  --out <ctx.armed.runDir>/muster-readiness.json`, `cwd = musterRoot`,
  `env = { ...process.env, STAMPER_REGISTRY_ROOT: <stamperRoot>/src/registry }`.
  Restated here because `runDiscoveryGate` is **private** in `e2e-run.ts` (L1408) and
  `runEvalConfig` bundles seed + serve + stop and cannot be reused inside an already-armed show.
- **Export `WINDOWS_LIBUV_TEARDOWN_EXIT` from `e2e-run.ts` (L644)** and import it here **and** in
  `eval-run.ts` L297 (replacing that bare literal). One constant, three call sites, no third copy.
- Accept exit `0` or `WINDOWS_LIBUV_TEARDOWN_EXIT`; then judge the artifact — parse it and require
  an `observations` array, else fail loudly.
- **Self-gating**: if `bin.js` is missing, log it and render an "evaluation unavailable" readout —
  never throw mid-demo (the `eval-run.ts` L220-229 rule). Note in the catalog and in
  `demos/README.md` that `../ces-muster/muster-api/dist/` is an **operator prerequisite**
  (`npm run build` in ces-muster, by the operator — ces-tester never builds a sibling); a `dist/`
  clean silently degrades the RE beat to "unavailable".
- **Read-only proof**: ledger create+mutate counts via `queryLedger` (exported,
  `src/stacksim-client/http.ts` L20) before and after; delta must be **0**. Log it.
  (`ledgerWriteCount` in `eval-run.ts` L157 is private — restate the two-query pattern.)
- **Readout page** into the visible pane via `ctx.pane.goto(htmlDataUrl(html))`: control count, a
  tally of **all four** postures (`met` / `not_met` / `partial` / `unknown`) plus an `other`
  bucket, the artifact path, the read-only delta, and an explicit line —
  *"Readiness score: not produced by DISCOVERY-1 (presence-based evaluation; per-control posture
  only)."* Style from the same navy palette `stagedReplayHtml` uses (L98-113).
- `ctx.artifact?.(<abs artifact path>)` for the readiness JSON.
- **Header comment must carry findings 2, 3, 4 and 5 verbatim in spirit** — the next agent must not
  "improve" this into a live Muster UI drive, a narrated score, or a two-value tally.
- Modes: `warm` (evaluate during prep) and `live` (evaluate now — it is seconds, so `live` is
  legitimate here). `staged` replays as usual.

**Wiring:** `deck-model.ts` L40-46 (union + array); `op-registry.ts` L68-71
(`OP_IMPLEMENTATIONS`), L80-85 (`armingFor` — **no new surface**), L37-47 + L174-180
(`ArmedEnvironment` gains `musterRoot` / `stamperRoot`, sourced from `ShowRunOptions` with the
VAULT.md sibling defaults).

**Accept 2a:** `muster-readiness` loads in `--check`; unit tests drive the op with an injected
spawn seam covering exit 0, `WINDOWS_LIBUV_TEARDOWN_EXIT`-with-good-artifact, missing `bin.js`, a
non-zero ledger delta, and **a fixture containing all four postures**; the readout names the
score-availability line.

### Sub-slice 2b — backstage session + Stamper GUI arming + `stamper-translate`

1. **`src/demo/show/app-pane.ts`** — add
   `export const BACKSTAGE_GEOMETRY: WindowGeometry = { width: 1280, height: 900, x: 0, y: 0 };`
   with a comment: *never displayed; the geometry only sizes the headless viewport so the Stamper
   GUI lays out as it does on stage.*
2. **`src/demo/show/op-registry.ts`** — the backstage session (P0-1's mechanism):
   - `OpDriveContext` gains `readonly backstage?: AppPane;`.
   - `MakeShowOpsDeps` gains `openBackstage?: () => Promise<AppPane>` (test seam; default
     `() => openAppPane({ geometry: BACKSTAGE_GEOMETRY, headless: true })`).
   - In `prepare()` (L160-166), **after** arming, create the backstage session **only when**
     `armingFor(drivenOpIds).withStamperGui` is true, and log
     `prep: backstage session up (headless, never displayed) — Config work runs here, per THREAD_HANDOFF`.
   - `dispose()` (L196-202) closes it **before** `armed.stop()`.
   - Both `run()` and the backstage work stay on the **existing single queue** (L142-152 — note
     that queue is the *general* pane-serialization queue used by every op, not a warm-specific
     one; warm scheduling lives in `show-run.ts` L301-306). One queue preserves
     translate-before-execute ordering and the existing "one thing at a time" invariant; the wall
     -time consequence is quantified by the prep budget below.
   - Copy `stamperBaseUrl` from `ArmedSim` into `ArmedEnvironment` (L37-47 and the env literal
     L174-180) — the op reads `ctx.armed.stamperBaseUrl`, and omitting the copy is an immediate
     compile error (GAP P2).
3. **`src/demo/stamper-ui-driver.ts`** — `StamperUiDriveContext` (L78-96) gains
   `readonly phase?: 'full' | 'through-translate' | 'execute-only';` defaulting to `'full'`.
   In `runStamperUiFlow` (L261-375): `'through-translate'` returns after step 6 (translate);
   `'execute-only'` skips steps 1-6 and starts at step 7 **but only under the precondition guard in
   2c**. `StamperUiDriveResult` gains `readonly phase: 'full'|'through-translate'|'execute-only';`
   and — closing GAP P1-10's honesty point — the `connected` / `assessed` / `translated` booleans
   are **observed-in-this-call**: `execute-only` returns them `false` with a comment, rather than
   the current hardcoded `true` literal (L366-369) asserting three beats it never performed.
   `executeBadge` / `reportPath` / `report` are already optional, so the `through-translate` early
   return is type-clean. **Default behaviour is byte-identical**, so `demo:e2e` is untouched —
   assert that in `tests/demo-stamper-ui-driver.test.ts`.
4. **`src/demo/show/arm-sim.ts`** — `ArmSimOptions` (L84-96) gains `withStamperGui?` /
   `stamperGuiPort?`; port **3000** joins the contested-port probe (L126-137) **only when
   `withStamperGui`**; after the AO GUI block (L195-205) start
   `startStamperGui({ stamperRoot, env, port, logPath: path.join(runDir,'stamper-gui.log') })`
   where
   ```
   env = buildGuiChildEnv({ simLaunchEnv, shimRoot, tenantRoot, pipelineRoot, storageRoot })
   ```
   — **`storageRoot` is mandatory and must be run-scoped** (closes GAP P1-11):
   `path.join(runDir, 'stamper-storage')`. Production Beat 3 passes it (`e2e-run.ts` L1137-1143);
   `GuiChildEnvOptions` (`gui-servers.ts` L70-82) makes it optional, so omitting it is **not** a
   compile error and no test would catch it — an armed Stamper GUI without a run-scoped
   `STORAGE_ROOT` writes execution reports to the default root, silently contaminating the very
   artifact Slice 2c judges.
   **Reuse the SAME `pipelineRoot` the AO GUI gets** (Stamper's plan-data lives at
   `{pipelineRoot}/Stamper/plan-data/{slug}`) — do **not** give it EO's `eo-pipeline` (one scope
   pointer per database, `REQ-EO-ASSESSMENT-SCOPE-POINTER-CRASH`).
   `ArmedSim` (L73-82) gains `stamperBaseUrl?`; `stop()` (L144-150) kills EO → **stamper GUI** →
   AO GUI → serve.
   **`armSim` gains an optional `ArmSimDeps` parameter** — seams for `probePort`, `startServe`,
   `resetDemoDibSmallTenant`, `startAoGui`, `startStamperGui`, `startShowEoServer` (the house
   deps-object pattern, as `MakeShowOpsDeps` and `ShowRunDeps` already use). Today `armSim` imports
   all of them directly (L37-52), so `tests/demo-show-arm-sim.test.ts` is **unwritable without
   this**; design the seam here rather than improvising it mid-slice. Every field optional,
   defaulting to the real import — existing callers are unchanged.
   **Never use `stamper gui --stacksim`** — it calls `enableStacksimMode`, which clobbers the shim
   (`gui-servers.ts` header).
5. **`src/demo/show/ops/stamper-translate-op.ts`** (NEW) — drives **`ctx.backstage`**, never
   `ctx.pane`. Throws a specific message if `backstage` or `armed.stamperBaseUrl` is absent
   (the `ao-registry` template rule). After `ctx.backstage.goto(baseUrl)`, composes
   `runStamperUiFlow(ctx.backstage.page, { baseUrl, slug, missionPlanPath, manifestPath,
   pipelineRoot, phase: 'through-translate', screenshotDir: ctx.armed.runDir, watch: HEADLESS_MODE })`.
   Plan paths default to `assets/demo-plan/demo-dib-small/*`; **resolve them ABSOLUTE first** —
   `path.resolve(ctx.options.testerRoot, 'assets/demo-plan/…')` — because the Stamper GUI child
   runs with `cwd = stamperRoot`, so a tester-relative string typed into `#configMissionPlanPath`
   resolves against the wrong root. Slice 4a turns both into params.
   `live` renders a readout **into `ctx.pane`** (tasks translated, plan path); the Config UI is
   never shown. `ctx.artifact?.()` for each screenshot.
6. **`armingFor`** (L80-85) gains
   `withStamperGui: drivenOpIds.has('stamper-translate') || drivenOpIds.has('stamper-execute')`.

**Accept 2b:** `stamper-translate` loads in `--check`; **`tests/demo-show-arm-sim.test.ts` (NEW,
closes GAP P1-9)** proves — with injected spawn/probe seams — that :3000 is probed and started only
when a stamper op is driven, that `buildGuiChildEnv` receives a run-scoped `storageRoot`, and that
`stop()` kills in the order EO → stamper → AO → serve; a unit test drives the op against a
hand-written `UiPage` and asserts it touches `backstage`, **never `pane`**, in `warm`;
`tests/demo-show-op-registry.test.ts` asserts the backstage session is created only for a
stamper-driving deck and closed on dispose; `demo-stamper-ui-driver.test.ts` proves the default
`phase` is byte-identical.

### Sub-slice 2c — `stamper-execute` (Config, apply the plan against the sim)

**`src/demo/show/ops/stamper-execute-op.ts`** (NEW). Drives **`ctx.backstage`**. Modelled on
`eo-review-op.ts`.

- **`warm`** — the expensive half (~7 min), on the backstage session. **Phase selection is guarded,
  not assumed** (closes GAP P1-10). `doExecute` bails unless the in-page
  `tenantConnectionState === 'connected'` (`../ces-stamper/public/index.html` L7704-7708,
  L7738-7741) and it reads `#outputPath` (L7735), which only a translate response populates
  (L7574, L7668). So `execute-only` is legal **only when this same page performed the translate**.
  The op checks both preconditions in-page — connection state indicator *and* a non-empty
  `#outputPath` — and:
  - both hold → `phase: 'execute-only'` (saves connect + config + assess + seed + translate,
    **≈5 minutes**, not the ~12 the earlier revision implied);
  - either fails → **log it loudly** and run `phase: 'full'` (≈12 min). Slower, still real; it
    never narrates a result it did not produce.
  **The backstage session is what makes the fast path the common case**: nothing else ever
  navigates it, so a warm `stamper-translate` earlier in the deck leaves exactly the state
  `execute-only` needs — the pane-navigation hazard that made the fallback routine is gone.
- **`live`** — renders the outcome readout into `ctx.pane`; no Config UI walk (doctrine).
- **Judge the artifact, never the badge**: read `result.report` (`parseExecutionReport` /
  `findLatestExecutionReport` / `stamperPlansDir(pipelineRoot, slug)` — all exported,
  `stamper-ui-driver.ts` L188 / L227 / L236). Log tasks total / applied / failed and the report path.
- **Skip-list**: export a pure
  `partitionGuiFailures(failureIds: readonly string[], skipList: readonly string[] | undefined): { expected: string[]; unexpected: string[]; staleSkips: string[] }`
  from this module and judge `result.report.failureIds` against **`GUI_LEG_KNOWN_FALSE_FAILS`**
  (imported from `src/demo/e2e-run.ts` — safe per finding 8). **Do not** use `partitionFailures`
  from `known-false-fails.ts`. `undefined` skip-list means "judge nothing as expected"; log the
  distinction.
- **The op fails only on `unexpected` reds.** Expected sim false-FAILs are reported and skipped —
  the honesty guard — and Slice 3's report records both lists.
- `ctx.artifact?.()` gets the execution-report path and every screenshot (the field exists from
  Sub-slice 2.0, so this compiles here).
- **Warm-ordering mechanism, not prose** (closes GAP P1-8, part 1): `deck-validate.ts` emits a
  load-time **WARNING** when a deck has a warm `stamper-execute` with no warm `stamper-translate`
  on an **earlier slide** — naming the ~12-minute full-flow prep cost. A warning, not an error:
  the self-heal path is legal, just expensive. (Slice 4a generalizes this into the catalog-driven
  prep budget.)

### Slice 2 File Inventory

| File | Action | Target |
|---|---|---|
| `assets/demo-plan/demo-dib-small/mission-plan.json` | CREATE | from `runs/e2e/m7-run5/artifacts/plans/` |
| `assets/demo-plan/demo-dib-small/manifest.json` | CREATE | the **tenant** manifest, same directory |
| `assets/demo-plan/README.md` | CREATE | provenance + regeneration rule + `runs/` is gitignored |
| `src/demo/show/ops/muster-readiness-op.ts` | CREATE | 2a |
| `src/demo/show/ops/stamper-translate-op.ts` | CREATE | 2b, drives `ctx.backstage` |
| `src/demo/show/ops/stamper-execute-op.ts` | CREATE | 2c + `partitionGuiFailures` |
| `src/demo/show/app-pane.ts` | MODIFY | `BACKSTAGE_GEOMETRY` |
| `src/demo/stamper-ui-driver.ts` | MODIFY | `StamperUiDriveContext` L78-96 (`phase`), `StamperUiDriveResult` L119-121 (+`phase`, observed-in-call booleans), `runStamperUiFlow` L261-375 |
| `src/demo/e2e-run.ts` | MODIFY | export `WINDOWS_LIBUV_TEARDOWN_EXIT` (L644) |
| `src/demo/eval-run.ts` | MODIFY | import it, replacing the bare literal (L297) |
| `src/demo/show/deck-model.ts` | MODIFY | `DemoOpId` / `DEMO_OP_IDS` L40-46 |
| `src/demo/show/deck-validate.ts` | MODIFY | warm-ordering warning (2c) |
| `src/demo/show/op-registry.ts` | MODIFY | `ArmedEnvironment` L37-47 (+`stamperBaseUrl`, `musterRoot`, `stamperRoot`), `OpDriveContext` L49-51 (+`backstage`), `MakeShowOpsDeps` L55-65, `OP_IMPLEMENTATIONS` L68-71, `armingFor` L80-85, `prepare`/`dispose` L160-202, env literal L174-180 |
| `src/demo/show/arm-sim.ts` | MODIFY | `ArmSimOptions` L84-96, `ArmedSim` L73-82, **new optional `ArmSimDeps` seam param** (L103-107 signature), port probe L126-137, `stop` L144-150, spawn order L195-225 |
| `src/demo/show/show-run.ts` | MODIFY | `ShowRunOptions` L42-63 (`musterRoot`), `ShowOpContext` L66-72 (`artifact?`) |
| `src/cli/show-command.ts` | MODIFY | `DemoShowArgs` L47-63, `parseShowArgs` L103-116, `FLAGS_WITH_VALUES` L120-127 |
| `src/cli/index.ts` | MODIFY | usage string L38-39 |
| `tests/demo-show-muster-op.test.ts` | CREATE | 2a; injected spawn seam; **four-posture fixture** |
| `tests/demo-show-stamper-op.test.ts` | CREATE | 2b/2c against a hand-written `UiPage`; **backstage-not-pane** assertion; phase-guard both branches; `partitionGuiFailures` |
| `tests/demo-show-arm-sim.test.ts` | CREATE | :3000 probe/start conditionality, run-scoped `storageRoot`, `stop()` kill order |
| `tests/demo-show-op-registry.test.ts` | MODIFY | five ids registered; `armingFor` mapping; backstage created/closed conditionally |
| `tests/demo-stamper-ui-driver.test.ts` | MODIFY | default `phase` byte-identical; `execute-only` returns observed-in-call booleans |
| `tests/demo-show-command.test.ts` | MODIFY | the three new root flags, incl. the flag-value-vs-deck case |
| `tests/demo-show-xlsx-loader.test.ts` | MODIFY | warm-ordering warning |
| `demos/README.md` | MODIFY | `op` row lists all five ids; prep-cost note; ces-muster `dist/` operator prerequisite |

### Accept (mirrors the REQ)

- [ ] `muster-readiness`, `stamper-translate` and `stamper-execute` each **load in `--check`**.
- [ ] `warm` pre-starts during prep and `live` holds the slide as documented in `demos/README.md`;
      the long ops are `warm`-first.
- [ ] **No Config GUI ever appears in the visible app pane.** A test proves the stamper ops touch
      `ctx.backstage` and never `ctx.pane` in `warm`; the backstage session is headless and is
      created only for a stamper-driving deck.
- [ ] `stamper-execute` applies the plan against the sim and partitions known sim false-FAILs from
      unexpected reds, failing only on the latter.
- [ ] The readiness readout tallies all four schema postures.
- [ ] No sibling project root was written to; ces-muster and ces-stamper are consumed over their
      existing CLI / GUI surfaces only.
- [ ] Ports 3000 / 4390 (and 3001 / 4002 when driven) are all free after teardown.

### Headless proof required before Slice 2 is called done

Follow the GP-DEMO-4 S5/eo-review method: a scratchpad harness in
`C:\Users\mhsut\AppData\Local\Temp\claude\...\scratchpad` (never in the repo) that runs the REAL
`armSim` → real backstage session → the real op, with ports re-probed first and the run aborting
rather than running against someone else's server. Record in `docs/context/IMPLEMENTATION_LOG.md`:
arm time, per-op wall time, **which phase `stamper-execute` selected and why**, the numbers
observed, the ledger delta, and post-teardown port state.

---

## Slice 3 — REQ ask 3: the run-report artifact

A schema'd JSON report per `demo:show` run, so strategy can iterate deck content on evidence —
the same assess → execute → verify loop CES sells, applied to demos. `--check` is unaffected.

### The schema

New file **`schemas/demo-show-report.schema.json`** (draft-07, same house pattern as
`demo-deck.schema.json`; ajv is already a dependency and `deck-validate.ts` L49-72 shows the
`createRequire` load with the dual-depth `dist/` fallback).

```jsonc
{
  "schemaVersion": 1,
  "runId": "show-1757168400000",
  "startedAt": "2026-09-06T18:20:00.000Z",
  "endedAt":   "2026-09-06T18:31:12.480Z",
  "exitReason": "key",                   // key | signal | end-of-deck | error
  "deck": {
    "path": "demos/ridgeline-run.xlsx",
    "title": "ridgeline-run",
    "slideCount": 10,
    "rowCount": 13,
    "warnings": ["..."]
  },
  "run": {
    "defaultDwellSec": 30,
    "slidesPort": 4500,
    "autoInitial": true,                 // toggles are events, not one boolean
    "presenterInitial": true,
    "toggles": [ { "at": "...", "what": "auto", "to": false } ],
    "manualAdvances": 4
  },
  "slides": [
    {
      "index": 0, "slideNumber": 1, "title": "Ridgeline Fabrication",
      "declaredDurationSec": 20,         // null when the cell was blank
      "effectiveDurationSec": 20,
      "actualDwellMs": 24310,            // summed across every visit
      "visits": [ { "enteredAt": "...", "leftAt": "...", "dwellMs": 24310, "advance": "auto" } ]
    }
  ],
  "ops": [
    {
      "index": 8, "slideNumber": 9, "opId": "eo-review", "mode": "warm",
      "params": {},                      // see the ordering note below
      "startedAt": "...", "endedAt": "...", "durationMs": 7480,
      "status": "done",                  // done | failed
      "error": null,
      "artifacts": ["runs/show/show-1757168400000/eo-review-03-sprs.png"]
    }
  ]
}
```

Written to **`runs/show/<runId>/report.json`** — the same directory `arm-sim.ts` L109 already
creates (`runs/show/<runId>`), so screenshots and the report referencing them sit together.

**Ordering note — `ops[].params`.** This slice lands BEFORE Slice 4a, so `SlideOp.params` does not
exist yet. The schema marks `params` **optional** and the recorder emits a literal `{}`; Slice 4a
carries the one-line follow-up.

### Plumbing gaps this slice closes

- **`onChange(state, previous)` does not carry the action**, so auto-tick vs manual advance cannot
  be classified. Widen to `onChange?(state, previous, action)` in `SlidesServerOptions`
  (`slides-server.ts` L62) and pass `action` from `dispatch` (L105-111). Third parameter, so every
  existing caller keeps compiling.
- **`ShowAction` has TEN members** (`show-state.ts` L59-69), not six (closes GAP P2):
  `next`, `prev`, `first`, `last`, `goto`, `toggle-presenter`, `toggle-auto`, `exit`, `op`, `tick`.
  `advanceKindFor` classifies only the five that move the index; `toggle-*` fire `onChange`
  **without** changing `state.index` and must not register as a slide transition — record them in
  `run.toggles` instead. `auto`/`presenter` are toggleable mid-run, so they are recorded as an
  initial value plus an event list, never as one lossy boolean.
- **Op start/end/status is dispatched but never recorded.** `show-run.ts`'s `startOpFor`
  (L257-285) is the single place that knows all of it — record there, not in each op.
- **Artifacts** flow through the `ShowOpContext.artifact?` callback already added in Sub-slice 2.0.
  This slice supplies the recorder behind it and retrofits **every** op that has evidence in hand
  (closes GAP P1-4): `ao-registry` (`result.screenshots`, `ops/ao-registry-op.ts` L61), `eo-review`
  (`shot()` L173-174), and the three Slice 2 ops (already calling it).
- **`runId`** — `ArmSimOptions.runId?` already exists (`arm-sim.ts` L92, defaulted L108) and
  `armSim(options, …)` receives the options object whole (`op-registry.ts` L165), so adding
  `runId?` to `ShowRunOptions` makes it flow with **no op-registry edit** and the report lands in
  the same `runs/show/<runId>` directory for free (closes GAP P2).

### Implementation steps

1. **`src/demo/show/run-report.ts`** (NEW) — pure recorder, no IO except the final write:
   ```ts
   export interface ShowReportRecorder {
     slideEntered(index: number, atMs: number): void;
     slideLeft(index: number, atMs: number, advance: 'auto'|'manual'|'jump'|'end'): void;
     toggled(what: 'auto'|'presenter', to: boolean, atMs: number): void;
     opStarted(index: number, slide: DemoSlide, atMs: number): void;
     opArtifact(index: number, absPath: string): void;
     opFinished(index: number, atMs: number, status: 'done'|'failed', error?: string): void;
     finish(atMs: number, exitReason: ShowReport['exitReason']): ShowReport;
   }
   export function createShowReport(deck: DemoDeck, options: ShowRunOptions, startedAtMs: number): ShowReportRecorder;
   export async function writeShowReport(report: ShowReport, absPath: string): Promise<void>;
   export function advanceKindFor(action: ShowAction): 'auto'|'manual'|'jump'|undefined;
   ```
   `advanceKindFor`: `tick` → `auto`; `next`/`prev` → `manual`; `first`/`last`/`goto` → `jump`;
   the other five → `undefined`. Times are injected ms so tests are arithmetic. Artifact paths are
   stored relative to `options.testerRoot` via `path.relative`.
2. **`src/demo/show/slides-server.ts`** — widen `onChange` to a third `action` parameter; pass it.
3. **`src/demo/show/show-run.ts`** — `ShowRunOptions` gains `runId?` and `report?: boolean`
   (default true); build the recorder after the deck loads; feed `slideEntered`/`slideLeft`/
   `toggled` from the widened `onChange`; feed `opStarted`/`opFinished` from `startOpFor`; supply
   the `artifact` callback into each `ShowOpContext`; in the `finally` block **write the report
   BEFORE `await dispose()`** and log its absolute path.
4. **`src/demo/show/ops/ao-registry-op.ts`** — forward `result.screenshots` (L61) to `ctx.artifact?.()`.
5. **`src/demo/show/ops/eo-review-op.ts`** — `shot()` (L173-174) forwards its resolved path.
6. **`src/cli/show-command.ts`** — `--no-report` in `parseShowArgs`
   (`report: !argv.includes('--no-report')`) and in `DemoShowArgs`. **Do not** touch the `--check`
   branch (L252-259) — the report is an operator-run artifact only.
7. **`schemas/demo-show-report.schema.json`** (NEW) — every field carrying a `description`; the
   schema IS the documentation the REQ asks for.
8. **`demos/README.md`** — "Run reports" section: where it lands, what it carries, that `--check`
   never writes one, and `--no-report` to suppress.

### File Inventory

| File | Action | Target |
|---|---|---|
| `src/demo/show/run-report.ts` | CREATE | recorder + writer + `advanceKindFor` |
| `schemas/demo-show-report.schema.json` | CREATE | the report schema |
| `src/demo/show/slides-server.ts` | MODIFY | `SlidesServerOptions.onChange` L62, `dispatch` L105-111 |
| `src/demo/show/show-run.ts` | MODIFY | `ShowRunOptions` L42-63, `runShow` L161-347 |
| `src/demo/show/ops/ao-registry-op.ts` | MODIFY | `result.screenshots` L61 |
| `src/demo/show/ops/eo-review-op.ts` | MODIFY | `shot()` L173-174 |
| `src/cli/show-command.ts` | MODIFY | `DemoShowArgs` L47-63, `parseShowArgs` L103-116 |
| `tests/demo-show-report.test.ts` | CREATE | recorder arithmetic; toggles are not transitions; ajv-validate a produced report; **the report is written before teardown** (inject a disposer that throws and assert the file exists) |
| `tests/demo-show-server.test.ts` | MODIFY | `onChange` receives the action |
| `tests/demo-show-command.test.ts` | MODIFY | `--no-report` parses; `--check` writes nothing |
| `demos/README.md` | MODIFY | "Run reports" section |

### Accept (mirrors the REQ)

- [ ] A `demo:show` run emits `runs/show/<runId>/report.json` validating against
      `schemas/demo-show-report.schema.json` (asserted by test, with ajv).
- [ ] Per-slide declared vs actual dwell present; manual advances counted and classified;
      mid-run `auto`/`presenter` toggles recorded as events.
- [ ] Op outcomes carry id, mode, start/end, pass/fail and evidence-artifact refs **for every op
      that captures evidence** — `ao-registry`, `eo-review`, and all three Slice 2 ops.
- [ ] A crash inside teardown does not cost the report (test).
- [ ] `--check` is unaffected — no report file written, all three decks still exit 0.

---

## Slice 4a — REQ ask 4a: parameterized ops + the published op catalog

Ops stay tester-implemented; the deck sets **declared** parameters by id. No step-level primitives
(click/navigate/wait) — selectors never leak into deck content; both sides refuse that.

### Design decisions

- **The catalog is a declaration-layer module.** `src/demo/show/op-catalog.ts` imports **types
  only** from `deck-model.ts` and nothing else, so `--check` validates a deck with no browser and
  no sibling present.
- **Cell syntax: `key=value`, one per line** (Alt+Enter in Excel) — the separator rule `features`
  already uses, and the only one a value can never itself contain.
- **Every loader error cites `docs/demo/OP-CATALOG.md` by path**, which is what makes the catalog
  the authoring vocabulary rather than a doc nobody opens.
- **Act-ready by construction** (the two soft amendments from `DEMO-ACTS-CONCEPT.md` §5, folded in
  so the catalog is written once): `OpCatalogEntry` carries `version: number` and
  `target: CesTool` (the concept's `DemoTool`) from day one — two fields, no behaviour — and
  `OP-CATALOG.md` adopts the **demo-act** vocabulary and carries the act-alias table.
  `HEADER_ALIASES` gains `act`, `demoact`, `demo-act` for the `op` column so the founder's
  vocabulary works in Excel. **Alias *resolution* is not built here** — `ACT_ALIASES` ships as
  pure data with a comment pointing at GP-DEMO-5 T3.

### Implementation steps

1. **`src/demo/show/op-catalog.ts`** (NEW):
   ```ts
   export type ParamType = 'enum' | 'string' | 'number' | 'boolean';
   export interface ParamSpec {
     readonly key: string; readonly type: ParamType;
     readonly values?: readonly string[];       // required when type === 'enum'
     readonly default?: string | number | boolean;
     readonly description: string;
   }
   export interface OpCatalogEntry {
     readonly id: DemoOpId;
     readonly version: number;                  // acts amendment 1
     readonly target: CesTool;                  // acts amendment 1
     readonly stageName: string;                // THREAD_HANDOFF stage naming
     readonly shows: string;
     readonly modes: readonly OpMode[];
     readonly typicalWarmMs: number;            // feeds the --check prep budget
     readonly params: readonly ParamSpec[];
     readonly preconditions: readonly string[];
   }
   export const OP_CATALOG: Readonly<Record<DemoOpId, OpCatalogEntry>>;
   /** Named presets: alias -> { id, params }. DATA ONLY — resolution lands in GP-DEMO-5 T3. */
   export const ACT_ALIASES: Readonly<Record<string, { id: DemoOpId; params: Readonly<Record<string,string>> }>>;
   export function parseParamsCell(raw: string): { params: Record<string,string>; errors: string[] };
   export function validateParams(opId: DemoOpId, params: Readonly<Record<string,string>>):
     { resolved: Record<string, string|number|boolean>; errors: string[] };   // fills defaults
   export function prepBudgetMs(warmOpIds: readonly DemoOpId[]): number;
   export const OP_CATALOG_DOC = 'docs/demo/OP-CATALOG.md';
   ```
   Seed entries — all five registered ops:
   | id | stage name | modes | params | key preconditions |
   |---|---|---|---|---|
   | `ao-registry` | Operations (Ops) | live, warm, staged | `command` (string, default `AO_DEMO_COMMAND_ID` — which lives in **`ao-leg.ts` L50**, imported by the op) | AO GUI armed (:3001) |
   | `eo-review` | Assessment | live, warm, staged | `family` (string, default `IA`), `land` (enum `dashboard\|evidence\|sprs`, default `sprs`) | `live` wants an earlier `warm` slide; self-heals by re-assessing if the visible pane moved on |
   | `muster-readiness` | Readiness Evaluation (RE) | live, warm, staged | `detail` (enum `counts\|controls`, default `counts`) | stacksim armed; **`../ces-muster/muster-api/dist/cli/bin.js` must exist — an operator prerequisite**, since ces-tester never builds a sibling. **No score is produced** — four-value posture only |
   | `stamper-translate` | Configuration (Config) | warm, staged (live legal, ~5 min) | `missionPlan`, `manifest` (deck-relative paths, default the `assets/demo-plan` fixture) | Stamper GUI armed (:3000); runs **backstage**, never in the visible pane |
   | `stamper-execute` | Configuration (Config) | warm, staged | `skipKnownFalseFails` (boolean, default `true`) | a warm `stamper-translate` **earlier in the deck** leaves the backstage page connected with `#outputPath` populated → the ~5 min fast path; otherwise the full flow (~12 min). Runs **backstage** |

   **Warm-op ordering is a real semantic and belongs in the preconditions text:** warm ops fire
   during prep **in deck order**, through the single serialization queue (`op-registry.ts`
   L142-152 — the general pane queue; warm *scheduling* is `show-run.ts` L301-306). A deck
   ordering `eo-review` (warm) → `stamper-execute` (warm) gets before-state numbers, then
   remediation; the after-truth Assessment beat works because `eo-review`'s `live` self-heal
   re-assesses when the visible pane has moved on.
2. **`src/demo/show/deck-model.ts`** — `SlideOp` gains
   `readonly params?: Readonly<Record<string, string|number|boolean>>;` — **optional**, so every
   existing test fixture and construction site still compiles (GAP P2). Ops read
   `ctx.slide.op.params?.x ?? <default>`.
3. **`src/demo/show/xlsx-loader.ts`** — the **six-site** column addition for `params`; aliases
   `params`, `parameters`, `opparams`, `args`, `arguments`, `options`. Plus the `op`-column act
   aliases `act`, `demoact`, `demo-act`.
4. **`src/demo/show/deck-validate.ts`** — Pass 1 parses the cell with `parseParamsCell` (syntax
   errors cite the sheet row); Pass 3 resolves by unique-or-agree (compare on sorted `key=value`
   lines) then calls `validateParams(opId, params)`. Errors:
   - params on a slide with **no** `op` → error;
   - unknown key → `slide N: op "<id>" has no parameter "<key>" (supported: a, b) — see docs/demo/OP-CATALOG.md`;
   - bad enum value → error listing allowed values + the same citation;
   - non-numeric for `number`, non-`true|false` for `boolean` → error.
   **Prep-budget check (closes GAP P1-8, part 2):** sum `typicalWarmMs` across the deck's warm ops
   via `prepBudgetMs` and emit a WARNING when it exceeds **300 000 ms**, naming the total and the
   contributing ops. This is the mechanized version of the 2c warm-ordering warning; keep both.
5. **`schemas/demo-deck.schema.json`** — add `"params": { "$ref": "#/definitions/text" }`.
6. **`src/demo/show/ops/eo-review-op.ts`** — read `params?.family` (fallback `EO_REVIEW_FAMILY`
   L92) and `params?.land` for the final tab. No-params behaviour must be byte-identical.
7. **`src/demo/show/ops/ao-registry-op.ts`** — read `params?.command`; unchanged default.
8. **`src/demo/show/ops/muster-readiness-op.ts`** — `detail`.
   **`stamper-translate-op.ts`** — `missionPlan` / `manifest` (still resolved absolute).
   **`stamper-execute-op.ts`** — `skipKnownFalseFails`.
9. **`src/demo/show/run-report.ts`** — populate `ops[].params` from `slide.op.params` (Slice 3
   left it `{}`).
10. **`docs/demo/OP-CATALOG.md`** (NEW) — one section per op: id, version, target tool, stage name,
    what it shows, supported modes, typical warm cost, parameter table, preconditions, and a worked
    deck-row example. Opens with the boundary note: *strategy writes op intents by id and declared
    parameters only; implementations, selectors and environment handling stay in ces-tester.*
    Adopts the **demo-act** vocabulary and carries the act-alias table, e.g.
    `eo-verify-evidence → eo-review land=evidence`,
    `eo-browse-determinations → eo-review land=sprs`.
11. **`demos/README.md`** — `params` row + alias line + the `act` aliases for `op` + a pointer to
    `docs/demo/OP-CATALOG.md`.

### File Inventory

| File | Action | Target |
|---|---|---|
| `src/demo/show/op-catalog.ts` | CREATE | catalog, act aliases, param parse/validate, `prepBudgetMs` |
| `docs/demo/OP-CATALOG.md` | CREATE | the published authoring vocabulary, act-ready |
| `src/demo/show/deck-model.ts` | MODIFY | `SlideOp` L92-100 (optional `params`) |
| `src/demo/show/xlsx-loader.ts` | MODIFY | six-site `params` addition + `op` act aliases |
| `src/demo/show/deck-validate.ts` | MODIFY | Pass 1 L200-308, Pass 3 L337-381, prep budget |
| `schemas/demo-deck.schema.json` | MODIFY | `normalizedRow.properties` |
| `src/demo/show/ops/eo-review-op.ts` | MODIFY | `family` / `land` |
| `src/demo/show/ops/ao-registry-op.ts` | MODIFY | `command` |
| `src/demo/show/ops/muster-readiness-op.ts` | MODIFY | `detail` |
| `src/demo/show/ops/stamper-translate-op.ts` | MODIFY | `missionPlan` / `manifest` |
| `src/demo/show/ops/stamper-execute-op.ts` | MODIFY | `skipKnownFalseFails` |
| `src/demo/show/run-report.ts` | MODIFY | populate `ops[].params` |
| `tests/demo-show-op-catalog.test.ts` | CREATE | parse/validate; `prepBudgetMs`; **doc-drift guard** — every `DEMO_OP_IDS` entry, every param key and every act alias appears in `docs/demo/OP-CATALOG.md` |
| `tests/demo-show-xlsx-loader.test.ts` | MODIFY | params column, unknown key, bad enum, no-op-with-params, prep-budget warning |
| `demos/README.md` | MODIFY | `params` row, act aliases, catalog pointer |

### Accept (mirrors the REQ)

- [ ] A params cell is validated **per op** by `--check`; an unknown key or bad enum value fails
      the load with a message citing `docs/demo/OP-CATALOG.md`.
- [ ] `docs/demo/OP-CATALOG.md` exists and lists every registered op id, its modes, parameters,
      typical warm cost and preconditions; a test fails if it drifts from `OP_CATALOG`.
- [ ] A deck whose warm chain exceeds the 5-minute prep budget produces a `--check` warning naming
      the total.
- [ ] All three decks (which set no params) still `--check` exit 0 with unchanged output.

---

## Slice 4b — REQ ask 4b: deck-supplied theme

A small theme file referenced by the deck and applied by the presenter shell, so stage chrome
matches the story's brand **without strategy touching the renderer**. The shell already reads CSS
variables (`SHOW_CSS` `:root`, `slide-render.ts` L387-397).

### Design decisions

- **The LOCKED V4 defaults must not move.** With no `theme` cell the shell renders as today,
  pinned against a **golden fixture** (see the invariant note below).
- **Token whitelist, not free CSS.** A theme file may only set known token names with validated
  values; anything else is a load-time error.
- **The logo is served, never inlined** (closes GAP P1-6). The Slice 1 `html` body is safe because
  it is a sandboxed, opaque-origin iframe; the theme logo would be inlined straight into the shell
  page (L720). Screening for `<script` alone leaves `onload=` / `onerror=`, `<foreignObject>` and
  `xlink:href="javascript:"` executing with full access to the page and `/nav`. So the logo is
  registered as a deck **asset** and rendered as
  `<img class="logo-mark" src="/asset/<id>" alt="">` — an `<img>`-referenced SVG cannot execute
  script, which removes the entire screening problem instead of trying to out-regex it.
- **Deck-level, expressed through the existing per-slide mechanism.** `theme` resolves
  unique-or-agree across the **whole deck**; two slides naming different theme files is an error.

### The no-theme invariant (closes GAP P1-5)

The invariant is pinned to a **golden fixture**, `tests/fixtures/show-page-baseline.html`, created
in this slice from `renderShowHtml(buildDeckView(fixtureDeck))`. `tests/demo-show-theme.test.ts`
asserts byte equality against it when no theme is supplied. **Slice 4c changes the shell**, so 4c
carries an explicit re-baseline step: regenerate the fixture, and review the diff — it must contain
**only** the `p-watch` div and its CSS, nothing else.

### Implementation steps

1. **`src/demo/show/theme.ts`** (NEW):
   ```ts
   export const THEME_TOKENS: readonly string[] = [
     'navy','navy-deep','navy-mid','gold','t1','t2','t3','t4',
     'pass','warn','hair','hair-soft','kbd-line','font-sans','font-mono',
   ];
   export interface DeckTheme { readonly tokens: Readonly<Record<string,string>>; readonly logo?: string; }
   export function parseTheme(json: unknown, ctx: { file: string }): { theme?: DeckTheme; errors: string[] };
   export function themeCss(theme: DeckTheme | undefined): string;   // '' or ':root{--navy:#…;}'
   ```
   Theme file: `{ "tokens": { "gold": "#f5b74a", … }, "logo": "themes/acme.svg" }`.
   Colour tokens accept `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`; `font-sans`/`font-mono`
   accept a font-family list — **reject any value containing `;`, `}`, `{`, `@`, `url(` or `/*`**.
   Unknown token key → error listing `THEME_TOKENS`.
2. **`src/demo/show/deck-model.ts`** — `DemoDeck` gains `readonly theme?: DeckTheme;`,
   `readonly themeSource?: string;` and `readonly logoAsset?: SlideImage;`.
3. **`src/demo/show/xlsx-loader.ts`** — the **six-site** column addition for `theme`; aliases
   `theme`, `themefile`, `brand`, `branding`.
4. **`src/demo/show/deck-validate.ts`** — path-fence + `fileExists` exactly like `image`; read via
   the `readText` seam from Slice 1; `JSON.parse` failure is an error citing the sheet row;
   `parseTheme` errors attributed to the same row. Cross-slide agreement: error if more than one
   distinct theme path exists across the deck. The optional `logo` is resolved with the same fence,
   must end `.svg`, and is registered in `deck.assets` via `assetIdFor` so `/asset/<id>` serves it.
5. **`schemas/demo-deck.schema.json`** — add `"theme": { "$ref": "#/definitions/text" }`.
6. **`src/demo/show/slide-render.ts`** — `DeckView` gains `readonly themeCss: string;` and
   `readonly logoAssetId?: string;`; `buildDeckView` (L344-378) fills them; `renderShowHtml`
   (L705, running to near the end of the ~908-line file) emits `<style>${SHOW_CSS}</style>` then,
   only when non-empty, `<style id="deck-theme">${themeCss}</style>` — **after**, so the theme wins
   by cascade order with no `!important` — and at L720 renders the `<img>` logo when
   `logoAssetId` is set, else `BHD_MARK`.
7. **`demos/themes/example-bhd.json`** (NEW) — the V4 defaults written out, a copy-paste start.
8. **`demos/README.md`** — `theme` row + a "Deck theme" section listing every token, the accepted
   value forms, the served-not-inlined logo rule, and one-theme-per-deck.

### File Inventory

| File | Action | Target |
|---|---|---|
| `src/demo/show/theme.ts` | CREATE | tokens, parse, `themeCss` |
| `demos/themes/example-bhd.json` | CREATE | the V4 defaults as a theme |
| `tests/fixtures/show-page-baseline.html` | CREATE | the no-theme golden |
| `src/demo/show/deck-model.ts` | MODIFY | `DemoDeck` L109-122 |
| `src/demo/show/xlsx-loader.ts` | MODIFY | six-site `theme` addition |
| `src/demo/show/deck-validate.ts` | MODIFY | Pass 1 + Pass 3, deck-level agreement, logo asset |
| `schemas/demo-deck.schema.json` | MODIFY | `normalizedRow.properties` |
| `src/demo/show/slide-render.ts` | MODIFY | `DeckView` L95-99, `buildDeckView` L344-378, `renderShowHtml` L705-720 |
| `tests/demo-show-theme.test.ts` | CREATE | token whitelist, value rejection, css emission, **golden-fixture equality with no theme**, logo served not inlined |
| `tests/demo-show-xlsx-loader.test.ts` | MODIFY | missing theme file, bad JSON, two different themes, non-`.svg` logo |
| `demos/README.md` | MODIFY | `theme` row + section |

### Accept

- [ ] A deck naming a theme file renders with those CSS variables; the logo variant is swapped and
      is **served via `/asset/<id>`, never inlined**.
- [ ] Unknown token, malformed value, missing file, non-`.svg` logo, or two slides naming different
      themes are all load-time errors.
- [ ] With no theme cell, `renderShowHtml` matches `tests/fixtures/show-page-baseline.html`
      byte-for-byte; all three decks `--check` exit 0.

---

## Slice 4c — REQ ask 4c: reserved presenter columns

`show` and `watchouts` currently ride as ignored-unknown columns and warn on every load
(`xlsx-loader.ts` L200-204).

**Decision (one, not "either"):** reserve **both** as canonical columns so the warnings stop.
`show` is captured and **not rendered** (reserved for a future stage-direction surface);
`watchouts` is captured per-row and rendered into the **existing presenter band** under the talk
track, **behind a `--watchouts` flag that defaults OFF** — nothing changes on stage unless the
presenter asks.

### Implementation steps

1. **`src/demo/show/xlsx-loader.ts`** — the **six-site** addition, twice: `show` (aliases `show`,
   `stagedirection`) and `watchouts` (aliases `watchouts`, `watchout`, `watch`, `cautions`).
2. **`src/demo/show/deck-model.ts`** — `SlideRow` (L49-70) gains `readonly show?: string;` and
   `readonly watchouts?: string;` — per-row like `talkTrack`, not per-slide op fields.
3. **`src/demo/show/deck-validate.ts`** — populate both via the existing `text()` helper in the
   `SlideRow` build (L286-295). No new rules; both are free text.
4. **`schemas/demo-deck.schema.json`** — add `"show"` and `"watchouts"` as `text`.
5. **`src/demo/show/slide-render.ts`** — `RenderedSlide` (L73-93) gains
   `readonly watchouts: readonly string[];` (collected with `column()`); `DeckView` gains
   `readonly showWatchouts: boolean;` (constant for the run, so it belongs on the view, not the
   snapshot); `BuildDeckViewOptions` gains `watchouts?: boolean`; `renderShowHtml` adds
   `<div class="p-watch" id="watch"></div>` inside `.presenter` (L746-749) and `draw()` fills it
   from `slide.watchouts` **only when `DECK.showWatchouts`**; CSS: amber-muted (`--warn`), smaller
   than the talk track, hairline rule above — never gold (the V4 gold budget is ≤3 elements/state).
6. **Re-baseline the Slice 4b golden**: regenerate `tests/fixtures/show-page-baseline.html` and
   review the diff — it must contain **only** the `p-watch` div and its CSS. Record the diff
   summary in the implementation log.
7. **`src/demo/show/slides-server.ts`** — `SlidesServerOptions` gains `watchouts?: boolean`, passed
   into `buildDeckView` (L82).
8. **`src/demo/show/show-run.ts`** — `ShowRunOptions` gains `readonly watchouts?: boolean;` —
   **optional** so existing callers and fixtures still compile (GAP P2).
9. **`src/cli/show-command.ts`** — `--watchouts` flag (`watchouts: argv.includes('--watchouts')`).
10. **`demos/README.md`** — `show` and `watchouts` rows marked *reserved presenter columns*, with
    the `--watchouts` flag documented.

### File Inventory

| File | Action | Target |
|---|---|---|
| `src/demo/show/xlsx-loader.ts` | MODIFY | six-site addition ×2 |
| `src/demo/show/deck-model.ts` | MODIFY | `SlideRow` L49-70 |
| `src/demo/show/deck-validate.ts` | MODIFY | `SlideRow` build L286-295 |
| `schemas/demo-deck.schema.json` | MODIFY | `normalizedRow.properties` |
| `src/demo/show/slide-render.ts` | MODIFY | `RenderedSlide` L73-93, `DeckView` L95-99, `buildDeckView` L344-378, `renderShowHtml` L705+, `SHOW_CSS` |
| `tests/fixtures/show-page-baseline.html` | MODIFY | re-baselined; diff must be `p-watch` only |
| `src/demo/show/slides-server.ts` | MODIFY | `SlidesServerOptions` L50-63, L82 |
| `src/demo/show/show-run.ts` | MODIFY | `ShowRunOptions` L42-63 |
| `src/cli/show-command.ts` | MODIFY | `DemoShowArgs` + `parseShowArgs` |
| `tests/demo-show-render.test.ts` | MODIFY | watchouts rendered only when enabled |
| `tests/demo-show-theme.test.ts` | MODIFY | golden re-baselined |
| `tests/demo-show-xlsx-loader.test.ts` | MODIFY | **no warning** for `show` / `watchouts` headers |
| `demos/README.md` | MODIFY | reserved-columns rows |

### Accept

- [ ] A deck carrying `show` and `watchouts` columns loads with **no "ignored unknown column"
      warning** for either.
- [ ] `--watchouts` renders the cues in the presenter band; without the flag the band is exactly
      as today.
- [ ] The re-baselined golden's diff contains only the `p-watch` addition.
- [ ] All three decks `--check` exit 0.

---

## Final loop step — validate the whole deck fleet

After the last slice, loop until green:

```
cd C:\Users\mhsut\DevProjects\ces\ces-tester
node scripts/make-demo-xlsx.mjs                                     # regenerates BOTH tester decks
git diff --stat demos/ces-overview.xlsx demos/ces-pain-story.xlsx   # expect NO change
npm run build
node bin/ces-tester.mjs demo:show --check demos/ces-overview.xlsx
node bin/ces-tester.mjs demo:show --check demos/ces-pain-story.xlsx
node bin/ces-tester.mjs demo:show --check demos/ridgeline-run.xlsx
npx tsc --noEmit
npm test
```

- **`demos/ridgeline-run.xlsx` is ces-strategy's product — never regenerate or edit it.** It is
  only ever `--check`ed here; a regression against it is a tester bug, not a deck bug.
- If a new column ever needs to appear in the two tester-owned decks, edit `STARTER_ROWS` /
  `PAIN_STORY_ROWS` in `scripts/make-demo-xlsx.mjs` and re-run — never edit the .xlsx directly.
- Append an "acceptance sweep" section to `docs/context/IMPLEMENTATION_LOG.md` recording each
  deck's slide/row counts and exit codes.

## Architecture Decisions (summary)

- **Backstage session for doctrine-sensitive ops** — the answer to GAP P0-1. `warm` is not "off
  stage" on the visible pane; a second headless session, created by the runner and never
  displayed, is. It also makes `execute-only` reliable and protects `eo-review`'s pane state.
- **Iframe over inlining for `html`; `<img>` over inlining for the theme logo** — both protect the
  locked V4 shell, and the `<img>` choice removes the SVG-sanitization problem rather than trying
  to out-regex it.
- **The declaration layer stays runtime-free** (`deck-model.ts`, `op-catalog.ts`, `theme.ts` import
  types only). Ops may import `e2e-run.ts` — Playwright is already in `--check`'s graph and no
  module in it has top-level side effects.
- **The op catalog, not step primitives, is the control surface**, and it is written **once**,
  act-alias-ready (`DEMO-ACTS-CONCEPT.md` §5 amendments folded into Slice 4a).
- **Hazards get mechanisms, not prose**: the warm-ordering warning (2c) and the catalog-driven
  prep budget (4a) both fire in `--check`.
- **Report recorded at the one place that knows** (`startOpFor` + the widened `onChange`); ops only
  contribute artifact paths, through a seam declared a slice early so every op compiles alone.

## Out of Scope

- **Editing `demos/ridgeline-run.xlsx` or anything under a sibling project root.** Siblings are
  read-only over their existing CLI/HTTP/GUI surfaces. Gaps found in ces-muster / ces-stamper /
  ces-eo / ces-ao are filed as REQ docs **in this repo**, never fixed there. ces-tester also never
  **builds** a sibling — `../ces-muster/muster-api/dist/` is an operator prerequisite.
- **Step-level deck primitives** (click / navigate / wait / selector cells) — refused by both sides.
- **Changing the LOCKED V4 design defaults.** Themes override tokens; see the founder-visibility
  note about how far token overrides reach.
- **Driving ces-planner's wizard (:5173)** or adding a ces-muster GUI. `muster-readiness` is a
  headless CLI op; `src/muster-driver/*` stays owned by the `demo:e2e` leg.
- **Changing `runStamperUiFlow`'s default behaviour.** The `phase` field is optional and defaults
  to today's flow, so `demo:e2e` is unaffected.
- **Cursor theater / the theatrical layer** (`DEMO-ACTS-CONCEPT.md` T1-T3) — the proposed GP-DEMO-5
  follow-on. This plan builds its substrate only.
- **Amending THREAD_HANDOFF's stage-format doctrine** (concept §4 options B/C) — a founder call.
- Committing or pushing beyond the per-slice commits named above; no pushes without founder say-so.

## Legend

| Term | Meaning |
|---|---|
| **RE / Config / Ops / Assessment** | On-stage product names (THREAD_HANDOFF, binding): Muster = Readiness Evaluation, Stamper = Configuration, AO = Operations, EO = Assessment. Internal ids and CLIs unchanged. |
| **REQ** | `docs/requirements/REQ-TESTER-DEMO-RICHNESS.md`, the founder-approved filing this plan executes. |
| **GAP P0-1 / P1-n / P2** | Findings in `docs/context/GAP_ANALYSIS.md`, by severity: P0 blocks approval, P1 fix in the plan, P2 executor handles. |
| **`--check`** | `demo:show --check <deck>` — the headless deck validator. Forces every op to `staged`, so it never reaches an op implementation. Exit 0 pass / 1 checked-and-failed / 2 unloadable. |
| **op mode** | `staged` = replay · `warm` = started during prep, before slide 1 · `live` = runs on slide entry, the slide holds until it completes. |
| **Backstage session** | A second, headless, never-displayed browser session created by the ops runner. Where Config (Stamper) work happens, so it is never on stage. |
| **V4** | The LOCKED demo:show visual design, `docs/demo/design/mockups/v4-final-hybrid.html`. |
| **DISCOVERY-1** | ces-muster's `mu discovery --sim` readiness executor — presence-based, four-value per-control posture, **not** a score. |
| **GUI-leg false fails** | `GUI_LEG_KNOWN_FALSE_FAILS` (`e2e-run.ts` L811-856) — expected sim-only Stamper verification failures. A different id space from `known-false-fails.ts`'s CLI registry. |
| **demo-act** | `DEMO-ACTS-CONCEPT.md`'s vocabulary for an op plus its declared params — the "routine end", never the mouse click. |
| **Slice** | One independently-green commit: code + tests + doc + the gates. |

## E-summary

- **Rev 2 closes GAP_ANALYSIS's P0 and all thirteen P1s**, plus the P2s worth pinning; the slice
  decomposition is unchanged.
- **P0-1's answer is the backstage session:** a second headless, never-displayed browser session,
  created by the runner during prep, where all Config (Stamper) work runs. The visible pane sees a
  Stamper op only as a readout on its `live` slide. It also makes `execute-only` reliable (~5 min
  saving) and protects `eo-review`'s pane state.
- **Step 0 first, always** — three commits (0 eo-review, 0b strategy drop, 0c planning docs) by
  explicit file list; the third is what makes Step 0's Accept gate reachable. Branch is
  **`gp-demo-4`**.
- **Twelve commits, REQ priority order:** 0, 0b, 0c, 1 `html`, 2.0, 2a, 2b, 2c, 3 report,
  4a params+catalog, 4b theme, 4c reserved columns.
- **Hazards now have mechanisms:** offline lint covers relative refs too, warm-ordering and
  prep-budget warnings fire in `--check`, `storageRoot` is mandatory, the readiness readout tallies
  all four postures, and the no-theme invariant is a golden fixture that 4c explicitly re-baselines.
- **Four items need founder eyes, not a slice decision:** prep-budget wall time, "no readiness
  score exists" as a stage claim, how far theme tokens may repaint the V4 lock, and full-bleed
  `html` slides suppressing V4 chrome.
