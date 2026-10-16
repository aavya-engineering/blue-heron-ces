// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * One-time extraction script: reads the full CMMC L2 tech reference (~1.9MB)
 * and produces a trimmed reference file (~15KB) for compliance analysis.
 *
 * Usage: npx tsx scripts/extract-cmmc-reference.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const SOURCE_PATH = path.resolve(
  __dirname,
  '..', '..', 'ces-planner', 'public', 'data',
  'gcc-high-g5-cmmc-2-tech-ref-structured.json'
);

// FX2-ST1: the control reference is owned by ces-shared (src/data/cmmc-l2-controls.reference.json);
// Stamper keeps no local copy. This script only writes to an explicit output path.
const OUTPUT_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : (() => { throw new Error('Usage: npx tsx scripts/extract-cmmc-reference.ts <output.json> (canonical copy lives in ces-shared)'); })();

interface SourceControl {
  control_id: string;
  family: string;
  cmmc_level: number;
  nist_sp_800_171_ref: string;
  practice: string;
}

interface SourceFamily {
  abbreviation: string;
  name: string;
  control_count: number;
  controls: SourceControl[];
}

interface SourceDocument {
  total_controls: number;
  control_families: SourceFamily[];
}

const raw = fs.readFileSync(SOURCE_PATH, 'utf-8');
const source: SourceDocument = JSON.parse(raw);

const families = source.control_families.map(f => ({
  abbreviation: f.abbreviation,
  name: f.name,
  control_count: f.control_count,
}));

const controls = source.control_families.flatMap(f =>
  f.controls.map(c => ({
    control_id: c.control_id,
    family: c.family,
    cmmc_level: c.cmmc_level,
    nist_ref: c.nist_sp_800_171_ref,
    practice: c.practice,
  }))
);

const output = {
  total_controls: source.total_controls,
  families,
  controls,
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

console.log(`Wrote ${controls.length} controls to ${OUTPUT_PATH}`);
console.log(`Families: ${families.map(f => f.abbreviation).join(', ')}`);
console.log(`File size: ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1)} KB`);
