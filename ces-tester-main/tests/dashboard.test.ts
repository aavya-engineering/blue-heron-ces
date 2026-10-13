// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// PLAN.md M4 tasks 2-3: dashboard data collection, flake detection, and the
// self-contained HTML generator (offline: no external refs, data inlined).
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildRunSummary, writeLiveSnapshot, writeRunSummary, type RunScenarioSummary } from '../src/results/run-summary.js';
import { scenarioHistories } from '../src/results/flaky.js';
import { buildDashboardData, collectRunSummaries, embedJson, generateDashboardHtml } from '../src/results/dashboard-generator.js';

function row(id: string, status: 'pass' | 'fail' | 'crash'): RunScenarioSummary {
  return { scenario_id: id, status };
}

describe('flaky detection (scenarioHistories)', () => {
  const runs = [
    buildRunSummary('r1', new Date('2026-07-26T01:00:00Z'), [row('a', 'pass'), row('b', 'fail'), row('zz', 'fail')], { completedAt: new Date('2026-07-26T01:20:00Z') }),
    buildRunSummary('r2', new Date('2026-07-26T02:00:00Z'), [row('a', 'pass'), row('b', 'pass'), row('zz', 'fail')], { completedAt: new Date('2026-07-26T02:20:00Z') }),
    buildRunSummary('r3', new Date('2026-07-26T03:00:00Z'), [row('a', 'pass'), row('b', 'fail'), row('zz', 'fail')], { completedAt: new Date('2026-07-26T03:20:00Z') }),
  ];

  it('mixed verdicts = flaky; all-pass = stable; all-fail (deliberate-fail) = consistent, NOT flaky', () => {
    const h = scenarioHistories(runs);
    const byId = Object.fromEntries(h.map((x) => [x.scenario_id, x]));
    expect(byId['a'].flaky).toBe(false);
    expect(byId['a'].pass_count).toBe(3);
    expect(byId['b'].flaky).toBe(true);
    expect(byId['b'].fail_count).toBe(2);
    expect(byId['b'].sequence).toEqual(['fail', 'pass', 'fail']);
    expect(byId['zz'].flaky).toBe(false);
    expect(byId['zz'].fail_count).toBe(3);
  });

  it('in-flight live snapshots are excluded from history', () => {
    const withLive = [...runs, buildRunSummary('r4', new Date('2026-07-26T04:00:00Z'), [row('a', 'fail')], { inProgress: true })];
    const byId = Object.fromEntries(scenarioHistories(withLive).map((x) => [x.scenario_id, x]));
    expect(byId['a'].runs_seen).toBe(3); // r4 (in flight) not counted
    expect(byId['a'].flaky).toBe(false);
  });
});

describe('dashboard generator', () => {
  it('collects summaries oldest-first, skips malformed, prefers summary.json over live.json', async () => {
    const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ces-dash-'));
    await writeRunSummary(runsRoot, buildRunSummary('r2', new Date('2026-07-26T02:00:00Z'), [row('a', 'pass')], { completedAt: new Date() }));
    await writeRunSummary(runsRoot, buildRunSummary('r1', new Date('2026-07-26T01:00:00Z'), [row('a', 'fail')], { completedAt: new Date() }));
    await writeLiveSnapshot(runsRoot, buildRunSummary('r3', new Date('2026-07-26T03:00:00Z'), [row('a', 'pass')], { inProgress: true }));
    await fs.mkdir(path.join(runsRoot, 'junk'), { recursive: true });
    await fs.writeFile(path.join(runsRoot, 'junk', 'summary.json'), 'not json', 'utf8');

    const collected = await collectRunSummaries(runsRoot);
    expect(collected.map((r) => r.run_id)).toEqual(['r1', 'r2', 'r3']);
    expect(collected[2].in_progress).toBe(true);
  });

  it('generates a fully self-contained page: data inlined, no external references, script-safe embedding', async () => {
    const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ces-dash2-'));
    // A scenario id crafted to break out of the <script> block if unescaped.
    const evil = 'x</script><script>alert(1)';
    await writeRunSummary(runsRoot, buildRunSummary('r1', new Date('2026-07-26T01:00:00Z'), [row(evil, 'fail'), row('ok', 'pass')], { completedAt: new Date() }));

    const data = await buildDashboardData(runsRoot, new Date('2026-07-26T05:00:00Z'));
    const html = generateDashboardHtml(data);

    expect(html).toContain('ces-tester Results Dashboard');
    expect(html).toContain('"run_id":"r1"');
    expect(html).not.toContain('x</script>'); // escaped to </script>
    // Self-contained: no external loads of any kind.
    expect(html).not.toMatch(/src\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/href\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/@import|link rel="stylesheet"/i);
  });

  it('embedJson escapes every "<"', () => {
    expect(embedJson({ a: '</script>' })).not.toContain('<');
  });

  it('latest-run drill-down data comes from the newest COMPLETED run', async () => {
    const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ces-dash3-'));
    const result = {
      scenario_id: 'a', status: 'pass', started_at: '2026-07-26T02:00:00Z', duration_ms: 1000,
      assertions: [{ stage: 'expected_state', check: 'c', result: 'pass' }],
      diverged_commands: [], stacksim_ledger_ref: 'r2/a/ledger-snapshot.json',
    };
    await fs.mkdir(path.join(runsRoot, 'r2', 'a'), { recursive: true });
    await fs.writeFile(path.join(runsRoot, 'r2', 'a', 'result.json'), JSON.stringify(result), 'utf8');
    await writeRunSummary(runsRoot, buildRunSummary('r2', new Date('2026-07-26T02:00:00Z'), [{ ...row('a', 'pass'), result_path: 'r2/a/result.json' }], { completedAt: new Date() }));
    await writeLiveSnapshot(runsRoot, buildRunSummary('r9', new Date('2026-07-26T09:00:00Z'), [row('a', 'fail')], { inProgress: true }));

    const data = await buildDashboardData(runsRoot);
    expect(data.latest_results).toHaveLength(1);
    expect(data.latest_results[0].scenario_id).toBe('a');
  });
});
