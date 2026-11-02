// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// evidenceCatalogBank.ts — EVC.3 (R-2): the vendored evidence catalog
// (src/features/plan/engine/data/evidence-catalog/) as a synchronous index, so
// the gap compile (compileGapSet arg 9) and the readiness collect column read
// the same released definitions in the SPA, in tests and in the headless
// runner. The vendored loader's validate + index functions are used as is; the
// files are bundled by import (Muster's public/ is not used for them).
import releaseLog from '@/features/plan/engine/data/evidence-catalog/catalog-releases.json';
import release0 from '@/features/plan/engine/data/evidence-catalog/evidence-catalog-release-0.json';
import examineLists from '@/features/plan/engine/data/evidence-catalog/nist-800-171a-examine-lists.json';
import buckets from '@/features/plan/engine/data/evidence-catalog/objective-coverage-buckets.json';
import {
  buildEvidenceCatalogIndex,
  validateEvidenceCatalog,
  type EvidenceCatalogIndex,
} from '@/features/plan/engine/shared/services/evidenceCatalog';
import type {
  EvidenceCatalogReleaseLog,
  ExamineLists,
  ObjectiveCoverageBuckets,
} from 'ces-shared/types/evidence-catalog';

/** Catalog files bundled with Muster, by the file name the release log lists. */
const CATALOG_FILES: Record<string, unknown> = {
  'evidence-catalog-release-0.json': release0,
};

let cache: EvidenceCatalogIndex | null = null;

/** The released evidence catalog, validated against the ces-shared schema and indexed. */
export function vendoredEvidenceCatalog(): EvidenceCatalogIndex {
  if (cache) return cache;
  const log = releaseLog as EvidenceCatalogReleaseLog;
  const catalogs = log.releases.map((r) => {
    if (!(r.catalog_file in CATALOG_FILES)) {
      throw new Error(`Evidence catalog release ${r.release} lists ${r.catalog_file}, which is not bundled (evidenceCatalogBank.CATALOG_FILES).`);
    }
    return validateEvidenceCatalog(CATALOG_FILES[r.catalog_file], r.catalog_file);
  });
  cache = buildEvidenceCatalogIndex({
    releaseLog: log,
    catalogs,
    examineLists: examineLists as ExamineLists,
    buckets: buckets as ObjectiveCoverageBuckets,
  });
  return cache;
}
