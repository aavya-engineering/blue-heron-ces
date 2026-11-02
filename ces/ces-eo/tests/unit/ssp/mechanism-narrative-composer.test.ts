// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { MechanismNarrativeComposer } from '../../../src/eo/ssp/MechanismNarrativeComposer';
import type { DependencyTable } from '../../../src/eo/ssp/MechanismNarrativeComposer';
import type { MechanismStatus } from '../../../src/shared/types/evidence.types';

const dependencyTable: DependencyTable = JSON.parse(
  require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../src/shared/data/mechanism-dependency-table.json'),
    'utf-8'
  )
);

function allPassStatus(): MechanismStatus {
  return {
    ca_app_control_active: true,
    ca_non_browser_block_active: true,
    dlp_active: true,
    sensitivity_labels_active: true,
  };
}

describe('MechanismNarrativeComposer', () => {
  describe('composeMechanismFragment', () => {
    it('joins 2 mechanisms for AC.L2-3.1.18 (ca_app_control + ca_non_browser_block)', () => {
      const result = MechanismNarrativeComposer.composeMechanismFragment(
        'AC.L2-3.1.18', allPassStatus(), dependencyTable
      );
      expect(result).toContain('Conditional Access App Control is active');
      expect(result).toContain('Non-Browser Client Block is active');
      expect(result).toContain(' and ');
    });

    it('joins 3 mechanisms for AC.L2-3.1.19 (ca_app_control + ca_non_browser_block + sensitivity_labels)', () => {
      const result = MechanismNarrativeComposer.composeMechanismFragment(
        'AC.L2-3.1.19', allPassStatus(), dependencyTable
      );
      expect(result).toContain('Conditional Access App Control is active');
      expect(result).toContain('Non-Browser Client Block is active');
      expect(result).toContain('Sensitivity Labels is active');
    });

    it('joins 1 mechanism for MP.L2-3.8.5 (ca_app_control only)', () => {
      const result = MechanismNarrativeComposer.composeMechanismFragment(
        'MP.L2-3.8.5', allPassStatus(), dependencyTable
      );
      expect(result).toContain('Conditional Access App Control is active');
      expect(result).not.toContain(' and ');
    });

    it('joins 2 mechanisms for MP.L2-3.8.6 (ca_app_control + sensitivity_labels)', () => {
      const result = MechanismNarrativeComposer.composeMechanismFragment(
        'MP.L2-3.8.6', allPassStatus(), dependencyTable
      );
      expect(result).toContain('Conditional Access App Control is active');
      expect(result).toContain('Sensitivity Labels is active');
    });

    it('shows "is not active" for failing mechanisms', () => {
      const status: MechanismStatus = {
        ca_app_control_active: true,
        ca_non_browser_block_active: false,
        dlp_active: true,
        sensitivity_labels_active: true,
      };
      const result = MechanismNarrativeComposer.composeMechanismFragment(
        'AC.L2-3.1.18', status, dependencyTable
      );
      expect(result).toContain('Non-Browser Client Block is not active');
    });

    it('returns empty string for unknown control', () => {
      const result = MechanismNarrativeComposer.composeMechanismFragment(
        'XX.L2-99.99.99', allPassStatus(), dependencyTable
      );
      expect(result).toBe('');
    });

    it('handles DLP-only controls (AC.L1-3.1.22)', () => {
      const result = MechanismNarrativeComposer.composeMechanismFragment(
        'AC.L1-3.1.22', allPassStatus(), dependencyTable
      );
      expect(result).toContain('Data Loss Prevention is active');
    });

    it('handles DLP + sensitivity_labels controls (MP.L2-3.8.9)', () => {
      const result = MechanismNarrativeComposer.composeMechanismFragment(
        'MP.L2-3.8.9', allPassStatus(), dependencyTable
      );
      expect(result).toContain('Data Loss Prevention is active');
      expect(result).toContain('Sensitivity Labels is active');
    });
  });

  describe('evaluateMechanismStatus', () => {
    it('returns allPass=true when all required mechanisms active', () => {
      const result = MechanismNarrativeComposer.evaluateMechanismStatus(
        'AC.L2-3.1.18', allPassStatus(), dependencyTable
      );
      expect(result.allPass).toBe(true);
      expect(result.failedMechanisms).toEqual([]);
    });

    it('returns allPass=false when required mechanism inactive', () => {
      const status: MechanismStatus = {
        ca_app_control_active: false,
        ca_non_browser_block_active: true,
        dlp_active: true,
        sensitivity_labels_active: true,
      };
      const result = MechanismNarrativeComposer.evaluateMechanismStatus(
        'AC.L2-3.1.18', status, dependencyTable
      );
      expect(result.allPass).toBe(false);
      expect(result.failedMechanisms).toContain('Conditional Access App Control');
    });

    it('ignores recommended mechanisms when evaluating pass/fail', () => {
      // AC.L2-3.1.19 has sensitivity_labels as recommended
      const status: MechanismStatus = {
        ca_app_control_active: true,
        ca_non_browser_block_active: true,
        dlp_active: true,
        sensitivity_labels_active: false,
      };
      const result = MechanismNarrativeComposer.evaluateMechanismStatus(
        'AC.L2-3.1.19', status, dependencyTable
      );
      expect(result.allPass).toBe(true);
    });

    it('returns allPass=true for unknown control', () => {
      const result = MechanismNarrativeComposer.evaluateMechanismStatus(
        'XX.L2-99.99.99', allPassStatus(), dependencyTable
      );
      expect(result.allPass).toBe(true);
    });

    it('correctly evaluates all 11 controls with all mechanisms passing', () => {
      const controlIds = dependencyTable.dependencies.map(d => d.control_id);
      for (const cid of controlIds) {
        const result = MechanismNarrativeComposer.evaluateMechanismStatus(
          cid, allPassStatus(), dependencyTable
        );
        expect(result.allPass).toBe(true);
      }
    });

    it('detects DLP failure for DLP-dependent controls', () => {
      const status: MechanismStatus = {
        ca_app_control_active: true,
        ca_non_browser_block_active: true,
        dlp_active: false,
        sensitivity_labels_active: true,
      };
      const result = MechanismNarrativeComposer.evaluateMechanismStatus(
        'MP.L2-3.8.8', status, dependencyTable
      );
      expect(result.allPass).toBe(false);
      expect(result.failedMechanisms).toContain('Data Loss Prevention');
    });
  });
});
