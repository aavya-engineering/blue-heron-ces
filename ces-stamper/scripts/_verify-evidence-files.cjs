// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const fs = require('fs');
const path = require('path');

const ref = JSON.parse(fs.readFileSync('../ces-shared/src/data/cmmc-l2-controls.reference.json','utf8'));
const m365 = JSON.parse(fs.readFileSync('src/registry/cmmc-l2-commands.registry.json','utf8'));
const infra = JSON.parse(fs.readFileSync('src/registry/infra-cmmc-l2-commands.registry.json','utf8'));
const all = [...(m365.entries || m365), ...(infra.entries || infra)];

const evidenceDir = 'plan-data/vfsgov-xtra/evidence';

// Build the same evidenceFileForEntry logic used by the app
// First, need the EVIDENCE_MAP and reverse map
// Read the EvidenceReadinessAnalyzer to understand the mapping
// For simplicity, replicate the auto-generated path logic
function categoryFromEntryId(entryId) {
  const prefix = entryId.split('.')[0].split('-')[0];
  const catMap = {
    'AC': 'access_control', 'AT': 'awareness_training', 'AU': 'audit_accountability',
    'CM': 'config_management', 'IA': 'identification_auth', 'IR': 'incident_response',
    'MA': 'maintenance', 'MP': 'media_protection', 'PE': 'physical_protection',
    'PS': 'personnel_security', 'RA': 'risk_assessment', 'CA': 'security_assessment',
    'SC': 'system_comms', 'SI': 'system_integrity',
    'AZ': 'infra',
  };
  return catMap[prefix] || 'other';
}

function evidenceFileForEntry(entryId) {
  const cat = categoryFromEntryId(entryId);
  return `${cat}/${entryId.toLowerCase()}.txt`;
}

// Build control -> entries map
const controlEntries = {};
ref.controls.forEach(c => { controlEntries[c.control_id] = []; });
all.forEach(e => {
  (e.control_ids || []).forEach(id => {
    if (controlEntries[id]) controlEntries[id].push(e);
  });
});

// Check each control
let controlsWithEvidence = 0;
let controlsWithout = 0;
const missing = [];
const covered = [];

ref.controls.forEach(ctrl => {
  const entries = controlEntries[ctrl.control_id] || [];
  let hasEvidence = false;
  const entryResults = [];

  entries.forEach(e => {
    const relTxt = evidenceFileForEntry(e.entry_id);
    const relJson = relTxt.replace(/\.txt$/, '.json');
    const txtPath = path.join(evidenceDir, relTxt);
    const jsonPath = path.join(evidenceDir, relJson);
    const txtExists = fs.existsSync(txtPath);
    const jsonExists = fs.existsSync(jsonPath);
    const found = txtExists || jsonExists;
    if (found) hasEvidence = true;
    entryResults.push({
      entryId: e.entry_id,
      found,
      format: txtExists ? '.txt' : (jsonExists ? '.json' : 'NONE'),
    });
  });

  if (hasEvidence) {
    controlsWithEvidence++;
    covered.push({ controlId: ctrl.control_id, entries: entryResults });
  } else {
    controlsWithout++;
    missing.push({ controlId: ctrl.control_id, entries: entryResults });
  }
});

console.log(`=== Evidence File Verification ===`);
console.log(`Evidence directory: ${evidenceDir}`);
console.log(`Total controls: ${ref.controls.length}`);
console.log(`Controls WITH evidence files: ${controlsWithEvidence}`);
console.log(`Controls WITHOUT evidence files: ${controlsWithout}`);
console.log(`Coverage: ${Math.round(controlsWithEvidence / ref.controls.length * 100)}%`);

if (missing.length > 0) {
  console.log(`\n=== MISSING EVIDENCE (${missing.length} controls) ===`);
  missing.forEach(m => {
    console.log(`\n  ${m.controlId}:`);
    if (m.entries.length === 0) {
      console.log(`    (no registry entries for this control)`);
    } else {
      m.entries.forEach(e => {
        console.log(`    ${e.entryId}: ${e.format}`);
      });
    }
  });
}

// Also count total entry-level files
let totalEntryFiles = 0;
let missingEntryFiles = 0;
const missingEntries = [];
all.forEach(e => {
  const relTxt = evidenceFileForEntry(e.entry_id);
  const relJson = relTxt.replace(/\.txt$/, '.json');
  const found = fs.existsSync(path.join(evidenceDir, relTxt)) || fs.existsSync(path.join(evidenceDir, relJson));
  totalEntryFiles++;
  if (!found) {
    missingEntryFiles++;
    missingEntries.push(e.entry_id);
  }
});

console.log(`\n=== Entry-Level Evidence ===`);
console.log(`Total registry entries: ${totalEntryFiles}`);
console.log(`Entries WITH evidence files: ${totalEntryFiles - missingEntryFiles}`);
console.log(`Entries WITHOUT evidence files: ${missingEntryFiles}`);

if (missingEntries.length > 0) {
  console.log(`\nMissing entry-level files (${missingEntries.length}):`);
  missingEntries.forEach(id => console.log(`  ${id}`));
}
