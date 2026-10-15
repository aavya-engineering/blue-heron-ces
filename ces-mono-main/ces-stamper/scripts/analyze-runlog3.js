// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const data = JSON.parse(require('fs').readFileSync('plan-data/vfsgov-xtra/logs/run-log-2026-04-09T12-09-04-234Z.json','utf8'));
// Show AZ-DIAG-006, AZ-FOUND-004, AZ-SEN-009 in detail (first occurrence only)
const targets = ['AZ-DIAG-006','AZ-FOUND-004','AZ-SEN-009'];
const seen = new Set();
for (const e of data.entries) {
  if (targets.includes(e.subId) && e.status === 'fail' && !seen.has(e.subId)) {
    seen.add(e.subId);
    console.log(`\n=== ${e.subId} (${e.status}) task=${e.taskId} ===`);
    console.log(`command: ${(e.command || '').substring(0, 200)}`);
    for (let i = 0; i < Math.min((e.streams || []).length, 10); i++) {
      const s = e.streams[i];
      console.log(`  stream[${i}] phase=${s.phase} exitCode=${s.exitCode}`);
      if (s.command) console.log(`    cmd: ${s.command.substring(0, 250)}`);
      if (s.stdout) console.log(`    stdout: ${s.stdout.substring(0, 300).replace(/[\n\r]/g, ' ')}`);
      if (s.stderr) console.log(`    stderr: ${s.stderr.substring(0, 300).replace(/[\n\r]/g, ' ')}`);
    }
    if ((e.streams || []).length > 10) console.log(`  ... ${e.streams.length - 10} more streams`);
  }
}

// Also check: what is the console log for SPO session establishment?
const spoLogs = (data.consoleLog || []).filter(l => (l.message || l.text || '').toLowerCase().includes('sharepoint') || (l.message || l.text || '').toLowerCase().includes('spo'));
console.log('\n\n=== SPO-related console log entries ===');
for (const l of spoLogs.slice(0, 10)) {
  console.log(JSON.stringify(l).substring(0, 300));
}
