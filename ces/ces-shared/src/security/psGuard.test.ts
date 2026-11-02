// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import {
  PsGuardError,
  psLiteral,
  psLiteralBody,
  psToken,
  jsonInPs,
  psDoubleQuotedSafe,
  renderPs,
  type PsTokenKind,
} from './psGuard.js';

// ---------------------------------------------------------------------------------------------
// Independent PowerShell single-quoted string reader (does NOT use psContext): from the opening
// quote, apply PowerShell's rule (any single-quote-class char followed by another is an escaped
// quote; a lone one closes) and return where the string closes and its decoded value.
// ---------------------------------------------------------------------------------------------
const SQ = ["'", '\u2018', '\u2019', '\u201A', '\u201B'];
function readSingle(s: string, open: number): { close: number; body: string } {
  expect(SQ).toContain(s[open]);
  let body = '';
  let i = open + 1;
  while (i < s.length) {
    if (SQ.includes(s[i])) {
      if (i + 1 < s.length && SQ.includes(s[i + 1])) {
        body += s[i];
        i += 2;
        continue;
      }
      return { close: i, body };
    }
    body += s[i];
    i++;
  }
  return { close: -1, body };
}

/** The double-quoted blocklist, restated independently for the V74 precondition. */
// eslint-disable-next-line no-control-regex
const DOUBLE_REFUSED = /[`;|&<>$()"\u201C\u201D\u201E\u0000\r\n\u0085\u2028\u2029]/;

// Breakout payloads with no line break: must stay inside a single-quoted literal.
const PAYLOADS_INLINE: string[] = [
  "'; Remove-MgUser x; '",
  "x'; Remove-MgUser -UserId admin@contoso.us -Confirm:$false; '",
  '"+(Remove-MgUser x)+"',
  '"; Remove-MgUser x; "',
  '$(calc)',
  '$(Remove-MgUser x)',
  '${env:x}',
  '${env:USERPROFILE}',
  '$env:x',
  '$true',
  '`$(calc)',
  'x`; calc',
  '`"; calc; `"',
  "`'; calc; `'",
  '\u2018; Remove-MgUser x; \u2018',
  '\u2019; Remove-MgUser x; \u2019',
  '\u201A; calc; \u201B',
  '\u201C+(calc)+\u201D',
  '\u201D; calc; \u201C',
  '\u201E; calc',
  "'\u2018\u2019\u2019; calc; \u2018",
  'x | Remove-MgUser',
  'x & calc',
  'x && calc',
  'x || calc',
  'x > C:\\out.txt',
  'x < C:\\in.txt',
  'x 2>&1',
  '(calc)',
  'x) ; calc ; (',
  '@(calc)',
  "''; calc; ''",
  "'''; calc #",
  "'+(calc)+'",
  "' -Force; '",
  '$null = calc',
  '"@; calc',
  "'@; calc",
  'x;calc',
  "[System.Diagnostics.Process]::Start('calc')",
  "& 'calc.exe'",
  '. { calc };',
  '--% ; calc',
  '<# x #> calc;',
  '-Filter "x"',
  "O'Brien; calc",
  "') | ForEach-Object { calc } #",
];

// Payloads carrying NUL or a line terminator: rejected in every context.
const PAYLOADS_LINEBREAK: string[] = [
  'x\nRemove-MgUser y',
  'x\r\nRemove-MgUser y',
  'x\rcalc',
  'x\u0000calc',
  "x\n'@\ncalc\n@'",
  'x\n"@\ncalc',
  'x\u2028calc',
  'x\u0085calc',
];

const ALL = [...PAYLOADS_INLINE, ...PAYLOADS_LINEBREAK];
const KINDS: PsTokenKind[] = ['generic', 'guid', 'upn', 'integer'];

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PsGuardError);
    return (e as PsGuardError).code;
  }
  return undefined;
};

describe('breakout payload table (V74 precondition)', () => {
  it('has 40+ payloads', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(40);
  });
  it.each(ALL)('payload %j contains a char the double-quoted blocklist refuses', (p) => {
    expect(DOUBLE_REFUSED.test(p)).toBe(true);
  });
});

describe('single context: the payload never closes the literal', () => {
  const templates = [
    "Set-MgUser -UserId 'PRE-{v} SUF' -AccountEnabled:$false",
    "Set-MgUser -UserId '${v}' -AccountEnabled:$false",
    "Get-X -Name '{v}{v}' | Out-Null",
    'Get-X -Name \u2018{v}\u2019; Get-Y',
  ];
  for (const template of templates) {
    it.each(PAYLOADS_INLINE)(`${template} <- %j`, (payload) => {
      const out = renderPs(template, { v: payload });
      const open = [...template].findIndex((c) => SQ.includes(c));
      const tplClose = readSingle(template, open).close;
      const { close, body } = readSingle(out, open);
      // The literal closes exactly where the template's own closing quote landed.
      expect(close).toBe(out.length - (template.length - tplClose));
      const tplBody = readSingle(template, open).body;
      const ph = template.includes('${v}') ? '${v}' : '{v}';
      expect(body).toBe(tplBody.split(ph).join(payload));
      // The text after the literal is the template's, untouched.
      expect(out.slice(close + 1)).toBe(template.slice(tplClose + 1));
    });
  }

  it.each(PAYLOADS_INLINE)('psLiteral(%j) is one literal spanning the whole output', (payload) => {
    const out = psLiteral(payload);
    const { close, body } = readSingle(out, 0);
    expect(close).toBe(out.length - 1);
    expect(body).toBe(payload);
  });

  it.each(PAYLOADS_LINEBREAK)('single context rejects %j', (payload) => {
    expect(codeOf(() => renderPs("Get-X '{v}'", { v: payload }))).toBe('PS_GUARD_LINE_BREAK');
    expect(codeOf(() => psLiteral(payload))).toBe('PS_GUARD_LINE_BREAK');
  });
});

describe('double context rejects every payload', () => {
  it.each(ALL)('%j', (payload) => {
    expect(codeOf(() => renderPs('Write-Output "Hello {v} there"', { v: payload }))).toBe('PS_GUARD_DOUBLE_BLOCKED');
    expect(codeOf(() => renderPs('@"\n{v}\n"@', { v: payload }))).toBe('PS_GUARD_DOUBLE_BLOCKED');
    expect(codeOf(() => psDoubleQuotedSafe(payload))).toBe('PS_GUARD_DOUBLE_BLOCKED');
  });
});

describe('bare context rejects every payload, for every kind', () => {
  it.each(ALL)('%j', (payload) => {
    for (const kind of KINDS) {
      expect(codeOf(() => renderPs('Get-MgUser -UserId {v}', { v: payload }, { kinds: { v: kind } }))).toBe(
        'PS_GUARD_TOKEN_MISMATCH',
      );
      expect(codeOf(() => psToken(payload, kind))).toBe('PS_GUARD_TOKEN_MISMATCH');
    }
    // Nested ($( ) / string-in-sub-expression) positions are bare too.
    expect(codeOf(() => renderPs("$(Get-X '{v}')", { v: payload }))).toBe('PS_GUARD_TOKEN_MISMATCH');
  });
});

describe('legitimate values still render', () => {
  it('display names with spaces and apostrophes in single context', () => {
    expect(renderPs("New-X -DisplayName '{n}'", { n: "CES Block O'Brien Sign-ins" })).toBe(
      "New-X -DisplayName 'CES Block O''Brien Sign-ins'",
    );
  });

  it('smart apostrophes are doubled with themselves', () => {
    expect(psLiteralBody('O\u2019Brien')).toBe('O\u2019\u2019Brien');
  });

  it('display names with spaces in double context', () => {
    expect(renderPs('Write-Host "Policy {n} applied"', { n: "CES Block Legacy Auth - O'Brien" })).toBe(
      "Write-Host \"Policy CES Block Legacy Auth - O'Brien applied\"",
    );
  });

  it('here-single keeps the value verbatim (no escapes exist there)', () => {
    expect(renderPs("@'\nName: {n}\n'@", { n: "O'Brien" })).toBe("@'\nName: O'Brien\n'@");
    expect(codeOf(() => renderPs("@'\n{n}\n'@", { n: "x\n'@" }))).toBe('PS_GUARD_LINE_BREAK');
  });

  it.each<[PsTokenKind, string]>([
    ['guid', '3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    ['upn', 'alex.ward@contoso.onmicrosoft.us'],
    ['upn', 'svc_ces-01@fabrikam.us'],
    ['integer', '42'],
    ['integer', '-1'],
    ['generic', 'rg-ces-prod'],
    ['generic', 'https://graph.microsoft.us/v1.0'],
    ['generic', 'a.b:c/d@e'],
    ['generic', '10'],
  ])('psToken accepts %s %s', (kind, value) => {
    expect(psToken(value, kind)).toBe(value);
    expect(renderPs('Get-X -P {v}', { v: value }, { kinds: { v: kind } })).toBe(`Get-X -P ${value}`);
  });

  it('numbers and booleans stringify', () => {
    expect(renderPs('Set-X -Days {d} -On:{b}', { d: 30, b: true }, { kinds: { d: 'integer' } })).toBe(
      'Set-X -Days 30 -On:true',
    );
  });
});

describe('psToken edge rules', () => {
  it.each(['-Force', '-WhatIf:x', '@splat', '', ' ', 'a b', 'a\\b', 'a,b', 'a+b', 'a=b', 'a#b', 'a*b', 'a%b'])(
    'generic rejects %j',
    (v) => {
      expect(codeOf(() => psToken(v))).toBe('PS_GUARD_TOKEN_MISMATCH');
    },
  );

  it.each([
    ['guid', '3fa85f64-5717-4562-b3fc-2c963f66afa'],
    ['guid', '{3fa85f64-5717-4562-b3fc-2c963f66afa6}'],
    ['upn', 'alex'],
    ['upn', '-alex@contoso.us'],
    ['upn', 'alex@contoso'],
    ['integer', '1.5'],
    ['integer', '0x10'],
  ] as Array<[PsTokenKind, string]>)('%s rejects %j', (kind, v) => {
    expect(codeOf(() => psToken(v, kind))).toBe('PS_GUARD_TOKEN_MISMATCH');
  });

  it('unknown kind throws a typed error', () => {
    expect(codeOf(() => psToken('x', 'nope' as PsTokenKind))).toBe('PS_GUARD_UNKNOWN_KIND');
  });

  it('errors carry the parameter name but not the value', () => {
    try {
      renderPs('Get-X {userId}', { userId: 'x; calc' });
      expect.unreachable();
    } catch (e) {
      const err = e as PsGuardError;
      expect(err.param).toBe('userId');
      expect(err.message).toContain('userId');
      expect(err.message).not.toContain('calc');
    }
  });
});

describe('jsonInPs', () => {
  it.each(ALL)('round-trips an object holding %j inside one literal', (payload) => {
    const obj = { displayName: payload, nested: { list: [payload, 1, true, null] } };
    const out = jsonInPs(obj);
    const { close, body } = readSingle(out, 0);
    expect(close).toBe(out.length - 1);
    expect(JSON.parse(body)).toEqual(obj);
  });

  it('escapes U+2028 / U+2029 / U+0085 instead of rejecting them', () => {
    const out = jsonInPs({ a: 'x\u2028y\u2029z\u0085' });
    expect(out).toBe("'{\"a\":\"x\\u2028y\\u2029z\\u0085\"}'");
  });

  it('undefined throws a typed error', () => {
    expect(codeOf(() => jsonInPs(undefined))).toBe('PS_GUARD_JSON_UNDEFINED');
  });
});

describe('renderPs substitution semantics', () => {
  it('leaves placeholders with no variable untouched', () => {
    expect(renderPs("Get-X '{a}' {b}", { a: 'v' })).toBe("Get-X 'v' {b}");
  });

  it('single pass: a value cannot introduce a new placeholder', () => {
    expect(renderPs("'{a}' '{b}'", { a: '{b}', b: 'B' })).toBe("'{b}' 'B'");
  });

  it('only own keys are substituted', () => {
    const vars = Object.create({ inherited: 'x' }) as Record<string, unknown>;
    expect(renderPs("'{inherited}'", vars)).toBe("'{inherited}'");
  });

  it('{name} after a word character is not substituted (matches interpolateVariables)', () => {
    expect(renderPs("'x{a}'", { a: 'v' })).toBe("'x{a}'");
  });

  it('both forms in one template', () => {
    expect(renderPs("Set-X -A '${a}' -B '{b}'", { a: "it's", b: 'ok' })).toBe("Set-X -A 'it''s' -B 'ok'");
  });
});
