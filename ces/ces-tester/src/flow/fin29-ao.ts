// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-29 (finishing plan PH-2 harness): step E9A, AO's other surfaces (V127, FINISH-PLAN.md §1.3).
 *  - MCP: AO's stdio tool server (`ces-ao/mcp/ao-mcp-server.mjs`) answers initialize, lists its tools and the registry
 *    commands, runs one dry run, and turns a `dryRun:false` call into a dry run (started without AO_MCP_ALLOW_APPLY).
 *  - CLI: `list --json`, `show <op>`, `approvals`.
 *  - Rails (each refusal must be evidenced, with the two-person mode): the sim-only rail refuses a non-sim (`kind: live`)
 *    tenant; the CMMC scope gate refuses an L2 command on an L1-scoped tenant; the web apply guard (`ao gui`) answers 428
 *    to a live apply without `confirmApply`. The two probe tenants are fictional records in a PRIVATE tenant root
 *    (`out/ao-surfaces/tenants`); their endpoints are never contacted (the rail and the gate refuse before any session).
 * Nothing here writes to the simulator: the MCP dry run reads it, the refusals stop before any session.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseAoJson, recordValue, twoPersonApprovalOn } from './ao-step.js';
import { FIN29_FILES, FIN29_SCHEMAS, type Fin29Captured, type Fin29StepCtx, type Fin29StepDef } from './fin29-common.js';

export const AO_MCP_SERVER_REL = path.join('mcp', 'ao-mcp-server.mjs');
export const MCP_TOOLS_WANTED = ['ao_list_commands', 'ao_get_command', 'ao_execute', 'ao_approvals', 'ao_approve'] as const;
/** The web console port E9A tries first (never the sim's 4390); the next five are tried when it is held. */
export const E9A_WEB_PORT = 4014;
export const V127_LIVE_SLUG = 'fin29-v127-live';
export const V127_L1_SLUG = 'fin29-v127-l1';

// ---------- the probe tenant records (fictional, private root) ----------

/** A `kind: live` record for the sim-only rail probe. Its endpoints are reserved `.invalid` names (never resolvable). */
export function liveProbeRecord(base: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'live',
    client: { slug: V127_LIVE_SLUG, name: 'FIN-29 V127 rail probe (FICTIONAL, never contacted)', engagement_id: 'fin29-v127-probe' },
    tenant: { tenant_id: 'fin29-v127-live-tenant', domain: 'fin29-v127-probe.invalid', environment: 'gcc-high' },
    auth: { ...((base.auth as Record<string, unknown>) ?? {}) },
    endpoints: { graph: 'https://graph.fin29-v127-probe.invalid', login: 'https://login.fin29-v127-probe.invalid', compliance_uri: 'https://compliance.fin29-v127-probe.invalid', exchange_env: 'O365USGovGCCHigh' },
    resources: { ...((base.resources as Record<string, unknown>) ?? {}) },
  };
}

/** The run's sim record re-scoped to CMMC L1 (with an explicit, empty CUI boundary so ces-tenant accepts it). */
export function l1ProbeRecord(base: Record<string, unknown>): Record<string, unknown> {
  return {
    ...base,
    kind: 'sim',
    client: { ...((base.client as Record<string, unknown>) ?? {}), slug: V127_L1_SLUG, name: 'FIN-29 V127 CMMC scope probe (FICTIONAL)' },
    tenant: { ...((base.tenant as Record<string, unknown>) ?? {}), tenant_id: 'sim-tenant-fin29-v127-l1' },
    cmmc_level: 'L1',
    cmmc_migration_exempt: false,
    cui_boundary: { resource_allowlist: [] },
  };
}

export function writeProbeRoot(root: string, base: Record<string, unknown>): { live: string; l1: string } {
  const live = path.join(root, 'live', `${V127_LIVE_SLUG}.json`);
  const l1 = path.join(root, 'sim', `${V127_L1_SLUG}.json`);
  for (const [f, r] of [[live, liveProbeRecord(base)], [l1, l1ProbeRecord(base)]] as const) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(r, null, 2) + '\n', 'utf-8');
  }
  return { live, l1 };
}

// ---------- registry picks ----------

interface RegCmd { id: string; sodTier: string; cmmcPractices?: string[]; idempotencyClass?: string; parameters?: Array<{ name: string; source?: string; required?: boolean }> }

const noUserInputs = (c: RegCmd): boolean => (c.parameters ?? []).every((p) => !!p.source || !p.required);
const l2Only = (c: RegCmd): boolean => (c.cmmcPractices ?? []).some((p) => p.includes('.L2-'));

/** Picks: a read with no user inputs (MCP and CLI dry runs, rail probe), an L2 command with no user inputs (CMMC gate), and a write with no user inputs (428). */
export function pickProbeOps(reg: RegCmd[]): { read: string | null; l2: string | null; write: string | null } {
  const free = reg.filter(noUserInputs);
  const read = free.find((c) => c.idempotencyClass !== 'get-then-set' && !(c.parameters ?? []).some((p) => p.source)) ?? free[0];
  const l2 = free.find((c) => l2Only(c) && !(c.parameters ?? []).some((p) => p.source)) ?? free.find(l2Only);
  const write = free.find((c) => c.idempotencyClass === 'get-then-set' && !(c.parameters ?? []).some((p) => p.source)) ?? free.find((c) => c.idempotencyClass === 'get-then-set');
  return { read: read?.id ?? null, l2: l2?.id ?? null, write: write?.id ?? null };
}

// ---------- MCP stdio client ----------

export interface McpClient {
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<{ result?: any; error?: any }>;
  notify: (method: string, params?: unknown) => void;
  close: () => void;
}

/** Newline-delimited JSON-RPC 2.0 over a child's stdio (AO's MCP transport). */
export function mcpClientOver(child: Pick<ChildProcess, 'stdin' | 'stdout' | 'kill'>, onClose?: () => void): McpClient {
  let buf = '';
  let next = 1;
  const pending = new Map<number, (m: any) => void>();
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line);
        const r = pending.get(m.id);
        if (r) {
          pending.delete(m.id);
          r(m);
        }
      } catch {
        /* not JSON-RPC */
      }
    }
  });
  return {
    request: (method, params, timeoutMs = 300_000) =>
      new Promise((resolve) => {
        const id = next++;
        const t = setTimeout(() => {
          pending.delete(id);
          resolve({ error: { message: `timeout after ${timeoutMs} ms` } });
        }, timeoutMs);
        pending.set(id, (m) => {
          clearTimeout(t);
          resolve({ result: m.result, error: m.error });
        });
        child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }) + '\n');
      }),
    notify: (method, params) => child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }) + '\n'),
    close: () => {
      try { child.stdin?.end(); } catch { /* closed */ }
      onClose?.();
    },
  };
}

/** The JSON a tools/call answered (AO wraps it as one text content item), or null with the error text. */
export function mcpToolData(res: { result?: any; error?: any }): { data: any; error: string | null } {
  if (res.error) return { data: null, error: String(res.error.message ?? JSON.stringify(res.error)) };
  const text = res.result?.content?.[0]?.text;
  if (res.result?.isError) return { data: null, error: String(text ?? 'isError') };
  try {
    return { data: JSON.parse(String(text)), error: null };
  } catch {
    return { data: null, error: `not JSON: ${String(text).slice(0, 200)}` };
  }
}

// ---------- the record ----------

export interface RailRecord {
  rail: 'sim_only' | 'cmmc_scope' | 'web_apply_guard';
  tenant: string;
  op: string | null;
  rc?: number;
  http?: number | null;
  success?: boolean;
  outcome?: string | null;
  error?: string | null;
  evidence_row_id?: string | null;
  evidence_persisted?: boolean | null;
  two_person_mode?: 'on' | 'off' | null;
  note?: string;
}

export interface AoSurfacesRecord {
  schema: typeof FIN29_SCHEMAS.aoSurfaces;
  slug: string;
  taken: string;
  two_person_approval: 'on' | 'off';
  registry_commands: number;
  ops: { read: string | null; l2: string | null; write: string | null };
  mcp: {
    ran: boolean;
    server_name?: string | null;
    tools?: string[];
    strict_cmmc_in_schema?: boolean;
    list_count?: number | null;
    get_command_id?: string | null;
    dry_run?: { mode: string | null; success: boolean | null; outcome: string | null; evidence_row_id: string | null; two_person_mode: 'on' | 'off' | null; error: string | null };
    apply_blocked?: { mode: string | null; live_apply_blocked: boolean; error: string | null };
    error?: string;
  };
  cli: { list: { rc: number; count: number | null }; show: { rc: number; id: string | null }; approvals: { rc: number; line: string } } | null;
  rails: RailRecord[];
  web: { port: number | null; up: boolean; note?: string };
}

const rowIdOf = (p: unknown): string | null => (typeof p === 'string' && p.includes('/') ? p.slice(p.indexOf('/') + 1) : null);
const modeOf = (ev: any): 'on' | 'off' | null => {
  const m = ev?.metadata?.twoPersonApproval?.mode;
  return m === 'on' || m === 'off' ? m : null;
};

/** Shapes one `exec --json` refusal (CLI) into a rail row. */
export function railFromExec(rail: RailRecord['rail'], tenant: string, op: string, r: Fin29Captured): RailRecord {
  const j = parseAoJson(r.stdout);
  return {
    rail,
    tenant,
    op,
    rc: r.rc,
    success: typeof j?.success === 'boolean' ? j.success : undefined,
    outcome: j?.evidence?.outcome ?? null,
    error: j ? (j.error ?? null) : (r.stderr || r.stdout).trim().slice(-300),
    evidence_row_id: rowIdOf(j?.evidencePath),
    evidence_persisted: typeof j?.evidencePersisted === 'boolean' ? j.evidencePersisted : null,
    two_person_mode: modeOf(j?.evidence),
  };
}

export function parseListCount(stdout: string): number | null {
  const t = stdout.trim();
  const i = t.indexOf('[');
  if (i < 0) return null;
  try {
    const a = JSON.parse(t.slice(i));
    return Array.isArray(a) ? a.length : null;
  } catch {
    return null;
  }
}

// ---------- the step factory ----------

export interface E9aDeps {
  /** Spawns AO's MCP server (tests: a fake). */
  spawnMcp?: (env: NodeJS.ProcessEnv) => ChildProcess;
  fetchFn?: typeof fetch;
}

/** E9A. Runner placement: after E7C, before E7S (it writes no sim state). Needs the sim (E1), the AO env (E7A), the registry record. */
export function e9aStep(ctx: Fin29StepCtx, deps: E9aDeps = {}): Fin29StepDef {
  const outFile = path.join(ctx.P.out, FIN29_FILES.aoSurfaces);
  const probeRoot = path.join(ctx.P.out, 'ao-surfaces', 'tenants');
  const fetchFn = deps.fetchFn ?? fetch;
  return {
    id: 'E9A',
    title: 'AO surfaces: MCP tool server (stdio), CLI list/show/approvals, sim-only rail, CMMC scope gate, web apply guard (428)',
    fatal: false,
    commands: [
      `(cwd ${ctx.rel(ctx.P.aoRoot)}, AO env) node ${AO_MCP_SERVER_REL.split(path.sep).join('/')} <- initialize, tools/list, ao_list_commands, ao_get_command, ao_execute (dry run; dryRun:false without AO_MCP_ALLOW_APPLY)`,
      `node ${ctx.rel(ctx.P.aoCli)} list --json | show <op> | approvals`,
      `CES_TENANT_ROOT=${ctx.rel(probeRoot)}: exec <read op> --tenant ${V127_LIVE_SLUG} (kind live: want denied_sim_only); exec <L2 op> --tenant ${V127_L1_SLUG} (cmmc_level L1: want denied_cmmc)`,
      `CES_AO_AUTH_TOKEN=<run-only> CES_NO_OPEN=1 node ${ctx.rel(ctx.P.aoCli)} gui --port ${E9A_WEB_PORT}; POST /api/execute/<write op> {tenant: ${ctx.slug}, dryRun:false} without confirmApply (want 428)`,
      `-> ${ctx.rel(outFile)}`,
    ],
    run: async () => {
      fs.rmSync(outFile, { force: true });
      fs.rmSync(path.join(ctx.P.out, 'ao-surfaces'), { recursive: true, force: true });
      const env0 = ctx.aoEnv();
      if (!env0 || !fs.existsSync(ctx.P.registryRecord)) return { rc: 1, detail: 'E9A needs the AO env (E7A) and the registry record (E5)' };
      const record = JSON.parse(fs.readFileSync(ctx.P.registryRecord, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
      const requestor = recordValue(record, 'resources.operator_upn') ?? 'harness.operator@sim.invalid';
      const reg = JSON.parse(fs.readFileSync(path.join(ctx.P.aoRoot, 'src', 'registry', 'ao-commands.registry.json'), 'utf8').replace(/^﻿/, '')) as RegCmd[];
      const ops = pickProbeOps(reg);
      const twoOn = twoPersonApprovalOn(env0);
      const rec: AoSurfacesRecord = { schema: FIN29_SCHEMAS.aoSurfaces, slug: ctx.slug, taken: ctx.nowIso(), two_person_approval: twoOn ? 'on' : 'off', registry_commands: reg.length, ops, mcp: { ran: false }, cli: null, rails: [], web: { port: null, up: false } };

      // MCP over stdio.
      let mcpChild: ChildProcess | undefined;
      try {
        const menv = { ...env0 };
        delete menv.AO_MCP_ALLOW_APPLY;
        mcpChild = deps.spawnMcp ? deps.spawnMcp(menv) : spawn(ctx.node, [path.join(ctx.P.aoRoot, AO_MCP_SERVER_REL)], { cwd: ctx.P.aoRoot, env: menv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        const errLog: string[] = [];
        mcpChild.stderr?.on('data', (d) => errLog.push(String(d)));
        const c = mcpClientOver(mcpChild);
        const init = await c.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ces-tester-e9a', version: '1' } }, 120_000);
        c.notify('notifications/initialized');
        const tl = await c.request('tools/list', {}, 60_000);
        const tools = (tl.result?.tools ?? []) as Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
        const call = (name: string, args: Record<string, unknown>) => c.request('tools/call', { name, arguments: args });
        const list = mcpToolData(await call('ao_list_commands', {}));
        const one = ops.read ? mcpToolData(await call('ao_get_command', { commandId: ops.read })) : { data: null, error: 'no read op' };
        const dry = ops.read ? mcpToolData(await call('ao_execute', { commandId: ops.read, tenant: ctx.slug, dryRun: true, requestorUPN: requestor })) : { data: null, error: 'no read op' };
        const blocked = ops.read ? mcpToolData(await call('ao_execute', { commandId: ops.read, tenant: ctx.slug, dryRun: false, requestorUPN: requestor })) : { data: null, error: 'no read op' };
        const ev = dry.data?.result?.evidence;
        rec.mcp = {
          ran: true,
          server_name: init.result?.serverInfo?.name ?? null,
          tools: tools.map((t) => t.name),
          strict_cmmc_in_schema: !!tools.find((t) => t.name === 'ao_execute')?.inputSchema?.properties?.strictCmmc,
          list_count: Array.isArray(list.data) ? list.data.length : null,
          get_command_id: one.data?.id ?? null,
          dry_run: { mode: dry.data?.mode ?? null, success: typeof dry.data?.result?.success === 'boolean' ? dry.data.result.success : null, outcome: ev?.outcome ?? null, evidence_row_id: rowIdOf(dry.data?.result?.evidencePath), two_person_mode: modeOf(ev), error: dry.error ?? dry.data?.result?.error ?? null },
          apply_blocked: { mode: blocked.data?.mode ?? null, live_apply_blocked: typeof blocked.data?.liveApplyBlocked === 'string' && blocked.data.liveApplyBlocked.length > 0, error: blocked.error },
          ...(init.error ? { error: `initialize: ${JSON.stringify(init.error).slice(0, 200)}` } : {}),
        };
        fs.writeFileSync(path.join(ctx.P.logs, 'E9A-mcp.err'), errLog.join(''));
        c.close();
      } catch (err) {
        rec.mcp = { ran: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        ctx.stopTree(mcpChild);
      }

      // CLI list / show / approvals.
      const l = await ctx.runAoCli(['list', '--json'], env0, 'E9A-list');
      const s = ops.read ? await ctx.runAoCli(['show', ops.read], env0, 'E9A-show') : { rc: 1, stdout: '', stderr: 'no read op' };
      const a = await ctx.runAoCli(['approvals'], env0, 'E9A-approvals');
      let showId: string | null = null;
      try { showId = (JSON.parse(s.stdout.trim()) as { id?: string }).id ?? null; } catch { showId = null; }
      rec.cli = { list: { rc: l.rc, count: parseListCount(l.stdout) }, show: { rc: s.rc, id: showId }, approvals: { rc: a.rc, line: (a.stdout || a.stderr).trim().split(/\r?\n/)[0]?.slice(0, 200) ?? '' } };

      // Rails on the private probe root.
      writeProbeRoot(probeRoot, record);
      const penv: NodeJS.ProcessEnv = { ...env0, CES_TENANT_ROOT: probeRoot };
      delete penv.CES_AO_ALLOW_LIVE;
      if (ops.read) {
        const r = await ctx.runAoCli(['exec', ops.read, '--tenant', V127_LIVE_SLUG, '--requestor', requestor, '--json'], penv, 'E9A-rail-sim-only');
        rec.rails.push(railFromExec('sim_only', V127_LIVE_SLUG, ops.read, r));
      } else rec.rails.push({ rail: 'sim_only', tenant: V127_LIVE_SLUG, op: null, note: 'no read op in the registry' });
      if (ops.l2) {
        const r = await ctx.runAoCli(['exec', ops.l2, '--tenant', V127_L1_SLUG, '--requestor', requestor, '--json'], penv, 'E9A-rail-cmmc');
        rec.rails.push(railFromExec('cmmc_scope', V127_L1_SLUG, ops.l2, r));
      } else rec.rails.push({ rail: 'cmmc_scope', tenant: V127_L1_SLUG, op: null, note: 'no L2 command without user inputs' });

      // The web apply guard: AO's console on a free port, a bearer token of this run.
      let web: ChildProcess | undefined;
      try {
        let port: number | null = null;
        for (let p = E9A_WEB_PORT; p < E9A_WEB_PORT + 6; p++) if (!(await ctx.portHeld(p))) { port = p; break; }
        if (!port || !ops.write) {
          rec.web = { port, up: false, note: !port ? `ports ${E9A_WEB_PORT}-${E9A_WEB_PORT + 5} all held` : 'no write op without user inputs' };
          rec.rails.push({ rail: 'web_apply_guard', tenant: ctx.slug, op: ops.write, note: rec.web.note });
        } else {
          const token = crypto.randomBytes(32).toString('hex');
          ctx.registerSecret('ao_web_token_e9a', token);
          web = ctx.startBg('E9A-ao-gui', ctx.node, [ctx.P.aoCli, 'gui', '--port', String(port)], ctx.P.aoRoot, { ...env0, CES_AO_AUTH_TOKEN: token, CES_NO_OPEN: '1' });
          const up = await ctx.waitHttp(`http://127.0.0.1:${port}/api/health`, 'GET', 60);
          rec.web = { port, up };
          if (!up) rec.rails.push({ rail: 'web_apply_guard', tenant: ctx.slug, op: ops.write, note: 'AO console did not answer /api/health' });
          else {
            const res = await fetchFn(`http://127.0.0.1:${port}/api/execute/${ops.write}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ tenant: ctx.slug, inputs: {}, dryRun: false, requestorUPN: requestor }),
              signal: AbortSignal.timeout(120_000),
            });
            let body: any = null;
            try { body = await res.json(); } catch { body = null; }
            rec.rails.push({ rail: 'web_apply_guard', tenant: ctx.slug, op: ops.write, http: res.status, success: body?.success ?? undefined, outcome: body?.evidence?.outcome ?? null, error: body?.error ?? null, evidence_row_id: rowIdOf(body?.evidencePath), evidence_persisted: typeof body?.evidencePersisted === 'boolean' ? body.evidencePersisted : null, two_person_mode: modeOf(body?.evidence) });
          }
        }
      } catch (err) {
        rec.rails.push({ rail: 'web_apply_guard', tenant: ctx.slug, op: ops.write, note: `error: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        ctx.stopTree(web);
      }

      fs.writeFileSync(outFile, JSON.stringify(rec, null, 2));
      const bad: string[] = [];
      if (!rec.mcp.ran) bad.push('MCP');
      if (rec.cli?.list.rc !== 0) bad.push('CLI list');
      for (const r of rec.rails) if (!r.evidence_row_id) bad.push(`${r.rail}: ${r.note ?? 'no evidence row'}`);
      return { rc: bad.length ? 1 : 0, ...(bad.length ? { detail: bad.join('; ') } : {}), extra: { file: FIN29_FILES.aoSurfaces, rails: rec.rails.map((r) => `${r.rail}:${r.outcome ?? r.http ?? '-'}`), web_port: rec.web.port } };
    },
  };
}
