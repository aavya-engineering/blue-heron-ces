// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node
// MG-16: fixture (a) renders all 20 policy documents (markdown + DOCX) with
// zero unresolved tokens and completeness >= Planner's golden for the same
// customer; the profile's sources (discovered / derived / defaulted /
// answered / drafted) are as designed. W5c2 (SC-5 P10): plus Muster's own 2
// (continuous monitoring plan, acceptable use policy), 22 in all.
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import JSZip from 'jszip';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/shared/db/schema';
import type { InterviewFact } from '@/shared/types/engagement';
import { generatePolicyInputsOutput } from '@/features/plan/engine/policy/services/policyProfileGenerator';
import {
  assessContextCompleteness,
  compilePolicyContext,
  type PolicyTemplateContext,
} from '@/features/plan/engine/mpt/services/policyContextCompiler';
import type { PlanCompileResult } from '../../planCompileService';
import { activeSimulation, buildPolicyInputsProfile, policySections, simulationMarker } from '../policyInputsProfile';
import {
  renderPolicySet,
  renderPolicies,
  unresolvedTokens,
  conventionPatterns,
  policyFileBase,
  withPlanningDraftBanner,
  withSimulationMarker,
  documentOwner,
  documentApprover,
  simulationMarkerParagraph,
  PLANNING_DRAFT_BANNERS,
  MUSTER_POLICY_TEMPLATES,
  SSP_APPENDIX_DOCUMENTS,
  resolvePolicySignatories,
  type PolicySet,
} from '../policyDocuments';

const PUBLIC = path.resolve(process.cwd(), 'public');
const realFetch = globalThis.fetch;
const bank = load(fs.readFileSync(path.join(PUBLIC, 'knowledge', 'primed Policy Inputs Question Bank.yaml'), 'utf8'));

const { loadCustomer } = await import('../../__tests__/parityHarness');
const { freezeEntropy } = await import('../../__tests__/fixtureInputs');
const customer = loadCustomer('a');
const golden = customer.goldens['policy-documents' as never] as unknown as Array<{ template_id: string; completeness: number; markdown: string }>;
/** W5c2: Planner's 20 (golden order), then Muster's 2. */
const MUSTER_IDS = MUSTER_POLICY_TEMPLATES.map((t) => t.template_id);
const ALL_IDS = [...golden.map((d) => d.template_id), ...MUSTER_IDS];

/** Planner's own context for the same customer: its policy answers + its golden SI/TCP/CUI/posture. */
function plannerContext(): PolicyTemplateContext {
  const sections = policySections(bank);
  const answers = Object.fromEntries(
    Object.entries(customer.inputs.policy as Record<string, unknown>).map(([id, raw]) => [
      id,
      { question_id: id, answer_type: 'text', raw_answer: raw, captured_at: '', provenance_class: 'client_assertion' },
    ])
  );
  const policyInputs = generatePolicyInputsOutput(answers as never, sections, '1.0');
  return compilePolicyContext({
    policyInputs,
    siBaseline: customer.goldens['si-baseline'],
    tenantConfig: customer.goldens['tenant-config-profile'],
    cuiBoundary: customer.goldens['cui-boundary'],
    readinessPosture: customer.goldens['readiness-posture'],
  });
}

/** The simple {{path}} references across the 20 templates (helpers and block tags excluded). */
function templateVariables(): string[] {
  const dir = path.join(PUBLIC, 'templates', 'policies');
  const vars = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/\{\{\s*([a-z_]+(?:\.[a-z_]+)+)\s*\}\}/g)) vars.add(m[1]);
  }
  return [...vars].sort();
}

/** Of the template variables, those the context resolves to a non-empty value. */
function resolvedVariables(ctx: PolicyTemplateContext): string[] {
  return templateVariables().filter((v) => {
    const value = v.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), ctx);
    return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
  });
}

let compiled: PlanCompileResult;
let set: PolicySet;
let files: Record<string, { markdown: string; docx: Buffer }>;

beforeAll(async () => {
  globalThis.fetch = (async (url: string) => {
    const file = path.join(PUBLIC, decodeURI(String(url)).replace(/^\//, ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    const text = fs.readFileSync(file, 'utf8');
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
  }) as typeof fetch;
  const s = customer.musterSession;
  await db.engagements.put(s.engagement);
  await db.assessed_parties.put(s.party);
  await db.interview_sessions.put(s.session);
  const entropy = freezeEntropy();
  try {
    const { compilePlanForSession } = await import('../../planCompileService');
    compiled = await compilePlanForSession(s.session.id);
    const args = { compile: compiled, facts: s.session.facts as InterviewFact[], party: s.party, bank };
    set = await renderPolicySet(args);
    files = await renderPolicies(args);
  } finally {
    entropy.restore();
  }
}, 120_000);

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('MG-16: fixture (a) policy documents', () => {
  test('all 22 render (Planner registry order, then Muster\'s 2), with zero unresolved tokens and no render error', () => {
    // The only brace text left is the TCP's naming conventions, quoted verbatim (Planner's golden has the CA one too).
    expect(conventionPatterns(set.context)).toEqual(['CA-{Number}-{Purpose}', 'DLP-{Scope}-{Action}', 'SIMTENANT-A-{Classification}-{Handling}']);
    expect(set.documents.map((d) => d.template_id)).toEqual(ALL_IDS);
    for (const d of set.documents) {
      expect(unresolvedTokens(d.markdown, conventionPatterns(set.context)), d.template_id).toEqual([]);
      expect(d.markdown.includes('**Error:**'), d.template_id).toBe(false);
    }
  });

  test("completeness >= Planner's golden, per document and over the context", () => {
    const byId = new Map(golden.map((g) => [g.template_id, g.completeness]));
    // W5c2: Muster's 2 have no Planner golden; they must be complete.
    for (const d of set.documents) expect(d.completeness, d.template_id).toBeGreaterThanOrEqual(byId.get(d.template_id) ?? 100);
    const planner = plannerContext();
    const p = assessContextCompleteness(planner);
    expect(set.contextCompleteness.resolved_variables).toBeGreaterThanOrEqual(p.resolved_variables);
    expect(set.contextCompleteness.unresolved).toEqual([]);
    // Template-variable coverage (stricter than Planner's heuristic): every
    // variable Planner's context fills, Muster's fills too.
    const mine = new Set(resolvedVariables(set.context));
    const missing = resolvedVariables(planner).filter((v) => !mine.has(v));
    expect(missing).toEqual([]);
    expect(mine.size).toBeGreaterThanOrEqual(resolvedVariables(planner).length);
  });

  test('renderPolicies: 22 base names, each with its markdown and a valid, token-free DOCX', async () => {
    expect(Object.keys(files).sort()).toEqual(ALL_IDS.map((template_id) => policyFileBase({ template_id })).sort());
    for (const [name, f] of Object.entries(files)) {
      expect(f.docx.subarray(0, 2).toString(), name).toBe('PK');
      const zip = await JSZip.loadAsync(f.docx);
      const xml = await zip.file('word/document.xml')!.async('string');
      const text = xml.replace(/<[^>]+>/g, '');
      expect(unresolvedTokens(text, conventionPatterns(set.context)), name).toEqual([]);
      expect(text.includes('[Name]') || text.includes('[Title]'), `${name} signature placeholders`).toBe(false);
    }
  });

  test('profile sources: org from the engagement profile and Graph, ODPs defaulted, governance from the plan date (W5)', () => {
    const src = Object.fromEntries(set.profile.sources.map((s) => [s.question_id, s]));
    expect(src['PI.ORG.001']).toMatchObject({ provenance: 'derived', source: 'engagement profile' });
    expect(src['PI.ORG.002']).toMatchObject({ provenance: 'discovered', source: 'graph:organization' });
    expect(src['PI.ORG.006'].provenance).toBe('derived');
    const odps = set.profile.sources.filter((s) => s.question_id.startsWith('PI.ODP.'));
    // W5c7 / FIN-26b: the bank's 15 ODPs plus the Muster-only PI.ODP.016 (time source) and PI.ODP.017 (sign-in frequency).
    expect(odps).toHaveLength(17);
    expect(odps.every((s) => s.provenance === 'defaulted')).toBe(true);
    expect(src['PI.GOV.001'].provenance).toBe('derived');
    expect(src['PI.GOV.001'].source).toBe('plan date (policies effective on approval)');
    // The frozen clock's date (freezeEntropy), never a future Mission Plan milestone.
    expect(src['PI.GOV.001'].value).toBe('2026-01-15');
    expect(set.profile.output.governance.policy_effective_date).toBe(src['PI.GOV.001'].value);
    // Planner's (a) ODP answers are the bank's recommended values: the defaulted ODPs equal them.
    // W5c7 / FIN-26b: plus Muster's own ODPs (PI.ODP.016, PI.ODP.017, not in Planner), defaulted here.
    const { authoritative_time_source, sign_in_frequency_hours, ...bankOdps } = set.profile.output.odps;
    expect(bankOdps).toEqual(plannerContext().odp);
    expect(authoritative_time_source).toBe('time.windows.com');
    expect(sign_in_frequency_hours).toBe('8');
    expect(set.profile.drafts).toEqual([]);
  });
});

describe('W5 SC-6: fixture (a) documents name an owner and an approver', () => {
  test('every one of the 22 names both, with no Designated Official, [Name], [Title] or Not specified', () => {
    const blank = /^(|not specified|tbd|n\/a|none|designated official|\[.*\]|_+)$/i;
    for (const d of set.documents) {
      expect(blank.test(documentOwner(d.markdown)), `${d.template_id} owner`).toBe(false);
      expect(blank.test(documentApprover(d.markdown)), `${d.template_id} approver`).toBe(false);
      expect(/Designated Official|\[Name\]|\[Title\]|\bNot specified\b/.test(d.markdown), d.template_id).toBe(false);
    }
  });
});

describe('W4 banner: the SSP and POA&M are planning drafts, not the documents of record', () => {
  const BANNERED = ['system_security_plan', 'poam'];

  test('the banner is the first paragraph under the title of exactly those two documents', () => {
    expect(Object.keys(PLANNING_DRAFT_BANNERS).sort()).toEqual([...BANNERED].sort());
    expect(PLANNING_DRAFT_BANNERS.system_security_plan).toBe(
      '**Planning draft, not the SSP of record.** The system security plan of record is the EvidenceOps SSP, which carries the assessed status.'
    );
    expect(PLANNING_DRAFT_BANNERS.poam).toBe(
      '**Planning draft, not the POA&M of record.** The POA&M of record is the EvidenceOps POA&M, which carries the assessed status.'
    );
    for (const d of set.documents) {
      const lines = d.markdown.split(/\r?\n/);
      if (BANNERED.includes(d.template_id)) {
        expect(lines[0], d.template_id).toBe(`# ${d.title}`);
        expect(lines[1], d.template_id).toBe('');
        expect(lines[2], d.template_id).toBe(PLANNING_DRAFT_BANNERS[d.template_id]);
        expect(lines[3], d.template_id).toBe('');
        expect(d.markdown.split('Planning draft, not the').length - 1, d.template_id).toBe(1);
      } else {
        expect(d.markdown.includes('Planning draft, not the'), d.template_id).toBe(false);
      }
    }
  });

  test('DOCX: the banner text appears once in the two documents, bold lead, no literal markdown', async () => {
    for (const id of BANNERED) {
      const base = id.replace(/_/g, '-');
      const zip = await JSZip.loadAsync(files[base].docx);
      const xml = await zip.file('word/document.xml')!.async('string');
      const text = xml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
      const plain = PLANNING_DRAFT_BANNERS[id].replace(/\*\*/g, '');
      expect(text.split(plain).length - 1, base).toBe(1);
      expect(text.includes('**Planning draft'), base).toBe(false);
      const lead = /<w:r>(?:(?!<\/w:r>).)*<w:b\/>(?:(?!<\/w:r>).)*Planning draft, not the/s;
      expect(lead.test(xml), `${base} bold lead`).toBe(true);
    }
    for (const [name, f] of Object.entries(files)) {
      if (BANNERED.map((b) => b.replace(/_/g, '-')).includes(name)) continue;
      const xml = await (await JSZip.loadAsync(f.docx)).file('word/document.xml')!.async('string');
      expect(xml.includes('Planning draft, not the'), name).toBe(false);
    }
  });

  test('the helper keeps the line endings and leaves other documents untouched', () => {
    const doc = { template_id: 'poam', title: 'T', markdown: '# T\r\n\r\n## 1. A\r\n', completeness: 100, domain: 'x', nist_controls: [] };
    expect(withPlanningDraftBanner(doc).markdown).toBe(`# T\r\n\r\n${PLANNING_DRAFT_BANNERS.poam}\r\n\r\n## 1. A\r\n`);
    expect(withPlanningDraftBanner({ ...doc, markdown: '# T\n\n## 1. A\n' }).markdown).toBe(`# T\n\n${PLANNING_DRAFT_BANNERS.poam}\n\n## 1. A\n`);
    const other = { ...doc, template_id: 'access_control_policy' };
    expect(withPlanningDraftBanner(other)).toBe(other);
  });
});

describe('V58: a simulated customer marks every document; a real one is unchanged', () => {
  const SIM = { simulated: true, legalName: 'Testfield Widgets LLC (FICTIONAL)', disclaimer: 'Invented for the simulator.' };
  const MARK = 'SIMULATED CUSTOMER (FICTIONAL): Testfield Widgets LLC (FICTIONAL)';
  let simSet: PolicySet;
  let simFiles: Record<string, { markdown: string; docx: Buffer }>;

  beforeAll(async () => {
    const s = customer.musterSession;
    const args = { compile: compiled, facts: s.session.facts as InterviewFact[], party: s.party, bank, simulation: SIM };
    simSet = await renderPolicySet(args);
    simFiles = await renderPolicies(args);
  }, 120_000);

  test('the block is read only when simulated === true with a legal name', () => {
    expect(activeSimulation(SIM)).toEqual(SIM);
    expect(simulationMarker(activeSimulation(SIM)!)).toBe(MARK);
    for (const b of [undefined, null, {}, { simulated: false, legalName: 'X' }, { simulated: 'true', legalName: 'X' }, { simulated: true, legalName: ' ' }]) {
      expect(activeSimulation(b)).toBeNull();
    }
  });

  test('the profile carries the block (so the policy_inputs_profile envelope does); without it, no key', () => {
    expect(simSet.profile.output.simulation).toEqual(SIM);
    expect('simulation' in set.profile.output).toBe(false);
  });

  test('markdown: the marker is the first paragraph under the title of all 22; the W4 banner follows it', () => {
    expect(simSet.documents).toHaveLength(22);
    for (const d of simSet.documents) {
      const lines = d.markdown.split(/\r?\n/);
      expect(lines[0], d.template_id).toMatch(/^# \S/);
      expect(lines[1], d.template_id).toBe('');
      expect(lines[2], d.template_id).toBe(simulationMarkerParagraph(SIM as never));
      expect(lines[2].startsWith(`**${MARK}**`), d.template_id).toBe(true);
      if (PLANNING_DRAFT_BANNERS[d.template_id]) expect(lines[4], d.template_id).toBe(PLANNING_DRAFT_BANNERS[d.template_id]);
    }
    for (const d of set.documents) expect(d.markdown.includes('SIMULATED CUSTOMER'), d.template_id).toBe(false);
  });

  test('DOCX: all 22 carry the marker in their first 3000 characters, bold, no literal markdown; none without', async () => {
    const textOf = async (docx: Buffer) => {
      const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
      return { xml, text: xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => `${m.replace(/<[^>]+>/g, '')}\n`).replace(/<[^>]+>/g, '') };
    };
    expect(Object.keys(simFiles)).toHaveLength(22);
    for (const [name, f] of Object.entries(simFiles)) {
      const { xml, text } = await textOf(f.docx);
      expect(text.slice(0, 3000).includes(MARK), name).toBe(true);
      expect(text.includes('**SIMULATED'), name).toBe(false);
      expect(/<w:r>(?:(?!<\/w:r>).)*<w:b\/>(?:(?!<\/w:r>).)*SIMULATED CUSTOMER \(FICTIONAL\)/s.test(xml), `${name} bold`).toBe(true);
    }
    for (const [name, f] of Object.entries(files)) expect((await textOf(f.docx)).text.includes('SIMULATED CUSTOMER'), name).toBe(false);
  });

  test('the helper keeps the line endings; no block returns the same object', () => {
    const doc = { template_id: 'poam', title: 'T', markdown: '# T\r\n\r\n## 1. A\r\n', completeness: 100, domain: 'x', nist_controls: [] };
    const para = simulationMarkerParagraph(SIM as never);
    expect(withSimulationMarker(doc, SIM as never).markdown).toBe(`# T\r\n\r\n${para}\r\n\r\n## 1. A\r\n`);
    expect(withSimulationMarker({ ...doc, markdown: '# T\n\n## 1. A\n' }, SIM as never).markdown).toBe(`# T\n\n${para}\n\n## 1. A\n`);
    expect(withSimulationMarker(doc, null)).toBe(doc);
    expect(withSimulationMarker(doc, undefined)).toBe(doc);
  });
});

describe('MG-16: personnel drafted from directory role holders', () => {
  const roleFacts: InterviewFact[] = [
    ['TCP.PA.001', 'admin@simtenant-a.onmicrosoft.us'],
    ['TCP.PA.002', 'secadmin@simtenant-a.onmicrosoft.us'],
    ['TCP.PA.003', 'complianceadmin@simtenant-a.onmicrosoft.us'],
  ].map(([id, answer]) => ({
    question_id: id,
    question_text: id,
    answer,
    provenance: 'auto_detected',
    confidence: 'high',
    recorded_at: '2026-01-15T00:00:00.000Z',
    source: 'graph:roleAssignments',
  }));

  test('drafts are shown, never rendered, until a person confirms them', () => {
    const profile = buildPolicyInputsProfile({ facts: roleFacts, party: { name: 'Draft Co' }, missionPlan: null, bank });
    expect(profile.drafts.map((d) => d.question_id)).toEqual(['PI.PER.001', 'PI.PER.002', 'PI.PER.003', 'PI.PER.004', 'PI.PER.006']);
    expect(profile.drafts[0].value).toBe('secadmin@simtenant-a.onmicrosoft.us | Information System Security Officer | secadmin@simtenant-a.onmicrosoft.us');
    expect(profile.output.personnel).toEqual([]);
    const confirmed: InterviewFact = {
      question_id: 'PI.PER.001',
      question_text: 'PI.PER.001',
      answer: profile.drafts[0].value,
      provenance: 'operator_interview',
      confidence: 'high',
      recorded_at: '2026-01-16T00:00:00.000Z',
    };
    const after = buildPolicyInputsProfile({ facts: [...roleFacts, confirmed], party: { name: 'Draft Co' }, missionPlan: null, bank });
    expect(after.output.personnel).toEqual([
      {
        role_id: 'isso',
        role_title: 'Information System Security Officer',
        name: 'secadmin@simtenant-a.onmicrosoft.us',
        title: 'Information System Security Officer',
        email: 'secadmin@simtenant-a.onmicrosoft.us',
      },
    ]);
    expect(after.drafts.map((d) => d.question_id)).not.toContain('PI.PER.001');
  });

  test('with nothing discovered or answered, the 22 still render token-free (template defaults apply)', async () => {
    const thin = await renderPolicySet({ compile: compiled, facts: [], party: { name: 'Thin Co' }, bank });
    expect(thin.documents).toHaveLength(22);
    for (const d of thin.documents) expect(unresolvedTokens(d.markdown, conventionPatterns(thin.context)), d.template_id).toEqual([]);
    expect(thin.profile.sources.filter((s) => s.provenance === 'missing').map((s) => s.question_id)).toContain('PI.PER.001');
  });
});

describe('W5c2 (SC-5 P10): Muster\'s continuous monitoring plan and acceptable use policy', () => {
  const at = '2026-10-01T00:00:00.000Z';
  const answer = (question_id: string, value: string): InterviewFact => ({
    question_id,
    question_text: question_id,
    answer: value,
    provenance: 'operator_interview',
    confidence: 'high',
    recorded_at: at,
    source: 'synthetic-interview:w5c2-test',
  });
  /** The S1 shape: the three new personnel answers (one "role held by"), plus the existing ISSO and HR answers. */
  const S1_LIKE: InterviewFact[] = [
    answer('PI.PER.001', 'Fixture Isso | Information Systems Security Officer (ISSO) | isso@w5c2.example'),
    answer('PI.PER.005', 'Fixture Hr | Controller | hr@w5c2.example'),
    answer('PI.PER.006', 'Fixture Admin | Systems Administrator | admin@w5c2.example'),
    answer('PI.PER.008', 'Fixture Legal | Contracts and CUI Manager | legal@w5c2.example'),
    answer('PI.PER.009', 'Fixture Owner | President / Owner | owner@w5c2.example'),
    answer('PI.PER.010', 'role held by Contracts and CUI Manager'),
    answer('PI.PER.011', 'Fixture Admin | Systems Administrator (Network Administrator role holder) | admin@w5c2.example'),
  ];
  const ORG = {
    roles: { issm: { name: 'Fixture Issm', title: 'Information Security Manager (ISSM)' } },
    approvers: { policy_approver: { name: 'Fixture Owner', title: 'President / Owner' } },
  };
  const SIM = { simulated: true, legalName: 'W5c2 Fixture LLC (FICTIONAL)' };
  const GAP = 'Not supplied by the organisation (content gap)';
  const muster = (ps: PolicySet) => ps.documents.filter((d) => MUSTER_IDS.includes(d.template_id));
  let s1: PolicySet;
  let partial: PolicySet;

  beforeAll(async () => {
    s1 = await renderPolicySet({ compile: compiled, facts: S1_LIKE, party: { name: 'W5c2 Fixture LLC (FICTIONAL)' }, bank, simulation: SIM, orgContent: ORG });
    // muster-partial: no answers, no organisation content, no simulation block.
    partial = await renderPolicySet({ compile: compiled, facts: [], party: { name: 'Sim tenant muster-partial' }, bank });
  }, 120_000);

  test('S1-like: both render with zero unresolved tokens, the answered roles named, no content gap, owner and approver named', () => {
    const docs = muster(s1);
    expect(docs.map((d) => d.template_id)).toEqual(['continuous_monitoring_plan', 'acceptable_use_policy']);
    const blank = /^(|not specified|tbd|n\/a|none|designated official|\[.*\]|_+)$/i;
    for (const d of docs) {
      expect(unresolvedTokens(d.markdown, conventionPatterns(s1.context)), d.template_id).toEqual([]);
      expect(d.completeness, d.template_id).toBe(100);
      expect(d.markdown.includes(GAP), d.template_id).toBe(false);
      expect(/Designated Official|\[Name\]|\[Title\]|\bNot specified\b|\bTBD\b/.test(d.markdown), d.template_id).toBe(false);
      expect(blank.test(documentOwner(d.markdown)), `${d.template_id} owner`).toBe(false);
      expect(documentApprover(d.markdown), d.template_id).toBe('Fixture Owner, President / Owner (Authorizing Official)');
      expect(d.markdown.split(/\r?\n/)[2], d.template_id).toBe('**SIMULATED CUSTOMER (FICTIONAL): W5c2 Fixture LLC (FICTIONAL)**');
    }
    const [conmon, aup] = docs;
    expect(documentOwner(conmon.markdown)).toBe('Fixture Isso');
    expect(conmon.markdown).toContain('| **Authorizing Official** | Fixture Owner, President / Owner |');
    expect(conmon.markdown).toContain('| Network Administrator | Fixture Admin |');
    expect(conmon.markdown).toContain(`| Vulnerability scanning of in-scope systems | ${s1.context.odp.vuln_scan_frequency} |`);
    // "role held by Contracts and CUI Manager" names the PI.PER.008 holder.
    expect(aup.markdown).toContain('| Privacy Officer | Fixture Legal |');
    expect(aup.markdown).toContain('| HR Representative | Fixture Hr |');
  });

  test('muster-partial: both render with zero unresolved tokens; each unanswered role is the content-gap sentence', () => {
    const [conmon, aup] = muster(partial);
    for (const d of [conmon, aup]) {
      expect(unresolvedTokens(d.markdown, conventionPatterns(partial.context)), d.template_id).toEqual([]);
      expect(/Designated Official|\[Name\]|\[Title\]|\bNot specified\b|\bTBD\b/.test(d.markdown), d.template_id).toBe(false);
      expect(d.markdown.includes('SIMULATED CUSTOMER'), d.template_id).toBe(false);
    }
    expect(conmon.markdown).toContain(`${GAP}: the Authorizing Official (PI.PER.009).`);
    expect(conmon.markdown).toContain(`${GAP}: the Network Administrator (PI.PER.011).`);
    expect(aup.markdown).toContain(`${GAP}: the Privacy Officer (PI.PER.010).`);
    // Generic defaults where nothing is answered: the bank ODPs still fill the schedule.
    expect(conmon.markdown).toContain(`| Vulnerability scanning of in-scope systems | ${partial.context.odp.vuln_scan_frequency} |`);
  });

  test('the SSP appendix map names documents the set renders (J = the configuration management policy)', () => {
    const bases = s1.documents.map((d) => policyFileBase(d));
    expect(SSP_APPENDIX_DOCUMENTS).toEqual({
      I: 'incident-response-plan',
      J: 'configuration-management-policy',
      K: 'continuous-monitoring-plan',
      L: 'acceptable-use-policy',
    });
    for (const base of Object.values(SSP_APPENDIX_DOCUMENTS)) expect(bases).toContain(base);
  });

  test('approver: the answered Authorizing Official (PI.PER.009) comes before the System Owner when the organisation content names none', () => {
    const ctx = { ...s1.context, personnel: { ...s1.context.personnel, system_owner: { name: 'Fixture Sysowner', title: 'CTO', email: '', role_title: 'System Owner' } } };
    expect(resolvePolicySignatories(ctx)?.approver).toMatchObject({ name: 'Fixture Owner', source: 'policy personnel authorizing_official' });
  });
});
