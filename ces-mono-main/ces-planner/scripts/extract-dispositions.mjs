// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { readFileSync } from 'fs';

const plan = JSON.parse(readFileSync('plan-data/plans/manual-mission-plan-2026-03-31T01-49-38-892Z.json', 'utf8'));
const disps = plan.outputs.human_readable_mission_plan.controls;

console.log('Total controls: ' + disps.length);
console.log('');

const byCategory = {};
for (const d of disps) {
  const cat = d.stamper_action;
  if (!(cat in byCategory)) { byCategory[cat] = []; }
  byCategory[cat].push(d);
}
for (const cat of Object.keys(byCategory)) {
  console.log(cat + ': ' + byCategory[cat].length);
}
console.log('');

for (const cat of ['Automated', 'Excluded', 'Non-Stack']) {
  const items = byCategory[cat] || [];
  if (items.length === 0) continue;
  console.log('=== ' + cat + ' (' + items.length + ') ===');
  items.sort((a, b) => a.requirement_id.localeCompare(b.requirement_id));
  for (let i = 0; i < items.length; i++) {
    const d = items[i];
    const gaps = d.gap_classifications.length > 0 ? d.gap_classifications.join(',') : '-';
    const scope = d.scope_status === 'scoped_out' ? 'OUT' : 'IN';
    console.log((i+1) + '. ' + d.requirement_id + ' | ' + d.stamper_action + ' | scope:' + scope + ' | gaps:' + gaps + ' | ' + d.title);
  }
  console.log('');
}
