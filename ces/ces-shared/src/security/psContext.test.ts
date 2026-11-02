// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { psContext, type PsContextKind, type PsQuote } from './psContext.js';

/** name:context pairs in template order. */
const ctx = (t: string): string[] => psContext(t).map((p) => `${p.name}:${p.context}`);

describe('psContext \- placeholder syntax (matches PowerShellAdapter.interpolateVariables)', () => {
  it('reports {name} and ${name} with their form and offsets', () => {
    const t = "Set-X -A {a} -B '${b}'";
    const out = psContext(t);
    expect(out).toEqual([
      { name: 'a', form: 'brace', start: 9, end: 12, context: 'bare', quote: null },
      { name: 'b', form: 'dollar', start: 17, end: 21, context: 'single', quote: 'single' },
    ]);
    expect(t.slice(out[1].start, out[1].end)).toBe('${b}');
  });

  it('does not report {name} preceded by a word character or $', () => {
    expect(ctx('x{a} ${b}')).toEqual(['b:bare']);
  });

  it('{{name}} reports the inner {name} (no distinct double-brace syntax)', () => {
    expect(ctx("'{{a}}'")).toEqual(['a:single']);
  });

  it('ignores non-word names and empty braces', () => {
    expect(ctx('{a b} {} {a-b} {a.b}')).toEqual([]);
  });

  it('accepts \\w names including digits and underscores', () => {
    expect(ctx("'{user_Id2}'")).toEqual(['user_Id2:single']);
  });
});

describe('psContext \- quoting contexts', () => {
  const cases: Array<[string, string, PsContextKind[], PsQuote[]?]> = [
    ['single-quoted', "Get-X '{a}'", ['single'], ['single']],
    ['double-quoted', 'Get-X "{a}"', ['double'], ['double']],
    ['bare argument', 'Get-X -Id {a}', ['bare']],
    ['doubled quote escape stays single', "'it''s {a}'", ['single']],
    ['single then bare', "'{a}' {b}", ['single', 'bare']],
    ['bare then single then bare', "{a} '{b}' {c}", ['bare', 'single', 'bare']],
    ['single quotes are literal inside double (OData filter)', `-Filter "displayName eq '{a}'"`, ['double']],
    ['double quotes are literal inside single', `'say "{a}"'`, ['single']],
    ['doubled "" escape stays double', '"a ""{b}"" c"', ['double']],
    ['backtick-escaped " stays double', '"a `" {b}"', ['double']],
    ['backtick-escaped quote in code does not open a string', "Write `'{a}", ['bare']],
    ['backtick right before a placeholder in double is bare', '"`{a}"', ['bare']],
    ['backtick right before a placeholder in code is bare', '`{a}', ['bare']],
    ['backtick is literal inside single', "'`{a}'", ['single']],
    ['$( ) in double: inner single is nested => bare; outer double', `"x $(Get-X '{a}') {b}"`, ['bare', 'double']],
    ['$( ) in code: inner placeholders bare, closes on matching paren', "$( (1+2) {a} ) '{b}'", ['bare', 'single']],
    [') inside a string inside $( ) does not close it', `$( ")" {a} ) '{b}'`, ['bare', 'single']],
    ['${env:x} braced variable is skipped in code', "${env:x} '{a}'", ['single']],
    ['${env:x} braced variable is skipped in double', '"${env:x} {a}"', ['double']],
    ['script block quotes are real quotes', "Where-Object { $_.Name -eq '{a}' }", ['single']],
    ['script block body is code', 'if ($x) { New-X -P {a} }', ['bare']],
  ];
  it.each(cases)('%s', (_label, template, contexts, quotes) => {
    const out = psContext(template);
    expect(out.map((p) => p.context)).toEqual(contexts);
    if (quotes) expect(out.map((p) => p.quote)).toEqual(quotes);
  });
});

describe('psContext \- smart quotes are PowerShell quotes', () => {
  it.each([
    ['\u2018{a}\u2019', 'single'],
    ['\u201A{a}\u201B', 'single'],
    ["'{a}\u2019 {b}", 'single'],
    ['\u201C{a}\u201D', 'double'],
    ['\u201E{a}"', 'double'],
  ])('%s', (t, kind) => {
    expect(psContext(t)[0].context).toBe(kind);
  });

  it('a smart quote closes an ASCII-opened single string', () => {
    expect(ctx("'x\u2019 {a}")).toEqual(['a:bare']);
  });

  it('mixed-class doubled single quote is an escape', () => {
    expect(ctx("'\u2019'{a}'")).toEqual(['a:single']);
  });

  it('a smart double quote closes an ASCII-opened double string', () => {
    expect(ctx('"x\u201D {a}')).toEqual(['a:bare']);
  });
});

describe('psContext \- here-strings', () => {
  it("@'...'@ is single (here-single); after it is bare", () => {
    const out = psContext("$s = @'\nline {a}\n'@\n{b}");
    expect(out.map((p) => [p.name, p.context, p.quote])).toEqual([
      ['a', 'single', 'here-single'],
      ['b', 'bare', null],
    ]);
  });

  it('a quote inside a here-single does not close it', () => {
    expect(ctx("@'\nit's {a}\n'@")).toEqual(['a:single']);
  });

  it("'@ not at line start does not close a here-single", () => {
    expect(ctx("@'\nx '@ {a}\n'@ {b}")).toEqual(['a:single', 'b:bare']);
  });

  it('@"..."@ is double (here-double) and tracks $( )', () => {
    const out = psContext('@"\nhi {a} $(Get-X {b})\n"@ {c}');
    expect(out.map((p) => [p.name, p.context, p.quote])).toEqual([
      ['a', 'double', 'here-double'],
      ['b', 'bare', null],
      ['c', 'bare', null],
    ]);
  });

  it('CRLF header and terminator', () => {
    expect(ctx("@'\r\n{a}\r\n'@ {b}")).toEqual(['a:single', 'b:bare']);
  });

  it('header with trailing spaces is still a here-string', () => {
    expect(ctx("@'  \n{a}\n'@")).toEqual(['a:single']);
  });

  it("@' without an end of line poisons the rest of the template", () => {
    expect(ctx("@'x {a}'@ '{b}'")).toEqual(['a:bare', 'b:bare']);
  });

  it('unterminated here-string => bare', () => {
    expect(ctx("@'\n{a}")).toEqual(['a:bare']);
  });
});

describe('psContext \- comments', () => {
  it('apostrophe in a line comment does not open a string', () => {
    expect(ctx("# don't do this\nSet-X {a} '{b}'")).toEqual(['a:bare', 'b:single']);
  });

  it('placeholder inside a line comment is bare', () => {
    expect(ctx("# '{a}'\n'{b}'")).toEqual(['a:bare', 'b:single']);
  });

  it('block comment <# #> hides quotes', () => {
    expect(ctx("<# it's #> '{a}'")).toEqual(['a:single']);
  });

  it('# right after a closing quote starts a comment', () => {
    expect(ctx("'x'#it's\n{a} '{b}'")).toEqual(['a:bare', 'b:single']);
  });

  it('# inside a bareword is ambiguous and poisons the rest', () => {
    expect(ctx("a#b '{a}'")).toEqual(['a:bare']);
  });

  it('# inside a string is not a comment', () => {
    expect(ctx("'#{a}' '{b}'")).toEqual(['a:single', 'b:single']);
  });
});

describe('psContext \- unknown or unterminated state is bare', () => {
  it.each([
    ["'abc {a}", 'unterminated single'],
    ['"abc {a}', 'unterminated double'],
    ['$( {a}', 'unterminated sub-expression'],
    ['"${env:x {a}', 'unterminated braced variable poisons'],
  ])('%s (%s)', (t) => {
    expect(psContext(t).every((p) => p.context === 'bare')).toBe(true);
    expect(psContext(t).length).toBeGreaterThan(0);
  });

  it('placeholders before an unterminated string keep their context', () => {
    expect(ctx("'{a}' '{b}")).toEqual(['a:single', 'b:bare']);
  });

  it('empty template has no placeholders', () => {
    expect(psContext('')).toEqual([]);
  });
});
