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
 * DEPTH-10.2 (2026-11-01, PH-12 P12-R1): the Microsoft Graph writes the new and re-aimed IA registry
 * entries send, with the service's own semantics, so a GET after a SET reads the SET's state back
 * (ces-strategy `docs/context/finish/LOG-PH12-R1.md`). ResolverTable.resolveUri asks this module
 * first; `undefined` means "not mine" and the table's own entries answer as before (the list read
 * `GET /v1.0/groupSettings` stays graphResolvers.ts's).
 *  - Directory settings (`/v1.0/groupSettings`, collection `directorySettings`, the objects the
 *    seeded "Password Rule Settings" live in):
 *      POST creates one setting from a template (`templateId`, `values` [{ name, value }]); a second
 *      setting for the same template is a 400, as Graph refuses it. PATCH `/{id}` replaces the
 *      `values` list (Graph requires the whole list); values are stored as strings, as Graph returns
 *      them. GET `/{id}` reads one; an unknown id is a 404.
 *  - Intune enrollment configurations (`/v1.0/deviceManagement/deviceEnrollmentConfigurations`,
 *    collection `deviceEnrollmentConfigurations`): every tenant has the default Windows Hello for
 *    Business configuration (`<tenant>_DefaultWindowsHelloForBusiness`, priority 0, state
 *    `notConfigured` until an admin sets it). The list read includes it (synthesised from the
 *    service default when the seed holds none); PATCH `/{id}` stores the change (state must be
 *    notConfigured / enabled / disabled; pinMinimumLength 4..127); GET `/{id}` reads one.
 */

registerObjectType('directorySettings');
registerObjectType('deviceEnrollmentConfigurations');

/** The Graph paths this module answers (method, pattern; `*` = one id segment), for readers of the resolver set. */
export const DEPTH10_IA_URIS: ReadonlyArray<{ method: 'GET' | 'POST' | 'PATCH'; pattern: string }> = [
  { method: 'POST', pattern: '/v1.0/groupSettings' },
  { method: 'GET', pattern: '/v1.0/groupSettings/*' },
  { method: 'PATCH', pattern: '/v1.0/groupSettings/*' },
  { method: 'GET', pattern: '/v1.0/deviceManagement/deviceEnrollmentConfigurations' },
  { method: 'GET', pattern: '/v1.0/deviceManagement/deviceEnrollmentConfigurations/*' },
  { method: 'PATCH', pattern: '/v1.0/deviceManagement/deviceEnrollmentConfigurations/*' },
];

export interface Depth10IaContext {
  store: ObjectStore;
  auditWriter?: DirectoryAuditWriter;
}

type Row = Record<string, unknown>;

const SETTINGS = /^\/(?:v1\.0|beta)\/groupSettings(?:\/([^/]+))?$/;
const ENROLLMENT = /^\/v1\.0\/deviceManagement\/deviceEnrollmentConfigurations(?:\/([^/]+))?$/;
const WHFB_TYPE = '#microsoft.graph.deviceEnrollmentWindowsHelloForBusinessConfiguration';
const WHFB_DEFAULT_SUFFIX = '_DefaultWindowsHelloForBusiness';
const TEMPLATE_NAMES: Record<string, string> = {
  '5cf42378-d67d-4f36-ba46-e8b86229381d': 'Password Rule Settings',
  '62375ab9-6b52-47ed-826b-58e47e0e304b': 'Group.Unified',
};

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function bodyObject(body: unknown): Row {
  let b = body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      throw new BadRequestError('the request body is not JSON');
    }
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestError('the request body must be an object');
  return b as Row;
}

function unwrap(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Row;
    if (Array.isArray(o.value) && typeof o.Count === 'number' && Object.keys(o).length === 2) return o.value;
  }
  return v;
}

/** Graph's `values` list: [{ name, value }], every value a string. */
function settingValues(v: unknown, where: string): Array<{ name: string; value: string }> {
  const list = unwrap(v);
  if (!Array.isArray(list)) throw new BadRequestError(`${where}: values must be a list of { name, value }`);
  return list.map((x) => {
    if (!x || typeof x !== 'object' || typeof (x as Row).name !== 'string') throw new BadRequestError(`${where}: every value needs a name`);
    const raw = (x as Row).value;
    const value = typeof raw === 'boolean' ? (raw ? 'True' : 'False') : raw === null || raw === undefined ? '' : String(raw);
    return { name: (x as Row).name as string, value };
  });
}

async function audit(ctx: Depth10IaContext, objectType: string, objectId: string, verb: 'POST' | 'PATCH', source: string) {
  await ctx.auditWriter?.recordMutation({ objectType, objectId, activityDisplayName: `${verb} ${source}`, requestVerb: verb, source });
}

async function whfbDefault(store: ObjectStore): Promise<Row> {
  const org = (await store.list('organization'))[0] as Row | undefined;
  const tenant = String(org?.id ?? 'sim-tenant');
  return {
    '@odata.type': WHFB_TYPE,
    id: `${tenant}${WHFB_DEFAULT_SUFFIX}`,
    displayName: 'All users and all devices',
    description: 'This is the default Windows Hello for Business configuration applied with the lowest priority to all users regardless of group membership.',
    priority: 0,
    version: 1,
    deviceEnrollmentConfigurationType: 'windowsHelloForBusiness',
    state: 'notConfigured',
    pinMinimumLength: 4,
    pinMaximumLength: 127,
    pinUppercaseCharactersUsage: 'disallowed',
    pinLowercaseCharactersUsage: 'disallowed',
    pinSpecialCharactersUsage: 'disallowed',
    securityDeviceRequired: false,
    unlockWithBiometricsEnabled: true,
    remotePassportEnabled: true,
    pinPreviousBlockCount: 0,
    pinExpirationInDays: 0,
    enhancedBiometricsState: 'notConfigured',
  };
}

/** The enrollment configurations the tenant has: the stored ones plus the service default WHfB one. */
async function enrollmentConfigs(store: ObjectStore): Promise<Row[]> {
  const rows = (await store.list('deviceEnrollmentConfigurations')) as Row[];
  if (rows.some((r) => String(r.id).endsWith(WHFB_DEFAULT_SUFFIX))) return rows;
  return [await whfbDefault(store), ...rows];
}

const WHFB_STATES = new Set(['notConfigured', 'enabled', 'disabled']);

/** Answers one DEPTH-10.2 Graph request, or undefined when the request is not one of them. */
export async function resolveDepth10IaUri(ctx: Depth10IaContext, method: string, normalized: string, body: unknown): Promise<unknown> {
  const { store } = ctx;

  const s = SETTINGS.exec(normalized);
  if (s) {
    const id = s[1] !== undefined ? decode(s[1]) : undefined;
    if (id === undefined) {
      if (method !== 'POST') return undefined; // the list read stays graphResolvers.ts's
      const b = bodyObject(body);
      const templateId = typeof b.templateId === 'string' ? b.templateId : '';
      if (!templateId) throw new BadRequestError(`POST ${normalized}: templateId is required`);
      const all = (await store.list('directorySettings')) as Row[];
      if (all.some((r) => String(r.templateId).toLowerCase() === templateId.toLowerCase())) {
        throw new BadRequestError(`POST ${normalized}: a setting for template ${templateId} already exists (Request_BadRequest: A conflicting object with one or more of the specified property values is present in the directory)`);
      }
      const row: StoreObject = {
        id: randomUUID(),
        displayName: TEMPLATE_NAMES[templateId.toLowerCase()] ?? (typeof b.displayName === 'string' ? b.displayName : templateId),
        templateId,
        values: settingValues(b.values ?? [], `POST ${normalized}`),
      };
      const created = await store.create('directorySettings', row);
      await audit(ctx, 'directorySettings', created.id, 'POST', `Invoke-MgGraphRequest POST ${normalized}`);
      return created;
    }
    const found = ((await store.list('directorySettings')) as Row[]).find((r) => String(r.id).toLowerCase() === id.toLowerCase());
    if (!found) throw new NotFoundError(`${method} ${normalized}: no directory setting with id "${id}" (Request_ResourceNotFound)`);
    if (method === 'GET') return found;
    if (method === 'PATCH') {
      const b = bodyObject(body);
      if (b.values === undefined) throw new BadRequestError(`PATCH ${normalized}: values is required`);
      await store.update('directorySettings', String(found.id), { values: settingValues(b.values, `PATCH ${normalized}`) } as Partial<StoreObject>);
      await audit(ctx, 'directorySettings', String(found.id), 'PATCH', `Invoke-MgGraphRequest PATCH ${normalized}`);
      return null; // Graph answers 204 No Content
    }
    throw new BadRequestError(`${method} ${normalized}: a directory setting supports GET and PATCH`);
  }

  const e = ENROLLMENT.exec(normalized);
  if (e) {
    const id = e[1] !== undefined ? decode(e[1]) : undefined;
    const configs = await enrollmentConfigs(store);
    if (id === undefined) {
      if (method !== 'GET') throw new BadRequestError(`${method} ${normalized}: the simulator models reading the list and updating one configuration`);
      return { value: configs };
    }
    const found = configs.find((r) => String(r.id).toLowerCase() === id.toLowerCase());
    if (!found) throw new NotFoundError(`${method} ${normalized}: no enrollment configuration with id "${id}" (ResourceNotFound)`);
    if (method === 'GET') return found;
    if (method === 'PATCH') {
      const { id: _id, ...patch } = bodyObject(body);
      const type = patch['@odata.type'];
      if (type !== undefined && type !== found['@odata.type']) throw new BadRequestError(`PATCH ${normalized}: @odata.type ${String(type)} does not match ${String(found['@odata.type'])}`);
      if (found['@odata.type'] === WHFB_TYPE) {
        if (patch.state !== undefined && !WHFB_STATES.has(String(patch.state))) throw new BadRequestError(`PATCH ${normalized}: state must be notConfigured, enabled or disabled`);
        if (patch.pinMinimumLength !== undefined && !(Number(patch.pinMinimumLength) >= 4 && Number(patch.pinMinimumLength) <= 127)) {
          throw new BadRequestError(`PATCH ${normalized}: pinMinimumLength must be 4..127`);
        }
      }
      const stored = ((await store.list('deviceEnrollmentConfigurations')) as Row[]).some((r) => r.id === found.id);
      const next = { ...found, ...patch, id: found.id } as StoreObject;
      if (stored) await store.update('deviceEnrollmentConfigurations', String(found.id), next);
      else await store.create('deviceEnrollmentConfigurations', next);
      await audit(ctx, 'deviceEnrollmentConfigurations', String(found.id), 'PATCH', `Invoke-MgGraphRequest PATCH ${normalized}`);
      return null; // Graph answers 204 No Content
    }
    throw new BadRequestError(`${method} ${normalized}: an enrollment configuration supports GET and PATCH`);
  }

  return undefined;
}
