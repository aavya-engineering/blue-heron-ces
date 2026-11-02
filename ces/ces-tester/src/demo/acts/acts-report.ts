// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-4 act harness — the report the harness writes and the CLI judges.
 *
 * One idea carries the whole design: **`failureClass`**. A demo-act that is
 * genuinely broken (`act-red`) and a harness that is broken (`harness-defect`)
 * both produce a non-zero exit, and without the class they are indistinguishable
 * in the output. That is the masking trap — a real defect riding along behind an
 * expected red. So every finding is classed, and the tier floor gates on
 * `harness-defect` being absent, independently of any `act-red`.
 *
 * The second idea: **`skipped` is a status, never an absence.** A check that did
 * not run says so and carries its reason. Absence of a red is not evidence.
 *
 * Imports only `node:*` — this module sits under the docs check, which must be
 * reachable without a browser, a server or a sibling process.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const ACTS_REPORT_SCHEMA_VERSION = 1;
export const ACTS_REPORT_SCHEMA = 'schemas/demo-acts-test.schema.json';
/** The roll-up artifact's filename inside `runs/acts-test/<runId>/`. */
export const ACTS_REPORT_FILE = 'acts-report.json';

/**
 * Why a finding is a finding. The distinction that matters most:
 * - `act-red`   — the demo-act is genuinely broken. Honest, recorded, exits
 *                 non-zero, and NEVER pinned or skip-listed to force green.
 * - `harness-defect` — the harness is broken. A `--full` run containing one of
 *                 these fails the tier floor no matter what else passed.
 * - `environment` — a precondition of the world, not of the act (a missing
 *                 sibling build, a family with no rows to screenshot).
 */
export type FailureClass = 'act-red' | 'doc-drift' | 'pace' | 'environment' | 'harness-defect';

export const FAILURE_CLASSES: readonly FailureClass[] = [
  'act-red',
  'doc-drift',
  'pace',
  'environment',
  'harness-defect',
];

export type FindingSeverity = 'fail' | 'warn';

export interface Finding {
  /** Stable rule id: `DD3`, `MR1`, `SE3`, `TD1`, ... */
  readonly rule: string;
  readonly severity: FindingSeverity;
  readonly failureClass: FailureClass;
  /** What the finding is about: `D.15`, `eo-review`, `stamper-execute`. */
  readonly subject: string;
  readonly message: string;
  /** Source line, when the finding points at a document. */
  readonly line?: number;
}

export type CheckStatus = 'pass' | 'fail' | 'skipped';

/**
 * The record of ONE per-act check having run. A green branch is proven by a
 * `pass` with its evidence, never by the absence of a `fail`.
 */
export interface CheckResult {
  readonly id: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** Free-form positive proof — SE3's partition counts live here. */
  readonly evidence?: Readonly<Record<string, string | number | boolean>>;
}

export interface OpMeasurement {
  readonly index: number;
  readonly opId: string;
  readonly mode: string;
  readonly ms: number;
  readonly status: 'done' | 'failed';
  readonly error?: string;
}

export type GroupStatus = 'pass' | 'failed' | 'skipped';

export interface ActGroupReport {
  readonly groupId: string;
  readonly status: GroupStatus;
  readonly opIds: readonly string[];
  /** Ports the roster says this group arms. */
  readonly expectedPorts: readonly number[];
  /** Ports the run actually brought up, as reported by the armed environment. */
  readonly armedPorts: readonly number[];
  /** Wall time of `prepare()` — arming plus the whole warm chain. */
  readonly armMs: number | null;
  readonly ops: readonly OpMeasurement[];
  /** Artifact paths as they appear in the FINISHED show report, not as fired. */
  readonly artifacts: readonly string[];
  readonly checks: readonly CheckResult[];
  readonly findings: readonly Finding[];
  /** TD1: every expected port probed free after `dispose()`. */
  readonly portsFreeAfter: boolean | null;
  readonly log: readonly string[];
}

export interface DocsReport {
  readonly dossierPath: string;
  readonly entryCount: number;
  readonly failCount: number;
  readonly warnCount: number;
  /** DD9 — PROPOSED entries, reported skipped rather than failed. */
  readonly skipped: readonly string[];
  readonly findings: readonly Finding[];
}

export interface PacingMeasurement {
  readonly opId: string;
  readonly catalogMs: number;
  readonly measuredMs: number | null;
  readonly suggestMs: number | null;
  readonly verdict: 'ok' | 'slow' | 'fast' | 'unmeasured';
  readonly dossierClaimsMs: readonly number[];
  /**
   * Whether the run this time came from also SUCCEEDED. Wall time is wall time
   * — a presenter waits it out whether the act ends green or red — so a failed
   * run's duration is still a measurement. This flag is what stops a reader
   * mistaking "12.9 minutes, and it failed" for "12.9 minutes, and it worked".
   */
  readonly completed: boolean;
}

export interface PacingReport {
  readonly measurements: readonly PacingMeasurement[];
  readonly catalogDelta: readonly PacingMeasurement[];
}

export type ActsTier = 'docs-only' | 'quick' | 'full' | 'act';

export interface ActsReport {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly tier: ActsTier;
  readonly exitCode: number;
  readonly docs: DocsReport;
  readonly groups: readonly ActGroupReport[];
  /** Every finding from every source, flattened — the thing to grep. */
  readonly findings: readonly Finding[];
  readonly pacing?: PacingReport;
}

export function countSeverity(
  findings: readonly Finding[],
  severity: FindingSeverity,
): number {
  return findings.filter((f) => f.severity === severity).length;
}

export function findingsOfClass(
  findings: readonly Finding[],
  failureClass: FailureClass,
): readonly Finding[] {
  return findings.filter((f) => f.failureClass === failureClass);
}

/**
 * The tier floor. A `--full` run may legitimately end `act-red` and exit 1, but
 * it may NEVER contain a `harness-defect` — that is the check that stops a real
 * defect hiding behind an expected red.
 */
export function hasHarnessDefect(report: ActsReport): boolean {
  return findingsOfClass(report.findings, 'harness-defect').length > 0;
}

/** AD6: 0 pass · 1 checked-and-failed · 2 bad invocation / could not run. */
export function exitCodeForFindings(findings: readonly Finding[]): 0 | 1 {
  return countSeverity(findings, 'fail') > 0 ? 1 : 0;
}

export function formatFinding(finding: Finding): string {
  const where = finding.line === undefined ? '' : `:${finding.line}`;
  const tag = finding.severity === 'fail' ? 'FAIL' : 'WARN';
  return `${tag} ${finding.rule} [${finding.failureClass}] ${finding.subject}${where} — ${finding.message}`;
}

export async function writeActsReport(report: ActsReport, absPath: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export async function writeGroupReport(group: ActGroupReport, absPath: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, `${JSON.stringify(group, null, 2)}\n`, 'utf8');
}

export async function readActsReport(absPath: string): Promise<ActsReport> {
  return JSON.parse(await fs.readFile(absPath, 'utf8')) as ActsReport;
}
