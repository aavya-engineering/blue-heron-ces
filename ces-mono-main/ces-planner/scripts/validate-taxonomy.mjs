// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { readFileSync } from 'fs';
import YAML from 'js-yaml';

const bank = YAML.load(readFileSync('public/data/primed RR Question Bank.yaml', 'utf-8'));
const ab = bank.ces.activity_bank;
const acts = [
  ...(ab.universal?.activities || []),
  ...(ab.level_specific?.L1?.activities || []),
  ...(ab.level_specific?.L2?.activities || []),
  ...(ab.level_specific?.L3?.activities || []),
];
const bankPractices = new Set();
for (const a of acts) {
  (a.mapped_requirements || []).forEach((r) => bankPractices.add(r));
}

const tax = YAML.load(readFileSync('public/data/domain Capability Taxonomy.yaml', 'utf-8'));
const taxPractices = new Map();
for (const cap of tax.capabilities) {
  for (const p of cap.practices || []) {
    if (taxPractices.has(p.id)) {
      console.log(`DUPLICATE: ${p.id} in ${cap.id} and ${taxPractices.get(p.id)}`);
    }
    taxPractices.set(p.id, cap.id);
  }
}

const missing = [];
bankPractices.forEach((p) => {
  if (!taxPractices.has(p)) missing.push(p);
});
const extra = [];
taxPractices.forEach((v, p) => {
  if (!bankPractices.has(p)) extra.push(p);
});

console.log(`Bank practices: ${bankPractices.size}`);
console.log(`Taxonomy practices: ${taxPractices.size}`);
console.log(`\nMissing from taxonomy (${missing.length}):`);
if (missing.length) console.log('  ' + missing.sort().join('\n  '));
console.log(`\nIn taxonomy but not in bank (${extra.length}):`);
if (extra.length) console.log('  ' + extra.sort().join('\n  '));
console.log(`\nCoverage: ${((1 - missing.length / bankPractices.size) * 100).toFixed(1)}%`);
