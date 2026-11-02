// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// VENDORED from ces-planner src/features/rrt/services/__tests__/postureGenerator.characterization.test.ts @ 4a00bee5d5e618cf55da2469ec12307ebc620418
// Import path adjustment: @/features/rrt/types -> @/vendored/ces-spine/types/rrt
// All other imports and test logic are byte-identical to the original.

import { describe, it, expect } from 'vitest';
import { generateReadinessPosture } from '../postureGenerator';
import { makeAnswer } from '@/__fixtures__/builders';
import type { RRTAnswer } from '@/vendored/ces-spine/types/rrt';

/**
 * CHARACTERIZATION tests for the RRT posture generator.
 *
 * determineRequirementStatus / mergeStatuses / computeControlStatusSummary /
 * deriveKeyFindings are NOT exported, so they are exercised through the public
 * generateReadinessPosture() entry point. The function is pure given plain
 * objects (idGenerator + dateFormatter are pure; no IndexedDB / network).
 *
 * Date/id fields are non-deterministic and are asserted by shape only.
 */

function answers(map: Record<string, { req: string; answer: unknown; evidence_ids?: string[] }>): Record<string, RRTAnswer> {
  const out: Record<string, RRTAnswer> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = makeAnswer({ mapped_requirements: [v.req], answer: v.answer, evidence_ids: v.evidence_ids });
  }
  return out;
}

/** Map requirement_id -> status from a posture result. */
function statusByReq(posture: ReturnType<typeof generateReadinessPosture>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of posture.ces.requirement_results) out[r.requirement_id] = r.status;
  return out;
}

describe('generateReadinessPosture — answer classification (determineRequirementStatus)', () => {
  it('classifies each answer-value branch to its observed status', () => {
    const p = generateReadinessPosture(
      answers({
        boolTrue: { req: 'R.boolTrue', answer: true },
        boolFalse: { req: 'R.boolFalse', answer: false },
        strPartial: { req: 'R.strPartial', answer: 'partial' },
        strInProgress: { req: 'R.strInProgress', answer: 'in_progress' },
        strImplemented: { req: 'R.strImplemented', answer: 'implemented' },
        strNotImpl: { req: 'R.strNotImpl', answer: 'not_implemented' },
        strYes: { req: 'R.strYes', answer: 'yes' },
        strNo: { req: 'R.strNo', answer: 'no' },
        strUnknown: { req: 'R.strUnknown', answer: 'maybe' },
        objNotImpl: { req: 'R.objNotImpl', answer: { status: 'not_implemented' } },
        objImpl: { req: 'R.objImpl', answer: { status: 'implemented' } },
        evidenceOnly: { req: 'R.evidenceOnly', answer: 'gibberish', evidence_ids: ['e1'] },
      }),
      [],
      {},
      {},
    );

    const s = statusByReq(p);

    // KNOWN QUIRK: the requirement is seeded as 'unknown', then merged with the
    // classified status. mergeStatuses returns 'unknown' whenever either side is
    // 'unknown', so a lone boolean-true ('met') answer is swallowed back to
    // 'unknown'. Likewise a lone 'implemented'/'yes' answer cannot reach 'met'.
    expect(s['R.boolTrue']).toBe('unknown');
    expect(s['R.strImplemented']).toBe('unknown');
    expect(s['R.strYes']).toBe('unknown');
    expect(s['R.objImpl']).toBe('unknown');

    // Negative / partial classifications survive the merge (they outrank unknown).
    expect(s['R.boolFalse']).toBe('not_met');
    expect(s['R.strNo']).toBe('not_met');
    expect(s['R.strNotImpl']).toBe('not_met');
    expect(s['R.objNotImpl']).toBe('not_met');
    expect(s['R.strPartial']).toBe('partial');
    expect(s['R.strInProgress']).toBe('partial');

    // Genuinely-unknown strings stay unknown.
    expect(s['R.strUnknown']).toBe('unknown');

    // Evidence-only fallback ('met') is also swallowed back to 'unknown' by the merge.
    expect(s['R.evidenceOnly']).toBe('unknown');
    // ...but the evidence ref is still recorded.
    const evid = p.ces.requirement_results.find((r) => r.requirement_id === 'R.evidenceOnly');
    expect(evid?.evidence_refs).toEqual([{ evidence_id: 'e1' }]);
  });
});

describe('generateReadinessPosture — mergeStatuses precedence', () => {
  it('applies not_met > partial > unknown > met precedence across same-requirement answers', () => {
    const p = generateReadinessPosture(
      {
        // X.1: met then not_met  -> not_met
        a1: makeAnswer({ mapped_requirements: ['X.1'], answer: true }),
        a2: makeAnswer({ mapped_requirements: ['X.1'], answer: false }),
        // X.2: met then partial  -> partial
        b1: makeAnswer({ mapped_requirements: ['X.2'], answer: true }),
        b2: makeAnswer({ mapped_requirements: ['X.2'], answer: 'partial' }),
        // X.3: met then unknown  -> unknown
        c1: makeAnswer({ mapped_requirements: ['X.3'], answer: true }),
        c2: makeAnswer({ mapped_requirements: ['X.3'], answer: 'maybe' }),
        // X.4: not_met then partial -> not_met (not_met wins)
        d1: makeAnswer({ mapped_requirements: ['X.4'], answer: false }),
        d2: makeAnswer({ mapped_requirements: ['X.4'], answer: 'partial' }),
      },
      [],
      {},
      {},
    );
    const s = statusByReq(p);
    expect(s['X.1']).toBe('not_met');
    expect(s['X.2']).toBe('partial');
    expect(s['X.3']).toBe('unknown');
    expect(s['X.4']).toBe('not_met');
  });
});

describe('generateReadinessPosture — control_status_summary (computeControlStatusSummary)', () => {
  it('counts statuses and resolves level from si_baseline.target', () => {
    const p = generateReadinessPosture(
      answers({
        m: { req: 'R.partial', answer: 'partial' },
        n1: { req: 'R.nm1', answer: false },
        n2: { req: 'R.nm2', answer: false },
        u1: { req: 'R.u1', answer: 'maybe' },
        u2: { req: 'R.u2', answer: 'maybe' },
        u3: { req: 'R.u3', answer: 'maybe' },
      }),
      [],
      {},
      { si_baseline: { target: { target_cmmc_level: 'L2' } } },
    );
    expect(p.ces.control_status_summary).toEqual({
      level: 'L2',
      met: 0,
      partial: 1,
      not_met: 2,
      unknown: 3,
    });
  });

  it('defaults level to L2 when no target level present', () => {
    const p = generateReadinessPosture(answers({ u: { req: 'R.u', answer: 'maybe' } }), [], {}, {});
    expect(p.ces.control_status_summary.level).toBe('L2');
  });
});

describe('generateReadinessPosture — key_findings (deriveKeyFindings)', () => {
  it('emits high not_met finding + medium unknown finding with impacted requirement ids', () => {
    const p = generateReadinessPosture(
      answers({
        n1: { req: 'R.nm1', answer: false },
        n2: { req: 'R.nm2', answer: false },
        u1: { req: 'R.u1', answer: 'maybe' },
      }),
      [],
      {},
      {},
    );
    const findings = p.ces.key_findings;
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].statement).toBe(
      '2 requirement(s) are currently NOT MET and require remediation.',
    );
    expect(findings[0].impacts_requirements).toEqual(['R.nm1', 'R.nm2']);
    expect(findings[1].severity).toBe('medium');
    expect(findings[1].statement).toBe(
      '1 requirement(s) have UNKNOWN status and need further investigation.',
    );
    expect(findings[1].impacts_requirements).toEqual(['R.u1']);
  });

  it('escalates not_met finding to critical when more than 5 are not met', () => {
    const map: Record<string, { req: string; answer: unknown }> = {};
    for (let i = 0; i < 6; i++) map['k' + i] = { req: 'R.' + i, answer: false };
    const p = generateReadinessPosture(answers(map), [], {}, {});
    const notMetFinding = p.ces.key_findings.find((f) => f.statement.includes('NOT MET'));
    expect(notMetFinding?.severity).toBe('critical');
  });

  it('substitutes the low "no significant findings" placeholder when there are none', () => {
    const p = generateReadinessPosture(answers({ p: { req: 'R.p', answer: 'partial' } }), [], {}, {});
    expect(p.ces.key_findings).toEqual([
      { severity: 'low', statement: 'No significant findings at this time.' },
    ]);
  });
});

describe('generateReadinessPosture — empty input + envelope shape', () => {
  it('produces placeholder requirement_results and low finding for empty answers', () => {
    const p = generateReadinessPosture({}, [], {}, {});
    expect(p.ces.requirement_results).toEqual([
      { requirement_id: 'placeholder', status: 'unknown', evidence_refs: [] },
    ]);
    expect(p.ces.key_findings).toEqual([
      { severity: 'low', statement: 'No significant findings at this time.' },
    ]);
    expect(p.ces.control_status_summary).toEqual({
      level: 'L2',
      met: 0,
      partial: 0,
      not_met: 0,
      unknown: 0,
    });
  });

  it('stamps a stable envelope with shape-matched non-deterministic fields', () => {
    const p = generateReadinessPosture(answers({ p: { req: 'R.p', answer: 'partial' } }), [], { ces: { version: '2.0.0' } }, {});
    expect(p.ces.artifact).toBe('CES_READINESS_POSTURE');
    expect(p.ces.version).toBe('1.0.0');
    // ISO datetime + ISO date shapes (never assert wall-clock value)
    expect(p.ces.generated_on).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(p.ces.as_of_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.ces.snapshot_id).toMatch(/^snapshot_/);

    // Artifact refs: schema_id + version are stable; artifact_id + hash shaped.
    expect(p.ces.si_baseline_ref.schema_id).toBe('ces-si-baseline-output');
    expect(p.ces.si_baseline_ref.artifact_id).toMatch(/^si_baseline_\d+$/);
    expect(p.ces.si_baseline_ref.hash_sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(p.ces.rr_question_set_ref.schema_id).toBe('ces-rr-question-set-output');
    expect(p.ces.rr_question_set_ref.artifact_id).toMatch(/^rr_qs_\d+$/);
    // questionSet.ces.version flows through to the ref version.
    expect(p.ces.rr_question_set_ref.version).toBe('2.0.0');
  });

  it('omits cesId when not supplied and includes it when supplied', () => {
    const without = generateReadinessPosture(answers({ p: { req: 'R.p', answer: 'partial' } }), [], {}, {});
    expect(without.ces).not.toHaveProperty('cesId');
    const withId = generateReadinessPosture(
      answers({ p: { req: 'R.p', answer: 'partial' } }),
      [],
      {},
      {},
      undefined,
      undefined,
      undefined,
      'ces-abc123',
    );
    expect(withId.ces.cesId).toBe('ces-abc123');
  });
});
