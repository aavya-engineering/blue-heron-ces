// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const fs = require('fs');

function extractVars(str) {
  if (!str) return [];
  const matches = str.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g) || [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
}

function audit(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const entries = raw.entries || raw;
  const results = [];

  for (const e of entries) {
    const cmdVars = new Set();
    for (const v of extractVars(e.get_command)) cmdVars.add(v);
    for (const v of extractVars(e.set_command)) cmdVars.add(v);
    if (e.evidence_commands) {
      for (const ec of e.evidence_commands) {
        for (const v of extractVars(ec)) cmdVars.add(v);
      }
    }

    const required = new Set(e.variables_required || []);
    const runtime = new Set(e.variables_runtime || []);
    const declared = new Set([...required, ...runtime]);

    const inCmdNotDeclared = [...cmdVars].filter(v => !declared.has(v));
    const declaredNotInCmd = [...declared].filter(v => !cmdVars.has(v));

    results.push({
      entry_id: e.entry_id,
      label: e.label,
      engine: e.engine,
      cmdVars: [...cmdVars].sort(),
      variables_required: [...required].sort(),
      variables_runtime: [...runtime].sort(),
      inCmdNotDeclared,
      declaredNotInCmd,
      hasMismatch: inCmdNotDeclared.length > 0 || declaredNotInCmd.length > 0
    });
  }
  return results;
}

const m365 = audit('src/registry/cmmc-l2-commands.registry.json');
const infra = audit('src/registry/infra-cmmc-l2-commands.registry.json');

// Summary of mismatches
const allMismatches = [...m365, ...infra].filter(r => r.hasMismatch);
console.log('=== MISMATCH SUMMARY ===');
console.log('Total entries: M365=' + m365.length + ', Infra=' + infra.length);
console.log('Entries with mismatches: ' + allMismatches.length);
console.log('');
for (const r of allMismatches) {
  console.log(r.entry_id + ' -- ' + r.label);
  if (r.inCmdNotDeclared.length) console.log('  IN CMD BUT NOT DECLARED: ' + r.inCmdNotDeclared.join(', '));
  if (r.declaredNotInCmd.length) console.log('  DECLARED BUT NOT IN CMD: ' + r.declaredNotInCmd.join(', '));
}

// Write full audit to JSON
fs.writeFileSync('variable-audit.json', JSON.stringify({ m365, infra }, null, 2));
console.log('');
console.log('Full audit written to variable-audit.json');
