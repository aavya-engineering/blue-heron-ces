// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { MechanismStatus } from '../../shared/types/evidence.types.js';
import type { ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
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

export class SprsValidator {

  static validateMechanismConsistency(
    controlId: string,
    directiveMetadata: ExtendedDirectiveMetadata,
    mechanismStatus: MechanismStatus,
    dependencyTable: DependencyTable
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!directiveMetadata.enforcement_verified) {
      return { valid: true, errors: [] };
    }

    const entry = dependencyTable.dependencies.find(d => d.control_id === controlId);
    if (!entry) {
      return { valid: true, errors: [] };
    }

    for (const [key, level] of Object.entries(entry.mechanisms)) {
      if (level !== 'required') continue;
      const statusKey = MECHANISM_STATUS_KEYS[key];
      if (!mechanismStatus[statusKey]) {
        errors.push(
          `${controlId}: enforcement_verified=true but ${MECHANISM_LABELS[key]} (${statusKey}) is false. ` +
          `This mismatch indicates a Stamper bug or evidence tampering.`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
