// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Directive-to-SPRS mapping engine.
 * Maps directive metadata to MET / NOT_MET / N/A determinations with rationale.
 * Used alongside the existing SprsCalculator for directive-aware SPRS calculation.
 */

import type { CmmcControl } from 'ces-shared/types/controls';
import type { ExtendedDirectiveMetadata, DirectiveType } from '../../shared/types/directive.types.js';
import type { DirectiveControlImplementation } from '../../shared/types/ssp.types.js';
import type { RenderResult } from '../../shared/types/render.types.js';

export interface SprsValueResult {
  value: 'MET' | 'NOT_MET' | 'N/A';
  rationale: string;
}

export interface EvidenceRequirementResult {
  satisfied: boolean;
  missingFields: string[];
}

export interface DirectiveScoreResult {
  score: number;
  metCount: number;
  notMetCount: number;
  naCount: number;
  skippedCount: number;
}

export class DirectiveSprsCalculator {

  /**
   * Calculate the SPRS value (MET/NOT_MET/N/A) for a single control
   * based on its directive metadata and artifact presence.
   *
   * Returns null for 'skip' directives (omitted from score).
   */
  calculateSprsValue(
    control: CmmcControl,
    metadata: ExtendedDirectiveMetadata,
    artifactMap: Map<string, boolean>,
    renderStatusMap?: Map<string, RenderResult>
  ): SprsValueResult | null {
    // Render-aware logic: if renderStatusMap has entry for this control
    // and state !== 'rendered', return NOT_MET with failure reason
    if (renderStatusMap) {
      const renderResult = renderStatusMap.get(control.control_id);
      if (renderResult && renderResult.state !== 'rendered') {
        return {
          value: 'NOT_MET',
          rationale: `NOT_MET: Artifact render failed for ${control.control_id}. ` +
            `Render state: ${renderResult.state}. ` +
            `Failure reason: ${renderResult.failure_reason ?? 'Unknown'}.`,
        };
      }
    }

    const directive = metadata.directive;

    switch (directive) {
      case 'implement': {
        if (metadata.enforcement_verified) {
          return {
            value: 'MET',
            rationale: `MET: Enforcement verified active for ${control.control_id}. ` +
              `Directive: implement, enforcement_verified=true.`,
          };
        }
        return {
          value: 'NOT_MET',
          rationale: `NOT_MET: Enforcement not verified for ${control.control_id}. ` +
            `Directive: implement, enforcement_verified=false.`,
        };
      }

      case 'validate': {
        const hasArtifact = metadata.evidence_artifacts.some(a => artifactMap.get(a) === true);
        if (hasArtifact) {
          return {
            value: 'MET',
            rationale: `MET: Validated artifact present for ${control.control_id}. ` +
              `Directive: validate, artifact confirmed.`,
          };
        }
        return {
          value: 'NOT_MET',
          rationale: `NOT_MET: Validated artifact missing for ${control.control_id}. ` +
            `Directive: validate, no artifact found.`,
        };
      }

      case 'manual': {
        if (metadata.platform_inherited) {
          const hasCrm = !!metadata.crm_reference;
          const hasFedramp = !!metadata.fedramp_package_id;
          if (hasCrm && hasFedramp) {
            return {
              value: 'MET',
              rationale: `MET: Platform inherited control with CRM reference (${metadata.crm_reference}) ` +
                `and FedRAMP package (${metadata.fedramp_package_id}) for ${control.control_id}.`,
            };
          }
          const missing: string[] = [];
          if (!hasCrm) missing.push('crm_reference');
          if (!hasFedramp) missing.push('fedramp_package_id');
          return {
            value: 'NOT_MET',
            rationale: `NOT_MET: Platform inherited control missing required citations for ${control.control_id}. ` +
              `Missing: ${missing.join(', ')}.`,
          };
        }
        // Non-inherited manual: check artifact presence
        const hasManualArtifact = metadata.evidence_artifacts.some(a => artifactMap.get(a) === true);
        if (hasManualArtifact) {
          return {
            value: 'MET',
            rationale: `MET: Manual artifact present for ${control.control_id}. ` +
              `Directive: manual, artifact confirmed.`,
          };
        }
        return {
          value: 'NOT_MET',
          rationale: `NOT_MET: Manual artifact missing for ${control.control_id}. ` +
            `Directive: manual, no artifact found.`,
        };
      }

      case 'document-absence': {
        return {
          value: 'N/A',
          rationale: `N/A: Capability does not exist in assessment boundary for ${control.control_id}. ` +
            `Directive: document-absence.`,
        };
      }

      case 'document-prohibition': {
        const hasArtifacts = metadata.evidence_artifacts.length >= 2 &&
          metadata.evidence_artifacts.slice(0, 2).every(a => artifactMap.get(a) === true);
        if (metadata.enforcement_verified && hasArtifacts) {
          return {
            value: 'MET',
            rationale: `MET: Prohibition enforced and verified for ${control.control_id}. ` +
              `Both policy and enforcement artifacts present, enforcement_verified=true.`,
          };
        }
        const reasons: string[] = [];
        if (!metadata.enforcement_verified) reasons.push('enforcement not verified');
        if (!hasArtifacts) reasons.push('required artifacts missing');
        return {
          value: 'NOT_MET',
          rationale: `NOT_MET: Prohibition requirements unsatisfied for ${control.control_id}. ` +
            `Reasons: ${reasons.join(', ')}.`,
        };
      }

      case 'inherit-fedramp': {
        if (metadata.readiness === 'met') {
          return {
            value: 'MET',
            rationale: `MET: FedRAMP inheritance verified for ${control.control_id}. ` +
              `Authorization package: ${metadata.fedramp_package_id ?? '[not recorded]'}, ` +
              `tenant variant confirmed: ${metadata.tenant_variant_confirmed ?? '[not recorded]'}.`
          };
        }
        if (metadata.readiness === 'not-met') {
          return {
            value: 'NOT_MET',
            rationale: `NOT_MET: FedRAMP inheritance requirements unsatisfied for ${control.control_id}. ` +
              `Missing fields or CRM review incomplete.`
          };
        }
        // readiness === 'unknown'
        return {
          value: 'NOT_MET',
          rationale: `NOT_MET: FedRAMP inheritance status unknown for ${control.control_id}. ` +
            `Requires CRM review and authorization package validation.`
        };
      }

      case 'skip': {
        // Omit from score entirely
        return null;
      }

      default: {
        throw new Error(
          `Unrecognized directive '${directive}' for control ${control.control_id}`
        );
      }
    }
  }

  /**
   * Verify that all evidence requirements are satisfied for a given directive.
   * Returns which fields are missing so the caller can downgrade MET to NOT_MET.
   */
  verifyEvidenceRequirements(
    directive: DirectiveType,
    metadata: ExtendedDirectiveMetadata
  ): EvidenceRequirementResult {
    const missingFields: string[] = [];

    switch (directive) {
      case 'document-prohibition':
        if (!metadata.policy_reference) missingFields.push('policy_reference');
        if (!metadata.enforcement_mechanism) missingFields.push('enforcement_mechanism');
        if (metadata.evidence_artifacts.length < 2) missingFields.push('evidence_artifacts (need at least 2)');
        break;

      case 'validate':
        if (metadata.evidence_artifacts.length === 0) missingFields.push('evidence_artifacts (need at least 1)');
        break;

      case 'manual':
        if (metadata.platform_inherited) {
          if (!metadata.crm_reference) missingFields.push('crm_reference');
          if (!metadata.fedramp_package_id) missingFields.push('fedramp_package_id');
        } else {
          if (metadata.evidence_artifacts.length === 0) missingFields.push('evidence_artifacts (need at least 1)');
        }
        break;

      case 'inherit-fedramp':
        if (!metadata.fedramp_package_id) missingFields.push('fedramp_package_id');
        if (!metadata.tenant_variant_confirmed) missingFields.push('tenant_variant_confirmed');
        if (!metadata.crm_reference) missingFields.push('crm_reference');
        break;

      default:
        break;
    }

    return {
      satisfied: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Calculate the aggregate SPRS score from directive-aware control implementations.
   * Starts at 110, deducts weight for each NOT_MET control.
   */
  calculateScore(
    controls: DirectiveControlImplementation[],
    weights: Map<string, number>
  ): DirectiveScoreResult {
    let score = 110;
    let metCount = 0;
    let notMetCount = 0;
    let naCount = 0;
    let skippedCount = 0;

    for (const ctrl of controls) {
      if (ctrl.directive === 'skip' || !ctrl.sprsValue) {
        skippedCount++;
        continue;
      }

      switch (ctrl.sprsValue) {
        case 'MET':
          metCount++;
          break;
        case 'NOT_MET': {
          notMetCount++;
          const weight = weights.get(ctrl.control_id) ?? 1;
          score -= weight;
          break;
        }
        case 'N/A':
          naCount++;
          break;
      }
    }

    if (score < 0) score = 0;

    return { score, metCount, notMetCount, naCount, skippedCount };
  }
}
