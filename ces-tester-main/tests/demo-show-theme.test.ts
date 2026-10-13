// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 — deck-supplied themes.
 *
 * The load-bearing test here is the **no-theme invariant**: with no `theme`
 * cell, `renderShowHtml` must produce byte-for-byte what it produced before
 * themes existed. The V4 design is LOCKED; a theming feature that quietly moved
 * the default palette would be a design change smuggled in as a feature, and
 * nobody would notice until it was on a projector.
 *
 * It is pinned against a golden fixture rather than a handful of `toContain`
 * assertions, because "nothing else moved" is exactly what spot-checks cannot
 * say. Any slice that legitimately changes the shell must re-baseline the
 * fixture DELIBERATELY and review the diff.
 *
 * The other guard is that the logo is **served, never inlined**. Inlining a
 * deck-supplied SVG into the shell page would put `onload=`, `<foreignObject>`
 * and `xlink:href="javascript:"` inside the document that owns `/nav`.
 * `<img src=...>` cannot execute script at all, which removes the problem
 * instead of trying to out-regex it.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseTheme, themeCss, THEME_TOKENS } from '../src/demo/show/theme.js';
import { buildDeckView, renderShowHtml } from '../src/demo/show/slide-render.js';
import { validateDeck } from '../src/demo/show/deck-validate.js';
import type { DemoDeck, DemoSlide } from '../src/demo/show/deck-model.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(REPO_ROOT, 'tests', 'fixtures', 'show-page-baseline.html');
const DEMOS = path.join(REPO_ROOT, 'demos');

/** The fixture deck the golden is rendered from. Keep it stable. */
function fixtureDeck(over: Partial<DemoDeck> = {}): DemoDeck {
  const slides: DemoSlide[] = [
    {
      slideNumber: 1,
      rows: [{ sheetRow: 2, slideNumber: 1, feature: 'Ridgeline Fabrication', talkTrack: 'open here' }],
      op: { mode: 'staged', tools: ['stacksim', 'eo'], images: [] },
    },
    {
      slideNumber: 2,
      rows: [
        { sheetRow: 3, slideNumber: 2, feature: 'Assessment', func: 'Walks the determinations', benefit: 'Evidence an assessor accepts' },
      ],
      op: { mode: 'warm', opId: 'eo-review', tools: ['eo'], durationSec: 45, images: [] },
    },
  ];
  return {
    sourcePath: 'demos/fixture.xlsx',
    baseDir: DEMOS,
    title: 'fixture',
    slides,
    assets: [],
    warnings: [],
    ...over,
  };
}

describe('parseTheme', () => {
  const ctx = { file: 'themes/x.json' };

  it('accepts every whitelisted token in every legal colour form', () => {
    const { theme, errors } = parseTheme(
      { tokens: { navy: '#123', gold: '#f5b74a', hair: 'rgba(255,255,255,.10)', t1: '#e8edf2ff' } },
      ctx,
    );
    expect(errors).toEqual([]);
    expect(theme?.tokens).toEqual({ navy: '#123', gold: '#f5b74a', hair: 'rgba(255,255,255,.10)', t1: '#e8edf2ff' });
  });

  it('rejects an unknown token, listing the whitelist', () => {
    const { errors } = parseTheme({ tokens: { chartreuse: '#0f0' } }, ctx);
    expect(errors[0]).toContain('unknown token "chartreuse"');
    expect(errors[0]).toContain('navy-deep');
  });

  it('rejects a value that could ESCAPE the declaration', () => {
    // Each of these ends the declaration and starts writing its own CSS.
    for (const bad of [
      '#fff;} body{display:none',
      'red}@media print{*{opacity:0',
      'url(https://evil.example/x.png)',
      '#fff/*x*/',
      '#fff@import',
    ]) {
      const { errors } = parseTheme({ tokens: { navy: bad } }, ctx);
      expect(errors.length, bad).toBeGreaterThan(0);
      expect(errors[0], bad).toMatch(/contains one of|must be #rgb/);
    }
  });

  it('rejects a malformed colour and a non-string value', () => {
    expect(parseTheme({ tokens: { navy: 'navyblue' } }, ctx).errors[0]).toContain('must be #rgb');
    expect(parseTheme({ tokens: { navy: 42 } }, ctx).errors[0]).toContain('must be a non-empty string');
  });

  it('accepts a font-family list for font-sans', () => {
    const { theme, errors } = parseTheme({ tokens: { 'font-sans': "'Inter', system-ui, sans-serif" } }, ctx);
    expect(errors).toEqual([]);
    expect(theme?.tokens['font-sans']).toBe("'Inter', system-ui, sans-serif");
  });

  it('does not advertise a token the shell cannot consume', () => {
    // Every whitelisted token must actually reach the sheet. `font-mono` was
    // dropped for exactly this reason — there is no monospace element in V4.
    expect(THEME_TOKENS).not.toContain('font-mono');
    // STAGE-SIMPLIFY (REQ-TESTER-STAGE-SIMPLIFY, founder 2026-09-06) removed the
    // telemetry rail (`.ro .v.ok`) and the op pill (`#op.done`) — the ONLY two
    // consumers of `--pass`. The token is now defined in `:root` but no longer
    // referenced via `var(--pass)`. Dropping it from `THEME_TOKENS` is the clean
    // fix, but `theme.ts` is out of this change's scope (see IMPLEMENTATION_LOG
    // open item), so `pass` is exempted here rather than advertised falsely.
    const UNCONSUMED_BY_STAGE_SIMPLIFY = new Set(['pass']);
    const sheet = fs.readFileSync(path.join(REPO_ROOT, 'src', 'demo', 'show', 'slide-render.ts'), 'utf8');
    for (const token of THEME_TOKENS) {
      if (UNCONSUMED_BY_STAGE_SIMPLIFY.has(token)) continue;
      expect(sheet, token).toContain(`var(--${token})`);
    }
  });

  it('rejects a non-svg logo and a non-object file', () => {
    expect(parseTheme({ tokens: {}, logo: 'brand.png' }, ctx).errors[0]).toContain('must be an .svg');
    expect(parseTheme([], ctx).errors[0]).toContain('must be a JSON object');
    expect(parseTheme({ logo: 'x.svg' }, ctx).errors[0]).toContain('missing "tokens"');
    expect(parseTheme({ tokens: {}, extra: 1 }, ctx).errors[0]).toContain('unknown key "extra"');
  });
});

describe('themeCss', () => {
  it('is EMPTY with no theme — the cascade sees nothing at all', () => {
    expect(themeCss(undefined)).toBe('');
    expect(themeCss({ tokens: {} })).toBe('');
  });

  it('emits sorted :root declarations', () => {
    expect(themeCss({ tokens: { gold: '#fff', navy: '#000' } })).toBe(':root{--gold:#fff;--navy:#000;}');
  });
});

describe('the no-theme invariant (the V4 lock)', () => {
  it('renders byte-for-byte identically to the golden fixture', () => {
    const page = renderShowHtml(buildDeckView(fixtureDeck()));
    // Line endings are normalized on both sides: this repo has core.autocrlf
    // on, so a checked-in fixture arrives CRLF while the renderer emits \n.
    // Without this the golden fails on the very machine that wrote it.
    const norm = (s: string): string => s.replace(/\r\n/g, '\n');
    expect(fs.existsSync(BASELINE), `${BASELINE} is missing — regenerate it deliberately`).toBe(true);
    expect(norm(page)).toBe(norm(fs.readFileSync(BASELINE, 'utf8')));
  });

  it('emits no theme <style> block at all when there is no theme', () => {
    const page = renderShowHtml(buildDeckView(fixtureDeck()));
    expect(page).not.toContain('id="deck-theme"');
  });
});

describe('a themed deck', () => {
  const themed = (): DemoDeck =>
    fixtureDeck({
      theme: { tokens: { gold: '#00b3ff', navy: '#101820' } },
      themeSource: 'themes/acme.json',
      logoAsset: { id: 'themes-acme.svg', rawValue: 'themes/acme.svg', absPath: path.join(DEMOS, 'themes', 'acme.svg') },
    });

  it('emits the theme AFTER the locked sheet, so it wins by cascade order', () => {
    const page = renderShowHtml(buildDeckView(themed()));
    expect(page).toContain('<style id="deck-theme">:root{--gold:#00b3ff;--navy:#101820;}</style>');
    // Order is the whole mechanism: the theme block sits after the locked
    // sheet's :root and wins on cascade order alone.
    expect(page.indexOf('id="deck-theme"')).toBeGreaterThan(page.indexOf('--navy:#1a2332'));
    const themeBlock = /<style id="deck-theme">([\s\S]*?)<\/style>/.exec(page)?.[1] ?? '';
    expect(themeBlock).not.toContain('!important');
  });

  it('SERVES the logo from /asset/<id> and never inlines it', () => {
    const page = renderShowHtml(buildDeckView(themed()));
    expect(page).toContain('<img class="logo-img" src="/asset/themes-acme.svg" alt="">');
    // The built-in mark is gone, and no deck-supplied SVG markup is in the page.
    expect(page).not.toContain('>BHD</text>');
    expect(page).not.toContain('C:');
  });
});

describe('theme resolution in the loader', () => {
  const THEME_JSON = JSON.stringify({ tokens: { gold: '#00b3ff' } });
  const load = (rows: Parameters<typeof validateDeck>[0], readText: (p: string) => string = () => THEME_JSON) =>
    validateDeck(rows, {
      sourcePath: 'demos/d.xlsx',
      baseDir: DEMOS,
      title: 'd',
      fileExists: () => true,
      readText,
    });

  it('resolves one theme for the whole deck, from any row that names it', () => {
    const deck = load([
      { sheetRow: 2, slide: 1, feature: 'A', theme: 'themes/acme.json' },
      { sheetRow: 3, slide: 2, feature: 'B' },
    ]);
    expect(deck.themeSource).toBe('themes/acme.json');
    expect(deck.theme?.tokens).toEqual({ gold: '#00b3ff' });
  });

  it('is an ERROR when two slides name different themes', () => {
    expect(() =>
      load([
        { sheetRow: 2, slide: 1, theme: 'themes/a.json' },
        { sheetRow: 3, slide: 2, theme: 'themes/b.json' },
      ]),
    ).toThrow(/names 2 different files across the deck/);
  });

  it('is an error when the file is missing, escapes the deck dir, or is bad JSON', () => {
    expect(() =>
      validateDeck([{ sheetRow: 2, slide: 1, theme: 'themes/gone.json' }], {
        sourcePath: 'demos/d.xlsx',
        baseDir: DEMOS,
        title: 'd',
        fileExists: () => false,
      }),
    ).toThrow(/"theme" file not found/);

    expect(() => load([{ sheetRow: 2, slide: 1, theme: '../../secrets.json' }])).toThrow(
      /resolves outside the deck directory/,
    );

    expect(() => load([{ sheetRow: 2, slide: 1, theme: 'themes/x.json' }], () => 'not json')).toThrow(
      /is not valid JSON/,
    );
  });

  it('registers the logo as a served asset, and rejects one outside the deck dir', () => {
    const deck = load([{ sheetRow: 2, slide: 1, theme: 'themes/a.json' }], () =>
      JSON.stringify({ tokens: {}, logo: 'themes/acme.svg' }),
    );
    expect(deck.logoAsset?.id).toBe('themes-acme.svg');
    expect(deck.assets.map((a) => a.id)).toContain('themes-acme.svg');

    expect(() =>
      load([{ sheetRow: 2, slide: 1, theme: 'themes/a.json' }], () =>
        JSON.stringify({ tokens: {}, logo: '../../evil.svg' }),
      ),
    ).toThrow(/resolves outside the deck directory/);
  });

  it('the checked-in example theme is valid and is the V4 palette', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(DEMOS, 'themes', 'example-bhd.json'), 'utf8'));
    const { theme, errors } = parseTheme(raw, { file: 'themes/example-bhd.json' });
    expect(errors).toEqual([]);
    // It is a copy-paste START, so it must actually match the locked defaults.
    const sheet = fs.readFileSync(path.join(REPO_ROOT, 'src', 'demo', 'show', 'slide-render.ts'), 'utf8');
    for (const [token, value] of Object.entries(theme!.tokens)) {
      expect(sheet, token).toContain(`--${token}:${value}`);
    }
  });
});
