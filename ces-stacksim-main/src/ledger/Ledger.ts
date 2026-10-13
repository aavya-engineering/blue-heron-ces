// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { LedgerEntry, LedgerQuery } from './LedgerTypes.js';

/**
 * Append-only JSONL ledger. All writes are serialized through a single
 * Promise-chained queue so there is never more than one OS-level writer in
 * flight — this makes Windows NTFS append-atomicity a non-issue by
 * construction (Core Design (f)).
 */
export class Ledger {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async append(entry: LedgerEntry): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    const task = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, line, 'utf8');
    });
    // Chain future writes off a version that never rejects, so one failed
    // append doesn't wedge the queue for subsequent callers.
    this.writeQueue = task.catch(() => undefined);
    return task;
  }

  async query(filter: LedgerQuery = {}): Promise<LedgerEntry[]> {
    // Wait for any in-flight writes to land before reading, so query() sees
    // a consistent view of everything appended so far.
    await this.writeQueue.catch(() => undefined);

    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const entries = raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LedgerEntry);

    return entries.filter((entry) => matches(entry, filter));
  }
}

function matches(entry: LedgerEntry, filter: LedgerQuery): boolean {
  if (filter.type !== undefined && entry.type !== filter.type) return false;
  if (filter.objectType !== undefined && entry.objectType !== filter.objectType) return false;
  if (filter.id !== undefined && entry.objectId !== filter.id) return false;
  if (filter.actor !== undefined && entry.actor !== filter.actor) return false;
  if (filter.from !== undefined && entry.ts < filter.from) return false;
  if (filter.to !== undefined && entry.ts > filter.to) return false;
  return true;
}
