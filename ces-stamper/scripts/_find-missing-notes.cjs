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

const m365Entries = m365.entries || m365;
const infraEntries = infra.entries || infra;

function analyzeRegistry(entries, label) {
  const noNotes = entries.filter(e => !e.notes || e.notes.trim() === '');
  const withNotes = entries.filter(e => e.notes && e.notes.trim() !== '');
  const hasSet = entries.filter(e => (e.sub_commands || []).some(sc => sc.set_command));
  const noSet = entries.filter(e => !(e.sub_commands || []).some(sc => sc.set_command));

  console.log(`\n=== ${label} ===`);
  console.log(`Total: ${entries.length} | With notes: ${withNotes.length} | Missing notes: ${noNotes.length}`);
  console.log(`Has set_command: ${hasSet.length} | No set_command (evidence-only): ${noSet.length}`);

  // List entries missing notes
  console.log(`\nMissing notes (${noNotes.length}):`);
  noNotes.forEach(e => {
    const hasGet = (e.sub_commands || []).some(sc => sc.get_command);
    const hasSetCmd = (e.sub_commands || []).some(sc => sc.set_command);
    const controls = (e.control_ids || []).join(', ');
    const desc = (e.description || '').substring(0, 80);
    console.log(`  ${e.entry_id.padEnd(40)} get:${hasGet?'Y':'N'} set:${hasSetCmd?'Y':'N'} | ${controls}`);
    if (desc) console.log(`    ${desc}`);
  });
}

analyzeRegistry(m365Entries, 'M365 Registry');
analyzeRegistry(infraEntries, 'Infra Registry');
