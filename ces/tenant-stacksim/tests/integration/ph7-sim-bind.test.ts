// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIM_BIND_ALL, startServe, type ServeHandle } from '../../src/cli/commands/serve.js';

/**
 * PH7-SEC (founder rule 10-30, no loopback-only defaults): `stacksim serve` listens on every
 * interface unless a host is named. In-process servers on port 0 only (never :4390).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');

describe('PH7-SEC: simulator bind default', () => {
  const handles: ServeHandle[] = [];
  const roots: string[] = [];

  afterEach(async () => {
    while (handles.length) await handles.pop()!.stop();
    while (roots.length) await fs.rm(roots.pop()!, { recursive: true, force: true });
  });

  async function serve(host?: string): Promise<ServeHandle> {
    const tenantRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ph7-'));
    roots.push(tenantRoot);
    const handle = await startServe({
      stance: 'm365_only',
      slug: 'stacksim-test-ph7',
      port: 0,
      ...(host !== undefined ? { host } : {}),
      profilesDir: PROFILES_DIR,
      tenantRoot,
    });
    handles.push(handle);
    return handle;
  }

  function address(handle: ServeHandle): string {
    const server = (handle.queryServer as unknown as { server: import('node:http').Server }).server;
    return (server.address() as AddressInfo).address;
  }

  it('no host: listens on the wildcard address, and loopback clients still reach it', async () => {
    expect(SIM_BIND_ALL).toBe('all');
    const handle = await serve();
    expect(['::', '0.0.0.0']).toContain(address(handle));
    const r = await fetch(`http://127.0.0.1:${handle.port}/v1.0/organization`);
    expect(r.status).toBeLessThan(500);
  });

  it('a named host binds that one address', async () => {
    const handle = await serve('127.0.0.1');
    expect(address(handle)).toBe('127.0.0.1');
  });
});
