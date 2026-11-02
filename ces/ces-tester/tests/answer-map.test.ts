// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import {
  answersForWizard,
  resolveAnswerForQuestion,
  CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP,
} from '../src/muster-driver/answer-map.js';

describe('resolveAnswerForQuestion', () => {
  it('finds an entry by question id', () => {
    const entry = resolveAnswerForQuestion(CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP, 'G-01');
    expect(entry).toBeDefined();
    expect(entry?.value).toBe('L2');
  });

  it('returns undefined for a question id not in the map (falls through to product defaults)', () => {
    const entry = resolveAnswerForQuestion(CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP, 'G-99');
    expect(entry).toBeUndefined();
  });
});

describe('answersForWizard', () => {
  it('filters to only entries for the given wizard, preserving order', () => {
    const sitEntries = answersForWizard(CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP, 'sit');
    expect(sitEntries.map((e) => e.questionId)).toEqual(['G-01', 'G-02', 'G-07']);
  });

  it('returns an empty array for a wizard with no answer-map entries (e.g. rrt)', () => {
    expect(answersForWizard(CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP, 'rrt')).toEqual([]);
  });

  it('returns exactly one entry for tcp', () => {
    const tcpEntries = answersForWizard(CLEAN_TENANT_MFA_BASELINE_ANSWER_MAP, 'tcp');
    expect(tcpEntries).toHaveLength(1);
    expect(tcpEntries[0].questionId).toBe('TCP.LIC.001');
  });
});
