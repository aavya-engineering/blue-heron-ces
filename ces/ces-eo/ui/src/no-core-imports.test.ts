// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// API-5 (GAP-CLOSURE-PLAN.md §4): the UI package imports no server or core module. The browser code
// talks to EO only over HTTP. Every import specifier in src/** (tests included) must be a relative
// path that stays inside ui/src, or one of the allowed browser packages. Node built-ins are allowed
// only in test files (this lint itself reads the disk).

// @vitest-environment node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));

/** Packages the UI may import (exact name, or name + '/subpath'). */
export const ALLOWED_PACKAGES = [
  'react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'zustand', 'ces-ui-kit',
] as const;
/** Additional packages for test files only. */
const TEST_ONLY_PACKAGES = ['vitest', '@testing-library/react', '@testing-library/user-event', '@testing-library/jest-dom', 'axe-core'];

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

export function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const pkgOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/** Null when allowed, else the reason. */
export function violation(spec: string, file: string, isTest: boolean): string | null {
  if (spec.startsWith('.')) {
    const target = path.resolve(path.dirname(file), spec);
    return target === SRC || target.startsWith(SRC + path.sep) ? null : `relative import leaves ui/src: ${spec}`;
  }
  if (spec.startsWith('node:') || ['fs', 'path', 'url', 'os', 'child_process', 'crypto', 'http'].includes(spec)) {
    return isTest ? null : `node built-in in browser code: ${spec}`;
  }
  const pkg = pkgOf(spec);
  if ((ALLOWED_PACKAGES as readonly string[]).includes(pkg)) return null;
  if (isTest && TEST_ONLY_PACKAGES.includes(pkg)) return null;
  return `package not allowed in the UI (server or core module?): ${spec}`;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}

describe('API-5: no server or core imports in ces-eo/ui', () => {
  const files = walk(SRC);

  it('scans the whole package', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('every import is inside ui/src or an allowed browser package', () => {
    const bad: string[] = [];
    // This file is skipped: its own self-test below holds example specifiers as string literals.
    for (const f of files.filter((x) => x !== fileURLToPath(import.meta.url))) {
      const isTest = /\.test\.(ts|tsx)$/.test(f) || /testUtils\.tsx?$/.test(f);
      for (const spec of importSpecifiers(fs.readFileSync(f, 'utf-8'))) {
        const v = violation(spec, f, isTest);
        if (v) bad.push(`${path.relative(SRC, f)}: ${v}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the lint catches the imports it exists to forbid', () => {
    const f = path.join(SRC, 'screens', 'x.tsx');
    expect(violation('../../../src/eo/server/EoServer', f, false)).toMatch(/leaves ui\/src/);
    expect(violation('ces-shared/http/principal', f, false)).toMatch(/not allowed/);
    expect(violation('ces-eo', f, false)).toMatch(/not allowed/);
    expect(violation('express', f, false)).toMatch(/not allowed/);
    expect(violation('node:fs', f, false)).toMatch(/node built-in/);
    expect(violation('ces-ui-kit', f, false)).toBeNull();
    expect(violation('../api/eo', f, false)).toBeNull();
    expect(importSpecifiers("import a from 'x';\nexport * from './y';\nimport type { T } from 'z';\nconst m = import('w');")).toEqual(['x', './y', 'z', 'w']);
  });
});
