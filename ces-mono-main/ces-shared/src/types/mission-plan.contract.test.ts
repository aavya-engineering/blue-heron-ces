// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ManualMissionPlanSchema,
  TenantManifestSchema,
  InfraManifestSchema,
  ControlDispositionSchema,
  ControlDirectiveSchema,
  MISSION_PLAN_CONTRACT_VERSION,
  type ManualMissionPlan,
  type ControlDisposition,
  type ControlDirective,
} from './mission-plan.contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

function loadFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));
}

// ─── Minimal inline fixture (for fast, self-contained tests) ─────

function makeMinimalPlan(overrides: Record<string, any> = {}): ManualMissionPlan {
  return {
    ces: {
      artifact: 'manual_mission_plan',
      version: MISSION_PLAN_CONTRACT_VERSION,
      generated_on: '2026-09-26',
      intent: 'Test plan',
      cesId: 'ces-test-001',
      ...overrides.ces,
    },
    inputs: {},
    outputs: {
      human_readable_mission_plan: {
        plan_id: 'test-plan-001',
        plan_mode: 'harden_existing',
        target_level: 'L2',
        milestones: [{
          id: 'ms-1',
          name: 'Phase 1',
          objective: 'Configure',
          exit_criteria: ['All controls configured'],
          target_date: '2026-12-31',
        }],
        assessor_alignment_notes: ['Note 1'],
        controls: [{
          requirement_id: 'AC.L2-3.1.1',
          title: 'Authorized Access',
          domain: 'AC',
          level: 'L2',
          scope_status: 'in_scope',
          stamper_action: 'Automated',
          task_ids: ['task-1'],
          estimated_effort_hours: 2,
          gap_classifications: ['configure'],
        }],
        control_directives: [{
          control_id: 'AC.L2-3.1.1',
          directive: 'implement',
          step_ids: ['task-1'],
        }],
        ...overrides.plan,
      },
      ...overrides.outputs,
    },
  };
}

describe('ManualMissionPlanSchema', () => {
  it('parses a minimal inline fixture', () => {
    const plan = makeMinimalPlan();
    const result = ManualMissionPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it('round-trips without losing controls[] or control_directives[]', () => {
    const plan = makeMinimalPlan();
    const result = ManualMissionPlanSchema.parse(plan);
    expect(result.outputs.human_readable_mission_plan.controls).toHaveLength(1);
    expect(result.outputs.human_readable_mission_plan.control_directives).toHaveLength(1);
  });

  it('preserves cesId on the ces envelope (MS-R4)', () => {
    const plan = makeMinimalPlan({ ces: { cesId: 'ces-abc-123' } });
    const result = ManualMissionPlanSchema.parse(plan);
    expect(result.ces.cesId).toBe('ces-abc-123');
  });

  it('preserves customerId and siBaselineId (MS-R4)', () => {
    const plan = makeMinimalPlan({
      ces: { customerId: 42, siBaselineId: 7 },
    });
    const result = ManualMissionPlanSchema.parse(plan);
    expect(result.ces.customerId).toBe(42);
    expect(result.ces.siBaselineId).toBe(7);
  });

  it('rejects an unknown plan version', () => {
    const plan = makeMinimalPlan({ ces: { version: '99.0.0' } });
    const result = ManualMissionPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success) {
      const versionIssue = result.error.issues.find(
        i => i.path.includes('version')
      );
      expect(versionIssue).toBeDefined();
    }
  });

  it('rejects a wrong artifact name', () => {
    const plan = makeMinimalPlan({ ces: { artifact: 'not_a_mission_plan' } });
    const result = ManualMissionPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it('accepts a plan with no controls (legacy/empty)', () => {
    const plan = makeMinimalPlan({ plan: { controls: undefined } });
    const result = ManualMissionPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it('accepts a plan with no control_directives (legacy path)', () => {
    const plan = makeMinimalPlan({ plan: { control_directives: undefined } });
    const result = ManualMissionPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  // ─── Real fixture: Muster-generated plan ─────────────────────

  it('parses the Muster-generated mission plan fixture', () => {
    const raw = loadFixture('muster-mission-plan.json');
    const result = ManualMissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      const mp = result.data.outputs.human_readable_mission_plan;
      expect(mp.controls?.length).toBeGreaterThan(0);
      expect(mp.control_directives?.length).toBeGreaterThan(0);
    }
  });

  it('round-trips the Muster fixture without key loss', () => {
    const raw = loadFixture('muster-mission-plan.json') as Record<string, unknown>;
    const parsed = ManualMissionPlanSchema.parse(raw);
    expect(parsed).toEqual(raw);
  });

  // ─── Real fixture: legacy ces-planner (tester demo plan) ─────

  it('parses the legacy ces-planner / tester demo plan fixture', () => {
    const raw = loadFixture('legacy-mission-plan.json');
    const result = ManualMissionPlanSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ces.cesId).toBe('ces-5e910877b82d');
    }
  });

  it('round-trips the legacy fixture without key loss', () => {
    const raw = loadFixture('legacy-mission-plan.json') as Record<string, unknown>;
    const parsed = ManualMissionPlanSchema.parse(raw);
    expect(parsed).toEqual(raw);
  });

  it('passthrough preserves unknown keys at every level', () => {
    const plan = makeMinimalPlan({
      ces: { future_ces_field: 'kept' },
      plan: {
        future_plan_field: 'kept',
        controls: [{
          requirement_id: 'AC.L2-3.1.1',
          title: 'Test', domain: 'AC', level: 'L2',
          scope_status: 'in_scope', stamper_action: 'Automated',
          task_ids: [], estimated_effort_hours: 0,
          gap_classifications: [],
          future_disp_field: 'kept',
        }],
        control_directives: [{
          control_id: 'AC.L2-3.1.1',
          directive: 'implement',
          future_dir_field: 'kept',
        }],
        scope_exclusions: [{
          requirement_id: 'AC.L2-3.1.1',
          justification: 'test',
          si_field: 'f', si_value: 'v',
          future_excl_field: 'kept',
        }],
        milestones: [{
          id: 'ms-1', name: 'P1', objective: 'O',
          exit_criteria: ['done'], target_date: '2026-12-31',
          future_ms_field: 'kept',
        }],
      },
    });
    (plan as any).future_top_field = 'kept';
    (plan as any).outputs.future_outputs_field = 'kept';

    const parsed = ManualMissionPlanSchema.parse(plan);
    expect(parsed).toEqual(plan);
  });
});

describe('TenantManifestSchema', () => {
  it('parses the Muster-generated tenant manifest fixture', () => {
    const raw = loadFixture('muster-tenant-manifest.json');
    const result = TenantManifestSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it('round-trips the tenant manifest fixture without key loss', () => {
    const raw = loadFixture('muster-tenant-manifest.json') as Record<string, unknown>;
    const parsed = TenantManifestSchema.parse(raw);
    expect(parsed).toEqual(raw);
  });

  it('rejects a manifest with wrong artifact name', () => {
    const manifest = {
      ces: {
        artifact: 'manual_mission_plan',
        version: '1.0.0',
        generated_on: '2026-09-26T00:00:00.000Z',
        intent: 'test',
      },
      tenant_manifest: { manifest_id: 'test' },
    };
    const result = TenantManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it('rejects a manifest with unknown version', () => {
    const manifest = {
      ces: {
        artifact: 'tenant_manifest',
        version: '99.0.0',
        generated_on: '2026-09-26T00:00:00.000Z',
        intent: 'test',
      },
      tenant_manifest: { manifest_id: 'test' },
    };
    const result = TenantManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });
});

describe('ControlDispositionSchema', () => {
  it('accepts all 5 StamperAction values', () => {
    const base: ControlDisposition = {
      requirement_id: 'AC.L2-3.1.1',
      title: 'Test',
      domain: 'AC',
      level: 'L2',
      scope_status: 'in_scope',
      stamper_action: 'Automated',
      task_ids: [],
      estimated_effort_hours: 0,
      gap_classifications: [],
    };

    for (const action of [
      'Automated',
      'Non-Stack',
      'N-A-Capability-Absent',
      'Met-By-Prohibition',
      'Inherited-FedRAMP',
    ] as const) {
      const result = ControlDispositionSchema.safeParse({ ...base, stamper_action: action });
      expect(result.success, `StamperAction '${action}' should be accepted`).toBe(true);
    }
  });

  it('rejects an unknown StamperAction', () => {
    const result = ControlDispositionSchema.safeParse({
      requirement_id: 'AC.L2-3.1.1',
      title: 'Test',
      domain: 'AC',
      level: 'L2',
      scope_status: 'in_scope',
      stamper_action: 'Unknown',
      task_ids: [],
      estimated_effort_hours: 0,
      gap_classifications: [],
    });
    expect(result.success).toBe(false);
  });

  it('preserves inheritance metadata (MS-R4)', () => {
    const disp: ControlDisposition = {
      requirement_id: 'PE.L2-3.10.3',
      title: 'Test',
      domain: 'PE',
      level: 'L2',
      scope_status: 'in_scope',
      stamper_action: 'Inherited-FedRAMP',
      task_ids: [],
      estimated_effort_hours: 0,
      gap_classifications: [],
      inheritance_rationale: 'FedRAMP Moderate baseline covers this control',
      fedramp_package_id: 'FR1234567890',
      requires_stamper_verification: true,
    };
    const result = ControlDispositionSchema.parse(disp);
    expect(result.inheritance_rationale).toBe('FedRAMP Moderate baseline covers this control');
    expect(result.fedramp_package_id).toBe('FR1234567890');
    expect(result.requires_stamper_verification).toBe(true);
  });
});

describe('ControlDirectiveSchema', () => {
  it('accepts all 9 directive values', () => {
    const directives = [
      'implement', 'validate', 'manual',
      'document-absence', 'document-prohibition', 'document-renderable',
      'inherit-fedramp', 'eo-tooled', 'skip',
    ] as const;
    for (const directive of directives) {
      const result = ControlDirectiveSchema.safeParse({
        control_id: 'AC.L2-3.1.1',
        directive,
      });
      expect(result.success, `directive '${directive}' should be accepted`).toBe(true);
    }
  });

  it('rejects an unknown directive', () => {
    const result = ControlDirectiveSchema.safeParse({
      control_id: 'AC.L2-3.1.1',
      directive: 'destroy',
    });
    expect(result.success).toBe(false);
  });

  it('preserves inheritance metadata (MS-R4)', () => {
    const cd: ControlDirective = {
      control_id: 'PE.L2-3.10.3',
      directive: 'inherit-fedramp',
      inheritance_rationale: 'Covered by FedRAMP Moderate',
      fedramp_package_id: 'FR1234567890',
      tenant_variant: 'gcc_high',
      requires_stamper_verification: false,
    };
    const result = ControlDirectiveSchema.parse(cd);
    expect(result.fedramp_package_id).toBe('FR1234567890');
    expect(result.tenant_variant).toBe('gcc_high');
  });
});

describe('N-12 infrastructure_manifest alias', () => {
  const infraMeta = {
    artifact: 'infrastructure_manifest',
    version: '1.0.0' as const,
    generated_on: '2026-09-27',
    intent: 'test',
  };
  const body = {
    identity: [], logging: [], security: [], storage: [],
    network: [], automation: [], diagnostics: [],
    stamper_variable_map: {
      subscriptionId: 's', resourceGroup: 'rg', location: 'l',
      lawWorkspaceName: 'law', eoAppDisplayName: 'eo',
      storageAccountName: '', keyVaultName: '', cmkKeyName: '',
      vnetName: '', vnetCidr: '', subnetPeName: '', subnetPeCidr: '',
      nsgPeName: '', automationAccountName: '',
    },
    registry_coverage: {
      total_infra_entries: 0, covered_entry_ids: [],
      uncovered_entry_ids: [], coverage_pct: 0,
    },
    provenance: [],
  };

  it('parses an envelope with the canonical infrastructure key', () => {
    const result = InfraManifestSchema.safeParse({
      ces: infraMeta,
      infrastructure: body,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.infrastructure).toEqual(body);
    }
  });

  it('parses an envelope with the deprecated infrastructure_manifest key', () => {
    const result = InfraManifestSchema.safeParse({
      ces: infraMeta,
      infrastructure_manifest: body,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.infrastructure).toEqual(body);
      expect((result.data as any).infrastructure_manifest).toBeUndefined();
    }
  });

  it('accepts both keys when values are identical', () => {
    const result = InfraManifestSchema.safeParse({
      ces: infraMeta,
      infrastructure: body,
      infrastructure_manifest: body,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.infrastructure).toEqual(body);
    }
  });

  it('rejects both keys when values differ', () => {
    const result = InfraManifestSchema.safeParse({
      ces: infraMeta,
      infrastructure: body,
      infrastructure_manifest: { different: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an envelope with neither key', () => {
    const result = InfraManifestSchema.safeParse({
      ces: infraMeta,
    });
    expect(result.success).toBe(false);
  });
});
