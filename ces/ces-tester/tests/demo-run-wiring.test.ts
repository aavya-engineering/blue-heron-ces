// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-1 iter4: the EO→unified-dashboard mapping used by demo:run Beat 4.
// Honest by construction — no fabricated SPRS movement; real EO baseline only.
import { describe, it, expect } from 'vitest';
import { buildUnifiedFromEo } from '../src/cli/demo-command.js';
import type { EoLegResult } from '../src/demo/eo-leg.js';

const AT = '2026-07-28T00:00:00.000Z';

describe('buildUnifiedFromEo', () => {
  it('maps a live EO result into a real baseline (Beat 3 pass, no fabricated needle)', () => {
    const eo: EoLegResult = {
      available: true,
      connected: true,
      summary: { snapshotId: 'snap-9', sprsScore: -89, controlsMet: 38, controlsNotMet: 35, controlsPartial: 0, controlsNotAssessed: 37, liveAssessmentCount: 106 },
    };
    const u = buildUnifiedFromEo(eo, AT);
    expect(u.tenant).toBe('demo-dib-small');
    expect(u.controls.metBefore).toBe(38);
    expect(u.controls.metAfter).toBe(38); // no remediation in this flow → no movement
    expect(u.controls.total).toBe(38 + 35 + 0 + 37);
    expect(u.sprs.before).toBe(u.sprs.after); // one-SPRS rule + no remediation → no fabricated headline move
    const beat3 = u.beats.find((b) => b.id === 3)!;
    expect(beat3.status).toBe('pass');
    expect(beat3.label).toContain('106');
    expect(u.evidence[0].name).toContain('snap-9');
    // the needle beat stays honestly staged
    expect(u.beats.find((b) => b.id === 4)!.status).toBe('staged');
  });

  it('degrades to STAGED when EO is unavailable (self-gated env)', () => {
    const eo: EoLegResult = { available: false, connected: false, error: 'EO env not available' };
    const u = buildUnifiedFromEo(eo, AT);
    const beat3 = u.beats.find((b) => b.id === 3)!;
    expect(beat3.status).toBe('staged');
    expect(beat3.label).toContain('pending');
    expect(u.controls.metBefore).toBe(0);
    expect(u.evidence).toHaveLength(0);
  });

  it('treats connected-but-zero-live-assessments as not trustworthy (staged)', () => {
    const eo: EoLegResult = { available: true, connected: true, summary: { controlsMet: 5, liveAssessmentCount: 0 } };
    const u = buildUnifiedFromEo(eo, AT);
    expect(u.beats.find((b) => b.id === 3)!.status).toBe('staged');
  });
});
