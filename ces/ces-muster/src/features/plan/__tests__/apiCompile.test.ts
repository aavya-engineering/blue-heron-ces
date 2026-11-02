// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-32 (FLOW-7, V125): the Plan tab's muster-api path sends what the headless round sends.
// - the typed answers leave in the interview-answers file shape the runner accepts
//   (parseInterviewAnswers is the judge, not a copy of its rules);
// - the compile body has the keys of `plan-compile.mjs compileBody`;
// - the push body is the `mx-helpers.mjs push` pick (newest file per prefix) plus the policy
//   texts matched to the policy-set manifest (ces-tester eo-intake.manifestPolicyTexts);
// - discovery runs on the API with the answers, then the compile gets that envelope.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { InterviewFact } from '@/shared/types/engagement';
import { parseInterviewAnswers } from '../headless/answersImport';
import {
  answersFileFromFacts,
  apiCompileBody,
  apiPushBody,
  compileOnApi,
  fileTestId,
  pickFile,
  policyTextsFor,
  pushCompiledOnApi,
  pushedParts,
  type ApiCompiledFile,
} from '../apiCompile';

const SLUG = 's1-mach';
const T = '2026-10-31T10:00:00.000Z';

const fact = (id: string, answer: string, provenance = 'operator_interview', extra: Partial<InterviewFact> = {}): InterviewFact => ({
  question_id: id,
  question_text: `Q ${id}`,
  answer,
  provenance,
  confidence: 'high',
  recorded_at: T,
  ...extra,
});

const f = (name: string, content: unknown): ApiCompiledFile => ({
  name,
  encoding: 'utf8',
  content: typeof content === 'string' ? content : JSON.stringify(content),
});

const TS1 = '2026-10-31T10-00-00-000Z';
const TS2 = '2026-10-31T11-00-00-000Z';
const MANIFEST = { ces: { artifact: 'policy_set_manifest' }, artifact: { documents: [{ name: 'access-control-policy.md' }, { name: 'missing-policy.md' }] } };
const FILES: ApiCompiledFile[] = [
  f(`manual-mission-plan-${SLUG}-${TS1}.json`, { mp: 'old' }),
  f(`manual-mission-plan-${SLUG}-${TS2}.json`, { mp: 'new' }),
  f(`tenant-manifest-${SLUG}-${TS2}.json`, { tm: 1 }),
  f(`infrastructure-manifest-${SLUG}-${TS2}.json`, { im: 1 }),
  f(`si-baseline-${SLUG}-${TS2}.json`, { si: 1 }),
  f(`tcp-${SLUG}-${TS2}.json`, { tcp: 1 }),
  f(`readiness-posture-${SLUG}-${TS2}.json`, { rp: 1 }),
  f(`policy-inputs-profile-${SLUG}-${TS2}.json`, { pip: 1 }),
  f(`policy-set-manifest-${SLUG}-${TS2}.json`, MANIFEST),
  f(`cui-boundary-${SLUG}-${TS2}.json`, { cui: 1 }),
  f(`btc-confirmation-${SLUG}-${TS2}.json`, { btc: 1 }),
  f('plan-trace.json', { trace: 1 }),
  f('policies/access-control-policy.md', '# Access control\n'),
  { name: 'policies/access-control-policy.docx', encoding: 'base64', content: 'UEsDBA==' },
  f('reports/tenant-manifest-x.json', { notTopLevel: true }),
];

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('answersFileFromFacts', () => {
  it('keeps only the operator answers, last per question, in the shape the runner parses', () => {
    const facts = [
      fact('G-01', 'yes'),
      fact('G-02', 'no', 'auto_detected', { source: 'discovery:x' }),
      fact('bnd-001', 'yes', 'resolver_draft', { attestation: { confirmed_by: 'A', confirmed_on: T } as InterviewFact['attestation'] }),
      fact('G-01', 'no'),
      fact('G-03', 'CTI, Export Controlled', 'operator_interview', { source: 'should-be-replaced' }),
      fact('G-04', '   '),
    ];
    const rows = answersFileFromFacts(facts, SLUG);
    expect(rows.map((r) => [r.question_id, r.answer])).toEqual([
      ['G-01', 'no'],
      ['G-03', 'CTI, Export Controlled'],
    ]);
    // The runner's own parser accepts the file (seven keys, provenance, source per slug).
    const parsed = parseInterviewAnswers(JSON.stringify(rows), SLUG);
    expect(parsed).toHaveLength(2);
    expect(Object.keys(rows[0]).sort()).toEqual(['answer', 'confidence', 'provenance', 'question_id', 'question_text', 'recorded_at', 'source']);
    expect(rows[1].source).toBe(`synthetic-interview:${SLUG}`);
  });
});

describe('request bodies', () => {
  it('compile body has the plan-compile.mjs keys; org content only when given', () => {
    const rows = answersFileFromFacts([fact('G-01', 'yes')], SLUG);
    expect(Object.keys(apiCompileBody({ slug: SLUG, discovery: { env: 1 }, answers: rows })).sort()).toEqual([
      'discovery',
      'interview_answers',
      'tenant_slug',
    ]);
    const withOrg = apiCompileBody({ slug: SLUG, discovery: { env: 1 }, answers: rows, orgContentText: '{"slug":"s1-mach"}' });
    expect(withOrg.org_content).toBe('{"slug":"s1-mach"}');
    expect(apiCompileBody({ slug: SLUG, discovery: {}, answers: [], orgContentText: '  ' }).org_content).toBeUndefined();
    // The session's services become `stacks` (compileBody's MX_STACKS); 'none' and empty = runner default.
    expect(apiCompileBody({ slug: SLUG, discovery: {}, answers: [], stacks: ['m365_e5_gcc', 'none', 'microsoft_intune'] }).stacks).toEqual([
      'm365_e5_gcc',
      'microsoft_intune',
    ]);
    expect('stacks' in apiCompileBody({ slug: SLUG, discovery: {}, answers: [], stacks: ['none'] })).toBe(false);
  });

  it('push body = the mx-helpers pick (newest per prefix, top level only) + policies from the manifest', () => {
    const body = apiPushBody(FILES, SLUG);
    expect(body.tenant_slug).toBe(SLUG);
    expect(body.missionPlan).toEqual({ mp: 'new' });
    expect(body.tenantManifest).toEqual({ tm: 1 });
    expect(body.infraManifest).toEqual({ im: 1 });
    expect(pushedParts(body).sort()).toEqual(
      [
        'missionPlan',
        'tenantManifest',
        'infraManifest',
        'si_baseline',
        'tcp',
        'readiness_posture',
        'policy_inputs_profile',
        'policy_set_manifest',
        'cui_boundary',
        'policies',
      ].sort()
    );
    expect(body.policies).toEqual([{ name: 'access-control-policy.md', markdown: '# Access control\n' }]);
    expect(policyTextsFor(MANIFEST, FILES).missing).toEqual(['missing-policy.md']);
    expect(apiPushBody(FILES, SLUG, { reason: ' known gap ' }).validationOverride).toEqual({ reason: 'known gap' });
  });

  it('refuses a compile with no Mission Plan; ignores non-top-level look-alikes', () => {
    expect(() => apiPushBody([f(`tenant-manifest-${SLUG}-${TS1}.json`, {})], SLUG)).toThrow(/no Mission Plan/);
    expect(pickFile(FILES, 'tenant-manifest-')?.name).toBe(`tenant-manifest-${SLUG}-${TS2}.json`);
    expect(fileTestId(`cui-boundary-${SLUG}-${TS2}.json`)).toBe('cui-boundary-s1-mach-json');
    expect(fileTestId('policies/access-control-policy.md')).toBe('policies-access-control-policy-md');
  });
});

describe('compileOnApi / pushCompiledOnApi (network faked)', () => {
  function fakeApi(handlers: Record<string, (body: unknown) => { status: number; json: unknown }>) {
    const calls: Array<{ method: string; path: string; body: unknown; auth: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const p = new URL(url, 'http://x').pathname;
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method: init.method ?? 'GET', path: p, body, auth: (init.headers as Record<string, string>).Authorization ?? null });
        const h = handlers[`${init.method} ${p}`] ?? handlers[p];
        if (!h) return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
        const r = h(body);
        return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } });
      })
    );
    return calls;
  }

  const ENVELOPE = { schema: 'readiness-result.v1', observations: [] };

  it('E2 then E3: discovery runs with the answers; the compile gets its envelope and the same answers', async () => {
    localStorage.setItem('muster-jwt', 'tok');
    const rows = answersFileFromFacts([fact('G-01', 'yes')], SLUG);
    const calls = fakeApi({
      'POST /api/discovery/run': () => ({ status: 202, json: { job_id: 'j1', status: 'running' } }),
      'GET /api/discovery/run/j1': () => ({ status: 200, json: { status: 'done', envelope: ENVELOPE } }),
      'POST /api/plan/compile': () => ({ status: 200, json: { tenant_slug: SLUG, summary: 'files=2', files: FILES, initial_password_ref: null, recurring_cost_notice: null } }),
    });
    // The fake envelope is not a parseable readiness result; the run must still hand it on.
    const parse = await import('@/features/discovery/importReadinessResult');
    vi.spyOn(parse, 'parseReadinessResultFile').mockReturnValue({} as never);
    vi.spyOn(parse, 'discoveryResultsFromPayload').mockReturnValue([]);
    vi.spyOn(parse, 'factsFromPayload').mockReturnValue([]);
    vi.spyOn(parse, 'consentsFromPayload').mockReturnValue([]);

    const r = await compileOnApi({ slug: SLUG, answers: rows, orgContentText: '{"a":1}', discovery: { sleep: async () => {} } });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/discovery/run', 'GET /api/discovery/run/j1', 'POST /api/plan/compile']);
    expect(calls[0].body).toEqual({ tenant_slug: SLUG, answers: rows });
    expect(calls[2].body).toEqual({ tenant_slug: SLUG, discovery: ENVELOPE, interview_answers: rows, org_content: '{"a":1}' });
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  it('a 401 compile is reported as a sign-in problem; a 409 push is a gate the operator may override', async () => {
    fakeApi({
      'POST /api/discovery/run': () => ({ status: 202, json: { job_id: 'j2' } }),
      'GET /api/discovery/run/j2': () => ({ status: 200, json: { status: 'done', envelope: ENVELOPE } }),
      'POST /api/plan/compile': () => ({ status: 401, json: { error: 'no token' } }),
      'POST /api/plan/push': () => ({ status: 409, json: { error: 'push gate', blocking: ['x'] } }),
    });
    const parse = await import('@/features/discovery/importReadinessResult');
    vi.spyOn(parse, 'parseReadinessResultFile').mockReturnValue({} as never);
    const c = await compileOnApi({ slug: SLUG, answers: [], discovery: { sleep: async () => {} } });
    expect(c).toMatchObject({ ok: false, status: 401 });
    const p = await pushCompiledOnApi(FILES, SLUG);
    expect(p).toMatchObject({ ok: false, status: 409, blocking: true });
    expect(p.sent).toContain('cui_boundary');
  });
});
