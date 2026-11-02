// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-21 gate: the archetype mechanism pre-fills fields with provenance
// 'archetype' (test archetype), never over discovery, a derivation or an
// answer, and every archetype in the registry (BHD content once it lands)
// pre-fills each of its fields.
import 'fake-indexeddb/auto';
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ARCHETYPES, TEST_ARCHETYPE, BHD_ARCHETYPES } from '@/__fixtures__/archetypes';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { applyArchetypeDefaults } from '@/features/assessment/archetypePrefill';
import { archetypeSitFacts } from '../archetypePriors';
import { sitAnswersFromFacts } from '../siBaselineAdapter';
import { loadCustomer } from './parityHarness';
import { freezeEntropy } from './fixtureInputs';

const SI_BANK_IDS = new Set(
  QUESTION_GRAPH.filter((n) => n.plan_input?.contract === 'si_baseline').map((n) => n.id)
);

function stubKnowledgeFetch(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const file = path.resolve(process.cwd(), 'public', decodeURI(String(url)).replace(/^\//, ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '', json: async () => null } as unknown as Response;
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

/** Compile a fixture customer's session with the test archetype's fields left
 * unanswered (the fixtures answer almost every SI question). */
async function compileCustomer(key: string, archetypeId?: string) {
  const unanswered = new Set(Object.keys(TEST_ARCHETYPE.defaults));
  const { musterSession } = loadCustomer(key);
  const { db } = await import('@/shared/db/schema');
  const restore = stubKnowledgeFetch();
  const entropy = freezeEntropy();
  try {
    const sessionId = `${musterSession.session.id}-${archetypeId ?? 'none'}`;
    await db.engagements.put(musterSession.engagement);
    await db.assessed_parties.put(musterSession.party);
    await db.interview_sessions.put({
      ...musterSession.session,
      id: sessionId,
      facts: musterSession.session.facts.filter(
        (f: { question_id: string }) => !unanswered.has(f.question_id)
      ),
      ...(archetypeId ? { archetype_id: archetypeId } : {}),
    });
    const { compilePlanForSession } = await import('../planCompileService');
    return await compilePlanForSession(sessionId);
  } finally {
    entropy.restore();
    restore();
  }
}

describe('MG-21 — archetype priors (mechanism, content slots)', () => {
  test('ships exactly one test archetype; BHD content slots start empty (D8)', () => {
    expect(BHD_ARCHETYPES).toEqual([]);
    expect(ARCHETYPES).toContain(TEST_ARCHETYPE);
    expect(TEST_ARCHETYPE.label).toMatch(/test/i);
    for (const v of Object.values(TEST_ARCHETYPE.defaults)) expect(v).toBe('unknown');
  });

  test('every archetype pre-fills each of its fields (interview and SI plan inputs)', () => {
    for (const a of ARCHETYPES) {
      const keys = Object.keys(a.defaults);
      expect(keys.length).toBeGreaterThan(0);
      for (const [qid, value] of Object.entries(a.defaults)) {
        const node = QUESTION_GRAPH.find((n) => n.id === qid);
        expect(node, `${a.id}: ${qid} names no question`).toBeDefined();
        if (node!.options.length > 0) expect(node!.options.map((o) => o.value)).toContain(value);
      }
      const prefill = applyArchetypeDefaults(a, QUESTION_GRAPH, {});
      expect(Object.keys(prefill.answers).sort()).toEqual([...keys].sort());
      const siKeys = keys.filter((k) => SI_BANK_IDS.has(k)).sort();
      const facts = archetypeSitFacts(a.id, QUESTION_GRAPH, SI_BANK_IDS, new Set());
      expect(facts.map((f) => f.question_id).sort()).toEqual(siKeys);
      for (const f of facts) expect(f.provenance).toBe(`archetype:${a.id}`);
    }
  });

  test('priors never fill a derived or answered field; no selection, no priors', () => {
    const filled = new Set(['S-13']);
    const facts = archetypeSitFacts(TEST_ARCHETYPE.id, QUESTION_GRAPH, SI_BANK_IDS, filled);
    expect(facts.map((f) => f.question_id)).toEqual(['S-28']);
    expect(archetypeSitFacts(undefined, QUESTION_GRAPH, SI_BANK_IDS, new Set())).toEqual([]);
    expect(archetypeSitFacts('no-such-archetype', QUESTION_GRAPH, SI_BANK_IDS, new Set())).toEqual([]);
  });

  test('an archetype prior is a SIT assumption, not a client assertion', () => {
    const facts = archetypeSitFacts(TEST_ARCHETYPE.id, QUESTION_GRAPH, SI_BANK_IDS, new Set());
    const bank = { ces: { question_bank: { questions: [...SI_BANK_IDS].map((id) => ({ id })) } } };
    const sit = sitAnswersFromFacts(facts, bank as never);
    expect(sit['S-28'].provenance_class).toBe('assumption');
  });

  test('compile: the selected archetype fills only defaulted SI fields, with source archetype', async () => {
    const without = await compileCustomer('a');
    const withArch = await compileCustomer('a', TEST_ARCHETYPE.id);
    let filled = 0;
    for (const qid of Object.keys(TEST_ARCHETYPE.defaults)) {
      const before = without.siFieldSources[qid];
      const after = withArch.siFieldSources[qid];
      if (before.source === 'defaulted') {
        filled++;
        expect(after).toEqual({
          source: 'archetype',
          provenance: `archetype:${TEST_ARCHETYPE.id}`,
          answer: TEST_ARCHETYPE.defaults[qid],
        });
      } else {
        // Discovery, a derivation or an answer already supplied it: unchanged.
        expect(after).toEqual(before);
      }
    }
    expect(filled).toBeGreaterThan(0);
    expect(withArch.defaultedInputs.length).toBe(without.defaultedInputs.length - filled);
  }, 60_000);
});
