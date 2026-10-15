// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach } from '@jest/globals';
import { AssetCategorizationEngine, type Asset } from '../AssetCategorizationEngine.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('AssetCategorizationEngine', () => {
  let engine: AssetCategorizationEngine;
  let tempDecisionsPath: string;

  beforeEach(() => {
    // Use temp directory for test decisions file
    tempDecisionsPath = path.join(os.tmpdir(), `asset-categorization-test-${Date.now()}.json`);
    engine = new AssetCategorizationEngine(tempDecisionsPath);
  });

  describe('Rule 1: Azure AD / Entra ID → SPA', () => {
    it('should categorize Azure AD as SECURITY_PROTECTION_ASSET', () => {
      const asset: Asset = {
        id: 'azuread-001',
        name: 'Azure AD Premium P2',
        type: 'service',
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('SECURITY_PROTECTION_ASSET');
      expect(result.matchedRule).toBe('Azure AD / Entra ID Service');
      expect(result.rationale).toContain('authentication/authorization');
    });

    it('should categorize Entra ID as SECURITY_PROTECTION_ASSET', () => {
      const asset: Asset = {
        id: 'entraid-001',
        name: 'Microsoft Entra ID',
        type: 'service',
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('SECURITY_PROTECTION_ASSET');
      expect(result.matchedRule).toBe('Azure AD / Entra ID Service');
    });
  });

  describe('Rule 2: OneDrive/SharePoint with CUI labels → CUI_ASSET', () => {
    it('should categorize OneDrive with CUI labels as CUI_ASSET', () => {
      const asset: Asset = {
        id: 'onedrive-001',
        name: 'OneDrive for Business',
        type: 'OneDrive',
        cuiLabelsConfigured: true,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('CUI_ASSET');
      expect(result.matchedRule).toBe('OneDrive/SharePoint with CUI Labels');
      expect(result.rationale).toContain('sensitivity labels');
    });

    it('should categorize SharePoint with CUI labels as CUI_ASSET', () => {
      const asset: Asset = {
        id: 'sharepoint-001',
        name: 'SharePoint Online Site Collection',
        type: 'SharePoint',
        cuiLabelsConfigured: true,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('CUI_ASSET');
      expect(result.matchedRule).toBe('OneDrive/SharePoint with CUI Labels');
    });

    it('should NOT categorize OneDrive without CUI labels as CUI_ASSET', () => {
      const asset: Asset = {
        id: 'onedrive-002',
        name: 'OneDrive for Business',
        type: 'OneDrive',
        cuiLabelsConfigured: false,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).not.toBe('CUI_ASSET');
      expect(result.category).toBe('REQUIRES_OPERATOR_REVIEW');
    });
  });

  describe('Rule 3: Exchange Online with retention → CUI_ASSET', () => {
    it('should categorize Exchange mailbox with retention as CUI_ASSET', () => {
      const asset: Asset = {
        id: 'exchange-001',
        name: 'Exchange Online Mailbox Pool',
        type: 'Exchange',
        retentionPolicyConfigured: true,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('CUI_ASSET');
      expect(result.matchedRule).toBe('Exchange Online Mailboxes with CUI Retention');
      expect(result.rationale).toContain('retention policies');
    });
  });

  describe('Rule 4: Microsoft Defender → SPA', () => {
    it('should categorize Defender for Endpoint as SECURITY_PROTECTION_ASSET', () => {
      const asset: Asset = {
        id: 'defender-001',
        name: 'Microsoft Defender for Endpoint',
        type: 'service',
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('SECURITY_PROTECTION_ASSET');
      expect(result.matchedRule).toBe('Microsoft Defender for Endpoint');
      expect(result.rationale).toContain('Endpoint protection');
    });
  });

  describe('Rule 5: Microsoft Sentinel → SPA', () => {
    it('should categorize Sentinel as SECURITY_PROTECTION_ASSET', () => {
      const asset: Asset = {
        id: 'sentinel-001',
        name: 'Microsoft Sentinel Workspace',
        type: 'service',
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('SECURITY_PROTECTION_ASSET');
      expect(result.matchedRule).toBe('Microsoft Sentinel SIEM');
      expect(result.rationale).toContain('SIEM');
    });
  });

  describe('Rule 6: Intune-managed endpoints → CRMA', () => {
    it('should categorize Intune-managed laptop as CONTRACTOR_RISK_MANAGED_ASSET', () => {
      const asset: Asset = {
        id: 'laptop-001',
        name: 'Corporate Laptop',
        type: 'laptop',
        intuneManaged: true,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('CONTRACTOR_RISK_MANAGED_ASSET');
      expect(result.matchedRule).toBe('Intune-Managed Endpoints');
      expect(result.rationale).toContain('Intune management');
    });

    it('should categorize Intune-managed desktop as CONTRACTOR_RISK_MANAGED_ASSET', () => {
      const asset: Asset = {
        id: 'desktop-001',
        name: 'Office Desktop',
        type: 'desktop',
        intuneManaged: true,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('CONTRACTOR_RISK_MANAGED_ASSET');
      expect(result.matchedRule).toBe('Intune-Managed Endpoints');
    });
  });

  describe('Rule 7: Network-isolated printers → OUT_OF_SCOPE', () => {
    it('should categorize network-isolated printer as OUT_OF_SCOPE', () => {
      const asset: Asset = {
        id: 'printer-001',
        name: 'Office Printer',
        type: 'printer',
        networkIsolated: true,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('OUT_OF_SCOPE');
      expect(result.matchedRule).toBe('Network-Isolated Printers/Scanners');
      expect(result.rationale).toContain('Network-isolated');
    });

    it('should categorize network-isolated scanner as OUT_OF_SCOPE', () => {
      const asset: Asset = {
        id: 'scanner-001',
        name: 'Document Scanner',
        type: 'scanner',
        networkIsolated: true,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('OUT_OF_SCOPE');
      expect(result.matchedRule).toBe('Network-Isolated Printers/Scanners');
    });
  });

  describe('Rule 8: IoT/building systems → SPECIALIZED_ASSET', () => {
    it('should categorize IoT device as SPECIALIZED_ASSET', () => {
      const asset: Asset = {
        id: 'iot-001',
        name: 'IoT Sensor',
        type: 'iot',
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('SPECIALIZED_ASSET');
      expect(result.matchedRule).toBe('IoT and Building Systems');
      expect(result.rationale).toContain('Operational technology');
    });

    it('should categorize HVAC system as SPECIALIZED_ASSET', () => {
      const asset: Asset = {
        id: 'hvac-001',
        name: 'Building HVAC Controller',
        type: 'hvac_controller',
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('SPECIALIZED_ASSET');
      expect(result.matchedRule).toBe('IoT and Building Systems');
    });

    it('should categorize badge reader as SPECIALIZED_ASSET', () => {
      const asset: Asset = {
        id: 'badge-001',
        name: 'Door Badge Reader',
        type: 'badge_reader',
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('SPECIALIZED_ASSET');
      expect(result.matchedRule).toBe('IoT and Building Systems');
    });
  });

  describe('Rule 9: Azure Key Vault → SPA', () => {
    it('should categorize Key Vault as SECURITY_PROTECTION_ASSET', () => {
      const asset: Asset = {
        id: 'keyvault-001',
        name: 'Azure Key Vault',
        type: 'KeyVault',
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('SECURITY_PROTECTION_ASSET');
      expect(result.matchedRule).toBe('Azure Key Vault');
      expect(result.rationale).toContain('Secrets management');
    });
  });

  describe('Rule 10: BYOD with MAM → CRMA', () => {
    it('should categorize BYOD with containerization as CONTRACTOR_RISK_MANAGED_ASSET', () => {
      const asset: Asset = {
        id: 'mobile-001',
        name: 'Personal iPhone with Intune MAM',
        type: 'mobile',
        byodContainerized: true,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('CONTRACTOR_RISK_MANAGED_ASSET');
      expect(result.matchedRule).toBe('BYOD with Intune MAM');
      expect(result.rationale).toContain('Mobile Application Management');
    });

    it('should NOT categorize BYOD without containerization as CRMA', () => {
      const asset: Asset = {
        id: 'mobile-002',
        name: 'Personal Android without MAM',
        type: 'mobile',
        byodContainerized: false,
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).not.toBe('CONTRACTOR_RISK_MANAGED_ASSET');
      expect(result.category).toBe('REQUIRES_OPERATOR_REVIEW');
    });
  });

  describe('Ambiguous assets', () => {
    it('should return REQUIRES_OPERATOR_REVIEW for assets with no matching rules', () => {
      const asset: Asset = {
        id: 'unknown-001',
        name: 'Unknown System',
        type: 'unknown',
      };

      const result = engine.categorizeAsset(asset);

      expect(result.category).toBe('REQUIRES_OPERATOR_REVIEW');
      expect(result.rationale).toContain('No matching categorization rule');
    });
  });

  describe('Batch categorization', () => {
    it('should categorize all assets and return summary counts', async () => {
      const assets: Asset[] = [
        { id: '1', name: 'Azure AD', type: 'service' },
        { id: '2', name: 'OneDrive with CUI', type: 'OneDrive', cuiLabelsConfigured: true },
        { id: '3', name: 'Laptop', type: 'laptop', intuneManaged: true },
        { id: '4', name: 'Printer', type: 'printer', networkIsolated: true },
        { id: '5', name: 'IoT Device', type: 'iot' },
      ];

      const result = await engine.categorizeAllAssets(assets, false);

      expect(result.categorized.length).toBe(5);
      expect(result.uncategorizedCount).toBe(0);
      expect(result.summaryByCategory.SECURITY_PROTECTION_ASSET).toBe(1);
      expect(result.summaryByCategory.CUI_ASSET).toBe(1);
      expect(result.summaryByCategory.CONTRACTOR_RISK_MANAGED_ASSET).toBe(1);
      expect(result.summaryByCategory.OUT_OF_SCOPE).toBe(1);
      expect(result.summaryByCategory.SPECIALIZED_ASSET).toBe(1);
    });

    it('should count uncategorized assets correctly', async () => {
      const assets: Asset[] = [
        { id: '1', name: 'Unknown', type: 'unknown' },
        { id: '2', name: 'Azure AD', type: 'service' },
      ];

      const result = await engine.categorizeAllAssets(assets, false);

      expect(result.categorized.length).toBe(2);
      expect(result.uncategorizedCount).toBe(1);
      expect(result.summaryByCategory.REQUIRES_OPERATOR_REVIEW).toBe(1);
    });
  });

  describe('Inventory table generation', () => {
    it('should generate 5-category inventory table', () => {
      const assets: Asset[] = [
        { id: '1', name: 'Azure AD', type: 'service', assetCategory: 'SECURITY_PROTECTION_ASSET' },
        { id: '2', name: 'OneDrive', type: 'OneDrive', assetCategory: 'CUI_ASSET' },
        { id: '3', name: 'Laptop', type: 'laptop', assetCategory: 'CONTRACTOR_RISK_MANAGED_ASSET' },
      ];

      const inventory = engine.generateInventoryTable(assets);

      expect(inventory.SECURITY_PROTECTION_ASSET.length).toBe(1);
      expect(inventory.CUI_ASSET.length).toBe(1);
      expect(inventory.CONTRACTOR_RISK_MANAGED_ASSET.length).toBe(1);
      expect(inventory.OUT_OF_SCOPE.length).toBe(0);
      expect(inventory.SPECIALIZED_ASSET.length).toBe(0);
    });
  });

  describe('Manual decisions', () => {
    it('should save and load manual categorization decisions', async () => {
      // Manually create a decision
      const decisions = [
        {
          assetId: 'manual-001',
          assetName: 'Manual Asset',
          assetType: 'custom',
          selectedCategory: 'CUI_ASSET' as const,
          rationale: 'Operator determined this is CUI',
          operator: 'test-user',
          timestamp: new Date().toISOString(),
        },
      ];

      fs.writeFileSync(tempDecisionsPath, JSON.stringify({ decisions }, null, 2));

      // Create new engine instance to load decisions
      const newEngine = new AssetCategorizationEngine(tempDecisionsPath);

      const asset: Asset = {
        id: 'manual-001',
        name: 'Manual Asset',
        type: 'custom',
      };

      const result = newEngine.categorizeAsset(asset);

      expect(result.category).toBe('CUI_ASSET');
      expect(result.matchedRule).toBe('Manual Decision');
      expect(result.rationale).toContain('Manual categorization');

      // Cleanup
      fs.unlinkSync(tempDecisionsPath);
    });

    it('should retrieve all saved decisions', () => {
      const decisions = engine.getDecisions();
      expect(Array.isArray(decisions)).toBe(true);
    });
  });

  describe('Integration test: 50-asset test case', () => {
    it('should categorize 50 diverse assets with >80% automation', async () => {
      const assets: Asset[] = [
        // 10 Azure AD/Defender services (SPA)
        { id: 's1', name: 'Azure AD Premium', type: 'service' },
        { id: 's2', name: 'Microsoft Defender for Endpoint', type: 'service' },
        { id: 's3', name: 'Microsoft Sentinel', type: 'service' },
        { id: 's4', name: 'Azure Key Vault', type: 'KeyVault' },
        { id: 's5', name: 'Defender for Cloud', type: 'service' },
        { id: 's6', name: 'Entra ID', type: 'service' },
        { id: 's7', name: 'Defender ATP', type: 'service' },
        { id: 's8', name: 'Sentinel SIEM', type: 'service' },
        { id: 's9', name: 'Key Vault Prod', type: 'KeyVault' },
        { id: 's10', name: 'Defender for Identity', type: 'service' },

        // 10 OneDrive/SharePoint with CUI (CUI_ASSET)
        { id: 'c1', name: 'OneDrive CUI Store', type: 'OneDrive', cuiLabelsConfigured: true },
        { id: 'c2', name: 'SharePoint CUI Site', type: 'SharePoint', cuiLabelsConfigured: true },
        { id: 'c3', name: 'OneDrive Contracts', type: 'OneDrive', cuiLabelsConfigured: true },
        { id: 'c4', name: 'SharePoint Legal', type: 'SharePoint', cuiLabelsConfigured: true },
        { id: 'c5', name: 'OneDrive HR Files', type: 'OneDrive', cuiLabelsConfigured: true },
        { id: 'c6', name: 'SharePoint Engineering', type: 'SharePoint', cuiLabelsConfigured: true },
        { id: 'c7', name: 'Exchange Mailbox Pool', type: 'Exchange', retentionPolicyConfigured: true },
        { id: 'c8', name: 'OneDrive Finance', type: 'OneDrive', cuiLabelsConfigured: true },
        { id: 'c9', name: 'SharePoint R&D', type: 'SharePoint', cuiLabelsConfigured: true },
        { id: 'c10', name: 'Exchange Archive', type: 'Exchange', retentionPolicyConfigured: true },

        // 10 Intune-managed laptops (CRMA)
        { id: 'l1', name: 'Laptop-001', type: 'laptop', intuneManaged: true },
        { id: 'l2', name: 'Laptop-002', type: 'laptop', intuneManaged: true },
        { id: 'l3', name: 'Desktop-001', type: 'desktop', intuneManaged: true },
        { id: 'l4', name: 'Laptop-003', type: 'laptop', intuneManaged: true },
        { id: 'l5', name: 'Desktop-002', type: 'desktop', intuneManaged: true },
        { id: 'l6', name: 'Mobile-MAM', type: 'mobile', byodContainerized: true },
        { id: 'l7', name: 'Laptop-004', type: 'laptop', intuneManaged: true },
        { id: 'l8', name: 'Desktop-003', type: 'desktop', intuneManaged: true },
        { id: 'l9', name: 'Laptop-005', type: 'laptop', intuneManaged: true },
        { id: 'l10', name: 'Desktop-004', type: 'desktop', intuneManaged: true },

        // 5 network-isolated printers (OUT_OF_SCOPE)
        { id: 'p1', name: 'Printer-Warehouse', type: 'printer', networkIsolated: true },
        { id: 'p2', name: 'Scanner-Reception', type: 'scanner', networkIsolated: true },
        { id: 'p3', name: 'Printer-Lab', type: 'printer', networkIsolated: true },
        { id: 'p4', name: 'Scanner-Office', type: 'scanner', networkIsolated: true },
        { id: 'p5', name: 'Printer-Shop', type: 'printer', networkIsolated: true },

        // 5 IoT/specialized (SPECIALIZED_ASSET)
        { id: 'i1', name: 'Badge Reader 1', type: 'badge_reader' },
        { id: 'i2', name: 'HVAC Controller', type: 'hvac_system' },
        { id: 'i3', name: 'IoT Sensor', type: 'iot' },
        { id: 'i4', name: 'Building System', type: 'building_system' },
        { id: 'i5', name: 'Badge Reader 2', type: 'badge_access' },

        // 10 ambiguous assets (REQUIRES_OPERATOR_REVIEW)
        { id: 'a1', name: 'VM-APP-PROD-001', type: 'vm' },
        { id: 'a2', name: 'Database-01', type: 'database' },
        { id: 'a3', name: 'Storage Account', type: 'storage' },
        { id: 'a4', name: 'Network Gateway', type: 'network' },
        { id: 'a5', name: 'Load Balancer', type: 'network' },
        { id: 'a6', name: 'API Server', type: 'server' },
        { id: 'a7', name: 'Web App', type: 'webapp' },
        { id: 'a8', name: 'Function App', type: 'function' },
        { id: 'a9', name: 'Container Registry', type: 'container' },
        { id: 'a10', name: 'DNS Zone', type: 'dns' },
      ];

      const result = await engine.categorizeAllAssets(assets, false);

      expect(result.categorized.length).toBe(50);

      // Verify 40 assets categorized automatically (80%)
      const automaticallyCategorized = 50 - result.uncategorizedCount;
      expect(automaticallyCategorized).toBe(40);
      expect(result.uncategorizedCount).toBe(10);

      // Verify summary counts
      expect(result.summaryByCategory.SECURITY_PROTECTION_ASSET).toBe(10);
      expect(result.summaryByCategory.CUI_ASSET).toBe(10);
      expect(result.summaryByCategory.CONTRACTOR_RISK_MANAGED_ASSET).toBe(10);
      expect(result.summaryByCategory.OUT_OF_SCOPE).toBe(5);
      expect(result.summaryByCategory.SPECIALIZED_ASSET).toBe(5);
      expect(result.summaryByCategory.REQUIRES_OPERATOR_REVIEW).toBe(10);

      // Coverage should be 80%
      const coverage = (automaticallyCategorized / 50) * 100;
      expect(coverage).toBe(80);
    });
  });
});
