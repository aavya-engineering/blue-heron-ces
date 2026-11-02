// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { clearEcRows } from '../src/flow/ec-reset.js';

describe('clearEcRows (DB-1 follow-up)', () => {
  it('removes only ec_* rows and tolerates a missing database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-reset-'));
    const dbPath = path.join(dir, 'ces.db');
    expect(clearEcRows(dbPath)).toBe(0);
    const db = new Database(dbPath);
    db.exec('CREATE TABLE ces_records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL)');
    const ins = db.prepare('INSERT INTO ces_records (collection, id, data) VALUES (?, ?, ?)');
    for (const c of ['ec_items', 'ec_runs', 'ec_ledger_history', 'adminops_evidence', 'eo_approver_token_mints', 'execution_state']) ins.run(c, 'x', '{}');
    db.close();
    expect(clearEcRows(dbPath)).toBe(3);
    const left = new Database(dbPath);
    const rows = left.prepare('SELECT collection FROM ces_records ORDER BY collection').all() as { collection: string }[];
    left.close();
    expect(rows.map((r) => r.collection)).toEqual(['adminops_evidence', 'eo_approver_token_mints', 'execution_state']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
