// Gap closure NS-4t: the tester-harness port of the package's NS-4 steps (E8.5 principal uploads, E8.6 document reviews,
// E8F stale build) and NS-2's interview-record posts. No servers: fetch is faked; the package loader, ces-shared's signer
// and muster-api's interview builder are the real modules (reads only).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  attemptStaleBuild,
  badReviewUploads,
  loadInterviewRecordModule,
  loadPrincipalSigner,
  operatorClaims,
  postInterviewRecords,
  reviewUploadRequests,
  reviewUploadRows,
  runReviewStep,
  splitReviewUploads,
  uploaderClaims,
  HARNESS_INTERVIEWER,
  type ReviewPlan,
} from '../src/flow/eo-reviews.js';
import { uploadRecords, type RecordUploadResult } from '../src/flow/ec-records.js';
import { perRunArtefacts } from '../src/flow/muster-e2e-run.js';

const CES = path.resolve('..');
const PKG = path.resolve('..', '..', 'pkg', 'ces-muster-run');
const pkgReady = fs.existsSync(path.join(PKG, 'scripts', 'build-customer-records.mjs'));
const sharedDist = path.join(CES, 'ces-shared', 'dist', 'http', 'requestPrincipal.js');
const objectivesRef = path.join(CES, 'ces-shared', 'dist', 'data', 'assessment-objectives.reference.json');
const musterApi = path.join(CES, 'ces-muster', 'muster-api');

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeFetch(answer: (c: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c: Call = { url, method: String(init.method), headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const a = answer(c);
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const plan = (over: Partial<ReviewPlan> = {}): ReviewPlan => ({
  schema: 'mx-e2e/review-plan@1', slug: 'sx', uploader: { upn: 'isso@sx.invalid' }, reviewer: { upn: 'ao@sx.invalid' }, operatorUpn: 'op@sx.invalid',
  uploads: [
    { id: 'rec1', file: 'records/a.json', sha256: 'aa', control_ids: ['PE.L1-3.10.1'], body: { controlIds: ['PE.L1-3.10.1'] } },
    { id: 'probe', file: 'review-artifacts/probe.json', sha256: 'pp', control_ids: ['CA.L2-3.12.4'], body: { controlIds: ['CA.L2-3.12.4'] } },
  ],
  reviews: [
    { control_id: 'PE.L1-3.10.1', objective_id: '3.10.1[a]', artifact: 'rec1', verdict: 'met', notes: 'n1' },
    { control_id: 'PE.L1-3.10.1', objective_id: '3.10.1[b]', artifact: 'rec1', verdict: 'met', notes: 'n2' },
  ],
  notReviewed: [],
  probe: { artifact: 'probe', control_id: 'CA.L2-3.12.4' },
  ...over,
});

describe('NS-4t E8.5: review uploads carry the uploader principal, one EC item per document', () => {
  it('uploadRecords sends x-ces-principal beside the EC bearer and records EC uploadedBy; without it the row shape is unchanged', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 201, body: { itemId: 'i1', sha256: 'aa', uploadedBy: { upn: 'isso@sx.invalid' } } }));
    const req = reviewUploadRequests([plan().uploads[0]]);
    const rows = await uploadRecords('http://ec', 'sek', req, f, { 'x-ces-principal': 'tok' });
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer sek', 'x-ces-principal': 'tok' });
    expect(rows[0]).toMatchObject({ http_status: 201, item_id: 'i1', sha256_match: true, uploaded_by: 'isso@sx.invalid' });
    const plain = await uploadRecords('http://ec', 'sek', req, f);
    expect('uploaded_by' in plain[0]).toBe(false);
    expect(calls[1].headers['x-ces-principal']).toBeUndefined();
  });

  it('a records/ artifact the catalog upload sent is reused; review-artifacts/ and the probe are uploaded; bad rows are named', () => {
    const cat: RecordUploadResult[] = [{ file: 'a.json', record_kind: 'k', control_ids: ['PE.L1-3.10.1'], http_status: 201, item_id: 'i1', sha256: 'aa', sha256_match: true, uploaded_by: 'isso@sx.invalid' }];
    const { reused, toUpload } = splitReviewUploads(plan(), cat);
    expect(reused.map((r) => [r.id, r.sha256, r.uploaded_by, r.via_catalog_upload])).toEqual([['rec1', 'aa', 'isso@sx.invalid', true]]);
    expect(toUpload.map((u) => u.id)).toEqual(['probe']);
    // a catalog row with other bytes is not reused
    expect(splitReviewUploads(plan(), [{ ...cat[0], sha256: 'zz' }]).toUpload.map((u) => u.id)).toEqual(['rec1', 'probe']);
    const sent = reviewUploadRows(toUpload, [{ file: 'review-artifacts/probe.json', record_kind: 'review-artifact', control_ids: [], http_status: 201, item_id: 'i2', sha256: 'pp', sha256_match: true, uploaded_by: null }]);
    expect(badReviewUploads([...reused, ...sent]).map((r) => r.id)).toEqual(['probe']); // no uploader recorded
  });

  it.skipIf(!pkgReady || !fs.existsSync(objectivesRef))('the package loader gives the four plans; S1 reuses its catalog records and uploads only the probe', async () => {
    // Loaded in a plain node child, as the compiled runner loads it (vitest's transform rejects the CRLF hashbang file).
    const script = `import(process.argv[1]).then((m) => { const ref = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
      const out = {}; for (const s of ['s1-mach', 's2-eng', 's3-def', 'muster-partial']) out[s] = m.loadDocumentReviews(process.argv[2], s, { objectivesRef: ref });
      process.stdout.write(JSON.stringify(out)); })`;
    const r = spawnSync(process.execPath, ['-e', script, pathToFileURL(path.join(PKG, 'scripts', 'build-customer-records.mjs')).href, PKG, objectivesRef], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(r.status, r.stderr).toBe(0);
    const plans = JSON.parse(r.stdout) as Record<string, ReviewPlan>;
    const counts = Object.fromEntries(Object.entries(plans).map(([s, p]) => [s, [p.uploads.length, p.reviews.length]]));
    // FIN-29 (FD-17): S1 +4 artifacts (support infrastructure, alternate sites, security impact analysis, signed SSP) and +12
    // reviews; S2 +3 artifacts and +4 reviews (LOG-FIN-29.md AR5 table).
    // FIN-35 (LOG-DEPTH-11.md open item 5): S1 and S2 each +3 artifacts (maintenance-control procedure, media marking,
    // backup protection) and +8 reviews (MA.L2-3.7.1 [a], MA.L2-3.7.2 [a]-[d], MP.L2-3.8.4 [a]-[b], MP.L2-3.8.9 [a]).
    expect(counts).toEqual({ 's1-mach': [20, 51], 's2-eng': [19, 44], 's3-def': [2, 1], 'muster-partial': [1, 0] });
    const s1 = plans['s1-mach'];
    const cat = JSON.parse(fs.readFileSync(path.join(PKG, 'customers', 's1-mach', 'records', 'catalog.json'), 'utf8')) as { items: Array<{ file: string; sha256: string }> };
    const rows: RecordUploadResult[] = cat.items.map((i) => ({ file: i.file, record_kind: 'k', control_ids: [], http_status: 201, item_id: 'x', sha256: i.sha256, sha256_match: true, uploaded_by: s1.uploader.upn }));
    const { toUpload } = splitReviewUploads(s1, rows);
    expect(toUpload.every((u) => u.file.startsWith('review-artifacts/'))).toBe(true);
    expect(toUpload.map((u) => u.id)).toContain(s1.probe.artifact);
  });
});

describe('NS-4t E8.6: document reviews', () => {
  const hashOf = { rec1: 'aa', probe: 'pp' };
  const base = { eoUrl: 'http://eo', slug: 'sx', hashOf, baseHeaders: { Authorization: 'Bearer eo-run' }, operatorToken: () => 'op-tok', now: () => 't' };

  it('mints for the reviewer, posts one review per row with the minted token, and the self-review probe gets 403: rc 0', async () => {
    const { f, calls } = fakeFetch((c) => {
      if (c.url.includes('/api/approver-tokens')) return { status: 201, body: { token: `tok-${(c.body as { approverUpn: string }).approverUpn}`, mintId: 'm1', operatorAuth: 'dev' } };
      if (c.headers['x-ces-principal'] === 'tok-isso@sx.invalid') return { status: 403, body: { error: 'reviewer_is_uploader' } };
      return { status: 201, body: { reviewId: 'r' } };
    });
    const { rc, record } = await runReviewStep({ ...base, plan: plan(), fetchImpl: f });
    expect(rc).toBe(0);
    expect(record).toMatchObject({ schema: 'mx-e2e/eo-reviews@1', reviews_planned: 2, posted_201: 2, mint_status: 201, self_mint_status: 201, self_review_status: 403, self_review_error: 'reviewer_is_uploader' });
    expect(calls[0]).toMatchObject({ url: 'http://eo/api/approver-tokens?tenant=sx', body: { approverUpn: 'ao@sx.invalid' }, headers: { Authorization: 'Bearer eo-run', 'x-ces-principal': 'op-tok' } });
    expect(calls[1]).toMatchObject({ url: 'http://eo/api/reviews', body: { tenant: 'sx', controlId: 'PE.L1-3.10.1', objectiveId: '3.10.1[a]', artifactHash: 'aa', verdict: 'met', notes: 'n1' }, headers: { 'x-ces-principal': 'tok-ao@sx.invalid' } });
    expect(JSON.stringify(record)).not.toMatch(/tok-|op-tok/); // never a token in the record
  });

  it('a self-review that is accepted, a refused review, or a refused mint is rc 1', async () => {
    const accepted = fakeFetch((c) => (c.url.includes('approver-tokens') ? { status: 201, body: { token: 't' } } : { status: 201, body: { reviewId: 'r' } }));
    expect((await runReviewStep({ ...base, plan: plan(), fetchImpl: accepted.f })).rc).toBe(1);
    const refused = fakeFetch((c) => (c.url.includes('approver-tokens') ? { status: 201, body: { token: 't' } } : { status: 409, body: { error: 'uploader_unknown' } }));
    const r2 = await runReviewStep({ ...base, plan: plan(), fetchImpl: refused.f });
    expect([r2.rc, r2.record.posted_201, r2.record.posted[0].error]).toEqual([1, 0, { error: 'uploader_unknown' }]);
    const noMint = fakeFetch(() => ({ status: 503, body: { error: 'operator_auth_not_configured' } }));
    const r3 = await runReviewStep({ ...base, plan: plan(), fetchImpl: noMint.f });
    expect([r3.rc, r3.record.mint_status, noMint.calls.length]).toEqual([1, 503, 1]);
  });

  it('no plan, or a plan with no review (muster-partial: the probe only), is rc 0 with a note and no call', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 500, body: {} }));
    expect((await runReviewStep({ ...base, plan: null, fetchImpl: f })).rc).toBe(0);
    const r = await runReviewStep({ ...base, plan: plan({ reviews: [], reviewer: null }), fetchImpl: f });
    expect([r.rc, r.record.note, calls.length]).toEqual([0, 'the plan has no review (probe upload only)', 0]);
  });

  it.skipIf(!fs.existsSync(sharedDist))('tokens are ces-shared HS256 tokens: uploader without roles, operator with bhd-operator', async () => {
    const sign = await loadPrincipalSigner(CES);
    const secret = 'x'.repeat(48);
    const shared = (await import(pathToFileURL(sharedDist).href)) as { createHs256PrincipalVerifier: (o: { secret: string }) => { verify: (t: string) => { ok: boolean; principal?: { upn: string; roles: string[]; subjectId?: string } } } };
    const v = shared.createHs256PrincipalVerifier({ secret });
    const up = v.verify(sign(uploaderClaims('ISSO@sx.invalid'), secret));
    const op = v.verify(sign(operatorClaims('op@sx.invalid'), secret));
    expect([up.ok, up.principal?.upn, up.principal?.roles]).toEqual([true, 'ISSO@sx.invalid', []]);
    expect([op.ok, op.principal?.roles]).toEqual([true, ['bhd-operator']]);
    expect(v.verify(sign(uploaderClaims('a@b.c'), 'y'.repeat(48))).ok).toBe(false);
  });
});

describe('NS-4t E8F: the stale package build (V78)', () => {
  it('409 is recorded with EO error text; a 200 removes the zip it wrote; no answer records null', async () => {
    const refused = fakeFetch(() => ({ status: 409, body: { error: 'Package build refused: snapshot mismatch' } }));
    expect(await attemptStaleBuild('http://eo', 'sx', { Authorization: 'Bearer b' }, refused.f)).toEqual({ stale_build_status: 409, stale_build_reason: 'Package build refused: snapshot mismatch' });
    expect(refused.calls[0]).toMatchObject({ url: 'http://eo/api/package/build', method: 'POST', body: { tenant: 'sx' }, headers: { Authorization: 'Bearer b' } });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns4t-'));
    try {
      const zip = path.join(dir, 'p.zip');
      fs.writeFileSync(zip, 'z');
      const built = fakeFetch(() => ({ status: 200, body: { filePath: zip } }));
      expect(await attemptStaleBuild('http://eo', 'sx', {}, built.f)).toEqual({ stale_build_status: 200, stale_build_reason: '', stale_build_zip_removed: true });
      expect(fs.existsSync(zip)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect((await attemptStaleBuild('http://eo', 'sx', {}, down)).stale_build_status).toBeNull();
  });
});

describe('NS-4t E7: interview records (V81)', () => {
  it('posts {tenant, records} with the EO bearer and reads the list back; no answers file posts nothing', async () => {
    const { f, calls } = fakeFetch((c) => (c.method === 'POST' ? { status: 201, body: { received: 2, stored: 2, skipped: 0 } } : { status: 200, body: { tenant: 'sx', records: [{}, {}] } }));
    const r = await postInterviewRecords('http://eo', 'sx', { records: [{ a: 1 }, { b: 2 }], skipped: [] }, 'pkg/customers/sx/interview-answers.json', { Authorization: 'Bearer b' }, f, () => 't');
    expect(r.ok).toBe(true);
    expect(r.record).toMatchObject({ built: 2, http_status: 201, stored: 2, skipped: 0, listed: 2, interviewer: HARNESS_INTERVIEWER });
    expect(calls[0]).toMatchObject({ url: 'http://eo/api/interviews', body: { tenant: 'sx', records: [{ a: 1 }, { b: 2 }] }, headers: { Authorization: 'Bearer b' } });
    expect(calls[1].url).toBe('http://eo/api/interviews?tenant=sx');
    const none = await postInterviewRecords('http://eo', 'mp', null, null, {}, f);
    expect([none.ok, none.record.built, none.record.note, calls.length]).toEqual([true, 0, 'no customers/<slug>/interview-answers.json', 2]);
    const bad = fakeFetch((c) => (c.method === 'POST' ? { status: 400, body: { error: 'records_invalid' } } : { status: 200, body: { records: [] } }));
    const b = await postInterviewRecords('http://eo', 'sx', { records: [{}], skipped: [] }, 'x', {}, bad.f);
    expect([b.ok, b.record.error, b.record.listed]).toEqual([false, { error: 'records_invalid' }, 0]);
  });

  it.skipIf(!pkgReady || !fs.existsSync(path.join(musterApi, 'dist', 'services', 'interviewRecordService.js')))('muster-api dist builds the NS-2 counts with stable recordIds (s1 143, s2 144, s3 105; FIN-29 adds the PI.PER.012 row to S1/S2, LOG-FIN-26)', async () => {
    const im = await loadInterviewRecordModule(musterApi);
    const qc = im.readQuestionControlMap(path.join(CES, 'ces-muster'));
    const counts: Record<string, number> = {};
    for (const slug of ['s1-mach', 's2-eng', 's3-def']) {
      const answers = fs.readFileSync(path.join(PKG, 'customers', slug, 'interview-answers.json'), 'utf8');
      const a = im.buildInterviewRecords(answers, { tenantSlug: slug, interviewer: { ...HARNESS_INTERVIEWER }, questionControls: qc });
      const b = im.buildInterviewRecords(answers, { tenantSlug: slug, interviewer: { ...HARNESS_INTERVIEWER }, questionControls: qc });
      expect((a.records as Array<{ recordId: string }>).map((r) => r.recordId)).toEqual((b.records as Array<{ recordId: string }>).map((r) => r.recordId));
      counts[slug] = a.records.length;
    }
    expect(counts).toEqual({ 's1-mach': 143, 's2-eng': 144, 's3-def': 105 });
    expect(fs.existsSync(path.join(PKG, 'customers', 'muster-partial', 'interview-answers.json'))).toBe(false);
  });
});

describe('NS-4t runner wiring (source order)', () => {
  const src = fs.readFileSync(path.resolve('src', 'flow', 'muster-e2e-run.ts'), 'utf8');
  it('E8.6 runs inside E7 after the health wait and before connect; interviews before connect; the main loop skips it', () => {
    const e7 = src.indexOf("id: 'E7',");
    const health = src.indexOf('/api/health`, \'GET\', 120', e7);
    const e86 = src.indexOf("await execStep(defs.find((d) => d.id === 'E8.6')!)", e7);
    const iv = src.indexOf('postInterviewRecords(EO_URL', e7);
    const connect = src.indexOf('/api/connect?tenant=${slug}`, stop', e7);
    expect(e7).toBeGreaterThan(-1);
    expect(health).toBeGreaterThan(e7);
    expect(e86).toBeGreaterThan(health);
    expect(iv).toBeGreaterThan(e86);
    expect(connect).toBeGreaterThan(iv);
    expect(src).toContain("if (d.id === 'E8.6' || d.id === 'E8.5b' || d.id === 'E8.6b') continue;"); // FIN-19: E8.5b / E8.6b too
  });
  it('E8F tries the stale build after the forced assess id and before the forced ssp/generate', () => {
    const e8f = src.indexOf("id: 'E8F',");
    const aid = src.indexOf('extra.assessment_id = faid;', e8f);
    const stale = src.indexOf('attemptStaleBuild(EO_URL, slug, eoAuthHeaders())', e8f);
    const ssp = src.indexOf('/api/ssp/generate`, path.join(P.forced', e8f);
    expect([aid > e8f, stale > aid, ssp > stale]).toEqual([true, true, true]);
    expect(src.indexOf("fs.writeFileSync(path.join(P.forced, 'forced.json')", e8f)).toBeGreaterThan(ssp);
  });
  it('EC gets CES_EC_PRINCIPAL_SECRET, EO the approver and operator secrets and the dev fallback; three distinct run-only secrets', () => {
    expect(src).toContain('CES_EC_PRINCIPAL_SECRET: ecPrincipalSecret');
    expect(src).toContain('CES_AO_PRINCIPAL_SECRET: eoApproverSecret');
    expect(src).toContain('CES_EO_OPERATOR_SECRET: eoOperatorSecret');
    expect(src).toContain("CES_EO_OPERATOR_DEV_FALLBACK: '1'");
    for (const v of ['ecPrincipalSecret', 'eoApproverSecret', 'eoOperatorSecret']) expect(src).toContain(`const ${v} = mintPrincipalSecret();`);
  });
  it('eo-reviews.json and eo-interviews.json are per-run artefacts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ns4t-out-'));
    try {
      for (const f of ['eo-reviews.json', 'eo-interviews.json', 'ec-upload-reviews.json']) fs.writeFileSync(path.join(root, f), '{}');
      const listed = perRunArtefacts(root, path.join(root, 'pl'), 'sx');
      for (const f of ['eo-reviews.json', 'eo-interviews.json', 'ec-upload-reviews.json']) expect(listed).toContain(path.join(root, f));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
