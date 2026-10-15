// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Diagnostic script: Identify controls with placeholder narratives
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SspGenerator } from '../src/eo/ssp/SspGenerator.js';
import { SnippetDataResolver } from '../src/eo/ssp/SnippetDataResolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const planData = 'C:/CES_Pipeline/Stamper/plan-data/vfsgov-xtra';

async function main() {
  const assessmentPath = path.join(root, 'storage/assessments/latest.json');
  const assessment = JSON.parse(fs.readFileSync(assessmentPath, 'utf-8'));

  const variablesPath = path.join(planData, 'variables.json');
  const variables = JSON.parse(fs.readFileSync(variablesPath, 'utf-8'));

  const resolver = new SnippetDataResolver();

  const plansDir = path.join(planData, 'plans');
  const planFiles = fs.readdirSync(plansDir).sort();

  const tenantManifest = planFiles.filter(f => f.startsWith('tenant-manifest-')).pop();
  const infraManifest = planFiles.filter(f => f.startsWith('infrastructure-manifest-')).pop();
  const missionPlan = planFiles.filter(f => f.includes('mission-plan-')).pop();

  const manifests = await resolver.loadManifests('vfsgov-xtra', {
    tenantManifestPath: tenantManifest ? path.join(plansDir, tenantManifest) : undefined,
    infraManifestPath: infraManifest ? path.join(plansDir, infraManifest) : undefined,
    missionPlanPath: missionPlan ? path.join(plansDir, missionPlan) : undefined,
  });

  const _require = createRequire(import.meta.url);
  const controlsRef = _require.resolve('ces-shared/data/cmmc-l2-controls');
  const sprsWeights = _require.resolve('ces-shared/data/sprs-weights');

  const generator = new SspGenerator(controlsRef, sprsWeights, resolver);
  const ssp = generator.generate({
    assessment,
    variables,
    manifests,
  });

  console.log('=== Placeholder Narrative Analysis ===\n');

  const placeholders = ssp.controlImplementations.filter(c =>
    c.implementationNarrative.includes('not yet documented') ||
    c.implementationNarrative.includes('not documented') ||
    c.implementationNarrative.includes('REQUIRES MANUAL INPUT')
  );

  console.log(`Total controls: ${ssp.controlImplementations.length}`);
  console.log(`Controls with placeholder narratives: ${placeholders.length}\n`);

  console.log('Control IDs with placeholders:');
  for (const ctrl of placeholders) {
    console.log(`  ${ctrl.control_id}: "${ctrl.implementationNarrative.substring(0, 80)}..."`);
  }

  console.log('\nFamily breakdown:');
  const byFamily = new Map<string, number>();
  for (const ctrl of placeholders) {
    byFamily.set(ctrl.family, (byFamily.get(ctrl.family) ?? 0) + 1);
  }
  for (const [family, count] of Array.from(byFamily.entries()).sort()) {
    console.log(`  ${family}: ${count}`);
  }

  console.log('\nSystem name:', ssp.systemName);
  console.log('Organization name:', ssp.organizationName ?? '[MISSING]');
  console.log('CAGE Code:', ssp.cageCode ?? '[MISSING]');
  console.log('UEI Number:', ssp.ueiNumber ?? '[MISSING]');
  console.log('System Identifier:', ssp.systemIdentifier ?? '[MISSING]');
}

main().catch(console.error);
