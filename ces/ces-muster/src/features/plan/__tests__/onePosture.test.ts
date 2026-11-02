// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-03 (2C-0): one posture everywhere. For fixture (a) and for a
// discovery-only session (the e2e sim discovery file, imported the way the
// headless runner does), the MP's embedded posture summary, the Result
// screen's posture (loadSessionPosture), the readiness export's
// derived.requirement_results and the runner's trace counts (postureCounts over
// compiled.posture) agree on every requirement.
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { db } from '@/shared/db/schema';
import type { InterviewSession } from '@/shared/types/engagement';

vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('./planTestSupport');
  const banks = loadBanks();
  return { loadCompilerBanks: async () => banks, _resetCompilerBanksCache: () => {} };
});

const { compilePlanForSession } = await import('../planCompileService');
const { loadSessionPosture, postureRequirementRows, postureCounts } = await import('../sessionPosture');
const { executeReadinessExport } = await import('@/features/export/readinessResultService');
const { loadCustomer } = await import('./parityHarness');

type Row = { requirement_id: string; status: string };
const byId = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.requirement_id, r.status]));

async function assertOnePosture(sessionId: string): Promise<ReturnType<typeof postureCounts>> {
  const compiled = await compilePlanForSession(sessionId);
  const mp = compiled.artifacts.missionPlan as unknown as {
    inputs: { readiness_posture: { snapshot_id: string; control_status_summary: Record<string, number> } };
  };
  const mpSummary = mp.inputs.readiness_posture.control_status_summary;

  // The runner's trace: postureCounts over the compile's posture (plan-from-discovery.ts).
  const traceRows = postureRequirementRows(compiled.posture);
  const trace = postureCounts(traceRows);
  // The Result screen's posture and the readiness export (Readiness tab + download).
  const screen = postureRequirementRows((await loadSessionPosture(sessionId)).posture);
  const exported = (await executeReadinessExport(sessionId)).derived.requirement_results ?? [];

  expect(trace.total).toBeGreaterThan(0);
  // The MP embedded this exact posture object, not an equal-count copy.
  expect(mp.inputs.readiness_posture.snapshot_id).toBe(compiled.posture.ces.snapshot_id);
  for (const k of ['met', 'partial', 'not_met', 'unknown'] as const) expect(mpSummary[k], k).toBe(trace[k]);
  expect(byId(screen)).toEqual(byId(traceRows));
  expect(byId(exported)).toEqual(byId(traceRows));
  // The four statuses only.
  for (const r of traceRows) expect(['met', 'partial', 'not_met', 'unknown']).toContain(r.status);
  return trace;
}

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
});

describe('MG-03: one posture for the MP, the Result screen, the export and the runner trace', () => {
  test('fixture (a)', async () => {
    const { musterSession } = loadCustomer('a');
    await db.engagements.put(musterSession.engagement);
    await db.assessed_parties.put(musterSession.party);
    // The export needs the Situation-tab manifest; the fixture session predates it.
    const session: InterviewSession = {
      ...musterSession.session,
      readiness_manifest: musterSession.session.readiness_manifest ?? {
        mode: 'independent',
        auth_tier: 'lite',
        tenant_slug: 'fixture-a',
        tenant_kind: 'sim',
        operator_name: 'Test Operator',
        operator_role: 'assessor',
      },
    };
    await db.interview_sessions.put(session);
    await assertOnePosture(session.id);
  });

  test('discovery-only session (the runner import path, no interview answers)', async () => {
    const { createSession, completeInterview } = await import('@/driver/sessionDriver');
    const { parseReadinessResultFile, discoveryResultsFromPayload, factsFromPayload } = await import(
      '@/features/discovery/importReadinessResult'
    );
    const { synthesizeFactsFromDiscovery } = await import('@/features/interview/discoveryFactJoin');
    const { inferBoundaryDrafts } = await import('@/features/interview/boundaryInference');
    const { processBoundaryDecisions } = await import('@/features/discovery/boundaryConfirm');
    const { QUESTION_GRAPH } = await import('@/features/interview/questionGraph');
    const { stackFilteredGraph } = await import('@/features/interview/questionGraphService');
    const { applyDiscoveryFacts, factsFromAnswers } = await import('@/features/assessment/assessmentHelpers');

    const payload = parseReadinessResultFile(
      fs.readFileSync(path.resolve(process.cwd(), 'e2e/fixtures/sim-discovery-result.json'), 'utf8')
    );
    const stacks = ['m365_e5_gcc', 'microsoft_intune', 'microsoft_sentinel'];
    const results = discoveryResultsFromPayload(payload);
    const handle = await createSession(payload.manifest.engagement_kind, { stacks, party: { name: 'Sim tenant', on_prem_ot: 'no' } });
    const staged = [
      ...synthesizeFactsFromDiscovery(results, QUESTION_GRAPH),
      ...processBoundaryDecisions(inferBoundaryDrafts(results), {}, ''),
      ...factsFromPayload(payload),
    ];
    const prefill = applyDiscoveryFacts(staged, {});
    const facts = factsFromAnswers(stackFilteredGraph(stacks), prefill.answers, prefill.provenances, prefill.confidences, prefill.attestations);
    expect(facts.length).toBeGreaterThan(0);
    await db.interview_sessions.update(handle.sessionId, {
      facts,
      discovery_results: results,
      discovery_observations: payload.observations,
      readiness_manifest: {
        mode: payload.manifest.mode,
        auth_tier: payload.manifest.auth_tier,
        tenant_slug: 'sim-local',
        tenant_kind: payload.manifest.tenant.kind,
        operator_name: payload.manifest.operator.name,
        operator_role: payload.manifest.operator.role,
      },
    });
    await completeInterview(handle);
    await assertOnePosture(handle.sessionId);
  });
});
