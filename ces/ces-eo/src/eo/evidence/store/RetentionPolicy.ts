// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.3 (B12): store records are kept six years from collection (32 CFR 170, the
 * OSC's artefact retention). Local under EO's storage root; off-box or write-once is deployment's.
 */
import * as path from 'node:path';

export const EVIDENCE_STORE_DIRNAME = 'evidence-store';
export const RETENTION_YEARS = 6;
export const RETENTION_POLICY_ID = '32cfr170-six-years';

/** collectedAt + 6 years (UTC calendar years). Throws on an unparseable time. */
export function retainUntil(collectedAt: string): string {
  const t = new Date(collectedAt);
  if (Number.isNaN(t.getTime())) throw new Error(`retainUntil: unparseable collectedAt '${collectedAt}'`);
  const out = new Date(t.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + RETENTION_YEARS);
  return out.toISOString();
}

/** True when `candidate` is the evidence store under `storageRoot`, or anything inside it. */
export function isUnderEvidenceStore(storageRoot: string, candidate: string): boolean {
  const store = path.resolve(storageRoot, EVIDENCE_STORE_DIRNAME);
  const p = path.resolve(candidate);
  const rel = path.relative(store, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
