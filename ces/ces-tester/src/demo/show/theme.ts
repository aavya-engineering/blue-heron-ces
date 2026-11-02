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
 * A small JSON file a deck names, applied by the presenter shell, so stage
 * chrome can match a story's brand **without strategy touching the renderer**.
 * The shell already reads CSS variables off `:root`; a theme redefines a
 * whitelisted subset of them.
 *
 * Three rules, and each of them is the reason this file exists rather than a
 * `<style>` cell in the spreadsheet:
 *
 * 1. **A token whitelist, not free CSS.** A deck may set known token names with
 *    validated values and nothing else. Arbitrary CSS in the shell page can
 *    reach every element the runner owns — the dwell bar, the hold ladder, the
 *    exit overlay — and a demo whose chrome has been accidentally restyled to
 *    invisible fails silently, on stage.
 * 2. **Values are screened for anything that could ESCAPE the declaration.** A
 *    value containing `;`, `}`, `{`, `@`, `url(` or a comment opener can end the
 *    declaration it sits in and start a new rule. Rejected outright rather than
 *    escaped, because escaping CSS correctly is a losing game.
 * 3. **The logo is SERVED, never inlined.** See `parseTheme`'s `logo` handling
 *    and the note in `deck-validate.ts`.
 *
 * This is a DECLARATION-LAYER module: it imports nothing. `--check` validates a
 * theme with no browser and no renderer.
 */

/**
 * The tokens a theme may set — the V4 palette's own variable names.
 * Deliberately does NOT include the motion tokens (`--ease-*`, `--slide-in`,
 * `--frag`, `--pill`): timing changes are how a deck accidentally breaks the
 * reduced-motion answers at the foot of the sheet.
 */
export const THEME_TOKENS: readonly string[] = [
  'navy',
  'navy-deep',
  'navy-mid',
  'gold',
  't1',
  't2',
  't3',
  't4',
  'pass',
  'warn',
  'hair',
  'hair-soft',
  'kbd-line',
  'font-sans',
  // NOTE: no `font-mono`. The plan listed one, but the V4 sheet has no
  // monospace element for it to reach — `kbd` inherits the body face — so the
  // token would be advertised and do nothing. A whitelist that lies about what
  // it can change is worse than a shorter whitelist.
];

/** The tokens that take a font-family list rather than a colour. */
const FONT_TOKENS = new Set(['font-sans']);

/**
 * Anything that could terminate the declaration or pull in an external
 * resource. Screened, not escaped — escaping CSS correctly is a losing game and
 * a theme has no legitimate need for any of these.
 */
const FORBIDDEN_IN_VALUE = /[;{}@]|url\(|\/\*|<|>/;

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, and the rgb()/rgba() functional forms. */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR = /^rgba?\(\s*[\d.]+%?\s*(?:[,\s]\s*[\d.]+%?\s*){2}(?:[,/]\s*[\d.]+%?\s*)?\)$/i;

/** A font-family list: names, quoted names and commas. Nothing exotic. */
const FONT_LIST = /^[A-Za-z0-9\s,'"._-]+$/;

export interface DeckTheme {
  readonly tokens: Readonly<Record<string, string>>;
  /** Deck-relative path to an `.svg`, registered as an asset and served by id. */
  readonly logo?: string;
}

/**
 * Parse and validate a theme file's already-JSON-parsed contents. Pure; every
 * error names the file so a deck with two themes reports which one is wrong.
 */
export function parseTheme(json: unknown, ctx: { file: string }): { theme?: DeckTheme; errors: string[] } {
  const errors: string[] = [];
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { errors: [`theme ${ctx.file}: must be a JSON object with a "tokens" object`] };
  }

  const raw = json as Record<string, unknown>;
  const known = new Set(['tokens', 'logo']);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      errors.push(`theme ${ctx.file}: unknown key "${key}" (supported: tokens, logo)`);
    }
  }

  const tokens: Record<string, string> = {};
  const rawTokens = raw.tokens;
  if (rawTokens === undefined) {
    errors.push(`theme ${ctx.file}: missing "tokens"`);
  } else if (rawTokens === null || typeof rawTokens !== 'object' || Array.isArray(rawTokens)) {
    errors.push(`theme ${ctx.file}: "tokens" must be an object of token -> value`);
  } else {
    for (const [key, value] of Object.entries(rawTokens as Record<string, unknown>)) {
      if (!THEME_TOKENS.includes(key)) {
        errors.push(`theme ${ctx.file}: unknown token "${key}" (supported: ${THEME_TOKENS.join(', ')})`);
        continue;
      }
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(`theme ${ctx.file}: token "${key}" must be a non-empty string`);
        continue;
      }
      const text = value.trim();
      if (FORBIDDEN_IN_VALUE.test(text)) {
        errors.push(
          `theme ${ctx.file}: token "${key}" value ${JSON.stringify(text)} contains one of ; { } @ url( /* < > — ` +
            'a theme sets one value, it does not write CSS',
        );
        continue;
      }
      const ok = FONT_TOKENS.has(key)
        ? FONT_LIST.test(text)
        : HEX_COLOR.test(text) || RGB_COLOR.test(text);
      if (!ok) {
        errors.push(
          FONT_TOKENS.has(key)
            ? `theme ${ctx.file}: token "${key}" must be a font-family list (got ${JSON.stringify(text)})`
            : `theme ${ctx.file}: token "${key}" must be #rgb, #rrggbb, #rrggbbaa, rgb() or rgba() (got ${JSON.stringify(text)})`,
        );
        continue;
      }
      tokens[key] = text;
    }
  }

  let logo: string | undefined;
  if (raw.logo !== undefined) {
    if (typeof raw.logo !== 'string' || raw.logo.trim() === '') {
      errors.push(`theme ${ctx.file}: "logo" must be a non-empty path string`);
    } else if (!raw.logo.trim().toLowerCase().endsWith('.svg')) {
      // An <img>-referenced SVG cannot execute script, which is what makes
      // "serve it" safe where "inline it" would not be. Other formats are not
      // refused for safety; they are refused because the mark is a vector slot.
      errors.push(`theme ${ctx.file}: "logo" must be an .svg (got ${JSON.stringify(raw.logo)})`);
    } else {
      logo = raw.logo.trim();
    }
  }

  if (errors.length > 0) return { errors };
  return { theme: { tokens, logo }, errors };
}

/**
 * `:root{--navy:#…;}` — or `''` when there is nothing to say. Emitted AFTER
 * `SHOW_CSS`, so the theme wins by cascade order with no `!important`.
 */
export function themeCss(theme: DeckTheme | undefined): string {
  if (!theme) return '';
  const declarations = Object.keys(theme.tokens)
    .sort()
    .map((k) => `--${k}:${theme.tokens[k]};`)
    .join('');
  return declarations === '' ? '' : `:root{${declarations}}`;
}
