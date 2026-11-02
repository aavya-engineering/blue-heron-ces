// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the pacing axis.
 *
 * The distinction these tests defend is **`unmeasured` vs `fast`**. An op that
 * never ran in this tier has no measurement, and reporting that as "faster than
 * the catalog says" would be inventing evidence — the exact dishonesty the
 * harness exists to catch, committed by the harness itself.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runDemoActsTestCommand } from '../src/cli/acts-test-command.js';
import {
  buildPacingReport,
  catalogDelta,
  measuredByOp,
  measurementOf,
  paceVerdict,
  pacingFindings,
  suggestMs,
  summaryMarkdown,
  PACE_TOLERANCE,
} from '../src/demo/acts/pacing.js';
import type { ActGroupReport, ActsReport } from '../src/demo/acts/acts-report.js';

const group = (
  groupId: string,
  ops: readonly { opId: string; mode: string; ms: number; status: 'done' | 'failed' }[],
): ActGroupReport => ({
  groupId,
  status: 'pass',
  opIds: [...new Set(ops.map((o) => o.opId))],
  expectedPorts: [4390],
  armedPorts: [4390],
  armMs: 1_600,
  ops: ops.map((o, index) => ({ index, ...o })),
  artifacts: [],
  checks: [],
  findings: [],
  portsFreeAfter: true,
  log: [],
});

describe('paceVerdict', () => {
  it('is ok inside the tolerance and flags strictly outside it', () => {
    expect(paceVerdict(10_000, 10_000)).toBe('ok');
    expect(paceVerdict(20_000, 10_000)).toBe('ok'); // exactly 2.0x passes
    expect(paceVerdict(5_000, 10_000)).toBe('ok'); // exactly 0.5x passes
    expect(paceVerdict(20_001, 10_000)).toBe('slow');
    expect(paceVerdict(4_999, 10_000)).toBe('fast');
    expect(PACE_TOLERANCE).toEqual({ min: 0.5, max: 2.0 });
  });

  it('reports an op that never ran as UNMEASURED, never as fast', () => {
    expect(paceVerdict(null, 30_000)).toBe('unmeasured');
    expect(paceVerdict(Number.NaN, 30_000)).toBe('unmeasured');
  });
});

describe('suggestMs', () => {
  it('rounds to whole seconds below a minute and ten-second steps above', () => {
    expect(suggestMs(77_633)).toBe(80_000);
    expect(suggestMs(786_400)).toBe(790_000);
    expect(suggestMs(12_400)).toBe(12_000);
    // Never suggests zero, however fast the op was.
    expect(suggestMs(12)).toBe(1_000);
  });
});

describe('measurementOf and catalogDelta', () => {
  it('suggests a new catalog value only when the verdict is not ok', () => {
    const ok = measurementOf({ opId: 'muster-readiness', catalogMs: 80_000, measuredMs: 77_633 });
    expect(ok.verdict).toBe('ok');
    expect(ok.suggestMs).toBeNull();

    const slow = measurementOf({ opId: 'eo-review', catalogMs: 10_000, measuredMs: 300_000 });
    expect(slow.verdict).toBe('slow');
    expect(slow.suggestMs).toBe(300_000);

    const never = measurementOf({ opId: 'ao-registry', catalogMs: 30_000, measuredMs: null });
    expect(never.verdict).toBe('unmeasured');
    expect(never.suggestMs).toBeNull();
  });

  it('returns only the rows a human has to act on', () => {
    const rows = [
      measurementOf({ opId: 'a', catalogMs: 10_000, measuredMs: 10_000 }),
      measurementOf({ opId: 'b', catalogMs: 10_000, measuredMs: 300_000 }),
      measurementOf({ opId: 'c', catalogMs: 10_000, measuredMs: null }),
    ];
    expect(catalogDelta(rows).map((m) => m.opId)).toEqual(['b', 'c']);
  });
});

describe('measuredByOp', () => {
  it('takes the SLOWEST run of an op, because the prep budget is a worst case', () => {
    const measured = measuredByOp([
      group('g', [
        { opId: 'muster-readiness', mode: 'warm', ms: 77_633, status: 'done' },
        { opId: 'muster-readiness', mode: 'live', ms: 81_004, status: 'done' },
      ]),
    ]);
    expect(measured.get('muster-readiness')).toEqual({ ms: 81_004, completed: true });
  });

  it('counts a FAILED run too, and flags it — wall time is wall time', () => {
    // stamper-execute ran its full 12.9 minutes and THEN reported an unexpected
    // task failure. Discarding that would throw away the most expensive number
    // in the run and report the op as `unmeasured`, which is simply untrue: the
    // presenter waited it out either way.
    const measured = measuredByOp([
      group('g', [{ opId: 'stamper-execute', mode: 'warm', ms: 774_297, status: 'failed' }]),
    ]);
    expect(measured.get('stamper-execute')).toEqual({ ms: 774_297, completed: false });
    const m = measurementOf({ opId: 'stamper-execute', catalogMs: 420_000, measuredMs: 774_297, completed: false });
    expect(m.verdict).toBe('ok'); // 1.84x — inside the tolerance
    expect(m.completed).toBe(false);
  });
});

describe('buildPacingReport and its findings', () => {
  const report = buildPacingReport(
    [
      group('muster-readiness', [
        { opId: 'muster-readiness', mode: 'warm', ms: 77_633, status: 'done' },
      ]),
    ],
    { 'muster-readiness': 80_000, 'ao-registry': 30_000, 'eo-review': 10_000 },
    { 'eo-review': [300_000] },
  );

  it('names every catalogued op, measured or not', () => {
    expect(report.measurements.map((m) => m.opId)).toEqual([
      'ao-registry',
      'eo-review',
      'muster-readiness',
    ]);
    expect(report.measurements.find((m) => m.opId === 'ao-registry')?.verdict).toBe('unmeasured');
    expect(report.measurements.find((m) => m.opId === 'muster-readiness')?.verdict).toBe('ok');
  });

  it('carries the dossier claims through so DD10 and the catalog stay in one view', () => {
    expect(report.measurements.find((m) => m.opId === 'eo-review')?.dossierClaimsMs).toEqual([
      300_000,
    ]);
  });

  it('emits advisory pace findings, and NONE for an op that was never measured', () => {
    const findings = pacingFindings(report);
    expect(findings.map((f) => f.subject)).toEqual([]);
    const withMeasurement = buildPacingReport(
      [group('g', [{ opId: 'eo-review', mode: 'warm', ms: 300_000, status: 'done' }])],
      { 'eo-review': 10_000 },
    );
    const real = pacingFindings(withMeasurement);
    expect(real).toHaveLength(1);
    expect(real[0]).toMatchObject({ severity: 'warn', failureClass: 'pace', rule: 'PACE1' });
  });
});

describe('summaryMarkdown', () => {
  const acts: ActsReport = {
    schemaVersion: 1,
    runId: 'acts-1',
    startedAt: '2026-09-06T00:00:00.000Z',
    endedAt: '2026-09-06T00:10:00.000Z',
    tier: 'quick',
    exitCode: 0,
    docs: {
      dossierPath: 'DEMO-ACTS-DOSSIER.md',
      entryCount: 16,
      failCount: 0,
      warnCount: 0,
      skipped: ['D.1 simstack-create'],
      findings: [],
    },
    groups: [
      {
        ...group('muster-readiness', [
          { opId: 'muster-readiness', mode: 'warm', ms: 77_633, status: 'done' },
        ]),
        checks: [
          { id: 'MR1', status: 'pass', detail: 'artifact parses', evidence: { observations: 329 } },
        ],
      },
    ],
    findings: [],
    pacing: buildPacingReport(
      [group('g', [{ opId: 'muster-readiness', mode: 'warm', ms: 77_633, status: 'done' }])],
      { 'muster-readiness': 80_000 },
    ),
  };

  it('writes the group table, the checks with their evidence, and the pacing table', () => {
    const md = summaryMarkdown(acts, '/root');
    expect(md).toContain('# demo:acts-test — acts-1');
    expect(md).toContain('| `muster-readiness` | **pass** |');
    expect(md).toContain('**MR1** PASS');
    expect(md).toContain('observations=329');
    expect(md).toContain('| `muster-readiness` | 80000 | 77633 | ok | — |');
  });

  it('says out loud that evidence also lives in the other directory', () => {
    expect(summaryMarkdown(acts, '/root')).toContain('runs/show/acts-1');
  });
});

/* ---------------------------------------------- the CLI's pacing + re-analysis */

describe('demo:acts-test pacing wiring', () => {
  const testerRoot = path.resolve(__dirname, '..');

  it('reports every catalogued op, including the ones the tier never ran', async () => {
    const runId = `vitest-pace-${process.pid}`;
    await runDemoActsTestCommand(['--docs-only', '--run-id', runId], testerRoot, {
      log: () => undefined,
    });
    const dir = path.join(testerRoot, 'runs', 'acts-test', runId);
    const report = JSON.parse(
      fs.readFileSync(path.join(dir, 'acts-report.json'), 'utf8'),
    ) as ActsReport;

    expect(report.pacing?.measurements.map((m) => m.opId).sort()).toEqual([
      'ao-make-change',
      'ao-registry',
      'eo-review',
      'eo-show-change-captured',
      'muster-adaptive-interview',
      'muster-auto-analysis',
      'muster-connect-tenant',
      'muster-consent-and-attest',
      'muster-generate-sprs-mp',
      'muster-readiness',
      'muster-rollup',
      'simstack-create',
      'simstack-destroy',
      'stamper-execute',
      'stamper-translate',
    ]);
    // A docs-only run measured nothing, so EVERY op is `unmeasured` — never
    // "fast", and never silently absent.
    expect(report.pacing?.measurements.every((m) => m.verdict === 'unmeasured')).toBe(true);
    // ...and an unmeasured op raises no pacing finding: we do not report on
    // what we did not measure.
    expect(report.findings.some((f) => f.rule === 'PACE1')).toBe(false);
    // The dossier's own minute prose rides along, so DD10 and the catalog are
    // readable in one table. `eo-review` now carries NO minute claim at all —
    // Slice F deleted the "about five minutes" that the 4.7 s measurement
    // disproved — while the Config pair still states real minute costs.
    expect(report.pacing?.measurements.find((m) => m.opId === 'eo-review')?.dossierClaimsMs).toEqual(
      [],
    );
    expect(
      report.pacing?.measurements.find((m) => m.opId === 'stamper-translate')?.dossierClaimsMs,
    ).toContain(300_000);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes summary.md beside the report', async () => {
    const runId = `vitest-summary-${process.pid}`;
    await runDemoActsTestCommand(['--docs-only', '--run-id', runId], testerRoot, {
      log: () => undefined,
    });
    const dir = path.join(testerRoot, 'runs', 'acts-test', runId);
    const md = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8');
    expect(md).toContain(`# demo:acts-test — ${runId}`);
    expect(md).toContain('## Pacing');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('--from-report re-analyses a prior run WITHOUT reaching the runtime', async () => {
    const priorId = `vitest-prior-${process.pid}`;
    const priorDir = path.join(testerRoot, 'runs', 'acts-test', priorId);
    fs.mkdirSync(priorDir, { recursive: true });
    const prior: ActsReport = {
      schemaVersion: 1,
      runId: priorId,
      startedAt: '2026-09-06T00:00:00.000Z',
      endedAt: '2026-09-06T00:20:00.000Z',
      tier: 'full',
      exitCode: 0,
      docs: {
        dossierPath: 'DEMO-ACTS-DOSSIER.md',
        entryCount: 16,
        failCount: 0,
        warnCount: 0,
        skipped: [],
        findings: [],
      },
      groups: [
        {
          groupId: 'eo-review',
          status: 'pass',
          opIds: ['eo-review'],
          expectedPorts: [4390, 4002],
          armedPorts: [4390, 4002],
          armMs: 2_000,
          ops: [
            { index: 0, opId: 'eo-review', mode: 'warm', ms: 301_000, status: 'done' },
          ],
          artifacts: [],
          checks: [],
          findings: [],
          portsFreeAfter: true,
          log: [],
        },
      ],
      findings: [],
    };
    fs.writeFileSync(path.join(priorDir, 'acts-report.json'), JSON.stringify(prior));

    const runId = `vitest-reanalyse-${process.pid}`;
    const lines: string[] = [];
    const code = await runDemoActsTestCommand(
      [
        '--from-report',
        path.join('runs', 'acts-test', priorId, 'acts-report.json'),
        '--run-id',
        runId,
      ],
      testerRoot,
      {
        log: (l) => lines.push(l),
        runGroups: () => {
          throw new Error('--from-report must never reach the runtime');
        },
      },
    );
    // 0, not 1: after Slice F the real dossier is clean, and the prior run's
    // groups carried no findings either.
    expect(code).toBe(0);

    const dir = path.join(testerRoot, 'runs', 'acts-test', runId);
    const re = JSON.parse(fs.readFileSync(path.join(dir, 'acts-report.json'), 'utf8')) as ActsReport;
    expect(re.groups.map((g) => g.groupId)).toEqual(['eo-review']);
    const eo = re.pacing?.measurements.find((m) => m.opId === 'eo-review');
    expect(eo?.measuredMs).toBe(301_000);
    expect(eo?.verdict).toBe('slow');
    expect(eo?.suggestMs).toBe(300_000);
    expect(lines.join('\n')).toContain('re-analysing 1 act group(s)');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(priorDir, { recursive: true, force: true });
  });

  it('exits 2 when --from-report names something it cannot read', async () => {
    const code = await runDemoActsTestCommand(
      ['--from-report', 'runs/acts-test/nope/acts-report.json'],
      testerRoot,
      { log: () => undefined },
    );
    expect(code).toBe(2);
  });
});
