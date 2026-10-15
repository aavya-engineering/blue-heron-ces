// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Integration test: Generate a full POA&M DOCX from real tenant data.
 * Usage: npx tsx scripts/integration-test-poam.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PoamGenerator } from '../src/eo/poam/PoamGenerator.js';
import { PoamDocxExporter } from '../src/eo/poam/PoamDocxExporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const planData = 'C:/CES_Pipeline/Stamper/plan-data/vfsgov-xtra';

async function main() {
  console.log('=== POA&M DOCX Integration Test ===\n');

  // 1. Load assessment snapshot
  const assessmentPath = path.join(root, 'storage/assessments/latest.json');
  console.log(`Loading assessment: ${assessmentPath}`);
  const assessment = JSON.parse(fs.readFileSync(assessmentPath, 'utf-8'));
  console.log(`  Controls: ${assessment.controls?.length ?? 0}`);
  console.log(`  SPRS: ${assessment.sprs_score}`);
  console.log(`  Met: ${assessment.controls_met}, Not Met: ${assessment.controls_not_met}, Not Assessed: ${assessment.controls_not_assessed}\n`);

  // 2. Load variables
  const variablesPath = path.join(planData, 'variables.json');
  console.log(`Loading variables: ${variablesPath}`);
  const variables = JSON.parse(fs.readFileSync(variablesPath, 'utf-8'));
  console.log(`  Keys: ${Object.keys(variables).length}\n`);

  // 3. Load mission plan (graceful degradation if missing)
  const plansDir = path.join(planData, 'plans');
  const planFiles = fs.readdirSync(plansDir).sort();
  const missionPlanFile = planFiles.filter(f => f.includes('mission-plan-')).pop();

  console.log('Loading mission plan:');
  console.log(`  File: ${missionPlanFile}\n`);

  let missionPlan;
  try {
    if (missionPlanFile) {
      const mpPath = path.join(plansDir, missionPlanFile);
      missionPlan = JSON.parse(fs.readFileSync(mpPath, 'utf-8'));
      console.log('  Mission plan loaded successfully\n');
    } else {
      console.warn('  No mission plan file found');
      console.warn('  Continuing without mission plan\n');
      missionPlan = undefined;
    }
  } catch (err) {
    console.warn(`  Mission plan loading failed: ${(err as Error).message}`);
    console.warn('  Continuing without mission plan\n');
    missionPlan = undefined;
  }

  // 4. Generate POA&M
  const _require = createRequire(import.meta.url);
  const controlsRef = _require.resolve('ces-shared/data/cmmc-l2-controls');
  const sprsWeights = _require.resolve('ces-shared/data/sprs-weights');

  console.log('Generating PlanOfActionMilestones...');
  const generator = new PoamGenerator(controlsRef, sprsWeights);
  const poam = generator.generate({
    assessment,
    missionPlan,
  });

  console.log(`  POA&M ID: ${poam.poamId}`);
  console.log(`  SPRS Score: ${poam.sprsScore}`);
  console.log(`  Total Items: ${poam.summary.totalItems}`);
  console.log(`  Open Items: ${poam.summary.openItems}`);
  console.log(`  Total Weight on POA&M: ${poam.summary.totalWeightOnPoam}`);
  console.log(`  Projected Score After POA&M: ${poam.summary.projectedScoreAfterPoam}`);
  console.log(`  Certification Path: ${poam.eligibility.certificationPath.toUpperCase()}`);
  console.log(`  Eligible: ${poam.eligibility.eligible}`);
  console.log(`  Blockers: ${poam.eligibility.blockers.length}\n`);

  // 5. Export to DOCX
  console.log('Exporting to DOCX...');
  const exporter = new PoamDocxExporter();
  const docxBuffer = await exporter.export(poam);

  const outputPath = path.join(root, 'test-poam-output.docx');
  fs.writeFileSync(outputPath, docxBuffer);
  console.log(`  Size: ${(docxBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`  Written to: ${outputPath}\n`);

  console.log('=== Integration Test PASSED ===');
  console.log('Open test-poam-output.docx in Word to verify visually.');
}

main().catch(err => {
  console.error('=== Integration Test FAILED ===');
  console.error(err);
  process.exit(1);
});
