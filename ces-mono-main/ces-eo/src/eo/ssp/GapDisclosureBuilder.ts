// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { MechanismStatus, ArchitectureMetadata } from '../../shared/types/evidence.types.js';
import type { DependencyTable } from './MechanismNarrativeComposer.js';

const MECHANISM_LABELS: Record<string, string> = {
  ca_app_control: 'Conditional Access App Control',
  ca_non_browser_block: 'Non-Browser Client Block',
  dlp: 'Data Loss Prevention',
  sensitivity_labels: 'Sensitivity Labels',
};

const MECHANISM_STATUS_KEYS: Record<string, keyof MechanismStatus> = {
  ca_app_control: 'ca_app_control_active',
  ca_non_browser_block: 'ca_non_browser_block_active',
  dlp: 'dlp_active',
  sensitivity_labels: 'sensitivity_labels_active',
};

export class GapDisclosureBuilder {

  static buildGapDisclosure(
    mechanismStatus: MechanismStatus,
    dependencyTable: DependencyTable,
    evidenceMetadata: ArchitectureMetadata
  ): string {
    const failingMechanisms: string[] = [];

    for (const dep of dependencyTable.dependencies) {
      for (const [key, level] of Object.entries(dep.mechanisms)) {
        if (level !== 'required') continue;
        const statusKey = MECHANISM_STATUS_KEYS[key];
        if (!mechanismStatus[statusKey]) {
          const label = MECHANISM_LABELS[key];
          if (!failingMechanisms.includes(label)) {
            failingMechanisms.push(label);
          }
        }
      }
    }

    if (failingMechanisms.length === 0) return '';

    let disclosure = `\n\nGap Disclosure: The following enforcement mechanisms required by the session-controlled BYOD architecture are not yet active: ${failingMechanisms.join(', ')}.`;

    if (evidenceMetadata.gap_description_dlp) {
      disclosure += ` ${evidenceMetadata.gap_description_dlp}`;
    }

    if (evidenceMetadata.poam_id) {
      disclosure += ` See ${evidenceMetadata.poam_id} in the Plan of Action and Milestones for remediation timeline.`;
    }

    return disclosure;
  }
}
