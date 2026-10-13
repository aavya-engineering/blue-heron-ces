// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-1 iter5 — the REAL before->after needle mapping. Honest by
// construction: `after` numbers only appear when a live post-remediation EO
// assess genuinely ran; a real before + honestly-staged after is preserved
// (never fabricated) when remediation didn't complete.
import { describe, it, expect } from 'vitest';
import { buildUnifiedFromNeedleRun, DEMO_MFA_CONTROL_ID, type NeedleRunResult } from '../src/demo/needle-run.js';
import type { EoLegResult } from '../src/demo/eo-leg.js';

const AT = '2026-07-28T00:00:00.000Z';

const liveBefore: EoLegResult = {
  available: true,
  connected: true,
  summary: { snapshotId: 'snap-before', sprsScore: -89, controlsMet: 38, controlsNotMet: 35, controlsPartial: 0, controlsNotAssessed: 37, liveAssessmentCount: 106 },
  controls: [{ controlId: DEMO_MFA_CONTROL_ID, status: 'not_met' }],
};

const liveAfter: EoLegResult = {
  available: true,
  connected: true,
  summary: { snapshotId: 'snap-after', sprsScore: 5, controlsMet: 45, controlsNotMet: 28, controlsPartial: 0, controlsNotAssessed: 37, liveAssessmentCount: 106 },
  controls: [{ controlId: DEMO_MFA_CONTROL_ID, status: 'met' }],
};

describe('buildUnifiedFromNeedleRun', () => {
  it('renders a REAL before->after needle when both legs are live', () => {
    const run: NeedleRunResult = {
      tenant: 'demo-dib-small',
      before: liveBefore,
      after: liveAfter,
      ledgerSnapshotPath: 'runs/demo/x/ledger-snapshot.json',
      setSubCount: 3,
      executeStatus: 'complete',
      failedTaskIds: [], // no failures at all
    };
    const u = buildUnifiedFromNeedleRun(run, AT);

    expect(u.tenant).toBe('demo-dib-small');
    expect(u.sprs.before).toBe(-89);
    expect(u.sprs.after).toBe(5);
    expect(u.sprs.after).toBeGreaterThan(u.sprs.before); // the real needle moved
    expect(u.sprsLabel).toContain('not the certified Muster headline');
    expect(u.controls.metBefore).toBe(38);
    expect(u.controls.metAfter).toBe(45);

    const mfaFinding = u.findings.find((f) => f.control === DEMO_MFA_CONTROL_ID)!;
    expect(mfaFinding.statusBefore).toBe('not_met');
    expect(mfaFinding.statusAfter).toBe('met');

    expect(u.evidence.some((e) => e.name.includes('snap-before'))).toBe(true);
    expect(u.evidence.some((e) => e.name.includes('snap-after'))).toBe(true);
    expect(u.evidence.some((e) => e.name === 'runs/demo/x/ledger-snapshot.json')).toBe(true);

    for (const b of u.beats) expect(b.status).toBe('pass');
    const remediationBeat = u.beats.find((b) => b.id === 2)!;
    expect(remediationBeat.artifactRef).toBe('runs/demo/x/ledger-snapshot.json');
  });

  it('keeps a REAL before and an honestly STAGED after when remediation does not complete (real partial, not a fake needle)', () => {
    const run: NeedleRunResult = {
      tenant: 'demo-dib-small',
      before: liveBefore,
      remediationError: 'stamper execute exited 1',
    };
    const u = buildUnifiedFromNeedleRun(run, AT);

    expect(u.sprs.before).toBe(u.sprs.after); // no fabricated movement
    expect(u.controls.metBefore).toBe(u.controls.metAfter);
    expect(u.findings[0].statusBefore).toBe(u.findings[0].statusAfter);
    // beat 3 (the after) is staged, carrying the honest reason
    expect(u.beats.find((b) => b.id === 3)!.status).toBe('staged');
    expect(u.beats.find((b) => b.id === 3)!.label).toContain('stamper execute exited 1');
    expect(u.beats.find((b) => b.id === 0)!.status).toBe('pass');
    expect(u.beats.find((b) => b.id === 1)!.status).toBe('pass');
  });

  it('SHOWS the real needle on a partial execute whose failures are confined to the KNOWN stable set (the one-demo-run bar)', () => {
    const run: NeedleRunResult = {
      tenant: 'demo-dib-small',
      before: liveBefore,
      after: liveAfter, // 45 > 38 — improved
      executeStatus: 'partial',
      failedTaskIds: ['MP.L2-3.8.1.cui-label', 'MA.L2-3.7.5.remote-mfa'], // all in the known set
      setSubCount: 61,
    };
    const u = buildUnifiedFromNeedleRun(run, AT);
    expect(u.controls.metBefore).toBe(38);
    expect(u.controls.metAfter).toBe(45); // real needle shown — failures are nameable on stage
    expect(u.sprs.after).toBeGreaterThan(u.sprs.before);
  });

  it('SHOWS the needle with unknown-set failures TRANSPARENTLY NAMED on the beat label (one-run bar: improved + not regressed)', () => {
    const run: NeedleRunResult = {
      tenant: 'demo-dib-small',
      before: liveBefore,
      after: liveAfter, // improved
      executeStatus: 'partial',
      failedTaskIds: ['MP.L2-3.8.1.cui-label', 'SC.L2-3.13.8.tls-enforce'], // 1 known + 1 drifter
      setSubCount: 61,
    };
    const u = buildUnifiedFromNeedleRun(run, AT);
    expect(u.controls.metAfter).toBe(45); // the real needle renders...
    const beat2 = u.beats.find((b) => b.id === 2)!;
    expect(beat2.label).toContain('1 known-set + 1 under diagnosis'); // ...with the split named
    expect(beat2.label).toContain('tls-enforce'); // the drifter is called out, not hidden
  });

  it('STAGES the after when it REGRESSED (partial execute under load broke controls)', () => {
    const regressedAfter: EoLegResult = {
      available: true,
      connected: true,
      summary: { sprsScore: -119, controlsMet: 28, controlsNotMet: 45, controlsPartial: 0, controlsNotAssessed: 37, liveAssessmentCount: 106 },
    };
    const run: NeedleRunResult = {
      tenant: 'demo-dib-small',
      before: liveBefore, // 38 met
      after: regressedAfter, // 28 met — WORSE
      executeStatus: 'partial',
    };
    const u = buildUnifiedFromNeedleRun(run, AT);
    expect(u.controls.metAfter).toBe(38); // the regression never reaches the screen
    expect(u.beats.find((b) => b.id === 3)!.status).toBe('staged');
    expect(u.beats.find((b) => b.id === 3)!.label.toLowerCase()).toContain('regress');
  });

  it('degrades to fully STAGED (before==after==0) when even the BEFORE baseline is not live', () => {
    const run: NeedleRunResult = {
      tenant: 'demo-dib-small',
      before: { available: false, connected: false, error: 'EO env not available' },
    };
    const u = buildUnifiedFromNeedleRun(run, AT);
    expect(u.sprs.before).toBe(0);
    expect(u.sprs.after).toBe(0);
    expect(u.sprsLabel).toBeUndefined();
    expect(u.findings).toHaveLength(0);
    expect(u.evidence).toHaveLength(0);
    for (const id of [1, 2, 3, 4]) expect(u.beats.find((b) => b.id === id)!.status).toBe('staged');
  });

  it('treats connected-but-zero-live-assessments as not trustworthy (staged), same as the before-only path', () => {
    const run: NeedleRunResult = {
      tenant: 'demo-dib-small',
      before: { available: true, connected: true, summary: { controlsMet: 5, liveAssessmentCount: 0 } },
    };
    const u = buildUnifiedFromNeedleRun(run, AT);
    expect(u.beats.find((b) => b.id === 1)!.status).toBe('staged');
  });
});
