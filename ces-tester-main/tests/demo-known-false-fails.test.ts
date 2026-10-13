// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-1: the known-false-FAIL registry. Re-populated 2026-07-28 from LIVE
// execute evidence (founder direction: the demo bar is ONE clean run whose
// failure set is known and nameable on stage). The 2026-07-27 "resolved" claim
// held for isolated round-trips but not live executes — RESOLVED_FALSE_FAILS
// keeps that provenance; the ACTIVE registry is the live-observed stable set.
import { describe, it, expect } from 'vitest';
import {
  KNOWN_FALSE_FAILS,
  RESOLVED_FALSE_FAILS,
  lookupKnownFalseFail,
  partitionFailures,
} from '../src/demo/known-false-fails.js';

// The bit-identical failed set from the 2026-07-28 quiet needle run (100/110
// completed, needle +8) — the on-stage-nameable set.
const LIVE_STABLE_10 = [
  'MP.L2-3.8.1.cui-label',
  'IA.L2-3.5.9.tap-config',
  'AC.L2-3.1.15.admin-mfa',
  'MA.L2-3.7.5.remote-mfa',
  'AC.L2-3.1.11.session-timeout',
  'SC.L2-3.13.13.safe-attach',
  'SI.L2-3.14.2.malware-rule',
  'SC.L2-3.13.15.anti-phish',
  'AC.L2-3.1.1.member-add',
  'SI.L2-3.14.3.safe-links-rule',
];

describe('known-false-fails registry (live-evidence, 2026-07-28)', () => {
  it('active registry is exactly the live-observed stable set of 10', () => {
    expect(KNOWN_FALSE_FAILS).toHaveLength(10);
    expect(KNOWN_FALSE_FAILS.map((k) => k.taskId).sort()).toEqual([...LIVE_STABLE_10].sort());
    for (const k of KNOWN_FALSE_FAILS) {
      expect(k.rationale.length).toBeGreaterThan(10);
      expect(k.ownedBy).toContain('STAMPER');
    }
  });

  it('resolved history (isolated round-trip fixes) is preserved as provenance', () => {
    expect(RESOLVED_FALSE_FAILS).toHaveLength(9);
  });

  it('a quiet run (failures ⊆ known set) partitions to all-explained, zero unexpected', () => {
    const p = partitionFailures(LIVE_STABLE_10);
    expect(p.explained).toHaveLength(10);
    expect(p.unexpected).toHaveLength(0);
    expect(p.staleSkips).toHaveLength(0);
  });

  it('a loaded run (known set + extras) surfaces exactly the extras as unexpected', () => {
    const p = partitionFailures([...LIVE_STABLE_10, 'SC.L2-3.13.8.tls-enforce', 'AU.L2-3.3.1.audit-enable']);
    expect(p.unexpected).toEqual(['AU.L2-3.3.1.audit-enable', 'SC.L2-3.13.8.tls-enforce']);
    expect(p.explained).toHaveLength(10);
  });

  it('lookup hits a registered task', () => {
    expect(lookupKnownFalseFail('MA.L2-3.7.5.remote-mfa')?.ownedBy).toContain('STAMPER');
    expect(lookupKnownFalseFail('AC.L2-3.1.99.not-a-thing')).toBeUndefined();
  });

  it('a task that stops failing shows as a stale skip (honest shrink signal)', () => {
    const p = partitionFailures(LIVE_STABLE_10.slice(0, 9)); // safe-links-rule absent
    expect(p.staleSkips.map((s) => s.taskId)).toEqual(['SI.L2-3.14.3.safe-links-rule']);
  });
});
