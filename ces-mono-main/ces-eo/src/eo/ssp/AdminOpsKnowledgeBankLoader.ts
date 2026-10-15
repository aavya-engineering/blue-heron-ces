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
import yaml from 'js-yaml';
import { appendTextArtifact } from 'ces-shared/persistence/files';

/** Level-insensitive practice key: AC.L1-3.1.1 and AC.L2-3.1.1 -> AC-3.1.1. */
const practiceKey = (id: string): string => String(id).replace(/^([A-Z]{2})\.L[12]-/, '$1-');

/**
 * AdminOps Knowledge Bank structure matching the YAML schema
 */
export interface AdminOpsKnowledgeBank {
  controlId: string | string[];
  relatedControlIds?: string[];
  practiceStatement: string;
  useCaseId: string;
  useCaseTitle: string;
  domain: string;
  priority: string;
  trigger: string;
  sodTier: string;
  entraRolesRequired: string[];
  approvalRequired: boolean;
  services: Array<{
    name: string;
    purpose?: string;
    modules?: string[];
  }>;
  configurationSteps: {
    portalPath: string;
    powershellCmdlets: Array<{
      cmdlet: string;
      parameters: string[];
    }>;
    graphApiEndpoint: string;
    graphApiPayloadExample?: Record<string, unknown>;
    requiredPermissions: string[];
  };
  evidenceArtifacts: Array<{
    type: string;
    retentionPeriod: string;
    storageLocation: string;
    query?: string;
    hashAlgorithm?: string;
    format?: string;
    filenamePattern?: string;
  }>;
  gccHighSpecifics: {
    endpoints: string[];
    complianceBoundary: string;
    endpointValidation: string;
    notes?: string;
  };
  relatedPolicies: string[];
  odpValues?: Array<{
    odpId: string;
    description: string;
    value: string;
    rationale: string;
    enforcementMechanism: string;
  }>;
  dependencies: {
    hardDependencies?: Array<{
      useCaseId: string;
      reason: string;
    }>;
    softDependencies?: Array<{
      useCaseId: string;
      reason: string;
    }>;
  };
  notes?: string;
}

/**
 * Simplified template context object for Handlebars templates
 */
export interface AdminOpsTemplateContext {
  useCaseId: string;
  useCaseTitle: string;
  sodTier: string;
  entraRoles: string;
  portalPath: string;
  powershellCmdlets: string;
  graphApiEndpoint: string;
  evidenceRetentionPeriod: string;
  gccHighEndpoints: string;
  relatedPolicies: string;
  odpValues?: string;
}

/**
 * Loads and indexes AdminOps knowledge bank YAML files for injection into
 * control narrative templates. Provides a prototype implementation for
 * Phase 00 validation.
 */
export class AdminOpsKnowledgeBankLoader {
  private knowledgeBanks: Map<string, AdminOpsKnowledgeBank> = new Map();
  private knowledgeBanksDir: string;

  constructor(knowledgeBanksDir?: string) {
    // Default to knowledge-banks/adminops relative to project root
    // In Jest environment, __dirname is available. In production, provide explicit path.
    if (knowledgeBanksDir) {
      this.knowledgeBanksDir = knowledgeBanksDir;
    } else {
      // Default: relative to project root (assumes typical deployment structure)
      this.knowledgeBanksDir = path.resolve(process.cwd(), 'knowledge-banks/adminops');
    }
  }

  /**
   * Load all YAML knowledge bank files from the adminops directory.
   * Indexes by primary controlId(s) and relatedControlIds for lookup.
   * Returns count of successfully loaded knowledge banks.
   *
   * PRODUCTION-READY: Implements error handling for YAML parse failures,
   * missing fields, and controlId collisions per Phase 02 spec.
   */
  loadAdminOpsKnowledgeBanks(): number {
    try {
      // Check directory exists (graceful degradation)
      if (!fs.existsSync(this.knowledgeBanksDir)) {
        console.warn(`[AdminOpsKnowledgeBankLoader] Knowledge banks directory not found: ${this.knowledgeBanksDir}`);
        return 0;
      }

      const files = fs.readdirSync(this.knowledgeBanksDir);
      const yamlFiles = files.filter(
        (f) => f.endsWith('.yaml') || f.endsWith('.yml')
      );

      let loadedCount = 0;
      const errorLogPath = path.resolve(process.cwd(), 'logs/resolver-errors.log');

      // Ensure logs directory exists
      const logsDir = path.dirname(errorLogPath);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      for (const file of yamlFiles) {
        const filePath = path.join(this.knowledgeBanksDir, file);

        try {
          const content = fs.readFileSync(filePath, 'utf-8');

          // YAML parse with error handling
          let parsed: AdminOpsKnowledgeBank;
          try {
            parsed = yaml.load(content) as AdminOpsKnowledgeBank;
          } catch (yamlError) {
            const errorMsg = `[${new Date().toISOString()}] YAML parse error: ${file} - ${yamlError instanceof Error ? yamlError.message : String(yamlError)}\n`;
            console.error(`[AdminOpsKnowledgeBankLoader] ${errorMsg.trim()}`);
            appendTextArtifact(errorLogPath, errorMsg);
            continue; // Skip this file
          }

          // Validate required fields
          if (!parsed.controlId || !parsed.useCaseId || !parsed.useCaseTitle) {
            const errorMsg = `[${new Date().toISOString()}] Missing required fields in ${file}: controlId=${parsed.controlId}, useCaseId=${parsed.useCaseId}\n`;
            console.warn(`[AdminOpsKnowledgeBankLoader] ${errorMsg.trim()}`);
            appendTextArtifact(errorLogPath, errorMsg);
            continue;
          }

          // Index by primary controlId(s)
          const controlIds = Array.isArray(parsed.controlId)
            ? parsed.controlId
            : [parsed.controlId];

          for (const controlId of controlIds) {
            // Primary control gets full knowledge bank
            if (!this.knowledgeBanks.has(controlId)) {
              this.knowledgeBanks.set(controlId, parsed);
            } else {
              // ControlId collision on primary
              const existing = this.knowledgeBanks.get(controlId);
              if (existing && existing.useCaseId !== parsed.useCaseId) {
                console.warn(
                  `[AdminOpsKnowledgeBankLoader] Primary controlId collision: ${controlId} claimed by ${existing.useCaseId} and ${parsed.useCaseId}, using first match`
                );
              }
            }
          }

          // Also index by relatedControlIds for secondary lookups with collision detection
          if (parsed.relatedControlIds) {
            for (const relatedId of parsed.relatedControlIds) {
              if (this.knowledgeBanks.has(relatedId)) {
                const existing = this.knowledgeBanks.get(relatedId);
                if (existing && existing.useCaseId !== parsed.useCaseId) {
                  console.warn(
                    `[AdminOpsKnowledgeBankLoader] ControlId collision: ${relatedId} claimed by ${existing.useCaseId} and ${parsed.useCaseId}, using first match`
                  );
                }
              } else {
                // Only set if not already present (primary and first related take precedence)
                this.knowledgeBanks.set(relatedId, parsed);
              }
            }
          }

          loadedCount++;
        } catch (fileError) {
          const errorMsg = `[${new Date().toISOString()}] File read error: ${file} - ${fileError instanceof Error ? fileError.message : String(fileError)}\n`;
          console.error(`[AdminOpsKnowledgeBankLoader] ${errorMsg.trim()}`);
          appendTextArtifact(errorLogPath, errorMsg);
          // Continue processing other files
        }
      }

      console.log(
        `[AdminOpsKnowledgeBankLoader] Loaded ${loadedCount} AdminOps knowledge bank files, indexed ${this.knowledgeBanks.size} control mappings`
      );
      return loadedCount;
    } catch (error) {
      console.error(
        '[AdminOpsKnowledgeBankLoader] Failed to load AdminOps knowledge banks directory:',
        error
      );
      // Non-fatal: resolver can still function with manifest data only
      return 0;
    }
  }

  /**
   * Get knowledge bank data for a specific control ID.
   * Returns undefined if no knowledge bank found for the control.
   */
  getKnowledgeBank(controlId: string): AdminOpsKnowledgeBank | undefined {
    const exact = this.knowledgeBanks.get(controlId);
    if (exact) return exact;
    // W4-EO2: YAML ids follow the AO registry / shared reference (AC.L1-3.1.1), while AO evidence
    // rows and some callers spell the same practice AC.L2-3.1.1. Match by practice number.
    const key = practiceKey(controlId);
    for (const [id, kb] of this.knowledgeBanks) if (practiceKey(id) === key) return kb;
    return undefined;
  }

  /**
   * Build template context object from knowledge bank data for Handlebars injection.
   * Transforms complex knowledge bank structure into flat string properties
   * suitable for template variables like {{adminOps.sodTier}}.
   */
  buildTemplateContext(
    controlId: string
  ): AdminOpsTemplateContext | undefined {
    const kb = this.getKnowledgeBank(controlId);
    if (!kb) return undefined;

    return {
      useCaseId: kb.useCaseId,
      useCaseTitle: kb.useCaseTitle,
      sodTier: kb.sodTier,
      entraRoles: kb.entraRolesRequired.join(', '),
      portalPath: kb.configurationSteps.portalPath,
      powershellCmdlets: kb.configurationSteps.powershellCmdlets
        .map((c) => c.cmdlet)
        .join(', '),
      graphApiEndpoint: kb.configurationSteps.graphApiEndpoint,
      evidenceRetentionPeriod:
        kb.evidenceArtifacts[0]?.retentionPeriod ?? 'Not specified',
      gccHighEndpoints: kb.gccHighSpecifics.endpoints.join(', '),
      relatedPolicies: kb.relatedPolicies.join(', '),
      odpValues: kb.odpValues?.map((odp) => odp.value).join('; '),
    };
  }

  /**
   * Get all loaded knowledge banks (for debugging/inspection).
   */
  getAllKnowledgeBanks(): Map<string, AdminOpsKnowledgeBank> {
    return this.knowledgeBanks;
  }

  /**
   * Clear loaded knowledge banks (for testing/reloading).
   */
  clear(): void {
    this.knowledgeBanks.clear();
  }
}
