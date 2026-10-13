// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// T3 — Evidence package export tests.
// Covers: round-trip schema validation, FCA disclaimer exactness (DONE-WHEN #6),
// missing-required-field rejections, artifact sha256 correctness, and
// additionalProperties enforcement.
// Node 24 provides globalThis.crypto so crypto.subtle is available natively.
import { describe, test, expect } from 'vitest';
import Ajv from 'ajv';
import schema from '../../../../public/schemas/evidence-package.schema.json';
import {
  buildEvidencePackage,
  validateEvidencePackage,
  sha256Hex,
  FCA_DISCLAIMER,
  type BuildEvidencePackageParams,
} from '../evidencePackageService';
import { generateReadinessPosture } from '@/vendored/ces-spine/services/postureGenerator';
import type { AssessedParty, InterviewSession } from '@/shared/types/engagement';

// ---------------------------------------------------------------------------
// SHA-256("hello") in hex — precomputed reference constant for artifact hash test.
// Verified against RFC 4634 / NIST test vectors.
// ---------------------------------------------------------------------------
const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

const ajv = new Ajv({ strict: true });
const ajvValidate = ajv.compile(schema);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockParty: AssessedParty = {
  id: 'party-t3-1',
  engagement_id: 'eng-t3-1',
  name: 'T3 Test Corp',
  uei: 'ABCDEFGHIJ12',
  cage: '1A2B3',
  on_prem_ot: 'no',
  created_at: '2026-01-01T00:00:00Z',
};

// Session with mixed provenance facts: auto_detected, captured, operator_interview
const mockSession: InterviewSession = {
  id: 'sess-t3-1',
  party_id: 'party-t3-1',
  facts: [
    {
      question_id: 'iam-001',
      question_text: 'Does the org enforce MFA for all users?',
      answer: 'yes',
      provenance: 'operator_interview',
      confidence: 'high',
      recorded_at: '2026-01-01T10:00:00Z',
    },
    {
      question_id: 'cm-001',
      question_text: 'Is a configuration baseline documented and maintained?',
      answer: 'partial',
      provenance: 'auto_detected',
      confidence: 'medium',
      recorded_at: '2026-01-01T10:05:00Z',
    },
    {
      question_id: 'ir-001',
      question_text: 'Does the org have a documented incident response plan?',
      answer: 'no',
      provenance: 'captured',
      confidence: 'low',
      recorded_at: '2026-01-01T10:10:00Z',
    },
  ],
  timing_segments: [],
  status: 'complete',
  created_at: '2026-01-01T09:00:00Z',
  completed_at: '2026-01-01T10:15:00Z',
};

const mockPosture = generateReadinessPosture({}, [], {}, {});

const baseParams: BuildEvidencePackageParams = {
  session: mockSession,
  party: mockParty,
  posture: mockPosture,
  conservativeScore: 42,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('T3 — Evidence Package Export', () => {
  test('round-trip: built package validates against committed schema (mixed provenance)', async () => {
    const pkg = await buildEvidencePackage(baseParams);

    // Structural assertions
    expect(pkg.package_version).toBe('1.0');
    expect(pkg.party.id).toBe('party-t3-1');
    expect(pkg.party.name).toBe('T3 Test Corp');
    expect(pkg.session_id).toBe('sess-t3-1');
    expect(pkg.facts).toHaveLength(3);

    // All three provenance values present
    const provenances = pkg.facts.map((f) => f.provenance);
    expect(provenances).toContain('operator_interview');
    expect(provenances).toContain('auto_detected');
    expect(provenances).toContain('captured');

    // Confidence values preserved verbatim
    expect(pkg.facts[0].confidence).toBe('high');
    expect(pkg.facts[1].confidence).toBe('medium');
    expect(pkg.facts[2].confidence).toBe('low');

    // AJV validation against committed schema
    const valid = ajvValidate(pkg);
    if (!valid) console.error('AJV errors:', ajvValidate.errors);
    expect(valid).toBe(true);
  });

  test('fca_disclaimer is embedded and exact (DONE-WHEN #6)', async () => {
    const pkg = await buildEvidencePackage(baseParams);
    expect(pkg.fca_disclaimer).toBe(
      'Self-assessed indicator — not a certification, not an SPRS submission, and not a quote-binding gap report.'
    );
    expect(pkg.fca_disclaimer).toBe(FCA_DISCLAIMER);
  });

  test('missing fca_disclaimer → schema invalid', () => {
    const pkg = {
      package_version: '1.0',
      generated_at: '2026-01-01T00:00:00.000Z',
      party: { id: 'p1', name: 'Test Corp' },
      session_id: 'sess-1',
      // fca_disclaimer intentionally omitted
      facts: [],
      posture_summary: {
        conservative_score: 0,
        control_status_summary: { met: 0, partial: 0, not_met: 0, unknown: 0 },
      },
      sprs: null,
      artifacts: [],
    };
    const result = validateEvidencePackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  test('missing provenance in a fact → schema invalid', () => {
    const pkg = {
      package_version: '1.0',
      generated_at: '2026-01-01T00:00:00.000Z',
      party: { id: 'p1', name: 'Test Corp' },
      session_id: 'sess-1',
      fca_disclaimer: FCA_DISCLAIMER,
      facts: [
        {
          question_id: 'q1',
          question_text: 'Does the org enforce MFA?',
          answer: 'yes',
          // provenance intentionally omitted
          confidence: 'high',
          recorded_at: '2026-01-01T10:00:00Z',
        },
      ],
      posture_summary: {
        conservative_score: 0,
        control_status_summary: { met: 0, partial: 0, not_met: 0, unknown: 0 },
      },
      sprs: null,
      artifacts: [],
    };
    const result = validateEvidencePackage(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  test('artifact sha256 is correct for a known string', async () => {
    const hash = await sha256Hex('hello');
    expect(hash).toBe(HELLO_SHA256);
  });

  test('artifact sha256 is embedded in built package when embedded_content is provided', async () => {
    const params: BuildEvidencePackageParams = {
      ...baseParams,
      artifacts: [
        {
          name: 'harvest-snapshot.json',
          content_type: 'application/json',
          embedded_content: 'hello',
        },
      ],
    };
    const pkg = await buildEvidencePackage(params);
    expect(pkg.artifacts).toHaveLength(1);
    expect(pkg.artifacts[0].sha256).toBe(HELLO_SHA256);
    expect(pkg.artifacts[0].embedded_content).toBe('hello');

    // Package with artifact still validates
    const valid = ajvValidate(pkg);
    if (!valid) console.error('AJV errors (artifact):', ajvValidate.errors);
    expect(valid).toBe(true);
  });

  test('validateEvidencePackage rejects additionalProperties', async () => {
    const pkg = await buildEvidencePackage(baseParams);
    // Inject a top-level property not in the schema
    const tampered = { ...pkg, extra_field: 'this should be rejected' };
    const result = validateEvidencePackage(tampered);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  test('sprs field: null is valid; object with sprs+assessed_count is valid', async () => {
    const withNullSprs = await buildEvidencePackage({ ...baseParams, sprs: null });
    expect(ajvValidate(withNullSprs)).toBe(true);

    const withSprs = await buildEvidencePackage({
      ...baseParams,
      sprs: { sprs: 88, assessed_count: 110 },
    });
    expect(withSprs.sprs).toEqual({ sprs: 88, assessed_count: 110 });
    expect(ajvValidate(withSprs)).toBe(true);
  });
});
