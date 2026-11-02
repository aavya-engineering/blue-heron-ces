// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PLAN-3 M0 gate (a), node half: the mission plan the Plan surface
// generates conforms to the SAME operative contract Planner's own output
// satisfies — proven by asserting the core contract against Planner's EDC
// reference FIRST, then against Muster's generated plan.
//
// This replaces JSON-schema validation, which is not the operative contract:
// the shipped schemas fail Planner's own reference output, and Planner's
// pipeline never schema-validates (it gates on validateArtifactAlignment only).
// See docs/goals/G-MUSTER-PLAN-3-FINDINGS.md and missionPlanContract.ts.
import 'fake-indexeddb/auto';
import { describe, test, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkMissionPlanCore } from '../missionPlanContract';
import { deriveSitFacts, residueIds } from '../siDerivation';
import { SI_FIELD_LABELS } from '../siResidue';
import { buildPlanArtifacts, type MusterRequirementResult } from '../tenantManifestAdapter';
import { loadBanks, sitAnswers } from './planTestSupport';
import {
  fixtureKeys,
  loadCustomer,
  loadAllowList,
  checkParity,
  describeDiff,
  musterFromSession,
  musterChainFromPlannerInputs,
  type ParityResult,
  type Producer,
} from './parityHarness';

const BANKS = loadBanks();

const RESULTS: MusterRequirementResult[] = [
  { requirement_id: 'AC.L2-3.1.1', status: 'not_met' },
  { requirement_id: 'IA.L2-3.5.3', status: 'not_met' },
  { requirement_id: 'AU.L2-3.3.1', status: 'met' },
];

const artifacts = buildPlanArtifacts(
  {
    sitAnswers: sitAnswers({ deploymentPosture: 'cloud_only' }),
    requirementResults: RESULTS,
    tenantConfig: null,
  },
  BANKS
);

// Planner's EDC reference output — the equivalence yardstick, when on disk.
const REF_PATH = path.resolve(
  '../ces-planner/customers/EDC GCC High G5 M365 + Foundation + Sentinel/outputs/manual-mission-plan_manual-2026-04-22T20-03-50-346Z.json'
);
const refExists = fs.existsSync(REF_PATH);

describe('M0 gate (a): mission-plan core contract (reference-parity)', () => {
  test('the core contract holds for Planner\'s EDC reference output (self-verification)', () => {
    if (!refExists) {
      console.warn('[M0] no Planner EDC reference on disk — parity self-check skipped');
      return;
    }
    const ref = JSON.parse(fs.readFileSync(REF_PATH, 'utf8'));
    const r = checkMissionPlanCore(ref);
    if (!r.ok) console.error('reference missing:', r.missing);
    expect(r.ok).toBe(true);
  });

  test('Muster\'s generated mission plan satisfies the same core contract', () => {
    const r = checkMissionPlanCore(artifacts.missionPlan);
    if (!r.ok) console.error('muster plan missing:', r.missing);
    expect(r.ok).toBe(true);
  });

  test('Muster\'s plan does not carry cesId on ces (Planner-reference parity)', () => {
    const ces = (artifacts.missionPlan as { ces?: Record<string, unknown> }).ces ?? {};
    expect('cesId' in ces).toBe(false);
  });

  test('M1 derivation labels residue honestly; derived fields are NOT defaulted', () => {
    // The generator emits NO validation_warnings for thin input (F4) — the
    // honest "labels every defaulted field" claim is carried by Muster's own
    // derivation coverage. For a GCC-High cloud tenant: target level and
    // deployment posture DERIVE (so are not residue), while CUI presence and
    // boundary strategy are genuine residue.
    const allBankIds = (BANKS.siQuestionBank?.ces?.question_bank?.questions ?? []).map((q) => q.id);
    const { derivedIds } = deriveSitFacts({ selectedStacks: ['m365_e5_gcc'] });
    const residueLabels = residueIds(allBankIds, derivedIds).map((id) => SI_FIELD_LABELS[id] ?? id);
    expect(derivedIds).toContain('G-01'); // target CMMC level — derived
    expect(derivedIds).toContain('G-08'); // deployment posture — derived
    expect(residueLabels).toContain('CUI presence');
    expect(residueLabels).toContain('boundary strategy');
    expect(residueLabels).not.toContain('target CMMC level');
  });
});

// ── MG-04: content parity with Planner's goldens for the fixture customers ──
// No skip path: the goldens are committed (src/features/plan/__fixtures__/customers/<x>/planner-golden/,
// generated in ces-planner by scripts/generate-goldens.ts), so a missing golden fails.
// Every diff must be absorbed by a reviewed entry of parity-allowlist.json, and
// every entry must absorb exactly its reviewed count per fixture.
describe('MG-04: Muster vs Planner golden content parity (fixture customers a-d)', () => {
  const FIXTURES = fixtureKeys();
  const ENTRIES = loadAllowList();
  const results: Record<string, Partial<Record<Producer, ParityResult>>> = {};

  beforeAll(async () => {
    for (const fx of FIXTURES) {
      const { goldens } = loadCustomer(fx);
      results[fx] = {
        session: checkParity(fx, 'session', goldens, await musterFromSession(fx), ENTRIES),
        chain: checkParity(fx, 'chain', goldens, await musterChainFromPlannerInputs(fx), ENTRIES),
      };
    }
  }, 300_000);

  test('the four fixture customers (a)-(d) are present', () => {
    expect(FIXTURES).toEqual(['a', 'b', 'c', 'd']);
  });

  for (const producer of ['session', 'chain'] as const) {
    test.each(['a', 'b', 'c', 'd'])(`fixture %s (${producer}): no content diff outside the reviewed allow-list`, (fx) => {
      const r = results[fx]?.[producer];
      expect(r, `no parity result for fixture ${fx}`).toBeDefined();
      const shown = r!.unallowed.slice(0, 25).map(describeDiff);
      expect(shown, `${r!.unallowed.length} diff(s) not in parity-allowlist.json`).toEqual([]);
    });
  }

  test('every allow-list entry has an owner, a reason, and absorbs exactly its reviewed count per fixture', () => {
    const off: string[] = [];
    for (const e of ENTRIES) {
      expect(e.mg, e.id).toBeTruthy();
      expect(e.reason.length, e.id).toBeGreaterThan(20);
      for (const fx of FIXTURES) {
        const got = (results[fx]?.session?.absorbed[e.id] ?? 0) + (results[fx]?.chain?.absorbed[e.id] ?? 0);
        const want = e.count[fx] ?? 0;
        if (got !== want) off.push(`${e.id} fixture ${fx}: absorbed ${got}, reviewed count ${want}`);
      }
      if (Object.values(e.count).every((n) => n === 0)) off.push(`${e.id}: absorbs nothing (remove it)`);
    }
    expect(off).toEqual([]);
  });

  test('pricing is allow-listed per D1 and nowhere else needs it', () => {
    const d1 = ENTRIES.filter((e) => e.mg === 'D1').map((e) => e.id);
    expect(d1).toEqual(['D1-cost-proposal-sow', 'D1-loe-fields']);
    // No golden carries a proposal artifact.
    for (const fx of FIXTURES) expect(loadCustomer(fx).meta.artifacts).not.toContain('proposal');
  });
});
