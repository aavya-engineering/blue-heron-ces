// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-12: read Stamper's execution-results manifest for a tenant (the ces-shared
 * `ExecutionResultsManifestSchema` contract, written by Stamper to
 * `<CES_PIPELINE_ROOT>/Stamper/plan-data/<slug>/state/execution-results-<planId>.json`)
 * and turn each per-control result into an assessment source.
 *
 * A failed or blocked Stamper task yields a `stamper_execution` source with result
 * `missing` (failed) or `error` (blocked); `ControlAssessor.determineStatus` then
 * reports the control `not_met` whatever seeded-state signal says, so it reaches
 * the SSP entry and the POA&M. A completed task is recorded verdict-neutral
 * (`no_query`): Stamper's own success never upgrades EO's verdict.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssessmentSource } from 'ces-shared/types/controls';
import {
  ExecutionResultsManifestSchema,
  type ExecutionResultsManifest,
  type ControlExecutionResult,
} from 'ces-shared/types/execution-results';
import { getStamperTenantSubdir } from 'ces-shared/storage/node';

const MANIFEST_RE = /^execution-results-.*\.json$/;
const DELIVERY_RE = /\.delivery\.json$/;

export interface LoadedExecutionResults {
  manifest: ExecutionResultsManifest;
  file: string;
  /** Manifest files in the state folder that failed the contract (skipped). */
  invalidFiles: string[];
}

/**
 * Latest valid manifest for the tenant (by `completedAt`), or null when there is none.
 * `.delivery.json` sidecars and manifests for another tenant are ignored.
 */
export function loadLatestExecutionResults(
  tenantSlug: string,
  stateDir: string = getStamperTenantSubdir(tenantSlug, 'state'),
): LoadedExecutionResults | null {
  if (!fs.existsSync(stateDir)) return null;
  const files = fs.readdirSync(stateDir).filter(f => MANIFEST_RE.test(f) && !DELIVERY_RE.test(f)).sort();
  const invalidFiles: string[] = [];
  let latest: { manifest: ExecutionResultsManifest; file: string } | null = null;
  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf-8'));
    } catch {
      invalidFiles.push(f);
      continue;
    }
    const parsed = ExecutionResultsManifestSchema.safeParse(raw);
    if (!parsed.success) {
      invalidFiles.push(f);
      continue;
    }
    if (parsed.data.tenantSlug !== tenantSlug) continue;
    if (!latest || parsed.data.completedAt > latest.manifest.completedAt) {
      latest = { manifest: parsed.data, file: f };
    }
  }
  return latest ? { ...latest, invalidFiles } : null;
}

export type StamperTaskState = 'completed' | 'failed' | 'blocked' | 'other';

export function stamperTaskState(r: ControlExecutionResult): StamperTaskState {
  if (/block/i.test(r.outcome)) return 'blocked';
  if (r.verdict === 'not_sat' || r.outcome === 'failed') return 'failed';
  if (r.verdict === 'sat') return 'completed';
  return 'other';
}

/** True for a source that records a failed or blocked Stamper task. */
export function isStamperExecutionFailure(s: AssessmentSource): boolean {
  return s.type === 'stamper_execution' && (s.result === 'missing' || s.result === 'error');
}

/** Per-control `stamper_execution` sources from one manifest. */
export function executionResultsToSources(manifest: ExecutionResultsManifest): Map<string, AssessmentSource[]> {
  const map = new Map<string, AssessmentSource[]>();
  for (const r of manifest.results) {
    const state = stamperTaskState(r);
    const result: AssessmentSource['result'] =
      state === 'failed' ? 'missing' : state === 'blocked' ? 'error' : 'no_query';
    const word = state === 'other' ? r.verdict : state;
    const source: AssessmentSource = {
      type: 'stamper_execution',
      timestamp: r.timestampUtc,
      detail: `Stamper task ${word} (directive ${r.directive}, outcome ${r.outcome}, run ${manifest.runId})`,
      result,
    };
    const existing = map.get(r.controlId);
    if (existing) existing.push(source);
    else map.set(r.controlId, [source]);
  }
  return map;
}
