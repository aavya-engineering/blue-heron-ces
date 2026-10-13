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
import type { StoreFile, StoreObject } from './StoreTypes.js';
import { assertKnownObjectType } from './schemas.js';

/**
 * One JSON file per tenant-profile instance (store.json). All writes are
 * serialized through a single Promise-chained queue (Core Design (f)); the
 * in-memory cache is a same-process read optimization behind that single
 * writer, not a second access path.
 */
export class ObjectStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private cache: StoreFile | undefined;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async load(): Promise<StoreFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as StoreFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = { collections: {} };
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private enqueueWrite(mutator: (file: StoreFile) => void): Promise<void> {
    const task = this.writeQueue.then(async () => {
      const file = await this.load();
      mutator(file);
      this.cache = file;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf8');
    });
    this.writeQueue = task.catch(() => undefined);
    return task;
  }

  async create(objectType: string, obj: StoreObject): Promise<StoreObject> {
    assertKnownObjectType(objectType);
    await this.enqueueWrite((file) => {
      if (!file.collections[objectType]) {
        file.collections[objectType] = {};
      }
      file.collections[objectType][obj.id] = obj;
    });
    return obj;
  }

  async read(objectType: string, id: string): Promise<StoreObject | undefined> {
    await this.writeQueue.catch(() => undefined);
    const file = await this.load();
    return file.collections[objectType]?.[id];
  }

  /** Inspector support: every collection name with its object count (read-only snapshot). */
  async collectionCounts(): Promise<Record<string, number>> {
    await this.writeQueue.catch(() => undefined);
    const file = await this.load();
    const counts: Record<string, number> = {};
    for (const [name, objects] of Object.entries(file.collections)) {
      counts[name] = Object.keys(objects).length;
    }
    return counts;
  }

  async update(
    objectType: string,
    id: string,
    patch: Partial<StoreObject>,
  ): Promise<StoreObject> {
    assertKnownObjectType(objectType);
    let updated: StoreObject | undefined;
    await this.enqueueWrite((file) => {
      const existing = file.collections[objectType]?.[id];
      if (!existing) {
        throw new Error(`ObjectStore.update: no ${objectType} object with id "${id}"`);
      }
      updated = { ...existing, ...patch, id };
      file.collections[objectType][id] = updated;
    });
    return updated as StoreObject;
  }

  /**
   * Create-or-merge-patch a single object by id (M4: backs PATCH mutation
   * handling for singleton-shaped Graph resources, e.g. authorizationPolicy/
   * authenticationMethodsPolicy configurations, which real Graph always
   * returns as already-existing - unlike update(), does not throw when the
   * object is missing).
   */
  async upsert(objectType: string, id: string, patch: Partial<StoreObject>): Promise<StoreObject> {
    assertKnownObjectType(objectType);
    let result: StoreObject | undefined;
    await this.enqueueWrite((file) => {
      if (!file.collections[objectType]) {
        file.collections[objectType] = {};
      }
      const existing = file.collections[objectType][id];
      result = existing ? { ...existing, ...patch, id } : { id, ...patch };
      file.collections[objectType][id] = result;
    });
    return result as StoreObject;
  }

  async delete(objectType: string, id: string): Promise<void> {
    await this.enqueueWrite((file) => {
      if (file.collections[objectType]) {
        delete file.collections[objectType][id];
      }
    });
  }

  async list(objectType: string): Promise<StoreObject[]> {
    await this.writeQueue.catch(() => undefined);
    const file = await this.load();
    return Object.values(file.collections[objectType] ?? {});
  }
}
