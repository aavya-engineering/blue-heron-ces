// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// NS-2: interview records built from interview answers and emitted to EO's POST /api/interviews.
import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { canonicalSha256 } from 'ces-shared/crypto';
import {
  buildInterviewRecords,
  emitCompileInterviews,
  emitInterviewRecords,
  readQuestionControlMap,
} from '../src/services/interviewRecordService.js';

const FACTS = [
  { question_id: 'bnd-001', question_text: 'Does CUI exist?', answer: 'yes', provenance: 'operator_interview', confidence: 'high', recorded_at: '2026-10-01T00:00:00.000Z', source: 'synthetic-interview:t1' },
  { question_id: 'G-03', question_text: 'CUI categories?', answer: 'CTI', provenance: 'operator_interview', confidence: 'high', recorded_at: '2026-10-01T00:00:00.000Z' },
  { question_id: 'G-04', question_text: 'Other constraints?', answer: '  ', provenance: 'operator_interview', confidence: 'low', recorded_at: '2026-10-01T00:00:00.000Z' },
  { question_id: 'bnd-002', question_text: 'Scoped?', answer: 'no', provenance: 'operator_interview', confidence: 'odd', recorded_at: '2026-10-02T00:00:00.000Z', attestation: { drafted_by: 'x', confirmed_by: 'Pat Example', confirmed_on: '2026-10-02' } },
];
const CONTROLS = new Map([
  ['bnd-001', ['AC.L1-3.1.1']],
  ['bnd-002', ['AC.L2-3.1.13', 'NO.SUCH-1.1.1']],
  ['G-03', []],
]);
const opts = { tenantSlug: 't1', interviewer: { subjectId: 'op-1', role: 'bhd_operator' }, questionControls: CONTROLS };

describe('NS-2 buildInterviewRecords', () => {
  it('emits one record per answered question, with who/when/objectives/answer/interviewer', () => {
    const { records, skipped } = buildInterviewRecords(FACTS, opts);
    expect(records.map((r) => r.questionId)).toEqual(['bnd-001', 'G-03', 'bnd-002']);
    expect(skipped).toEqual([{ question_id: 'G-04', reason: 'not answered' }]);
    const [a, b, c] = records;
    expect(a).toMatchObject({
      schema: 'ces-shared/interview-record@1', tenantSlug: 't1', answer: 'yes', interviewedAt: '2026-10-01T00:00:00.000Z',
      interviewee: { name: null, role: null }, interviewer: { subjectId: 'op-1', role: 'bhd_operator' },
      provenance: 'operator_interview', confidence: 'high', source: 'synthetic-interview:t1',
    });
    expect(a.objectives).toHaveLength(1);
    expect(a.objectives[0].controlId).toBe('AC.L1-3.1.1');
    expect(a.objectives[0].objectiveIds).toEqual(expect.arrayContaining(['AC.L1-3.1.1[a]']));
    expect(b.objectives).toEqual([]);
    // unknown control dropped; attestation names the respondent; odd confidence -> unknown
    expect(c.objectives.map((o) => o.controlId)).toEqual(['AC.L2-3.1.13']);
    expect(c.interviewee).toEqual({ name: 'Pat Example', role: null });
    expect(c.confidence).toBe('unknown');
  });

  it('recordId is the canonical sha256 of the record without recordId (EO recomputes it)', () => {
    const { records } = buildInterviewRecords(FACTS, opts);
    for (const r of records) {
      const { recordId, ...rest } = r;
      expect(recordId).toBe(canonicalSha256(rest));
    }
    expect(buildInterviewRecords(JSON.stringify(FACTS), opts).records.map((r) => r.recordId))
      .toEqual(records.map((r) => r.recordId));
  });

  it('a timestamp EO would reject (date only, no zone) is skipped, not emitted', () => {
    const { records, skipped } = buildInterviewRecords([
      { ...FACTS[0], recorded_at: '2026-10-02' },
      { ...FACTS[1], recorded_at: '2026-10-02T00:00:00' },
    ], opts);
    expect(records).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['no valid recorded_at', 'no valid recorded_at']);
  });

  it('uses the caller interviewee when the fact names nobody', () => {
    const { records } = buildInterviewRecords([FACTS[0]], { ...opts, interviewee: { name: 'Sam Example', role: 'it_admin' } });
    expect(records[0].interviewee).toEqual({ name: 'Sam Example', role: 'it_admin' });
  });

  it('reads the SPA question register: bnd-001 feeds AC.L1-3.1.1', () => {
    const map = readQuestionControlMap(path.resolve(__dirname, '..', '..'));
    expect(map.get('bnd-001')).toContain('AC.L1-3.1.1');
    expect(map.get('G-03')).toEqual([]);
  });
});

describe('NS-2 emitInterviewRecords', () => {
  const env = { CES_EO_URL: 'http://eo.test/', CES_EO_AUTH_TOKEN: 'tok' } as NodeJS.ProcessEnv;
  const { records } = buildInterviewRecords(FACTS, opts);

  it('not_configured without CES_EO_URL / CES_EO_AUTH_TOKEN; no_records when empty', async () => {
    expect(await emitInterviewRecords('t1', records, {} as NodeJS.ProcessEnv)).toEqual({ status: 'not_configured' });
    expect(await emitInterviewRecords('t1', [], env)).toEqual({ status: 'no_records' });
  });

  it('posts { tenant, records } with the EO bearer and reports only the delivery status', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ stored: 3, skipped: 0, extra: 'ignored' }), { status: 201 });
    }) as unknown as typeof fetch;
    const out = await emitInterviewRecords('t1', records, env, fake);
    expect(out).toEqual({ status: 'delivered', http: 201, records: 3, stored: 3, skipped: 0 });
    expect(seen!.url).toBe('http://eo.test/api/interviews');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(seen!.init.body as string)).toEqual({ tenant: 't1', records });
  });

  it('never rejects: HTTP error and network error become failed', async () => {
    const bad = (async () => new Response('nope', { status: 400 })) as unknown as typeof fetch;
    expect(await emitInterviewRecords('t1', records, env, bad)).toMatchObject({ status: 'failed', http: 400 });
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await emitInterviewRecords('t1', records, env, down)).toEqual({ status: 'failed', error: 'ECONNREFUSED' });
  });

  it('compile hook: no answers -> no_records; bad answers -> failed (never throws)', async () => {
    const user = { sub: 'op-1', role: 'bhd_operator' };
    expect(await emitCompileInterviews('t1', undefined, undefined, user, env)).toEqual({ status: 'no_records' });
    expect(await emitCompileInterviews('t1', FACTS, undefined, user, {} as NodeJS.ProcessEnv)).toEqual({ status: 'not_configured' });
    expect(await emitCompileInterviews('t1', '{"not":"an array"}', undefined, user, env, undefined, CONTROLS)).toMatchObject({ status: 'failed' });
  });
});
