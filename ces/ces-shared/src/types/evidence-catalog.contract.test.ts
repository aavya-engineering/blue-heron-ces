// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EVC.1: the release-0 catalog (landed in Planner at the DEC-8 location)
// validates against the evidence-catalog contract, and the zod mirror agrees
// with the JSON schema it mirrors.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EvidenceCatalogSchema,
  PracticeIdConventionSchema,
  EvidenceTierSchema,
  EvidenceProductionSchema,
  EvidenceDefinitionStatusSchema,
  DEFINITION_ID_PATTERN,
  NIST_REF_PATTERN,
  FORM_ID_PATTERN,
  EMX_ID_PATTERN,
  EVIDENCE_CATALOG_SCHEMA_ID,
  parseEvidenceCatalog,
} from './evidence-catalog.contract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(here, '../data/evidence-catalog.schema.json');
const RELEASE_0_PATH = path.resolve(
  here,
  '../../../ces-muster/src/features/plan/engine/data/evidence-catalog/evidence-catalog-release-0.json',
);

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
const release0 = JSON.parse(fs.readFileSync(RELEASE_0_PATH, 'utf-8'));
const defSchema = schema.properties.definitions.items;

describe('EVC.1 evidence catalog contract', () => {
  it('release 0 validates: 14 definitions, each with at least one objective id', () => {
    const result = EvidenceCatalogSchema.safeParse(release0);
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true);
    const cat = parseEvidenceCatalog(release0);
    expect(cat.definitions).toHaveLength(14);
    for (const d of cat.definitions) expect(d.objective_ids.length).toBeGreaterThanOrEqual(1);
    // EMX ids are not required: #E01 and #E08 carry none.
    const noEmx = cat.definitions.filter((d) => d.emx_ids.length === 0).map((d) => d.definition_id);
    expect(noEmx).toEqual(['AC.L2-3.1.1#E01', 'AC.L2-3.1.1#E08']);
  });

  it('rejects a definition with no objective ids or a bad definition id', () => {
    const noObj = structuredClone(release0);
    noObj.definitions[0].objective_ids = [];
    expect(EvidenceCatalogSchema.safeParse(noObj).success).toBe(false);
    const badId = structuredClone(release0);
    badId.definitions[0].definition_id = 'AC.L2-3.1.1#1';
    expect(EvidenceCatalogSchema.safeParse(badId).success).toBe(false);
  });

  it('zod mirror agrees with the JSON schema: id, required keys, enums, patterns', () => {
    expect(schema.$id).toBe(EVIDENCE_CATALOG_SCHEMA_ID);
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');

    const topKeys = Object.keys(EvidenceCatalogSchema.shape);
    expect(topKeys.sort()).toEqual(Object.keys(schema.properties).sort());
    for (const k of schema.required) expect(EvidenceCatalogSchema.shape[k as keyof typeof EvidenceCatalogSchema.shape].isOptional()).toBe(false);

    const defShape = (EvidenceCatalogSchema.shape.definitions.element as any).shape as Record<string, { isOptional(): boolean }>;
    expect(Object.keys(defShape).sort()).toEqual(Object.keys(defSchema.properties).sort());
    for (const k of Object.keys(defShape)) {
      expect(defShape[k].isOptional(), k).toBe(!defSchema.required.includes(k));
    }

    expect(PracticeIdConventionSchema.options).toEqual(schema.properties.practice_id_convention.enum);
    expect(EvidenceTierSchema.options).toEqual(defSchema.properties.tier.enum);
    expect(EvidenceProductionSchema.options).toEqual(defSchema.properties.production.enum);
    expect(EvidenceDefinitionStatusSchema.options).toEqual(defSchema.properties.status.enum);

    expect(DEFINITION_ID_PATTERN.source).toBe(defSchema.properties.definition_id.pattern);
    expect(NIST_REF_PATTERN.source).toBe(defSchema.properties.nist_ref.pattern);
    expect(FORM_ID_PATTERN.source).toBe(defSchema.properties.form_id.pattern);
    expect(EMX_ID_PATTERN.source).toBe(defSchema.properties.emx_ids.items.pattern);
  });
});
