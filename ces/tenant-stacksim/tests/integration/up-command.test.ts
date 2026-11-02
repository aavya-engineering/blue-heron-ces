// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upTenant } from '../../src/cli/commands/up.js';

/**
 * `stacksim up` (the `npm run stacksim` launcher): seeds only when the
 * tenant doesn't exist yet — existing state (scenario-built or mutated)
 * must survive a relaunch untouched.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');

describe('stacksim up', () => {
  it('seeds a missing tenant, then reuses (never re-seeds) existing state on relaunch', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-up-'));
    const tenantRoot = path.join(dir, 'tenant');
    try {
      const first = await upTenant({ slug: 'up-test', port: 0, profilesDir: PROFILES_DIR, tenantRoot });
      expect(first.seeded).toBe(true);
      expect(first.stance).toBe('m365_azure');
      // Server is live and answering.
      const res = await fetch(`http://127.0.0.1:${first.handle.port}/v1.0/identity/conditionalAccess/policies`);
      expect(res.status).toBe(200);
      // Leave a canary mutation, stop.
      await first.handle.store.create('users', { id: 'up-canary', displayName: 'Canary' });
      await first.handle.stop();

      const second = await upTenant({ slug: 'up-test', port: 0, profilesDir: PROFILES_DIR, tenantRoot });
      expect(second.seeded).toBe(false);
      const users = (await second.handle.store.list('users')).map((u) => u.id);
      expect(users).toContain('up-canary');
      await second.handle.stop();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
