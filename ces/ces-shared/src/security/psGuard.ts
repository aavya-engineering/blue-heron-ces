// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PowerShell injection guards (SEC-1, GAP-CLOSURE-PLAN.md \section 4 G-SEC).
//
// One guard per placeholder context reported by psContext():
//   single \ -> psLiteralBody   (every single-quote-class char doubled; NUL / line breaks refused)
//   double \ -> psDoubleQuotedSafe (blocklist: ` ; | & < > $ ( ) " and smart double quotes, NUL /
//                              line breaks; spaces allowed for display names)
//   bare   \ -> psToken          (typed allowlist: guid, upn, integer, generic)
// renderPs() lexes the template once and substitutes from the recorded positions in one pass,
// so a substituted value can never create a new placeholder.

import { psContext, PS_DOUBLE_QUOTES, PS_SINGLE_QUOTES, type PsPlaceholder } from './psContext.js';

export { psContext, PS_SINGLE_QUOTES, PS_DOUBLE_QUOTES } from './psContext.js';
export type { PsPlaceholder, PsContextKind, PsQuote, PsPlaceholderForm } from './psContext.js';

export type PsGuardErrorCode =
  | 'PS_GUARD_LINE_BREAK'
  | 'PS_GUARD_DOUBLE_BLOCKED'
  | 'PS_GUARD_TOKEN_MISMATCH'
  | 'PS_GUARD_UNKNOWN_KIND'
  | 'PS_GUARD_JSON_UNDEFINED';

export class PsGuardError extends Error {
  readonly code: PsGuardErrorCode;
  /** Placeholder / parameter name, when known. */
  readonly param?: string;
  /** The offending character or rule, never the full value. */
  readonly detail?: string;

  constructor(code: PsGuardErrorCode, message: string, param?: string, detail?: string) {
    super(message);
    this.name = 'PsGuardError';
    this.code = code;
    this.param = param;
    this.detail = detail;
  }
}

export type PsTokenKind = 'guid' | 'upn' | 'integer' | 'generic';

/** NUL and every line terminator (CR, LF, NEL, LS, PS). */
// eslint-disable-next-line no-control-regex
const LINE_BREAK = /[\u0000\r\n\u0085\u2028\u2029]/;
/** Double-quoted blocklist: ` ; | & < > $ ( ) " + smart doubles + NUL/line breaks. */
// eslint-disable-next-line no-control-regex
const DOUBLE_BLOCKED = /[`;|&<>$()"\u201C\u201D\u201E\u0000\r\n\u0085\u2028\u2029]/;

const TOKEN_PATTERNS: Record<PsTokenKind, RegExp> = {
  guid: /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/,
  upn: /^[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/,
  integer: /^-?[0-9]+$/,
  // [A-Za-z0-9._@:/-]+, but not starting with `-` (parameter/switch injection) or `@` (splatting).
  generic: /^[A-Za-z0-9._:/][A-Za-z0-9._@:/-]*$/,
};

const label = (param?: string): string => (param ? `parameter "${param}"` : 'value');

function assertNoLineBreak(s: string, param?: string): void {
  const m = LINE_BREAK.exec(s);
  if (m) {
    throw new PsGuardError(
      'PS_GUARD_LINE_BREAK',
      `PowerShell injection guard: ${label(param)} contains NUL or a line break ` +
        `(U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}) and was rejected.`,
      param,
      m[0],
    );
  }
}

/**
 * Body of a single-quoted PowerShell literal, WITHOUT the surrounding quotes: every
 * single-quote-class char is doubled; NUL and line breaks are refused.
 */
export function psLiteralBody(value: unknown, param?: string): string {
  const s = String(value);
  assertNoLineBreak(s, param);
  let out = '';
  for (const ch of s) out += PS_SINGLE_QUOTES.has(ch) ? ch + ch : ch;
  return out;
}

/** A complete single-quoted PowerShell literal: `'` + psLiteralBody(value) + `'`. */
export function psLiteral(value: unknown, param?: string): string {
  return `'${psLiteralBody(value, param)}'`;
}

/** Typed allowlist for an unquoted (bare) position. Returns the value unchanged or throws. */
export function psToken(value: unknown, kind: PsTokenKind = 'generic', param?: string): string {
  const pattern = TOKEN_PATTERNS[kind];
  if (!pattern) {
    throw new PsGuardError('PS_GUARD_UNKNOWN_KIND', `PowerShell injection guard: unknown token kind "${String(kind)}".`, param, String(kind));
  }
  const s = String(value);
  if (!pattern.test(s)) {
    throw new PsGuardError(
      'PS_GUARD_TOKEN_MISMATCH',
      `PowerShell injection guard: ${label(param)} is not a valid ${kind} token for an unquoted position and was rejected.`,
      param,
      kind,
    );
  }
  return s;
}

/** JSON-encode, then wrap as a single-quoted PowerShell literal. */
export function jsonInPs(obj: unknown, param?: string): string {
  const json = JSON.stringify(obj);
  if (json === undefined) {
    throw new PsGuardError('PS_GUARD_JSON_UNDEFINED', `PowerShell injection guard: ${label(param)} is not JSON-serializable.`, param);
  }
  // JSON.stringify leaves NEL / LS / PS raw; \u escapes are equivalent JSON and pass the guard.
  const escaped = json.replace(/[\u0085\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return psLiteral(escaped, param);
}

/** Value for a double-quoted position: returned unchanged, or throws on a blocked char. */
export function psDoubleQuotedSafe(value: unknown, param?: string): string {
  const s = String(value);
  const m = DOUBLE_BLOCKED.exec(s);
  if (m) {
    throw new PsGuardError(
      'PS_GUARD_DOUBLE_BLOCKED',
      `PowerShell injection guard: ${label(param)} contains ${JSON.stringify(m[0])}, which is not allowed in a ` +
        'double-quoted position (` ; | & < > $ ( ) " smart double quotes, NUL, line breaks).',
      param,
      m[0],
    );
  }
  return s;
}

export interface RenderPsOptions {
  /** Token kind per placeholder name for bare positions; default 'generic'. */
  kinds?: Record<string, PsTokenKind>;
}

function guardFor(ph: PsPlaceholder, value: unknown, opts: RenderPsOptions): string {
  if (ph.context === 'single') {
    if (ph.quote === 'here-single') {
      // No escapes exist inside @'...'@; the only way out is a line break + `'@`.
      const s = String(value);
      assertNoLineBreak(s, ph.name);
      return s;
    }
    return psLiteralBody(value, ph.name);
  }
  if (ph.context === 'double') return psDoubleQuotedSafe(value, ph.name);
  return psToken(value, opts.kinds?.[ph.name] ?? 'generic', ph.name);
}

/**
 * Render a PowerShell template: each placeholder whose name is an own key of `vars` is replaced
 * through the guard for its context; other placeholders are left as written.
 */
export function renderPs(template: string, vars: Record<string, unknown>, opts: RenderPsOptions = {}): string {
  let out = '';
  let last = 0;
  for (const ph of psContext(template)) {
    if (!Object.prototype.hasOwnProperty.call(vars, ph.name)) continue;
    out += template.slice(last, ph.start) + guardFor(ph, vars[ph.name], opts);
    last = ph.end;
  }
  return out + template.slice(last);
}
