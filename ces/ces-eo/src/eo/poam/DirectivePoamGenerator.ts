// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Directive-aware POA&M generator.
 * Generates POA&M items for NOT_MET controls based on directive metadata,
 * checks eligibility against 32 CFR 170.21 reference data, and produces
 * a structured PlanOfActionMilestones document with blocking/eligible splits.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DirectiveType, ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import type { DirectiveControlImplementation } from '../../shared/types/ssp.types.js';

export interface DirectivePoamItem {
  control_id: string;
  control_title: string;
  reason_not_met: string;
  eligibility: { eligible: boolean; reason?: string };
  closure_date: string;
  required_artifacts: string[];
  directive: DirectiveType;
}

export interface DirectivePlanOfActionMilestones {
  generated_at: string;
  total_items: number;
  blocking_items: DirectivePoamItem[];
  eligible_items: DirectivePoamItem[];
}

interface PoamEligibilityRaw {
  ineligible_controls: {
    weight_5: string[];
    weight_3: string[];
    explicitly_named_ineligible: string[];
  };
  conditional_eligibility: Record<string, { condition: string; effect: string; reference: string }>;
  scoring_context: {
    max_poam_point_value: number;
    closeout_deadline_days: number;
    conditional_threshold: number;
  };
  source: string;
}

interface PoamEligibilityResolved {
  ineligible_set: Set<string>;
  conditional_eligibility: Record<string, { condition: string; effect: string; reference: string }>;
  closeout_deadline_days: number;
  source: string;
}

export class DirectivePoamGenerator {
  private readonly eligibility: PoamEligibilityResolved;

  constructor() {
    // Resolve the eligibility data file using multiple strategies
    let eligibilityPath: string | null = null;

    const candidates = [
      path.resolve(process.cwd(), 'src', 'shared', 'data', 'poam-eligibility.json'),
      path.resolve(process.cwd(), 'dist', 'shared', 'data', 'poam-eligibility.json'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        eligibilityPath = candidate;
        break;
      }
    }

    if (eligibilityPath) {
      try {
        const raw: PoamEligibilityRaw = JSON.parse(fs.readFileSync(eligibilityPath, 'utf-8'));
        // Flatten all ineligible controls into a single Set for O(1) lookup
        const allIneligible = [
          ...raw.ineligible_controls.weight_5,
          ...raw.ineligible_controls.weight_3,
          ...raw.ineligible_controls.explicitly_named_ineligible,
        ];
        this.eligibility = {
          ineligible_set: new Set(allIneligible),
          conditional_eligibility: raw.conditional_eligibility,
          closeout_deadline_days: raw.scoring_context.closeout_deadline_days,
          source: raw.source,
        };
      } catch {
        this.eligibility = {
          ineligible_set: new Set(),
          conditional_eligibility: {},
          closeout_deadline_days: 180,
          source: 'fallback (parse error)',
        };
      }
    } else {
      this.eligibility = {
        ineligible_set: new Set(),
        conditional_eligibility: {},
        closeout_deadline_days: 180,
        source: 'fallback (file not found)',
      };
      console.warn('[DirectivePoamGenerator] poam-eligibility.json not found, using empty fallback');
    }
  }

  /**
   * Check whether a control is eligible for POA&M per 32 CFR 170.21.
   * Controls with weight > 1 or explicitly named in § 170.21(a)(2)(iii) are ineligible.
   * SC.L2-3.13.11 has conditional eligibility (FIPS exception).
   */
  checkPoamEligibility(controlId: string): { eligible: boolean; reason?: string } {
    // Check conditional eligibility first (e.g., SC.L2-3.13.11 FIPS exception)
    const conditional = this.eligibility.conditional_eligibility[controlId];
    if (conditional) {
      return {
        eligible: true,
        reason: `Conditionally eligible: ${conditional.condition} (${conditional.reference})`,
      };
    }

    // Check ineligible set (weight_5 + weight_3 + explicitly named)
    if (this.eligibility.ineligible_set.has(controlId)) {
      return {
        eligible: false,
        reason: `POA&M-ineligible per 32 CFR \u00a7 170.21 (point value > 1 or explicitly prohibited)`,
      };
    }

    return { eligible: true };
  }

  /**
   * Generate a single POA&M item from a NOT_MET control with directive metadata.
   */
  generatePoamItem(
    control: DirectiveControlImplementation,
    metadata: ExtendedDirectiveMetadata,
    assessmentDate?: string
  ): DirectivePoamItem {
    const eligibility = this.checkPoamEligibility(control.control_id);

    // Closure date: per § 170.21 closeout deadline from assessment date
    const baseDate = assessmentDate ? new Date(assessmentDate) : new Date();
    const closureDate = new Date(baseDate);
    closureDate.setDate(closureDate.getDate() + this.eligibility.closeout_deadline_days);

    // Derive required artifacts from directive
    let requiredArtifacts = this.getRequiredArtifacts(metadata.directive);
    let remediation: string | undefined;

    // Parse failure reasons for inherit-fedramp controls
    if (control.directive === 'inherit-fedramp' && control.sprsRationale) {
      const rationale = control.sprsRationale;
      if (rationale.includes('fedramp_package_id')) {
        remediation = 'Obtain FedRAMP authorization package reference from CSP documentation';
        requiredArtifacts.push('FedRAMP authorization package document ID');
      } else if (rationale.includes('tenant_variant_confirmed')) {
        remediation = 'Confirm tenant variant matches authorized system boundary in FedRAMP package';
        requiredArtifacts.push('Tenant variant confirmation statement');
      } else if (rationale.includes('crm_reference')) {
        remediation = 'Review Customer Responsibility Matrix and document customer-side responsibilities';
        requiredArtifacts.push('CRM review documentation');
      } else {
        remediation = 'Verify FedRAMP inheritance requirements per CRM';
        requiredArtifacts = ['FedRAMP authorization package', 'Customer Responsibility Matrix', 'tenant variant confirmation'];
      }
    }

    return {
      control_id: control.control_id,
      control_title: control.practice,
      reason_not_met: remediation ?? control.sprsRationale ?? 'Directive requirements not satisfied',
      eligibility,
      closure_date: closureDate.toISOString(),
      required_artifacts: requiredArtifacts,
      directive: metadata.directive,
    };
  }

  /**
   * Build the full POA&M list from directive-aware control implementations.
   * Filters to controls where sprsValue === 'NOT_MET', generates items,
   * and splits into blocking (ineligible) and eligible lists.
   */
  buildPoamList(controls: DirectiveControlImplementation[]): DirectivePlanOfActionMilestones {
    const blockingItems: DirectivePoamItem[] = [];
    const eligibleItems: DirectivePoamItem[] = [];

    for (const ctrl of controls) {
      if (ctrl.sprsValue !== 'NOT_MET') continue;
      if (!ctrl.directiveMetadata) continue;

      const item = this.generatePoamItem(ctrl, ctrl.directiveMetadata);

      if (item.eligibility.eligible) {
        eligibleItems.push(item);
      } else {
        blockingItems.push(item);
      }
    }

    return {
      generated_at: new Date().toISOString(),
      total_items: blockingItems.length + eligibleItems.length,
      blocking_items: blockingItems,
      eligible_items: eligibleItems,
    };
  }

  private getRequiredArtifacts(directive: DirectiveType): string[] {
    switch (directive) {
      case 'document-prohibition':
        return ['policy document', 'enforcement verification artifact'];
      case 'implement':
        return ['enforcement configuration artifact'];
      case 'validate':
        return ['validated evidence artifact'];
      case 'manual':
        return ['manual evidence artifact'];
      case 'document-absence':
        return ['baseline system inventory'];
      case 'inherit-fedramp':
        return ['FedRAMP authorization package', 'Customer Responsibility Matrix', 'tenant variant confirmation'];
      case 'skip':
        return [];
      default:
        return [];
    }
  }
}
