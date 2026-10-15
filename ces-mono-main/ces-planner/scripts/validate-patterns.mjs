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

// Load all three data files
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
    taxPractices.set(p.id, cap.id);
  }
}

const patterns = YAML.load(
  readFileSync('public/data/domain Implementation Patterns.yaml', 'utf-8')
);
const patternPractices = new Map();
const patternIds = new Set();
let totalActions = 0;
let duplicatePatterns = [];
let duplicateActions = [];

for (const pat of patterns.patterns) {
  // Check duplicate pattern IDs
  if (patternIds.has(pat.pattern_id)) {
    duplicatePatterns.push(pat.pattern_id);
  }
  patternIds.add(pat.pattern_id);

  // Track practice coverage
  if (patternPractices.has(pat.practice_id)) {
    patternPractices.get(pat.practice_id).push(pat.pattern_id);
  } else {
    patternPractices.set(pat.practice_id, [pat.pattern_id]);
  }

  // Count and check actions
  const actionIds = new Set();
  for (const act of pat.actions || []) {
    totalActions++;
    if (actionIds.has(act.id)) {
      duplicateActions.push(`${act.id} in ${pat.pattern_id}`);
    }
    actionIds.add(act.id);
  }
}

// Compare patterns vs bank practices
const missingFromPatterns = [];
bankPractices.forEach((p) => {
  if (!patternPractices.has(p)) missingFromPatterns.push(p);
});

const extraInPatterns = [];
patternPractices.forEach((v, p) => {
  if (!bankPractices.has(p)) extraInPatterns.push(p);
});

// Compare patterns vs taxonomy
const missingFromTaxonomy = [];
patternPractices.forEach((v, p) => {
  if (!taxPractices.has(p)) missingFromTaxonomy.push(p);
});

const taxonomyNotInPatterns = [];
taxPractices.forEach((v, p) => {
  if (!patternPractices.has(p)) taxonomyNotInPatterns.push(p);
});

// Report
console.log('=== Implementation Patterns Validation ===\n');
console.log(`Bank practices:     ${bankPractices.size}`);
console.log(`Taxonomy practices: ${taxPractices.size}`);
console.log(`Pattern practices:  ${patternPractices.size}`);
console.log(`Total patterns:     ${patternIds.size}`);
console.log(`Total actions:      ${totalActions}`);

if (duplicatePatterns.length) {
  console.log(`\nDUPLICATE pattern IDs (${duplicatePatterns.length}):`);
  console.log('  ' + duplicatePatterns.join('\n  '));
}
if (duplicateActions.length) {
  console.log(`\nDUPLICATE action IDs (${duplicateActions.length}):`);
  console.log('  ' + duplicateActions.join('\n  '));
}

console.log(`\nPractices missing from patterns (${missingFromPatterns.length}):`);
if (missingFromPatterns.length) console.log('  ' + missingFromPatterns.sort().join('\n  '));

console.log(`\nIn patterns but not in bank (${extraInPatterns.length}):`);
if (extraInPatterns.length) console.log('  ' + extraInPatterns.sort().join('\n  '));

console.log(`\nIn patterns but not in taxonomy (${missingFromTaxonomy.length}):`);
if (missingFromTaxonomy.length) console.log('  ' + missingFromTaxonomy.sort().join('\n  '));

console.log(`\nIn taxonomy but not in patterns (${taxonomyNotInPatterns.length}):`);
if (taxonomyNotInPatterns.length) console.log('  ' + taxonomyNotInPatterns.sort().join('\n  '));

const coverage = ((1 - missingFromPatterns.length / bankPractices.size) * 100).toFixed(1);
console.log(`\nBank → Patterns coverage: ${coverage}%`);
