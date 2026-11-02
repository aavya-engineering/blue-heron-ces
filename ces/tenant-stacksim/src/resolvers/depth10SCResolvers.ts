// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { randomUUID } from 'node:crypto';
import type { ObjectStore } from '../store/ObjectStore.js';
import type { StoreObject } from '../store/StoreTypes.js';
import type { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import { registerObjectType } from '../store/schemas.js';
import { BadRequestError, NotFoundError } from './targets.js';

/**
 * DEPTH-10.4 (PH-12 P12-R3, 2026-11-01): the Graph resources the SC batch's new Stamper registry
 * entries send that no earlier resolver answers, with the service's own rules, so a GET after the
 * SET reads the SET's state back.
 *
 *  - /v1.0|beta/policies/activityBasedTimeoutPolicies[/{id}] (Stamper SC.L2-3.13.9.idle-session-timeout):
 *    the Entra activity-based timeout policy behind Microsoft 365 "idle session timeout".
 *    GET lists ({ value }) or reads one (404 when absent); POST creates one (server id); PATCH
 *    merges into one; DELETE removes one. `definition` is a string collection holding ONE JSON
 *    string: ActivityBasedTimeoutPolicy { Version: 1, ApplicationPolicies: [{ ApplicationId,
 *    WebSessionIdleTimeout }] }, each timeout "[d.]hh:mm:ss" between 5 minutes and one day
 *    (Learn: resources/activitybasedtimeoutpolicy). Only one policy may be the organization default
 *    (isOrganizationDefault true): a second is a 400 here (Learn: "only one can be activated as the
 *    organization default").
 *
 * The Settings Catalog entries of the batch (network protection, pagefile clear, FIPS mode) need no
 * new resolver: /beta/deviceManagement/configurationPolicies POST, /assign and `$expand=settings,assignments`
 * already round-trip (graphResolvers.ts W5c1-c; ResolverTable ASSIGN_URI).
 */

registerObjectType('activityBasedTimeoutPolicies');

const COLLECTION = 'activityBasedTimeoutPolicies';

/** The paths this file answers; ResolverTable.resolveUri routes them here (same literal there). */
export const DEPTH10_SC_URI = /^\/(?:v1\.0|beta)\/policies\/activityBasedTimeoutPolicies(?:\/([^/]+))?$/;

export interface Depth10ScContext {
  store: ObjectStore;
  auditWriter?: DirectoryAuditWriter;
}

type Row = Record<string, unknown>;

function bodyOf(body: unknown, where: string): Row {
  let b = body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b) as unknown;
    } catch {
      throw new BadRequestError(`${where}: the body is not JSON`);
    }
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestError(`${where}: the body must be a JSON object`);
  return { ...(b as Row) };
}

const TIMESPAN = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})$/;

/** Seconds in a "[d.]hh:mm:ss" duration, or undefined when malformed. */
export function timespanSeconds(v: unknown): number | undefined {
  const m = typeof v === 'string' ? TIMESPAN.exec(v) : null;
  if (!m) return undefined;
  const [d, h, min, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3]), Number(m[4])];
  if (h > 23 || min > 59 || s > 59) return undefined;
  return ((d * 24 + h) * 60 + min) * 60 + s;
}

/** A PowerShell one-element array can arrive as { value: [...], Count } after ConvertTo-Json. */
function unwrap(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Row;
    if (Array.isArray(o.value) && typeof o.Count === 'number' && Object.keys(o).length === 2) return o.value;
  }
  return v;
}

function validateDefinition(raw: unknown, where: string): string[] {
  const def = unwrap(raw);
  const list = typeof def === 'string' ? [def] : def;
  if (!Array.isArray(list) || list.length !== 1 || typeof list[0] !== 'string') {
    throw new BadRequestError(`${where}: definition must be a string collection holding one JSON string`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(list[0]);
  } catch {
    throw new BadRequestError(`${where}: definition[0] is not JSON`);
  }
  const policy = (parsed as Row | null)?.ActivityBasedTimeoutPolicy as Row | undefined;
  if (!policy || policy.Version !== 1) throw new BadRequestError(`${where}: definition needs ActivityBasedTimeoutPolicy with Version 1`);
  const apps = policy.ApplicationPolicies;
  if (!Array.isArray(apps) || apps.length === 0) throw new BadRequestError(`${where}: ApplicationPolicies must list at least one application policy`);
  for (const a of apps as Row[]) {
    if (typeof a?.ApplicationId !== 'string' || !a.ApplicationId) throw new BadRequestError(`${where}: each application policy needs an ApplicationId`);
    const secs = timespanSeconds(a.WebSessionIdleTimeout);
    if (secs === undefined) throw new BadRequestError(`${where}: WebSessionIdleTimeout '${String(a.WebSessionIdleTimeout)}' is not dd.hh:mm:ss`);
    if (secs < 300 || secs > 86_400) throw new BadRequestError(`${where}: WebSessionIdleTimeout must be between 00:05:00 and one day`);
  }
  return [list[0]];
}

async function assertOneDefault(store: ObjectStore, selfId: string | undefined, where: string): Promise<void> {
  const other = (await store.list(COLLECTION)).find((p) => p.id !== selfId && (p as Row).isOrganizationDefault === true);
  if (other) throw new BadRequestError(`${where}: policy '${String((other as Row).displayName ?? other.id)}' is already the organization default`);
}

async function audit(ctx: Depth10ScContext, id: string, verb: 'POST' | 'PATCH' | 'DELETE', where: string): Promise<void> {
  await ctx.auditWriter?.recordMutation({ objectType: COLLECTION, objectId: id, activityDisplayName: `${verb} ${where}`, requestVerb: verb, source: `Invoke-MgGraphRequest ${verb} ${where}` });
}

/** Resolves one call whose normalized path matches DEPTH10_SC_URI. */
export async function resolveDepth10Sc(ctx: Depth10ScContext, method: string, normalized: string, body?: unknown): Promise<unknown> {
  const m = DEPTH10_SC_URI.exec(normalized);
  if (!m) throw new NotFoundError(`${method} ${normalized}: not a DEPTH-10.4 resource`);
  const id = m[1] !== undefined ? decodeURIComponent(m[1]) : undefined;
  const verb = method.toUpperCase();
  const where = `${verb} ${normalized}`;
  const { store } = ctx;
  const find = async (): Promise<StoreObject> => {
    const row = id === undefined ? undefined : await store.read(COLLECTION, id);
    if (!row) throw new NotFoundError(`${where}: no activityBasedTimeoutPolicy with id '${String(id)}'`);
    return row;
  };

  if (verb === 'GET') return id === undefined ? { value: await store.list(COLLECTION) } : find();

  if (verb === 'POST') {
    if (id !== undefined) throw new BadRequestError(`${where}: POST creates on the collection, not on one policy`);
    const b = bodyOf(body, where);
    if (typeof b.displayName !== 'string' || !b.displayName) throw new BadRequestError(`${where}: displayName is required`);
    const definition = validateDefinition(b.definition, where);
    const isDefault = b.isOrganizationDefault === true;
    if (isDefault) await assertOneDefault(store, undefined, where);
    const row: StoreObject = {
      id: randomUUID(),
      deletedDateTime: null,
      displayName: b.displayName,
      definition,
      isOrganizationDefault: isDefault,
      ...(typeof b.description === 'string' ? { description: b.description } : {}),
    };
    await store.create(COLLECTION, row);
    await audit(ctx, row.id, 'POST', normalized);
    return row;
  }

  if (verb === 'PATCH') {
    const existing = await find();
    const b = bodyOf(body, where);
    delete b.id;
    if (b.definition !== undefined) b.definition = validateDefinition(b.definition, where);
    if (b.isOrganizationDefault === true) await assertOneDefault(store, existing.id, where);
    await store.update(COLLECTION, existing.id, b as Partial<StoreObject>);
    await audit(ctx, existing.id, 'PATCH', normalized);
    return null; // 204 No Content, as on Graph
  }

  if (verb === 'DELETE') {
    const existing = await find();
    await store.delete(COLLECTION, existing.id);
    await audit(ctx, existing.id, 'DELETE', normalized);
    return null;
  }

  throw new BadRequestError(`${where}: method not supported`);
}
