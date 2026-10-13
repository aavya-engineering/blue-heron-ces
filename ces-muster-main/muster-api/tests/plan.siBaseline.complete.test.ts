// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FC-MU MU-10 + MS-1 (2026-09-27): the SI Baseline, complete, and carried out
// of the SPA.
//
// Drives the production session driver (createSession → answer × N →
// completeInterview) into real Dexie (fake-indexeddb) and the production
// compilePlanForSession. Only the Vite-fetched banks are swapped for the same
// public/knowledge files read from disk (planTestSupport.loadBanks).
//
// The complete-session fixture is answered the way the live interview asks it:
//   pass 1 — the readiness and Tenant Config Profile questions;
//   pass 2 — derive from that session (production derivationContextFor +
//            deriveSitFacts), prune the graph with the derived facts (production
//            loadQuestionGraph), and answer ONLY the SIT questions still asked.
// So every one of the 26 SI bank questions ends up either derived (with a
// source pointer) or explicitly asked-and-answered — never defaulted.
//
// Precedence (founder default 2026-09-27): an explicit operator answer ALWAYS
// beats a derivation. SIT-020 derives to m365_azure whenever M365 stacks are
// declared; an operator who answers m365_sentinel gets m365_sentinel.
//
// MS-1: the complete SI Baseline leaves the SPA inside the Mission Plan
// (inputs.si_baseline) and muster-api's real push route still accepts it.
import 'fake-indexeddb/auto';
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
const { compilePlanForSession, derivationContextFor } = await import('@/features/plan/planCompileService');
const { deriveSitFacts } = await import('@/features/plan/siDerivation');
const { SI_FIELD_LABELS } = await import('@/features/plan/siResidue');
const { loadQuestionGraph } = await import('@/features/interview/questionGraphService');
const { SI_INPUT_KIND_BY_ID, parsePlanInputAnswer } = await import('@/features/interview/siPlanInputNodes');
const { loadBanks } = await import('@/features/plan/__tests__/planTestSupport');
const { pushPlanToStamper } = await import('@/features/plan/planPushService');
const { db } = await import('@/shared/db/schema');
const { createApp } = await import('../src/app.js');
const { mintToken } = await import('../src/lib/jwt.js');
type PlanCompileResult = Awaited<ReturnType<typeof compilePlanForSession>>;

const STACKS = ['Microsoft 365', 'microsoft_intune', 'microsoft_sentinel'];

type Deps = { infrastructure_model?: string };

const BANK_QUESTIONS = (loadBanks(SPA_ROOT).siQuestionBank?.ces?.question_bank?.questions ?? []) as Array<{
  id: string;
  sets_its_fields?: string[];
}>;
const BANK_IDS = BANK_QUESTIONS.map((q) => q.id);

// Pass 1 — readiness + Tenant Config Profile (an m365_azure GCC High enclave).
const READINESS: Record<string, string> = {
  'iam-001': 'yes', 'iam-002': 'no', 'iam-003': 'yes', 'iam-004': 'no', 'iam-005': 'unknown',
  'ep-001': 'yes', 'ep-002': 'no', 'ep-003': 'yes', 'ep-004': 'no',
  'pol-001': 'yes', 'pol-002': 'no', 'pol-003': 'no', 'pol-004': 'yes',
  'mon-001': 'no', 'mon-002': 'yes', 'mon-003': 'no', 'mon-004': 'unknown',
  'dp-001': 'yes', 'dp-002': 'no', 'dp-003': 'yes', 'dp-004': 'no',
  'ir-001': 'no', 'ir-002': 'yes', 'ir-003': 'no', 'ir-004': 'yes',
  'bnd-001': 'yes', 'bnd-002': 'unsure', 'bnd-003': 'no',
};
const TCP: Record<string, string> = {
  'TCP.TI.004': 'gcc_high',
  'TCP.LIC.001': 'm365_g5',
  'TCP.IA.004': 'hybrid_ad_connect',
  'TCP.IA.005': 'yes',
  'TCP.PA.004': 'yes',
  'TCP.GA.004': 'mixed',
  'TCP.DM.001': 'enroll_only',
};
// Pass 2 — the operator's answer for any SIT question the interview still asks.
const SI_ANSWERS: Record<string, string> = {
  'G-01': 'L2', 'G-02': 'cui_present', 'G-03': 'CTI, Export Controlled', 'G-04': 'ITAR technical data on two programs',
  'G-05': 'certification', 'G-06': '2027-06-30; prime contract option year', 'G-07': 'single_enclave', 'G-08': 'hybrid',
  'S-11': '40', 'S-12': 'teams_first', 'S-13': 'allowed_mdm', 'S-16': 'c3pao_ready', 'S-20': 'gcc_high',
  'SIT-020': 'm365_azure', 'SIT-021': 'g5', 'SIT-022': '35', 'SIT-023': 'FR1234567890, FR0987654321',
  'SIT-024': '2', 'SIT-025': '0', 'S-24': 'poam_if_allowed', 'S-25': 'company_managed_only',
  'S-26': 'managed_wireless', 'S-27': 'allowed_encrypted', 'S-28': 'cloud_native', 'S-29': 'managed_nonlocal',
  'S-30': 'managed_endpoints',
};

/** Read a si_baseline.* path off the generated baseline. */
function at(si: unknown, field: string): unknown {
  let node: unknown = si;
  for (const seg of field.split('.')) node = (node as Record<string, unknown> | undefined)?.[seg];
  return node;
}

let complete: PlanCompileResult;
let askedIds: string[] = [];
let derivedIds: string[] = [];

beforeAll(async () => {
  const handle = await createSession('individual_contractor', {
    stacks: STACKS,
    party: { name: 'Complete SI Fixture Co', on_prem_ot: 'no' },
  });
  for (const [id, v] of Object.entries({ ...READINESS, ...TCP })) await answer(handle, id, v);

  // Pass 2: derive exactly as the product does, prune, answer what is asked.
  const session = (await db.interview_sessions.get(handle.sessionId))!;
  const derived = deriveSitFacts(derivationContextFor(session));
  derivedIds = derived.derivedIds;
  const graph = await loadQuestionGraph(STACKS, derived.facts);
  askedIds = graph.filter((n) => n.cluster === 'plan-input:si').map((n) => n.id);
  for (const id of askedIds) {
    const v = SI_ANSWERS[id];
    expect(v, `fixture answers asked SIT question ${id}`).toBeDefined();
    const node = graph.find((n) => n.id === id)!;
    if (node.input) expect(parsePlanInputAnswer(node.input, v).ok, id).toBe(true);
    else expect(node.options.map((o) => o.value), id).toContain(v);
    await answer(handle, id, v);
  }
  await completeInterview(handle);
  complete = await compilePlanForSession(handle.sessionId);
});

describe('MU-10: a full m365_azure session yields a complete SI Baseline', () => {
  test('every one of the 26 SI fields is derived (with source) or asked-and-answered — none defaulted', () => {
    expect(BANK_IDS).toHaveLength(26);
    const sources = complete.siFieldSources;
    expect(Object.keys(sources).sort()).toEqual([...BANK_IDS].sort());
    const defaulted = BANK_IDS.filter((id) => sources[id].source === 'defaulted');
    expect(defaulted).toEqual([]);

    const derived = BANK_IDS.filter((id) => sources[id].source === 'derived');
    const answered = BANK_IDS.filter((id) => sources[id].source === 'answered');
    // Derived = exactly what the production derivation produced; answered =
    // exactly what the pruned interview asked. Together: all 26, disjoint.
    expect(derived.sort()).toEqual([...derivedIds].sort());
    expect(answered.sort()).toEqual([...askedIds].sort());
    expect(derived.length + answered.length).toBe(26);
    for (const id of derived) {
      const s = sources[id];
      expect(s.source === 'derived' && s.provenance, id).toMatch(/^derived:si:[a-z]+:[a-z0-9_-]+$/);
    }
    // The computed coverage for this reference fixture (reported in the FC-MU notes).
    console.info(`MU-10 SI coverage: ${derived.length} of 26 derived [${derived.join(', ')}]; ${answered.length} asked-and-answered`);
    expect(derived.sort()).toEqual(['G-01', 'G-02', 'G-08', 'S-13', 'S-20', 'SIT-020', 'SIT-021']);

    // No SI field is reported as a default on the Plan tab.
    const siLabels = new Set(BANK_IDS.map((id) => SI_FIELD_LABELS[id] ?? id));
    expect(complete.defaultedInputs.filter((d) => siLabels.has(d))).toEqual([]);
  });

  test('the generated SI Baseline carries every derived or answered value, typed', () => {
    const si = complete.artifacts.siBaseline;
    for (const q of BANK_QUESTIONS) {
      const s = complete.siFieldSources[q.id];
      if (s.source === 'defaulted') throw new Error(`${q.id} defaulted`);
      const kind = SI_INPUT_KIND_BY_ID[q.id];
      const parsed = kind ? parsePlanInputAnswer(kind, s.answer) : null;
      const expected = parsed ? (parsed.ok ? parsed.value : undefined) : s.answer;
      for (const field of q.sets_its_fields ?? []) {
        expect(at(si, field), `${q.id} -> ${field}`).toEqual(expected);
      }
    }
  });
});

describe('MU-10 precedence: an explicit operator answer beats a derivation', () => {
  test('SIT-020: derivation says m365_azure, the operator says m365_sentinel → m365_sentinel', async () => {
    // Precondition (non-vacuous): these stacks DO derive SIT-020 = m365_azure.
    const derived = deriveSitFacts({ selectedStacks: STACKS }).facts.find((f) => f.question_id === 'SIT-020');
    expect(derived?.answer).toBe('m365_azure');

    const handle = await createSession('individual_contractor', {
      stacks: STACKS,
      party: { name: 'Precedence Fixture Co', on_prem_ot: 'no' },
    });
    await answer(handle, 'SIT-020', 'm365_sentinel');
    await completeInterview(handle);
    const result = await compilePlanForSession(handle.sessionId);

    const deps = (result.artifacts.siBaseline.si_baseline as { dependencies?: Deps }).dependencies;
    expect(deps?.infrastructure_model).toBe('m365_sentinel');
    expect(result.siFieldSources['SIT-020']).toEqual({ source: 'answered', answer: 'm365_sentinel' });
  });

  test('without an operator answer the derivation still applies (m365_azure)', async () => {
    const handle = await createSession('individual_contractor', {
      stacks: STACKS,
      party: { name: 'Derivation Fixture Co', on_prem_ot: 'no' },
    });
    await completeInterview(handle);
    const result = await compilePlanForSession(handle.sessionId);
    const deps = (result.artifacts.siBaseline.si_baseline as { dependencies?: Deps }).dependencies;
    expect(deps?.infrastructure_model).toBe('m365_azure');
    expect(result.siFieldSources['SIT-020']).toMatchObject({ source: 'derived', answer: 'm365_azure' });
  });
});

describe('MS-1: the complete SI Baseline leaves the SPA and muster-api still accepts the push', () => {
  let server: http.Server;
  let base: string;
  let tmpRoot: string;
  const store = new Map<string, string>();

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-fcmu-ms1-'));
    process.env.CES_PIPELINE_ROOT = tmpRoot;
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  afterAll(() => {
    server?.close();
    delete (globalThis as { localStorage?: unknown }).localStorage;
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.CES_PIPELINE_ROOT;
  });

  test('the pushed Mission Plan embeds the complete SI Baseline; the route validates and writes it', async () => {
    store.set('muster-api-url', `${base}/api`);
    store.set(
      'muster-jwt',
      mintToken({ sub: 'fcmu-operator', tenant_id: '00000000-0000-0000-0000-00000000fc01', party_id: null, role: 'bhd_operator' })
    );
    const outcome = await pushPlanToStamper({ ...complete, tenantSlug: 'fcmu-ms1' });
    if (!outcome.ok) console.error('push failed:', outcome);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const plansDir = path.join(tmpRoot, 'Stamper', 'plan-data', 'fcmu-ms1', 'plans');
    const written = JSON.parse(fs.readFileSync(path.join(plansDir, outcome.pushed[0]), 'utf8'));
    // The SI Baseline that left the SPA is the complete one, byte-for-byte.
    expect(written.inputs.si_baseline).toEqual(JSON.parse(JSON.stringify(complete.artifacts.siBaseline)));
    const sib = written.inputs.si_baseline.si_baseline;
    // Non-vacuous: fields that USED to fall back to generator defaults now carry answers.
    expect(sib.dependencies.user_count).toBe(35);
    expect(sib.assessment.certification_timing_goal).toEqual({
      goal_type: 'by_date',
      by_date: '2027-06-30',
      driver: 'prime contract option year',
    });
    expect(sib.operations.mobile_device_presence).toBe('company_managed_only');
    expect(sib.operations.byod_posture).toBe('allowed_mdm');
    // The plan's own key-facts block reads the answered values, not its defaults.
    const keyFacts = written.outputs.human_readable_mission_plan.disposition_summary.si_key_facts;
    expect(keyFacts.user_count).toBe(35);
    expect(keyFacts.remote_access_posture).toBe('cloud_native');
    expect(keyFacts.fedramp_package_ids).toEqual(['FR1234567890', 'FR0987654321']);
  });
});
