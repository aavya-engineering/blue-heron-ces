// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from './ObjectStore.js';

describe('ObjectStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-store-'));
    filePath = path.join(dir, 'store.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips create -> read', async () => {
    const store = new ObjectStore(filePath);
    await store.create('users', { id: 'user-1', displayName: 'Alice' });

    const read = await store.read('users', 'user-1');
    expect(read).toEqual({ id: 'user-1', displayName: 'Alice' });
  });

  it('updates an existing object', async () => {
    const store = new ObjectStore(filePath);
    await store.create('users', { id: 'user-1', displayName: 'Alice' });
    const updated = await store.update('users', 'user-1', { displayName: 'Alice Smith' });

    expect(updated.displayName).toBe('Alice Smith');
    const read = await store.read('users', 'user-1');
    expect(read?.displayName).toBe('Alice Smith');
  });

  it('throws when updating a nonexistent object', async () => {
    const store = new ObjectStore(filePath);
    await expect(store.update('users', 'nope', { displayName: 'X' })).rejects.toThrow();
  });

  it('deletes an object', async () => {
    const store = new ObjectStore(filePath);
    await store.create('users', { id: 'user-1', displayName: 'Alice' });
    await store.delete('users', 'user-1');

    const read = await store.read('users', 'user-1');
    expect(read).toBeUndefined();
  });

  it('lists objects in a collection', async () => {
    const store = new ObjectStore(filePath);
    await store.create('users', { id: 'user-1', displayName: 'Alice' });
    await store.create('users', { id: 'user-2', displayName: 'Bob' });

    const list = await store.list('users');
    expect(list).toHaveLength(2);
  });

  it('persists to disk across store instances', async () => {
    const store1 = new ObjectStore(filePath);
    await store1.create('devices', { id: 'device-1', name: 'Laptop' });

    const store2 = new ObjectStore(filePath);
    const read = await store2.read('devices', 'device-1');
    expect(read).toEqual({ id: 'device-1', name: 'Laptop' });
  });

  it('rejects unknown object types', async () => {
    const store = new ObjectStore(filePath);
    await expect(store.create('bogusType', { id: 'x' })).rejects.toThrow();
  });

  it('upsert creates a new object when none exists (M4: singleton PATCH targets that always exist on a real tenant)', async () => {
    const store = new ObjectStore(filePath);
    const result = await store.upsert('authorizationPolicy', 'authorizationPolicy', { state: 'enabled' });

    expect(result).toEqual({ id: 'authorizationPolicy', state: 'enabled' });
    const read = await store.read('authorizationPolicy', 'authorizationPolicy');
    expect(read).toEqual({ id: 'authorizationPolicy', state: 'enabled' });
  });

  it('upsert merge-patches an existing object without dropping other fields', async () => {
    const store = new ObjectStore(filePath);
    await store.create('authorizationPolicy', {
      id: 'authorizationPolicy',
      allowInvitesFrom: 'adminsAndGuestInviters',
    });
    const result = await store.upsert('authorizationPolicy', 'authorizationPolicy', {
      defaultUserRolePermissions: { allowedToCreateApps: false },
    });

    expect(result).toEqual({
      id: 'authorizationPolicy',
      allowInvitesFrom: 'adminsAndGuestInviters',
      defaultUserRolePermissions: { allowedToCreateApps: false },
    });
  });
});
