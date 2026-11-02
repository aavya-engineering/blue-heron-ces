// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PowerShell template lexer (SEC-1, GAP-CLOSURE-PLAN.md \section 4 G-SEC).
//
// Walks a command template character by character (no regex over the whole template) and
// reports every placeholder with the PowerShell quoting context it sits in, so the caller can
// pick the right guard (psGuard.ts). Placeholder syntax is exactly what Stamper's executing
// resolver (PowerShellAdapter.interpolateVariables) accepts:
//   ${name}  \- "dollar" form
//   {name}   \- "brace" form, only when the `{` is NOT preceded by `$` or a word character
// where name is \w+. `{{name}}` is not a distinct syntax: its inner `{name}` is reported, as
// both existing resolvers would substitute it.
//
// Context rules (strictest wins):
//   'single' \- directly inside a top-level '...' string or @'...'@ here-string
//   'double' \- directly inside a top-level "..." string or @"..."@ here-string
//   'bare'   \- anywhere else: code, comments, $( ) sub-expressions, any nested string, a
//              placeholder right after a backtick escape, an unterminated string, or anything
//              after a construct the lexer cannot classify (the template is "poisoned").
// PowerShell treats the smart quotes as quotes: single = ' U+2018 U+2019 U+201A U+201B,
// double = " U+201C U+201D U+201E. The doubled-quote escape is any member followed by any
// member of the same class.

export type PsContextKind = 'single' | 'double' | 'bare';
export type PsQuote = 'single' | 'double' | 'here-single' | 'here-double' | null;
export type PsPlaceholderForm = 'brace' | 'dollar';

export interface PsPlaceholder {
  /** Variable name (\w+). */
  name: string;
  form: PsPlaceholderForm;
  /** Offset of the first placeholder character in the template. */
  start: number;
  /** Offset one past the last placeholder character. */
  end: number;
  context: PsContextKind;
  /** The enclosing quote construct when context is 'single' or 'double'; null for 'bare'. */
  quote: PsQuote;
}

export const PS_SINGLE_QUOTES: ReadonlySet<string> = new Set(["'", '\u2018', '\u2019', '\u201A', '\u201B']);
export const PS_DOUBLE_QUOTES: ReadonlySet<string> = new Set(['"', '\u201C', '\u201D', '\u201E']);

type FrameKind =
  | 'code'
  | 'sub'
  | 'single'
  | 'double'
  | 'hereSingle'
  | 'hereDouble'
  | 'lineComment'
  | 'blockComment';

interface Frame {
  kind: FrameKind;
  /** Paren depth for 'sub' frames. */
  depth: number;
  closed: boolean;
}

interface Pending {
  ph: PsPlaceholder;
  frames: Frame[];
}

const WORD = /\w/;
/** Characters after which `#` starts a comment (token boundary). */
const COMMENT_PREV = new Set([' ', '\t', '\r', '\n', ';', '|', '&', '(', ')', '{', '}', '[', ']', ',', '=']);

function matchPlaceholder(t: string, i: number): { name: string; form: PsPlaceholderForm; end: number } | null {
  let j: number;
  let form: PsPlaceholderForm;
  if (t[i] === '$' && t[i + 1] === '{') {
    j = i + 2;
    form = 'dollar';
  } else if (t[i] === '{') {
    const prev = i > 0 ? t[i - 1] : '';
    if (prev === '$' || (prev !== '' && WORD.test(prev))) return null;
    j = i + 1;
    form = 'brace';
  } else {
    return null;
  }
  const nameStart = j;
  while (j < t.length && WORD.test(t[j])) j++;
  if (j === nameStart || t[j] !== '}') return null;
  return { name: t.slice(nameStart, j), form, end: j + 1 };
}

/** Index of the char after a here-string header (`@'` + spaces/tabs + EOL), or -1. */
function hereHeaderEnd(t: string, quoteIdx: number): number {
  let j = quoteIdx + 1;
  while (t[j] === ' ' || t[j] === '\t') j++;
  if (t[j] === '\n') return j + 1;
  if (t[j] === '\r' && t[j + 1] === '\n') return j + 2;
  return -1;
}

/**
 * Lex a PowerShell template and return every placeholder with its quoting context,
 * in template order.
 */
export function psContext(template: string): PsPlaceholder[] {
  const t = template;
  const n = t.length;
  const base: Frame = { kind: 'code', depth: 0, closed: true };
  const stack: Frame[] = [base];
  const pending: Pending[] = [];
  let poisoned = false;
  let lastStringEnd = -1;
  let i = 0;

  const top = (): Frame => stack[stack.length - 1];
  const push = (kind: FrameKind, depth = 0): void => {
    stack.push({ kind, depth, closed: false });
  };
  const pop = (): void => {
    const f = stack.pop();
    if (f) f.closed = true;
  };

  const record = (m: { name: string; form: PsPlaceholderForm; end: number }, start: number, forceBare: boolean): void => {
    let context: PsContextKind = 'bare';
    let quote: PsQuote = null;
    if (!forceBare && !poisoned && stack.length === 2) {
      const k = stack[1].kind;
      if (k === 'single') { context = 'single'; quote = 'single'; }
      else if (k === 'hereSingle') { context = 'single'; quote = 'here-single'; }
      else if (k === 'double') { context = 'double'; quote = 'double'; }
      else if (k === 'hereDouble') { context = 'double'; quote = 'here-double'; }
    }
    pending.push({
      ph: { name: m.name, form: m.form, start, end: m.end, context, quote },
      frames: stack.slice(1),
    });
  };

  /** Backtick escape in code / double-quoted text. Returns the next index. */
  const backtick = (at: number): number => {
    const m = matchPlaceholder(t, at + 1);
    if (m) {
      record(m, at + 1, true);
      return m.end;
    }
    return at + 2;
  };

  /**
   * `${...}` that is not a placeholder: skip it opaquely to its `}`. A placeholder inside it is
   * still reported (as bare), so nothing the resolvers would substitute goes unseen.
   * Returns the next index.
   */
  const bracedVar = (at: number): number => {
    let j = at + 2;
    while (j < n) {
      const inner = matchPlaceholder(t, j);
      if (inner) {
        record(inner, j, true);
        j = inner.end;
        continue;
      }
      if (t[j] === '`') { j += 2; continue; }
      if (t[j] === '}') return j + 1;
      j++;
    }
    poisoned = true;
    return n;
  };

  while (i < n) {
    const m = matchPlaceholder(t, i);
    if (m) {
      record(m, i, false);
      i = m.end;
      continue;
    }
    const f = top();
    const c = t[i];
    const next = t[i + 1];

    switch (f.kind) {
      case 'code':
      case 'sub': {
        if (c === '`') { i = backtick(i); break; }
        if (PS_SINGLE_QUOTES.has(c)) { push('single'); i++; break; }
        if (PS_DOUBLE_QUOTES.has(c)) { push('double'); i++; break; }
        if (c === '@' && next !== undefined && (PS_SINGLE_QUOTES.has(next) || PS_DOUBLE_QUOTES.has(next))) {
          const isSingle = PS_SINGLE_QUOTES.has(next);
          const after = hereHeaderEnd(t, i + 1);
          if (after < 0) {
            // `@'` without an end of line is a PowerShell parse error: cannot classify.
            poisoned = true;
            push(isSingle ? 'single' : 'double');
            i += 2;
          } else {
            push(isSingle ? 'hereSingle' : 'hereDouble');
            i = after;
          }
          break;
        }
        if (c === '<' && next === '#') { push('blockComment'); i += 2; break; }
        if (c === '#') {
          const prev = i > 0 ? t[i - 1] : '';
          if (prev === '' || COMMENT_PREV.has(prev) || i === lastStringEnd) {
            push('lineComment');
          } else {
            // `#` inside a bareword: PowerShell's reading is not certain here.
            poisoned = true;
          }
          i++;
          break;
        }
        if (c === '$' && next === '(') {
          if (f.kind === 'sub') f.depth++;
          else push('sub', 1);
          i += 2;
          break;
        }
        if (c === '$' && next === '{') { i = bracedVar(i); break; }
        if (f.kind === 'sub') {
          if (c === '(') f.depth++;
          else if (c === ')') {
            f.depth--;
            if (f.depth === 0) pop();
          }
        }
        i++;
        break;
      }
      case 'single': {
        if (PS_SINGLE_QUOTES.has(c)) {
          if (next !== undefined && PS_SINGLE_QUOTES.has(next)) { i += 2; break; }
          pop();
          i++;
          lastStringEnd = i;
          break;
        }
        i++;
        break;
      }
      case 'double': {
        if (c === '`') { i = backtick(i); break; }
        if (PS_DOUBLE_QUOTES.has(c)) {
          if (next !== undefined && PS_DOUBLE_QUOTES.has(next)) { i += 2; break; }
          pop();
          i++;
          lastStringEnd = i;
          break;
        }
        if (c === '$' && next === '(') { push('sub', 1); i += 2; break; }
        if (c === '$' && next === '{') { i = bracedVar(i); break; }
        i++;
        break;
      }
      case 'hereSingle':
      case 'hereDouble': {
        const quotes = f.kind === 'hereSingle' ? PS_SINGLE_QUOTES : PS_DOUBLE_QUOTES;
        const atLineStart = i > 0 && t[i - 1] === '\n';
        if (atLineStart && quotes.has(c) && next === '@') {
          pop();
          i += 2;
          lastStringEnd = i;
          break;
        }
        if (f.kind === 'hereDouble') {
          if (c === '`') { i = backtick(i); break; }
          if (c === '$' && next === '(') { push('sub', 1); i += 2; break; }
          if (c === '$' && next === '{') { i = bracedVar(i); break; }
        }
        i++;
        break;
      }
      case 'lineComment': {
        if (c === '\n' || c === '\r') { pop(); break; }
        i++;
        break;
      }
      case 'blockComment': {
        if (c === '#' && next === '>') { pop(); i += 2; break; }
        i++;
        break;
      }
    }
  }

  // Anything still open at the end is unterminated: every placeholder inside it is bare.
  return pending.map(({ ph, frames }) =>
    frames.some((fr) => !fr.closed) ? { ...ph, context: 'bare' as const, quote: null } : ph,
  );
}
