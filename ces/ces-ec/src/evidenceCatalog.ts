// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EVC.5: read-only access to the released evidence catalog, used to validate the optional
// `form_id` / `emx_ids` on POST /api/ingest (DEC-2). Path order:
//   1. CES_EVIDENCE_CATALOG_PATH (when set, the only path tried)
//   2. <CES_PIPELINE_ROOT>/evidence-catalog/evidence-catalog-release-0.json
//   3. <package root>/../ces-muster/src/features/plan/engine/data/evidence-catalog/evidence-catalog-release-0.json
//      (FIN-28: ces-planner removed; byte-identical copy)
// Read at call time (like config.ts). A missing or invalid file yields `unavailable`; ingest
// then stores the ids unvalidated with `catalog: "unavailable"`. Catalog ids never carry a
// status effect (DEC-7): EC records them, it never derives a verdict from them.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEvidenceCatalog } from 'ces-shared/types/evidence-catalog';

export const CATALOG_PATH_ENV = 'CES_EVIDENCE_CATALOG_PATH';
export const CATALOG_RELEASE_FILE = 'evidence-catalog-release-0.json';

type Env = Record<string, string | undefined>;

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface CatalogIndex {
  status: 'loaded';
  path: string;
  version: string;
  formIds: Set<string>;
  definitionIds: Set<string>;
  emxIds: Set<string>;
}

export type CatalogLoad = CatalogIndex | { status: 'unavailable'; reason: string };

export function catalogCandidates(env: Env = process.env): string[] {
  const explicit = env[CATALOG_PATH_ENV]?.trim();
  if (explicit) return [path.resolve(explicit)];
  const out: string[] = [];
  const pipelineRoot = env.CES_PIPELINE_ROOT?.trim();
  if (pipelineRoot) out.push(path.join(pipelineRoot, 'evidence-catalog', CATALOG_RELEASE_FILE));
  out.push(path.resolve(PKG_ROOT, '..', 'ces-muster', 'src', 'features', 'plan', 'engine', 'data', 'evidence-catalog', CATALOG_RELEASE_FILE));
  return out;
}

export function loadCatalog(env: Env = process.env): CatalogLoad {
  const candidates = catalogCandidates(env);
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) return { status: 'unavailable', reason: `no catalog file at ${candidates.join(' or ')}` };
  try {
    const raw = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
    const catalog = parseEvidenceCatalog(JSON.parse(raw));
    const formIds = new Set<string>();
    const definitionIds = new Set<string>();
    const emxIds = new Set<string>();
    for (const d of catalog.definitions) {
      formIds.add(d.form_id);
      definitionIds.add(d.definition_id);
      for (const e of d.emx_ids) emxIds.add(e);
    }
    return { status: 'loaded', path: file, version: catalog.catalog_version, formIds, definitionIds, emxIds };
  } catch (err) {
    return { status: 'unavailable', reason: `catalog at ${file} is invalid: ${(err as Error).message}` };
  }
}

export interface CatalogIdsInput {
  form_id?: string;
  emx_ids?: string[];
}

export interface CatalogIdsFields {
  form_id?: string;
  emx_ids?: string[];
  form_id_matched_by?: 'form_id' | 'definition_id';
  catalog: 'validated' | 'unavailable';
}

export type CatalogCheck =
  | { ok: true; fields: CatalogIdsFields }
  | { ok: false; field: 'form_id' | 'emx_ids'; id: string; detail: string };

/** Validate the optional ids against a loaded catalog, or mark them unvalidated when none loaded. */
export function checkCatalogIds(input: CatalogIdsInput, load: CatalogLoad): CatalogCheck {
  const fields: CatalogIdsFields = { catalog: load.status === 'loaded' ? 'validated' : 'unavailable' };
  if (input.form_id !== undefined) fields.form_id = input.form_id;
  if (input.emx_ids !== undefined) fields.emx_ids = input.emx_ids;
  if (load.status !== 'loaded') return { ok: true, fields };

  if (input.form_id !== undefined) {
    if (load.formIds.has(input.form_id)) fields.form_id_matched_by = 'form_id';
    else if (load.definitionIds.has(input.form_id)) fields.form_id_matched_by = 'definition_id';
    else return { ok: false, field: 'form_id', id: input.form_id, detail: `unknown form_id '${input.form_id}' (not in evidence catalog ${load.version})` };
  }
  for (const e of input.emx_ids ?? []) {
    if (!load.emxIds.has(e)) return { ok: false, field: 'emx_ids', id: e, detail: `unknown emx_id '${e}' (not in evidence catalog ${load.version})` };
  }
  return { ok: true, fields };
}
