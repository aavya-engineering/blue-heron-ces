// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// SE-2..SE-6 — Session driver tests (Node environment via environmentMatchGlobs)
// fake-indexeddb provides real IndexedDB for the Node test environment.
// loadKnowledge is mocked so fetch is never called — tests run without a server.
import 'fake-indexeddb/auto';
import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock the YAML knowledge loader before any imports that might trigger it
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
import schema from '../../../public/schemas/status-payload.schema.json';
import { createSession, answer, completeInterview, exportPayload } from '../sessionDriver';
import { scoreFacts } from '@/features/scoring/scoringService';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { db } from '@/shared/db/schema';

const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema);

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
  await db.subs.clear();
});

describe('Session driver (SE-2..SE-6)', () => {
  test('SE-2: happy path → createSession → answer × N → completeInterview → exportPayload → AJV-valid StatusPayload', async () => {
    const handle = await createSession('prime_and_subs', {
      stacks: ['Microsoft 365'],
      party: { name: 'Alpha Corp', on_prem_ot: 'no' },
    });
    await answer(handle, 'iam-001', 'yes');
    await answer(handle, 'iam-002', 'no');
    await answer(handle, 'iam-003', 'yes');
    await completeInterview(handle);

    const payload = await exportPayload(handle);

    const valid = validate(payload);
    if (!valid) console.error('AJV errors:', validate.errors);
    expect(valid).toBe(true);
    expect(payload.engagement_kind).toBe('prime_and_subs');
    expect(payload.party.name).toBe('Alpha Corp');
  });

  test('SE-3: driver parity — exportPayload conservative score matches direct scoreFacts call on identical facts and stacks', async () => {
    const stacks: string[] = [];
    const handle = await createSession('prime_and_subs', {
      stacks,
      party: { name: 'Beta Corp', on_prem_ot: 'no' },
    });
    await answer(handle, 'iam-001', 'yes');
    await answer(handle, 'iam-002', 'no');
    await completeInterview(handle);

    const payload = await exportPayload(handle);

    // Direct scoreFacts call with identical facts + stacks
    const session = await db.interview_sessions.get(handle.sessionId);
    const graph = await loadQuestionGraph(stacks);
    const { conservativeScore } = await scoreFacts(session!.facts, graph, stacks);

    expect(payload.posture_summary.conservative_score).toBe(conservativeScore);
  });

  test('SE-4: individual_contractor kind — payload.engagement_kind matches; fact count matches answered count', async () => {
    const handle = await createSession('individual_contractor', {
      party: { name: 'Solo LLC', on_prem_ot: 'unsure' },
    });
    await answer(handle, 'iam-001', 'yes');
    await answer(handle, 'iam-002', 'yes');
    await answer(handle, 'iam-003', 'no');
    await completeInterview(handle);

    const payload = await exportPayload(handle);

    expect(payload.engagement_kind).toBe('individual_contractor');
    expect(payload.interview_facts).toHaveLength(3);
  });

  test('SE-5: all value=unsure answers → payload.posture_summary.conservative_score === 0', async () => {
    const handle = await createSession('prime_and_subs', {
      party: { name: 'Unknown Corp', on_prem_ot: 'no' },
    });
    await answer(handle, 'iam-001', 'unsure');
    await answer(handle, 'iam-002', 'unsure');
    await answer(handle, 'iam-003', 'unsure');
    await completeInterview(handle);

    const payload = await exportPayload(handle);

    expect(payload.posture_summary.conservative_score).toBe(0);
  });

  test('SE-6: global.fetch spy never called during a full driver session', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const handle = await createSession('prime_and_subs', {
        party: { name: 'Net Corp', on_prem_ot: 'no' },
      });
      await answer(handle, 'iam-001', 'yes');
      await completeInterview(handle);
      await exportPayload(handle);

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
