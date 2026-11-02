// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

const CONTROLS_REF_PATH = _require.resolve('ces-shared/data/cmmc-l2-controls');
const OUTPUT_PATH = path.resolve(__dirname, '../docs/context/MANUAL_GATE_AUDIT.md');

// Imported inline to avoid ES module import issues in script context
const MANUAL_GATE_CONTROLS = new Set([
  'AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3',
  'PE.L1-3.10.1', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5',
  'PE.L2-3.10.2', 'PE.L2-3.10.6',
  'PS.L2-3.9.1', 'PS.L2-3.9.2',
  'CA.L2-3.12.1', 'CA.L2-3.12.2', 'CA.L2-3.12.3', 'CA.L2-3.12.4',
  'IR.L2-3.6.2', 'IR.L2-3.6.3',
  'MA.L2-3.7.1', 'MA.L2-3.7.2',
  'AU.L2-3.3.5', 'AU.L2-3.3.8', 'AU.L2-3.3.9',
  'MP.L2-3.8.4', 'MP.L2-3.8.9',
  'RA.L2-3.11.1', 'RA.L2-3.11.2',
  'SC.L2-3.13.7',
  'SI.L2-3.14.4',
]);

interface CmmcControl {
  control_id: string;
  family: string;
  cmmc_level: number;
  nist_ref: string;
  practice: string;
}

interface ControlsReference {
  total_controls: number;
  controls: CmmcControl[];
}

// Manual gate rationale by family
const FAMILY_RATIONALE: Record<string, string> = {
  AT: 'No M365 automation possible (training programs require human administration and tracking)',
  PE: 'No M365 automation possible (physical security controls require physical access management)',
  PS: 'No M365 automation possible (personnel screening requires HR processes)',
  CA: 'No M365 automation possible (security assessments require human judgment and C3PAO involvement)',
  IR: 'No M365 automation possible (incident response testing and reporting require human coordination)',
  MA: 'No M365 automation possible (maintenance procedures require physical/administrative oversight)',
  AU: 'Partial automation possible but process controls require manual oversight (audit review, correlation analysis)',
  MP: 'Partial automation possible but media marking/backup protection requires procedural controls',
  RA: 'No M365 automation possible (risk assessments require human risk analysis and judgment)',
  SC: 'Partial automation possible but split tunneling prevention requires network-level policy beyond M365',
  SI: 'Partial automation possible but malware update verification requires process validation',
};

// Families where ALL controls are manual gate
const FULLY_MANUAL_FAMILIES = new Set(['AT', 'PE', 'PS']);

function getAutomationPossible(family: string, controlId: string): string {
  if (FULLY_MANUAL_FAMILIES.has(family)) return 'no';
  // Specific controls that could theoretically be automated in the future
  const futureAutomation = new Set([
    'AU.L2-3.3.5', 'AU.L2-3.3.8', 'AU.L2-3.3.9',
    'MP.L2-3.8.4', 'MP.L2-3.8.9',
    'SC.L2-3.13.7',
    'SI.L2-3.14.4',
  ]);
  if (futureAutomation.has(controlId)) return 'future';
  return 'no';
}

function getRationale(family: string, isManualGate: boolean): string {
  if (!isManualGate) return 'Automated via M365/Azure signals and infrastructure manifest data';
  return FAMILY_RATIONALE[family] ?? 'Manual process control required';
}

// --- Main ---
console.log('Manual Gate Control Audit');
console.log('========================\n');

const ref: ControlsReference = JSON.parse(fs.readFileSync(CONTROLS_REF_PATH, 'utf-8'));
console.log(`Total controls in reference: ${ref.total_controls}`);
console.log(`Controls loaded: ${ref.controls.length}`);
console.log(`Manual gate controls in set: ${MANUAL_GATE_CONTROLS.size}\n`);

// Build audit table
const lines: string[] = [];
lines.push('# Manual Gate Control Audit');
lines.push('');
lines.push(`**Generated:** ${new Date().toISOString()}`);
lines.push(`**Total Controls:** ${ref.controls.length}`);
lines.push(`**Manual Gate Controls:** ${MANUAL_GATE_CONTROLS.size}`);
lines.push(`**Automated Controls:** ${ref.controls.length - MANUAL_GATE_CONTROLS.size}`);
lines.push('');
lines.push('## Summary by Family');
lines.push('');
lines.push('| Family | Total | Manual Gate | Automated | Notes |');
lines.push('|--------|-------|-------------|-----------|-------|');

// Group by family
const familyGroups = new Map<string, CmmcControl[]>();
for (const ctrl of ref.controls) {
  if (!familyGroups.has(ctrl.family)) familyGroups.set(ctrl.family, []);
  familyGroups.get(ctrl.family)!.push(ctrl);
}

for (const [family, controls] of familyGroups) {
  const manualCount = controls.filter(c => MANUAL_GATE_CONTROLS.has(c.control_id)).length;
  const autoCount = controls.length - manualCount;
  const allManual = manualCount === controls.length;
  const notes = allManual ? 'All manual (no M365 automation)' : manualCount > 0 ? 'Mixed' : 'All automated';
  lines.push(`| ${family} | ${controls.length} | ${manualCount} | ${autoCount} | ${notes} |`);
}

lines.push('');
lines.push('## Full Control Table');
lines.push('');
lines.push('| controlId | family | isManualGate | rationale | automationPossible |');
lines.push('|-----------|--------|-------------|-----------|-------------------|');

for (const ctrl of ref.controls) {
  const isManualGate = MANUAL_GATE_CONTROLS.has(ctrl.control_id);
  const rationale = getRationale(ctrl.family, isManualGate);
  const automationPossible = isManualGate ? getAutomationPossible(ctrl.family, ctrl.control_id) : 'yes';

  lines.push(`| ${ctrl.control_id} | ${ctrl.family} | ${isManualGate ? 'yes' : 'no'} | ${rationale} | ${automationPossible} |`);
}

lines.push('');

const output = lines.join('\n');

// Write output
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, output, 'utf-8');

console.log(`Audit written to: ${OUTPUT_PATH}`);
console.log(`\nManual gate controls (${MANUAL_GATE_CONTROLS.size}):`);
for (const cid of MANUAL_GATE_CONTROLS) {
  console.log(`  ${cid}`);
}
