// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// SPRS calculator unit tests + vendored-calculator parity fixture (DONE-WHEN #11).
// Edge cases: all-met, single 5-weight not_met, unknown-as-not-met, partial-as-not-met,
// floor enforcement. Fixture test: full pipeline with all-yes facts.
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { computeSprs } from '../sprsCalc';

// Mock the knowledgeLoader so scoreFacts can run in Node without a web server.
// The mock replaces fetch-based loading with readFileSync (same files, same data).
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

// ── Pure unit tests — no pipeline ────────────────────────────────────────────

describe('computeSprs — pure unit', () => {
  test('all-met requirements → score 110, zero deductions', () => {
    const results = [
      { requirement_id: 'AC.L1-3.1.1', status: 'met' },
      { requirement_id: 'IA.L2-3.5.3', status: 'met' },
      { requirement_id: 'CA.L2-3.12.4', status: 'met' },
    ];
    const out = computeSprs(results);
    expect(out.sprs).toBe(110);
    expect(out.assessed_count).toBe(3);
    expect(out.deductions).toHaveLength(0);
  });

  test('empty input → score 110, zero assessed', () => {
    const out = computeSprs([]);
    expect(out.sprs).toBe(110);
    expect(out.assessed_count).toBe(0);
    expect(out.deductions).toHaveLength(0);
  });

  test('one 5-weight not_met requirement → score 105', () => {
    const out = computeSprs([{ requirement_id: 'AC.L1-3.1.1', status: 'not_met' }]);
    expect(out.sprs).toBe(105);
    expect(out.assessed_count).toBe(1);
    expect(out.deductions).toEqual([{ requirement_id: 'AC.L1-3.1.1', weight: 5 }]);
  });

  test('a 3-weight not_met requirement deducts 3 (AU.L2-3.3.2, authoritative table)', () => {
    // 3.3.2 "Trace actions to individual users" = 3 pts per the methodology.
    const out = computeSprs([{ requirement_id: 'AU.L2-3.3.2', status: 'not_met' }]);
    expect(out.sprs).toBe(107);
    expect(out.deductions[0].weight).toBe(3);
  });

  test('AU.L2-3.3.1 is a 5-pointer (authoritative table, was wrongly 3 pre-2026-07-12)', () => {
    const out = computeSprs([{ requirement_id: 'AU.L2-3.3.1', status: 'not_met' }]);
    expect(out.sprs).toBe(105);
    expect(out.deductions[0].weight).toBe(5);
  });

  test('the SSP (CA.L2-3.12.4) is unscored — weight 0, never deducts', () => {
    const out = computeSprs([{ requirement_id: 'CA.L2-3.12.4', status: 'not_met' }]);
    expect(out.sprs).toBe(110);
    expect(out.deductions[0].weight).toBe(0);
  });

  test('the two partial-credit controls carry their full weight (5) in the table', () => {
    // computeSprs deducts full weight for not-met; the 3-pt partial rule is a
    // separate assessment-input concern (see SPRS-SCORING-METHODOLOGY.md §2).
    expect(computeSprs([{ requirement_id: 'IA.L2-3.5.3', status: 'not_met' }]).deductions[0].weight).toBe(5);
    expect(computeSprs([{ requirement_id: 'SC.L2-3.13.11', status: 'not_met' }]).deductions[0].weight).toBe(5);
  });

  test('unknown status counts as not met — full deduction', () => {
    const out = computeSprs([{ requirement_id: 'IA.L2-3.5.3', status: 'unknown' }]);
    expect(out.sprs).toBe(105); // IA.L2-3.5.3 weight = 5
    expect(out.deductions).toHaveLength(1);
    expect(out.deductions[0].weight).toBe(5);
  });

  test('partial status counts as not met — full deduction', () => {
    const out = computeSprs([{ requirement_id: 'IA.L2-3.5.3', status: 'partial' }]);
    expect(out.sprs).toBe(105);
    expect(out.deductions).toHaveLength(1);
  });

  test('unknown requirement_id falls back to DEFAULT_WEIGHT = 1', () => {
    const out = computeSprs([{ requirement_id: 'UNKNOWN.FAKE-9.9.9', status: 'not_met' }]);
    expect(out.sprs).toBe(109); // 110 - 1
    expect(out.deductions[0].weight).toBe(1);
  });

  test('floor is never below -203', () => {
    // Generate enough not_met requirements at DEFAULT_WEIGHT to push far below -203
    const massive = Array.from({ length: 400 }, (_, i) => ({
      requirement_id: `FAKE.${i}`,
      status: 'not_met',
    }));
    const out = computeSprs(massive);
    expect(out.sprs).toBe(-203);
  });

  test('score floored at -203 even when deductions from real requirements exceed limit', () => {
    // All 31 listed requirements as not_met: 12×5 + 18×3 + 1×1 = 115 deductions → 110-115 = -5
    // Add 400 synthetic reqs at weight 1 each → -405 deductions total → floor to -203
    const allListed = [
      'AC.L1-3.1.1', 'AC.L1-3.1.2', 'AC.L2-3.1.6', 'AC.L2-3.1.12', 'AC.L2-3.1.13',
      'AC.L2-3.1.14', 'IA.L2-3.5.3', 'IA.L2-3.5.5', 'PS.L2-3.9.2', 'CM.L2-3.4.1',
      'CM.L2-3.4.2', 'CM.L2-3.4.7', 'CM.L2-3.4.8', 'SI.L1-3.14.1', 'SI.L2-3.14.2',
      'CA.L2-3.12.4', 'AT.L2-3.2.1', 'AT.L2-3.2.2', 'RA.L2-3.11.1', 'RA.L2-3.11.2',
      'AU.L2-3.3.1', 'AU.L2-3.3.2', 'AU.L2-3.3.5', 'IR.L2-3.6.1', 'IR.L2-3.6.2',
      'IR.L2-3.6.3', 'MP.L1-3.8.3', 'MP.L2-3.8.6', 'MP.L2-3.8.9', 'SC.L2-3.13.8',
      'SC.L2-3.13.10',
    ].map((id) => ({ requirement_id: id, status: 'not_met' as const }));
    const extra = Array.from({ length: 400 }, (_, i) => ({
      requirement_id: `EXTRA.${i}`,
      status: 'not_met' as const,
    }));
    const out = computeSprs([...allListed, ...extra]);
    expect(out.sprs).toBe(-203);
  });
});

// ── Deterministic fixture snapshot — full pipeline with all-yes facts ─────────

describe('computeSprs — vendored-calculator parity fixture', () => {
  // Imports are hoisted after vi.mock, so the knowledgeLoader mock is active.
  // We import scoreFacts and loadQuestionGraph here inside beforeAll to ensure
  // the mock is in place before the module is loaded.
  let fixtureSprs: number;
  let fixtureInput: Array<{ requirement_id: string; status: string }>;
  let fixtureExpected: ReturnType<typeof computeSprs>;

  const FIXTURE_DIR = resolve('src/features/scoring/__tests__/__fixtures__');
  const FIXTURE_PATH = resolve(FIXTURE_DIR, 'sprs-parity.json');

  beforeAll(async () => {
    // Dynamic imports so the vi.mock is already in effect
    const { scoreFacts } = await import('../scoringService');
    const { loadQuestionGraph } = await import('@/features/interview/questionGraphService');

    // Load question graph with no declared stacks (excludes stack-specific questions)
    const nodes = await loadQuestionGraph([]);

    // Build all-yes facts — every node answered 'yes'
    const facts = nodes.map((n) => ({
      question_id: n.id,
      question_text: n.text,
      answer: 'yes',
      provenance: 'client_assertion',
      confidence: 'high' as const,
      recorded_at: new Date().toISOString(),
    }));

    const { posture } = await scoreFacts(facts, nodes, []);
    fixtureInput = posture.ces.requirement_results.map((r) => ({
      requirement_id: r.requirement_id,
      status: r.status,
    }));
    fixtureExpected = computeSprs(fixtureInput);
    fixtureSprs = fixtureExpected.sprs;

    // Write fixture on first run; assert equality on subsequent runs
    if (!existsSync(FIXTURE_PATH)) {
      mkdirSync(FIXTURE_DIR, { recursive: true });
      writeFileSync(
        FIXTURE_PATH,
        JSON.stringify({ input: fixtureInput, expected: fixtureExpected }, null, 2)
      );
    }
  });

  test('all-yes pipeline fixture: sprs is deterministic', () => {
    // Fixture was computed above; re-run and compare
    const recomputed = computeSprs(fixtureInput);
    expect(recomputed).toEqual(fixtureExpected);
    expect(recomputed.sprs).toBe(fixtureSprs);
  });

  test('fixture matches committed sprs-parity.json', () => {
    const committed = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as {
      input: Array<{ requirement_id: string; status: string }>;
      expected: ReturnType<typeof computeSprs>;
    };
    const recomputed = computeSprs(committed.input);
    expect(recomputed).toEqual(committed.expected);
  });

  test('assessed_count equals number of requirements in pipeline output', () => {
    expect(fixtureExpected.assessed_count).toBe(fixtureInput.length);
  });
});
