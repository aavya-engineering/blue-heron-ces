// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PLAN-3 M0 gate (b): the two arguments M0 wires into the ONE compile
// actually carry — proven SEPARATELY, because they trigger on different inputs:
//
//   - techRefIndex (compileTaskCatalog arg 7): enriches EVERY task with a
//     `tech_ref` block. Proven end-to-end through the adapter (buildPlanArtifacts):
//     with the shipped tech ref in the banks, the produced mission plan carries
//     tech_ref; with it absent, it does not.
//
//   - inheritanceTable (compileGapSet arg 8): only changes the gap set for a
//     cloud_only SI baseline with valid FedRAMP package IDs and zero physical
//     facilities — none of which the M0 5-field baseline supplies. So it is a
//     deliberate no-op for the default plan surface, and its wire is proven at
//     the vendored-compiler boundary with a crafted SI baseline that triggers
//     inheritance, using the EXACT table the SPA ships. This proves both the
//     arg position and that the shipped YAML drives real inheritance.
import { describe, test, expect } from 'vitest';
import { buildTechRefIndex } from '@/vendored/ces-planner/shared/services/techRefIndex';
import type { TechRefCMMCL2 } from '@/vendored/ces-planner/shared/types/domain';
import { compileGapSet } from '@/vendored/ces-planner/mpt/services/gapCompiler';
import type { FedRAMPInheritanceTable } from '@/vendored/ces-planner/mpt/services/fedrampInheritance';
import type { SIBaseline, ReadinessPosture } from '@/vendored/ces-planner/shared/types/artifacts';
import { buildPlanArtifacts, type MusterRequirementResult } from '../tenantManifestAdapter';
import { loadBanks, sitAnswers } from './planTestSupport';

const BANKS = loadBanks();
const TECH_REF = BANKS.techRef as TechRefCMMCL2;
const FEDRAMP_TABLE = BANKS.inheritanceTable as FedRAMPInheritanceTable;
// Base banks for the fedramp direct-compile test (no techRef/table wired).
const BASE_BANKS = BANKS;

// A posture with not-met controls so the compile actually produces gaps/tasks.
const RESULTS: MusterRequirementResult[] = [
  { requirement_id: 'AC.L2-3.1.1', status: 'not_met' },
  { requirement_id: 'IA.L2-3.5.3', status: 'not_met' },
  { requirement_id: 'AU.L2-3.3.1', status: 'not_met' },
];

const INPUT = {
  sitAnswers: sitAnswers({ deploymentPosture: 'cloud_only' }),
  requirementResults: RESULTS,
  tenantConfig: null,
};

describe('M0 wire: techRefIndex (compileTaskCatalog arg 7)', () => {
  test('shipped tech ref carries into the produced mission plan; absent, it does not', () => {
    const withIdx = buildPlanArtifacts(INPUT, { ...BANKS, techRef: TECH_REF, inheritanceTable: null });
    const without = buildPlanArtifacts(INPUT, { ...BANKS, techRef: null, inheritanceTable: null });

    const withJson = JSON.stringify(withIdx.missionPlan);
    const withoutJson = JSON.stringify(without.missionPlan);

    // The wire carries: the enriched plan differs from the bare one, and only
    // the enriched one carries tech_ref guidance.
    expect(withJson).not.toBe(withoutJson);
    expect(withJson).toContain('tech_ref');
    expect(withoutJson).not.toContain('tech_ref');
  });

  test('buildTechRefIndex resolves a known control from the shipped file', () => {
    const idx = buildTechRefIndex(TECH_REF);
    expect(idx.getControl('AC.L2-3.1.1')).toBeDefined();
  });
});

describe('M0 wire: FedRAMP inheritance table (compileGapSet arg 8)', () => {
  // A cloud_only SI baseline with a valid FedRAMP package ID and zero physical
  // facilities — the conditions evaluateInheritance requires. PE.L1-3.10.1 is
  // in the shipped table gated on physical_facility_count_zero.
  const inheritSI = {
    ces: { artifact: 'CES_SI_BASELINE', version: '1.0.0', generated_on: '1970-01-01', cesId: 'fedramp-wire' },
    si_baseline: {
      target: { target_cmmc_level: 'L2', cui_presence: 'has_cui' },
      scope: { deployment_posture: 'cloud_only' },
      dependencies: {
        infrastructure_model: 'm365_azure',
        license_tier: 'g5',
        fedramp_package_ids: ['F1234567890'],
        physical_facility_count: 0,
        tenant_model_preference: 'gcc_high',
      },
    },
  } as unknown as SIBaseline;

  const posture = {
    ces: {
      artifact: 'CES_READINESS_POSTURE',
      version: '1.0.0',
      generated_on: '1970-01-01',
      snapshot_id: 's',
      as_of_date: '1970-01-01',
      si_baseline_ref: { artifact_id: 'x', hash: 'x' },
      rr_question_set_ref: { artifact_id: 'n/a', hash: 'n/a' },
      control_status_summary: {},
      key_findings: [],
      constraints: [],
      requirement_results: [{ requirement_id: 'PE.L1-3.10.1', status: 'not_met', evidence_refs: [] }],
      evidence_index: [],
    },
  } as unknown as ReadinessPosture;

  const caps = { patterns: BASE_BANKS.patterns, playbook: BASE_BANKS.playbook };

  test('shipped table produces a FedRAMP-inherited disposition; null table does not', () => {
    const withTable = compileGapSet(
      inheritSI, posture, BASE_BANKS.cmmcRequirements, BASE_BANKS.evidenceMatrix, caps, null, null, FEDRAMP_TABLE
    );
    const withoutTable = compileGapSet(
      inheritSI, posture, BASE_BANKS.cmmcRequirements, BASE_BANKS.evidenceMatrix, caps, null, null, null
    );

    const inheritedWith = withTable.controlDispositions?.some(
      (d) => d.stamper_action === 'Inherited-FedRAMP'
    );
    const inheritedWithout = withoutTable.controlDispositions?.some(
      (d) => d.stamper_action === 'Inherited-FedRAMP'
    );

    expect(inheritedWith).toBe(true);
    expect(inheritedWithout).toBeFalsy();
  });
});
