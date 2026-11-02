// FIN-29 (PH-2 harness): the E9E / E9M steps of src/flow/fin29-eo-muster.ts with fake HTTP, sim and CLI runners.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  pickDriftSeed, writesInWindow, policyReimportBody, entraMfaRecipe, lastJson, requirementResults, assessTicks,
  e9eStep, e9mStep, V120_TAMPER_SUFFIX, type HttpCall, type HttpResult, type Fin29EoMusterCtx,
} from '../src/flow/fin29-eo-muster.js';

const ok = (json: unknown, status = 200, headers: Record<string, string> = {}): HttpResult => ({ status, text: JSON.stringify(json), json, headers });
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

function makeCtx(root: string, over: Partial<Fin29EoMusterCtx> = {}): { ctx: Fin29EoMusterCtx; secrets: Map<string, string>; captures: Array<{ label: string; args: string[]; env: NodeJS.ProcessEnv }> } {
  const secrets = new Map<string, string>();
  const captures: Array<{ label: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const out = path.join(root, 'out');
  const P = {
    ws: root, pkg: path.join(root, 'pkg'), ces: path.join(root, 'ces'), out, logs: path.join(out, 'logs'), pl: path.join(root, 'pl'), tenants: path.join(root, 'tenants'),
    sim: path.join(root, 'ces', 'tenant-stacksim'), musterApi: path.join(root, 'ces', 'ces-muster', 'muster-api'), muster: path.join(root, 'ces', 'ces-muster'),
    stamper: path.join(root, 'ces', 'ces-stamper'), stamperRegistry: '', tsx: path.join(root, 'tsx.mjs'), exe: '', st: '', stCwd: '', forced: '', plansPushed: '', planDir: '',
    aoRoot: '', aoCli: '', eoRoot: path.join(root, 'ces', 'ces-eo'), registryRecord: '', mintToken: '',
  };
  const ctx: Fin29EoMusterCtx = {
    slug: 's1-mach', scenario: {}, P, urls: { sim: 'http://sim', api: 'http://api', ec: 'http://ec', eo: 'http://eo' }, node: 'node',
    log: () => undefined, rel: (p) => path.relative(root, p).split(path.sep).join('/'), nowIso: () => new Date().toISOString(),
    runCapture: async (label, _exe, args, _cwd, env) => { captures.push({ label, args, env }); return { rc: 0, stdout: '', stderr: '' }; },
    runAoCli: async () => ({ rc: 0, stdout: '', stderr: '' }),
    startBg: () => ({ pid: 1 }) as never, stopTree: () => undefined, waitHttp: async () => true, portHeld: async () => false,
    eoAuthHeaders: () => ({ Authorization: 'Bearer eo-run-token' }),
    simEnv: () => ({}), stamperEnv: () => ({}), aoEnv: () => ({}), simUp: () => true, eoUp: () => true, musterApiUp: () => true,
    musterToken: () => 'op-token-xyz', musterJwt: () => 'jwt-secret-for-tests-0123456789', registerSecret: (n, v) => { if (v) secrets.set(n, v); },
    eoEnv: () => ({ EO_PORT: '4002', STORAGE_ROOT: path.join(out, 'eo') }), ecSecret: () => 'ec-secret-abc',
    ...over,
  };
  return { ctx, secrets, captures };
}

describe('fin29-eo-muster pure helpers', () => {
  it('pickDriftSeed prefers an enabled MFA policy, else the first enabled one, else null', () => {
    const pols = [
      { id: 'p1', state: 'disabled', grantControls: { builtInControls: ['mfa'] } },
      { id: 'p2', state: 'enabled', grantControls: { builtInControls: ['block'] } },
      { id: 'p3', state: 'enabled', displayName: 'MFA all', grantControls: { builtInControls: ['mfa'] } },
    ];
    expect(pickDriftSeed(pols)?.policy_id).toBe('p3');
    expect(pickDriftSeed(pols.slice(0, 2))?.policy_id).toBe('p2');
    expect(pickDriftSeed([pols[0]])).toBeNull();
  });
  it('writesInWindow counts only writes inside the window', () => {
    const e = [
      { ts: '2026-10-31T10:00:00Z', type: 'mutate' }, { ts: '2026-10-31T10:05:00Z', type: 'read' },
      { ts: '2026-10-31T10:06:00Z', type: 'mutate' }, { ts: '2026-10-31T10:06:30Z', type: 'mutate', sessionType: 'seed' },
    ];
    expect(writesInWindow(e, '2026-10-31T10:01:00Z', '2026-10-31T10:07:00Z')).toHaveLength(1);
  });
  it('policyReimportBody re-imports one held policy unchanged (schema fields only)', () => {
    const b = policyReimportBody('s1-mach', [{ template_id: 't', title: 'T', markdown: '# m', domain: 'AC', completeness: 80, nist_controls: ['AC.L1-3.1.1'], extra: 1, id: 'x' }]);
    expect(b).toEqual({ tenantSlug: 's1-mach', policies: [{ template_id: 't', title: 'T', markdown: '# m', completeness: 80, domain: 'AC', nist_controls: ['AC.L1-3.1.1'] }] });
    expect(policyReimportBody('s1-mach', [])).toBeNull();
  });
  it('entraMfaRecipe derives the expected iam-001 answer from the sim policies', () => {
    expect(entraMfaRecipe([{ id: 'a', state: 'enabled', grantControls: { builtInControls: ['mfa'] } }]).expectedAnswer).toBe('yes');
    expect(entraMfaRecipe([{ id: 'a', state: 'disabled', grantControls: { builtInControls: ['mfa'] } }]).expectedAnswer).toBe('no');
    expect(entraMfaRecipe([]).body.recipe_name).toBe('entra-mfa-report');
  });
  it('lastJson reads pretty JSON after log noise', () => {
    expect(lastJson('seeding...\n{\n  "tenant": { "id": "t1" }\n}\n')).toEqual({ tenant: { id: 't1' } });
    expect(lastJson('no json')).toBeNull();
  });
  it('requirementResults and assessTicks', () => {
    expect(requirementResults({ controls: [{ control_id: 'A', status: 'met' }, { status: 'met' }] })).toEqual([{ requirement_id: 'A', status: 'met' }]);
    expect(assessTicks([{ mode: 'collect', at: '1' }, { mode: 'assess', at: '3' }, { mode: 'assess', at: '2' }]).map((t) => t.at)).toEqual(['2', '3']);
  });
});

describe('E9E (V119, V120, V128) with fakes', () => {
  it('waits for the first assess tick, seeds and reverts the drift, tampers and restores the EC blob, drives the routes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fin29c-'));
    const { ctx } = makeCtx(root);
    fs.mkdirSync(path.join(root, 'out', 'eo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'out', 'eo', 'x.json'), '{}');
    fs.writeFileSync(path.join(root, 'out', 'ec-upload.json'), JSON.stringify({ itemId: 'eci-1' }));
    const realBlob = path.join(root, 'pl', 'EvidenceCollector', 'storage', 's1-mach', 'items', 'eci-1.bin');
    fs.mkdirSync(path.dirname(realBlob), { recursive: true });
    fs.writeFileSync(realBlob, 'original');
    fs.writeFileSync(path.join(root, 'pl', 'ces.db'), 'live');
    // the tamper leg works on the private copy under out/e9/pl, never on the real store
    const blob = path.join(root, 'out', 'e9', 'pl', 'EvidenceCollector', 'storage', 's1-mach', 'items', 'eci-1.bin');
    const backups: string[] = [];
    let phase = 0;
    const simCalls: unknown[] = [];
    const http: HttpCall = async (method, url, o) => {
      if (url.includes('/api/collect/schedule')) {
        const t0 = { tickId: 't0', tenantSlug: 's1-mach', at: '2026-10-31T10:00:00Z', mode: 'assess', assess: { ok: true, snapshotId: 'snap0', drift: null } };
        const ticks = [t0];
        if (phase >= 1) ticks.push({ tickId: 't1', tenantSlug: 's1-mach', at: new Date(Date.now() + 1000).toISOString(), mode: 'collect', integrity: { reachable: true, newHashDrift: 1 } } as never);
        if (phase >= 2) ticks.push({ tickId: 't2', tenantSlug: 's1-mach', at: new Date(Date.now() + 2000).toISOString(), mode: 'assess', assess: { ok: true, snapshotId: 'snap1', drift: { previousSnapshotId: 'snap0', drifted: [{ controlId: 'IA.L2-3.5.3' }] } } } as never);
        if (phase >= 1) phase++;
        return ok({ enabled: true, tenants: { 's1-mach': { lastTickAt: 'x' } }, ticks });
      }
      if (url.includes('/api/index')) {
        expect(url).toBe('http://127.0.0.1:4013/api/index?tenant=s1-mach');
        expect(o?.headers?.Authorization).toBe('Bearer ec-secret-abc');
        expect(fs.readFileSync(blob, 'utf8')).toBe('original' + V120_TAMPER_SUFFIX);
        phase = 1;
        return ok({ newFindings: [{ findingId: 'f1', checkId: 'HASH_DRIFT' }] });
      }
      if (url.includes('/api/collect/integrity')) return ok([{ findingId: 'eoif-f1', ecFindingId: 'f1' }]);
      if (url.includes('/api/collect/notices')) return ok([{ kind: 'drift', tickId: 't2', action: 'operator action: re-apply the setting through Stamper or AdminOps' }]);
      if (url.includes('/api/policies?')) return ok([{ template_id: 't', title: 'T', markdown: 'm', domain: 'AC' }]);
      if (url.includes('/api/policies/import')) return ok({ imported: 1 }, 201);
      if (url.includes('/api/evidence-explorer/capture')) return ok({ capturedCount: 3, liveSignals: 'connected' });
      if (url.includes('/api/risk-assessment/snapshots/')) return ok({ error: 'nf' }, 404);
      if (url.includes('one-click')) return ok({ success: true });
      if (url.includes('render/report')) return ok({ state: 'rendered' });
      if (url.includes('/api/personnel?')) return ok([{ id: '11111111-2222-3333-4444-555555555555', status: 'active' }]);
      if (url.includes('/api/training/catalog')) return ok({ courses: [{ id: 'c1' }] });
      if (url.includes('training/email')) return ok({ emailText: 'Dear ...' });
      if (url.includes('training/certificate')) return ok({ id: 'art1', type: 'training-certificate' });
      if (url.includes('element6-form')) return { status: 200, text: '<pdf>', json: null, headers: { 'content-type': 'application/pdf', 'x-fin29-head': '%PDF-' } };
      return ok({});
    };
    const step = e9eStep(ctx, {
      http, sleep: async () => undefined, pollScale: 0.05,
      simResolve: async (_u, b) => { simCalls.push(b); return (b as { method: string }).method === 'GET' ? { value: [{ id: 'pol-1', state: 'enabled', grantControls: { builtInControls: ['mfa'] } }] } : {}; },
      queryLedger: async () => [{ ts: new Date().toISOString(), type: 'mutate' }],
      connectSse: async () => ({ rc: 0 }),
      backupDb: async (src, dest) => { backups.push(`${src} -> ${dest}`); fs.copyFileSync(src, dest); },
      countRows: () => ({ eo_assessments: 7, ec_runs: 2 }),
    });
    expect(step.fatal).toBe(false);
    expect(step.commands.join(' ')).not.toMatch(/ec-secret-abc|eo-run-token/);
    const r = await step.run();
    const rec = JSON.parse(fs.readFileSync(path.join(root, 'out', 'eo-continuous.json'), 'utf8'));
    expect(rec.seed.policy_id).toBe('pol-1');
    expect(rec.seed.reverted).toBe(true);
    expect(simCalls.filter((b) => (b as { method: string }).method === 'PATCH').map((b) => (b as { body: { state: string } }).body.state)).toEqual(['disabled', 'enabled']);
    expect(rec.tamper.restored).toBe(true);
    expect(fs.readFileSync(blob, 'utf8')).toBe('original');
    expect(fs.readFileSync(realBlob, 'utf8')).toBe('original');
    expect(rec.tamper.original_sha256).toBe(sha('original'));
    expect(backups).toEqual([`${path.join(root, 'pl', 'ces.db')} -> ${path.join(root, 'out', 'e9', 'pl', 'ces.db')}`]);
    expect(rec.private_root.copied).toEqual(['ces.db (online backup)', 'EvidenceCollector']);
    expect(rec.real_db).toMatchObject({ tenant_id: 'sim-tenant-s1-mach', changed: [] });
    expect(rec.tamper.eo_finding_ids).toEqual(['eoif-f1']);
    const routes = JSON.parse(fs.readFileSync(path.join(root, 'out', 'eo-routes.json'), 'utf8'));
    expect(routes.calls.filter((c: { ok: boolean }) => !c.ok)).toEqual([]);
    expect(r.rc).toBe(0);
    expect(fs.readFileSync(path.join(root, 'out', 'eo-continuous.json'), 'utf8')).not.toMatch(/ec-secret-abc|eo-run-token/);
  });
  it('fails when the real ces.db changed for this tenant during E9E', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fin29c-'));
    fs.mkdirSync(path.join(root, 'pl'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pl', 'ces.db'), 'live');
    let n = 0;
    const r = await e9eStep(makeCtx(root).ctx, {
      http: async () => ok({}), sleep: async () => undefined, pollScale: 0.01, connectSse: async () => ({ rc: 0 }),
      backupDb: async () => undefined, countRows: () => ({ eo_assessments: n++ === 0 ? 5 : 6 }),
    }).run();
    expect(r.rc).toBe(1);
    const rec = JSON.parse(fs.readFileSync(path.join(root, 'out', 'eo-continuous.json'), 'utf8'));
    expect(rec.real_db.changed).toEqual(['eo_assessments 5 -> 6']);
  });
  it('refuses without the sim / EO env, and when its port is held', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fin29c-'));
    expect((await e9eStep(makeCtx(root, { eoEnv: () => undefined }).ctx).run()).rc).toBe(1);
    expect((await e9eStep(makeCtx(root, { portHeld: async () => true }).ctx).run()).rc).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'out', 'eo-continuous.json'), 'utf8')).error).toMatch(/port/);
  });
});

describe('E9M (V121, V130) with fakes', () => {
  it('seeds with the password in the env only, registers every token, and keeps them out of the records', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fin29c-'));
    const apiDir = path.join(root, 'ces', 'ces-muster', 'muster-api');
    // a minimal jsonwebtoken stand-in for mintMusterToken (createRequire from muster-api/package.json)
    fs.mkdirSync(path.join(apiDir, 'node_modules', 'jsonwebtoken'), { recursive: true });
    fs.writeFileSync(path.join(apiDir, 'package.json'), '{"name":"x"}');
    fs.writeFileSync(path.join(apiDir, 'node_modules', 'jsonwebtoken', 'index.js'), 'exports.sign=(p,s)=>"jwt."+p.role+"."+s.length;');
    fs.mkdirSync(path.join(root, 'out', 'eo-package', 'p1', 'assessments'), { recursive: true });
    fs.writeFileSync(path.join(root, 'out', 'eo-package', 'p1', 'assessments', 'latest-snapshot.json'), JSON.stringify({ snapshotId: 's', sprs_score: 105, controls: [{ control_id: 'A', status: 'not_met' }] }));
    const { ctx, secrets, captures } = makeCtx(root, {
      runCapture: async (label, _e, args, _c, env) => {
        captures.push({ label, args, env });
        if (label === 'E9M-seed') return { rc: 0, stdout: JSON.stringify({ tenant: { id: 'tp1' }, user: { id: 'u1' } }, null, 2), stderr: '' };
        if (label === 'E9M-mu-collector-kit') { const f = args[args.indexOf('--out') + 1]; fs.writeFileSync(f, 'kit'); return { rc: 0, stdout: JSON.stringify({ sha256: sha('kit'), header_sha256: sha('kit') }), stderr: '' }; }
        if (label === 'E9M-mu-collector-kit-manifest') return { rc: 0, stdout: JSON.stringify({ sha256: sha('kit') }), stderr: '' };
        if (label === 'E9M-mu-recipes-ingest') return { rc: 0, stdout: JSON.stringify({ facts: [{ question_id: 'iam-001', answer: 'yes', provenance: 'captured' }] }), stderr: '' };
        return { rc: 1, stdout: '', stderr: 'Concierge session required' };
      },
    });
    let n = 0;
    const http: HttpCall = async (method, url) => {
      if (url.endsWith('/auth/login')) return ok({ token: 'login-token-777' });
      if (url.endsWith('/auth/me')) return ok({ tenant_id: 'tp1' });
      if (url.endsWith('/api/engagements')) return ok({ id: 'e1' }, 201);
      if (url.endsWith('/parties')) return ok({ id: 'p1' }, 201);
      if (url.includes('/api/hil/flag')) return ok({ id: 'h1' }, 201);
      if (url.includes('/api/hil/queue') && method === 'GET') return ok([{ id: 'h1' }]);
      if (url.endsWith('/api/contracts')) return ok({ id: 'c1' }, 201);
      if (url.includes('/api/delivery/grants')) return ok({ id: 'g1', token: 'grant-capability-999' }, 201);
      if (url.includes('/api/delivery/artifacts')) return ok({ id: 'a1' }, 201);
      if (url.includes('/api/sprs/score')) return ok({ sprs: 105 });
      if (url.endsWith('/api/discovery/run') && method === 'POST') return n++ === 0 ? ok({ id: 'j1' }, 202) : ok({ error: 'live_not_enabled' }, 403);
      if (url.includes('/api/discovery/run/j1')) return ok({ status: 'done', stats: {}, postures: [1, 2], envelope: { schema: 'x' } });
      if (url.includes('/api/harvest/run')) return n++ < 3 ? ok({ facts: [{}] }) : ok({ error: 'live_path_requires_engagement_consent' }, 403);
      if (url.includes('/api/sessions/sync')) return ok({}, 201);
      // PH-5 (V121): the reassessment tick flips the probe party (its session was completed just before).
      if (url.includes('/api/reassessment/tick')) return ok({ flipped: [{ party_id: 'p1', previous: 'complete' }] });
      if (url.includes('/api/touch/events')) return ok({}, 201);
      return ok({});
    };
    const r = await e9mStep(ctx, { http, sleep: async () => undefined, pollScale: 0.05, simResolve: async () => ({ value: [{ id: 'x', state: 'enabled', grantControls: { builtInControls: ['mfa'] } }] }) }).run();
    const seed = captures.find((c) => c.label === 'E9M-seed')!;
    expect(seed.args.join(' ')).not.toContain(secrets.get('muster_probe_password'));
    expect(seed.env.SEED_PASSWORD).toBe(secrets.get('muster_probe_password'));
    expect(captures.find((c) => c.label === 'E9M-mu-collector-kit')!.env.MU_TOKEN).toBe('op-token-xyz');
    expect([...secrets.keys()]).toEqual(expect.arrayContaining(['muster_probe_password', 'muster_probe_login_token', 'muster_probe_sub_token', 'muster_probe_operator_token', 'muster_probe_grant_token']));
    const files = ['muster-engagement.json', 'muster-surfaces.json'].map((f) => fs.readFileSync(path.join(root, 'out', f), 'utf8')).join('\n');
    for (const v of secrets.values()) expect(files).not.toContain(v);
    expect(files).not.toContain('op-token-xyz');
    const eng = JSON.parse(fs.readFileSync(path.join(root, 'out', 'muster-engagement.json'), 'utf8'));
    expect(eng.sprs).toMatchObject({ muster: 105, eo: 105 });
    expect(eng.probe).toMatchObject({ tenant_id: 'tp1', engagement_id: 'e1', party_id: 'p1', hil_item_id: 'h1', contract_id: 'c1' });
    const names = eng.calls.map((c: { name: string }) => c.name);
    expect(names.indexOf('nudge tick')).toBeLessThan(names.indexOf('session complete'));
    expect(names.indexOf('session complete')).toBeLessThan(names.indexOf('reassessment tick'));
    expect(eng.calls.find((c: { name: string }) => c.name === 'reassessment tick')).toMatchObject({ ok: true, detail: { flipped: [{ party_id: 'p1' }] } });
    const surf = JSON.parse(fs.readFileSync(path.join(root, 'out', 'muster-surfaces.json'), 'utf8'));
    expect(surf.discovery).toMatchObject({ status: 'done', live_refused_status: 403 });
    expect(surf.recipe).toMatchObject({ rc: 0, expected_answer: 'yes', no_concierge_rc: 1 });
    expect(r.rc).toBe(0);
  });
  it('refuses without E3\'s muster-api', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fin29c-'));
    expect((await e9mStep(makeCtx(root, { musterApiUp: () => false }).ctx).run()).rc).toBe(1);
  });
});
