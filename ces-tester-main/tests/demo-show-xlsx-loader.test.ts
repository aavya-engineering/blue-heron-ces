// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S1 gate — the round trip.
 *
 * `scripts/make-demo-xlsx.mjs` writes a real .xlsx; `xlsx-loader.ts` reads it
 * back with the same `read-excel-file` call the live command uses; the grouped
 * model is asserted. That closed loop is what proves both halves at once — a
 * generator nobody reads back is an unverified guess, and a loader tested only
 * against hand-built grids never proves it can open a real workbook.
 *
 * Grouping (A2) and the error contract (A3) are asserted here too, the latter
 * against hand-built grids so no fixture file has to be malformed on disk.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  loadDeck,
  normalizeSheet,
  normalizeHeader,
  canonicalColumn,
  normalizeCell,
  type RawCell,
} from '../src/demo/show/xlsx-loader.js';
import { validateDeck } from '../src/demo/show/deck-validate.js';
import { DeckLoadFailure, deckRowCount, formatDeckErrors } from '../src/demo/show/deck-model.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const STARTER_DECK = path.join(REPO_ROOT, 'demos', 'ces-overview.xlsx');
const PAIN_STORY_DECK = path.join(REPO_ROOT, 'demos', 'ces-pain-story.xlsx');
const MAKE_DECKS = path.join(REPO_ROOT, 'scripts', 'make-demo-xlsx.mjs');

/** Header + rows -> a grid, the shape `read-excel-file` hands back. */
const HEADER: RawCell[] = [
  'slide #',
  'talk track',
  'feature',
  'function',
  'benefit',
  'differentiator',
  'tools',
  'op mode',
  'op',
  'duration (sec)',
  'image',
  'features',
];

function grid(...rows: RawCell[][]): RawCell[][] {
  return [HEADER, ...rows];
}

/** Load from an in-memory grid — no file, no image existence checks. */
async function loadGrid(rows: RawCell[][], sourcePath = 'demos/test.xlsx') {
  return loadDeck(sourcePath, {
    readGrid: async () => rows,
    fileExists: () => true,
  });
}

async function loadErrors(rows: RawCell[][], sourcePath = 'demos/test.xlsx'): Promise<string[]> {
  try {
    await loadGrid(rows, sourcePath);
  } catch (err) {
    expect(err).toBeInstanceOf(DeckLoadFailure);
    const failure = err as DeckLoadFailure;
    return formatDeckErrors(failure.sourcePath, failure.errors);
  }
  throw new Error('expected the deck to fail loading, but it loaded');
}

describe('header normalization', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeHeader('Duration (sec)')).toBe('durationsec');
    expect(normalizeHeader('  Slide #  ')).toBe('slide');
    expect(normalizeHeader('TALK_TRACK')).toBe('talktrack');
  });

  it('accepts aliases and reports unknown columns as warnings, not errors', () => {
    expect(canonicalColumn('Dwell')).toBe('durationsec');
    expect(canonicalColumn('Narration')).toBe('talktrack');
    expect(canonicalColumn('op id')).toBe('op');
    expect(canonicalColumn('nonsense')).toBeUndefined();

    const result = normalizeSheet([
      ['slide', 'narration', 'my scratch column'],
      [1, 'hello', 'ignored'],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => w.includes('my scratch column'))).toBe(true);
    expect(result.rows[0]).toMatchObject({ sheetRow: 2, slide: 1, talktrack: 'hello' });
  });

  it('collapses every flavour of blank to null', () => {
    expect(normalizeCell(null)).toBeNull();
    expect(normalizeCell(undefined)).toBeNull();
    expect(normalizeCell('   ')).toBeNull();
    expect(normalizeCell('  x ')).toBe('x');
    expect(normalizeCell(30)).toBe(30);
  });
});

describe('round trip: generator -> loader -> grouped model', () => {
  it('the checked-in starter deck exists (regenerate with scripts/make-demo-xlsx.mjs)', () => {
    expect(fs.existsSync(STARTER_DECK)).toBe(true);
  });

  it('reads a real .xlsx back into the expected deck model', async () => {
    const deck = await loadDeck(STARTER_DECK);

    expect(deck.title).toBe('ces-overview');
    expect(deck.baseDir).toBe(path.join(REPO_ROOT, 'demos'));
    expect(deck.slides.map((s) => s.slideNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(deckRowCount(deck)).toBe(11);

    // A2: rows sharing a slide # group onto ONE slide, in sheet order.
    const slide2 = deck.slides.find((s) => s.slideNumber === 2)!;
    expect(slide2.rows).toHaveLength(2);
    expect(slide2.rows.map((r) => r.sheetRow)).toEqual([3, 4]);
    expect(slide2.rows[0].feature).toBe('The evidence gap');
    expect(slide2.rows[0].benefit).toBeUndefined();
    expect(slide2.rows[1].feature).toBeUndefined();
    expect(slide2.rows[1].benefit).toContain('Auditors accept evidence');

    // Blank op cells on the second row inherit the slide's op spec.
    expect(slide2.op.mode).toBe('staged');
    expect(slide2.op.durationSec).toBe(30);

    // A blank duration is absent, not zero — the run default fills it in.
    const slide3 = deck.slides.find((s) => s.slideNumber === 3)!;
    expect(slide3.op.durationSec).toBeUndefined();
    expect(slide3.op.tools).toEqual(['stacksim']);

    // The mix of op modes the fixture is shaped to carry.
    expect(deck.slides.find((s) => s.slideNumber === 6)!.op).toMatchObject({
      mode: 'warm',
      opId: 'ao-registry',
      durationSec: 45,
    });
    const slide7 = deck.slides.find((s) => s.slideNumber === 7)!;
    expect(slide7.rows).toHaveLength(2);
    expect(slide7.op).toMatchObject({ mode: 'live', opId: 'ao-registry', durationSec: 90 });
    expect(slide7.op.tools).toEqual(['ao']);

    // Tools parse as a comma-separated subset, whitespace tolerated.
    expect(deck.slides[0].op.tools).toEqual(['stacksim', 'muster', 'stamper', 'ao', 'eo']);

    // No image cells in the fixture, so no assets to serve.
    expect(deck.assets).toEqual([]);

    // The `features` column survives the round trip as a split array — the cell
    // is authored newline-separated and arrives as one item per line.
    expect(slide3.rows[0].features).toEqual([
      'Simulated M365/GCC-High tenant',
      'CLI seed and serve',
      'HTTP resolve/evidence/ledger endpoints',
      'Mutation-tracking evidence ledger',
      'Sandboxed PowerShell module surface',
    ]);
    // Every tool slide carries a list; slide 7 (live execution) deliberately
    // does not, and neither do the narrative slides.
    for (const n of [3, 4, 5, 6, 8]) {
      const rows = deck.slides.find((s) => s.slideNumber === n)!.rows;
      const listed = rows.flatMap((r) => r.features ?? []);
      expect(listed).toHaveLength(5);
      expect(listed.every((f) => f.trim() === f && f !== '')).toBe(true);
    }
    expect(deck.slides.find((s) => s.slideNumber === 7)!.rows.flatMap((r) => r.features ?? [])).toEqual([]);
    // An ampersand round-trips through the XML writer and the reader intact.
    expect(deck.slides.find((s) => s.slideNumber === 8)!.rows[0].features).toContain(
      'POA&M auto-close lifecycle',
    );
    // Five each is exactly the display cap, so the fixture warns about none.
    expect(deck.warnings.filter((w) => w.includes('features'))).toEqual([]);
  });

  it('carries `right-third` natively: `app` on the driven ao-registry beats (6, 7), `absent` elsewhere', async () => {
    const deck = await loadDeck(STARTER_DECK);
    const rt = new Map(deck.slides.map((s) => [s.slideNumber, s.op.rightThird] as const));
    expect([...rt.entries()].filter(([, v]) => v === 'app').map(([n]) => n)).toEqual([6, 7]);
    for (const [n, v] of rt) {
      expect(v, `slide ${n}`).toBe(n === 6 || n === 7 ? 'app' : 'absent');
    }
    expect(deck.warnings.filter((w) => w.toLowerCase().includes('right-third'))).toEqual([]);
  });

  it('regenerating the fixture to a temp path yields the identical model', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-demo-deck-'));
    try {
      // Run the real script the way the operator does — an import would test a
      // module boundary the CLI never uses.
      const outPath = path.join(tmpDir, 'ces-overview.xlsx');
      execFileSync(process.execPath, [MAKE_DECKS, outPath], {
        stdio: 'ignore',
      });

      const fresh = await loadDeck(outPath);
      const checkedIn = await loadDeck(STARTER_DECK);
      expect(fresh.slides).toEqual(checkedIn.slides);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

/**
 * The second checked-in deck. `ces-overview` proves the loader can read a real
 * workbook; `ces-pain-story` is the deck an operator actually presents, so what
 * is asserted here is the DECK CONTRACT the founder's narrative doctrine
 * imposes (THREAD_HANDOFF.md, 2026-09-05) — not just that it parses. A talk
 * track that goes missing, an op that quietly turns live, or a slide that
 * silently falls back to the 30 s default dwell are all demo-day failures, and
 * all three are invisible to `--check`.
 */
describe('round trip: the pain-story deck', () => {
  it('is checked in and loads as 12 slides across 14 rows', async () => {
    expect(fs.existsSync(PAIN_STORY_DECK)).toBe(true);
    const deck = await loadDeck(PAIN_STORY_DECK);

    expect(deck.title).toBe('ces-pain-story');
    expect(deck.slides.map((s) => s.slideNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(deckRowCount(deck)).toBe(14);
    expect(deck.assets).toEqual([]);
    expect(deck.warnings.filter((w) => w.includes('features'))).toEqual([]);
  });

  it('narrates every slide — the talk track is the deliverable', async () => {
    const deck = await loadDeck(PAIN_STORY_DECK);
    for (const slide of deck.slides) {
      const narration = slide.rows.map((r) => r.talkTrack ?? '').join(' ').trim();
      expect(narration.length, `slide ${slide.slideNumber} talk track`).toBeGreaterThan(200);
    }
    // The opener names the fear, and the close answers it.
    expect(deck.slides[0].rows[0].talkTrack).toContain('no longer win');
    expect(deck.slides[11].rows[1].talkTrack).toContain('You do your work');
  });

  it('runs staged except one warm and one live ao-registry at the peak', async () => {
    const deck = await loadDeck(PAIN_STORY_DECK);
    const byMode = (mode: string) => deck.slides.filter((s) => s.op.mode === mode).map((s) => s.slideNumber);

    expect(byMode('warm')).toEqual([8]);
    expect(byMode('live')).toEqual([9]);
    expect(byMode('staged')).toHaveLength(10);
    // `ao-registry` is the only registered op, so it is the only one named.
    for (const slide of deck.slides) {
      expect(slide.op.opId, `slide ${slide.slideNumber}`).toBe(
        slide.op.mode === 'staged' ? undefined : 'ao-registry',
      );
    }
  });

  it('authors `right-third` per slide: `app` on the AdminOps beats, `absent` everywhere else', async () => {
    const deck = await loadDeck(PAIN_STORY_DECK);
    // The generator (`make-demo-xlsx.mjs`) now carries the column natively. The
    // two driven ao-registry slides (8 warm, 9 live) show the app pane; the
    // narrative/staged slides declare no pane.
    const rt = new Map(deck.slides.map((s) => [s.slideNumber, s.op.rightThird] as const));
    expect([...rt.entries()].filter(([, v]) => v === 'app').map(([n]) => n)).toEqual([8, 9]);
    for (const [n, v] of rt) {
      expect(v, `slide ${n}`).toBe(n === 8 || n === 9 ? 'app' : 'absent');
    }
    // The column parses cleanly — never a warned-unknown column, no image/absent
    // mismatch warnings (the app slides drive an op; the absent slides are staged).
    expect(deck.warnings.filter((w) => w.toLowerCase().includes('right-third'))).toEqual([]);
    expect(deck.warnings.some((w) => w.includes('unknown column') && w.includes('right-third'))).toBe(false);
  });

  it('declares an explicit dwell on every slide, totalling 584 s', async () => {
    const deck = await loadDeck(PAIN_STORY_DECK);
    // A blank duration silently becomes --default-dwell, which would make the
    // deck's stated run time a fiction. Every slide states its own.
    for (const slide of deck.slides) {
      expect(slide.op.durationSec, `slide ${slide.slideNumber}`).toBeGreaterThan(0);
    }
    const total = deck.slides.reduce((n, s) => n + (s.op.durationSec ?? 0), 0);
    expect(total).toBe(584);
  });

  it('carries at most three features, and only on the slides whose pain they remove', async () => {
    const deck = await loadDeck(PAIN_STORY_DECK);
    const listed = new Map(
      deck.slides.map((s) => [s.slideNumber, s.rows.flatMap((r) => r.features ?? [])] as const),
    );
    expect([...listed].filter(([, f]) => f.length > 0).map(([n]) => n)).toEqual([2, 5, 6, 8, 10]);
    for (const [n, features] of listed) {
      expect(features.length, `slide ${n}`).toBeLessThanOrEqual(3);
      expect(features.every((f) => f.trim() === f && f !== '')).toBe(true);
    }
  });

  it('inherits the op spec on the continuation row of each two-row slide', async () => {
    const deck = await loadDeck(PAIN_STORY_DECK);
    for (const n of [9, 12]) {
      const slide = deck.slides.find((s) => s.slideNumber === n)!;
      expect(slide.rows, `slide ${n}`).toHaveLength(2);
      // Row 2 states no op fields at all; the slide's spec still resolves.
      expect(slide.rows[1].feature).toBeUndefined();
      expect(slide.rows[1].benefit).toBeDefined();
    }
    const peak = deck.slides.find((s) => s.slideNumber === 9)!;
    expect(peak.op).toMatchObject({ mode: 'live', opId: 'ao-registry', durationSec: 60 });
    expect(peak.op.tools).toEqual(['ao', 'stacksim']);
  });

  it('regenerates deterministically, and the no-argument run writes BOTH decks', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-pain-deck-'));
    try {
      const outPath = path.join(tmpDir, 'ces-pain-story.xlsx');
      execFileSync(process.execPath, [MAKE_DECKS, '--deck', 'ces-pain-story', outPath], {
        stdio: 'ignore',
      });
      const fresh = await loadDeck(outPath);
      const checkedIn = await loadDeck(PAIN_STORY_DECK);
      expect(fresh.slides).toEqual(checkedIn.slides);

      // Byte-for-byte, so `node scripts/make-demo-xlsx.mjs` is safe to re-run
      // against the working tree without producing a spurious diff.
      expect(fs.readFileSync(outPath)).toEqual(fs.readFileSync(PAIN_STORY_DECK));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // The no-argument invocation regenerates the whole demos/ directory in
    // place. Running it here proves BOTH checked-in decks are exactly what the
    // script emits today — the gate's one-command claim, asserted rather than
    // trusted. Deterministic output means this rewrites identical bytes.
    const before = [STARTER_DECK, PAIN_STORY_DECK].map((p) => fs.readFileSync(p));
    execFileSync(process.execPath, [MAKE_DECKS], { stdio: 'ignore' });
    const after = [STARTER_DECK, PAIN_STORY_DECK].map((p) => fs.readFileSync(p));
    expect(after).toEqual(before);
  });
});

describe('grouping (A2)', () => {
  it('groups non-contiguous, out-of-order slide numbers ascending', async () => {
    const deck = await loadGrid(
      grid(
        [7, 'seven a', 'G', null, null, null, null, 'staged', null, null, null],
        [2, 'two', 'B', null, null, null, null, null, null, null, null],
        [7, 'seven b', null, null, 'benefit', null, null, null, null, null, null],
      ),
    );
    expect(deck.slides.map((s) => s.slideNumber)).toEqual([2, 7]);
    const seven = deck.slides[1];
    expect(seven.rows.map((r) => r.talkTrack)).toEqual(['seven a', 'seven b']);
  });

  it('inherits blank op cells within a slide and accepts agreeing duplicates', async () => {
    const deck = await loadGrid(
      grid(
        [3, 'a', 'F', null, null, null, 'ao', 'live', 'ao-registry', 60, null],
        [3, 'b', null, null, null, null, 'ao', 'live', null, null, null],
      ),
    );
    expect(deck.slides[0].op).toMatchObject({ mode: 'live', opId: 'ao-registry', durationSec: 60 });
    expect(deck.slides[0].op.tools).toEqual(['ao']);
  });

  it('defaults a slide with no op mode to staged', async () => {
    const deck = await loadGrid(grid([1, 'a', 'F', null, null, null, null, null, null, null, null]));
    expect(deck.slides[0].op.mode).toBe('staged');
  });
});

describe('in-slide app mirror (T1.5) resolved from the catalog at load', () => {
  it('stamps mirror + mirrorSource from the catalog for a live-GUI op and a Config op', async () => {
    const deck = await loadGrid(
      grid(
        [1, 'a', 'F', null, null, null, 'ao', 'live', 'ao-registry', null, null],
        [2, 'b', 'F', null, null, null, 'stamper', 'warm', 'stamper-execute', null, null],
      ),
    );
    // theatrical for the AO GUI act…
    expect(deck.slides[0].op.mirror).toBe('theatrical');
    // …and theatrical for Config too (decision 11), streamed from backstage.
    expect(deck.slides[1].op.mirror).toBe('theatrical');
    // GP-DEMO-5 streamgui: the screencast source is stamped alongside `mirror`.
    // The AO op streams the visible pane; the Config op streams backstage.
    expect(deck.slides[0].op.mirrorSource).toBe('pane');
    expect(deck.slides[1].op.mirrorSource).toBe('backstage');
  });

  it('stamps mirror:none and mirrorSource:pane for a slide that names no op', async () => {
    const deck = await loadGrid(grid([1, 'a', 'F', null, null, null, null, null, null, null, null]));
    expect(deck.slides[0].op.mirror).toBe('none');
    expect(deck.slides[0].op.mirrorSource).toBe('pane');
  });
});

describe('the features column', () => {
  const row = (slide: number, features: RawCell, fn: RawCell = 'does a thing'): RawCell[] => [
    slide, 'talk', 'F', fn, null, null, null, null, null, null, null, features,
  ];

  it('splits on newlines, trims each line and drops blank ones', async () => {
    const deck = await loadGrid(grid(row(1, '  one  \n\ntwo\r\n three \n   \n')));
    expect(deck.slides[0].rows[0].features).toEqual(['one', 'two', 'three']);
  });

  it('leaves a blank or absent cell absent rather than an empty array', async () => {
    const blank = await loadGrid(grid(row(1, '   ')));
    expect(blank.slides[0].rows[0].features).toBeUndefined();
    // A grid whose header has no features column at all.
    const noColumn = await loadGrid([
      ['slide #', 'feature'],
      [1, 'F'],
    ]);
    expect(noColumn.slides[0].rows[0].features).toBeUndefined();
  });

  it('is PER-ROW, not unique-or-agree: two rows of one slide concatenate', async () => {
    // Differing op fields across a slide's rows is an error; differing feature
    // lists is not — they are two rows' worth of one list.
    const deck = await loadGrid(grid(row(1, 'a\nb'), row(1, 'c')));
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].rows.map((r) => r.features)).toEqual([['a', 'b'], ['c']]);
  });

  it('warns past the display cap and counts across the slide, but still loads', async () => {
    const deck = await loadGrid(grid(row(1, '1\n2\n3\n4'), row(1, '5\n6\n7')));
    const warning = deck.warnings.find((w) => w.includes('features'));
    expect(warning).toContain('slide 1: 7');
    expect(warning).toContain('only the first 5 are displayed');
    // Non-fatal: every authored item is still in the model, cap or not.
    expect(deck.slides[0].rows.flatMap((r) => r.features ?? [])).toHaveLength(7);
  });

  it('accepts the plural aliases and never steals the singular title column', async () => {
    expect(canonicalColumn('features')).toBe('features');
    expect(canonicalColumn('Major Features')).toBe('features');
    expect(canonicalColumn('feature list')).toBe('features');
    // `feature` (singular) stays the slide title — one letter apart, two columns.
    expect(canonicalColumn('feature')).toBe('feature');
    expect(canonicalColumn('feature name')).toBe('feature');
  });
});

describe('error contract (A3)', () => {
  it('cites the 1-based sheet row and the founder-facing column label', async () => {
    const errors = await loadErrors(
      grid(
        [1, 'ok', 'F', null, null, null, null, 'staged', null, 20, null],
        [2, 'bad mode', 'F', null, null, null, null, 'livee', null, null, null],
      ),
      'demos/ces-overview.xlsx',
    );
    expect(errors).toEqual([
      'demos/ces-overview.xlsx row 3: "op mode" must be one of live|warm|staged (got "livee")',
    ]);
  });

  it('collects EVERY error, not just the first', async () => {
    const errors = await loadErrors(
      grid(
        ['x', 'bad slide', null, null, null, null, null, null, null, null, null],
        [2, 'bad tools', null, null, null, null, 'ao, nope', null, null, null, null],
        [3, 'bad duration', null, null, null, null, null, null, null, 'soon', null],
        [4, 'bad op', null, null, null, null, null, null, 'not-an-op', null, null],
      ),
    );
    expect(errors).toHaveLength(4);
    expect(errors[0]).toContain('row 2: "slide #" must be a whole number 1 or greater');
    expect(errors[1]).toContain('row 3: "tools" must be a comma-separated subset');
    expect(errors[1]).toContain('"nope"');
    expect(errors[2]).toContain('row 4: "duration (sec)" must be a positive number');
    expect(errors[3]).toContain('row 5: "op" names an unknown op "not-an-op"');
  });

  it('rejects disagreeing op fields on one slide instead of silently taking the first', async () => {
    const errors = await loadErrors(
      grid(
        [1, 'a', 'F', null, null, null, null, 'live', null, null, null],
        [1, 'b', null, null, null, null, null, 'warm', null, null, null],
      ),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('row 3');
    expect(errors[0]).toContain('slide 1: "op mode" disagrees across the slide\'s rows');
    expect(errors[0]).toContain('"live" on row 2');
    expect(errors[0]).toContain('"warm" on row 3');
  });

  it('rejects a missing slide # column and a missing header outright', async () => {
    await expect(loadGrid([['talk track', 'feature'], ['a', 'b']])).rejects.toThrow(/required column "slide #" is missing/);
    await expect(loadGrid([])).rejects.toThrow(/cannot read as .xlsx|first sheet is empty|no data rows/);
  });

  it('rejects a duplicate canonical column in the header', async () => {
    const errors = await loadErrors([
      ['slide #', 'duration (sec)', 'dwell'],
      [1, 10, 20],
    ]);
    expect(errors[0]).toContain('row 1: duplicate column for "duration (sec)"');
  });

  it('skips fully blank rows with a warning rather than failing', async () => {
    const deck = await loadGrid(
      grid(
        [1, 'a', 'F', null, null, null, null, null, null, null, null],
        [null, null, null, null, null, null, null, null, null, null, null],
        [2, 'b', 'G', null, null, null, null, null, null, null, null],
      ),
    );
    expect(deck.slides).toHaveLength(2);
    expect(deck.warnings.some((w) => w.includes('skipped blank row 3'))).toBe(true);
  });
});

describe('image cells', () => {
  const baseDir = path.join(REPO_ROOT, 'demos');

  it('resolves relative to the deck directory and assigns a URL-safe asset id', () => {
    const deck = validateDeck(
      [{ sheetRow: 2, slide: 1, feature: 'F', image: 'art/one shot.png' }],
      { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
    );
    const image = deck.slides[0].op.images[0];
    expect(image.rawValue).toBe('art/one shot.png');
    expect(image.absPath).toBe(path.join(baseDir, 'art', 'one shot.png'));
    expect(image.id).toBe('art-one-shot.png');
    expect(deck.assets).toHaveLength(1);
  });

  it('rejects a path that escapes the deck directory', () => {
    expect(() =>
      validateDeck([{ sheetRow: 2, slide: 1, image: '../../secrets.png' }], {
        sourcePath: 'demos/d.xlsx',
        baseDir,
        title: 'd',
        fileExists: () => true,
      }),
    ).toThrow(/resolves outside the deck directory/);
  });

  it('rejects a missing image file at load time', () => {
    expect(() =>
      validateDeck([{ sheetRow: 2, slide: 1, image: 'gone.png' }], {
        sourcePath: 'demos/d.xlsx',
        baseDir,
        title: 'd',
        fileExists: () => false,
      }),
    ).toThrow(/"image" file not found/);
  });
});

/* ------------------------------------------------------------------ Slice 1 */

describe('html slide bodies', () => {
  const baseDir = path.join(REPO_ROOT, 'demos');
  const SELF_CONTAINED = '<!doctype html><style>body{background:#000}</style><h2>Hi</h2>';

  const validate = (
    rows: Parameters<typeof validateDeck>[0],
    over: Partial<Parameters<typeof validateDeck>[1]> = {},
  ) =>
    validateDeck(rows, {
      sourcePath: 'demos/d.xlsx',
      baseDir,
      title: 'd',
      fileExists: () => true,
      readText: () => SELF_CONTAINED,
      ...over,
    });

  it('is a canonical column with aliases', () => {
    expect(canonicalColumn('html')).toBe('html');
    expect(canonicalColumn('HTML Body')).toBe('html');
    expect(canonicalColumn('slide html')).toBe('html');
    expect(canonicalColumn('html file')).toBe('html');
    expect(canonicalColumn('Page')).toBe('html');
  });

  it('resolves relative to the deck directory and assigns a URL-safe asset id', () => {
    const deck = validate([{ sheetRow: 2, slide: 1, feature: 'F', html: 'slides/big idea.html' }]);
    const html = deck.slides[0].op.html!;
    expect(html.rawValue).toBe('slides/big idea.html');
    expect(html.absPath).toBe(path.join(baseDir, 'slides', 'big idea.html'));
    expect(html.id).toBe('slides-big-idea.html');
    // Same asset map as an image — the page fetches it from /asset/<id>.
    expect(deck.assets.map((a) => a.id)).toEqual(['slides-big-idea.html']);
  });

  it('rejects a path that escapes the deck directory, same shape as image', () => {
    expect(() => validate([{ sheetRow: 2, slide: 1, html: '../../secrets.html' }])).toThrow(
      /"html" .* resolves outside the deck directory/,
    );
  });

  it('rejects a missing html file at load time', () => {
    expect(() => validate([{ sheetRow: 2, slide: 1, html: 'gone.html' }], { fileExists: () => false })).toThrow(
      /"html" file not found/,
    );
  });

  it('lets html win over image, with a warning and no image asset', () => {
    const deck = validate([{ sheetRow: 2, slide: 1, feature: 'F', html: 'a.html', image: 'b.png' }]);
    expect(deck.slides[0].op.html?.rawValue).toBe('a.html');
    expect(deck.slides[0].op.images).toEqual([]);
    expect(deck.warnings.filter((w) => w.includes('html wins'))).toHaveLength(1);
    // The dropped image is not served either — one body, one truth.
    expect(deck.assets.map((a) => a.rawValue)).toEqual(['a.html']);
  });

  it('warns about every reference the document does not inline — relative as well as absolute', () => {
    const deck = validate([{ sheetRow: 2, slide: 1, feature: 'F', html: 'x.html' }], {
      readText: () =>
        '<img src="logo.png">' + // relative: 404s on stage, because assets are served BY ID
        '<link href="https://cdn.example.com/a.css" rel="stylesheet">' +
        '<img src="data:image/gif;base64,R0lGOD">' + // inlined — fine
        '<a href="#next">n</a>' + // in-document — fine
        '<iframe src="about:blank"></iframe>', // fine
    });
    const warn = deck.warnings.find((w) => w.includes('does not inline'));
    expect(warn).toBeDefined();
    expect(warn).toContain('logo.png');
    expect(warn).toContain('https://cdn.example.com/a.css');
    expect(warn).toContain('data:');
    expect(warn).not.toContain('R0lGOD');
    expect(warn).not.toContain('#next');
    expect(warn).not.toContain('about:blank');
    expect(warn).toContain('2 asset(s)');
  });

  it('names at most five offenders', () => {
    const deck = validate([{ sheetRow: 2, slide: 1, feature: 'F', html: 'x.html' }], {
      readText: () => Array.from({ length: 8 }, (_, i) => `<img src="a${i}.png">`).join(''),
    });
    const warn = deck.warnings.find((w) => w.includes('does not inline'))!;
    expect(warn).toContain('8 asset(s)');
    expect(warn).toContain('(+3 more)');
    expect(warn).toContain('a4.png');
    expect(warn).not.toContain('a5.png');
  });

  it('says nothing about a fully self-contained document', () => {
    const deck = validate([{ sheetRow: 2, slide: 1, feature: 'F', html: 'x.html' }]);
    expect(deck.warnings.filter((w) => w.includes('does not inline'))).toEqual([]);
  });

  it('warns — never errors — about a warm stamper-execute with no earlier warm translate', () => {
    const warmExecuteOnly = validateDeck(
      [{ sheetRow: 2, slide: 4, feature: 'Config', op: 'stamper-execute', opmode: 'warm' }],
      { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
    );
    const warn = warmExecuteOnly.warnings.find((w) => w.includes('stamper-execute'));
    expect(warn).toBeDefined();
    expect(warn).toContain('~12 min');
    // A warning, not an error: the self-heal path is legal, just expensive.
    expect(warmExecuteOnly.slides[0].op.opId).toBe('stamper-execute');
  });

  it('says nothing when a warm translate sits on an EARLIER slide', () => {
    const ordered = validateDeck(
      [
        { sheetRow: 2, slide: 3, feature: 'Translate', op: 'stamper-translate', opmode: 'warm' },
        { sheetRow: 3, slide: 4, feature: 'Execute', op: 'stamper-execute', opmode: 'warm' },
      ],
      { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
    );
    expect(ordered.warnings.filter((w) => w.includes('~12 min'))).toEqual([]);
  });

  it('still warns when the warm translate is AFTER the execute — warm ops fire in deck order', () => {
    const backwards = validateDeck(
      [
        { sheetRow: 2, slide: 3, feature: 'Execute', op: 'stamper-execute', opmode: 'warm' },
        { sheetRow: 3, slide: 4, feature: 'Translate', op: 'stamper-translate', opmode: 'warm' },
      ],
      { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
    );
    expect(backwards.warnings.some((w) => w.includes('~12 min'))).toBe(true);
  });

  it('params: is a canonical column with aliases, and `act` names the op column', () => {
    expect(canonicalColumn('params')).toBe('params');
    expect(canonicalColumn('Parameters')).toBe('params');
    expect(canonicalColumn('op params')).toBe('params');
    expect(canonicalColumn('args')).toBe('params');
    expect(canonicalColumn('Options')).toBe('params');
    // The founder's "demo act" vocabulary names the OP column.
    expect(canonicalColumn('act')).toBe('op');
    expect(canonicalColumn('demo act')).toBe('op');
    expect(canonicalColumn('demo-act')).toBe('op');
  });

  it('params: resolves against the op catalog, filling defaults', () => {
    const deck = validateDeck(
      [{ sheetRow: 2, slide: 1, feature: 'A', op: 'eo-review', opmode: 'live', params: 'land=evidence' }],
      { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
    );
    // The declared value wins; the undeclared one gets the catalog default.
    expect(deck.slides[0].op.params).toEqual({ family: 'IA', land: 'evidence' });
  });

  it('params: fills defaults even when the author wrote no cell at all', () => {
    const deck = validateDeck([{ sheetRow: 2, slide: 1, feature: 'A', op: 'eo-review', opmode: 'live' }], {
      sourcePath: 'demos/d.xlsx',
      baseDir,
      title: 'd',
      fileExists: () => true,
    });
    expect(deck.slides[0].op.params).toEqual({ family: 'IA', land: 'sprs' });
  });

  it('params: an unknown key or a bad enum value fails the load, citing the catalog', () => {
    const unknown = () =>
      validateDeck([{ sheetRow: 2, slide: 1, op: 'eo-review', opmode: 'live', params: 'familly=IA' }], {
        sourcePath: 'demos/d.xlsx',
        baseDir,
        title: 'd',
        fileExists: () => true,
      });
    expect(unknown).toThrow(/has no parameter "familly"/);
    expect(unknown).toThrow(/docs\/demo\/OP-CATALOG\.md/);

    expect(() =>
      validateDeck([{ sheetRow: 2, slide: 1, op: 'eo-review', opmode: 'live', params: 'land=nowhere' }], {
        sourcePath: 'demos/d.xlsx',
        baseDir,
        title: 'd',
        fileExists: () => true,
      }),
    ).toThrow(/must be one of dashboard\|evidence\|sprs/);
  });

  it('params: on a slide with NO op is an error — parameters belong to an op', () => {
    expect(() =>
      validateDeck([{ sheetRow: 2, slide: 1, feature: 'A', params: 'land=sprs' }], {
        sourcePath: 'demos/d.xlsx',
        baseDir,
        title: 'd',
        fileExists: () => true,
      }),
    ).toThrow(/is set but the slide names no "op"/);
  });

  it('params: a malformed line is a syntax error citing the SHEET row', async () => {
    const errors = await loadErrors([
      ['slide #', 'feature', 'op', 'op mode', 'params'],
      [1, 'A', 'eo-review', 'live', 'land sprs'],
    ]);
    expect(errors[0]).toContain('row 2');
    expect(errors[0]).toContain('is not `key=value`');
  });

  it('params: agree across a slide regardless of LINE ORDER', () => {
    const deck = validateDeck(
      [
        { sheetRow: 2, slide: 1, feature: 'A', op: 'eo-review', opmode: 'live', params: 'family=AC\nland=sprs' },
        { sheetRow: 3, slide: 1, benefit: 'B', params: 'land=sprs\nfamily=AC' },
      ],
      { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
    );
    expect(deck.slides[0].op.params).toEqual({ family: 'AC', land: 'sprs' });
  });

  it('params: two rows setting DIFFERENT values is a conflict, as for every op field', () => {
    expect(() =>
      validateDeck(
        [
          { sheetRow: 2, slide: 1, feature: 'A', op: 'eo-review', opmode: 'live', params: 'family=AC' },
          { sheetRow: 3, slide: 1, benefit: 'B', params: 'family=IA' },
        ],
        { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
      ),
    ).toThrow(/"params" disagrees across the slide's rows/);
  });

  it('warns when the deck s warm chain blows the prep budget, naming the total', () => {
    const deck = validateDeck(
      [
        { sheetRow: 2, slide: 1, feature: 'T', op: 'stamper-translate', opmode: 'warm' },
        { sheetRow: 3, slide: 2, feature: 'E', op: 'stamper-execute', opmode: 'warm' },
      ],
      { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
    );
    const warn = deck.warnings.find((w) => w.startsWith('prep budget:'));
    expect(warn).toBeDefined();
    // 300 s translate + 780 s execute. Both MEASURED 2026-09-06 by
    // `demo:acts-test --full`; the execute half was re-stamped from a 420 s
    // guess to the 774 s it actually took on the FAST path.
    expect(warn).toContain('1080s');
    expect(warn).toContain('stamper-translate, stamper-execute');
    expect(warn).toContain('docs/demo/OP-CATALOG.md');
  });

  it('says nothing about the prep budget for a short warm chain', () => {
    const deck = validateDeck(
      [{ sheetRow: 2, slide: 1, feature: 'A', op: 'eo-review', opmode: 'warm' }],
      { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
    );
    expect(deck.warnings.filter((w) => w.startsWith('prep budget:'))).toEqual([]);
  });

  it('reserves `show` and `watchouts` — no "ignored unknown column" warning for either', () => {
    for (const header of ['show', 'stage direction', 'watchouts', 'watch out', 'watch', 'cautions']) {
      expect(canonicalColumn(header), header).toBeDefined();
    }
    const result = normalizeSheet([
      ['slide #', 'feature', 'show', 'watchouts'],
      [1, 'A', 'stand left', 'the sim is slow here'],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.filter((w) => w.includes('unknown column'))).toEqual([]);
    expect(result.rows[0]).toMatchObject({ show: 'stand left', watchouts: 'the sim is slow here' });
  });

  it('carries both reserved columns onto the row, per row and with no rules', () => {
    const deck = validateDeck(
      [
        { sheetRow: 2, slide: 1, feature: 'A', show: 'stand left', watchouts: 'cue one' },
        { sheetRow: 3, slide: 1, benefit: 'B', watchouts: 'cue two' },
      ],
      { sourcePath: 'demos/d.xlsx', baseDir, title: 'd', fileExists: () => true },
    );
    // Per-row like talkTrack, NOT unique-or-agree like the op fields: two rows
    // each carrying a cue is two cues, not a conflict.
    expect(deck.slides[0].rows.map((r) => r.watchouts)).toEqual(['cue one', 'cue two']);
    expect(deck.slides[0].rows[0].show).toBe('stand left');
    expect(deck.slides[0].rows[1].show).toBeUndefined();
  });

  it('resolves unique-or-agree across a slide, like every other op field', () => {
    expect(() =>
      validate([
        { sheetRow: 2, slide: 1, feature: 'F', html: 'a.html' },
        { sheetRow: 3, slide: 1, benefit: 'B', html: 'b.html' },
      ]),
    ).toThrow(/"html" disagrees across the slide's rows/);
  });
});

describe('op mode vs catalog modes (GP-DEMO-4 Slice 2B)', () => {
  it('rejects a declared mode the op catalog does not list, citing the catalog', async () => {
    // `simstack-destroy` catalogs `['staged','live']` — `warm` is not allowed
    // (destroying during prep removes the tenant the deck is about to use).
    const errors = await loadErrors(
      grid([1, '', 'Teardown', '', '', '', '', 'warm', 'simstack-destroy', '', '', '']),
    );
    expect(errors.some((e) => /does not support .*warm/.test(e) && e.includes('simstack-destroy'))).toBe(
      true,
    );
    expect(errors.some((e) => e.includes('OP-CATALOG.md'))).toBe(true);
  });

  it('accepts a mode the op catalog does list', async () => {
    const deck = await loadGrid(
      grid([1, '', 'Teardown', '', '', '', '', 'live', 'simstack-destroy', '', '', '']),
    );
    expect(deck.slides[0].op.opId).toBe('simstack-destroy');
    expect(deck.slides[0].op.mode).toBe('live');
  });
});
