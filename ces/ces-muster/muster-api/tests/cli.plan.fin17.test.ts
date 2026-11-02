// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// FIN-17 (audit M1): `mu plan compile`, `mu plan push` and `mu collector-kit` drive the same
// muster-api routes the harness and the SPA use. `mu recipes ingest` is covered in cli.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import { runMu, makeMemoryCredStore, planCompileBody, planPushBody, writeCompiledFiles, type MuDeps } from '../src/cli/mu.js';
import { createPlanRouter } from '../src/routes/plan.js';
import { mintToken } from '../src/lib/jwt.js';

const TOKEN = mintToken({ sub: 'mu-op', tenant_id: '00000000-0000-0000-0000-0000000000d1', party_id: null, role: 'bhd_operator' });
const FIXTURE_DIR = path.resolve(__dirname, '../../src/features/plan/__fixtures__');

function streams() {
  let out = '';
  let err = '';
  return { stdout: { write: (s: string) => { out += s; } }, stderr: { write: (s: string) => { err += s; } }, out: () => out, err: () => err };
}

function deps(fetchImpl: MuDeps['fetchImpl'], s = streams()): MuDeps & { s: ReturnType<typeof streams> } {
  return { fetchImpl, stdout: s.stdout, stderr: s.stderr, env: { MU_TOKEN: TOKEN, MU_API_URL: 'http://test.local' }, credStore: makeMemoryCredStore(), s };
}

let tmp: string;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-fin17-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('mu plan compile', () => {
  it('posts the harness-shaped body, writes every file, and prints the record without a value', async () => {
    const disc = path.join(tmp, 'disc.json');
    fs.writeFileSync(disc, '{ "manifest": {} }\n');
    const answers = path.join(tmp, 'answers.json');
    fs.writeFileSync(answers, '[]');
    let sent: { url: string; init: RequestInit } | null = null;
    const response = {
      tenant_slug: 's1', summary: 'plan_files=1 recurring_items=0', initial_password_ref: 'secretref:one-time:abc',
      initial_password_terms: { max_reads: 2, expires_at: '2026-10-31T23:00:00.000Z' },
      recurring_cost_notice: null, eo_interviews: { status: 'not_configured' },
      files: [
        { name: 'manual-mission-plan-s1-T.json', encoding: 'utf8', content: '{"a":1}' },
        { name: 'policies/p.docx', encoding: 'base64', content: Buffer.from([1, 2, 3]).toString('base64') },
      ],
    };
    const d = deps(async (url, init = {}) => {
      sent = { url, init };
      return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const out = path.join(tmp, 'plan');
    const code = await runMu(['plan', 'compile', '--slug', 's1', '--discovery', disc, '--answers', answers, '--stacks', 'a,b', '--max-reads', '2', '--out', out], d);
    expect(code).toBe(0);
    expect(sent!.url).toBe('http://test.local/api/plan/compile');
    expect(sent!.init.method).toBe('POST');
    expect(JSON.parse(sent!.init.body as string)).toEqual({ tenant_slug: 's1', discovery: '{ "manifest": {} }\n', interview_answers: '[]', stacks: ['a', 'b'], max_reads: 2 });
    expect(fs.readFileSync(path.join(out, 'manual-mission-plan-s1-T.json'), 'utf8')).toBe('{"a":1}');
    expect([...fs.readFileSync(path.join(out, 'policies', 'p.docx'))]).toEqual([1, 2, 3]);
    const rec = JSON.parse(d.s.out());
    expect(rec.initial_password_terms.max_reads).toBe(2);
    expect(rec.eo_interviews).toEqual({ status: 'not_configured' });
    expect(rec.files[0]).toEqual({ name: 'manual-mission-plan-s1-T.json', bytes: 7, sha256: crypto.createHash('sha256').update('{"a":1}').digest('hex') });
    expect(d.s.out()).not.toMatch(/"value"/);
  });

  it('missing flags exit 1; a 422 compile exits 1 with the error on stderr', async () => {
    expect(await runMu(['plan', 'compile', '--slug', 's1'], deps(async () => new Response('{}')))).toBe(1);
    const disc = path.join(tmp, 'disc2.json');
    fs.writeFileSync(disc, '{}');
    const d = deps(async () => new Response(JSON.stringify({ error: 'plan compile failed' }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
    expect(await runMu(['plan', 'compile', '--slug', 's1', '--discovery', disc, '--out', path.join(tmp, 'p2')], d)).toBe(1);
    expect(d.s.err()).toMatch(/plan compile failed/);
  });

  // PH-7 (V114): with no --stacks / --tenant-harvest, the body carries MX_STACKS / MX_TENANT_HARVEST exactly as
  // the harness's plan-compile.mjs sends them (S3 rounds set MX_STACKS=m365_e5_gcc,microsoft_intune); flags win.
  it('--stacks and --tenant-harvest default to MX_STACKS and MX_TENANT_HARVEST; the flags win', async () => {
    const disc = path.join(tmp, 'disc3.json');
    fs.writeFileSync(disc, '{}');
    const ok = { files: [{ name: 'f.json', encoding: 'utf8', content: '{}' }] };
    const run = async (args: string[], extraEnv: Record<string, string>) => {
      let body: Record<string, unknown> | null = null;
      const d = deps(async (_url, init = {}) => {
        body = JSON.parse(init.body as string);
        return new Response(JSON.stringify(ok), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      d.env = { ...d.env, ...extraEnv };
      expect(await runMu(['plan', 'compile', '--slug', 's3', '--discovery', disc, '--out', path.join(tmp, `p-${crypto.randomUUID()}`), ...args], d)).toBe(0);
      return body!;
    };
    const fromEnv = await run([], { MX_STACKS: 'm365_e5_gcc, microsoft_intune', MX_TENANT_HARVEST: 'off' });
    expect(fromEnv.stacks).toEqual(['m365_e5_gcc', 'microsoft_intune']);
    expect(fromEnv.tenant_harvest).toBe('off');
    const flagsWin = await run(['--stacks', 'm365_e5_gcc', '--tenant-harvest', 'on'], { MX_STACKS: 'm365_e5_gcc,microsoft_intune', MX_TENANT_HARVEST: 'off' });
    expect(flagsWin.stacks).toEqual(['m365_e5_gcc']);
    expect(flagsWin.tenant_harvest).toBeUndefined();
    const none = await run([], {});
    expect(none.stacks).toBeUndefined();
    expect(none.tenant_harvest).toBeUndefined();
  });

  it('planCompileBody matches the harness compileBody shape; writeCompiledFiles refuses an escaping name', () => {
    expect(planCompileBody({ slug: 's', discoveryText: 'd', tenantHarvest: 'off', stacks: [] })).toEqual({ tenant_slug: 's', discovery: 'd', tenant_harvest: 'off' });
    expect(() => writeCompiledFiles(path.join(tmp, 'w'), [{ name: '../escape.json', content: 'x' }])).toThrow(/outside the plan folder/);
  });
});

describe('mu plan push (against the real plan router)', () => {
  let server: http.Server;
  let base: string;
  let pipe: string;
  const plans = () => path.join(tmp, 'plans-push');

  beforeAll(() => {
    pipe = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-fin17-pipe-'));
    process.env.CES_PIPELINE_ROOT = pipe;
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api/plan', createPlanRouter());
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    fs.mkdirSync(path.join(plans(), 'policies'), { recursive: true });
    fs.copyFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), path.join(plans(), 'manual-mission-plan-mu-s1-T1.json'));
    fs.copyFileSync(path.join(FIXTURE_DIR, 'tenant-manifest.json'), path.join(plans(), 'tenant-manifest-mu-s1-T1.json'));
    fs.writeFileSync(path.join(plans(), 'policies', 'access-control-policy.md'), '# AC\n');
  });
  afterAll(() => {
    server?.close();
    fs.rmSync(pipe, { recursive: true, force: true });
    delete process.env.CES_PIPELINE_ROOT;
  });

  it('pushes the newest MP and TM; the response is written to --out; Stamper has the same bytes', async () => {
    const s = streams();
    const outFile = path.join(tmp, 'push-response.json');
    const code = await runMu(['--api-url', base, 'plan', 'push', '--slug', 'mu-s1', '--plans', plans(), '--out', outFile], {
      stdout: s.stdout, stderr: s.stderr, env: { MU_TOKEN: TOKEN }, credStore: makeMemoryCredStore(),
    });
    expect(code).toBe(0);
    const res = JSON.parse(fs.readFileSync(outFile, 'utf8')) as { pushed: string[]; eo_intake: { status: string } };
    expect(res.pushed).toHaveLength(2);
    expect(res.eo_intake.status).toBe('not_configured');
    const stored = JSON.parse(fs.readFileSync(path.join(pipe, 'Stamper', 'plan-data', 'mu-s1', 'plans', res.pushed[0]!), 'utf8'));
    expect(stored).toEqual(JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manual-mission-plan.json'), 'utf8')));
  });

  it('planPushBody: --with-policies adds the policy texts; --override-reason adds the audited override', () => {
    const b = planPushBody(plans(), 'mu-s1', { withPolicies: true, overrideReason: ' operator accepted ' });
    expect(b.policies).toEqual([{ name: 'policies/access-control-policy.md', markdown: '# AC\n' }]);
    expect(b.validationOverride).toEqual({ reason: 'operator accepted' });
    expect(Object.keys(planPushBody(plans(), 'mu-s1'))).toEqual(['tenant_slug', 'missionPlan', 'tenantManifest']);
    expect(() => planPushBody(tmp, 'x')).toThrow(/no manual-mission-plan/);
  });
});

describe('mu collector-kit', () => {
  const script = '# muster collector kit\nWrite-Output 1\n';
  const sha = crypto.createHash('sha256').update(script).digest('hex');

  it('writes the kit and checks the X-Collector-Kit-Sha256 header', async () => {
    let url = '';
    const d = deps(async (u) => {
      url = u;
      return new Response(script, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Collector-Kit-Sha256': sha } });
    });
    const out = path.join(tmp, 'kit.ps1');
    expect(await runMu(['collector-kit', '--out', out], d)).toBe(0);
    expect(url).toBe('http://test.local/api/recipes/collector-kit');
    expect(fs.readFileSync(out, 'utf8')).toBe(script);
    expect(JSON.parse(d.s.out())).toMatchObject({ file: out, sha256: sha, header_sha256: sha });
  });

  it('a header that does not match the body is refused (exit 1, no file)', async () => {
    const d = deps(async () => new Response(script, { status: 200, headers: { 'Content-Type': 'text/plain', 'X-Collector-Kit-Sha256': '0'.repeat(64) } }));
    const out = path.join(tmp, 'kit-bad.ps1');
    expect(await runMu(['collector-kit', '--out', out], d)).toBe(1);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('--manifest prints the manifest JSON', async () => {
    let url = '';
    const d = deps(async (u) => {
      url = u;
      return new Response(JSON.stringify({ sha256: sha }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    expect(await runMu(['collector-kit', '--manifest'], d)).toBe(0);
    expect(url).toBe('http://test.local/api/recipes/collector-kit/manifest');
    expect(JSON.parse(d.s.out())).toEqual({ sha256: sha });
  });
});
