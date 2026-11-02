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

/**
 * backlog-S1 (BACKLOG.md § S1, filed by ces-tester): exclusive-writer lock
 * for a tenant root. `stacksim serve` holds the lock for its whole lifetime;
 * `seed` and `scenario` hold it for the duration of their writes. A writer
 * that finds the lock held by a LIVE process fails loudly instead of
 * interleaving writes into store.json/ledger.jsonl — the single-writer
 * guarantee `seed.ts`'s M1 deviation comment promised once serve existed.
 *
 * Mechanism: `<tenantRoot>/.stacksim.lock` created with the exclusive 'wx'
 * flag (atomic on both NTFS and POSIX), holding `{pid, owner, acquiredAt}`.
 * A lock whose pid is no longer alive is stale (crashed process) and is
 * stolen with a warning — liveness via `process.kill(pid, 0)` (EPERM counts
 * as alive; only ESRCH means gone).
 */

export const TENANT_LOCK_FILENAME = '.stacksim.lock';

export class TenantLockedError extends Error {
  constructor(tenantRoot: string, holder: { pid: number; owner: string }) {
    super(
      `tenant at ${tenantRoot} is locked by a live "${holder.owner}" process (pid ${holder.pid}). ` +
        `Only one writer may own store.json/ledger.jsonl at a time (backlog-S1 single-writer guarantee). ` +
        `Stop that process first, or target a different --slug.`,
    );
    this.name = 'TenantLockedError';
  }
}

export interface TenantLockHandle {
  lockPath: string;
  release: () => Promise<void>;
}

interface LockFileContent {
  pid: number;
  owner: string;
  acquiredAt: string;
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export async function acquireTenantLock(tenantRoot: string, owner: string): Promise<TenantLockHandle> {
  await fs.mkdir(tenantRoot, { recursive: true });
  const lockPath = path.join(tenantRoot, TENANT_LOCK_FILENAME);
  const content: LockFileContent = { pid: process.pid, owner, acquiredAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify(content, null, 2), 'utf8');
      await handle.close();
      return {
        lockPath,
        release: async () => {
          try {
            await fs.unlink(lockPath);
          } catch {
            /* already gone — releasing twice or after a wipe is not an error */
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

      let existing: LockFileContent | undefined;
      try {
        existing = JSON.parse(await fs.readFile(lockPath, 'utf8')) as LockFileContent;
      } catch {
        /* unreadable/corrupt lock — treat as stale below */
      }

      // NOTE: a lock holding OUR OWN pid is a live conflict, not stale — the
      // serve/seed/scenario writers can coexist inside one process (vitest,
      // CoverageRunner), and the guarantee is per-WRITER, not per-process.
      if (existing && typeof existing.pid === 'number' && pidIsAlive(existing.pid)) {
        throw new TenantLockedError(tenantRoot, existing);
      }

      // Stale (dead pid or corrupt content): steal it and retry the
      // exclusive create once.
      console.warn(
        `TenantLock: stealing stale lock at ${lockPath} (holder ${existing ? `"${existing.owner}" pid ${existing.pid}` : 'unreadable'})`,
      );
      await fs.unlink(lockPath).catch(() => undefined);
    }
  }
  throw new Error(`TenantLock: failed to acquire ${lockPath} after stale-lock retry`);
}
