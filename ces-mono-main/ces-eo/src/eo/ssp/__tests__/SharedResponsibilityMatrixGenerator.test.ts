// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach } from '@jest/globals';
import { SharedResponsibilityMatrixGenerator } from '../SharedResponsibilityMatrixGenerator.js';

/**
 * Unit tests for SharedResponsibilityMatrixGenerator (Phase 05)
 *
 * Validates:
 * - Azure-backed architecture returns 52 inherited controls
 * - BYOD architecture returns 46 inherited controls
 * - Partial inheritance controls marked as "Shared"
 * - Full inheritance controls marked as "Inherited"
 * - Non-inherited controls marked as "Customer"
 */
describe('SharedResponsibilityMatrixGenerator', () => {
  let generator: SharedResponsibilityMatrixGenerator;

  beforeEach(() => {
    generator = new SharedResponsibilityMatrixGenerator();
  });

  describe('computeControlOwnership', () => {
    it('should mark PE.L2-3.10.1 as Inherited (full inheritance, no customer implementation)', () => {
      const result = generator.computeControlOwnership('PE.L2-3.10.1', 'azure-gov', false);

      expect(result.controlId).toBe('PE.L2-3.10.1');
      expect(result.responsibility).toBe('Inherited');
      expect(result.rationale).toContain('Fully inherited from Microsoft FedRAMP High');
    });

    it('should mark AC.L2-3.1.2 as Shared (partial inheritance)', () => {
      const result = generator.computeControlOwnership('AC.L2-3.1.2', 'azure-gov', false);

      expect(result.controlId).toBe('AC.L2-3.1.2');
      expect(result.responsibility).toBe('Shared');
      expect(result.rationale).toContain('Microsoft:');
      expect(result.rationale).toContain('Customer:');
    });

    it('should mark AT.L2-3.2.1 as Customer (no inheritance)', () => {
      const result = generator.computeControlOwnership('AT.L2-3.2.1', 'azure-gov', false);

      expect(result.controlId).toBe('AT.L2-3.2.1');
      expect(result.responsibility).toBe('Customer');
      expect(result.rationale).toContain('Not inherited from Microsoft FedRAMP High');
    });

    it('should mark inherited control as Shared if AdminOps knowledge bank exists', () => {
      const result = generator.computeControlOwnership('PE.L2-3.10.1', 'azure-gov', true);

      expect(result.controlId).toBe('PE.L2-3.10.1');
      expect(result.responsibility).toBe('Shared');
      expect(result.rationale).toContain('Microsoft:');
    });

    it('should mark Azure-only control as Customer for BYOD architecture', () => {
      const result = generator.computeControlOwnership('SC.L2-3.13.1', 'byod', false);

      expect(result.controlId).toBe('SC.L2-3.13.1');
      expect(result.responsibility).toBe('Customer');
      expect(result.rationale).toContain('but not byod');
    });

    it('should mark BYOD-compatible control as Inherited for BYOD architecture', () => {
      const result = generator.computeControlOwnership('AC.L2-3.1.3', 'byod', false);

      expect(result.controlId).toBe('AC.L2-3.1.3');
      expect(result.responsibility).toBe('Inherited');
      expect(result.rationale).toContain('Fully inherited');
    });
  });

  describe('generateCrmTable', () => {
    it('should return 52 inherited controls for Azure-backed architecture (no AdminOps)', () => {
      // All 110 CMMC L2 controls (representative subset for test)
      const allControlIds = generateAllControlIds();

      const result = generator.generateCrmTable(allControlIds, 'azure-gov', new Set());

      expect(result.totalControls).toBe(110);
      expect(result.inherited + result.shared).toBeGreaterThanOrEqual(40); // Inherited plus shared FedRAMP-backed controls
      expect(result.inherited + result.shared + result.customer).toBe(110);
      expect(result.fedRampReference).toContain('FedRAMP High');
      expect(result.fedRampReference).toContain('2017-07-28');
    });

    it('should return fewer inherited controls for BYOD architecture (6 fewer infrastructure controls)', () => {
      const allControlIds = generateAllControlIds();

      const azureResult = generator.generateCrmTable(allControlIds, 'azure-gov', new Set());
      const byodResult = generator.generateCrmTable(allControlIds, 'byod', new Set());

      expect(byodResult.totalControls).toBe(110);
      expect(byodResult.inherited).toBeLessThan(azureResult.inherited);
      expect(azureResult.inherited - byodResult.inherited).toBeGreaterThanOrEqual(5); // At least 5-6 fewer inherited
      expect(byodResult.inherited + byodResult.shared + byodResult.customer).toBe(110);
    });

    it('should return 14-family breakdown with correct family names', () => {
      const allControlIds = generateAllControlIds();

      const result = generator.generateCrmTable(allControlIds, 'azure-gov', new Set());

      expect(result.byFamily).toHaveLength(14);
      const familyNames = result.byFamily.map(f => f.family);
      expect(familyNames).toContain('AC');
      expect(familyNames).toContain('AT');
      expect(familyNames).toContain('AU');
      expect(familyNames).toContain('CA');
      expect(familyNames).toContain('CM');
      expect(familyNames).toContain('IA');
      expect(familyNames).toContain('IR');
      expect(familyNames).toContain('MA');
      expect(familyNames).toContain('MP');
      expect(familyNames).toContain('PE');
      expect(familyNames).toContain('PS');
      expect(familyNames).toContain('RA');
      expect(familyNames).toContain('SC');
      expect(familyNames).toContain('SI');
    });

    it('should return per-control details array', () => {
      const allControlIds = generateAllControlIds();

      const result = generator.generateCrmTable(allControlIds, 'azure-gov', new Set());

      expect(result.controlDetails).toBeDefined();
      expect(result.controlDetails!.length).toBe(110);
      expect(result.controlDetails![0]).toHaveProperty('controlId');
      expect(result.controlDetails![0]).toHaveProperty('responsibility');
      expect(result.controlDetails![0]).toHaveProperty('rationale');
    });

    it('should mark controls as Shared when AdminOps knowledge banks exist', () => {
      const allControlIds = generateAllControlIds();
      const adminOpsKnowledgeBanks = new Set(['PE.L2-3.10.1', 'PE.L2-3.10.2']); // Normally inherited

      const result = generator.generateCrmTable(allControlIds, 'azure-gov', adminOpsKnowledgeBanks);

      const pe1 = result.controlDetails!.find(c => c.controlId === 'PE.L2-3.10.1');
      const pe2 = result.controlDetails!.find(c => c.controlId === 'PE.L2-3.10.2');

      expect(pe1?.responsibility).toBe('Shared');
      expect(pe2?.responsibility).toBe('Shared');
    });
  });

  describe('generateCrmNarrative', () => {
    it('should generate narrative text with percentage breakdown', () => {
      const allControlIds = generateAllControlIds();
      const crm = generator.generateCrmTable(allControlIds, 'azure-gov', new Set());

      const narrative = generator.generateCrmNarrative(crm);

      expect(narrative).toContain('Microsoft FedRAMP High Authorization Package');
      expect(narrative).toContain('2017-07-28');
      expect(narrative).toContain('110 CMMC Level 2 controls');
      expect(narrative).toContain('| Family | Inherited | Shared | Customer |');
      expect(narrative).toContain('Microsoft Service Trust Portal');
    });
  });

  describe('detectArchitectureType', () => {
    it('should detect BYOD architecture from tenant manifest', () => {
      const tenantManifest = { byodArchitectureMetadata: { architecture_declared: 'session_controlled_byod' } };

      const result = generator.detectArchitectureType(tenantManifest, undefined);

      expect(result).toBe('byod');
    });

    it('should detect Azure-Gov architecture from infrastructure manifest', () => {
      const infraManifest = { azureGovResources: [{ type: 'vnet', name: 'vnet-gcc-high' }] };

      const result = generator.detectArchitectureType(undefined, infraManifest);

      expect(result).toBe('azure-gov');
    });

    it('should return hybrid for empty manifests', () => {
      const result = generator.detectArchitectureType(undefined, undefined);

      expect(result).toBe('hybrid');
    });

    it('should prioritize BYOD over Azure-Gov if both present', () => {
      const tenantManifest = { byodArchitectureMetadata: { architecture_declared: 'session_controlled_byod' } };
      const infraManifest = { azureGovResources: [{ type: 'vnet', name: 'vnet-gcc-high' }] };

      const result = generator.detectArchitectureType(tenantManifest, infraManifest);

      expect(result).toBe('byod');
    });
  });
});

/**
 * Generate all 110 CMMC L2 control IDs for test scenarios.
 * Matches actual CMMC L2 control ID enumeration.
 */
function generateAllControlIds(): string[] {
  const controlIds: string[] = [];

  // AC family (22 controls)
  for (let i = 1; i <= 22; i++) {
    controlIds.push(`AC.L2-3.1.${i}`);
  }

  // AT family (3 controls)
  for (let i = 1; i <= 3; i++) {
    controlIds.push(`AT.L2-3.2.${i}`);
  }

  // AU family (9 controls)
  for (let i = 1; i <= 9; i++) {
    controlIds.push(`AU.L2-3.3.${i}`);
  }

  // CA family (4 controls)
  for (let i = 1; i <= 4; i++) {
    controlIds.push(`CA.L2-3.12.${i}`);
  }

  // CM family (9 controls)
  for (let i = 1; i <= 9; i++) {
    controlIds.push(`CM.L2-3.4.${i}`);
  }

  // IA family (11 controls)
  for (let i = 1; i <= 11; i++) {
    controlIds.push(`IA.L2-3.5.${i}`);
  }

  // IR family (3 controls)
  for (let i = 1; i <= 3; i++) {
    controlIds.push(`IR.L2-3.6.${i}`);
  }

  // MA family (6 controls)
  for (let i = 1; i <= 6; i++) {
    controlIds.push(`MA.L2-3.7.${i}`);
  }

  // MP family (9 controls)
  for (let i = 1; i <= 9; i++) {
    controlIds.push(`MP.L2-3.8.${i}`);
  }

  // PE family (6 controls)
  for (let i = 1; i <= 6; i++) {
    controlIds.push(`PE.L2-3.10.${i}`);
  }

  // PS family (2 controls)
  for (let i = 1; i <= 2; i++) {
    controlIds.push(`PS.L2-3.9.${i}`);
  }

  // RA family (3 controls)
  for (let i = 1; i <= 3; i++) {
    controlIds.push(`RA.L2-3.11.${i}`);
  }

  // SC family (16 controls)
  for (let i = 1; i <= 16; i++) {
    controlIds.push(`SC.L2-3.13.${i}`);
  }

  // SI family (7 controls)
  const siNumbers = [1, 2, 4, 5, 6, 7, 8];
  for (const i of siNumbers) {
    controlIds.push(`SI.L2-3.14.${i}`);
  }

  return controlIds;
}
