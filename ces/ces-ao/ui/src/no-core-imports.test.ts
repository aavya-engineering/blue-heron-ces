// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// API-5 (GAP-CLOSURE-PLAN.md §4, G-API row 5; ADR 2026-10-29 addendum rule 1 and 3): the AO UI
// package imports no server or core module. Every import specifier in ui/src is checked, type-only
// imports and re-exports included:
//  - app source may import only the allow-list (react, react-dom, zustand, ces-ui-kit, CSS) and
//    relative paths that stay inside ui/src;
//  - test files and src/test/** may also import the test libraries, but never a server or core
//    module either (no ces-ao/src, ces-shared, ces-stamper, ces-tenant, express).

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const SRC = path.dirname(SELF);

const APP_ALLOWED = [/^react$/, /^react\/jsx-runtime$/, /^react-dom(\/client)?$/, /^zustand$/, /^ces-ui-kit$/, /^ces-ui-kit\/kit\.css$/];
const TEST_ALLOWED = [
  ...APP_ALLOWED,
  /^vitest$/,
  /^@testing-library\//,
  /^axe-core$/,
  /^node:(fs|path|url)$/,
];
/** Never, in any file: AO's server and core, the shared core, other modules, the HTTP server. */
const FORBIDDEN = [/^ces-ao(\/|$)/, /^ces-shared(\/|$)/, /^ces-stamper(\/|$)/, /^ces-tenant(\/|$)/, /^ces-eo(\/|$)/, /^express$/, /^@bhd-edc\//];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/** Import / export-from / dynamic import / require specifiers. */
export function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:\bimport\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?|\bexport\s+(?:type\s+)?[^'";]*?\s+from\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

function isTestFile(file: string): boolean {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  return /\.test\.tsx?$/.test(rel) || rel.startsWith('test/');
}

export function violations(file: string, source: string): string[] {
  const bad: string[] = [];
  const allowed = isTestFile(file) ? TEST_ALLOWED : APP_ALLOWED;
  for (const spec of specifiers(source)) {
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec);
      if (path.relative(SRC, target).startsWith('..')) bad.push(`${spec} (leaves ui/src)`);
      continue;
    }
    if (FORBIDDEN.some((r) => r.test(spec))) bad.push(`${spec} (server or core module)`);
    else if (!allowed.some((r) => r.test(spec))) bad.push(`${spec} (not on the UI allow-list)`);
  }
  return bad;
}

describe('API-5: the AO UI imports no server or core module', () => {
  // This file is the lint; its self-check strings name forbidden imports on purpose.
  const files = walk(SRC).filter((f) => path.resolve(f) !== path.resolve(SELF));

  it('finds the UI sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('no file in ui/src imports outside the allow-list', () => {
    const found: Record<string, string[]> = {};
    for (const f of files) {
      const v = violations(f, fs.readFileSync(f, 'utf8'));
      if (v.length) found[path.relative(SRC, f)] = v;
    }
    expect(found).toEqual({});
  });

  it('self-check: the lint catches server, core, type-only and escaping imports', () => {
    const app = path.join(SRC, 'screens', 'x.tsx');
    expect(violations(app, "import type { AoCommand } from '../../../src/types/AoCommand.js';")).toHaveLength(1);
    expect(violations(app, "import { getCesRepository } from 'ces-shared/persistence/node';")).toHaveLength(1);
    expect(violations(app, "import express from 'express';")).toHaveLength(1);
    expect(violations(app, "export { x } from 'ces-ao/src/server/AoServer';")).toHaveLength(1);
    expect(violations(app, "const m = await import('ces-stamper');")).toHaveLength(1);
    expect(violations(app, "import * as fs from 'node:fs';")).toHaveLength(1);
    expect(violations(app, "import { AppShell } from 'ces-ui-kit';\nimport { aoApi } from '../api';")).toEqual([]);
    expect(violations(path.join(SRC, 'App.test.tsx'), "import * as fs from 'node:fs';")).toEqual([]);
    expect(violations(path.join(SRC, 'App.test.tsx'), "import { AoServer } from '../../src/server/AoServer.js';")).toHaveLength(1);
  });
});
