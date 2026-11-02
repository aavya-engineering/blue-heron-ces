// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const ref = JSON.parse(require('fs').readFileSync('../ces-shared/src/data/cmmc-l2-controls.reference.json','utf8'));
const m365 = JSON.parse(require('fs').readFileSync('src/registry/cmmc-l2-commands.registry.json','utf8'));
const infra = JSON.parse(require('fs').readFileSync('src/registry/infra-cmmc-l2-commands.registry.json','utf8'));

const refIds = new Set(ref.controls.map(c => c.control_id));
const coveredIds = new Set();
const allEntries = [...(m365.entries || m365), ...(infra.entries || infra)];
allEntries.forEach(e => (e.control_ids || []).forEach(id => coveredIds.add(id)));

const uncovered = Array.from(refIds).filter(id => {
  return !coveredIds.has(id);
}).sort();

console.log('Total reference controls:', refIds.size);
console.log('Covered by registry entries:', coveredIds.size);
console.log('Uncovered (' + uncovered.length + '):');
uncovered.forEach(id => console.log('  -', id));

// Also check: entries per control
console.log('\nEntries per control:');
const entriesPerControl = {};
allEntries.forEach(e => {
  (e.control_ids || []).forEach(id => {
    if (!entriesPerControl[id]) entriesPerControl[id] = [];
    entriesPerControl[id].push(e.entry_id);
  });
});
Array.from(refIds).sort().forEach(id => {
  const count = (entriesPerControl[id] || []).length;
  if (count === 0) console.log('  MISSING:', id);
});
