// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Generates the FedRAMP Inherited Controls section (Section 2.4) for the SSP.
 * Filters inherit-fedramp controls, validates metadata consistency,
 * generates parent narrative + per-control entries, and applies validation.
 */

import type { ControlImplementation } from 'ces-shared/types/ssp';
import type { ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import type { DirectiveControlImplementation } from '../../shared/types/ssp.types.js';
import { DirectiveNarrativeBuilder } from '../generation/DirectiveNarrativeBuilder.js';
import { NarrativeLanguageGuard } from './NarrativeLanguageGuard.js';

export interface InheritanceSection {
  parentNarrative: string;
  controlEntries: ControlImplementation[];
}

export class FedRampInheritanceGenerator {

  generateInheritanceSection(
    controls: DirectiveControlImplementation[],
    metadata: Map<string, ExtendedDirectiveMetadata>
  ): InheritanceSection | null {
    // 1. Filter controls where directive === 'inherit-fedramp'
    const inheritControls = controls.filter(c => c.directive === 'inherit-fedramp');
    if (inheritControls.length === 0) return null;

    // 2. Extract common fields from first metadata
    const firstMeta = metadata.get(inheritControls[0].control_id);
    if (!firstMeta) return null;

    // 3. Validate all inherit-fedramp controls share same fedramp_package_id
    const packageId = firstMeta.fedramp_package_id;
    for (const ctrl of inheritControls) {
      const ctrlMeta = metadata.get(ctrl.control_id);
      if (ctrlMeta && ctrlMeta.fedramp_package_id !== packageId) {
        console.warn(
          `[FedRampInheritanceGenerator] Multiple FedRAMP packages detected: ` +
          `${packageId} vs ${ctrlMeta.fedramp_package_id}. Using first package.`
        );
        break;
      }
    }

    // 4. Build CmmcControl-shaped objects for the narrative builder
    const cmmcControls = inheritControls.map(c => ({
      control_id: c.control_id,
      nist_ref: c.nist_ref,
      family: c.family,
      practice: c.practice,
      weight: c.weight,
    }));

    // 5. Generate parent section narrative
    let parentNarrative = DirectiveNarrativeBuilder.buildInheritFedRampNarrative(
      cmmcControls[0] as any,
      firstMeta,
      true,
      cmmcControls as any[]
    );

    // 6. Validate date fabrication
    const allowedDates = [new Date().toISOString().split('T')[0]];
    const dateCheck = NarrativeLanguageGuard.validateNoFabricatedDates(parentNarrative, allowedDates);
    if (!dateCheck.valid) {
      console.warn(`[FedRampInheritanceGenerator] Fabricated dates detected: ${dateCheck.violations.join(', ')}. Replacing with "see compliance repository".`);
      for (const date of dateCheck.violations) {
        parentNarrative = parentNarrative.replace(new RegExp(date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'see compliance repository');
      }
    }

    // 7. Validate generic CRM language
    const crmCheck = NarrativeLanguageGuard.validateNoGenericCrm(parentNarrative);
    if (!crmCheck.valid) {
      console.warn(`[FedRampInheritanceGenerator] Generic CRM language detected: ${crmCheck.violations.join(', ')}. Consider refining narrative.`);
    }

    // 8. Build control entries from existing control implementations
    const controlEntries: ControlImplementation[] = inheritControls.map(c => ({
      control_id: c.control_id,
      nist_ref: c.nist_ref,
      family: c.family,
      practice: c.practice,
      status: c.status,
      classification: c.classification,
      weight: c.weight,
      implementationNarrative: c.implementationNarrative,
      technologyUsed: c.technologyUsed,
      responsibleRole: c.responsibleRole,
      evidenceReferences: c.evidenceReferences,
      relatedPolicies: c.relatedPolicies,
      odpValues: c.odpValues,
      assessmentObjectives: c.assessmentObjectives,
    }));

    return {
      parentNarrative,
      controlEntries,
    };
  }
}
