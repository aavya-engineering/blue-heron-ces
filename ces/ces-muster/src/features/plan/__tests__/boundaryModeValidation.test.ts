// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-08 (CUI boundary), MG-10 (plan mode) and MG-15 (validation before push),
// end to end over the MG-04 fixture customers:
//  - MG-08: fixture (a)'s TM boundary_zones and MP boundary_context equal
//    Planner's golden; fixture (b) is skipped as in Planner; the CUI nodes are
//    a transcription of the bank; the headless runner's sim-only decision is
//    what makes a discovery-only session carry a boundary.
//  - MG-10: (a) derives harden_existing and (d) build_new, with Planner's
//    golden milestones; migrate/hybrid signals only set the deferred flag.
//  - MG-15: every fixture passes the gate with zero warnings beyond the
//    reviewed schema allow-list; a misaligned MP/TM is refused by the SPA push
//    path with a named error and an override with a reason is sent.
/* eslint-disable @typescript-eslint/no-explicit-any -- golden JSON is read untyped */
import 'fake-indexeddb/auto';
import { describe, test, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { CUI_NODE_SPECS, CUI_BOUNDARY_NODES, cuiRawAnswer } from '@/features/interview/cuiBoundaryNodes';
import { PLAN_MODE_NODE_ID } from '@/features/interview/planModeNode';
import type { InterviewFact } from '@/shared/types/engagement';
import { loadCustomer, normalize } from './parityHarness';
import { freezeEntropy } from './fixtureInputs';
import { derivePlanMode } from '../planModeDerivation';
import { classifyAlignment } from '../planValidation';
import type { PlanCompileResult } from '../planCompileService';

const CUI_BANK = load(
  fs.readFileSync(path.resolve('public/knowledge', 'primed CUI Boundary Question Bank.yaml'), 'utf8')
) as { sections: Array<{ questions: Array<Record<string, any>> }> };
const BANK_Q = new Map(CUI_BANK.sections.flatMap((s) => s.questions).map((q) => [q.id as string, q]));

const fact = (question_id: string, answer: string, provenance = 'operator_interview'): InterviewFact => ({
  question_id,
  question_text: question_id,
  answer,
  provenance,
  confidence: 'high',
  recorded_at: '2026-01-15T00:00:00.000Z',
});

/** Compile a fixture customer's session (optionally with edited facts) through compilePlanForSession. */
async function compileFixture(
  key: string,
  editFacts?: (facts: InterviewFact[]) => InterviewFact[],
  editSession?: (session: any) => any
): Promise<PlanCompileResult> {
  const { musterSession } = loadCustomer(key);
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const file = path.resolve(process.cwd(), 'public', decodeURI(String(url)).replace(/^\//, ''));
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
  }) as typeof fetch;
  const entropy = freezeEntropy();
  try {
    const { db } = await import('@/shared/db/schema');
    let session = { ...musterSession.session };
    if (editFacts) session.facts = editFacts([...session.facts]);
    if (editSession) session = editSession(session);
    await db.engagements.put(musterSession.engagement);
    await db.assessed_parties.put(musterSession.party);
    await db.interview_sessions.put(session);
    const { compilePlanForSession } = await import('../planCompileService');
    return await compilePlanForSession(session.id);
  } finally {
    entropy.restore();
    globalThis.fetch = real;
  }
}

const tmOf = (r: PlanCompileResult) => (r.artifacts.tenantManifest as any).tenant_manifest;
const hrmpOf = (r: PlanCompileResult) => (r.artifacts.missionPlan as any).outputs.human_readable_mission_plan;

describe('MG-08: CUI boundary nodes', () => {
  test('every node is a transcription of the CUI bank (id, binding, answer type, options)', () => {
    for (const spec of CUI_NODE_SPECS) {
      const q = BANK_Q.get(spec.id);
      expect(q, spec.id).toBeDefined();
      expect([...Object.keys(q!.bindings.manifest ?? {}), ...Object.keys(q!.bindings.policy ?? {})]).toContain(spec.field);
      expect(spec.answerType).toBe(q!.answer_type);
      expect(spec.text.startsWith(q!.prompt)).toBe(true);
      if (spec.options) expect(spec.options.map((o) => o.bankOption)).toEqual(q!.options);
      if (spec.bankOptions) expect(spec.bankOptions).toEqual(q!.options);
    }
  });

  test('the nodes are in THE graph, score-leak safe and optional for finish', () => {
    for (const n of CUI_BOUNDARY_NODES) {
      const g = QUESTION_GRAPH.find((x) => x.id === n.id);
      expect(g?.cluster).toBe('boundary');
      expect(g?.mapped_requirements).toEqual([]);
      expect(g?.plan_input?.contract).toBe('cui_boundary');
    }
    expect(QUESTION_GRAPH.find((x) => x.id === PLAN_MODE_NODE_ID)?.mapped_requirements).toEqual([]);
  });

  test('stored answers map to the bank raw answer', () => {
    const spec = (id: string) => CUI_NODE_SPECS.find((s) => s.id === id)!;
    expect(cuiRawAnswer(spec('CUI.GEN.001'), 'received_only')).toBe('No – only received');
    expect(cuiRawAnswer(spec('CUI.USR.002'), '40')).toBe(40);
    expect(cuiRawAnswer(spec('CUI.INT.001'), 'none')).toEqual([]);
    expect(cuiRawAnswer(spec('CUI.LC.STO.001'), 'exchange mailboxes; Teams file libraries')).toEqual([
      'Exchange mailboxes',
      'Teams file libraries',
    ]);
    expect(cuiRawAnswer(spec('CUI.GEN.001'), 'maybe')).toBeNull();
    // W5c4: the seven S1 answers (Q-20..Q-26) decode to bank options, not to the default.
    expect(cuiRawAnswer(spec('CUI.CAT.001'), 'Controlled Technical Information (CTI), Technical drawings / engineering data, Contract deliverables containing CUI')).toEqual([
      'Controlled Technical Information (CTI)',
      'Technical drawings / engineering data',
      'Contract deliverables containing CUI',
    ]);
    expect(cuiRawAnswer(spec('CUI.USR.001'), 'Engineers, Program Managers, IT Admins, Security Team')).toEqual([
      'Engineers',
      'Program Managers',
      'IT Admins',
      'Security Team',
    ]);
    expect(cuiRawAnswer(spec('CUI.DEVOPS.002'), 'Other')).toEqual(['Other']);
    expect(cuiRawAnswer(spec('CUI.INT.002'), 'no')).toBe('No');
    expect(cuiRawAnswer(spec('CUI.INT.003'), 'yes')).toBe('Yes');
    expect(cuiRawAnswer(spec('CUI.BKP.001'), 'm365_native')).toBe('M365 native only');
    expect(
      cuiRawAnswer(
        spec('CUI.ENF.001'),
        'Conditional Access, Intune compliance enforcement, DLP policies, Sensitivity labels, External sharing restrictions, Defender policies, Network segmentation'
      )
    ).toHaveLength(7);
    // A bank string instead of the slug is not a valid single_select answer (it would fall to the default).
    expect(cuiRawAnswer(spec('CUI.BKP.001'), 'M365 native only')).toBeNull();
  });
});

describe('MG-08 / MG-10 / MG-15 over the fixture customers', () => {
  afterEach(() => vi.restoreAllMocks());

  test('fixture (a): TM boundary_zones and MP boundary_context equal Planner golden; harden_existing; gate clean', async () => {
    const r = await compileFixture('a');
    const { goldens } = loadCustomer('a');
    const gtm = (goldens['tenant-manifest'] as any).tenant_manifest;
    const ghr = (goldens['manual-mission-plan'] as any).outputs.human_readable_mission_plan;
    expect(r.cuiBoundaryBuild.skipped).toBeNull();
    expect(normalize(tmOf(r).boundary_zones)).toEqual(normalize(gtm.boundary_zones));
    expect(hrmpOf(r).boundary_context).toEqual(ghr.boundary_context);
    expect(normalize(r.artifacts.cuiBoundary)).toEqual(normalize(goldens['cui-boundary']));

    expect(r.planModeDecision).toMatchObject({ planMode: 'harden_existing', source: 'derived', deferred: null });
    expect(hrmpOf(r).plan_mode).toBe(ghr.plan_mode);
    const ms = (h: any) => h.milestones.map((m: any) => ({ id: m.id, name: m.name, objective: m.objective, target_date: m.target_date }));
    expect(ms(hrmpOf(r))).toEqual(ms(ghr));

    expect(r.validation.blocking).toEqual([]);
    expect(r.validation.warnings).toEqual([]);
    expect(r.validation.schema.warnings).toEqual([]);
  });

  test('fixture (b): no CUI -> boundary skipped as in Planner (no cui-boundary golden, no zones)', async () => {
    const r = await compileFixture('b');
    const { goldens, meta } = loadCustomer('b');
    expect(meta.artifacts).not.toContain('cui-boundary');
    expect(r.cuiBoundaryBuild.skipped).toBe('no_cui');
    expect(r.artifacts.cuiBoundary).toBeNull();
    expect(tmOf(r).boundary_zones).toBeUndefined();
    expect((goldens['tenant-manifest'] as any).tenant_manifest.boundary_zones).toBeUndefined();
    expect(r.validation.blocking).toEqual([]);
    expect(r.validation.warnings).toEqual([]);
    expect(r.validation.schema.warnings).toEqual([]);
  });

  test('fixture (c): boundary equals golden; gate clean', async () => {
    const r = await compileFixture('c');
    expect(normalize(r.artifacts.cuiBoundary)).toEqual(normalize(loadCustomer('c').goldens['cui-boundary']));
    expect(r.validation).toMatchObject({ blocking: [], warnings: [], schema: { warnings: [] } });
  });

  test('fixture (d): build_new derived from the empty tenant; milestones and boundary equal golden; gate clean', async () => {
    const r = await compileFixture('d');
    const { goldens } = loadCustomer('d');
    const ghr = (goldens['manual-mission-plan'] as any).outputs.human_readable_mission_plan;
    expect(r.planModeDecision).toMatchObject({ planMode: 'build_new', source: 'derived', deferred: null });
    expect(hrmpOf(r).plan_mode).toBe('build_new');
    expect(tmOf(r).plan_mode).toBe((goldens['tenant-manifest'] as any).tenant_manifest.plan_mode);
    const ms = (h: any) => h.milestones.map((m: any) => ({ id: m.id, name: m.name, objective: m.objective, target_date: m.target_date }));
    expect(ms(hrmpOf(r))).toEqual(ms(ghr));
    // build_new derives tenant_separation 'Planned but not yet implemented', as the golden holds.
    expect(normalize(r.artifacts.cuiBoundary)).toEqual(normalize(goldens['cui-boundary']));
    expect(r.validation).toMatchObject({ blocking: [], warnings: [], schema: { warnings: [] } });
  });

  test('the plan-mode answer beats the derivation; a hybrid signal is flagged, never built', async () => {
    const r = await compileFixture('a', (f) => [...f, fact(PLAN_MODE_NODE_ID, 'build_new'), fact('TCP.IA.005', 'yes')]);
    expect(r.planModeDecision.planMode).toBe('build_new');
    expect(r.planModeDecision.source).toBe('answered');
    expect(r.planModeDecision.deferred?.modes).toEqual(['hybrid']);
    expect(hrmpOf(r).plan_mode).toBe('build_new');
    const mp = r.docs.find((d) => d.kind === 'mission-plan')!;
    expect(mp.validationWarnings.some((w) => w.startsWith('Deferred plan mode (hybrid)'))).toBe(true);
  });

  test('headless-runner path: discovery only -> no boundary; the sim-only G-02 default -> zones', async () => {
    const discoveryOnly = (f: InterviewFact[]) => f.filter((x) => x.provenance === 'discovery');
    const none = await compileFixture('a', discoveryOnly);
    expect(none.cuiBoundaryBuild.skipped).toBe('cui_presence_not_established');
    expect(tmOf(none).boundary_zones).toBeUndefined();

    const sim = await compileFixture('a', (f) => [...discoveryOnly(f), fact('G-02', 'cui_present', 'defaulted')]);
    expect(sim.cuiBoundaryBuild.skipped).toBeNull();
    expect(tmOf(sim).boundary_zones.definitions.length).toBeGreaterThanOrEqual(1);
    expect(sim.validation.blocking).toEqual([]);
    // Unanswered bindings with no default are listed, never invented.
    expect(sim.defaultedInputs).toContain('CUI boundary CUI.CONTRACT.001 (not answered)');
    expect(tmOf(sim).boundary_zones.definitions.some((d: any) => d.key === 'contract_scope')).toBe(false);
  });
});

describe('FX-11 / MG-15: operator values in the TM and the push gate', () => {
  const noWifiOrEmail = (f: InterviewFact[]) => f.filter((x) => x.question_id !== 'TCP.MU.006' && x.question_id !== 'TCP.MU.007');

  test('fixture (a): the seven operator values ride tenant_identity (camelCase) with provenance; all supplied, nothing flagged', async () => {
    const r = await compileFixture('a');
    const ti = tmOf(r).tenant_identity;
    for (const k of ['operatorUPN', 'breakGlassUPN', 'breakGlassUserId', 'cuiGroupName', 'wifiSsid', 'securityEmail', 'cisoEmail']) {
      expect(typeof ti[k], k).toBe('string');
    }
    // W5c6: cisoEmail is the answered security mailbox again, with the same provenance (Stamper AZ-MON-001).
    expect(ti.cisoEmail).toBe(ti.securityEmail);
    expect(ti.operator_value_provenance.values.cisoEmail).toBe(ti.operator_value_provenance.values.securityEmail);
    expect(ti.operator_value_provenance.sim_only).toBe(true);
    expect(ti.operator_value_provenance.values.operatorUPN).toBe('discovered');
    expect(r.validation.operatorValues).toEqual({ simOnly: true, defaulted: [], blocking: [] });
  });

  test('defaulted operator values are listed but not blocked for a sim tenant, and blocked by name otherwise', async () => {
    const sim = await compileFixture('a', noWifiOrEmail);
    expect(sim.validation.operatorValues.defaulted).toEqual([
      'wifiSsid: placeholder MUSTER-DEFAULT-SSID',
      'securityEmail: placeholder unset-security-email@example.invalid',
      'cisoEmail: placeholder unset-security-email@example.invalid',
    ]);
    expect(sim.validation.blocking).toEqual([]);
    const mp = sim.docs.find((d) => d.kind === 'mission-plan')!;
    expect(mp.validationWarnings.filter((w) => w.startsWith('Operator value defaulted (sim-only plan'))).toHaveLength(3);

    const live = await compileFixture('a', noWifiOrEmail, (s) => ({
      ...s,
      readiness_manifest: { ...s.readiness_manifest, tenant_kind: 'live' },
    }));
    expect(live.validation.operatorValues.simOnly).toBe(false);
    expect(live.validation.blocking).toEqual([
      'OPERATOR_VALUE_DEFAULTED: wifiSsid: placeholder MUSTER-DEFAULT-SSID (not discovered or answered)',
      'OPERATOR_VALUE_DEFAULTED: securityEmail: placeholder unset-security-email@example.invalid (not discovered or answered)',
      'OPERATOR_VALUE_DEFAULTED: cisoEmail: placeholder unset-security-email@example.invalid (not discovered or answered)',
    ]);
    const { pushGate } = await import('../planPushService');
    expect(pushGate(live)).toEqual(live.validation.blocking);
  });

  test('S-27 / S-28 harvest pre-fills are reported as derived from discovery, not answered', async () => {
    const r = await compileFixture('a');
    expect(r.siFieldSources['S-27']).toEqual({
      source: 'derived',
      provenance: 'derived:si:discovery:graph:deviceConfigurations',
      answer: 'blocked',
    });
    expect(r.siFieldSources['S-28']).toEqual({
      source: 'derived',
      provenance: 'derived:si:discovery:graph:conditionalAccess',
      answer: 'cloud_native',
    });
  });
});

describe('MG-10: plan-mode derivation rules', () => {
  test('no target tenant -> build_new; established -> harden_existing; commercial source + GCC High target -> migrate flag', () => {
    expect(derivePlanMode({ facts: [], hasTenantManifest: false }).planMode).toBe('build_new');
    expect(derivePlanMode({ facts: [fact('iam-001', 'yes', 'discovery')], hasTenantManifest: true }).planMode).toBe(
      'harden_existing'
    );
    const d = derivePlanMode({
      facts: [fact('iam-001', 'yes', 'discovery'), fact('TCP.TI.004', 'commercial')],
      hasTenantManifest: true,
      targetTenantModel: 'gcc_high',
    });
    expect(d.planMode).toBe('harden_existing');
    expect(d.deferred?.modes).toEqual(['migrate']);
  });
});

describe('MG-15: the SPA push path', () => {
  test('classification: structural errors and MP<->TM control mismatches block, the rest warn', () => {
    expect(
      classifyAlignment({
        errors: ['Tenant manifest missing tenant_manifest block'],
        warnings: [
          'Control "AC.L2-3.1.1" has expected artifacts but no evidence monitor in tenant manifest',
          'Tenant manifest normative control "X.1" not present in manual plan control coverage',
          'CUI boundary exists but tenant manifest is missing boundary_zones',
        ],
      })
    ).toEqual({
      blocking: [
        'STRUCTURE: Tenant manifest missing tenant_manifest block',
        'MP_TM_CONTROL_MISMATCH: Control "AC.L2-3.1.1" has expected artifacts but no evidence monitor in tenant manifest',
        'MP_TM_CONTROL_MISMATCH: Tenant manifest normative control "X.1" not present in manual plan control coverage',
      ],
      warnings: ['CUI boundary exists but tenant manifest is missing boundary_zones'],
    });
  });

  test('a misaligned MP/TM is refused before any request; an override with a reason is sent', async () => {
    const r = await compileFixture('a');
    const tm = JSON.parse(JSON.stringify(r.artifacts.tenantManifest));
    tm.tenant_manifest.evidence_monitors = tm.tenant_manifest.evidence_monitors.filter(
      (m: { control_ids: string[] }) => !m.control_ids.includes('AC.L2-3.1.1')
    );
    const misaligned = { ...r, artifacts: { ...r.artifacts, tenantManifest: tm } } as PlanCompileResult;
    const { pushPlanToStamper } = await import('../planPushService');
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ pushed: ['mp.json', 'tm.json'], plansDir: 'x', override: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    const refused = await pushPlanToStamper(misaligned);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? [] : refused.blocking).toEqual([
      'MP_TM_CONTROL_MISMATCH: Control "AC.L2-3.1.1" has expected artifacts but no evidence monitor in tenant manifest',
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();

    const blank = await pushPlanToStamper(misaligned, { reason: '  ' });
    expect(blank.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    const sent = await pushPlanToStamper(misaligned, { reason: 'accepted for this delivery' });
    expect(sent).toMatchObject({ ok: true, overridden: true });
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.validationOverride).toEqual({ reason: 'accepted for this delivery' });
    expect(body.cuiBoundary).toBeDefined();
    vi.unstubAllGlobals();
  });
});
