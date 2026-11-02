// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-09 hand-off (e): the Plan tab capture review of the eight evidenced BTC
// questions. Accepting a capture answers its runlist entry (a client
// assertion citing the capture), so an evidenced gate can pass; rejecting
// leaves it unanswered (and drops a discovery-verdict answer). The review
// component renders one accept/reject row per evidenced question.
// Hand-off (d): the BTC reaches the vendored validator (gate warnings).
import 'fake-indexeddb/auto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, test, expect } from 'vitest';
import { db } from '@/shared/db/schema';
import type { BtcCaptureReview as Review } from '@/shared/types/engagement';
import { discoveryEvidenceItems } from '@/features/discovery/discoveryEvidence';
import { PLAN_TAB_QUESTIONS } from '@/features/interview/questionRegisterJustifications';
import { buildBtcLite } from '../btcLite';
import { CAPTURE_REVIEW_IDS, captureReviewItems } from '../captureReviewSpec';
import BtcCaptureReview from '../BtcCaptureReview';
import { classifyAlignment, validatePlanAlignment } from '../../planValidation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const root = process.cwd();
const yaml = (f: string) => load(fs.readFileSync(path.resolve(root, 'public/knowledge', f), 'utf8'));
const banks = { btcQuestionBank: yaml('primed BTC Question Bank.yaml'), btcActivationPackage: yaml('CES BTC Activation Package.yaml') };
const golden = (f: string) =>
  JSON.parse(fs.readFileSync(path.resolve(root, `src/features/plan/__fixtures__/customers/a/planner-golden/${f}`), 'utf8'));

const evidence = discoveryEvidenceItems(
  [
    { control_id: 'AU.L2-3.3.1', objective_ids: [], confidence: 'high', ran_entry_ids: ['AU.L2-3.3.1.audit-enable'], raw_capture_ref: 'captures/ae.txt', derived_posture: 'met' },
    { control_id: 'AU.L2-3.3.1', objective_ids: [], confidence: 'high', ran_entry_ids: ['AU.L2-3.3.1.audit-retention'], raw_capture_ref: 'captures/ar.txt', derived_posture: 'unknown' },
    { control_id: 'AU.L2-3.3.8', objective_ids: [], confidence: 'high', ran_entry_ids: ['AZ-LOG-004'], raw_capture_ref: 'captures/lk.txt', derived_posture: 'unknown' },
    { control_id: 'AU.L2-3.3.1', objective_ids: [], confidence: 'high', ran_entry_ids: ['AZ-LOG-001'], raw_capture_ref: 'captures/law.txt', derived_posture: 'unknown' },
  ],
  '2026-01-15T00:00:00.000Z'
);
const review = (verdict: Review['verdict']): Review => ({ verdict, evidence_ids: [], reviewed_on: '2026-01-16T00:00:00.000Z' });
const build = (reviews?: Record<string, Review>) =>
  buildBtcLite({ siBaseline: golden('si-baseline.json'), cuiBoundary: golden('cui-boundary.json'), evidence, facts: [], banks, reviews })!;

describe('MG-09 hand-off (e): capture review', () => {
  test('the review rows are the eight evidenced questions, each with a register row', () => {
    expect([...CAPTURE_REVIEW_IDS].sort()).toEqual(
      ['BTC.DEV.001', 'BTC.DEV.002', 'BTC.ID.001', 'BTC.ID.002', 'BTC.LOG.001', 'BTC.LOG.002', 'BTC.LOG.003', 'BTC.LOG.004'].sort()
    );
    expect(PLAN_TAB_QUESTIONS.map((q) => q.id).sort()).toEqual(CAPTURE_REVIEW_IDS.map((id) => `review.${id}`).sort());
  });

  test('accepting the log captures answers DV-03; the answers cite the captures', () => {
    const before = build().confirmation.btc_confirmation;
    expect(before.gate_status['DV-03'].pass).toBe(false);
    const after = build({ 'BTC.LOG.002': review('accepted'), 'BTC.LOG.003': review('accepted'), 'BTC.LOG.004': review('accepted') })
      .confirmation.btc_confirmation;
    expect(after.gate_status['DV-03']).toMatchObject({ pass: true });
    expect(after.answers['BTC.LOG.003']).toMatchObject({ answer: 'Yes', evidence_ids: ['disc:AU.L2-3.3.1.audit-retention'] });
  });

  test('rejecting drops the discovery-verdict answer and leaves the gate open', () => {
    const out = build({ 'BTC.LOG.001': review('rejected') }).confirmation.btc_confirmation;
    expect(out.answers['BTC.LOG.001']).toBeUndefined();
    expect(out.gate_status['DV-03'].reason).toContain('BTC.LOG.001: not answered');
  });

  test('a review of a question with no capture changes nothing', () => {
    const out = build({ 'BTC.ID.001': review('accepted') }).confirmation.btc_confirmation;
    expect(out.answers['BTC.ID.001']?.answer).toEqual(build().confirmation.btc_confirmation.answers['BTC.ID.001']?.answer);
  });

  test('the component lists the evidenced questions and stores a verdict', async () => {
    const btc = build().confirmation;
    await db.interview_sessions.put({
      id: 'sess-review',
      party_id: 'p',
      facts: [],
      timing_segments: [],
      status: 'complete',
      created_at: '2026-01-15T00:00:00.000Z',
    });
    expect(captureReviewItems(btc, undefined).map((i) => i.question_id)).toEqual([
      'BTC.LOG.001',
      'BTC.LOG.002',
      'BTC.LOG.003',
      'BTC.LOG.004',
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const r = createRoot(container);
    let reviewed = 0;
    await act(async () => {
      r.render(<BtcCaptureReview btcConfirmation={btc} sessionId="sess-review" onReviewed={() => reviewed++} />);
    });
    for (let i = 0; i < 40 && !container.querySelector('[data-testid="btc-review-accept-BTC.LOG.002"]'); i++) {
      await act(async () => {
        await new Promise((res) => setTimeout(res, 5));
      });
    }
    await act(async () => (container.querySelector('[data-testid="btc-review-accept-BTC.LOG.002"]') as HTMLButtonElement).click());
    for (let i = 0; i < 40 && reviewed === 0; i++) {
      await act(async () => {
        await new Promise((res) => setTimeout(res, 5));
      });
    }
    expect(reviewed).toBe(1);
    expect((await db.interview_sessions.get('sess-review'))!.btc_capture_reviews!['BTC.LOG.002']).toMatchObject({
      verdict: 'accepted',
      evidence_ids: ['disc:AZ-LOG-001'],
    });
    act(() => r.unmount());
    container.remove();
  });
});

describe('MG-09 hand-off (d): the BTC reaches the vendored validator', () => {
  test('failed BTC gates surface as alignment warnings (never blocking)', () => {
    const btc = build().confirmation;
    const mp = golden('manual-mission-plan.json');
    const tm = golden('tenant-manifest.json');
    const without = validatePlanAlignment(mp, tm, golden('cui-boundary.json'), golden('tenant-config-profile.json'));
    const withBtc = validatePlanAlignment(mp, tm, golden('cui-boundary.json'), golden('tenant-config-profile.json'), btc);
    expect(without.warnings.some((w) => w.startsWith('BTC gate'))).toBe(false);
    expect(withBtc.warnings.some((w) => w.startsWith('BTC gate "DV-03"'))).toBe(true);
    expect(withBtc.blocking.filter((b) => !without.blocking.includes(b))).toEqual([]);
  });

  test("MG-09 x D10: a failed gate's btc_gate_* TM marker warns; any other uncovered normative control blocks", () => {
    const marker = 'Tenant manifest normative control "btc_gate_device verification" not present in manual plan control coverage';
    const other = 'Tenant manifest normative control "ZZ.L2-9.9.9" not present in manual plan control coverage';
    expect(classifyAlignment({ errors: [], warnings: [marker, other] })).toEqual({
      blocking: [`MP_TM_CONTROL_MISMATCH: ${other}`],
      warnings: [marker],
    });
  });
});
