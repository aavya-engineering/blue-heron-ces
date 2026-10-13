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
 * "Paced well" is the founder's second question, and it has a specific failure
 * mode: **a pacing lie**. The op catalog's `typicalWarmMs` feeds the `--check`
 * prep-budget warning and the dossier's timing prose feeds the talk track, so a
 * number that is a guess dressed as a measurement mis-sets a presenter's
 * expectations on stage — they stand in silence for five minutes having promised
 * ten seconds.
 *
 * This module turns measured wall time into a verdict and a concrete catalog
 * delta. It is pure and imports only `node:*` and the report types, so
 * `--from-report` can re-analyse a prior run without re-running anything.
 */

import * as path from 'node:path';
import type {
  ActGroupReport,
  ActsReport,
  Finding,
  PacingMeasurement,
  PacingReport,
} from './acts-report.js';

/**
 * The same tolerance DD10 uses on the dossier's prose, applied to the catalog:
 * flagged **strictly outside** [0.5x, 2.0x], so 2.0x exactly passes.
 */
export const PACE_TOLERANCE = { min: 0.5, max: 2.0 } as const;

export type PaceVerdict = PacingMeasurement['verdict'];

export function paceVerdict(measuredMs: number | null, catalogMs: number): PaceVerdict {
  if (measuredMs === null || !Number.isFinite(measuredMs)) return 'unmeasured';
  if (catalogMs <= 0) return 'slow';
  const ratio = measuredMs / catalogMs;
  if (ratio > PACE_TOLERANCE.max) return 'slow';
  if (ratio < PACE_TOLERANCE.min) return 'fast';
  return 'ok';
}

/**
 * What the catalog SHOULD say. Rounded to whole seconds (10 s above a minute)
 * because a `typicalWarmMs` carrying millisecond precision claims a repeatability
 * that a browser-driven op against a live sibling does not have.
 */
export function suggestMs(measuredMs: number): number {
  if (measuredMs >= 60_000) return Math.round(measuredMs / 10_000) * 10_000;
  return Math.max(1_000, Math.round(measuredMs / 1_000) * 1_000);
}

export interface Measured {
  readonly opId: string;
  readonly catalogMs: number;
  /** null when this op was never run in this tier — "unmeasured", not "fast". */
  readonly measuredMs: number | null;
  readonly completed?: boolean;
  readonly dossierClaimsMs?: readonly number[];
}

export function measurementOf(input: Measured): PacingMeasurement {
  const verdict = paceVerdict(input.measuredMs, input.catalogMs);
  return {
    opId: input.opId,
    catalogMs: input.catalogMs,
    measuredMs: input.measuredMs,
    suggestMs:
      input.measuredMs === null || verdict === 'ok' ? null : suggestMs(input.measuredMs),
    verdict,
    dossierClaimsMs: [...(input.dossierClaimsMs ?? [])],
    completed: input.completed ?? false,
  };
}

/** The rows a human has to act on: everything the catalog gets wrong, or never learned. */
export function catalogDelta(
  measurements: readonly PacingMeasurement[],
): readonly PacingMeasurement[] {
  return measurements.filter((m) => m.verdict !== 'ok');
}

/**
 * The slowest run of each op across the whole report.
 *
 * **Slowest rather than mean**, because the prep budget is a worst-case promise
 * to the presenter: averaging an op that is fast once and slow once hides the
 * beat that will actually strand them.
 *
 * **A FAILED run still counts.** `stamper-execute` ran its full 12.9 minutes and
 * then reported an unexpected task failure — discarding that as "not a
 * measurement" would throw away the single most expensive number in the run and
 * report the op as `unmeasured`. Wall time is wall time. The `completed` flag
 * carries the caveat so no reader has to cross-reference the op status to know
 * whether the measured run also worked.
 */
export function measuredByOp(
  groups: readonly ActGroupReport[],
): Map<string, { ms: number; completed: boolean }> {
  const out = new Map<string, { ms: number; completed: boolean }>();
  for (const group of groups) {
    for (const op of group.ops) {
      const seen = out.get(op.opId);
      if (seen === undefined || op.ms > seen.ms) {
        out.set(op.opId, { ms: op.ms, completed: op.status === 'done' });
      }
    }
  }
  return out;
}

export function buildPacingReport(
  groups: readonly ActGroupReport[],
  catalogMsById: Readonly<Record<string, number>>,
  dossierClaimsById: Readonly<Record<string, readonly number[]>> = {},
): PacingReport {
  const measured = measuredByOp(groups);
  const measurements = Object.keys(catalogMsById)
    .sort()
    .map((opId) =>
      measurementOf({
        opId,
        catalogMs: catalogMsById[opId],
        measuredMs: measured.get(opId)?.ms ?? null,
        completed: measured.get(opId)?.completed ?? false,
        dossierClaimsMs: dossierClaimsById[opId],
      }),
    );
  return { measurements, catalogDelta: [...catalogDelta(measurements)] };
}

/**
 * Pacing findings are `pace`-classed and advisory (`warn`): a catalog value that
 * is wrong is a documentation problem, not a broken act. An op that was never
 * measured produces no finding at all — silence about what we did not measure is
 * the honest reporting, and `unmeasured` already says so in the table.
 */
export function pacingFindings(pacing: PacingReport): Finding[] {
  return pacing.catalogDelta
    .filter((m) => m.verdict !== 'unmeasured')
    .map((m) => ({
      rule: 'PACE1',
      severity: 'warn' as const,
      failureClass: 'pace' as const,
      subject: m.opId,
      message: `measured ${m.measuredMs} ms against typicalWarmMs ${m.catalogMs} (${m.verdict}) — suggest ${m.suggestMs}`,
    }));
}

const ms = (v: number | null): string => (v === null ? '—' : `${(v / 1000).toFixed(1)} s`);

export function summaryMarkdown(report: ActsReport, testerRoot: string): string {
  const lines: string[] = [
    `# demo:acts-test — ${report.runId}`,
    '',
    `**Tier:** ${report.tier} · **Started:** ${report.startedAt} · **Exit:** ${report.exitCode}`,
    '',
    '## Documentation axis',
    '',
    `${report.docs.failCount} FAIL · ${report.docs.warnCount} WARN · ${report.docs.skipped.length} skipped (PROPOSED)`,
    '',
  ];

  if (report.groups.length > 0) {
    lines.push('## Act groups', '', '| Group | Status | arm ms | ops | artifacts | ports free |', '|---|---|---|---|---|---|');
    for (const g of report.groups) {
      lines.push(
        `| \`${g.groupId}\` | **${g.status}** | ${ms(g.armMs)} | ${g.ops
          .map((o) => `${o.opId}/${o.mode} ${ms(o.ms)}`)
          .join('<br>')} | ${g.artifacts.length} | ${g.portsFreeAfter === null ? '—' : g.portsFreeAfter} |`,
      );
    }
    lines.push('');

    lines.push('## Checks', '');
    for (const g of report.groups) {
      lines.push(`### ${g.groupId}`, '');
      for (const c of g.checks) {
        const evidence = c.evidence
          ? ` — \`${Object.entries(c.evidence)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')}\``
          : '';
        lines.push(`- **${c.id}** ${c.status.toUpperCase()}: ${c.detail}${evidence}`);
      }
      lines.push('');
    }
  }

  if (report.pacing) {
    lines.push(
      '## Pacing',
      '',
      '| op | catalog `typicalWarmMs` | measured | verdict | suggest |',
      '|---|---|---|---|---|',
    );
    for (const m of report.pacing.measurements) {
      lines.push(
        `| \`${m.opId}\` | ${m.catalogMs} | ${m.measuredMs ?? '—'}${m.measuredMs !== null && !m.completed ? ' *(run failed)*' : ''} | ${m.verdict} | ${m.suggestMs ?? '—'} |`,
      );
    }
    lines.push('');
  }

  if (report.findings.length > 0) {
    lines.push('## Findings', '');
    for (const f of report.findings) {
      lines.push(
        `- \`${f.severity.toUpperCase()}\` **${f.rule}** [${f.failureClass}] ${f.subject} — ${f.message}`,
      );
    }
    lines.push('');
  }

  lines.push(
    '---',
    '',
    `Evidence for this run also lives in \`${path
      .join('runs', 'show', report.runId)
      .replace(/\\/g, '/')}\` — arming hardcodes that directory, so one harness run`,
    'touches two. `runs/` is gitignored: transcribe what matters into',
    '`docs/context/IMPLEMENTATION_LOG.md`.',
    '',
  );
  void testerRoot;
  return lines.join('\n');
}
