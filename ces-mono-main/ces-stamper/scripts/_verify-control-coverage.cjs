// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const fs = require('fs');
const ref = JSON.parse(fs.readFileSync('../ces-shared/src/data/cmmc-l2-controls.reference.json','utf8'));
const m365 = JSON.parse(fs.readFileSync('src/registry/cmmc-l2-commands.registry.json','utf8'));
const infra = JSON.parse(fs.readFileSync('src/registry/infra-cmmc-l2-commands.registry.json','utf8'));
const all = [...(m365.entries || m365), ...(infra.entries || infra)];

const refIds = ref.controls.map(c => c.control_id);
console.log(`Total CMMC L2 controls: ${refIds.length}`);
console.log(`Total registry entries: ${all.length}`);

// Build control -> entries map
const controlMap = {};
refIds.forEach(id => { controlMap[id] = []; });
all.forEach(e => {
  (e.control_ids || []).forEach(id => {
    if (controlMap[id]) controlMap[id].push(e);
  });
});

// Categorize each control
const uncovered = [];
const manualOnly = [];
const hasGet = [];

refIds.sort().forEach(id => {
  const entries = controlMap[id];
  if (entries.length === 0) {
    uncovered.push(id);
    return;
  }
  const anyGetCmd = entries.some(e => e.get_command);
  const anyManualOnly = entries.some(e => e.manual_only && !e.get_command);

  if (anyGetCmd) {
    hasGet.push(id);
  } else if (anyManualOnly) {
    manualOnly.push(id);
  } else {
    uncovered.push(id);
  }
});

console.log(`\nControls with live assess capability (get_command): ${hasGet.length}`);
console.log(`Controls with manual_only entries only (SAT by policy): ${manualOnly.length}`);
console.log(`Controls with NO registry entries: ${uncovered.length}`);

if (manualOnly.length > 0) {
  console.log(`\nManual-only controls (${manualOnly.length}):`);
  manualOnly.forEach(id => {
    const entries = controlMap[id];
    const entryIds = entries.map(e => e.entry_id).join(', ');
    console.log(`  ${id} <- ${entryIds}`);
  });
}

if (uncovered.length > 0) {
  console.log(`\nUNCOVERED controls (${uncovered.length}):`);
  uncovered.forEach(id => console.log(`  ${id}`));
}

// Check: will every control produce an evidence file during assess?
console.log(`\n=== EVIDENCE GENERATION SUMMARY ===`);
console.log(`Controls that will produce evidence during assess: ${hasGet.length + manualOnly.length} / ${refIds.length}`);
console.log(`  - Live (PowerShell query): ${hasGet.length}`);
console.log(`  - Manual gate (SAT by policy): ${manualOnly.length}`);
if (uncovered.length > 0) {
  console.log(`  - NO EVIDENCE POSSIBLE: ${uncovered.length}`);
}
console.log(`Coverage: ${Math.round((hasGet.length + manualOnly.length) / refIds.length * 100)}%`);
