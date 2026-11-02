// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Evidence catalog types (EVC.1). Zero imports, so consumers that vendor this
// file (ces-muster) need no zod. The data shape is defined by
// src/data/evidence-catalog.schema.json (JSON Schema 2020-12); the zod mirror is
// evidence-catalog.contract.ts. The catalog data itself lives in Planner
// (ces-planner/public/data/evidence-catalog/, DEC-8).

export type PracticeIdConvention = 'L2-guide-v2.13' | 'ces-shared-2021';
export type EvidenceTier = 'must_have' | 'nice_to_have';
export type EvidenceProduction = 'signal' | 'capture' | 'rendered' | 'attested';
export type EvidenceDefinitionStatus = 'draft' | 'released' | 'retired';

export interface EvidenceCatalogChange {
  version: string;
  date: string;
  summary: string;
  role: string;
}

/** One 800-171A examine-list object for one requirement; id `<practice>#E<nn>`. */
export interface EvidenceDefinition {
  definition_id: string;
  requirement_id: string;
  nist_ref?: string;
  examine_index: number;
  examine_text: string;
  form_id: string;
  form_title?: string;
  legacy_alias?: string;
  /** May be empty: no archetype fits (e.g. AC.L2-3.1.1#E01, #E08). */
  emx_ids: string[];
  emx_proposed_new?: string[];
  /** Objective level (DEC-3); at least one. */
  objective_ids: string[];
  tier: EvidenceTier;
  production: EvidenceProduction;
  status_effect?: 'none';
  collection_guidance?: string;
  gcc_high_checked?: boolean;
  status: EvidenceDefinitionStatus;
}

/** One released batch (one catalog file). */
export interface EvidenceCatalog {
  catalog_version: string;
  released_on: string;
  approved_by_role: string;
  practice_id_convention: PracticeIdConvention;
  change_log?: EvidenceCatalogChange[];
  definitions: EvidenceDefinition[];
}

/** One entry of catalog-releases.json (the release log). */
export interface EvidenceCatalogRelease {
  release: number;
  date: string;
  catalog_file: string;
  catalog_version: string;
  practices_covered: string[];
  definitions: number;
  examine_lists_file: string;
  examine_lists_sha256: string;
  objective_buckets_file?: string;
  source?: string;
  note?: string;
}

export interface EvidenceCatalogReleaseLog {
  releases: EvidenceCatalogRelease[];
}

/** nist-800-171a-examine-lists.json: one entry per requirement (110). */
export interface ExamineListEntry {
  /** NIST number, e.g. "3.1.1". */
  requirement_id: string;
  requirement_text: string;
  examine: string[];
  examine_count: number;
}

export interface ExamineLists {
  source: string;
  extracted: string;
  requirements: ExamineListEntry[];
  notes?: string[];
}

export type ObjectiveBucket = 'A' | 'B' | 'C';

/** objective-coverage-buckets.json: one entry per assessment objective (320). */
export interface ObjectiveCoverageEntry {
  objective_id: string;
  control: string;
  statement: string;
  bucket: ObjectiveBucket;
  bucket_meaning: string;
  runnable_reads_for_control: number;
}

export interface ObjectiveCoverageBuckets {
  source: string;
  objectives: ObjectiveCoverageEntry[];
}
