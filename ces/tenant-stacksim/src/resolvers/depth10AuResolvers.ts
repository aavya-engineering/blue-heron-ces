// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { ObjectStore } from '../store/ObjectStore.js';
import type { StoreObject } from '../store/StoreTypes.js';
import type { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import type { NamedCmdletResolverEntry } from './types.js';
import { registerObjectType } from '../store/schemas.js';
import { BadRequestError, NotFoundError } from './targets.js';

/**
 * DEPTH-10.1 (2026-11-01, PH-12 P12-R1): the Exchange Online / Security & Compliance cmdlets the
 * new AU registry entries send, with the service's own semantics, so a GET after a SET reads the
 * SET's state back (ces-strategy `docs/context/finish/LOG-PH12-R1.md`):
 *  - Set-OrganizationConfig: sets the named parameters on the tenant's ONE organization config
 *    (the object Get-OrganizationConfig reads; base seed `organizationConfig`). AU.L2-3.3.2's
 *    mailbox-audit-default entry sends `-AuditDisabled $false`. A tenant with no organization
 *    config is a 404, as Enable-OrganizationCustomization is.
 *  - New-ProtectionAlert: a Purview alert policy in the collection Get-ProtectionAlert reads
 *    (`protectionAlert`), keyed by -Name (a second policy with the same name is a 400, as the
 *    service answers). Disabled false, IsSystemRule false and NotificationEnabled true are what
 *    the service sets for a new custom policy; -Operation and -NotifyUser are stored as lists.
 *
 * The entries are spread into exoResolvers.ts's manual list, so the generated
 * ExchangeOnlineManagement module exports a wrapper for each and no derived twin is generated.
 */

registerObjectType('organizationConfig');
registerObjectType('protectionAlert');

export const DEPTH10_AU_EXO_ENTRIES: NamedCmdletResolverEntry[] = [
  {
    kind: 'cmdlet',
    cmdlet: 'Set-OrganizationConfig',
    endpoint: 'exo:Set-OrganizationConfig',
    collection: 'organizationConfig',
    verb: 'PATCH',
    azureTier: 'none',
    mutationVerbs: ['PATCH'],
  },
  {
    kind: 'cmdlet',
    cmdlet: 'New-ProtectionAlert',
    endpoint: 'ipps:New-ProtectionAlert',
    collection: 'protectionAlert',
    verb: 'POST',
    azureTier: 'none',
    mutationVerbs: ['POST'],
  },
];

export const DEPTH10_AU_CMDLETS: ReadonlySet<string> = new Set(DEPTH10_AU_EXO_ENTRIES.map((e) => e.cmdlet));

export interface Depth10AuContext {
  store: ObjectStore;
  auditWriter?: DirectoryAuditWriter;
}

type Row = Record<string, unknown>;

// ------------------------------------------------------------------ args (same rules as depthInfraResolvers.ts)

const isParam = (a: unknown): a is string => typeof a === 'string' && /^-[A-Za-z]/.test(a);

function unwrapPsArray(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Row;
    if (Array.isArray(o.value) && typeof o.Count === 'number' && Object.keys(o).length === 2) return o.value;
  }
  return v;
}

/** PowerShell's spelling of a boolean argument ($true / $false / 'True' / 'False') as a boolean. */
function psValue(v: unknown): unknown {
  if (typeof v === 'string') {
    const t = v.trim().replace(/^['"]|['"]$/g, '');
    if (/^\$?true$/i.test(t)) return true;
    if (/^\$?false$/i.test(t)) return false;
    return t;
  }
  return unwrapPsArray(v);
}

/** Every `-Name value` / `-Name:value` / bare `-Switch` pair of a call, in order. */
function namedArgs(args: unknown[]): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!isParam(a)) continue;
    const colon = a.indexOf(':');
    if (colon > 0) {
      out.push([a.slice(1, colon), psValue(a.slice(colon + 1))]);
    } else if (i + 1 < args.length && !isParam(args[i + 1])) {
      out.push([a.slice(1), psValue(args[i + 1])]);
      i++;
    } else {
      out.push([a.slice(1), true]);
    }
  }
  return out;
}

const COMMON_PARAMS = new Set(['erroraction', 'warningaction', 'confirm', 'whatif', 'verbose', 'debug', 'informationaction']);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

async function audit(ctx: Depth10AuContext, objectType: string, objectId: string, verb: 'POST' | 'PATCH', source: string) {
  await ctx.auditWriter?.recordMutation({ objectType, objectId, activityDisplayName: `${verb} ${source}`, requestVerb: verb, source });
}

/** Resolves one DEPTH10_AU_CMDLETS call against the store. */
export async function resolveDepth10Au(ctx: Depth10AuContext, name: string, rawArgs: unknown): Promise<unknown> {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const { store } = ctx;
  const pairs = namedArgs(args).filter(([k]) => !COMMON_PARAMS.has(k.toLowerCase()));

  switch (name) {
    case 'Set-OrganizationConfig': {
      const cfg = (await store.list('organizationConfig'))[0];
      if (!cfg) throw new NotFoundError(`${name}: no organizationConfig object`);
      if (pairs.length === 0) throw new BadRequestError(`${name}: no parameter to set`);
      const patch: Row = {};
      for (const [k, v] of pairs) {
        if (k.toLowerCase() === 'identity') continue;
        patch[k] = v;
      }
      await store.update('organizationConfig', cfg.id, patch as Partial<StoreObject>);
      await audit(ctx, 'organizationConfig', cfg.id, 'PATCH', name);
      // The real cmdlet writes nothing to the pipeline.
      return null;
    }
    case 'New-ProtectionAlert': {
      const fields = new Map(pairs.map(([k, v]) => [k.toLowerCase(), v] as const));
      const nm = fields.get('name');
      if (typeof nm !== 'string' || !nm) throw new BadRequestError(`${name}: -Name is required`);
      const existing = ((await store.list('protectionAlert')) as Row[]).find((p) => String(p.Name ?? p.id).toLowerCase() === nm.toLowerCase());
      if (existing) throw new BadRequestError(`${name}: an alert policy named '${nm}' already exists`);
      const row: StoreObject = {
        id: nm,
        Identity: nm,
        Name: nm,
        Category: fields.get('category') ?? 'Others',
        Severity: fields.get('severity') ?? 'Low',
        ThreatType: fields.get('threattype') ?? 'Activity',
        Operation: asList(fields.get('operation')),
        NotifyUser: asList(fields.get('notifyuser')),
        AggregationType: fields.get('aggregationtype') ?? 'None',
        Comment: fields.get('comment') ?? fields.get('description') ?? '',
        Disabled: fields.get('disabled') === true,
        IsSystemRule: false,
        NotificationEnabled: true,
        ...(fields.has('filter') ? { Filter: fields.get('filter') } : {}),
      };
      const created = await store.create('protectionAlert', row);
      await audit(ctx, 'protectionAlert', created.id, 'POST', name);
      return created;
    }
    default:
      throw new BadRequestError(`resolveDepth10Au: ${name} is not a DEPTH-10.1 cmdlet`);
  }
}
