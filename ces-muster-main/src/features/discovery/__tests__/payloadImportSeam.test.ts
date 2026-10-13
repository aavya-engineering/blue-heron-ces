// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PLAN-2 M1 gates:
//   1 — a readiness-result.v1 payload produces boundary-draft behavior and
//       downstream fact-store input IDENTICAL to the canned-fixture path
//       (equivalence asserted, GO-2 M3 pattern extended to the full payload).
//   2 — the same facts entered via the adaptive/manual path yield an
//       equivalent scored artifact (dual-input equivalence on the REAL
//       production scoring path).
//   3 — attested facts[] from the payload land in the fact store with their
//       ORIGINAL provenance strings and attestation records.
// One seam, no parallel path: these tests call the same functions the UI wires.
import { describe, test, expect, vi } from 'vitest';
import { DISCOVERY_RESULTS_FIXTURE } from '@/__fixtures__/discoveryResults';
import { READINESS_RESULT_CANNED } from '@/__fixtures__/readinessResults';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { synthesizeFactsFromDiscovery } from '@/features/interview/discoveryFactJoin';
import { inferBoundaryDrafts } from '@/features/interview/boundaryInference';
import { applyDiscoveryFacts, factsFromAnswers } from '@/features/assessment/assessmentHelpers';
import type { ReadinessResult } from '@/shared/types/readinessResult';
import type { InterviewFact } from '@/shared/types/engagement';
import {
  looksLikeReadinessResult,
  parseReadinessResultFile,
  discoveryResultsFromPayload,
  factsFromPayload,
} from '../importReadinessResult';

vi.mock('@/features/scoring/knowledgeLoader', async () => {
  const { readFileSync: rfs } = await import('fs');
  const { resolve: res } = await import('path');
  const { load } = await import('js-yaml');
  return {
    loadKnowledge: async () => ({
      patterns: load(rfs(res('public/knowledge/domain Implementation Patterns.yaml'), 'utf-8')),
      playbook: load(rfs(res('public/knowledge/vendor playbook Microsoft 365.yaml'), 'utf-8')),
    }),
    _resetKnowledgeCache: () => {},
  };
});

/** A payload whose observations mirror the canned discovery fixture exactly. */
function payloadOverFixture(facts?: InterviewFact[]): ReadinessResult {
  return {
    ...READINESS_RESULT_CANNED,
    observations: DISCOVERY_RESULTS_FIXTURE.map((r) => ({
      control_id: r.control_id,
      objective_ids: r.objective_ids,
      confidence: r.confidence,
      ran_entry_ids: [],
      derived_posture: r.confidence === 'unknown' ? ('unknown' as const) : ('met' as const),
    })),
    ...(facts ? { facts } : {}),
  };
}

const stable = <T extends { recorded_at: string }>(xs: T[]) =>
  xs.map(({ recorded_at: _r, ...rest }) => rest);

describe('PLAN-2 M1 — payload import seam', () => {
  test('sniff + parse: payload recognized and schema-validated; junk fails loudly', () => {
    const p = payloadOverFixture();
    expect(looksLikeReadinessResult(p)).toBe(true);
    expect(looksLikeReadinessResult(DISCOVERY_RESULTS_FIXTURE)).toBe(false);
    expect(parseReadinessResultFile(JSON.stringify(p)).schema_version).toBe('readiness-result/1.0.0');
    expect(() => parseReadinessResultFile('{"schema_version":"readiness-result/1.0.0"}')).toThrow(
      /does not validate/
    );
    expect(() => parseReadinessResultFile('[]')).toThrow(/not a readiness-result/);
  });

  test('GATE 1: payload path == fixture path — identical synthesized facts and boundary drafts', () => {
    const payload = parseReadinessResultFile(JSON.stringify(payloadOverFixture()));
    const rows = discoveryResultsFromPayload(payload);

    expect(rows).toEqual(DISCOVERY_RESULTS_FIXTURE);
    expect(stable(synthesizeFactsFromDiscovery(rows, QUESTION_GRAPH))).toEqual(
      stable(synthesizeFactsFromDiscovery(DISCOVERY_RESULTS_FIXTURE, QUESTION_GRAPH))
    );
    expect(stable(inferBoundaryDrafts(rows))).toEqual(
      stable(inferBoundaryDrafts(DISCOVERY_RESULTS_FIXTURE))
    );
  });

  test('GATE 3: attested payload facts reach the fact store with original provenance + attestation', () => {
    const attested: InterviewFact = {
      question_id: 'iam-001',
      question_text: 'MFA enforced?',
      answer: 'yes',
      provenance: 'discovery-inferred',
      confidence: 'medium',
      recorded_at: '2026-07-12T09:00:00Z',
      attestation: {
        drafted_by: 'discovery inference',
        confirmed_by: 'Jane Assessor',
        confirmed_on: '2026-07-12',
      },
    };
    const payload = parseReadinessResultFile(JSON.stringify(payloadOverFixture([attested])));
    const payloadFacts = factsFromPayload(payload);

    // The staged batch, exactly as BoundaryConfirmPanel builds it: synthesized
    // first, payload facts LAST (last write wins the prefill maps).
    const staged = [
      ...synthesizeFactsFromDiscovery(discoveryResultsFromPayload(payload), QUESTION_GRAPH),
      ...payloadFacts,
    ];
    const prefill = applyDiscoveryFacts(staged, {});
    expect(prefill.provenances['iam-001']).toBe('discovery-inferred');
    expect(prefill.attestations['iam-001']).toEqual(attested.attestation);

    // And it survives the fact-store round trip (factsFromAnswers regeneration).
    const roundTripped = factsFromAnswers(
      QUESTION_GRAPH,
      prefill.answers,
      prefill.provenances,
      prefill.confidences,
      prefill.attestations
    ).find((f) => f.question_id === 'iam-001')!;
    expect(roundTripped.provenance).toBe('discovery-inferred');
    expect(roundTripped.attestation).toEqual(attested.attestation);
  });

  test('GATE 2: dual-input equivalence — payload-fed facts score identically to adaptively-entered facts', async () => {
    const { scoreFacts } = await import('@/features/scoring/scoringService');
    // The same substantive answers, arriving two ways:
    const viaPayload: InterviewFact[] = [
      {
        question_id: 'iam-001', question_text: 'Q', answer: 'yes',
        provenance: 'discovery-inferred', confidence: 'medium',
        recorded_at: '2026-07-12T09:00:00Z',
        attestation: { drafted_by: 'discovery inference', confirmed_by: 'J', confirmed_on: '2026-07-12' },
      },
      {
        question_id: 'iam-002', question_text: 'Q', answer: 'no',
        provenance: 'operator_interview', confidence: 'high',
        recorded_at: '2026-07-12T09:00:00Z',
      },
    ];
    const viaAdaptive: InterviewFact[] = viaPayload.map((f) => ({
      ...f,
      provenance: 'operator_interview',
      attestation: undefined,
    }));

    const a = await scoreFacts(viaPayload, QUESTION_GRAPH, []);
    const b = await scoreFacts(viaAdaptive, QUESTION_GRAPH, []);
    expect(a.conservativeScore).toBe(b.conservativeScore);
    expect(a.posture.ces.control_status_summary).toEqual(b.posture.ces.control_status_summary);
  });
});