// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planCompileService.ts — gap closure API-3a: the compile behind
// POST /api/plan/compile (discovery result -> Mission Plan, Tenant Manifest,
// Infrastructure Manifest, the MG-12 hand-off envelopes, policies, reports and
// plan-trace.json), the same plan scripts/mx/plan-from-discovery.ts produces.
//
// The compile itself is the Muster SPA's own code (Dexie sessions, the '@/'
// module graph, the knowledge banks under public/). muster-api's tsc build
// (CommonJS, rootDir src) cannot load that graph in-process, and the compile
// installs process-wide shims (fake IndexedDB, a fetch shim for /knowledge), so
// this service runs it in a child process: the runner script, unchanged in
// behaviour, is the one implementation, and stays usable on its own. This
// service owns the API side: input checks, a private work folder, the
// muster-api-issued initial-password reference (FLOW-5 a), the child's
// environment (only what the request names: inherited MX_* variables are
// dropped), and the result (every output file, text as utf8, binary as base64).
// API-3b (W10) moves the compile into muster-api proper; the route stays.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { issueInitialPassword, issuedSecretTerms, MAX_MAX_READS, revokeIssuedSecret } from './initialPasswordIssuer.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STACK_RE = /^[a-z0-9_]{1,64}$/;
const TEXT_EXT = new Set(['.json', '.md', '.txt', '.html', '.csv']);
/** The runner's trace marker when it used the muster-api reference (plan-from-discovery.ts). */
export const ISSUED_REF_TRACE = 'issued by muster-api (sim-only; muster-api holds the value)';

export interface PlanCompileInput {
  tenant_slug: string;
  /** The readiness-result file from `mu discovery` (its text, or the parsed object). */
  discovery: string | Record<string, unknown>;
  /** customers/<slug>/org-content.json (text or object); optional. */
  org_content?: string | Record<string, unknown>;
  /** customers/<slug>/interview-answers.json (text or array); optional. */
  interview_answers?: string | unknown[];
  /** Stack tiles; absent = the runner's default. */
  stacks?: string[];
  /** 'off' skips the harvest reads (offline dry run). */
  tenant_harvest?: 'on' | 'off';
  /**
   * SP-7: how many times Stamper may resolve the issued initial-password reference (1..3, default 1;
   * 1 in a release build). The proof harness asks for 2 (Stamper resolves at E6 and again at E8F).
   */
  max_reads?: number;
}

export interface CompiledFile {
  /** Path relative to the plan folder, '/' separated (e.g. policies/access-control-policy.md). */
  name: string;
  encoding: 'utf8' | 'base64';
  content: string;
}

export interface PlanCompileResult {
  /** The runner's MX_SUMMARY line (counts), without the prefix. */
  summary: string | null;
  /** CG-8 / FIN-17: the runner's MX_COST_NOTICE lines (one per recurring-cost item), with the prefix. */
  cost_notice_lines: string[];
  trace: Record<string, unknown> | null;
  files: CompiledFile[];
  /** The muster-api-issued reference the plan carries, or null (not a sim plan / already answered). */
  initial_password_ref: string | null;
  /** SP-7: the reference's read budget and expiry (never a value or a read count), or null with no reference. */
  initial_password_terms: { max_reads: number; expires_at: string } | null;
  /**
   * CG-8: the Mission Plan's recurring-cost notice (read from the compiled plan file), or null when
   * the plan carries none. Informational; never blocks.
   */
  recurring_cost_notice: unknown | null;
}

/** CG-8: the recurring_cost_notice of the compiled manual-mission-plan-*.json, if any. */
export function recurringCostNoticeOf(files: CompiledFile[]): unknown | null {
  const mp = files.find((f) => /(^|\/)manual-mission-plan-[^/]*\.json$/.test(f.name) && f.encoding === 'utf8');
  if (!mp) return null;
  try {
    return (JSON.parse(mp.content) as { recurring_cost_notice?: unknown }).recurring_cost_notice ?? null;
  } catch {
    return null;
  }
}

export class PlanCompileError extends Error {
  constructor(message: string, readonly detail: string) {
    super(message);
    this.name = 'PlanCompileError';
  }
}

export type CompileRunner = (args: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<{ code: number; stdout: string; stderr: string }>;

/** ces-muster/ (the SPA root that holds scripts/mx and node_modules/vite-node). */
export function musterRoot(): string {
  return process.env.CES_MUSTER_ROOT ?? path.resolve(__dirname, '..', '..', '..');
}

/** Runs the runner script with vite-node, as the harness ran it before API-3a. */
export const viteNodeRunner: CompileRunner = ({ cwd, env }) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(cwd, 'node_modules', 'vite-node', 'vite-node.mjs'), 'scripts/mx/plan-from-discovery.ts'],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (e) => resolve({ code: 1, stdout, stderr: stderr + String(e) }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

/** Request body -> input, or the first problem. */
export function validateCompileInput(body: unknown): { ok: true; input: PlanCompileInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.tenant_slug !== 'string' || !SLUG_RE.test(b.tenant_slug)) {
    return { ok: false, error: 'tenant_slug must match /^[a-z0-9][a-z0-9-]{0,63}$/' };
  }
  const isDoc = (v: unknown): boolean => (typeof v === 'string' && v.trim() !== '') || (!!v && typeof v === 'object');
  if (!isDoc(b.discovery)) return { ok: false, error: 'discovery (the readiness-result file) is required' };
  if (b.org_content !== undefined && !isDoc(b.org_content)) return { ok: false, error: 'org_content must be a JSON object or its text' };
  if (b.interview_answers !== undefined && !isDoc(b.interview_answers)) return { ok: false, error: 'interview_answers must be a JSON array or its text' };
  if (b.stacks !== undefined && !(Array.isArray(b.stacks) && b.stacks.length > 0 && b.stacks.every((s) => typeof s === 'string' && STACK_RE.test(s)))) {
    return { ok: false, error: 'stacks must be a non-empty array of stack ids' };
  }
  if (b.tenant_harvest !== undefined && b.tenant_harvest !== 'on' && b.tenant_harvest !== 'off') {
    return { ok: false, error: "tenant_harvest must be 'on' or 'off'" };
  }
  if (b.max_reads !== undefined && !(Number.isInteger(b.max_reads) && (b.max_reads as number) >= 1 && (b.max_reads as number) <= MAX_MAX_READS)) {
    return { ok: false, error: `max_reads must be an integer from 1 to ${MAX_MAX_READS}` };
  }
  return { ok: true, input: b as unknown as PlanCompileInput };
}

const docText = (v: string | object): string => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

function listFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

function lineAfter(stdout: string, prefix: string): string | null {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith(prefix));
  return line ? line.slice(prefix.length) : null;
}

/**
 * Compile one plan. `tenantId` is the caller's JWT tenant: the issued initial-password
 * reference resolves only for it (FLOW-5 a). Throws PlanCompileError when the runner fails
 * (including a plan the push gate would block).
 */
export async function compilePlan(
  input: PlanCompileInput,
  opts: { tenantId: string; runner?: CompileRunner; root?: string },
): Promise<PlanCompileResult> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'muster-plan-compile-'));
  const ref = issueInitialPassword(input.tenant_slug, opts.tenantId, { maxReads: input.max_reads });
  let keepRef = false;
  try {
    const outDir = path.join(work, 'plan');
    const disc = path.join(work, 'discovery-result.json');
    fs.writeFileSync(disc, docText(input.discovery), 'utf8');
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('MX_')) env[k] = v;
    env.MX_DISCOVERY = disc;
    env.MX_OUT = outDir;
    env.MX_SLUG = input.tenant_slug;
    env.MX_INITIAL_PASSWORD_REF = ref;
    if (input.org_content !== undefined) {
      env.MX_ORG_CONTENT = path.join(work, 'org-content.json');
      fs.writeFileSync(env.MX_ORG_CONTENT, docText(input.org_content), 'utf8');
    }
    if (input.interview_answers !== undefined) {
      env.MX_ANSWERS = path.join(work, 'interview-answers.json');
      fs.writeFileSync(env.MX_ANSWERS, docText(input.interview_answers), 'utf8');
    }
    if (input.stacks) env.MX_STACKS = input.stacks.join(',');
    if (input.tenant_harvest === 'off') env.MX_TENANT_HARVEST = 'off';

    const r = await (opts.runner ?? viteNodeRunner)({ cwd: opts.root ?? musterRoot(), env });
    if (r.code !== 0) {
      throw new PlanCompileError('plan compile failed', r.stderr.trim().split(/\r?\n/).slice(-20).join('\n'));
    }
    const resultLine = lineAfter(r.stdout, 'MX_RESULT ');
    const parsed = resultLine ? (JSON.parse(resultLine) as { trace?: Record<string, unknown> }) : null;
    const trace = parsed?.trace ?? null;
    if (!fs.existsSync(outDir)) throw new PlanCompileError('plan compile wrote no files', r.stderr.trim().slice(-2000));
    const files: CompiledFile[] = listFiles(outDir).map((name) => {
      const buf = fs.readFileSync(path.join(outDir, name));
      const text = TEXT_EXT.has(path.extname(name).toLowerCase());
      return { name, encoding: text ? 'utf8' : 'base64', content: buf.toString(text ? 'utf8' : 'base64') };
    });
    keepRef = trace?.initial_password_ref === ISSUED_REF_TRACE;
    const costNoticeLines = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('MX_COST_NOTICE '));
    return { summary: lineAfter(r.stdout, 'MX_SUMMARY '), cost_notice_lines: costNoticeLines, trace, files, initial_password_ref: keepRef ? ref : null, initial_password_terms: keepRef ? issuedSecretTerms(ref) : null, recurring_cost_notice: recurringCostNoticeOf(files) };
  } finally {
    if (!keepRef) revokeIssuedSecret(ref);
    fs.rmSync(work, { recursive: true, force: true });
  }
}
