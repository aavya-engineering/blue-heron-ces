// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../store/StoreTypes.js';

/**
 * SIMFIX FIX-S1 (2026-09-27, data safety): target resolution for cmdlets and
 * URIs that NAME the object they act on.
 *
 * The defect this closes: a named-cmdlet mutation ignored its own
 * `-UserId <UPN>` (or any `-…Id`) argument and acted on the entry's fixed
 * `singletonId` - for `Remove-MgUser` that is `user-1` (the derived
 * `seededSingletonId`), so AO op A-03 ("hard delete sim.user5") deleted
 * user-1. The same fallback existed on reads (`Get-MgUser -UserId x`
 * returned the WHOLE collection, whose `.Id` then fed later writes), on
 * `-Identity` reads that matched nothing (whole collection returned), and on
 * dynamic-id URI mutations (`PATCH /v1.0/users/<upn>` upserted a phantom user
 * keyed by the UPN string; `DELETE` silently no-oped).
 *
 * The rule, applied everywhere a call names a target:
 *  - resolve the named value against the target's collection by `id` or by
 *    the collection's REAL alternate key (users: userPrincipalName - Graph
 *    accepts `/users/{id | userPrincipalName}`; Exchange/Purview -Identity:
 *    Identity/Name/DisplayName/Guid/id; SharePoint -Identity/-Site: Url/id);
 *  - exactly one match -> act on that object and nothing else;
 *  - no match -> NotFoundError (HTTP 404 from the sim), store unchanged;
 *  - NEVER fall back to a singleton id or the first object when a target was
 *    supplied. Only a call that names no target keeps the legacy singleton
 *    collapse (e.g. `Set-AzFirewall -AzureFirewall $fw`).
 */

/** Error the QueryServer maps to HTTP 404 (real Graph: Request_ResourceNotFound). */
export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) {
    super(`Request_ResourceNotFound: ${message}`);
    this.name = 'NotFoundError';
  }
}

/** FX-10: error the QueryServer maps to HTTP 400 (real Graph: Request_BadRequest). */
export class BadRequestError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(`Request_BadRequest: ${message}`);
    this.name = 'BadRequestError';
  }
}

export interface TargetParamSpec {
  /** Store collection that holds the named object. */
  collection: string;
  /** Alternate keys (besides `id`) the real API accepts for this parameter. Case-insensitive match. */
  altKeys: string[];
}

/**
 * Parameters that NAME the object a cmdlet acts on, keyed by lower-cased
 * parameter name. Payload parameters that merely REFERENCE another object
 * (`-DirectoryObjectId` = the member being added, `-KeyId`, `-UserIds`,
 * `-TargetResourceId`, `-StorageId`, ...) are deliberately absent.
 *
 * Alternate keys are only the ones the real API accepts: Graph's
 * `/users/{id | userPrincipalName}` is the one Graph alternate key in this
 * table; every other Graph object (groups, devices, policies, apps, alerts)
 * is id-addressed only, exactly like the real service.
 */
export const TARGET_PARAMS: Record<string, TargetParamSpec> = {
  userid: { collection: 'users', altKeys: ['userPrincipalName'] },
  groupid: { collection: 'groups', altKeys: [] },
  manageddeviceid: { collection: 'managedDevices', altKeys: [] },
  conditionalaccesspolicyid: { collection: 'caPolicies', altKeys: [] },
  namedlocationid: { collection: 'namedLocations', altKeys: [] },
  applicationid: { collection: 'applications', altKeys: [] },
  serviceprincipalid: { collection: 'servicePrincipals', altKeys: [] },
  devicecompliancepolicyid: { collection: 'deviceCompliancePolicies', altKeys: [] },
  alertid: { collection: 'alerts', altKeys: [] },
  incidentid: { collection: 'securityIncidents', altKeys: [] },
  // SharePoint Online addresses a site by its URL (Get-SPOUser -Site <url>).
  site: { collection: 'spoSites', altKeys: ['Url'] },
  directorysettingid: { collection: 'directorySettings', altKeys: [] },
  androidmanagedappprotectionid: { collection: 'androidManagedAppProtections', altKeys: [] },
  iosmanagedappprotectionid: { collection: 'iosManagedAppProtections', altKeys: [] },
  authenticationmethodconfigurationid: { collection: 'authenticationMethodsPolicyConfigurations', altKeys: [] },
  // W5c2 follow-up 6 (SIM-B1): Get-MgDirectoryRoleMember -DirectoryRoleId <id>
  // reads only that role's members (records carry directoryRoleId).
  directoryroleid: { collection: 'directoryRole', altKeys: [] },
};

/** Exchange Online / Purview `-Identity` accepts any of these (case-insensitive). */
export const IDENTITY_ALT_KEYS = ['identity', 'name', 'displayname', 'guid', 'id', 'userprincipalname', 'url'];

export interface CmdletTarget {
  /** Parameter name as written by the caller (without the dash). */
  param: string;
  /** Unquoted value the caller passed. */
  value: string;
  /** Spec for a TARGET_PARAMS parameter; undefined for `-Identity`/Az `-Name` (resolved in the entry's own collection). */
  spec?: TargetParamSpec;
  /** Alternate keys for an entry-collection target (Az `-Name` -> name). Default: IDENTITY_ALT_KEYS. */
  altKeys?: string[];
}

/**
 * Az read cmdlets address ONE resource by `-Name` (Get-AzFirewall -Name x,
 * Get-AzVirtualNetwork -Name x, Get-AzKeyVault -VaultName x). Returning the
 * whole collection handed callers an array - AO F-11's `$fw.Deallocate()`
 * then ran against every firewall, including one a different script had
 * created. `*Config` getters (Get-AzVirtualNetworkSubnetConfig -Name <subnet>)
 * name a sub-object, not the resource, and are excluded.
 */
export const AZ_NAMED_GETS = new Set([
  'Get-AzFirewall',
  'Get-AzVirtualNetwork',
  'Get-AzNetworkSecurityGroup',
  'Get-AzPublicIpAddress',
  'Get-AzStorageAccount',
  'Get-AzKeyVault',
  'Get-AzOperationalInsightsWorkspace',
  'Get-AzRouteTable',
  'Get-AzAutomationAccount',
]);

/**
 * Only the resource getters whose `-Name`/`-VaultName` names the resource
 * itself (and whose collection the sim seeds). Sub-resource getters that also
 * take -Name (Get-AzOperationalInsightsWorkspaceSharedKey -Name <workspace>,
 * Get-AzVMExtension -Name <extension>) are deliberately excluded.
 */
export function isAzNamedGet(cmdlet: string | undefined): boolean {
  return !!cmdlet && AZ_NAMED_GETS.has(cmdlet);
}

function unquote(v: string): string {
  return v.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Finds the parameter that names the call's target object: `-Identity`, or
 * the first `-<X>Id` listed in TARGET_PARAMS, whichever appears first. A
 * target whose value is not a scalar string (e.g. `$null`, an array) is
 * ignored rather than guessed at.
 */
export function findCmdletTarget(args: unknown, cmdlet?: string): CmdletTarget | undefined {
  if (!Array.isArray(args)) return undefined;
  const azNamed = isAzNamedGet(cmdlet);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string' || !/^-[A-Za-z]/.test(a)) continue;
    let name = a.slice(1);
    let value: unknown;
    const colon = name.indexOf(':');
    if (colon > 0) {
      const inline = name.slice(colon + 1);
      name = name.slice(0, colon);
      value = inline.length > 0 ? inline : args[i + 1];
    } else {
      value = args[i + 1];
    }
    const lc = name.toLowerCase();
    const azName = azNamed && (lc === 'name' || lc === 'vaultname');
    // TARGET_PARAMS name Graph/Entra objects: only Graph SDK (-Mg) cmdlets
    // and cmdlets with no module marker use them (Az's -GroupId on
    // New-AzPrivateLinkServiceConnection is a private-link sub-resource name).
    const graphParam = !!TARGET_PARAMS[lc] && !(cmdlet && /^[A-Za-z]+-Az[A-Z]/.test(cmdlet));
    if (lc !== 'identity' && !graphParam && !azName) continue;
    if (typeof value === 'number') value = String(value);
    if (typeof value !== 'string' || /^-[A-Za-z]/.test(value)) continue;
    const v = unquote(value);
    if (v.length === 0) continue;
    if (azName) return { param: name, value: v, altKeys: ['name'] };
    if (lc === 'identity') return { param: name, value: v };
    return { param: name, value: v, spec: TARGET_PARAMS[lc] };
  }
  return undefined;
}

/**
 * PH-13 P13-REG (LOG-PH12-AO.md STOP 2): the target parameter a call NAMES but
 * leaves without a value - `-ManagedDeviceId $null` (the shim forwards a JSON
 * null), `-UserId ''`, a parameter followed straight by the next `-Param`, or a
 * parameter that ends the call. findCmdletTarget skips such a parameter, so the
 * call would fall through to the generic upsert and create an object; real
 * Graph refuses it (400). Returns the parameter as written (no dash), or
 * undefined when no named target parameter is empty. Same parameter set as
 * findCmdletTarget: `-Identity` and the Graph TARGET_PARAMS (not on Az cmdlets).
 */
export function emptyNamedTarget(args: unknown, cmdlet?: string): string | undefined {
  if (!Array.isArray(args)) return undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string' || !/^-[A-Za-z]/.test(a)) continue;
    let name = a.slice(1);
    let value: unknown;
    const colon = name.indexOf(':');
    if (colon > 0) {
      const inline = name.slice(colon + 1);
      name = name.slice(0, colon);
      value = inline.length > 0 ? inline : args[i + 1];
    } else {
      value = args[i + 1];
    }
    const lc = name.toLowerCase();
    const graphParam = !!TARGET_PARAMS[lc] && !(cmdlet && /^[A-Za-z]+-Az[A-Z]/.test(cmdlet));
    if (lc !== 'identity' && !graphParam) continue;
    if (value === null || value === undefined) return name;
    if (typeof value === 'number') continue;
    if (typeof value !== 'string') continue;
    if (/^-[A-Za-z]/.test(value) || unquote(value).length === 0) return name;
  }
  return undefined;
}

/** Case-insensitive property read. */
function prop(o: Record<string, unknown>, lcKey: string): unknown {
  const k = Object.keys(o).find((key) => key.toLowerCase() === lcKey);
  return k === undefined ? undefined : o[k];
}

/**
 * Exactly-one match of `value` in `objects` by `id` (exact) or by one of the
 * alternate keys (case-insensitive, the way Graph treats UPNs and EXO treats
 * identities). Returns undefined when nothing matches. Throws when an
 * alternate key is ambiguous (two objects share it) - acting on either would
 * be a guess.
 */
export function matchTarget(objects: StoreObject[], value: string, altKeys: string[]): StoreObject | undefined {
  const byId = objects.find((o) => o.id === value);
  if (byId) return byId;
  const lcValue = value.toLowerCase();
  const lcKeys = altKeys.map((k) => k.toLowerCase());
  const hits = objects.filter((o) =>
    lcKeys.some((k) => {
      const v = prop(o as Record<string, unknown>, k);
      return typeof v === 'string' && v.toLowerCase() === lcValue;
    }),
  );
  if (hits.length > 1) {
    throw new Error(`ambiguous target "${value}": ${hits.length} objects share that key (${hits.map((h) => h.id).join(', ')})`);
  }
  return hits[0];
}

/** Alternate keys a collection's item-level URI accepts (`/users/{id | userPrincipalName}`). */
export const URI_ALT_KEYS: Record<string, string[]> = {
  users: ['userPrincipalName'],
  // az CLI addresses Key Vault keys and Log Analytics workspaces by NAME.
  keyVaultKeys: ['name'],
  logAnalyticsWorkspaces: ['name'],
};

/**
 * OData `$filter` support for URI collection GETs: `field eq 'v'` / bare
 * literal, joined by `and`. Returns `undefined` when the expression uses
 * anything else (the caller then leaves the collection unfiltered - recorded
 * as a known limit in docs/SIM-FIX-REPORT-2026-09.md), so a supported filter
 * is always applied and an unsupported one is never half-applied.
 */
export function parseODataEqFilter(expr: string): Array<{ field: string; value: string }> | undefined {
  const clauses = expr.split(/\s+and\s+/i);
  const out: Array<{ field: string; value: string }> = [];
  for (const c of clauses) {
    const m = /^\s*([\w./]+)\s+eq\s+(?:'((?:[^']|'')*)'|\$?([^'\s]+))\s*$/i.exec(c);
    if (!m) return undefined;
    out.push({ field: m[1], value: m[2] !== undefined ? m[2].replace(/''/g, "'") : m[3] });
  }
  return out;
}

export function applyODataEqFilter<T>(data: T[], clauses: Array<{ field: string; value: string }>): T[] {
  return data.filter((o) => {
    if (!o || typeof o !== 'object') return false;
    return clauses.every(({ field, value }) => {
      let cur: unknown = o;
      for (const part of field.split(/[./]/)) {
        if (!cur || typeof cur !== 'object') return false;
        cur = prop(cur as Record<string, unknown>, part.toLowerCase());
      }
      return cur !== undefined && String(cur) === value;
    });
  });
}

/**
 * EO-collection B20 / W2.1 (2026-10-27): the URI `$filter` grammar the sim
 * honours, and the ONLY one - anything outside it is a 400, never the whole
 * collection.
 *
 *   filter  := clause ( 'and' clause )*
 *   clause  := field op literal
 *   field   := [\w./]+            (a/b or a.b walks a nested property)
 *   op      := eq | ne | ge | gt | le | lt        (case-insensitive)
 *   literal := 'quoted' ('' escapes ') | bare token (true, 42, $true,
 *              2026-10-01T00:00:00Z - OData datetime literals are unquoted)
 *
 * eq/ne compare by string form (as before). ge/gt/le/lt compare as instants
 * when the literal is an ISO date-time (both sides through Date.parse) and
 * numerically when it is a number; any other literal is a 400. A row whose
 * field is missing or not comparable is excluded by every operator but `ne`
 * (OData: null ne 'x' is true). `or`, `not`, parentheses and functions
 * (startswith, any, contains) are not supported.
 */
export type ODataFilterOp = 'eq' | 'ne' | 'ge' | 'gt' | 'le' | 'lt';
export interface ODataFilterClause {
  field: string;
  op: ODataFilterOp;
  value: string;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const NUMBER_LITERAL = /^-?\d+(\.\d+)?$/;

/** Parses a URI `$filter`; throws BadRequestError (HTTP 400) for anything outside the grammar above. */
export function parseODataFilter(expr: string): ODataFilterClause[] {
  const clauses = splitOnAnd(expr.trim());
  const out: ODataFilterClause[] = [];
  for (const c of clauses) {
    const m = /^\s*([\w./]+)\s+(eq|ne|ge|gt|le|lt)\s+(?:'((?:[^']|'')*)'|\$?([^'\s()]+))\s*$/i.exec(c);
    if (!m) {
      throw new BadRequestError(
        `Invalid filter clause: '${c.trim()}' is not supported by the sim (supported: field eq|ne|ge|gt|le|lt literal, joined by 'and')`,
      );
    }
    const op = m[2].toLowerCase() as ODataFilterOp;
    const value = m[3] !== undefined ? m[3].replace(/''/g, "'") : m[4];
    if ((op === 'ge' || op === 'gt' || op === 'le' || op === 'lt') && !ISO_DATETIME.test(value) && !NUMBER_LITERAL.test(value)) {
      throw new BadRequestError(`Invalid filter clause: '${c.trim()}': operator '${op}' needs a date-time or number literal`);
    }
    out.push({ field: m[1], op, value });
  }
  return out;
}

/** Splits on the `and` keyword outside quoted literals ('...' with '' escapes), so `displayName eq 'A and B'` stays one clause. */
function splitOnAnd(expr: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'") {
      if (inQuote && expr[i + 1] === "'") {
        i++;
        continue;
      }
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      const m = /^\s+and\s+/i.exec(expr.slice(i));
      if (m) {
        out.push(expr.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  out.push(expr.slice(start));
  return out;
}

function compareRange(actual: unknown, literal: string): number | undefined {
  if (ISO_DATETIME.test(literal)) {
    if (typeof actual !== 'string') return undefined;
    const a = Date.parse(actual);
    const b = Date.parse(literal);
    return Number.isNaN(a) || Number.isNaN(b) ? undefined : a - b;
  }
  const a = typeof actual === 'number' ? actual : typeof actual === 'string' && NUMBER_LITERAL.test(actual) ? Number(actual) : NaN;
  return Number.isNaN(a) ? undefined : a - Number(literal);
}

export function applyODataFilter<T>(data: T[], clauses: ODataFilterClause[]): T[] {
  return data.filter((o) => {
    if (!o || typeof o !== 'object') return false;
    return clauses.every(({ field, op, value }) => {
      let cur: unknown = o;
      for (const part of field.split(/[./]/)) {
        if (!cur || typeof cur !== 'object') {
          cur = undefined;
          break;
        }
        cur = prop(cur as Record<string, unknown>, part.toLowerCase());
      }
      const present = cur !== undefined && cur !== null;
      if (op === 'eq') return present && String(cur) === value;
      if (op === 'ne') return !present || String(cur) !== value;
      if (!present) return false;
      const d = compareRange(cur, value);
      if (d === undefined) return false;
      return op === 'ge' ? d >= 0 : op === 'gt' ? d > 0 : op === 'le' ? d <= 0 : d < 0;
    });
  });
}

/** Extracts and decodes the `$filter` query parameter from a raw URI, if any. */
export function extractODataFilter(uri: string): string | undefined {
  const q = uri.indexOf('?');
  if (q === -1) return undefined;
  for (const part of uri.slice(q + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    let key: string;
    let val: string;
    try {
      key = decodeURIComponent(part.slice(0, eq));
      val = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    } catch {
      continue;
    }
    if (key === '$filter' || key === '`$filter') return val;
  }
  return undefined;
}
