// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MS-R1 (M3) acceptance: a plan produced by the REAL generator
// (src/features/plan/planCompileService.ts → compilePlanForSession) parses
// with the canonical ces-shared schema — imported straight from
// 'ces-shared/types/mission-plan', not through Muster's re-export, so this
// proves the shared contract itself accepts Muster's output.
//
// Only the I/O edges are faked: Dexie (an in-memory session/party/engagement)
// and the Vite-fetched banks (loaded from the same public/knowledge files via
// planTestSupport). Everything between — routing, requirement posture, SI
// derivation, buildPlanArtifacts, the SPA core pre-check — is the real code.
import { describe, test, expect, vi } from 'vitest';
import * as path from 'node:path';
import {
  ManualMissionPlanSchema,
  TenantManifestSchema,
} from 'ces-shared/types/mission-plan';

const SPA_ROOT = path.resolve(__dirname, '../..');

const ENGAGEMENT_ID = 'eng-generator-contract-001';
const SESSION = {
  id: 'sess-generator-contract-001',
  party_id: 'party-generator-contract-001',
  selected_stacks: [] as string[],
  facts: [] as unknown[],
  preamble: null,
  readiness_manifest: null,
};

vi.mock('@/shared/db/schema', () => ({
  db: {
    interview_sessions: { get: async (id: string) => (id === SESSION.id ? SESSION : undefined) },
    assessed_parties: {
      get: async (id: string) =>
        id === SESSION.party_id ? { id, engagement_id: ENGAGEMENT_ID } : undefined,
    },
    engagements: {
      get: async (id: string) =>
        id === ENGAGEMENT_ID ? { id, engagement_kind: 'readiness' } : undefined,
    },
  },
}));

vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('@/features/plan/__tests__/planTestSupport');
  const banks = loadBanks(SPA_ROOT);
  return {
    loadCompilerBanks: async () => banks,
    _resetCompilerBanksCache: () => {},
  };
});

const { compilePlanForSession } = await import('@/features/plan/planCompileService');

describe('MS-R1 (M3): real generator output parses with the shared schema', () => {
  test('compilePlanForSession MP + TM pass ces-shared ManualMissionPlanSchema / TenantManifestSchema', async () => {
    const result = await compilePlanForSession(SESSION.id);

    const mp = ManualMissionPlanSchema.safeParse(result.artifacts.missionPlan);
    if (!mp.success) console.error('MP issues:', mp.error.issues.slice(0, 10));
    expect(mp.success).toBe(true);

    const tm = TenantManifestSchema.safeParse(result.artifacts.tenantManifest);
    if (!tm.success) console.error('TM issues:', tm.error.issues.slice(0, 10));
    expect(tm.success).toBe(true);

    // Non-vacuous: the generated plan carries real steps and directives, so
    // the typed ManualStep body schema (S4) was actually exercised.
    const hrmp = (result.artifacts.missionPlan as {
      outputs: { human_readable_mission_plan: { steps?: unknown[]; control_directives?: unknown[] } };
    }).outputs.human_readable_mission_plan;
    expect(hrmp.steps?.length ?? 0).toBeGreaterThan(0);
    expect(hrmp.control_directives?.length ?? 0).toBeGreaterThan(0);

    // The generator stamped the engagement identity (MS-R4) and the shared
    // contract kept it (passthrough/optional field, not stripped).
    const ces = (mp.success ? mp.data.ces : {}) as Record<string, unknown>;
    expect(ces.cesId).toBe(ENGAGEMENT_ID);
  });
});
