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
import Handlebars from 'handlebars';
import Ajv from 'ajv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATES_DIR = path.resolve(__dirname, '../src/eo/data/snippet-templates');
const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures/snippet-validation');
const SCHEMAS_DIR = path.resolve(__dirname, '../src/eo/data/template-variables');

// Map template file names to fixture file names
const FIXTURE_MAP: Record<string, string> = {
  'AC.L2-3.1.1.hbs': 'ac-fixture.json',
  'IA.L2-3.5.1.hbs': 'ia-fixture.json',
  'SC.L2-3.13.11.hbs': 'sc-fixture.json',
};

function getFixturePath(templateFile: string): string {
  // Check explicit map first
  if (FIXTURE_MAP[templateFile]) return FIXTURE_MAP[templateFile];

  // Extract family prefix: "AC.L2-3.1.1.hbs" -> "AC"
  // Pattern: Match 2-3 uppercase letters before first dot
  const match = templateFile.match(/^([A-Z]{2,3})\./);
  if (match) {
    const family = match[1];
    return `${family.toLowerCase()}-fixture.json`;
  }

  throw new Error(`Cannot determine fixture path for ${templateFile}`);
}

const ERROR_MARKERS = ['[object Object]', 'undefined'];

interface ValidationResult {
  template: string;
  passed: boolean;
  error?: string;
  schemaWarning?: string;
}

const ajv = new Ajv();

function getControlFamily(templateFile: string): string {
  // Extract family from control ID: "AC.L2-3.1.1.hbs" -> "ac"
  const controlId = templateFile.replace('.hbs', '');
  const family = controlId.split('.')[0].toLowerCase();
  return family;
}

function validateSchema(templateFile: string, fixtureData: Record<string, unknown>): string | undefined {
  const family = getControlFamily(templateFile);
  const schemaPath = path.join(SCHEMAS_DIR, `${family}-variables.schema.json`);

  if (!fs.existsSync(schemaPath)) {
    return `No schema found for family "${family}" at ${schemaPath}`;
  }

  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const validate = ajv.compile(schema);
    const valid = validate(fixtureData);
    if (!valid && validate.errors) {
      const errors = validate.errors.map(e =>
        `Template ${templateFile} fixture ${e.message}${e.params && 'missingProperty' in e.params ? `: ${e.params.missingProperty}` : ''}`
      );
      return errors.join('; ');
    }
  } catch (err) {
    return `Schema validation error: ${(err as Error).message}`;
  }

  return undefined;
}

function validateTemplate(templateFile: string): ValidationResult {
  const templatePath = path.join(TEMPLATES_DIR, templateFile);
  const result: ValidationResult = { template: templateFile, passed: false };

  // Step 1: Read template source
  let source: string;
  try {
    source = fs.readFileSync(templatePath, 'utf-8');
  } catch (err) {
    result.error = `Failed to read template: ${(err as Error).message}`;
    return result;
  }

  // Step 2: Compile template
  let compiled: HandlebarsTemplateDelegate;
  try {
    compiled = Handlebars.compile(source);
  } catch (err) {
    result.error = `Handlebars compilation failed: ${(err as Error).message}`;
    return result;
  }

  // Step 3: Load fixture data
  let fixtureFile: string;
  try {
    fixtureFile = getFixturePath(templateFile);
  } catch (err) {
    result.error = `No fixture data found for template ${templateFile}: ${(err as Error).message}`;
    return result;
  }

  let fixtureData: Record<string, unknown>;
  try {
    const fixturePath = path.join(FIXTURES_DIR, fixtureFile);
    fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  } catch (err) {
    result.error = `Failed to load fixture: ${(err as Error).message}`;
    return result;
  }

  // Step 4: Schema validation using ajv
  const schemaError = validateSchema(templateFile, fixtureData);
  if (schemaError) {
    result.schemaWarning = schemaError;
  }

  // Step 5: Render template with fixture data
  let output: string;
  try {
    output = compiled(fixtureData);
  } catch (err) {
    result.error = `Handlebars rendering failed: ${(err as Error).message}`;
    return result;
  }

  // Step 6: Validate output
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    result.error = 'Rendered output is empty';
    return result;
  }

  // Check for error markers
  for (const marker of ERROR_MARKERS) {
    if (trimmed.includes(marker)) {
      result.error = `Output contains error marker: "${marker}"`;
      return result;
    }
  }

  result.passed = true;
  return result;
}

// --- Main ---
console.log('Snippet Template Validation');
console.log('===========================\n');

// Discover all .hbs templates
const templateFiles = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.hbs'));
console.log(`Found ${templateFiles.length} template(s) in ${TEMPLATES_DIR}\n`);

const results: ValidationResult[] = [];
let hasFailure = false;

for (const templateFile of templateFiles) {
  const result = validateTemplate(templateFile);
  results.push(result);

  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${result.template}`);
  if (result.error) {
    console.log(`         Error: ${result.error}`);
  }
  if (result.schemaWarning) {
    console.log(`         Schema: ${result.schemaWarning}`);
  }

  if (!result.passed) {
    hasFailure = true;
  }
}

console.log(`\n${results.filter(r => r.passed).length}/${results.length} templates passed validation.`);

if (hasFailure) {
  process.exit(1);
}

process.exit(0);
