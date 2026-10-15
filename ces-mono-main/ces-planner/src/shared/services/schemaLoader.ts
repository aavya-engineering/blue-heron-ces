// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Schema loader - loads JSON schemas from decsriptions/ directory
import type { JSONSchemaType } from 'ajv';

const SCHEMA_BASE_PATH = '/schemas';

export interface SchemaDefinition {
  name: string;
  fileName: string;
  schema?: JSONSchemaType<unknown>;
}

export const SCHEMA_FILES: Record<string, string> = {
  SI_BASELINE: 'CES SIT Strategic Intent Baseline.schema.json',
  SI_QUESTION_BANK: 'primed SI Question Bank.schema.json',
  RR_QUESTION_SET: 'CES SIT Scenario-Specific Question Set.schema.json',
  RR_QUESTION_BANK: 'primed RR Question Bank.json',
  READINESS_POSTURE: 'CES RRT Readiness Posture.schema.json',
  MANUAL_MISSION_PLAN: 'CES MPT Manual Mission Plan schema.json',
  PROPOSAL: 'CES MPT Proposal Schema.json',
  TENANT_MANIFEST: 'CES Tenant Manifest.schema.json',
  ASSESSOR_KB: 'domain CES Assessor Approach Knowledge Base.schema.json',
  EVIDENCE_MATRIX: 'domain CES Assessor Evidence Matrix.schema.json',
  CMMC_REQUIREMENTS: 'domain CES CMMC Fundamental Requirements Store.schema.json',
  TECH_STACK_MAPPING: 'domain Tech Stack Compliance Mapping schema.json',
  TECH_REF_PLAN: 'CES MPT Tech Ref Implementation Guide.schema.json',
  TENANT_CONFIG_PROFILE: 'CES TCP Tenant Config Profile.schema.json',
};

class SchemaLoaderService {
  private schemas: Map<string, JSONSchemaType<unknown>> = new Map();
  private loadPromise: Promise<void> | null = null;

  async loadAllSchemas(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this._loadSchemas();
    return this.loadPromise;
  }

  private async _loadSchemas(): Promise<void> {
    const loadPromises = Object.entries(SCHEMA_FILES).map(async ([key, fileName]) => {
      try {
        const response = await fetch(`${SCHEMA_BASE_PATH}/${fileName}`);
        if (!response.ok) {
          throw new Error(`Failed to load schema ${fileName}: ${response.statusText}`);
        }
        const schema = await response.json();
        this.schemas.set(key, schema);
      } catch (error) {
        console.error(`Error loading schema ${fileName}:`, error);
        throw error;
      }
    });

    await Promise.all(loadPromises);
    console.log(`Loaded ${this.schemas.size} schemas successfully`);
  }

  getSchema(schemaKey: string): JSONSchemaType<unknown> | undefined {
    return this.schemas.get(schemaKey);
  }

  getAllSchemas(): Map<string, JSONSchemaType<unknown>> {
    return this.schemas;
  }

  isLoaded(): boolean {
    return this.schemas.size > 0;
  }
}

export const schemaLoader = new SchemaLoaderService();
