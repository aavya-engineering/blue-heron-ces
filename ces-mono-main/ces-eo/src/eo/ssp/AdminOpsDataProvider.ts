// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { AdminOpsKnowledgeBankLoader, AdminOpsKnowledgeBank } from './AdminOpsKnowledgeBankLoader.js';

/**
 * Handlebars template context for AdminOps knowledge bank data.
 * Provides flattened string variables for template injection.
 */
export interface AdminOpsContext {
  useCaseId: string;
  useCaseTitle: string;
  domain: string;
  sodTier: string;
  entraRoles: string;
  approvalRequired: string;
  portalPath: string;
  powershellCmdlets: string;
  graphApiEndpoint: string;
  requiredPermissions: string;
  evidenceRetentionPeriod: string;
  evidenceStorageLocation: string;
  gccHighEndpoints: string;
  complianceBoundary: string;
  relatedPolicies: string;
  notes: string;
  odpValue?: string;
  odpEnforcement?: string;
  portalSteps: string;
  graphApiEndpoints: string;
  /**
   * W4-EO2 (AE-R7): where this text comes from. The knowledge bank is a DESIGNED procedure;
   * it is only 'live execution' when a live, executed, SAT AdminOps row exists for the control.
   */
  provenance: AdminOpsProvenance;
}

export type AdminOpsProvenance = 'designed procedure' | 'live execution';
export const DESIGNED_PROCEDURE_LABEL: AdminOpsProvenance = 'designed procedure';

/** Level-insensitive practice key: AC.L1-3.1.1 and AC.L2-3.1.1 -> AC-3.1.1. */
const practiceKey = (id: string): string => id.replace(/^([A-Z]{2})\.L[12]-/, '$1-');

/**
 * Wraps AdminOpsKnowledgeBankLoader to provide Handlebars-ready context data.
 *
 * Usage:
 *   const provider = new AdminOpsDataProvider();
 *   provider.initialize(); // Load all knowledge banks
 *   const context = provider.getByControlId('AC.L2-3.1.1');
 *   // Use context.adminOps.useCaseId, context.adminOps.sodTier, etc. in templates
 */
export class AdminOpsDataProvider {
  private loader: AdminOpsKnowledgeBankLoader;
  private initialized = false;
  private liveControlKeys = new Set<string>();

  constructor(knowledgeBanksDir?: string) {
    this.loader = new AdminOpsKnowledgeBankLoader(knowledgeBanksDir);
  }

  /**
   * Load all AdminOps knowledge banks from disk.
   * Must be called before getByControlId().
   */
  initialize(): number {
    const count = this.loader.loadAdminOpsKnowledgeBanks();
    this.initialized = true;
    return count;
  }

  /**
   * W4-EO2: controls that have a live, executed, SAT AdminOps row for this tenant
   * (liveSatAdminOpsControls). Everything else is labelled 'designed procedure'.
   */
  setLiveControls(controlIds: Iterable<string>): void {
    this.liveControlKeys = new Set([...controlIds].map(practiceKey));
  }

  /**
   * Get Handlebars context variables for a given control ID.
   * Returns undefined if no knowledge bank found for the control.
   *
   * @param controlId - CMMC control ID (e.g., "AC.L2-3.1.1")
   * @returns AdminOpsContext with all template variables, or undefined
   */
  getByControlId(controlId: string): AdminOpsContext | undefined {
    if (!this.initialized) {
      throw new Error('[AdminOpsDataProvider] Must call initialize() before getByControlId()');
    }

    const kb = this.loader.getKnowledgeBank(controlId);
    if (!kb) {
      return undefined;
    }

    return { ...this.buildContext(kb), provenance: this.liveControlKeys.has(practiceKey(controlId)) ? 'live execution' : DESIGNED_PROCEDURE_LABEL };
  }

  /**
   * Transform knowledge bank data into flattened Handlebars context.
   * Handles array-to-string conversions, optional fields, and fallback values.
   */
  private buildContext(kb: AdminOpsKnowledgeBank): Omit<AdminOpsContext, 'provenance'> {
    // PowerShell cmdlets: format as "cmdlet param1 param2; cmdlet2 param3"
    const powershellCmdlets = kb.configurationSteps.powershellCmdlets
      .map(c => `${c.cmdlet} ${c.parameters.join(' ')}`)
      .join('; ');

    // Portal steps: extract from portalPath (simplified for now)
    const portalSteps = kb.configurationSteps.portalPath
      .split(' > ')
      .slice(1) // Remove base URL
      .join(' > ') || kb.configurationSteps.portalPath;

    // Graph API endpoints: currently single endpoint, but support future multi-endpoint
    const graphApiEndpoints = kb.configurationSteps.graphApiEndpoint;

    // Evidence retention period: find first artifact with retentionPeriod
    const evidenceRetentionPeriod =
      kb.evidenceArtifacts.find(a => a.retentionPeriod)?.retentionPeriod || 'N/A';

    // Evidence storage location: first artifact's storageLocation
    const evidenceStorageLocation =
      kb.evidenceArtifacts[0]?.storageLocation || 'N/A';

    // GCC High endpoints: comma-separated
    const gccHighEndpoints = kb.gccHighSpecifics.endpoints.join(', ');

    // Entra roles: comma-separated
    const entraRoles = kb.entraRolesRequired.join(', ');

    // Related policies: comma-separated
    const relatedPolicies = kb.relatedPolicies.join(', ');

    // Required permissions: comma-separated
    const requiredPermissions = kb.configurationSteps.requiredPermissions.join(', ');

    // ODP values: extract first entry if present
    const odpValue = kb.odpValues?.[0]?.value;
    const odpEnforcement = kb.odpValues?.[0]?.enforcementMechanism;

    return {
      useCaseId: kb.useCaseId,
      useCaseTitle: kb.useCaseTitle,
      domain: kb.domain,
      sodTier: kb.sodTier,
      entraRoles,
      approvalRequired: String(kb.approvalRequired),
      portalPath: kb.configurationSteps.portalPath,
      powershellCmdlets,
      graphApiEndpoint: kb.configurationSteps.graphApiEndpoint,
      requiredPermissions,
      evidenceRetentionPeriod,
      evidenceStorageLocation,
      gccHighEndpoints,
      complianceBoundary: kb.gccHighSpecifics.complianceBoundary,
      relatedPolicies,
      notes: kb.notes || 'N/A',
      odpValue,
      odpEnforcement,
      portalSteps,
      graphApiEndpoints,
    };
  }

  /**
   * Get raw knowledge bank for advanced use cases.
   */
  getRawKnowledgeBank(controlId: string): AdminOpsKnowledgeBank | undefined {
    if (!this.initialized) {
      throw new Error('[AdminOpsDataProvider] Must call initialize() before getRawKnowledgeBank()');
    }
    return this.loader.getKnowledgeBank(controlId);
  }

  /**
   * Get count of loaded knowledge banks (for diagnostics).
   */
  getLoadedCount(): number {
    return this.loader.getAllKnowledgeBanks().size;
  }

  /**
   * Clear loaded data (for testing).
   */
  clear(): void {
    this.loader.clear();
    this.initialized = false;
  }
}
