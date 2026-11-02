# REQ-TESTER-DEMO-RICHNESS-2026-09-06

**To:** ces-tester · **From:** ces-strategy · **Status:** filed (founder-approved 2026-09-06)
**Context:** `ces-strategy/docs/DEMO-PIPELINE-PROPOSAL-2026-09-05.md` — approved split: strategy
authors demo decks as finished products; tester loads, presents, and drives them via the
existing `demo:show` column contract. Deck #1 (`ridgeline-run.xlsx`, generated in strategy from
reviewable source with claim-bar + identity lint) already passes `demo:show --check` (exit 0,
2026-09-06) with zero tester changes. This REQ asks for the contract extensions that unlock
rich, multi-demo authoring.

## Asks (in priority order)

### 1. `html` slide-body column
Like `image`, but a **self-contained HTML file** (relative to `demos/`, same path-escape
rejection) rendered in place of the auto-rendered body. No network access assumed (no CDN
fetches — decks must present offline). This is the unlock for branded graphics, diagrams, and
CSS animation authored in strategy against `docs/design/BHD-BRAND.md`; your
`docs/design/mockups/v2-keynote-dark.html` is the direction we'd author toward.
- Accept: a slide with `html: slides/foo.html` renders that document; a missing file is a
  load-time error (parity with `image`); `--check` validates existence.
- Suggested precedence when both given: `html` wins over `image`, warn.

### 2. Register the remaining demo-arc op ids
**Amended 2026-09-06:** two ops are already registered (`ao-registry`, and `eo-review` — whose
warm-runs-assess-off-stage / live-walks-the-result split is exactly the right shape; deck #1 now
uses both). The remaining arc needs:
- `muster-readiness` — run the readiness evaluation against the sim; surface score availability.
- `stamper-translate` — compile the plan.
- `stamper-execute` — apply the plan against the sim (skip-list for known sim false-FAILs).
(`eo-review` may already cover the eo-assess/evidence-verify asks — your call whether one op
with mode-branching or split ops serves the arc better.)
`warm` support matters most for the long ones (EO assess, Stamper execute), per your own
pain-story pattern (slide 8 warm / slide 9 live).
- Accept: each op id loads in `--check`; `warm` pre-start + `live` hold semantics as documented
  in `demos/README.md`.

### 3. Run-report artifact (closes the authoring loop)
After a `demo:show` run, emit a JSON report to `runs/` (or alongside the deck): per-slide
declared vs actual dwell, manual advances, op outcomes (id, mode, start/end, pass/fail,
evidence-artifact refs), and screenshot paths if captured. Strategy consumes this to iterate
deck content — the same assess → execute → verify loop CES itself sells, applied to demos.
- Accept: a documented, schema'd report file per run; `--check` unaffected.

### 4a. Parameterized ops + a published op catalog *(added 2026-09-06, per DEMO-CONTROL-GAP)*
Ops stay tester-implemented, but each declares parameters the deck may set (examples: which
registry command `ao-registry` submits; whether `eo-review` lands on the Evidence Explorer or
the determination viewer; which control to spotlight). Tester publishes an **op catalog** —
id, what it shows, supported modes, parameters, preconditions — as the authoring vocabulary.
This is how "strategy controls tool tie-in" becomes true **without** step-level primitives
(click/navigate/wait) leaking selectors into deck content, which both sides should refuse.
- Accept: a params cell (or columns) validated per-op by `--check`; a catalog doc the loader's
  errors can cite.

### 4b. Deck-supplied theme *(added 2026-09-06, per DEMO-CONTROL-GAP)*
A small theme file (colors, logo variant, typography tokens) referenced by the deck and applied
by the presenter shell — stage chrome matches the story's brand without strategy touching the
renderer. Low effort if the shell already reads CSS variables.

### 4c. Reserved presenter columns (small, optional)
`show` and `watchouts` currently ride as ignored-unknown columns (warned every load). Formally
reserving them (ignore silently, or render `watchouts` into the presenter band behind a flag)
would quiet the warnings and give presenters their cues in-tool. Low priority; the warning is
livable.

## Boundary notes
- Strategy writes **op intents by id only** — implementations, selectors, and environment
  handling stay yours.
- The deck schema stays **tester-owned**; strategy validates against `--check` before any
  hand-off. (Standing founder reminder exists to revisit promoting the schema to ces-shared
  once both sides depend on it.)
- Deck drops into `ces-tester/demos/` happen only on per-deck founder approval.

## Legend
- **demo:show / --check** — tester's deck presenter / headless validator.
- **op / op mode** — a tester-registered product operation a slide can drive (`staged` replay ·
  `warm` pre-started · `live` runs on entry, slide holds).
- **Ridgeline Run** — strategy's 10-beat demo (source: `ces-strategy/demo-decks/ridgeline-run.py`).
- **Claim-bar lint** — strategy's build-time scan barring figures/claims per FEATURE-INDEX §B
  plus banned identifiers.
