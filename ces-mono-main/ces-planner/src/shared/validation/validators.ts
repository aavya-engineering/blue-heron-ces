// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { schemaLoader, SCHEMA_FILES } from '../services/schemaLoader';

class ValidationService {
  private ajv: Ajv;
  private validators: Map<string, ValidateFunction> = new Map();
  private initialized = false;
  private initializationErrors: string[] = [];

  constructor() {
    // Configure AJV to be lenient with Draft 2020-12 schemas
    // The source schemas are immutable, so we must accommodate their format
    this.ajv = new Ajv({
      strict: false,           // Allow unknown keywords (schema_name, etc.)
      strictSchema: false,     // Don't validate against meta-schema
      strictTypes: false,      // Allow properties without explicit type
      validateSchema: false,   // Skip meta-schema validation (draft-2020-12 not built-in)
      allErrors: true,
      verbose: true,
      allowUnionTypes: true,
    });
    addFormats(this.ajv);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure schemas are loaded
    await schemaLoader.loadAllSchemas();

    // Compile validators for key artifacts
    // Note: Some schemas may fail due to regex patterns or $defs - we continue anyway
    const schemaKeys = Object.keys(SCHEMA_FILES);
    for (const key of schemaKeys) {
      const schema = schemaLoader.getSchema(key);
      if (schema) {
        try {
          // Clean up schema for AJV compatibility
          const cleanedSchema = this.cleanSchemaForAjv(schema);
          const validator = this.ajv.compile(cleanedSchema);
          this.validators.set(key, validator);
        } catch (error) {
          const errorMsg = `Schema ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          this.initializationErrors.push(errorMsg);
          console.warn(`[ValidationService] Skipping schema ${key} - will use permissive validation`);
        }
      }
    }

    this.initialized = true;
    console.log(`[ValidationService] Compiled ${this.validators.size}/${schemaKeys.length} validators`);
    if (this.initializationErrors.length > 0) {
      console.warn(`[ValidationService] ${this.initializationErrors.length} schemas could not be compiled - artifacts will pass validation by default`);
    }
  }

  // Clean schema for AJV compatibility (handles regex escapes and other issues)
  private cleanSchemaForAjv(schema: Record<string, unknown>): Record<string, unknown> {
    const cleaned = JSON.parse(JSON.stringify(schema));

    // Remove $schema declaration that AJV doesn't recognize
    delete cleaned.$schema;

    // Recursively fix regex patterns with invalid escapes
    this.fixRegexPatterns(cleaned);

    return cleaned;
  }

  private fixRegexPatterns(obj: unknown): void {
    if (typeof obj !== 'object' || obj === null) return;

    const record = obj as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      if (key === 'pattern' && typeof record[key] === 'string') {
        // Fix invalid regex escapes: \- inside [] should be just -
        record[key] = (record[key] as string).replace(/\\\-/g, '-');
      } else if (typeof record[key] === 'object') {
        this.fixRegexPatterns(record[key]);
      }
    }
  }

  private getValidator(key: string): ValidateFunction | undefined {
    if (!this.initialized) {
      console.warn('ValidationService not initialized - returning permissive validator');
      return undefined;
    }
    return this.validators.get(key);
  }

  // Check if service is ready
  isReady(): boolean {
    return this.initialized;
  }

  // Get initialization errors for debugging
  getInitializationErrors(): string[] {
    return [...this.initializationErrors];
  }

  // Helper to run validation with fallback to permissive mode
  private runValidation(key: string, data: unknown, artifactName: string): { valid: boolean; errors?: string[] } {
    const validator = this.getValidator(key);

    // If no validator is available (schema failed to compile), FAIL CLOSED (G-ENG-4). Previously
    // this returned { valid: true }, so a schema-invalid artifact passed silently when its schema
    // could not compile — an integrity hole for CUI planning artifacts. A missing validator is an
    // operational error, not a licence to skip validation: refuse the artifact and surface why.
    if (!validator) {
      console.error(`[ValidationService] No validator for ${artifactName} - REJECTING (schema unavailable)`);
      return {
        valid: false,
        errors: [`No schema validator available for ${artifactName}; the artifact cannot be validated and is rejected.`],
      };
    }

    const valid = validator(data);
    if (!valid && validator.errors) {
      return {
        valid: false,
        errors: validator.errors.map((e) => `${e.instancePath} ${e.message}`),
      };
    }

    return { valid: true };
  }

  validateSIBaseline(data: unknown): { valid: boolean; errors?: string[] } {
    return this.runValidation('SI_BASELINE', data, 'SI Baseline');
  }

  validateRRQuestionSet(data: unknown): { valid: boolean; errors?: string[] } {
    return this.runValidation('RR_QUESTION_SET', data, 'RR Question Set');
  }

  validateReadinessPosture(data: unknown): { valid: boolean; errors?: string[] } {
    return this.runValidation('READINESS_POSTURE', data, 'Readiness Posture');
  }

  validateManualMissionPlan(data: unknown): { valid: boolean; errors?: string[] } {
    return this.runValidation('MANUAL_MISSION_PLAN', data, 'Manual Mission Plan');
  }

  validateProposal(data: unknown): { valid: boolean; errors?: string[] } {
    return this.runValidation('PROPOSAL', data, 'Proposal');
  }

  validateTenantManifest(data: unknown): { valid: boolean; errors?: string[] } {
    return this.runValidation('TENANT_MANIFEST', data, 'Tenant Manifest');
  }

  validateTechRefPlan(data: unknown): { valid: boolean; errors?: string[] } {
    return this.runValidation('TECH_REF_PLAN', data, 'Tech Ref Implementation Guide');
  }

  validateTenantConfigProfile(data: unknown): { valid: boolean; errors?: string[] } {
    return this.runValidation('TENANT_CONFIG_PROFILE', data, 'Tenant Config Profile');
  }

  // Generic validation for domain data
  validateDomainData(schemaKey: string, data: unknown): { valid: boolean; errors?: string[] } {
    return this.runValidation(schemaKey, data, schemaKey);
  }
}

export const validationService = new ValidationService();

// Convenience exports for direct function imports
export const validateSIBaseline = (data: unknown) => validationService.validateSIBaseline(data);
export const validateRRQuestionSet = (data: unknown) => validationService.validateRRQuestionSet(data);
export const validateReadinessPosture = (data: unknown) => validationService.validateReadinessPosture(data);
export const validateManualMissionPlan = (data: unknown) => validationService.validateManualMissionPlan(data);
export const validateProposal = (data: unknown) => validationService.validateProposal(data);
export const validateTenantManifest = (data: unknown) => validationService.validateTenantManifest(data);
export const validateTechRefPlan = (data: unknown) => validationService.validateTechRefPlan(data);
export const validateTenantConfigProfile = (data: unknown) =>
  validationService.validateTenantConfigProfile(data);
