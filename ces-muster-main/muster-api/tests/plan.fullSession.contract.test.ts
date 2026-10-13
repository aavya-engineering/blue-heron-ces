// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FX-MU3 acceptance: a FULL interview session — every node of the question
// graph answered, readiness and plan-input (SI residue) alike — runs through
// the real generator and its output parses with the canonical ces-shared schema.
//
// The earlier contract proofs (missionPlan.generator.contract.test.ts) use a
// session with zero facts. This one drives the production session driver
// (src/driver/sessionDriver.ts: createSession → answer × N → completeInterview)
// into a real Dexie database (fake-indexeddb), then calls the production
// compilePlanForSession. Only the Vite-fetched banks are swapped for the same
// public/knowledge files read from disk (planTestSupport.loadBanks).
//
// "Fails if a required field is removed": the second test deletes required
// fields from the generated output and proves the same schema rejects it.
import 'fake-indexeddb/auto';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import * as path from 'node:path';
import {
  InfraManifestSchema,
  ManualMissionPlanSchema,
  TenantManifestSchema,
} from 'ces-shared/types/mission-plan';

const SPA_ROOT = path.resolve(__dirname, '../..');

vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('@/features/plan/__tests__/planTestSupport');
  const banks = loadBanks(SPA_ROOT);
  return {
    loadCompilerBanks: async () => banks,
    _resetCompilerBanksCache: () => {},
  };
});

const { createSession, answer, completeInterview } = await import('@/driver/sessionDriver');
const { loadQuestionGraph } = await import('@/features/interview/questionGraphService');
const { compilePlanForSession } = await import('@/features/plan/planCompileService');
const { SI_FIELD_LABELS } = await import('@/features/plan/siResidue');
const { parsePlanInputAnswer } = await import('@/features/interview/siPlanInputNodes');
type PlanCompileResult = Awaited<ReturnType<typeof compilePlanForSession>>;

// Every stack tag the graph gates on, so no node is filtered out.
const STACKS = ['Microsoft 365', 'microsoft_intune', 'microsoft_sentinel'];

// The full interview: a GCC High L2 CUI contractor partway to readiness.
// Readiness nodes carry a realistic mix (met / not met / unsure); every SI
// plan-input node is answered from its own option list.
const FULL_SESSION_ANSWERS: Record<string, string> = {
  // Identity and access
  'iam-001': 'yes', 'iam-002': 'no', 'iam-003': 'yes', 'iam-004': 'no', 'iam-005': 'unknown',
  // Endpoint
  'ep-001': 'yes', 'ep-002': 'no', 'ep-003': 'yes', 'ep-004': 'no',
  // Policy
  'pol-001': 'yes', 'pol-002': 'no', 'pol-003': 'no', 'pol-004': 'yes',
  // Monitoring
  'mon-001': 'no', 'mon-002': 'yes', 'mon-003': 'no', 'mon-004': 'unknown',
  // Data protection
  'dp-001': 'yes', 'dp-002': 'no', 'dp-003': 'yes', 'dp-004': 'no',
  // Incident response
  'ir-001': 'no', 'ir-002': 'yes', 'ir-003': 'no', 'ir-004': 'yes',
  // Boundary
  'bnd-001': 'yes', 'bnd-002': 'unsure', 'bnd-003': 'no',
  // SI plan inputs (residue the interview captures)
  'G-01': 'L2',
  'G-02': 'cui_present',
  'G-05': 'certification',
  'G-07': 'single_enclave',
  'G-08': 'cloud_only',
  'S-12': 'teams_first',
  'S-13': 'not_allowed',
  'S-16': 'c3pao_ready',
  'S-20': 'gcc_high',
  'SIT-020': 'm365_sentinel',
  'SIT-021': 'g5',
  'S-24': 'poam_if_allowed',
  // FC-MU (MU-10): the six operations postures, now live enum nodes
  'S-25': 'company_managed_only',
  'S-26': 'managed_wireless',
  'S-27': 'allowed_encrypted',
  'S-28': 'cloud_native',
  'S-29': 'managed_nonlocal',
  'S-30': 'managed_endpoints',
  // FC-MU (MU-10): the non-enum SIT residue, asked through typed inputs
  'G-03': 'CTI, Export Controlled',
  'G-04': 'ITAR technical data on two programs',
  'G-06': '2027-06-30; prime contract option year',
  'S-11': '40',
  'SIT-022': '35',
  'SIT-023': 'FR1234567890',
  'SIT-024': '2',
  'SIT-025': '0',
  // W4-MU1: Tenant Config Profile plan inputs (PLAN-3 M3)
  'TCP.TI.004': 'gcc_high',
  'TCP.LIC.001': 'm365_g5',
  'TCP.IA.004': 'entra_native',
  'TCP.IA.005': 'no',
  'TCP.PA.004': 'yes',
  'TCP.GA.004': 'assigned',
  'TCP.DM.001': 'azure_ad_join',
  // FC-MU-2 (MS-5): the provisioning intake nodes (well-formed answers; the
  // file/secret flows themselves are proven in plan.fullSession.provisioning).
  'TCP.MU.001': 'pim-approver@fixture.example',
  'TCP.MU.002': `file:terms.pdf;sha256:${'0'.repeat(64)}`,
  'TCP.MU.003': 'secretref:one-time:00000000-0000-4000-8000-000000000000',
};

let result: PlanCompileResult;
let engagementId: string;
let answeredCount = 0;

beforeAll(async () => {
  const handle = await createSession('individual_contractor', {
    stacks: STACKS,
    party: { name: 'Full Session Fixture Co', on_prem_ot: 'no' },
  });
  engagementId = handle.engagementId;

  const graph = await loadQuestionGraph(STACKS);
  // Fixture completeness guard: "full session" means every graph node, each
  // answered with one of that node's own option values.
  const missing = graph.filter((n) => !(n.id in FULL_SESSION_ANSWERS)).map((n) => n.id);
  expect(missing, 'fixture must answer every question-graph node').toEqual([]);
  for (const node of graph) {
    const value = FULL_SESSION_ANSWERS[node.id];
    if (node.input) {
      expect(parsePlanInputAnswer(node.input, value).ok, `${node.id} answer must parse as ${node.input}`).toBe(true);
    } else {
      expect(node.options.map((o) => o.value), `${node.id} answer must be a valid option`).toContain(value);
    }
    await answer(handle, node.id, value);
    answeredCount++;
  }
  await completeInterview(handle);

  result = await compilePlanForSession(handle.sessionId);
});

describe('FX-MU3: full interview session → generator → ces-shared schema', () => {
  test('MP + TM from a fully answered session parse with the canonical schema', () => {
    expect(answeredCount).toBe(Object.keys(FULL_SESSION_ANSWERS).length);

    const mp = ManualMissionPlanSchema.safeParse(result.artifacts.missionPlan);
    if (!mp.success) console.error('MP issues:', mp.error.issues.slice(0, 10));
    expect(mp.success).toBe(true);

    const tm = TenantManifestSchema.safeParse(result.artifacts.tenantManifest);
    if (!tm.success) console.error('TM issues:', tm.error.issues.slice(0, 10));
    expect(tm.success).toBe(true);

    const hrmp = (result.artifacts.missionPlan as {
      outputs: {
        human_readable_mission_plan: {
          target_level: string;
          steps?: unknown[];
          control_directives?: Array<{ control_id: string; directive: string }>;
        };
      };
    }).outputs.human_readable_mission_plan;
    // Non-vacuous: the answered interview drove real content.
    expect(hrmp.target_level).toBe('L2');
    expect(hrmp.steps?.length ?? 0).toBeGreaterThan(0);
    expect(hrmp.control_directives?.length ?? 0).toBeGreaterThan(0);

    // MS-R4 identity survives the full path.
    const ces = (mp.success ? mp.data.ces : {}) as Record<string, unknown>;
    expect(ces.cesId).toBe(engagementId);

    // The SI residue the interview answered is no longer reported as defaulted
    // (the rest of the 27-question SI bank — no graph node yet — still is).
    const answeredSiLabels = Object.keys(FULL_SESSION_ANSWERS)
      .filter((id) => /^(G|S|SIT)-/.test(id))
      .map((id) => SI_FIELD_LABELS[id] ?? id);
    for (const label of answeredSiLabels) expect(result.defaultedInputs).not.toContain(label);
    expect(result.defaultedInputs.length).toBeGreaterThan(0);

    // W4-MU1: the TCP answers produce a Tenant Config Profile and an Infra
    // Manifest that parses. SIT-020 derives to m365_azure from the declared M365
    // stacks, but FC-MU (MU-10) precedence (founder default 2026-09-27) is that an
    // explicit operator answer always beats a derivation — so the SI Baseline and
    // the manifest follow the interview answer (m365_sentinel).
    expect(result.artifacts.tenantConfig?.tenant_config.identity.cloud_environment).toBe('gcc_high');
    const siModel = (result.artifacts.siBaseline.si_baseline as { dependencies?: { infrastructure_model?: string } })
      .dependencies?.infrastructure_model;
    expect(siModel).toBe(FULL_SESSION_ANSWERS['SIT-020']);
    const infra = InfraManifestSchema.safeParse(result.artifacts.infrastructureManifest);
    if (!infra.success) console.error('Infra issues:', infra.error.issues.slice(0, 10));
    expect(infra.success).toBe(true);
    if (infra.success) {
      expect(infra.data.infrastructure.infrastructure_model).toBe(siModel);
      expect(infra.data.infrastructure.logging.map((r) => r.resource_type)).toContain('log_analytics_workspace');
    }

    // Size evidence for the push route's body limit (muster-api PLAN_BODY_LIMIT).
    const bytes = JSON.stringify({
      missionPlan: result.artifacts.missionPlan,
      tenantManifest: result.artifacts.tenantManifest,
    }).length;
    console.info(`FX-MU3 full-session push body: ${bytes} bytes compact`);
    expect(bytes).toBeLessThan(25 * 1024 * 1024);
  });

  test('the same schema rejects the full-session output when a required field is removed', () => {
    const cases: Array<{ name: string; mutate: (mp: any) => void; path: string }> = [
      { name: 'plan_id', mutate: (m) => delete m.outputs.human_readable_mission_plan.plan_id, path: 'outputs.human_readable_mission_plan.plan_id' },
      { name: 'ces.artifact', mutate: (m) => delete m.ces.artifact, path: 'ces.artifact' },
      { name: 'milestones', mutate: (m) => delete m.outputs.human_readable_mission_plan.milestones, path: 'outputs.human_readable_mission_plan.milestones' },
    ];
    for (const c of cases) {
      const broken = structuredClone(result.artifacts.missionPlan) as any;
      c.mutate(broken);
      const parsed = ManualMissionPlanSchema.safeParse(broken);
      expect(parsed.success, `MP without ${c.name} must fail`).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain(c.path);
      }
    }

    const brokenTm = structuredClone(result.artifacts.tenantManifest) as any;
    delete brokenTm.tenant_manifest;
    const tmParsed = TenantManifestSchema.safeParse(brokenTm);
    expect(tmParsed.success, 'TM without tenant_manifest must fail').toBe(false);
    if (!tmParsed.success) {
      expect(tmParsed.error.issues.map((i) => i.path.join('.'))).toContain('tenant_manifest');
    }
  });
});
