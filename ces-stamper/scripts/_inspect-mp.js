// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const mp = JSON.parse(require('fs').readFileSync('plan-data/vfsgov-xtra/plans/manual-mission-plan-2026-04-14T00-27-54-661Z.json','utf8'));
const hr = mp.outputs.human_readable_mission_plan;

// control_directives
const cd = hr.control_directives;
console.log('control_directives type:', typeof cd, Array.isArray(cd));
if (typeof cd === 'object' && !Array.isArray(cd)) {
  const vals = {};
  for (const [k,v] of Object.entries(cd)) vals[v] = (vals[v]||0) + 1;
  console.log('Directive values:', vals);
  console.log('Total:', Object.keys(cd).length);
} else if (Array.isArray(cd)) {
  console.log('First entry:', JSON.stringify(cd[0]).substring(0, 200));
  console.log('Count:', cd.length);
}

// scope_exclusions
const ex = hr.scope_exclusions;
console.log('\nscope_exclusions count:', ex.length);
console.log('First:', JSON.stringify(ex[0]).substring(0, 200));
const exIds = new Set(ex.map(e => e.requirement_id || e.control_id));
console.log('Unique exclusion IDs:', exIds.size);

// controls
const ctrls = hr.controls;
console.log('\ncontrols count:', ctrls.length);
console.log('First control keys:', Object.keys(ctrls[0]));
console.log('First:', JSON.stringify(ctrls[0]).substring(0, 400));

// Check stamper_action values
const actions = {};
for (const c of ctrls) {
  const a = c.stamper_action || 'none';
  actions[a] = (actions[a]||0) + 1;
}
console.log('\nstamper_action values:', actions);
