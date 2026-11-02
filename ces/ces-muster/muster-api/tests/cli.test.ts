// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * cli.test.ts — unit + integration tests for the `mu` CLI.
 *
 * Unit section: injected fetchImpl mock asserts method/path/body/headers.
 * Integration section: boots a real express app on port 0, runs runMu end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import bcrypt from 'bcryptjs';

import { runMu, makeMemoryCredStore, type MuDeps, type CredStore } from '../src/cli/mu.js';
import { createEngagementsRouter } from '../src/routes/engagements.js';
import { createContractsRouter } from '../src/routes/contracts.js';
import { createNudgesRouter } from '../src/routes/nudges.js';
import { mintToken } from '../src/lib/jwt.js';
import { bearerAuth } from '../src/middleware/auth.js';
import { createMockDb } from './helpers/mockDb.js';
import sprsRouter from '../src/routes/sprs.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const TENANT = '00000000-test-0000-0000-000000000001';
const ENG_ID = '00000000-0000-aaaa-0000-000000000001';

function bhdToken(): string {
  return mintToken({ sub: 'user-bhd', tenant_id: TENANT, party_id: null, role: 'bhd_operator' });
}

/** Capture stdout/stderr writes into strings. */
function captureStreams() {
  let out = '';
  let err = '';
  return {
    stdout: { write: (s: string) => { out += s; } },
    stderr: { write: (s: string) => { err += s; } },
    getOut: () => out,
    getErr: () => err,
  };
}

/** Build a deps object with a mock fetch that returns a pre-built response. */
function mockDeps(
  responseBody: unknown,
  status = 200,
  onCall?: (url: string, init: RequestInit) => void,
  credStore?: CredStore
): MuDeps & { streams: ReturnType<typeof captureStreams> } {
  const streams = captureStreams();
  const store = credStore ?? makeMemoryCredStore();
  return {
    fetchImpl: async (url: string, init: RequestInit = {}) => {
      onCall?.(url, init);
      const body = JSON.stringify(responseBody);
      return new Response(body, {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    stdout: streams.stdout,
    stderr: streams.stderr,
    env: { MU_TOKEN: bhdToken(), MU_API_URL: 'http://test.local' },
    credStore: store,
    streams,
  };
}

/** Write JSON to a temp file, return path. */
function tmpJson(obj: unknown): string {
  const dir = join(tmpdir(), 'mu-test');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(obj), 'utf-8');
  return p;
}

// ── Unit tests ─────────────────────────────────────────────────────────────────

describe('mu CLI — unit (mock fetch)', () => {

  // ── help ──────────────────────────────────────────────────────────────────

  it('help: no args → exit 0 + usage on stdout', async () => {
    const streams = captureStreams();
    const code = await runMu([], {
      fetchImpl: async () => { throw new Error('should not fetch'); },
      stdout: streams.stdout,
      stderr: streams.stderr,
      env: {},
      credStore: makeMemoryCredStore(),
    });
    expect(code).toBe(0);
    expect(streams.getOut()).toContain('mu — muster-api CLI');
  });

  it('help: unknown command → exit 2 + usage on stderr', async () => {
    const streams = captureStreams();
    const code = await runMu(['xyzzy'], {
      fetchImpl: async () => { throw new Error('should not fetch'); },
      stdout: streams.stdout,
      stderr: streams.stderr,
      env: {},
      credStore: makeMemoryCredStore(),
    });
    expect(code).toBe(2);
    expect(streams.getErr()).toContain('mu — muster-api CLI');
  });

  // ── login ─────────────────────────────────────────────────────────────────

  it('login: POST /auth/login with email+password, writes credStore', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const store = makeMemoryCredStore();
    const streams = captureStreams();
    const code = await runMu(
      ['login', '--email', 'ops@bhd.test', '--password', 'secret'],
      {
        fetchImpl: async (url, init = {}) => {
          captured = { url, init };
          return new Response(JSON.stringify({ token: 'tok-abc' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        stdout: streams.stdout,
        stderr: streams.stderr,
        env: { MU_API_URL: 'http://api.test' },
        credStore: store,
      }
    );
    expect(code).toBe(0);
    expect(captured?.url).toBe('http://api.test/auth/login');
    expect(captured?.init.method).toBe('POST');
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toEqual({ email: 'ops@bhd.test', password: 'secret' });
    const cred = await store.load();
    expect(cred?.token).toBe('tok-abc');
    expect(cred?.email).toBe('ops@bhd.test');
  });

  // ── whoami ────────────────────────────────────────────────────────────────

  it('whoami: GET /auth/me with Bearer token', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const d = mockDeps({ sub: 'user-1', role: 'bhd_operator' }, 200, (url, init) => {
      capturedHeaders = init.headers as Record<string, string>;
    });
    const code = await runMu(['whoami'], d);
    expect(code).toBe(0);
    expect(capturedHeaders?.['Authorization']).toMatch(/^Bearer /);
    expect(d.streams.getOut()).toContain('bhd_operator');
  });

  // ── engagements list ──────────────────────────────────────────────────────

  it('engagements list: GET /api/engagements', async () => {
    let capturedUrl = '';
    const d = mockDeps([{ id: ENG_ID, engagement_kind: 'prime_and_subs' }], 200, (url) => { capturedUrl = url; });
    const code = await runMu(['engagements', 'list'], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain('/api/engagements');
    const parsed = JSON.parse(d.streams.getOut());
    expect(Array.isArray(parsed)).toBe(true);
  });

  // ── engagements create ────────────────────────────────────────────────────

  it('engagements create: POST /api/engagements with engagement_kind', async () => {
    let capturedBody: unknown;
    let capturedMethod = '';
    const d = mockDeps({ id: 'new-id', engagement_kind: 'prime_and_subs' }, 201, (url, init) => {
      capturedMethod = init.method ?? '';
      capturedBody = JSON.parse(init.body as string);
    });
    const code = await runMu(['engagements', 'create', '--kind', 'prime_and_subs'], d);
    expect(code).toBe(0);
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ engagement_kind: 'prime_and_subs' });
  });

  // ── engagements get ───────────────────────────────────────────────────────

  it('engagements get: GET /api/engagements/:id', async () => {
    let capturedUrl = '';
    const d = mockDeps({ id: ENG_ID }, 200, (url) => { capturedUrl = url; });
    const code = await runMu(['engagements', 'get', ENG_ID], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain(`/api/engagements/${ENG_ID}`);
  });

  // ── engagements progress ──────────────────────────────────────────────────

  it('engagements progress: GET /api/engagements/:id/progress', async () => {
    let capturedUrl = '';
    const d = mockDeps({ parties: [] }, 200, (url) => { capturedUrl = url; });
    const code = await runMu(['engagements', 'progress', ENG_ID], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain(`/api/engagements/${ENG_ID}/progress`);
  });

  // ── parties list ──────────────────────────────────────────────────────────

  it('parties list: GET /api/engagements/:id/parties', async () => {
    let capturedUrl = '';
    const d = mockDeps([], 200, (url) => { capturedUrl = url; });
    const code = await runMu(['parties', 'list', '--engagement', ENG_ID], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain(`/api/engagements/${ENG_ID}/parties`);
  });

  // ── parties action ────────────────────────────────────────────────────────

  it('parties action: POST /api/parties/:id/actions/:action with optional notes', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    const PARTY_ID = 'party-uuid-001';
    const d = mockDeps({ party: {}, action: 'mark-abandoned' }, 200, (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
    });
    const code = await runMu(['parties', 'action', PARTY_ID, 'mark-abandoned', '--notes', 'no response'], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain(`/api/parties/${PARTY_ID}/actions/mark-abandoned`);
    expect((capturedBody as Record<string, unknown>)['notes']).toBe('no response');
  });

  // ── contracts create (--file) ─────────────────────────────────────────────

  it('contracts create: POST /api/contracts with --file body', async () => {
    const contractBody = {
      party_id: 'p-001',
      engagement_id: ENG_ID,
      contract_number: 'FA8621-22-C-0001',
      program_name: 'Test',
      cmmc_level_required: 2,
      cui_categories: ['CTI'],
    };
    const file = tmpJson(contractBody);
    let capturedUrl = '';
    let capturedBody: unknown;
    let capturedMethod = '';
    const d = mockDeps({ id: 'c-001', ...contractBody }, 201, (url, init) => {
      capturedUrl = url;
      capturedMethod = init.method ?? '';
      capturedBody = JSON.parse(init.body as string);
    });
    const code = await runMu(['contracts', 'create', '--file', file], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain('/api/contracts');
    expect(capturedMethod).toBe('POST');
    expect((capturedBody as Record<string, unknown>)['contract_number']).toBe('FA8621-22-C-0001');
  });

  // ── hil resolve (--minutes) ───────────────────────────────────────────────

  it('hil resolve: POST /api/hil/queue/:id/resolve with advisor_minutes', async () => {
    const HIL_ID = 'hil-001';
    let capturedUrl = '';
    let capturedBody: unknown;
    const d = mockDeps({ id: HIL_ID, resolved: true }, 200, (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
    });
    const code = await runMu(['hil', 'resolve', HIL_ID, '--minutes', '12.5'], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain(`/api/hil/queue/${HIL_ID}/resolve`);
    expect((capturedBody as Record<string, unknown>)['advisor_minutes']).toBe(12.5);
  });

  // ── sprs score (--file) ───────────────────────────────────────────────────

  it('sprs score: POST /api/sprs/score with file body', async () => {
    const scoreBody = {
      requirement_results: [
        { requirement_id: 'AC.1.001', status: 'met' },
        { requirement_id: 'AC.1.002', status: 'not_met' },
      ],
    };
    const file = tmpJson(scoreBody);
    let capturedUrl = '';
    let capturedBody: unknown;
    const d = mockDeps({ sprs: 108, assessed_count: 2, deductions: [] }, 200, (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
    });
    const code = await runMu(['sprs', 'score', '--file', file], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain('/api/sprs/score');
    expect((capturedBody as Record<string, unknown>)['requirement_results']).toHaveLength(2);
  });

  // ── nudges tick (--now, --engagement) ────────────────────────────────────

  it('nudges tick: POST /api/nudges/tick with now + engagement_id', async () => {
    const NOW = '2026-01-01T00:00:00.000Z';
    let capturedBody: unknown;
    const d = mockDeps({ fired: [] }, 200, (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
    });
    const code = await runMu(['nudges', 'tick', '--now', NOW, '--engagement', ENG_ID], d);
    expect(code).toBe(0);
    expect((capturedBody as Record<string, unknown>)['now']).toBe(NOW);
    expect((capturedBody as Record<string, unknown>)['engagement_id']).toBe(ENG_ID);
  });

  // ── recipes ingest --concierge (x-concierge-session header) ──────────────

  it('recipes ingest --concierge: sends x-concierge-session: true header', async () => {
    const ingestBody = { recipe_name: 'mfa-audit', output: {} };
    const file = tmpJson(ingestBody);
    let capturedHeaders: Record<string, string> | undefined;
    const d = mockDeps({ facts: [] }, 200, (_url, init) => {
      capturedHeaders = init.headers as Record<string, string>;
    });
    const code = await runMu(['recipes', 'ingest', '--file', file, '--concierge'], d);
    expect(code).toBe(0);
    expect(capturedHeaders?.['x-concierge-session']).toBe('true');
  });

  // ── sessions sync ─────────────────────────────────────────────────────────

  it('sessions sync: POST /api/sessions/sync with --file body', async () => {
    const sessionBody = {
      id: 'sess-001',
      party_id: 'party-001',
      facts: {},
      timing_segments: [],
      selected_stacks: ['AWS'],
      status: 'in_progress',
    };
    const file = tmpJson(sessionBody);
    let capturedUrl = '';
    const d = mockDeps(sessionBody, 200, (url) => { capturedUrl = url; });
    const code = await runMu(['sessions', 'sync', '--file', file], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain('/api/sessions/sync');
  });

  // ── touch report ──────────────────────────────────────────────────────────

  it('touch report: GET /api/touch/report?engagement_id=...', async () => {
    let capturedUrl = '';
    const d = mockDeps({ total_minutes: 0, events: [] }, 200, (url) => { capturedUrl = url; });
    const code = await runMu(['touch', 'report', '--engagement', ENG_ID], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain(`/api/touch/report?engagement_id=${encodeURIComponent(ENG_ID)}`);
  });

  // ── reassessment drift-check ──────────────────────────────────────────────

  it('reassessment drift-check: POST /api/reassessment/drift-check with --file', async () => {
    const driftBody = {
      party_id: 'party-001',
      previous_facts: [{ question_id: 'q1', answer: 'yes', provenance: 'auto' }],
      current_facts: [{ question_id: 'q1', answer: 'no', provenance: 'auto' }],
    };
    const file = tmpJson(driftBody);
    let capturedUrl = '';
    const d = mockDeps({ drift_count: 1, alerts: [] }, 201, (url) => { capturedUrl = url; });
    const code = await runMu(['reassessment', 'drift-check', '--file', file], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain('/api/reassessment/drift-check');
  });

  // ── hil queue ─────────────────────────────────────────────────────────────

  it('hil queue: GET /api/hil/queue', async () => {
    let capturedUrl = '';
    const d = mockDeps([], 200, (url) => { capturedUrl = url; });
    const code = await runMu(['hil', 'queue'], d);
    expect(code).toBe(0);
    expect(capturedUrl).toContain('/api/hil/queue');
  });

  // ── nudges digest ─────────────────────────────────────────────────────────

  it('nudges digest: POST /api/nudges/digest with engagement + now', async () => {
    const NOW = '2026-06-01T00:00:00.000Z';
    let capturedBody: unknown;
    const d = mockDeps({ digest: null }, 200, (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
    });
    const code = await runMu(['nudges', 'digest', '--engagement', ENG_ID, '--now', NOW], d);
    expect(code).toBe(0);
    expect((capturedBody as Record<string, unknown>)['engagement_id']).toBe(ENG_ID);
    expect((capturedBody as Record<string, unknown>)['now']).toBe(NOW);
  });

  // (harvest consent-url retired in FC-MU-3 — harvest.retired.test.ts)

  // ── degraded 503 → exit 3 ─────────────────────────────────────────────────

  it('degraded: 503 {degraded:true} → exit code 3', async () => {
    const streams = captureStreams();
    const code = await runMu(
      ['interview', 'next', '--file', tmpJson({ sessionId: 's1', priorFacts: [], stacks: [], remainingQuestions: [] })],
      {
        fetchImpl: async () => new Response(JSON.stringify({ degraded: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
        stdout: streams.stdout,
        stderr: streams.stderr,
        env: { MU_TOKEN: bhdToken() },
        credStore: makeMemoryCredStore(),
      }
    );
    expect(code).toBe(3);
  });

  // ── --pretty flag ─────────────────────────────────────────────────────────

  it('--pretty: output is indented JSON', async () => {
    const streams = captureStreams();
    const code = await runMu(
      ['engagements', 'list', '--pretty'],
      {
        fetchImpl: async () => new Response(JSON.stringify([{ id: '1' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        stdout: streams.stdout,
        stderr: streams.stderr,
        env: { MU_TOKEN: bhdToken() },
        credStore: makeMemoryCredStore(),
      }
    );
    expect(code).toBe(0);
    // Pretty-printed JSON has newlines + indentation
    expect(streams.getOut()).toContain('\n  ');
  });

  // ── logout ────────────────────────────────────────────────────────────────

  it('logout: deletes credStore', async () => {
    const store = makeMemoryCredStore();
    await store.save({ token: 'old-tok', api_url: 'http://api.test', email: 'x@y.z', saved_at: new Date().toISOString() });
    const streams = captureStreams();
    const code = await runMu(['logout'], {
      fetchImpl: async () => { throw new Error('should not fetch'); },
      stdout: streams.stdout,
      stderr: streams.stderr,
      env: {},
      credStore: store,
    });
    expect(code).toBe(0);
    expect(await store.load()).toBeNull();
  });

  // ── unknown subcommand → exit 2 ───────────────────────────────────────────

  it('unknown sub-command → exit 2 + usage on stderr', async () => {
    const streams = captureStreams();
    const code = await runMu(['engagements', 'frobnicate'], {
      fetchImpl: async () => { throw new Error('should not fetch'); },
      stdout: streams.stdout,
      stderr: streams.stderr,
      env: { MU_TOKEN: bhdToken() },
      credStore: makeMemoryCredStore(),
    });
    expect(code).toBe(2);
    expect(streams.getErr()).toContain('mu — muster-api CLI');
  });

});

// ── Integration tests ──────────────────────────────────────────────────────────

describe('mu CLI — integration (real express + port 0)', () => {
  let server: http.Server;
  let base: string;
  let db: ReturnType<typeof createMockDb>;
  let credStore: CredStore;

  beforeAll(async () => {
    db = createMockDb();

    // Seed a bhd_operator user with a real bcrypt hash
    const hash = await bcrypt.hash('hunter2', 10);
    await db.user.create({
      data: {
        id: 'user-bhd-int',
        email: 'bhd@test.local',
        password_hash: hash,
        tenant_id: TENANT,
        party_id: null,
        role: 'bhd_operator',
      },
    });

    // Build a minimal test app — auth route inlined since auth.ts imports db directly
    const app = express();
    app.use(express.json());

    // Inline auth routes using mockDb
    app.post('/auth/login', async (req, res) => {
      try {
        const { email, password } = req.body as { email: string; password: string };
        const user = await db.user.findUnique({ where: { email } });
        if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return; }
        const valid = await bcrypt.compare(password, (user as Record<string, unknown>)['password_hash'] as string);
        if (!valid) { res.status(401).json({ error: 'Invalid credentials' }); return; }
        const token = mintToken({
          sub: (user as Record<string, unknown>)['id'] as string,
          tenant_id: (user as Record<string, unknown>)['tenant_id'] as string,
          party_id: ((user as Record<string, unknown>)['party_id'] as string | null) ?? null,
          role: (user as Record<string, unknown>)['role'] as string,
        });
        res.json({ token });
      } catch (e) { res.status(500).json({ error: String(e) }); }
    });

    app.get('/auth/me', bearerAuth, (req, res) => { res.json(req.user); });

    app.use('/api/engagements', createEngagementsRouter(db));
    app.use('/api/contracts', createContractsRouter(db));
    app.use('/api/nudges', createNudgesRouter(db));
    app.use('/api/sprs', sprsRouter);

    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).json({ error: 'Not found' });
    });

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;

    // In-memory cred store shared across integration test steps
    credStore = makeMemoryCredStore();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve()))
    );
  });

  function deps(): MuDeps {
    return {
      env: { MU_API_URL: base },
      credStore,
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    };
  }

  it('login: authenticates against real server, stores token', async () => {
    let out = '';
    const code = await runMu(
      ['login', '--email', 'bhd@test.local', '--password', 'hunter2'],
      {
        ...deps(),
        stdout: { write: (s) => { out += s; } },
      }
    );
    expect(code).toBe(0);
    const cred = await credStore.load();
    expect(cred?.token).toBeTruthy();
    expect(cred?.email).toBe('bhd@test.local');
    expect(JSON.parse(out)).toHaveProperty('token');
  });

  it('engagements create: creates an engagement, returns 201 body', async () => {
    let out = '';
    const code = await runMu(
      ['engagements', 'create', '--kind', 'prime_and_subs'],
      {
        ...deps(),
        stdout: { write: (s) => { out += s; } },
      }
    );
    expect(code).toBe(0);
    const body = JSON.parse(out);
    expect(body).toHaveProperty('id');
    expect(body.engagement_kind).toBe('prime_and_subs');
  });

  it('engagements list: lists created engagement', async () => {
    let out = '';
    const code = await runMu(
      ['engagements', 'list'],
      {
        ...deps(),
        stdout: { write: (s) => { out += s; } },
      }
    );
    expect(code).toBe(0);
    const body = JSON.parse(out) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('sprs score: computes SPRS from fixture', async () => {
    const scoreBody = {
      requirement_results: [
        { requirement_id: 'AC.1.001', status: 'met' },
        { requirement_id: 'AC.1.002', status: 'not_met' },
      ],
    };
    const file = tmpJson(scoreBody);
    let out = '';
    const code = await runMu(
      ['sprs', 'score', '--file', file],
      {
        ...deps(),
        stdout: { write: (s) => { out += s; } },
      }
    );
    expect(code).toBe(0);
    const body = JSON.parse(out);
    expect(body).toHaveProperty('sprs');
    expect(typeof body.sprs).toBe('number');
  });

  it('nudges tick --now: fires against real nudges router, returns {fired}', async () => {
    let out = '';
    const code = await runMu(
      ['nudges', 'tick', '--now', '2026-01-01T00:00:00.000Z'],
      {
        ...deps(),
        stdout: { write: (s) => { out += s; } },
      }
    );
    expect(code).toBe(0);
    const body = JSON.parse(out);
    expect(body).toHaveProperty('fired');
    expect(Array.isArray(body.fired)).toBe(true);
  });
});
