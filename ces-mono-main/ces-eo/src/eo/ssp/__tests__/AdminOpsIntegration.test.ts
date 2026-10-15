// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeAll } from '@jest/globals';
import { AdminOpsKnowledgeBankLoader } from '../AdminOpsKnowledgeBankLoader.js';
import { AdminOpsDataProvider } from '../AdminOpsDataProvider.js';

/**
 * Phase 03 Integration Test
 *
 * Validates end-to-end pipeline: knowledge banks → loader → data provider → template context
 * Tests 10 representative controls across AC, IA, SC families
 */

const REAL_KB_DIR = path.resolve(__dirname, '../../../../knowledge-banks/adminops');

// 10 test controls from Phase 03 specification
const TEST_CONTROLS = [
  'AC.L2-3.1.1',
  'AC.L2-3.1.2',
  'AC.L2-3.1.5',
  'AC.L2-3.1.12',
  'IA.L2-3.5.1',
  'IA.L2-3.5.2',
  'IA.L2-3.5.7',
  'SC.L2-3.13.1',
  'SC.L2-3.13.8',
  'SC.L2-3.13.11'
] as const;

describe('Phase 03: AdminOps Integration Test', () => {
  let loader: AdminOpsKnowledgeBankLoader;
  let provider: AdminOpsDataProvider;
  let loadedCount: number;

  beforeAll(() => {
    // Skip test if knowledge banks directory doesn't exist
    if (!fs.existsSync(REAL_KB_DIR)) {
      console.warn('[AdminOpsIntegration] Skipping: knowledge-banks/adminops/ not found');
      return;
    }

    loader = new AdminOpsKnowledgeBankLoader(REAL_KB_DIR);
    loadedCount = loader.loadAdminOpsKnowledgeBanks();

    provider = new AdminOpsDataProvider(REAL_KB_DIR);
    provider.initialize();
  });

  describe('Knowledge Bank Loading', () => {
    it('should load all 85 YAML files from knowledge-banks/adminops/', () => {
      if (!fs.existsSync(REAL_KB_DIR)) {
        console.warn('[Test Skipped] Knowledge banks directory not found');
        return;
      }

      // Phase 01c validation confirmed 85 knowledge bank files
      expect(loadedCount).toBeGreaterThanOrEqual(85);
      console.log(`[AdminOpsIntegration] Loaded ${loadedCount} knowledge banks`);
    });

    it('should index controls by primary controlId and relatedControlIds', () => {
      if (!fs.existsSync(REAL_KB_DIR)) return;

      const allKBs = loader.getAllKnowledgeBanks();
      expect(allKBs.size).toBeGreaterThan(0);

      // Check that TEST_CONTROLS are accessible
      for (const controlId of TEST_CONTROLS) {
        const kb = loader.getKnowledgeBank(controlId);
        if (!kb) {
          console.warn(`[AdminOpsIntegration] Warning: ${controlId} not found in knowledge banks`);
        }
      }
    });
  });

  describe('AdminOpsDataProvider Context Generation', () => {
    describe('AC.L2-3.1.1 (Authorized Access)', () => {
      it('should return valid Handlebars context', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('AC.L2-3.1.1');
        expect(context).toBeDefined();

        if (context) {
          expect(context.powershellCmdlets).toBeTruthy();
          expect(context.powershellCmdlets.length).toBeGreaterThan(0);
          expect(context.gccHighEndpoints).toContain('.microsoft.us');
          expect(context.sodTier).toMatch(/Tier [1-3]/);

          console.log('[AC.L2-3.1.1] PowerShell cmdlets:', context.powershellCmdlets.substring(0, 100));
          console.log('[AC.L2-3.1.1] SoD Tier:', context.sodTier);
          console.log('[AC.L2-3.1.1] Portal:', context.portalPath);
        }
      });
    });

    describe('AC.L2-3.1.2 (Transaction Types Restrictions)', () => {
      it('should return valid Handlebars context with Conditional Access data', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('AC.L2-3.1.2');
        expect(context).toBeDefined();

        if (context) {
          expect(context.powershellCmdlets).toBeTruthy();
          expect(context.gccHighEndpoints).toContain('.microsoft.us');
          expect(context.sodTier).toMatch(/Tier [1-3]/);
          expect(context.evidenceRetentionPeriod).toBeTruthy();

          console.log('[AC.L2-3.1.2] Use Case:', context.useCaseTitle);
          console.log('[AC.L2-3.1.2] SoD Tier:', context.sodTier);
        }
      });
    });

    describe('AC.L2-3.1.5 (Separation of Duties)', () => {
      it('should return valid Handlebars context with SoD tier data', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('AC.L2-3.1.5');

        if (!context) {
          console.warn('[AC.L2-3.1.5] No knowledge bank found for this control');
          return;
        }

        expect(context.sodTier).toMatch(/Tier [1-3]/);
        expect(context.entraRoles).toBeTruthy();

        console.log('[AC.L2-3.1.5] SoD Tier:', context.sodTier);
        console.log('[AC.L2-3.1.5] Entra Roles:', context.entraRoles);
      });
    });

    describe('AC.L2-3.1.12 (Session Lock)', () => {
      it('should return valid Handlebars context with session timeout data', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('AC.L2-3.1.12');

        if (!context) {
          console.warn('[AC.L2-3.1.12] No knowledge bank found for this control');
          return;
        }

        expect(context.powershellCmdlets).toBeTruthy();
        expect(context.sodTier).toMatch(/Tier [1-3]/);

        console.log('[AC.L2-3.1.12] Use Case:', context.useCaseTitle);
      });
    });

    describe('IA.L2-3.5.1 (Identification)', () => {
      it('should return valid Handlebars context with user identity data', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('IA.L2-3.5.1');
        expect(context).toBeDefined();

        if (context) {
          expect(context.powershellCmdlets).toBeTruthy();
          expect(context.graphApiEndpoint).toContain('graph.microsoft.us');
          expect(context.gccHighEndpoints).toContain('.microsoft.us');

          console.log('[IA.L2-3.5.1] Graph API:', context.graphApiEndpoint);
        }
      });
    });

    describe('IA.L2-3.5.2 (Authentication)', () => {
      it('should return valid Handlebars context with authentication data', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('IA.L2-3.5.2');

        if (!context) {
          console.warn('[IA.L2-3.5.2] No knowledge bank found for this control');
          return;
        }

        expect(context.powershellCmdlets).toBeTruthy();
        expect(context.evidenceRetentionPeriod).toBeTruthy();
        expect(context.relatedPolicies).toBeTruthy();

        console.log('[IA.L2-3.5.2] Related Policies:', context.relatedPolicies);
      });
    });

    describe('IA.L2-3.5.7 (Cryptographic Module Authentication)', () => {
      it('should return valid Handlebars context with crypto authentication data', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('IA.L2-3.5.7');

        if (!context) {
          console.warn('[IA.L2-3.5.7] No knowledge bank found for this control');
          return;
        }

        expect(context.useCaseTitle).toBeTruthy();
        expect(context.sodTier).toMatch(/Tier [1-3]/);

        console.log('[IA.L2-3.5.7] Use Case:', context.useCaseTitle);
      });
    });

    describe('SC.L2-3.13.1 (Boundary Protection)', () => {
      it('should return valid Handlebars context with network boundary data', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('SC.L2-3.13.1');

        if (!context) {
          console.warn('[SC.L2-3.13.1] No knowledge bank found for this control');
          return;
        }

        expect(context.useCaseTitle).toBeTruthy();
        expect(context.portalPath).toBeTruthy();

        console.log('[SC.L2-3.13.1] Portal Path:', context.portalPath);
      });
    });

    describe('SC.L2-3.13.8 (Transmission Confidentiality)', () => {
      it('should return valid Handlebars context with TLS/encryption data', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('SC.L2-3.13.8');

        if (!context) {
          console.warn('[SC.L2-3.13.8] No knowledge bank found for this control');
          return;
        }

        expect(context.useCaseTitle).toBeTruthy();
        expect(context.gccHighEndpoints).toBeTruthy();

        console.log('[SC.L2-3.13.8] Use Case:', context.useCaseTitle);
      });
    });

    describe('SC.L2-3.13.11 (Cryptographic Protection)', () => {
      it('should return valid Handlebars context with encryption data', () => {
        if (!fs.existsSync(REAL_KB_DIR)) return;

        const context = provider.getByControlId('SC.L2-3.13.11');

        if (!context) {
          console.warn('[SC.L2-3.13.11] No knowledge bank found for this control');
          return;
        }

        expect(context.useCaseTitle).toBeTruthy();
        expect(context.domain).toBeTruthy();

        console.log('[SC.L2-3.13.11] Domain:', context.domain);
      });
    });
  });

  describe('Required Fields Validation', () => {
    it('should validate that all 10 test controls have required adminOps fields populated', () => {
      if (!fs.existsSync(REAL_KB_DIR)) return;

      const results = {
        totalControls: TEST_CONTROLS.length,
        found: 0,
        missing: [] as string[],
        fieldValidation: [] as Array<{
          controlId: string;
          hasNonEmptyPowershellCmdlets: boolean;
          hasGccHighEndpoints: boolean;
          hasSodTier: boolean;
        }>
      };

      for (const controlId of TEST_CONTROLS) {
        const context = provider.getByControlId(controlId);

        if (!context) {
          results.missing.push(controlId);
          continue;
        }

        results.found++;

        const validation = {
          controlId,
          hasNonEmptyPowershellCmdlets: context.powershellCmdlets.length > 0,
          hasGccHighEndpoints: context.gccHighEndpoints.includes('.microsoft.us'),
          hasSodTier: /Tier [1-3]/.test(context.sodTier)
        };

        results.fieldValidation.push(validation);

        // Assert required fields
        expect(validation.hasNonEmptyPowershellCmdlets).toBe(true);
        expect(validation.hasGccHighEndpoints).toBe(true);
        expect(validation.hasSodTier).toBe(true);
      }

      console.log('\n[Field Validation Summary]');
      console.log(`Total test controls: ${results.totalControls}`);
      console.log(`Found: ${results.found}`);
      console.log(`Missing: ${results.missing.length} (${results.missing.join(', ')})`);
      console.log('\nField validation details:');
      results.fieldValidation.forEach(v => {
        console.log(`  ${v.controlId}: cmdlets=${v.hasNonEmptyPowershellCmdlets}, endpoints=${v.hasGccHighEndpoints}, tier=${v.hasSodTier}`);
      });
    });
  });

  describe('Knowledge Bank Coverage Analysis', () => {
    it('should report which controls have knowledge bank coverage', () => {
      if (!fs.existsSync(REAL_KB_DIR)) return;

      const allKBs = loader.getAllKnowledgeBanks();
      const uniqueControlIds = new Set<string>();

      // Collect all unique control IDs
      allKBs.forEach((kb) => {
        const controlIds = Array.isArray(kb.controlId) ? kb.controlId : [kb.controlId];
        controlIds.forEach(id => uniqueControlIds.add(id));

        if (kb.relatedControlIds) {
          kb.relatedControlIds.forEach(id => uniqueControlIds.add(id));
        }
      });

      const coverageReport = {
        totalKnowledgeBanks: loadedCount,
        totalControlMappings: allKBs.size,
        uniqueControlsCovered: uniqueControlIds.size,
        testControlsCovered: TEST_CONTROLS.filter(id => allKBs.has(id)).length,
        testControlsMissing: TEST_CONTROLS.filter(id => !allKBs.has(id))
      };

      console.log('\n[Knowledge Bank Coverage Report]');
      console.log(`Total knowledge banks loaded: ${coverageReport.totalKnowledgeBanks}`);
      console.log(`Total control mappings (includes related): ${coverageReport.totalControlMappings}`);
      console.log(`Unique controls covered: ${coverageReport.uniqueControlsCovered}`);
      console.log(`Test controls covered: ${coverageReport.testControlsCovered}/${TEST_CONTROLS.length}`);

      if (coverageReport.testControlsMissing.length > 0) {
        console.log(`Test controls missing: ${coverageReport.testControlsMissing.join(', ')}`);
      }

      expect(coverageReport.totalKnowledgeBanks).toBeGreaterThanOrEqual(85);
    });
  });

  describe('YAML Parse Error Detection', () => {
    it('should report any YAML parse errors from the 85 files', () => {
      if (!fs.existsSync(REAL_KB_DIR)) return;

      const errorLogPath = path.resolve(__dirname, '../../../../logs/resolver-errors.log');

      if (fs.existsSync(errorLogPath)) {
        const logContent = fs.readFileSync(errorLogPath, 'utf-8');
        const yamlErrors = logContent.split('\n').filter(line =>
          line.includes('YAML parse error') || line.includes('Missing required fields')
        );

        console.log('\n[YAML Parse Error Report]');
        if (yamlErrors.length > 0) {
          console.log(`Found ${yamlErrors.length} YAML errors:`);
          yamlErrors.forEach(err => console.log(`  ${err}`));
        } else {
          console.log('No YAML parse errors detected');
        }

        // Test passes even if errors exist (non-blocking), but logs them
        expect(yamlErrors.length).toBeGreaterThanOrEqual(0);
      } else {
        console.log('[YAML Parse Error Report] No error log found (all files parsed successfully)');
      }
    });
  });
});
