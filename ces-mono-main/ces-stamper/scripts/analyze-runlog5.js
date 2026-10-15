// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const data = JSON.parse(require('fs').readFileSync('plan-data/vfsgov-xtra/logs/run-log-2026-04-09T12-09-04-234Z.json','utf8'));
const seen = new Set();
for (const e of data.entries) {
  if (e.subId === 'SI.L1-3.14.1.flaw-remediation-evidence' && !seen.has(e.subId)) {
    seen.add(e.subId);
    console.log(`\n=== ${e.subId} (${e.status}) task=${e.taskId} ===`);
    console.log(`command: ${(e.command || '').substring(0, 200)}`);
    console.log(`message: ${(e.message || '')}`);
    for (let i = 0; i < (e.streams || []).length; i++) {
      const s = e.streams[i];
      console.log(`  stream[${i}] phase=${s.phase} exitCode=${s.exitCode}`);
      if (s.command) console.log(`    cmd: ${s.command.substring(0, 250)}`);
      if (s.stdout) console.log(`    stdout: ${s.stdout.substring(0, 300).replace(/[\n\r]/g, ' ')}`);
      if (s.stderr) console.log(`    stderr: ${s.stderr.substring(0, 300).replace(/[\n\r]/g, ' ')}`);
    }
  }
}

// Also show how the SEN-009 fail is chained through SI task
const siTask = data.entries.find(e => e.subId === 'SI.L1-3.14.1.flaw-remediation-evidence');
if (siTask) {
  console.log('\n=== SI task chain ===');
  for (const e of data.entries) {
    if (e.taskId === siTask.taskId) {
      console.log(`  ${e.subId} status=${e.status} streams=${(e.streams||[]).length} msg=${(e.message||'').substring(0,80)}`);
    }
  }
}
