// FIN-29 (finishing plan PH-2 harness): src/flow/fin29-ao.ts (E9A, V127) with a fake MCP server, a fake AO CLI and a
// fake fetch. Temp folders only; no AO, MCP or simulator process is started.
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import {
  E9A_WEB_PORT,
  V127_L1_SLUG,
  V127_LIVE_SLUG,
  e9aStep,
  l1ProbeRecord,
  liveProbeRecord,
  mcpClientOver,
  mcpToolData,
  parseListCount,
  pickProbeOps,
  railFromExec,
} from '../src/flow/fin29-ao.js';
import { FIN29_FILES, type Fin29StepCtx } from '../src/flow/fin29-common.js';

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));
const AO_ROOT = path.resolve('..', 'ces-ao');
const REG = JSON.parse(fs.readFileSync(path.join(AO_ROOT, 'src', 'registry', 'ao-commands.registry.json'), 'utf8'));

/** A fake AO MCP server: answers initialize, tools/list and the four tools the step calls. */
function fakeMcp(): ChildProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill: () => true, pid: undefined, exitCode: 0, signalCode: null }) as unknown as ChildProcess;
  let buf = '';
  stdin.on('data', (d) => {
    buf += String(d);
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const m = JSON.parse(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (m.id === undefined) continue;
      const send = (result: unknown) => stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
      const text = (data: unknown) => send({ content: [{ type: 'text', text: JSON.stringify(data) }] });
      if (m.method === 'initialize') send({ serverInfo: { name: 'ces-adminops' } });
      else if (m.method === 'tools/list') send({ tools: ['ao_list_commands', 'ao_get_command', 'ao_execute', 'ao_approvals', 'ao_approve'].map((name) => ({ name, inputSchema: { properties: name === 'ao_execute' ? { strictCmmc: {} } : {} } })) });
      else if (m.params.name === 'ao_list_commands') text(REG.map((c: { id: string }) => ({ id: c.id })));
      else if (m.params.name === 'ao_get_command') text({ id: m.params.arguments.commandId });
      else if (m.params.name === 'ao_execute') {
        const live = m.params.arguments.dryRun === false;
        text({ mode: 'DRY_RUN', ...(live ? { liveApplyBlocked: 'requested dryRun:false was overridden to true' } : {}), result: { success: true, evidencePath: 'adminops_evidence/A-08:mcp', evidence: { outcome: 'dry_run', metadata: { twoPersonApproval: { mode: 'off' } } } } });
      }
    }
  });
  return child;
}

const execJson = (outcome: string, mode?: 'on' | 'off') => ({
  rc: 0,
  stderr: '',
  stdout: JSON.stringify({ success: false, error: outcome, evidencePersisted: true, evidencePath: `adminops_evidence/A-08:${outcome}`, evidence: { outcome, metadata: mode ? { twoPersonApproval: { mode } } : {} } }, null, 2),
});

function ctxFor(ws: string, over: Partial<Fin29StepCtx> = {}): Fin29StepCtx {
  const out = path.join(ws, 'out');
  fs.mkdirSync(path.join(out, 'logs'), { recursive: true });
  const rec = path.join(ws, 'tenants', 'sim', 's1-mach.json');
  fs.mkdirSync(path.dirname(rec), { recursive: true });
  fs.writeFileSync(rec, JSON.stringify({ kind: 'sim', client: { slug: 's1-mach' }, tenant: { tenant_id: 'sim-tenant-s1-mach', domain: 's1-mach.simtenant.onmicrosoft.us' }, auth: { app_id: 'a', cert_path: 'c', cert_thumbprint: 't' }, endpoints: { graph: 'http://localhost:4390/graph' }, resources: { operator_upn: 'op@s1-mach.simtenant.onmicrosoft.us' } }));
  const P = { ws, pkg: ws, ces: path.resolve('..'), out, logs: path.join(out, 'logs'), pl: path.join(ws, 'pl'), tenants: path.join(ws, 'tenants'), sim: ws, musterApi: ws, muster: ws, stamper: ws, stamperRegistry: ws, tsx: ws, exe: ws, st: ws, stCwd: ws, forced: ws, plansPushed: ws, planDir: ws, aoRoot: AO_ROOT, aoCli: path.join(AO_ROOT, 'dist', 'cli', 'index.js'), eoRoot: ws, registryRecord: rec, mintToken: ws };
  return {
    slug: 's1-mach', scenario: {}, P, urls: { sim: 'http://127.0.0.1:1', api: '', ec: '', eo: '' }, node: process.execPath, log: () => undefined,
    rel: (p) => path.relative(ws, p).split(path.sep).join('/'), nowIso: () => new Date().toISOString(),
    runCapture: async () => ({ rc: 0, stdout: '', stderr: '' }),
    runAoCli: async (a) => {
      if (a[0] === 'list') return { rc: 0, stdout: JSON.stringify(REG.map((c: { id: string }) => ({ id: c.id })), null, 2), stderr: '' };
      if (a[0] === 'show') return { rc: 0, stdout: JSON.stringify({ id: a[1] }, null, 2), stderr: '' };
      if (a[0] === 'approvals') return { rc: 0, stdout: 'No pending approvals.', stderr: '' };
      return execJson(a.includes(V127_LIVE_SLUG) ? 'denied_sim_only' : 'denied_cmmc');
    },
    startBg: () => ({ pid: undefined, exitCode: null, signalCode: null }) as unknown as ChildProcess,
    stopTree: () => undefined, waitHttp: async () => true, portHeld: async (p) => p === E9A_WEB_PORT, eoAuthHeaders: () => ({}),
    simEnv: () => ({}), stamperEnv: () => ({}), aoEnv: () => ({ CES_TENANT_ROOT: path.join(ws, 'tenants'), AO_MCP_ALLOW_APPLY: '1' }),
    simUp: () => true, eoUp: () => true, musterApiUp: () => true, musterToken: () => undefined, musterJwt: () => undefined, registerSecret: () => undefined,
    ...over,
  };
}

describe('probe records and picks', () => {
  it('the live probe is kind live with .invalid endpoints; the L1 probe is a re-scoped sim record ces-tenant accepts', () => {
    const base = { kind: 'sim', client: { slug: 's1-mach' }, tenant: { tenant_id: 't', domain: 'd' }, auth: { app_id: 'a', cert_path: 'c', cert_thumbprint: 'x' }, resources: { operator_upn: 'o' } };
    const live = liveProbeRecord(base) as any;
    expect(live.kind).toBe('live');
    expect(Object.values(live.endpoints).every((u) => /\.invalid$/.test(String(u)) || u === 'O365USGovGCCHigh')).toBe(true);
    const l1 = l1ProbeRecord(base) as any;
    expect(l1).toMatchObject({ kind: 'sim', cmmc_level: 'L1', cmmc_migration_exempt: false, cui_boundary: { resource_allowlist: [] } });
    expect(l1.client.slug).toBe(V127_L1_SLUG);
    expect(l1.tenant.tenant_id).not.toBe('t');
  });
  it('picks A-08 (read, L2) and A-18 (write) from the real registry', () => {
    expect(pickProbeOps(REG)).toEqual({ read: 'A-08', l2: 'A-08', write: 'A-18' });
  });
  it('parses list output, MCP text content and exec refusals', () => {
    expect(parseListCount('noise\n[\n {"id":"A"},{"id":"B"}\n]')).toBe(2);
    expect(mcpToolData({ result: { content: [{ text: '{"a":1}' }] } }).data).toEqual({ a: 1 });
    expect(mcpToolData({ result: { isError: true, content: [{ text: 'error: x' }] } }).error).toBe('error: x');
    const r = railFromExec('sim_only', 'x', 'A-08', execJson('denied_sim_only'));
    expect(r).toMatchObject({ outcome: 'denied_sim_only', success: false, evidence_row_id: 'A-08:denied_sim_only', two_person_mode: null });
  });
  it('the MCP client matches answers by id', async () => {
    const c = mcpClientOver(fakeMcp());
    const r = await c.request('initialize', {});
    expect(r.result.serverInfo.name).toBe('ces-adminops');
  });
});

describe('e9aStep', () => {
  it('writes ao-surfaces.json: MCP, CLI, the two CLI rails on the private root, and the 428 on the next free port', async () => {
    const ws = tmp('fin29-e9a-');
    const envRoots: string[] = [];
    let mcpEnv: NodeJS.ProcessEnv | undefined;
    let bgEnv: NodeJS.ProcessEnv | undefined;
    let posted: { url: string; body: any; auth: string } | undefined;
    const base = ctxFor(ws);
    const ctx = ctxFor(ws, {
      runAoCli: async (a, e, l) => { envRoots.push(`${a[0]}:${e.CES_TENANT_ROOT}`); return base.runAoCli(a, e, l); },
      startBg: (_n, _e, args, _c, env) => { bgEnv = env; return { pid: undefined, exitCode: null, signalCode: null, args } as unknown as ChildProcess; },
    });
    const fetchFn = (async (url: string, init: RequestInit) => {
      posted = { url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).Authorization) };
      return new Response(JSON.stringify({ success: false, applyGuard: 'refused', evidencePersisted: true, evidencePath: 'adminops_evidence/A-18:guard', evidence: { outcome: 'failed', metadata: { twoPersonApproval: { mode: 'off' } } } }), { status: 428 });
    }) as unknown as typeof fetch;
    const step = e9aStep(ctx, { spawnMcp: (env) => { mcpEnv = env; return fakeMcp(); }, fetchFn });
    expect(step.fatal).toBe(false);
    const r = await step.run();
    const rec = JSON.parse(fs.readFileSync(path.join(ctx.P.out, FIN29_FILES.aoSurfaces), 'utf8'));
    expect(rec.schema).toBe('ces-tester/ao-surfaces@1');
    expect(rec.mcp).toMatchObject({ ran: true, list_count: REG.length, get_command_id: 'A-08', strict_cmmc_in_schema: true, dry_run: { mode: 'DRY_RUN', success: true, outcome: 'dry_run', two_person_mode: 'off' }, apply_blocked: { mode: 'DRY_RUN', live_apply_blocked: true } });
    expect(mcpEnv?.AO_MCP_ALLOW_APPLY).toBeUndefined();
    expect(rec.cli).toMatchObject({ list: { rc: 0, count: REG.length }, show: { rc: 0, id: 'A-08' }, approvals: { rc: 0 } });
    expect(rec.rails.map((x: { rail: string }) => x.rail)).toEqual(['sim_only', 'cmmc_scope', 'web_apply_guard']);
    expect(rec.rails[0].tenant).toBe(V127_LIVE_SLUG);
    expect(rec.rails[1].tenant).toBe(V127_L1_SLUG);
    const probeRoot = path.join(ctx.P.out, 'ao-surfaces', 'tenants');
    expect(envRoots.filter((x) => x.startsWith('exec:'))).toEqual([`exec:${probeRoot}`, `exec:${probeRoot}`]);
    expect(fs.existsSync(path.join(probeRoot, 'live', `${V127_LIVE_SLUG}.json`))).toBe(true);
    // 4014 is held: the next port is used; the token travels in the env and the header, never argv or the record
    expect(rec.web.port).toBe(E9A_WEB_PORT + 1);
    expect(posted?.url).toBe(`http://127.0.0.1:${E9A_WEB_PORT + 1}/api/execute/A-18`);
    expect(posted?.body).toMatchObject({ tenant: 's1-mach', dryRun: false });
    expect(posted?.body.confirmApply).toBeUndefined();
    expect(posted?.auth).toBe(`Bearer ${bgEnv?.CES_AO_AUTH_TOKEN}`);
    expect(bgEnv?.CES_NO_OPEN).toBe('1');
    expect(JSON.stringify(rec)).not.toContain(String(bgEnv?.CES_AO_AUTH_TOKEN));
    expect(rec.rails[2]).toMatchObject({ http: 428, evidence_row_id: 'A-18:guard', two_person_mode: 'off' });
    expect(r.rc).toBe(0);
  });
  it('refuses without the AO env', async () => {
    const r = await e9aStep(ctxFor(tmp('fin29-e9a-'), { aoEnv: () => undefined })).run();
    expect(r.rc).toBe(1);
  });
});
