// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { CUIBoundaryOutput } from '@/shared/types/artifacts';
import type { CUIAnswer, CUISectionDef } from '../types';

/**
 * Normalization map: derive BTC-activation contract keys from bank answers.
 * The CUI Output Contract specifies keys like `byod_model` and `managed_device_required`
 * but the bank produces `device_model` from CUI.DEV.001. This map handles the transformation.
 */
function deriveContractKeys(
  boundary: Record<string, string | number | boolean | string[]>
): void {
  const deviceModel = boundary.device_model as string | undefined;
  if (deviceModel) {
    if (deviceModel === 'Yes – managed only') {
      boundary.byod_model = 'No BYOD';
      boundary.managed_device_required = 'Yes - managed only';
    } else if (deviceModel === 'BYOD via VDI/Cloud PC') {
      boundary.byod_model = 'Yes - VDI/Cloud PC only';
      boundary.managed_device_required = 'No';
    } else if (deviceModel === 'BYOD direct access allowed') {
      boundary.byod_model = 'Yes - direct access allowed';
      boundary.managed_device_required = 'No';
    } else {
      boundary.byod_model = 'Unknown';
      boundary.managed_device_required = 'Unknown';
    }
  }

  // Derive guest_access_policy from external_sharing_model (CUI.LC.EGR.001)
  const externalSharing = boundary.external_sharing_model as string | undefined;
  if (externalSharing) {
    if (externalSharing === 'No') {
      boundary.guest_access_policy = 'No';
    } else {
      boundary.guest_access_policy = 'Yes - tightly controlled';
    }
  }

  // Normalize devops_in_scope to contract values
  const devops = boundary.devops_in_scope as string | undefined;
  if (devops) {
    if (devops === 'No') {
      boundary.devops_in_scope = 'No';
    } else if (devops.startsWith('Yes')) {
      boundary.devops_in_scope = 'Yes';
    }
  }
}

export function generateCUIBoundary(
  answers: Record<string, CUIAnswer>,
  sections: CUISectionDef[],
  bankVersion: string
): CUIBoundaryOutput {
  const boundary: Record<string, string | number | boolean | string[]> = {};

  // Direct mapping: extract bindings.manifest.* and bindings.policy.* keys
  for (const section of sections) {
    for (const question of section.questions) {
      const answer = answers[question.id];
      if (!answer) continue;

      if (question.bindings.manifest) {
        for (const key of Object.keys(question.bindings.manifest)) {
          boundary[key] = answer.raw_answer;
        }
      }
      if (question.bindings.policy) {
        for (const key of Object.keys(question.bindings.policy)) {
          boundary[key] = answer.raw_answer;
        }
      }
    }
  }

  // Contract normalization: derive BTC-activation keys
  deriveContractKeys(boundary);

  return {
    ces: {
      artifact: 'cui_boundary_output',
      version: '1.0',
      generated_on: new Date().toISOString().slice(0, 10),
      cui_bank_version: bankVersion,
    },
    cui_boundary: boundary,
  };
}
