// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { ObjectStore } from '../store/ObjectStore.js';
import type { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import { BadRequestError, NotFoundError, URI_ALT_KEYS, matchTarget } from './targets.js';

/**
 * PH-13 P13-LV (2026-11-01): the one Graph call of AdminOps A-22 (leaver access termination) that no
 * resolver served: deleting a registered MFA method,
 *   `DELETE /v1.0/users/{id | userPrincipalName}/authentication/{kind}Methods/{methodId}` (v1.0 and beta).
 * The other A-22 steps are cmdlets the simulator already serves (Update-MgUser, Revoke-MgUserSignInSession,
 * Get-MgUserMemberOf, Remove-MgGroupMemberByRef, Set-MgUserLicense, Get-MgUserAuthenticationMethod).
 * The `Remove-MgUserAuthentication<Kind>Method` cmdlets are not in coverage/inventory.json, so they have no
 * simulator shim; A-22 sends the REST form through Invoke-MgGraphRequest instead.
 *
 * Service semantics (Microsoft Learn, "Delete microsoftAuthenticatorAuthenticationMethod" and the phone, fido2,
 * softwareOath, email and windowsHelloForBusiness method deletes; "passwordAuthenticationMethod" has no delete):
 *  - unknown user, or no method of that kind with that id for that user: 404, store unchanged;
 *  - `passwordMethods`: 400 (the password method cannot be deleted);
 *  - success: the method row leaves `authMethods` (the collection Get-MgUserAuthenticationMethod reads,
 *    semantics.ts COLLECTION_REMAP), 204 No Content (null).
 * `temporaryAccessPassMethods` is aoResolvers.ts's (its own collection); this file never sees it, because the
 * AO hook runs first. Returns `undefined` for every other URI.
 */

export interface LeaverResolverContext {
  store: ObjectStore;
  auditWriter?: DirectoryAuditWriter;
}

const METHOD_URI = /^\/(?:v1\.0|beta)\/users\/([^/]+)\/authentication\/([A-Za-z0-9]+)Methods\/([^/]+)$/;

/** Path kind -> the `methodType` the seed stores (`#microsoft.graph.<kind>AuthenticationMethod`). */
const DELETABLE_KINDS = new Set(['microsoftAuthenticator', 'phone', 'fido2', 'softwareOath', 'email', 'windowsHelloForBusiness', 'platformCredential']);

function decode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function kindOf(row: Record<string, unknown>): string {
  if (typeof row.methodType === 'string' && row.methodType) return row.methodType;
  const t = String(row['@odata.type'] ?? '');
  return t.replace(/^#microsoft\.graph\./, '').replace(/AuthenticationMethod$/, '');
}

export async function resolveLeaverUri(ctx: LeaverResolverContext, method: string, normalized: string): Promise<unknown> {
  const m = METHOD_URI.exec(normalized);
  if (!m) return undefined;
  const kind = m[2];
  if (kind === 'temporaryAccessPass') return undefined;
  const where = `${method} ${normalized}`;
  if (method !== 'DELETE') return undefined; // reads of one method stay with the generic table
  if (kind === 'password') throw new BadRequestError(`${where}: the password authentication method cannot be deleted`);
  if (!DELETABLE_KINDS.has(kind)) throw new BadRequestError(`${where}: "${kind}Methods" is not a deletable authentication method kind`);
  const idOrUpn = decode(m[1]);
  const user = matchTarget(await ctx.store.list('users'), idOrUpn, URI_ALT_KEYS.users ?? []);
  if (!user) throw new NotFoundError(`${where}: no users object with id or userPrincipalName "${idOrUpn}"`);
  const methodId = decode(m[3]);
  const row = (await ctx.store.list('authMethods')).find((r) => {
    const o = r as Record<string, unknown>;
    return r.id === methodId && o.userId === user.id && kindOf(o) === kind;
  });
  if (!row) throw new NotFoundError(`${where}: user "${user.id}" has no ${kind} authentication method "${methodId}"`);
  await ctx.store.delete('authMethods', row.id);
  await ctx.auditWriter?.recordMutation({
    objectType: 'authMethods',
    objectId: row.id,
    activityDisplayName: `DELETE ${normalized}`,
    requestVerb: 'DELETE',
    source: `Invoke-MgGraphRequest DELETE ${normalized}`,
  });
  return null;
}
