// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Integration test: Generate a full SSP DOCX from real tenant data.
 * Usage: npx tsx scripts/integration-test-ssp.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SspGenerator } from '../src/eo/ssp/SspGenerator.js';
import { SspDocxExporter } from '../src/eo/ssp/SspDocxExporter.js';
import { SnippetDataResolver } from '../src/eo/ssp/SnippetDataResolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const planData = 'C:/CES_Pipeline/Stamper/plan-data/vfsgov-xtra';

async function main() {
  console.log('=== SSP DOCX Integration Test ===\n');

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

  // 3. Load manifests via SnippetDataResolver
  const resolver = new SnippetDataResolver();

  // Find latest manifest files
  const plansDir = path.join(planData, 'plans');
  const planFiles = fs.readdirSync(plansDir).sort();

  const tenantManifest = planFiles.filter(f => f.startsWith('tenant-manifest-')).pop();
  const infraManifest = planFiles.filter(f => f.startsWith('infrastructure-manifest-')).pop();
  const missionPlan = planFiles.filter(f => f.includes('mission-plan-')).pop();

  console.log('Loading manifests:');
  console.log(`  Tenant: ${tenantManifest}`);
  console.log(`  Infra: ${infraManifest}`);
  console.log(`  Mission: ${missionPlan}\n`);

  let manifests;
  try {
    manifests = await resolver.loadManifests('vfsgov-xtra', {
      tenantManifestPath: tenantManifest ? path.join(plansDir, tenantManifest) : undefined,
      infraManifestPath: infraManifest ? path.join(plansDir, infraManifest) : undefined,
      missionPlanPath: missionPlan ? path.join(plansDir, missionPlan) : undefined,
    });
    console.log('  Manifests loaded successfully\n');
  } catch (err) {
    console.warn(`  Manifest loading failed: ${(err as Error).message}`);
    console.warn('  Continuing without manifests\n');
    manifests = undefined;
  }

  // 4. Generate SSP
  const _require = createRequire(import.meta.url);
  const controlsRef = _require.resolve('ces-shared/data/cmmc-l2-controls');
  const sprsWeights = _require.resolve('ces-shared/data/sprs-weights');

  console.log('Generating SystemSecurityPlan...');
  const generator = new SspGenerator(controlsRef, sprsWeights, resolver);
  const ssp = generator.generate({
    assessment,
    variables,
    manifests: manifests || undefined,
  });

  console.log(`  System: ${ssp.systemName}`);
  console.log(`  Controls: ${ssp.controlImplementations.length}`);
  console.log(`  Version: ${ssp.version}`);

  // Count classifications
  const classCount = { automated: 0, manual: 0, nonstack: 0 };
  for (const ci of ssp.controlImplementations) {
    classCount[ci.classification] = (classCount[ci.classification] ?? 0) + 1;
  }
  console.log(`  Classifications: ${JSON.stringify(classCount)}`);

  // Count narrative sources
  let withNarrative = 0;
  let placeholder = 0;
  for (const ci of ssp.controlImplementations) {
    if (ci.implementationNarrative && !ci.implementationNarrative.includes('not yet documented') && !ci.implementationNarrative.includes('not documented')) {
      withNarrative++;
    } else {
      placeholder++;
    }
  }
  console.log(`  Narratives: ${withNarrative} populated, ${placeholder} placeholder\n`);

  // 5. Export to DOCX
  console.log('Exporting to DOCX...');
  const exporter = new SspDocxExporter();
  const docxBuffer = await exporter.export(ssp);

  const outputPath = path.join(root, 'test-ssp-output.docx');
  fs.writeFileSync(outputPath, docxBuffer);
  console.log(`  Size: ${(docxBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`  Written to: ${outputPath}\n`);

  console.log('=== Integration Test PASSED ===');
  console.log('Open test-ssp-output.docx in Word to verify visually.');
}

main().catch(err => {
  console.error('=== Integration Test FAILED ===');
  console.error(err);
  process.exit(1);
});
