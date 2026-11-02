// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * P4.1 (muster-e2e): ports of two functions from the run package's
 * `scripts/mx-helpers.mjs` (`sse` and `push`). That file is a CLI that
 * dispatches at load time and exports nothing, so it cannot be imported;
 * these keep its behaviour line for line (same stop rule, same error rule,
 * same request body). The other package scripts (mint-token, apply-overrides,
 * bundle) are spawned by path from the package root instead.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SseEvent {
  type?: string;
  phase?: string;
  [k: string]: unknown;
}

export interface SseResult {
  rc: number;
  events: SseEvent[];
  stopped: boolean;
  /** PH-8 (R-F5 Q3): the HTTP status of the stream request, null when the request itself failed. */
  status: number | null;
  /** The one-line summary mx-helpers prints, plus `http <status>`. */
  line: string;
}

/** Split SSE text into complete frames' JSON `data:` payloads; returns the
 * parsed events and the unconsumed tail. Non-JSON data lines (keepalives) are
 * skipped, as in mx-helpers. */
export function parseSseFrames(buf: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  let i: number;
  let rest = buf;
  while ((i = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, i);
    rest = rest.slice(i + 2);
    const line = frame.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()) as SseEvent);
    } catch {
      /* keepalive */
    }
  }
  return { events, rest };
}

/** `stop` is an event type, or `type:phase` (EO /api/connect ends on connection_log phase "done"). */
export function isStopEvent(e: SseEvent, stop: string): boolean {
  const [stopType, stopPhase] = stop.split(':');
  return e.type === stopType && (!stopPhase || e.phase === stopPhase);
}

/** mx-helpers rule: rc 0 only when the stop event arrived and no event type ends in "_error". */
export function sseExitCode(events: SseEvent[], stopped: boolean): number {
  const errors = events.filter((e) => typeof e.type === 'string' && e.type.endsWith('_error'));
  return stopped && errors.length === 0 ? 0 : 1;
}

/** PH-8 (R-F5 Q3): the first event whose type ends in "_error", as `<type>: <error | message>[ (<detail>)]`, or null. */
export function firstSseError(events: SseEvent[]): string | null {
  const e = events.find((x) => typeof x.type === 'string' && x.type.endsWith('_error'));
  if (!e) return null;
  const msg = typeof e.error === 'string' ? e.error : typeof e.message === 'string' ? e.message : '(no message)';
  const detail = typeof e.detail === 'string' ? ` (${e.detail})` : '';
  return `${e.type}: ${msg}${detail}`.slice(0, 400);
}

/** PH-8 (R-F5 Q3): the step detail for a failed SSE read: the first `*_error` event's message, then the SSE line. */
export function sseFailureDetail(label: string, r: Pick<SseResult, 'events' | 'line'>): string {
  return `${label} failed: ${firstSseError(r.events) ?? 'no *_error event'}; ${r.line}`;
}

/** SEC-4: `Authorization: Bearer <CES_EO_AUTH_TOKEN>` when the harness set an EO token, else no header. */
export function eoAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = env.CES_EO_AUTH_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Internal: a non-2xx response already recorded as an mx_http_error event. */
class HttpStatusError extends Error {}

export async function readSse(opts: { url: string; stop: string; outFile: string; timeoutMs?: number; headers?: Record<string, string> }): Promise<SseResult> {
  const timeoutMs = opts.timeoutMs ?? 600000;
  const events: SseEvent[] = [];
  let stopped = false;
  let status: number | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timer = setTimeout(() => {
    reader?.cancel().catch(() => undefined);
  }, timeoutMs);
  try {
    const res = await fetch(opts.url, { headers: opts.headers ?? {} });
    status = res.status;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      events.push({ type: 'mx_http_error', status: res.status, message: `http ${res.status}${text ? `: ${text.slice(0, 400)}` : ''}` });
      throw new HttpStatusError();
    }
    if (!res.body) throw new Error(`no response body (HTTP ${res.status})`);
    reader = res.body.getReader();
    let buf = '';
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString('utf8');
      const parsed = parseSseFrames(buf);
      buf = parsed.rest;
      for (const ev of parsed.events) {
        events.push(ev);
        if (isStopEvent(ev, opts.stop)) {
          stopped = true;
          break outer;
        }
      }
    }
    await reader.cancel().catch(() => undefined);
  } catch (e) {
    if (!(e instanceof HttpStatusError)) events.push({ type: 'mx_stream_error', message: String(e) });
  }
  clearTimeout(timer);
  fs.writeFileSync(opts.outFile, JSON.stringify(events, null, 2));
  const types: Record<string, number> = {};
  for (const e of events) types[String(e.type)] = (types[String(e.type)] ?? 0) + 1;
  const line = `sse ${opts.url}: http ${status ?? 'none'}, ${events.length} events, stop "${opts.stop}" ${stopped ? 'reached' : 'NOT reached'}, types ${JSON.stringify(types)}`;
  return { rc: sseExitCode(events, stopped), events, stopped, status, line };
}

/** MG-12 hand-off envelopes the push sends as written (muster-api checks their hashes). */
export const HANDOFF_PREFIXES: Record<string, string> = {
  si_baseline: 'si-baseline-',
  tcp: 'tcp-',
  readiness_posture: 'readiness-posture-',
  // SSP uplift W3.3c (B9): the policy-inputs profile and the hashed policy-set manifest travel as MG-12 envelopes too.
  policy_inputs_profile: 'policy-inputs-profile-',
  policy_set_manifest: 'policy-set-manifest-',
  // W7-MX2 (2026-10-29): the CUI Boundary is pushed too; the Mission Plan references it by hash (inputs.cui_boundary_ref).
  cui_boundary: 'cui-boundary-',
};

/** The POST /api/plan/push body mx-helpers builds from the runner's plan folder. */
export function buildPushBody(plansDir: string, slug: string): Record<string, unknown> {
  const files = fs.readdirSync(plansDir);
  const pick = (prefix: string): string | undefined =>
    files.filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort().pop();
  const read = (f: string | undefined): unknown => (f ? JSON.parse(fs.readFileSync(path.join(plansDir, f), 'utf8')) : undefined);
  const body: Record<string, unknown> = {
    tenant_slug: slug,
    missionPlan: read(pick('manual-mission-plan-')),
    tenantManifest: read(pick('tenant-manifest-')),
  };
  if (pick('infrastructure-manifest-')) body.infraManifest = read(pick('infrastructure-manifest-'));
  for (const [k, p] of Object.entries(HANDOFF_PREFIXES)) if (pick(p)) body[k] = read(pick(p));
  return body;
}

export async function pushPlans(opts: {
  apiBase: string;
  token: string;
  plansDir: string;
  slug: string;
  outFile: string;
  /** FIN-19 (V114): extra body fields, e.g. the policy texts the policy-set manifest hashes, so muster-api's own EO intake call carries them. */
  extraBody?: Record<string, unknown>;
}): Promise<{ rc: number; status: number; line: string; text: string }> {
  const body = { ...buildPushBody(opts.plansDir, opts.slug), ...(opts.extraBody ?? {}) };
  const res = await fetch(`${opts.apiBase}/api/plan/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  fs.writeFileSync(opts.outFile, text);
  const sent = Object.keys(body).filter((k) => k !== 'tenant_slug').join(', ');
  const line = `push: HTTP ${res.status} (sent: ${sent}) ${text.slice(0, 400)}`;
  return { rc: res.status === 201 ? 0 : 1, status: res.status, line, text };
}
