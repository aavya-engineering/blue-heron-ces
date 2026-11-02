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
 * Recomputes the SHA-256 of every vendored file and fails on mismatch with the
 * hashes pinned in vendor-manifest.json (`files`).
 *
 * Hash mode (RF-47): SHA-256 of the file bytes with CRLF normalised to LF, so a
 * checkout's line-ending setting cannot turn the gate red (10 of the 51 pre-RF-47
 * mismatches were pins taken on a CRLF checkout). Any other byte change fails.
 *
 * Usage:
 *   node scripts/check-vendor-drift.mjs                    # the gate: pinned hashes only, no siblings needed
 *   node scripts/check-vendor-drift.mjs --against-sibling  # also compare each copy with its source in the
 *                                                          # sibling tree (`provenance[path].source`, a path
 *                                                          # relative to this repo, e.g. ../ces-planner/...).
 * Exit 0 = all hashes match (and, with --against-sibling, every `verbatim` copy equals its source);
 * Exit 1 = drift detected.
 */
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const againstSibling = process.argv.includes('--against-sibling');

const manifestPath = join(root, 'vendor-manifest.json');
if (!existsSync(manifestPath)) {
  console.error('ERROR: vendor-manifest.json not found at', manifestPath);
  process.exit(1);
}

/** The pinned hash: SHA-256 over the bytes with CRLF -> LF. */
function pinHash(buf) {
  const lf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return createHash('sha256').update(lf).digest('hex');
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
  const actual = pinHash(readFileSync(absPath));
  if (actual !== expectedHash) {
    failures.push({ path: relPath, expected: expectedHash, actual });
    failed++;
  } else {
    passed++;
  }
}

console.log(`\nVendor drift check — pins verified against ces-mono ${manifest.verifiedAgainst?.commit ?? manifest.pinnedSha}`);
console.log(`Checked ${passed + failed} files: ${passed} OK, ${failed} DRIFT\n`);

let siblingFailed = 0;
if (againstSibling) {
  // Code comparison ignores what a vendored copy is allowed to change: the
  // leading comment block (notice + VENDORED header), import lines, BOM, CRLF
  // and trailing whitespace. Data files compare on BOM/CRLF only.
  const isCode = (p) => /\.(ts|tsx|mjs|js)$/.test(p);
  const norm = (s, code) => {
    let lines = s.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
    if (!code) return lines.join('\n');
    let i = 0;
    while (i < lines.length && (lines[i] === '' || lines[i].startsWith('//'))) i++;
    lines = lines.slice(i).filter((l) => !/^\s*import\s|^\s*\}\s*from\s+['"]/.test(l));
    return lines.join('\n').trim();
  };
  const prov = manifest.provenance ?? {};
  const counts = { same: 0, diverged: 0, adapted: 0, noSource: 0, siblingAbsent: 0 };
  for (const relPath of Object.keys(expected)) {
    const p = prov[relPath];
    if (!p?.source) { counts.noSource++; continue; }
    const src = resolve(root, p.source);
    if (!existsSync(src)) { counts.siblingAbsent++; continue; }
    const code = isCode(relPath);
    const same = norm(readFileSync(src, 'utf-8'), code) === norm(readFileSync(join(root, relPath), 'utf-8'), code);
    if (p.kind === 'verbatim') {
      if (same) counts.same++;
      else { counts.diverged++; siblingFailed++; console.error(`  DIVERGED (verbatim copy != source) ${relPath}  <-  ${p.source}`); }
    } else {
      counts.adapted++;
      if (same) console.log(`  NOTE adapted copy now equals its source — reclassify as verbatim: ${relPath}`);
    }
  }
  console.log(`Sibling comparison: ${counts.same} verbatim equal, ${counts.diverged} verbatim DIVERGED, ${counts.adapted} adapted/shim (reported in manifest), ${counts.noSource} without a source, ${counts.siblingAbsent} source not on disk\n`);
}

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
if (siblingFailed > 0) process.exit(1);

console.log('All vendored files match pinned hashes. No drift detected.');
process.exit(0);
