// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const fs = require('fs');
const m365 = JSON.parse(fs.readFileSync('src/registry/cmmc-l2-commands.registry.json','utf8'));
const infra = JSON.parse(fs.readFileSync('src/registry/infra-cmmc-l2-commands.registry.json','utf8'));
const all = [...(m365.entries || m365), ...(infra.entries || infra)];

// Categorize entries by assess path
const noGetCmd = all.filter(e => !e.get_command);
const noGetManualOnly = noGetCmd.filter(e => e.manual_only);
const noGetNotManual = noGetCmd.filter(e => !e.manual_only);
const hasGetCmd = all.filter(e => e.get_command);

console.log('=== Assess Path Analysis ===');
console.log(`Total entries: ${all.length}`);
console.log(`Has get_command (live path): ${hasGetCmd.length}`);
console.log(`No get_command: ${noGetCmd.length}`);
console.log(`  manual_only=true (→ SAT): ${noGetManualOnly.length}`);
console.log(`  manual_only=false (→ NOT_SAT): ${noGetNotManual.length}`);

console.log('\n=== Entries with NO get_command and NOT manual_only (→ NOT_SAT) ===');
noGetNotManual.forEach(e => {
  console.log(`  ${e.entry_id.padEnd(45)} controls: ${(e.control_ids||[]).join(', ')}`);
  console.log(`    label: ${e.label}`);
  console.log(`    set_command: ${e.set_command ? 'YES' : 'no'}`);
});

console.log('\n=== Entries with NO get_command but manual_only=true (→ SAT) ===');
noGetManualOnly.forEach(e => {
  console.log(`  ${e.entry_id.padEnd(45)} controls: ${(e.control_ids||[]).join(', ')}`);
});

// Which controls are ONLY covered by NOT_SAT entries?
const notSatControlIds = new Set();
noGetNotManual.forEach(e => (e.control_ids||[]).forEach(id => notSatControlIds.add(id)));

const satEntries = [...noGetManualOnly, ...hasGetCmd];
const satControlIds = new Set();
satEntries.forEach(e => (e.control_ids||[]).forEach(id => satControlIds.add(id)));

const onlyNotSatControls = [...notSatControlIds].filter(id => !satControlIds.has(id)).sort();
console.log(`\n=== Controls covered ONLY by NOT_SAT entries (${onlyNotSatControls.length}) ===`);
onlyNotSatControls.forEach(id => {
  const covering = noGetNotManual.filter(e => (e.control_ids||[]).includes(id));
  covering.forEach(e => console.log(`  ${id} <- ${e.entry_id}`));
});

// Controls that have at least one SAT-capable entry
const bothControls = [...notSatControlIds].filter(id => satControlIds.has(id)).sort();
console.log(`\nControls with NOT_SAT entries BUT also SAT-capable entries: ${bothControls.length}`);
