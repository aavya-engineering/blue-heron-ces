// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DW#9 — StatusPayload schema validation
import { describe, test, expect } from 'vitest';
import Ajv from 'ajv';
import schema from '../../../../public/schemas/status-payload.schema.json';
import { buildStatusPayload, type StatusPayload } from '../statusPayloadService';
import { generateReadinessPosture } from '@/vendored/ces-spine/services/postureGenerator';
import type { Engagement, AssessedParty, InterviewSession } from '@/shared/types/engagement';

const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema);

const mockEngagement: Engagement = {
  id: 'eng-1',
  engagement_kind: 'prime_and_subs',
  created_at: '2026-01-01T00:00:00Z',
};

const mockParty: AssessedParty = {
  id: 'party-1',
  engagement_id: 'eng-1',
  name: 'Test Corp',
  uei: 'ABCDEFGHIJ12',
  cage: '1A2B3',
  on_prem_ot: 'no',
  created_at: '2026-01-01T00:00:00Z',
};

const mockSession: InterviewSession = {
  id: 'sess-1',
  party_id: 'party-1',
  facts: [
    {
      question_id: 'iam-001',
      question_text: 'Does your org enforce MFA?',
      answer: 'yes',
      provenance: 'operator_interview',
      confidence: 'high',
      recorded_at: '2026-01-01T10:00:00Z',
    },
  ],
  timing_segments: [
    {
      segment: 'setup',
      started_at: '2026-01-01T09:00:00Z',
      stopped_at: '2026-01-01T09:15:00Z',
      duration_ms: 900000,
    },
  ],
  status: 'complete',
  created_at: '2026-01-01T09:00:00Z',
  completed_at: '2026-01-01T10:00:00Z',
};

const mockPosture = generateReadinessPosture({}, [], {}, {});

describe('DW#9 — StatusPayload schema validation', () => {
  test('buildStatusPayload produces a valid StatusPayload object', () => {
    const payload: StatusPayload = buildStatusPayload(
      mockEngagement,
      mockParty,
      mockSession,
      34,
      mockPosture
    );

    expect(payload.schema_version).toBe('1.0.0');
    expect(payload.engagement_kind).toBe('prime_and_subs');
    expect(payload.party.name).toBe('Test Corp');
    expect(payload.on_prem_ot).toBe('no');
    expect(payload.interview_facts).toHaveLength(1);
    expect(payload.posture_summary.conservative_score).toBe(34);
    expect(payload.timing_segments).toHaveLength(1);
  });

  test('StatusPayload validates against its JSON Schema', () => {
    const payload: StatusPayload = buildStatusPayload(
      mockEngagement,
      mockParty,
      mockSession,
      34,
      mockPosture
    );
    const valid = validate(payload);
    if (!valid) {
      console.error('AJV validation errors:', validate.errors);
    }
    expect(valid).toBe(true);
  });

  test('individual_contractor payload also validates', () => {
    const indEng: Engagement = { ...mockEngagement, engagement_kind: 'individual_contractor' };
    const indParty: AssessedParty = {
      ...mockParty,
      uei: undefined,
      cage: undefined,
      on_prem_ot: 'unsure',
    };
    const payload = buildStatusPayload(indEng, indParty, { ...mockSession, facts: [] }, 0, mockPosture);
    const valid = validate(payload);
    expect(valid).toBe(true);
  });

  test('SE-1: AJV rejects a payload with a corrupted required field', () => {
    const payload = buildStatusPayload(mockEngagement, mockParty, mockSession, 34, mockPosture);
    // Corrupt a required field — schema_version must be "1.0.0"
    const broken = { ...payload, schema_version: 'bad-version' };
    const valid = validate(broken as unknown as object);
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
  });

  test('embedded posture validates against posture schema', () => {
    const payload = buildStatusPayload(mockEngagement, mockParty, mockSession, 34, mockPosture);
    const summary = payload.posture_summary.control_status_summary;
    // Verify the embedded summary has all required fields from the schema contract
    expect(typeof summary.level).toBe('string');
    expect(typeof summary.met).toBe('number');
    expect(typeof summary.partial).toBe('number');
    expect(typeof summary.not_met).toBe('number');
    expect(typeof summary.unknown).toBe('number');
    // Score must be within bounds
    expect(payload.posture_summary.conservative_score).toBeGreaterThanOrEqual(0);
    expect(payload.posture_summary.conservative_score).toBeLessThanOrEqual(100);
  });
});
