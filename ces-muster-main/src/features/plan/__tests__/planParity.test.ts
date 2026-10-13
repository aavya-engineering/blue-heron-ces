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
// satisfies — proven by asserting the core contract against Planner's VFS
// reference FIRST, then against Muster's generated plan.
//
// This replaces JSON-schema validation, which is not the operative contract:
// the shipped schemas fail Planner's own reference output, and Planner's
// pipeline never schema-validates (it gates on validateArtifactAlignment only).
// See docs/goals/G-MUSTER-PLAN-3-FINDINGS.md and missionPlanContract.ts.
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkMissionPlanCore } from '../missionPlanContract';
import { deriveSitFacts, residueIds } from '../siDerivation';
import { SI_FIELD_LABELS } from '../siResidue';
import { buildPlanArtifacts, type MusterRequirementResult } from '../tenantManifestAdapter';
import { loadBanks, sitAnswers } from './planTestSupport';

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

// Planner's VFS reference output — the equivalence yardstick, when on disk.
const REF_PATH = path.resolve(
  '../ces-planner/customers/VFS GCC High G5 M365 + Foundation + Sentinel/outputs/manual-mission-plan_manual-2026-04-22T20-03-50-346Z.json'
);
const refExists = fs.existsSync(REF_PATH);

describe('M0 gate (a): mission-plan core contract (reference-parity)', () => {
  test('the core contract holds for Planner\'s VFS reference output (self-verification)', () => {
    if (!refExists) {
      console.warn('[M0] no Planner VFS reference on disk — parity self-check skipped');
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
