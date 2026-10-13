# `demos/` — demo decks for `ces-tester demo:show`

One demo = one `.xlsx` in this directory. ces-tester **loads** decks; it does not author
spreadsheets at runtime. Prime a deck in Excel, drop it here, and run it:

```
npm run build
node bin/ces-tester.mjs demo:show demos/ces-pain-story.xlsx            # operator run (two windows)
node bin/ces-tester.mjs demo:show --check demos/ces-pain-story.xlsx    # headless deck check, exit 0/2
```

## The decks

The canonical catalog of all runnables (scenarios, decks, acts, pipelines) is now
`node bin/ces-tester.mjs catalog`. The table below is kept for quick reference of the
two generator-shipped decks; for the full list run `catalog --json` or open the Command
Center (`node bin/ces-tester.mjs center`).

| Deck | Slides | Declared time | What it is |
|---|---|---|---|
| `ces-pain-story.xlsx` | 12 (14 rows) | 584 s — 9:44 | **The deck you present.** A pain-removal story: the fear, "where do we stand", "how do we get compliant without stopping the business", "how do we stay compliant", "will we survive the assessor", close. |
| `ces-overview.xlsx` | 8 (11 rows) | 280 s — 4:40 | The loader fixture and a short tool-by-tool walk. Shaped to exercise the column contract, not to sell. |

`ces-pain-story` runs `staged` throughout except two slides: slide 8 is `warm` (the AdminOps
console comes up during prep and is standing by when the story reaches day-two operations) and
slide 9 is `live` — the peak, where a real command is submitted and its evidence record writes
itself. **A `live` slide holds past its dwell until the op finishes**, so wall time is 9:44 plus
however long that one op takes.

## Column contract

Row 1 is the header. Headers are matched loosely — lowercased with every non-alphanumeric
stripped — so `Duration (sec)`, `duration_sec` and `DURATION SEC` are the same column. Common
aliases are accepted (listed below). **Unknown columns are ignored with a warning**, so a scratch
column of your own will not break a run.

| Column | Required | Accepts | Notes |
|---|---|---|---|
| `slide #` | yes | whole number ≥ 1 | Rows sharing a value become **one** slide, in sheet order. Numbers need not be contiguous; slides render in ascending order. |
| `talk track` | no | text | The narration. Shown in the presenter band (press `t` to toggle). |
| `feature` | no | text | The slide title. |
| `function` | no | text | What the feature does in the app. |
| `benefit` | no | text | Customer value — cost, schedule, risk, revenue. |
| `differentiator` | no | text | How this is different-better than competitors. |
| `tools` | no | comma-separated `stacksim`, `muster`, `stamper`, `ao`, `eo` | Which CES tools the slide involves. Rendered as chips. |
| `op mode` | no | `live`, `warm`, `staged` | Blank ⇒ `staged`. See "Op modes". |
| `op` | no | a registered op id | Currently: `ao-registry`, `eo-review`, `muster-readiness`, `stamper-translate`, `stamper-execute`. An unknown id is an error. |
| `duration (sec)` | no | positive number | Auto-pacing dwell. Blank ⇒ `--default-dwell` (30 s). |
| `image` | no | path relative to **this directory** | Rendered in place of the auto-rendered body. A missing file is a load-time error; a path that escapes `demos/` is rejected. |
| `html` | no | path relative to **this directory** | A **self-contained** `.html` document rendered in place of the auto-rendered body. Same rules as `image`; beats `image` when both are set. See "HTML slide bodies". |
| `theme` | no | path relative to **this directory** | A theme JSON file that repaints the stage chrome. **Deck-level**: one theme per deck, named on any row. See "Deck theme". |
| `params` | no | `key=value`, one per line (Alt+Enter) | The op's declared parameters. Keys, types, defaults and enum values are published in **[`docs/demo/OP-CATALOG.md`](../docs/demo/OP-CATALOG.md)**; an unknown key or bad value is a load-time error citing that file. Blank is fine — every parameter has a default. |
| `show` | no | text | **Reserved presenter column.** Captured per row and **not rendered** — reserved for a future stage-direction surface. Carrying it no longer produces an "ignored unknown column" warning. |
| `watchouts` | no | text | **Reserved presenter column:** cautions for the presenter, per row. Rendered under the talk track **only with `--watchouts`**, which defaults OFF. |
| `features` | no | one feature per line (Alt+Enter in Excel) | The tool's **major features**, listed under the `function` card. Note the plural: `feature` (singular) is the slide title, `features` is the list. See below. |

### Aliases

- `slide #` — `slide`, `slide no`, `slide number`, `slide id`
- `talk track` — `talk`, `narration`, `narrative`, `script`
- `function` — `functionality`
- `benefit` — `benefits`, `value`
- `differentiator` — `differentiators`, `differentiation`
- `tools` — `tool`, `ces tools`, `modules`
- `op mode` — `mode`
- `op` — `op id`, `operation`, and the demo-act spellings `act`, `demo act`, `demo-act`
- `params` — `parameters`, `op params`, `args`, `arguments`, `options`
- `theme` — `theme file`, `brand`, `branding`
- `show` — `stage direction`
- `watchouts` — `watch out`, `watch`, `cautions`
- `duration (sec)` — `duration`, `duration seconds`, `dwell`, `seconds`, `sec`
- `image` — `images`, `img`, `picture`
- `html` — `html body`, `slide html`, `html file`, `page`
- `features` — `major features`, `feature list`

## HTML slide bodies (`html`)

When the auto-rendered body cannot say it — a branded full-slide graphic, a diagram, a CSS
animation — point the `html` cell at a document in this directory and it is rendered in place of
the body.

- **The file must be self-contained.** It is served from `/asset/<id>` **by id, not by path**, so
  a relative reference inside it (`<img src="logo.png">`, a local font, a stylesheet next door)
  cannot resolve on stage. Inline every asset as a `data:` URI. `--check` warns and names up to
  five offending `src=` / `href=` values — relative and absolute alike — but still loads the deck.
- **It runs in a sandboxed iframe.** CSS animation and inline `<script>` work. The frame is
  opaque-origin (`sandbox="allow-scripts"` with no `allow-same-origin`), so the document cannot
  reach the slides server's state or navigation.
- **Boxed or full-bleed, decided by what you wrote** — there is no extra column:
  - the slide also carries a `feature` title or `function` / `benefit` / `differentiator` text ⇒
    **boxed**: the slide head (number, chips, title) stays and the frame fills the body;
  - the slide carries none of those ⇒ **full-bleed**: the head is suppressed and the document
    fills the whole stage.
- **`html` beats `image`.** Setting both is a warning, not an error; the html renders and the
  image does not.
- A missing file is a **load-time error** and a path escaping `demos/` is rejected — same as
  `image`.

## Major features (`features`)

On a tool slide, list what the tool actually does. Put **one feature per line inside the single
cell** — press `Alt+Enter` in Excel to add a line. Commas and semicolons are *not* separators,
because a feature label routinely contains them.

```
95-command governed registry
Preview-first get-then-set safety
Tier-3 two-person approval
```

- The list renders **under that row's `function` text**, in the muted ramp, smaller than the card
  body — it is supporting detail, not a headline.
- **At most 5 are displayed.** Authoring more is legal: the loader emits a *warning* naming the
  slide and the count, and the slide shows the first five. It is never an error — a deck that
  refuses to open ten minutes before a demo is worse than one that shows a short list.
- Unlike the op fields, `features` is **per row, not per slide**: on a multi-row slide each row
  may carry its own list, and they concatenate in sheet order. Two rows with different lists is
  normal, not a unique-or-agree conflict.
- On a slide that drives an op, the `function` text is promoted into the "Now" lozenge. The
  Function card stays behind to carry the list, so the features still appear.

## Multi-row slides and the op spec

A slide may span several rows — that is how you get three benefit lines under one title. The
narration fields are taken **row by row**; the op fields (`tools`, `op mode`, `op`,
`duration (sec)`, `image`, `html`) belong to the **slide**, not the row, and resolve by
**unique-or-agree**:

- a blank cell inherits from the slide's other rows;
- two rows on the same slide carrying **different** non-blank values for the same op field is a
  **validation error** — never a silent first-wins.

## Op modes

| Mode | Meaning |
|---|---|
| `staged` | Replay only. Nothing is driven. The default, and what `--check` forces for the whole deck. |
| `warm` | The op is started during demo **prep**, before slide 1, and awaited when the slide arrives. For long operations (EO assess ≈ 5 min, Stamper execute ≈ 7 min) this is what keeps them demoable. |
| `live` | The op runs when the slide is entered. The slide **holds** past its dwell until the op completes, then dwells normally. Manual advance is always available. |

### Op parameters — the published catalog

Every op takes **declared parameters** by key, written `key=value` one per line in the `params`
cell. What each op supports — its types, defaults, enum values, typical warm cost and
preconditions — is published in **[`docs/demo/OP-CATALOG.md`](../docs/demo/OP-CATALOG.md)**, and
every parameter error names that file by path.

```
op:      eo-review
op mode: live
params:  family=AC
         land=evidence
```

There are deliberately **no step-level primitives** — no `click`, `navigate`, `wait` or selector
cells. A deck names a *demo act* ("browse the determinations"), never a mouse click; selectors stay
in ces-tester, where a sibling's markup change is a code fix rather than a broken deck.

`--check` also **sums the warm ops' typical cost** and warns above five minutes, naming the total
and the contributing ops — that is wall time the presenter commits to before slide 1 appears.

### Operator prerequisites for `muster-readiness`

`muster-readiness` spawns ces-muster's headless discovery CLI —
`../ces-muster/muster-api/dist/cli/bin.js`. **ces-tester never builds a sibling**, so that
`dist/` must already exist (`npm run build` in ces-muster, by the operator). If it does not, the
op does **not** fail the show: it renders an "evaluation unavailable" readout naming the missing
path, and the Readiness Evaluation beat silently degrades. Check it before a rehearsal.

Two things the op deliberately does not claim, because ces-muster does not produce them:

- **No readiness score.** DISCOVERY-1 yields a per-control posture and nothing else. The readout
  says so in as many words. (EO's SPRS score is a different number from a different tool.)
- **No "gap discovery".** DISCOVERY-1 is *presence*-based: `IA.L2-3.5.3` reads `met` before
  remediation because the policy exists but is report-only. Gap depth belongs to the Assessment
  (EO) beat.

The readout tallies **all four** postures the ces-muster schema permits — `met`, `not_met`,
`partial`, `unknown` — plus anything the schema gains later, named rather than dropped.

### The Configuration ops run BACKSTAGE

`stamper-translate` drives the Stamper Configuration GUI, and **that GUI is never shown on
stage**. Stage doctrine (THREAD_HANDOFF) gives Configuration no live product demo, and `warm` is
not automatically off-stage: a warm op is dispatched while the deck advances, so warm work in the
app pane happens in the window the audience is watching.

So the runner opens a **backstage session** during prep — a second, headless, never-displayed
browser — and the Stamper ops drive that. The visible app pane sees a Configuration op only as an
outcome readout, and only on a `live` slide. The backstage session is created **only** for a deck
that drives a stamper op, and it is closed before the servers it was driving are killed.

Consequences worth knowing when authoring:

- **Port 3000 is probed and the Stamper GUI is started only when a stamper op is in the deck.** A
  deck with none never touches :3000.
- **The mission plan and manifest come from `assets/demo-plan/demo-dib-small/`** (see
  `assets/demo-plan/README.md` for provenance). `demo:show` never runs the planner wizard.
- **`warm` is the sensible mode.** Connect + assess + translate is minutes of work; on a `live`
  slide the slide holds for all of it.

**Order your two Config beats.** `stamper-execute` takes a ~5-minute fast path when the backstage
page already connected and translated — which a **warm `stamper-translate` on an earlier slide**
is what provides. Without one it self-heals by running the whole flow: still real, but ~12 minutes
of prep instead of ~7. `--check` emits a warning naming the slide when a deck is ordered that way,
because warm ops fire during prep **in deck order**.

`stamper-execute` is judged by the **execution report on disk**, never by the GUI's status badge —
that badge has been measured reading `Complete` on a run the report called `partial` (80/110). Known
sim-only verification failures are reported and skipped; only unexpected failures fail the op.

## The in-slide app mirror (T1.5)

By default `demo:show` renders the live app **inside the slide's right third** — a CDP screencast
of the app pane, streamed as MJPEG into an `<img>` on the slide — instead of a separate second
window. There is nothing to author: the mode is resolved from the op catalog per act, not from a
sheet cell. `--pane-window` restores the old two-window behaviour for rehearsal (and then no split
is drawn).

Each op declares one of three mirror modes in the catalog:

- **`theatrical`** — the live GUI is the beat. The AO / EO / Muster GUI acts stream the real app
  being driven into the right third.
- **`readout`** — the op's own **real result card** is the beat. The readout acts
  (`muster-readiness`, `simstack-create`, `simstack-destroy`, `stamper-translate`,
  `stamper-execute`) navigate the visible pane to an outcome card built from **this run's** numbers,
  and that card streams into the right third — so the on-stage figures match the run, never a
  pre-authored static value. For the Configuration ops this is doctrine-safe: the GUI work still
  runs on the unmirrorable **backstage** session; only the finished result card ever reaches the
  visible pane, so the Configuration GUI is never on stage.
- **`none`** — nothing is surfaced (no act is `none` today).

**The drive is performed, not just executed (GP-DEMO-6 theatre).** The visible pane's seam is
wrapped in `src/demo/show/theatrical-page.ts`: every click glides the branded pointer to its target
first, every field is typed at a human cadence, every action settles for a beat so the app's response
is seen. Reads are untouched. An op that runs real work with no UI of its own (the ~80 s DISCOVERY-1
walk in `muster-readiness`) pins a small HUD over the app that says what is running and for how
long — the pane is never silently blank while the on-air klaxon is red. `muster-readiness` now
puts the Muster SPA on stage *before* the walk starts and performs the manifest beat while it runs,
then visibly imports this run's result. The same HUD covers every other UI-less wait: the
`muster-auto-analysis` walk, the `eo-review` assess (warm or live-recover), the off-screen manual
branch of `muster-adaptive-interview`, and the minutes `stamper-translate` / `stamper-execute` spend
on the backstage session — which, because it streams on `/mirror/backstage` for those slides, gets
the theatre too on a mirror-active run (and stays at full speed under `--pane-window`, where nothing
sees it). The pure GUI acts (AO, EO walk, the Muster connect / consent / export beats) need nothing
extra: the wrapper is on the pane seam, so they are performed by construction.
To observe a run without watching the screen: `scripts/dev/theatre-proof.cmd` (build → tests →
`--check` every deck → headed runs of `demos/mini-sim-muster.xlsx` and `demos/mini-muster-gui.xlsx`
with `scripts/dev/grab-mirror.mjs` saving what the pane streams as JPEG frames under
`runs/theatre-proof/<deck>/`). `mini-muster-gui.xlsx` is generated by
`scripts/dev/make-mini-muster-gui.mjs` — the five Muster GUI acts, live, in deck order.

**Authoring rule — the readout still needs authored slide content when it is NOT driven.** A
mirrored card only appears when the op actually runs on stage (a `live` or `warm` slide with the
mirror active). Two cases render **no** card, so their audience-facing outcome must be authored as
slide content (an `html` cell or Function/Benefit/Differentiator cards) on the op's slide:

- a **`staged`** readout slide (the op is replayed, not driven — the split gate excludes staged), and
- a **`--pane-window`** run (the readout shows in the second window, not the slide) and every
  `demo:show --check`.

So: put the beat's meaning in the slide text, and let the mirror card add the run-accurate numbers
on top when the op is driven. Do not rely on the mirrored card alone to carry a beat.

## Reserved presenter columns (`show`, `watchouts`)

Both were already appearing in authored decks and warning as unknown columns on every load. They
are now **reserved**, so the warnings stop and the meaning is fixed.

- **`show`** is captured per row and **never rendered**. It holds stage directions for a future
  surface; writing it today costs nothing and changes nothing on screen.
- **`watchouts`** holds cautions for the presenter — "the sim is slow here", "don't click Refresh".
  Run with **`--watchouts`** and they appear in the presenter band under the talk track, in the
  muted amber ramp behind a hairline. **Without the flag the band is byte-for-byte as it is
  today**; the cues are still carried in the deck, they are simply not drawn.

Both are **per row**, like `talk track` — two rows of one slide each carrying a cue is two cues,
not a unique-or-agree conflict.

```
node bin/ces-tester.mjs demo:show demos/ces-pain-story.xlsx --watchouts
```

## Deck theme (`theme`)

Point the `theme` cell at a small JSON file in this directory and the presenter shell repaints its
CSS variables. **One theme per deck** — stage chrome is a property of the deck, not of a slide, so
it resolves across the whole file and two slides naming different themes is an error. With no
`theme` cell the shell renders exactly as it does today, pinned byte-for-byte by a golden fixture.

```json
{
  "tokens": { "gold": "#00b3ff", "navy": "#101820" },
  "logo": "themes/acme.svg"
}
```

Start from **`demos/themes/example-bhd.json`**, which is the current palette written out.

| Token | What it paints |
|---|---|
| `navy`, `navy-deep`, `navy-mid` | The stage grounds |
| `gold` | The accent. It is rationed to ≤3 elements per state by design — a theme changes its hue, not its budget |
| `t1`, `t2`, `t3`, `t4` | The text ramp, brightest to most muted |
| `pass`, `warn` | Status colours. Failures are **amber**, never red |
| `hair`, `hair-soft`, `kbd-line` | Hairline rules — elevation is hairlines only, never panel fills |
| `font-sans` | The body face |

- **Values are a whitelist, not free CSS.** Colours accept `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`
  and `rgba()`; `font-sans` accepts a font-family list. Any value containing `;`, `{`, `}`, `@`,
  `url(`, `<`, `>` or a comment opener is **rejected** — those can end the declaration and start
  writing rules of their own.
- **An unknown token is a load-time error**, listing the ones that exist.
- **Motion tokens are not themeable.** Retiming the transitions breaks the reduced-motion
  behaviour the sheet guarantees.
- **The `logo` is optional, must be an `.svg`, and is served from `/asset/<id>` — never inlined.**
  An `<img>`-referenced SVG cannot execute script, which is why serving it is safe where inlining
  it would not be.
- Theme declarations are emitted **after** the locked sheet, so they win on cascade order alone —
  there is no `!important` anywhere.

## Run reports

Every operator run writes **`runs/show/<runId>/report.json`** — the same directory the run's
screenshots land in, so a report and the evidence it references sit together.

It carries: the deck (path, title, counts, every load-time warning), how the run was configured,
**declared vs actual dwell for every slide** with one entry per visit, how each slide was left
(`auto` tick / `manual` next-prev / `jump` / `end`), how many manual advances there were, every
mid-run `auto`/`presenter` toggle as a timestamped event, and per op its id, mode, start, end,
outcome and the evidence files it produced.

- The format is documented by **`schemas/demo-show-report.schema.json`** — every field carries a
  description, and a test validates a produced report against it.
- **`--check` never writes one.** It is an operator-run artifact.
- **`--no-report`** suppresses it.
- The report is written **before teardown**, so a failure while killing servers and browsers
  cannot cost you the evidence for the run that just happened.

Use it to retime a deck: a slide whose `actualDwellMs` is consistently far from its
`effectiveDurationSec`, or a high `manualAdvances` count, is a deck whose declared durations are
wrong.

## Errors

A malformed deck fails to load with **every** problem listed at once, each citing the 1-based
spreadsheet row you see in Excel, and exits `2`. Nothing is rendered partially.

```
demos/ces-overview.xlsx row 7: "op mode" must be one of live|warm|staged (got "livee")
demos/ces-overview.xlsx row 9: "duration (sec)" must be a positive number of seconds, or blank for the run default (got "soon")
```

## Regenerating the checked-in decks

Both checked-in decks are generated, so both regenerate byte-for-byte and both are reviewed as
source rather than as binaries:

```
node scripts/make-demo-xlsx.mjs                                  # -> BOTH decks
node scripts/make-demo-xlsx.mjs some/other.xlsx                  # -> ces-overview, there
node scripts/make-demo-xlsx.mjs --deck ces-pain-story out.xlsx   # -> pain-story, there
```

Edit `STARTER_ROWS` / `PAIN_STORY_ROWS` in `scripts/make-demo-xlsx.mjs`, re-run it, and re-run
`--check`. Talk-track wording lives in that file for a reason: prose gets rewritten many times, a
text diff shows what changed and a workbook diff does not.

**Authoring a third deck is still an Excel job.** The generator is not a general authoring tool —
it holds the two decks the repo ships and tests. Prime a new one in Excel against the column
contract above and drop it in this directory.
