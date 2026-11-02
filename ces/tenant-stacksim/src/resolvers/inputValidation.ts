// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { ObjectStore } from '../store/ObjectStore.js';
import { BadRequestError, matchTarget } from './targets.js';

/**
 * FX-10 (2026-10-26): reject what a real tenant would reject, so an
 * unfilled template value fails on the sim with a clear 400 instead of being
 * stored.
 *
 *  (a) A value that is still an unresolved placeholder (`{name}`) is
 *      rejected wherever a value would be stored (mutation args/bodies) and
 *      in any id position (URI path segments, id-typed fields).
 *  (b) An id-typed field must hold a GUID or the id of an object that exists
 *      in the sim store for the expected type. The sim's own ids are not
 *      GUIDs (`user-1`, `group-1`), and callers capture them from GET output
 *      and reuse them, so an existing sim id is accepted; a typo or a
 *      literal name is not. Id-typed fields checked: `-UserId`, `-GroupId`,
 *      a `directoryObjects/<id>` reference, and CA `excludeUsers`.
 *
 * A GUID that matches nothing keeps the existing 404 (the real service's
 * answer for a well-formed id it cannot find), as does a UPN-shaped
 * `-UserId` (Graph addresses users by id or userPrincipalName).
 */

const PLACEHOLDER = /^\{[A-Za-z][A-Za-z0-9_]*\}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Keywords a CA policy's user condition accepts in place of an object id. */
const CA_USER_KEYWORDS = new Set(['all', 'none', 'guestsorexternalusers']);
/** Collections a `directoryObjects/<id>` reference can name. */
const DIRECTORY_OBJECT_COLLECTIONS = ['users', 'groups', 'servicePrincipals', 'devices'];
const DIRECTORY_OBJECT_REF = /\/directoryObjects\/([^/?]+)/i;

export function isPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && PLACEHOLDER.test(value);
}

/** (a) Throws on any `{name}` string anywhere inside `value` (arrays/objects walked). */
export function assertNoPlaceholders(value: unknown, where: string): void {
  if (isPlaceholder(value)) {
    throw new BadRequestError(`${where}: unresolved placeholder value "${value as string}"`);
  }
  if (Array.isArray(value)) {
    for (const v of value) assertNoPlaceholders(v, where);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) assertNoPlaceholders(v, where);
  }
}

async function existsIn(store: ObjectStore, collections: string[], value: string, altKeys: string[] = []): Promise<boolean> {
  for (const c of collections) {
    if (matchTarget(await store.list(c), value, altKeys)) return true;
  }
  return false;
}

/** (b) Throws unless `value` is a GUID or names an existing object in `collections`. */
export async function assertIdValue(
  store: ObjectStore,
  field: string,
  value: unknown,
  collections: string[],
  opts: { allowUpn?: boolean; keywords?: Set<string> } = {},
): Promise<void> {
  if (typeof value !== 'string') return;
  if (isPlaceholder(value)) {
    throw new BadRequestError(`${field}: unresolved placeholder value "${value}"`);
  }
  if (GUID.test(value)) return;
  if (opts.keywords?.has(value.toLowerCase())) return;
  if (opts.allowUpn && value.includes('@')) return;
  if (await existsIn(store, collections, value, opts.allowUpn ? ['userPrincipalName'] : [])) return;
  throw new BadRequestError(`${field}: invalid object identifier "${value}" (not a GUID and no such ${collections.join('/')} object)`);
}

/** Every string inside `value`, walked recursively, with the object key it sits under (if any). */
function* walkStrings(value: unknown, key?: string): Generator<{ key?: string; value: string }> {
  if (typeof value === 'string') {
    yield { key, value };
  } else if (Array.isArray(value)) {
    for (const v of value) yield* walkStrings(v, key);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) yield* walkStrings(v, k);
  }
}

/** (b) `directoryObjects/<id>` references and CA `excludeUsers` entries anywhere inside `value`. */
export async function assertReferencedIds(store: ObjectStore, value: unknown): Promise<void> {
  for (const s of walkStrings(value)) {
    const ref = DIRECTORY_OBJECT_REF.exec(s.value);
    if (ref) {
      let id = ref[1];
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep the raw segment */
      }
      await assertIdValue(store, 'directoryObjects/<id>', id, DIRECTORY_OBJECT_COLLECTIONS);
    }
    if (s.key !== undefined && s.key.toLowerCase() === 'excludeusers') {
      await assertIdValue(store, 'excludeUsers', s.value, ['users'], { keywords: CA_USER_KEYWORDS });
    }
  }
}

/** FX-10 checks for a named-cmdlet call. */
export async function validateCmdletArgs(
  store: ObjectStore,
  cmdlet: string,
  args: unknown,
  isMutation: boolean,
): Promise<void> {
  if (!Array.isArray(args)) return;
  if (isMutation) assertNoPlaceholders(args, cmdlet);
  for (let i = 0; i < args.length - 1; i++) {
    const a = args[i];
    if (typeof a !== 'string') continue;
    const param = a.replace(/:$/, '').toLowerCase();
    const raw = args[i + 1];
    const v = typeof raw === 'string' ? raw.replace(/^['"]|['"]$/g, '') : raw;
    if (param === '-userid') await assertIdValue(store, `${cmdlet} -UserId`, v, ['users'], { allowUpn: true });
    if (param === '-groupid') await assertIdValue(store, `${cmdlet} -GroupId`, v, ['groups']);
  }
  await assertReferencedIds(store, args);
}

/** FX-10 checks for a URI call (path segments, then body). */
export async function validateUriRequest(
  store: ObjectStore,
  method: string,
  normalizedUri: string,
  body: unknown,
): Promise<void> {
  for (const seg of normalizedUri.split('/')) {
    let s = seg;
    try {
      s = decodeURIComponent(seg);
    } catch {
      /* keep the raw segment */
    }
    if (isPlaceholder(s)) throw new BadRequestError(`${method} ${normalizedUri}: unresolved placeholder value "${s}"`);
  }
  if (method !== 'GET') assertNoPlaceholders(body, `${method} ${normalizedUri}`);
  await assertReferencedIds(store, [normalizedUri, body]);
}
