// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const ep = require('../plan-data/vfsgov-xtra/plans/executable-plan-2026-04-14T00-27-54-661Z.json');
const tasks = ep.execution_graph;
const exclusions = ep.scope_exclusions || [];

console.log('Total tasks:', tasks.length);
console.log('Total exclusions:', exclusions.length);

// manual_gate breakdown
const mg = tasks.filter(t => t.action && t.action.engine === 'manual_gate');
const mgNonEvidence = mg.filter(t => t.type !== 'evidence_collection');
const mgEvidence = mg.filter(t => t.type === 'evidence_collection');

console.log('\nmanual_gate total:', mg.length);
console.log('  non-evidence (non-stack):', mgNonEvidence.length);
console.log('  evidence_collection (duplicates):', mgEvidence.length);

console.log('\nNon-stack tasks:');
mgNonEvidence.forEach(t => {
  console.log(' ', t.step_id, '|', t.type, '|', (t.controls || []).join(','));
});

// Post-fix projection
const realTasks = tasks.filter(t => t.type !== 'evidence_collection');
console.log('\n--- Post-fix projection ---');
console.log('Real tasks (non-evidence):', realTasks.length);
console.log('Exclusions:', exclusions.length);
console.log('Sum:', realTasks.length + exclusions.length);

// Engine breakdown for real tasks
const engines = {};
realTasks.forEach(t => {
  const e = t.action ? t.action.engine : 'none';
  engines[e] = (engines[e] || 0) + 1;
});
console.log('Real tasks by engine:', JSON.stringify(engines, null, 2));
