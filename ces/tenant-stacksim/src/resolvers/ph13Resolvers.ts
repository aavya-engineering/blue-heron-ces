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
import { NotFoundError } from './targets.js';

/**
 * PH-13 (2026-11-01, P13-ST; founder Q3: an empty successful read is never evidence). The reads an
 * evidence-only registry entry sends that the simulator answered with nothing although the seeded tenant
 * holds the object, so the empty read was the simulator's, not the tenant's:
 *  - Get-AzSentinelDataConnector (Az.SecurityInsights; Stamper SI.L2-3.14.7.threat-intel's evidence read):
 *    the Microsoft Sentinel data connectors of the workspace, in the Az PowerShell shape (Name, Id, Kind,
 *    Type, Etag, DataTypes, TenantId). It reads the 'sentinelDataConnectors' collection that the
 *    customer seed fills (S1: Office 365 and Microsoft Defender XDR) and Stamper's
 *    AU.L2-3.3.3.sentinel-connector PUT writes (azCliResolvers.ts), so the list shows what was onboarded.
 *    The cmdlet's derived twin read a collection nothing writes, so every tenant read empty.
 *    -Name (or -Id) names ONE connector or is a 404, as Azure answers. A tenant without Sentinel (S2)
 *    has no connector and reads an empty list: that empty read is the tenant's honest answer.
 *    Learn: https://learn.microsoft.com/powershell/module/az.securityinsights/get-azsentineldataconnector
 */

export const PH13_CMDLETS: ReadonlySet<string> = new Set(['Get-AzSentinelDataConnector']);

export interface Ph13Context {
  store: ObjectStore;
}

type Row = Record<string, unknown>;

function param(args: unknown[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string' || !/^-[A-Za-z]/.test(a)) continue;
    const colon = a.indexOf(':');
    const key = (colon > 0 ? a.slice(1, colon) : a.slice(1)).toLowerCase();
    if (key !== name.toLowerCase()) continue;
    const v = colon > 0 ? a.slice(colon + 1) : args[i + 1];
    return typeof v === 'string' ? v.trim().replace(/^['"]|['"]$/g, '') : v === undefined ? undefined : String(v);
  }
  return undefined;
}

/** One stored connector in the Az PowerShell shape (PSSentinelDataConnector). */
function azShape(r: StoreObject, resourceGroup: string | undefined, workspace: string | undefined): Row {
  const props = (r.properties ?? {}) as Row;
  const name = String(r.name ?? r.id);
  return {
    Name: name,
    Id: resourceGroup && workspace
      ? `/resourceGroups/${resourceGroup}/providers/Microsoft.OperationalInsights/workspaces/${workspace}/providers/Microsoft.SecurityInsights/dataConnectors/${name}`
      : name,
    Kind: r.kind ?? null,
    Type: r.type ?? 'Microsoft.SecurityInsights/dataConnectors',
    Etag: r.etag ?? null,
    DataTypes: props.dataTypes ?? null,
    TenantId: props.tenantId ?? null,
  };
}

export async function resolvePh13(ctx: Ph13Context, cmdlet: string, rawArgs: unknown): Promise<unknown> {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  switch (cmdlet) {
    case 'Get-AzSentinelDataConnector': {
      const rg = param(args, 'ResourceGroupName');
      const ws = param(args, 'WorkspaceName');
      const rows = (await ctx.store.list('sentinelDataConnectors')).map((r) => azShape(r, rg, ws));
      const one = param(args, 'Name') ?? param(args, 'Id');
      if (one === undefined) return rows;
      const hit = rows.find((r) => r.Name === one || r.Id === one);
      if (!hit) throw new NotFoundError(`Get-AzSentinelDataConnector: data connector '${one}' was not found`);
      return hit;
    }
    default:
      throw new Error(`ph13Resolvers: no resolver for cmdlet "${cmdlet}"`);
  }
}
