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
 * DEPTH-10.8 (2026-11-01, PH-12 P12-R4, IR batch): the Exchange Online cmdlets Stamper's new
 * IR.L2-3.6.1.user-reporting entry sends, with the service's own semantics, so a GET after the SET
 * reads the SET's state back:
 *  - Get-/Set-ReportSubmissionPolicy: the organisation's user-reported-message settings (the Defender
 *    portal's "User reported settings"). Exchange Online has exactly one such policy, named
 *    DefaultReportSubmissionPolicy, and it always exists: before any Set, Get returns it with the
 *    service defaults (report to Microsoft on, no reporting mailbox). Set -Identity names that policy
 *    (any other identity is a 404, as the service answers); it changes only the parameters given.
 *    A parameter the cmdlet does not have is a 400, so a mistyped registry SET fails here as it would
 *    against Exchange Online. The *Addresses parameters hold a list of addresses.
 *    Learn: https://learn.microsoft.com/powershell/module/exchangepowershell/set-reportsubmissionpolicy
 */

registerObjectType('reportSubmissionPolicy');

const exoCmdlet = (name: string, verb: NamedCmdletResolverEntry['verb']): NamedCmdletResolverEntry => ({
  kind: 'cmdlet',
  cmdlet: name,
  endpoint: `exo:${name.replace(/^(Get|Set)-/, '')}`,
  collection: 'reportSubmissionPolicy',
  verb,
  azureTier: 'none',
  ...(verb === 'GET' ? {} : { mutationVerbs: [verb as 'POST' | 'PATCH' | 'DELETE'] }),
});

/** Exchange entries; spread into exoResolvers.ts's manual list (so a PowerShell wrapper is generated and no derived twin). */
export const DEPTH10_IR_EXO_ENTRIES: NamedCmdletResolverEntry[] = [
  exoCmdlet('Get-ReportSubmissionPolicy', 'GET'),
  exoCmdlet('Set-ReportSubmissionPolicy', 'PATCH'),
];

export const DEPTH10_IR_CMDLETS: ReadonlySet<string> = new Set(DEPTH10_IR_EXO_ENTRIES.map((e) => e.cmdlet));

export interface Depth10IrContext {
  store: ObjectStore;
  auditWriter?: DirectoryAuditWriter;
}

type Row = Record<string, unknown>;

const POLICY_ID = 'DefaultReportSubmissionPolicy';

/** The service defaults of the one policy (Get-ReportSubmissionPolicy on a new tenant). */
const DEFAULT_POLICY: Row = {
  Identity: POLICY_ID,
  Name: POLICY_ID,
  EnableReportToMicrosoft: true,
  EnableThirdPartyAddress: false,
  ReportJunkToCustomizedAddress: false,
  ReportNotJunkToCustomizedAddress: false,
  ReportPhishToCustomizedAddress: false,
  ReportJunkAddresses: [],
  ReportNotJunkAddresses: [],
  ReportPhishAddresses: [],
  ThirdPartyReportAddresses: [],
  EnableUserEmailNotification: false,
  PreSubmitMessageEnabled: true,
  PostSubmitMessageEnabled: true,
};

const BOOLEAN_PARAMS = [
  'EnableReportToMicrosoft', 'EnableThirdPartyAddress', 'ReportJunkToCustomizedAddress', 'ReportNotJunkToCustomizedAddress',
  'ReportPhishToCustomizedAddress', 'EnableUserEmailNotification', 'PreSubmitMessageEnabled', 'PostSubmitMessageEnabled',
];
const ADDRESS_PARAMS = ['ReportJunkAddresses', 'ReportNotJunkAddresses', 'ReportPhishAddresses', 'ThirdPartyReportAddresses'];
const COMMON = new Set(['identity', 'confirm', 'whatif', 'erroraction', 'warningaction', 'verbose', 'debug']);

function unwrapPsArray(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Row;
    if (Array.isArray(o.value) && typeof o.Count === 'number' && Object.keys(o).length === 2) return o.value;
  }
  return v;
}

/** '-Name value' pairs (and '-Name:value'); a bare switch is true. Names are matched case-insensitively. */
function parseArgs(args: unknown[]): Map<string, { name: string; value: unknown }> {
  const out = new Map<string, { name: string; value: unknown }>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string' || !/^-[A-Za-z]/.test(a)) continue;
    const colon = a.indexOf(':');
    const name = (colon > 0 ? a.slice(1, colon) : a.slice(1));
    let value: unknown;
    if (colon > 0) value = a.slice(colon + 1);
    else if (i + 1 < args.length && !(typeof args[i + 1] === 'string' && /^-[A-Za-z]/.test(args[i + 1] as string))) value = args[++i];
    else value = true;
    if (typeof value === 'string') value = value.trim().replace(/^['"]|['"]$/g, '');
    out.set(name.toLowerCase(), { name, value: unwrapPsArray(value) });
  }
  return out;
}

function toBool(param: string, v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().replace(/^\$/, '').toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  throw new BadRequestError(`Set-ReportSubmissionPolicy: -${param} takes $true or $false (got '${String(v)}')`);
}

function toAddresses(v: unknown): string[] {
  if (v === null || v === undefined || v === '$null') return [];
  const list = Array.isArray(v) ? v : String(v).split(',');
  return list.map((x) => String(x).trim()).filter((x) => x.length > 0);
}

async function current(store: ObjectStore): Promise<Row> {
  const row = (await store.list('reportSubmissionPolicy')).find((r) => (r as Row).id === POLICY_ID) as Row | undefined;
  if (!row) return { ...DEFAULT_POLICY };
  const { id: _id, ...rest } = row;
  return { ...DEFAULT_POLICY, ...rest };
}

function checkIdentity(name: string, params: Map<string, { name: string; value: unknown }>, required: boolean): void {
  const id = params.get('identity')?.value;
  if (id === undefined) {
    if (required) throw new BadRequestError(`${name}: -Identity is required`);
    return;
  }
  if (String(id).toLowerCase() !== POLICY_ID.toLowerCase()) {
    throw new NotFoundError(`${name}: the report submission policy '${String(id)}' was not found (the organisation has only ${POLICY_ID})`);
  }
}

/** Resolves one DEPTH10_IR_CMDLETS call against the store. */
export async function resolveDepth10Ir(ctx: Depth10IrContext, name: string, rawArgs: unknown): Promise<unknown> {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const params = parseArgs(args);
  switch (name) {
    case 'Get-ReportSubmissionPolicy': {
      checkIdentity(name, params, false);
      return current(ctx.store);
    }
    case 'Set-ReportSubmissionPolicy': {
      checkIdentity(name, params, true);
      const patch: Row = {};
      for (const [key, { name: given, value }] of params) {
        if (COMMON.has(key)) continue;
        const b = BOOLEAN_PARAMS.find((p) => p.toLowerCase() === key);
        const a = ADDRESS_PARAMS.find((p) => p.toLowerCase() === key);
        if (b) patch[b] = toBool(b, value);
        else if (a) patch[a] = toAddresses(value);
        else throw new BadRequestError(`Set-ReportSubmissionPolicy: a parameter cannot be found that matches parameter name '${given}' (simulator: not modelled)`);
      }
      const next = { ...(await current(ctx.store)), ...patch };
      await ctx.store.upsert('reportSubmissionPolicy', POLICY_ID, { id: POLICY_ID, ...next } as StoreObject);
      await ctx.auditWriter?.recordMutation({
        objectType: 'reportSubmissionPolicy',
        objectId: POLICY_ID,
        activityDisplayName: `PATCH ${name}`,
        requestVerb: 'PATCH',
        source: name,
      });
      // Exchange Online's Set-* cmdlets write nothing to the pipeline.
      return null;
    }
    default:
      throw new BadRequestError(`depth10IRResolvers: ${name} is not modelled`);
  }
}
