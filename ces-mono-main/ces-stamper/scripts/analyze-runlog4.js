// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const data = JSON.parse(require('fs').readFileSync('plan-data/vfsgov-xtra/logs/run-log-2026-04-09T12-09-04-234Z.json','utf8'));

// Show KV task chain (where AZ-KV-003/004 fail)
console.log('=== KV Task Chain ===');
const kvTask = 'step_task_SC.L2-3.13.10_mnkmi5kp_9avcznj';
for (const e of data.entries) {
  if (e.taskId === kvTask) {
    const hasStreams = (e.streams || []).length > 0;
    console.log(`  ${e.subId} status=${e.status} streams=${hasStreams ? (e.streams||[]).length : 0} msg=${(e.message||'').substring(0,80)}`);
  }
}

// Show DIAG task chain (where AZ-DIAG-004/006 fail)
console.log('\n=== DIAG Task Chain ===');
const diagTask = 'step_task_AU.L2-3.3.1_mnkmi5kq_zkaoqzy';
for (const e of data.entries) {
  if (e.taskId === diagTask) {
    const hasStreams = (e.streams || []).length > 0;
    console.log(`  ${e.subId} status=${e.status} streams=${hasStreams ? (e.streams||[]).length : 0} msg=${(e.message||'').substring(0,80)}`);
  }
}

// Show SEN-009 task chain
console.log('\n=== SEN-009 Task Chain ===');
const senTask = 'step_task_SI.L1-3.14.1_mnkmi5kr_ggnyzxm';
for (const e of data.entries) {
  if (e.taskId === senTask) {
    const hasStreams = (e.streams || []).length > 0;
    console.log(`  ${e.subId} status=${e.status} streams=${hasStreams ? (e.streams||[]).length : 0} msg=${(e.message||'').substring(0,80)}`);
  }
}

// Show SPO task chain
console.log('\n=== SPO Task Chain ===');
for (const e of data.entries) {
  if (e.subId && e.subId.includes('spo')) {
    const hasStreams = (e.streams || []).length > 0;
    console.log(`  ${e.subId} status=${e.status} task=${e.taskId} streams=${hasStreams ? (e.streams||[]).length : 0}`);
  }
}

// Show DKIM task chain
console.log('\n=== DKIM Task Chain ===');
for (const e of data.entries) {
  if (e.subId && e.subId.includes('3.13.15')) {
    const hasStreams = (e.streams || []).length > 0;
    console.log(`  ${e.subId} status=${e.status} streams=${hasStreams ? (e.streams||[]).length : 0}`);
  }
}
