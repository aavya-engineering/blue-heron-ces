// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W4.1: the SSP's posture reconciliation block (§1.1). Every posture count the bundle carries is listed
 * side by side with the rule that produced it. Nothing is re-scored:
 *  - EO (EvidenceOps) assessed: the snapshot's control statuses and SPRS. The only SPRS labelled "assessed".
 *  - Determination ledger: the per-objective rollup of the same snapshot plus the other objective sources.
 *  - Muster readiness posture: Planner's counts as pushed in the Mission Plan (MP) `inputs.readiness_posture`,
 *    printed unchanged under founder decision B1 (a) (open).
 *  - MP per-requirement readiness: the MP's 110 `controls[].readiness_status`; its SPRS is the planning posture.
 *  - POA&M projection: §14's projected SPRS if every POA&M item closes. Never "assessed".
 */
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DeterminationLedger } from '../assessment/DeterminationLedger.js';
import type { EoPoamSummary } from '../../shared/types/ssp.types.js';
import type { PolicyReconciliationRow } from './PolicyReconciliation.js';

export type PostureSprsLabel = 'assessed' | 'planning posture' | 'projected' | 'not scored' | 'not carried';

export interface PostureRow {
  id: 'eo-assessed' | 'ledger-rollup' | 'muster-readiness' | 'mp-readiness' | 'poam-projection';
  name: string;
  source: string;
  rule: string;
  /** Status counts as the source states them; null when the source has no such count. */
  counts: { met: number | null; partial: number | null; notMet: number | null; notAssessed: number | null };
  /** "not assessed" for EO and the ledger; "unknown" for Muster's readiness statuses. */
  remainderLabel: 'not assessed' | 'unknown';
  unit: string;
  countsText: string;
  sprs: number | null;
  sprsLabel: PostureSprsLabel;
  sprsText: string;
}

export interface PostureReconciliation {
  heading: string;
  intro: string;
  rows: PostureRow[];
  /** The one assessed SPRS (EO's), or null when the snapshot carries none. */
  assessedSprs: number | null;
  notMetDeduction: { controls: number; points: number };
  notAssessedDeduction: { controls: number; points: number };
  partialDeduction: { controls: number; points: number };
  /** Controls whose ledger rollup differs from the EO status (ledger passed only). */
  ledgerDifferences: Array<{ controlId: string; eoStatus: string; ledgerStatus: string }>;
  statements: string[];
  /** W5 cycle 3: policy vs tenant ODP rows (PolicyReconciliation.applyPolicyReconciliation); findings only. */
  policyReconciliation?: PolicyReconciliationRow[];
}

export interface PostureInput {
  assessment: AssessmentSnapshot;
  ledger?: DeterminationLedger;
  missionPlan?: Record<string, unknown>;
  poamSummary?: EoPoamSummary;
  /** SPRS weight by NIST reference (e.g. "3.1.1"). */
  weightFor: (nistRef: string) => number;
}

const MAX_SPRS = 110;
const SPRS_FLOOR = -203;

const numericRef = (id: string): string => id.replace(/^[A-Z]+\.L\d-/, '');

function tally(statuses: string[]): { met: number; partial: number; notMet: number; rest: number } {
  const t = { met: 0, partial: 0, notMet: 0, rest: 0 };
  for (const s of statuses) {
    if (s === 'met') t.met++;
    else if (s === 'partial') t.partial++;
    else if (s === 'not_met') t.notMet++;
    else t.rest++;
  }
  return t;
}

/** R-POAM: §14 POA&M items, excluding the tracked deficiencies that are eligibility blockers. */
function poamItemCount(s: EoPoamSummary): number {
  if (!Array.isArray(s.items)) return s.totalItems;
  const blockers = new Set((s.blockers ?? []).map(b => b.control_id));
  return s.items.filter(i => !blockers.has(i.control_id)).length;
}

function countsText(c: PostureRow['counts'], remainder: string, unit: string): string {
  const part = (n: number | null, label: string) => (n === null ? null : `${n} ${label}`);
  const parts = [part(c.met, 'met'), part(c.notMet, 'not met'), part(c.partial, 'partial'), part(c.notAssessed, remainder)].filter(Boolean);
  const total = [c.met, c.notMet, c.partial, c.notAssessed].reduce<number>((s, n) => s + (n ?? 0), 0);
  return `${parts.join(' / ')} (${total} ${unit})`;
}

function mpReadiness(mp: Record<string, unknown> | undefined): {
  summary?: { met?: number; partial?: number; not_met?: number; unknown?: number; level?: string };
  snapshotId?: string;
  controls: Array<{ requirement_id: string; readiness_status: string }>;
} {
  const inputs = mp?.inputs as Record<string, unknown> | undefined;
  const rp = inputs?.readiness_posture as Record<string, unknown> | undefined;
  const outputs = mp?.outputs as Record<string, unknown> | undefined;
  const hrp = outputs?.human_readable_mission_plan as Record<string, unknown> | undefined;
  const controls = Array.isArray(hrp?.controls)
    ? (hrp!.controls as Array<Record<string, unknown>>)
        .filter(c => typeof c.requirement_id === 'string' && typeof c.readiness_status === 'string')
        .map(c => ({ requirement_id: c.requirement_id as string, readiness_status: c.readiness_status as string }))
    : [];
  return {
    summary: rp?.control_status_summary as { met?: number; partial?: number; not_met?: number; unknown?: number; level?: string } | undefined,
    snapshotId: rp?.snapshot_id as string | undefined,
    controls,
  };
}

export function buildPostureReconciliation(input: PostureInput): PostureReconciliation {
  const { assessment, ledger, missionPlan, poamSummary, weightFor } = input;
  const rows: PostureRow[] = [];
  const statements: string[] = [];

  // --- EO assessed ---
  const eo = tally(assessment.controls.map(c => c.status));
  const weightOf = (status: string) => assessment.controls
    .filter(c => c.status === status)
    .reduce((s, c) => s + weightFor(c.nist_ref ?? numericRef(c.control_id)), 0);
  const notMetDeduction = { controls: eo.notMet, points: weightOf('not_met') };
  const notAssessedDeduction = { controls: assessment.controls.filter(c => c.status === 'not_assessed').length, points: weightOf('not_assessed') };
  const partialDeduction = { controls: eo.partial, points: weightOf('partial') };
  const storedSprs = (assessment as AssessmentSnapshot & { sprs_score?: number }).sprs_score;
  const assessedSprs = typeof storedSprs === 'number' ? storedSprs : null;
  const eoCounts = { met: eo.met, partial: eo.partial, notMet: eo.notMet, notAssessed: eo.rest };
  rows.push({
    id: 'eo-assessed',
    name: 'EvidenceOps assessment (status of record)',
    source: `EO assessment snapshot ${(assessment as AssessmentSnapshot & { snapshotId?: string }).snapshotId ?? ''}`.trim(),
    rule: 'One status per control from ControlAssessor\'s stated precedence: a live negative read is decisive; unread signals are "no query", not absence; policies never set status. Not-assessed controls count as not implemented in the SPRS.',
    counts: eoCounts,
    remainderLabel: 'not assessed',
    unit: 'controls',
    countsText: countsText(eoCounts, 'not assessed', 'controls'),
    sprs: assessedSprs,
    sprsLabel: 'assessed',
    sprsText: assessedSprs === null
      ? 'SPRS (assessed): not recorded on the snapshot'
      : `SPRS (assessed): ${assessedSprs} = ${MAX_SPRS} - ${notMetDeduction.points} (${notMetDeduction.controls} not met) - ${notAssessedDeduction.points} (${notAssessedDeduction.controls} not assessed)${partialDeduction.controls > 0 ? ` - ${partialDeduction.points} (${partialDeduction.controls} partial)` : ''}`,
  });

  // --- Determination ledger rollup ---
  const ledgerDifferences: PostureReconciliation['ledgerDifferences'] = [];
  if (ledger) {
    const s = ledger.summary;
    const lc = { met: s.controlsMet, partial: s.controlsPartial, notMet: s.controlsNotMet, notAssessed: s.controlsNotAssessed };
    rows.push({
      id: 'ledger-rollup',
      name: 'Determination ledger (per-objective rollup)',
      source: `EO determination ledger, ${s.objectivesTotal} objectives`,
      rule: 'Per control from its objectives: any objective other than satisfied makes it not met; all satisfied makes it met; some satisfied makes it partial; otherwise not assessed. Objective sources: Mission Plan dispositions, tenant test-suite probes, personnel readiness, and the snapshot status for digital signals.',
      counts: lc,
      remainderLabel: 'not assessed',
      unit: 'controls',
      countsText: countsText(lc, 'not assessed', 'controls'),
      sprs: null,
      sprsLabel: 'not scored',
      sprsText: 'Not scored (the ledger computes no SPRS)',
    });
    const eoStatus = new Map(assessment.controls.map(c => [c.control_id, c.status]));
    for (const rc of ledger.controls ?? []) {
      const e = eoStatus.get(rc.controlId);
      if (e !== undefined && e !== rc.status) ledgerDifferences.push({ controlId: rc.controlId, eoStatus: e, ledgerStatus: rc.status });
    }
  }

  // --- Muster readiness (Planner's rule, B1 (a)) ---
  const mr = mpReadiness(missionPlan);
  const plannerRule = 'Planner\'s all-activities rule, kept under founder decision B1 (a) (open): a requirement is met only when every contributing activity is met. A planning figure, not an assessment; printed unchanged.';
  if (mr.summary) {
    const mc = { met: mr.summary.met ?? null, partial: mr.summary.partial ?? null, notMet: mr.summary.not_met ?? null, notAssessed: mr.summary.unknown ?? null };
    rows.push({
      id: 'muster-readiness',
      name: 'Muster readiness posture',
      source: `Mission Plan inputs.readiness_posture${mr.snapshotId ? ` (${mr.snapshotId})` : ''}`,
      rule: `${plannerRule} Counted over Planner's requirement-id set, in which a practice can appear under both a Level 1 and a Level 2 id.`,
      counts: mc,
      remainderLabel: 'unknown',
      unit: 'requirement ids',
      countsText: countsText(mc, 'unknown', 'requirement ids'),
      sprs: null,
      sprsLabel: 'not carried',
      sprsText: 'Not carried (the pushed readiness posture has no SPRS; see the Mission Plan row)',
    });
  }
  if (mr.controls.length > 0) {
    const t = tally(mr.controls.map(c => c.readiness_status));
    const deducted = mr.controls
      .filter(c => c.readiness_status !== 'met')
      .reduce((s, c) => s + weightFor(numericRef(c.requirement_id)), 0);
    const planning = Math.max(SPRS_FLOOR, MAX_SPRS - deducted);
    const pc = { met: t.met, partial: t.partial, notMet: t.notMet, notAssessed: t.rest };
    rows.push({
      id: 'mp-readiness',
      name: 'Mission Plan per-requirement readiness',
      source: 'Mission Plan outputs.human_readable_mission_plan.controls[].readiness_status',
      rule: `${plannerRule} SPRS arithmetic by EO on these statuses: every requirement not met (partial and unknown included) deducts its full weight; floor ${SPRS_FLOOR}.`,
      counts: pc,
      remainderLabel: 'unknown',
      unit: 'requirements',
      countsText: countsText(pc, 'unknown', 'requirements'),
      sprs: planning,
      sprsLabel: 'planning posture',
      sprsText: `${planning} (planning posture, not an assessment: ${MAX_SPRS} - ${deducted})`,
    });
  }

  // --- POA&M projection ---
  if (poamSummary) {
    const blockers = Array.isArray(poamSummary.blockers) ? poamSummary.blockers.length : null;
    rows.push({
      id: 'poam-projection',
      name: 'POA&M projection',
      source: `POA&M ${poamSummary.poamId ?? ''} (section 14)`.trim(),
      rule: 'The SPRS if every POA&M item closes: the assessed score plus the weight on the POA&M. Blockers (3- and 5-point and POA&M-prohibited controls) cannot go on the POA&M and must be met first.',
      counts: { met: null, partial: null, notMet: null, notAssessed: null },
      remainderLabel: 'not assessed',
      unit: 'POA&M entries',
      // R-POAM: items[] also tracks the blockers; count them once, as blockers.
      countsText: `${poamItemCount(poamSummary)} POA&M items${blockers === null ? '' : ` / ${blockers} blockers`}`,
      sprs: poamSummary.projectedScoreAfterPoam,
      sprsLabel: 'projected',
      sprsText: `${poamSummary.projectedScoreAfterPoam} projected (${poamSummary.totalWeightOnPoam} POA&M points; a projection, not an assessment)`,
    });
  }

  statements.push(
    assessedSprs === null
      ? 'No assessed SPRS is recorded on the EO snapshot.'
      : `Only EvidenceOps' SPRS is an assessed value. It deducts the ${notAssessedDeduction.controls} not-assessed controls (${notAssessedDeduction.points} points) as not implemented, in addition to the ${notMetDeduction.controls} not-met controls (${notMetDeduction.points} points).`,
  );
  if (ledgerDifferences.length > 0) {
    statements.push(`The ledger rollup and the EO status differ on ${ledgerDifferences.length} control(s): ${ledgerDifferences.map(d => `${d.controlId} (EO ${d.eoStatus}, ledger ${d.ledgerStatus})`).join('; ')}. The EO status is the status of record; the objective statuses are listed in section 10.`);
  }
  if (mr.summary || mr.controls.length > 0) {
    statements.push('The Muster figures come from planning answers and discovery, not from this assessment. Muster\'s own system-security-plan and POA&M documents carry the same planning posture; they are planning documents, not the SSP of record.');
  }

  return {
    heading: '1.1 Posture Reconciliation',
    intro: 'Each posture figure the evidence bundle carries, side by side with the rule that produced it. This SSP does not re-score any of them; the EvidenceOps status is the status of record.',
    rows,
    assessedSprs,
    notMetDeduction,
    notAssessedDeduction,
    partialDeduction,
    ledgerDifferences,
    statements,
  };
}
