// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// PH-13 (P13-INT): step EL's calls (leaver-step.ts) against a fake AO, and its place in the step order.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EL_SCENARIOS, LEAVER_FLOW_SCHEMA, elAdminRecipients, parseConfirmLink, redactTokens, runLeaverFlow, type HttpFn,
} from '../src/flow/leaver-step.js';
import { MUSTER_E2E_STEP_IDS, REQUIRED_STEPS } from '../src/flow/muster-e2e-run.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AO = 'http://127.0.0.1:51234';
const TOKEN = 'tok_ABCdef0123456789abcdefABCDEF0123456789xyz';
const ADMIN = 'sim.operator@s1-mach.simtenant.onmicrosoft.us';

/** A fake AO: records every call; answers like ces-ao's leaver routes. */
function fakeAo(o: { mode: 'confirm' | 'unconfirmed'; flowStatusAfter?: string; reuse?: number }) {
  const calls: Array<{ method: string; url: string; body: unknown; bearer: string | null }> = [];
  let confirmed = 0;
  const http: HttpFn = async (method, url, body, bearer) => {
    calls.push({ method, url, body, bearer });
    const u = new URL(url);
    const ok = (json: unknown) => ({ status: 200, json, text: JSON.stringify(json) });
    if (u.pathname === '/api/leaver/settings') return ok({ adminRecipients: (body as { adminRecipients: string[] }).adminRecipients });
    if (u.pathname === '/api/leaver/scan') return ok({ pastLeavers: 2, enabledPastLeavers: 1, started: [{ flowId: 'lvf-1', status: 'awaiting_confirmation' }], alreadyTracked: [] });
    if (u.pathname === '/api/leaver/outbox') return ok([
      { id: 'm1', flow_id: 'lvf-1', kind: 'leaver_confirm_request', to: [ADMIN], body: `Confirm here: ${AO}/leaver/confirm/lvf-1?t=${TOKEN}` },
      { id: 'm0', flow_id: 'other', kind: 'leaver_confirm_request', to: [ADMIN], body: `${AO}/leaver/confirm/other?t=zzz` },
    ]);
    if (u.pathname === '/leaver/confirm/lvf-1' && method === 'GET') return { status: 200, json: null, text: '<html>confirm</html>' };
    if (u.pathname === '/leaver/confirm/lvf-1' && method === 'POST') {
      confirmed++;
      return confirmed === 1 ? ok({ flowId: 'lvf-1', status: 'done', confirmedBy: ADMIN }) : { status: o.reuse ?? 409, json: { error: 'used' }, text: '{"error":"used"}' };
    }
    if (u.pathname === '/api/leaver/tick') return ok({ reminded: ['lvf-1'], escalated: ['lvf-1'] });
    if (u.pathname === '/api/leaver/flows/lvf-1') return ok({ flowId: 'lvf-1', status: o.flowStatusAfter ?? (o.mode === 'confirm' ? 'done' : 'awaiting_confirmation') });
    return { status: 404, json: null, text: 'not found' };
  };
  return { http, calls };
}

describe('EL: helpers', () => {
  it('parses the confirm link and redacts tokens', () => {
    expect(parseConfirmLink(`x ${AO}/leaver/confirm/lvf-1?t=${TOKEN} y`)).toEqual({ url: `${AO}/leaver/confirm/lvf-1?t=${TOKEN}`, flowId: 'lvf-1', token: TOKEN });
    expect(parseConfirmLink('no link here')).toBeNull();
    expect(redactTokens(`GET /leaver/confirm/lvf-1?t=${TOKEN}&x=1`)).toBe('GET /leaver/confirm/lvf-1?t=<redacted>&x=1');
  });
  it('the administrators are the sim operator and approver principals, distinct, lower-case', () => {
    expect(elAdminRecipients({ operator_upn: 'Sim.Operator@x.example', approver_upn: 'sim.operator@x.example', other: 'a@b' })).toEqual(['sim.operator@x.example']);
    expect(elAdminRecipients({ operator_upn: 'op@x.example', approver_upn: 'ap@x.example' })).toEqual(['op@x.example', 'ap@x.example']);
    expect(elAdminRecipients({})).toEqual([]);
  });
  it('runs on S1, S2 and S3 only, with the modes V131 expects', () => {
    expect(EL_SCENARIOS).toEqual({ 's1-mach': { mode: 'confirm', bhd: false }, 's2-eng': { mode: 'confirm', bhd: true }, 's3-def': { mode: 'unconfirmed', bhd: false } });
  });
});

describe('EL: the calls', () => {
  it('S1 (confirm): settings, scan, outbox, page GET, confirm POST without a bearer, reuse refused; the record holds no token', async () => {
    const ao = fakeAo({ mode: 'confirm' });
    const registered: string[] = [];
    const rec = await runLeaverFlow({ aoUrl: AO, bearer: 'B'.repeat(64), slug: 's1-mach', admins: [ADMIN], http: ao.http, register: (_n, v) => registered.push(v) });
    expect(rec.problems).toEqual([]);
    expect(rec).toMatchObject({ schema: LEAVER_FLOW_SCHEMA, slug: 's1-mach', mode: 'confirm', flow_id: 'lvf-1', bhd_mailbox: 'ces-notices@bhd.invalid' });
    expect(rec.settings).toMatchObject({ status: 200, adminRecipients: [ADMIN], notifyBhdOnDone: false, reminderAfterMinutes: 0, confirmWindowMinutes: 4320 });
    expect(rec.scan).toEqual({ status: 200, pastLeavers: 2, enabledPastLeavers: 1, started: ['lvf-1'] });
    expect(rec.confirm).toMatchObject({ get_status: 200, post_status: 200, post_without_bearer: true, reuse_status: 409, link: `${AO}/leaver/confirm/lvf-1?t=<redacted>` });
    // the administrator's three calls carry no AO bearer; every /api call does
    for (const c of ao.calls) expect([c.url, c.bearer === null]).toEqual([c.url, c.url.includes('/leaver/confirm/')]);
    expect(ao.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/leaver/confirm/lvf-1')).map((c) => c.body)).toEqual([{ t: TOKEN, decision: 'confirm' }, { t: TOKEN, decision: 'confirm' }]);
    expect(JSON.stringify(rec)).not.toContain(TOKEN);
    expect(registered).toContain(TOKEN);
    expect(Date.parse(rec.ended)).toBeGreaterThanOrEqual(Date.parse(rec.started));
  });

  it('S2: the BHD opt-in is set', async () => {
    const rec = await runLeaverFlow({ aoUrl: AO, bearer: 'b', slug: 's2-eng', admins: [ADMIN], http: fakeAo({ mode: 'confirm' }).http });
    expect(rec.settings.notifyBhdOnDone).toBe(true);
    expect(rec.problems).toEqual([]);
  });

  it('S3 (unconfirmed): window 0, one tick, no confirm call; the flow stays awaiting_confirmation', async () => {
    const ao = fakeAo({ mode: 'unconfirmed' });
    const rec = await runLeaverFlow({ aoUrl: AO, bearer: 'b', slug: 's3-def', admins: [ADMIN], http: ao.http });
    expect(rec.problems).toEqual([]);
    expect(rec.settings.confirmWindowMinutes).toBe(0);
    expect(rec.confirm).toBeUndefined();
    expect(rec.tick?.status).toBe(200);
    expect(ao.calls.some((c) => c.url.includes('/leaver/confirm/'))).toBe(false);
  });

  it('a reusable link, a flow not done, or no administrator are reported as problems (the step fails, V131 judges)', async () => {
    expect((await runLeaverFlow({ aoUrl: AO, bearer: 'b', slug: 's1-mach', admins: [ADMIN], http: fakeAo({ mode: 'confirm', reuse: 200 }).http })).problems).toEqual(['reused confirm link answered 200, expected 409']);
    expect((await runLeaverFlow({ aoUrl: AO, bearer: 'b', slug: 's1-mach', admins: [ADMIN], http: fakeAo({ mode: 'confirm', flowStatusAfter: 'failed' }).http })).problems).toEqual(['flow status failed, expected done']);
    expect((await runLeaverFlow({ aoUrl: AO, bearer: 'b', slug: 's1-mach', admins: [], http: fakeAo({ mode: 'confirm' }).http })).problems[0]).toMatch(/no tenant administrator/);
  });

  it('refuses muster-partial (no AdminOps op runs there)', async () => {
    await expect(runLeaverFlow({ aoUrl: AO, bearer: 'b', slug: 'muster-partial', admins: [ADMIN], http: fakeAo({ mode: 'confirm' }).http })).rejects.toThrow(/does not run on muster-partial/);
  });
});

describe('EL: its place in the run', () => {
  it('EL sits after E5 and before E6; it is not a required step (V131 judges it; muster-partial skips it)', () => {
    const ids = [...MUSTER_E2E_STEP_IDS];
    expect(ids.indexOf('EL')).toBe(ids.indexOf('E5') + 1);
    expect(ids.indexOf('E6')).toBe(ids.indexOf('EL') + 1);
    expect(REQUIRED_STEPS).not.toContain('EL');
  });
  it('the runner defines EL between E5 and E6, not fatal, skipped where EL_SCENARIOS has no entry', () => {
    const src = fs.readFileSync(path.join(HERE, '..', 'src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    const e5 = src.indexOf("id: 'E5',");
    const el = src.indexOf("id: 'EL',");
    const e6 = src.indexOf("id: 'E6',");
    expect(e5).toBeGreaterThan(0);
    expect(el).toBeGreaterThan(e5);
    expect(e6).toBeGreaterThan(el);
    const block = src.slice(el, e6);
    expect(block).toContain('fatal: false');
    expect(block).toContain('EL_SCENARIOS[slug] ? {} : { skip:');
    expect(block).toContain("'leaver-flow.json'");
  });
  it('S1 and S2 allow sim writes during EL (A-22) and expect at least one; S3 does not (nobody confirms)', () => {
    const sc = (f: string) => JSON.parse(fs.readFileSync(path.join(HERE, '..', 'scenarios', 'muster', f), 'utf8'));
    for (const f of ['s1-mach-e2e.json', 's2-eng-e2e.json']) {
      const l = sc(f).expected_ledger;
      expect(l.allowed_write_windows).toContain('EL');
      expect(l.min_writes_during.EL).toBe(1);
    }
    expect(sc('s3-def-e2e.json').expected_ledger.allowed_write_windows ?? []).not.toContain('EL');
  });
});
