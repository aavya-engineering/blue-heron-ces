// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-29 (finishing plan PH-2 harness), the Stamper legs. Four step factories the runner (muster-e2e-run.ts) places:
 *
 *  - E0  (V117) clean-tenant initialization, BEFORE E1: the simulator reseeded with FIN-21's `clean-g5` profile on the
 *        run's sim port; `stamper bootstrap` (New-TenantBootstrap.ps1 under pwsh) writes a tenant record into a PRIVATE
 *        tenant root (out/e0/tenants); GET /api/preflight (held items, break-glass); GET /api/baseline twice on
 *        posture m365_full_infra: pass 1 with an injected simulator fault on a free resource (New-AzVirtualNetwork, the
 *        simulator's own POST /_faults) and no DP-1 (every recurring item refused), pass 2 with DP-1 + the typed DP-2
 *        for one item and a wrong DP-2 for another. The licence check (bootstrap steps 1 and 18) is read from the
 *        bootstrap output. The bootstrap certificate (non-exportable, Cert:\CurrentUser\My) is checked and removed.
 *  - E8R (V126) Stamper lifecycle commands, after E8F / E7C / E7S: validate, report, a HALTED run (a copy of the forced
 *        entry's task marked critical, forced to fail, so Stamper stops the run), resume (completes it), report again,
 *        rollback (the run-level rollback of that run's applied SETs; Stamper has no per-entry rollback),
 *        tenants list / validate. Everything on a PRIVATE pipeline root (out/e8r/pl, a copy of the run's) so the
 *        manifests V17 / V100 read are untouched.
 *  - E8T (V116) the Stamper CLI at a terminal, after E8R: driven through a Windows pseudo-console (the package's
 *        scripts/conpty-run.ps1), so process.stdin.isTTY is true: DP-1 typed at `stamper cost-ack`; translate; pass A
 *        executes two manual gates (one approved, one rejected) and the key-vault entry with a WRONG DP-2 (refused);
 *        pass B executes the key-vault entry with the correct DP-2 (accepted). Private pipeline root (out/e8t/pl).
 *  - E8G (V115) the Stamper GUI cost gate, after E8T: a Stamper GUI server on a private port and pipeline root;
 *        GET /api/cost-gate/items (listed, unticked, priced), translate without DP-1 (dropped), POST /api/cost-gate/ack
 *        (DP-1), translate again (kept), an Incremental run whose DP-2 is answered through GET /api/cost-gate/pending +
 *        POST /api/approve {gateType: 'cost'} (simulated tenant, FD-1).
 *
 * The DP-2 legs need a scenario where the key vault's SET really runs (FIN-16: on S1 the vault takes the exists path),
 * so E8T runs on s2-eng and E8G on s3-def by default (one vault-creating leg per scenario);
 * CES_FIN29_E8T_SCENARIOS / CES_FIN29_E8G_SCENARIOS (comma lists) override. Every step is fatal: false.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServe, type ServeHandle } from '../stacksim-client/serve-lifecycle.js';
import { createTenantRegistry, createEphemeralSimTenant, getSimLaunchEnv, teardownEphemeralSimTenant } from '../tenant-registry/index.js';
import { mergeSimLaunchEnv } from '../stamper-launcher/env.js';
import { parseSseFrames, type SseEvent } from './mx-io.js';
import { FIN29_FILES, FIN29_SCHEMAS, type Fin29StepCtx, type Fin29StepDef, type Fin29StepOutcome } from './fin29-common.js';

// ---------- constants ----------

export const CLEAN_G5_SCENARIO = 'clean-g5';
/** The slug bootstrap registers the clean tenant under (private tenant root out/e0/tenants). */
export const E0_TENANT_SLUG = 'clean-g5-e0';
export const E0_DISPLAY_NAME = 'CES E0 Clean G5 (SIMULATED)';
export const E0_POSTURE = 'm365_full_infra';
/** The free resource whose provision the simulator is told to fail (pass 1): honest failure + dependents skipped. */
export const E0_INJECTED_CMDLET = 'New-AzVirtualNetwork';
/** Pass 2: DP-1 + the correct DP-2 for the first, DP-1 + a wrong DP-2 for the second. */
export const E0_DP2_ACCEPT = 'baseline.LogAnalyticsWorkspace';
export const E0_DP2_REFUSE = 'baseline.StorageAccount';
/** Private GUI ports (never the sim's 4390, never the EU run's 3000). */
export const E0_GUI_PORT = 4396;
export const E8G_GUI_PORT = 4397;
export const KEY_VAULT_ENTRY = 'SC.L2-3.13.10.key-vault';
export const E8T_DEFAULT_SCENARIOS = ['s2-eng'];
export const E8G_DEFAULT_SCENARIOS = ['s3-def'];
/** A fictional operator name typed at the prompts. */
export const HARNESS_OPERATOR = 'harness-operator (simulated)';
export const REJECT_REASON = 'fictional rejection for the V116 terminal proof';
export const CONPTY_SCRIPT_REL = path.join('scripts', 'conpty-run.ps1');

export function legScenarios(envVar: string, defaults: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  const v = env[envVar];
  return v && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : defaults;
}

// ---------- pure helpers ----------

/** Strip VT/ANSI control sequences (CSI, OSC, single-char escapes) and carriage returns a pseudo-console prints. */
export function stripVt(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r/g, '');
}

/** One argument quoted for a Windows command line (CommandLineToArgvW rules). */
export function winQuote(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let bs = 0;
  for (const ch of arg) {
    if (ch === '\\') bs++;
    else if (ch === '"') {
      out += '\\'.repeat(bs * 2 + 1) + '"';
      bs = 0;
    } else {
      out += '\\'.repeat(bs) + ch;
      bs = 0;
    }
  }
  return out + '\\'.repeat(bs * 2) + '"';
}

export function buildCommandLine(exe: string, args: string[]): string {
  return [exe, ...args].map(winQuote).join(' ');
}

export interface PtyRule {
  name: string;
  /** Matched against the stripped output since the last answer; must match at the END of the output (the prompt waits). */
  match: RegExp;
  /** The keys to type (without the final Enter, which is added), or null to leave the prompt alone. */
  answer: (m: RegExpExecArray, before: string) => string | null;
}

export interface PtyAnswer {
  rule: string;
  answer: string;
  /** The last "Task ID: <id>" printed before the prompt (manual gates), when any. */
  task_id?: string;
}

/** The last manual-gate task id printed before `end` (ManualGateAdapter prints "Task ID: <id>"). */
export function lastTaskId(text: string): string | undefined {
  const all = [...text.matchAll(/Task ID: (\S+)/g)];
  return all.length ? all[all.length - 1]![1] : undefined;
}

/**
 * The prompt waiting at the end of `pending` (the output since the last answer), or null. A prompt is answered only
 * when it is the tail of the output (after an idle pause), so a prompt the console redraws after its answer is never
 * answered twice.
 */
export function pickAnswer(pending: string, all: string, rules: PtyRule[]): { rule: PtyRule; answer: string } | null {
  const tail = pending.replace(/\s+$/, '');
  for (const rule of rules) {
    const re = new RegExp(rule.match.source + '\\s*$', rule.match.flags.replace('g', ''));
    const m = re.exec(tail);
    if (!m) continue;
    const answer = rule.answer(m, all);
    if (answer !== null) return { rule, answer };
  }
  return null;
}

/** The manual-gate and DP-2 prompts of Stamper's CLI (TUI confirm, ManualGateAdapter readline, terminalDp2Prompt). */
export function stamperTerminalRules(o: { approve: Set<string>; dp2: 'correct' | 'wrong'; operator?: string }): PtyRule[] {
  const op = o.operator ?? HARNESS_OPERATOR;
  return [
    { name: 'confirm', match: /\(Y\/n\)/, answer: () => 'y' },
    { name: 'gate-decision', match: /Approve this task\? \(yes\/no\):/, answer: (_m, all) => (o.approve.has(lastTaskId(all) ?? '') ? 'yes' : 'no') },
    { name: 'gate-notes', match: /Add notes\? \(yes\/no\):/, answer: () => 'no' },
    { name: 'gate-reason', match: /Reason for rejection \(optional\):/, answer: () => REJECT_REASON },
    { name: 'dp2-typed', match: /Type "([^"]+)" to confirm \(anything else refuses\):/, answer: (m) => (o.dp2 === 'correct' ? m[1]! : `${m[1]!.split(' ')[0]} $999.99`) },
    { name: 'dp1-typed', match: /Type the entry id "([^"]+)" to opt in \(anything else refuses\):/, answer: (m) => m[1]! },
    { name: 'operator', match: /Your name\/ID:/, answer: () => op },
  ];
}

export interface PtyRunResult {
  rc: number | null;
  timed_out: boolean;
  /** PH-8: which limit stopped the run when timed_out ("total" when both fired). */
  timed_out_by?: 'stall' | 'total';
  answers: PtyAnswer[];
  transcript_file: string;
  /** "conpty" when the pseudo-console host ran; "none" when it could not start. */
  host: 'conpty' | 'none';
  /** PH-5: the host's own failure line when host is "none". */
  host_error?: string;
  is_tty?: boolean;
}

/** PH-8 (R-F5 Q2): the per-pass caps. E8T's passes A and B each hit the old 900 s total cap in R-F5. */
export const PTY_STALL_MS_DEFAULT = 180000;
export const PTY_TOTAL_MS_DEFAULT = 300000;

export type PtySpawn = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;
const defaultPtySpawn: PtySpawn = (cmd, args, opts) => spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

/**
 * Run one command inside the pseudo-console host and answer its prompts by `rules`. The command line travels in the
 * host's env (CES_CONPTY_CMDLINE), never as a quoted argv string. idleMs: the pause after output before a prompt is
 * judged; stallMs: no output and no prompt for this long stops the run (recorded timed_out).
 */
export async function runInPty(o: {
  conptyScript: string;
  exe: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  rules: PtyRule[];
  transcriptFile: string;
  idleMs?: number;
  stallMs?: number;
  totalMs?: number;
  spawnImpl?: PtySpawn;
}): Promise<PtyRunResult> {
  const idleMs = o.idleMs ?? 600;
  const stallMs = o.stallMs ?? PTY_STALL_MS_DEFAULT;
  const totalMs = o.totalMs ?? PTY_TOTAL_MS_DEFAULT;
  const answers: PtyAnswer[] = [];
  fs.mkdirSync(path.dirname(o.transcriptFile), { recursive: true });
  const env = { ...o.env, CES_CONPTY_CMDLINE: buildCommandLine(o.exe, o.args) };
  const child = (o.spawnImpl ?? defaultPtySpawn)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', o.conptyScript, '-Cwd', o.cwd], { cwd: o.cwd, env });
  let raw = '';
  let cursor = 0;
  let timedOut = false;
  let timedOutBy: 'stall' | 'total' | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let lastData = Date.now();
  const all = (): string => stripVt(raw);
  const judge = (): void => {
    const text = all();
    const hit = pickAnswer(text.slice(cursor), text, o.rules);
    if (!hit) return;
    cursor = text.length;
    const taskId = hit.rule.name.startsWith('gate') ? lastTaskId(text) : undefined;
    answers.push({ rule: hit.rule.name, answer: hit.answer, ...(taskId ? { task_id: taskId } : {}) });
    child.stdin?.write(hit.answer);
    setTimeout(() => child.stdin?.write('\r'), 150);
  };
  const rc = await new Promise<number | null>((resolve) => {
    let settled = false;
    const done = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      if (idleTimer) clearTimeout(idleTimer);
      resolve(code);
    };
    const t0 = Date.now();
    const watch = setInterval(() => {
      const overTotal = Date.now() - t0 > totalMs;
      if (overTotal || Date.now() - lastData > stallMs) {
        timedOut = true;
        if (!timedOutBy || overTotal) timedOutBy = overTotal ? 'total' : 'stall';
        if (child.pid) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      }
    }, 2000);
    child.stdout?.on('data', (d) => {
      raw += String(d);
      lastData = Date.now();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(judge, idleMs);
    });
    child.stderr?.on('data', (d) => {
      raw += String(d);
      lastData = Date.now();
    });
    child.on('error', (err) => {
      raw += `\n[conpty host spawn error: ${String(err)}]\n`;
      done(null);
    });
    child.on('close', (code) => done(code));
  });
  const text = all();
  fs.writeFileSync(o.transcriptFile, text);
  const ttyLine = /TTY=(true|false)/.exec(text);
  const hostErr = hostFailure(text);
  return { rc, timed_out: timedOut, ...(timedOutBy ? { timed_out_by: timedOutBy } : {}), answers, transcript_file: o.transcriptFile, host: hostErr ? 'none' : 'conpty', ...(hostErr ? { host_error: hostErr } : {}), ...(ttyLine ? { is_tty: ttyLine[1] === 'true' } : {}) };
}

/**
 * PH-5 (R-F2 V116 red): the first line showing that the pseudo-console host itself failed (it could not spawn, compile
 * its console type or start the command), or null. R-F2's host died on "Unable to find type [CesConPty]" (the sim's
 * fake Microsoft.Graph.Authentication exports an Add-Type function) and E8T read it as a run with no prompts.
 */
export function hostFailure(text: string): string | null {
  const m = /^.*(?:conpty host spawn error|conpty-run: |Unable to find type \[CesConPty\]).*$/m.exec(text);
  return m ? m[0].trim().slice(0, 240) : null;
}

/** Rewrite STORAGE_ROOT in a synthetic Stamper env file (as E8F does). */
export function envFileWithStorageRoot(src: string, dest: string, storageRoot: string): void {
  const lines = fs
    .readFileSync(src, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l !== '')
    .map((l) => (l.startsWith('STORAGE_ROOT=') ? `STORAGE_ROOT=${storageRoot.replace(/\\/g, '/')}` : l));
  if (!lines.some((l) => l.startsWith('STORAGE_ROOT='))) lines.push(`STORAGE_ROOT=${storageRoot.replace(/\\/g, '/')}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, lines.join('\n') + '\n');
}

/**
 * A private copy of the run's pipeline root for one tenant: <pl>/Stamper/plan-data/<slug> without its evidence folders,
 * plus (optionally) ces.db (Stamper's execution state lives there). Returns the private root.
 */
export function privatePipelineRoot(runPl: string, slug: string, dest: string, opts: { withDb?: boolean } = {}): string {
  fs.rmSync(dest, { recursive: true, force: true });
  const src = path.join(runPl, 'Stamper', 'plan-data', slug);
  const to = path.join(dest, 'Stamper', 'plan-data', slug);
  fs.mkdirSync(to, { recursive: true });
  if (fs.existsSync(src)) {
    for (const d of fs.readdirSync(src, { withFileTypes: true })) {
      if (['evidence', 'evidence-by-task', 'cost-gate-evidence'].includes(d.name)) continue;
      fs.cpSync(path.join(src, d.name), path.join(to, d.name), { recursive: true });
    }
  }
  if (opts.withDb) for (const f of ['ces.db', 'ces.db-wal', 'ces.db-shm']) if (fs.existsSync(path.join(runPl, f))) fs.copyFileSync(path.join(runPl, f), path.join(dest, f));
  return dest;
}

type Task = { id: string; priority?: string; depends_on?: string[]; controls?: string[]; action: { engine: string; args?: Record<string, unknown> } };
type Plan = { plan_id: string; execution_graph: Task[]; variables?: Record<string, unknown>; prechecks?: unknown[]; postchecks?: Array<{ control_id?: string }>; [k: string]: unknown };

/** A smaller copy of an executable plan: the kept tasks (deps inside the set), their postchecks, no prechecks. */
export function subsetPlan(plan: Plan, taskIds: string[], o: { planIdSuffix: string; critical?: string[]; dropSecretRefs?: boolean }): Plan {
  const keep = new Set(taskIds);
  const tasks = plan.execution_graph
    .filter((t) => keep.has(t.id))
    .map((t) => ({ ...t, depends_on: (t.depends_on ?? []).filter((d) => keep.has(d)), ...(o.critical?.includes(t.id) ? { priority: 'p1' } : {}) }));
  const controls = new Set(tasks.flatMap((t) => t.controls ?? []));
  const variables = { ...(plan.variables ?? {}) };
  if (o.dropSecretRefs) {
    const refs = Array.isArray(variables._secret_references) ? (variables._secret_references as Array<{ variable?: string }>) : [];
    for (const r of refs) if (r.variable) delete variables[r.variable];
    delete variables._secret_references;
  }
  return {
    ...plan,
    plan_id: `${plan.plan_id}-${o.planIdSuffix}`,
    execution_graph: tasks,
    variables,
    prechecks: [],
    postchecks: (plan.postchecks ?? []).filter((p) => !p.control_id || controls.has(p.control_id)),
  };
}

/** The task that carries a registry entry id (a sub-command of a control task). */
export function taskWithEntry(plan: Plan, entryId: string): Task | undefined {
  return plan.execution_graph.find((t) => JSON.stringify(t.action).includes(`"${entryId}"`));
}

/** Two single-control manual gates (approve the first, reject the second). */
export function pickGatePair(plan: Plan): [Task, Task] | null {
  const gates = plan.execution_graph.filter((t) => t.action.engine === 'manual_gate' && t.id.startsWith('manual-') && (t.controls ?? []).length === 1);
  return gates.length >= 2 ? [gates[0]!, gates[1]!] : null;
}

export interface CostEvidenceRow {
  file: string;
  dp: number | null;
  entry_id: string | null;
  outcome: string | null;
  reason: string | null;
}

/** The cost-gate evidence records under <tenantDir>/cost-gate-evidence (FIN-15 / FIN-16 / GATE-RUN). */
export function readCostEvidence(tenantDir: string): CostEvidenceRow[] {
  const dir = path.join(tenantDir, 'cost-gate-evidence');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { outcome?: string; metadata?: { dp?: number; entryId?: string; reason?: string } };
        return { file: f, dp: j.metadata?.dp ?? null, entry_id: j.metadata?.entryId ?? null, outcome: j.outcome ?? null, reason: j.metadata?.reason ?? null };
      } catch {
        return { file: f, dp: null, entry_id: null, outcome: null, reason: 'unreadable' };
      }
    });
}

/** The execution-results manifest of a plan under a pipeline root (verdict per control). */
export function readResultsManifest(pl: string, slug: string, planId: string): { path: string; verdicts: Record<string, string> } | null {
  const f = path.join(pl, 'Stamper', 'plan-data', slug, 'state', `execution-results-${planId}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(f, 'utf8')) as { results?: Array<{ controlId?: string; verdict?: string }> };
    return { path: f, verdicts: Object.fromEntries((m.results ?? []).filter((r) => r.controlId).map((r) => [r.controlId!, String(r.verdict)])) };
  } catch {
    return null;
  }
}

/** The JSON report path a Stamper CLI run printed ("  JSON: <path>"). */
export function printedReportPath(stdout: string): string | null {
  const m = /JSON: (.+\.json)\s*$/m.exec(stripVt(stdout));
  return m ? m[1]!.trim() : null;
}

/** Collect an SSE stream into events, calling onEvent for each (it may act, e.g. approve a gate). */
export async function collectSse(url: string, stop: (e: SseEvent) => boolean, o: { timeoutMs: number; onEvent?: (e: SseEvent) => Promise<void> | void; fetchImpl?: typeof fetch }): Promise<{ events: SseEvent[]; stopped: boolean; error?: string }> {
  const events: SseEvent[] = [];
  let stopped = false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs);
  try {
    const res = await (o.fetchImpl ?? fetch)(url, { signal: ctl.signal });
    if (!res.body) throw new Error(`no body (HTTP ${res.status})`);
    const reader = res.body.getReader();
    let buf = '';
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString('utf8');
      const p = parseSseFrames(buf);
      buf = p.rest;
      for (const e of p.events) {
        events.push(e);
        if (o.onEvent) await o.onEvent(e);
        if (stop(e)) {
          stopped = true;
          break outer;
        }
      }
    }
    await reader.cancel().catch(() => undefined);
    return { events, stopped };
  } catch (err) {
    return { events, stopped, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- shared runtime bits ----------

const readJson = <T = unknown>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')) as T;
const latestFile = (dir: string, prefix: string): string | null => {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort().pop();
  return f ? path.join(dir, f) : null;
};
const stamperCli = (P: Fin29StepCtx['P']): string => path.join(P.stamper, 'dist', 'cli', 'index.js');
const withoutMusterSecrets = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const e = { ...env };
  delete e.CES_MUSTER_SECRETS_URL;
  delete e.CES_MUSTER_SECRETS_TOKEN;
  delete e.CES_MUSTER_API_URL;
  delete e.CES_MUSTER_API_TOKEN;
  return e;
};

/** `where pwsh` (PowerShell 7): bootstrap needs it (FD-21: the orchestrator installs it). */
export function pwshAvailable(): boolean {
  const r = spawnSync('where.exe', ['pwsh'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 && /pwsh/i.test(r.stdout ?? '');
}

/** True when a module folder named `name` is on the PSModulePath (so bootstrap never runs Install-Module). */
export function moduleOnPath(psModulePath: string | undefined, name: string): boolean {
  return (psModulePath ?? '').split(';').filter(Boolean).some((d) => fs.existsSync(path.join(d, name)));
}

async function getJson(url: string, init?: RequestInit): Promise<{ status: number | null; body: any }> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(120000) });
    const t = await r.text();
    let body: unknown = t;
    try { body = JSON.parse(t); } catch { /* text */ }
    return { status: r.status, body };
  } catch (err) {
    return { status: null, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}
const postJson = (url: string, body: unknown) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function startStamperGuiOn(ctx: Fin29StepCtx, port: number, env: NodeJS.ProcessEnv, name: string): ChildProcess {
  return ctx.startBg(name, ctx.node, [stamperCli(ctx.P), 'gui', '--port', String(port)], ctx.P.stamper, { ...env, CES_NO_OPEN: '1', BROWSER: 'none' });
}

// ---------- E0 (V117) ----------

export interface E0Record {
  schema: typeof FIN29_SCHEMAS.e0;
  taken: string;
  tenant_slug: string;
  scenario: string;
  ran: boolean;
  note?: string;
  bootstrap?: {
    rc: number | null;
    record_file: string | null;
    record_kind: string | null;
    cert_source: string | null;
    cert_thumbprint: string | null;
    cert_non_exportable: boolean | null;
    cert_removed: boolean | null;
    permissions: unknown;
    held_lines: string[];
    break_glass: unknown;
    security_defaults: unknown;
    licence_lines: string[];
    licence_record: unknown;
    via?: string;
    simulator?: unknown;
    writer_error?: string;
  };
  preflight?: { stopped: boolean; summary_held: unknown; summary_break_glass: unknown; checks: Array<{ phase?: unknown; name?: unknown; status?: unknown; detail?: unknown }>; held: string[]; break_glass: unknown; errors: string[] };
  baseline_pass1?: BaselinePass;
  baseline_pass2?: BaselinePass;
}

export interface BaselinePass {
  stopped: boolean;
  injected: string | null;
  complete: Record<string, unknown> | null;
  cost_gate: Array<{ entryId?: unknown; allowed?: unknown; reason?: unknown }>;
  errors: Array<{ resourceName?: unknown; error?: unknown }>;
  progress: Array<{ resourceName?: unknown; resourceType?: unknown; exitCode?: unknown }>;
  cost_evidence: CostEvidenceRow[];
  dp1?: Record<string, number | null>;
}

const summariseBaseline = (events: SseEvent[], injected: string | null, tenantDir: string): BaselinePass => ({
  stopped: events.some((e) => e.type === 'baseline_complete'),
  injected,
  complete: (events.find((e) => e.type === 'baseline_complete') as Record<string, unknown> | undefined) ?? null,
  cost_gate: events.filter((e) => e.type === 'cost_gate').map((e) => ({ entryId: e.entryId, allowed: e.allowed, reason: e.reason })),
  errors: events.filter((e) => e.type === 'baseline_error').map((e) => ({ resourceName: e.resourceName, error: e.error })),
  progress: events.filter((e) => e.type === 'execution_progress').map((e) => ({ resourceName: e.resourceName, resourceType: e.resourceType, exitCode: e.exitCode })),
  cost_evidence: readCostEvidence(tenantDir),
});

export function e0Step(ctx: Fin29StepCtx): Fin29StepDef {
  const { P } = ctx;
  const dir = path.join(P.out, 'e0');
  const file = path.join(P.out, FIN29_FILES.e0);
  const profileJs = path.join(P.sim, 'dist', 'src', 'profiles', 'clean-g5.js');
  const scenarioJson = path.join(P.sim, 'scenarios', `${CLEAN_G5_SCENARIO}.json`);
  const skip = process.env.CES_FIN29_E0 === '0'
    ? 'CES_FIN29_E0=0'
    : !fs.existsSync(scenarioJson) || !fs.existsSync(profileJs)
      ? `slice not landed: FIN-21 clean-g5 profile not built (${ctx.rel(scenarioJson)} / ${ctx.rel(profileJs)})`
      : !pwshAvailable()
        ? 'PowerShell 7 (pwsh) is not installed (FD-21: the orchestrator installs it); bootstrap needs it'
        : undefined;
  return {
    id: 'E0',
    title: 'Clean-tenant initialization on the clean-g5 simulator: bootstrap, preflight, baseline (injected failure, DP-1/DP-2), licence check',
    fatal: false,
    ...(skip ? { skip } : {}),
    commands: [
      `(cwd ${ctx.rel(P.sim)}) node bin/stacksim.mjs scenario ${CLEAN_G5_SCENARIO}; serve m365_azure --slug ${CLEAN_G5_SCENARIO} --port 4390`,
      `(cwd ${ctx.rel(P.stamper)}, sim env, CES_TENANT_ROOT=${ctx.rel(path.join(dir, 'tenants'))} CES_PIPELINE_ROOT=${ctx.rel(path.join(dir, 'pl'))}) node dist/cli/index.js bootstrap --tenant-id <clean-g5 tenant id> --display-name "${E0_DISPLAY_NAME}" --environment gcchigh --slug ${E0_TENANT_SLUG} --subscription-id <clean-g5 subscription> --break-glass-upn <2 fictional UPNs> --license-upn <the clean-g5 operator> --simulator --security-defaults-answer yes`,
      `(until the CLI has --simulator, LOG-FIN-21 §5 item 1) pwsh -File scripts/New-TenantBootstrap.ps1 <same values> -ResultPath ${ctx.rel(path.join(dir, 'bootstrap-result.json'))} -Simulator -SecurityDefaultsAnswer yes; then Stamper's writeBootstrapTenantRecord (dist/cli/bootstrapTenantRecord.js) into the private tenant root`,
      `powershell: the bootstrap certificate's key export policy (want non-exportable), then Remove-Item Cert:\\CurrentUser\\My\\<thumbprint>`,
      `(same env) node dist/cli/index.js gui --port ${E0_GUI_PORT}; GET /api/preflight?tenant=${E0_TENANT_SLUG} (SSE to preflight_done)`,
      `POST ${ctx.urls.sim}/_faults [{target: ${E0_INJECTED_CMDLET}, kind: transient, times: always}]; GET /api/baseline?tenant=${E0_TENANT_SLUG}&posture=${E0_POSTURE} (no DP-1: every recurring item refused)`,
      `POST /_faults []; POST /api/baseline/cost-ack x2 (DP-1 ${E0_DP2_ACCEPT}, ${E0_DP2_REFUSE}); GET /api/baseline ...&operator=<fictional>&dp2={${E0_DP2_ACCEPT}: <expected>, ${E0_DP2_REFUSE}: <wrong>} -> ${ctx.rel(file)}`,
    ],
    run: async (): Promise<Fin29StepOutcome> => {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      for (const d of ['tenants', 'pl', 'certs', 'st']) fs.mkdirSync(path.join(dir, d), { recursive: true });
      const rec: E0Record = { schema: FIN29_SCHEMAS.e0, taken: ctx.nowIso(), tenant_slug: E0_TENANT_SLUG, scenario: CLEAN_G5_SCENARIO, ran: false };
      const save = (): void => fs.writeFileSync(file, JSON.stringify(rec, null, 2));
      if (await ctx.portHeld(4390)) {
        rec.note = 'the sim port 4390 is held before E1 (E0 never stops a process it did not start)';
        save();
        return { rc: 1, detail: rec.note };
      }
      let serve: ServeHandle | undefined;
      let gui: ChildProcess | undefined;
      let registry: ReturnType<typeof createTenantRegistry> | undefined;
      let thumb: string | null = null;
      try {
        const profile = (await import(pathToFileURL(profileJs).href)) as { CLEAN_G5_TENANT_ID?: string; CLEAN_G5_SUBSCRIPTION_ID?: string; CLEAN_G5_BREAK_GLASS_UPNS?: readonly string[] };
        if (!profile.CLEAN_G5_TENANT_ID || !profile.CLEAN_G5_BREAK_GLASS_UPNS) {
          rec.note = 'slice not landed: clean-g5 profile exports no CLEAN_G5_TENANT_ID / CLEAN_G5_BREAK_GLASS_UPNS';
          save();
          return { rc: 1, detail: rec.note };
        }
        const sc = await ctx.runCapture('E0-scenario', ctx.node, ['bin/stacksim.mjs', 'scenario', CLEAN_G5_SCENARIO], P.sim, process.env);
        if (sc.rc !== 0) throw new Error(`stacksim scenario ${CLEAN_G5_SCENARIO} rc ${sc.rc}`);
        serve = await startServe({ stacksimRoot: P.sim, stance: 'm365_azure', slug: CLEAN_G5_SCENARIO, port: 4390, logPath: path.join(P.logs, 'E0-serve.out') });
        if (!(await ctx.waitHttp(`${ctx.urls.sim}/ledger`, 'POST', 30))) throw new Error('the clean-g5 sim did not answer');
        registry = createTenantRegistry({ registryRoot: path.join(dir, 'tenants'), stacksimRoot: P.sim });
        await createEphemeralSimTenant(registry, CLEAN_G5_SCENARIO, { scenario: CLEAN_G5_SCENARIO, stance: 'm365_azure' });
        const launch = await getSimLaunchEnv(registry, CLEAN_G5_SCENARIO, { stacksimRoot: P.sim });
        const env: NodeJS.ProcessEnv = {
          ...withoutMusterSecrets(mergeSimLaunchEnv({ simLaunchEnv: launch })),
          CES_TENANT_ROOT: path.join(dir, 'tenants'),
          CES_PIPELINE_ROOT: path.join(dir, 'pl'),
          STORAGE_ROOT: path.join(dir, 'st'),
        };
        rec.ran = true;
        // ---- bootstrap in simulator mode (FIN-21: -Simulator refuses a non-sim tenant id and any real Graph/Az module,
        // installs nothing, and is the only mode that takes a scripted Security Defaults answer: FD-1). Through
        // `stamper bootstrap --simulator` when the built CLI has it (LOG-FIN-21 §5 item 1); else the script under pwsh
        // and Stamper's own record writer (dist/cli/bootstrapTenantRecord.js), the two halves the CLI joins. ----
        const licenceUpn = (profile as { CLEAN_G5_OPERATOR_UPN?: string }).CLEAN_G5_OPERATOR_UPN;
        const cliHasSim = fs.existsSync(stamperCli(P)) && /--simulator/.test(fs.readFileSync(stamperCli(P), 'utf8'));
        const resultPath = path.join(dir, 'bootstrap-result.json');
        const scriptArgs = ['-NoProfile', '-File', path.join(P.stamper, 'scripts', 'New-TenantBootstrap.ps1'), '-TenantId', profile.CLEAN_G5_TENANT_ID, '-DisplayName', E0_DISPLAY_NAME, '-Environment', 'GCCHigh',
          '-ResultPath', resultPath, '-OutputPath', path.join(dir, 'bootstrap.env'), '-CertStorePath', path.join(dir, 'certs'),
          ...(profile.CLEAN_G5_SUBSCRIPTION_ID ? ['-SubscriptionId', profile.CLEAN_G5_SUBSCRIPTION_ID] : []),
          '-BreakGlassUpn', profile.CLEAN_G5_BREAK_GLASS_UPNS.join(','), ...(licenceUpn ? ['-LicenseUpn', licenceUpn] : []), '-Simulator', '-SecurityDefaultsAnswer', 'yes'];
        const cliArgs = [stamperCli(P), 'bootstrap', '--tenant-id', profile.CLEAN_G5_TENANT_ID, '--display-name', E0_DISPLAY_NAME, '--environment', 'gcchigh', '--slug', E0_TENANT_SLUG,
          ...(profile.CLEAN_G5_SUBSCRIPTION_ID ? ['--subscription-id', profile.CLEAN_G5_SUBSCRIPTION_ID] : []),
          '--break-glass-upn', ...profile.CLEAN_G5_BREAK_GLASS_UPNS, ...(licenceUpn ? ['--license-upn', licenceUpn] : []), '--simulator', '--security-defaults-answer', 'yes',
          '--output', path.join(dir, 'bootstrap.env'), '--cert-store-path', path.join(dir, 'certs')];
        const b = await new Promise<{ rc: number | null; out: string }>((resolve) => {
          let out = '';
          const c = cliHasSim
            ? spawn(ctx.node, cliArgs, { cwd: P.stamper, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
            : spawn('pwsh', scriptArgs, { cwd: P.stamper, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
          const t = setTimeout(() => { if (c.pid) spawnSync('taskkill.exe', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); }, 600000);
          c.stdout?.on('data', (d) => (out += String(d)));
          c.stderr?.on('data', (d) => (out += String(d)));
          c.on('error', (e) => { clearTimeout(t); resolve({ rc: null, out: out + String(e) }); });
          c.on('close', (code) => { clearTimeout(t); resolve({ rc: code, out }); });
        });
        fs.writeFileSync(path.join(P.logs, 'E0-bootstrap.out'), b.out);
        let result: Record<string, any> | null = fs.existsSync(resultPath) ? readJson<Record<string, any>>(resultPath) : null;
        let writerError: string | null = null;
        if (!cliHasSim && b.rc === 0 && result) {
          try {
            const w = (await import(pathToFileURL(path.join(P.stamper, 'dist', 'cli', 'bootstrapTenantRecord.js')).href)) as { writeBootstrapTenantRecord: (r: unknown, slug: string, env?: NodeJS.ProcessEnv) => { path: string } };
            w.writeBootstrapTenantRecord(result, E0_TENANT_SLUG, env);
          } catch (err) {
            writerError = err instanceof Error ? err.message : String(err);
          }
        }
        const recFile = ['sim', 'live'].map((k) => path.join(dir, 'tenants', k, `${E0_TENANT_SLUG}.json`)).find((f) => fs.existsSync(f)) ?? path.join(dir, 'tenants', 'sim', `${E0_TENANT_SLUG}.json`);
        const tr = fs.existsSync(recFile) ? readJson<Record<string, any>>(recFile) : null;
        result ??= null;
        thumb = tr?.auth?.cert_thumbprint ?? result?.cert_thumbprint ?? (/Certificate created: ([0-9A-F]{40})/i.exec(b.out)?.[1] ?? null);
        let nonExportable: boolean | null = null;
        let removed: boolean | null = null;
        if (thumb && /^[0-9A-F]{40}$/i.test(thumb)) {
          const q = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            `$c = Get-Item -LiteralPath 'Cert:\\CurrentUser\\My\\${thumb}' -ErrorAction SilentlyContinue; if (-not $c) { 'MISSING' } else { $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c); if ($k -is [System.Security.Cryptography.RSACng]) { $k.Key.ExportPolicy.ToString() } else { try { $null = $k.ExportParameters($true); 'EXPORTABLE' } catch { 'NONEXPORTABLE' } } }`], { encoding: 'utf8', windowsHide: true });
          const pol = (q.stdout ?? '').trim();
          nonExportable = pol === 'MISSING' || pol === '' ? null : !/AllowExport|AllowPlaintextExport|^EXPORTABLE$/i.test(pol);
        }
        rec.bootstrap = {
          rc: b.rc,
          record_file: fs.existsSync(recFile) ? ctx.rel(recFile) : null,
          record_kind: tr?.kind ?? null,
          cert_source: tr?.auth?.cert_source ?? null,
          cert_thumbprint: thumb,
          cert_non_exportable: nonExportable,
          cert_removed: removed,
          permissions: tr?.onboarding?.permissions ?? null,
          held_lines: stripVt(b.out).split(/\r?\n/).filter((l) => /\[HELD\]/.test(l)).map((l) => l.trim()),
          break_glass: tr?.onboarding?.break_glass ?? null,
          security_defaults: tr?.onboarding?.security_defaults ?? null,
          licence_lines: stripVt(b.out).split(/\r?\n/).filter((l) => /licen[cs]e|subscribed sku/i.test(l) && !/SPDX/.test(l)).map((l) => l.trim()),
          licence_record: tr?.onboarding?.licenses ?? result?.licenses ?? null,
          via: cliHasSim ? 'stamper bootstrap --simulator' : 'New-TenantBootstrap.ps1 -Simulator + Stamper bootstrapTenantRecord writer',
          simulator: result?.simulator ?? tr?.onboarding?.simulator ?? null,
          ...(writerError ? { writer_error: writerError } : {}),
        };
        save();
        if (!tr) return { rc: 1, detail: `bootstrap rc ${b.rc}: no tenant record ${ctx.rel(recFile)} (logs/E0-bootstrap.out)`, extra: { bootstrap_rc: b.rc } };
        // ---- preflight + baseline through the GUI routes (private GUI) ----
        if (await ctx.portHeld(E0_GUI_PORT)) throw new Error(`port ${E0_GUI_PORT} is held`);
        gui = startStamperGuiOn(ctx, E0_GUI_PORT, env, 'E0-stamper-gui');
        const base = `http://127.0.0.1:${E0_GUI_PORT}`;
        if (!(await ctx.waitHttp(`${base}/api/tenants`, 'GET', 90))) throw new Error('the E0 Stamper GUI did not answer');
        const pf = await collectSse(`${base}/api/preflight?tenant=${E0_TENANT_SLUG}`, (e) => e.type === 'preflight_done', { timeoutMs: 600000 });
        fs.writeFileSync(path.join(dir, 'preflight-events.json'), JSON.stringify(pf.events, null, 2));
        const checks = pf.events.filter((e) => e.type === 'preflight_check').map((e) => ({ phase: e.phase, name: e.name, status: e.status, detail: e.detail }));
        const summary = pf.events.find((e) => e.type === 'preflight_summary') as { held?: unknown; breakGlass?: unknown } | undefined;
        rec.preflight = {
          stopped: pf.stopped,
          summary_held: summary?.held ?? null,
          summary_break_glass: summary?.breakGlass ?? null,
          checks,
          held: checks.filter((c) => c.status === 'held').map((c) => String(c.name)),
          break_glass: checks.filter((c) => /break.?glass/i.test(String(c.name ?? '')) || c.phase === 'tenant_readiness'),
          errors: pf.events.filter((e) => e.type === 'error').map((e) => String(e.message ?? '')).concat(pf.error ? [pf.error] : []),
        };
        save();
        // The baseline reads the latest Infrastructure Manifest from the tenant's plans dir: ces-shared's fictional example.
        const imSrc = path.join(P.ces, 'ces-shared', 'src', 'data', 'infra-manifest.example.json');
        const tenantDir = path.join(dir, 'pl', 'Stamper', 'plan-data', E0_TENANT_SLUG);
        fs.mkdirSync(path.join(tenantDir, 'plans'), { recursive: true });
        if (fs.existsSync(imSrc)) fs.copyFileSync(imSrc, path.join(tenantDir, 'plans', `infrastructure-manifest-${E0_TENANT_SLUG}-e0.json`));
        const faults = (rules: unknown[]) => postJson(`${ctx.urls.sim}/_faults`, rules);
        const f1 = await faults([{ target: E0_INJECTED_CMDLET, kind: 'transient', times: 'always' }]);
        const b1 = await collectSse(`${base}/api/baseline?tenant=${E0_TENANT_SLUG}&posture=${E0_POSTURE}`, (e) => e.type === 'baseline_complete' || (e.type === 'baseline_error' && e.phase === 'discovery'), { timeoutMs: 900000 });
        fs.writeFileSync(path.join(dir, 'baseline-1-events.json'), JSON.stringify(b1.events, null, 2));
        rec.baseline_pass1 = summariseBaseline(b1.events, f1.status === 200 ? E0_INJECTED_CMDLET : null, tenantDir);
        await faults([]);
        save();
        // Pass 2: DP-1 for two items, then the typed DP-2: correct for one, wrong for the other (simulated tenant, FD-1).
        const items = await getJson(`${base}/api/baseline/cost-items?tenant=${E0_TENANT_SLUG}&posture=${E0_POSTURE}`);
        const rows = (items.body?.items ?? []) as Array<{ entry_id?: string; expected_dp2?: string | null }>;
        const dp1: Record<string, number | null> = {};
        for (const id of [E0_DP2_ACCEPT, E0_DP2_REFUSE]) dp1[id] = (await postJson(`${base}/api/baseline/cost-ack`, { tenant: E0_TENANT_SLUG, entryId: id, typed: id, operator: HARNESS_OPERATOR })).status;
        const expected = rows.find((r) => r.entry_id === E0_DP2_ACCEPT)?.expected_dp2 ?? '';
        const dp2 = { [E0_DP2_ACCEPT]: expected, [E0_DP2_REFUSE]: `${E0_DP2_REFUSE} $999.99` };
        const b2 = await collectSse(`${base}/api/baseline?tenant=${E0_TENANT_SLUG}&posture=${E0_POSTURE}&operator=${encodeURIComponent(HARNESS_OPERATOR)}&dp2=${encodeURIComponent(JSON.stringify(dp2))}`, (e) => e.type === 'baseline_complete' || (e.type === 'baseline_error' && e.phase === 'discovery'), { timeoutMs: 900000 });
        fs.writeFileSync(path.join(dir, 'baseline-2-events.json'), JSON.stringify(b2.events, null, 2));
        rec.baseline_pass2 = { ...summariseBaseline(b2.events, null, tenantDir), dp1 };
        save();
        return { rc: 0, extra: { bootstrap_rc: b.rc, preflight_held: rec.preflight.held.length, pass1_cost_gated_off: rec.baseline_pass1.complete?.cost_gated_off ?? null, file: path.basename(file) } };
      } catch (err) {
        rec.note = `E0 stopped: ${err instanceof Error ? err.message : String(err)}`;
        save();
        return { rc: 1, detail: rec.note };
      } finally {
        ctx.stopTree(gui);
        if (serve) await serve.stop().catch(() => undefined);
        if (registry) await teardownEphemeralSimTenant(registry, CLEAN_G5_SCENARIO).catch(() => undefined);
        // The bootstrap key lives in Cert:\CurrentUser\My: remove what this run created (the simulator needs no cert).
        if (thumb && /^[0-9A-F]{40}$/i.test(thumb)) {
          const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath 'Cert:\\CurrentUser\\My\\${thumb}' -DeleteKey -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath 'Cert:\\CurrentUser\\My\\${thumb}') { 'LEFT' } else { 'GONE' }`], { encoding: 'utf8', windowsHide: true });
          if (rec.bootstrap) rec.bootstrap.cert_removed = /GONE/.test(r.stdout ?? '');
        }
        fs.rmSync(path.join(dir, 'bootstrap.env'), { force: true }); // carries no secret (SP-3), but it is a live-shaped config: not kept
        save();
      }
    },
  };
}

// ---------- E8R (V126) ----------

export interface E8rCall {
  call: string;
  rc: number | null;
  ok: boolean;
  detail: string;
  [k: string]: unknown;
}

export interface E8rRecord {
  schema: typeof FIN29_SCHEMAS.e8r;
  taken: string;
  tenant_slug: string;
  plan_id: string | null;
  halted_plan_id: string | null;
  forced_entry: string | null;
  private_pipeline_root: string;
  calls: E8rCall[];
  note?: string;
}

export function e8rStep(ctx: Fin29StepCtx, opts: { forceFailEntry: string }): Fin29StepDef {
  const { P, slug } = ctx;
  const dir = path.join(P.out, 'e8r');
  const file = path.join(P.out, FIN29_FILES.e8r);
  const cli = stamperCli(P);
  return {
    id: 'E8R',
    title: 'Stamper lifecycle commands on a private pipeline root: validate, report, a halted run, resume, rollback, tenants list/validate',
    fatal: false,
    ...(process.env.CES_FIN29_E8R === '0' ? { skip: 'CES_FIN29_E8R=0' } : {}),
    commands: [
      `copy ${ctx.rel(P.pl)}/Stamper/plan-data/${slug} (no evidence folders) + ces.db -> ${ctx.rel(path.join(dir, 'pl'))}; env file STORAGE_ROOT=${ctx.rel(path.join(dir, 'st'))}; child env CES_PIPELINE_ROOT=<that copy>, no muster-api secrets`,
      `node ${ctx.rel(cli)} validate ${ctx.rel(P.exe)} -e <env file>; report <plan id> --tenant ${slug} -f json`,
      `halted run: <plan>-e8r = the task of ${opts.forceFailEntry} (marked p1) + the next two tasks; execute --mode auto --tenant ${slug} --force-fail ${opts.forceFailEntry} --i-know-this-is-a-test (stdin newline)`,
      `resume <plan>-e8r --mode auto --tenant ${slug}; report <plan>-e8r --tenant ${slug} -f json; rollback <plan>-e8r -e <env file>`,
      `tenants list; tenants validate ${slug} (CES_TENANT_ROOT=${ctx.rel(P.tenants)}) -> ${ctx.rel(file)}`,
    ],
    run: async (): Promise<Fin29StepOutcome> => {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      const rec: E8rRecord = { schema: FIN29_SCHEMAS.e8r, taken: ctx.nowIso(), tenant_slug: slug, plan_id: null, halted_plan_id: null, forced_entry: opts.forceFailEntry, private_pipeline_root: ctx.rel(path.join(dir, 'pl')), calls: [] };
      const save = (): void => fs.writeFileSync(file, JSON.stringify(rec, null, 2));
      const senv = ctx.stamperEnv();
      if (!senv || !ctx.simUp() || !fs.existsSync(P.exe) || !fs.existsSync(path.join(P.out, 'stamper.synthetic.env'))) {
        rec.note = 'E8R needs the sim, the Stamper env (E5), out/executable-plan.json and out/stamper.synthetic.env';
        save();
        return { rc: 1, detail: rec.note };
      }
      const pl = privatePipelineRoot(P.pl, slug, path.join(dir, 'pl'), { withDb: true });
      const envFile = path.join(dir, 'stamper.synthetic.env');
      envFileWithStorageRoot(path.join(P.out, 'stamper.synthetic.env'), envFile, path.join(dir, 'st'));
      const env: NodeJS.ProcessEnv = { ...withoutMusterSecrets(senv), CES_PIPELINE_ROOT: pl, CES_TENANT_ROOT: P.tenants };
      const run = (label: string, args: string[], stdin?: string) =>
        new Promise<{ rc: number | null; stdout: string; stderr: string }>((resolve) => {
          let stdout = '';
          let stderr = '';
          const c = spawn(ctx.node, [cli, ...args], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
          const t = setTimeout(() => { if (c.pid) spawnSync('taskkill.exe', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); }, 900000);
          c.stdout?.on('data', (d) => (stdout += String(d)));
          c.stderr?.on('data', (d) => (stderr += String(d)));
          if (stdin !== undefined) c.stdin?.write(stdin);
          c.stdin?.end();
          c.on('error', (e) => { clearTimeout(t); resolve({ rc: null, stdout, stderr: stderr + String(e) }); });
          c.on('close', (code) => {
            clearTimeout(t);
            fs.writeFileSync(path.join(P.logs, `E8R-${label}.out`), stdout);
            fs.writeFileSync(path.join(P.logs, `E8R-${label}.err`), stderr);
            resolve({ rc: code, stdout, stderr });
          });
        });
      const parseJsonOut = (s: string): any => { const i = s.indexOf('{'); try { return i >= 0 ? JSON.parse(s.slice(i)) : null; } catch { return null; } };
      try {
        const plan = readJson<Plan>(P.exe);
        rec.plan_id = plan.plan_id;
        // validate
        const v = await run('validate', ['validate', P.exe, '-e', envFile]);
        const vTasks = Number(/Total Tasks: (\d+)/.exec(v.stdout)?.[1] ?? NaN);
        rec.calls.push({ call: 'validate', rc: v.rc, ok: v.rc === 0 && /Plan validation successful/.test(v.stdout) && vTasks === plan.execution_graph.length, detail: `total tasks ${vTasks} (plan ${plan.execution_graph.length})`, total_tasks: vTasks });
        // report (the run's own manifest, from the copy)
        const r1 = await run('report', ['report', plan.plan_id, '--tenant', slug, '-f', 'json']);
        const j1 = parseJsonOut(r1.stdout);
        rec.calls.push({ call: 'report', rc: r1.rc, ok: r1.rc === 0 && j1?.executablePlanId === plan.plan_id && Number(j1?.totalControls) > 0, detail: `planId ${j1?.executablePlanId ?? '?'}, ${j1?.totalControls ?? '?'} controls`, by_verdict: j1?.byVerdict ?? null });
        save();
        // a halted run: the forced entry's task (critical) + its next two automated tasks
        const forcedTask = taskWithEntry(plan, opts.forceFailEntry);
        if (!forcedTask) throw new Error(`no task carries ${opts.forceFailEntry}`);
        const idx = plan.execution_graph.indexOf(forcedTask);
        const next = plan.execution_graph.slice(idx + 1).concat(plan.execution_graph.slice(0, idx)).filter((t) => t.action.engine !== 'manual_gate').slice(0, 2);
        const halted = subsetPlan(plan, [forcedTask.id, ...next.map((t) => t.id)], { planIdSuffix: 'e8r', critical: [forcedTask.id], dropSecretRefs: true });
        // the forced task first (a critical failure halts the tasks after it)
        halted.execution_graph = [halted.execution_graph.find((t) => t.id === forcedTask.id)!, ...halted.execution_graph.filter((t) => t.id !== forcedTask.id)].map((t) => ({ ...t, depends_on: [] }));
        const haltedFile = path.join(dir, 'halted-plan.json');
        fs.writeFileSync(haltedFile, JSON.stringify(halted, null, 2));
        rec.halted_plan_id = halted.plan_id;
        const x = await run('halted-execute', ['execute', haltedFile, '--mode', 'auto', '-e', envFile, '--tenant', slug, '--force-fail', opts.forceFailEntry, '--i-know-this-is-a-test'], '\n');
        const haltRep = printedReportPath(x.stdout);
        const hr = haltRep && fs.existsSync(haltRep) ? readJson<{ status?: string; summary?: Record<string, unknown> }>(haltRep) : null;
        rec.calls.push({ call: 'halted_execute', rc: x.rc, ok: hr?.status === 'failed', detail: `report status ${hr?.status ?? 'missing'}`, report_status: hr?.status ?? null, summary: hr?.summary ?? null });
        // resume (no force-fail): completes the halted run
        const rs = await run('resume', ['resume', haltedFile, '--mode', 'auto', '-e', envFile, '--tenant', slug]);
        const resumeLine = /Resuming (\S+) \(prior status: (\w+)\) - (\d+)\/(\d+) task\(s\) already done/.exec(rs.stdout);
        const rsRep = printedReportPath(rs.stdout);
        const rr = rsRep && fs.existsSync(rsRep) ? readJson<{ status?: string; summary?: Record<string, unknown>; recurring_cost?: { line?: string } }>(rsRep) : null;
        rec.calls.push({
          call: 'resume', rc: rs.rc, ok: rs.rc === 0 && !!resumeLine && resumeLine[2] !== 'completed' && rr?.status !== 'failed',
          detail: resumeLine ? `prior status ${resumeLine[2]}, ${resumeLine[3]}/${resumeLine[4]} done before; report ${rr?.status ?? 'missing'}` : `no "Resuming" line (rc ${rs.rc}): ${(rs.stderr || rs.stdout).trim().slice(-300)}`,
          prior_status: resumeLine?.[2] ?? null, done_before: resumeLine ? Number(resumeLine[3]) : null, report_status: rr?.status ?? null,
          recurring_cost_line: rr?.recurring_cost?.line ?? null,
        });
        // report of the resumed run
        const r2 = await run('report-resumed', ['report', halted.plan_id, '--tenant', slug, '-f', 'json']);
        const j2 = parseJsonOut(r2.stdout);
        rec.calls.push({ call: 'report_resumed', rc: r2.rc, ok: r2.rc === 0 && j2?.executablePlanId === halted.plan_id, detail: `planId ${j2?.executablePlanId ?? '?'}, by verdict ${JSON.stringify(j2?.byVerdict ?? null)}`, by_verdict: j2?.byVerdict ?? null });
        // rollback: Stamper's run-level rollback of the halted run's applied SETs (sim-only guard)
        const rb = await run('rollback', ['rollback', haltedFile, '-e', envFile]);
        const target = /Rollback target: (.+)/.exec(rb.stdout)?.[1]?.trim() ?? null;
        const counts = /Reversed: (\d+), failed: (\d+), manual: (\d+), no-op: (\d+)/.exec(rb.stdout);
        rec.calls.push({
          call: 'rollback', rc: rb.rc, ok: rb.rc === 0 && !!counts && counts[2] === '0',
          detail: counts ? `target ${target}; reversed ${counts[1]}, failed ${counts[2]}, manual ${counts[3]}, no-op ${counts[4]}` : `rollback refused or no counts (rc ${rb.rc}): ${(rb.stderr || rb.stdout).trim().slice(-300)}`,
          target, reversed: counts ? Number(counts[1]) : null, failed: counts ? Number(counts[2]) : null, manual: counts ? Number(counts[3]) : null, noop: counts ? Number(counts[4]) : null,
        });
        // tenants list / validate (read-only)
        const tl = await run('tenants-list', ['tenants', 'list']);
        rec.calls.push({ call: 'tenants_list', rc: tl.rc, ok: tl.rc === 0 && new RegExp(`Slug:\\s+${slug}\\b`).test(tl.stdout), detail: `${(tl.stdout.match(/Slug:/g) ?? []).length} tenant(s) listed` });
        const tv = await run('tenants-validate', ['tenants', 'validate', slug]);
        rec.calls.push({ call: 'tenants_validate', rc: tv.rc, ok: tv.rc === 0 && new RegExp(`Validating tenant: ${slug}`).test(tv.stdout) && /Tenant JSON:/.test(tv.stdout), detail: (/Tenant JSON: (.+)/.exec(tv.stdout)?.[1] ?? '').trim() ? 'tenant JSON resolved' : `rc ${tv.rc}` });
        save();
        const bad = rec.calls.filter((c) => !c.ok);
        return { rc: bad.length ? 1 : 0, ...(bad.length ? { detail: bad.map((c) => `${c.call}: ${c.detail}`).join('; ') } : {}), extra: { calls: rec.calls.length, file: path.basename(file) } };
      } catch (err) {
        rec.note = `E8R stopped: ${err instanceof Error ? err.message : String(err)}`;
        save();
        return { rc: 1, detail: rec.note };
      }
    },
  };
}

// ---------- E8T (V116) ----------

/** PH-8 (R-F5 Q2): the E8T failure detail for a pass that timed out, or null. A timed-out pass fails the step. */
export function passTimeoutDetail(pass: string, r: Pick<PtyRunResult, 'timed_out' | 'timed_out_by'>, limits: { stallMs?: number; totalMs?: number } = {}): string | null {
  if (!r.timed_out) return null;
  const by = r.timed_out_by ?? 'total';
  const ms = by === 'total' ? (limits.totalMs ?? PTY_TOTAL_MS_DEFAULT) : (limits.stallMs ?? PTY_STALL_MS_DEFAULT);
  return `pass ${pass} timed out: ${by === 'total' ? 'total cap' : 'stall guard (no output)'} ${Math.round(ms / 1000)} s`;
}

export interface E8tRecord {
  schema: typeof FIN29_SCHEMAS.e8t;
  taken: string;
  tenant_slug: string;
  host: string;
  dp1: { rc: number | null; answers: PtyAnswer[]; evidence: CostEvidenceRow[] } | null;
  translate: { rc: number | null; acked: string[]; gated_off: string[] } | null;
  gates: { approve: string | null; approve_control: string | null; reject: string | null; reject_control: string | null; other_controls: string[] } | null;
  pass_a: { plan_id: string; rc: number | null; timed_out: boolean; is_tty: boolean | null; answers: PtyAnswer[]; verdicts: Record<string, string> | null; transcript: string } | null;
  pass_b: { plan_id: string; rc: number | null; timed_out: boolean; answers: PtyAnswer[]; verdicts: Record<string, string> | null; transcript: string } | null;
  cost_evidence: CostEvidenceRow[];
  note?: string;
}

export function e8tStep(ctx: Fin29StepCtx): Fin29StepDef {
  const { P, slug } = ctx;
  const dir = path.join(P.out, 'e8t');
  const file = path.join(P.out, FIN29_FILES.e8t);
  const cli = stamperCli(P);
  const conpty = path.join(P.pkg, CONPTY_SCRIPT_REL);
  const scenarios = legScenarios('CES_FIN29_E8T_SCENARIOS', E8T_DEFAULT_SCENARIOS);
  const skip = !scenarios.includes(slug)
    ? `not this scenario: the terminal leg runs on ${scenarios.join(', ')} (a scenario where the key vault's SET runs; CES_FIN29_E8T_SCENARIOS)`
    : !fs.existsSync(conpty) ? `no pseudo-console host (${ctx.rel(conpty)})` : undefined;
  return {
    id: 'E8T',
    title: 'Stamper CLI at a terminal (Windows pseudo-console): DP-1 typed, one gate approved, one rejected, one DP-2 refused and one accepted',
    fatal: false,
    ...(skip ? { skip } : {}),
    commands: [
      `private pipeline root ${ctx.rel(path.join(dir, 'pl'))} (copy of the tenant folder, no evidence); child env CES_PIPELINE_ROOT=<copy>, CES_TENANT_ROOT=${ctx.rel(P.tenants)}, no muster-api secrets`,
      `(pseudo-console: powershell ${ctx.rel(conpty)}) node ${ctx.rel(cli)} cost-ack --tenant ${slug} --entry ${KEY_VAULT_ENTRY} (DP-1 typed)`,
      `node ${ctx.rel(cli)} translate <pushed MP> -m <pushed TM> --tenant ${slug} -o ${ctx.rel(path.join(dir, 'executable-plan.json'))}`,
      `pass A (pseudo-console): execute <plan>-e8t-a (2 manual gates + the ${KEY_VAULT_ENTRY} task) --mode manual: approve gate 1, reject gate 2, DP-2 typed WRONG`,
      `pass B (pseudo-console): execute <plan>-e8t-b (the ${KEY_VAULT_ENTRY} task) --mode manual: DP-2 typed as shown -> ${ctx.rel(file)}`,
    ],
    run: async (): Promise<Fin29StepOutcome> => {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      const rec: E8tRecord = { schema: FIN29_SCHEMAS.e8t, taken: ctx.nowIso(), tenant_slug: slug, host: 'conpty', dp1: null, translate: null, gates: null, pass_a: null, pass_b: null, cost_evidence: [] };
      const save = (): void => fs.writeFileSync(file, JSON.stringify(rec, null, 2));
      const senv = ctx.stamperEnv();
      const pMP = latestFile(P.plansPushed, 'manual-mission-plan-');
      const pTM = latestFile(P.plansPushed, 'tenant-manifest-');
      if (!senv || !ctx.simUp() || !pMP || !pTM || !fs.existsSync(path.join(P.out, 'stamper.synthetic.env'))) {
        rec.note = 'E8T needs the sim, the Stamper env (E5), the pushed MP/TM and out/stamper.synthetic.env';
        save();
        return { rc: 1, detail: rec.note };
      }
      const pl = privatePipelineRoot(P.pl, slug, path.join(dir, 'pl'));
      const tenantDir = path.join(pl, 'Stamper', 'plan-data', slug);
      const env: NodeJS.ProcessEnv = { ...withoutMusterSecrets(senv), CES_PIPELINE_ROOT: pl, CES_TENANT_ROOT: P.tenants };
      try {
        // DP-1 at the terminal
        const d1 = await runInPty({ conptyScript: conpty, exe: ctx.node, args: [cli, 'cost-ack', '--tenant', slug, '--entry', KEY_VAULT_ENTRY], cwd: dir, env, rules: stamperTerminalRules({ approve: new Set(), dp2: 'wrong' }), transcriptFile: path.join(dir, 'dp1.transcript.txt'), stallMs: 120000 });
        rec.dp1 = { rc: d1.rc, answers: d1.answers, evidence: readCostEvidence(tenantDir) };
        save();
        if (d1.host === 'none') { rec.host = 'none'; throw new Error(`the pseudo-console host failed: ${d1.host_error ?? 'no detail'}`); }
        // translate with the opt-in
        const exeA = path.join(dir, 'executable-plan.json');
        const tr = await ctx.runCapture('E8T-translate', ctx.node, [cli, 'translate', pMP, '-m', pTM, '--tenant', slug, '-o', exeA], dir, env);
        const plan = fs.existsSync(exeA) ? readJson<Plan>(exeA) : null;
        const cg = (plan?.variables?._cost_gate ?? {}) as { acked?: Array<{ entry_id?: string }>; gated_off?: Array<{ entry_id?: string }> };
        rec.translate = { rc: tr.rc, acked: (cg.acked ?? []).map((a) => String(a.entry_id)), gated_off: (cg.gated_off ?? []).map((a) => String(a.entry_id)) };
        save();
        if (!plan) throw new Error(`translate rc ${tr.rc}: no plan`);
        const pair = pickGatePair(plan);
        const kv = taskWithEntry(plan, KEY_VAULT_ENTRY);
        rec.gates = pair ? { approve: pair[0].id, approve_control: pair[0].controls![0]!, reject: pair[1].id, reject_control: pair[1].controls![0]!, other_controls: kv?.controls ?? [] } : null;
        if (!pair) throw new Error('the plan has fewer than two single-control manual gates');
        const envFileFor = (k: string): string => {
          const f = path.join(dir, `stamper-${k}.synthetic.env`);
          envFileWithStorageRoot(path.join(P.out, 'stamper.synthetic.env'), f, path.join(dir, `st-${k}`));
          return f;
        };
        // pass A: two gates + the key vault (DP-2 wrong)
        const planA = subsetPlan(plan, [pair[0].id, pair[1].id, ...(kv ? [kv.id] : [])], { planIdSuffix: 'e8t-a', dropSecretRefs: true });
        const fileA = path.join(dir, 'terminal-plan-a.json');
        fs.writeFileSync(fileA, JSON.stringify(planA, null, 2));
        const a = await runInPty({ conptyScript: conpty, exe: ctx.node, args: [cli, 'execute', fileA, '--mode', 'manual', '-e', envFileFor('a'), '--tenant', slug], cwd: dir, env, rules: stamperTerminalRules({ approve: new Set([pair[0].id]), dp2: 'wrong' }), transcriptFile: path.join(dir, 'pass-a.transcript.txt') });
        rec.pass_a = { plan_id: planA.plan_id, rc: a.rc, timed_out: a.timed_out, is_tty: a.is_tty ?? null, answers: a.answers, verdicts: readResultsManifest(pl, slug, planA.plan_id)?.verdicts ?? null, transcript: ctx.rel(a.transcript_file) };
        save();
        const timeoutA = passTimeoutDetail('A', a);
        if (timeoutA) throw new Error(timeoutA);
        // pass B: the key vault alone (DP-2 correct)
        if (kv) {
          const planB = subsetPlan(plan, [kv.id], { planIdSuffix: 'e8t-b', dropSecretRefs: true });
          const fileB = path.join(dir, 'terminal-plan-b.json');
          fs.writeFileSync(fileB, JSON.stringify(planB, null, 2));
          const b = await runInPty({ conptyScript: conpty, exe: ctx.node, args: [cli, 'execute', fileB, '--mode', 'manual', '-e', envFileFor('b'), '--tenant', slug], cwd: dir, env, rules: stamperTerminalRules({ approve: new Set(), dp2: 'correct' }), transcriptFile: path.join(dir, 'pass-b.transcript.txt') });
          rec.pass_b = { plan_id: planB.plan_id, rc: b.rc, timed_out: b.timed_out, answers: b.answers, verdicts: readResultsManifest(pl, slug, planB.plan_id)?.verdicts ?? null, transcript: ctx.rel(b.transcript_file) };
          save();
          const timeoutB = passTimeoutDetail('B', b);
          if (timeoutB) throw new Error(timeoutB);
        }
        rec.cost_evidence = readCostEvidence(tenantDir);
        save();
        return { rc: 0, extra: { answers_a: rec.pass_a.answers.length, answers_b: rec.pass_b?.answers.length ?? 0, cost_records: rec.cost_evidence.length, file: path.basename(file) } };
      } catch (err) {
        rec.note = `E8T stopped: ${err instanceof Error ? err.message : String(err)}`;
        rec.cost_evidence = readCostEvidence(tenantDir);
        save();
        return { rc: 1, detail: rec.note };
      }
    },
  };
}

// ---------- E8G (V115) ----------

export interface E8gRecord {
  schema: typeof FIN29_SCHEMAS.e8g;
  taken: string;
  tenant_slug: string;
  items: { status: number | null; item: Record<string, unknown> | null };
  translate_without_dp1: { status: number | null; gated_off: string[]; acked: string[] } | null;
  dp1: { status: number | null; ok: boolean | null } | null;
  translate_with_dp1: { status: number | null; gated_off: string[]; acked: string[] } | null;
  run: { stopped: boolean; task_approvals: number; pending_seen: Array<{ entryId?: unknown; expected?: unknown; estimate?: unknown }>; answer: { status: number | null; outcome: unknown } | null; error?: string } | null;
  cost_evidence: CostEvidenceRow[];
  note?: string;
}

export function e8gStep(ctx: Fin29StepCtx): Fin29StepDef {
  const { P, slug } = ctx;
  const dir = path.join(P.out, 'e8g');
  const file = path.join(P.out, FIN29_FILES.e8g);
  const scenarios = legScenarios('CES_FIN29_E8G_SCENARIOS', E8G_DEFAULT_SCENARIOS);
  const base = `http://127.0.0.1:${E8G_GUI_PORT}`;
  return {
    id: 'E8G',
    title: 'Stamper GUI cost gate: priced opt-in list, translate drops without DP-1, DP-1, the DP-2 dialog answered on an Incremental run',
    fatal: false,
    ...(!scenarios.includes(slug) ? { skip: `not this scenario: the GUI cost leg runs on ${scenarios.join(', ')} (CES_FIN29_E8G_SCENARIOS)` } : {}),
    commands: [
      `(cwd ${ctx.rel(P.stamper)}, sim env, CES_PIPELINE_ROOT=${ctx.rel(path.join(dir, 'pl'))} CES_TENANT_ROOT=${ctx.rel(P.tenants)} STORAGE_ROOT=${ctx.rel(path.join(dir, 'st'))}) node dist/cli/index.js gui --port ${E8G_GUI_PORT}`,
      `GET ${base}/api/cost-gate/items?tenant=${slug}; POST /api/translate (no DP-1); POST /api/cost-gate/ack {${KEY_VAULT_ENTRY}}; POST /api/translate`,
      `GET /api/execute?plan=<the ${KEY_VAULT_ENTRY} task alone>&mode=incremental&tenant=${slug}: approve the step; GET /api/cost-gate/pending; POST /api/approve {gateType: cost, typed: <as shown>, automated: true} -> ${ctx.rel(file)}`,
    ],
    run: async (): Promise<Fin29StepOutcome> => {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(file, { force: true });
      const rec: E8gRecord = { schema: FIN29_SCHEMAS.e8g, taken: ctx.nowIso(), tenant_slug: slug, items: { status: null, item: null }, translate_without_dp1: null, dp1: null, translate_with_dp1: null, run: null, cost_evidence: [] };
      const save = (): void => fs.writeFileSync(file, JSON.stringify(rec, null, 2));
      const senv = ctx.simEnv();
      const pMP = latestFile(P.plansPushed, 'manual-mission-plan-');
      const pTM = latestFile(P.plansPushed, 'tenant-manifest-');
      if (!senv || !ctx.simUp() || !pMP || !pTM) {
        rec.note = 'E8G needs the sim, the sim env (E5) and the pushed MP/TM';
        save();
        return { rc: 1, detail: rec.note };
      }
      if (await ctx.portHeld(E8G_GUI_PORT)) {
        rec.note = `port ${E8G_GUI_PORT} is held`;
        save();
        return { rc: 1, detail: rec.note };
      }
      const pl = privatePipelineRoot(P.pl, slug, path.join(dir, 'pl'));
      const tenantDir = path.join(pl, 'Stamper', 'plan-data', slug);
      const env: NodeJS.ProcessEnv = { ...withoutMusterSecrets(senv), CES_PIPELINE_ROOT: pl, CES_TENANT_ROOT: P.tenants, STORAGE_ROOT: path.join(dir, 'st') };
      let gui: ChildProcess | undefined;
      const cgOf = (f: string): { gated_off: string[]; acked: string[] } => {
        const cg = (fs.existsSync(f) ? readJson<Plan>(f).variables?._cost_gate : null) as { acked?: Array<{ entry_id?: string }>; gated_off?: Array<{ entry_id?: string }> } | null;
        return { gated_off: (cg?.gated_off ?? []).map((x) => String(x.entry_id)), acked: (cg?.acked ?? []).map((x) => String(x.entry_id)) };
      };
      try {
        gui = startStamperGuiOn(ctx, E8G_GUI_PORT, env, 'E8G-stamper-gui');
        if (!(await ctx.waitHttp(`${base}/api/tenants`, 'GET', 90))) throw new Error('the E8G Stamper GUI did not answer');
        const it = await getJson(`${base}/api/cost-gate/items?tenant=${slug}`);
        rec.items = { status: it.status, item: ((it.body?.items ?? []) as Array<Record<string, unknown>>).find((x) => x.entry_id === KEY_VAULT_ENTRY) ?? null };
        const out0 = path.join(dir, 'translate-no-dp1.json');
        const t0 = await postJson(`${base}/api/translate`, { missionPlan: pMP, manifest: pTM, tenant: slug, output: out0 });
        rec.translate_without_dp1 = { status: t0.status, ...cgOf(out0) };
        const a = await postJson(`${base}/api/cost-gate/ack`, { tenant: slug, entryId: KEY_VAULT_ENTRY, typed: KEY_VAULT_ENTRY, operator: HARNESS_OPERATOR });
        rec.dp1 = { status: a.status, ok: a.body?.ok ?? null };
        const out1 = path.join(dir, 'translate-dp1.json');
        const t1 = await postJson(`${base}/api/translate`, { missionPlan: pMP, manifest: pTM, tenant: slug, output: out1 });
        rec.translate_with_dp1 = { status: t1.status, ...cgOf(out1) };
        save();
        const plan = fs.existsSync(out1) ? readJson<Plan>(out1) : null;
        const kv = plan ? taskWithEntry(plan, KEY_VAULT_ENTRY) : undefined;
        if (!plan || !kv) throw new Error(`the DP-1 translate kept no ${KEY_VAULT_ENTRY} task`);
        const mini = subsetPlan(plan, [kv.id], { planIdSuffix: 'e8g', dropSecretRefs: true });
        const miniFile = path.join(dir, 'gui-cost-plan.json');
        fs.writeFileSync(miniFile, JSON.stringify(mini, null, 2));
        let approvals = 0;
        const pending: Array<{ entryId?: unknown; expected?: unknown; estimate?: unknown }> = [];
        let answer: { status: number | null; outcome: unknown } | null = null;
        let polling = true;
        const poll = (async () => {
          while (polling && !answer) {
            const pr = await getJson(`${base}/api/cost-gate/pending`);
            const p = ((pr.body?.pending ?? []) as Array<Record<string, unknown>>).find((x) => x.entryId === KEY_VAULT_ENTRY || x.entry_id === KEY_VAULT_ENTRY);
            if (p) {
              const expected = String(p.expected ?? p.expected_dp2 ?? p.typed ?? '');
              pending.push({ entryId: p.entryId ?? p.entry_id, expected, estimate: p.estimate });
              const ans = await postJson(`${base}/api/approve`, { gateType: 'cost', entryId: KEY_VAULT_ENTRY, decision: 'approve', typed: expected, operator: HARNESS_OPERATOR, tenant: slug, automated: true });
              answer = { status: ans.status, outcome: ans.body?.outcome ?? null };
            }
            await new Promise((r) => setTimeout(r, 1500));
          }
        })();
        const run = await collectSse(`${base}/api/execute?plan=${encodeURIComponent(miniFile)}&mode=incremental&tenant=${slug}&uploadToBlob=false`, (e) => e.type === 'done' || e.type === 'error', {
          timeoutMs: 900000,
          onEvent: async (e) => {
            if (e.type === 'task_approve_request' && typeof e.taskId === 'string') {
              const r = await postJson(`${base}/api/approve`, { taskId: e.taskId, decision: 'approve' });
              if (r.status === 200) approvals++;
            }
          },
        });
        polling = false;
        await poll;
        fs.writeFileSync(path.join(dir, 'execute-events.json'), JSON.stringify(run.events, null, 2));
        rec.run = { stopped: run.stopped, task_approvals: approvals, pending_seen: pending, answer, ...(run.error ? { error: run.error } : {}) };
        rec.cost_evidence = readCostEvidence(tenantDir);
        save();
        return { rc: 0, extra: { dp2_outcome: answer ? (answer as { outcome: unknown }).outcome : null, cost_records: rec.cost_evidence.length, file: path.basename(file) } };
      } catch (err) {
        rec.note = `E8G stopped: ${err instanceof Error ? err.message : String(err)}`;
        rec.cost_evidence = readCostEvidence(tenantDir);
        save();
        return { rc: 1, detail: rec.note };
      } finally {
        ctx.stopTree(gui);
      }
    },
  };
}
