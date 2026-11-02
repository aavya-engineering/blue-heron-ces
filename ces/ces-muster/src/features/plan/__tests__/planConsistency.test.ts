// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-22: Planner's consistency rules as pre-push warnings (planValidation).
// The four fixture customers are consistent as shipped (no warning); variants
// of fixture (a) — a conflicting CUI boundary and a stale one (re-run
// discovery after the CUI answers) — produce the named warning, never a
// blocking error.
import 'fake-indexeddb/auto';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import { db } from '@/shared/db/schema';
import type { CUIBoundaryOutput, SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import type { PlanCompileResult } from '../planCompileService';

vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('./planTestSupport');
  const banks = loadBanks();
  return { loadCompilerBanks: async () => banks, _resetCompilerBanksCache: () => {} };
});

const { compilePlanForSession } = await import('../planCompileService');
const { checkPlanConsistency, checkDiscoveryStaleness, validatePlanAlignment } = await import('../planValidation');
const { loadCustomer, fixtureKeys } = await import('./parityHarness');

const consistency = (ws: string[]) => ws.filter((w) => w.startsWith('CONSISTENCY_'));
const codes = (ws: string[]) => consistency(ws).map((w) => w.split(':')[0]);

describe('MG-22: the fixture customers are consistent as shipped', () => {
  test.each(['a', 'b', 'c', 'd'])('fixture %s: the golden SI Baseline and CUI boundary raise no consistency warning', (fx) => {
    const { goldens } = loadCustomer(fx);
    expect(
      checkPlanConsistency({
        siBaseline: goldens['si-baseline'] as SIBaseline,
        cuiBoundary: (goldens['cui-boundary'] as CUIBoundaryOutput) ?? null,
      })
    ).toEqual([]);
  });

  test.each(fixtureKeys())('fixture %s: the session facts are not stale against discovery', (fx) => {
    expect(checkDiscoveryStaleness(loadCustomer(fx).musterSession.session.facts)).toEqual([]);
  });
});

describe('MG-22: a conflicting or stale variant of fixture (a) produces the named warning', () => {
  let compiled: PlanCompileResult;
  beforeAll(async () => {
    const { musterSession } = loadCustomer('a');
    await db.engagements.put(musterSession.engagement);
    await db.assessed_parties.put(musterSession.party);
    await db.interview_sessions.put(musterSession.session);
    compiled = await compilePlanForSession(musterSession.session.id);
  }, 120_000);

  const withCui = (patch: Record<string, string>): CUIBoundaryOutput => {
    const cui = compiled.artifacts.cuiBoundary!;
    return { ...cui, cui_boundary: { ...cui.cui_boundary, ...patch } };
  };
  const gate = (cui: CUIBoundaryOutput) =>
    validatePlanAlignment(compiled.artifacts.missionPlan, compiled.artifacts.tenantManifest, cui, compiled.artifacts.tenantConfig);

  test('the compiled fixture (a) plan carries no consistency warning', () => {
    expect(consistency(compiled.validation.warnings)).toEqual([]);
  });

  test('BYOD direct access on the CUI boundary vs SI "BYOD not allowed" -> CONSISTENCY_SI_CUI_BYOD (warn, not block)', () => {
    const base = gate(compiled.artifacts.cuiBoundary!);
    const r = gate(withCui({ device_model: 'BYOD direct access allowed' }));
    expect(codes(r.warnings)).toEqual(['CONSISTENCY_SI_CUI_BYOD']);
    expect(r.blocking).toEqual(base.blocking);
  });

  test('DevOps in scope on the CUI boundary vs SI "DevOps does not touch CUI" -> CONSISTENCY_SI_CUI_DEVOPS', () => {
    expect(codes(gate(withCui({ devops_in_scope: 'Yes – fully in scope' })).warnings)).toEqual(['CONSISTENCY_SI_CUI_DEVOPS']);
  });

  test('no external sharing on the CUI boundary vs SI teams_first collaboration -> CONSISTENCY_SI_CUI_SHARING', () => {
    expect(codes(gate(withCui({ external_sharing_model: 'No' })).warnings)).toEqual(['CONSISTENCY_SI_CUI_SHARING']);
  });

  test('discovery re-run after the CUI answers -> CONSISTENCY_CUI_STALE_VS_DISCOVERY', () => {
    const facts = loadCustomer('a').musterSession.session.facts.map((f: { provenance: string; question_id: string }) =>
      f.provenance === 'discovery' && f.question_id === 'iam-001' ? { ...f, recorded_at: '2026-02-01T00:00:00.000Z' } : f
    );
    const w = checkDiscoveryStaleness(facts);
    expect(codes(w)).toEqual(['CONSISTENCY_CUI_STALE_VS_DISCOVERY']);
    expect(w[0]).toContain('discovery run: 2026-02-01T00:00:00.000Z');
  });
});
