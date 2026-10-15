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
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AdminOpsKnowledgeBankLoader } from '../AdminOpsKnowledgeBankLoader.js';
import { AdminOpsDataProvider } from '../AdminOpsDataProvider.js';

// Jest-compatible __dirname
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'adminops');
const REAL_KB_DIR = path.resolve(__dirname, '../../../../knowledge-banks/adminops');

describe('AdminOpsKnowledgeBankLoader', () => {
  let loader: AdminOpsKnowledgeBankLoader;

  beforeEach(() => {
    loader = new AdminOpsKnowledgeBankLoader(FIXTURES_DIR);
  });

  afterEach(() => {
    loader.clear();
  });

  describe('Test Case 1: Load Valid YAML Files and Index by controlId', () => {
    it('should load valid YAML files and index by primary controlId', () => {
      const loadedCount = loader.loadAdminOpsKnowledgeBanks();

      // Should load 2 valid files (test-valid-01.yaml, test-valid-02.yaml)
      // test-malformed.yaml should be skipped
      expect(loadedCount).toBeGreaterThanOrEqual(2);

      // Check primary controlId is indexed
      const allKBs = loader.getAllKnowledgeBanks();
      expect(allKBs.has('TEST.L2-1.1.1')).toBe(true);
      expect(allKBs.has('TEST.L2-2.2.1')).toBe(true);

      // Verify knowledge bank content
      const kb1 = loader.getKnowledgeBank('TEST.L2-1.1.1');
      expect(kb1).toBeDefined();
      expect(kb1?.useCaseId).toBe('TEST-01');
      expect(kb1?.useCaseTitle).toBe('Test Use Case One');
      expect(kb1?.sodTier).toBe('Tier 1 -- Test Tier');
    });
  });

  describe('Test Case 2: Handle YAML Parse Error Gracefully', () => {
    it('should skip malformed YAML files and log errors', () => {
      const loadedCount = loader.loadAdminOpsKnowledgeBanks();

      // Should load only valid files, skip malformed
      expect(loadedCount).toBeGreaterThanOrEqual(2);

      // Malformed file's control should not be indexed
      const kb3 = loader.getKnowledgeBank('TEST.L2-3.3.1');
      expect(kb3).toBeUndefined();

      // Verify error log was created
      const errorLogPath = path.resolve(__dirname, '../../../../logs/resolver-errors.log');
      expect(fs.existsSync(errorLogPath)).toBe(true);

      // Check error log contains YAML parse error message
      if (fs.existsSync(errorLogPath)) {
        const logContent = fs.readFileSync(errorLogPath, 'utf-8');
        expect(logContent).toContain('YAML parse error');
        expect(logContent).toContain('test-malformed.yaml');
      }
    });
  });

  describe('Test Case 3: Index Related Control IDs', () => {
    it('should index knowledge banks by relatedControlIds', () => {
      loader.loadAdminOpsKnowledgeBanks();

      const allKBs = loader.getAllKnowledgeBanks();

      // Primary controlId
      expect(allKBs.has('TEST.L2-1.1.1')).toBe(true);

      // Related controlIds from test-valid-01.yaml
      expect(allKBs.has('TEST.L2-1.1.2')).toBe(true);
      expect(allKBs.has('TEST.L2-1.1.3')).toBe(true);

      // All should point to same knowledge bank object
      const primary = allKBs.get('TEST.L2-1.1.1');
      const related1 = allKBs.get('TEST.L2-1.1.2');
      const related2 = allKBs.get('TEST.L2-1.1.3');

      expect(primary).toBe(related1);
      expect(primary).toBe(related2);
      expect(primary?.useCaseId).toBe('TEST-01');
    });
  });

  describe('Test Case 4: Return Undefined for Unknown Control ID', () => {
    it('should return undefined when control ID not found', () => {
      loader.loadAdminOpsKnowledgeBanks();

      const kb = loader.getKnowledgeBank('UNKNOWN.L2-9.9.9');
      expect(kb).toBeUndefined();
    });
  });

  describe('Test Case 5: Load Real Knowledge Banks from Production Directory', () => {
    it('should load real AdminOps knowledge banks from knowledge-banks/adminops/', () => {
      // Skip if real knowledge banks directory doesn't exist
      if (!fs.existsSync(REAL_KB_DIR)) {
        console.warn('Skipping real knowledge bank test: directory not found');
        return;
      }

      const realLoader = new AdminOpsKnowledgeBankLoader(REAL_KB_DIR);
      const loadedCount = realLoader.loadAdminOpsKnowledgeBanks();

      // Should load at least 85 knowledge banks (per Phase 01c validation)
      expect(loadedCount).toBeGreaterThanOrEqual(85);

      // Check specific real control from A-01-new-user-provisioning.yaml
      const kb = realLoader.getKnowledgeBank('AC.L2-3.1.1');
      expect(kb).toBeDefined();
      expect(kb?.useCaseId).toBe('A-01');
      expect(kb?.useCaseTitle).toBe('New User Provisioning');
      expect(kb?.domain).toBe('Identity & Access Management');
      expect(kb?.sodTier).toBe('Tier 2 -- Config Manager');

      // Verify relatedControlIds are indexed
      const relatedKb1 = realLoader.getKnowledgeBank('AC.L2-3.1.2');
      expect(relatedKb1).toBeDefined();
      expect(relatedKb1?.useCaseId).toBe('A-01');

      const relatedKb2 = realLoader.getKnowledgeBank('IA.L2-3.5.1');
      expect(relatedKb2).toBeDefined();
      expect(relatedKb2?.useCaseId).toBe('A-01');

      realLoader.clear();
    });
  });
});

describe('AdminOpsDataProvider', () => {
  let provider: AdminOpsDataProvider;

  beforeEach(() => {
    provider = new AdminOpsDataProvider(FIXTURES_DIR);
  });

  afterEach(() => {
    provider.clear();
  });

  describe('Handlebars Context Generation', () => {
    it('should build Handlebars context with all required variables', () => {
      provider.initialize();

      const context = provider.getByControlId('TEST.L2-1.1.1');
      expect(context).toBeDefined();

      // Verify all 18 AdminOps variables are present
      expect(context?.useCaseId).toBe('TEST-01');
      expect(context?.useCaseTitle).toBe('Test Use Case One');
      expect(context?.domain).toBe('Testing Domain');
      expect(context?.sodTier).toBe('Tier 1 -- Test Tier');
      expect(context?.entraRoles).toContain('Test Administrator');
      expect(context?.approvalRequired).toBe('true');
      expect(context?.portalPath).toBe('https://test.microsoft.us > Test > Path');
      expect(context?.powershellCmdlets).toContain('Test-MgCommand');
      expect(context?.graphApiEndpoint).toBe('POST https://graph.microsoft.us/v1.0/test');
      expect(context?.requiredPermissions).toBe('Test.ReadWrite.All');
      expect(context?.evidenceRetentionPeriod).toBe('365 days');
      expect(context?.evidenceStorageLocation).toContain('test-evidence-store');
      expect(context?.gccHighEndpoints).toContain('graph.microsoft.us');
      expect(context?.complianceBoundary).toBe('Test Boundary');
      expect(context?.relatedPolicies).toContain('TEST-001');
    });

    it('should return undefined for unknown control ID', () => {
      provider.initialize();

      const context = provider.getByControlId('UNKNOWN.L2-9.9.9');
      expect(context).toBeUndefined();
    });

    it('should throw error if getByControlId called before initialize', () => {
      expect(() => {
        provider.getByControlId('TEST.L2-1.1.1');
      }).toThrow('Must call initialize()');
    });
  });

  describe('PowerShell Cmdlet Formatting', () => {
    it('should format cmdlets with parameters as semicolon-separated string', () => {
      provider.initialize();

      const context = provider.getByControlId('TEST.L2-1.1.1');
      expect(context?.powershellCmdlets).toBe('Test-MgCommand -Parameter1 -Parameter2');
    });
  });

  describe('Portal Steps Extraction', () => {
    it('should extract portal navigation steps from portalPath', () => {
      provider.initialize();

      const context = provider.getByControlId('TEST.L2-1.1.1');
      expect(context?.portalSteps).toContain('Test');
      expect(context?.portalSteps).toContain('Path');
    });
  });
});
