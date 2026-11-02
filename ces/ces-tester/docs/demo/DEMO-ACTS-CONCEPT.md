# Concept / Feasibility — "Demo-Acts": named, visible, evolving demo primitives

**Date:** 2026-09-06 · **Status:** CONCEPT — awaiting founder decision (§4) · **Repo:** ces-tester
**Answers:** *Can we do this? How? What form? What acts would we need?*
**No code changed by this document.**

## The ask, restated

An **evolving set of named "demo-acts"** — each a small set of actions against ONE CES tool that
accomplishes a routine end (make a half-configured simstack; run readiness and show the result).
During an act the audience must **see the cursor move and the UI interact**. Acts are encoded in
the demo-definition `.xlsx`, and `demo:show` runs them from there. *"These are demo primitives."*

**Short answer: yes — and two-thirds of it already exists.** The registry of named,
tester-implemented, deck-addressable primitives is `src/demo/show/op-registry.ts`; the `.xlsx`
already carries `op` + `op mode`, and `PLAN-DEMO-RICHNESS` Slice 4a adds `params` + a published
catalog. The genuinely new engineering is **one thing**: a visible cursor. Everything else is
naming, catalog entries, and a handful of new acts.

---

## 1. Feasibility + mechanics of visible-cursor interaction

### 1.1 The problem is real

The app pane is a headed Chromium launched by `openPositionedUiPage` (`src/demo/ui-page.ts`
L245-268, Playwright `^1.61.1`). Playwright dispatches input over CDP: the page receives real
trusted `mousemove` / `mousedown` events, but **the OS never draws a pointer**. Today an audience
watching an `ao-registry` op sees fields fill themselves with no visible cause. Under `--watch`,
`WATCH_SLOW_MO_MS = 250` (`src/demo/watch-mode.ts`) slows it down but shows nothing more.

### 1.2 The technique — assessed, and it works here

Inject a branded cursor overlay into the driven page and let it **track the page's own mouse
events**, so it follows any `page.mouse.move()` automatically.

```js
// installed via page.addInitScript(...) — runs before page scripts, on EVERY navigation
const dot = document.createElement('div');          // BHD gold ring + navy core
Object.assign(dot.style, { position:'fixed', zIndex:'2147483647', pointerEvents:'none', ... });
addEventListener('mousemove', e => { dot.style.left = e.clientX+'px'; dot.style.top = e.clientY+'px'; }, true);
addEventListener('mousedown', () => dot.animate(PULSE, 260), true);
```

Then the driver's job is only cadence:

- `page.mouse.move(x, y, { steps: 24 })` → smooth glide, overlay follows for free.
- `mouse.down()/up()` → the CSS click-pulse fires from the page's own event.
- `keyboard.type(text, { delay: 45 })` → human typing (instead of Playwright `fill`, which is
  instantaneous DOM assignment).
- A short `evaluate()` before each act step draws a **highlight ring** around the target's
  bounding box, so the audience knows where the cursor is going before it arrives.

**Why this is cheap here:** every driver and op in this repo is written against the narrow
`UiPage` seam (`ui-page.ts` L32-52), and `UiSession.raw` already exposes the underlying Playwright
`Page` (L134-139) for exactly this kind of extension.

### 1.3 The recommended shape: a `UiPage` decorator, not a new API

```ts
// src/demo/show/theatrical-page.ts  (NEW — proposed)
export function theatricalPage(raw: Page, inner: UiPage, cadence: Cadence): UiPage;
```

- `click(sel)` → `boundingBox()` → `mouse.move(cx, cy, {steps})` → dwell → `down/up`.
- `fill(sel, v)` → theatrical click, then `keyboard.type(v, {delay})`.
- `selectOption` / `check` → cursor travel, then delegate to `inner` (native select popups are
  OS-drawn and cannot be overlaid — travel is the honest part, the choice stays programmatic).
- Everything else (`textContent`, `texts`, `getJson`, `screenshot`, waits) delegates unchanged.

**Consequence — this is the strongest feasibility argument:** because `runEoUiFlow`,
`runStamperUiFlow` and `runAoUiFlow` all take a `UiPage`, wrapping the app pane's page gives every
existing op cursor theater with **zero changes to any flow, selector, or ordering rule**. The M4
ordering guarantees (AO's toggle-before-tenant, Stamper's sticky dry-run guard) are untouched.

`app-pane.ts` gains one option — `theatrical?: Cadence` — and `openAppPane` returns
`theatricalPage(session.raw, session.page, cadence)` as its `page`. Nothing downstream knows.

### 1.4 What has to be built (nothing exists today)

Verified by grep across `src/`: **zero** uses of `addInitScript`, `addStyleTag`, `evaluate(`, or
`exposeFunction`. There is no precedent for injecting anything into a sibling's page, and `UiPage`
exposes no evaluate-style method. So: the overlay script, the decorator, a `Cadence` record
(travel steps, dwell ms, type delay — the `WatchMode` pattern), and CSS tokens from
`docs/demo/design/BHD-BRAND.md` (navy `#1a2332`, gold `#f5b74a`, glow `rgba(245,183,74,0.25)`,
Roboto). ~250 lines, unit-testable against a hand-written `UiPage` plus a fake `Page`.

### 1.5 Risks, each with its handling

| Risk | Reality | Handling |
|---|---|---|
| **CSP on a driven app** | `addInitScript` is injected over CDP (`Page.addScriptToEvaluateOnNewDocument`) and is **not** subject to `script-src`. Overlay styling uses CSSOM property assignment (`el.style.left = …`), which `style-src` does not govern — only parsed inline `<style>`/`style=` attributes are. | Low risk. Never inject a `<style>` tag; set properties. Verify once per driven surface (:3000, :3001, :4002) during the build slice. |
| **Page wipes injected DOM on navigation** | Documented for the EO SPA: it does not rehydrate on load, and a `goto` clears state (`IMPLEMENTATION_LOG.md` §eo-review L3053-3072). | `addInitScript` **re-runs on every navigation and every frame** — this is the mitigation, not a workaround. Belt-and-braces: `ensureOverlay()` re-asserts the element before each theatrical step. |
| **Iframes** | A top-document listener never sees moves landing inside a cross-frame document. | `addInitScript` runs per-frame, so each frame gets its own overlay. Where a frame is opaque-origin, fall back to wrapper-driven positioning (the decorator knows the coordinates it just sent). None of the three driven GUIs uses iframes today. |
| **`fill` → `type` changes behavior** | `type` fires real keystrokes; some inputs validate/debounce per keystroke where `fill` fired one `input`. | The decorator's `fill` is opt-in per act. Any field with a known ordering trap (Stamper `#execTargetSelect`, AO tenant box) keeps native `fill` + the existing verify-it-stuck assertions. |
| **Double pacing** | `slowMo: 250` plus theatrical cadence = a demo that crawls. | Theatrical acts run `slowMo: 0`; cadence owns pacing. Assert it in the act's context. |
| **Data-URL readout pages** | `htmlDataUrl()` pages (`op-registry.ts` L122) have no UI to interact with. | Readouts declare `cursor: none`. No overlay, no theater — they are results, not interaction. |
| **Headless / `--check`** | `--check` forces every op to `staged` and never reaches an implementation. | Theater is app-pane-only and is a no-op headless. `--check` behavior is unchanged by construction. |

**Verdict: feasible, standard, low-risk, and disproportionately cheap** because of the `UiPage`
seam. Estimated one slice for the layer, one for the terminal-theater renderer (§3).

---

## 2. Form — what a demo-act IS

### 2.1 Recommendation: acts ARE the ops, evolved. Do not build a second abstraction.

The op registry already satisfies most of the founder's definition: a **named**,
**tester-implemented**, **deck-addressable** primitive with **modes** and **honest verification of
the end state** (`eo-review` judges the API, not the DOM; `stamper-execute` judges the on-disk
report, never the `#cardStatus4` badge). "Demo-act" is the **founder-facing name for a registry op
with a theatrical script**. Ops are not recast *into* acts and acts do not compose *into* ops —
they are the same object, described more completely.

An act entry (extending Slice 4a's `OpCatalogEntry`):

| Field | Meaning |
|---|---|
| `id` | Stable act id — what the deck writes (`eo-review`, `ao-registry`, …). |
| `version` | Integer, bumped when what the audience sees changes. Recorded in the run report; **never written in the deck**. |
| `stageName` | On-stage product name (RE / Config / Ops / Assessment). |
| `target` | The one CES tool it acts on. One act, one tool — the founder's rule. |
| `shows` | One sentence: what the audience sees. |
| `modes` | `live` / `warm` / `staged`. |
| `params` | Declared parameters (Slice 4a `ParamSpec[]`) — the only knob the deck turns. |
| `preconditions` | Arming needs; deck-ordering needs (warm-before-live, no pane-navigating act in between). |
| `script` | The theatrical drive: travel → highlight → click → type, in the app pane. |
| `verify` | The honest end-state check, from the tool's own API/artifact — never the DOM. |
| `cursor` | `theatrical` \| `none` (readouts, terminal-theater). |

### 2.2 How the deck references an act — **no new columns needed**

The existing contract already is the encoding the founder envisioned:

| Cell | Today | Under acts |
|---|---|---|
| `op` | registered op id | unchanged; **add header aliases `act`, `demo act`, `demo-act`** so the founder's vocabulary works in Excel |
| `op mode` | `live`/`warm`/`staged` | unchanged |
| `params` | *(Slice 4a)* `key=value`, one per line | unchanged — this is how an act is parameterized |
| `duration (sec)` | dwell | unchanged; a `live` act holds past its dwell |

One cheap addition worth taking: **act aliases in the catalog** — a named preset that resolves to
`id` + default params, pure data, no new code path:

```
eo-verify-evidence       →  eo-review   land=evidence   # ends on the Evidence Explorer
eo-browse-determinations →  eo-review   land=sprs       # matrix -> family NOT-MET -> SPRS score
```

(`land` names where the walk *ends*; every landing walks the matrix and the family determinations
first, which is the beat the alias name describes.)

That gives the founder genuinely *named* acts at the granularity of "a routine end" without
proliferating implementations, and it is where the set **evolves**: new names are catalog rows.

### 2.3 Why this satisfies REQ 4a's boundary (asked explicitly)

REQ-TESTER-DEMO-RICHNESS §4a refuses **step-level primitives** — `click` / `navigate` / `wait`
cells that leak selectors into deck content. Acts are the opposite of that and are in fact the
mechanism the REQ named:

- The deck writes **an id and declared parameters**. It never writes a selector, a URL, a port, a
  timeout, or an ordering rule.
- Every selector, every wait, every environment concern, and the entire theatrical script stay
  **inside ces-tester**, versioned with the sibling GUIs they track. When ces-eo moves a tab,
  ces-tester fixes an act; no deck changes.
- The **published catalog** (`docs/demo/OP-CATALOG.md`, Slice 4a) is the authoring vocabulary, and
  loader errors cite it by path.

"Demo primitive" is the right word — the primitive is the *routine end*, not the mouse click.

---

## 3. Initial act catalog — and an honest map of what UI actually exists

**The honesty problem, stated up front:** cursor theater requires a GUI. This repo *drives* exactly
three: **Stamper GUI :3000**, **AO GUI :3001**, **EO SPA :4002**. stacksim is an HTTP service
(`serve` on :4390) with no GUI.

> **CORRECTION (§7, this document).** This paragraph originally read: *"There is **no ces-muster
> GUI**… Readiness Evaluation is a headless CLI."* **That was wrong.** ces-muster ships a Vite +
> React SPA (default port 5173) with 76 `data-testid` hooks and its own Playwright suite. What is
> true is narrower: **ces-tester has no Muster GUI *driver*** — `src/muster-driver/*` drives
> **ces-planner's** wizard, and this repo's own comments mislabel that surface "Muster"
> (`e2e-run.ts` L849, `demo-command.ts` L65). See §7.1 for the root cause and §7.3 for the five
> acts this error omitted. The rows below are corrected; the original text is preserved here
> rather than silently rewritten.

So acts come in three visual grades:

- **CURSOR** — real UI, real pointer, real interaction.
- **TERMINAL-THEATER** *(new, §5)* — the pane renders a BHD-navy terminal card and streams the
  CLI's real stdout line by line, with a typed command line. Honest: it is the real command and
  the real output, presented. Not a fake GUI.
- **READOUT** — a `htmlDataUrl()` result card (the existing `stagedReplayHtml` pattern).

| Act (name in deck) | Target tool | Surface | Grade | What the audience sees | Status |
|---|---|---|---|---|---|
| `simstack-create` | stacksim :4390 | CLI + HTTP | TERMINAL-THEATER | The half-configured tenant being seeded — command typed, ledger rows landing, "MFA policy absent" as the deliberate gap the story needs | NEW. Today this is invisible prep arming (`arm-sim.ts`); promoting it is a deliberate change, aligned with the founder's *"stacksim is product, never hidden plumbing"* note |
| `muster-readiness` | ces-muster | **CLI lane** (`mu discovery --sim`) — *not* the only Muster surface, see §7 | TERMINAL-THEATER → READOUT | `mu discovery --sim` running for real, then a card: control count, met/unknown tallies, read-only ledger delta = 0, and **"no readiness score is produced by DISCOVERY-1"** | PLANNED (Slice 2a). **CORRECTED (§7):** this row is right about the CLI act but was written believing it was the *only* option. Muster also has a full SPA — five GUI acts are added in §7.3 |
| `stamper-translate` | Stamper GUI :3000 | GUI exists | CURSOR-capable, **doctrine-blocked** | Today: a readout of tasks compiled. With §4 option B/C: the Config UI walked | PLANNED (Slice 2b) |
| `stamper-execute` | Stamper GUI :3000 | GUI exists | CURSOR-capable, **doctrine-blocked** | ~7 min — `warm` regardless. Live slide shows applied/failed counts from the on-disk report | PLANNED (Slice 2c) |
| `ao-registry-command` | AO GUI :3001 | GUI | **CURSOR** | Cursor searches the 95-command registry, opens the form, flips the live toggle, sets tenant, hits Execute; the evidence record writes itself | EXISTS (`ao-registry`) — add theater + warm/live split (it has neither today) |
| `eo-assess` | EO SPA :4002 | GUI | CURSOR (off-stage) | ~5 min — `warm`. Tenant → Connect → Assess | EXISTS as `eo-review` warm phase |
| `eo-browse-determinations` | EO SPA :4002 | GUI | **CURSOR** | Cursor walks the compliance matrix, filters IA to NOT-MET, opens the SPRS score | EXISTS as `eo-review` live phase; becomes an alias (`land=sprs`) |
| `eo-verify-evidence` | EO SPA :4002 | GUI | **CURSOR** | Cursor opens the Evidence Explorer and opens the record the AO act just wrote | Alias `eo-review land=evidence` (Slice 4a already specs the param) |
| `ao-make-change` | AO GUI :3001 | GUI | **CURSOR** | The remediating change submitted on stage — the "fix it" beat | NEW. Same flow as `ao-registry-command`, different `command` param |
| `eo-show-change-captured` | EO SPA :4002 | GUI | **CURSOR** | Re-assess, then the cursor walks to the control that flipped and the delta | NEW (composes `eo-assess` + a delta-aware browse) |

### 3.1 The founder's arc, cast in acts

**assess → remediate → re-assess → evidence → ops-change**

| Beat | Act | Mode | Why |
|---|---|---|---|
| Set the stage | `simstack-create` | warm | The gap is deliberate and shown, not asserted |
| Point at the tenant | `muster-connect-tenant` | live | **RE, doctrine-gated (§7.5).** Declare mode, auth tier and tenant before claiming anything |
| Where do we stand | `muster-auto-analysis` | live | **RE, doctrine-gated.** Real CLI walk (zero-writes ledger delta), imported into the SPA — never the fixture button |
| A human signs for it | `muster-run-analysis-scripts` → **`muster-consent-and-attest`** | live | **RE, doctrine-gated.** Named-human attestation; nothing auto-drafted becomes an attested fact |
| Fewer questions to answer | `muster-adaptive-interview` | live | **RE, doctrine-gated.** The question count visibly drops because discovery already answered them |
| The score and the plan | `muster-generate-sprs-mp` | live | **RE, doctrine-gated.** SPRS, gaps, and the Mission Plan Stamper will execute |
| *(doctrine-safe substitute for the five above)* | `muster-readiness` | live | The CLI lane — terminal-theater, honest and fast, **not** doctrine-gated |
| The assessment | `eo-assess` | **warm** | ~5 min, off stage |
| The verdict | `eo-browse-determinations` | live | CURSOR — the peak of the "will we survive the assessor" beat |
| Remediate | `stamper-execute` | **warm** | ~7 min, off stage; readout on its slide |
| Re-assess | `eo-show-change-captured` | live | CURSOR — the flip, proven |
| Day-two ops | `ao-make-change` | live | CURSOR — a real governed command |
| Evidence | `eo-verify-evidence` | live | CURSOR — the record that wrote itself |

**Deck-ordering rule that must be in the catalog:** warm acts fire during prep in **deck order**
through one serialized queue (`op-registry.ts` L142-152), and `#cardStatus3` / the EO matrix are
**page** state, not server state — a pane-navigating act between a warm act and its live partner
forces the (honest, slow) self-heal path. The catalog states this; it is not the deck author's
problem to infer.

---

## 4. DOCTRINE TENSION — founder decision required

**The conflict is real and this document does not resolve it.**
`docs/context/THREAD_HANDOFF.md` §"Stage naming + show format" is BINDING:

> **RE and Config: NO live product demo.** Show the hub-and-spoke model as a drawing instead.
> Describe WHAT they do, never HOW they work. · **Ops and Assessment: LIVE.**

⚠ **SUPERSEDED (2026-09-07).** Decision 9 lifted the restriction for RE (Muster); **decision 11
lifted it for Config (Stamper) too** — the Configuration GUI now streams live from the headless
backstage session (`/mirror/backstage`, `mirrorSource: backstage`), never by driving the visible
pane. All five capabilities are now live-eligible; only the *how* (backstage vs pane) still differs.

The new ask names *"a demo-act to run Muster on that simstack and show the result"* with visible UI
interaction — which for RE is a live product demo of a capability the doctrine excludes.
`PLAN-DEMO-RICHNESS` currently lists live RE/Config demos in **Out of Scope** on that authority.

> **⚠ CORRECTION — THIS SECTION'S CENTRAL ARGUMENT WAS WRONG (see §7.4).** The paragraph below
> claimed *"even if the rule is lifted, RE cannot get a cursor walk — there is no Muster GUI to
> walk,"* and concluded that lifting the rule buys only a live Config walk. **False.** ces-muster
> has the richest GUI surface in the fleet for cursor work — 76 `data-testid` hooks, its own
> Playwright happy path, a fluid single-column layout that mirrors well, and no CSP. **Founder
> decision 2 of 2026-09-06 (doctrine holds) was taken with this incorrect input in front of it and
> should be revisited on the corrected facts.** The original text is kept below, struck through in
> effect, so the record shows what changed. The rest of §4 — options A/B/C and the recommendation
> mechanism — still stands; only the RE-can't-be-walked premise is void.

*(Superseded, retained for the record:)* ~~**One asymmetry the decision turns on, and it is not
obvious:** *even if the rule is lifted, RE cannot get a cursor walk.* There is no Muster GUI to
walk. Lifting the rule buys a live **Config (Stamper GUI)** walk and nothing more; RE's ceiling is
terminal-theater either way.~~

**Corrected asymmetry:** the imbalance runs the *other* way. **RE has the strongest live-demo case
of any capability** (a purpose-built assessor SPA whose whole workflow is audience-legible);
**Config remains the weak case** (a task-runner GUI whose value is the artifact, not the screen).
If doctrine is relaxed for one and not the other, relax it for **RE**.

| | Option A — doctrine holds *(recommended)* | Option B — amend the doctrine | Option C — per-deck stage-format override |
|---|---|---|---|
| **What happens** | CURSOR acts for Ops, Assessment, and stacksim's terminal-theater. RE/Config do real work `warm` and land a readout | RE/Config become demoable on stage: Config gets a live Stamper GUI walk, RE gets terminal-theater | Doctrine is the default; a deck may set `stageFormat = engine-room` to unlock Config/RE walks |
| **Founder ask met** | Partly — visible interaction everywhere a UI exists; Muster is shown honestly as CLI | Fully for Config; **still not** a Muster UI (none exists) | Fully, per audience |
| **Cost** | Zero doctrine change; PLAN unchanged | Amend THREAD_HANDOFF + PLAN Out of Scope; ~5 min of stage time for a live translate | Small: one deck-level column + a catalog `requiresStageFormat` flag |
| **Risk** | Founder's new ask is partially declined | "Describe WHAT, never HOW" is the differentiator-protection rule; a Stamper walk shows HOW | Two stage formats to keep honest; a mis-set deck shows internals to a sales audience |

**Recommendation: A now, C as the mechanism when a technical audience actually needs it.**
Rationale: (1) the doctrine's purpose — don't show competitors HOW — is unharmed by cursor theater
on Ops/Assessment, which is where the emotional peak of the pain-story already lives; (2) B's
payoff is one live Stamper walk that costs ~5 minutes of stage time and cannot fix the RE gap
anyway; (3) C preserves the sales-deck doctrine intact while giving the founder an explicit,
per-deck, auditable switch for evaluator/engineering audiences.

**This is a founder call, not an architect's.** Options B and C both require amending
THREAD_HANDOFF §"Stage naming + show format" **and** `PLAN-DEMO-RICHNESS` Out of Scope. This
document surfaces that; it does not do it.

---

## 5. Sequencing against PLAN-DEMO-RICHNESS

**Recommendation: `PLAN-DEMO-RICHNESS` proceeds unamended. Acts land as a follow-on phase.**

The plan is awaiting approval and its Slices 2 and 4a *are the act substrate*: Slice 2 registers
the three missing acts; Slice 4a delivers params, `OP_CATALOG`, and the published catalog doc.
Re-cutting it now to add cursor theater would delay the substrate for a layer that sits on top of
it.

**Two soft amendments to Slice 4a only** (so the catalog is not written twice):

1. `OpCatalogEntry` gains `version: number` and `target: DemoTool` at authoring time — two fields,
   no behavior.
2. `docs/demo/OP-CATALOG.md` adopts the **demo-act** vocabulary, carries the act-alias table
   (§2.2), and `HEADER_ALIASES` gains `act` / `demo act` / `demo-act` for the `op` column.

**Follow-on phase (proposed GP-DEMO-5), after PLAN completes, three slices:**

| Slice | Content | Depends on |
|---|---|---|
| **T1 — the theatrical layer** | `src/demo/show/theatrical-page.ts` (overlay init script, `Cadence`, decorator), `app-pane.ts` `theatrical?` option, `cursor` field in the catalog. Retrofit `ao-registry` and `eo-review` — no flow changes. CSP verified on :3000/:3001/:4002 | PLAN Slice 4a |
| **T2 — terminal-theater** | A BHD-navy terminal renderer for CLI acts (typed command line, streamed real stdout), applied to `muster-readiness` and `simstack-create` | T1, PLAN Slice 2a |
| **T3 — the evolving set** | `simstack-create`, `ao-make-change`, `eo-show-change-captured`; act aliases; the founder's five-beat arc authored as a deck | T1, T2, PLAN Slices 2 + 3 |

The run report (PLAN Slice 3) already records op id, mode, params, timing, pass/fail and artifacts
— adding `actVersion` there closes the loop, so a deck that looked wrong on stage can be traced to
the exact act version that ran.

---

## 6. In-slide app area (right third) — founder follow-up

> *"Can we run our demo-acts inside the 16:9 'slide' container? Essentially use the right 1/3 of
> the slide area for app area or graphic?"*

**Short answer: yes for a graphic — that works today with zero new mechanism. Yes for a live app
area too, but only via one of four mechanisms, and the good one re-decides a LOCKED decision.**

### 6.1 This touches LOCKED decision FD-1

`THREAD_HANDOFF.md` locked decision 1 (founder-approved 2026-09-03): **"App pane = separate headed
browser window."** Mechanisms (b) and (c) below both re-decide it — (b) retires the second window
entirely, (c) keeps it but disguises it. **This is the founder's call, not the architect's.**
If FD-1 is re-decided, what changes: `DEFAULT_APP_GEOMETRY` and `openAppPane`'s headed default
(`app-pane.ts` L23, L43); the window lifecycle in `show-run.ts`; the THREAD_HANDOFF text itself;
and PLAN rev 2's *"never displayed"* wording for the backstage session. Recommend keeping a
`--pane-window` escape hatch that restores today's behavior for rehearsal and debugging.

### 6.2 Layout math, and what the V4 lock actually says

The V4 stage is **resolution-independent**: `.stage` is `width:min(100vw,177.78vh)` with
`--u = 1%` of stage width, and every dimension in the sheet is expressed in `--u`
(`slide-render.ts` L407-412). So "right third" is simply `flex:0 0 calc(33.33*var(--u))`.

| Stage size | App area | Ratio | vs today's pane (620×1000 = 0.62) |
|---|---|---|---|
| 1280×720 (laptop) | **427×720** | 0.59 | near-identical shape, 31% smaller |
| 1920×1080 (projector) | **640×1080** | 0.59 | near-identical shape, comparable size |

**Legibility — the hard part, and the three GUIs make it harder than the arithmetic suggests.**
All three are hard-coded desktop grids with **zero `@media` breakpoints**: `#main` is
`grid-template-columns:380px 1fr; max-width:1320px` in Stamper (`public/index.html` L88-97) and AO
(L73-81), `260px 1fr` in EO (L78-87). They need ~1360px before content and simply overflow at
640px — clipped in Stamper (`#main` sets `overflow:hidden`), scrollbars in AO and EO. And
downscaling a 1360px render into 640px is 0.47×: unreadable across a room.

**So the answer is reflow, not rescale.** None of the three sets any CSP, and the mirror drives the
page **directly** rather than through a cross-origin frame — so a small per-app narrow-layout
stylesheet (`#main{grid-template-columns:1fr;max-width:none}`) injected with `addInitScript` makes
the GUI lay out honestly at 640px, after which the mirror maps **1:1 with no rescale blur**. This
is the capability the iframe option cannot have. It is a presentational reflow of the real app
doing real work — declare it per act (`narrowLayout: true`) so it is never mistaken for a mock, and
note that it changes **no sibling file**. Surfaces that resist reflow fall back to a region crop
that follows the act's target.

**Does the split violate the V4 lock? No — it is a permitted variant, but say so out loud.**
Three reasons: (1) **the locked sheet already contains a split body** — `.body-split .cards{flex:1.15}`
/ `.body-split .images{flex:1}` (L488) is exactly this layout family, shipped and locked;
(2) nothing is redrawn, only re-flowed, because every rule is in `--u`; (3) the variant is gated on
the slide declaring a mirrored act, so **every existing slide renders byte-identically** (assert it
with the existing render test). The real cost is **content**, not CSS: the content region goes from
85u to ~51.7u (rail is a fixed 15u, L519), ~39% narrower — so split slides need shorter card text.
That is an authoring rule for the catalog, not a renderer change.

**"Graphic in the right third" needs no new mechanism at all.** PLAN Slice 1's `html` / `image`
column plus `.body-split` already puts arbitrary self-contained content beside the cards. The
hub-and-spoke drawing in the right third is a **pure authoring act today** — zero code.

### 6.3 The four mechanisms

| | Verdict |
|---|---|
| **(a) Iframe the app into the slide** | **Reject — on architecture, before headers.** Three blockers: (1) `UiPage` is a flat selector-string seam with **no frame concept** (`ui-page.ts` L32-52); driving an app inside a frame means frame-aware resolution through all four M4 drivers and their ordering tests — the exact blast radius the theatrical decorator exists to avoid. (2) **Pane navigation has no iframe equivalent.** Ops call `ctx.pane.goto(url)`, and `UiPage` has no verb for "set a frame's src". Worse, two existing behaviors break inside the sandboxed frame PLAN Slice 1 mandates (`allow-scripts` **without** `allow-same-origin`): `htmlDataUrl()` readouts navigate the pane to a `data:` URL (`op-registry.ts` L122-124), and `stagedReplayHtml` embeds screenshots as `file:///` URLs (L115-119) — an opaque-origin frame loads neither. (3) The app would live inside the window that also owns keyboard nav and the SSE state stream, so an act's crash takes the slides down with it; today they are isolated. **Headers verified — framing is permitted, and it still does not save the option.** None of the three servers sets `X-Frame-Options` or any CSP, in header or `<meta>` (`ces-stamper/src/server/GuiServer.ts` L316-329, `ces-ao/src/server/AoServer.ts` L65-73, `ces-eo/src/eo/server/EoServer.ts` L267-268, nor the shared middleware in `ces-shared/src`), and there is no framebusting JS in any of them. The shared bearer auth gates on **loopback peer address with no `Origin`/`Referer` check**, so framed requests would authenticate. Policy is not the blocker; architecture is. A **fourth** blocker also appears once §6.2's layout finding lands: a cross-origin frame cannot be reached into to fix the GUIs' fixed-width layout — the parent may not inject CSS into it. Cursor overlay itself would work (`addInitScript` runs per frame). |
| **(b) CDP screencast mirror** | **Recommended.** Drive the app in the backstage session; stream its rendered frames into an `<img>` in the slide's right third. Detail below. |
| **(c) Window-overlay illusion** | **Reject — cheapest to prototype, worst to depend on.** The slides page owns keyboard nav (its keydown POSTs `/nav`), so every operator keypress requires the slides window focused, which raises it **above** the app window and breaks the illusion mid-demo. `--window-position/--window-size` are physical pixels, so Windows display scaling (125/150%) desynchronizes them from `--u`. The stage is centered and letterboxed by `min(100vw,177.78vh)`, so the right third's true screen rect must be recomputed on every window move or display change. Window borders leave a seam, and screen-share captures *a window* — a remote demo shows the seam or loses the app entirely. Every failure mode is live, on stage. |
| **(d) Status quo (two windows)** | Zero cost, fully honest, already built. The cost is presentational: two windows read as two artifacts, which is precisely why the founder asked. Keep it as the `--pane-window` fallback. |

### 6.4 Mechanism (b) in detail

`context.newCDPSession(page)` → `Page.startScreencast({format:'jpeg', quality, maxWidth, maxHeight,
everyNthFrame:1})` → `Page.screencastFrame` events carrying a JPEG. **Every frame must be acked**
(`Page.screencastFrameAck`) or the stream stalls after a few frames.

**Transport — no new dependency.** `slides-server.ts` is already a plain `node:http` server with
SSE, `POST /nav`, `/asset/<id>` and `/state` (L113-187). Add `GET /pane-stream` as
`multipart/x-mixed-replace` (MJPEG) and put `<img src="/pane-stream">` in the app area: raw JPEG
buffers (no base64 inflation), decoded natively by the browser, **no `ws` dependency** (the repo has
none), and it degrades to a frozen last frame rather than an error.

**Practicality.** Screencast is change-driven, not fixed-rate: an idle page costs ~0 frames; during
cursor travel it delivers roughly 15-30 fps. At 640×1080, q75 (~50-90 KB/frame) that is ~1-3 MB/s
over loopback — trivial. Latency is one frame plus loopback, well under the threshold at which
"the cursor is moving" reads as live.

**Why it composes better than anything else here:**
- **T1's cursor overlay is injected DOM, so it is inside the rendered frame.** The mirror shows the
  branded cursor, the click pulse and the highlight ring exactly as the page draws them.
- Screencast captures the **page viewport only** — no URL bar, no tab strip, no window chrome. It
  looks like part of the slide because it is part of the slide.
- **It is what PLAN rev 2's backstage session was already 90% of the way to.** Rev 2 creates a
  second headless, never-displayed `AppPane` in `prepare()`. This turns *"never displayed"* into
  *"displayed as pixels, under deck control."*

**The one thing that must not be missed:** mirroring is **per-act opt-in** (`mirror: none |
theatrical` in the catalog entry, beside `cursor`). Config acts declare `mirror: none` and stay
invisible, exactly as rev 2's doctrine fix requires. Without that field this mechanism silently
reopens the doctrine hole GAP_ANALYSIS P0-1 just closed.

**Risks:** screencast support in the pinned Playwright build's headless mode must be spiked first —
fallback is a headed window parked off-screen at negative coordinates, which screencasts
unconditionally; frame acks are mandatory; a slow or dropped MJPEG client must **drop** frames, never
queue them (keep last-frame-only, or the frame buffer is a memory leak).

**Rough size: ~250-350 lines** — `src/demo/show/screencast-mirror.ts` (CDP session, last-frame
buffer, subscriber fan-out), one route in `slides-server.ts`, the `mirror` catalog field, the
`.body-mirror` CSS + `<img>` in `slide-render.ts`, lifecycle in `op-registry.ts` / `show-run.ts`,
and tests against a fake CDP session. No new dependency.

### 6.5 Sequencing

Insert **T1.5 — the in-slide mirror** between T1 and T2: it needs T1's overlay to be worth
mirroring, and T2's terminal-theater then renders into the *same* app area for free (it is a page
in the backstage session, so the mirror carries it). T3 is unaffected.

**Recommendation: (b), gated three ways** — the split layout applies only to slides declaring a
mirrored act; mirroring is per-act opt-in so doctrine holds; `--pane-window` restores (d) for
rehearsal. And ship the **graphic-in-right-third** case immediately, since it needs no mechanism at
all.

---

## 7. Muster corrected — GUI verified + workflow map + new acts

**The founder is right and §3 of this document was wrong.** ces-muster has a full web GUI. This
section records the correction, maps the founder's five-step workflow to code, and adds the acts
§3 was missing. Nothing in `src/`, `tests/`, `demos/`, `OP-CATALOG.md` or any plan file is touched
by this section — a build executor is running against PLAN-DEMO-RICHNESS; §7.6 carries the
follow-up NOTES instead.

### 7.1 The GUI — VERIFIED, and the root cause of my error

ces-muster is a **Vite + React 18 SPA** — `index.html` (`<title>CES Muster</title>`) mounting
`src/main.tsx` into `#root`, an 8-view app (`assessment | result | rollup | quick-session |
contracts | help | discovery | readiness`, `src/features/app/App.tsx` L19-27) behind two nav rails,
branded *"Blue Heron Defense — Muster"*. Our own survey already said so plainly: *"Muster is two
halves: a zero-network SPA (`src/`) and a Node API platform (`muster-api/`)"*
(`docs/MUSTER-TENANT-READINESS.md` L9-10).

**The distinction that probably caused the error is real and worth keeping straight:**
**`muster-api` serves no HTML at all.** It is a pure JSON API on **port 4000** (`PORT` env,
`muster-api/src/server.ts` L5-8) whose catch-all returns `res.status(404).json(...)`
(`muster-api/src/app.ts` L52-54) — there is no `express.static`, no `sendFile`, no SPA fallback.
The GUI is served **only by Vite**: `npm run dev` → **:5173** (Vite's default; no `server.port`
override in `vite.config.ts`) or `npm run build && npm run preview` → **:4173** (verified,
`playwright.config.ts` L7, L11). There is **no `mu` CLI subcommand that starts a GUI** — the full
USAGE block (`muster-api/src/cli/mu.ts` L171-257) has no `gui`/`serve`/`web`/`ui`, so arming would
spawn an npm script, unlike Stamper's and AO's CLI starters.

**Why §3 got it wrong — three misleading signals inside *this* repo, none of them about ces-muster:**
1. `gui-servers.ts`'s `GuiServerKind` is a closed `'stamper' | 'ao'` union — true, but that is
   **ces-tester's driver inventory**, not evidence about a sibling. I over-read it.
2. `src/demo/e2e-run.ts` L849 comments port 5173 as *"ces-planner — the Muster wizard SPA"* — a
   legacy misnomer that calls a **ces-planner** surface "the Muster wizard".
3. `src/cli/demo-command.ts` L65 labels the 5173 port entry `{ name: 'muster', port: 5173 }`.

**The repo has even observed the real Muster SPA running:** `src/demo/preflight.ts` L96-104 records
that *"an orphaned `ces-muster` vite held `::1:5173`"* during GP-DEMO-3 M7, which then drove
"a DIFFERENT product's SPA to a 30 s selector timeout." **ces-muster and ces-planner both default
to Vite 5173 — a real collision** (§7.6 NOTE 3).

**Driver status — the one part of §3's claim that stands: ces-tester has NO Muster GUI driver.**
`src/muster-driver/*` drives **ces-planner's** wizard, not Muster. A Muster driver is new work —
but **cheaper than the existing three**, because ces-muster ships what Stamper/AO/EO do not:
- **76 unique `data-testid` attributes** in `src/` — stable hooks, not scraped CSS selectors.
- **Its own Playwright e2e suite** (`ces-muster/e2e/`, `playwright.config.ts`) including a full
  happy path (`prime-and-subs-happy.spec.ts` "EU-1") and a five-tab shell walk
  (`five-tabs.spec.ts`) — a verified selector source to copy from rather than reverse-engineer.

### 7.2 The founder's five steps, verdict by step

| # | Founder's step | Verdict | Evidence |
|---|---|---|---|
| 1 | Pointed at a tenant | **CONFIRMED, with one refinement** | The Situation tab captures a `readiness_manifest` — mode (self-hosted/independent/collaborative-bhd), auth tier (device-code/script-upload/lite/cert-app-only), operator, tenant — and `buildReadinessResult()` **throws without it**: you cannot claim readiness without declaring how you assessed (`readinessResultService.ts` L112-117; survey §9). Refinement: **the SPA never touches a tenant**; muster-api reaches tenants only through `ces-tenant` (`TENANT-CONNECTION.md`; survey §3). GUI path: `nav-tab-situation` → `tab-profile`. |
| 2 | Read-only auto-analysis | **PARTLY — read-only is confirmed and enforced; "auto" and "in the GUI" both need correction** | **Read-only is enforced three independent ways** and is stronger than the founder claimed: structurally (`discoveryService.ts` L1-13 — "NO code path that touches a set_command"; the `RegistryGetEntry` type has no such field); by **post-hoc ledger assertion** — the CLI re-queries the sim for create/mutate entries and **fails the run** on any (`discoveryCli.ts` L156-164); and in the generated collector script (`collectorKitService.ts` L10-14). **Two corrections:** (i) nothing runs *automatically* — a human invokes it, and the CLI refuses any non-`--sim` target ("FD-LIVE-SMOKE safety, non-negotiable", `discoveryCli.ts` L119-125); (ii) **the SPA's "Run Discovery" button does NOT run the walk.** It sets a canned fixture: `App.tsx` L253-254 `onRunDiscovery={() => setDiscoveryResults(DISCOVERY_RESULTS_FIXTURE)}`, and `DiscoverySubTab.tsx` L2, L23 states "Zero network calls". The real walk is the **CLI lane only**. This is the single most important finding in §7 — see §7.3. |
| 3 | Runs analysis scripts **with permission** | **PARTLY — permission is real and structural, but there is no prompt anywhere** | **Verified negative:** grepping `readline\|createInterface\|inquirer\|prompts?\(\|window.confirm` across `muster-api/src` and `src` returns **zero** interactive prompts, and there is no `--allow`/`--consent` flag and no consent-record table. What actually gates execution is three structural mechanisms: (a) **OAuth admin consent** — the tenant admin's own browser grant (`consentService.ts` L30-45, GCC High authority; routes `harvest.ts` L44-87, restricted to roles `prime \| bhd_operator`); (b) **the concierge-session header gate**, the closest thing to an explicit permission flag — recipe execution returns **403 "Concierge session required"** unless `x-concierge-session: true` is asserted or `RECIPES_SELF_SERVE=true` is set (`routes/recipes.ts` L74-83, L10-13), with SHA-256 signature verification throwing `SignatureError` on mismatch (`recipeIngestService.ts` L222-244); (c) **consent by construction** — the customer's own admin runs the signed, human-readable collector in their own session, and is told to delete any command block they are not comfortable with (`collectorKitService.ts` L67-80). **Ordering correction:** (c) is *not* a deeper probe run after step 2 — it is an **alternative rung of the auth ladder** used *instead of* connected discovery when credentials cannot be obtained (`docs/design/residual-elicitation-ladder.md` L161-186). |
| 4 | Adaptive questioning per remaining gaps | **CONFIRMED — and it is measurable on stage** | Two layers: **coverage pruning** — a question is skipped iff a non-`unknown` fact already covers it, and an `unknown` fact NEVER prunes (`factCoveragePruner.ts`; survey §5); and **Claude-powered adaptive ordering** which may only select ids from the provided bank and "NEVER converts an 'unknown'/'unsure' answer into a pass" (`adaptiveInterviewService.ts`; survey §5). **ces-muster's own e2e proves the delta by clicking the product**: Run Discovery → Continue yields *strictly fewer* interview questions than Skip to Manual (`e2e/five-tabs.spec.ts`, asserted against `progress-note` "of N answered"). |
| 5 | SPRS and **MP** generation | **CONFIRMED — and "MP" = Manual Mission Plan, verified not guessed** | SPRS: the DoD 110-point calculator, start 110, floor −203, and **only `met` passes** — `partial` and `unknown` each deduct the full weight (`muster-api/src/services/sprsCalc.ts` L21-22, L42-45), with a SPA twin over one shared weight table (`sprs-weights/2.0.0`). **MP is a literal artifact id in code:** `expect(result.missionPlan.ces.artifact).toBe('manual_mission_plan')` (`src/features/plan/__tests__/tenantManifestAdapter.test.ts` L102); builder `buildManualPlan` (`tenantManifestAdapter.ts` L189-214), described there as *"the Manual Mission Plan — Planner's headline artifact (the one ces-tester drives Stamper with)"*; type `ManualMissionPlan` (`vendored/ces-planner/shared/types/artifacts.ts` L481). **Not a POA&M and not an SSP** — both exist in the repo only as vendored Planner reference content and question/evidence labels; muster generates neither. Tenant Manifest, Mission Plan and Infra Manifest share **one** compile pass so they can never diverge (`tenantManifestAdapter.ts` L97-101, L112-147). GUI path: `nav-tab-readiness` → `readiness-tab`. |
| — | *(step the founder omitted)* **Human attestation** | **MISSING FROM THE DESCRIPTION — and it is the legally load-bearing one** | Strategic Intent and the CUI boundary feed the SSP, which *"carries **False Claims Act weight**"*, so every inferred / extracted / archetype-defaulted answer must end in a **named human's confirmation**, and *"nothing auto-drafted converts silently into an attested fact"* (`docs/design/residual-elicitation-ladder.md` L196-208). Enforced in code: drafts are excluded before routing (`exportPipeline.ts` L25-38), prefills render as unconfirmed drafts (`AssessmentPage.tsx` L839), and `confirmFact()` is the single choke point requiring a non-blank human name (survey §6). **Any pitch describing Muster as five automated steps ending in generated artifacts understates this guardrail** — and it is a differentiator, not a caveat. |

**Overall: the founder's understanding is materially correct on shape, with three substantive
corrections** — (1) the SPA's Run Discovery is a fixture, not the walk; (2) "with permission" is
three structural mechanisms and zero prompts; (3) human attestation, the legally load-bearing step,
is missing from the description entirely.

**Two framing cautions for talk tracks.** (a) The five steps are **not a linear pipeline** — the
design doc explicitly reframes them as an ordered **resolver chain** on one answer engine
(*discover → infer-and-confirm → extract-from-document → archetype-default → ask-the-human*), run
repeatedly, biggest gaps first (`docs/design/residual-elicitation-ladder.md` L38-65). (b) Muster's
own code caps the claim: the evidence package is a *"self-assessed indicator — **not a
certification, not an SPRS submission**, and not a quote-binding gap report"*
(`evidencePackageService.ts` L9-11). Never narrate otherwise.

### 7.3 The five new acts

All five are **RE (Readiness Evaluation)** and therefore **doctrine-gated** (§7.5). All five are
**driver-required** — none can be built until a `muster-ui-driver.ts` exists.

| Act | Phase | Surface / key hooks | Grade | Notes |
|---|---|---|---|---|
| `muster-connect-tenant` | 1 | SPA Situation tab: `nav-tab-situation` → `tab-profile` → `readiness-manifest-capture` (`rm-mode`, `rm-auth-tier`, `rm-tenant-slug`, `rm-tenant-kind`, `rm-operator-name`) → `begin-interview` | **CURSOR** | The honest opening beat: *declare how you are assessing before you claim anything.* `rm-tenant-slug` is literally the tenant selector. |
| `muster-auto-analysis` | 2 | **CLI walk** → `export-readiness-result` → SPA `discovery-import-input` → `discovery-sub-tab` → `discovery-summary` | **TERMINAL-THEATER** then **CURSOR** | ⚠ **Composed deliberately — do not shortcut to the GUI button.** `discovery-run-btn` loads `DISCOVERY_RESULTS_FIXTURE` with zero network (`App.tsx` L253-254). An act that clicked it while narrating the zero-writes ledger proof would be **a replay dressed as a live run** — the exact failure this harness exists to prevent. The honest act runs the **real CLI walk** (with its ledger assertion), then imports the resulting `readiness-result.v1` into the SPA through the documented import seam (survey §2) so the audience sees real numbers in the real UI. |
| `muster-run-analysis-scripts` | 3 | `boundary-confirm-panel` → `boundary-confirmer-name` → `boundary-confirm-{qid}` → `boundary-continue-btn` | **CURSOR** (attestation) · **READOUT** (OAuth + concierge lanes) | **Rename recommended → `muster-consent-and-attest`.** The offer screen is a UX choice, *not* a permission gate (§7.2 step 3), so it must not be staged as one. What is genuinely demoable is the **named-human attestation** gate — a machine may never assert CUI-boundary intent (`discoveryFactJoin.ts` L32-39) — which also covers the step the founder omitted. The OAuth consent and `x-concierge-session` gates cannot be shown in sim (they need a real tenant and Microsoft's own consent screen) and belong in a readout. Governed, consent-based, human-attested scanning is the strongest differentiator beat in the set. |
| `muster-adaptive-interview` | 4 | The interview view; `progress-note` ("of N answered") | **CURSOR** | The best beat of the five: show the question count **drop** because discovery already answered them. Params: `compare=manual\|discovery` to stage the delta. |
| `muster-generate-sprs-mp` | 5 | `finish-interview` → `nav-tab-readiness` → `readiness-tab` (`readiness-sprs-score`, `readiness-matrix`), then `export-readiness-result` / `export-evidence-package`; plan-mode emits the Manual Mission Plan | **CURSOR** + **READOUT** | Lands the number the customer actually reports, then the artifact Stamper consumes. Exports are real browser downloads (asserted via `page.waitForEvent('download')` in ces-muster's own e2e). |

**Muster is the *most* mirror-friendly surface in the fleet** (§6.2 context): `.page` is
`max-width:860px; margin:0 auto` — a **fluid centred single column**, not a fixed grid
(`ces-muster/src/muster.css` L7-15). Unlike Stamper/AO/EO it needs no injected reflow to be legible
narrow; it simply needs a viewport ≥ ~900px to look native. It also sets **no CSP and no
X-Frame-Options** (verified: zero matches repo-wide, `helmet` is not a dependency) and uses **no SSE
or WebSocket**, so nothing about it resists automation or mirroring.

**Honesty flags for act authors:** (a) the offer screen ships marketing figures — "pre-answered
41.6% of objectives", "reduced interview time by 87.3%", "saving an average of 150 minutes"
(`discoveryOfferCopy.ts` L7-11) — these are **product copy, not measurements from the demo run**;
they will appear on screen during `muster-auto-analysis`, so a talk track must not narrate them as
this tenant's results. (b) DISCOVERY-1 remains presence-based and produces **no readiness score**
(founder decision 5); the SPRS on the Readiness tab comes from the scoring path, not from the walk.

### 7.4 What this changes in §3 and §4 (corrections applied in place)

- **§3's preamble** claimed "there is **no ces-muster GUI**" and that RE therefore gets
  terminal-theater. **Corrected in place**, with the original claim quoted so the record shows what
  changed rather than silently rewriting it.
- **§3's `muster-readiness` row** described a CLI-only act. Corrected to note the GUI exists and
  that the CLI act (in flight as PLAN Slice 2a) is now *one of two* Muster surfaces.
- **§4's asymmetry argument is now VOID and this is the most consequential correction in this
  document.** §4 argued that even if the RE no-live rule were lifted, "RE cannot get a cursor walk
  — there is no Muster GUI to walk," and that option B therefore bought only a live Config walk.
  **That was false.** RE has the *richest* GUI surface in the fleet for cursor work. Founder
  decision 2 (2026-09-06, doctrine holds) was taken with that incorrect input in front of it and
  **should be revisited on the corrected facts** — see §7.5.

### 7.5 Doctrine gating, and what changes if the RE restriction lifts

⚠ **This section is superseded.** THREAD_HANDOFF item 2 ("RE and Config get no live product demo")
was lifted for RE by decision 9 (2026-09-06) and for **Config by decision 11 (2026-09-07)**. The
five Muster acts ship **`mirror: theatrical`** (streaming the visible pane), and the Config pair
ships **`mirror: theatrical` with `mirrorSource: backstage`** (streaming the headless backstage
session) — not `mirror: none`. The historical reasoning below is retained for provenance.

**If the founder lifts the RE restriction (or authorizes engine-room for a technical audience):**
- These five become **the strongest cursor-act set in the catalog** — 76 stable `data-testid`
  hooks and an existing Playwright happy path, versus scraped CSS selectors everywhere else.
- The arc gains a genuine opening: *point at the tenant → prove read-only → ask permission →
  watch the questions disappear → get the score and the plan.* That is the pain-removal story told
  as product, not as a drawing.
- The hub-and-spoke drawing stays valuable for the **Config** half, which still has the weaker
  case (§4 option B).
- Cost: a `muster-ui-driver.ts` plus five acts — **a new slice, not an amendment** to work in
  flight.

### 7.6 NOTES for follow-up decision — do not action during the running build

1. **`muster-readiness` (Slice 2a, CLI) is now MORE important, not less.** It is the **only** path
   that actually runs DISCOVERY-1 — the SPA's Run Discovery button is a fixture (§7.2 step 2). The
   GUI act `muster-auto-analysis` therefore *composes on top of* Slice 2a rather than competing
   with it: CLI walk → `readiness-result.v1` → SPA import. **No change to Slice 2a is implied, and
   its CLI-based design is vindicated.**
2. **The Mission Plan fixture.** Slice 2.0 checks in `assets/demo-plan/demo-dib-small/mission-plan.json`
   copied from an e2e run — but §7.2 step 5 shows **Muster generates exactly that artifact**. A
   later arc could hand Muster's own MP to Stamper instead of a fixture, making the
   assess→remediate chain end-to-end product. Decision for after PLAN completes.
3. **Port 5173 is contested** between ces-muster's SPA and ces-planner's wizard (both Vite
   defaults; collision observed live per `preflight.ts` L96-104). **The clean fix already exists:**
   ces-muster's `npm run preview` serves the built SPA on **:4173** (verified,
   `playwright.config.ts` L7, L11), which collides with nothing in `DEMO_PORTS`. A Muster act
   should arm `preview`, not `dev` — it also means serving compiled output, matching the
   pre-flight build-freshness discipline. Separately, `DEMO_PORTS`' `{ name: 'muster', port: 5173 }`
   label is misleading as written and `muster-api`'s own port (**4000**) is not in `DEMO_PORTS` at
   all.
4. **Two misnomers in this repo** — `e2e-run.ts` L849 and `demo-command.ts` L65 call ces-planner
   surfaces "Muster". They caused this error and will cause the next one. Worth a comment-only fix
   when the build is idle.

---

## 8. Record & fast-replay of long ops — founder feasibility question

> *"Would it be possible to record a long-running tool run and play it back rapidly / jump ahead to
> the end, to make the demo more compelling?"*

**Short answer: yes, and the honest version is already most-built.** But first, the scope just
shrank dramatically.

### 8.1 What is actually long — the measurement changes the whole answer

The harness now has **measured** durations, and one prior claim was prose fiction:

| Act | Old prose | **Measured** | Needs fast-replay? |
|---|---|---|---|
| `eo-assess` (EO Assessment) | "≈ 5 min" | **≈ 4.7 s** | **No.** It is already faster than a slide dwell. The "5 min" was never real. |
| `stamper-translate` (Config) | "≈ 0.1 s" / "~5 min" | **~5–10 min, 2× variance** | **Yes.** |
| `stamper-execute` (Config) | "≈ 7 min" | **~13 min (774 s)** | **Yes — the true long pole.** |

**So the entire feature scopes to the Stamper Config pair — two acts.** EO no longer needs it;
`muster-readiness` is seconds; AO is seconds. This is a small, targeted capability, not a
harness-wide one. And both target acts are **doctrine-gated Config** (item 2), so whatever we build
plays into a *readout*, not a live GUI walk — which, as it turns out, is exactly what makes the
honest version cheap.

### 8.2 The honesty line — non-negotiable

Two things the founder's phrasing could mean, and only one is allowed:

- ✅ **Replay a genuine prior real run, time-compressed, LABELED as recorded.** "This is a real
  ~13-minute execution against the sim, compressed to 15 seconds." Honest: the pixels and the
  end-state artifact are from a real run.
- ❌ **Fabricate progress** — a synthetic progress bar, invented intermediate numbers, or a replay
  presented as *happening live now*. This is the exact failure the standing honesty guards forbid
  (THREAD_HANDOFF Founder decisions 2026-09-06; A.5 honesty rules; no fabricated data).

**The rule for §8: a fast-replay must be of a real captured run, carry a persistent "RECORDED · N×"
label on screen, and never be narrated as live.** A recording whose provenance (which run, when,
what tenant) is not traceable to a real `runDir` may not be replayed.

### 8.3 Mechanisms, assessed against the repo

| | Mechanism | Verdict |
|---|---|---|
| **(a)** | **Artifact-time-warp (readout).** The op already produces real artifacts — `report.json`, screenshots, evidence. "Replay" = render the real end-state readout immediately with a short animated flourish (a few checkpoint lines counting in). | **Cheapest; ~90% already exists.** This is essentially what `staged`/READOUT does today, plus a CSS animation. Honest *iff* the artifact is from a real run. For the Config pair this may be all the founder needs. |
| **(b)** | **Screencast record + speed-up.** During a real warm run, capture the §6 CDP `Page.startScreencast` frames to a file; replay them fast / scrub / jump-to-end into the pane's `<img>`. | **The literal ask — a sped-up film of the real UI.** Assessed below. Real work, but it *composes* with §6's T1.5 mirror rather than adding a new mechanism. |
| **(c)** | **Warm-and-reveal.** The long op runs during prep (`warm`); the slide just reveals the finished result. | **Already shipped. This IS "jump to the end," for free, no recording.** For Stamper, `warm` already pays the ~13 min off-stage and the slide shows applied/failed counts on arrival. **Likely sufficient on its own.** |
| **(d)** | **Checkpoint scrub.** Record milestones (translate: *N tasks compiled*; execute: *applied / failed landing*) and step through them fast under presenter control. | A middle option: more compelling than (a), far lighter than (b). Milestones come from the real report, so it stays honest. |

**On (b) specifically — the practical facts:**
- **Storage.** §6 measured screencast at ~50–90 KB/frame, change-driven (idle ≈ 0 frames). A
  13-minute Stamper run is mostly a near-static page with occasional card updates, so a captured
  file is **tens of MB, not GB** — a `runDir` artifact, not a problem. Cap it by capturing at a low
  `everyNthFrame` and dropping duplicate frames.
- **Capture site.** The recording happens on the **backstage session** (where the warm Config work
  already runs, off-stage), so it costs the audience nothing and never touches the visible pane.
- **Replay control.** Frames carry timestamps; replay is just an interval feeding the pane `<img>`.
  Rate (2×/8×/32×), seek, and jump-to-end are trivial over a timestamped frame list. Serve it over
  the same `multipart/x-mixed-replace` route §6 proposes — no new transport, no new dependency.
- **Composition.** T1.5's mirror renders a *live* screencast into the slide's right third; a
  recording is the *same frames from a file*. One renderer, two sources.

### 8.4 Presenter control

The nav model is a small `ShowAction` union dispatched from keydown → `/nav` (`show-state.ts`
`keyToAction`; free keys remain — `n/p/f/l/t` are taken, `j`, `[`, `]` are not). A record/replay
act would add, words-only here: **`j` = jump-to-end** (skip straight to the final frame + readout),
and **`[` / `]` = slower / faster replay rate**. These slot into the existing key→action→dispatch
path with no new mechanism; a live op's "slide holds until it completes" behavior already gives the
presenter the manual-advance escape hatch.

### 8.5 Recommendation & sequencing

**Ship (c) + (a) first; treat (b) as an optional richness add.**

1. **(c) warm-and-reveal is already the answer for "jump to the end"** — for the Stamper pair it is
   shipped behavior. Confirm it satisfies the founder before building anything.
2. **(a) artifact-time-warp** adds the "compelling" flourish for near-zero cost: the real end-state
   readout with checkpoint lines counting in, labeled RECORDED. This is a small addition to the
   **T2 terminal-theater** slice (Config readouts already render there).
3. **(b) screencast record+replay** is the founder's literal "sped-up film." Build it **only if (a)
   proves too flat**, and build it as **T2.5**, immediately after the T1.5 mirror it reuses — same
   CDP capture, same MJPEG route, same `<img>`, plus a frame file and a replay clock. Scope is two
   acts, so even (b) is a contained slice.

**Net:** the honest, compelling version of the founder's ask is mostly the `warm` mode already
shipped, dressed with a labeled readout. The literal sped-up film is feasible, cheap because it
rides §6's mirror, and needed for at most two acts — so it is a nice-to-have, not a blocker.

---

## Out of scope for this concept

- Changing any source file (this is a concept doc).
- Driving ces-planner's wizard (:5173) or building a ces-muster GUI — both remain out of scope per
  `PLAN-DEMO-RICHNESS`; a Muster GUI would be a **ces-muster** work item filed as a REQ in this
  repo, never built here.
- Step-level deck primitives (click/navigate/wait/selector cells) — refused by both sides.
- Changing the LOCKED V4 slide design. Cursor theater lives in the **app pane**, never the deck.
- Writing to any sibling project root.

## Legend

| Term | Meaning |
|---|---|
| **demo-act / act** | This document's proposed name for a registry op with a theatrical script: a named, versioned, tester-implemented primitive a deck references by id + params. |
| **op / op mode** | Today's terms. `staged` = replay · `warm` = started during prep · `live` = runs on slide entry, slide holds. |
| **RE / Config / Ops / Assessment** | Binding on-stage product names (THREAD_HANDOFF): Muster = Readiness Evaluation, Stamper = Configuration, AO = Operations, EO = Assessment. Internal ids/CLIs unchanged. |
| **CURSOR / TERMINAL-THEATER / READOUT** | The three visual grades an act can have (§3), set by whether a real GUI exists for that tool. |
| **`--check`** | `demo:show --check <deck>` — headless deck validator. Forces every op to `staged`, so it never reaches an implementation. |
| **CSP** | Content Security Policy — a page's restriction on what scripts/styles may run. Relevant because the overlay is injected. |
| **SPA** | Single-page application — here, the ces-eo web UI on :4002. |
| **V4** | The LOCKED `demo:show` slide design (`docs/demo/design/mockups/v4-final-hybrid.html`). |
| **DISCOVERY-1** | ces-muster's `mu discovery --sim` executor — presence-based per-control posture, **not** a score. |
| **MP** | **Mission Plan** — specifically the *Manual Mission Plan* Muster's plan-mode adapters emit via the vendored `generateManualPlan`, alongside a Tenant Manifest, an Infrastructure Manifest and an SI Baseline. **Not** a POA&M and **not** an SSP (§7.2 step 5). |
| **Muster SPA** | ces-muster's Vite + React GUI (`npm run dev` :5173 / `npm run preview` :4173) — distinct from **muster-api**, the pure-JSON Express service on :4000 that serves no HTML. |
| **RR** | Readiness Review — Muster's interview / question-bank flow (`docs/MUSTER-TENANT-READINESS.md` legend). |
| **FCA** | Two unrelated meanings, both live in this material: **"Fail-Conservative Assessment"** — Muster's discipline that unknown or absent evidence never counts as a pass (survey legend); and **False Claims Act**, the legal exposure that makes human attestation mandatory (`residual-elicitation-ladder.md` L196-208). Disambiguate whenever either is used. |
| **resolver chain** | Muster's own framing of its workflow — *discover → infer-and-confirm → extract-from-document → archetype-default → ask-the-human* — run repeatedly over one answer engine, biggest gaps first. **Not** a linear five-stage pipeline. |
| **attestation** | A named human confirming a machine-drafted answer. Drafts prune questions but never score; `confirmFact()` is the single choke point. |
| **`data-testid`** | Stable test hooks ces-muster ships (76 unique in `src/`), which make a Muster driver cheaper than the CSS-selector scraping the other three GUIs require. |
| **`UiPage`** | The narrow browser seam (`src/demo/ui-page.ts` L32-52) every driver and op is written against. |
| **FD-1** | THREAD_HANDOFF locked decision 1 (2026-09-03): *"App pane = separate headed browser window."* §6 mechanisms (b) and (c) re-decide it. |
| **backstage session** | PLAN rev 2's second, headless, never-displayed `AppPane`, created by the runner in `prepare()` so doctrine-sensitive (Config) work never appears on the visible pane. Resolves GAP_ANALYSIS P0-1. |
| **CDP** | Chrome DevTools Protocol — the channel Playwright drives Chromium over; source of `Page.startScreencast`. |
| **screencast mirror** | §6's recommended mechanism: the backstage page's rendered frames streamed into the slide's right third. |
| **MJPEG** | `multipart/x-mixed-replace` — a stream of JPEGs a plain `<img>` renders live. Needs no client JS and no new dependency. |
| **`--u`** | The V4 stage's relative unit: 1% of stage width (`slide-render.ts` L409). Every V4 dimension is expressed in it, which is why a split layout re-flows rather than breaks. |
| **split layout** | The proposed 2/3 content + 1/3 app-area slide variant. Same family as the already-locked `.body-split` cards/images layout. |
| **T1 / T1.5 / T2 / T2.5 / T3** | The proposed follow-on slices: theatrical cursor layer · in-slide mirror · terminal-theater · **record & fast-replay (§8, optional)** · the new acts. |
| **warm-and-reveal** | The shipped `warm` behavior used as "jump to the end": a long op runs during prep, the slide reveals the finished real result on arrival. No recording needed (§8 mechanism c). |
| **artifact-time-warp** | Rendering a real run's end-state readout immediately with a short animated flourish — honest replay of a real artifact (§8 mechanism a). |
| **fast-replay / RECORDED · N×** | Time-compressed playback of a **real** captured run, always labeled as recorded and never narrated as live (§8.2). |
| **PLAN** | `docs/demo/PLAN-DEMO-RICHNESS.md`, awaiting approval. |
| **REQ** | `docs/requirements/REQ-TESTER-DEMO-RICHNESS.md` (founder-approved 2026-09-06). |
