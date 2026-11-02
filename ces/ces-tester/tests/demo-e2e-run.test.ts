// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M5 — the `demo:e2e` success-predicate truth table (plan File
 * Inventory row: "success-predicate truth table (injected deps)").
 *
 * Everything here is pure: `evaluateE2ePredicate` takes assembled facts and
 * decides the exit code, so every clause — including the ones that can only be
 * observed on a live box — is exercised without spawning a server, binding a
 * port, or launching a browser.
 *
 * The two clauses with non-obvious semantics are pinned hardest:
 *  - clause 5 CALIBRATES when no GUI-leg known-false-FAIL set exists (M0 FLAG +
 *    M2's drive-mode-dependence finding), and `--calibrate` accepts THAT clause
 *    only — it must never excuse a real clause-5 failure;
 *  - clause 9 fails when the gates were skipped: an unverified gate is not a
 *    clean gate (never render a partial as clean).
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateE2ePredicate,
  buildUnifiedFromE2e,
  renderBeatPlan,
  summarizeEoSnapshot,
  E2E_BEATS,
  GUI_LEG_KNOWN_FALSE_FAILS,
  type E2ePredicateFacts,
  type E2eBeatOutcome,
} from '../src/demo/e2e-run.js';
import { parseDemoE2eArgs, DEMO_PORTS, demoModules } from '../src/cli/demo-command.js';
import type { AoLegResult } from '../src/demo/ao-leg.js';
import type { ExecutionReportSummary } from '../src/demo/stamper-ui-driver.js';

const REPORT: ExecutionReportSummary = {
  status: 'partial',
  totalTasks: 110,
  completedTasks: 107,
  failures: [{ taskId: 'step_task_IA.L2-3.5.9_x', entryId: 'IA.L2-3.5.9.tap-config', error: 'IA.L2-3.5.9.tap-config: verification failed' }],
  failureIds: ['IA.L2-3.5.9.tap-config'],
};

const AO_PASS: AoLegResult = {
  available: true,
  executed: true,
  tenantId: 'sim-tenant-demo-dib-small',
  commandId: 'A-18',
  verdict: {
    satisfied: true,
    rowCountDelta: 1,
    ledgerMutationDelta: 1,
    stateChanged: true,
    hasCommandExecuted: true,
    hasSha256Hash: true,
    failures: [],
    newest: {
      id: 'A-18:A-18-1788038395123',
      tenantId: 'sim-tenant-demo-dib-small',
      createdAt: '2026-08-29T21:19:55.123Z',
      outcome: 'automated_success',
      complianceVerdict: 'SAT',
      metadata: { stateChanged: true, commandExecuted: 'Invoke-MgGraphRequest -Method PATCH ...', sha256Hash: '0190614b98a5' },
    },
  },
  addedRows: [
    {
      id: 'A-18:A-18-1788038395123',
      tenantId: 'sim-tenant-demo-dib-small',
      createdAt: '2026-08-29T21:19:55.123Z',
      outcome: 'automated_success',
      complianceVerdict: 'SAT',
      metadata: { stateChanged: true, commandExecuted: 'Invoke-MgGraphRequest -Method PATCH ...', sha256Hash: '0190614b98a5' },
    },
  ],
};

/** An all-green run of the FD-4 default config, with a calibrated GUI known set. */
function allPass(): E2ePredicateFacts {
  return {
    configId: 'demo-dib-small',
    fullChain: true,
    calibrateAccepted: false,
    preflight: { ok: true, issues: [] },
    seed: { seeded: true, serveReady: true },
    discovery: { ran: true, readOnly: true, ledgerWriteDelta: 0, mismatches: [], observationCount: 329, resultPath: 'runs/e2e/x/discovery-result.json' },
    // clause 10: an applicable (after-truth-carrying full chain) re-read that
    // matched. Synthetic facts — the pure predicate never reads the registry, so
    // it is fine that no shipped registry entry carries an after-truth yet.
    postRemediation: { applicable: true, ran: true, readOnly: true, ledgerWriteDelta: 0, mismatches: [], observationCount: 329, resultPath: 'runs/e2e/x/discovery-after-result.json' },
    muster: { missionPlanPath: 'C:/runs/mp.json', manifestPath: 'C:/runs/tm.json' },
    stamper: {
      ran: true,
      executeBadge: 'Complete',
      report: REPORT,
      ledgerSnapshotPath: 'C:/runs/ledger-snapshot.json',
      knownFalseFails: ['IA.L2-3.5.9.tap-config'],
      taxonomyPath: 'C:/runs/stamper-failure-taxonomy.json',
    },
    eo: {
      before: { live: true, liveAssessmentCount: 42, controlsMet: 61, controlsTotal: 110, sprsScore: 39, snapshotId: 'before-1' },
      after: { live: true, liveAssessmentCount: 44, controlsMet: 69, controlsTotal: 110, sprsScore: 55, snapshotId: 'after-1' },
    },
    ao: AO_PASS,
    dashboard: { path: 'C:/runs/unified-dashboard.html', beatIds: [0, 1, 2, 3, 4, 5] },
    gates: { typecheck: 'pass', tests: 'pass' },
  };
}

function statusOf(facts: E2ePredicateFacts, id: number): string {
  return evaluateE2ePredicate(facts).clauses.find((c) => c.id === id)!.status;
}

describe('evaluateE2ePredicate — the all-pass baseline', () => {
  it('returns satisfied with ten clauses, all pass, none calibrating', () => {
    const v = evaluateE2ePredicate(allPass());
    expect(v.clauses.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(v.clauses.every((c) => c.status === 'pass')).toBe(true);
    expect(v.satisfied).toBe(true);
    expect(v.calibrating).toEqual([]);
    expect(v.failures).toEqual([]);
  });

  it('gives every clause a stated reason — a clause never passes silently', () => {
    for (const c of evaluateE2ePredicate(allPass()).clauses) {
      expect(c.detail.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe('evaluateE2ePredicate — each clause fails alone', () => {
  it('1: pre-flight not ready', () => {
    const f = { ...allPass(), preflight: { ok: false, issues: ['port OCCUPIED: 3001 (ao-gui)'] } };
    expect(statusOf(f, 1)).toBe('fail');
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
    expect(evaluateE2ePredicate(f).failures[0]).toContain('ao-gui');
  });

  it('2: serve never became ready', () => {
    const f = { ...allPass(), seed: { seeded: true, serveReady: false, error: 'ready-check exhausted' } };
    expect(statusOf(f, 2)).toBe('fail');
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
  });

  it('3: a probe mismatch fails the ground-truth gate', () => {
    const f = {
      ...allPass(),
      discovery: { ...allPass().discovery, mismatches: [{ control: 'PS.L2-3.9.2', expected: 'met', actual: 'unknown' }] },
    };
    expect(statusOf(f, 3)).toBe('fail');
    expect(evaluateE2ePredicate(f).failures.join()).toContain('PS.L2-3.9.2');
  });

  it('3: a non-read-only discovery walk fails even with a perfect diff', () => {
    const f = { ...allPass(), discovery: { ...allPass().discovery, readOnly: false, ledgerWriteDelta: 4 } };
    expect(statusOf(f, 3)).toBe('fail');
    expect(evaluateE2ePredicate(f).failures.join()).toContain('read-only');
  });

  it('4: no wizard artifacts', () => {
    const f = { ...allPass(), muster: { error: 'wizard drive threw' } };
    expect(statusOf(f, 4)).toBe('fail');
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
  });

  it('5: an unexpected failure id outside the calibrated GUI known set', () => {
    const f = { ...allPass(), stamper: { ...allPass().stamper, knownFalseFails: [] as readonly string[] } };
    expect(statusOf(f, 5)).toBe('fail');
    expect(evaluateE2ePredicate(f).failures.join()).toContain('IA.L2-3.5.9.tap-config');
  });

  it('5: a missing ledger snapshot fails even when no task failed', () => {
    const f = {
      ...allPass(),
      stamper: { ...allPass().stamper, ledgerSnapshotPath: undefined, report: { ...REPORT, failures: [], failureIds: [] } },
    };
    expect(statusOf(f, 5)).toBe('fail');
    expect(evaluateE2ePredicate(f).failures.join()).toContain('ledger snapshot');
  });

  it('6: EO after not live', () => {
    const f = { ...allPass(), eo: { ...allPass().eo, after: { live: false, liveAssessmentCount: 0 } } };
    expect(statusOf(f, 6)).toBe('fail');
  });

  it('6: a regression is a failure and is named as one', () => {
    const f = {
      ...allPass(),
      eo: { ...allPass().eo, after: { live: true, liveAssessmentCount: 44, controlsMet: 55, controlsTotal: 110 } },
    };
    expect(statusOf(f, 6)).toBe('fail');
    expect(evaluateE2ePredicate(f).failures.join()).toContain('REGRESSION');
  });

  it('7: the AO verdict failures propagate verbatim (they are the reasons)', () => {
    const f: E2ePredicateFacts = {
      ...allPass(),
      ao: {
        available: true,
        executed: true,
        tenantId: 'sim-tenant-demo-dib-small',
        commandId: 'A-18',
        verdict: {
          satisfied: false,
          rowCountDelta: 0,
          ledgerMutationDelta: 0,
          stateChanged: false,
          hasCommandExecuted: false,
          hasSha256Hash: false,
          failures: ['no new adminops_evidence row for this tenant (delta 0)', "stacksim ledger shows no mutate entry in AO's window (delta 0)"],
        },
      },
    };
    expect(statusOf(f, 7)).toBe('fail');
    const joined = evaluateE2ePredicate(f).failures.join();
    expect(joined).toContain('no new adminops_evidence row');
    expect(joined).toContain('no mutate entry');
  });

  it('7: an unavailable AO leg fails rather than passing vacuously', () => {
    const f: E2ePredicateFacts = {
      ...allPass(),
      ao: { available: false, executed: false, tenantId: 'sim-tenant-demo-dib-small', commandId: 'A-18', error: 'ces-ao is not built' },
    };
    expect(statusOf(f, 7)).toBe('fail');
  });

  it('8: a dashboard rendered without Beat 5 fails', () => {
    const f = { ...allPass(), dashboard: { path: 'C:/runs/d.html', beatIds: [0, 1, 2, 3, 4] } };
    expect(statusOf(f, 8)).toBe('fail');
    expect(evaluateE2ePredicate(f).failures.join()).toContain('Beat 5');
  });

  it('9: a failing gate fails the run', () => {
    const f = { ...allPass(), gates: { typecheck: 'pass' as const, tests: 'fail' as const } };
    expect(statusOf(f, 9)).toBe('fail');
  });

  it('9: SKIPPED gates fail — an unverified gate is not a clean gate', () => {
    const f = { ...allPass(), gates: { typecheck: 'skipped' as const, tests: 'skipped' as const, detail: '--skip-gates' } };
    expect(statusOf(f, 9)).toBe('fail');
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
  });

  it('--calibrate does NOT rescue any clause other than 5', () => {
    const f = { ...allPass(), calibrateAccepted: true, gates: { typecheck: 'skipped' as const, tests: 'skipped' as const } };
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
  });
});

describe('evaluateE2ePredicate — FD-4 non-fullChain configs', () => {
  const tConfig = (): E2ePredicateFacts => ({
    ...allPass(),
    configId: 'eval-decoys',
    fullChain: false,
    muster: { error: 'n/a' },
    stamper: { ran: false, error: 'n/a' },
  });

  it('reports clauses 4, 5 and 10 as n/a — never silently skipped', () => {
    const v = evaluateE2ePredicate(tConfig());
    expect(v.clauses.find((c) => c.id === 4)!.status).toBe('n/a');
    expect(v.clauses.find((c) => c.id === 5)!.status).toBe('n/a');
    expect(v.clauses.find((c) => c.id === 5)!.detail).toContain('no proven remediation path');
    // clause 10 is n/a because the config is not a full chain — even though the
    // synthetic postRemediation is `applicable`, the !fullChain guard wins.
    expect(v.clauses.find((c) => c.id === 10)!.status).toBe('n/a');
    expect(v.clauses.find((c) => c.id === 10)!.detail).toContain('no proven remediation path');
  });

  it('still passes overall — n/a is not a failure', () => {
    expect(evaluateE2ePredicate(tConfig()).satisfied).toBe(true);
  });

  it('still judges the AO and discovery beats, which DO run for a T-config', () => {
    const f: E2ePredicateFacts = { ...tConfig(), ao: { available: true, executed: true, tenantId: 't', commandId: 'A-18', error: 'boom' } };
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
    expect(statusOf({ ...tConfig(), discovery: { ...tConfig().discovery, readOnly: false, ledgerWriteDelta: 2 } }, 3)).toBe('fail');
  });
});

describe('evaluateE2ePredicate — clause 5 calibration (the M0 FLAG)', () => {
  const calibrating = (): E2ePredicateFacts => ({
    ...allPass(),
    stamper: { ...allPass().stamper, knownFalseFails: undefined },
  });

  it('reports clause 5 as calibrating when no GUI-leg known set exists', () => {
    const v = evaluateE2ePredicate(calibrating());
    expect(v.clauses.find((c) => c.id === 5)!.status).toBe('calibrating');
    expect(v.calibrating).toEqual([5]);
  });

  it('names the taxonomy file it recorded, so the run is reproducible', () => {
    const detail = evaluateE2ePredicate(calibrating()).clauses.find((c) => c.id === 5)!.detail;
    expect(detail).toContain('stamper-failure-taxonomy.json');
    expect(detail).toContain('drive-mode-dependent');
  });

  it('is NOT satisfied without --calibrate (a partial is never rendered clean)', () => {
    const v = evaluateE2ePredicate(calibrating());
    expect(v.satisfied).toBe(false);
    expect(v.failures.join()).toContain('clause 5');
  });

  it('IS satisfied with --calibrate, and clause 5 still reads "calibrating" on screen', () => {
    const v = evaluateE2ePredicate({ ...calibrating(), calibrateAccepted: true });
    expect(v.satisfied).toBe(true);
    expect(v.clauses.find((c) => c.id === 5)!.status).toBe('calibrating');
    expect(v.calibrating).toEqual([5]);
  });

  it('--calibrate does not excuse a REAL clause-5 failure once a known set exists', () => {
    const f = { ...allPass(), calibrateAccepted: true, stamper: { ...allPass().stamper, knownFalseFails: [] as readonly string[] } };
    const v = evaluateE2ePredicate(f);
    expect(v.clauses.find((c) => c.id === 5)!.status).toBe('fail');
    expect(v.satisfied).toBe(false);
  });

  it('ships a PINNED GUI known set whose every id survives a re-translation', () => {
    // GP-DEMO-3 M7 PINNED the set from the live calibration run, so the default
    // is no longer "calibrating". Every id must survive a re-translation: an
    // entry-id (`IA.L2-3.5.9.tap-config`, `AZ-LOG-001`) or a control id
    // (`AC.L2-3.1.14`) — never a raw `step_task_*` id, whose suffix is
    // regenerated per run and would silently match nothing.
    expect(GUI_LEG_KNOWN_FALSE_FAILS).toBeDefined();
    for (const id of GUI_LEG_KNOWN_FALSE_FAILS ?? []) {
      expect(id, id).not.toContain('step_task_');
      expect(id, id).toMatch(/^([A-Z]{2}\.L\d-\d+(\.\d+)*(\.[A-Za-z][A-Za-z0-9._-]*)?|[A-Z]{2,}-[A-Z]{2,}-\d+[a-z]?)$/);
    }
  });
});

describe('evaluateE2ePredicate — clause 10 (post-remediation Muster re-read)', () => {
  it('PASS: an applicable, read-only re-read with zero mismatches vs after-truth', () => {
    const v = evaluateE2ePredicate(allPass());
    const c10 = v.clauses.find((c) => c.id === 10)!;
    expect(c10.status).toBe('pass');
    expect(c10.detail).toContain('after-truth');
    expect(v.satisfied).toBe(true);
  });

  it('FAIL: a probe mismatch vs after-truth fails the re-read and is named', () => {
    const f = {
      ...allPass(),
      postRemediation: { ...allPass().postRemediation, mismatches: [{ control: 'IA.L2-3.5.3', expected: 'unknown', actual: 'met' }] },
    };
    expect(statusOf(f, 10)).toBe('fail');
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
    expect(evaluateE2ePredicate(f).failures.join()).toContain('IA.L2-3.5.3');
  });

  it('FAIL: a non-read-only re-read fails even with a perfect diff', () => {
    const f = { ...allPass(), postRemediation: { ...allPass().postRemediation, readOnly: false, ledgerWriteDelta: 3 } };
    expect(statusOf(f, 10)).toBe('fail');
    expect(evaluateE2ePredicate(f).failures.join()).toContain('read-only');
  });

  it('FAIL: an applicable re-read that did not run is a loud failure, not an n/a', () => {
    // The initial-value honesty case: applicable is set synchronously, so a run
    // that aborted before the re-read still FAILS clause 10 for an after-truth
    // config — it never decays into a clean-looking n/a.
    const f = {
      ...allPass(),
      postRemediation: { applicable: true, ran: false, readOnly: false, ledgerWriteDelta: 0, mismatches: [], observationCount: 0, error: 'post-remediation re-read did not run' },
    };
    expect(statusOf(f, 10)).toBe('fail');
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
    expect(evaluateE2ePredicate(f).failures.join()).toContain('did not run');
  });

  it('N/A: an after-truth-less full chain reports n/a and stays satisfied (never fabricated pass)', () => {
    const f = {
      ...allPass(),
      postRemediation: { applicable: false, ran: false, readOnly: false, ledgerWriteDelta: 0, mismatches: [], observationCount: 0 },
    };
    const c10 = evaluateE2ePredicate(f).clauses.find((c) => c.id === 10)!;
    expect(c10.status).toBe('n/a');
    expect(c10.detail).toContain('no after-truth');
    expect(evaluateE2ePredicate(f).satisfied).toBe(true);
  });

  it('N/A: a non-fullChain config is n/a on clause 10 regardless of the postRemediation facts', () => {
    const f = { ...allPass(), fullChain: false };
    expect(statusOf(f, 10)).toBe('n/a');
    expect(evaluateE2ePredicate(f).clauses.find((c) => c.id === 10)!.detail).toContain('no proven remediation path');
  });

  it('--calibrate does NOT rescue a real clause-10 failure', () => {
    const f = {
      ...allPass(),
      calibrateAccepted: true,
      postRemediation: { ...allPass().postRemediation, mismatches: [{ control: 'AC.L1-3.1.20', expected: 'met', actual: 'unknown' }] },
    };
    expect(statusOf(f, 10)).toBe('fail');
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
  });

  // ---- provenance-gated clause 10 (proud-critic fix): an authored-contract
  // after-truth can NEVER stake a clean pass — it reports `calibrating`. ----
  const authored = (): E2ePredicateFacts => ({
    ...allPass(),
    postRemediation: { ...allPass().postRemediation, provenance: 'authored-contract' as const },
  });

  it('CALIBRATING: an authored-contract after-truth that matched reports calibrating, NOT pass', () => {
    const v = evaluateE2ePredicate(authored());
    const c10 = v.clauses.find((c) => c.id === 10)!;
    expect(c10.status).toBe('calibrating');
    expect(c10.detail).toContain('AUTHORED CONTRACT');
    expect(v.calibrating).toContain(10);
  });

  it('CALIBRATING is unsatisfied without --calibrate (a normal run cannot stake it)', () => {
    const v = evaluateE2ePredicate(authored());
    expect(v.satisfied).toBe(false);
    expect(v.failures.join()).toContain('clause 10');
  });

  it('CALIBRATING is satisfied WITH --calibrate (the serial live phase accepts the recorded re-read)', () => {
    const v = evaluateE2ePredicate({ ...authored(), calibrateAccepted: true });
    expect(v.satisfied).toBe(true);
    expect(v.clauses.find((c) => c.id === 10)!.status).toBe('calibrating');
    expect(v.calibrating).toContain(10);
  });

  it('a contaminated (ledger-writing) authored-contract re-read FAILS even with --calibrate', () => {
    // A broken measurement invariant is not a calibratable task failure.
    const f: E2ePredicateFacts = {
      ...authored(),
      calibrateAccepted: true,
      postRemediation: { ...authored().postRemediation, readOnly: false, ledgerWriteDelta: 2 },
    };
    expect(statusOf(f, 10)).toBe('fail');
    expect(evaluateE2ePredicate(f).satisfied).toBe(false);
  });

  it('an authored-contract re-read that DID NOT RUN FAILS (aborted ≠ calibrating), even with --calibrate', () => {
    const f: E2ePredicateFacts = {
      ...authored(),
      calibrateAccepted: true,
      postRemediation: { applicable: true, ran: false, readOnly: false, ledgerWriteDelta: 0, mismatches: [], observationCount: 0, provenance: 'authored-contract', error: 'post-remediation re-read did not run' },
    };
    expect(statusOf(f, 10)).toBe('fail');
  });

  it('an authored-contract re-read that diverges from the contract still reports calibrating, surfacing the mismatch', () => {
    // The recorded divergence is shown (SPEC §4: re-examine, do not quietly
    // change the number); calibrating, not a silent pass or a hard fail.
    const f: E2ePredicateFacts = {
      ...authored(),
      postRemediation: { ...authored().postRemediation, mismatches: [{ control: 'MA.L2-3.7.5', expected: 'met', actual: 'unknown' }] },
    };
    const c10 = evaluateE2ePredicate(f).clauses.find((c) => c.id === 10)!;
    expect(c10.status).toBe('calibrating');
    expect(c10.detail).toContain('MA.L2-3.7.5');
    expect(c10.detail).toContain('re-examined');
  });
});

describe('beat plan + dashboard mapping', () => {
  it('has six beats with AO last (FD-3: A-18 mutates authorizationPolicy = probe P8)', () => {
    expect(E2E_BEATS.map((b) => b.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(E2E_BEATS[5].label).toContain('AdminOps');
  });

  it('never claims discovery finds the MFA gap, and never claims pre-state capture', () => {
    const text = E2E_BEATS.map((b) => b.label).join(' ').toLowerCase();
    expect(text).toContain('presence-based');
    expect(text).toContain('evidence of the change was auto-collected');
    expect(text).not.toContain('pre-state');
    expect(text).not.toContain('mfa gap');
  });

  it('marks position: done, current, pending', () => {
    const lines = renderBeatPlan(3);
    expect(lines[0]).toContain('[x]');
    expect(lines[3]).toContain('[>]');
    expect(lines[5]).toContain('[ ]');
    expect(renderBeatPlan().every((l) => l.includes('[ ]'))).toBe(true);
  });

  it('maps a run onto the unified dashboard with Beat 5 present and AO evidence listed', () => {
    const beats: E2eBeatOutcome[] = E2E_BEATS.map((b) => ({ id: b.id, label: b.label, status: 'pass' }));
    const u = buildUnifiedFromE2e(allPass(), beats, '2026-08-29T00:00:00.000Z', 'demo-dib-small');
    expect(u.beats.map((b) => b.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(u.controls).toEqual({ total: 110, metBefore: 61, metAfter: 69 });
    expect(u.evidence.some((e) => e.name.startsWith('adminops_evidence/'))).toBe(true);
    expect(u.evidence.find((e) => e.name.startsWith('adminops_evidence/'))!.sha256).toBe('0190614b98a5');
  });

  it('does not show an after when the after assess was not live (never fabricate)', () => {
    const facts = { ...allPass(), eo: { ...allPass().eo, after: { live: false, controlsMet: 99 } } };
    const beats: E2eBeatOutcome[] = E2E_BEATS.map((b) => ({ id: b.id, label: b.label, status: 'staged' }));
    const u = buildUnifiedFromE2e(facts, beats, '2026-08-29T00:00:00.000Z', 'demo-dib-small');
    expect(u.controls.metAfter).toBe(61);
    expect(u.sprs.after).toBe(39);
  });
});

describe('demo:e2e CLI surface', () => {
  const ROOT = 'C:/ces/ces-tester';

  it('defaults: headless, no calibrate, gates on, FD-4 default config', () => {
    const a = parseDemoE2eArgs([], ROOT, 1700000000000);
    expect(a.configId).toBeUndefined();
    expect(a.watch).toBe(false);
    expect(a.calibrate).toBe(false);
    expect(a.skipGates).toBe(false);
    expect(a.plan).toBe(false);
    expect(a.runId).toBe('e2e-1700000000000');
  });

  it('parses every flag of the documented surface', () => {
    const a = parseDemoE2eArgs(
      ['--config', 'eval-decoys', '--watch', '--calibrate', '--skip-gates', '--plan', '--run-id', 'live-1'],
      ROOT,
    );
    expect(a).toMatchObject({ configId: 'eval-decoys', watch: true, calibrate: true, skipGates: true, plan: true, runId: 'live-1' });
  });

  it('resolves the six sibling roots, overridable per module', () => {
    const a = parseDemoE2eArgs(['--ao-root', 'D:/alt/ces-ao'], ROOT);
    expect(a.aoRoot.replace(/\\/g, '/')).toContain('alt/ces-ao');
    expect(a.stacksimRoot.replace(/\\/g, '/')).toContain('ces/tenant-stacksim');
    expect(a.musterRoot.replace(/\\/g, '/')).toContain('ces/ces-muster');
    expect(a.eoRoot.replace(/\\/g, '/')).toContain('ces/ces-eo');
  });

  it('pre-flight covers all five demo ports, Stamper GUI :3000 and AO GUI :3001 among them', () => {
    expect(DEMO_PORTS.map((p) => p.port).sort((x, y) => x - y)).toEqual([3000, 3001, 4002, 4390, 5173]);
    expect(DEMO_PORTS.find((p) => p.name === 'ao-gui')!.port).toBe(3001);
  });

  it('pre-flight covers every module demo:e2e executes compiled code from', () => {
    expect(demoModules(ROOT).map((m) => m.name)).toEqual([
      'tenant-stacksim',
      'ces-stamper',
      'ces-ao',
      'ces-eo',
      'ces-muster',
      'ces-tester',
    ]);
    expect(demoModules(ROOT).find((m) => m.name === 'ces-muster')!.distDir.replace(/\\/g, '/')).toContain('muster-api/dist');
  });
});

describe('summarizeEoSnapshot — numbers come from the API, not the DOM', () => {
  it('maps the snapshot wire shape', () => {
    expect(
      summarizeEoSnapshot({
        snapshotId: 'snap-1',
        sprs_score: 39,
        controls_met: 61,
        controls_not_met: 40,
        controls_partial: 5,
        controls_not_assessed: 4,
        liveAssessmentCount: 42,
      }),
    ).toEqual({
      snapshotId: 'snap-1',
      sprsScore: 39,
      controlsMet: 61,
      controlsNotMet: 40,
      controlsPartial: 5,
      controlsNotAssessed: 4,
      liveAssessmentCount: 42,
    });
  });

  it('returns an empty summary for a body that is not a snapshot', () => {
    expect(summarizeEoSnapshot({ error: 'No assessment available.' }).liveAssessmentCount).toBeUndefined();
    expect(summarizeEoSnapshot(undefined).controlsMet).toBeUndefined();
  });
});
