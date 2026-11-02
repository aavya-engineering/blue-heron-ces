// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// NS-2 (2026-10-30): one interview record (ces-shared/types/interview-record) per answered
// interview question, sent to EO's POST /api/interviews. Muster only collects and sends: EO's
// reply is reported as a delivery status and nothing from it is kept or acted on.
//
// - who: the fact's attestation.confirmed_by when present, else the caller's `interviewee`, else
//   null (never guessed from provenance or source).
// - interviewer: the authenticated muster-api principal that submitted the answers.
// - objectives: the question register row's `requirement_results[<control>]` output fields, each
//   with that control's objectives whose assessment methods include `interview`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { canonicalSha256 } from 'ces-shared/crypto';
import { secretEnv } from 'ces-shared/secrets';
import OBJECTIVES_REF from 'ces-shared/data/assessment-objectives';
import type {
  InterviewInterviewer,
  InterviewObjectiveRef,
  InterviewRecord,
  InterviewRespondent,
} from 'ces-shared/types/interview-record';
import { musterRoot } from './planCompileService.js';

const INTERVIEW_RECORD_SCHEMA = 'ces-shared/interview-record@1' as const;
const CONFIDENCE = new Set(['high', 'medium', 'low', 'unknown']);
const REQUIREMENT_FIELD = /^requirement_results\[([^\]]+)\]/;
/** Same check as the shared schema's interviewedAt, so EO never rejects a batch over a timestamp. */
const ISO_WITH_OFFSET = z.string().datetime({ offset: true });

/** question id -> control ids the register says the question feeds. */
export type QuestionControlMap = Map<string, string[]>;

/** Reads the SPA's question register (src/features/interview/questionRegister.json) at run time. */
export function readQuestionControlMap(root: string = musterRoot()): QuestionControlMap {
  const file = path.join(root, 'src', 'features', 'interview', 'questionRegister.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as {
    rows?: Array<{ id: string; output_fields?: string[] }>;
  };
  const map: QuestionControlMap = new Map();
  for (const row of raw.rows ?? []) {
    const controls = new Set<string>();
    for (const f of row.output_fields ?? []) {
      const m = REQUIREMENT_FIELD.exec(f);
      if (m) controls.add(m[1]);
    }
    map.set(row.id, [...controls]);
  }
  return map;
}

let interviewObjectives: Map<string, string[]> | undefined;
/** control id -> its objective ids assessed by the interview method (ces-shared reference). */
function interviewObjectivesByControl(): Map<string, string[]> {
  if (!interviewObjectives) {
    const map = new Map<string, string[]>();
    const rows = (OBJECTIVES_REF as { objectives?: Array<{ objectiveId: string; controlId: string; methods?: string[] }> }).objectives ?? [];
    for (const o of rows) {
      if (!map.has(o.controlId)) map.set(o.controlId, []);
      if ((o.methods ?? []).includes('interview')) map.get(o.controlId)!.push(o.objectiveId);
    }
    interviewObjectives = map;
  }
  return interviewObjectives;
}

export interface BuildInterviewRecordsOptions {
  tenantSlug: string;
  interviewer: InterviewInterviewer;
  /** Who answered, when the facts themselves do not say. */
  interviewee?: Partial<InterviewRespondent>;
  questionControls?: QuestionControlMap;
}

export interface BuildInterviewRecordsResult {
  records: InterviewRecord[];
  /** Facts not emitted: no answer, no question id, or no valid timestamp. */
  skipped: Array<{ question_id: string | null; reason: string }>;
}

type RawFact = {
  question_id?: unknown;
  question_text?: unknown;
  answer?: unknown;
  provenance?: unknown;
  confidence?: unknown;
  recorded_at?: unknown;
  source?: unknown;
  attestation?: { confirmed_by?: unknown };
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** One record per answered question in `answers` (the compile body's interview_answers: text or array). */
export function buildInterviewRecords(answers: string | unknown[], opts: BuildInterviewRecordsOptions): BuildInterviewRecordsResult {
  const facts = (typeof answers === 'string' ? JSON.parse(answers.replace(/^﻿/, '')) : answers) as unknown;
  if (!Array.isArray(facts)) throw new Error('interview_answers must be a JSON array');
  const controls = opts.questionControls ?? readQuestionControlMap();
  const objectivesByControl = interviewObjectivesByControl();
  const records: InterviewRecord[] = [];
  const skipped: BuildInterviewRecordsResult['skipped'] = [];

  for (const f of facts as RawFact[]) {
    const questionId = str(f?.question_id);
    const answer = str(f?.answer);
    const at = str(f?.recorded_at);
    if (!questionId) { skipped.push({ question_id: null, reason: 'no question_id' }); continue; }
    if (!answer) { skipped.push({ question_id: questionId, reason: 'not answered' }); continue; }
    if (!at || !ISO_WITH_OFFSET.safeParse(at).success) { skipped.push({ question_id: questionId, reason: 'no valid recorded_at' }); continue; }

    const objectives: InterviewObjectiveRef[] = (controls.get(questionId) ?? [])
      .filter((c) => objectivesByControl.has(c))
      .map((c) => ({ controlId: c, objectiveIds: objectivesByControl.get(c)! }));
    const confidence = typeof f.confidence === 'string' && CONFIDENCE.has(f.confidence)
      ? (f.confidence as InterviewRecord['confidence'])
      : 'unknown';
    const body: Omit<InterviewRecord, 'recordId'> = {
      schema: INTERVIEW_RECORD_SCHEMA,
      tenantSlug: opts.tenantSlug,
      questionId,
      questionText: typeof f.question_text === 'string' ? f.question_text : '',
      answer,
      interviewedAt: at,
      interviewee: {
        name: str(f.attestation?.confirmed_by) ?? str(opts.interviewee?.name) ?? null,
        role: str(opts.interviewee?.role) ?? null,
      },
      interviewer: opts.interviewer,
      objectives,
      provenance: str(f.provenance) ?? 'unknown',
      confidence,
      ...(str(f.source) ? { source: str(f.source)! } : {}),
    };
    records.push({ ...body, recordId: canonicalSha256(body) } as InterviewRecord);
  }
  return { records, skipped };
}

export type InterviewEmitOutcome =
  | { status: 'not_configured' }
  | { status: 'no_records' }
  | { status: 'delivered'; http: 201; records: number; stored?: number; skipped?: number }
  | { status: 'failed'; http?: number; error: string };

/**
 * Sends the records to EO when CES_EO_URL and CES_EO_AUTH_TOKEN are set. Never rejects. Only the
 * delivery status (and EO's stored/skipped counts) is returned; nothing is persisted from EO.
 */
export async function emitInterviewRecords(
  tenantSlug: string,
  records: InterviewRecord[],
  env: NodeJS.ProcessEnv = secretEnv(),
  fetchImpl: typeof fetch = fetch,
): Promise<InterviewEmitOutcome> {
  const url = env.CES_EO_URL?.trim();
  const token = env.CES_EO_AUTH_TOKEN?.trim();
  if (!url || !token) return { status: 'not_configured' };
  if (records.length === 0) return { status: 'no_records' };
  try {
    const res = await fetchImpl(`${url.replace(/\/+$/, '')}/api/interviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tenant: tenantSlug, records }),
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    if (res.status === 201) {
      let receipt: { stored?: unknown; skipped?: unknown } = {};
      try { receipt = JSON.parse(text); } catch { /* counts stay absent */ }
      return {
        status: 'delivered',
        http: 201,
        records: records.length,
        ...(typeof receipt.stored === 'number' ? { stored: receipt.stored } : {}),
        ...(typeof receipt.skipped === 'number' ? { skipped: receipt.skipped } : {}),
      };
    }
    return { status: 'failed', http: res.status, error: text.slice(0, 500) };
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The compile route's hook: builds records from the compile body's interview_answers (absent:
 * 'no_records') and emits them. Never rejects; a build error is reported as 'failed'.
 */
export async function emitCompileInterviews(
  tenantSlug: string,
  answers: string | unknown[] | undefined,
  interviewee: unknown,
  user: { sub: string; role: string },
  env: NodeJS.ProcessEnv = secretEnv(),
  fetchImpl: typeof fetch = fetch,
  questionControls?: QuestionControlMap,
): Promise<InterviewEmitOutcome> {
  if (answers === undefined) return { status: 'no_records' };
  if (!env.CES_EO_URL?.trim() || !env.CES_EO_AUTH_TOKEN?.trim()) return { status: 'not_configured' };
  try {
    const who = interviewee && typeof interviewee === 'object' ? (interviewee as Partial<InterviewRespondent>) : undefined;
    const { records } = buildInterviewRecords(answers, {
      tenantSlug,
      interviewer: { subjectId: user.sub, role: user.role },
      ...(who ? { interviewee: who } : {}),
      ...(questionControls ? { questionControls } : {}),
    });
    return await emitInterviewRecords(tenantSlug, records, env, fetchImpl);
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
