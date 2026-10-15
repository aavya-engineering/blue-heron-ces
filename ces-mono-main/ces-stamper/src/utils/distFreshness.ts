// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as path from 'path';

/**
 * FX-ST2 / MS-R12: detect a stale `dist/`.
 *
 * `dist/` is gitignored, but the `stamper` bin and ces-tester's scenarios run
 * it. A src change without `npm run build` used to leave the runtime on old
 * code silently (the 2026-09-09 dist ran for weeks after the contract work).
 *
 * A src file is stale when its emitted `.js` is missing or older than the
 * `.ts` (tsc rewrites every output on each build, so any src edit after the
 * last build shows up here). Declaration-only files (`*.d.ts`) emit nothing
 * and are skipped.
 */
export interface StaleEntry {
  src: string;
  dist: string;
  reason: 'missing' | 'older';
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTs(p));
    else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Returns the stale src files (empty = dist is fresh). Throws if `src/` is absent. */
export function findStaleDist(stamperRoot: string): StaleEntry[] {
  const srcDir = path.join(stamperRoot, 'src');
  const distDir = path.join(stamperRoot, 'dist');
  const stale: StaleEntry[] = [];
  for (const src of listTs(srcDir)) {
    const rel = path.relative(srcDir, src).replace(/\.ts$/, '.js');
    const dist = path.join(distDir, rel);
    if (!fs.existsSync(dist)) {
      stale.push({ src, dist, reason: 'missing' });
      continue;
    }
    if (fs.statSync(src).mtimeMs > fs.statSync(dist).mtimeMs) stale.push({ src, dist, reason: 'older' });
  }
  return stale;
}

export function describeStale(stale: StaleEntry[], stamperRoot: string, max = 10): string {
  const lines = stale.slice(0, max).map(s => `  ${path.relative(stamperRoot, s.src)} (${s.reason === 'missing' ? 'not built' : 'newer than dist'})`);
  const more = stale.length > max ? `\n  … and ${stale.length - max} more` : '';
  return `dist/ is stale: ${stale.length} src file(s) changed since the last build — run \`npm run build\`.\n${lines.join('\n')}${more}`;
}

/**
 * CLI start-up guard. Only applies when running the BUILT CLI from a checkout
 * that still has `src/` next to `dist/` (a packaged install has no src and is
 * skipped). Exits non-zero on staleness unless STAMPER_ALLOW_STALE_DIST=1.
 */
export function assertDistFreshAtStartup(distCliDir: string): void {
  const distDir = path.resolve(distCliDir, '..');
  if (path.basename(distDir) !== 'dist') return; // running from src via tsx
  const stamperRoot = path.resolve(distDir, '..');
  if (!fs.existsSync(path.join(stamperRoot, 'src'))) return;
  const stale = findStaleDist(stamperRoot);
  if (stale.length === 0) return;
  const msg = describeStale(stale, stamperRoot);
  if (process.env.STAMPER_ALLOW_STALE_DIST === '1') {
    console.warn(`WARNING (STAMPER_ALLOW_STALE_DIST=1): ${msg}`);
    return;
  }
  console.error(`ERROR: ${msg}\nSet STAMPER_ALLOW_STALE_DIST=1 to run anyway.`);
  process.exit(3);
}
