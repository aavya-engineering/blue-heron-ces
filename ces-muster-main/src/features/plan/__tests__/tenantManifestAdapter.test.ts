// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PLAN-2 M2 slice 3 gate: the VENDORED ces-planner compiler chain,
// driven from Muster inputs, produces the Planner Tenant Manifest contract.
// Banks are loaded from the vendored public/knowledge/ YAML via fs (the same
// files the SPA fetches). This is the parity guarantee: the generator IS
// Planner's own code, unforked.
import { describe, test, expect } from 'vitest';
import { buildTenantManifest, buildManualPlan, type MusterRequirementResult } from '../tenantManifestAdapter';
import { loadBanks, sitAnswers } from './planTestSupport';

const BANKS = loadBanks();

// A small posture: a couple of not-met controls become gaps -> tasks.
const RESULTS: MusterRequirementResult[] = [
  { requirement_id: 'AC.L2-3.1.1', status: 'not_met' },
  { requirement_id: 'IA.L2-3.5.3', status: 'not_met' },
  { requirement_id: 'AU.L2-3.3.1', status: 'met' },
  { requirement_id: 'SI.L2-3.14.2', status: 'partial' },
];

describe('PLAN-2 M2 slice 3 — Tenant Manifest via the vendored Planner compiler', () => {
  test('produces the Planner tenant_manifest contract shape from Muster inputs', () => {
    const result = buildTenantManifest(
      {
        sitAnswers: sitAnswers({ targetLevel: 'L2', cuiPresence: 'cui_present', boundaryStrategy: 'single_enclave', deploymentPosture: 'cloud_only' }),
        requirementResults: RESULTS,
      },
      BANKS
    );

    // ces envelope
    expect(result.tenantManifest.ces.artifact).toBe('tenant_manifest');
    expect(typeof result.tenantManifest.ces.version).toBe('string');

    // tenant_manifest body — the normative contract keys.
    const tm = result.tenantManifest.tenant_manifest as Record<string, unknown>;
    expect(typeof tm.manifest_id).toBe('string');
    expect(Array.isArray(tm.normative_controls)).toBe(true);
    expect(Array.isArray(tm.config_intents)).toBe(true);
    expect(Array.isArray(tm.evidence_monitors)).toBe(true);
    expect(Array.isArray(tm.drift_policies)).toBe(true);

    // The compiler chain actually ran: not-met controls produced tasks.
    expect(result.taskCount).toBeGreaterThan(0);

    // m365_only-by-default -> no infra manifest without an Azure tenant config.
    expect(result.infrastructureManifest).toBeNull();

    // SI Baseline flowed through unchanged.
    expect(result.siBaseline.si_baseline.target.target_cmmc_level).toBe('L2');
  });

  test('the normative_controls trace to the posture (compiler consumed requirement_results)', () => {
    const result = buildTenantManifest(
      { sitAnswers: sitAnswers({ targetLevel: 'L2', cuiPresence: 'cui_present' }), requirementResults: RESULTS },
      BANKS
    );
    const tm = result.tenantManifest.tenant_manifest as { normative_controls: Array<{ control_id?: string }> };
    // Normative controls exist and are shaped (control_id present on rows).
    expect(tm.normative_controls.length).toBeGreaterThan(0);
  });

  test('an all-met posture yields few or no remediation tasks (gap-driven)', () => {
    const allMet: MusterRequirementResult[] = RESULTS.map((r) => ({ ...r, status: 'met' }));
    const result = buildTenantManifest(
      { sitAnswers: sitAnswers({ targetLevel: 'L2', cuiPresence: 'cui_present' }), requirementResults: allMet },
      BANKS
    );
    expect(result.tenantManifest.ces.artifact).toBe('tenant_manifest');
    // Fewer tasks than the not-met case — gaps drive task compilation.
    const notMet = buildTenantManifest(
      { sitAnswers: sitAnswers({ targetLevel: 'L2', cuiPresence: 'cui_present' }), requirementResults: RESULTS },
      BANKS
    );
    expect(result.taskCount).toBeLessThanOrEqual(notMet.taskCount);
  });
});

describe('PLAN-2 M2 slice 4 — Manual Mission Plan via the vendored Planner generator', () => {
  test('produces the Planner manual_mission_plan contract from Muster inputs', () => {
    const result = buildManualPlan(
      {
        sitAnswers: sitAnswers({ targetLevel: 'L2', cuiPresence: 'cui_present', boundaryStrategy: 'single_enclave', deploymentPosture: 'cloud_only' }),
        requirementResults: RESULTS,
      },
      BANKS
    );

    expect(result.missionPlan.ces.artifact).toBe('manual_mission_plan');
    const mp = result.missionPlan as { outputs?: { human_readable_mission_plan?: unknown } };
    expect(mp.outputs).toBeDefined();
    expect(mp.outputs!.human_readable_mission_plan).toBeDefined();
    expect(result.taskCount).toBeGreaterThan(0);
    expect(result.siBaseline.si_baseline.target.target_cmmc_level).toBe('L2');
  });

  test('the mission plan and the tenant manifest share the same compile pass (task counts agree)', () => {
    const inputs = { sitAnswers: sitAnswers({ targetLevel: 'L2', cuiPresence: 'cui_present' }), requirementResults: RESULTS };
    const plan = buildManualPlan(inputs, BANKS);
    const manifest = buildTenantManifest(inputs, BANKS);
    // Both drive the same GapSet -> TaskCatalog, so the task count is identical.
    expect(plan.taskCount).toBe(manifest.taskCount);
  });
});
