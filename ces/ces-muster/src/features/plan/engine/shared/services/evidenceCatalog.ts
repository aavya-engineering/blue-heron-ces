// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import catalogSchema from 'ces-shared/data/evidence-catalog-schema';
import type {
  EvidenceCatalog,
  EvidenceCatalogRelease,
  EvidenceCatalogReleaseLog,
  EvidenceDefinition,
  ExamineListEntry,
  ExamineLists,
  ObjectiveCoverageBuckets,
  ObjectiveCoverageEntry,
} from 'ces-shared/types/evidence-catalog';
import { toNistRef } from './practiceReference';

/**
 * EVC.1 seed loader for the evidence catalog (DEC-8 location:
 * public/data/evidence-catalog/). Reads the release log, every released catalog
 * file it lists, the NIST 800-171A examine lists and the objective coverage
 * buckets; validates each catalog file against the ces-shared JSON schema
 * (2020-12) on load; indexes definitions by practice and by EMX id.
 *
 * Practice keys are NIST numbers (R-4): `AC.L1-3.1.1`, `AC.L2-3.1.1` and
 * `3.1.1` all resolve to the same definitions. A definition id that appears in
 * a later release replaces the earlier one.
 *
 * The file reader is injected (fetch in the app, fs in tests), so the module
 * body is identical in Planner and in Muster's vendored copy.
 */

export const RELEASE_LOG_FILE = 'catalog-releases.json';
export const EXAMINE_LISTS_FILE = 'nist-800-171a-examine-lists.json';
export const OBJECTIVE_BUCKETS_FILE = 'objective-coverage-buckets.json';

/** Reads one file of the evidence-catalog folder and returns the parsed JSON. */
export type CatalogReader = (fileName: string) => Promise<unknown>;

let validator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    validator = ajv.compile(catalogSchema);
  }
  return validator;
}

/** Validate one catalog file against evidence-catalog.schema.json; throws on failure. */
export function validateEvidenceCatalog(doc: unknown, label = 'catalog'): EvidenceCatalog {
  const validate = getValidator();
  if (!validate(doc)) {
    const why = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
    throw new Error(`Evidence catalog ${label} does not match evidence-catalog.schema.json: ${why}`);
  }
  return doc as EvidenceCatalog;
}

/** `AC.L2-3.1.1`, `AC.L1-3.1.1`, `AC.L2-3.1.1#E01`, `3.1.1` -> `3.1.1`. */
export function practiceKey(id: string): string {
  return toNistRef(id).replace(/[#[].*$/, '');
}

export interface EvidenceCatalogIndex {
  releases: EvidenceCatalogRelease[];
  definitions: EvidenceDefinition[];
  examineLists: ExamineListEntry[];
  objectives: ObjectiveCoverageEntry[];
  definitionsForPractice(practiceId: string): EvidenceDefinition[];
  definitionsForEmx(emxId: string): EvidenceDefinition[];
  examineList(practiceId: string): ExamineListEntry | undefined;
  objectiveBucket(objectiveId: string): ObjectiveCoverageEntry | undefined;
}

export interface EvidenceCatalogInput {
  releaseLog: EvidenceCatalogReleaseLog;
  catalogs: EvidenceCatalog[];
  examineLists: ExamineLists;
  buckets: ObjectiveCoverageBuckets;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildEvidenceCatalogIndex(input: EvidenceCatalogInput): EvidenceCatalogIndex {
  const byId = new Map<string, EvidenceDefinition>();
  for (const catalog of input.catalogs) {
    for (const d of catalog.definitions) {
      // Keyed level-free, so an L1 and an L2 spelling of one definition collapse.
      const id = d.definition_id;
      byId.set(practiceKey(id) + id.slice(id.indexOf('#')), d);
    }
  }
  const definitions = [...byId.values()];
  const byPractice = new Map<string, EvidenceDefinition[]>();
  const byEmx = new Map<string, EvidenceDefinition[]>();
  for (const d of definitions) {
    push(byPractice, practiceKey(d.requirement_id), d);
    for (const emx of d.emx_ids) push(byEmx, emx.toUpperCase(), d);
  }
  const examineByNist = new Map(input.examineLists.requirements.map((r) => [practiceKey(r.requirement_id), r]));
  const bucketByObjective = new Map(input.buckets.objectives.map((o) => [toNistRef(o.objective_id), o]));

  return {
    releases: input.releaseLog.releases,
    definitions,
    examineLists: input.examineLists.requirements,
    objectives: input.buckets.objectives,
    definitionsForPractice: (practiceId) => byPractice.get(practiceKey(practiceId)) ?? [],
    definitionsForEmx: (emxId) => byEmx.get(emxId.toUpperCase()) ?? [],
    examineList: (practiceId) => examineByNist.get(practiceKey(practiceId)),
    objectiveBucket: (objectiveId) => bucketByObjective.get(toNistRef(objectiveId)),
  };
}

/** Read, validate and index the catalog through `read`. */
export async function loadEvidenceCatalog(read: CatalogReader): Promise<EvidenceCatalogIndex> {
  const releaseLog = (await read(RELEASE_LOG_FILE)) as EvidenceCatalogReleaseLog;
  const catalogs: EvidenceCatalog[] = [];
  for (const r of releaseLog.releases) {
    catalogs.push(validateEvidenceCatalog(await read(r.catalog_file), r.catalog_file));
  }
  const examineLists = (await read(EXAMINE_LISTS_FILE)) as ExamineLists;
  const buckets = (await read(OBJECTIVE_BUCKETS_FILE)) as ObjectiveCoverageBuckets;
  return buildEvidenceCatalogIndex({ releaseLog, catalogs, examineLists, buckets });
}
