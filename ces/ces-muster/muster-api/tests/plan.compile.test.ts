// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Gap closure API-3a + FLOW-5 (a): POST /api/plan/compile and POST /api/plan/secrets/resolve.
// The compile worker is replaced by a stand-in vite-node.mjs under CES_MUSTER_ROOT that behaves
// like scripts/mx/plan-from-discovery.ts at its edges (env in; files, MX_SUMMARY, MX_RESULT out),
// so the real spawn path of planCompileService runs.
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import { createPlanRouter } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';
import { ISSUED_REF_TRACE, validateCompileInput } from '../src/services/planCompileService.js';
import {
  clearIssuedSecrets,
  effectiveMaxReads,
  generateInitialPasswordValue,
  issueInitialPassword,
  PASSWORD_ALPHABET,
  resolveIssuedSecret,
} from '../src/services/initialPasswordIssuer.js';
import { musterCallLogPath } from '../src/routes/plan.js';

const FAKE_RUNNER = `
import fs from 'node:fs';
import path from 'node:path';
const mode = process.env.FAKE_COMPILE_MODE ?? 'ok';
if (mode === 'fail') { process.stderr.write('plan-from-discovery failed: plan validation blocks this plan\\n'); process.exit(1); }
const out = process.env.MX_OUT;
fs.mkdirSync(path.join(out, 'policies'), { recursive: true });
const seen = {};
for (const k of ['MX_DISCOVERY', 'MX_SLUG', 'MX_STACKS', 'MX_ORG_CONTENT', 'MX_ANSWERS', 'MX_TENANT_HARVEST', 'MX_INITIAL_PASSWORD_REF']) seen[k] = process.env[k] ?? null;
seen.discovery_text = fs.readFileSync(process.env.MX_DISCOVERY, 'utf8');
fs.writeFileSync(path.join(out, 'manual-mission-plan-' + process.env.MX_SLUG + '-T.json'), JSON.stringify({ seen }, null, 2));
fs.writeFileSync(path.join(out, 'policies', 'p.md'), '# policy\\n');
fs.writeFileSync(path.join(out, 'policies', 'p.docx'), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]));
const issued = mode !== 'not-sim' && process.env.MX_INITIAL_PASSWORD_REF;
const trace = { initial_password_ref: issued ? ${JSON.stringify(ISSUED_REF_TRACE)} : null };
process.stdout.write('MX_SUMMARY plan_files=1 policies=1\\n');
if (mode === 'cost') process.stdout.write('MX_COST_NOTICE AZ-LAW-001 Log Analytics workspace ~$2.30-$46/month\\n');
process.stdout.write('MX_RESULT ' + JSON.stringify({ files: {}, trace }) + '\\n');
`;

let server: http.Server;
let base: string;
let root: string;
let pipelineRoot: string;
const callLog = (slug: string): Array<Record<string, any>> =>
  fs.existsSync(musterCallLogPath(slug))
    ? fs.readFileSync(musterCallLogPath(slug), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l))
    : [];

const tok = (tenant_id: string, role = 'bhd_operator') => mintToken({ sub: 'op', tenant_id, party_id: null, role: role as 'bhd_operator' });
const T1 = tok('00000000-0000-0000-0000-0000000000a1');
const T2 = tok('00000000-0000-0000-0000-0000000000a2');

async function post(p: string, body: unknown, token?: string) {
  const res = await fetch(`${base}/api/plan${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-compile-'));
  fs.mkdirSync(path.join(root, 'node_modules', 'vite-node'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'vite-node', 'vite-node.mjs'), FAKE_RUNNER);
  process.env.CES_MUSTER_ROOT = root;
  // FIN-17: the call record lands under the pipeline root; keep it in a temp folder.
  pipelineRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-plan-compile-pipe-'));
  process.env.CES_PIPELINE_ROOT = pipelineRoot;
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/plan', createPlanRouter());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server?.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(pipelineRoot, { recursive: true, force: true });
  delete process.env.CES_MUSTER_ROOT;
  delete process.env.CES_PIPELINE_ROOT;
  delete process.env.FAKE_COMPILE_MODE;
});

beforeEach(() => {
  delete process.env.FAKE_COMPILE_MODE;
  clearIssuedSecrets();
});

const DISC = '{\n  "manifest": { "tenant": { "slug": "s1", "kind": "sim" } }\n}\n';

describe('POST /api/plan/compile (API-3a)', () => {
  test('401 without a token; 403 for a read-only role; 400 on a bad body', async () => {
    expect((await post('/compile', { tenant_slug: 's1', discovery: DISC })).status).toBe(401);
    expect((await post('/compile', { tenant_slug: 's1', discovery: DISC }, tok('t', 'assessor_read_only'))).status).toBe(403);
    expect((await post('/compile', { tenant_slug: 'Bad Slug', discovery: DISC }, T1)).status).toBe(400);
    expect((await post('/compile', { tenant_slug: 's1' }, T1)).status).toBe(400);
    expect((await post('/compile', { tenant_slug: 's1', discovery: DISC, stacks: ['x y'] }, T1)).status).toBe(400);
  });

  test('returns every output file (text utf8, binary base64), the summary and the trace; the worker gets only the request\'s inputs', async () => {
    process.env.MX_STACKS = 'inherited_should_not_pass';
    try {
      const r = await post('/compile', { tenant_slug: 's1', discovery: DISC, stacks: ['m365_e5_gcc', 'microsoft_intune'], interview_answers: '[]', org_content: { simulation: {} } }, T1);
      expect(r.status).toBe(200);
      expect(r.body.summary).toBe('plan_files=1 policies=1');
      expect(r.body.files.map((f: { name: string }) => f.name)).toEqual(['manual-mission-plan-s1-T.json', 'policies/p.docx', 'policies/p.md']);
      const docx = r.body.files.find((f: { name: string }) => f.name === 'policies/p.docx');
      expect(docx.encoding).toBe('base64');
      expect(Buffer.from(docx.content, 'base64')).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]));
      const mp = JSON.parse(r.body.files[0].content);
      expect(mp.seen.MX_STACKS).toBe('m365_e5_gcc,microsoft_intune');
      expect(mp.seen.MX_SLUG).toBe('s1');
      expect(mp.seen.discovery_text).toBe(DISC); // the discovery text reaches the runner byte for byte
      expect(mp.seen.MX_TENANT_HARVEST).toBeNull();
      expect(path.basename(mp.seen.MX_ANSWERS)).toBe('interview-answers.json');
      expect(mp.seen.MX_INITIAL_PASSWORD_REF).toMatch(/^secretref:one-time:[0-9a-f-]{36}$/);
      expect(r.body.initial_password_ref).toBe(mp.seen.MX_INITIAL_PASSWORD_REF);
      expect(r.body.trace.initial_password_ref).toBe(ISSUED_REF_TRACE);
      // FLOW-5 (a): the response carries the reference, never a password value.
      expect(JSON.stringify(r.body)).not.toMatch(/"value"/);
    } finally {
      delete process.env.MX_STACKS;
    }
  });

  test('a failing compile answers 422 with the runner\'s error', async () => {
    process.env.FAKE_COMPILE_MODE = 'fail';
    const r = await post('/compile', { tenant_slug: 's1', discovery: DISC }, T1);
    expect(r.status).toBe(422);
    expect(r.body.detail).toMatch(/plan validation blocks/);
  });
});

describe('POST /api/plan/secrets/resolve (FLOW-5 a)', () => {
  test('the issued reference resolves for the issuing tenant and slug only', async () => {
    const c = await post('/compile', { tenant_slug: 's1', discovery: DISC, max_reads: 2 }, T1);
    const ref = c.body.initial_password_ref as string;
    expect(c.body.initial_password_terms.max_reads).toBe(2);
    const ok = await post('/secrets/resolve', { tenant_slug: 's1', ref }, T1);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.body.variable).toBe('initialPassword');
    expect(ok.body.value).toMatch(/^[A-Za-z0-9._-]{24}$/);
    expect((await post('/secrets/resolve', { tenant_slug: 's1', ref }, T2)).status).toBe(404); // a wrong tenant uses no read
    expect((await post('/secrets/resolve', { tenant_slug: 's1', ref }, T1)).body.value).toBe(ok.body.value); // E6 and E8F both resolve
    expect((await post('/secrets/resolve', { tenant_slug: 's2', ref }, T1)).status).toBe(404);
    expect((await post('/secrets/resolve', { tenant_slug: 's1', ref: 'secretref:one-time:00000000-0000-0000-0000-000000000000' }, T1)).status).toBe(404);
    expect((await post('/secrets/resolve', { tenant_slug: 's1', ref }, tok('00000000-0000-0000-0000-0000000000a1', 'prime'))).status).toBe(403);
  });

  test('a compile that did not use the reference (not a sim plan) or failed leaves nothing to resolve', async () => {
    process.env.FAKE_COMPILE_MODE = 'not-sim';
    const c = await post('/compile', { tenant_slug: 's1', discovery: DISC }, T1);
    expect(c.status).toBe(200);
    expect(c.body.initial_password_ref).toBeNull();
  });
});

describe('planCompileService helpers', () => {
  test('validateCompileInput accepts text or objects', () => {
    expect(validateCompileInput({ tenant_slug: 's1', discovery: { a: 1 } }).ok).toBe(true);
    expect(validateCompileInput({ tenant_slug: 's1', discovery: '  ' }).ok).toBe(false);
    expect(validateCompileInput({ tenant_slug: 's1', discovery: DISC, tenant_harvest: 'maybe' }).ok).toBe(false);
  });

  test('generated values use the harness-safe alphabet with every class', () => {
    for (let i = 0; i < 50; i++) {
      const v = generateInitialPasswordValue();
      expect(v).toHaveLength(24);
      expect([...v].every((ch) => PASSWORD_ALPHABET.includes(ch))).toBe(true);
      expect(/[A-Z]/.test(v) && /[a-z]/.test(v) && /[0-9]/.test(v) && /[-_.]/.test(v)).toBe(true);
    }
  });
});

describe('SP-7: read budget and expiry (FIN-17)', () => {
  const A = '00000000-0000-0000-0000-0000000000a1';

  test('default budget is 1: the first read succeeds, the next answers like an unknown reference', async () => {
    const c = await post('/compile', { tenant_slug: 's1', discovery: DISC }, T1);
    expect(c.body.initial_password_terms.max_reads).toBe(1);
    const ref = c.body.initial_password_ref as string;
    expect((await post('/secrets/resolve', { tenant_slug: 's1', ref }, T1)).status).toBe(200);
    const again = await post('/secrets/resolve', { tenant_slug: 's1', ref }, T1);
    const unknown = await post('/secrets/resolve', { tenant_slug: 's1', ref: 'secretref:one-time:00000000-0000-0000-0000-000000000000' }, T1);
    expect(again.status).toBe(404);
    expect(again.body).toEqual(unknown.body); // the same 404: nothing says the reference ever existed
  });

  test('max_reads 2 allows exactly two reads (E6, E8F); the third gets 404', async () => {
    const c = await post('/compile', { tenant_slug: 's1', discovery: DISC, max_reads: 2 }, T1);
    const ref = c.body.initial_password_ref as string;
    expect((await post('/secrets/resolve', { tenant_slug: 's1', ref }, T1)).status).toBe(200);
    expect((await post('/secrets/resolve', { tenant_slug: 's1', ref }, T1)).status).toBe(200);
    expect((await post('/secrets/resolve', { tenant_slug: 's1', ref }, T1)).status).toBe(404);
    // The read counter (no value) is in Muster's call record; the compile line carries the terms.
    const lines = callLog('s1');
    const reads = lines.filter((l) => l.event === 'secret_read' && l.ref === ref);
    expect(reads.map((l) => [l.read, l.max_reads])).toEqual([[1, 2], [2, 2]]);
    expect(JSON.stringify(lines)).not.toMatch(/"value"/);
    const compileLine = lines.filter((l) => l.event === 'eo_interviews' && l.initial_password?.ref === ref);
    expect(compileLine).toHaveLength(1);
    expect(compileLine[0].initial_password.max_reads).toBe(2);
  });

  test('max_reads outside 1..3 is a 400; a release build caps the budget at 1', async () => {
    expect((await post('/compile', { tenant_slug: 's1', discovery: DISC, max_reads: 4 }, T1)).status).toBe(400);
    expect((await post('/compile', { tenant_slug: 's1', discovery: DISC, max_reads: 0 }, T1)).status).toBe(400);
    expect((await post('/compile', { tenant_slug: 's1', discovery: DISC, max_reads: 1.5 }, T1)).status).toBe(400);
    expect(effectiveMaxReads(3, {})).toBe(3);
    expect(effectiveMaxReads(undefined, {})).toBe(1);
    expect(effectiveMaxReads(3, { CES_RELEASE_BUILD: '1' })).toBe(1);
    const ref = issueInitialPassword('s1', A, { maxReads: 3, env: { CES_RELEASE_BUILD: '1' } });
    expect(resolveIssuedSecret(ref, 's1', A)).not.toBeNull();
    expect(resolveIssuedSecret(ref, 's1', A)).toBeNull();
  });

  test('an expired reference answers null (404) even with reads left, and is deleted', () => {
    const t0 = Date.parse('2026-10-31T12:00:00Z');
    const ref = issueInitialPassword('s1', A, { maxReads: 2, now: t0 });
    expect(resolveIssuedSecret(ref, 's1', A, t0 + 60_000)?.read).toBe(1);
    expect(resolveIssuedSecret(ref, 's1', A, t0 + 2 * 60 * 60 * 1000)).toBeNull(); // the default 2 h expiry
    expect(resolveIssuedSecret(ref, 's1', A, t0 + 120_000)).toBeNull(); // deleted, not just refused
  });
});

describe('FIN-17 / CG-8: the runner cost-notice lines reach the compile response', () => {
  test('MX_COST_NOTICE lines are returned as cost_notice_lines (none when the runner prints none)', async () => {
    process.env.FAKE_COMPILE_MODE = 'cost';
    const c = await post('/compile', { tenant_slug: 's1', discovery: DISC }, T1);
    expect(c.body.cost_notice_lines).toEqual(['MX_COST_NOTICE AZ-LAW-001 Log Analytics workspace ~$2.30-$46/month']);
    delete process.env.FAKE_COMPILE_MODE;
    expect((await post('/compile', { tenant_slug: 's1', discovery: DISC }, T1)).body.cost_notice_lines).toEqual([]);
  });
});

describe('FIN-17: the interview-record send outcome is recorded', () => {
  test('the compile appends one eo_interviews line with the send status', async () => {
    const before = callLog('rec-slug').length;
    const c = await post('/compile', { tenant_slug: 'rec-slug', discovery: DISC, interview_answers: '[]' }, T1);
    expect(c.status).toBe(200);
    const lines = callLog('rec-slug').slice(before);
    expect(lines.map((l) => l.event)).toEqual(['eo_interviews']);
    expect(lines[0].status).toBe(c.body.eo_interviews.status);
  });

  test('a slug owned by another tenant gets no line (the response still carries the outcome)', async () => {
    const slug = 'owned-elsewhere';
    const owner = path.join(pipelineRoot, 'Stamper', 'plan-data', slug, 'state', 'muster-owner.json');
    fs.mkdirSync(path.dirname(owner), { recursive: true });
    fs.writeFileSync(owner, JSON.stringify({ tenant_id: '00000000-0000-0000-0000-0000000000ff' }));
    expect(path.dirname(musterCallLogPath(slug))).toBe(path.dirname(owner));
    const c = await post('/compile', { tenant_slug: slug, discovery: DISC }, T1);
    expect(c.status).toBe(200);
    expect(c.body.eo_interviews).toBeDefined();
    expect(callLog(slug)).toEqual([]);
  });
});
