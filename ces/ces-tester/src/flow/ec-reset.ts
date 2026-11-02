// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure DB-1 follow-up: since DB-1, EC keeps its runs, findings, ledger and item records as
 * `ec_*` rows in the shared `ces.db` (ces-ec/src/store.ts EC_COLLECTIONS). The E8.5 reset that
 * deletes `<pl>/EvidenceCollector` must also delete those rows, or a run's EC records outlive it.
 * Only `ec_*` collections are touched; AO and EO rows stay.
 */
import * as fs from 'node:fs';
import Database from 'better-sqlite3';

export const EC_COLLECTION_PREFIX = 'ec_';

/** Deletes every `ec_*` row in the given ces.db; returns the number removed (0 when the file is absent). */
export function clearEcRows(dbPath: string): number {
  if (!fs.existsSync(dbPath)) return 0;
  const db = new Database(dbPath);
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ces_records'").get();
    if (!hasTable) return 0;
    return db.prepare("DELETE FROM ces_records WHERE substr(collection, 1, 3) = ?").run(EC_COLLECTION_PREFIX).changes;
  } finally {
    db.close();
  }
}
