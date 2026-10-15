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

const FEDRAMP_METADATA_PATH = path.resolve(process.cwd(), 'data/fedramp-gcc-high-inheritance.json');

/**
 * FedRAMP metadata structure matching fedramp-gcc-high-inheritance.json
 */
interface FedRampMetadata {
  schema_version: string;
  authorization_package: string;
  ato_date: string;
  source: string;
  url: string;
  last_verified: string;
  inherited_controls: InheritedControl[];
  control_families: Record<string, FamilyBreakdown>;
}

interface InheritedControl {
  controlId: string;
  inheritance: 'full' | 'partial';
  architectures: string[];
  microsoftResponsibility: string;
  customerResponsibility: string;
}

interface FamilyBreakdown {
  inherited: number;
  shared: number;
  customer: number;
}

interface ControlResponsibility {
  controlId: string;
  responsibility: 'Inherited' | 'Shared' | 'Customer';
  rationale: string;
}

export interface SharedResponsibilityMatrix {
  totalControls: number;
  inherited: number;
  shared: number;
  customer: number;
  byFamily: Array<{ family: string; inherited: number; shared: number; customer: number }>;
  fedRampReference?: string;
  controlDetails?: ControlResponsibility[];
}

/**
 * Generates Shared Responsibility Matrix (CRM) dynamically from FedRAMP metadata
 * and tenant architecture detection. Replaces hardcoded CRM values in SspGenerator.
 *
 * Phase 05 implementation: computes which of 110 CMMC L2 controls are inherited
 * from Microsoft FedRAMP High authorization for Azure Government and M365 GCC High.
 */
export class SharedResponsibilityMatrixGenerator {
  private fedRampMetadata!: FedRampMetadata;

  constructor() {
    this.loadFedRampMetadata();
  }

  /**
   * Load FedRAMP GCC High inheritance metadata from data directory.
   * Throws if file not found or invalid JSON.
   */
  private loadFedRampMetadata(): void {
    const metadataPath = FEDRAMP_METADATA_PATH;

    if (!fs.existsSync(metadataPath)) {
      throw new Error(
        `[SharedResponsibilityMatrixGenerator] FedRAMP metadata file not found: ${metadataPath}`
      );
    }

    const rawData = fs.readFileSync(metadataPath, 'utf-8');
    this.fedRampMetadata = JSON.parse(rawData);

    // Validate metadata structure
    if (!this.fedRampMetadata.inherited_controls || !Array.isArray(this.fedRampMetadata.inherited_controls)) {
      throw new Error(
        '[SharedResponsibilityMatrixGenerator] Invalid FedRAMP metadata: missing inherited_controls array'
      );
    }

    console.log(
      `[SharedResponsibilityMatrixGenerator] Loaded FedRAMP metadata: ${this.fedRampMetadata.inherited_controls.length} inherited controls`
    );
  }

  /**
   * Compute control ownership (inherited/shared/customer) for a single control.
   *
   * Rules:
   * - If control in FedRAMP inherited list AND architecture matches:
   *   - Full inheritance + no customer implementation → Inherited
   *   - Partial inheritance OR customer also implements → Shared
   * - If control not in FedRAMP list OR architecture mismatch → Customer
   *
   * @param controlId Control ID (e.g., "AC.L2-3.1.2")
   * @param architectureType Architecture variant (azure-gov | byod | hybrid)
   * @param adminOpsKnowledgeBankExists Whether AdminOps knowledge bank exists for this control
   */
  public computeControlOwnership(
    controlId: string,
    architectureType: 'azure-gov' | 'byod' | 'hybrid',
    adminOpsKnowledgeBankExists: boolean
  ): ControlResponsibility {
    // Check if control is in FedRAMP inherited list
    const inheritedControl = this.fedRampMetadata.inherited_controls.find(
      c => c.controlId === controlId
    );

    if (!inheritedControl) {
      // Control not inherited, customer responsibility
      return {
        controlId,
        responsibility: 'Customer',
        rationale: 'Not inherited from Microsoft FedRAMP High authorization. Customer implements.'
      };
    }

    // Check if architecture supports this inheritance
    if (!inheritedControl.architectures.includes(architectureType)) {
      return {
        controlId,
        responsibility: 'Customer',
        rationale: `Inherited for ${inheritedControl.architectures.join(', ')} but not ${architectureType}. Customer implements.`
      };
    }

    // If full inheritance and no customer implementation, inherited
    if (inheritedControl.inheritance === 'full' && !adminOpsKnowledgeBankExists) {
      return {
        controlId,
        responsibility: 'Inherited',
        rationale: `Fully inherited from Microsoft FedRAMP High Authorization Package. ${inheritedControl.microsoftResponsibility}`
      };
    }

    // If partial inheritance or customer also implements, shared
    if (inheritedControl.inheritance === 'partial' || adminOpsKnowledgeBankExists) {
      return {
        controlId,
        responsibility: 'Shared',
        rationale: `Microsoft: ${inheritedControl.microsoftResponsibility}. Customer: ${inheritedControl.customerResponsibility}`
      };
    }

    return {
      controlId,
      responsibility: 'Inherited',
      rationale: `Inherited from Microsoft FedRAMP High authorization. ${inheritedControl.microsoftResponsibility}`
    };
  }

  /**
   * Generate complete CRM table with per-family breakdown.
   *
   * @param allControlIds Array of all 110 CMMC L2 control IDs
   * @param architectureType Architecture variant (azure-gov | byod | hybrid)
   * @param adminOpsKnowledgeBanks Set of control IDs with AdminOps knowledge banks
   * @returns CRM with summary counts, family breakdown, and per-control details
   */
  public generateCrmTable(
    allControlIds: string[],
    architectureType: 'azure-gov' | 'byod' | 'hybrid',
    adminOpsKnowledgeBanks: Set<string>
  ): SharedResponsibilityMatrix {
    const controlDetails: ControlResponsibility[] = [];
    const familyCounts: Record<string, FamilyBreakdown> = {};

    // Initialize family counts for all 14 CMMC families
    const families = ['AC', 'AT', 'AU', 'CA', 'CM', 'IA', 'IR', 'MA', 'MP', 'PE', 'PS', 'RA', 'SC', 'SI'];
    families.forEach(f => {
      familyCounts[f] = { inherited: 0, shared: 0, customer: 0 };
    });

    // Compute responsibility for each control
    for (const controlId of allControlIds) {
      const responsibility = this.computeControlOwnership(
        controlId,
        architectureType,
        adminOpsKnowledgeBanks.has(controlId)
      );

      controlDetails.push(responsibility);

      // Extract family prefix (e.g., AC from AC.L2-3.1.1)
      const family = controlId.split('.')[0];
      if (familyCounts[family]) {
        if (responsibility.responsibility === 'Inherited') {
          familyCounts[family].inherited++;
        } else if (responsibility.responsibility === 'Shared') {
          familyCounts[family].shared++;
        } else {
          familyCounts[family].customer++;
        }
      }
    }

    // Compute summary totals
    let totalInherited = 0;
    let totalShared = 0;
    let totalCustomer = 0;

    for (const family of families) {
      totalInherited += familyCounts[family].inherited;
      totalShared += familyCounts[family].shared;
      totalCustomer += familyCounts[family].customer;
    }

    // Build FedRAMP reference text
    const fedRampReference = `Inherited controls based on ${this.fedRampMetadata.authorization_package}, ATO date ${this.fedRampMetadata.ato_date}. Reference: ${this.fedRampMetadata.url}`;

    // Convert familyCounts to array format matching SSP type
    const byFamily = families.map(family => ({
      family,
      inherited: familyCounts[family].inherited,
      shared: familyCounts[family].shared,
      customer: familyCounts[family].customer,
    }));

    return {
      totalControls: allControlIds.length,
      inherited: totalInherited,
      shared: totalShared,
      customer: totalCustomer,
      byFamily,
      fedRampReference,
      controlDetails,
    };
  }

  /**
   * Generate narrative text for CRM section (Section 2.4 or Appendix section).
   * Returns prose description referencing Microsoft FedRAMP High authorization.
   */
  public generateCrmNarrative(crm: SharedResponsibilityMatrix): string {
    const narrative = [
      `This system leverages the Microsoft FedRAMP High Authorization Package for Azure Government and Microsoft 365 GCC High (ATO date: ${this.fedRampMetadata.ato_date}).`,
      '',
      `Of the 110 CMMC Level 2 controls:`,
      `- **${crm.inherited} controls (${Math.round((crm.inherited / crm.totalControls) * 100)}%)** are fully inherited from Microsoft's authorization.`,
      `- **${crm.shared} controls (${Math.round((crm.shared / crm.totalControls) * 100)}%)** are shared responsibilities between Microsoft (platform) and customer (tenant configuration).`,
      `- **${crm.customer} controls (${Math.round((crm.customer / crm.totalControls) * 100)}%)** are customer responsibility.`,
      '',
      `The following table shows the control responsibility breakdown by NIST family:`,
      '',
      `| Family | Inherited | Shared | Customer |`,
      `|--------|-----------|--------|----------|`,
      ...crm.byFamily.map(f => `| ${f.family} | ${f.inherited} | ${f.shared} | ${f.customer} |`),
      '',
      `**Note:** Fully inherited controls are documented in Microsoft's FedRAMP High authorization package and require no customer implementation. Shared controls require both Microsoft platform capabilities and customer tenant-level configuration. Customer-only controls are implemented entirely within the tenant boundary.`,
      '',
      `For complete details on Microsoft's platform-level control implementations, refer to the Microsoft Service Trust Portal: ${this.fedRampMetadata.url}`,
    ];

    return narrative.join('\n');
  }

  /**
   * Detect architecture type from tenant and infrastructure manifests.
   *
   * Detection logic:
   * - BYOD: byodArchitectureMetadata present in tenant manifest
   * - Azure-Gov: Azure Government resources present in infrastructure manifest
   * - Hybrid: fallback (mixed or unknown)
   *
   * @param tenantManifest Tenant manifest object
   * @param infraManifest Infrastructure manifest object
   */
  public detectArchitectureType(
    tenantManifest: Record<string, unknown> | undefined,
    infraManifest: Record<string, unknown> | undefined
  ): 'azure-gov' | 'byod' | 'hybrid' {
    // Check for BYOD architecture metadata
    if (tenantManifest?.byodArchitectureMetadata) {
      return 'byod';
    }

    // Check for Azure Government resources
    if (infraManifest?.azureGovResources && Array.isArray(infraManifest.azureGovResources) && infraManifest.azureGovResources.length > 0) {
      return 'azure-gov';
    }

    // Fallback: hybrid or unknown
    return 'hybrid';
  }
}
