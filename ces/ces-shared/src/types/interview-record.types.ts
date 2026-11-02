// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// NS-2 (2026-10-30): the interview record. FE-safe (zero node:* imports).
//
// One record per answered interview question: who answered, when, which assessment objectives
// the question bears on, the answer, and who conducted the interview. Muster (the data collector)
// emits them; EO stores them append-only (WORM collection `eo_interview_records`). A record is
// evidence of what was said, never a verdict: no status, score or credit field exists here.
//
// recordId = canonicalSha256 (ces-shared/crypto) of the record without `recordId`, so the same
// answer emitted twice has the same id and EO can store it once.

import { z } from 'zod';

export const INTERVIEW_RECORD_SCHEMA = 'ces-shared/interview-record@1' as const;

/** Who answered. Interview facts rarely name a person; null means not recorded (never guessed). */
export const InterviewRespondentSchema = z.object({
  name: z.string().min(1).nullable(),
  role: z.string().min(1).nullable(),
}).strict();
export type InterviewRespondent = z.infer<typeof InterviewRespondentSchema>;

/** Who conducted the interview: the authenticated Muster principal that recorded the answers. */
export const InterviewInterviewerSchema = z.object({
  subjectId: z.string().min(1),
  role: z.string().min(1),
  name: z.string().min(1).optional(),
}).strict();
export type InterviewInterviewer = z.infer<typeof InterviewInterviewerSchema>;

/** One control the question bears on, with its objectives assessed by the interview method. */
export const InterviewObjectiveRefSchema = z.object({
  controlId: z.string().min(1),
  objectiveIds: z.array(z.string().min(1)),
}).strict();
export type InterviewObjectiveRef = z.infer<typeof InterviewObjectiveRefSchema>;

export const InterviewRecordSchema = z.object({
  schema: z.literal(INTERVIEW_RECORD_SCHEMA),
  recordId: z.string().regex(/^[0-9a-f]{64}$/),
  tenantSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  questionId: z.string().min(1),
  questionText: z.string(),
  answer: z.string().min(1),
  /** When the answer was given (ISO-8601). */
  interviewedAt: z.string().datetime({ offset: true }),
  interviewee: InterviewRespondentSchema,
  interviewer: InterviewInterviewerSchema,
  /** Empty when the question feeds scoping fields only (no control). */
  objectives: z.array(InterviewObjectiveRefSchema),
  provenance: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']),
  source: z.string().min(1).optional(),
}).strict();
export type InterviewRecord = z.infer<typeof InterviewRecordSchema>;

/** Body of EO's POST /api/interviews. */
export const InterviewRecordBatchSchema = z.object({
  tenant: z.string().min(1),
  records: z.array(InterviewRecordSchema).min(1),
}).strict();
export type InterviewRecordBatch = z.infer<typeof InterviewRecordBatchSchema>;
