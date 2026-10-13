// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// DW#12 — FCA guardrail: unknown facts must never produce a 'met' requirement.
// Tests run against both the direct postureGenerator path AND the full cascade path.
import { describe, test, expect } from 'vitest';
import { computeConservativeScore } from '../scoringService';
import { generateReadinessPosture } from '@/vendored/ces-spine/services/postureGenerator';
import { deriveActionStatuses, convertToRRTAnswers } from '@/vendored/ces-spine/services/bulkAnswerDerivation';
import type { RRTAnswer, PreambleAnswers } from '@/vendored/ces-spine/types/rrt';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { load } from 'js-yaml';
import type { ImplementationPatterns, VendorPlaybook } from '@/vendored/ces-spine/types/domain';

// Load real knowledge files once for cascade tests (node readFileSync, no fetch)
const patterns = load(
  readFileSync(resolve('public/knowledge/domain Implementation Patterns.yaml'), 'utf-8')
) as ImplementationPatterns;
const playbook = load(
  readFileSync(resolve('public/knowledge/vendor playbook Microsoft 365.yaml'), 'utf-8')
) as VendorPlaybook;

// Greenfield/E3: worst-case preamble — all actions → not_implemented (never met)
const GREENFIELD_PREAMBLE: PreambleAnswers = {
  license_tier: 'e3',
  security_archetype: 'greenfield',
  endpoint_management: 'unmanaged',
  monitoring_siem: 'none',
  policy_doc_state: 'nothing_written',
};

describe('DW#12 — FCA guardrails (direct postureGenerator path)', () => {
  test('unknown fact can never yield a passing objective', () => {
    const unknownAnswers: Record<string, RRTAnswer> = {
      q1: {
        question_id: 'q1',
        answer: 'unknown',
        provenance_class: 'operator_inference',
        mapped_requirements: ['AC.L1-3.1.1'],
      },
    };

    const posture = generateReadinessPosture(unknownAnswers, [], {}, {});
    const score = computeConservativeScore(posture);

    expect(posture.ces.control_status_summary.met).toBe(0);
    expect(score).toBe(0);
    const anyMet = posture.ces.requirement_results.some((r) => r.status === 'met');
    expect(anyMet).toBe(false);
  });

  test('multiple unknown facts across different requirements yield zero score', () => {
    const answers: Record<string, RRTAnswer> = {};
    for (let i = 0; i < 5; i++) {
      answers[`q${i}`] = {
        question_id: `q${i}`,
        answer: 'unknown',
        provenance_class: 'operator_inference',
        mapped_requirements: [`AC.L1-3.1.${i}`],
      };
    }
    const posture = generateReadinessPosture(answers, [], {}, {});
    const score = computeConservativeScore(posture);
    expect(score).toBe(0);
    expect(posture.ces.control_status_summary.met).toBe(0);
  });

  test('computeConservativeScore returns 0 when met is 0', () => {
    const posture = generateReadinessPosture(
      {
        q1: { question_id: 'q1', answer: 'no', provenance_class: 'client_assertion', mapped_requirements: ['AC.L1-3.1.1'] },
        q2: { question_id: 'q2', answer: 'partial', provenance_class: 'client_assertion', mapped_requirements: ['IA.L2-3.5.3'] },
      },
      [],
      {},
      {}
    );
    const score = computeConservativeScore(posture);
    expect(posture.ces.control_status_summary.met).toBe(0);
    expect(score).toBe(0);
  });
});

describe('DW#12 — FCA guardrails (full cascade path)', () => {
  test('greenfield/E3 cascade: unknown interview facts cannot yield met objectives', () => {
    // Run full cascade — greenfield produces not_implemented, never implemented
    const actionStatuses = deriveActionStatuses(patterns, playbook, GREENFIELD_PREAMBLE, {});
    const cascadeAnswers = convertToRRTAnswers(actionStatuses);

    // Add a direct unknown answer on top of cascade
    cascadeAnswers['interview-q1'] = {
      question_id: 'interview-q1',
      answer: 'unknown',
      provenance_class: 'client_assertion',
      mapped_requirements: ['AC.L1-3.1.1'],
    };

    const posture = generateReadinessPosture(cascadeAnswers, [], {}, {});
    const score = computeConservativeScore(posture);

    // Greenfield cascade sets not_implemented → not_met; never produces met
    expect(posture.ces.control_status_summary.met).toBe(0);
    expect(score).toBe(0);
  });

  test('cascade path: I-dont-know interview answer on a cascade-covered requirement stays non-met', () => {
    const actionStatuses = deriveActionStatuses(patterns, playbook, GREENFIELD_PREAMBLE, {});
    const cascadeAnswers = convertToRRTAnswers(actionStatuses);

    // Simulate "I don't know" for all questions (worst conservative case)
    for (const key of Object.keys(cascadeAnswers)) {
      cascadeAnswers[key] = { ...cascadeAnswers[key], answer: 'unknown' };
    }

    const posture = generateReadinessPosture(cascadeAnswers, [], {}, {});
    expect(posture.ces.control_status_summary.met).toBe(0);
    expect(computeConservativeScore(posture)).toBe(0);
  });
});
