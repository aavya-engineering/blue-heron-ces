// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * convert-objectives-yaml-to-json.cjs
 *
 * Parses C:\Users\mhsut\DevProjects\cse-fe-v2\data\domain CES CMMC Fundamental Requirements Store.yaml
 * and extracts assessment_objectives into a JSON reference file for runtime use.
 *
 * Usage: node scripts/convert-objectives-yaml-to-json.cjs
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const YAML_PATH = 'C:\\Users\\mhsut\\DevProjects\\cse-fe-v2\\data\\domain CES CMMC Fundamental Requirements Store.yaml';
const OUTPUT_PATH = require.resolve('ces-shared/data/assessment-objectives');
const EXPECTED_OBJECTIVE_COUNT = 324;
const EXPECTED_CONTROL_COUNT = 110;

function main() {
  console.log('Converting assessment objectives from YAML to JSON...');

  // Read and parse YAML
  const yamlContent = fs.readFileSync(YAML_PATH, 'utf-8');
  const data = yaml.load(yamlContent);

  if (!data || !data.requirements || !Array.isArray(data.requirements)) {
    throw new Error('Invalid YAML structure: missing requirements array');
  }

  const objectives = [];
  let controlCount = 0;

  // Extract assessment objectives from each requirement
  for (const req of data.requirements) {
    const controlId = req.requirement_id;
    if (!controlId) {
      console.warn('Skipping requirement with missing requirement_id');
      continue;
    }

    controlCount++;

    if (req.assessment_objectives && Array.isArray(req.assessment_objectives)) {
      for (const obj of req.assessment_objectives) {
        objectives.push({
          objectiveId: obj.id,
          controlId: controlId,
          description: obj.text,
          methods: obj.methods || []
        });
      }
    }
  }

  // Log results
  console.log(`Converted ${objectives.length} objectives across ${controlCount} controls`);

  // Warn if counts don't match expectations
  if (objectives.length !== EXPECTED_OBJECTIVE_COUNT) {
    console.warn(`WARNING: Expected ${EXPECTED_OBJECTIVE_COUNT} objectives, found ${objectives.length}`);
  }
  if (controlCount !== EXPECTED_CONTROL_COUNT) {
    console.warn(`WARNING: Expected ${EXPECTED_CONTROL_COUNT} controls, found ${controlCount}`);
  }

  // Create output directory if needed
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write JSON
  const output = { objectives };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Written to ${OUTPUT_PATH}`);
}

main();
