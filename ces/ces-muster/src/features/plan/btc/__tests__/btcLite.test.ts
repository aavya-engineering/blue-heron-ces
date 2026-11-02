// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-09 (BTC-lite) done-when:
//  - activated rules, risk flags and gate results equal Planner's for fixture (a)
//    (__fixtures__/planner-btc-a.json: ces-planner's own BTC services over the
//    fixture's planner-golden SI + CUI boundary; Planner's goldens carry no BTC);
//  - requirements with captured evidence move unknown -> partial in the emitted
//    posture (the discovery-only session from e2e/fixtures/sim-discovery-result.json);
//  - the BTC output reaches the gap set, the TM and the MP only when discovery captured evidence.
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { db } from '@/shared/db/schema';
import type { InterviewFact } from '@/shared/types/engagement';
import type { ReadinessObservation } from '@/shared/types/readinessResult';
import { buildBtcLite, parseBtcBanks, raisePostureWithEvidence, BTC_EVIDENCE_NOTE } from '../btcLite';
import { BTC_GATE_NODES, BTC_NODE_SPECS, btcOptionValue } from '../btcGateNodes';
import { discoveryEvidenceItems, btcEvidencedQuestionIds } from '@/features/discovery/discoveryEvidence';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import plannerRefA from '../__fixtures__/planner-btc-a.json';

vi.mock('@/features/plan/compilerBanks', async () => {
  const { loadBanks } = await import('../../__tests__/planTestSupport');
  const banks = loadBanks();
  return { loadCompilerBanks: async () => banks, _resetCompilerBanksCache: () => {} };
});

const { compilePlanForSession } = await import('../../planCompileService');
const { loadSessionPosture, postureRequirementRows, postureCounts } = await import('../../sessionPosture');
const { loadCustomer } = await import('../../__tests__/parityHarness');

const root = process.cwd();
const yaml = (f: string) => load(fs.readFileSync(path.resolve(root, 'public/knowledge', f), 'utf8'));
const banks = { btcQuestionBank: yaml('primed BTC Question Bank.yaml'), btcActivationPackage: yaml('CES BTC Activation Package.yaml') };
const golden = (fx: string, f: string) =>
  JSON.parse(fs.readFileSync(path.resolve(root, `src/features/plan/__fixtures__/customers/${fx}/planner-golden/${f}`), 'utf8'));
const simPayload = () =>
  JSON.parse(fs.readFileSync(path.resolve(root, 'e2e/fixtures/sim-discovery-result.json'), 'utf8')) as {
    observations: ReadinessObservation[];
  };

describe('MG-09: bank transcription and the asked set', () => {
  test('asked nodes + discovery-evidenced questions partition the bank; nodes transcribe the bank', () => {
    const bank = parseBtcBanks(banks);
    const all = bank.sections.flatMap((s) => s.questions);
    const evidenced = btcEvidencedQuestionIds().filter((id) => !id.endsWith('.CA_ENFORCEMENT_PROOF'));
    const asked = BTC_NODE_SPECS.map((s) => s.id);
    expect([...asked, ...evidenced].sort()).toEqual(all.map((q) => q.id).sort());
    expect(asked.filter((id) => evidenced.includes(id))).toEqual([]);
    for (const spec of BTC_NODE_SPECS) {
      const q = all.find((x) => x.id === spec.id)!;
      expect(spec.text).toBe(q.prompt);
      expect(spec.bankOptions).toEqual(q.options);
    }
    // Every virtual id the map names exists in the bank.
    const virtualIds = bank.virtualQuestions.map((q) => q.id);
    for (const id of btcEvidencedQuestionIds()) expect([...all.map((q) => q.id), ...virtualIds]).toContain(id);
    // The asked nodes are in the one graph, score-leak safe.
    for (const n of BTC_GATE_NODES) {
      expect(QUESTION_GRAPH.find((g) => g.id === n.id)).toBeTruthy();
      expect(n.mapped_requirements).toEqual([]);
    }
    expect(btcOptionValue('Guests present - not aligned')).toBe('guests_present_not_aligned');
  });
});

describe("MG-09: fixture (a) equals Planner's BTC services", () => {
  test('activated rules, risk flags, gate results, derived answers and runlist modes', () => {
    const r = buildBtcLite({
      siBaseline: golden('a', 'si-baseline.json'),
      cuiBoundary: golden('a', 'cui-boundary.json'),
      evidence: [],
      facts: [],
      banks,
    })!;
    const out = r.confirmation.btc_confirmation;
    const activated = out.decision_log.filter((d) => d.result === 'matched').map((d) => d.rule_id);
    expect(activated).toEqual(plannerRefA.activated_rules);
    expect(activated).toEqual(['BTC-RULE-DEVOPS-NOT-IN-SCOPE', 'BTC-RULE-MANAGED-ONLY', 'BTC-RULE-EMAIL-FWD-NO']);
    expect(out.decision_log).toEqual(plannerRefA.decision_log);
    expect(out.risk_flags).toEqual(plannerRefA.risk_flags);
    expect(out.gate_status).toEqual(plannerRefA.gate_status);
    expect(Object.fromEntries(Object.entries(out.answers).map(([k, v]) => [k, v.answer]))).toEqual(plannerRefA.answers);
    expect(
      r.runlist.entries.map((e) => ({
        question_id: e.question_id,
        section_id: e.section_id,
        mode: e.mode,
        required: e.required,
        evidence_required: e.evidence_required,
        activated_by_rules: e.activated_by_rules,
        ...(e.substitute_source_id ? { substitute_source_id: e.substitute_source_id } : {}),
      }))
    ).toEqual(plannerRefA.runlist);
  });

  test('no CUI boundary -> no BTC (Planner builds none without one)', () => {
    expect(buildBtcLite({ siBaseline: golden('a', 'si-baseline.json'), cuiBoundary: null, evidence: [], facts: [], banks })).toBeNull();
  });

  test('captures and asked answers move the gates', () => {
    const evidence = discoveryEvidenceItems(
      [
        { control_id: 'AU.L2-3.3.1', objective_ids: [], confidence: 'high', ran_entry_ids: ['AU.L2-3.3.1.audit-enable'], raw_capture_ref: 'captures/ae.txt', derived_posture: 'met' },
        { control_id: 'AU.L2-3.3.1', objective_ids: [], confidence: 'high', ran_entry_ids: ['AU.L2-3.3.1.audit-retention'], raw_capture_ref: 'captures/ar.txt', derived_posture: 'unknown' },
        { control_id: 'AU.L2-3.3.8', objective_ids: [], confidence: 'high', ran_entry_ids: ['AZ-LOG-004'], raw_capture_ref: 'captures/lk.txt', derived_posture: 'unknown' },
        { control_id: 'AU.L2-3.3.1', objective_ids: [], confidence: 'high', ran_entry_ids: ['AZ-LOG-001'], raw_capture_ref: 'captures/law.txt', derived_posture: 'unknown' },
        { control_id: 'AC.L1-3.1.1', objective_ids: [], confidence: 'high', ran_entry_ids: ['AC.L1-3.1.1.ca-policy-evidence'], raw_capture_ref: 'captures/ca.txt', derived_posture: 'met' },
        { control_id: 'AC.L2-3.1.18', objective_ids: [], confidence: 'high', ran_entry_ids: ['AC.L2-3.1.18.byod-nonbrowser-signins'], raw_capture_ref: 'captures/si.txt', derived_posture: 'unknown' },
      ],
      '2026-01-15T00:00:00.000Z'
    );
    const fact = (question_id: string, answer: string): InterviewFact =>
      ({ question_id, question_text: question_id, answer, provenance: 'operator_interview', confidence: 'high', recorded_at: '2026-01-15T00:00:00.000Z' }) as InterviewFact;
    const facts = ['BTC.GOV.001', 'BTC.GOV.002', 'BTC.GOV.003', 'BTC.GOV.004'].map((id) => fact(id, 'yes'));
    const r = buildBtcLite({ siBaseline: golden('a', 'si-baseline.json'), cuiBoundary: golden('a', 'cui-boundary.json'), evidence, facts, banks })!;
    const out = r.confirmation.btc_confirmation;
    // LOG.001 answered by its verdict; LOG.002-004 evidenced but unanswered (not asked: the reading needs review).
    expect(out.answers['BTC.LOG.001'].answer).toBe('Yes');
    expect(out.gate_status['DV-03'].reason).toBe('BTC.LOG.002: not answered; BTC.LOG.003: not answered; BTC.LOG.004: not answered');
    // DEV.002 is substituted for (a): the CA export counts, the sign-in query does not.
    expect(out.evidence_refs.filter((e) => e.question_id === 'BTC.DEV.002').map((e) => e.evidence_id)).toEqual([
      'disc:AC.L1-3.1.1.ca-policy-evidence',
    ]);
    expect(out.gate_status['DV-06']).toEqual({ domain: 'Exception & Governance Validation', pass: true, reason: 'All requirements met' });
    expect(r.unanswered).not.toContain('BTC.GOV.001');
  });
});

describe('MG-09: discovery captures as posture evidence', () => {
  test('one evidence item per captured entry, mapped to every control it covers', () => {
    const obs = simPayload().observations;
    const items = discoveryEvidenceItems(obs, '2026-09-27T20:53:27.055Z');
    const captured = obs.filter((o) => o.raw_capture_ref);
    expect(items).toHaveLength(new Set(captured.flatMap((o) => o.ran_entry_ids)).size);
    for (const o of captured) {
      const item = items.find((i) => i.entry_id === o.ran_entry_ids[0])!;
      expect(item.location).toBe(o.raw_capture_ref);
      expect(item.mapped_requirements).toContain(o.control_id);
    }
    expect(discoveryEvidenceItems(obs.filter((o) => !o.raw_capture_ref), 'x')).toEqual([]);
  });

  test('raise: only unknown -> partial, with Planner note; summary recounted', () => {
    const posture = {
      ces: {
        control_status_summary: { level: 'L2', met: 1, partial: 0, not_met: 1, unknown: 1 },
        key_findings: [],
        requirement_results: [
          { requirement_id: 'R1', status: 'unknown', evidence_refs: [] as Array<{ evidence_id: string }> },
          { requirement_id: 'R2', status: 'met', evidence_refs: [] as Array<{ evidence_id: string }> },
          { requirement_id: 'R3', status: 'not_met', evidence_refs: [] as Array<{ evidence_id: string }> },
        ],
        evidence_index: [] as Array<{ evidence_id: string; source_system: string; location: string; hash_sha256: string }>,
      },
    };
    const items = discoveryEvidenceItems(
      ['R1', 'R2', 'R3'].map((id) => ({ control_id: id, objective_ids: [], confidence: 'high' as const, ran_entry_ids: ['E1'], raw_capture_ref: 'captures/E1.txt', derived_posture: 'met' as const })),
      '2026-01-15T00:00:00.000Z'
    );
    expect(raisePostureWithEvidence(posture, items)).toEqual(['R1']);
    expect(posture.ces.requirement_results.map((r) => r.status)).toEqual(['partial', 'met', 'not_met']);
    expect((posture.ces.requirement_results[0] as { notes?: string }).notes).toBe(BTC_EVIDENCE_NOTE);
    expect(posture.ces.control_status_summary).toEqual({ level: 'L2', met: 1, partial: 1, not_met: 1, unknown: 0 });
    expect(posture.ces.evidence_index.map((e) => e.evidence_id)).toEqual(['disc:E1']);
    expect(posture.ces.requirement_results[2].evidence_refs).toEqual([{ evidence_id: 'disc:E1' }]);
  });
});

beforeEach(async () => {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
});

/** onePosture.test.ts's discovery-only session (the runner import path), optionally without its observations. */
async function discoveryOnlySession(opts: { observations: boolean; simBoundary: boolean }): Promise<string> {
  const { createSession, completeInterview } = await import('@/driver/sessionDriver');
  const { parseReadinessResultFile, discoveryResultsFromPayload, factsFromPayload } = await import(
    '@/features/discovery/importReadinessResult'
  );
  const { synthesizeFactsFromDiscovery } = await import('@/features/interview/discoveryFactJoin');
  const { inferBoundaryDrafts } = await import('@/features/interview/boundaryInference');
  const { processBoundaryDecisions } = await import('@/features/discovery/boundaryConfirm');
  const { stackFilteredGraph } = await import('@/features/interview/questionGraphService');
  const { applyDiscoveryFacts, factsFromAnswers } = await import('@/features/assessment/assessmentHelpers');

  const payload = parseReadinessResultFile(fs.readFileSync(path.resolve(root, 'e2e/fixtures/sim-discovery-result.json'), 'utf8'));
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
  if (opts.simBoundary) {
    // plan-from-discovery.ts SIM_BOUNDARY_DECISION (sim only): CUI presence, so a boundary exists.
    facts.push({
      question_id: 'G-02',
      question_text: 'SIM-ONLY DEFAULT: CUI presence assumed so the sim plan carries a CUI boundary',
      answer: 'cui_present',
      provenance: 'defaulted',
      confidence: 'high',
      recorded_at: '2026-09-27T20:53:27.055Z',
    } as InterviewFact);
  }
  await db.interview_sessions.update(handle.sessionId, {
    facts,
    discovery_results: results,
    ...(opts.observations ? { discovery_observations: payload.observations } : {}),
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
  return handle.sessionId;
}

describe('MG-09: the discovery-only session', () => {
  test('requirements with captured evidence move unknown -> partial in the emitted posture', async () => {
    const before = await loadSessionPosture(await discoveryOnlySession({ observations: false, simBoundary: false }));
    const afterId = await discoveryOnlySession({ observations: true, simBoundary: false });
    const after = await loadSessionPosture(afterId);
    const b = postureCounts(postureRequirementRows(before.posture));
    const a = postureCounts(postureRequirementRows(after.posture));
    const captured = new Set(after.discoveryEvidence.flatMap((i) => i.mapped_requirements));
    const beforeById = Object.fromEntries(postureRequirementRows(before.posture).map((r) => [r.requirement_id, r.status]));
    const moved = [...captured].filter((id) => beforeById[id] === 'unknown');
    console.log(`MG-09 discovery-only posture: before ${JSON.stringify(b)} after ${JSON.stringify(a)}; captures ${after.discoveryEvidence.length}, captured requirements ${captured.size}, moved ${moved.length}`);
    expect(moved.length).toBeGreaterThan(0);
    expect(a.unknown).toBe(b.unknown - moved.length);
    expect(a.partial).toBe(b.partial + moved.length);
    expect(a.met).toBe(b.met);
    expect(a.not_met).toBe(b.not_met);
    expect(after.evidenceRaised.sort()).toEqual(moved.sort());
    const afterById = Object.fromEntries(postureRequirementRows(after.posture).map((r) => [r.requirement_id, r.status]));
    for (const id of moved) expect(afterById[id]).toBe('partial');
    expect(after.posture.ces.control_status_summary.unknown).toBe(a.unknown);
    // The compile reads and the MP embeds this same raised posture.
    const compiled = await compilePlanForSession(afterId);
    expect(postureCounts(postureRequirementRows(compiled.posture))).toEqual(a);
  });

  test('with a CUI boundary the BTC reaches the gap set, the TM and the MP', async () => {
    const id = await discoveryOnlySession({ observations: true, simBoundary: true });
    const compiled = await compilePlanForSession(id);
    const btc = compiled.artifacts.btcConfirmation!;
    expect(btc).toBeTruthy();
    expect(btc.btc_confirmation.evidence_refs.length).toBeGreaterThan(0);
    const mp = compiled.artifacts.missionPlan as unknown as {
      inputs: { btc_confirmation_ref?: unknown };
      outputs: { human_readable_mission_plan: { boundary_context?: { btc_verification?: { gate_status: unknown } } } };
    };
    expect(mp.inputs.btc_confirmation_ref).toBeTruthy();
    expect(mp.outputs.human_readable_mission_plan.boundary_context?.btc_verification?.gate_status).toEqual(
      btc.btc_confirmation.gate_status
    );
    console.log(
      `MG-09 sim BTC: rules ${btc.btc_confirmation.decision_log.filter((d) => d.result === 'matched').map((d) => d.rule_id).join(',')}; ` +
        `flags ${btc.btc_confirmation.risk_flags.length}; evidence ${btc.btc_confirmation.evidence_refs.map((e) => e.question_id).join(',')}; ` +
        `unanswered ${compiled.artifacts.btcUnanswered.join(',')}; gates ${JSON.stringify(btc.btc_confirmation.gate_status)}`
    );
    const failed = Object.values(btc.btc_confirmation.gate_status).filter((g) => !g.pass);
    const tm = JSON.stringify(compiled.artifacts.tenantManifest);
    for (const g of failed) expect(tm).toContain(`btc_gate_${g.domain.toLowerCase()}`);
  });

  test('fixture (a) has no discovery captures, so its compile carries no BTC', async () => {
    const { musterSession } = loadCustomer('a');
    await db.engagements.put(musterSession.engagement);
    await db.assessed_parties.put(musterSession.party);
    await db.interview_sessions.put(musterSession.session);
    const compiled = await compilePlanForSession(musterSession.session.id);
    expect(compiled.artifacts.btcConfirmation).toBeNull();
  });
});
