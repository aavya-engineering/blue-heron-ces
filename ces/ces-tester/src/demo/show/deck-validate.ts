// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 S1 — validate normalized rows and group them into a `DemoDeck`.
 *
 * Three rules carry the weight here:
 *
 * 1. **Every error is collected, then thrown together.** A demo deck is edited
 *    in Excel; reporting one problem per run would mean one Excel round trip
 *    per typo. `loadDeck` throws a single `DeckLoadFailure` carrying all of
 *    them, and the CLI exits 2 without rendering anything partial (A3).
 * 2. **Errors cite the 1-based SHEET row.** The founder's eye is on Excel's row
 *    gutter; a 0-based array index would be a different number and would send
 *    them to the wrong line.
 * 3. **Op fields resolve by unique-or-agree, never first-wins.** A slide has
 *    one op. Blank cells inherit from the slide's other rows; two rows carrying
 *    *different* non-blank values for the same op field is an error. Silent
 *    first-wins is how a demo ends up running an op the deck did not ask for.
 *
 * ajv validates the row STRUCTURE (`schemas/demo-deck.schema.json`) as a
 * backstop behind the hand-written semantic checks, and only speaks about rows
 * the semantic pass already found clean — otherwise every enum typo would be
 * reported twice, in two different voices.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import {
  CES_TOOLS,
  DEMO_OP_IDS,
  DeckLoadFailure,
  isCesTool,
  isDemoOpId,
  isOpMode,
  MAX_SLIDE_FEATURES,
  OP_MODES,
  type CesTool,
  type DeckError,
  type DemoDeck,
  type DemoOpId,
  type DemoSlide,
  type OpMode,
  type SlideImage,
  type SlideOp,
  type SlideRow,
} from './deck-model.js';
import { COLUMN_LABEL, type NormalizedRow } from './xlsx-loader.js';
import {
  parseParamsCell,
  prepBudgetMs,
  validateParams,
  OP_CATALOG,
  OP_CATALOG_DOC,
  PREP_BUDGET_WARN_MS,
} from './op-catalog.js';
import { parseTheme, type DeckTheme } from './theme.js';

/**
 * A params bag as one canonical, order-independent string. Two rows of a slide
 * writing the same parameters in a different order is not a disagreement.
 */
function canonicalParams(params: Readonly<Record<string, string>>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');
}

const _require = createRequire(import.meta.url);

let compiled: ValidateFunction | undefined;
function rowsValidator(): ValidateFunction {
  if (!compiled) {
    // ajv is CJS; under NodeNext ESM the default-import interop is unreliable,
    // so require() it (the house pattern — see scenarios/scenarioFile.ts).
    const ajvModule = _require('ajv') as { default?: unknown } & Record<string, unknown>;
    const AjvCtor = (ajvModule.default ?? ajvModule) as new (opts: { strict: boolean; allErrors: boolean }) => {
      compile: (schema: unknown) => ValidateFunction;
    };
    // Depth differs between contexts: vitest imports this TS source
    // (src/demo/show -> repo root is ../../../), the CLI runs the compiled file
    // (dist/src/demo/show -> repo root is ../../../../).
    let schema: unknown;
    try {
      schema = _require('../../../schemas/demo-deck.schema.json');
    } catch {
      schema = _require('../../../../schemas/demo-deck.schema.json');
    }
    compiled = new AjvCtor({ strict: true, allErrors: true }).compile(schema);
  }
  return compiled;
}

/** A slide with no `op mode` on any of its rows narrates only. */
export const DEFAULT_OP_MODE: OpMode = 'staged';

export interface ValidateDeckOptions {
  /** Test seam: existence probe for `image` cells. Defaults to `fs.existsSync`. */
  readonly fileExists?: (absPath: string) => boolean;
  /**
   * Test seam: reader for `html` cells, used by the offline lint. Defaults to
   * `fs.readFileSync(p, 'utf8')`. Mirrors `fileExists` so a deck can be
   * validated entirely in memory.
   */
  readonly readText?: (absPath: string) => string;
  /** Op ids this run can dispatch. Defaults to the model's `DEMO_OP_IDS`. */
  readonly knownOpIds?: readonly string[];
}

/**
 * Every `src=` / `href=` an html slide body carries. Assets are served BY ID
 * from a map (`slides-server.ts`), never by path, so a *relative* sub-reference
 * (`<img src="logo.png">`, a local font, an external stylesheet) 404s on stage
 * while `--check` exits 0 — a worse failure mode than a CDN URL, which at least
 * fails visibly offline. Absolute and relative alike are flagged.
 */
const HTML_REF_RE = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;

/** References that need no resolution: inline data, in-document, and `about:`. */
const HTML_REF_OK_RE = /^(data:|#|about:)/i;

/** Up to five offending references, so one bad file cannot flood the console. */
const HTML_LINT_MAX_NAMED = 5;

/**
 * Offline lint for one html slide body. Pure over the document text so the
 * test drives it without a filesystem.
 */
export function externalHtmlRefs(html: string): string[] {
  const found: string[] = [];
  HTML_REF_RE.lastIndex = 0;
  for (let m = HTML_REF_RE.exec(html); m !== null; m = HTML_REF_RE.exec(html)) {
    const value = (m[1] ?? '').trim();
    if (value === '' || HTML_REF_OK_RE.test(value)) continue;
    if (!found.includes(value)) found.push(value);
  }
  return found;
}

export interface ValidateDeckContext extends ValidateDeckOptions {
  /** The path exactly as the operator typed it — quoted in every message. */
  readonly sourcePath: string;
  /** Absolute directory of the .xlsx; images resolve and are fenced here. */
  readonly baseDir: string;
  readonly title: string;
  readonly warnings?: readonly string[];
}

/** Numeric cells arrive as numbers; a text-formatted cell arrives as a string. */
function coerceNumber(value: string | number | null | undefined): number | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 'invalid';
  const n = Number(value.trim());
  return value.trim() !== '' && Number.isFinite(n) ? n : 'invalid';
}

function text(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

/**
 * One `features` cell -> the row's list. Newline-separated, because that is what
 * Alt+Enter produces in Excel and it is the only separator a feature label can
 * never itself contain — commas and semicolons routinely appear inside one.
 * Returns undefined for a blank cell so an absent list stays absent.
 */
export function parseFeatures(value: string | number | null | undefined): readonly string[] | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const items = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return items.length === 0 ? undefined : items;
}

/** `demo art/one.png` -> `demo-art-one.png`, so it is safe in a URL path. */
export function assetIdFor(relPath: string, taken: ReadonlySet<string>): string {
  const base = relPath.replace(/[\\/]+/g, '-').replace(/[^A-Za-z0-9._-]/g, '-');
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${n}-${base}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** One non-blank op-field value, with the row that supplied it. */
interface FieldEntry<T> {
  readonly sheetRow: number;
  readonly raw: string;
  readonly value: T;
}

/**
 * Unique-or-agree: every non-blank value across a slide's rows must be equal.
 * Returns the agreed value, or pushes an error naming BOTH rows so the founder
 * can see the pair that disagrees without hunting.
 */
function agreeOn<T>(
  slideNumber: number,
  label: string,
  entries: readonly FieldEntry<T>[],
  errors: DeckError[],
  equal: (a: T, b: T) => boolean = (a, b) => a === b,
): T | undefined {
  if (entries.length === 0) return undefined;
  const first = entries[0];
  for (const entry of entries.slice(1)) {
    if (!equal(first.value, entry.value)) {
      errors.push({
        sheetRow: entry.sheetRow,
        message:
          `slide ${slideNumber}: "${label}" disagrees across the slide's rows ` +
          `("${first.raw}" on row ${first.sheetRow}, "${entry.raw}" on row ${entry.sheetRow}) — ` +
          'a slide has exactly one op spec, so every non-blank cell must agree',
      });
      return undefined;
    }
  }
  return first.value;
}

function sameTools(a: readonly CesTool[], b: readonly CesTool[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * Validate + group. Throws `DeckLoadFailure` with every problem found; returns
 * a fully-resolved deck otherwise.
 */
export function validateDeck(rows: readonly NormalizedRow[], ctx: ValidateDeckContext): DemoDeck {
  const errors: DeckError[] = [];
  const warnings: string[] = [...(ctx.warnings ?? [])];
  const fileExists = ctx.fileExists ?? ((p: string) => fs.existsSync(p));
  const readText = ctx.readText ?? ((p: string) => fs.readFileSync(p, 'utf8'));
  const knownOpIds = ctx.knownOpIds ?? DEMO_OP_IDS;

  /* ---------------- Pass 1: per-row cell semantics ---------------- */

  interface CheckedRow {
    readonly sheetRow: number;
    readonly slide: number;
    readonly row: SlideRow;
    readonly tools?: FieldEntry<readonly CesTool[]>;
    readonly mode?: FieldEntry<OpMode>;
    readonly opId?: FieldEntry<DemoOpId>;
    readonly durationSec?: FieldEntry<number>;
    readonly image?: FieldEntry<string>;
    readonly html?: FieldEntry<string>;
    /** The parsed cell. Agreement compares the canonical `key=value` rendering. */
    readonly params?: FieldEntry<Record<string, string>>;
  }

  const checked: CheckedRow[] = [];
  /** Every non-blank `theme` cell in the deck. Resolved deck-level, after Pass 3. */
  const themeRefs: FieldEntry<string>[] = [];
  /** The same rows with numeric cells coerced — what ajv actually sees. */
  const coercedRows: Record<string, unknown>[] = [];

  for (const raw of rows) {
    const sheetRow = raw.sheetRow;
    const rowErrorsBefore = errors.length;

    const slideNum = coerceNumber(raw.slide);
    let slide = 0;
    if (slideNum === null) {
      errors.push({ sheetRow, message: `"${COLUMN_LABEL.slide}" is required on every row (this row is blank)` });
    } else if (slideNum === 'invalid' || !Number.isInteger(slideNum) || slideNum < 1) {
      errors.push({
        sheetRow,
        message: `"${COLUMN_LABEL.slide}" must be a whole number 1 or greater (got ${JSON.stringify(raw.slide)})`,
      });
    } else {
      slide = slideNum;
    }

    let tools: FieldEntry<readonly CesTool[]> | undefined;
    const toolsText = text(raw.tools);
    if (toolsText !== undefined) {
      const parts = toolsText.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t !== '');
      const bad = parts.filter((t) => !isCesTool(t));
      if (bad.length > 0) {
        errors.push({
          sheetRow,
          message: `"${COLUMN_LABEL.tools}" must be a comma-separated subset of ${CES_TOOLS.join('|')} (unrecognized: ${bad.map((b) => JSON.stringify(b)).join(', ')})`,
        });
      } else {
        tools = { sheetRow, raw: toolsText, value: parts.filter(isCesTool) };
      }
    }

    let mode: FieldEntry<OpMode> | undefined;
    const modeText = text(raw.opmode)?.toLowerCase();
    if (modeText !== undefined) {
      if (!isOpMode(modeText)) {
        errors.push({
          sheetRow,
          message: `"${COLUMN_LABEL.opmode}" must be one of ${OP_MODES.join('|')} (got ${JSON.stringify(text(raw.opmode))})`,
        });
      } else {
        mode = { sheetRow, raw: modeText, value: modeText };
      }
    }

    let opId: FieldEntry<DemoOpId> | undefined;
    const opText = text(raw.op);
    if (opText !== undefined) {
      if (!isDemoOpId(opText) || !knownOpIds.includes(opText)) {
        errors.push({
          sheetRow,
          message: `"${COLUMN_LABEL.op}" names an unknown op ${JSON.stringify(opText)} (registered: ${knownOpIds.join(', ') || 'none'})`,
        });
      } else {
        opId = { sheetRow, raw: opText, value: opText };
      }
    }

    let durationSec: FieldEntry<number> | undefined;
    const durationNum = coerceNumber(raw.durationsec);
    if (durationNum === 'invalid' || (typeof durationNum === 'number' && durationNum <= 0)) {
      errors.push({
        sheetRow,
        message: `"${COLUMN_LABEL.durationsec}" must be a positive number of seconds, or blank for the run default (got ${JSON.stringify(raw.durationsec)})`,
      });
    } else if (typeof durationNum === 'number') {
      durationSec = { sheetRow, raw: String(durationNum), value: durationNum };
    }

    // `image` and `html` are the same kind of cell — a deck-relative asset path
    // — so they get the SAME fence and the SAME two failure messages. One
    // helper, so the two can never drift into different guarantees.
    const deckAsset = (label: string, cell: string | undefined): FieldEntry<string> | undefined => {
      if (cell === undefined) return undefined;
      const abs = path.resolve(ctx.baseDir, cell);
      const rel = path.relative(ctx.baseDir, abs);
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        errors.push({
          sheetRow,
          message: `"${label}" ${JSON.stringify(cell)} resolves outside the deck directory — images must live under ${ctx.baseDir}`,
        });
        return undefined;
      }
      if (!fileExists(abs)) {
        errors.push({ sheetRow, message: `"${label}" file not found: ${abs}` });
        return undefined;
      }
      return { sheetRow, raw: cell, value: rel.split(path.sep).join('/') };
    };

    const image = deckAsset(COLUMN_LABEL.image, text(raw.image));
    const html = deckAsset(COLUMN_LABEL.html, text(raw.html));
    const themeRef = deckAsset(COLUMN_LABEL.theme, text(raw.theme));
    if (themeRef) themeRefs.push(themeRef);

    let params: FieldEntry<Record<string, string>> | undefined;
    const paramsText = text(raw.params);
    if (paramsText !== undefined) {
      const parsed = parseParamsCell(paramsText);
      // Syntax errors cite the SHEET row — the founder's eye is on Excel's gutter.
      for (const message of parsed.errors) errors.push({ sheetRow, message });
      if (parsed.errors.length === 0) {
        params = { sheetRow, raw: canonicalParams(parsed.params), value: parsed.params };
      }
    }

    const row: SlideRow = {
      sheetRow,
      slideNumber: slide,
      talkTrack: text(raw.talktrack),
      feature: text(raw.feature),
      func: text(raw.function),
      benefit: text(raw.benefit),
      differentiator: text(raw.differentiator),
      features: parseFeatures(raw.features),
      // Reserved presenter columns: free text, per-row, no rules.
      show: text(raw.show),
      watchouts: text(raw.watchouts),
    };

    if (errors.length === rowErrorsBefore) {
      checked.push({ sheetRow, slide, row, tools, mode, opId, durationSec, image, html, params });
      // ajv only speaks about rows the semantic pass found clean, so a single
      // typo never produces two differently-worded complaints.
      const coerced: Record<string, unknown> = { sheetRow, slide };
      for (const key of ['talktrack', 'feature', 'function', 'benefit', 'differentiator', 'tools', 'opmode', 'op', 'image', 'html', 'params', 'theme', 'show', 'watchouts', 'features'] as const) {
        if (key in raw) coerced[key] = (raw as unknown as Record<string, unknown>)[key] ?? null;
      }
      if ('durationsec' in raw) coerced.durationsec = typeof durationNum === 'number' ? durationNum : null;
      coercedRows.push(coerced);
    }
  }

  /* ---------------- Pass 2: ajv structural backstop ---------------- */

  const validate = rowsValidator();
  // Validated through a separate `unknown` binding: ajv's `data is T` guard
  // would otherwise narrow `coercedRows` itself to `never` in the failure arm.
  const payload: unknown = coercedRows;
  if (!validate(payload)) {
    for (const err of validate.errors ?? []) {
      const index = Number(/^\/(\d+)/.exec(err.instancePath ?? '')?.[1] ?? NaN);
      const sheetRow = Number.isInteger(index) ? (coercedRows[index]?.sheetRow as number | undefined) : undefined;
      errors.push({ sheetRow, message: `schema: ${err.instancePath || '(root)'} ${err.message ?? 'is invalid'}` });
    }
  }

  /* ---------------- Pass 3: group by slide #, resolve the op ---------------- */

  const bySlide = new Map<number, CheckedRow[]>();
  for (const c of checked) {
    const list = bySlide.get(c.slide);
    if (list) list.push(c);
    else bySlide.set(c.slide, [c]);
  }

  const assets: SlideImage[] = [];
  const takenIds = new Set<string>();
  const slides: DemoSlide[] = [];

  for (const slideNumber of [...bySlide.keys()].sort((a, b) => a - b)) {
    const group = bySlide.get(slideNumber)!;
    const tools = agreeOn(slideNumber, COLUMN_LABEL.tools, group.flatMap((g) => (g.tools ? [g.tools] : [])), errors, sameTools);
    const mode = agreeOn(slideNumber, COLUMN_LABEL.opmode, group.flatMap((g) => (g.mode ? [g.mode] : [])), errors);
    const opId = agreeOn(slideNumber, COLUMN_LABEL.op, group.flatMap((g) => (g.opId ? [g.opId] : [])), errors);
    const durationSec = agreeOn(slideNumber, COLUMN_LABEL.durationsec, group.flatMap((g) => (g.durationSec ? [g.durationSec] : [])), errors);
    const imageRel = agreeOn(slideNumber, COLUMN_LABEL.image, group.flatMap((g) => (g.image ? [g.image] : [])), errors);
    const htmlRel = agreeOn(slideNumber, COLUMN_LABEL.html, group.flatMap((g) => (g.html ? [g.html] : [])), errors);

    const mintAsset = (rel: string): SlideImage => {
      const id = assetIdFor(rel, takenIds);
      takenIds.add(id);
      const asset: SlideImage = { id, rawValue: rel, absPath: path.resolve(ctx.baseDir, rel) };
      assets.push(asset);
      return asset;
    };

    let html: SlideImage | undefined;
    if (htmlRel !== undefined) {
      html = mintAsset(htmlRel);

      // Offline lint. `--check` passing while the stage 404s is the failure this
      // exists to prevent, so a reference that cannot resolve is named here even
      // though the deck loads fine.
      let body: string | undefined;
      try {
        body = readText(html.absPath);
      } catch (err) {
        warnings.push(
          `slide ${slideNumber}: could not read "${COLUMN_LABEL.html}" ${htmlRel} for the offline check ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
      }
      if (body !== undefined) {
        const external = externalHtmlRefs(body);
        if (external.length > 0) {
          const named = external.slice(0, HTML_LINT_MAX_NAMED).join(', ');
          const more = external.length > HTML_LINT_MAX_NAMED ? ` (+${external.length - HTML_LINT_MAX_NAMED} more)` : '';
          warnings.push(
            `slide ${slideNumber}: "${COLUMN_LABEL.html}" ${htmlRel} references ${external.length} asset(s) it does not inline ` +
              `— ${named}${more}. Self-contained decks must inline every asset as a \`data:\` URI; ` +
              '`/asset/<id>` serves by id, so relative paths cannot resolve.',
          );
        }
      }
    }

    // Precedence: one body, decided at load time. The renderer never chooses.
    const images: SlideImage[] = [];
    if (imageRel !== undefined) {
      if (html !== undefined) {
        warnings.push(
          `slide ${slideNumber}: both "${COLUMN_LABEL.html}" (${htmlRel}) and "${COLUMN_LABEL.image}" (${imageRel}) are set ` +
            '— html wins; the image is not rendered',
        );
      } else {
        images.push(mintAsset(imageRel));
      }
    }

    // The display cap is a SLIDE budget, not a cell one: two rows carrying four
    // features each overflow the card just as surely as one row carrying eight.
    // Non-fatal by design — a deck that refuses to open ten minutes before a
    // demo is worse than a deck that shows a short list.
    const featureCount = group.reduce((n, g) => n + (g.row.features?.length ?? 0), 0);
    if (featureCount > MAX_SLIDE_FEATURES) {
      warnings.push(
        `slide ${slideNumber}: ${featureCount} "${COLUMN_LABEL.features}" across its rows — ` +
          `only the first ${MAX_SLIDE_FEATURES} are displayed`,
      );
    }

    // Params resolve unique-or-agree like every other op field, compared on the
    // canonical sorted `key=value` rendering so cell ORDER never counts as
    // disagreement.
    const declaredParams = agreeOn(
      slideNumber,
      COLUMN_LABEL.params,
      group.flatMap((g) => (g.params ? [g.params] : [])),
      errors,
      (a, b) => canonicalParams(a) === canonicalParams(b),
    );

    let params: Readonly<Record<string, string | number | boolean>> | undefined;
    if (declaredParams !== undefined && opId === undefined) {
      errors.push({
        sheetRow: group.find((g) => g.params)?.sheetRow,
        message:
          `slide ${slideNumber}: "${COLUMN_LABEL.params}" is set but the slide names no "${COLUMN_LABEL.op}" — ` +
          `parameters belong to an op; see ${OP_CATALOG_DOC}`,
      });
    } else if (opId !== undefined) {
      // Defaults are filled in even when the author wrote no params cell, so an
      // op always reads a complete bag.
      const checkedParams = validateParams(opId, declaredParams ?? {});
      for (const message of checkedParams.errors) {
        errors.push({ sheetRow: group.find((g) => g.params)?.sheetRow, message: `slide ${slideNumber}: ${message}` });
      }
      if (checkedParams.errors.length === 0 && Object.keys(checkedParams.resolved).length > 0) {
        params = checkedParams.resolved;
      }
    }

    const resolvedMode = mode ?? DEFAULT_OP_MODE;
    // GP-DEMO-4 Slice 2B — the op's DECLARED mode must be one the catalog lists.
    // This is a general loader improvement (not just for `simstack-destroy`): a
    // deck naming a mode the op does not support (e.g. `warm` on a re-assess or a
    // teardown) fails at load with a catalog error, in `--check`, rather than
    // doing the wrong thing on stage. Checked against the DECLARED mode, so it
    // fires even though `--check` would later force `staged` at run time.
    if (opId !== undefined && !OP_CATALOG[opId].modes.includes(resolvedMode)) {
      errors.push({
        sheetRow: mode ? group.find((g) => g.mode)?.sheetRow : undefined,
        message:
          `slide ${slideNumber}: op "${opId}" does not support "${COLUMN_LABEL.opmode}" ${resolvedMode} ` +
          `(catalog modes: ${OP_CATALOG[opId].modes.join('|')}); see ${OP_CATALOG_DOC}`,
      });
    }
    if (opId !== undefined && resolvedMode === 'staged') {
      warnings.push(
        `slide ${slideNumber}: op "${opId}" is declared but "${COLUMN_LABEL.opmode}" is ${resolvedMode} — the op will be replayed, not driven`,
      );
    }

    const op: SlideOp = {
      mode: resolvedMode,
      opId,
      tools: tools ?? [],
      durationSec,
      images,
      html,
      params,
      // Stamp the in-slide app mirror mode (T1.5) from the catalog at LOAD time,
      // so `--check` and the live render read the same value. A slide that names
      // no op surfaces nothing, so it is `none`.
      mirror: opId !== undefined ? OP_CATALOG[opId].mirror : 'none',
      // Stamp WHICH screencast source a theatrical mirror streams (GP-DEMO-5
      // streamgui), the same way `mirror` is stamped. Op-less slides default to
      // `pane`; only a `theatrical` slide consults it (`slide-render.ts`).
      mirrorSource: opId !== undefined ? OP_CATALOG[opId].mirrorSource : 'pane',
    };
    slides.push({ slideNumber, rows: group.map((g) => g.row), op });
  }

  /* --------- Deck-level: the warm-ordering hazard, as a mechanism --------- */

  // `stamper-execute` takes the ~5-minute `execute-only` fast path only when the
  // backstage page already connected and translated — which a warm
  // `stamper-translate` on an EARLIER slide is what provides. Without it the op
  // self-heals by running the full flow, which is legal and real but costs the
  // operator ~12 minutes of prep instead of ~7. A WARNING, not an error: the
  // self-heal path works, it is just expensive, and a deck that refuses to open
  // is worse than a deck that opens slowly.
  const warmSlide = (opId: DemoOpId): number | undefined =>
    slides.find((s) => s.op.opId === opId && s.op.mode === 'warm')?.slideNumber;
  const warmExecute = warmSlide('stamper-execute');
  if (warmExecute !== undefined) {
    const warmTranslate = warmSlide('stamper-translate');
    if (warmTranslate === undefined || warmTranslate >= warmExecute) {
      warnings.push(
        `slide ${warmExecute}: warm "stamper-execute" with no warm "stamper-translate" on an earlier slide — ` +
          'it will run the full connect/assess/translate/execute flow (~12 min of prep instead of ~7). ' +
          'Add a warm "stamper-translate" earlier in the deck to take the fast path.',
      );
    }
  }

  /* ------- Deck-level: the theme. Stage chrome belongs to the DECK ------- */

  let theme: DeckTheme | undefined;
  let themeSource: string | undefined;
  let logoAsset: SlideImage | undefined;

  const distinctThemes = [...new Set(themeRefs.map((t) => t.value))];
  if (distinctThemes.length > 1) {
    errors.push({
      sheetRow: themeRefs.find((t) => t.value === distinctThemes[1])?.sheetRow,
      message:
        `"${COLUMN_LABEL.theme}" names ${distinctThemes.length} different files across the deck ` +
        `(${distinctThemes.join(', ')}) — stage chrome is a property of the DECK, so there is exactly one`,
    });
  } else if (distinctThemes.length === 1) {
    themeSource = distinctThemes[0];
    const first = themeRefs[0];
    const abs = path.resolve(ctx.baseDir, themeSource);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(readText(abs));
    } catch (err) {
      errors.push({
        sheetRow: first.sheetRow,
        message: `"${COLUMN_LABEL.theme}" ${themeSource} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      parsedJson = undefined;
    }
    if (parsedJson !== undefined) {
      const result = parseTheme(parsedJson, { file: themeSource });
      for (const message of result.errors) errors.push({ sheetRow: first.sheetRow, message });
      theme = result.theme;

      if (theme?.logo !== undefined) {
        // Same fence as every other deck-relative path.
        const logoAbs = path.resolve(ctx.baseDir, theme.logo);
        const rel = path.relative(ctx.baseDir, logoAbs);
        if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
          errors.push({
            sheetRow: first.sheetRow,
            message: `theme ${themeSource}: "logo" ${JSON.stringify(theme.logo)} resolves outside the deck directory`,
          });
        } else if (!fileExists(logoAbs)) {
          errors.push({ sheetRow: first.sheetRow, message: `theme ${themeSource}: "logo" file not found: ${logoAbs}` });
        } else {
          // SERVED, never inlined. An <img>-referenced SVG cannot execute
          // script, which removes the whole sanitization problem rather than
          // trying to out-regex `onload=`, `<foreignObject>` and
          // `xlink:href="javascript:"` inside the shell page.
          const relPosix = rel.split(path.sep).join('/');
          const id = assetIdFor(relPosix, takenIds);
          takenIds.add(id);
          logoAsset = { id, rawValue: relPosix, absPath: logoAbs };
          assets.push(logoAsset);
        }
      }
    }
  }

  // The prep budget: warm ops fire during prep, IN DECK ORDER, through one
  // serialization queue — so this is a sum, and it is wall time the presenter
  // commits to before slide 1 ever appears. The mechanized general case of the
  // warm-ordering warning above; both are kept, because they say different
  // things (that one names a fixable ordering, this one names the total).
  const warmOpIds = slides
    .filter((s) => s.op.mode === 'warm' && s.op.opId !== undefined)
    .map((s) => s.op.opId!);
  const budgetMs = prepBudgetMs(warmOpIds);
  if (budgetMs > PREP_BUDGET_WARN_MS) {
    warnings.push(
      `prep budget: this deck's ${warmOpIds.length} warm op(s) take about ${Math.round(budgetMs / 1000)}s ` +
        `(${(budgetMs / 60_000).toFixed(1)} min) before slide 1 — over the ${Math.round(PREP_BUDGET_WARN_MS / 1000)}s guideline. ` +
        `Contributors: ${warmOpIds.join(', ')}. See ${OP_CATALOG_DOC}.`,
    );
  }

  if (errors.length > 0) throw new DeckLoadFailure(ctx.sourcePath, errors);
  if (slides.length === 0) throw new DeckLoadFailure(ctx.sourcePath, [{ message: 'no slides — every data row was blank' }]);

  return {
    sourcePath: ctx.sourcePath,
    baseDir: ctx.baseDir,
    title: ctx.title,
    slides,
    assets,
    warnings,
    theme,
    themeSource,
    logoAsset,
  };
}
