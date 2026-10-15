// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Integration test: Build a complete evidence package with SSP, POA&M, and artifacts.
 * Usage: npx tsx scripts/integration-test-package.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SspGenerator } from '../src/eo/ssp/SspGenerator.js';
import { SspDocxExporter } from '../src/eo/ssp/SspDocxExporter.js';
import { PoamGenerator } from '../src/eo/poam/PoamGenerator.js';
import { PoamDocxExporter } from '../src/eo/poam/PoamDocxExporter.js';
import { EvidencePackager } from '../src/eo/packager/EvidencePackager.js';
import { SnippetDataResolver } from '../src/eo/ssp/SnippetDataResolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const planData = 'C:/CES_Pipeline/Stamper/plan-data/vfsgov-xtra';

async function main() {
  console.log('=== Evidence Package Integration Test ===\n');

  // 1. Load assessment snapshot
  const assessmentPath = path.join(root, 'storage/assessments/latest.json');
  console.log(`Loading assessment: ${assessmentPath}`);
  const assessment = JSON.parse(fs.readFileSync(assessmentPath, 'utf-8'));
  console.log(`  Controls: ${assessment.controls?.length ?? 0}`);
  console.log(`  SPRS: ${assessment.sprs_score}\n`);

  // 2. Load variables
  const variablesPath = path.join(planData, 'variables.json');
  console.log(`Loading variables: ${variablesPath}`);
  const variables = JSON.parse(fs.readFileSync(variablesPath, 'utf-8'));
  console.log(`  Keys: ${Object.keys(variables).length}\n`);

  // 3. Load manifests via SnippetDataResolver
  const resolver = new SnippetDataResolver();
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
  let missionPlanData;
  try {
    manifests = await resolver.loadManifests('vfsgov-xtra', {
      tenantManifestPath: tenantManifest ? path.join(plansDir, tenantManifest) : undefined,
      infraManifestPath: infraManifest ? path.join(plansDir, infraManifest) : undefined,
      missionPlanPath: missionPlan ? path.join(plansDir, missionPlan) : undefined,
    });
    if (missionPlan) {
      missionPlanData = JSON.parse(fs.readFileSync(path.join(plansDir, missionPlan), 'utf-8'));
    }
    console.log('  Manifests loaded successfully\n');
  } catch (err) {
    console.warn(`  Manifest loading failed: ${(err as Error).message}`);
    console.warn('  Continuing without manifests\n');
    manifests = undefined;
    missionPlanData = undefined;
  }

  // 4. Generate SSP JSON
  const _require = createRequire(import.meta.url);
  const controlsRef = _require.resolve('ces-shared/data/cmmc-l2-controls');
  const sprsWeights = _require.resolve('ces-shared/data/sprs-weights');

  console.log('Generating SystemSecurityPlan...');
  const sspGenerator = new SspGenerator(controlsRef, sprsWeights, resolver);
  const ssp = sspGenerator.generate({
    assessment,
    variables,
    manifests: manifests || undefined,
  });
  console.log(`  System: ${ssp.systemName}`);
  console.log(`  Controls: ${ssp.controlImplementations.length}\n`);

  // 5. Generate SSP DOCX
  console.log('Exporting SSP DOCX...');
  const sspExporter = new SspDocxExporter();
  const sspDocxBuffer = await sspExporter.export(ssp);
  console.log(`  SSP DOCX size: ${(sspDocxBuffer.length / 1024).toFixed(1)} KB\n`);

  // 6. Create temp directory and write SSP files
  const tempDir = path.join(root, 'storage/temp');
  fs.mkdirSync(tempDir, { recursive: true });

  const sspJsonPath = path.join(tempDir, 'ssp-temp.json');
  const sspDocxPath = path.join(tempDir, 'ssp-temp.docx');
  fs.writeFileSync(sspJsonPath, JSON.stringify(ssp, null, 2));
  fs.writeFileSync(sspDocxPath, sspDocxBuffer);
  console.log(`SSP files written to temp:\n  ${sspJsonPath}\n  ${sspDocxPath}\n`);

  // 7. Generate POA&M JSON
  console.log('Generating PlanOfActionMilestones...');
  const poamGenerator = new PoamGenerator(controlsRef, sprsWeights);
  const poam = poamGenerator.generate({
    assessment,
    missionPlan: missionPlanData,
  });
  console.log(`  Total Items: ${poam.summary.totalItems}`);
  console.log(`  Certification Path: ${poam.eligibility.certificationPath}\n`);

  // 8. Generate POA&M DOCX
  console.log('Exporting POA&M DOCX...');
  const poamExporter = new PoamDocxExporter();
  const poamDocxBuffer = await poamExporter.export(poam);
  console.log(`  POA&M DOCX size: ${(poamDocxBuffer.length / 1024).toFixed(1)} KB\n`);

  // 9. Write POA&M files to temp
  const poamJsonPath = path.join(tempDir, 'poam-temp.json');
  const poamDocxPath = path.join(tempDir, 'poam-temp.docx');
  fs.writeFileSync(poamJsonPath, JSON.stringify(poam, null, 2));
  fs.writeFileSync(poamDocxPath, poamDocxBuffer);
  console.log(`POA&M files written to temp:\n  ${poamJsonPath}\n  ${poamDocxPath}\n`);

  // 10. Build evidence package
  console.log('Building evidence package...');
  const packager = new EvidencePackager(controlsRef);
  const outputDir = path.join(root, 'storage/packages');

  const result = await packager.build({
    assessment,
    sspPath: sspJsonPath,
    sspDocxPath: sspDocxPath,
    poamPath: poamJsonPath,
    poamDocxPath: poamDocxPath,
    outputDir,
  });

  console.log(`  Package ID: ${result.packageId}`);
  console.log(`  File Path: ${result.filePath}`);
  console.log(`  File Count: ${result.fileCount}`);
  console.log(`  Size: ${(result.sizeBytes / 1024).toFixed(1)} KB\n`);

  if (result.fileCount === 0) {
    throw new Error('Package build failed: fileCount is 0');
  }

  console.log('=== Integration Test PASSED ===');
  console.log(`Evidence package written to: ${result.filePath}`);
  console.log('Extract the .zip to verify structure: cover-sheet.json, ssp/, poam/, assessments/, integrity-manifest.json');
}

main().catch(err => {
  console.error('=== Integration Test FAILED ===');
  console.error(err);
  process.exit(1);
});
