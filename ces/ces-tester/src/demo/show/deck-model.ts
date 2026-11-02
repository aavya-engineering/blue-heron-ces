// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S1 — the demo-deck data model.
 *
 * A deck is ONE `demos/*.xlsx`. Its rows group into slides by `slide #`; a
 * slide is one or more content rows plus a single op spec. The split matters:
 * the founder authors narration row by row (a slide may want three benefit
 * lines), but a slide drives at most ONE app-pane operation — so op fields are
 * resolved ACROSS the slide's rows by "unique-or-agree" (`deck-validate.ts`)
 * rather than being read off whichever row happened to come first.
 *
 * Everything here is data only. Loading lives in `xlsx-loader.ts`, validation
 * and grouping in `deck-validate.ts`, and rendering in `slide-render.ts`.
 */

import type { DeckTheme } from './theme.js';

export type { DeckTheme };

/** FD-2's per-slide op modes. */
export type OpMode = 'live' | 'warm' | 'staged';

export const OP_MODES: readonly OpMode[] = ['live', 'warm', 'staged'];

export function isOpMode(value: string): value is OpMode {
  return (OP_MODES as readonly string[]).includes(value);
}

/** The five CES tools a demo object can involve. */
export type CesTool = 'stacksim' | 'muster' | 'stamper' | 'ao' | 'eo';

export const CES_TOOLS: readonly CesTool[] = ['stacksim', 'muster', 'stamper', 'ao', 'eo'];

export function isCesTool(value: string): value is CesTool {
  return (CES_TOOLS as readonly string[]).includes(value);
}

/**
 * The op ids a deck may name. Declared here rather than in `op-registry.ts` so
 * a deck can be loaded and validated with no runtime, no browser and no
 * sibling tool present — `--check` depends on that. `op-registry.ts` is keyed
 * by this same union, so an id can never be registered without being loadable
 * or named in a deck without being registered.
 */
export type DemoOpId =
  | 'ao-registry'
  | 'ao-make-change'
  | 'eo-review'
  | 'eo-show-change-captured'
  | 'muster-readiness'
  | 'muster-connect-tenant'
  | 'muster-auto-analysis'
  | 'muster-consent-and-attest'
  | 'muster-adaptive-interview'
  | 'muster-generate-sprs-mp'
  | 'muster-rollup'
  | 'simstack-create'
  | 'simstack-destroy'
  | 'stamper-translate'
  | 'stamper-execute';

export const DEMO_OP_IDS: readonly DemoOpId[] = [
  'ao-registry',
  'ao-make-change',
  'eo-review',
  'eo-show-change-captured',
  'muster-readiness',
  'muster-connect-tenant',
  'muster-auto-analysis',
  'muster-consent-and-attest',
  'muster-adaptive-interview',
  'muster-generate-sprs-mp',
  'muster-rollup',
  'simstack-create',
  'simstack-destroy',
  'stamper-translate',
  'stamper-execute',
];

export function isDemoOpId(value: string): value is DemoOpId {
  return (DEMO_OP_IDS as readonly string[]).includes(value);
}

/** One narration row of a slide, in sheet order. */
export interface SlideRow {
  /**
   * The 1-based row number the founder sees in Excel — header is row 1, so the
   * first data row is 2. Every error message cites THIS number, never a
   * 0-based array index.
   */
  readonly sheetRow: number;
  readonly slideNumber: number;
  readonly talkTrack?: string;
  readonly feature?: string;
  /** What the feature does in the context of the app. */
  readonly func?: string;
  readonly benefit?: string;
  readonly differentiator?: string;
  /**
   * The tool's major features, one per line in the sheet cell. PER-ROW, not
   * per-slide: unlike the op fields, two rows of one slide carrying different
   * lists is not a conflict — they are two rows' worth of list, concatenated in
   * sheet order under the slide's Function card.
   */
  readonly features?: readonly string[];
  /**
   * RESERVED presenter column. Captured and **not rendered** — it exists so a
   * deck may carry stage directions without the loader warning about an unknown
   * column on every load. A future stage-direction surface is where it lands.
   */
  readonly show?: string;
  /**
   * RESERVED presenter column: cautions for the presenter. Rendered in the
   * presenter band under the talk track, but only behind `--watchouts`, which
   * defaults OFF — nothing changes on stage unless the presenter asks.
   *
   * PER-ROW, like `talkTrack` and unlike the op fields: two rows of one slide
   * each carrying a cue is two cues, not a conflict.
   */
  readonly watchouts?: string;
}

/**
 * How many features a slide DISPLAYS. Authoring more is legal and non-fatal —
 * the loader warns and the renderer shows the first five — because a deck that
 * refuses to open ten minutes before a demo is worse than a deck that shows a
 * short list. Shared by `deck-validate.ts` and `slide-render.ts` so the warning
 * and the truncation can never disagree.
 */
export const MAX_SLIDE_FEATURES = 5;

/** An `image` or `html` cell, resolved against the deck's directory. */
export interface SlideImage {
  /** Stable, URL-safe asset id — the page fetches `/asset/<id>`. */
  readonly id: string;
  /** Exactly as typed in the sheet, for error messages. */
  readonly rawValue: string;
  /** Absolute path on disk, already guarded to under the deck directory. */
  readonly absPath: string;
}

/**
 * The single app-pane operation a slide is paired with.
 *
 * `html` wins over `image`; both is a warning, never an error. The loader drops
 * the losing image so the renderer has exactly one truth to draw — a renderer
 * that has to pick between two bodies is a renderer that picks differently on
 * stage than it did in `--check`.
 */
export interface SlideOp {
  readonly mode: OpMode;
  /** Registry id; absent for a slide that narrates without driving anything. */
  readonly opId?: DemoOpId;
  readonly tools: readonly CesTool[];
  /** Blank in the sheet means "use `--default-dwell`", represented as absent. */
  readonly durationSec?: number;
  readonly images: readonly SlideImage[];
  /**
   * A self-contained `.html` document rendered IN PLACE of the auto-rendered
   * body, in a sandboxed iframe served from `/asset/<id>`. Same id-addressable
   * record as an image, because the asset map is keyed off exactly that shape.
   */
  readonly html?: SlideImage;
  /**
   * The op's DECLARED parameters, resolved against `op-catalog.ts` (defaults
   * filled in). OPTIONAL, so every existing construction site still compiles;
   * ops read `ctx.slide.op.params?.x ?? <default>`.
   */
  readonly params?: Readonly<Record<string, string | number | boolean>>;
  /**
   * Whether this slide's op renders the in-slide app mirror (T1.5), and how.
   * Resolved from `op-catalog.ts` at LOAD time (`deck-validate.ts`) so `--check`
   * and the live render read the same value.
   *
   * - `none`      — no split; the pane is not surfaced on this slide.
   * - `theatrical` — the LIVE app GUI streams into the right third (AO/EO/Muster).
   * - `readout`   — the op's own REAL result card (the `htmlDataUrl` the readout
   *                 ops navigate the visible pane to) streams into the right third,
   *                 so the on-stage numbers match the run. Config work still runs
   *                 on the unmirrorable backstage session; only the card is shown.
   *
   * OPTIONAL so every existing construction site still compiles; absent reads as
   * `none`. `theatrical` and `readout` render identically (both stream the pane
   * `<img>` into the 50/50 `.pane`) — the distinction is the catalog default and
   * doctrine.
   */
  readonly mirror?: 'none' | 'theatrical' | 'readout';
  /**
   * WHICH screencast source this slide's mirror `<img>` subscribes to
   * (GP-DEMO-5 streamgui). Resolved from `op-catalog.ts` at LOAD time
   * (`deck-validate.ts`), the same way `mirror` is.
   *
   * - `pane`      — the VISIBLE pane's screencast (`GET /mirror`). The default,
   *                 and what every non-Config op streams.
   * - `backstage` — the headless backstage session's screencast
   *                 (`GET /mirror/backstage`). The Config (Stamper) ops drive
   *                 backstage; decision 11 lifted decision 8's no-live-Config
   *                 rule, so their GUI now streams from there.
   *
   * Encoded once in the catalog rather than derived from `target`: where an op
   * *drives* is not the same as which tool it targets. OPTIONAL so every existing
   * construction site still compiles; absent reads as `pane`. Only consulted when
   * `mirror === 'theatrical'` — a `readout` slide always streams `/mirror`.
   */
  readonly mirrorSource?: 'pane' | 'backstage';
  /**
   * The founder's authored per-slide RIGHT-PANE intent, from the deck's
   * `right-third` column (resolved per slide in `xlsx-loader.ts`):
   *
   * - `app`    — the driven app mirror `<img>` streams into the `.pane` (a static
   *              last-frame when the op is not live).
   * - `image`  — the slide's own static image fills the `.pane` (direct `<img>`,
   *              not the mirror). Downgraded to `absent` at load time when the
   *              slide has no image asset.
   * - `absent` — no pane; the content column runs full width, even when the op is
   *              theatrical (it still drives the pane headless, just unshown here).
   *
   * AUTHORITATIVE when present: it overrides the op-catalog `mirror` default in the
   * renderer. OPTIONAL — absent/blank/unknown falls back to the existing
   * `slideMirrors` gating, which keeps decks WITHOUT the column byte-identical.
   */
  readonly rightThird?: 'app' | 'image' | 'absent';
}

export interface DemoSlide {
  readonly slideNumber: number;
  /** One or more, in sheet order. */
  readonly rows: readonly SlideRow[];
  readonly op: SlideOp;
}

export interface DemoDeck {
  /** The path as the operator supplied it — used verbatim in error messages. */
  readonly sourcePath: string;
  /** Absolute directory of the .xlsx; images and asset serving resolve here. */
  readonly baseDir: string;
  /** Deck title for the slides window — the .xlsx basename without extension. */
  readonly title: string;
  /** Ascending by `slide #`. */
  readonly slides: readonly DemoSlide[];
  /** Every image across the deck, id-addressable for `/asset/<id>`. */
  readonly assets: readonly SlideImage[];
  /** Non-fatal notes (unknown columns, ignored blank rows). */
  readonly warnings: readonly string[];
  /**
   * The deck's theme, resolved unique-or-agree across the WHOLE deck — stage
   * chrome is a property of the deck, not of a slide. Absent means the LOCKED
   * V4 defaults, unchanged.
   */
  readonly theme?: DeckTheme;
  /** The theme file as typed, for error messages. */
  readonly themeSource?: string;
  /** The theme's logo, registered as a deck asset so it is SERVED, never inlined. */
  readonly logoAsset?: SlideImage;
}

/** One load/validation failure, tied to the sheet row that caused it. */
export interface DeckError {
  /** Absent for whole-file problems (missing sheet, no `slide #` column). */
  readonly sheetRow?: number;
  readonly message: string;
}

/**
 * Thrown by `loadDeck` when a deck is unusable. Carries EVERY error, not the
 * first — the founder fixes one spreadsheet pass, not one error per run. The
 * CLI prints them and exits 2; a partial deck is never rendered.
 */
export class DeckLoadFailure extends Error {
  readonly errors: readonly DeckError[];
  readonly sourcePath: string;

  constructor(sourcePath: string, errors: readonly DeckError[]) {
    super(`${sourcePath}: ${errors.length} problem(s) — ${errors[0]?.message ?? 'unknown'}`);
    this.name = 'DeckLoadFailure';
    this.sourcePath = sourcePath;
    this.errors = errors;
  }
}

/**
 * Render errors the way the founder reads them:
 * `demos/ces-overview.xlsx row 7: "op mode" must be one of live|warm|staged (got "livee")`.
 */
export function formatDeckErrors(sourcePath: string, errors: readonly DeckError[]): string[] {
  return errors.map((e) =>
    e.sheetRow === undefined ? `${sourcePath}: ${e.message}` : `${sourcePath} row ${e.sheetRow}: ${e.message}`,
  );
}

/** Total narration rows across the deck — the round-trip test's shape check. */
export function deckRowCount(deck: DemoDeck): number {
  return deck.slides.reduce((n, s) => n + s.rows.length, 0);
}

/** The dwell a slide gets: its own `duration (sec)`, else the run default. */
export function slideDwellMs(slide: DemoSlide, defaultDwellSec: number): number {
  return (slide.op.durationSec ?? defaultDwellSec) * 1000;
}
