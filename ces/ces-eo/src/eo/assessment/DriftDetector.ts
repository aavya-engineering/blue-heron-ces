// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EO-collection W3 (P1 #6, #7): drift and regression detection between two assessment snapshots.
//
// Compares the current snapshot with the previous stored non-forced one for the same tenant, per control
// (status, the deciding tier and the deciding source parsed from ControlAssessor's statusRationale)
// and per 800-171A objective (status and source from the determination ledger built on each
// snapshot). Each difference is classified by its status move:
//   regression  = was met (satisfied), now anything worse  -> the alert list `regressions[]`
//   improvement = moved to a better status
//   decline     = moved to a worse status from a status that was not met (no alert)
//   no_change   = same status, but the deciding tier or source changed
// Status rank: met 3 > partial 2 > not_assessed 1 > not_met 0.
// The record is written beside the snapshot, at <storageRoot>/assessments/<snapshotId>/drift.json.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DeterminationLedger } from './DeterminationLedger.js';

export type DriftChange = 'regression' | 'improvement' | 'decline' | 'no_change';

export interface ControlSide {
  status: string;
  /** The precedence tier that decided (1-5), null when no source had an opinion. */
  tier: number | null;
  /** The deciding source as `<type>/<result>` (e.g. `discovery/exists`), null when none. */
  source: string | null;
}

export interface ControlDrift {
  controlId: string;
  change: DriftChange;
  previous: ControlSide;
  current: ControlSide;
}

export interface ObjectiveSide {
  status: string;
  source: string;
  tier: number | null;
  freshness?: string;
}

export interface ObjectiveDrift {
  objectiveId: string;
  controlId: string;
  change: DriftChange;
  previous: ObjectiveSide;
  current: ObjectiveSide;
}

export interface DriftRecord {
  schema: 'ces-eo/drift@1';
  tenantId: string;
  snapshotId: string;
  generatedAt: string;
  previousSnapshotId: string | null;
  previousGeneratedAt: string | null;
  /** True when there was no previous snapshot to compare with. */
  baseline: boolean;
  summary: {
    controlsCompared: number;
    regressions: number;
    improvements: number;
    declines: number;
    tierOrSourceOnly: number;
    objectivesCompared: number;
    objectiveRegressions: number;
    objectiveImprovements: number;
    objectiveDeclines: number;
    objectiveSourceOnly: number;
  };
  /** Controls that were met and are now worse (the regression alert list). */
  regressions: ControlDrift[];
  /** Every control whose status, deciding tier or deciding source changed. */
  controls: ControlDrift[];
  /** Every objective whose status or source changed (only when both ledgers were given). */
  objectives: ObjectiveDrift[];
}

const CONTROL_RANK: Record<string, number> = { met: 3, partial: 2, not_assessed: 1, not_met: 0 };
const OBJECTIVE_RANK: Record<string, number> = { satisfied: 3, not_assessed: 1, other_than_satisfied: 0 };
const NO_SIDE: ControlSide = { status: 'not_assessed', tier: null, source: null };

/** The deciding tier and source in a ControlAssessor statusRationale ("Tier 2 (live read) decides: discovery/exists: …"). */
export function deciderOf(statusRationale: string | undefined): { tier: number | null; source: string | null } {
  const r = statusRationale ?? '';
  const t = /^Tier (\d)\b/.exec(r);
  if (!t) return { tier: null, source: null };
  const i = r.indexOf('decides');
  const m = i >= 0 ? /(?:^|[:;] )([a-z_]+)\/([a-z_]+)(?=: |; |$)/.exec(r.slice(i)) : null;
  return { tier: Number(t[1]), source: m ? `${m[1]}/${m[2]}` : null };
}

function classify(prev: string, cur: string, rank: Record<string, number>, positive: string): DriftChange {
  if (prev === cur) return 'no_change';
  const p = rank[prev] ?? 1;
  const c = rank[cur] ?? 1;
  if (prev === positive && c < p) return 'regression';
  if (c > p) return 'improvement';
  return c < p ? 'decline' : 'no_change';
}

function controlSides(snapshot: AssessmentSnapshot): Map<string, ControlSide> {
  const out = new Map<string, ControlSide>();
  for (const c of snapshot.controls) {
    const d = deciderOf((c as { statusRationale?: string }).statusRationale);
    out.set(c.control_id, { status: c.status, tier: d.tier, source: d.source });
  }
  return out;
}

function objectiveSides(ledger: DeterminationLedger, controls: Map<string, ControlSide>): Map<string, ObjectiveSide & { controlId: string }> {
  const out = new Map<string, ObjectiveSide & { controlId: string }>();
  for (const o of ledger.objectives) {
    out.set(o.objectiveId, {
      controlId: o.controlId,
      status: o.status,
      source: o.source,
      tier: o.source === 'digital-signal' ? controls.get(o.controlId)?.tier ?? null : null,
      ...(o.freshness ? { freshness: o.freshness } : {}),
    });
  }
  return out;
}

const byId = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

/**
 * Compare `current` with `previous` (the tenant's previous stored snapshot, or null for the first
 * one). Objectives are compared only when both ledgers are given. Pure.
 */
export function detectDrift(input: {
  previous: AssessmentSnapshot | null;
  current: AssessmentSnapshot;
  previousLedger?: DeterminationLedger | null;
  currentLedger?: DeterminationLedger | null;
}): DriftRecord {
  const { previous, current } = input;
  const cur = controlSides(current);
  const controls: ControlDrift[] = [];
  const objectives: ObjectiveDrift[] = [];
  let objectivesCompared = 0;

  if (previous) {
    const prev = controlSides(previous);
    for (const [controlId, c] of cur) {
      const p = prev.get(controlId) ?? NO_SIDE;
      if (p.status === c.status && p.tier === c.tier && p.source === c.source) continue;
      controls.push({ controlId, change: classify(p.status, c.status, CONTROL_RANK, 'met'), previous: p, current: c });
    }
    if (input.previousLedger && input.currentLedger) {
      const po = objectiveSides(input.previousLedger, prev);
      const co = objectiveSides(input.currentLedger, cur);
      objectivesCompared = co.size;
      for (const [objectiveId, c] of co) {
        const p = po.get(objectiveId);
        if (!p) continue;
        if (p.status === c.status && p.source === c.source) continue;
        const { controlId: _pc, ...pSide } = p;
        const { controlId, ...cSide } = c;
        objectives.push({ objectiveId, controlId, change: classify(p.status, c.status, OBJECTIVE_RANK, 'satisfied'), previous: pSide, current: cSide });
      }
    }
  }
  controls.sort((a, b) => byId(a.controlId, b.controlId));
  objectives.sort((a, b) => byId(a.objectiveId, b.objectiveId));
  const count = <T extends { change: DriftChange }>(list: T[], k: DriftChange): number => list.filter(x => x.change === k).length;
  const regressions = controls.filter(c => c.change === 'regression');

  return {
    schema: 'ces-eo/drift@1',
    tenantId: current.tenantId,
    snapshotId: current.snapshotId,
    generatedAt: current.generatedAt,
    previousSnapshotId: previous?.snapshotId ?? null,
    previousGeneratedAt: previous?.generatedAt ?? null,
    baseline: previous === null,
    summary: {
      controlsCompared: previous ? cur.size : 0,
      regressions: regressions.length,
      improvements: count(controls, 'improvement'),
      declines: count(controls, 'decline'),
      tierOrSourceOnly: count(controls, 'no_change'),
      objectivesCompared,
      objectiveRegressions: count(objectives, 'regression'),
      objectiveImprovements: count(objectives, 'improvement'),
      objectiveDeclines: count(objectives, 'decline'),
      objectiveSourceOnly: count(objectives, 'no_change'),
    },
    regressions,
    controls,
    objectives,
  };
}

/**
 * The drift baseline: the newest stored snapshot of the tenant that is not a forced-failure one
 * (`metadata.forced`, the harness's E8F). Null when there is none (first assessment: a baseline record).
 */
export function pickBaseline(snapshots: Array<AssessmentSnapshot & { metadata?: { forced?: boolean } }>): AssessmentSnapshot | null {
  const sorted = [...snapshots].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return sorted.find(s => s.metadata?.forced !== true) ?? null;
}

/** True when nothing changed (no control and no objective entry). */
export function isEmptyDrift(record: DriftRecord): boolean {
  return record.controls.length === 0 && record.objectives.length === 0;
}

const SNAPSHOT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** <storageRoot>/assessments/<snapshotId>/drift.json; null for an id that is not a plain folder name. */
export function driftPath(storageRoot: string, snapshotId: string): string | null {
  if (!SNAPSHOT_ID_RE.test(snapshotId)) return null;
  return path.join(storageRoot, 'assessments', snapshotId, 'drift.json');
}

export function writeDrift(storageRoot: string, record: DriftRecord): string {
  const p = driftPath(storageRoot, record.snapshotId);
  if (!p) throw new Error(`drift: invalid snapshot id '${record.snapshotId}'`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, p);
  return p;
}

/** The stored record for a snapshot of this tenant, or null (absent, unreadable or another tenant's). */
export function readDrift(storageRoot: string, snapshotId: string, tenantId: string): DriftRecord | null {
  const p = driftPath(storageRoot, snapshotId);
  if (!p || !fs.existsSync(p)) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(p, 'utf-8')) as DriftRecord;
    return rec && rec.tenantId === tenantId && rec.snapshotId === snapshotId ? rec : null;
  } catch {
    return null;
  }
}

/** The SSE / eo-assess.json view: ids, counts and the regression list (no objective rows). */
export function summarizeDrift(record: DriftRecord): {
  previousSnapshotId: string | null;
  baseline: boolean;
  empty: boolean;
  summary: DriftRecord['summary'];
  regressions: ControlDrift[];
} {
  return {
    previousSnapshotId: record.previousSnapshotId,
    baseline: record.baseline,
    empty: isEmptyDrift(record),
    summary: record.summary,
    regressions: record.regressions,
  };
}
