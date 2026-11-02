// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FE-safe evidence catalog contract (EVC.1). Zero node:* imports.
//
// zod mirror of src/data/evidence-catalog.schema.json (JSON Schema 2020-12, the
// shape BHD sent on 2026-10-26). The JSON schema is the source of truth; Planner
// and Muster validate the catalog against it with Ajv 2020. This mirror lets
// ces-shared validate without ajv; evidence-catalog.contract.test.ts checks the
// two agree on required keys, enums and patterns. Unknown keys pass through, as
// in the JSON schema (the files carry `_about` notes).

import { z } from 'zod';
import type { EvidenceCatalog } from './evidence-catalog.types.js';
export type * from './evidence-catalog.types.js';

export const EVIDENCE_CATALOG_SCHEMA_ID = 'https://blueherondefense.example/ces/evidence-catalog.schema.json';

export const DEFINITION_ID_PATTERN = /^[A-Z]{2}\.L[12]-3\.[0-9]{1,2}\.[0-9]{1,2}#E[0-9]{2}$/;
export const NIST_REF_PATTERN = /^3\.[0-9]{1,2}\.[0-9]{1,2}$/;
export const FORM_ID_PATTERN = /^[a-z0-9_]+$/;
export const EMX_ID_PATTERN = /^EMX-[A-Z]+-[0-9]{3}$/;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const PracticeIdConventionSchema = z.enum(['L2-guide-v2.13', 'ces-shared-2021']);
export const EvidenceTierSchema = z.enum(['must_have', 'nice_to_have']);
export const EvidenceProductionSchema = z.enum(['signal', 'capture', 'rendered', 'attested']);
export const EvidenceDefinitionStatusSchema = z.enum(['draft', 'released', 'retired']);

export const EvidenceCatalogChangeSchema = z
  .object({ version: z.string(), date: isoDate, summary: z.string(), role: z.string() })
  .passthrough();

export const EvidenceDefinitionSchema = z
  .object({
    definition_id: z.string().regex(DEFINITION_ID_PATTERN),
    requirement_id: z.string(),
    nist_ref: z.string().regex(NIST_REF_PATTERN).optional(),
    examine_index: z.number().int().min(1),
    examine_text: z.string(),
    form_id: z.string().regex(FORM_ID_PATTERN),
    form_title: z.string().optional(),
    legacy_alias: z.string().optional(),
    emx_ids: z.array(z.string().regex(EMX_ID_PATTERN)),
    emx_proposed_new: z.array(z.string()).optional(),
    objective_ids: z.array(z.string()).min(1),
    tier: EvidenceTierSchema,
    production: EvidenceProductionSchema,
    status_effect: z.literal('none').optional(),
    collection_guidance: z.string().optional(),
    gcc_high_checked: z.boolean().optional(),
    status: EvidenceDefinitionStatusSchema,
  })
  .passthrough();

export const EvidenceCatalogSchema = z
  .object({
    catalog_version: z.string(),
    released_on: isoDate,
    approved_by_role: z.string(),
    practice_id_convention: PracticeIdConventionSchema,
    change_log: z.array(EvidenceCatalogChangeSchema).optional(),
    definitions: z.array(EvidenceDefinitionSchema),
  })
  .passthrough();

/** Parse a catalog file; throws a ZodError when it does not match the schema. */
export function parseEvidenceCatalog(doc: unknown): EvidenceCatalog {
  return EvidenceCatalogSchema.parse(doc) as EvidenceCatalog;
}
