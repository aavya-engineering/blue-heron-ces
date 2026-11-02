// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import { classifyIdempotency } from '../src/execution/IdempotencyClassifier.js';
import { makeAoCommand } from './fixtures.js';

// Characterization tests: capture the ACTUAL current behavior of classifyIdempotency.
describe('classifyIdempotency', () => {
  it('Tier 3 always wins -> unsafe_requires_gate (even with AUDIT trigger)', () => {
    expect(
      classifyIdempotency(makeAoCommand({ sodTier: 'Tier 3', trigger: 'AUDIT' }))
    ).toBe('unsafe_requires_gate');
  });

  it('AUDIT trigger (non-Tier3) -> evidence-only', () => {
    expect(classifyIdempotency(makeAoCommand({ trigger: 'AUDIT' }))).toBe('evidence-only');
  });

  it('CONFIG + write keyword -> get-then-set', () => {
    expect(
      classifyIdempotency(
        makeAoCommand({ trigger: 'CONFIG', title: 'Create User', overview: 'create a new user' })
      )
    ).toBe('get-then-set');
  });

  it('ONBOARDING + write keyword -> get-then-set', () => {
    expect(
      classifyIdempotency(
        makeAoCommand({ trigger: 'ONBOARDING', title: 'Provision Account', overview: 'provision an account' })
      )
    ).toBe('get-then-set');
  });

  it('read-only title + no write keyword in overview -> safe', () => {
    expect(
      classifyIdempotency(
        makeAoCommand({ trigger: 'CONFIG', title: 'Get Users', overview: 'list all users for review' })
      )
    ).toBe('safe');
  });

  it('no matching heuristic -> best_effort fallback', () => {
    expect(
      classifyIdempotency(
        makeAoCommand({ trigger: 'CONFIG', title: 'Something', overview: 'do a thing nobody knows' })
      )
    ).toBe('best_effort');
  });
});
