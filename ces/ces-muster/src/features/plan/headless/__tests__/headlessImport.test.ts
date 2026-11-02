// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// The headless runner's import steps (headlessImport.ts, as plan-from-discovery.ts
// calls them) on the e2e sim discovery file plus a captured harvest payload
// (the harvest route's { facts } response for the muster-partial scenario):
// the 8 readiness activities the harvest answers carry the harvest answer,
// provenance auto_detected, in the session and in the readiness export.
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { db } from '@/shared/db/schema';
import type { InterviewFact } from '@/shared/types/engagement';

vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('../../__tests__/planTestSupport');
  const banks = loadBanks();
  return { loadCompilerBanks: async () => banks, _resetCompilerBanksCache: () => {} };
});

const { stageHeadlessFacts } = await import('../headlessImport');
const { parseReadinessResultFile } = await import('@/features/discovery/importReadinessResult');
const { createSession, completeInterview } = await import('@/driver/sessionDriver');
const { compilePlanForSession } = await import('@/features/plan/planCompileService');
const { buildReadinessResult } = await import('@/features/export/readinessResultService');
const { LEGACY_READINESS_ALIASES } = await import('@/features/interview/questionGraph');
const { applyDiscoveryFacts } = await import('@/features/assessment/assessmentHelpers');

const STACKS = ['m365_e5_gcc', 'microsoft_intune', 'microsoft_sentinel'];

/** muster-partial's expectedFacts (tenant-stacksim scenarios/muster-partial.json). */
const EXPECTED: Record<string, string> = {
  'RR-ACT-AC_L2_3_1_13': 'no',
  'RR-ACT-IA_L2_3_5_3': 'no',
  'RR-ACT-AC_L2_3_1_12': 'no',
  'RR-ACT-AC_L2_3_1_14': 'no',
  'RR-ACT-CM_L2_3_4_1': 'yes',
  'RR-ACT-CM_L2_3_4_2': 'yes',
  'RR-ACT-SI_L1_3_14_1': 'yes',
  'RR-ACT-SI_L2_3_14_2': 'yes',
};

const readFixture = (name: string) => fs.readFileSync(path.resolve(process.cwd(), 'e2e/fixtures', name), 'utf8');

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
});

describe('headless import: discovery file + harvest payload', () => {
  test('the captured harvest payload answers the probe activities (the retired iam-001/iam-004/ep-001/ep-002 aliases)', () => {
    const { facts } = JSON.parse(readFixture('sim-harvest-muster-partial.json')) as { facts: Array<{ question_id: string }> };
    const probeIds = ['iam-001', 'iam-004', 'ep-001', 'ep-002'].flatMap((id) => LEGACY_READINESS_ALIASES[id]);
    expect(facts.map((f) => f.question_id).sort()).toEqual([...probeIds].sort());
    expect(Object.keys(EXPECTED).sort()).toEqual([...probeIds].sort());
  });

  test('the 8 harvest facts reach the session and the readiness export', async () => {
    const payload = parseReadinessResultFile(readFixture('sim-discovery-result.json'));
    const harvest = JSON.parse(readFixture('sim-harvest-muster-partial.json')).facts;
    const { results, facts } = stageHeadlessFacts(payload, harvest, STACKS);

    const handle = await createSession(payload.manifest.engagement_kind, { stacks: STACKS, party: { name: 'Sim tenant', on_prem_ot: 'no' } });
    await db.interview_sessions.update(handle.sessionId, {
      facts,
      discovery_results: results,
      discovery_observations: payload.observations,
      readiness_manifest: {
        mode: payload.manifest.mode,
        auth_tier: payload.manifest.auth_tier,
        tenant_slug: 'sim-local',
        tenant_kind: payload.manifest.tenant.kind,
        operator_name: payload.manifest.operator.name,
        operator_role: payload.manifest.operator.role,
      },
    });
    await completeInterview(handle);

    const compiled = await compilePlanForSession(handle.sessionId);
    const session = (await db.interview_sessions.get(handle.sessionId))!;
    const party = (await db.assessed_parties.get(session.party_id))!;
    const engagement = (await db.engagements.get(party.engagement_id))!;
    const exported = buildReadinessResult(engagement, party, session, compiled.posture);

    for (const source of [session.facts, exported.facts as InterviewFact[]]) {
      for (const [id, answer] of Object.entries(EXPECTED)) {
        const hits = source.filter((f) => f.question_id === id);
        expect(hits, id).toHaveLength(1);
        expect(hits[0].answer, id).toBe(answer);
        expect(hits[0].provenance, id).toBe('auto_detected');
        expect(hits[0].source, id).toMatch(/^graph:/);
      }
    }
  });

  test('without a harvest, a decisive discovery verdict is not overwritten by a later unknown row', () => {
    const payload = parseReadinessResultFile(readFixture('sim-discovery-result.json'));
    const { facts } = stageHeadlessFacts(payload, [], STACKS);
    const byId = new Map(facts.map((f) => [f.question_id, f]));
    // SI.L1-3.14.1: predicated met rows followed by unknown rows in the sim file.
    expect(byId.get('RR-ACT-SI_L1_3_14_1')?.answer).toBe('yes');
  });
});

describe('applyDiscoveryFacts: a discovery verdict beats unsure', () => {
  const fact = (answer: string, confidence: InterviewFact['confidence'], provenance = 'auto_detected'): InterviewFact => ({
    question_id: 'Q',
    question_text: 'Q',
    answer,
    provenance,
    confidence,
    recorded_at: '2026-10-27T00:00:00.000Z',
  });

  test('an unknown row after a decisive one keeps the decisive answer', () => {
    expect(applyDiscoveryFacts([fact('yes', 'high'), fact('unsure', 'unknown')], {}).answers.Q).toBe('yes');
    expect(applyDiscoveryFacts([fact('no', 'high'), fact('unsure', 'unknown')], {}).answers.Q).toBe('no');
  });

  test('a decisive row after an unknown one replaces it; decisive rows keep last-write-wins', () => {
    expect(applyDiscoveryFacts([fact('unsure', 'unknown'), fact('yes', 'high')], {}).answers.Q).toBe('yes');
    expect(applyDiscoveryFacts([fact('yes', 'high'), fact('no', 'high')], {}).answers.Q).toBe('no');
  });

  test('an operator answer still wins as the last write', () => {
    expect(applyDiscoveryFacts([fact('yes', 'high'), fact('unknown', 'unknown', 'operator_interview')], {}).answers.Q).toBe('unknown');
  });
});
