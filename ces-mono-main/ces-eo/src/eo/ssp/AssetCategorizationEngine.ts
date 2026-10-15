// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeJsonArtifact } from 'ces-shared/persistence/files';

const DEFAULT_DECISIONS_PATH = path.resolve(process.cwd(), 'data/asset-categorization-decisions.json');

export type AssetCategory = 'CUI_ASSET' | 'SECURITY_PROTECTION_ASSET' | 'CONTRACTOR_RISK_MANAGED_ASSET' | 'SPECIALIZED_ASSET' | 'OUT_OF_SCOPE' | 'REQUIRES_OPERATOR_REVIEW';

export interface Asset {
  id: string;
  name: string;
  type: string;
  description?: string;
  owner?: string;
  assetCategory?: AssetCategory;
  // Categorization metadata
  cuiLabelsConfigured?: boolean;
  networkIsolated?: boolean;
  byodContainerized?: boolean;
  productionTag?: boolean;
  intuneManaged?: boolean;
  retentionPolicyConfigured?: boolean;
  supportsCuiAssets?: boolean;
  environment?: string;
}

export interface CategorizationRule {
  name: string;
  detect: (asset: Asset) => boolean;
  category: AssetCategory;
  rationale: string;
}

export interface CategorizationResult {
  category: AssetCategory;
  rationale: string;
  matchedRule?: string;
}

export interface CategorizationDecision {
  assetId: string;
  assetName: string;
  assetType: string;
  selectedCategory: AssetCategory;
  rationale: string;
  operator: string;
  timestamp: string;
}

export interface BatchCategorizationResult {
  categorized: Asset[];
  uncategorizedCount: number;
  summaryByCategory: Record<AssetCategory, number>;
}

/**
 * AssetCategorizationEngine: 5-category CMMC asset classifier
 *
 * Implements 10 rule-based detection rules to automatically categorize assets into:
 * - CUI_ASSET: Assets storing/processing/transmitting CUI
 * - SECURITY_PROTECTION_ASSET: Security function assets (do not process CUI)
 * - CONTRACTOR_RISK_MANAGED_ASSET: Standard endpoints/infrastructure supporting CUI access
 * - SPECIALIZED_ASSET: IoT, OT, unique systems
 * - OUT_OF_SCOPE: Assets outside CUI boundary
 *
 * For ambiguous assets (no rule match), returns REQUIRES_OPERATOR_REVIEW category
 * and optionally prompts operator for manual categorization.
 */
export class AssetCategorizationEngine {
  private rules!: CategorizationRule[];
  private decisions: CategorizationDecision[] = [];
  private decisionsPath: string;

  constructor(decisionsPath?: string) {
    this.decisionsPath = decisionsPath ?? DEFAULT_DECISIONS_PATH;
    this.loadDecisions();
    this.initializeRules();
  }

  /**
   * Initialize 10 rule-based detection rules.
   * Rules are evaluated in order; first matching rule wins.
   */
  private initializeRules(): void {
    this.rules = [
      // Rule 1: Azure AD / Entra ID → SPA
      {
        name: 'Azure AD / Entra ID Service',
        detect: (asset) =>
          asset.type === 'service' &&
          (asset.name.toLowerCase().includes('azure ad') ||
            asset.name.toLowerCase().includes('entra id')),
        category: 'SECURITY_PROTECTION_ASSET',
        rationale: 'Provides authentication/authorization security functions. Does not process CUI directly.',
      },

      // Rule 2: OneDrive/SharePoint with CUI sensitivity labels → CUI_ASSET
      {
        name: 'OneDrive/SharePoint with CUI Labels',
        detect: (asset) =>
          (asset.type.toLowerCase() === 'onedrive' || asset.type.toLowerCase() === 'sharepoint') &&
          asset.cuiLabelsConfigured === true,
        category: 'CUI_ASSET',
        rationale: 'Stores CUI documents with sensitivity labels applied.',
      },

      // Rule 3: Exchange Online mailboxes receiving CUI → CUI_ASSET
      {
        name: 'Exchange Online Mailboxes with CUI Retention',
        detect: (asset) =>
          asset.type.toLowerCase() === 'exchange' && asset.retentionPolicyConfigured === true,
        category: 'CUI_ASSET',
        rationale: 'Processes CUI emails with retention policies configured.',
      },

      // Rule 4: Microsoft Defender for Endpoint → SPA
      {
        name: 'Microsoft Defender for Endpoint',
        detect: (asset) =>
          asset.type === 'service' &&
          (asset.name.toLowerCase().includes('defender') ||
            asset.name.toLowerCase().includes('defender for endpoint')),
        category: 'SECURITY_PROTECTION_ASSET',
        rationale: 'Endpoint protection security function. Does not process CUI.',
      },

      // Rule 5: Microsoft Sentinel → SPA
      {
        name: 'Microsoft Sentinel SIEM',
        detect: (asset) =>
          asset.type === 'service' && asset.name.toLowerCase().includes('sentinel'),
        category: 'SECURITY_PROTECTION_ASSET',
        rationale: 'Security monitoring/SIEM function. Does not process CUI.',
      },

      // Rule 6: Intune/MEM managed devices → CONTRACTOR_RISK_MANAGED_ASSET (default) or CUI_ASSET (if CUI processing confirmed)
      {
        name: 'Intune-Managed Endpoints',
        detect: (asset) =>
          (asset.type.toLowerCase() === 'laptop' || asset.type.toLowerCase() === 'desktop') &&
          asset.intuneManaged === true,
        category: 'CONTRACTOR_RISK_MANAGED_ASSET',
        rationale: 'Endpoints capable of accessing CUI via Intune management.',
      },

      // Rule 7: Printers/scanners without network access to CUI systems → OUT_OF_SCOPE
      {
        name: 'Network-Isolated Printers/Scanners',
        detect: (asset) =>
          (asset.type.toLowerCase() === 'printer' || asset.type.toLowerCase() === 'scanner') &&
          asset.networkIsolated === true,
        category: 'OUT_OF_SCOPE',
        rationale: 'Network-isolated device without access to CUI systems.',
      },

      // Rule 8: IoT devices/building systems → SPECIALIZED_ASSET
      {
        name: 'IoT and Building Systems',
        detect: (asset) =>
          asset.type.toLowerCase() === 'iot' ||
          asset.type.toLowerCase() === 'building_system' ||
          asset.type.toLowerCase().includes('hvac') ||
          asset.type.toLowerCase().includes('badge'),
        category: 'SPECIALIZED_ASSET',
        rationale: 'Operational technology or IoT device requiring specialized handling.',
      },

      // Rule 9: Azure Key Vault → SPA
      {
        name: 'Azure Key Vault',
        detect: (asset) =>
          asset.type.toLowerCase() === 'keyvault' ||
          asset.name.toLowerCase().includes('key vault'),
        category: 'SECURITY_PROTECTION_ASSET',
        rationale: 'Secrets management supporting CUI protection. Does not store CUI directly.',
      },

      // Rule 10: Personal BYOD devices with MAM → CONTRACTOR_RISK_MANAGED_ASSET
      {
        name: 'BYOD with Intune MAM',
        detect: (asset) =>
          asset.type.toLowerCase() === 'mobile' && asset.byodContainerized === true,
        category: 'CONTRACTOR_RISK_MANAGED_ASSET',
        rationale: 'BYOD mobile device with Intune Mobile Application Management containerization.',
      },
    ];
  }

  /**
   * Load saved operator decisions from disk.
   */
  private loadDecisions(): void {
    if (fs.existsSync(this.decisionsPath)) {
      try {
        const data = fs.readFileSync(this.decisionsPath, 'utf-8');
        const parsed = JSON.parse(data);
        this.decisions = parsed.decisions || [];
      } catch (error) {
        console.warn(`[AssetCategorizationEngine] Failed to load decisions from ${this.decisionsPath}:`, error);
        this.decisions = [];
      }
    }
  }

  /**
   * Save operator decisions to disk for audit trail.
   */
  private saveDecisions(): void {
    try {
      const dir = path.dirname(this.decisionsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      writeJsonArtifact(this.decisionsPath, { decisions: this.decisions }, { pretty: true });
    } catch (error) {
      console.error(`[AssetCategorizationEngine] Failed to save decisions to ${this.decisionsPath}:`, error);
    }
  }

  /**
   * Categorize a single asset using rule-based detection.
   * Returns category, rationale, and matched rule name (if any).
   */
  public categorizeAsset(asset: Asset): CategorizationResult {
    // Check if already categorized manually
    const existingDecision = this.decisions.find((d) => d.assetId === asset.id);
    if (existingDecision) {
      return {
        category: existingDecision.selectedCategory,
        rationale: `Manual categorization: ${existingDecision.rationale}`,
        matchedRule: 'Manual Decision',
      };
    }

    // Apply rules in order
    for (const rule of this.rules) {
      if (rule.detect(asset)) {
        return {
          category: rule.category,
          rationale: rule.rationale,
          matchedRule: rule.name,
        };
      }
    }

    // No matching rule — requires operator review
    return {
      category: 'REQUIRES_OPERATOR_REVIEW',
      rationale: 'No matching categorization rule found. Manual review required.',
    };
  }

  /**
   * Prompt operator to manually categorize an asset via CLI.
   * Returns selected category.
   */
  public async promptOperatorForCategory(asset: Asset): Promise<AssetCategory> {
    console.log(`\nAsset [${asset.name}] could not be automatically categorized.\n`);
    console.log('Asset Details:');
    console.log(`  Name: ${asset.name}`);
    console.log(`  Type: ${asset.type}`);
    console.log(`  Description: ${asset.description || 'N/A'}`);
    console.log(`  Owner: ${asset.owner || 'N/A'}`);
    console.log('\nSelect Category:');
    console.log('  1. CUI Asset');
    console.log('  2. Security Protection Asset (SPA)');
    console.log('  3. Contractor Risk Managed Asset (CRMA)');
    console.log('  4. Specialized Asset');
    console.log('  5. Out-of-Scope');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const choice = await new Promise<string>((resolve) => {
      rl.question('\nEnter choice [1-5]: ', resolve);
    });

    const rationale = await new Promise<string>((resolve) => {
      rl.question('Rationale (optional): ', resolve);
    });

    rl.close();

    const categoryMap: Record<string, AssetCategory> = {
      '1': 'CUI_ASSET',
      '2': 'SECURITY_PROTECTION_ASSET',
      '3': 'CONTRACTOR_RISK_MANAGED_ASSET',
      '4': 'SPECIALIZED_ASSET',
      '5': 'OUT_OF_SCOPE',
    };

    const selectedCategory = categoryMap[choice] || 'REQUIRES_OPERATOR_REVIEW';

    // Save decision for future runs
    this.decisions.push({
      assetId: asset.id,
      assetName: asset.name,
      assetType: asset.type,
      selectedCategory,
      rationale,
      operator: process.env.USER || 'unknown',
      timestamp: new Date().toISOString(),
    });

    this.saveDecisions();

    return selectedCategory;
  }

  /**
   * Categorize all assets in batch. Optionally prompt operator for ambiguous assets.
   *
   * @param assets Array of assets to categorize
   * @param interactiveMode If true, prompt operator for REQUIRES_OPERATOR_REVIEW assets
   * @returns Categorized assets, uncategorized count, and summary by category
   */
  public async categorizeAllAssets(
    assets: Asset[],
    interactiveMode: boolean = false
  ): Promise<BatchCategorizationResult> {
    const categorized: Asset[] = [];
    let uncategorizedCount = 0;
    const summaryByCategory: Record<AssetCategory, number> = {
      CUI_ASSET: 0,
      SECURITY_PROTECTION_ASSET: 0,
      CONTRACTOR_RISK_MANAGED_ASSET: 0,
      SPECIALIZED_ASSET: 0,
      OUT_OF_SCOPE: 0,
      REQUIRES_OPERATOR_REVIEW: 0,
    };

    for (const asset of assets) {
      const result = this.categorizeAsset(asset);

      if (result.category === 'REQUIRES_OPERATOR_REVIEW' && interactiveMode) {
        // Prompt operator for manual categorization
        const manualCategory = await this.promptOperatorForCategory(asset);
        asset.assetCategory = manualCategory;
      } else {
        asset.assetCategory = result.category;
      }

      if (asset.assetCategory === 'REQUIRES_OPERATOR_REVIEW') {
        uncategorizedCount++;
      }

      summaryByCategory[asset.assetCategory]++;
      categorized.push(asset);
    }

    return { categorized, uncategorizedCount, summaryByCategory };
  }

  /**
   * Generate 5-category inventory table (grouped by category).
   */
  public generateInventoryTable(assets: Asset[]): Record<AssetCategory, Asset[]> {
    const inventory: Record<AssetCategory, Asset[]> = {
      CUI_ASSET: [],
      SECURITY_PROTECTION_ASSET: [],
      CONTRACTOR_RISK_MANAGED_ASSET: [],
      SPECIALIZED_ASSET: [],
      OUT_OF_SCOPE: [],
      REQUIRES_OPERATOR_REVIEW: [],
    };

    for (const asset of assets) {
      const category = asset.assetCategory || 'REQUIRES_OPERATOR_REVIEW';
      inventory[category].push(asset);
    }

    return inventory;
  }

  /**
   * Get all saved operator decisions (for audit/reporting).
   */
  public getDecisions(): CategorizationDecision[] {
    return [...this.decisions];
  }
}
