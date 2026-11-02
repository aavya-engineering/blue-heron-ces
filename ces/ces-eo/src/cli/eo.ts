// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * eo.ts — thin CLI that drives EO's HTTP API (API-2, modelled on Muster's `mu`).
 *
 * Testable core: runEo(argv, deps?) : Promise<number>. The `eo` bin (index.ts) calls it.
 *  - URL:    --url    > CES_EO_URL        > http://127.0.0.1:4002
 *  - Token:  --token  > CES_EO_AUTH_TOKEN > none (sent as Bearer when set)
 *  - Tenant: --tenant (required by every command except status/help)
 *
 * Exit codes:
 *   0  success
 *   1  error (HTTP 4xx/5xx, assess_error / no terminal SSE event, bad arguments)
 *   2  unknown command / usage error
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, basename } from 'node:path';
import { secretEnv } from 'ces-shared/secrets';

export interface EoDeps {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  stdout?: { write: (s: string) => void };
  stderr?: { write: (s: string) => void };
  env?: Record<string, string | undefined>;
}

export const DEFAULT_EO_URL = 'http://127.0.0.1:4002';

interface ParsedArgs {
  flags: Map<string, string | boolean>;
  positionals: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i += 2;
      } else {
        flags.set(key, true);
        i += 1;
      }
    } else {
      positionals.push(arg);
      i += 1;
    }
  }
  return { flags, positionals };
}

const USAGE = `eo — EO (evidence-ops) API CLI

Usage: eo [--url URL] [--token TOKEN] [--tenant SLUG] [--pretty] <command> [args]

Commands:
  eo status                                    GET /api/health
  eo assess --tenant <slug>                    GET /api/assess (SSE); one JSON line per event
  eo ssp generate --tenant <slug> [--assessment <id>]
                                               POST /api/ssp/generate (default: latest snapshot)
  eo poam [generate] --tenant <slug> [--assessment <id>]
                                               POST /api/poam/generate (default: latest snapshot)
  eo package build --tenant <slug> --out <file.zip>
                                               POST /api/package/build, then downloads the zip to --out
  eo policies import --tenant <slug> --file <path>
                                               POST /api/policies/import (file: policy array or {policies:[...]})
  eo review --tenant <slug> --control <id> --objective <id> (--hash <sha256> | --file <path>)
            --verdict met|not_met [--notes <text>] [--approver-token <token>]
                                               POST /api/reviews (GD-b document review; the latest
                                               review per objective counts, FD-8)
  eo review list --tenant <slug> [--control <id>] [--history]
                                               GET /api/reviews (live reviews; --history adds all rows)

Global flags:
  --url URL        EO base URL (env: CES_EO_URL; default: ${DEFAULT_EO_URL})
  --token TOKEN    Bearer token (env: CES_EO_AUTH_TOKEN)
  --tenant SLUG    Tenant slug
  --pretty         Pretty-print JSON output
  --approver-token Minted approver token for \`eo review\`, sent as x-ces-principal
                   (env: CES_EO_APPROVER_TOKEN). Never the --token bearer.

Exit codes:
  0  success
  1  error (HTTP error, assess_error, bad arguments)
  2  unknown command / usage error
`;

export async function runEo(argv: string[], deps: EoDeps = {}): Promise<number> {
  const env = deps.env ?? (secretEnv() as Record<string, string | undefined>);
  const fetchFn = deps.fetchImpl ?? (globalThis.fetch as (url: string, init?: RequestInit) => Promise<Response>);
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;

  const { flags, positionals } = parseArgs(argv);
  const str = (k: string): string | undefined => {
    const v = flags.get(k);
    return typeof v === 'string' ? v : undefined;
  };

  const baseUrl = (str('url') ?? env['CES_EO_URL'] ?? DEFAULT_EO_URL).replace(/\/+$/, '');
  const token = str('token') ?? env['CES_EO_AUTH_TOKEN'] ?? null;
  const tenant = str('tenant');
  const pretty = flags.get('pretty') === true;

  function emit(data: unknown): void {
    stdout.write((pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) + '\n');
  }

  function emitErr(error: unknown, status?: number): void {
    const obj: Record<string, unknown> = { error };
    if (status !== undefined) obj['status'] = status;
    stderr.write(JSON.stringify(obj) + '\n');
  }

  function headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  async function readData(res: Response): Promise<unknown> {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return res.json();
    const text = await res.text();
    return text || null;
  }

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    const init: RequestInit = { method, headers: headers(body !== undefined) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetchFn(`${baseUrl}${path}`, init);
    return { status: res.status, data: await readData(res) };
  }

  /** Simple call: emit body on 2xx, error + exit 1 on HTTP error. */
  async function simple(method: string, path: string, body?: unknown): Promise<number> {
    const r = await call(method, path, body);
    if (r.status >= 400) { emitErr(r.data, r.status); return 1; }
    emit(r.data);
    return 0;
  }

  function needTenant(): string | null {
    if (!tenant) { emitErr('--tenant <slug> required'); return null; }
    return tenant;
  }

  /** --assessment, else the latest snapshot id from GET /api/assessment. */
  async function resolveAssessmentId(slug: string): Promise<string | null> {
    const given = str('assessment');
    if (given) return given;
    const r = await call('GET', `/api/assessment?tenant=${encodeURIComponent(slug)}`);
    if (r.status >= 400) { emitErr(r.data, r.status); return null; }
    const id = (r.data as { snapshotId?: unknown } | null)?.snapshotId;
    if (typeof id !== 'string' || !id) { emitErr('latest assessment has no snapshotId; pass --assessment <id>'); return null; }
    return id;
  }

  const group = positionals[0];
  const sub = positionals[1];

  if (!group || group === 'help') {
    stdout.write(USAGE);
    return 0;
  }

  // ── status ─────────────────────────────────────────────────────────────────
  if (group === 'status') {
    return simple('GET', '/api/health');
  }

  // ── assess (SSE) ───────────────────────────────────────────────────────────
  if (group === 'assess') {
    const slug = needTenant();
    if (!slug) return 1;
    const res = await fetchFn(`${baseUrl}/api/assess?tenant=${encodeURIComponent(slug)}`, {
      method: 'GET',
      headers: { ...headers(false), Accept: 'text/event-stream' },
    });
    if (res.status >= 400) { emitErr(await readData(res), res.status); return 1; }
    if (!res.body) { emitErr('assess: empty response body'); return 1; }
    let terminal: 'assess_done' | 'assess_error' | null = null;
    let buf = '';
    const decoder = new TextDecoder();
    const handleBlock = (block: string): void => {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) return;
      let evt: unknown;
      try { evt = JSON.parse(data); } catch { evt = { type: 'raw', data }; }
      const type = (evt as { type?: unknown }).type;
      if (type === 'assess_done' || type === 'assess_error') terminal = type;
      emit(evt);
    };
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const m = /\r?\n\r?\n/.exec(buf.slice(idx))!;
        handleBlock(buf.slice(0, idx));
        buf = buf.slice(idx + m[0].length);
      }
    }
    buf += decoder.decode();
    if (buf.trim()) handleBlock(buf);
    if (terminal === 'assess_done') return 0;
    emitErr(terminal === 'assess_error' ? 'assess ended with assess_error' : 'assess stream ended without a terminal event');
    return 1;
  }

  // ── ssp generate ───────────────────────────────────────────────────────────
  if (group === 'ssp') {
    if (sub !== 'generate') { stderr.write(USAGE); return 2; }
    const slug = needTenant();
    if (!slug) return 1;
    const aid = await resolveAssessmentId(slug);
    if (!aid) return 1;
    return simple('POST', '/api/ssp/generate', { tenantSlug: slug, assessmentId: aid });
  }

  // ── poam [generate] ────────────────────────────────────────────────────────
  if (group === 'poam') {
    if (sub !== undefined && sub !== 'generate') { stderr.write(USAGE); return 2; }
    const slug = needTenant();
    if (!slug) return 1;
    const aid = await resolveAssessmentId(slug);
    if (!aid) return 1;
    return simple('POST', '/api/poam/generate', { tenantSlug: slug, assessmentId: aid });
  }

  // ── package build ──────────────────────────────────────────────────────────
  if (group === 'package') {
    if (sub !== 'build') { stderr.write(USAGE); return 2; }
    const slug = needTenant();
    if (!slug) return 1;
    const out = str('out');
    if (!out) { emitErr('--out <file.zip> required'); return 1; }
    const b = await call('POST', '/api/package/build', { tenant: slug });
    if (b.status >= 400) { emitErr(b.data, b.status); return 1; }
    const built = b.data as { packageId?: string; filePath?: string; fileCount?: number; sizeBytes?: number } | null;
    const filePath = built?.filePath;
    if (typeof filePath !== 'string' || !filePath) { emitErr('package build response has no filePath'); return 1; }
    const filename = basename(filePath.replace(/\\/g, '/'));
    const dl = await fetchFn(
      `${baseUrl}/api/package/download/${encodeURIComponent(filename)}?tenant=${encodeURIComponent(slug)}`,
      { method: 'GET', headers: headers(false) },
    );
    if (dl.status >= 400) { emitErr(await readData(dl), dl.status); return 1; }
    const bytes = Buffer.from(await dl.arrayBuffer());
    const outPath = resolve(out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, bytes);
    emit({
      packageId: built?.packageId,
      filename,
      fileCount: built?.fileCount,
      sizeBytes: built?.sizeBytes,
      out: outPath,
      bytesWritten: bytes.length,
    });
    return 0;
  }

  // ── policies import ────────────────────────────────────────────────────────
  if (group === 'policies') {
    if (sub !== 'import') { stderr.write(USAGE); return 2; }
    const slug = needTenant();
    if (!slug) return 1;
    const file = str('file');
    if (!file) { emitErr('--file <path> required'); return 1; }
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(file, 'utf-8')); }
    catch (err) { emitErr(`cannot read ${file}: ${(err as Error).message}`); return 1; }
    const policies = Array.isArray(parsed) ? parsed : (parsed as { policies?: unknown } | null)?.policies;
    if (!Array.isArray(policies)) { emitErr('--file must hold a policy array or {"policies":[...]}'); return 1; }
    return simple('POST', '/api/policies/import', { tenantSlug: slug, policies });
  }

  // ── review (FIN-12, NS-audit F-3) ──────────────────────────────────────────
  // POST /api/reviews body {tenant, controlId, objectiveId, artifactHash, verdict, notes?}; the
  // reviewer is proven by a minted approver token in x-ces-principal (GD-b: the route refuses a
  // reviewer who uploaded the artifact, 403 reviewer_is_uploader). --file hashes a local copy of the
  // artifact (sha256, as EC records it) instead of --hash.
  if (group === 'review') {
    const slug = needTenant();
    if (!slug) return 1;
    if (sub === 'list') {
      const q = new URLSearchParams({ tenant: slug });
      const control = str('control');
      if (control) q.set('controlId', control);
      if (flags.get('history') === true) q.set('history', '1');
      return simple('GET', `/api/reviews?${q.toString()}`);
    }
    if (sub !== undefined) { stderr.write(USAGE); return 2; }
    const controlId = str('control');
    const objectiveId = str('objective');
    const verdict = str('verdict');
    const notes = str('notes');
    if (!controlId) { emitErr('--control <controlId> required'); return 1; }
    if (!objectiveId) { emitErr('--objective <objectiveId> required'); return 1; }
    if (verdict !== 'met' && verdict !== 'not_met') { emitErr('--verdict must be met or not_met'); return 1; }
    let artifactHash = str('hash');
    const file = str('file');
    if (artifactHash && file) { emitErr('pass --hash or --file, not both'); return 1; }
    if (file) {
      try { artifactHash = createHash('sha256').update(readFileSync(file)).digest('hex'); }
      catch (err) { emitErr(`cannot read ${file}: ${(err as Error).message}`); return 1; }
    }
    if (!artifactHash) { emitErr('--hash <sha256> or --file <path> required'); return 1; }
    const approverToken = str('approver-token') ?? env['CES_EO_APPROVER_TOKEN'];
    if (!approverToken) { emitErr('--approver-token <token> (or CES_EO_APPROVER_TOKEN) required: a minted approver token proves the reviewer'); return 1; }
    const body = { tenant: slug, controlId, objectiveId, artifactHash, verdict, ...(notes ? { notes } : {}) };
    const res = await fetchFn(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { ...headers(true), 'x-ces-principal': approverToken },
      body: JSON.stringify(body),
    });
    const data = await readData(res);
    if (res.status >= 400) { emitErr(data, res.status); return 1; }
    emit(data);
    return 0;
  }

  stderr.write(USAGE);
  return 2;
}
