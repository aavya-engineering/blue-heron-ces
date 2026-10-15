// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * sync-ui-assets.mjs
 * Copies canonical CES UI assets from ces-shared/ui/ into each module's
 * public/ directory so ./ces-ui.css is reachable under each module's
 * express.static root.
 *
 * Run: node scripts/sync-ui-assets.mjs
 * Registered in root package.json as: "sync-ui-assets": "node scripts/sync-ui-assets.mjs"
 *
 * Idempotent — overwrites if already present. Logs each file written.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Canonical source files
const SRC_DIR = resolve(root, 'ces-shared', 'ui');
const ALL_FOUR = ['ces-ui.css', 'ces-theme-toggle.js', 'ces-logo.svg', 'ces-favicon.svg'];
const BRAND_ONLY = ['ces-logo.svg', 'ces-favicon.svg'];
// Muster restores the theme inline in index.html on the same localStorage["ces-theme"]
// contract, so it takes the stylesheet + brand assets but not ces-theme-toggle.js.
const NO_TOGGLE = ['ces-ui.css', 'ces-logo.svg', 'ces-favicon.svg'];

// Target directories and which assets they receive
const TARGETS = [
  { dir: resolve(root, 'ces-stamper', 'public'), assets: ALL_FOUR },
  { dir: resolve(root, 'ces-ao',      'public'), assets: ALL_FOUR },
  { dir: resolve(root, 'ces-eo',      'public'), assets: ALL_FOUR },
  { dir: resolve(root, 'ces-muster',  'public'), assets: NO_TOGGLE },
  { dir: resolve(root, 'ces-planner', 'public'), assets: BRAND_ONLY },
];

let written = 0;

for (const target of TARGETS) {
  if (!existsSync(target.dir)) {
    mkdirSync(target.dir, { recursive: true });
    console.log(`  mkdir  ${target.dir}`);
  }
  for (const filename of target.assets) {
    const src  = resolve(SRC_DIR, filename);
    const dest = resolve(target.dir, filename);
    copyFileSync(src, dest);
    console.log(`  wrote  ${dest}`);
    written++;
  }
}

console.log(`\nsync-ui-assets: ${written} file(s) written.`);
