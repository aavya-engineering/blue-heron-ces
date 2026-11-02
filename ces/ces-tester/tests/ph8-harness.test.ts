// PH-8 (R-F5 Q2/Q3 harness fixes): E8T fails on a timed-out pass (fin29-stamper.ts), readSse records the HTTP status
// (mx-io.ts), and E7's connect/assess failure detail carries the first *_error message and the SSE line
// (muster-e2e-run.ts). Fake children and a stubbed fetch only: no server, no port, no pseudo-console host.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { PTY_STALL_MS_DEFAULT, PTY_TOTAL_MS_DEFAULT, passTimeoutDetail, runInPty, stamperTerminalRules } from '../src/flow/fin29-stamper.js';
import { firstSseError, readSse, sseFailureDetail } from '../src/flow/mx-io.js';

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'ph8-'));

describe('E8T pass caps', () => {
  it('defaults: 300 s total cap, 180 s stall guard', () => {
    expect(PTY_TOTAL_MS_DEFAULT).toBe(300000);
    expect(PTY_STALL_MS_DEFAULT).toBe(180000);
  });
  it('passTimeoutDetail names the pass and the limit; null when the pass finished', () => {
    expect(passTimeoutDetail('A', { timed_out: false })).toBeNull();
    expect(passTimeoutDetail('A', { timed_out: true, timed_out_by: 'total' })).toBe('pass A timed out: total cap 300 s');
    expect(passTimeoutDetail('B', { timed_out: true, timed_out_by: 'stall' })).toBe('pass B timed out: stall guard (no output) 180 s');
  });
  it('the E8T step throws (rc 1 via its catch) after pass A and pass B when they time out', () => {
    const src = fs.readFileSync(path.resolve('src', 'flow', 'fin29-stamper.ts'), 'utf8');
    expect(src).toMatch(/const timeoutA = passTimeoutDetail\('A', a\);\s+if \(timeoutA\) throw new Error\(timeoutA\);/);
    expect(src).toMatch(/const timeoutB = passTimeoutDetail\('B', b\);\s+if \(timeoutB\) throw new Error\(timeoutB\);/);
    expect(src).toMatch(/transcriptFile: path\.join\(dir, 'pass-a\.transcript\.txt'\)/);
    expect(src).toMatch(/transcriptFile: path\.join\(dir, 'pass-b\.transcript\.txt'\)/);
  });
  it('runInPty records timed_out_by "total" when the total cap fires, and still writes the transcript', async () => {
    const d = tmp();
    const stdout = new PassThrough();
    // pid undefined: the watcher never calls taskkill; the test closes the fake child itself.
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout, stderr: new PassThrough(), pid: undefined }) as unknown as ChildProcess;
    const tick = setInterval(() => stdout.write('still working\n'), 200);
    const p = runInPty({
      conptyScript: 'x.ps1', exe: 'node', args: [], cwd: d, env: {}, idleMs: 30, stallMs: 60000, totalMs: 100,
      rules: stamperTerminalRules({ approve: new Set(), dp2: 'wrong' }), transcriptFile: path.join(d, 'e8t', 'pass-a.transcript.txt'),
      spawnImpl: () => child,
    });
    await new Promise((r) => setTimeout(r, 2600));
    clearInterval(tick);
    child.emit('close', 1);
    const res = await p;
    expect(res.timed_out).toBe(true);
    expect(res.timed_out_by).toBe('total');
    expect(passTimeoutDetail('A', res, { totalMs: 100 })).toBe('pass A timed out: total cap 0 s');
    expect(fs.readFileSync(path.join(d, 'e8t', 'pass-a.transcript.txt'), 'utf8')).toContain('still working');
  }, 10000);
});

describe('readSse HTTP status', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('a non-2xx response is rc 1 with "http <status>" in the line and an mx_http_error event', async () => {
    const d = tmp();
    vi.stubGlobal('fetch', async () => new Response('unauthorized', { status: 401 }));
    const r = await readSse({ url: 'http://x/api/assess?tenant=s', stop: 'assess_done', outFile: path.join(d, 'a.json') });
    expect(r.rc).toBe(1);
    expect(r.status).toBe(401);
    expect(r.line).toMatch(/http 401/);
    expect(r.events).toEqual([{ type: 'mx_http_error', status: 401, message: 'http 401: unauthorized' }]);
    expect(sseFailureDetail('EO assess 1', r)).toMatch(/^EO assess 1 failed: mx_http_error: http 401: unauthorized; sse http:\/\/x\/api\/assess\?tenant=s: http 401, 1 events/);
  });
  it('a 2xx stream records its status and keeps the old exit rule', async () => {
    const d = tmp();
    const body = 'data: {"type":"assess_start"}\n\ndata: {"type":"assess_done"}\n\n';
    vi.stubGlobal('fetch', async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    const r = await readSse({ url: 'http://x/a', stop: 'assess_done', outFile: path.join(d, 'a.json') });
    expect(r.rc).toBe(0);
    expect(r.status).toBe(200);
    expect(r.stopped).toBe(true);
    expect(r.line).toMatch(/^sse http:\/\/x\/a: http 200, 2 events, stop "assess_done" reached/);
  });
  it('a request that never gets a response is status null, "http none", mx_stream_error', async () => {
    const d = tmp();
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED'); });
    const r = await readSse({ url: 'http://x/a', stop: 'assess_done', outFile: path.join(d, 'a.json') });
    expect(r.rc).toBe(1);
    expect(r.status).toBeNull();
    expect(r.line).toMatch(/http none/);
    expect(r.events[0]!.type).toBe('mx_stream_error');
  });
});

describe('E7 failure detail', () => {
  it('firstSseError reads error, message and detail from the first *_error event', () => {
    expect(firstSseError([{ type: 'assess_start' }])).toBeNull();
    expect(firstSseError([{ type: 'assess_start' }, { type: 'assess_error', error: 'EC returned 401' }, { type: 'drift_error', error: 'later' }])).toBe('assess_error: EC returned 401');
    expect(firstSseError([{ type: 'render_error', message: 'bad' }])).toBe('render_error: bad');
    expect(firstSseError([{ type: 'assess_error', error: 'Failed to load tenant config', detail: 'ENOENT' }])).toBe('assess_error: Failed to load tenant config (ENOENT)');
    expect(firstSseError([{ type: 'x_error' }])).toBe('x_error: (no message)');
    expect(firstSseError([{ type: 'assess_error', error: 'e'.repeat(1000) }])!.length).toBe(400);
  });
  it('sseFailureDetail: "<label> failed: <type>: <message>; <line>"', () => {
    const r = { events: [{ type: 'assess_error', error: 'EcUnavailableError: EC GET /api/items 401' }], line: 'sse u: http 200, 3 events, stop "assess_done" NOT reached, types {}' };
    expect(sseFailureDetail('EO assess 1', r)).toBe('EO assess 1 failed: assess_error: EcUnavailableError: EC GET /api/items 401; sse u: http 200, 3 events, stop "assess_done" NOT reached, types {}');
    expect(sseFailureDetail('EO connect', { events: [], line: 'L' })).toBe('EO connect failed: no *_error event; L');
  });
  it('E7 uses it for connect and every assess pass', () => {
    const src = fs.readFileSync(path.resolve('src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    expect(src).toContain("if (c.rc !== 0) return { rc: c.rc, detail: sseFailureDetail('EO connect', c) };");
    expect(src).toContain('if (a.rc !== 0) return { rc: a.rc, detail: sseFailureDetail(`EO assess ${i}`, a), extra:');
  });
});
