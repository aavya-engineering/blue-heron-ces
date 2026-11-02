// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PL-1 H1 — the JSON schema and the runtime enforcer provably agree.
//
// muster-api stays self-contained (no ajv runtime dependency): the single
// runtime enforcer is the hand-rolled validateConfigFact(). This test proves it
// agrees with config-fact.schema.json BOTH ways over a fixture set, by driving
// each fixture through:
//   (1) validateConfigFact()  — the runtime enforcer, and
//   (2) schemaCheck()         — a compact checker that INTERPRETS the schema
//       file's own declared keywords (required / additionalProperties / type /
//       minLength / enum / const). schemaCheck consumes the committed schema as
//       DATA, so it cannot drift from it — it is a test-only oracle, never a
//       second runtime validator or a second schema.
// Agreement = for every fixture, both verdicts are identical. Any divergence
// (e.g. an extra property the validator forgot to reject) fails the test.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateConfigFact, CONFIG_FACT_KEYS } from '../src/services/recipeIngestService.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(resolve(here, '..', 'schemas', 'config-fact.schema.json'), 'utf-8')
) as {
  required: string[];
  additionalProperties: boolean;
  properties: Record<
    string,
    { type?: string; minLength?: number; enum?: string[]; const?: string }
  >;
};

/**
 * A minimal JSON-Schema-subset checker driven entirely by the schema object
 * above. Supports exactly the keywords config-fact.schema.json uses. Returns
 * true iff `obj` satisfies the schema. Test-only oracle.
 */
function schemaCheck(obj: unknown): boolean {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  const f = obj as Record<string, unknown>;
  // required
  for (const key of schema.required) {
    if (!(key in f)) return false;
  }
  // additionalProperties: false
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(f)) {
      if (!allowed.has(key)) return false;
    }
  }
  // per-property constraints (only for present keys)
  for (const [key, spec] of Object.entries(schema.properties)) {
    if (!(key in f)) continue;
    const v = f[key];
    if (spec.type === 'string' && typeof v !== 'string') return false;
    if (spec.minLength !== undefined && (typeof v !== 'string' || v.length < spec.minLength))
      return false;
    if (spec.enum !== undefined && !spec.enum.includes(v as string)) return false;
    if (spec.const !== undefined && v !== spec.const) return false;
  }
  return true;
}

const validFact = {
  question_id: 'iam-001',
  answer: 'yes',
  provenance: 'captured',
  confidence: 'high',
  captured_at: '2026-07-27T10:00:00Z',
  source: 'recipe:entra-mfa-report@1.0.0',
};

// Each fixture pairs a case with a label; expected verdict is NOT hard-coded —
// the two validators must simply AGREE on it (and we separately assert the valid
// fixture is accepted and each invalid one is rejected, so agreement can't be
// vacuously "both wrong").
const fixtures: Array<{ label: string; value: unknown; expectValid: boolean }> = [
  { label: 'valid fact', value: validFact, expectValid: true },
  { label: 'answer not in enum', value: { ...validFact, answer: 'maybe' }, expectValid: false },
  { label: 'provenance not const', value: { ...validFact, provenance: 'auto_detected' }, expectValid: false },
  { label: 'confidence not const', value: { ...validFact, confidence: 'low' }, expectValid: false },
  { label: 'question_id empty (minLength)', value: { ...validFact, question_id: '' }, expectValid: false },
  { label: 'source empty (minLength)', value: { ...validFact, source: '' }, expectValid: false },
  { label: 'captured_at wrong type', value: { ...validFact, captured_at: 12345 }, expectValid: false },
  { label: 'missing required field (source)', value: (() => { const c = { ...validFact } as Record<string, unknown>; delete c.source; return c; })(), expectValid: false },
  { label: 'extra property (additionalProperties:false)', value: { ...validFact, injected: 'x' }, expectValid: false },
  { label: 'null', value: null, expectValid: false },
  { label: 'array', value: [validFact], expectValid: false },
];

describe('H1 — config-fact.schema.json and validateConfigFact provably agree', () => {
  it('the runtime validator enforces exactly the schema-declared key set', () => {
    // Ties CONFIG_FACT_KEYS (what the validator uses for additionalProperties)
    // to the schema's own property set + required list.
    expect([...CONFIG_FACT_KEYS].sort()).toEqual(Object.keys(schema.properties).sort());
    expect([...CONFIG_FACT_KEYS].sort()).toEqual([...schema.required].sort());
    expect(schema.additionalProperties).toBe(false);
    // The enum/const rules the validator hard-codes match the schema.
    expect(schema.properties.answer.enum).toEqual(['yes', 'no']);
    expect(schema.properties.provenance.const).toBe('captured');
    expect(schema.properties.confidence.const).toBe('high');
  });

  it.each(fixtures)('agrees on: $label', ({ value, expectValid }) => {
    const bySchema = schemaCheck(value);
    const byValidator = validateConfigFact(value);
    // Both-ways agreement: schema oracle and runtime validator return the same.
    expect(byValidator).toBe(bySchema);
    // And that shared verdict is the correct one (non-vacuous agreement).
    expect(byValidator).toBe(expectValid);
  });
});
