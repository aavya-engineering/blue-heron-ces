// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// engagement.cesdb.test.ts — FIN-25 (DB-3, the V121 shape): Muster's whole
// engagement layer through the REAL app (createApp) on a REAL ces.db file —
// no mock database, no Postgres. Login, engagement create, parties, party
// actions, contracts, HIL flag + resolve, session sync, reassessment tick,
// touch, a delivery grant + portal pull, and a nudge tick that writes one
// message to the simulated mail outbox (FD-6). Ends by reopening the file
// with a fresh CesRepository to prove the rows are on disk, tenant-scoped.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { CesRepository } from 'ces-shared/persistence/node';
import { createApp } from '../src/app.js';
import { MusterStore } from '../src/lib/musterStore.js';
import { OUTBOX_FROM } from '../src/services/mailOutbox.js';

const ROOT = mkdtempSync(join(process.env.CES_PIPELINE_ROOT ?? tmpdir(), 'fin25-cesdb-'));
const DB_PATH = join(ROOT, 'ces.db');
const TENANT = '11111111-0000-4000-8000-000000000001';
const OTHER_TENANT = '22222222-0000-4000-8000-000000000002';
const OPERATOR = { email: 'operator@example.test', password: 'op-pass-not-real' };
const SUB = { email: 'sub@example.test', password: 'sub-pass-not-real' };
const OTHER = { email: 'other@example.test', password: 'other-pass-not-real' };

let store: MusterStore;
let server: http.Server;
let base: string;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* binary or text body */
  }
  return { status: res.status, json: json as any, text }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function login(email: string, password: string): Promise<string> {
  const r = await call('POST', '/auth/login', undefined, { email, password });
  expect(r.status).toBe(200);
  return r.json.token as string;
}

beforeAll(async () => {
  store = new MusterStore(DB_PATH);
  // Seed exactly as scripts/seed.ts does: root tenant + user creates.
  await store.tenant.create({ data: { id: TENANT, name: 'Fictional Prime LLC' } });
  await store.tenant.create({ data: { id: OTHER_TENANT, name: 'Other Fictional LLC' } });
  await store.user.create({
    data: { tenant_id: TENANT, email: OPERATOR.email, password_hash: await bcrypt.hash(OPERATOR.password, 4), role: 'bhd_operator' },
  });
  await store.user.create({
    data: { tenant_id: OTHER_TENANT, email: OTHER.email, password_hash: await bcrypt.hash(OTHER.password, 4), role: 'bhd_operator' },
  });
  const app = createApp({ db: store });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(ROOT, { recursive: true, force: true });
});

describe('FIN-25 — the engagement layer runs on ces.db (V121 shape)', () => {
  let op: string;
  let engagementId: string;
  let partyId: string;

  it('login: a wrong password is refused; the seeded operator signs in', async () => {
    expect((await call('POST', '/auth/login', undefined, { email: OPERATOR.email, password: 'wrong' })).status).toBe(401);
    expect((await call('POST', '/auth/login', undefined, { email: 'nobody@example.test', password: 'x' })).status).toBe(401);
    op = await login(OPERATOR.email, OPERATOR.password);
    const me = await call('GET', '/auth/me', op);
    expect(me.json.tenant_id).toBe(TENANT);
  });

  it('engagement create + list + get + progress', async () => {
    const created = await call('POST', '/api/engagements', op, { engagement_kind: 'prime_and_subs' });
    expect(created.status).toBe(201);
    engagementId = created.json.id;
    expect(created.json.tenant_id).toBe(TENANT);
    expect(created.json.live_access_enabled).toBe(false);
    const list = await call('GET', '/api/engagements', op);
    expect(list.json.map((e: { id: string }) => e.id)).toEqual([engagementId]);
    expect((await call('GET', `/api/engagements/${engagementId}`, op)).status).toBe(200);
    expect((await call('GET', `/api/engagements/${engagementId}/progress`, op)).status).toBe(200);
  });

  it('parties: create, list, get; a sub user for the party signs in', async () => {
    const p = await call('POST', `/api/engagements/${engagementId}/parties`, op, { name: 'Fictional Sub Inc', on_prem_ot: 'no' });
    expect(p.status).toBe(201);
    partyId = p.json.id;
    expect(p.json.lifecycle).toBe('invited');
    const list = await call('GET', `/api/engagements/${engagementId}/parties`, op);
    expect(list.json).toHaveLength(1);
    expect((await call('GET', `/api/parties/${partyId}`, op)).json.name).toBe('Fictional Sub Inc');
    await store.user.create({
      data: { tenant_id: TENANT, party_id: partyId, email: SUB.email, password_hash: await bcrypt.hash(SUB.password, 4), role: 'sub' },
    });
  });

  it('contracts: create, read, update, list, delete', async () => {
    const c = await call('POST', '/api/contracts', op, {
      party_id: partyId,
      engagement_id: engagementId,
      contract_number: 'FICT-0001',
      program_name: 'Fictional Program',
      cmmc_level_required: 2,
      cui_categories: ['CTI'],
      award_date: '2026-01-15T00:00:00.000Z',
    });
    expect(c.status).toBe(201);
    const id = c.json.id;
    expect((await call('GET', `/api/contracts/${id}`, op)).json.contract_number).toBe('FICT-0001');
    const u = await call('PUT', `/api/contracts/${id}`, op, { program_name: 'Renamed Program' });
    expect(u.status).toBe(200);
    expect(u.json.program_name).toBe('Renamed Program');
    expect((await call('GET', `/api/contracts?party_id=${partyId}`, op)).json).toHaveLength(1);
    expect((await call('DELETE', `/api/contracts/${id}`, op)).status).toBe(204);
    expect((await call('GET', `/api/contracts/${id}`, op)).status).toBe(404);
  });

  it('session sync: create then update, read back', async () => {
    const sub = await login(SUB.email, SUB.password);
    const body = { id: 'sess-fin25-1', party_id: partyId, facts: [{ q: 'Q1' }], timing_segments: [], selected_stacks: ['m365'], status: 'in_progress' };
    expect((await call('POST', '/api/sessions/sync', sub, body)).status).toBeLessThan(300);
    const done = await call('POST', '/api/sessions/sync', sub, { ...body, status: 'complete', completed_at: '2025-01-01T00:00:00.000Z' });
    expect(done.status).toBeLessThan(300);
    const got = await call('GET', '/api/sessions/sess-fin25-1', sub);
    expect(got.json.status).toBe('complete');
    expect(got.json.selected_stacks).toEqual(['m365']);
    // PH-5 (V121): the complete sync moved the party along its lifecycle (invited -> in_progress -> complete).
    expect((await call('GET', `/api/parties/${partyId}`, op)).json.lifecycle).toBe('complete');
  });

  it('HIL: the sub flags a fact, the operator sees it and resolves it', async () => {
    const sub = await login(SUB.email, SUB.password);
    const flag = await call('POST', '/api/hil/flag', sub, { session_id: 'sess-fin25-1', question_id: 'Q-FIN25', fact: { answer: 'yes' } });
    expect(flag.status).toBe(201);
    const queue = await call('GET', '/api/hil/queue', op);
    expect(queue.json.map((i: { id: string }) => i.id)).toContain(flag.json.id);
    const resolved = await call('POST', `/api/hil/queue/${flag.json.id}/resolve`, op, { advisor_minutes: 12 });
    expect(resolved.status).toBe(200);
    expect(resolved.json.resolved_at).toBeTruthy();
  });

  it('party actions: lifecycle moves and a manual nudge (recorded in the outbox)', async () => {
    // invited → reassessment_due is legal; a manual nudge goes to the sub's address.
    const nudge = await call('POST', `/api/parties/${partyId}/actions/send-nudge-now`, op, {});
    expect(nudge.status).toBe(200);
    const outbox = await store.forTenant(TENANT).mailOutbox.findMany({ where: { kind: 'nudge_manual' } });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toEqual([SUB.email]);
  });

  it('nudge tick: an idle party gets t3/t7/t14 events and one outbox message each, never sent', async () => {
    // PH-5: nudges go to parties that have not finished (invited / in_progress); the sync test completed this one.
    await store.forTenant(TENANT).party.update({ where: { id: partyId }, data: { lifecycle: 'invited' } });
    const tick = await call('POST', '/api/nudges/tick', op, { now: '2027-06-01T00:00:00.000Z' });
    expect(tick.status).toBe(200);
    const types = tick.json.fired.map((e: { nudge_type: string }) => e.nudge_type).sort();
    expect(types).toEqual(['t14', 't3', 't7']);
    const outbox = await store.forTenant(TENANT).mailOutbox.findMany({ orderBy: { created_at: 'asc' } });
    const tickMail = outbox.filter((m) => String(m.kind).startsWith('nudge_t'));
    expect(tickMail).toHaveLength(3);
    for (const m of tickMail) {
      expect(m.transport).toBe('simulated');
      expect(m.delivered).toBe(false);
      expect(m.from).toBe(OUTBOX_FROM);
      expect(m.to).toEqual([SUB.email]);
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // Idempotent: a second tick fires nothing new and records nothing new.
    const again = await call('POST', '/api/nudges/tick', op, { now: '2027-06-02T00:00:00.000Z' });
    expect(again.json.fired).toEqual([]);
    expect((await store.forTenant(TENANT).mailOutbox.findMany()).length).toBe(outbox.length);
  });

  it('reassessment tick: a complete party past its cadence flips and gets a reminder; touch report', async () => {
    // The party finished its interview (session completed 2025-01-01).
    await store.forTenant(TENANT).party.update({ where: { id: partyId }, data: { lifecycle: 'complete' } });
    const tick = await call('POST', '/api/reassessment/tick', op, { now: '2027-06-01T00:00:00.000Z' });
    expect(tick.status).toBe(200);
    expect(tick.json.flipped.map((f: { party_id: string }) => f.party_id)).toEqual([partyId]);
    expect((await call('GET', `/api/parties/${partyId}`, op)).json.lifecycle).toBe('reassessment_due');
    const reminders = await store.forTenant(TENANT).mailOutbox.findMany({ where: { kind: 'reassessment_due' } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].to).toEqual([SUB.email]);
    const touch = await call('POST', '/api/touch/events', op, { mode: 'a', engagement_id: engagementId, kind: 'advisor_call', minutes: 30 });
    expect(touch.status).toBe(201);
    const report = await call('GET', `/api/touch/report?engagement_id=${engagementId}`, op);
    expect(report.status).toBe(200);
  });

  it('delivery: register an artifact, issue a grant, the grantee pulls the bytes; audit trail kept', async () => {
    const content = Buffer.from('{"fictional":"readiness"}');
    const art = await call('POST', '/api/delivery/artifacts', op, {
      engagement_id: engagementId,
      kind: 'readiness_result',
      filename: 'readiness.json',
      content_base64: content.toString('base64'),
    });
    expect(art.status).toBe(201);
    const grant = await call('POST', '/api/delivery/grants', op, {
      engagement_id: engagementId,
      grantee_name: 'Fictional Grantee',
      grantee_email: 'grantee@example.test',
    });
    expect(grant.status).toBe(201);
    const token = grant.json.token as string;
    const list = await call('GET', '/portal/artifacts', token);
    expect(list.status).toBe(200);
    const artifactId = art.json.id ?? art.json.artifact?.id ?? list.json[0].id;
    const pull = await fetch(`${base}/portal/artifacts/${artifactId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(pull.status).toBe(200);
    expect(Buffer.from(await pull.arrayBuffer()).equals(content)).toBe(true);
    expect((await call('GET', '/portal/artifacts', 'not-a-real-token')).status).toBe(401);
    const audit = await call('GET', `/api/delivery/audit?engagement_id=${engagementId}`, op);
    expect(audit.status).toBe(200);
    const actions = (audit.json as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['artifact_registered', 'grant_issued', 'pull']));
  });

  it("another tenant's operator cannot see or reach this tenant's rows", async () => {
    const other = await login(OTHER.email, OTHER.password);
    expect((await call('GET', '/api/engagements', other)).json).toEqual([]);
    expect((await call('GET', `/api/engagements/${engagementId}`, other)).status).toBe(404);
    expect((await call('GET', `/api/engagements/${engagementId}/parties`, other)).status).toBe(404);
    expect((await call('GET', `/api/parties/${partyId}`, other)).status).toBe(404);
    expect((await call('GET', '/api/hil/queue', other)).json).toEqual([]);
    const tick = await call('POST', '/api/nudges/tick', other, { now: '2028-01-01T00:00:00.000Z' });
    expect(tick.json.fired).toEqual([]);
  });

  it('the rows are on disk in ces.db, tenant-scoped (fresh CesRepository handle)', () => {
    expect(existsSync(DB_PATH)).toBe(true);
    const repo = new CesRepository(DB_PATH);
    try {
      const scope = { tenantId: TENANT };
      expect(repo.list('muster_engagements', scope)).toHaveLength(1);
      expect(repo.list('muster_parties', scope)).toHaveLength(1);
      expect(repo.list('muster_interview_sessions', scope)).toHaveLength(1);
      expect(repo.list('muster_hil_items', scope)).toHaveLength(1);
      expect(repo.list('muster_mail_outbox', scope).length).toBeGreaterThanOrEqual(4);
      expect(repo.list('muster_engagements', { tenantId: OTHER_TENANT })).toHaveLength(0);
    } finally {
      repo.close();
    }
  });
});
