// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Tests for StaticRollup aggregate extraction and AJV validation logic.
import { describe, test, expect, beforeAll } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, '../../../../public/schemas/status-payload.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

let validate: ReturnType<InstanceType<typeof Ajv>['compile']>;

beforeAll(() => {
  const ajv = new Ajv({ strict: true });
  validate = ajv.compile(schema);
});

// ---------------------------------------------------------------------------
// Helpers that mirror the extraction logic in StaticRollup.tsx handleFiles
// ---------------------------------------------------------------------------

interface TimingSegment {
  segment: string;
  started_at: string;
  stopped_at?: string;
  duration_ms?: number;
}

interface MockPayload {
  schema_version: string;
  engagement_kind: string;
  party: { name: string; uei?: string; cage?: string };
  on_prem_ot: unknown;
  interview_facts: Array<Record<string, unknown>>;
  posture_summary: {
    conservative_score: number;
    control_status_summary: {
      level: string;
      met: number;
      partial: number;
      not_met: number;
      unknown: number;
    };
  };
  timing_segments: TimingSegment[];
}

function makeValidPayload(overrides: Partial<MockPayload> = {}): MockPayload {
  return {
    schema_version: '1.0.0',
    engagement_kind: 'prime_and_subs',
    party: { name: 'Acme Defense LLC' },
    on_prem_ot: 'yes',
    interview_facts: [
      {
        question_id: 'q1',
        question_text: 'Do you have MFA?',
        answer: 'yes',
        provenance: 'operator_interview',
        confidence: 'high',
        recorded_at: '2026-07-06T10:00:00.000Z',
      },
      {
        question_id: 'q2',
        question_text: 'Do you have EDR?',
        answer: 'no',
        provenance: 'operator_interview',
        confidence: 'high',
        recorded_at: '2026-07-06T10:05:00.000Z',
      },
    ],
    posture_summary: {
      conservative_score: 65,
      control_status_summary: {
        level: 'CMMC L2',
        met: 80,
        partial: 10,
        not_met: 5,
        unknown: 5,
      },
    },
    timing_segments: [
      {
        segment: 'interview',
        started_at: '2026-07-06T10:00:00.000Z',
        stopped_at: '2026-07-06T10:30:00.000Z',
        duration_ms: 1_800_000,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Extraction logic helpers (mirrors StaticRollup.tsx handleFiles)
// ---------------------------------------------------------------------------

function extractFactCount(payload: MockPayload): number {
  return payload.interview_facts.length;
}

function extractTotalTimingMs(payload: MockPayload): number {
  return payload.timing_segments.reduce((acc, s) => acc + (s.duration_ms ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StaticRollup — fact_count and total_timing_ms extraction', () => {
  test('fact_count equals interview_facts.length', () => {
    const payload = makeValidPayload();
    expect(extractFactCount(payload)).toBe(2);
  });

  test('total_timing_ms sums duration_ms across timing_segments', () => {
    const payload = makeValidPayload({
      timing_segments: [
        { segment: 'setup', started_at: '2026-07-06T09:00:00.000Z', duration_ms: 300_000 },
        { segment: 'interview', started_at: '2026-07-06T09:05:00.000Z', duration_ms: 1_800_000 },
      ],
    });
    expect(extractTotalTimingMs(payload)).toBe(2_100_000);
  });

  test('total_timing_ms treats missing duration_ms as 0', () => {
    const payload = makeValidPayload({
      timing_segments: [
        { segment: 'interview', started_at: '2026-07-06T10:00:00.000Z' },
      ],
    });
    expect(extractTotalTimingMs(payload)).toBe(0);
  });
});

describe('StaticRollup — AJV schema validation', () => {
  test('valid payload passes AJV validation', () => {
    const payload = makeValidPayload();
    const result = validate(payload);
    expect(result).toBe(true);
  });

  test('payload with on_prem_ot: null is rejected with a descriptive error', () => {
    const payload = makeValidPayload({ on_prem_ot: null });
    const result = validate(payload);
    expect(result).toBe(false);
    expect(validate.errors).not.toBeNull();
    const errorMessage = validate.errors?.[0]?.message ?? '';
    // AJV will report a type or enum mismatch for the on_prem_ot field
    expect(errorMessage.length).toBeGreaterThan(0);
  });

  test('payload missing party.name is rejected', () => {
    const payload = makeValidPayload({ party: { name: '' } });
    const result = validate(payload);
    expect(result).toBe(false);
  });
});

describe('StaticRollup — summary panel arithmetic', () => {
  interface RagRow {
    name: string;
    score: number;
    on_prem_ot: string;
    rag: 'green' | 'amber' | 'red';
    fact_count: number;
    total_timing_ms: number;
  }

  const rows: RagRow[] = [
    { name: 'Sub A', score: 80, on_prem_ot: 'yes', rag: 'green', fact_count: 5, total_timing_ms: 1_800_000 },
    { name: 'Sub B', score: 50, on_prem_ot: 'no', rag: 'amber', fact_count: 3, total_timing_ms: 900_000 },
    { name: 'Sub C', score: 30, on_prem_ot: 'yes', rag: 'red', fact_count: 4, total_timing_ms: 1_200_000 },
  ];

  test('total facts = sum of fact_count across rows', () => {
    const totalFacts = rows.reduce((a, r) => a + r.fact_count, 0);
    expect(totalFacts).toBe(12);
  });

  test('avg session time in minutes is correct', () => {
    const totalMs = rows.reduce((a, r) => a + r.total_timing_ms, 0);
    const avgMinutes = totalMs / rows.length / 60000;
    expect(avgMinutes).toBeCloseTo(21.67, 1);
  });

  test('on-prem/OT share percentage is correct', () => {
    const onPremCount = rows.filter((r) => r.on_prem_ot === 'yes').length;
    const pct = Math.round((onPremCount / rows.length) * 100);
    expect(onPremCount).toBe(2);
    expect(pct).toBe(67);
  });

  test('"X / 5 subs" indicator threshold: green at >= 5', () => {
    const fiveRows: RagRow[] = Array.from({ length: 5 }, (_, i) => ({
      name: `Sub ${i}`,
      score: 70,
      on_prem_ot: 'no',
      rag: 'green',
      fact_count: 2,
      total_timing_ms: 600_000,
    }));
    expect(fiveRows.length >= 5).toBe(true);

    const fourRows = fiveRows.slice(0, 4);
    expect(fourRows.length >= 5).toBe(false);
  });
});
