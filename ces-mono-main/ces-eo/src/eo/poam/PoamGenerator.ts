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
  }): PlanOfActionMilestones {
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
      scoreThresholdMet: true,
      weightRuleMet,
      prohibitedControlsMet,
    };

    // Generate POA&M items for eligible NOT MET 1-point controls
    const items: PoamItem[] = [];
    let totalWeightOnPoam = 0;

    for (const assessed of notMetControls) {
      const ctrl = controlMap.get(assessed.control_id);
      if (!ctrl) continue;

      const w = weightMap.get(ctrl.nist_ref);
      if (!w || !w.poam_allowed) continue;

      // Skip if it's a blocker
      if (blockers.some(b => b.control_id === assessed.control_id)) continue;

      const mpStep = mpSteps.get(assessed.control_id);

      // Determine if automation is available for remediation
      const automationAvailable = this.hasAutomationPath(ctrl.control_id);
      const remediationGuidance = this.getRemediationGuidance(assessed, ctrl.control_id);

      items.push({
        itemId: uuidv4(),
        control_id: assessed.control_id,
        nist_ref: ctrl.nist_ref,
        practice: ctrl.practice,
        weight: w.weight,
        deficiencyDescription: assessed.status === 'not_assessed'
          ? 'Control not yet assessed'
          : 'Control implementation not detected',
        plannedCorrectiveAction: remediationGuidance || mpStep?.what_to_do || 'Corrective action not yet defined',
        responsibleParty: mpStep?.owner_role ?? 'TBD',
        estimatedCompletionDate: mpStep?.target_date ?? '',
        resourcesRequired: automationAvailable ? 'Stamper automation available' : '',
        status: 'open',
        milestones: [],
        automationAvailable,
      });

      totalWeightOnPoam += w.weight;
    }

    const summary: PoamSummary = {
      totalItems: items.length,
      openItems: items.filter(i => i.status === 'open').length,
      totalWeightOnPoam,
      projectedScoreAfterPoam: sprsResult.score + totalWeightOnPoam,
    };

    return {
      poamId: uuidv4(),
      generatedAt: new Date().toISOString(),
      tenantId: assessment.tenantId,
      ces: resolveCesIdentity(loadCesConfig(), { tenantSlug: assessment.ces?.tenantSlug, tenantId: assessment.tenantId }),
      sprsScore: sprsResult.score,
      eligibility,
      items,
      summary,
    };
  }

  private static readonly FALLBACK_AUTOMATION_SET = new Set([
    'AC.L2-3.1.1', 'AC.L2-3.1.2', 'AC.L2-3.1.5', 'AC.L2-3.1.10', 'AC.L2-3.1.20',
    'IA.L2-3.5.1', 'IA.L2-3.5.2', 'IA.L2-3.5.7', 'IA.L2-3.5.11',
    'SC.L2-3.13.8', 'SC.L2-3.13.11', 'SC.L2-3.13.16',
    'SI.L2-3.14.1', 'SI.L2-3.14.5', 'SI.L2-3.14.6', 'SI.L2-3.14.7',
    'AU.L2-3.3.1', 'AU.L2-3.3.2',
  ]);

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

    // Fallback to hardcoded set for backward compatibility
    return PoamGenerator.FALLBACK_AUTOMATION_SET.has(controlId);
  }

  private getRemediationGuidance(
    assessed: { status: string; automationSource?: string },
    controlId: string
  ): string | null {
    if (assessed.automationSource !== 'graph') return null;

    // Provide signal-specific guidance
    if (controlId.startsWith('AC.')) {
      return 'Deploy Conditional Access policy via Stamper set_command to enforce access restrictions.';
    }
    if (controlId.startsWith('IA.')) {
      return 'Configure authentication methods policy via Stamper to enforce MFA requirements.';
    }
    if (controlId.startsWith('SC.')) {
      return 'Deploy Intune device compliance policy via Stamper to enforce encryption requirements.';
    }
    if (controlId.startsWith('SI.')) {
      return 'Configure security monitoring via Stamper to enable system integrity checks.';
    }
    return null;
  }

  private buildMpLookup(mp: Record<string, unknown> | undefined): Map<string, { what_to_do: string; owner_role?: string; target_date?: string }> {
    const map = new Map<string, { what_to_do: string; owner_role?: string; target_date?: string }>();
    if (!mp) return map;

    const plan = mp.plan as Record<string, unknown> | undefined;
    const steps = (mp.steps ?? plan?.steps ?? []) as Array<Record<string, unknown>>;
    for (const step of steps) {
      const coverage = (step.control_coverage ?? []) as Array<{ control_id: string }>;
      for (const cc of coverage) {
        if (!map.has(cc.control_id)) {
          map.set(cc.control_id, {
            what_to_do: (step.what_to_do as string) ?? '',
            owner_role: step.owner_role as string | undefined,
            target_date: step.target_date as string | undefined,
          });
        }
      }
    }
    return map;
  }
}
