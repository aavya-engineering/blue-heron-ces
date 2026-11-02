// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { randomBytes, randomUUID } from 'node:crypto';
import type { ObjectStore } from '../store/ObjectStore.js';
import type { StoreObject } from '../store/StoreTypes.js';
import type { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import { registerObjectType } from '../store/schemas.js';
import { BadRequestError, NotFoundError, URI_ALT_KEYS, matchTarget } from './targets.js';

/**
 * PH-12 P12-AO (2026-11-01): REST paths AdminOps (ces-ao) sends that no resolver served, found by the
 * R-F9 S1 AO sweep (E7S, V77). One hook in `ResolverTable.resolveUri` calls `resolveAoUri` first; it
 * returns `undefined` for every URI it does not own, so nothing else changes.
 *
 *  - Temporary Access Pass (AO A-01, the joiner op, FIN-23):
 *    `GET|POST /v1.0/users/{id | userPrincipalName}/authentication/temporaryAccessPassMethods` and
 *    `GET|DELETE .../temporaryAccessPassMethods/{methodId}` (Graph v1.0 and beta).
 *    The user id sits in the MIDDLE of the path, which the table's trailing-`*` capture cannot address
 *    (same shape as the per-user MFA requirement special case). R-F9 S1: the A-01 apply failed 404 on
 *    the GET guard of its set, so the TAP step never ran.
 *    Service semantics (Microsoft Learn, "Create temporaryAccessPassMethod" and "Configure Temporary
 *    Access Pass"):
 *      - unknown user: 404, store unchanged;
 *      - the tenant's TAP method policy (authenticationMethodsPolicyConfigurations/TemporaryAccessPass)
 *        is 'disabled': 400;
 *      - the policy's `isUsableOnce` is true and the request asks for a multi-use pass: 400;
 *      - `lifetimeInMinutes` outside the policy's [minimum, maximum]: 400 (default: the policy's
 *        defaultLifetimeInMinutes);
 *      - a user holds at most one pass: a second POST is a 400;
 *      - the pass value is returned ONCE, in the POST response, and is never stored: later GETs show
 *        `temporaryAccessPass: null`, as Graph does. The value is random and fictional.
 *    Stored in its own collection (`temporaryAccessPassMethods`, by `userId`), not in `authMethods`,
 *    so no EvidenceOps auth-method read changes (an AO write after every assessment, but still).
 */

registerObjectType('temporaryAccessPassMethods');

export interface AoResolverContext {
  store: ObjectStore;
  auditWriter?: DirectoryAuditWriter;
}

const TAP_URI = /^\/(?:v1\.0|beta)\/users\/([^/]+)\/authentication\/temporaryAccessPassMethods(?:\/([^/]+))?$/;
const TAP_ODATA = '#microsoft.graph.temporaryAccessPassAuthenticationMethod';

function decode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function bodyObject(body: unknown, where: string): Record<string, unknown> {
  let b = body;
  if (b === undefined || b === null || b === '') return {};
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b) as unknown;
    } catch {
      throw new BadRequestError(`${where}: the body is not JSON`);
    }
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestError(`${where}: the body must be a JSON object`);
  return b as Record<string, unknown>;
}

/** Case-insensitive own-property read (PowerShell hashtables keep the caller's casing). */
function field(o: Record<string, unknown>, name: string): unknown {
  const k = Object.keys(o).find((x) => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : o[k];
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  return undefined;
}

/** The stored row as Graph lists it (the pass value is never readable after creation). */
function view(row: StoreObject): Record<string, unknown> {
  const { userId: _u, ...rest } = row as Record<string, unknown>;
  return { ...rest, temporaryAccessPass: null };
}

/** A fictional 8-character pass (Graph's default length), never stored. */
function fictionalPass(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

async function resolveTap(ctx: AoResolverContext, method: string, normalized: string, userSeg: string, methodSeg: string | undefined, body: unknown): Promise<unknown> {
  const where = `${method} ${normalized}`;
  const idOrUpn = decode(userSeg);
  const user = matchTarget(await ctx.store.list('users'), idOrUpn, URI_ALT_KEYS.users ?? []);
  if (!user) throw new NotFoundError(`${where}: no users object with id or userPrincipalName "${idOrUpn}"`);
  const mine = (await ctx.store.list('temporaryAccessPassMethods')).filter((r) => (r as Record<string, unknown>).userId === user.id);

  if (methodSeg !== undefined) {
    const methodId = decode(methodSeg);
    const row = mine.find((r) => r.id === methodId);
    if (!row) throw new NotFoundError(`${where}: user "${user.id}" has no temporaryAccessPassMethod "${methodId}"`);
    if (method === 'GET') return view(row);
    if (method === 'DELETE') {
      await ctx.store.delete('temporaryAccessPassMethods', row.id);
      await ctx.auditWriter?.recordMutation({ objectType: 'temporaryAccessPassMethods', objectId: row.id, activityDisplayName: `DELETE ${normalized}`, requestVerb: 'DELETE', source: `Invoke-MgGraphRequest DELETE ${normalized}` });
      return null;
    }
    throw new BadRequestError(`${where}: one temporaryAccessPassMethod supports GET and DELETE only`);
  }

  if (method === 'GET') return { value: mine.map(view) };
  if (method !== 'POST') throw new BadRequestError(`${where}: the temporaryAccessPassMethods collection supports GET and POST only`);

  const req = bodyObject(body, where);
  const policy = (await ctx.store.list('authenticationMethodsPolicyConfigurations')).find((p) => p.id === 'TemporaryAccessPass') as Record<string, unknown> | undefined;
  if (policy && String(policy.state ?? '').toLowerCase() === 'disabled') {
    throw new BadRequestError(`${where}: the Temporary Access Pass authentication method is disabled by the tenant's authentication methods policy`);
  }
  const policyOnce = policy ? bool(policy.isUsableOnce) : undefined;
  const reqOnce = bool(field(req, 'isUsableOnce'));
  if (policyOnce === true && reqOnce === false) {
    throw new BadRequestError(`${where}: the tenant's policy allows one-time passes only (isUsableOnce true)`);
  }
  const min = policy ? num(policy.minimumLifetimeInMinutes) : undefined;
  const max = policy ? num(policy.maximumLifetimeInMinutes) : undefined;
  const lifetime = num(field(req, 'lifetimeInMinutes')) ?? (policy ? num(policy.defaultLifetimeInMinutes) : undefined) ?? 60;
  if ((min !== undefined && lifetime < min) || (max !== undefined && lifetime > max)) {
    throw new BadRequestError(`${where}: lifetimeInMinutes ${lifetime} is outside the policy's range [${min ?? '-'}, ${max ?? '-'}]`);
  }
  if (mine.length > 0) throw new BadRequestError(`${where}: user "${user.id}" already has a Temporary Access Pass (a user holds at most one)`);

  const startRaw = field(req, 'startDateTime');
  const start = typeof startRaw === 'string' && !Number.isNaN(Date.parse(startRaw)) ? new Date(startRaw).toISOString() : new Date().toISOString();
  const row: StoreObject = {
    id: randomUUID(),
    '@odata.type': TAP_ODATA,
    userId: user.id,
    createdDateTime: new Date().toISOString(),
    startDateTime: start,
    lifetimeInMinutes: lifetime,
    isUsableOnce: reqOnce ?? policyOnce ?? false,
    isUsable: true,
    methodUsabilityReason: 'EnabledByPolicy',
  } as StoreObject;
  const created = await ctx.store.create('temporaryAccessPassMethods', row);
  await ctx.auditWriter?.recordMutation({ objectType: 'temporaryAccessPassMethods', objectId: created.id, activityDisplayName: `POST ${normalized}`, requestVerb: 'POST', source: `Invoke-MgGraphRequest POST ${normalized}` });
  const length = (policy ? num(policy.defaultLength) : undefined) ?? 8;
  return { ...view(created), temporaryAccessPass: fictionalPass(length) };
}

/**
 * The AO-owned REST paths. Returns `undefined` when `normalized` is not one of them (the caller then
 * resolves the URI as before).
 */
export async function resolveAoUri(ctx: AoResolverContext, method: string, normalized: string, body?: unknown): Promise<unknown> {
  const tap = TAP_URI.exec(normalized);
  if (tap) return resolveTap(ctx, method, normalized, tap[1], tap[2], body);
  return undefined;
}
