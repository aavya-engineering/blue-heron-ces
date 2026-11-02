// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import type { AssessmentSnapshot, CmmcControl } from 'ces-shared/types/controls';
import type {
  PlanOfActionMilestones,
  PoamEligibility,
  PoamBlocker,
  PoamItem,
  PoamSummary,
} from 'ces-shared/types/poam';
import type { SprsWeightsFile } from 'ces-shared/types/sprs';
import { resolveCesIdentity } from 'ces-shared/config/ces';
import { loadCesConfig } from 'ces-shared/config/ces/node';
import type { CommandRegistryFile } from 'ces-shared/types/registry';

import { SprsCalculator } from '../sprs/SprsCalculator.js';
import { NON_STACK_NOT_DECIDED_FINDING } from '../assessment/ControlAssessor.js';

/** R-POAM (CONTRACT CHANGE): the eligibility note on a tracked entry that cannot be a CMMC POA&M item. */
export const NOT_POAM_ELIGIBLE_NOTE = 'not CMMC POA&M-eligible (32 CFR 170.21): close before assessment';

/**
 * R-POAM (CONTRACT CHANGE): every not_met / not_assessed control is a tracked entry in `items[]`.
 * `poamEligible` false = an eligibility blocker or a control the SPRS weights do not allow on a POA&M;
 * it carries `eligibilityNote` and adds nothing to `totalWeightOnPoam`.
 */
export type TrackedPoamItem = PoamItem & { poamEligible: boolean; eligibilityNote?: string };

/** R-POAM (CONTRACT CHANGE): `totalItems` = all tracked entries; the eligible / not-eligible split. */
export type TrackedPoamSummary = PoamSummary & { eligibleItems: number; notEligibleItems: number };

/** GC-PKG-1 (CONTRACT CHANGE): a POA&M records the assessment snapshot it was generated from. */
export type SnapshotStampedPoam = Omit<PlanOfActionMilestones, 'items' | 'summary'> & {
  snapshotId: string;
  items: TrackedPoamItem[];
  summary: TrackedPoamSummary;
};

/** W2.4: the CMMC conditional-certification SPRS floor (same boundary as EligibilityChecker). */
export const CONDITIONAL_SPRS_THRESHOLD = 88;

/** W5 cycle 2: the plannedCorrectiveAction when neither the finding nor the MP step gives one. */
export const NO_CORRECTIVE_ACTION = 'Corrective action to be defined by the organisation';

/** W5 cycle 2: what the assessment found for a not-met control (ControlAssessor fields, read off the snapshot). */
export interface PoamFinding {
  /** The deciding evaluator's evidence sentence (or the deciding record text), verbatim. */
  text?: string;
  /** The verdict rationale (fallback when no finding was recorded). */
  statusRationale?: string;
  /** The Stamper NOT_SAT entries behind a Tier 1 finding. */
  stamperEntries: Array<{ entryId: string; label: string; outcomeRationale: string }>;
}

export function findingFor(assessed: unknown): PoamFinding {
  const a = assessed as { assessmentFinding?: string; statusRationale?: string; findingStamperEntries?: PoamFinding['stamperEntries'] };
  return { text: a.assessmentFinding, statusRationale: a.statusRationale, stamperEntries: a.findingStamperEntries ?? [] };
}

/**
 * W5 cycle 2: the deficiency is the finding. A Tier 1 Stamper NOT_SAT gives each entry id with its
 * outcomeRationale; otherwise the evidence sentence; else the verdict rationale.
 */
export function deficiencyDescriptionOf(f: PoamFinding): string {
  if (f.stamperEntries.length > 0) {
    return f.stamperEntries.map(e => `Stamper entry ${e.entryId} (${e.label}) NOT_SAT${e.outcomeRationale ? `: ${e.outcomeRationale}` : ''}`).join('; ');
  }
  return f.text || f.statusRationale || 'Control implementation not recorded by the assessment';
}

/** A clause of the finding that compares the configured value with an organisation value. */
const ORG_VALUE_CLAUSE = /\(organisation value: |\bfailing:? \$\.\S+ (?:equals|contains|gte|lte|exists|count-gte) /;

/**
 * W5 cycle 2: the corrective action derived from the finding, or null when the finding names no
 * specific action. A failed Stamper entry is named; a finding that compares the configured value
 * with the organisation's value says to configure the organisation's value (the clause is quoted).
 */
export function correctiveActionFromFinding(f: PoamFinding): string | null {
  if (f.stamperEntries.length > 0) {
    return f.stamperEntries.map(e =>
      `Resolve the failure of Stamper entry ${e.entryId} (${e.label})${e.outcomeRationale ? `, last outcome: ${e.outcomeRationale}` : ''}; re-run the entry and re-assess the control.`,
    ).join(' ');
  }
  if (!f.text) return null;
  const clauses = f.text.split('; ').filter(c => ORG_VALUE_CLAUSE.test(c));
  if (clauses.length > 0) {
    return `Configure the organisation's value: the finding compares the configured value with the organisation's value (${clauses.map(c => `"${c}"`).join('; ')}); set the configuration named in the finding to that value, then re-assess the control.`;
  }
  return null;
}

interface ControlsReference {
  total_controls: number;
  controls: CmmcControl[];
}

/**
 * Generates Plan of Action & Milestones for NOT MET controls.
 */
export class PoamGenerator {
  private readonly controls: CmmcControl[];
  private readonly sprsWeights: SprsWeightsFile;
  private readonly registries?: CommandRegistryFile[];

  constructor(controlsRefPath: string, sprsWeightsPath: string, registries?: CommandRegistryFile[]) {
    const ref: ControlsReference = JSON.parse(fs.readFileSync(controlsRefPath, 'utf-8'));
    this.controls = ref.controls;
    this.sprsWeights = JSON.parse(fs.readFileSync(sprsWeightsPath, 'utf-8'));
    this.registries = registries;
  }

  generate(params: {
    assessment: AssessmentSnapshot;
    missionPlan?: Record<string, unknown>;
  }): SnapshotStampedPoam {
    const { assessment, missionPlan } = params;

    // Calculate SPRS
    const sprsCalc = new SprsCalculator();
    const sprsResult = sprsCalc.calculate(assessment.controls);

    // Build weight lookup
    const weightMap = new Map<string, { weight: number; poam_allowed: boolean }>();
    for (const w of this.sprsWeights.controls) {
      weightMap.set(w.nist_ref, { weight: w.weight, poam_allowed: w.poam_allowed });
    }

    // Build control lookup
    const controlMap = new Map(this.controls.map(c => [c.control_id, c]));

    // Build MP step lookup
    const mpSteps = this.buildMpLookup(missionPlan);

    // Determine eligibility
    const prohibitedSet = new Set(this.sprsWeights.poam_prohibited);
    const blockers: PoamBlocker[] = [];
    let weightRuleMet = true;
    let prohibitedControlsMet = true;

    // Check NOT MET controls
    const notMetControls = assessment.controls.filter(
      c => c.status === 'not_met' || c.status === 'not_assessed'
    );

    for (const assessed of notMetControls) {
      const ctrl = controlMap.get(assessed.control_id);
      if (!ctrl) continue;

      const w = weightMap.get(ctrl.nist_ref);
      if (!w) continue;

      if (prohibitedSet.has(ctrl.nist_ref)) {
        prohibitedControlsMet = false;
        blockers.push({
          control_id: assessed.control_id,
          nist_ref: ctrl.nist_ref,
          weight: w.weight,
          reason: 'POA&M prohibited control',
        });
      } else if (w.weight >= 5) {
        weightRuleMet = false;
        blockers.push({
          control_id: assessed.control_id,
          nist_ref: ctrl.nist_ref,
          weight: w.weight,
          reason: '5-point control must be MET',
        });
      } else if (w.weight === 3) {
        // Check partial credit exception for 3.13.11
        const pc = this.sprsWeights.partial_credit.find(p => p.nist_ref === ctrl.nist_ref);
        if (pc?.poam_allowed_at_partial && assessed.status === 'partial') {
          // Allowed — will be a POA&M item
        } else {
          weightRuleMet = false;
          blockers.push({
            control_id: assessed.control_id,
            nist_ref: ctrl.nist_ref,
            weight: w.weight,
            reason: '3-point control must be MET',
          });
        }
      }
    }

    const eligible = weightRuleMet && prohibitedControlsMet;
    const certPath = sprsResult.controlsMet === 110 ? 'full' as const :
                     eligible ? 'conditional' as const : 'blocked' as const;

    const eligibility: PoamEligibility = {
      eligible,
      certificationPath: certPath,
      blockers,
      // W2.4: computed from the assessed SPRS (was hard-coded true).
      scoreThresholdMet: sprsResult.score >= CONDITIONAL_SPRS_THRESHOLD,
      weightRuleMet,
      prohibitedControlsMet,
    };

    // R-POAM: a tracked entry for every NOT MET / not assessed control; only POA&M-eligible ones carry weight
    const items: TrackedPoamItem[] = [];
    let totalWeightOnPoam = 0;

    for (const assessed of notMetControls) {
      const ctrl = controlMap.get(assessed.control_id);
      if (!ctrl) continue;

      const w = weightMap.get(ctrl.nist_ref);
      if (!w) continue;

      const poamEligible = w.poam_allowed && !blockers.some(b => b.control_id === assessed.control_id);

      const mpStep = mpSteps.get(assessed.control_id);

      // W5 cycle 2: automation only when a Stamper registry entry with a set command covers the control.
      const automationAvailable = this.hasAutomationPath(ctrl.control_id);
      // W5 cycle 2: description and action from the finding, never from a family boilerplate.
      const finding = findingFor(assessed);

      items.push({
        itemId: uuidv4(),
        control_id: assessed.control_id,
        nist_ref: ctrl.nist_ref,
        practice: ctrl.practice,
        weight: w.weight,
        // PH7-EO (V59): a non-stack control's NON_STACK_NOT_DECIDED_FINDING names the records shown and the deciding route.
        deficiencyDescription: assessed.status === 'not_assessed'
          ? (finding.text?.startsWith(NON_STACK_NOT_DECIDED_FINDING) ? `Control not yet assessed. ${finding.text}` : 'Control not yet assessed')
          : deficiencyDescriptionOf(finding),
        plannedCorrectiveAction: (assessed.status === 'not_met' ? correctiveActionFromFinding(finding) : null) ?? (mpStep?.what_to_do || NO_CORRECTIVE_ACTION),
        responsibleParty: mpStep?.owner_role ?? 'TBD',
        estimatedCompletionDate: mpStep?.target_date ?? '',
        resourcesRequired: automationAvailable ? 'Stamper automation available' : '',
        status: 'open',
        milestones: [],
        automationAvailable,
        poamEligible,
        ...(poamEligible ? {} : { eligibilityNote: NOT_POAM_ELIGIBLE_NOTE }),
      });

      if (poamEligible) totalWeightOnPoam += w.weight;
    }

    const eligibleItems = items.filter(i => i.poamEligible).length;
    const summary: TrackedPoamSummary = {
      totalItems: items.length,
      openItems: items.filter(i => i.status === 'open').length,
      totalWeightOnPoam,
      projectedScoreAfterPoam: sprsResult.score + totalWeightOnPoam,
      eligibleItems,
      notEligibleItems: items.length - eligibleItems,
    };

    return {
      poamId: uuidv4(),
      generatedAt: new Date().toISOString(),
      tenantId: assessment.tenantId,
      // GC-PKG-1: the snapshot this POA&M was generated from; the package build requires it to match.
      snapshotId: assessment.snapshotId,
      ces: resolveCesIdentity(loadCesConfig(), { tenantSlug: assessment.ces?.tenantSlug, tenantId: assessment.tenantId }),
      sprsScore: sprsResult.score,
      eligibility,
      items,
      summary,
    };
  }

  private hasAutomationPath(controlId: string): boolean {
    // Dynamic detection from Stamper registries
    if (this.registries) {
      for (const registry of this.registries) {
        for (const entry of registry.entries) {
          if (entry.set_command.trim() !== '' && entry.control_ids.includes(controlId)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * W2.4: MP step per control. Reads the pushed MP at `outputs.human_readable_mission_plan`
   * (older shapes: `steps`, `plan.steps`). Role = the step's `owner_role`; date = the
   * `target_date` of the milestone whose `phase_tasks` lists the step (`task_…` ids, step ids
   * `step_task_…`), else the step's own `target_date`. An array `what_to_do` is joined by newlines.
   */
  private buildMpLookup(mp: Record<string, unknown> | undefined): Map<string, { what_to_do: string; owner_role?: string; target_date?: string }> {
    const map = new Map<string, { what_to_do: string; owner_role?: string; target_date?: string }>();
    if (!mp) return map;

    const outputs = mp.outputs as Record<string, unknown> | undefined;
    const hr = outputs?.human_readable_mission_plan as Record<string, unknown> | undefined;
    const plan = mp.plan as Record<string, unknown> | undefined;
    const steps = (hr?.steps ?? mp.steps ?? plan?.steps ?? []) as Array<Record<string, unknown>>;
    const milestones = (hr?.milestones ?? mp.milestones ?? plan?.milestones ?? []) as Array<Record<string, unknown>>;

    const dateByTask = new Map<string, string>();
    for (const ms of milestones) {
      const date = ms.target_date as string | undefined;
      if (!date) continue;
      for (const t of (ms.phase_tasks ?? []) as string[]) {
        if (!dateByTask.has(t)) dateByTask.set(t, date);
      }
    }
    const milestoneDate = (stepId: unknown): string | undefined => {
      if (typeof stepId !== 'string') return undefined;
      return dateByTask.get(stepId) ?? dateByTask.get(stepId.replace(/^step_/, ''));
    };

    for (const step of steps) {
      const coverage = (step.control_coverage ?? []) as Array<{ control_id: string }>;
      const whatToDo = Array.isArray(step.what_to_do) ? (step.what_to_do as string[]).join('\n') : ((step.what_to_do as string) ?? '');
      for (const cc of coverage) {
        if (!map.has(cc.control_id)) {
          map.set(cc.control_id, {
            what_to_do: whatToDo,
            owner_role: step.owner_role as string | undefined,
            target_date: milestoneDate(step.id) ?? (step.target_date as string | undefined),
          });
        }
      }
    }
    return map;
  }
}
