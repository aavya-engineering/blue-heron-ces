// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 P13-LV: the leaver flow through the real AoServer.createApp() composition on 127.0.0.1:0, with
// CES_AO_AUTH_TOKEN set (the bearer gate enforced). The harness's path is exactly this one: scan, read the
// confirm link from the outbox, POST it (no bearer: the link's own token is the gate), read the flow back.
//  - /api/leaver/* is behind the bearer gate (401 without it);
//  - GET /leaver/confirm shows the page and changes nothing; POST decides; a reused link is 409;
//  - a tick with a zero window escalates; settings validation is a 400.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AoServer } from '../src/server/AoServer.js';
import { LeaverFlowService, type LeaverExecArgs } from '../src/leaver/LeaverFlowService.js';

const TOKEN = 'p13lv-route-token-0001';
const SLUG = 'lv-route';
const ADMIN = 'it-admin@lv-route.example';
const LEAVER = 'ext.calvane.heathford@lv-route.example';

let tmp: string;
let saved: string | undefined;
let server: Server | undefined;
let base: string;
let calls: LeaverExecArgs[];

async function start(): Promise<void> {
  const service = new LeaverFlowService({
    resolveTenant: async (slug) => {
      if (slug !== SLUG) throw new Error(`unknown tenant ${slug}`);
      return { tenantId: 'lv-route-tenant' };
    },
    readSignal: async () => ({ query: 'GET /v1.0/users?$filter=employeeLeaveDateTime le <now>', users: [{ id: 'user-28', upn: LEAVER, accountEnabled: true, employeeLeaveDateTime: '2026-09-20T00:00:00Z' }] }),
    execute: async (a) => {
      calls.push(a);
      return { success: true, outcome: 'executed', verdict: 'SAT', summary: `leaver '${LEAVER}': account disabled`, evidencePersisted: true };
    },
    publicBaseUrl: 'http://127.0.0.1:9',
    logger: { log: () => undefined, warn: () => undefined },
  });
  const app = AoServer.createApp({ CES_AO_AUTH_TOKEN: TOKEN }, { leaverService: service });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const api = (p: string, init: RequestInit = {}, auth = true) =>
  fetch(`${base}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), ...(init.headers ?? {}) } });

/** The link a tenant administrator would click, re-based on this test server. */
async function linkFrom(kind: string): Promise<{ path: string; t: string }> {
  const outbox: any[] = await (await api(`/api/leaver/outbox?tenant=${SLUG}`)).json();
  const m = outbox.filter((x) => x.kind === kind).at(-1);
  const hit = /http:\/\/[^/]+(\/leaver\/confirm\/[^?\s]+)\?t=([A-Za-z0-9_-]+)/.exec(m.body)!;
  return { path: hit[1], t: hit[2] };
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-p13lv-routes-'));
  saved = process.env.CES_PIPELINE_ROOT;
  process.env.CES_PIPELINE_ROOT = tmp;
  closeAllCesRepositories();
  calls = [];
  await start();
  const put = await api(`/api/leaver/settings?tenant=${SLUG}`, { method: 'PUT', body: JSON.stringify({ adminRecipients: [ADMIN] }) });
  expect(put.status).toBe(200);
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  closeAllCesRepositories();
  if (saved === undefined) delete process.env.CES_PIPELINE_ROOT;
  else process.env.CES_PIPELINE_ROOT = saved;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('leaver routes (AoServer composition, bearer enforced)', () => {
  it('the operator routes need the bearer token', async () => {
    expect((await api(`/api/leaver/flows?tenant=${SLUG}`, {}, false)).status).toBe(401);
    expect((await api(`/api/leaver/scan?tenant=${SLUG}`, { method: 'POST' }, false)).status).toBe(401);
    expect((await api(`/api/leaver/flows?tenant=${SLUG}`)).status).toBe(200);
  });

  it('scan -> link from the outbox -> GET page (no change) -> POST confirm (no bearer) -> done; the link then refuses', async () => {
    const scan: any = await (await api(`/api/leaver/scan?tenant=${SLUG}`, { method: 'POST' })).json();
    expect(scan.started).toHaveLength(1);
    const flowId = scan.started[0].flowId;
    const { path: p, t } = await linkFrom('leaver_confirm_request');
    expect(p).toBe(`/leaver/confirm/${flowId}`);

    const page = await fetch(`${base}${p}?t=${t}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.text()).toContain(LEAVER);
    expect(calls).toEqual([]);
    const still: any = await (await api(`/api/leaver/flows/${flowId}`)).json();
    expect(still.status).toBe('awaiting_confirmation');

    const bad = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'A'.repeat(43), decision: 'confirm' }) });
    expect(bad.status).toBe(403);

    const ok = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t, decision: 'confirm' }) });
    expect(ok.status).toBe(200);
    const body: any = await ok.json();
    expect(body).toMatchObject({ flowId, status: 'done', confirmedBy: ADMIN });
    expect(calls).toEqual([{ tenantSlug: SLUG, upn: LEAVER, requestorUPN: ADMIN, correlationId: `leaver-flow:${flowId}` }]);

    const again = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t, decision: 'confirm' }) });
    expect(again.status).toBe(409);
    const gone = await fetch(`${base}${p}?t=${t}`);
    expect(gone.status).toBe(409);

    const flow: any = await (await api(`/api/leaver/flows/${flowId}`)).json();
    expect(JSON.stringify(flow)).not.toContain('sha256');
    const outbox: any[] = await (await api(`/api/leaver/outbox?tenant=${SLUG}`)).json();
    expect(outbox.map((m) => m.kind)).toEqual(['leaver_confirm_request', 'leaver_done']);
  });

  it('an HTML form post (what the page sends) also decides', async () => {
    await api(`/api/leaver/scan?tenant=${SLUG}`, { method: 'POST' });
    const { path: p, t } = await linkFrom('leaver_confirm_request');
    const res = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `t=${t}&decision=decline&reason=still+employed` });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('declined');
    expect(calls).toEqual([]);
  });

  it('a zero window escalates on the next tick; the escalation and the HR-input route are listed', async () => {
    const put = await api(`/api/leaver/settings?tenant=${SLUG}`, { method: 'PUT', body: JSON.stringify({ reminderAfterMinutes: 0, confirmWindowMinutes: 0 }) });
    expect(put.status).toBe(200);
    const hr = await api('/api/leaver/flows', { method: 'POST', body: JSON.stringify({ tenant: SLUG, upn: 'hr.named@lv-route.example', reason: 'HR ticket 7' }) });
    expect(hr.status).toBe(201);
    const tick: any = await (await api(`/api/leaver/tick?tenant=${SLUG}`, { method: 'POST' })).json();
    expect(tick.reminded).toHaveLength(1);
    expect(tick.escalated).toHaveLength(1);
    const esc: any[] = await (await api(`/api/leaver/escalations?tenant=${SLUG}`)).json();
    expect(esc).toEqual([expect.objectContaining({ reason: 'unconfirmed_in_window', objectiveId: 'PS.L2-3.9.2[b]', leaverUpn: 'hr.named@lv-route.example' })]);
  });

  it('bad input is a 400; an unknown tenant is a 404', async () => {
    expect((await api(`/api/leaver/settings?tenant=${SLUG}`, { method: 'PUT', body: JSON.stringify({ adminRecipients: ['nope'] }) })).status).toBe(400);
    expect((await api('/api/leaver/flows', { method: 'POST', body: JSON.stringify({ tenant: SLUG }) })).status).toBe(400);
    expect((await api('/api/leaver/flows', { method: 'POST', body: JSON.stringify({ tenant: 'nobody', upn: 'a@b.example' }) })).status).toBe(404);
    expect((await fetch(`${base}/leaver/confirm/lvf-x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: 'x', decision: 'maybe' }) })).status).toBe(400);
  });
});
