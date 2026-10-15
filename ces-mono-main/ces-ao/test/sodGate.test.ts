// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G-AO-CMMC-BOUND-1 M4 — SodGate additive floor unit tests.
// Scope boundary under test: the ONE floor is (cmmcLevel === 'L2' && kind ===
// 'live' && write-shaped && Tier 2); nothing else may change gate behavior.

import { describe, it, expect } from 'vitest';
import { requiresManualGate } from '../src/execution/SodGate.js';
import { makeAoCommand } from './fixtures.js';

const l2Live = { cmmcLevel: 'L2' as const, kind: 'live', writeShaped: true };

describe('SodGate.requiresManualGate — M4 additive floor', () => {
  it('Tier 3 always gates, with or without tenant context', () => {
    const t3 = makeAoCommand({ sodTier: 'Tier 3' });
    expect(requiresManualGate(t3)).toBe(true);
    expect(requiresManualGate(t3, l2Live)).toBe(true);
  });

  it('Tier 2 without tenant context keeps its historical behavior (no gate)', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }))).toBe(false);
  });

  it('floors a write-shaped Tier 2 command against a live L2 tenant', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), l2Live)).toBe(true);
  });

  it('does not floor read/evidence commands (writeShaped false)', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), { ...l2Live, writeShaped: false })).toBe(false);
  });

  it('does not floor against a sim tenant', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), { ...l2Live, kind: 'sim' })).toBe(false);
  });

  it('does not floor against an L1 (or unmigrated) tenant', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), { ...l2Live, cmmcLevel: 'L1' })).toBe(false);
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), { kind: 'live', writeShaped: true })).toBe(false);
  });
});
