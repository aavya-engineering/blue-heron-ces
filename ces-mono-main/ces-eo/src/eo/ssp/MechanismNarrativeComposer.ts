// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { MechanismStatus } from '../../shared/types/evidence.types.js';

export interface DependencyEntry {
  control_id: string;
  mechanisms: {
    ca_app_control: 'required' | 'recommended' | null;
    ca_non_browser_block: 'required' | 'recommended' | null;
    dlp: 'required' | 'recommended' | null;
    sensitivity_labels: 'required' | 'recommended' | null;
  };
}

export interface DependencyTable {
  architecture: string;
  dependencies: DependencyEntry[];
}

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

export class MechanismNarrativeComposer {

  static composeMechanismFragment(
    controlId: string,
    mechanismStatus: MechanismStatus,
    dependencyTable: DependencyTable
  ): string {
    const entry = dependencyTable.dependencies.find(d => d.control_id === controlId);
    if (!entry) return '';

    const fragments: string[] = [];
    for (const [key, level] of Object.entries(entry.mechanisms)) {
      if (level === null) continue;
      const statusKey = MECHANISM_STATUS_KEYS[key];
      const active = mechanismStatus[statusKey];
      const label = MECHANISM_LABELS[key];
      if (active) {
        fragments.push(`${label} is active`);
      } else {
        fragments.push(`${label} is not active`);
      }
    }

    if (fragments.length === 0) return '';
    if (fragments.length === 1) return fragments[0] + '.';
    const last = fragments.pop()!;
    return fragments.join(', ') + ' and ' + last + '.';
  }

  static evaluateMechanismStatus(
    controlId: string,
    mechanismStatus: MechanismStatus,
    dependencyTable: DependencyTable
  ): { allPass: boolean; failedMechanisms: string[] } {
    const entry = dependencyTable.dependencies.find(d => d.control_id === controlId);
    if (!entry) return { allPass: true, failedMechanisms: [] };

    const failedMechanisms: string[] = [];
    for (const [key, level] of Object.entries(entry.mechanisms)) {
      if (level !== 'required') continue;
      const statusKey = MECHANISM_STATUS_KEYS[key];
      const active = mechanismStatus[statusKey];
      if (!active) {
        failedMechanisms.push(MECHANISM_LABELS[key]);
      }
    }

    return {
      allPass: failedMechanisms.length === 0,
      failedMechanisms,
    };
  }
}
