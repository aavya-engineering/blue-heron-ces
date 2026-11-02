// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/** NS-2: POST/GET /api/interviews over real HTTP, with a temp ces.db and a temp stamper plan-data tenant. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories, getCesRepository, DEFAULT_WORM_COLLECTIONS } from 'ces-shared/persistence/node';
import type { InterviewRecord } from 'ces-shared/types/interview-record';
import {
  createInterviewRouter, interviewRecordId, InterviewRecordStore, INTERVIEW_RECORD_COLLECTION,
} from '../../../src/eo/server/routers/interview-router';

const TENANT = { slug: 'ns2-interview-tenant', guid: '00000000-0000-4000-8000-0000000a5201' };

const record = (overrides: Partial<Omit<InterviewRecord, 'recordId'>> = {}): InterviewRecord => {
  const body: Omit<InterviewRecord, 'recordId'> = {
    schema: 'ces-shared/interview-record@1',
    tenantSlug: TENANT.slug,
    questionId: 'bnd-001',
    questionText: 'Does CUI exist in your environment?',
    answer: 'yes',
    interviewedAt: '2026-10-01T00:00:00.000Z',
    interviewee: { name: null, role: null },
    interviewer: { subjectId: 'op-ns2', role: 'bhd_operator' },
    objectives: [{ controlId: 'AC.L1-3.1.1', objectiveIds: ['AC.L1-3.1.1[a]'] }],
    provenance: 'operator_interview',
    confidence: 'high',
    ...overrides,
  };
  return { ...body, recordId: interviewRecordId(body) };
};

describe('NS-2: /api/interviews', () => {
  let tmp: string;
  let dbPath: string;
  let server: Server;
  let base: string;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ns2-interview-'));
    dbPath = path.join(tmp, 'ces.db');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    const stamperRoot = path.join(tmp, 'stamper');
    fs.mkdirSync(path.join(stamperRoot, 'plan-data', TENANT.slug), { recursive: true });
    fs.writeFileSync(path.join(stamperRoot, 'plan-data', TENANT.slug, `${TENANT.slug}.json`),
      JSON.stringify({ tenant: { tenant_id: TENANT.guid, domain: 'interview-tenant.example.test' } }));
    const app = express();
    app.use(express.json());
    app.use(createInterviewRouter({ stamperRoot, store: new InterviewRecordStore(dbPath) }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(r => server.close(() => r()));
    closeAllCesRepositories();
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const post = (body: unknown) => fetch(`${base}/api/interviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  it('rejects a missing or unknown tenant', async () => {
    expect((await post({ records: [record()] })).status).toBe(400);
    expect((await post({ tenant: 'no-such-tenant', records: [record()] })).status).toBe(404);
  });

  it('rejects schema errors, a wrong tenant, a tampered recordId and a foreign objective; writes nothing', async () => {
    expect((await post({ tenant: TENANT.slug, records: [{ ...record(), verdict: 'met' }] })).status).toBe(400);
    expect((await post({ tenant: TENANT.slug, records: [record({ tenantSlug: 'other-tenant' })] })).status).toBe(400);
    expect((await post({ tenant: TENANT.slug, records: [{ ...record(), answer: 'no' }] })).status).toBe(400);
    expect((await post({ tenant: TENANT.slug, records: [record({ objectives: [{ controlId: 'AC.L1-3.1.1', objectiveIds: ['AC.L1-3.1.2[a]'] }] })] })).status).toBe(400);
    expect((await post({ tenant: TENANT.slug, records: [record({ objectives: [{ controlId: 'XX.L9-9.9.9', objectiveIds: [] }] })] })).status).toBe(400);
    const list = await (await fetch(`${base}/api/interviews?tenant=${TENANT.slug}`)).json();
    expect(list.records).toEqual([]);
  });

  it('stores valid records, skips a re-send, lists and filters them', async () => {
    const a = record();
    const b = record({ questionId: 'G-03', questionText: 'CUI categories?', answer: 'CTI', objectives: [] });
    const first = await post({ tenant: TENANT.slug, records: [a, b] });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ tenant: TENANT.slug, received: 2, stored: 2, skipped: 0, recordIds: [a.recordId, b.recordId] });

    const again = await post({ tenant: TENANT.slug, records: [a] });
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ stored: 0, skipped: 1 });

    const all = await (await fetch(`${base}/api/interviews?tenant=${TENANT.slug}`)).json();
    expect(all.records).toHaveLength(2);
    const byControl = await (await fetch(`${base}/api/interviews?tenant=${TENANT.slug}&controlId=AC.L1-3.1.1`)).json();
    expect(byControl.records.map((r: InterviewRecord) => r.questionId)).toEqual(['bnd-001']);
    const byQuestion = await (await fetch(`${base}/api/interviews?tenant=${TENANT.slug}&questionId=G-03`)).json();
    expect(byQuestion.records).toEqual([b]);
  });

  ((DEFAULT_WORM_COLLECTIONS as readonly string[]).includes(INTERVIEW_RECORD_COLLECTION) ? it : it.skip)(
    'the collection is WORM: an overwrite throws append-only', () => {
      const a = record({ questionId: 'bnd-002' });
      new InterviewRecordStore(dbPath).record(a, TENANT.guid);
      expect(() => getCesRepository(dbPath).put(INTERVIEW_RECORD_COLLECTION, {
        id: a.recordId, ces: { tenantSlug: TENANT.slug, tenantId: TENANT.guid }, data: { ...a, answer: 'no' },
      })).toThrow(/append-only|WORM/);
    });
});
