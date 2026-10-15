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

// Load implementation patterns
const patterns = YAML.load(
  readFileSync('public/data/domain Implementation Patterns.yaml', 'utf-8')
);
const patternActions = new Map();
for (const pat of patterns.patterns) {
  for (const act of pat.actions || []) {
    patternActions.set(act.id, { pattern_id: pat.pattern_id, practice_id: pat.practice_id });
  }
}

// Load vendor playbook
const playbook = YAML.load(
  readFileSync('public/data/vendor playbook Microsoft 365.yaml', 'utf-8')
);
const playbookActions = new Set();
const duplicatePlaybook = [];
for (const entry of playbook.playbook) {
  if (playbookActions.has(entry.action_id)) {
    duplicatePlaybook.push(entry.action_id);
  }
  playbookActions.add(entry.action_id);
}

// Compare
const missingFromPlaybook = [];
patternActions.forEach((v, actionId) => {
  if (!playbookActions.has(actionId)) missingFromPlaybook.push(actionId);
});

const extraInPlaybook = [];
playbookActions.forEach((actionId) => {
  if (!patternActions.has(actionId)) extraInPlaybook.push(actionId);
});

// Count entries with PowerShell commands
let withPowershell = 0;
let withPortalPath = 0;
let withEvidence = 0;
for (const entry of playbook.playbook) {
  if (entry.powershell && entry.powershell.length > 0) withPowershell++;
  if (entry.portal_path) withPortalPath++;
  if (entry.evidence_commands && entry.evidence_commands.length > 0) withEvidence++;
}

// Report
console.log('=== Vendor Playbook Validation (Microsoft 365) ===\n');
console.log(`Pattern actions:  ${patternActions.size}`);
console.log(`Playbook entries: ${playbookActions.size}`);

if (duplicatePlaybook.length) {
  console.log(`\nDUPLICATE playbook entries (${duplicatePlaybook.length}):`);
  console.log('  ' + duplicatePlaybook.join('\n  '));
}

console.log(`\nActions missing from playbook (${missingFromPlaybook.length}):`);
if (missingFromPlaybook.length) console.log('  ' + missingFromPlaybook.sort().join('\n  '));

console.log(`\nIn playbook but not in patterns (${extraInPlaybook.length}):`);
if (extraInPlaybook.length) console.log('  ' + [...extraInPlaybook].sort().join('\n  '));

const coverage = ((1 - missingFromPlaybook.length / patternActions.size) * 100).toFixed(1);
console.log(`\nCoverage: ${coverage}%`);

console.log(`\n--- Richness ---`);
console.log(`With PowerShell:   ${withPowershell}/${playbookActions.size} (${((withPowershell / playbookActions.size) * 100).toFixed(0)}%)`);
console.log(`With portal path:  ${withPortalPath}/${playbookActions.size} (${((withPortalPath / playbookActions.size) * 100).toFixed(0)}%)`);
console.log(`With evidence cmd: ${withEvidence}/${playbookActions.size} (${((withEvidence / playbookActions.size) * 100).toFixed(0)}%)`);
