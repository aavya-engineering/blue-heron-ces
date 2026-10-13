// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * mu.ts — thin CLI that drives the full muster-api over HTTP.
 *
 * Design:
 *  - No new runtime dependencies. Hand-rolled argv parsing, native fetch (Node 24).
 *  - Testable core: export runMu(argv, deps?) : Promise<number>
 *  - Config: --api-url > MU_API_URL > http://localhost:4000
 *  - Token:  --token  > MU_TOKEN   > ~/.muster/credentials.json
 *
 * Exit codes:
 *   0  success
 *   1  error (HTTP 4xx/5xx, bad args)
 *   2  unknown command / usage error
 *   3  HTTP 503 {degraded:true}
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { runDiscoveryCli } from './discoveryCli.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StoredCred {
  token: string;
  api_url: string;
  email: string;
  saved_at: string;
}

export interface CredStore {
  load(): Promise<StoredCred | null>;
  save(cred: StoredCred): Promise<void>;
  delete(): Promise<void>;
}

export interface MuDeps {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  stdout?: { write: (s: string) => void };
  stderr?: { write: (s: string) => void };
  env?: Record<string, string | undefined>;
  credStore?: CredStore;
}

// ── File CredStore ─────────────────────────────────────────────────────────────

function defaultCredPath(): string {
  return join(homedir(), '.muster', 'credentials.json');
}

export function makeFileCredStore(credPath: string): CredStore {
  return {
    async load(): Promise<StoredCred | null> {
      try {
        const raw = readFileSync(credPath, 'utf-8');
        return JSON.parse(raw) as StoredCred;
      } catch {
        return null;
      }
    },
    async save(cred: StoredCred): Promise<void> {
      mkdirSync(dirname(credPath), { recursive: true });
      writeFileSync(credPath, JSON.stringify(cred, null, 2), 'utf-8');
    },
    async delete(): Promise<void> {
      try {
        unlinkSync(credPath);
      } catch {
        // ignore if already absent
      }
    },
  };
}

export function makeMemoryCredStore(): CredStore {
  let stored: StoredCred | null = null;
  return {
    async load() { return stored; },
    async save(c) { stored = c; },
    async delete() { stored = null; },
  };
}

// ── Arg Parsing ────────────────────────────────────────────────────────────────

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

// ── HTTP ───────────────────────────────────────────────────────────────────────

interface ApiResult {
  status: number;
  data: unknown;
}

async function apiCall(
  method: string,
  path: string,
  body: unknown,
  token: string | null,
  baseUrl: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>,
  extraHeaders?: Record<string, string>
): Promise<ApiResult> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (extraHeaders) Object.assign(headers, extraHeaders);

  const init: RequestInit = { method, headers };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
  }

  const res = await fetchFn(url, init);
  let data: unknown;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    data = await res.json();
  } else {
    const text = await res.text();
    data = text || null;
  }
  return { status: res.status, data };
}

// ── File / stdin reader ────────────────────────────────────────────────────────

async function readBody(filePath: string): Promise<unknown> {
  if (filePath === '@-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk as ArrayBuffer));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  }
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ── Usage ──────────────────────────────────────────────────────────────────────

const USAGE = `mu — muster-api CLI

Usage: mu [--api-url URL] [--token TOKEN] [--pretty] <command> [args]

Auth:
  mu login --email <e> --password <p>         Authenticate; store token
  mu logout                                    Delete stored credentials
  mu whoami                                    GET /auth/me

Engagements:
  mu engagements list
  mu engagements create --kind <individual_contractor|prime_and_subs>
  mu engagements get <id>
  mu engagements progress <id>

Parties:
  mu parties list --engagement <id>
  mu parties get <id>
  mu parties action <partyId> <action> [--notes <text>]
    actions: send-nudge-now | mark-abandoned | disposition-ready |
             disposition-validate | convert-to-enclave |
             schedule-reassessment | opt-out

Contracts:
  mu contracts list
  mu contracts get <id>
  mu contracts create --file <path|@->
  mu contracts update <id> --file <path|@->
  mu contracts delete <id>

Sessions:
  mu sessions get <id>
  mu sessions sync --file <path|@->

HIL:
  mu hil queue
  mu hil flag --file <path|@->
  mu hil resolve <id> --minutes <n>

Interview:
  mu interview next --file <path|@->
  mu interview retro --file <path|@->

Coach:
  mu coach chat --file <path|@->

Harvest:
  mu harvest run --file <path|@->
    (consent-url is retired: live reads use the device-code consent on
     /api/live, then run with {"live":true,"engagement_id","consent_id"})

Discovery:
  mu discovery --sim [--out <file>] [--slug <slug>]
    Runs the DISCOVERY-1 executor's registry walk against an already-running
    stacksim sim (127.0.0.1:4390 — start it yourself, this never boots/resets
    it) and writes a schema-valid readiness-result.v1 file to --out (default
    ./discovery-result.json). Local, no --api-url/--token involved.

SPRS:
  mu sprs score --file <path|@->

Nudges:
  mu nudges tick [--now <ISO>] [--engagement <id>]
  mu nudges digest --engagement <id> [--now <ISO>]

Reassessment:
  mu reassessment tick [--now <ISO>]
  mu reassessment drift-check --file <path|@->

Recipes:
  mu recipes list
  mu recipes ingest --file <path|@-> [--concierge]

Touch:
  mu touch report --engagement <id>
  mu touch record --file <path|@->

Global flags:
  --api-url URL    Override API base URL (env: MU_API_URL; default: http://localhost:4000)
  --token TOKEN    Bearer token (env: MU_TOKEN; skips credential file)
  --pretty         Pretty-print JSON output

Exit codes:
  0  success
  1  error (HTTP error, bad arguments)
  2  unknown command / usage error
  3  API degraded (HTTP 503 {degraded:true})
`;

// ── Main export ────────────────────────────────────────────────────────────────

export async function runMu(argv: string[], deps: MuDeps = {}): Promise<number> {
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const fetchFn = deps.fetchImpl ?? (globalThis.fetch as (url: string, init?: RequestInit) => Promise<Response>);
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const credStore = deps.credStore ?? makeFileCredStore(defaultCredPath());

  const { flags, positionals } = parseArgs(argv);

  const baseUrl = (flags.get('api-url') as string | undefined) ?? env['MU_API_URL'] ?? 'http://localhost:4000';
  const pretty = flags.get('pretty') === true;

  const group = positionals[0];

  // ── Output helpers ─────────────────────────────────────────────────────────

  function emit(data: unknown): void {
    stdout.write((pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) + '\n');
  }

  function emitErr(error: unknown, status?: number): void {
    const obj: Record<string, unknown> = { error };
    if (status !== undefined) obj['status'] = status;
    stderr.write(JSON.stringify(obj) + '\n');
  }

  // ── Token resolution ───────────────────────────────────────────────────────

  async function getToken(): Promise<string | null> {
    const fromFlag = flags.get('token') as string | undefined;
    if (fromFlag) return fromFlag;
    const fromEnv = env['MU_TOKEN'];
    if (fromEnv) return fromEnv;
    const cred = await credStore.load();
    return cred?.token ?? null;
  }

  // ── call: wraps apiCall and maps to exit code ──────────────────────────────

  async function call(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<{ code: number; data: unknown }> {
    const token = await getToken();
    const r = await apiCall(method, path, body, token, baseUrl, fetchFn, extraHeaders);
    if (
      r.status === 503 &&
      typeof r.data === 'object' &&
      r.data !== null &&
      'degraded' in (r.data as Record<string, unknown>)
    ) {
      return { code: 3, data: r.data };
    }
    if (r.status >= 400) return { code: 1, data: r.data };
    return { code: 0, data: r.data };
  }

  // ── help / default ─────────────────────────────────────────────────────────

  if (!group || group === 'help') {
    stdout.write(USAGE);
    return 0;
  }

  // ── discovery ──────────────────────────────────────────────────────────────
  // Local: runs the DISCOVERY-1 executor directly (no HTTP call to muster-api),
  // so --api-url/--token/getToken() are irrelevant here.

  if (group === 'discovery') {
    return runDiscoveryCli(flags, { stdout, stderr });
  }

  // ── login ──────────────────────────────────────────────────────────────────

  if (group === 'login') {
    const email = (flags.get('email') as string | undefined) ?? env['MU_EMAIL'];
    const password = (flags.get('password') as string | undefined) ?? env['MU_PASSWORD'];
    if (!email || !password) {
      emitErr('--email and --password required (or MU_EMAIL / MU_PASSWORD env vars)');
      return 1;
    }
    const r = await call('POST', '/auth/login', { email, password });
    if (r.code === 3) { emitErr((r.data as Record<string, unknown>), 503); return 3; }
    if (r.code !== 0) { emitErr((r.data as Record<string, unknown>)['error'] ?? r.data, r.code); return 1; }
    const token = (r.data as Record<string, unknown>)['token'] as string;
    await credStore.save({ token, api_url: baseUrl, email, saved_at: new Date().toISOString() });
    emit(r.data);
    return 0;
  }

  // ── logout ─────────────────────────────────────────────────────────────────

  if (group === 'logout') {
    await credStore.delete();
    emit({ ok: true });
    return 0;
  }

  // ── whoami ─────────────────────────────────────────────────────────────────

  if (group === 'whoami') {
    const r = await call('GET', '/auth/me');
    if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
    emit(r.data);
    return 0;
  }

  // ── engagements ────────────────────────────────────────────────────────────

  if (group === 'engagements') {
    const sub = positionals[1];

    if (sub === 'list') {
      const r = await call('GET', '/api/engagements');
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'create') {
      const kind = flags.get('kind') as string | undefined;
      if (!kind) { emitErr('--kind required'); return 1; }
      const r = await call('POST', '/api/engagements', { engagement_kind: kind });
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'get') {
      const id = positionals[2];
      if (!id) { emitErr('<id> required'); return 1; }
      const r = await call('GET', `/api/engagements/${id}`);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'progress') {
      const id = positionals[2];
      if (!id) { emitErr('<id> required'); return 1; }
      const r = await call('GET', `/api/engagements/${id}/progress`);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── parties ────────────────────────────────────────────────────────────────

  if (group === 'parties') {
    const sub = positionals[1];

    if (sub === 'list') {
      const engId = flags.get('engagement') as string | undefined;
      if (!engId) { emitErr('--engagement <id> required'); return 1; }
      const r = await call('GET', `/api/engagements/${engId}/parties`);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'get') {
      const id = positionals[2];
      if (!id) { emitErr('<id> required'); return 1; }
      const r = await call('GET', `/api/parties/${id}`);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'action') {
      const partyId = positionals[2];
      const action = positionals[3];
      if (!partyId || !action) { emitErr('<partyId> and <action> required'); return 1; }
      const notes = flags.get('notes') as string | undefined;
      const body: Record<string, unknown> = {};
      if (notes) body['notes'] = notes;
      const r = await call('POST', `/api/parties/${partyId}/actions/${action}`, Object.keys(body).length ? body : undefined);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── contracts ──────────────────────────────────────────────────────────────

  if (group === 'contracts') {
    const sub = positionals[1];

    if (sub === 'list') {
      const r = await call('GET', '/api/contracts');
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'get') {
      const id = positionals[2];
      if (!id) { emitErr('<id> required'); return 1; }
      const r = await call('GET', `/api/contracts/${id}`);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'create') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/contracts', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'update') {
      const id = positionals[2];
      const file = flags.get('file') as string | undefined;
      if (!id) { emitErr('<id> required'); return 1; }
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('PUT', `/api/contracts/${id}`, body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'delete') {
      const id = positionals[2];
      if (!id) { emitErr('<id> required'); return 1; }
      const r = await call('DELETE', `/api/contracts/${id}`);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit({ ok: true });
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── sessions ───────────────────────────────────────────────────────────────

  if (group === 'sessions') {
    const sub = positionals[1];

    if (sub === 'get') {
      const id = positionals[2];
      if (!id) { emitErr('<id> required'); return 1; }
      const r = await call('GET', `/api/sessions/${id}`);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'sync') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/sessions/sync', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── hil ────────────────────────────────────────────────────────────────────

  if (group === 'hil') {
    const sub = positionals[1];

    if (sub === 'queue') {
      const r = await call('GET', '/api/hil/queue');
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'flag') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/hil/flag', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'resolve') {
      const id = positionals[2];
      const minutesStr = flags.get('minutes') as string | undefined;
      if (!id) { emitErr('<id> required'); return 1; }
      if (!minutesStr) { emitErr('--minutes required'); return 1; }
      const minutes = parseFloat(minutesStr);
      if (isNaN(minutes)) { emitErr('--minutes must be a number'); return 1; }
      const r = await call('POST', `/api/hil/queue/${id}/resolve`, { advisor_minutes: minutes });
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── interview ──────────────────────────────────────────────────────────────

  if (group === 'interview') {
    const sub = positionals[1];

    if (sub === 'next') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/interview/adaptive/next', body);
      if (r.code === 3) { emitErr(r.data, 503); return 3; }
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'retro') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/interview/retro-confidence', body);
      if (r.code === 3) { emitErr(r.data, 503); return 3; }
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── coach ──────────────────────────────────────────────────────────────────

  if (group === 'coach') {
    const sub = positionals[1];

    if (sub === 'chat') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/coach/chat', body);
      if (r.code === 3) { emitErr(r.data, 503); return 3; }
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── harvest ────────────────────────────────────────────────────────────────

  if (group === 'harvest') {
    const sub = positionals[1];

    if (sub === 'consent-url') {
      // FC-MU-3: retired with the client-secret routes. No request is made.
      stderr.write('mu harvest consent-url is retired: the client-secret consent flow was removed. Use the device-code consent (POST /api/live/engagements/<id>/consent), then mu harvest run with {"live":true,"engagement_id":…,"consent_id":…}.\n');
      return 2;
    }

    if (sub === 'run') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/harvest/run', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── sprs ───────────────────────────────────────────────────────────────────

  if (group === 'sprs') {
    const sub = positionals[1];

    if (sub === 'score') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/sprs/score', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── nudges ─────────────────────────────────────────────────────────────────

  if (group === 'nudges') {
    const sub = positionals[1];

    if (sub === 'tick') {
      const body: Record<string, unknown> = {};
      const now = flags.get('now') as string | undefined;
      const engId = flags.get('engagement') as string | undefined;
      if (now) body['now'] = now;
      if (engId) body['engagement_id'] = engId;
      const r = await call('POST', '/api/nudges/tick', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'digest') {
      const engId = flags.get('engagement') as string | undefined;
      if (!engId) { emitErr('--engagement <id> required'); return 1; }
      const body: Record<string, unknown> = { engagement_id: engId };
      const now = flags.get('now') as string | undefined;
      if (now) body['now'] = now;
      const r = await call('POST', '/api/nudges/digest', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── reassessment ───────────────────────────────────────────────────────────

  if (group === 'reassessment') {
    const sub = positionals[1];

    if (sub === 'tick') {
      const body: Record<string, unknown> = {};
      const now = flags.get('now') as string | undefined;
      if (now) body['now'] = now;
      const r = await call('POST', '/api/reassessment/tick', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'drift-check') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/reassessment/drift-check', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── recipes ────────────────────────────────────────────────────────────────

  if (group === 'recipes') {
    const sub = positionals[1];

    if (sub === 'list') {
      const r = await call('GET', '/api/recipes');
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'ingest') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const extraHeaders: Record<string, string> = {};
      if (flags.get('concierge') === true) {
        extraHeaders['x-concierge-session'] = 'true';
      }
      const r = await call('POST', '/api/recipes/ingest', body, extraHeaders);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── touch ──────────────────────────────────────────────────────────────────

  if (group === 'touch') {
    const sub = positionals[1];

    if (sub === 'report') {
      const engId = flags.get('engagement') as string | undefined;
      if (!engId) { emitErr('--engagement <id> required'); return 1; }
      const r = await call('GET', `/api/touch/report?engagement_id=${encodeURIComponent(engId)}`);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    if (sub === 'record') {
      const file = flags.get('file') as string | undefined;
      if (!file) { emitErr('--file required'); return 1; }
      const body = await readBody(file);
      const r = await call('POST', '/api/touch/events', body);
      if (r.code !== 0) { emitErr(r.data, r.code); return r.code; }
      emit(r.data);
      return 0;
    }

    stderr.write(USAGE);
    return 2;
  }

  // ── unknown ────────────────────────────────────────────────────────────────

  stderr.write(USAGE);
  return 2;
}
