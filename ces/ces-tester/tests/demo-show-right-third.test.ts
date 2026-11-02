// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * PLAN.md "Wire `right-third`" (slices 1–3) — the per-slide right-pane intent,
 * end to end: the loader parses + resolves the column, the model carries it, and
 * the renderer honours it per the plan's precedence table.
 *
 * Kept in a NEW file (the existing loader suites are out of this change's
 * allowed-file set). Two halves:
 *   - LOADER: `right-third` (+ aliases) reaches the slide op as `rightThird`,
 *     leading kind token parsed out of authored prose, first-non-blank-wins per
 *     slide, unknown → warning + unset, `image` with no asset → warning + absent,
 *     `absent` on a theatrical op → mismatch warning.
 *   - RENDERER: `app` → mirror pane, `image` → static-image pane, `absent` → no
 *     pane; and the compatibility invariant — a column-less slide is byte-identical.
 */

import { describe, it, expect } from 'vitest';
import { loadDeck, type RawCell } from '../src/demo/show/xlsx-loader.js';
import { renderSlideHtml } from '../src/demo/show/slide-render.js';
import type { DemoSlide } from '../src/demo/show/deck-model.js';

/** Load a deck straight from an in-memory grid, with the fs seams stubbed. */
async function load(grid: RawCell[][], opts: { fileExists?: (p: string) => boolean } = {}) {
  return loadDeck('demos/t.xlsx', {
    readGrid: async () => grid,
    fileExists: opts.fileExists ?? (() => true),
  });
}

describe('right-third — loader resolution', () => {
  it('parses the leading kind token out of authored prose, per slide, and carries it as rightThird', async () => {
    const deck = await load([
      ['slide #', 'feature', 'op mode', 'op', 'right-third'],
      [1, 'Title', null, null, 'absent — title slide, hero render'],
      [2, 'Ops', 'live', 'ao-registry', 'app — ao-registry driven live'],
    ]);
    expect(deck.slides[0].op.rightThird).toBe('absent');
    expect(deck.slides[1].op.rightThird).toBe('app');
    // The column is recognised — never warned as unknown.
    expect(deck.warnings.join('\n')).not.toContain('unknown column');
  });

  it('accepts the `rightpane` / `right-pane` header alias', async () => {
    const deck = await load([
      ['slide #', 'feature', 'right-pane'],
      [1, 'Title', 'image'],
    ]);
    // No image asset on this slide, so `image` downgrades to `absent` (below);
    // what matters here is that the alias resolved at all (no unknown-column warn).
    expect(deck.warnings.join('\n')).not.toContain('unknown column');
    expect(deck.slides[0].op.rightThird).toBe('absent');
  });

  it('takes the FIRST non-blank cell for a slide (first-non-blank-wins, like the op fields)', async () => {
    const deck = await load([
      ['slide #', 'feature', 'benefit', 'right-third'],
      [2, 'A', 'b1', null],
      [2, null, 'b2', 'image — the diagram'],
      [2, null, 'b3', 'app — should NOT win, a later row'],
    ]);
    // No image asset, so image → absent, but it is the IMAGE row that won, not app.
    expect(deck.slides[0].op.rightThird).toBe('absent');
    expect(deck.warnings.join('\n')).toContain('no image asset');
  });

  it('warns (never errors) and leaves rightThird unset on an unknown leading token', async () => {
    const deck = await load([
      ['slide #', 'feature', 'right-third'],
      [1, 'A', 'sideways — not a kind'],
    ]);
    expect(deck.slides[0].op.rightThird).toBeUndefined();
    expect(deck.warnings.join('\n')).toMatch(/does not begin with app\|image\|absent/);
  });

  it('downgrades `image` with no image asset to `absent`, with a warning', async () => {
    const deck = await load([
      ['slide #', 'feature', 'right-third'],
      [1, 'A', 'image — a diagram that was never authored'],
    ]);
    expect(deck.slides[0].op.rightThird).toBe('absent');
    expect(deck.warnings.join('\n')).toContain('no image asset');
  });

  it('keeps `image` when the slide has an image asset', async () => {
    const deck = await load([
      ['slide #', 'feature', 'image', 'right-third'],
      [1, 'A', 'art/one.png', 'image — the authored diagram'],
    ]);
    expect(deck.slides[0].op.rightThird).toBe('image');
    expect(deck.slides[0].op.images).toHaveLength(1);
  });

  it('surfaces a column-vs-catalog mismatch when `absent` sits on a theatrical op', async () => {
    const deck = await load([
      ['slide #', 'feature', 'op mode', 'op', 'right-third'],
      [1, 'Ops', 'live', 'ao-registry', 'absent — deliberately hidden here'],
    ]);
    expect(deck.slides[0].op.rightThird).toBe('absent');
    expect(deck.warnings.join('\n')).toMatch(/is "absent" but op .* is theatrical\/readout/);
  });

  it('leaves rightThird unset (and adds no warnings) for a deck with no right-third column', async () => {
    const deck = await load([
      ['slide #', 'feature', 'op mode', 'op'],
      [1, 'Title', null, null],
      [2, 'Ops', 'live', 'ao-registry'],
    ]);
    expect(deck.slides.every((s) => s.op.rightThird === undefined)).toBe(true);
    expect(deck.warnings.join('\n')).not.toContain('right-third');
  });
});

describe('right-third — renderer precedence', () => {
  const base = (over: Partial<DemoSlide['op']>): DemoSlide => ({
    slideNumber: 2,
    rows: [
      {
        sheetRow: 2,
        slideNumber: 2,
        feature: 'Operations',
        func: 'A command executes against the tenant',
        benefit: 'Every action leaves an evidence record',
      },
    ],
    op: { mode: 'live', opId: 'ao-registry', tools: ['ao'], images: [], mirror: 'theatrical', ...over },
  });
  const OPTS = { position: 2, slideCount: 4, mirrorActive: true } as const;

  it('`app` streams the mirror into the pane when the run has the mirror active', () => {
    const html = renderSlideHtml(base({ rightThird: 'app' }), OPTS);
    expect(html).toContain('class="shalf"');
    expect(html).toContain('class="pane"');
    expect(html).toContain('<img class="mirror-img" src="/mirror" alt="live app">');
    expect(html).toContain('A command executes against the tenant'); // promoted to Now
    // GP-DEMO-6 (founder 2026-09-07) removed the "APP NOW LIVE" placard entirely; the
    // live cue is now a gold glow toggled onto the `.mirror-img` frame by draw(), so no
    // `.onair` element exists anywhere in the render or the page.
    expect(html).not.toContain('class="onair"');
  });

  it('`app` renders NO pane (no invented fallback) when the mirror is inactive', () => {
    const html = renderSlideHtml(base({ rightThird: 'app' }), { position: 2, slideCount: 4 });
    expect(html).not.toContain('class="shalf"');
    expect(html).not.toContain('src="/mirror"');
    expect(html).toContain('class="body"');
  });

  it('`app` forces the mirror pane even on a static (non-live, mirror:none) op — the static seed', () => {
    const staticApp = base({ mode: 'staged', opId: undefined, mirror: 'none', rightThird: 'app' });
    const html = renderSlideHtml(staticApp, OPTS);
    // slideMirrors would be FALSE here (staged, mirror none); `app` overrides it.
    expect(html).toContain('class="pane"');
    expect(html).toContain('<img class="mirror-img" src="/mirror" alt="live app">');
  });

  it('a theatrical+backstage `app` slide streams /mirror/backstage', () => {
    const html = renderSlideHtml(
      base({ opId: 'stamper-translate', mirror: 'theatrical', mirrorSource: 'backstage', rightThird: 'app' }),
      OPTS,
    );
    expect(html).toContain('src="/mirror/backstage"');
  });

  it('`image` fills the pane with the slide’s static image (direct <img>, not the mirror)', () => {
    const withImg = base({
      mode: 'staged',
      opId: undefined,
      mirror: 'none',
      images: [{ id: 'art-one.png', rawValue: 'art/one.png', absPath: 'C:/repo/demos/art/one.png' }],
      rightThird: 'image',
    });
    const html = renderSlideHtml(withImg, OPTS);
    expect(html).toContain('class="shalf"');
    expect(html).toContain('class="pane"');
    expect(html).toContain('<img class="slide-image" src="/asset/art-one.png"');
    expect(html).not.toContain('src="/mirror"');
    expect(html).not.toContain('C:/repo');
    // No `.onair` placard anywhere post GP-DEMO-6 (the live cue is a frame glow).
    expect(html).not.toContain('class="onair"');
  });

  it('`absent` renders no pane, full-width content — even when the op is theatrical', () => {
    const html = renderSlideHtml(base({ rightThird: 'absent' }), OPTS);
    expect(html).not.toContain('class="shalf"');
    expect(html).not.toContain('src="/mirror"');
    expect(html).toContain('class="body"');
    // The Now lozenge (a driven-op promotion) still renders — absent is only the pane.
    expect(html).toContain('class="now"');
  });

  it('`absent` suppresses only the PANE, not an image-only body takeover (the "full-bleed branded body" slides)', () => {
    // pain-story's branded slides are `absent` + an image with no cards: the image
    // IS the body. `absent` must not blank them into an empty navy body.
    const brandedBody: DemoSlide = {
      slideNumber: 3,
      rows: [{ sheetRow: 4, slideNumber: 3, feature: 'A branded graphic' }],
      op: {
        mode: 'staged',
        tools: [],
        images: [{ id: 'ces-pain-story-03.png', rawValue: 'slides/ces-pain-story-03.png', absPath: '/x/y.png' }],
        rightThird: 'absent',
      },
    };
    const html = renderSlideHtml(brandedBody, { position: 3, slideCount: 12 });
    expect(html).toContain('class="body body-image-only"');
    expect(html).toContain('<img class="slide-image" src="/asset/ces-pain-story-03.png"');
    expect(html).not.toContain('class="shalf"'); // still no right pane
  });
});

describe('right-third — the compatibility invariant', () => {
  const theatrical: DemoSlide = {
    slideNumber: 2,
    rows: [{ sheetRow: 2, slideNumber: 2, feature: 'Operations', func: 'A command executes', benefit: 'Evidence' }],
    op: { mode: 'live', opId: 'ao-registry', tools: ['ao'], images: [], mirror: 'theatrical' },
  };
  const OPTS = { position: 2, slideCount: 4, mirrorActive: true } as const;

  it('an `app` slide is byte-identical to the same slide under the OLD gating (app aligns with the mirror default)', () => {
    const columnLess = renderSlideHtml(theatrical, OPTS);
    const withApp = renderSlideHtml({ ...theatrical, op: { ...theatrical.op, rightThird: 'app' } }, OPTS);
    expect(withApp).toBe(columnLess);
  });

  it('leaving rightThird unset changes nothing versus a plain cards slide', () => {
    const cardsSlide: DemoSlide = {
      slideNumber: 3,
      rows: [{ sheetRow: 4, slideNumber: 3, feature: 'A', benefit: 'B' }],
      op: { mode: 'staged', tools: [], images: [] },
    };
    const before = renderSlideHtml(cardsSlide, { position: 3, slideCount: 4 });
    const withUnset = renderSlideHtml(
      { ...cardsSlide, op: { ...cardsSlide.op, rightThird: undefined } },
      { position: 3, slideCount: 4 },
    );
    expect(withUnset).toBe(before);
    expect(before).not.toContain('class="shalf"');
  });
});
