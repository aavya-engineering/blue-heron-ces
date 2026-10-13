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
