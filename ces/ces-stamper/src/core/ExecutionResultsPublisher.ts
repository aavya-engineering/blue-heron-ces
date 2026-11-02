// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-ST6 — one publisher for the per-control execution-results manifest, shared
 * by the GUI server's execute route and the CLI `execute` / `translate --execute`
 * paths (REQ-STAMPER-CLI-NO-RESULTS-MANIFEST).
 *
 * Manifest building stays in ExecutionResultsCollector.buildManifestForPlan —
 * this module only (a) turns a finished run's task states into collector
 * records (CLI path) and (b) writes the manifest to the canonical location
 * `<CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/execution-results-<planId>.json`,
 * where EO's StamperExecutionResultsLoader reads it.
 *
 * ROLE-2 (depth plan, 2026-10-30): Muster collects data and writes the plan
 * only; it receives no execution results. The Muster delivery (MS-R9 loop) and
 * its `.delivery.json` sidecar were removed.
 *
 * DEPTH-8 (depth plan §4): each control row also carries `objectives[]`, the verdict per assessment
 * objective from this run's postchecks (PostcheckRunner.objectiveVerdictsByControl). The row's own
 * `verdict` is unchanged: EO holds status. The ces-shared row schema does not list `objectives` yet
 * (CONTRACT CHANGE proposed in LOG-DEPTH-78.md); a zod parse strips it, the file keeps it.
 */
import * as path from 'path';
import { writeJsonArtifact } from 'ces-shared/persistence/files';
import { tenantStateDir } from './EvidenceReadinessAnalyzer.js';
import {
  ExecutionResultsCollector,
  ResultVerdict,
  metVerdict,
  EVIDENCE_NOT_SHOWN_OUTCOME,
  type ExecutionResultsManifest,
  type ManifestPlanRef,
} from './ExecutionResultsCollector.js';
import type { TaskStatus } from '../types/schema.types.js';
import { objectiveVerdictsByControl, runPostcheckResults, type CheckResult, type ObjectiveVerdict } from './PostcheckRunner.js';

/** DEPTH-8: a manifest row with its per-objective verdicts (ces-shared row + `objectives`). */
export type ManifestRowWithObjectives = ExecutionResultsManifest['results'][number] & { objectives?: ObjectiveVerdict[] };

// ---- (a) task states → collector records (CLI path) ----

export interface ResultsPlanTask {
  id: string;
  controls?: string[];
}

/**
 * Record per-control results from a finished run's task states, with the same
 * words the server route records: completed → SAT/'completed', accomplished →
 * SAT/'accomplished', failed → NOT_SAT/'failed'; skipped/pending are not
 * recorded. Directive = `_control_directives[cid] || 'automated'`.
 * synthetic-customer W3: a completed task `pendingGate` names (a manual gate with no operator
 * action) records its controls PROVISIONAL / 'manual_gate_pending' instead of SAT.
 * A control covered by several tasks is NOT_SAT if any of them failed (a later
 * SAT never overwrites a NOT_SAT).
 * PH-11 (founder Q3): a completed read-only prohibition task `prohibitionNotShown` names (its reads
 * showed nothing) records its controls NOT MET / 'document-prohibition', the GUI branch's row.
 * PH-13 (founder Q3): a completed registry task `evidenceNotShown` names (an evidence read showed
 * nothing; PowerShellAdapter output.evidenceShown === false) records its controls NOT_SAT /
 * 'evidence_not_shown', the GUI normal path's row. Precedence: failed, prohibition not shown,
 * pending gate, evidence not shown, then SAT.
 */
export function recordTaskStatuses(
  collector: ExecutionResultsCollector,
  tasks: ResultsPlanTask[],
  statusOf: (taskId: string) => TaskStatus | undefined,
  controlDirectives: Record<string, string> = {},
  pendingGate: (taskId: string) => boolean = () => false,
  prohibitionNotShown: (taskId: string) => boolean = () => false,
  evidenceNotShown: (taskId: string) => boolean = () => false,
): void {
  const failed = new Set<string>();
  const notShown = new Set<string>();
  const evidenceEmpty = new Set<string>();
  const pending = new Set<string>();
  const passed = new Map<string, 'completed' | 'accomplished'>();
  for (const task of tasks) {
    const status = statusOf(task.id);
    for (const cid of task.controls ?? []) {
      if (status === 'failed') failed.add(cid);
      else if (status === 'completed' || status === 'accomplished') {
        // synthetic-customer W3: a manual gate no operator acted on is never SAT.
        if (prohibitionNotShown(task.id)) notShown.add(cid);
        else if (pendingGate(task.id)) pending.add(cid);
        else if (evidenceNotShown(task.id)) evidenceEmpty.add(cid);
        else if (!passed.has(cid)) passed.set(cid, status);
      }
    }
  }
  for (const cid of notShown) {
    if (failed.has(cid)) continue;
    collector.recordControlResult(cid, controlDirectives[cid] || 'automated', metVerdict(false), 'document-prohibition');
  }
  for (const cid of pending) {
    if (failed.has(cid) || notShown.has(cid)) continue;
    collector.recordControlResult(cid, controlDirectives[cid] || 'automated', ResultVerdict.PROVISIONAL, 'manual_gate_pending');
  }
  for (const cid of evidenceEmpty) {
    if (failed.has(cid) || notShown.has(cid) || pending.has(cid)) continue;
    collector.recordControlResult(cid, controlDirectives[cid] || 'automated', ResultVerdict.NOT_SAT, EVIDENCE_NOT_SHOWN_OUTCOME);
  }
  for (const [cid, outcome] of passed) {
    if (failed.has(cid) || pending.has(cid) || evidenceEmpty.has(cid)) continue;
    collector.recordControlResult(cid, controlDirectives[cid] || 'automated', ResultVerdict.SAT, outcome);
  }
  for (const cid of failed) {
    collector.recordControlResult(cid, controlDirectives[cid] || 'automated', ResultVerdict.NOT_SAT, 'failed');
  }
}

/**
 * Tenant slug for a CLI run: --tenant > plan.ces.tenantSlug >
 * variables.tenant_slug > TENANT_SLUG env > 'dev' (the server's fallback).
 */
export function resolveResultsTenantSlug(
  plan: ManifestPlanRef & { ces?: { tenantSlug?: string } },
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates = [explicit, plan.ces?.tenantSlug, plan.variables?.tenant_slug, env.TENANT_SLUG];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '' && c !== 'unknown') return c.trim();
  }
  return 'dev';
}

// ---- (b) canonical write ----

export function executionResultsManifestPath(tenantSlug: string, executablePlanId: string): string {
  return path.join(tenantStateDir(tenantSlug), `execution-results-${executablePlanId}.json`);
}

/** Write the manifest to the canonical state dir; returns its path. */
export function writeExecutionResultsManifest(
  manifest: ExecutionResultsManifest,
  tenantSlug: string,
  executablePlanId: string,
): string {
  const manifestPath = executionResultsManifestPath(tenantSlug, executablePlanId);
  writeJsonArtifact(manifestPath, manifest);
  return manifestPath;
}

// ---- build + write (both paths) ----

export interface PublishResult {
  manifest: ExecutionResultsManifest;
  manifestPath: string;
}

/**
 * Build the manifest with the production builder and write it to the canonical
 * location. Throws only if the manifest itself cannot be built/written.
 */
export async function publishExecutionResults(
  collector: ExecutionResultsCollector,
  plan: ManifestPlanRef,
  tenantSlug: string,
  opts: { runId?: string; postchecks?: CheckResult[] } = {},
): Promise<PublishResult> {
  const manifest = collector.buildManifestForPlan(opts.runId ?? plan.plan_id, tenantSlug, plan);
  attachObjectiveVerdicts(manifest, opts.postchecks ?? runPostcheckResults(plan.plan_id));
  const manifestPath = writeExecutionResultsManifest(manifest, tenantSlug, plan.plan_id);
  return { manifest, manifestPath };
}

/**
 * DEPTH-8: add `objectives[]` to every manifest row whose control has objective-keyed postchecks in this
 * run. Rows without any keep their shape; no row is added and no row verdict changes.
 */
export function attachObjectiveVerdicts(manifest: ExecutionResultsManifest, postchecks: CheckResult[]): number {
  const byControl = objectiveVerdictsByControl(postchecks);
  let attached = 0;
  for (const row of manifest.results as ManifestRowWithObjectives[]) {
    const objectives = byControl.get(row.controlId);
    if (!objectives || objectives.length === 0) continue;
    row.objectives = objectives;
    attached += objectives.length;
  }
  return attached;
}
