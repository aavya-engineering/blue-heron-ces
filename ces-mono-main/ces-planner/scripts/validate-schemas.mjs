// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { readFileSync } from 'fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'js-yaml';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const pairs = [
  {
    name: 'Capability Taxonomy',
    schema: 'public/schemas/domain CES Capability Taxonomy.schema.json',
    data: 'public/data/domain Capability Taxonomy.yaml',
  },
  {
    name: 'Implementation Patterns',
    schema: 'public/schemas/domain CES Implementation Patterns.schema.json',
    data: 'public/data/domain Implementation Patterns.yaml',
  },
  {
    name: 'Vendor Playbook (M365)',
    schema: 'public/schemas/domain CES Vendor Playbook.schema.json',
    data: 'public/data/vendor playbook Microsoft 365.yaml',
  },
];

let allPassed = true;

for (const { name, schema, data } of pairs) {
  console.log(`\n=== ${name} ===`);
  const schemaObj = JSON.parse(readFileSync(schema, 'utf-8'));
  const dataObj = YAML.load(readFileSync(data, 'utf-8'));

  const validate = ajv.compile(schemaObj);
  const valid = validate(dataObj);

  if (valid) {
    console.log('  PASS');
  } else {
    allPassed = false;
    console.log('  FAIL');
    for (const err of validate.errors.slice(0, 15)) {
      console.log(`  ${err.instancePath} — ${err.message} ${err.params ? JSON.stringify(err.params) : ''}`);
    }
    if (validate.errors.length > 15) {
      console.log(`  ... and ${validate.errors.length - 15} more errors`);
    }
  }
}

console.log(`\n${allPassed ? 'All schemas passed.' : 'Some schemas failed.'}`);
process.exit(allPassed ? 0 : 1);
