// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Flow-through X1/X2 (MS-R3 / MS-R10): the Muster -> Stamper contract suite
 * and the Muster plan source run Muster's REAL generator
 * (ces-muster/src/features/plan/tenantManifestAdapter.ts) in-process. Muster's
 * sources import through its own `@/` alias, so the same alias is mirrored
 * here (read-only resolution into the sibling repo; nothing is written there).
 *
 * The ces root is found by walking up from this file until a directory holds
 * both ces-muster and ces-stamper (works from the main checkout and from
 * .worktrees/*). CES_ROOT overrides.
 */
function findCesRoot(): string | null {
  if (process.env.CES_ROOT) return path.resolve(process.env.CES_ROOT);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'ces-muster')) && fs.existsSync(path.join(dir, 'ces-stamper'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const cesRoot = findCesRoot();
const musterSrc = cesRoot ? path.join(cesRoot, 'ces-muster', 'src').split(path.sep).join('/') : null;

export default defineConfig({
  resolve: {
    alias: musterSrc ? [{ find: /^@\/(.*)$/, replacement: `${musterSrc}/$1` }] : [],
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
