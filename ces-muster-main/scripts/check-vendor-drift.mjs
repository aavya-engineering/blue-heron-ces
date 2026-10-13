#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * check-vendor-drift.mjs
 * Recomputes SHA-256 of every vendored file and fails on mismatch
 * with the hashes recorded in vendor-manifest.json.
 *
 * Usage: node scripts/check-vendor-drift.mjs
 * Exit 0 = all hashes match; Exit 1 = drift detected.
 */
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const manifestPath = join(root, 'vendor-manifest.json');
if (!existsSync(manifestPath)) {
  console.error('ERROR: vendor-manifest.json not found at', manifestPath);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const expected = manifest.files;

let passed = 0;
let failed = 0;
const failures = [];

for (const [relPath, expectedHash] of Object.entries(expected)) {
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) {
    failures.push({ path: relPath, error: 'FILE NOT FOUND' });
    failed++;
    continue;
  }
  const content = readFileSync(absPath);
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== expectedHash) {
    failures.push({ path: relPath, expected: expectedHash, actual });
    failed++;
  } else {
    passed++;
  }
}

console.log(`\nVendor drift check — pinned SHA: ${manifest.pinnedSha}`);
console.log(`Checked ${passed + failed} files: ${passed} OK, ${failed} DRIFT\n`);

if (failures.length > 0) {
  console.error('DRIFT DETECTED:');
  for (const f of failures) {
    if (f.error) {
      console.error(`  MISSING  ${f.path}`);
    } else {
      console.error(`  MISMATCH ${f.path}`);
      console.error(`    expected: ${f.expected}`);
      console.error(`    actual:   ${f.actual}`);
    }
  }
  process.exit(1);
}

console.log('All vendored files match pinned hashes. No drift detected.');
process.exit(0);
