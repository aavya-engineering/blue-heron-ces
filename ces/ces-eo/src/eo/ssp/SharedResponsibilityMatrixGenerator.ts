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
 * FedRAMP metadata structure matching fedramp-gcc-high-inheritance.json (schema 2.0, W3.4).
 * The row array keeps its historical name `inherited_controls`; since schema 2.0 it holds one row per
 * CMMC Level 2 control (110), including customer-only rows (`inheritance: 'none'`).
 */
interface FedRampMetadata {
  schema_version: string;
  authorization_package: string;
  authorization_reference?: string;
  ato_date: string | null;
  source: string;
  url: string;
  last_verified: string;
  coverage_definition?: string;
  inheritance_rule?: string;
  condition_semantics?: Record<string, string>;
  sources?: Array<{ key: string; name: string; url: string; accessed?: string; note?: string; alias?: string }>;
  excluded_ids?: Array<{ id: string; reason: string }>;
  muster_table_notes?: string[];
  inherited_controls: InheritedControl[];
  control_families: Record<string, FamilyBreakdown>;
}

export type InheritanceCondition = 'physical_facility_count_zero' | 'customer_equipment_count_zero';

export interface InheritedControl {
  controlId: string;
  nistRef?: string;
  requirement?: string;
  inheritance: 'full' | 'partial' | 'none';
  architectures: string[];
  conditions?: InheritanceCondition[];
  microsoftResponsibility: string;
  customerResponsibility: string;
  placematCoverage?: string;
  placematSheet?: string;
  placematPrimaries?: string[];
  nist80053?: string;
  basis?: string;
  source?: string;
  sourceUrl?: string;
  customerResponsibilitySource?: string;
  verified?: boolean | string;
  note?: string;
}

interface FamilyBreakdown {
  inherited: number;
  shared: number;
  customer: number;
}

/**
 * Tenant facts that gate conditional inheritance (Muster SI-baseline dependencies).
 * `null`/`undefined` means the fact was not recorded ("pending facts").
 */
export interface InheritanceFacts {
  physicalFacilityCount?: number | null;
  customerEquipmentCount?: number | null;
}

export type ConditionStatus = 'met' | 'not_met' | 'pending' | 'none';

export interface ControlResponsibility {
  controlId: string;
  responsibility: 'Inherited' | 'Shared' | 'Customer';
  rationale: string;
  /** Rows below are present when the control resolves to a data-file row (W3.4). */
  nistRef?: string;
  requirement?: string;
  microsoftResponsibility?: string;
  customerResponsibility?: string;
  placematCoverage?: string;
  basis?: string;
  source?: string;
  sourceUrl?: string;
  conditions?: InheritanceCondition[];
  conditionStatus?: ConditionStatus;
  note?: string;
}

export interface SharedResponsibilityMatrix {
  totalControls: number;
  inherited: number;
  shared: number;
  customer: number;
  byFamily: Array<{ family: string; inherited: number; shared: number; customer: number }>;
  fedRampReference?: string;
  controlDetails?: ControlResponsibility[];
  /** Ids present in the data file's `excluded_ids` (SP 800-53 text with no SP 800-171 counterpart). */
  excludedIds?: Array<{ id: string; reason: string }>;
  /** Disagreements with Muster's fedramp-inheritance-table.yaml, printed as a note in SSP section 2.4. */
  musterTableNotes?: string[];
  /** Named sources behind the rows (for the section 2.4 footnote column). */
  sources?: Array<{ key: string; name: string; url: string }>;
  facts?: InheritanceFacts;
}

/** Numeric SP 800-171 reference of a CMMC id: "AC.L1-3.1.1" -> "3.1.1" (B4-neutral: ignores the L1/L2 tag). */
export function nistRefOf(controlId: string): string {
  const m = /-(\d+\.\d+\.\d+)$/.exec(controlId);
  return m ? m[1] : controlId;
}

/**
 * Generates Shared Responsibility Matrix (CRM) dynamically from FedRAMP metadata
 * and tenant architecture detection. Replaces hardcoded CRM values in SspGenerator.
 *
 * W3.4 (founder decision B10): the data file is authored per control from Microsoft's published
 * GCC High coverage (Product Placemat for CMMC 2.0); rows are matched by numeric reference, the
 * `excluded_ids` list is honoured, and PE/MA inheritance is gated on the Muster facility/equipment counts.
 */
export class SharedResponsibilityMatrixGenerator {
  private fedRampMetadata!: FedRampMetadata;
  private rowsByRef!: Map<string, InheritedControl>;
  private excludedByRef!: Map<string, { id: string; reason: string }>;

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

    this.excludedByRef = new Map();
    for (const ex of this.fedRampMetadata.excluded_ids ?? []) {
      this.excludedByRef.set(nistRefOf(ex.id), ex);
    }

    this.rowsByRef = new Map();
    for (const row of this.fedRampMetadata.inherited_controls) {
      const ref = nistRefOf(row.controlId);
      if (this.excludedByRef.has(ref)) {
        console.warn(`[SharedResponsibilityMatrixGenerator] Row ${row.controlId} is also in excluded_ids; the exclusion wins.`);
        continue;
      }
      if (this.rowsByRef.has(ref)) {
        console.warn(`[SharedResponsibilityMatrixGenerator] Duplicate row for reference ${ref} (${row.controlId}); keeping the first.`);
        continue;
      }
      this.rowsByRef.set(ref, row);
    }

    const counts = { full: 0, partial: 0, none: 0 };
    for (const r of this.rowsByRef.values()) counts[r.inheritance] = (counts[r.inheritance] ?? 0) + 1;
    console.log(
      `[SharedResponsibilityMatrixGenerator] Loaded FedRAMP metadata: ${this.rowsByRef.size} control rows ` +
      `(full ${counts.full}, partial ${counts.partial}, none ${counts.none}; ${this.excludedByRef.size} excluded ids)`
    );
  }

  /** The data-file row for a control id, matched by numeric reference; undefined when absent or excluded. */
  public getRow(controlId: string): InheritedControl | undefined {
    return this.rowsByRef.get(nistRefOf(controlId));
  }

  /** The exclusion entry for a control id (SP 800-53 text with no SP 800-171 match), if any. */
  public getExclusion(controlId: string): { id: string; reason: string } | undefined {
    return this.excludedByRef.get(nistRefOf(controlId));
  }

  public getExcludedIds(): Array<{ id: string; reason: string }> {
    return [...(this.fedRampMetadata.excluded_ids ?? [])];
  }

  public getMusterTableNotes(): string[] {
    return [...(this.fedRampMetadata.muster_table_notes ?? [])];
  }

  public getSources(): Array<{ key: string; name: string; url: string }> {
    return (this.fedRampMetadata.sources ?? []).map(s => ({ key: s.key, name: s.name, url: s.url }));
  }

  public getMetadataSummary(): { authorizationPackage: string; authorizationReference?: string; atoDate: string | null; source: string; url: string; lastVerified: string } {
    const m = this.fedRampMetadata;
    return {
      authorizationPackage: m.authorization_package,
      authorizationReference: m.authorization_reference,
      atoDate: m.ato_date ?? null,
      source: m.source,
      url: m.url,
      lastVerified: m.last_verified,
    };
  }

  /**
   * Read the Muster facility/equipment counts out of a pushed Mission Plan (raw JSON), looking at
   * `outputs.human_readable_mission_plan.disposition_summary.si_key_facts` first and then
   * `inputs.si_baseline.si_baseline.dependencies`. Missing values stay undefined ("pending facts").
   */
  public static extractFacts(missionPlanRaw: Record<string, unknown> | undefined): InheritanceFacts {
    const facts: InheritanceFacts = {};
    if (!missionPlanRaw) return facts;
    const get = (obj: unknown, keys: string[]): unknown => {
      let cur: unknown = obj;
      for (const k of keys) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[k];
      }
      return cur;
    };
    const candidates: unknown[] = [
      get(missionPlanRaw, ['outputs', 'human_readable_mission_plan', 'disposition_summary', 'si_key_facts']),
      get(missionPlanRaw, ['inputs', 'si_baseline', 'si_baseline', 'dependencies']),
      get(missionPlanRaw, ['si_baseline', 'dependencies']),
    ];
    const asCount = (v: unknown): number | null | undefined =>
      v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    for (const c of candidates) {
      if (!c || typeof c !== 'object') continue;
      const rec = c as Record<string, unknown>;
      if (facts.physicalFacilityCount === undefined) facts.physicalFacilityCount = asCount(rec.physical_facility_count);
      if (facts.customerEquipmentCount === undefined) facts.customerEquipmentCount = asCount(rec.customer_equipment_count);
    }
    return facts;
  }

  /** Evaluate a row's conditions against the facts. 'none' when the row has no conditions. */
  public static evaluateConditions(conditions: InheritanceCondition[] | undefined, facts: InheritanceFacts | undefined): ConditionStatus {
    if (!conditions || conditions.length === 0) return 'none';
    let pending = false;
    for (const cond of conditions) {
      const value = cond === 'physical_facility_count_zero'
        ? facts?.physicalFacilityCount
        : cond === 'customer_equipment_count_zero'
          ? facts?.customerEquipmentCount
          : undefined;
      if (value === undefined || value === null) { pending = true; continue; }
      if (value !== 0) return 'not_met';
    }
    return pending ? 'pending' : 'met';
  }

  /**
   * Compute control ownership (inherited/shared/customer) for a single control.
   *
   * Rules:
   * - Id in `excluded_ids` (numeric match) → Customer, rationale names the exclusion.
   * - No data-file row (numeric match) → Customer.
   * - Row architecture does not include the tenant architecture → Customer.
   * - inheritance 'none' → Customer.
   * - inheritance 'full' with every condition met and no AdminOps credit → Inherited.
   * - inheritance 'full' with a condition not met or pending (facts not recorded) → Shared.
   * - inheritance 'partial', or AdminOps also implements → Shared.
   *
   * @param controlId Control ID (e.g., "AC.L2-3.1.2"); matched by its numeric reference (B4-neutral)
   * @param architectureType Architecture variant (azure-gov | byod | hybrid)
   * @param adminOpsKnowledgeBankExists Whether AdminOps knowledge bank exists for this control
   * @param facts Muster facility/equipment counts; undefined → conditional rows read "pending facts"
   */
  public computeControlOwnership(
    controlId: string,
    architectureType: 'azure-gov' | 'byod' | 'hybrid',
    adminOpsKnowledgeBankExists: boolean,
    facts?: InheritanceFacts
  ): ControlResponsibility {
    const exclusion = this.getExclusion(controlId);
    if (exclusion) {
      return {
        controlId,
        responsibility: 'Customer',
        rationale: `Excluded from the inheritance data (${exclusion.id}: ${exclusion.reason}). Customer implements.`,
      };
    }

    const row = this.getRow(controlId);
    if (!row) {
      return {
        controlId,
        responsibility: 'Customer',
        rationale: 'Not inherited from Microsoft FedRAMP High authorization. Customer implements.'
      };
    }

    const base: Omit<ControlResponsibility, 'responsibility' | 'rationale'> = {
      controlId,
      nistRef: row.nistRef ?? nistRefOf(row.controlId),
      requirement: row.requirement,
      microsoftResponsibility: row.microsoftResponsibility,
      customerResponsibility: row.customerResponsibility,
      placematCoverage: row.placematCoverage,
      basis: row.basis,
      source: row.source,
      sourceUrl: row.sourceUrl,
      conditions: row.conditions ?? [],
      note: row.note,
    };

    // Check if architecture supports this inheritance
    if (!row.architectures.includes(architectureType)) {
      return {
        ...base,
        responsibility: 'Customer',
        conditionStatus: 'none',
        rationale: `Inherited for ${row.architectures.join(', ')} but not ${architectureType}. Customer implements.`
      };
    }

    if (row.inheritance === 'none') {
      return {
        ...base,
        responsibility: 'Customer',
        conditionStatus: 'none',
        rationale: `Customer responsibility (${row.placematCoverage ?? 'no platform coverage'}). ${row.customerResponsibility}`,
      };
    }

    const conditionStatus = SharedResponsibilityMatrixGenerator.evaluateConditions(row.conditions, facts);

    if (row.inheritance === 'full') {
      if (conditionStatus === 'not_met') {
        return {
          ...base,
          responsibility: 'Shared',
          conditionStatus,
          rationale: `Microsoft: ${row.microsoftResponsibility} Customer: ${row.customerResponsibility} (Condition ${row.conditions!.join(', ')} not met: the organization reports a non-zero count.)`,
        };
      }
      if (conditionStatus === 'pending') {
        return {
          ...base,
          responsibility: 'Shared',
          conditionStatus,
          rationale: `Microsoft: ${row.microsoftResponsibility} Customer: ${row.customerResponsibility} (Pending facts: ${row.conditions!.join(', ')} not recorded in the SI baseline; inheritance cannot be claimed until it is.)`,
        };
      }
      if (adminOpsKnowledgeBankExists) {
        return {
          ...base,
          responsibility: 'Shared',
          conditionStatus,
          rationale: `Microsoft: ${row.microsoftResponsibility} Customer: ${row.customerResponsibility} (AdminOps also implements this control in the tenant.)`,
        };
      }
      return {
        ...base,
        responsibility: 'Inherited',
        conditionStatus,
        rationale: `Fully inherited from Microsoft FedRAMP High Authorization Package. ${row.microsoftResponsibility}`
      };
    }

    // partial (or customer also implements): shared
    return {
      ...base,
      responsibility: 'Shared',
      conditionStatus,
      rationale: `Microsoft: ${row.microsoftResponsibility} Customer: ${row.customerResponsibility}`
    };
  }

  /**
   * Generate complete CRM table with per-family breakdown.
   *
   * @param allControlIds Array of all 110 CMMC L2 control IDs (ces-shared reference ids)
   * @param architectureType Architecture variant (azure-gov | byod | hybrid)
   * @param adminOpsKnowledgeBanks Set of control IDs with AdminOps knowledge banks
   * @param facts Muster facility/equipment counts (optional; undefined → conditional rows pending)
   * @returns CRM with summary counts, family breakdown, and per-control details
   */
  public generateCrmTable(
    allControlIds: string[],
    architectureType: 'azure-gov' | 'byod' | 'hybrid',
    adminOpsKnowledgeBanks: Set<string>,
    facts?: InheritanceFacts
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
        adminOpsKnowledgeBanks.has(controlId),
        facts
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

    // Build FedRAMP reference text (no fabricated date: the ATO date is printed only when the data file records one)
    const m = this.fedRampMetadata;
    const authorization = m.ato_date
      ? `ATO date ${m.ato_date}`
      : (m.authorization_reference ?? 'authorization dates not verified');
    const fedRampReference = `Inherited controls based on ${m.authorization_package}, ${authorization}. Source: ${m.source} (${m.url}); last verified ${m.last_verified}.`;

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
      excludedIds: this.getExcludedIds(),
      musterTableNotes: this.getMusterTableNotes(),
      sources: this.getSources(),
      facts,
    };
  }

  /**
   * Generate narrative text for CRM section (Section 2.3 / 2.4 or Appendix section).
   * Returns prose description referencing Microsoft FedRAMP High authorization.
   */
  public generateCrmNarrative(crm: SharedResponsibilityMatrix): string {
    const m = this.fedRampMetadata;
    const authorization = m.ato_date ? `ATO date: ${m.ato_date}` : 'authorization dates: see the FedRAMP Marketplace; not verified here';
    const narrative = [
      `This system leverages the Microsoft FedRAMP High Authorization Package for Azure Government and Microsoft 365 GCC High (${authorization}).`,
      '',
      `Of the ${crm.totalControls} CMMC Level 2 controls:`,
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
      `Per-control coverage follows ${m.source}: ${m.url}`,
    ];

    return narrative.join('\n');
  }

  /**
   * Detect architecture type from tenant and infrastructure manifests.
   *
   * Detection logic:
   * - BYOD: byodArchitectureMetadata present in tenant manifest
   * - Azure-Gov: TM cloud_environment gcc_high, IM infrastructure_model m365_azure,
   *   or Azure Government resources present in infrastructure manifest
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

    // W2.3: GCC High tenant (TM `tenant_identity.cloud_environment`) or an M365 + Azure IM
    // (`infrastructure_model`); either manifest may still carry its envelope.
    const tm = (tenantManifest?.tenant_manifest ?? tenantManifest) as Record<string, unknown> | undefined;
    const identity = tm?.tenant_identity as Record<string, unknown> | undefined;
    if (identity?.cloud_environment === 'gcc_high') {
      return 'azure-gov';
    }
    const im = (infraManifest?.infrastructure ?? infraManifest) as Record<string, unknown> | undefined;
    if (im?.infrastructure_model === 'm365_azure') {
      return 'azure-gov';
    }

    // Check for Azure Government resources
    if (infraManifest?.azureGovResources && Array.isArray(infraManifest.azureGovResources) && infraManifest.azureGovResources.length > 0) {
      return 'azure-gov';
    }

    // Fallback: hybrid or unknown
    return 'hybrid';
  }
}
