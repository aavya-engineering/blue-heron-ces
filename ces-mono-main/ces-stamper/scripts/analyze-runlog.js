// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const data = JSON.parse(require('fs').readFileSync('plan-data/vfsgov-xtra/logs/run-log-2026-04-09T12-09-04-234Z.json','utf8'));
const taskId = 'step_task_SC.L2-3.13.10_mnkmi5kp_9avcznj';
let idx = 0;
for (const e of data.entries) {
  if (e.taskId === taskId && e.status !== 'skip') {
    idx++;
    const s0 = (e.streams && e.streams[0] && e.streams[0].stdout) || '';
    console.log(`${idx}. ${e.subId} status=${e.status} phase=${e.streams?.[0]?.phase} stdout[0:120]=${s0.substring(0,120).replace(/[\n\r]/g,' ')}`);
  }
}
console.log('---');
// Also show sequence around DIAG-004/006
const taskId2 = data.entries.find(e => e.subId === 'AZ-DIAG-004' && e.status === 'fail')?.taskId;
if (taskId2) {
  idx = 0;
  for (const e of data.entries) {
    if (e.taskId === taskId2 && e.status !== 'skip') {
      idx++;
      const s0 = (e.streams && e.streams[0] && e.streams[0].stdout) || '';
      console.log(`${idx}. ${e.subId} status=${e.status} stdout[0:120]=${s0.substring(0,120).replace(/[\n\r]/g,' ')}`);
    }
  }
}
