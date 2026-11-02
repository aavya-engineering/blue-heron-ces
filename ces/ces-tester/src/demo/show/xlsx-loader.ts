// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S1 — read a `demos/*.xlsx` into normalized rows.
 *
 * Two things bite here and both are handled explicitly:
 *
 * 1. **`read-excel-file` v9's API changed.** The DEFAULT export resolves to
 *    `Sheet[]` (`{sheet, data}[]`), not rows — the `readXlsxFile(path).then(rows
 *    => …)` form in every blog post is the pre-v9 shape and silently yields the
 *    wrong thing. The named `readSheet` export is the row-returning one
 *    (RESEARCH_SUMMARY.md finding 1 + Q4).
 * 2. **Blank cells arrive as `null`**, not `''` or `undefined`. Blank is
 *    meaningful in this format — it means "inherit from the slide's other
 *    rows" — so every blank is normalized to a single representation (`null`)
 *    before validation ever sees it.
 *
 * Headers are matched loosely (lowercased, non-alphanumerics stripped, a table
 * of aliases) because the deck is authored in Excel by a human who will type
 * "Duration (sec)", "duration", or "Dwell" on different days. An unrecognized
 * column is a WARNING, never a failure — a founder's scratch column must not
 * break the show.
 */

import * as path from 'node:path';
import { readSheet } from 'read-excel-file/node';
import { type DemoDeck, type DeckError, DeckLoadFailure } from './deck-model.js';
import { validateDeck, type ValidateDeckOptions } from './deck-validate.js';

/** The canonical column keys, post-normalization. */
export const CANONICAL_COLUMNS = [
  'slide',
  'talktrack',
  'feature',
  'function',
  'benefit',
  'differentiator',
  'tools',
  'opmode',
  'op',
  'durationsec',
  'image',
  'html',
  'params',
  'theme',
  'show',
  'watchouts',
  'features',
  'rightthird',
] as const;

export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

/** The header the founder most likely typed, for error messages. */
export const COLUMN_LABEL: Readonly<Record<CanonicalColumn, string>> = {
  slide: 'slide #',
  talktrack: 'talk track',
  feature: 'feature',
  function: 'function',
  benefit: 'benefit',
  differentiator: 'differentiator',
  tools: 'tools',
  opmode: 'op mode',
  op: 'op',
  durationsec: 'duration (sec)',
  image: 'image',
  html: 'html',
  params: 'params',
  theme: 'theme',
  show: 'show',
  watchouts: 'watchouts',
  features: 'features',
  rightthird: 'right-third',
};

/**
 * Normalized header text -> canonical column. Keys are already lowercased with
 * every non-alphanumeric stripped, so `"Duration (sec)"`, `"duration_sec"` and
 * `"DURATION SEC"` all arrive as `durationsec`.
 */
const HEADER_ALIASES: Readonly<Record<string, CanonicalColumn>> = {
  slide: 'slide',
  slideno: 'slide',
  slidenum: 'slide',
  slidenumber: 'slide',
  slideid: 'slide',

  talktrack: 'talktrack',
  talk: 'talktrack',
  narration: 'talktrack',
  narrative: 'talktrack',
  script: 'talktrack',

  feature: 'feature',
  featurename: 'feature',

  // Singular `feature` is the slide TITLE; plural `features` is the major-feature
  // list rendered under the Function card. Two different columns, one letter
  // apart, so neither alias set may grow into the other's territory.
  features: 'features',
  majorfeatures: 'features',
  featurelist: 'features',

  function: 'function',
  functionality: 'function',

  benefit: 'benefit',
  benefits: 'benefit',
  value: 'benefit',

  differentiator: 'differentiator',
  differentiators: 'differentiator',
  differentiation: 'differentiator',

  tools: 'tools',
  tool: 'tools',
  cestools: 'tools',
  modules: 'tools',

  opmode: 'opmode',
  mode: 'opmode',

  op: 'op',
  opid: 'op',
  operation: 'op',
  // The founder's "demo act" vocabulary (DEMO-ACTS-CONCEPT.md) names the same
  // column. `demo-act` and `demo act` both normalize to `demoact`. Alias
  // RESOLUTION (a named preset expanding to id + params) is GP-DEMO-5 T3; these
  // are header aliases only, so `act` today still takes a registered op id.
  act: 'op',
  demoact: 'op',

  durationsec: 'durationsec',
  durationseconds: 'durationsec',
  duration: 'durationsec',
  dwell: 'durationsec',
  dwellsec: 'durationsec',
  seconds: 'durationsec',
  sec: 'durationsec',

  image: 'image',
  images: 'image',
  img: 'image',
  picture: 'image',

  html: 'html',
  htmlbody: 'html',
  slidehtml: 'html',
  htmlfile: 'html',
  page: 'html',

  params: 'params',
  parameters: 'params',
  opparams: 'params',
  args: 'params',
  arguments: 'params',
  options: 'params',

  theme: 'theme',
  themefile: 'theme',
  brand: 'theme',
  branding: 'theme',

  // Reserved presenter columns. They rode as ignored-unknown columns and warned
  // on every load; reserving them stops the noise.
  show: 'show',
  stagedirection: 'show',
  watchouts: 'watchouts',
  watchout: 'watchouts',
  watch: 'watchouts',
  cautions: 'watchouts',

  // The authored per-slide right-pane intent. `right-third`, `rightthird` and
  // `right third` all normalize to `rightthird`; `rightpane` and `right-pane`
  // to `rightpane` — the two distinct keys the alias table needs.
  rightthird: 'rightthird',
  rightpane: 'rightthird',
};

/** Lowercase, strip every non-alphanumeric. `"Duration (sec)"` -> `durationsec`. */
export function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Map a header cell to its canonical column, or undefined if unrecognized. */
export function canonicalColumn(raw: string): CanonicalColumn | undefined {
  return HEADER_ALIASES[normalizeHeader(raw)];
}

/** A row keyed by canonical column, with every blank collapsed to `null`. */
export interface NormalizedRow {
  /** 1-based spreadsheet row (header is 1, so data starts at 2). */
  sheetRow: number;
  slide: string | number | null;
  talktrack?: string | null;
  feature?: string | null;
  function?: string | null;
  benefit?: string | null;
  differentiator?: string | null;
  tools?: string | null;
  opmode?: string | null;
  op?: string | null;
  durationsec?: string | number | null;
  image?: string | null;
  /** Deck-relative path to a self-contained `.html` slide body. */
  html?: string | null;
  /** Raw cell text; `key=value`, one per line, parsed against the op catalog. */
  params?: string | null;
  /** Deck-relative path to a theme JSON file. Deck-level: one per deck. */
  theme?: string | null;
  /** Reserved presenter column: stage directions. Captured, never rendered. */
  show?: string | null;
  /** Reserved presenter column: cautions, rendered only behind --watchouts. */
  watchouts?: string | null;
  /** Raw cell text; the newlines inside it are the list separators. */
  features?: string | null;
  /**
   * The founder's authored right-pane intent. The cell carries a leading kind
   * token (`app` | `image` | `absent`) optionally followed by prose, e.g.
   * `"app — muster-readiness readout (live)"`. Resolved per slide in `loadDeck`.
   */
  rightthird?: string | null;
}

/** A raw cell as `read-excel-file` hands it over. */
export type RawCell = string | number | boolean | Date | null | undefined;

/**
 * Collapse one cell to `string | number | null`. Whitespace-only text is blank
 * (an operator who taps space in a cell means "empty"), and a Date is rendered
 * ISO — no deck field is a date, so this only keeps a stray cell readable in an
 * error message rather than printing `[object Object]`.
 */
export function normalizeCell(cell: RawCell): string | number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'boolean') return String(cell);
  if (cell instanceof Date) return cell.toISOString();
  const text = String(cell).trim();
  return text === '' ? null : text;
}

export interface NormalizeSheetResult {
  readonly rows: NormalizedRow[];
  readonly warnings: string[];
  /** Whole-file problems (no header, duplicate or missing `slide #`). */
  readonly errors: DeckError[];
}

/**
 * Turn the raw sheet grid into normalized rows. Pure — the round-trip test
 * drives it from a real generated .xlsx, and the error tests drive it from
 * hand-built grids with no filesystem involved.
 */
export function normalizeSheet(grid: readonly (readonly RawCell[])[]): NormalizeSheetResult {
  const warnings: string[] = [];
  const errors: DeckError[] = [];

  const header = grid[0];
  if (!header || header.every((c) => normalizeCell(c) === null)) {
    return { rows: [], warnings, errors: [{ message: 'the first sheet is empty — row 1 must be the header row' }] };
  }

  // Header row -> column index per canonical column.
  const columnAt = new Map<CanonicalColumn, number>();
  header.forEach((cell, index) => {
    const text = normalizeCell(cell);
    if (text === null) return;
    const canonical = canonicalColumn(String(text));
    if (!canonical) {
      warnings.push(`ignored unknown column "${String(text)}" (column ${index + 1})`);
      return;
    }
    if (columnAt.has(canonical)) {
      errors.push({
        sheetRow: 1,
        message: `duplicate column for "${COLUMN_LABEL[canonical]}" — it appears more than once in the header`,
      });
      return;
    }
    columnAt.set(canonical, index);
  });

  if (!columnAt.has('slide')) {
    errors.push({ sheetRow: 1, message: 'required column "slide #" is missing from the header row' });
  }
  if (errors.length > 0) return { rows: [], warnings, errors };

  const rows: NormalizedRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    const sheetRow = i + 1; // header is row 1
    const read = (col: CanonicalColumn): string | number | null => {
      const at = columnAt.get(col);
      return at === undefined ? null : normalizeCell(cells[at]);
    };

    // A fully blank row is spreadsheet noise (trailing rows, spacer rows), not
    // an error — Excel hands them over freely.
    if (CANONICAL_COLUMNS.every((c) => read(c) === null)) {
      warnings.push(`skipped blank row ${sheetRow}`);
      continue;
    }

    const row: NormalizedRow = { sheetRow, slide: read('slide') };
    // Only columns the header actually carries are attached — the schema is
    // `additionalProperties: false`, and an absent column must not masquerade
    // as an explicitly blank cell.
    for (const col of CANONICAL_COLUMNS) {
      if (col === 'slide' || !columnAt.has(col)) continue;
      (row as unknown as Record<string, unknown>)[col] = read(col);
    }
    rows.push(row);
  }

  return { rows, warnings, errors };
}

export interface LoadDeckOptions extends ValidateDeckOptions {
  /** Sheet index (1-based) or name. Defaults to the first sheet. */
  readonly sheet?: number | string;
  /** Test seam: supply the grid instead of reading a real .xlsx. */
  readonly readGrid?: (absPath: string, sheet?: number | string) => Promise<readonly (readonly RawCell[])[]>;
}

async function readGridFromFile(
  absPath: string,
  sheet?: number | string,
): Promise<readonly (readonly RawCell[])[]> {
  // v9: the NAMED export returns rows. The default export returns Sheet[].
  return (await readSheet(absPath, sheet ?? 1)) as unknown as readonly (readonly RawCell[])[];
}

/** The `right-third` kinds, and the regex that reads the leading kind token. */
export const RIGHT_THIRD_KINDS = ['app', 'image', 'absent'] as const;
export type RightThirdKind = (typeof RIGHT_THIRD_KINDS)[number];
const RIGHT_THIRD_KIND_RE = /^(app|image|absent)\b/;

/**
 * Resolve the founder's authored per-slide right-pane intent from the
 * `right-third` column and stamp it onto each slide's op.
 *
 * Kept HERE, in the loader, rather than in `deck-validate.ts`: the resolution
 * mirrors the op fields' PER-SLIDE, first-non-blank-wins semantics but needs
 * none of the validator's unique-or-agree/error machinery. An authored cell is
 * a leading KIND token (`app` | `image` | `absent`) optionally followed by prose
 * — e.g. `"app — muster-readiness readout (live)"` — so only the token is read,
 * and the first non-blank cell for a slide wins.
 *
 * A deck WITHOUT the column produces no `rightThird` on any slide and no extra
 * warnings, so the deck rebuilds byte-identically — the compatibility invariant
 * that keeps `--check` green for legacy decks.
 *
 * Warnings (never errors, per the task): an unknown leading token, an `image`
 * with no image asset (downgraded to `absent`), and an `absent` on a
 * theatrical/readout op (a column-vs-catalog mismatch worth surfacing).
 */
export function applyRightThird(deck: DemoDeck, rows: readonly NormalizedRow[]): DemoDeck {
  const rawBySlide = new Map<number, string>();
  for (const r of rows) {
    const cell = r.rightthird;
    if (cell === null || cell === undefined) continue;
    const raw = String(cell).trim();
    if (raw === '') continue;
    const slideNum = Number(r.slide);
    if (!Number.isInteger(slideNum)) continue;
    if (!rawBySlide.has(slideNum)) rawBySlide.set(slideNum, raw); // first non-blank wins
  }
  if (rawBySlide.size === 0) return deck; // no column anywhere → unchanged

  const warnings = [...deck.warnings];
  const slides = deck.slides.map((slide) => {
    const raw = rawBySlide.get(slide.slideNumber);
    if (raw === undefined) return slide;
    const match = RIGHT_THIRD_KIND_RE.exec(raw.toLowerCase());
    if (!match) {
      warnings.push(
        `slide ${slide.slideNumber}: "${COLUMN_LABEL.rightthird}" ${JSON.stringify(raw)} does not begin with ` +
          `${RIGHT_THIRD_KINDS.join('|')} — ignored; the pane falls back to the op default`,
      );
      return slide;
    }
    let kind = match[1] as RightThirdKind;
    if (kind === 'image' && slide.op.images.length === 0) {
      warnings.push(
        `slide ${slide.slideNumber}: "${COLUMN_LABEL.rightthird}" is "image" but the slide has no image asset — ` +
          'rendering no pane (treated as absent)',
      );
      kind = 'absent';
    }
    if (kind === 'absent' && (slide.op.mirror === 'theatrical' || slide.op.mirror === 'readout')) {
      warnings.push(
        `slide ${slide.slideNumber}: "${COLUMN_LABEL.rightthird}" is "absent" but op ${JSON.stringify(slide.op.opId ?? '')} ` +
          'is theatrical/readout — the op still drives the pane headless; it is just not shown on this slide',
      );
    }
    return { ...slide, op: { ...slide.op, rightThird: kind } };
  });

  return { ...deck, slides, warnings };
}

/**
 * Load and validate one deck. Throws `DeckLoadFailure` carrying EVERY problem
 * — never a partially-built deck, which is the whole point of A3.
 */
export async function loadDeck(deckPath: string, opts: LoadDeckOptions = {}): Promise<DemoDeck> {
  const absPath = path.resolve(deckPath);
  const baseDir = path.dirname(absPath);
  const title = path.basename(absPath, path.extname(absPath));

  let grid: readonly (readonly RawCell[])[];
  try {
    grid = await (opts.readGrid ?? readGridFromFile)(absPath, opts.sheet);
  } catch (err) {
    throw new DeckLoadFailure(deckPath, [
      { message: `cannot read as .xlsx: ${err instanceof Error ? err.message : String(err)}` },
    ]);
  }

  const normalized = normalizeSheet(grid);
  if (normalized.errors.length > 0) throw new DeckLoadFailure(deckPath, normalized.errors);
  if (normalized.rows.length === 0) {
    throw new DeckLoadFailure(deckPath, [{ message: 'no data rows — the sheet has a header and nothing else' }]);
  }

  const deck = validateDeck(normalized.rows, {
    ...opts,
    sourcePath: deckPath,
    baseDir,
    title,
    warnings: normalized.warnings,
  });

  // Stamp the authored per-slide right-pane intent onto each slide's op. A
  // column-less deck is returned unchanged (byte-identical render).
  return applyRightThird(deck, normalized.rows);
}
