// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DW#9 — Export pipeline wiring: real Dexie → executeExport → valid StatusPayload
// fake-indexeddb provides a real IndexedDB implementation for the Node test environment.
// Proves the wiring path that App.tsx's handleExport now exercises:
// session from Dexie → scoreFacts → buildStatusPayload → valid schema-compliant payload
//
// The knowledgeLoader is mocked so fetch('/knowledge/*') is not attempted in Node —
// tests that verify the real YAML loading are in noNetworkCalls.test.ts.
import 'fake-indexeddb/auto';
import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock YAML knowledge loader before any other imports that might trigger it
vi.mock('@/features/scoring/knowledgeLoader', () => ({
  loadKnowledge: async () => ({
    patterns: {
      ces: { artifact: 'implementation_patterns', version: '1.0.0', generated_on: '2026-01-01' },
      patterns: [],
    },
    playbook: {
      ces: { artifact: 'vendor_playbook', vendor: 'microsoft_365', version: '1.0.0', generated_on: '2026-01-01' },
      playbook: [],
    },
  }),
  _resetKnowledgeCache: () => {},
}));

import Ajv from 'ajv';
import schema from '../../../../public/schemas/status-payload.schema.json';
import { executeExport } from '../exportPipeline';
import { db } from '@/shared/db/schema';

const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema);

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
  await db.subs.clear();
});

describe('DW#9 — executeExport wiring (real Dexie → payload)', () => {
  test('loads session from Dexie and produces a schema-valid StatusPayload', async () => {
    // Seed Dexie exactly as the app would after a full interview run
    await db.engagements.add({
      id: 'eng-w1',
      engagement_kind: 'prime_and_subs',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.assessed_parties.add({
      id: 'party-w1',
      engagement_id: 'eng-w1',
      name: 'Wired Corp',
      uei: 'ABCDEFGHIJ12',
      cage: '1A2B3',
      on_prem_ot: 'no',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.interview_sessions.add({
      id: 'sess-w1',
      party_id: 'party-w1',
      facts: [
        {
          question_id: 'iam-001',
          question_text: 'Does the organization enforce MFA for all users?',
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
          stopped_at: '2026-01-01T09:10:00Z',
          duration_ms: 600000,
        },
        {
          segment: 'interview',
          started_at: '2026-01-01T09:10:00Z',
          stopped_at: '2026-01-01T10:10:00Z',
          duration_ms: 3600000,
        },
      ],
      status: 'complete',
      created_at: '2026-01-01T09:00:00Z',
      completed_at: '2026-01-01T10:10:00Z',
    });

    const payload = await executeExport('sess-w1');

    // Schema validation
    const valid = validate(payload);
    if (!valid) console.error('AJV errors:', validate.errors);
    expect(valid).toBe(true);

    // Real data flows through the pipe
    expect(payload.party.name).toBe('Wired Corp');
    expect(payload.engagement_kind).toBe('prime_and_subs');
    expect(payload.on_prem_ot).toBe('no');
    expect(payload.interview_facts).toHaveLength(1);
    expect(payload.timing_segments).toHaveLength(2);
    expect(payload.timing_segments[0].segment).toBe('setup');
    expect(payload.posture_summary.conservative_score).toBeGreaterThanOrEqual(0);
  });

  test('executeExport throws when session does not exist', async () => {
    await expect(executeExport('nonexistent-session')).rejects.toThrow('Session not found');
  });

  test('C3: the three profile answers reach the exported StatusPayload.profile', async () => {
    await db.engagements.add({
      id: 'eng-c3',
      engagement_kind: 'individual_contractor',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.assessed_parties.add({
      id: 'party-c3',
      engagement_id: 'eng-c3',
      name: 'Profile Corp',
      on_prem_ot: 'no',
      created_at: '2026-01-01T00:00:00Z',
      employee_count: '50-250',
      has_ssp: 'unsure',
      covers_m365: 'yes',
    });
    await db.interview_sessions.add({
      id: 'sess-c3',
      party_id: 'party-c3',
      facts: [],
      timing_segments: [],
      status: 'complete',
      created_at: '2026-01-01T09:00:00Z',
    });

    const payload = await executeExport('sess-c3');
    const valid = validate(payload);
    if (!valid) console.error('AJV errors:', validate.errors);
    expect(valid).toBe(true); // schema-valid WITH the profile block
    expect(payload.profile).toEqual({
      employee_count: '50-250',
      has_ssp: 'unsure',
      covers_m365: 'yes',
    });
  });

  test('C3: a party with no profile answers emits no profile key (still schema-valid)', async () => {
    await db.engagements.add({
      id: 'eng-c3b',
      engagement_kind: 'individual_contractor',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.assessed_parties.add({
      id: 'party-c3b',
      engagement_id: 'eng-c3b',
      name: 'Bare Corp',
      on_prem_ot: 'no',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.interview_sessions.add({
      id: 'sess-c3b',
      party_id: 'party-c3b',
      facts: [],
      timing_segments: [],
      status: 'complete',
      created_at: '2026-01-01T09:00:00Z',
    });

    const payload = await executeExport('sess-c3b');
    expect(validate(payload)).toBe(true);
    expect(payload.profile).toBeUndefined();
  });

  test('individual_contractor engagement produces valid export', async () => {
    await db.engagements.add({
      id: 'eng-w2',
      engagement_kind: 'individual_contractor',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.assessed_parties.add({
      id: 'party-w2',
      engagement_id: 'eng-w2',
      name: 'Solo Contractor LLC',
      on_prem_ot: 'unsure',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.interview_sessions.add({
      id: 'sess-w2',
      party_id: 'party-w2',
      facts: [],
      timing_segments: [],
      status: 'complete',
      created_at: '2026-01-01T09:00:00Z',
    });

    const payload = await executeExport('sess-w2');
    expect(validate(payload)).toBe(true);
    expect(payload.engagement_kind).toBe('individual_contractor');
    expect(payload.on_prem_ot).toBe('unsure');
  });

  test('GO-2 D2 regression: unconfirmed drafts NEVER leak into StatusPayload.interview_facts', async () => {
    await db.engagements.add({
      id: 'eng-w3',
      engagement_kind: 'individual_contractor',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.assessed_parties.add({
      id: 'party-w3',
      engagement_id: 'eng-w3',
      name: 'Draft Corp',
      on_prem_ot: 'no',
      created_at: '2026-01-01T00:00:00Z',
    });
    await db.interview_sessions.add({
      id: 'sess-w3',
      party_id: 'party-w3',
      facts: [
        {
          question_id: 'iam-001',
          question_text: 'Q',
          answer: 'yes',
          provenance: 'archetype-default', // unconfirmed draft
          confidence: 'low',
          recorded_at: '2026-01-01T10:00:00Z',
        },
        {
          question_id: 'iam-002',
          question_text: 'Q2',
          answer: 'yes',
          provenance: 'discovery-inferred', // CONFIRMED draft — stays
          confidence: 'medium',
          recorded_at: '2026-01-01T10:00:00Z',
          attestation: {
            drafted_by: 'discovery inference',
            confirmed_by: 'Jane Assessor',
            confirmed_on: '2026-07-11',
          },
        },
        {
          question_id: 'iam-003',
          question_text: 'Q3',
          answer: 'no',
          provenance: 'operator_interview', // human — stays
          confidence: 'high',
          recorded_at: '2026-01-01T10:00:00Z',
        },
      ],
      timing_segments: [],
      status: 'complete',
      created_at: '2026-01-01T09:00:00Z',
    });

    const payload = await executeExport('sess-w3');
    expect(validate(payload)).toBe(true); // schema-valid WITH the attestation present
    const ids = payload.interview_facts.map((f) => f.question_id).sort();
    expect(ids).toEqual(['iam-002', 'iam-003']); // the unconfirmed draft is GONE
    expect(
      payload.interview_facts.find((f) => f.question_id === 'iam-002')?.attestation
    ).toBeDefined();
  });
});
