// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S2 — the auto-rendered 16:9 slide (FD-4).
 *
 * `renderSlideHtml` is the SAME function `demo:show --check` and the live
 * slides page both use, so these assertions cover both. Three things are worth
 * pinning: multi-row slides stack (the reason the format has rows at all),
 * an `image` cell reaches the page as `/asset/<id>` and never as a filesystem
 * path, and every founder-authored cell is escaped — a deck is untrusted input
 * as far as the page is concerned.
 */

import { describe, it, expect } from 'vitest';
import type { DemoDeck, DemoSlide } from '../src/demo/show/deck-model.js';
import {
  buildDeckView,
  embedJson,
  escapeHtml,
  renderHoldHtml,
  renderShowHtml,
  renderSlideHtml,
} from '../src/demo/show/slide-render.js';

const MULTI_ROW: DemoSlide = {
  slideNumber: 5,
  rows: [
    {
      sheetRow: 7,
      slideNumber: 5,
      talkTrack: 'Stamper takes that plan and remediates.',
      feature: 'Stamper',
      func: 'Applies and verifies remediation tasks',
    },
    {
      sheetRow: 8,
      slideNumber: 5,
      benefit: 'Nothing is reported fixed that was not',
      differentiator: 'Apply and verify are one artifact',
    },
    {
      sheetRow: 9,
      slideNumber: 5,
      benefit: 'A second benefit line, same slide',
    },
  ],
  op: { mode: 'staged', tools: ['stamper'], durationSec: 40, images: [] },
};

describe('renderSlideHtml', () => {
  it('takes the title from the first feature and stacks every row under its card', () => {
    const html = renderSlideHtml(MULTI_ROW);
    expect(html).toContain('<h1>Stamper</h1>');
    expect(html).toContain('Applies and verifies remediation tasks');
    expect(html).toContain('Nothing is reported fixed that was not');
    expect(html).toContain('A second benefit line, same slide');
    expect(html).toContain('Apply and verify are one artifact');
    // Two benefit rows, one Benefit card.
    expect(html.match(/<h3>Benefit<\/h3>/g)).toHaveLength(1);
    expect(html.match(/class="card benefit"/g)).toHaveLength(1);
  });

  it('lists major features under the function card, capped at five', () => {
    const html = renderSlideHtml({
      ...MULTI_ROW,
      rows: [
        { ...MULTI_ROW.rows[0], features: ['Registry-driven plan compilation', 'No-write tenant assessment'] },
        ...MULTI_ROW.rows.slice(1),
      ],
    });
    // The list sits INSIDE the function card, after its text — not as a card of
    // its own and not before the function it describes. (The <h3> pinned here is
    // structure, not a visible label: since 2026-09-05 `.card > h3` is visually
    // hidden — see 'keeps the card labels in the DOM but never paints them'.)
    expect(html).toContain(
      '<section class="card fn"><h3>Function</h3><p>Applies and verifies remediation tasks</p>' +
        '<ul class="feat"><li>Registry-driven plan compilation</li><li>No-write tenant assessment</li></ul></section>',
    );
    // Quiet chrome: no gold, no fills — the list is styled off the muted ramp.
    expect(html).not.toContain('feat gold');
  });

  it('concatenates each row\'s own list in sheet order and shows only the first five', () => {
    const html = renderSlideHtml({
      ...MULTI_ROW,
      rows: [
        { ...MULTI_ROW.rows[0], features: ['one', 'two', 'three'] },
        { ...MULTI_ROW.rows[1], features: ['four', 'five', 'six'] },
        MULTI_ROW.rows[2],
      ],
    });
    for (const shown of ['one', 'two', 'three', 'four', 'five']) {
      expect(html).toContain(`<li>${shown}</li>`);
    }
    // The sixth is authored, warned about at load time, and not displayed.
    expect(html).not.toContain('<li>six</li>');
    expect(html.match(/<li>/g)).toHaveLength(5);
  });

  it('keeps the function card alive for the list when the rail promoted the function', () => {
    // A rail slide moves function[0] into the Now lozenge, which would leave the
    // Function card empty — the list must not vanish with it.
    const html = renderSlideHtml(
      {
        slideNumber: 6,
        rows: [
          {
            sheetRow: 8,
            slideNumber: 6,
            feature: 'AdminOps',
            func: 'A tiered command registry',
            features: ['95-command governed registry', 'Tier-3 two-person approval'],
          },
        ],
        op: { mode: 'warm', opId: 'ao-registry', tools: ['ao'], durationSec: 45, images: [] },
      },
      { position: 6, slideCount: 8 },
    );
    // Promoted into the lozenge, exactly as before.
    expect(html).toContain('<span class="lbl">Now</span><span>A tiered command registry</span>');
    // ...and NOT repeated as card text, but the card still carries the list.
    expect(html).toContain('<section class="card fn"><h3>Function</h3><ul class="feat">');
    expect(html).toContain('<li>95-command governed registry</li>');
    expect(html.match(/A tiered command registry/g)).toHaveLength(1);
  });

  it('escapes feature text like every other founder-authored cell', () => {
    const html = renderSlideHtml({
      slideNumber: 1,
      rows: [{ sheetRow: 2, slideNumber: 1, feature: 'T', func: 'f', features: ['<img src=x>', 'POA&M lifecycle'] }],
      op: { mode: 'staged', tools: [], images: [] },
    });
    expect(html).toContain('<li>&lt;img src=x&gt;</li>');
    expect(html).toContain('<li>POA&amp;M lifecycle</li>');
    expect(html).not.toContain('<img src=x>');
  });

  it('renders no list markup at all when a slide has no features', () => {
    expect(renderSlideHtml(MULTI_ROW)).not.toContain('ul class="feat"');
  });

  it('renders tool chips and the zero-padded slide number in the V4 eyebrow', () => {
    const html = renderSlideHtml(MULTI_ROW);
    expect(html).toContain('chip-stamper');
    // The chip CLASS keeps the raw enum (chip-stamper); the projected LABEL is the
    // outward capability name (REQ-TESTER-CHIP-OUTWARD-LABELS): stamper → Configuration.
    expect(html).toContain('>Configuration<');
    // V4 eyebrow: rule + tabular number + chips. A slide with no op spends its
    // gold here, so the rule is the gold one.
    expect(html).toContain('<div class="eyebrow">');
    expect(html).toContain('<span class="rule gold"></span>');
    expect(html).toContain('<span class="num">05</span>');
  });

  it('omits cards that have no content at all', () => {
    const html = renderSlideHtml({
      slideNumber: 1,
      rows: [{ sheetRow: 2, slideNumber: 1, feature: 'Title only' }],
      op: { mode: 'staged', tools: [], images: [] },
    });
    expect(html).toContain('<h1>Title only</h1>');
    expect(html).not.toContain('<h3>Benefit</h3>');
    expect(html).not.toContain('<h3>Function</h3>');
  });

  it('falls back to the slide number when no row carries a feature', () => {
    const html = renderSlideHtml({
      slideNumber: 12,
      rows: [{ sheetRow: 2, slideNumber: 12, benefit: 'b' }],
      op: { mode: 'staged', tools: [], images: [] },
    });
    expect(html).toContain('<h1>Slide 12</h1>');
  });

  it('renders extra feature values as a subtitle rather than dropping them', () => {
    const html = renderSlideHtml({
      slideNumber: 2,
      rows: [
        { sheetRow: 2, slideNumber: 2, feature: 'First' },
        { sheetRow: 3, slideNumber: 2, feature: 'Second' },
      ],
      op: { mode: 'staged', tools: [], images: [] },
    });
    expect(html).toContain('<h1>First</h1>');
    expect(html).toContain('class="subtitle">Second');
  });
});

describe('image cells', () => {
  const withImage = (rows: DemoSlide['rows']): DemoSlide => ({
    slideNumber: 3,
    rows,
    op: {
      mode: 'staged',
      tools: [],
      images: [{ id: 'art-one.png', rawValue: 'art/one.png', absPath: 'C:/repo/demos/art/one.png' }],
    },
  });

  it('serves the image from /asset/<id> and never leaks the filesystem path', () => {
    const html = renderSlideHtml(withImage([{ sheetRow: 2, slideNumber: 3, feature: 'F', benefit: 'B' }]));
    expect(html).toContain('src="/asset/art-one.png"');
    expect(html).not.toContain('C:/repo');
    // STAGE-SIMPLIFY: with cards present the image sits in the full-height pane
    // beside the content column — the 50/50 shalf split, not a lower body inset.
    expect(html).toContain('class="shalf"');
    expect(html).toContain('class="pane"');
    expect(html).not.toContain('body-split');
  });

  it('an image with no card content takes over the body', () => {
    const html = renderSlideHtml(withImage([{ sheetRow: 2, slideNumber: 3, feature: 'Just art' }]));
    expect(html).toContain('body body-image-only');
    expect(html).toContain('<h1>Just art</h1>');
  });

  it('URL-encodes the asset id', () => {
    const html = renderSlideHtml({
      slideNumber: 1,
      rows: [{ sheetRow: 2, slideNumber: 1 }],
      op: { mode: 'staged', tools: [], images: [{ id: 'a b.png', rawValue: 'a b.png', absPath: '/x/a b.png' }] },
    });
    expect(html).toContain('src="/asset/a%20b.png"');
  });
});

describe('reserved presenter columns', () => {
  const cued = (): DemoDeck => ({
    sourcePath: 'demos/t.xlsx',
    baseDir: 'C:/repo/demos',
    title: 't',
    assets: [],
    warnings: [],
    slides: [
      {
        slideNumber: 1,
        rows: [
          { sheetRow: 2, slideNumber: 1, feature: 'A', talkTrack: 'say this', watchouts: 'do not click Refresh', show: 'stand left' },
          { sheetRow: 3, slideNumber: 1, benefit: 'B', watchouts: 'the sim is slow here' },
        ],
        op: { mode: 'staged', tools: [], images: [] },
      },
    ],
  });

  it('collects watchouts per row, in sheet order, like the talk track', () => {
    const view = buildDeckView(cued(), { watchouts: true });
    expect(view.slides[0].watchouts).toEqual(['do not click Refresh', 'the sim is slow here']);
    expect(view.showWatchouts).toBe(true);
  });

  it('defaults OFF — the band is exactly as today without the flag', () => {
    const view = buildDeckView(cued());
    expect(view.showWatchouts).toBe(false);
    // The cues are still CARRIED (the deck said them); the shell just draws none.
    expect(view.slides[0].watchouts).toHaveLength(2);
  });

  it('renders the band container always, and fills it only when enabled', () => {
    const on = renderShowHtml(buildDeckView(cued(), { watchouts: true }));
    const off = renderShowHtml(buildDeckView(cued()));
    // The container is static markup either way — `draw()` decides.
    for (const page of [on, off]) expect(page).toContain('<div class="p-watch" id="watch"></div>');
    expect(on).toContain('"showWatchouts":true');
    expect(off).toContain('"showWatchouts":false');
    // The gate is exactly that flag, so a deck cannot force cues on.
    expect(on).toContain('var cues = (DECK.showWatchouts && slide.watchouts) || [];');
  });

  it('styles the cues amber-muted, never gold — the V4 gold budget is <=3 per state', () => {
    const page = renderShowHtml(buildDeckView(cued(), { watchouts: true }));
    expect(page).toContain('color:var(--warn)');
    expect(page).toMatch(/\.p-watch p\{[^}]*var\(--warn\)/);
    expect(page).not.toMatch(/\.p-watch[^}]*var\(--gold\)/);
  });

  it('`show` is captured on the row and NOT rendered — it is reserved', () => {
    const deck = cued();
    expect(deck.slides[0].rows[0].show).toBe('stand left');
    const page = renderShowHtml(buildDeckView(deck, { watchouts: true }));
    expect(page).not.toContain('stand left');
  });
});

describe('html slide bodies', () => {
  const HTML_ASSET = { id: 'slides-hero.html', rawValue: 'slides/hero.html', absPath: 'C:/repo/demos/slides/hero.html' };

  const withHtml = (rows: DemoSlide['rows']): DemoSlide => ({
    slideNumber: 4,
    rows,
    op: { mode: 'staged', tools: [], images: [], html: HTML_ASSET },
  });

  it('frames the document from /asset/<id>, sandboxed and opaque-origin', () => {
    const html = renderSlideHtml(withHtml([{ sheetRow: 2, slideNumber: 4, feature: 'The shape of it' }]));
    expect(html).toContain('<iframe class="slide-html" src="/asset/slides-hero.html"');
    expect(html).toContain('sandbox="allow-scripts"');
    // No allow-same-origin: the document must not reach the server's state or /nav.
    expect(html).not.toContain('allow-same-origin');
    expect(html).not.toContain('C:/repo');
    expect(html).toContain('title="slides/hero.html"');
  });

  it('replaces the auto-rendered body — no cards, no images', () => {
    const html = renderSlideHtml(
      withHtml([
        { sheetRow: 2, slideNumber: 4, feature: 'Boxed', benefit: 'B', differentiator: 'D', func: 'F' },
      ]),
    );
    expect(html).toContain('class="body body-html"');
    expect(html).not.toContain('class="card');
    expect(html).not.toContain('class="cards"');
    expect(html).not.toContain('slide-image');
  });

  it('keeps the V4 head when the author wrote narration (boxed)', () => {
    const html = renderSlideHtml(withHtml([{ sheetRow: 2, slideNumber: 4, feature: 'Boxed' }]), {
      position: 4,
      slideCount: 9,
    });
    expect(html).toContain('<h1>Boxed</h1>');
    expect(html).toContain('<span class="num">04</span>');
    expect(html).not.toContain('body-full-bleed');
  });

  it('suppresses the head entirely when the slide carries no narration (full-bleed)', () => {
    // Talk track is presenter-band only, so it does not count as slide chrome.
    const html = renderSlideHtml(withHtml([{ sheetRow: 2, slideNumber: 4, talkTrack: 'say this' }]));
    expect(html).toContain('class="body body-html body-full-bleed"');
    expect(html).not.toContain('<h1>');
    expect(html).not.toContain('slide-head');
  });

  it('a function/benefit/differentiator cell alone is enough to keep the head', () => {
    for (const row of [
      { sheetRow: 2, slideNumber: 4, func: 'F' },
      { sheetRow: 2, slideNumber: 4, benefit: 'B' },
      { sheetRow: 2, slideNumber: 4, differentiator: 'D' },
    ]) {
      const html = renderSlideHtml(withHtml([row]));
      expect(html).toContain('<h1>Slide 4</h1>');
      expect(html).not.toContain('body-full-bleed');
    }
  });

  it('an html body on a driven-op slide still frames the document, with no telemetry rail (STAGE-SIMPLIFY)', () => {
    const html = renderSlideHtml(
      {
        slideNumber: 7,
        rows: [{ sheetRow: 2, slideNumber: 7, feature: 'Live' }],
        op: { mode: 'live', opId: 'ao-registry', tools: ['ao'], images: [], html: HTML_ASSET },
      },
      { position: 7, slideCount: 9 },
    );
    // The rail and its grid are gone; an html body never panes either.
    expect(html).not.toContain('class="rail"');
    expect(html).not.toContain('class="slide-grid"');
    expect(html).not.toContain('class="shalf"');
    expect(html).toContain('class="slide-html"');
  });

  it('URL-encodes the asset id', () => {
    const html = renderSlideHtml({
      slideNumber: 1,
      rows: [{ sheetRow: 2, slideNumber: 1 }],
      op: { mode: 'staged', tools: [], images: [], html: { id: 'a b.html', rawValue: 'a b.html', absPath: '/x/a b.html' } },
    });
    expect(html).toContain('src="/asset/a%20b.html"');
  });
});

describe('escaping', () => {
  it('escapes founder-authored text everywhere it lands', () => {
    const html = renderSlideHtml({
      slideNumber: 1,
      rows: [
        {
          sheetRow: 2,
          slideNumber: 1,
          feature: '<script>alert(1)</script>',
          benefit: 'a & b "quoted" \'single\'',
        },
      ],
      op: { mode: 'staged', tools: [], images: [] },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('a &amp; b &quot;quoted&quot; &#39;single&#39;');
  });

  it('escapeHtml and embedJson cover the two injection routes', () => {
    expect(escapeHtml('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&#39;');
    // The inline-embed guard: a literal </script> must not close the block.
    expect(embedJson({ x: '</script>' })).not.toContain('</script>');
    expect(embedJson({ x: '</script>' })).toContain('\\u003c/script>');
  });
});

describe('buildDeckView / renderShowHtml', () => {
  const deck: DemoDeck = {
    sourcePath: 'demos/t.xlsx',
    baseDir: 'C:/repo/demos',
    title: 'ces-overview',
    slides: [
      MULTI_ROW,
      {
        slideNumber: 6,
        rows: [{ sheetRow: 10, slideNumber: 6, feature: 'AO', talkTrack: 'live now' }],
        op: { mode: 'live', opId: 'ao-registry', tools: ['ao'], durationSec: 90, images: [] },
      },
    ],
    assets: [],
    warnings: [],
  };

  it('carries pre-rendered html, talk track and op metadata per slide', () => {
    const view = buildDeckView(deck, { defaultDwellSec: 15 });
    expect(view.title).toBe('ces-overview');
    expect(view.defaultDwellSec).toBe(15);
    expect(view.slides).toHaveLength(2);
    expect(view.slides[0]).toMatchObject({ index: 0, number: 5, title: 'Stamper', mode: 'staged', durationSec: 40 });
    expect(view.slides[0].talkTrack).toEqual(['Stamper takes that plan and remediates.']);
    // Slide 1 of a deck is its title slide (mockup F5), so the hero path runs.
    expect(view.slides[0].html).toContain('<h1 class="hero" data-i="0">Stamper</h1>');
    expect(view.slides[1]).toMatchObject({ number: 6, mode: 'live', opId: 'ao-registry' });
    expect(view.slides[1].html).toContain('<h1>AO</h1>');
  });

  it('flags only the first slide as the title slide', () => {
    const view = buildDeckView(deck);
    expect(view.slides.map((s) => s.isTitle)).toEqual([true, false]);
  });

  it('the title slide counts the deck, not the slide, and keeps every tool chip', () => {
    const html = buildDeckView(deck).slides[0].html;
    // stacksim is product, not plumbing (founder note 2026-09-05): a deck-wide
    // chip row names every tool the deck declares, unfiltered.
    expect(html).toContain('<span class="big">2</span><span>tools</span>');
    expect(html).toContain('<span>2 slides</span>');
    expect(html).toContain('chip-stamper');
    expect(html).toContain('chip-ao');
    expect(html).toContain('class="title-org">ces-overview<');
  });

  it('escapes founder text on the title path too', () => {
    const html = renderSlideHtml(
      {
        slideNumber: 1,
        rows: [{ sheetRow: 2, slideNumber: 1, feature: '<b>x</b>', func: 'a & b' }],
        op: { mode: 'staged', tools: [], images: [] },
      },
      { isTitle: true, slideCount: 4 },
    );
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).not.toContain('<b>x</b>');
  });

  it('produces one self-contained page with the deck inlined and no external assets', () => {
    const html = renderShowHtml(buildDeckView(deck));
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>ces-overview — CES demo</title>');
    expect(html).toContain('id="deck-data"');
    expect(html).toContain("new EventSource('/events')");
    expect(html).toContain("fetch('/nav'");
    // Self-contained: nothing is loaded off the network. The BHD mark is
    // inlined SVG, and there is no font or image URL anywhere.
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toContain('__DECK__');
    expect(html).not.toMatch(/url\(http/);
  });
});

/**
 * The V4 design port (2026-09-05). These pin the parts of the founder-approved
 * mockup that are RENDERER decisions rather than CSS: which slides earn the
 * telemetry rail, where the gold goes, and what the hold card says.
 */
describe('V4 design port', () => {
  const railSlide: DemoSlide = {
    slideNumber: 7,
    rows: [
      {
        sheetRow: 9,
        slideNumber: 7,
        feature: 'Live command execution',
        func: 'A Tier-1 command is executing against the tenant',
        benefit: 'Every operator action leaves an evidence record',
        differentiator: 'The evidence is collected by the tool',
      },
    ],
    op: { mode: 'live', opId: 'ao-registry', tools: ['ao'], durationSec: 90, images: [] },
  };

  it('no longer emits a telemetry rail for a driven-op slide (STAGE-SIMPLIFY), but still promotes the Now lozenge', () => {
    const html = renderSlideHtml(railSlide, { position: 7, slideCount: 8 });
    // STAGE-SIMPLIFY removed the rail, its grid, its readouts and its stops.
    expect(html).not.toContain('class="rail"');
    expect(html).not.toContain('class="slide-grid"');
    expect(html).not.toContain('data-ro="status"');
    expect(html).not.toContain('data-ro="dwell"');
    expect(html).not.toContain('class="stop"');
    // The driven-op gate survives on the render itself: Function is promoted
    // into the Now lozenge (it is what the predicate still gates).
    expect(html).toContain('class="now"');
    expect(html).toContain('A Tier-1 command is executing against the tenant');
  });

  it('withholds the rail from a staged slide, whose op never runs', () => {
    const staged: DemoSlide = { ...railSlide, op: { ...railSlide.op, mode: 'staged' } };
    const html = renderSlideHtml(staged, { position: 7, slideCount: 8 });
    expect(html).not.toContain('class="rail"');
    expect(html).not.toContain('class="now"');
  });

  it('promotes Function into the Now lozenge on a rail slide instead of repeating it', () => {
    const html = renderSlideHtml(railSlide, { position: 7, slideCount: 8 });
    expect(html).toContain('class="now"');
    expect(html).toContain('A Tier-1 command is executing against the tenant');
    expect(html).not.toContain('<h3>Function</h3>');
    expect(html).toContain('<h3>Benefit</h3>');
  });

  it('keeps the card labels in the DOM but never paints them', () => {
    // Founder feedback 2026-09-05: the audience does not need a FUNCTION /
    // BENEFIT / DIFFERENTIATOR gutter, so the labels are gone from the SLIDE
    // even though the <h3> is still emitted — it stays as the card's accessible
    // name and as the hook every assertion above pins. The card is now a single
    // full-width column: nothing is inset behind a label any more, and nothing
    // coloured took the label's place.
    const html = renderShowHtml(
      buildDeckView({
        sourcePath: 'demos/t.xlsx',
        baseDir: 'C:/repo/demos',
        title: 't',
        slides: [MULTI_ROW, railSlide],
        assets: [],
        warnings: [],
      }),
    );
    expect(html).toContain('.card > h3{position:absolute;');
    expect(html).toContain('clip-path:inset(50%);');
    expect(html).not.toContain('.card{display:grid');
    // The CARD's two-column label gutter is gone. Scoped to `.card` rules: the
    // presenter band is a legitimate grid, and `.p-watch` sits in its content
    // column — an unscoped `grid-column:2` search would catch that too.
    const cardRules = html.match(/^\.card[^\n]*$/gm) ?? [];
    expect(cardRules.length).toBeGreaterThan(0);
    expect(cardRules.join('\n')).not.toContain('grid-column:2');
    // The talk-track band's "Talk track" label was removed entirely (founder
    // 2026-09-07) — the band shows the talk copy with no label.
    expect(html).not.toContain('class="p-label"');
  });

  it('spends the eyebrow gold only where the chrome has not already spent it', () => {
    // A rail slide's gold goes to #op running / #mode warm, so its rule is neutral.
    expect(renderSlideHtml(railSlide)).toContain('<span class="rule"></span>');
    expect(renderSlideHtml(railSlide)).not.toContain('rule gold');
    expect(renderSlideHtml(MULTI_ROW)).toContain('rule gold');
  });

  it('the hold card promotes the differentiator, falling back down the row', () => {
    const view = buildDeckView({
      sourcePath: 'demos/t.xlsx',
      baseDir: 'C:/repo/demos',
      title: 't',
      slides: [MULTI_ROW, railSlide],
      assets: [],
      warnings: [],
    });
    const hold = view.slides[1].holdHtml;
    expect(hold).toContain('class="hold-line">The evidence is collected by the tool</p>');
    expect(hold).toContain('Hold · live operation in progress');
    expect(hold).toContain('Live command execution · ao-registry · slide 02 of 02');
    // Only a slide that can hold gets a hold card.
    expect(view.slides[0].holdHtml).toBe('');
  });

  it('falls back to benefit, then function, then the title, and escapes all of it', () => {
    const base = { ...railSlide.op };
    const of = (row: Partial<DemoSlide['rows'][number]>): string =>
      renderHoldHtml({ slideNumber: 3, rows: [{ sheetRow: 4, slideNumber: 3, ...row }], op: base });
    expect(of({ feature: 'T', benefit: 'B', func: 'F' })).toContain('class="hold-line">B</p>');
    expect(of({ feature: 'T', func: 'F' })).toContain('class="hold-line">F</p>');
    expect(of({ feature: 'T' })).toContain('class="hold-line">T</p>');
    expect(of({ feature: 'T', differentiator: '<i>d</i>' })).toContain('&lt;i&gt;d&lt;/i&gt;');
  });

  it('STAGE-SIMPLIFY removed the on-stage kbd advisory chips, but the key bindings still work', () => {
    const html = renderShowHtml(
      buildDeckView({
        sourcePath: 'demos/t.xlsx',
        baseDir: 'C:/repo/demos',
        title: 't',
        slides: [MULTI_ROW, railSlide],
        assets: [],
        warnings: [],
      }),
    );
    // The footer kbd-chip advisories (and the `?`-hints toggle) are gone.
    expect(html).not.toContain('hint-txt');
    expect(html).not.toContain('<kbd>');
    expect(html).not.toContain("hints.classList");
    // ...but the keydown handler that posts the keys is untouched.
    expect(html).toContain("document.addEventListener('keydown'");
    expect(html).toContain('send({ key: e.key.length === 1 ? e.key.toLowerCase() : e.key });');
    // Dots are the only position indicator; #pos survives, hidden and unused.
    expect(html).toContain('<b id="pos" hidden></b>');
    expect(html).not.toContain('<span>slide <b id="pos"></b></span>');
  });

  it('the chrome carries clickable prev/next/exit chips beside the dots', () => {
    const html = renderShowHtml(
      buildDeckView({
        sourcePath: 'demos/t.xlsx',
        baseDir: 'C:/repo/demos',
        title: 't',
        slides: [MULTI_ROW, railSlide],
        assets: [],
        warnings: [],
      }),
    );
    // Position: the chip cluster opens immediately after the dots, no node between.
    expect(html).toContain('<span id="dots"></span><span id="navbtns"');
    for (const nav of ['prev', 'next', 'exit']) {
      expect(html).toContain(`class="navbtn" data-nav="${nav}"`);
    }
    // Additive only: the chips post the keys that already exist, so no binding
    // changes and the footer advisories above stay truthful.
    expect(html).toContain("prev:'ArrowLeft', next:'ArrowRight', exit:'Escape'");
    // Quiet chrome — the chips are in the muted ramp, never the gold budget.
    expect(html).toContain('.navbtn:hover{color:var(--t1);border-color:var(--kbd-line);}');
  });

  it('carries a "Move on" escape that starts hidden and posts the same next key', () => {
    const html = renderShowHtml(
      buildDeckView({
        sourcePath: 'demos/t.xlsx',
        baseDir: 'C:/repo/demos',
        title: 't',
        slides: [MULTI_ROW, railSlide],
        assets: [],
        warnings: [],
      }),
    );
    // Present in the chrome, hidden by default — draw() reveals it only while
    // the current slide is holding on an op (opStatus pending/running, rung >= 1).
    expect(html).toContain('<button type="button" id="moveon" tabindex="-1" hidden>Move on');
    expect(html).toContain('moveonEl.hidden = !(pending && snap.holdRung >= 1)');
    // It rides the SAME next key the chip and ArrowRight already send — no new
    // action, and the running op is left to finish on the queue.
    expect(html).toContain("moveonEl.addEventListener('click', function(e){\n    e.stopPropagation();\n    send({ key: 'ArrowRight' });");
  });
});

/**
 * GP-DEMO-5 T1.5 S2 — the in-slide app mirror (the render half).
 *
 * `--check` cannot cover the split: it forces `mode:'staged'` and the gate
 * excludes staged, so the split path is never exercised there. These direct
 * `renderSlideHtml` tests are what pin (a) the split appears for a driven
 * theatrical/readout slide with the mirror active, and (b) every other slide is
 * byte-identical to today.
 */
describe('in-slide app mirror (T1.5) render gate', () => {
  const theatrical: DemoSlide = {
    slideNumber: 9,
    rows: [
      {
        sheetRow: 11,
        slideNumber: 9,
        feature: 'Operations',
        func: 'A Tier-1 command executes against the tenant',
        benefit: 'Every action leaves an evidence record',
      },
    ],
    op: { mode: 'live', opId: 'ao-registry', tools: ['ao'], durationSec: 60, images: [], mirror: 'theatrical' },
  };
  const readout: DemoSlide = {
    ...theatrical,
    op: { ...theatrical.op, opId: 'muster-readiness', mirror: 'readout' },
  };

  it('renders the 50/50 pane split + <img src="/mirror"> for a driven theatrical slide when the mirror is active', () => {
    const html = renderSlideHtml(theatrical, { position: 9, slideCount: 12, mirrorActive: true });
    // STAGE-SIMPLIFY: the mirror is the full-height pane, not a lower-right inset.
    expect(html).toContain('class="shalf"');
    expect(html).toContain('class="pane"');
    expect(html).toContain('<img class="mirror-img" src="/mirror" alt="live app">');
    // The cards still render beside the mirror, in the content column.
    expect(html).toContain('A Tier-1 command executes against the tenant');
  });

  it('renders the split for a readout op too (theatrical and readout are identical here)', () => {
    const html = renderSlideHtml(readout, { position: 9, slideCount: 12, mirrorActive: true });
    expect(html).toContain('class="shalf"');
    expect(html).toContain('class="pane"');
    expect(html).toContain('src="/mirror"');
  });

  /* GP-DEMO-5 streamgui — the src gate. `/mirror/backstage` ONLY for a
   * theatrical+backstage slide (a Config op streaming its GUI); everything else,
   * including a backstage READOUT slide, keeps `/mirror`. This is what keeps A1
   * inert until the catalog flips a Config op's `mirror` to theatrical. */
  const theatricalBackstage: DemoSlide = {
    ...theatrical,
    op: { ...theatrical.op, opId: 'stamper-translate', mirror: 'theatrical', mirrorSource: 'backstage' },
  };
  const readoutBackstage: DemoSlide = {
    ...theatrical,
    op: { ...theatrical.op, opId: 'stamper-translate', mirror: 'readout', mirrorSource: 'backstage' },
  };

  it('routes a theatrical+backstage slide to /mirror/backstage', () => {
    const html = renderSlideHtml(theatricalBackstage, { position: 9, slideCount: 12, mirrorActive: true });
    expect(html).toContain('class="shalf"');
    expect(html).toContain('class="pane"');
    expect(html).toContain('<img class="mirror-img" src="/mirror/backstage" alt="live app">');
    expect(html).not.toContain('src="/mirror"'); // the backstage src, never the pane src
  });

  it('a backstage READOUT slide still streams /mirror (the theatrical gate keeps A1 inert)', () => {
    const html = renderSlideHtml(readoutBackstage, { position: 9, slideCount: 12, mirrorActive: true });
    expect(html).toContain('class="shalf"');
    expect(html).toContain('class="pane"');
    expect(html).toContain('<img class="mirror-img" src="/mirror" alt="live app">');
    expect(html).not.toContain('/mirror/backstage');
  });

  it('a theatrical+pane slide is byte-identical to a mirrorSource-less theatrical slide', () => {
    const paneStamped: DemoSlide = { ...theatrical, op: { ...theatrical.op, mirrorSource: 'pane' } };
    const opts = { position: 9, slideCount: 12, mirrorActive: true } as const;
    expect(renderSlideHtml(paneStamped, opts)).toBe(renderSlideHtml(theatrical, opts));
    expect(renderSlideHtml(paneStamped, opts)).toContain('src="/mirror"');
  });

  it('is byte-identical to today when the mirror is NOT active', () => {
    const withFlag = renderSlideHtml(theatrical, { position: 9, slideCount: 12 });
    const noMirrorField = renderSlideHtml(
      { ...theatrical, op: { ...theatrical.op, mirror: undefined } },
      { position: 9, slideCount: 12 },
    );
    // No mirrorActive => no split, and the same bytes as a slide with no mirror
    // field at all — the split path is invisible unless the run turns it on.
    expect(withFlag).not.toContain('class="shalf"');
    expect(withFlag).not.toContain('src="/mirror"');
    expect(withFlag).toBe(noMirrorField);
  });

  it('is byte-identical for a none/absent/staged slide even with the mirror active', () => {
    const none = { ...theatrical, op: { ...theatrical.op, mirror: 'none' as const } };
    const absent = { ...theatrical, op: { ...theatrical.op, mirror: undefined } };
    const staged = { ...theatrical, op: { ...theatrical.op, mode: 'staged' as const } };
    const base = renderSlideHtml(absent, { position: 9, slideCount: 12 });
    // Active mirror, but none of these qualify — so all match the no-mirror render.
    expect(renderSlideHtml(none, { position: 9, slideCount: 12, mirrorActive: true })).toBe(base);
    expect(renderSlideHtml(absent, { position: 9, slideCount: 12, mirrorActive: true })).toBe(base);
    expect(renderSlideHtml(staged, { position: 9, slideCount: 12, mirrorActive: true })).not.toContain('class="shalf"');
  });

  it('an html body WINS over the mirror (the author chose a full graphic)', () => {
    const htmlAsset = { id: 'g.html', rawValue: 'g.html', absPath: 'C:/repo/demos/g.html' };
    const both: DemoSlide = { ...theatrical, op: { ...theatrical.op, html: htmlAsset } };
    const html = renderSlideHtml(both, { position: 9, slideCount: 12, mirrorActive: true });
    expect(html).toContain('class="slide-html"');
    expect(html).not.toContain('class="shalf"');
    expect(html).not.toContain('src="/mirror"');
  });

  it('buildDeckView blanks holdHtml for a mirrored slide so draw() never swaps the <img> out', () => {
    const deck: DemoDeck = {
      sourcePath: 'demos/t.xlsx',
      baseDir: 'C:/repo/demos',
      title: 't',
      slides: [MULTI_ROW, theatrical],
      assets: [],
      warnings: [],
    };
    const active = buildDeckView(deck, { mirrorActive: true }).slides[1];
    const inactive = buildDeckView(deck, { mirrorActive: false }).slides[1];
    expect(active.holdHtml).toBe(''); // the mirror IS the hold surface
    expect(inactive.holdHtml).not.toBe(''); // without the mirror, the hold card returns
  });
});

/**
 * GP-DEMO-6 — the prose dedup safeguard (founder 2026-09-07: "you are repeating
 * prose on the slides"). Within one slide, the same normalized string must not
 * appear twice across the rendered text regions (title, Now lozenge, cards,
 * bullets). It is EXACT/normalized — a line that merely CONTAINS another is a
 * distinct line and is deliberately preserved. Render-level, so any deck is
 * protected without an authoring change.
 */
describe('prose dedup safeguard (GP-DEMO-6)', () => {
  const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

  it('renders a string authored in two columns (benefit == differentiator) only once', () => {
    const html = renderSlideHtml({
      slideNumber: 4,
      rows: [
        {
          sheetRow: 2,
          slideNumber: 4,
          feature: 'Dup slide',
          benefit: 'Evidence the assessor accepts',
          differentiator: 'Evidence the assessor accepts',
        },
      ],
      op: { mode: 'staged', tools: [], images: [] },
    });
    expect(countOf(html, 'Evidence the assessor accepts')).toBe(1);
    // The Benefit card keeps it (first, higher region); the Differentiator card drops
    // it entirely — with nothing else to show, that card does not render.
    expect(html).toContain('<section class="card benefit"><h3>Benefit</h3><p>Evidence the assessor accepts</p>');
    expect(html).not.toContain('class="card diff"');
  });

  it('drops a card line that exactly restates the promoted Now function', () => {
    const html = renderSlideHtml(
      {
        slideNumber: 5,
        rows: [
          {
            sheetRow: 2,
            slideNumber: 5,
            feature: 'Live',
            func: 'Walks the determinations',
            benefit: 'Walks the determinations',
          },
        ],
        op: { mode: 'live', opId: 'eo-review', tools: ['eo'], images: [] },
      },
      { position: 5, slideCount: 8 },
    );
    // Promoted into the Now lozenge once; the identical Benefit line is dropped.
    expect(html).toContain('<span class="lbl">Now</span><span>Walks the determinations</span>');
    expect(countOf(html, 'Walks the determinations')).toBe(1);
  });

  it('collapses the same value repeated across two rows of one column', () => {
    const html = renderSlideHtml({
      slideNumber: 6,
      rows: [
        { sheetRow: 2, slideNumber: 6, feature: 'Repeat', benefit: 'One honest number' },
        { sheetRow: 3, slideNumber: 6, benefit: 'One honest number' },
      ],
      op: { mode: 'staged', tools: [], images: [] },
    });
    expect(countOf(html, 'One honest number')).toBe(1);
    expect(html.match(/<p>One honest number<\/p>/g)).toHaveLength(1);
  });

  it('matches duplicates case- and whitespace-insensitively', () => {
    const html = renderSlideHtml({
      slideNumber: 7,
      rows: [
        {
          sheetRow: 2,
          slideNumber: 7,
          feature: 'Norm',
          benefit: 'Read only, changes nothing',
          differentiator: '  read ONLY,   changes  nothing ',
        },
      ],
      op: { mode: 'staged', tools: [], images: [] },
    });
    // The benefit form is kept verbatim; the differently-cased/spaced differentiator drops.
    expect(countOf(html, 'changes nothing')).toBe(1);
    expect(html).not.toContain('read ONLY');
  });

  it('does NOT drop a distinct longer line that merely CONTAINS a shorter one', () => {
    // The founder's live decks restate a card phrase as a quiet bullet — a distinct
    // (longer) sentence and a shorter fragment. Only EXACT normalized matches dedup,
    // so both survive by design.
    const html = renderSlideHtml({
      slideNumber: 8,
      rows: [
        {
          sheetRow: 2,
          slideNumber: 8,
          feature: 'Contain',
          func: 'Compliance maintained by how you operate — the record builds itself',
          features: ['Compliance maintained by how you operate'],
        },
      ],
      op: { mode: 'staged', tools: [], images: [] },
    });
    expect(html).toContain('<p>Compliance maintained by how you operate — the record builds itself</p>');
    expect(html).toContain('<li>Compliance maintained by how you operate</li>');
  });
});
