// API-2: `eo` CLI against a stub HTTP server (no real EO).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { runEo } from '../../src/cli/eo';

interface Seen { method: string; url: string; auth?: string; principal?: string; body: unknown }

type Handler = (req: http.IncomingMessage, body: unknown, res: http.ServerResponse) => void;

const ZIP_BYTES = Buffer.from('PK\u0003\u0004fake-zip-bytes');

let server: http.Server;
let baseUrl: string;
let seen: Seen[];
let routes: Record<string, Handler>;

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function defaultRoutes(): Record<string, Handler> {
  return {
    'GET /api/health': (_q, _b, res) => json(res, 200, { status: 'ok', service: 'evidence-ops' }),
    'GET /api/assessment': (_q, _b, res) => json(res, 200, { snapshotId: 'snap-1' }),
    'POST /api/ssp/generate': (_q, b, res) => json(res, 200, { sspId: 'ssp-1', echo: b }),
    'POST /api/poam/generate': (_q, b, res) => json(res, 200, { poamId: 'poam-1', echo: b }),
    'POST /api/package/build': (_q, _b, res) =>
      json(res, 200, { packageId: 'pkg-1', filePath: 'C:\\x\\packages\\evidence-package-2026-10-30T00-00-00.zip', fileCount: 7, sizeBytes: 123 }),
    'GET /api/package/download/evidence-package-2026-10-30T00-00-00.zip': (_q, _b, res) => {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(ZIP_BYTES);
    },
    'POST /api/policies/import': (_q, b, res) => json(res, 201, { imported: ((b as { policies: unknown[] }).policies).length }),
    'GET /api/assess': (_q, _b, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"assess_start"}\n\n');
      res.write('data: {"type":"assess_summary","snapshotId":"snap-2"}\n\n');
      res.end('data: {"type":"assess_done"}\n\n');
    },
  };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) : undefined;
      const pathOnly = (req.url ?? '').split('?')[0];
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, principal: req.headers['x-ces-principal'] as string | undefined, body });
      const h = routes[`${req.method} ${pathOnly}`];
      if (h) h(req, body, res);
      else { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end(`Cannot ${req.method} ${pathOnly}`); }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  seen = [];
  routes = defaultRoutes();
});

async function run(argv: string[], env: Record<string, string | undefined> = {}) {
  let out = '';
  let err = '';
  const code = await runEo(argv, {
    env: { CES_EO_URL: baseUrl, ...env },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

describe('eo CLI (API-2)', () => {
  it('help prints usage and exits 0; unknown command exits 2', async () => {
    expect((await run([])).code).toBe(0);
    const r = await run(['bogus']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Usage: eo');
  });

  it('status calls /api/health with the CES_EO_AUTH_TOKEN bearer', async () => {
    const r = await run(['status'], { CES_EO_AUTH_TOKEN: 'tok-env' });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).status).toBe('ok');
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/health', auth: 'Bearer tok-env' });
  });

  it('--url and --token override the env', async () => {
    const r = await run(['--url', baseUrl, '--token', 'tok-flag', 'status'], { CES_EO_URL: 'http://127.0.0.1:1', CES_EO_AUTH_TOKEN: 'tok-env' });
    expect(r.code).toBe(0);
    expect(seen[0].auth).toBe('Bearer tok-flag');
  });

  it('sends no Authorization header when no token is set', async () => {
    await run(['status']);
    expect(seen[0].auth).toBeUndefined();
  });

  it('HTTP error exits 1 with the status on stderr', async () => {
    routes['GET /api/health'] = (_q, _b, res) => json(res, 401, { error: 'unauthorized' });
    const r = await run(['status']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toEqual({ error: { error: 'unauthorized' }, status: 401 });
  });

  it('assess streams SSE events as JSON lines and exits 0 on assess_done', async () => {
    const r = await run(['assess', '--tenant', 'acme']);
    expect(r.code).toBe(0);
    const lines = r.out.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((e) => e.type)).toEqual(['assess_start', 'assess_summary', 'assess_done']);
    expect(seen[0].url).toBe('/api/assess?tenant=acme');
  });

  it('assess exits 1 on assess_error and on a stream with no terminal event', async () => {
    routes['GET /api/assess'] = (_q, _b, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"type":"assess_error","error":"boom"}\n\n');
    };
    expect((await run(['assess', '--tenant', 'acme'])).code).toBe(1);
    routes['GET /api/assess'] = (_q, _b, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"type":"assess_start"}\n\n');
    };
    expect((await run(['assess', '--tenant', 'acme'])).code).toBe(1);
  });

  it('commands needing a tenant exit 1 without --tenant', async () => {
    const r = await run(['assess']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('--tenant');
    expect(seen).toHaveLength(0);
  });

  it('ssp generate resolves the latest snapshot when --assessment is absent', async () => {
    const r = await run(['ssp', 'generate', '--tenant', 'acme']);
    expect(r.code).toBe(0);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(['GET /api/assessment?tenant=acme', 'POST /api/ssp/generate']);
    expect(seen[1].body).toEqual({ tenantSlug: 'acme', assessmentId: 'snap-1' });
  });

  it('poam uses --assessment when given (both `poam` and `poam generate`)', async () => {
    expect((await run(['poam', '--tenant', 'acme', '--assessment', 'snap-9'])).code).toBe(0);
    expect((await run(['poam', 'generate', '--tenant', 'acme', '--assessment', 'snap-9'])).code).toBe(0);
    expect(seen.map((s) => s.url)).toEqual(['/api/poam/generate', '/api/poam/generate']);
    expect(seen[0].body).toEqual({ tenantSlug: 'acme', assessmentId: 'snap-9' });
  });

  it('package build posts the build and writes the downloaded zip to --out', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-cli-'));
    try {
      const out = path.join(dir, 'sub', 'pkg.zip');
      const r = await run(['package', 'build', '--tenant', 'acme', '--out', out]);
      expect(r.code).toBe(0);
      expect(fs.readFileSync(out).equals(ZIP_BYTES)).toBe(true);
      expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/package/build', body: { tenant: 'acme' } });
      expect(seen[1].url).toBe('/api/package/download/evidence-package-2026-10-30T00-00-00.zip?tenant=acme');
      expect(JSON.parse(r.out)).toMatchObject({ packageId: 'pkg-1', filename: 'evidence-package-2026-10-30T00-00-00.zip', bytesWritten: ZIP_BYTES.length });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('package build requires --out and exits 1 on a build error', async () => {
    expect((await run(['package', 'build', '--tenant', 'acme'])).code).toBe(1);
    routes['POST /api/package/build'] = (_q, _b, res) => json(res, 404, { error: 'No assessment available' });
    const r = await run(['package', 'build', '--tenant', 'acme', '--out', path.join(os.tmpdir(), 'never.zip')]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err).status).toBe(404);
  });

  it('policies import accepts a bare array or {policies:[...]}', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-cli-'));
    try {
      const a = path.join(dir, 'a.json');
      const b = path.join(dir, 'b.json');
      fs.writeFileSync(a, JSON.stringify([{ title: 'P1' }]));
      fs.writeFileSync(b, JSON.stringify({ policies: [{ title: 'P1' }, { title: 'P2' }] }));
      expect((await run(['policies', 'import', '--tenant', 'acme', '--file', a])).code).toBe(0);
      expect((await run(['policies', 'import', '--tenant', 'acme', '--file', b])).code).toBe(0);
      expect(seen[0].body).toEqual({ tenantSlug: 'acme', policies: [{ title: 'P1' }] });
      expect((seen[1].body as { policies: unknown[] }).policies).toHaveLength(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // FIN-12 (NS-audit F-3): `eo review` posts a GD-b review the route accepts.
  const reviewArgs = ['review', '--tenant', 'acme', '--control', 'AT.L2-3.2.1', '--objective', 'AT.L2-3.2.1[a]', '--verdict', 'met'];

  it('review posts {tenant, controlId, objectiveId, artifactHash, verdict, notes} with the approver token as x-ces-principal', async () => {
    routes['POST /api/reviews'] = (_q, b, res) => json(res, 201, { reviewId: 'r-1', echo: b });
    const r = await run([...reviewArgs, '--hash', 'd'.repeat(64), '--notes', 'roster reviewed', '--approver-token', 'appr.tok.en', '--token', 'bear']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).reviewId).toBe('r-1');
    expect(seen[0]).toMatchObject({
      method: 'POST', url: '/api/reviews', principal: 'appr.tok.en', auth: 'Bearer bear',
      body: { tenant: 'acme', controlId: 'AT.L2-3.2.1', objectiveId: 'AT.L2-3.2.1[a]', artifactHash: 'd'.repeat(64), verdict: 'met', notes: 'roster reviewed' },
    });
    expect((seen[0].body as Record<string, unknown>).tenantSlug).toBeUndefined();
  });

  it('review reads the approver token from CES_EO_APPROVER_TOKEN and hashes --file (sha256)', async () => {
    routes['POST /api/reviews'] = (_q, _b, res) => json(res, 201, { reviewId: 'r-2' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-cli-review-'));
    try {
      const f = path.join(dir, 'roster.pdf');
      fs.writeFileSync(f, 'roster contents');
      const r = await run([...reviewArgs, '--file', f], { CES_EO_APPROVER_TOKEN: 'env.tok' });
      expect(r.code).toBe(0);
      expect(seen[0].principal).toBe('env.tok');
      expect((seen[0].body as { artifactHash: string }).artifactHash).toBe(createHash('sha256').update('roster contents').digest('hex'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('review refuses locally (exit 1, no request) without the objective, verdict, hash or approver token', async () => {
    const cases: string[][] = [
      ['review', '--tenant', 'acme', '--control', 'AT.L2-3.2.1', '--verdict', 'met', '--hash', 'h', '--approver-token', 't'],
      ['review', '--tenant', 'acme', '--control', 'AT.L2-3.2.1', '--objective', 'AT.L2-3.2.1[a]', '--verdict', 'partial', '--hash', 'h', '--approver-token', 't'],
      [...reviewArgs, '--approver-token', 't'],
      [...reviewArgs, '--hash', 'h'],
      [...reviewArgs, '--hash', 'h', '--file', 'x', '--approver-token', 't'],
    ];
    for (const argv of cases) {
      const r = await run(argv);
      expect(r.code).toBe(1);
    }
    expect(seen).toHaveLength(0);
  });

  it('review surfaces the route refusal (403 reviewer_is_uploader) and exits 1', async () => {
    routes['POST /api/reviews'] = (_q, _b, res) => json(res, 403, { error: 'reviewer_is_uploader' });
    const r = await run([...reviewArgs, '--hash', 'h', '--approver-token', 't']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toEqual({ error: { error: 'reviewer_is_uploader' }, status: 403 });
  });

  it('review list GETs /api/reviews with tenant, controlId and history', async () => {
    routes['GET /api/reviews'] = (_q, _b, res) => json(res, 200, { tenant: 'acme', reviews: [] });
    const r = await run(['review', 'list', '--tenant', 'acme', '--control', 'AT.L2-3.2.1', '--history']);
    expect(r.code).toBe(0);
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/reviews?tenant=acme&controlId=AT.L2-3.2.1&history=1' });
  });
});
