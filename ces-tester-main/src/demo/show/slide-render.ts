// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S2 — auto-rendered 16:9 slides (FD-4), V4 design.
 *
 * Follows the house precedent (`src/results/dashboard-generator.ts`): a styled
 * HTML shell with the payload INLINED as JSON at generation time, and a page
 * script that is a dumb renderer. Nothing is fetched, nothing is templated in
 * the browser.
 *
 * The one departure that matters: **each slide's body HTML is rendered HERE, in
 * TypeScript, and shipped inside that JSON** rather than assembled by page
 * script. That is deliberate — `demo:show --check` (A1) proves "every slide
 * renders" by calling this exact function, so a headless check and the live
 * window can never drift into rendering two different decks.
 *
 * Sizing: every dimension is a multiple of `--u`, one hundredth of the 16:9
 * stage's width. The stage letterboxes itself into whatever window it gets, so
 * the same deck is legible in a 1280x720 pane and on a projector.
 *
 * ---------------------------------------------------------------------------
 * V4 DESIGN PORT (2026-09-05) — the spec is
 * `docs/demo/design/mockups/v4-final-hybrid.html`, founder-approved, and the
 * numbers behind it are in `docs/context/RESEARCH_SUMMARY.md`.
 *
 * Three render paths over the SAME sheet columns — no new columns anywhere:
 *
 *   title    slide index 0 (`isTitle`): mark, hero line, stat row, deck chips.
 *   content  the briefing sheet: hairline ledger rows, no panel fills. Slides
 *            that drive an op (`opId` + mode != staged) promote `func` into the
 *            "Now" lozenge; a mirrored or image slide splits the stage 50/50 —
 *            the app pane runs full height beside the content column
 *            (STAGE-SIMPLIFY, REQ-TESTER-STAGE-SIMPLIFY, founder 2026-09-06).
 *   hold     the >2.5s rung of the research's hold ladder — the differentiator
 *            promoted to the whole slide, so a long live op reads as a
 *            deliberate beat instead of a hang.
 *
 * Elevation is hairlines only (a `#243244` panel on `#1a2332` is 1.21:1 and
 * vanishes on a projector), gold is capped at 3 elements per state, fails are
 * amber rather than red, and motion is 280/180/70ms with a
 * `prefers-reduced-motion` path that drops to 120ms opacity.
 */

import { themeCss } from './theme.js';
import { MAX_SLIDE_FEATURES, type CesTool, type DemoDeck, type DemoSlide, type OpMode } from './deck-model.js';
import { DEFAULT_DWELL_SEC, HOLD_CARD_RUNG } from './show-state.js';
import { isStandbySlide } from './standby.js';

/** HTML text escape — every founder-authored cell passes through this. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inline-embed guard, same rule as `dashboard-generator.embedJson`: a literal
 * `</script>` inside the data would terminate the script block and blank the
 * deck mid-demo.
 */
export function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * The BHD mark, inlined verbatim from `docs/demo/design/brand/bhd-logo-white.svg`
 * so the page stays fully offline — no CDN, no font, no image path.
 */
const BHD_MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 200 60" aria-hidden="true">' +
  '<rect width="200" height="60" rx="8" fill="transparent"/>' +
  '<text x="100" y="37" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" ' +
  'fill="#ffffff" text-anchor="middle">BHD</text></svg>';

/** One slide, pre-rendered. This is what the page receives and displays. */
export interface RenderedSlide {
  readonly index: number;
  readonly number: number;
  readonly title: string;
  /** The slide body, already HTML-escaped and laid out. */
  readonly html: string;
  /**
   * The full-slide hold card for this slide, pre-rendered on the same terms as
   * `html`. Shown only at the top rung of the hold ladder; empty for a slide
   * that never drives an op.
   */
  readonly holdHtml: string;
  /** Talk-track paragraphs for the presenter band, in sheet order. */
  readonly talkTrack: readonly string[];
  /** Presenter cautions, in sheet order. Drawn only when `DeckView.showWatchouts`. */
  readonly watchouts: readonly string[];
  readonly tools: readonly CesTool[];
  readonly mode: OpMode;
  readonly opId?: string;
  readonly durationSec?: number;
  /** Slide 1 renders through the title path (mockup F5). */
  readonly isTitle: boolean;
}

export interface DeckView {
  readonly title: string;
  readonly defaultDwellSec: number;
  readonly slides: readonly RenderedSlide[];
  /**
   * `:root{--…}` from the deck's theme, or `''`. Emitted AFTER `SHOW_CSS`, so
   * the theme wins by cascade order with no `!important` anywhere.
   */
  readonly themeCss: string;
  /** The theme logo's asset id; absent means the built-in mark. */
  readonly logoAssetId?: string;
  /**
   * Whether the presenter band shows watchout cues. Constant for the RUN (it
   * comes from `--watchouts`), so it belongs on the view rather than on every
   * state snapshot. Defaults false: nothing changes on stage unless asked.
   */
  readonly showWatchouts: boolean;
}

/** Collect one field across a slide's rows, dropping blanks, preserving order. */
function column(slide: DemoSlide, pick: (row: DemoSlide['rows'][number]) => string | undefined): string[] {
  const out: string[] = [];
  for (const row of slide.rows) {
    const value = pick(row);
    if (value !== undefined && value !== '') out.push(value);
  }
  return out;
}

/**
 * `extra` is trailing HTML that belongs INSIDE the card, under its text — the
 * major-feature list. It also keeps the card alive on its own: a driven-op slide
 * promotes the function into the Now lozenge, leaving `values` empty, and the
 * list still has to render in that card rather than vanish with it.
 *
 * `label` is no longer painted (founder feedback 2026-09-05 cut the visible
 * FUNCTION / BENEFIT / DIFFERENTIATOR gutter). The `<h3>` is still emitted and
 * still names the card — it is the accessible name and the tests' hook — but
 * `.card > h3` is visually hidden in `SHOW_CSS`.
 */
function cardHtml(label: string, kind: string, values: readonly string[], extra = ''): string {
  if (values.length === 0 && extra === '') return '';
  const items = values.map((v) => `<p>${escapeHtml(v)}</p>`).join('');
  return `<section class="card ${kind}"><h3>${escapeHtml(label)}</h3>${items}${extra}</section>`;
}

/**
 * The major-feature list (founder request 2026-09-05). Quiet by construction:
 * muted ramp, below the card's body size, en-dash bullets, no fills and no
 * gold. Display is capped at `MAX_SLIDE_FEATURES`; authoring more is a
 * load-time WARNING in `deck-validate.ts`, never an error, so the truncation
 * here is the visible half of a rule the loader already announced.
 */
function featureListHtml(features: readonly string[]): string {
  if (features.length === 0) return '';
  const items = features
    .slice(0, MAX_SLIDE_FEATURES)
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join('');
  return `<ul class="feat">${items}</ul>`;
}

// Outward capability names for the PROJECTED chips (REQ-TESTER-CHIP-OUTWARD-LABELS,
// founder outward-naming policy 2026-09-06; routed via INSTRUCTIONS-FROM-STRATEGY
// 2026-09-07). The `tools` cell VALUES stay the loader enum (untouched — that is the
// machine contract `deck-validate.ts` checks); only the rendered label changes, and
// the chip CLASS keeps the raw enum (`chip-${t}`) so styling/tests are unaffected. An
// unrecognized value falls through to its raw text rather than disappearing.
const CHIP_LABELS: Partial<Record<CesTool, string>> = {
  muster: 'Readiness Evaluation',
  stamper: 'Configuration',
  ao: 'Operations',
  eo: 'Assessment',
};
// stacksim is demo infrastructure — the simulated tenant we demo against — not a
// product capability, so its chip is SUPPRESSED entirely: never styled beside the four
// capabilities (it would read as a fifth product). This supersedes the 2026-09-05
// "stacksim keeps its chip" note for the projected chip specifically.
const CHIP_SUPPRESS: ReadonlySet<CesTool> = new Set<CesTool>(['stacksim']);

function chipsHtml(tools: readonly CesTool[]): string {
  return tools
    .filter((t) => !CHIP_SUPPRESS.has(t))
    .map((t) => `<span class="chip chip-${t}">${escapeHtml(CHIP_LABELS[t] ?? t)}</span>`)
    .join('');
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Does this slide drive a live op? A staged slide's op never runs. This one
 * predicate gates the Now lozenge, the hold card, the app-pane mirror and the
 * neutral (non-gold) eyebrow. The telemetry rail it once also gated was removed
 * in STAGE-SIMPLIFY (REQ-TESTER-STAGE-SIMPLIFY, founder 2026-09-06).
 */
function slideDrivesOp(slide: DemoSlide): boolean {
  return slide.op.opId !== undefined && slide.op.mode !== 'staged';
}

/**
 * Does this slide render the in-slide app mirror (T1.5)? The same driven-op rule
 * (`slideDrivesOp`) — a staged op never runs, so it has nothing to stream — plus
 * a `theatrical`/`readout` mirror value. `theatrical` (a live GUI) and `readout`
 * (the op's own result card) render IDENTICALLY here: both stream the pane `<img>`
 * into the 50/50 `.pane`. The value only differs in the catalog default and the
 * doctrine note (a Config op is `readout`: its card streams, its GUI runs on the
 * unmirrorable backstage session and never surfaces).
 *
 * The RUN must also have the mirror active (`opts.mirrorActive`): under
 * `--pane-window` the app is the second window, so no `<img src="/mirror">` is
 * rendered and the mirror route has no subscribers.
 */
function slideMirrors(slide: DemoSlide): boolean {
  return slideDrivesOp(slide) && (slide.op.mirror === 'theatrical' || slide.op.mirror === 'readout');
}

export interface RenderSlideOptions {
  /** Render through the title path rather than the content path. */
  readonly isTitle?: boolean;
  /** 1-based position in the deck, used by the title stats and the hold-card foot. */
  readonly position?: number;
  readonly slideCount?: number;
  /** Every tool named anywhere in the deck — the title slide's chip row. */
  readonly deckTools?: readonly CesTool[];
  /** Deck title, used as the title slide's org line. */
  readonly deckTitle?: string;
  /**
   * Whether the in-slide app mirror is active for this RUN (T1.5). Only when
   * true does a `theatrical`/`readout` driven slide render the right-third split
   * + `<img src="/mirror">`. Absent/false (every `--check`, every `--pane-window`
   * run) renders exactly as today — the split path never appears, which is what
   * keeps non-mirror slides byte-identical.
   */
  readonly mirrorActive?: boolean;
}

/**
 * The title slide (mockup F5, state 1). A second branch over the same fields:
 * the mark, the first feature as the hero line, the next narration line as the
 * lede, and a stat row of counts the deck actually knows.
 */
function renderTitleHtml(slide: DemoSlide, opts: RenderSlideOptions): string {
  const features = column(slide, (r) => r.feature);
  const functions = column(slide, (r) => r.func);
  const benefits = column(slide, (r) => r.benefit);
  const title = features[0] ?? `Slide ${slide.slideNumber}`;
  const lede = features.slice(1).join(' · ') || functions[0] || benefits[0] || '';
  const tools = opts.deckTools ?? slide.op.tools;

  const stats: string[] = [];
  // Count the DISPLAYED capabilities (chips actually rendered), not raw tools:
  // stacksim is suppressed as infrastructure, so counting it would project "N tools"
  // above N−1 chips (REQ-TESTER-CHIP-OUTWARD-LABELS).
  const shownToolCount = tools.filter((t) => !CHIP_SUPPRESS.has(t)).length;
  if (shownToolCount > 0) stats.push(`<span class="big">${shownToolCount}</span><span>tools</span>`);
  if (opts.slideCount !== undefined) {
    if (stats.length > 0) stats.push('<span class="sep">/</span>');
    stats.push(`<span>${opts.slideCount} slides</span>`);
  }

  return (
    `<div class="title-head">` +
    `<span class="logo-mark big">${BHD_MARK}</span>` +
    `<span class="title-rule"></span>` +
    (opts.deckTitle === undefined || opts.deckTitle === ''
      ? ''
      : `<span class="title-org">${escapeHtml(opts.deckTitle)}</span>`) +
    `</div>` +
    `<h1 class="hero" data-i="0">${escapeHtml(title)}</h1>` +
    (lede === '' ? '' : `<p class="subtitle lede" data-i="1">${escapeHtml(lede)}</p>`) +
    (stats.length === 0 ? '' : `<div class="stat-row" data-i="2">${stats.join('')}</div>`) +
    // Gate on the RENDERED chips, not the raw tool count: a title whose only tool is
    // stacksim suppresses every chip, so it must emit no empty chip container.
    (chipsHtml(tools) === '' ? '' : `<div class="chips title-chips" data-i="3">${chipsHtml(tools)}</div>`)
  );
}

/**
 * The hold card — the >2.5s rung of the research's ladder. The differentiator
 * is the line the room should be reading while a live op takes its time; it
 * falls back through benefit and function so the card is never blank.
 */
export function renderHoldHtml(slide: DemoSlide, opts: RenderSlideOptions = {}): string {
  const features = column(slide, (r) => r.feature);
  const title = features[0] ?? `Slide ${slide.slideNumber}`;
  const line =
    column(slide, (r) => r.differentiator)[0] ??
    column(slide, (r) => r.benefit)[0] ??
    column(slide, (r) => r.func)[0] ??
    title;
  const foot = [title, slide.op.opId, opts.position !== undefined && opts.slideCount !== undefined
    ? `slide ${pad2(opts.position)} of ${pad2(opts.slideCount)}`
    : undefined]
    .filter((p): p is string => p !== undefined && p !== '')
    .map((p) => escapeHtml(p))
    .join(' · ');

  return (
    `<div class="hold-kicker"><span class="rule"></span><span>Hold · live operation in progress</span></div>` +
    `<div class="hold-rule"></div>` +
    `<p class="hold-line">${escapeHtml(line)}</p>` +
    (foot === '' ? '' : `<div class="hold-foot" data-i="0">${foot}</div>`)
  );
}

/**
 * The synthetic standby cover (GP-DEMO-6). Shown while the CES tools arm and
 * warm ops settle, before the real slide 1 is revealed. Composed ENTIRELY from
 * classes the LOCKED V4 sheet already defines (`slide-head`, `eyebrow`, `rule`,
 * `num`, `h1`, `subtitle`, `hold-kicker`) — no new CSS, because `SHOW_CSS` and
 * the page shell are pinned byte-for-byte by the golden fixture. It never drives
 * a real op and never dwells, so it is a static cover with a "standby" kicker.
 */
export function renderStandbyHtml(): string {
  return (
    `<div class="slide-head">` +
    `<div class="eyebrow"><span class="rule gold"></span>` +
    `<span class="num">00</span></div>` +
    `<h1>Preparing the demo</h1>` +
    `<div class="subtitle">Arming apps — the show begins in a moment.</div>` +
    `</div>` +
    `<div class="body">` +
    `<div class="hold-kicker"><span class="rule"></span>` +
    `<span>Standby · arming the CES tools</span></div>` +
    `</div>`
  );
}

/**
 * Render one slide's body. Multi-row slides stack every non-blank value under
 * its card — that is the point of authoring three benefit rows under one title.
 *
 * `opts` is optional on purpose: `demo:show --check` calls this with a slide and
 * nothing else, and must keep getting a content render with a bare `<h1>`.
 */
export function renderSlideHtml(slide: DemoSlide, opts: RenderSlideOptions = {}): string {
  if (opts.isTitle === true) return renderTitleHtml(slide, opts);

  const features = column(slide, (r) => r.feature);
  const functions = column(slide, (r) => r.func);
  const benefits = column(slide, (r) => r.benefit);
  const differentiators = column(slide, (r) => r.differentiator);

  const title = features[0] ?? `Slide ${slide.slideNumber}`;
  const drivesOp = slideDrivesOp(slide);

  // Prose dedup safeguard (GP-DEMO-6, founder 2026-09-07: "you are repeating prose
  // on the slides"). Within ONE slide's rendered text regions the SAME normalized
  // string must not appear more than once: keep the FIRST occurrence in visual order
  // (title → subtitle → Now lozenge → Function card text → its feature bullets →
  // Benefit → Differentiator) and drop any later exact restatement. The compare is
  // case/space-insensitive but EXACT — a line that merely CONTAINS another (a bullet
  // that echoes a phrase from a longer card sentence) is a legitimately distinct line
  // and is deliberately NOT dropped. This is render-level, so ANY deck (v2,
  // acts-showcase, future) is protected with no authoring change. It never touches
  // `renderHoldHtml` (a hold card is MEANT to restate a slide line) or the title/
  // talk-track paths, which build their own strings elsewhere.
  const seenProse = new Set<string>();
  const firstSeen = (value: string): boolean => {
    const key = value.trim().replace(/\s+/g, ' ').toLowerCase();
    if (key === '') return true; // never dedup an empty string
    if (seenProse.has(key)) return false;
    seenProse.add(key);
    return true;
  };
  firstSeen(title); // the title is the top-priority occurrence

  const subtitle = features.slice(1).filter(firstSeen).join(' · ');

  // On a driven-op slide, Function IS the "what you're seeing" — it is promoted
  // into the Now lozenge instead of being repeated as a card below it.
  const promoted = drivesOp ? functions[0] : undefined;
  const remainingFunctions = promoted === undefined ? functions : functions.slice(1);
  // The Now lozenge outranks the cards; it is dropped only if it exactly restates the
  // title (register it here, before the card regions, so it wins that tie).
  const promotedShown = promoted !== undefined && firstSeen(promoted) ? promoted : undefined;

  // Features are per-row, and one slide has one Function card, so the rows'
  // lists concatenate in sheet order rather than resolving unique-or-agree the
  // way an op field does.
  // (`features` above is the singular `feature` column — the slide title. This
  // is the plural `features` column, which is a different thing entirely.)
  const majorFeatures = slide.rows.flatMap((r) => r.features ?? []);

  // Dedup each card/bullet region in render order (Function text, then its bullets,
  // then Benefit, then Differentiator) so an exact restatement keeps its highest,
  // earliest occurrence and later copies vanish.
  const shownFunctions = remainingFunctions.filter(firstSeen);
  const shownFeatures = majorFeatures.filter(firstSeen);
  const shownBenefits = benefits.filter(firstSeen);
  const shownDifferentiators = differentiators.filter(firstSeen);

  const chips = chipsHtml(slide.op.tools);
  const cards =
    cardHtml('Function', 'fn', shownFunctions, featureListHtml(shownFeatures)) +
    cardHtml('Benefit', 'benefit', shownBenefits) +
    cardHtml('Differentiator', 'diff', shownDifferentiators);

  // Gold budget: a driven-op slide already spends gold on `#mode.warm` or
  // `#op.running`, so its eyebrow rule stays neutral. Only a no-op slide's
  // eyebrow earns the gold rule.
  const head =
    `<div class="slide-head">` +
    `<div class="eyebrow">` +
    `<span class="rule${drivesOp ? '' : ' gold'}"></span>` +
    `<span class="num">${escapeHtml(pad2(slide.slideNumber))}</span>` +
    (chips === '' ? '' : `<span class="chips">${chips}</span>`) +
    `</div>` +
    `<h1>${escapeHtml(title)}</h1>` +
    (subtitle === '' ? '' : `<div class="subtitle">${escapeHtml(subtitle)}</div>`) +
    `</div>`;

  // The "Now" lozenge — computed once: a driven-op slide promotes its Function
  // here. Empty for every other slide.
  const now =
    promotedShown === undefined
      ? ''
      : `<div class="now" data-i="0"><span class="eye"></span><span class="lbl">Now</span>` +
        `<span>${escapeHtml(promotedShown)}</span></div>`;

  // STAGE-SIMPLIFY (REQ-TESTER-STAGE-SIMPLIFY, founder 2026-09-06): a pane slide
  // splits the stage 50/50 — the content column sits in `.smain`, the app pane
  // (mirror `<img>` or the slide's static image) in `.pane`, both full height.
  const paneSplit = (leftInner: string, pane: string): string =>
    `<div class="shalf"><div class="smain">${leftInner}</div><div class="pane">${pane}</div></div>`;

  // An `html` body replaces the auto-rendered one. It is framed, never inlined:
  // strategy's CSS in the shell page would bleed into the LOCKED V4 sheet. The
  // sandbox has `allow-scripts` but deliberately NOT `allow-same-origin`, so
  // animation and inline JS run while the document stays opaque-origin and
  // cannot reach the slides server's state or `/nav`. An `html` body never panes.
  if (slide.op.html !== undefined) {
    const asset = slide.op.html;
    const frame =
      `<iframe class="slide-html" src="/asset/${encodeURIComponent(asset.id)}" ` +
      `sandbox="allow-scripts" title="${escapeHtml(asset.rawValue)}" loading="eager"></iframe>`;

    // Full-bleed: the author wrote a branded graphic and no narration, so the V4
    // head would only crop it. Boxed otherwise — the head still names the slide.
    const authoredChrome =
      features.length > 0 || functions.length > 0 || benefits.length > 0 || differentiators.length > 0;
    return authoredChrome
      ? head + `<div class="body body-html">${frame}</div>`
      : `<div class="body body-html body-full-bleed">${frame}</div>`;
  }

  // Placed AFTER the `html` early-return, so an `html` body wins over the pane.
  const images = slide.op.images
    .map((img) => `<img class="slide-image" src="/asset/${encodeURIComponent(img.id)}" alt="${escapeHtml(img.rawValue)}">`)
    .join('');

  // The screencast source (shared). `/mirror/backstage` ONLY for a theatrical
  // slide whose op drives the backstage session (the Config ops, GP-DEMO-5
  // streamgui); every other mirrored slide — including a `readout` stamper slide
  // — keeps `/mirror`, which is what keeps A1 inert until a Config op's catalog
  // `mirror` flips to theatrical.
  const mirrorSrc =
    slide.op.mirror === 'theatrical' && slide.op.mirrorSource === 'backstage' ? '/mirror/backstage' : '/mirror';
  // The app pane: just the live-streamed app, full pane height. GP-DEMO-6 (founder
  // 2026-09-07) removed the separate "APP NOW LIVE" placard — draw() now toggles `.live`
  // onto the `.mirror-img` frame itself so a soft gold glow breathes around the app
  // while its op runs.
  const mirrorPane =
    `<div class="pane-view"><img class="mirror-img" src="${mirrorSrc}" alt="live app"></div>`;
  const cardsInner = head + now + `<div class="cards">${cards}</div>`;
  const contentOnly = head + now + `<div class="body"><div class="cards">${cards}</div></div>`;

  // The founder's authored per-slide pane intent (`right-third`) is AUTHORITATIVE
  // when present — it overrides the op-catalog mirror gating below. Absent/blank/
  // unknown leaves `rightThird` unset, so a column-less deck falls through to the
  // existing gating and renders byte-identically (the compatibility invariant).
  const rt = slide.op.rightThird;
  if (rt === 'app') {
    // The driven app mirror streams into the pane — a static last-frame when the
    // op is not live. Needs the run's mirror active; under `--pane-window` /
    // `--check` there is no mirror route, so no pane (no invented image fallback).
    return opts.mirrorActive === true ? paneSplit(cardsInner, mirrorPane) : contentOnly;
  }
  if (rt === 'image') {
    // The slide's own static image fills the pane (direct `<img>`, not the mirror).
    // The loader downgrades an `image` with no asset to `absent`, so `images` is
    // normally non-empty here; guard anyway.
    return images !== '' ? paneSplit(cardsInner, `<div class="images">${images}</div>`) : contentOnly;
  }
  if (rt === 'absent') {
    // No PANE, even when the op is theatrical (it still drives the pane headless;
    // it is just not shown on this slide). `absent` suppresses the `.shalf` split
    // — NOT the image-only body takeover, which is a body, not a pane: the deck's
    // "full-bleed branded body" slides are `absent` + an image with no cards, and
    // the image IS the slide body there. absent + image + cards stays content-only
    // (full-width content, image dropped) — a case the real decks do not hit.
    if (images !== '' && cards === '') {
      return head + now + `<div class="body body-image-only"><div class="images">${images}</div></div>`;
    }
    return contentOnly;
  }

  // No column (or blank/unknown → unset): the existing gating, byte-identical to
  // before `right-third` was wired.
  //
  // The in-slide app mirror (T1.5): a driven `theatrical`/`readout` op with the
  // run's mirror active streams the pane into the full-height `.pane`.
  if (slideMirrors(slide) && opts.mirrorActive === true) {
    return paneSplit(cardsInner, mirrorPane);
  }
  // An image beside the cards splits the stage 50/50; an image with no cards
  // fills the body; cards alone are the whole slide.
  if (images !== '' && cards !== '') {
    return paneSplit(cardsInner, `<div class="images">${images}</div>`);
  }
  if (images !== '') {
    return head + now + `<div class="body body-image-only"><div class="images">${images}</div></div>`;
  }
  return contentOnly;
}

export interface BuildDeckViewOptions {
  readonly defaultDwellSec?: number;
  /** `--watchouts`. Defaults OFF — the band is exactly as today without it. */
  readonly watchouts?: boolean;
  /**
   * The in-slide app mirror (T1.5) is active for this run. Threaded into every
   * slide's render so the right-third split appears, and into `holdHtml` so a
   * mirrored slide never swaps its `<img>` out for the hold card. Defaults OFF —
   * `--check` and `--pane-window` build the deck exactly as today.
   */
  readonly mirrorActive?: boolean;
}

export function buildDeckView(deck: DemoDeck, opts: BuildDeckViewOptions = {}): DeckView {
  const deckTools: CesTool[] = [];
  for (const slide of deck.slides) {
    for (const t of slide.op.tools) if (!deckTools.includes(t)) deckTools.push(t);
  }

  // F5: the title treatment belongs to the first AUTHORED slide. With a standby
  // cover prepended it sits at deck index 1, so the title flag follows the first
  // non-standby slide rather than a hardcoded index 0. For a standby-free deck
  // `findIndex` is 0 and every value below is byte-identical to before.
  const titleIndex = Math.max(
    0,
    deck.slides.findIndex((s) => !isStandbySlide(s)),
  );
  // The standby cover is excluded from the position chrome (the title stat row
  // and the hold-card foot) so authored slide 1 still reads "01 of N".
  const realSlideCount = deck.slides.filter((s) => !isStandbySlide(s)).length;

  return {
    title: deck.title,
    defaultDwellSec: opts.defaultDwellSec ?? DEFAULT_DWELL_SEC,
    themeCss: themeCss(deck.theme),
    logoAssetId: deck.logoAsset?.id,
    showWatchouts: opts.watchouts === true,
    slides: deck.slides.map((slide, index) => {
      const standby = isStandbySlide(slide);
      const isTitle = index === titleIndex;
      // Position counts only authored slides — the standby cover does not occupy
      // a 1-of-N slot. For a standby-free deck this is exactly `index + 1`.
      const position = deck.slides.slice(0, index).filter((s) => !isStandbySlide(s)).length + 1;
      const render: RenderSlideOptions = {
        isTitle,
        position,
        slideCount: realSlideCount,
        deckTools,
        deckTitle: deck.title,
        mirrorActive: opts.mirrorActive === true,
      };
      // A mirrored slide's hold surface IS the `<img>`: `draw()` would otherwise
      // swap `html`->`holdHtml` after ~2.5s of a live op and remove the mirror at
      // exactly the moment the room should be watching the app. An empty
      // `holdHtml` makes `draw()` no-op the swap.
      const mirrored = opts.mirrorActive === true && slideMirrors(slide);
      return {
        index,
        number: slide.slideNumber,
        title: column(slide, (r) => r.feature)[0] ?? `Slide ${slide.slideNumber}`,
        // The standby cover renders its own static cover and never holds a card.
        html: standby ? renderStandbyHtml() : renderSlideHtml(slide, render),
        holdHtml: !standby && slideDrivesOp(slide) && !mirrored ? renderHoldHtml(slide, render) : '',
        talkTrack: column(slide, (r) => r.talkTrack),
        watchouts: column(slide, (r) => r.watchouts),
        tools: slide.op.tools,
        mode: slide.op.mode,
        opId: slide.op.opId,
        durationSec: slide.op.durationSec,
        isTitle,
      };
    }),
  };
}

/**
 * V4 — the founder-approved design, ported from
 * `docs/demo/design/mockups/v4-final-hybrid.html`. Sizes are multiples of `--u`
 * (1% of stage width), elevation is hairlines only, gold is rationed, and every
 * animation has a reduced-motion answer at the bottom of the sheet.
 */
const SHOW_CSS = `
:root{
  /* BHD-BRAND.md palette */
  --navy:#1a2332; --navy-deep:#0f1923; --navy-mid:#152030;
  --gold:#f5b74a;
  /* Text ramp — computed WCAG on #1a2332 (RESEARCH_SUMMARY 4) */
  --t1:#e8edf2; --t2:#c9d4e0; --t3:#8fa3b8; --t4:#7d8fa3;
  --pass:#4ade80; --warn:#ffb454;   /* fails are AMBER, never red */
  --hair:rgba(255,255,255,.10); --hair-soft:rgba(255,255,255,.06);
  --kbd-line:rgba(255,255,255,.18);
  /* The body face, as a token so a deck theme can replace it. Motion tokens
     below are deliberately NOT themeable — retiming breaks the reduced-motion
     answers at the foot of this sheet. */
  --font-sans:'Roboto',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;
  --ease-slide:cubic-bezier(.16,1,.3,1); --ease-brand:cubic-bezier(.4,0,.2,1);
  --slide-in:280ms; --frag:180ms; --pill:240ms;
}
*{box-sizing:border-box;}
[hidden]{display:none !important;}
html,body{margin:0;padding:0;height:100%;background:var(--navy-deep);overflow:hidden;
  user-select:none;-webkit-user-select:none;}
body{color:var(--t1);font-family:var(--font-sans);font-weight:400;}
body.cursor-idle{cursor:none;}

/* ---------------------------------------------------------------- STAGE --- */
.stage{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:min(100vw, 177.78vh); height:min(56.25vw, 100vh);
  --u:calc(min(100vw, 177.78vh) / 100);
  background:var(--navy);display:flex;flex-direction:column;overflow:hidden;
  font-size:calc(1*var(--u));
}
/* Console texture + vignette: decorative only, held at 1.6-2.8% so a
   lifted-black projector cannot turn it into visible banding. */
.texture{position:absolute;inset:0;pointer-events:none;z-index:1;
  background-image:
    repeating-linear-gradient(0deg,  rgba(255,255,255,.028) 0 1px, transparent 1px calc(4*var(--u))),
    repeating-linear-gradient(90deg, rgba(255,255,255,.028) 0 1px, transparent 1px calc(4*var(--u))),
    repeating-linear-gradient(0deg,  rgba(255,255,255,.016) 0 1px, transparent 1px 3px);}
.vignette{position:absolute;inset:0;pointer-events:none;z-index:1;
  box-shadow:inset 0 0 calc(12*var(--u)) rgba(10,16,24,.45);}

.slide-area{position:relative;z-index:2;flex:1;min-height:0;}

/* One slide element, re-animated on every change: 280ms opacity + a .73u
   (14px @1920) rise, never a rotate/cube/zoom. */
@keyframes stateIn{from{opacity:0;transform:translateY(calc(.73*var(--u)));}to{opacity:1;transform:none;}}
.state{
  position:absolute;inset:0;
  /* GP-DEMO-6 (founder 2026-09-07): top/bottom padding trimmed (3.2u→2.6u, 2.2u→1.8u)
     so the slide body — and with it the full-height app-frame pane — gains vertical
     extent. Side padding (8u) is unchanged. */
  padding:calc(2.6*var(--u)) calc(8*var(--u)) calc(1.8*var(--u));
  display:flex;flex-direction:column;min-height:0;overflow:hidden;
}
.state.anim{animation:stateIn var(--slide-in) var(--ease-slide) both;}
.state[data-render="title"]{justify-content:center;}
.state[data-render="hold"]{justify-content:center;align-items:flex-start;}

/* Fragment reveal — 180ms, .42u rise, 70ms stagger. Driven by :nth-child over
   the renderer's own markup, so no .frag class has to be emitted. */
@keyframes frag{from{opacity:0;transform:translateY(calc(.42*var(--u)));}to{opacity:1;transform:translateY(0);}}
.state.anim .slide-head > *,
.state.anim .cards > .card,
.state.anim .images,
.state.anim [data-i]{animation:frag var(--frag) var(--ease-slide) both;}
.state.anim .slide-head > *:nth-child(1){animation-delay:120ms;}
.state.anim .slide-head > *:nth-child(2){animation-delay:190ms;}
.state.anim .slide-head > *:nth-child(3){animation-delay:260ms;}
.state.anim .cards > .card:nth-child(1){animation-delay:260ms;}
.state.anim .cards > .card:nth-child(2){animation-delay:330ms;}
.state.anim .cards > .card:nth-child(3){animation-delay:400ms;}
.state.anim .images{animation-delay:330ms;}
/* CSS cannot read an attribute into var(), so the index is mapped explicitly. */
[data-i="0"]{--i:0;} [data-i="1"]{--i:1;} [data-i="2"]{--i:2;} [data-i="3"]{--i:3;}
.state.anim [data-i]{animation-delay:calc(var(--i,0) * 70ms + 120ms);}

/* -------------------------------------------------------------- EYEBROW --- */
.slide-head{flex:0 0 auto;}
.eyebrow{display:flex;align-items:center;gap:calc(1.1*var(--u));
  font-size:calc(1.25*var(--u));line-height:1;text-transform:uppercase;
  letter-spacing:.14em;font-weight:700;color:var(--t3);}
.eyebrow .num{color:var(--t2);font-variant-numeric:tabular-nums;}
/* 2px floor: a scaled hairline lands on a half pixel, and a half-lit gold line
   is exactly the low-luminance detail a projector eats. */
.rule{flex:0 0 auto;width:calc(3.2*var(--u));height:max(2px, calc(.16*var(--u)));background:var(--t4);}
.rule.gold{background:var(--gold);}

.chips{display:inline-flex;gap:calc(.6*var(--u));}
.chip{border:1px solid var(--hair);border-radius:calc(.28*var(--u));
  padding:calc(.2*var(--u)) calc(.8*var(--u));font-size:calc(1.05*var(--u));
  letter-spacing:.12em;font-weight:500;color:var(--t3);}
.title-chips{margin-top:calc(2*var(--u));}

/* ----------------------------------------------------------- TYPOGRAPHY --- */
h1{margin:calc(1.4*var(--u)) 0 0;font-size:calc(3*var(--u));line-height:1.1;
  font-weight:700;letter-spacing:-.012em;color:var(--t1);max-width:18ch;}
h1.hero{font-size:calc(4.6*var(--u));line-height:1.06;max-width:14ch;margin-top:calc(2.4*var(--u));}
.subtitle{margin:calc(1.3*var(--u)) 0 0;font-size:calc(1.88*var(--u));
  line-height:1.45;color:var(--t2);max-width:44ch;}
.subtitle.lede{font-size:calc(2.2*var(--u));max-width:40ch;}

/* ------------------------------------------------- LEDGER OF CARDS -------- */
/* Single-column ledger rows: hairline separation only, no fills and no coloured
   left borders (#243244 on navy is 1.21:1). Founder feedback 2026-09-05 cut the
   visible FUNCTION / BENEFIT / DIFFERENTIATOR label gutter — each row's text now
   stands alone as a statement, told apart by the text ramp (.card.fn is one step
   down) and the hairline, never by a label or a badge. */
.body{flex:1;min-height:0;display:flex;gap:calc(3*var(--u));margin-top:calc(.4*var(--u));overflow:hidden;}
.body-image-only .images{flex:1;min-width:0;}
/* STAGE-SIMPLIFY (REQ-TESTER-STAGE-SIMPLIFY, founder 2026-09-06): a pane slide
   splits the stage — the content column (.smain) beside the app pane (.pane),
   both full height. GP-DEMO-6 (founder 2026-09-07): the split is no longer 50/50.
   The app-frame pane sizes to the FRAME's natural width (see below), the content
   column (.smain, flex:1) takes ALL the remaining width, and the .shalf gap is the
   buffer between them — so the content text boxes run right up to a buffer short of the
   frame instead of stopping at a rigid half. */
.shalf{flex:1;min-height:0;display:flex;gap:calc(3*var(--u));}
.smain{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;}
.pane{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;
  position:relative;}
/* The APP-frame pane shrinks to the frame's own (portrait) width and right-aligns it,
   giving the content column the freed horizontal space. Scoped by :has(.pane-view) so
   ONLY the mirror app pane shrinks — a static IMAGE pane (.pane>.images, which can be
   landscape) keeps the flex:1 half above. */
/* aspect-ratio here (not only on .mirror-img) is LOAD-BEARING: flex-basis:auto would
   otherwise size .pane from the img's raw captured pixel width (its height:100% is
   indefinite during max-content measurement, so height×ratio can't be used) and
   flex-shrink:0 would pin .pane over-wide, leaving a dead gap left of the right-aligned
   frame. A definite ratio on the pane box (height is definite via the .body→.shalf→.pane
   column) computes width = height×736/1080 directly, so .smain reclaims the space and
   runs to the .shalf buffer before the frame. Do NOT remove as "redundant". */
.pane:has(.pane-view){flex:0 0 auto;aspect-ratio:736/1080;}
/* The app frame consumes the FULL pane height (founder 2026-09-07). justify-content
   flex-end right-aligns the frame within its (now frame-width) column. A static image
   pane fills the pane whole, unchanged. */
.pane-view{flex:1;min-height:0;display:flex;align-items:center;justify-content:flex-end;}
.pane>.images{flex:1;min-height:0;}
/* Beside the pane the content column runs nearly full width (the frame is a narrow
   portrait), so every ch wrapping cap is lifted (max-width:none) — title, subtitle,
   card paragraphs and feature bullets all use the whole content column before they
   wrap, no mid-band stop. GP-DEMO-6 (founder 2026-09-07): the app frame widened 15%
   (640→736 capture), so the content column lost ~4-6% of its width. To keep the slide
   BALANCED against the taller/wider frame and stop lines from clipping or wrapping to
   an awkward one-word tail, the shalf type sizes are each nudged DOWN a touch from the
   prior pass — h1 2.85→2.7u, card p 1.7→1.6u, now 1.42→1.36u, feat li 1.25→1.2u — and
   the subtitle is pinned at 1.7u (below h1, above card p). Hierarchy stays
   h1 > subtitle > card p > now > li. */
.shalf .card>p{font-size:calc(1.6*var(--u));max-width:none;}
.shalf h1{font-size:calc(2.7*var(--u));max-width:none;}
.shalf .subtitle{font-size:calc(1.7*var(--u));max-width:none;}
.shalf .now{font-size:calc(1.36*var(--u));max-width:none;}
.shalf .card>ul.feat>li{font-size:calc(1.2*var(--u));max-width:none;}
/* The app frame FILLS the pane vertically and scales its width proportionally
   (founder 2026-09-07): height pinned to 100% of the pane, width auto so the
   captured 736×1080 portrait keeps its aspect (pillar-boxed on a wider pane, never
   letter-boxed). aspect-ratio:auto 736/1080 (GP-DEMO-6: was 16/27 for the 640×1080
   capture; the +15% widening to 736 raises the ratio 0.593→0.681) gives the frame a
   definite width even before the mirror image loads — which is what lets the app-frame
   pane below shrink to the frame width (.pane:has(.pane-view)) instead of collapsing
   pre-load; auto defers to the real intrinsic ratio once loaded, so a future capture
   size can never letterbox silently. max-width:100% is only a guard against horizontal
   overflow on an unusually narrow pane. */
.mirror-img{height:100%;width:auto;max-width:100%;aspect-ratio:auto 736/1080;object-fit:contain;
  background:var(--navy-deep);border:1px solid var(--hair);border-radius:calc(.6*var(--u));}
/* GP-DEMO-6 app-frame polish (founder 2026-09-07): the "APP NOW LIVE" on-air sign is
   GONE. Instead, while a slide's op is running (draw() toggles .live onto the frame),
   a soft brand-gold glow breathes around the app frame — the room reads "the app is
   operating live" from the frame itself, no separate placard. Off-air: no glow, just the
   existing hairline frame border. */
.mirror-img.live{animation:appGlow 1.6s ease-in-out infinite;}
@keyframes appGlow{
  0%,100%{box-shadow:0 0 calc(.7*var(--u)) rgba(245,183,74,.16);}
  50%{box-shadow:0 0 calc(2.6*var(--u)) var(--accent-glow,rgba(245,183,74,.5));}
}
.paused .mirror-img.live{animation-play-state:paused;}
.cards{flex:1;min-width:0;display:flex;flex-direction:column;}
.card{padding:calc(1.2*var(--u)) 0;border-top:1px solid var(--hair);}
.card:last-child{border-bottom:1px solid var(--hair);}
/* The label stays in the DOM — screen readers and the render tests both pin it —
   but it is never painted. Absolute takes it out of flow, so the body text and
   the feature list start at the card's left edge and run full width. */
.card > h3{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;
  overflow:hidden;white-space:nowrap;clip:rect(0 0 0 0);clip-path:inset(50%);}
.card > p{margin:0 0 calc(.6*var(--u));font-size:calc(1.75*var(--u));
  line-height:1.45;color:var(--t1);}
.card > p:last-child{margin-bottom:0;}
.card.fn > p{color:var(--t2);}

/* Major features — a quiet list under the function card's text, full width now
   that the label gutter is gone. Muted ramp, below the 1.75u card body size,
   en-dash bullets, no fills, no gold. */
.card > ul.feat{margin:calc(.55*var(--u)) 0 0;padding:0;list-style:none;}
.card > ul.feat > li{position:relative;padding-left:calc(1.5*var(--u));
  margin-bottom:calc(.3*var(--u));font-size:calc(1.3*var(--u));line-height:1.4;
  color:var(--t3);}
.card > ul.feat > li:last-child{margin-bottom:0;}
.card > ul.feat > li::before{content:'\\2013';position:absolute;left:0;color:var(--t4);}

.images{display:flex;align-items:center;justify-content:center;min-height:0;}
.slide-image{max-width:100%;max-height:100%;object-fit:contain;
  border:1px solid var(--hair);border-radius:calc(.6*var(--u));background:transparent;}

/* An html slide body. The document owns its own layout, so the wrapper adds no
   padding and the frame carries no chrome — a deck's branded graphic must not be
   boxed inside a second frame it did not ask for. Full-bleed drops the V4 head
   entirely and fills the stage. */
.body-html{padding:0;display:block;}
.slide-html{width:100%;height:100%;border:0;background:transparent;display:block;}
.body-full-bleed{position:absolute;inset:0;}

/* --------------------------------------- "WHAT YOU'RE SEEING" CAPTION ----- */
.now{margin-top:calc(1.5*var(--u));align-self:flex-start;display:inline-flex;
  align-items:center;gap:calc(.9*var(--u));border:1px solid var(--hair);
  border-radius:calc(2*var(--u));padding:calc(.5*var(--u)) calc(1.3*var(--u));
  font-size:calc(1.46*var(--u));line-height:1.35;color:var(--t2);max-width:52ch;}
.now .lbl{flex:0 0 auto;font-size:calc(1*var(--u));text-transform:uppercase;
  letter-spacing:.16em;color:var(--t4);font-weight:700;}
.now .eye{flex:0 0 auto;width:calc(.7*var(--u));height:calc(.7*var(--u));
  border-radius:50%;background:var(--t2);animation:breathe 1.6s var(--ease-brand) infinite;}
@keyframes breathe{0%,100%{opacity:.4}50%{opacity:1}}
.paused .now .eye{animation-play-state:paused;}

/* ------------------------------------------------------- TITLE SLIDE ------ */
.title-head{display:flex;align-items:center;gap:calc(2*var(--u));flex:0 0 auto;}
.title-rule{flex:0 0 calc(6*var(--u));height:max(2px, calc(.16*var(--u)));background:var(--gold);}
.title-org{font-size:calc(1.25*var(--u));text-transform:uppercase;letter-spacing:.20em;
  color:var(--t3);font-weight:700;}
.stat-row{margin-top:calc(2.2*var(--u));display:flex;align-items:baseline;
  gap:calc(1.2*var(--u));flex-wrap:wrap;font-size:calc(1.46*var(--u));color:var(--t3);
  text-transform:uppercase;letter-spacing:.14em;font-weight:500;}
/* Deliberately NOT gold: the dwell fill is already ticking on this state. */
.stat-row .big{font-size:calc(3*var(--u));font-weight:700;line-height:1;
  color:var(--t1);font-variant-numeric:tabular-nums;letter-spacing:0;}
.stat-row .sep{color:var(--t4);}

/* -------------------------------------------------------------- LOGO ------ */
.logo-mark svg{display:block;height:calc(1.67*var(--u));width:auto;}
.logo-mark.big svg{height:calc(3.4*var(--u));}
/* A deck-supplied logo is an <img>, and gets the same box the inline mark has. */
.logo-mark img.logo-img{display:block;height:calc(1.67*var(--u));width:auto;}
.logo-mark.big img.logo-img{height:calc(3.4*var(--u));}
.logo-corner{position:absolute;right:calc(8*var(--u));bottom:calc(1.1*var(--u));
  z-index:2;opacity:.8;margin-right:calc(-2.1*var(--u));}

/* ------------------------------------------------- HOLD CARD (>2.5s) ------ */
.hold-kicker{display:flex;align-items:center;gap:calc(1.1*var(--u));
  font-size:calc(1.25*var(--u));text-transform:uppercase;letter-spacing:.16em;
  color:var(--t3);font-weight:700;}
.hold-line{margin:calc(2.2*var(--u)) 0 0;font-size:calc(2.6*var(--u));line-height:1.3;
  font-weight:400;color:var(--t1);max-width:26ch;animation:holdPulse 2s ease-in-out infinite;}
@keyframes holdPulse{0%,100%{opacity:1}50%{opacity:.72}}
.paused .hold-line{animation-play-state:paused;}
.hold-foot{margin-top:calc(2.2*var(--u));font-size:calc(1.46*var(--u));color:var(--t3);}
.hold-rule{margin-top:calc(1.2*var(--u));width:calc(20*var(--u));
  height:max(2px, calc(.16*var(--u)));background:var(--gold);}

/* --------------------------------------------------------- DWELL BAR ------ */
/* Depleting, LINEAR, constant colour, gold at 40%: no red, no pulse, no
   acceleration — those are what make a countdown stressful in a room. While an
   op holds the dwell has not started, so the bar is dormant at zero. */
.dwell{flex:0 0 auto;position:relative;z-index:3;height:max(3px, calc(.3*var(--u)));
  background:rgba(255,255,255,.05);}
.dwell i{display:block;height:100%;width:0%;background:rgba(245,183,74,.40);
  transition:width 1000ms linear;}
.dwell.holding i{width:0 !important;transition:none;}

/* ------------------------------------------------------------- CHROME ----- */
.chrome{flex:0 0 auto;position:relative;z-index:3;background:var(--navy-mid);
  border-top:1px solid var(--hair);padding:calc(1*var(--u)) calc(8*var(--u));
  display:flex;align-items:center;gap:calc(1.6*var(--u));font-size:calc(1*var(--u));
  color:var(--t3);letter-spacing:.06em;}
.chrome .grow{flex:1;}
#dots{display:inline-flex;gap:calc(.5*var(--u));align-items:center;}
#dots .dot{width:calc(.55*var(--u));height:calc(.55*var(--u));border-radius:50%;
  background:rgba(255,255,255,.18);
  transition:background var(--pill) var(--ease-slide), transform var(--pill) var(--ease-slide);}
#dots .dot.on{background:var(--gold);transform:scale(1.3);}

/* Nav chips — clickable PREV / NEXT / EXIT, sat beside the dots cluster
   (founder request 2026-09-05). Quiet chrome by construction: hairline border,
   muted text ramp, NO gold (the ≤3-per-state budget is already spent on the
   active dot, the dwell fill and #mode.warm / #op.running). A <button> inherits
   neither font nor colour, so both are reset explicitly. */
#navbtns{display:inline-flex;gap:calc(.5*var(--u));align-items:center;
  margin-left:calc(1.2*var(--u));}
.navbtn{font:inherit;background:transparent;cursor:pointer;
  display:inline-flex;align-items:center;height:calc(1.5*var(--u));
  padding:0 calc(.9*var(--u));border:1px solid var(--hair);
  border-radius:calc(.28*var(--u));font-size:calc(.82*var(--u));
  letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--t3);
  transition:color 300ms var(--ease-brand), border-color 300ms var(--ease-brand);}
.navbtn:hover{color:var(--t1);border-color:var(--kbd-line);}

/* "Move on" escape (founder 2026-09-08). A live/warm op-slide holds the show
   until the op finishes; in a real demo the presenter must be able to walk
   forward without waiting out a minutes-long act. It appears ONLY while the
   current slide is holding on an op (holdRung >= 1), dispatches the SAME next
   the Next chip and ArrowRight already send, and leaves the running op alone —
   it finishes on the single queue, in deck order. Gold on purpose: during a
   hold the dwell fill is dormant, so this is THE live action on screen. */
#moveon{font:inherit;cursor:pointer;margin-left:calc(1.2*var(--u));
  display:inline-flex;align-items:center;height:calc(1.7*var(--u));
  padding:0 calc(1.15*var(--u));border:1px solid var(--gold);
  border-radius:calc(.28*var(--u));font-size:calc(.9*var(--u));
  letter-spacing:.12em;text-transform:uppercase;font-weight:700;
  color:var(--gold);background:rgba(245,183,74,.08);
  transition:background 300ms var(--ease-brand),color 300ms var(--ease-brand);}
#moveon:hover{background:rgba(245,183,74,.2);}
#moveon[hidden]{display:none;}

/* --------------------------------------------------- PRESENTER BAND ------- */
.presenter{flex:0 0 auto;position:relative;z-index:3;background:var(--navy-deep);
  border-top:1px solid var(--hair);padding:calc(1*var(--u)) calc(8*var(--u));
  display:block;max-height:23%;overflow:hidden;
  transition:opacity var(--pill) var(--ease-brand);}
/* GP-DEMO-6 (founder 2026-09-07): the talk track uses the FULL band width (max-width
   cap lifted, was 96ch) and a slightly larger face (1.35u, was 1.2u). Wider paragraphs
   wrap to fewer lines, so the larger size still fits under the 23% band cap above. */
.presenter p{margin:0 0 calc(.45*var(--u));font-size:calc(1.35*var(--u));line-height:1.38;
  color:var(--t2);max-width:none;}
.presenter p:last-child{margin-bottom:0;}
.presenter.hidden{display:none;}
/* Watchout cues — amber-muted, below the talk track's size, one hairline above.
   Never gold: the V4 gold budget is <=3 elements per state and the talk track
   is not one of them. Spans the content column, under the track it qualifies. */
.p-watch{grid-column:2;margin-top:calc(.7*var(--u));padding-top:calc(.6*var(--u));
  border-top:1px solid var(--hair-soft);}
.p-watch[hidden]{display:none;}
.p-watch p{font-size:calc(1.15*var(--u));line-height:1.4;color:var(--warn);
  opacity:.85;margin:0 0 calc(.35*var(--u));}

.exited{position:absolute;inset:0;z-index:4;display:flex;align-items:center;
  justify-content:center;background:rgba(15,25,35,.94);font-size:calc(2.4*var(--u));
  letter-spacing:.06em;color:var(--t3);}
.exited.hidden{display:none;}

/* prefers-reduced-motion — 120ms opacity only, no transforms, no pulses. */
@media (prefers-reduced-motion: reduce){
  #dots .dot,.navbtn,.now,.presenter{
    transition-duration:120ms !important;transition-property:opacity !important;
    transition-delay:0ms !important;}
  @keyframes fragFade{from{opacity:0}to{opacity:1}}
  .state.anim,
  .state.anim .slide-head > *,
  .state.anim .cards > .card,
  .state.anim .images,
  .state.anim [data-i]{
    animation-duration:120ms !important;animation-delay:0ms !important;
    animation-name:fragFade !important;}
  .hold-line,.now .eye{animation:none !important;opacity:1 !important;}
  /* No breathing glow under reduced motion — a static gold glow still marks the frame live. */
  .mirror-img.live{animation:none !important;
    box-shadow:0 0 calc(1.2*var(--u)) rgba(245,183,74,.4) !important;}
  .dwell i{transition:none !important;}
}
`;

/**
 * The full slides page. The deck ships inlined; the page holds no logic beyond
 * "draw the snapshot the server just sent" and "POST the key I just saw".
 *
 * The keyboard bindings are unchanged (`keyToAction`): arrows move, `t` toggles
 * the talk track, `a` holds (the existing toggle-auto action, because `p` is
 * already prev). STAGE-SIMPLIFY removed the on-stage kbd advisory chips.
 */
export function renderShowHtml(view: DeckView): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(view.title)} — CES demo</title>
<style>${SHOW_CSS}</style>
${view.themeCss === '' ? '' : `<style id="deck-theme">${view.themeCss}</style>\n`}</head>
<body>
<div class="stage" id="stage">
  <div class="texture"></div>
  <div class="vignette"></div>
  <div class="slide-area">
    <div class="state" id="slide"></div>
    <span class="logo-corner logo-mark" id="logo">${
      view.logoAssetId === undefined
        ? BHD_MARK
        : // SERVED via /asset/<id>, never inlined: an <img>-referenced SVG cannot
          // execute script, which removes the sanitization problem entirely
          // rather than trying to out-regex onload= and <foreignObject>.
          `<img class="logo-img" src="/asset/${encodeURIComponent(view.logoAssetId)}" alt="">`
    }</span>
    <div class="exited hidden" id="exited">demo ended — this window is closing</div>
  </div>
  <div class="dwell" id="dwell-track"><i id="dwell"></i></div>
  <div class="chrome">
    <span id="dots"></span><span id="navbtns"
      ><button type="button" class="navbtn" data-nav="prev" tabindex="-1">Prev</button
      ><button type="button" class="navbtn" data-nav="next" tabindex="-1">Next</button
      ><button type="button" class="navbtn" data-nav="exit" tabindex="-1">Exit</button
    ></span>
    <button type="button" id="moveon" tabindex="-1" hidden>Move on&nbsp;&#9654;</button>
    <span class="grow"></span>
    <!-- #pos is kept in the DOM but hidden and audience-invisible: founder
         feedback 2026-09-05 made the dots the SINGLE position indicator and cut
         the numeric "slide 07 / 08" counter. draw() still writes it, so any
         operator tooling reading the DOM keeps working. -->
    <b id="pos" hidden></b>
  </div>
  <div class="presenter" id="presenter">
    <div id="talk"></div>
    <div class="p-watch" id="watch"></div>
  </div>
</div>
<script id="deck-data" type="application/json">__DECK__</script>
<script>
(function(){
  var DECK = JSON.parse(document.getElementById('deck-data').textContent);
  var $ = function(id){ return document.getElementById(id); };
  var stageEl = $('stage'), slideEl = $('slide'), logoEl = $('logo');
  var presenterEl = $('presenter'), talkEl = $('talk'), watchEl = $('watch');
  var posEl = $('pos');
  var dotsEl = $('dots'), exitedEl = $('exited');
  var dwellEl = $('dwell'), dwellTrack = $('dwell-track');
  var moveonEl = $('moveon');
  var drawn = '';

  dotsEl.innerHTML = DECK.slides.map(function(){ return '<span class="dot"></span>'; }).join('');
  var dots = dotsEl.querySelectorAll('.dot');

  function draw(snap){
    var slide = DECK.slides[snap.index];
    if (!slide) return;
    var status = snap.opStatus;
    var pending = (status === 'pending' || status === 'running');
    // The research's hold ladder: 0-800ms silent, 800ms-2.5s a status pill,
    // >2.5s the full-slide hold card. holdRung is computed on the server.
    var hold = pending && snap.holdRung >= ${HOLD_CARD_RUNG} && slide.holdHtml !== '';
    var key = snap.index + (hold ? ':hold' : '');

    if (drawn !== key) {
      slideEl.className = 'state';
      slideEl.setAttribute('data-render', hold ? 'hold' : (slide.isTitle ? 'title' : 'content'));
      slideEl.innerHTML = hold ? slide.holdHtml : slide.html;
      void slideEl.offsetWidth;          /* replay the enter + stagger */
      slideEl.className = 'state anim';
      drawn = key;
    }
    logoEl.hidden = !!slide.isTitle;

    // The app-frame live glow (GP-DEMO-6): while this slide's op is running
    // (pending/running), the mirror frame breathes a soft gold glow; off otherwise.
    // Re-applied every draw AFTER the innerHTML swap above, so a fresh frame element
    // picks up .live in the same pass. Absent on non-mirror slides — no frame, no-op.
    var frame = slideEl.querySelector('.mirror-img');
    if (frame) frame.classList.toggle('live', pending);

    var talk = slide.talkTrack || [];
    presenterEl.className = 'presenter' + (snap.presenter && talk.length ? '' : ' hidden');
    talkEl.innerHTML = talk.map(function(t){
      var d = document.createElement('p'); d.textContent = t; return d.outerHTML;
    }).join('');
    var cues = (DECK.showWatchouts && slide.watchouts) || [];
    watchEl.innerHTML = cues.map(function(t){
      var d = document.createElement('p'); d.textContent = t; return d.outerHTML;
    }).join('');
    watchEl.hidden = !cues.length;

    posEl.textContent = (snap.index + 1) + ' / ' + snap.slideCount;

    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === snap.index);

    var total = slide.durationSec || DECK.defaultDwellSec;
    var dormant = snap.remainingSec === null;
    dwellTrack.className = 'dwell' + (dormant ? ' holding' : '');
    dwellEl.style.width = dormant
      ? '0%'
      : Math.max(0, Math.min(100, (snap.remainingSec / total) * 100)) + '%';

    // "Move on" appears once the room has been waiting on this slide's op long
    // enough to notice (rung 1 = the ladder's pill threshold), and vanishes the
    // instant the op finishes and the dwell starts. It never advances by itself
    // — it just makes the always-available manual next visible during a hold.
    moveonEl.hidden = !(pending && snap.holdRung >= 1) || snap.exited;

    // 'a' (toggle-auto) is the hold key; a held deck stops every pulse.
    stageEl.classList.toggle('paused', !snap.auto);

    exitedEl.className = 'exited' + (snap.exited ? '' : ' hidden');
  }

  function send(body){
    fetch('/nav', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      .catch(function(){ /* the server is tearing down; the window follows */ });
  }

  var noInput = new URLSearchParams(location.search).has('no-input');

  if (!noInput) {
  document.addEventListener('keydown', function(e){
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // keyToAction is keyed on lowercase letters, so Shift+T must still work —
    // an advisory chip that names a key which does nothing is a lie.
    send({ key: e.key.length === 1 ? e.key.toLowerCase() : e.key });
    e.preventDefault();
  });
  /* The nav chips drive the SAME keys the keyboard sends, so there is no second
     nav path to keep in sync and no binding changes: prev/next/exit are already
     ArrowLeft / ArrowRight / Escape in keyToAction. Two guards matter — the
     click must not also reach the click-to-advance handler below (both chips
     sit in the left quarter, so a NEXT click would have fired ArrowLeft too),
     and mousedown is defaulted away so a chip never takes focus and turns a
     later Space/Enter into a second nav. */
  var NAV_KEYS = { prev:'ArrowLeft', next:'ArrowRight', exit:'Escape' };
  var navEl = $('navbtns');
  navEl.addEventListener('mousedown', function(e){ e.preventDefault(); });
  navEl.addEventListener('click', function(e){
    e.stopPropagation();
    var btn = e.target && e.target.closest ? e.target.closest('.navbtn') : null;
    if (!btn) return;
    var key = NAV_KEYS[btn.getAttribute('data-nav')];
    if (key) send({ key: key });
  });

  /* "Move on" sends the SAME next key (ArrowRight) the Next chip does. stop the
     click reaching the click-to-advance handler below (it would fire a second
     ArrowRight) and default mousedown so the button never steals focus. */
  moveonEl.addEventListener('mousedown', function(e){ e.preventDefault(); });
  moveonEl.addEventListener('click', function(e){
    e.stopPropagation();
    send({ key: 'ArrowRight' });
  });

  document.addEventListener('click', function(e){
    send({ key: e.clientX < window.innerWidth / 4 ? 'ArrowLeft' : 'ArrowRight' });
  });
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  }

  /* Cursor auto-hide at 2500ms — reveal's 5000 is too long for a live demo. */
  var cursorTimer;
  function wake(){
    document.body.classList.remove('cursor-idle');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(function(){ document.body.classList.add('cursor-idle'); }, 2500);
  }
  document.addEventListener('mousemove', wake);
  wake();

  var events = new EventSource('/events');
  events.addEventListener('state', function(e){ draw(JSON.parse(e.data)); });
})();
</script>
</body>
</html>
`.replace('__DECK__', embedJson(view));
}
