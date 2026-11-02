// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-READINESS-1 M1 acceptance gate 1 — readiness-result/1.0.0 schema
// validates all three producer flavors (canned, script-upload, tester) and
// rejects malformed payloads. The payload IS the import-file format.
import { describe, test, expect } from 'vitest';
import Ajv from 'ajv';
import schema from '../../../../public/schemas/readiness-result.schema.json';
import {
  READINESS_RESULT_CANNED,
  READINESS_RESULT_SCRIPT_UPLOAD,
  READINESS_RESULT_TESTER,
} from '../../../__fixtures__/readinessResults';

const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema);

function expectValid(payload: unknown): void {
  const valid = validate(payload);
  if (!valid) console.error('AJV errors:', validate.errors);
  expect(valid).toBe(true);
}

describe('readiness-result/1.0.0 schema', () => {
  test('validates the canned fixture flavor', () => {
    expectValid(READINESS_RESULT_CANNED);
  });

  test('validates the script-upload flavor (facts + attestation extension)', () => {
    expectValid(READINESS_RESULT_SCRIPT_UPLOAD);
  });

  test('validates the ces-tester flavor', () => {
    expectValid(READINESS_RESULT_TESTER);
  });

  test('rejects a wrong schema_version', () => {
    const bad = { ...READINESS_RESULT_CANNED, schema_version: 'readiness-result/2.0.0' };
    expect(validate(bad)).toBe(false);
  });

  test('rejects unknown top-level properties (no second format smuggled in)', () => {
    const bad = { ...READINESS_RESULT_CANNED, raw_output: 'inline dump' };
    expect(validate(bad)).toBe(false);
  });

  test('rejects a missing manifest.mode (the session kind is mandatory provenance)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { mode: _mode, ...manifestWithoutMode } = READINESS_RESULT_CANNED.manifest;
    const bad = { ...READINESS_RESULT_CANNED, manifest: manifestWithoutMode };
    expect(validate(bad)).toBe(false);
  });

  test('rejects an invalid derived_posture enum value', () => {
    const bad = {
      ...READINESS_RESULT_CANNED,
      observations: [
        { ...READINESS_RESULT_CANNED.observations[0], derived_posture: 'passed' },
      ],
    };
    expect(validate(bad)).toBe(false);
  });

  test('rejects an objective_coverage bucket outside A/B/C', () => {
    const bad = {
      ...READINESS_RESULT_CANNED,
      observations: [
        {
          ...READINESS_RESULT_CANNED.observations[0],
          objective_coverage: { 'AC.L1-3.1.1[a]': 'D' },
        },
      ],
    };
    expect(validate(bad)).toBe(false);
  });

  test('rejects sprs values outside the DoD floor/ceiling (-203..110)', () => {
    const bad = {
      ...READINESS_RESULT_CANNED,
      derived: { ...READINESS_RESULT_CANNED.derived, sprs_after: 111 },
    };
    expect(validate(bad)).toBe(false);
  });
});
