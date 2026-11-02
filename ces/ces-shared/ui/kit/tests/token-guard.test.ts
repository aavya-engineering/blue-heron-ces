// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node
// Token guard (AD-1): kit and gallery sources carry no colour literals; colours come from var(--co-*).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const kitRoot = fileURLToPath(new URL('..', import.meta.url));
const SCANNED_DIRS = ['src', 'gallery'];
const SCANNED_EXT = /\.(css|ts|tsx|html)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;

const NAMED_COLOURS =
  'white|black|red|green|blue|yellow|orange|purple|gray|grey|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|cyan|magenta|pink|brown|gold|indigo|violet';

const RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'hex colour', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'colour function', pattern: /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi },
  {
    name: 'named colour in a colour property',
    pattern: new RegExp(
      `(?:color|background(?:-color)?|border(?:-[a-z]+)*-color|border(?:-(?:top|right|bottom|left))?|outline(?:-color)?|fill|stroke|box-shadow)\\s*:[^;{}]*\\b(?:${NAMED_COLOURS})\\b`,
      'gi',
    ),
  },
];

function collect(dir: string): string[] {
  return readdirSync(join(kitRoot, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => SCANNED_EXT.test(path) && !TEST_FILE.test(path));
}

function stripComments(text: string): string {
  // Token references (var(--co-term-cyan) etc.) name a token, not a colour: drop them before the named-colour rule runs.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/var\(\s*--[\w-]+\s*\)/g, 'var(--token)');
}

describe('token guard', () => {
  const files = SCANNED_DIRS.flatMap(collect);

  it('scans the kit sources', () => {
    expect(files.some((f) => f.endsWith('kit.css'))).toBe(true);
    expect(files.some((f) => f.endsWith('AppShell.tsx'))).toBe(true);
  });

  it('finds no colour literals in kit or gallery sources', () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const rule of RULES) {
        for (const match of text.matchAll(rule.pattern)) {
          hits.push(`${relative(kitRoot, file)}: ${rule.name}: ${match[0]}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('catches a literal when one is present (self-check)', () => {
    const sample = '.x { color: #fff; background: rgba(0,0,0,0.1); border-color: white; }';
    const found = RULES.flatMap((rule) => [...sample.matchAll(rule.pattern)].map((m) => m[0]));
    expect(found).toHaveLength(3);
  });
});
