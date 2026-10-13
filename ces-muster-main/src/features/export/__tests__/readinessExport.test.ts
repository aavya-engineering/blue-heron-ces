// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-READINESS-1 M2 gates:
//   Gate 2 — the readiness export VALIDATES against the published schema, with
//            manifest fields populated from the Situation-tab capture.
//   Gate 4 — adding an unconfirmed draft fact does NOT raise sprs_now.
// Plus: registry fix paths populate gaps[]; sprs_after is the flipped-fixables
// projection; the payload's facts[] is the transparency surface (drafts ride
// with provenance + attestation); a missing manifest fails loudly.
import 'fake-indexeddb/auto';
import { describe, test, expect, beforeEach } from 'vitest';
import Ajv from 'ajv';
import schema from '../../../../public/schemas/readiness-result.schema.json';
import { executeReadinessExport } from '../readinessResultService';
import { REGISTRY_FIX_PATHS } from '../registryFixPaths';
import { db } from '@/shared/db/schema';
import type { InterviewFact, InterviewSession } from '@/shared/types/engagement';

const ajv = new Ajv({ strict: true });
const validate = ajv.compile(schema);

const MANIFEST = {
  mode: 'independent' as const,
  auth_tier: 'script-upload' as const,
  tenant_slug: 'stacksim-demo',
  tenant_kind: 'sim' as const,
  operator_name: 'Jane Assessor',
  operator_role: 'assessor',
};

function fact(overrides: Partial<InterviewFact>): InterviewFact {
  return {
    question_id: 'iam-001',
    question_text: 'Q',
    answer: 'yes',
    provenance: 'operator_interview',
    confidence: 'high',
    recorded_at: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

async function seed(sessionOverrides: Partial<InterviewSession>): Promise<string> {
  await db.engagements.add({
    id: 'eng-r1',
    engagement_kind: 'individual_contractor',
    created_at: '2026-07-12T00:00:00Z',
  });
  await db.assessed_parties.add({
    id: 'party-r1',
    engagement_id: 'eng-r1',
    name: 'Readiness Corp',
    on_prem_ot: 'no',
    created_at: '2026-07-12T00:00:00Z',
  });
  await db.interview_sessions.add({
    id: 'sess-r1',
    party_id: 'party-r1',
    facts: [],
    timing_segments: [],
    status: 'complete',
    created_at: '2026-07-12T09:00:00Z',
    completed_at: '2026-07-12T10:00:00Z',
    readiness_manifest: MANIFEST,
    ...sessionOverrides,
  });
  return 'sess-r1';
}

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
});

describe('READINESS-1 M2 — readiness-result exporter', () => {
  test('GATE 2: export validates against the schema with the captured manifest populated', async () => {
    const id = await seed({
      facts: [fact({ question_id: 'iam-001', answer: 'yes' })],
      discovery_results: [
        { control_id: 'AC.L2-3.1.13', objective_ids: ['AC.L2-3.1.13[a]'], confidence: 'high' },
        { control_id: 'RA.L2-3.11.1', objective_ids: ['RA.L2-3.11.1[a]'], confidence: 'unknown' },
      ],
    });
    const result = await executeReadinessExport(id);

    const valid = validate(result);
    if (!valid) console.error(validate.errors);
    expect(valid).toBe(true);

    expect(result.manifest.mode).toBe('independent');
    expect(result.manifest.auth_tier).toBe('script-upload');
    expect(result.manifest.tenant).toEqual({ slug: 'stacksim-demo', kind: 'sim' });
    expect(result.manifest.operator).toEqual({ name: 'Jane Assessor', role: 'assessor' });
    expect(result.manifest.engagement_id).toBe('eng-r1');
    expect(result.manifest.party_id).toBe('party-r1');
    expect(result.manifest.started_at).toBe('2026-07-12T09:00:00Z');

    // Observations: FCA — the unknown-confidence row observes posture 'unknown'.
    expect(result.observations).toHaveLength(2);
    expect(result.observations.find((o) => o.control_id === 'RA.L2-3.11.1')?.derived_posture).toBe('unknown');
    expect(result.observations.find((o) => o.control_id === 'AC.L2-3.1.13')?.derived_posture).toBe('met');
  });

  test('GATE 4: adding an unconfirmed draft does NOT raise sprs_now (and cannot lower it either)', async () => {
    const humanFacts = [
      fact({ question_id: 'iam-001', answer: 'yes' }),
      fact({ question_id: 'iam-002', answer: 'no' }),
    ];
    const id = await seed({ facts: humanFacts });
    const without = await executeReadinessExport(id);

    await db.interview_sessions.update(id, {
      facts: [
        ...humanFacts,
        fact({ question_id: 'ep-002', answer: 'yes', provenance: 'archetype-default', confidence: 'low' }),
        fact({ question_id: 'bnd-001', answer: 'yes', provenance: 'discovery-inferred', confidence: 'medium' }),
      ],
    });
    const withDrafts = await executeReadinessExport(id);

    expect(withDrafts.derived.sprs_now).toEqual(without.derived.sprs_now);
    expect(withDrafts.derived.gaps).toEqual(without.derived.gaps);
  });

  test('facts[] is the transparency surface: drafts ride with provenance; attestations intact', async () => {
    const confirmed = fact({
      question_id: 'iam-003',
      provenance: 'discovery-inferred',
      confidence: 'medium',
      attestation: {
        drafted_by: 'discovery inference',
        confirmed_by: 'Jane Assessor',
        confirmed_on: '2026-07-12',
      },
    });
    const draft = fact({ question_id: 'ep-002', provenance: 'archetype-default', confidence: 'low' });
    const id = await seed({ facts: [confirmed, draft] });
    const result = await executeReadinessExport(id);

    expect(result.facts).toHaveLength(2);
    expect(result.facts!.find((f) => f.question_id === 'ep-002')?.provenance).toBe('archetype-default');
    expect(result.facts!.find((f) => f.question_id === 'iam-003')?.attestation?.confirmed_by).toBe('Jane Assessor');
    // But the CONFIRMED discovery-inferred fact scores; the unconfirmed one does not:
    // iam-003 'yes' -> its mapped requirements are assessed; ep-002's are absent.
    const assessed = new Set(result.derived.sprs_now.deductions.map((d) => d.requirement_id));
    expect(result.derived.sprs_now.assessed_count).toBeGreaterThan(0);
    expect(assessed.size).toBe(result.derived.sprs_now.deductions.length);
  });

  test('registry-fixable gaps carry fix_entry_ids and sprs_after projects them to met', async () => {
    // iam-002 'no' -> AC.L1-3.1.1 + AC.L1-3.1.2 not_met; AC.L1-3.1.1 is
    // registry-fixable per the derived extract.
    expect(REGISTRY_FIX_PATHS['AC.L1-3.1.1']?.length).toBeGreaterThan(0);
    const id = await seed({ facts: [fact({ question_id: 'iam-002', answer: 'no' })] });
    const result = await executeReadinessExport(id);

    const gap = result.derived.gaps.find((g) => g.requirement_id === 'AC.L1-3.1.1')!;
    expect(gap.fixable).toBe('registry');
    expect(gap.fix_entry_ids).toEqual(REGISTRY_FIX_PATHS['AC.L1-3.1.1']);
    expect(result.derived.sprs_after).toBeGreaterThan(result.derived.sprs_now.sprs);
    // The projection never exceeds the ceiling.
    expect(result.derived.sprs_after).toBeLessThanOrEqual(110);
  });

  test('a missing Situation-tab manifest fails LOUDLY, never a silent or invalid export', async () => {
    const id = await seed({ readiness_manifest: undefined, facts: [fact({})] });
    await expect(executeReadinessExport(id)).rejects.toThrow(/manifest capture/);
  });

  test('DISCOVERY-1: the executor’s real observations ride verbatim (ran_entry_ids + capture ref), not the stub', async () => {
    // A live/sim discovery walk produced these — the richer rows the executor
    // emits (ran_entry_ids, raw_capture_ref, executor-derived posture). They must
    // NOT be re-synthesized from discovery_results; they must pass through whole.
    const id = await seed({
      facts: [fact({ question_id: 'iam-001', answer: 'yes' })],
      // Thin rows present too — the executor rows must WIN over these.
      discovery_results: [
        { control_id: 'AC.L2-3.1.13', objective_ids: ['AC.L2-3.1.13[a]'], confidence: 'high' },
      ],
      discovery_observations: [
        {
          control_id: 'AC.L2-3.1.13',
          objective_ids: ['AC.L2-3.1.13[a]'],
          confidence: 'high',
          ran_entry_ids: ['AC.L2-3.1.13.operator-discover'],
          raw_capture_ref: 'captures/AC.L2-3.1.13.operator-discover.json',
          derived_posture: 'met',
        },
        {
          control_id: 'RA.L2-3.11.1',
          objective_ids: ['RA.L2-3.11.1[a]'],
          confidence: 'unknown',
          ran_entry_ids: ['RA.L2-3.11.1.scan-config'],
          derived_posture: 'unknown',
        },
      ],
    });
    const result = await executeReadinessExport(id);

    const valid = validate(result);
    if (!valid) console.error(validate.errors);
    expect(valid).toBe(true);

    // Two rows from the executor, NOT one from the thin discovery_results.
    expect(result.observations).toHaveLength(2);
    const ac = result.observations.find((o) => o.control_id === 'AC.L2-3.1.13')!;
    // The stub would have emitted ran_entry_ids: []; the executor rows carry provenance.
    expect(ac.ran_entry_ids).toEqual(['AC.L2-3.1.13.operator-discover']);
    expect(ac.raw_capture_ref).toBe('captures/AC.L2-3.1.13.operator-discover.json');
    expect(ac.derived_posture).toBe('met');
    // The unknown row survives as unknown (FCA), with its executor entry id intact.
    const ra = result.observations.find((o) => o.control_id === 'RA.L2-3.11.1')!;
    expect(ra.derived_posture).toBe('unknown');
    expect(ra.ran_entry_ids).toEqual(['RA.L2-3.11.1.scan-config']);
  });
});