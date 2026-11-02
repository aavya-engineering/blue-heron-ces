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
import { StackShapeGate } from '../gating/StackShapeGate.js';
import type { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import type { EvidenceHold } from '../evidence/EvidenceHold.js';
import type { NamedCmdletResolverEntry, ResolverEntry, UriPatternResolverEntry } from './types.js';
import { graphResolvers } from './graphResolvers.js';
import { azureResolvers, azRestMethodPathResolvers } from './azureResolvers.js';
import { exoResolvers } from './exoResolvers.js';
import { azCliResolvers } from './azCliResolvers.js';
import { registerObjectType } from '../store/schemas.js';
import { validateCmdletArgs, validateUriRequest } from './inputValidation.js';
import { TENANT_INIT_CMDLETS, resolveTenantInit } from './tenantInitResolvers.js';
import { DEPTH_INFRA_CMDLETS, resolveDepthInfra } from './depthInfraResolvers.js';
import { resolveAoUri } from './aoResolvers.js';
import { resolveLeaverUri } from './leaverResolvers.js';
import { DEPTH10_AC_ENTRIES } from './depth10ACResolvers.js';
import { resolveDepth10Sc } from './depth10SCResolvers.js';
import { DEPTH10_IR_CMDLETS, resolveDepth10Ir } from './depth10IRResolvers.js';
import { DEPTH10_AU_CMDLETS, resolveDepth10Au } from './depth10AuResolvers.js';
import { resolveDepth10IaUri } from './depth10IaResolvers.js';
import { DEPTH10_R5_URI_ENTRIES, DEPTH10_R5_CMDLETS, isDepth10R5AzRest, resolveDepth10R5 } from './depth10R5Resolvers.js';
import { PH13_CMDLETS, resolvePh13 } from './ph13Resolvers.js';
import {
  applyCollectionRemap,
  TARGET_ACTIONS,
  transformUserPatch,
  confirmRiskyUsers,
  userMemberOf,
  presentMembers,
  searchUnifiedAuditLog,
  getPnpListItems,
  presentForCmdlet,
  AZ_ARM_TYPES,
} from './semantics.js';
import type { StoreObject } from '../store/StoreTypes.js';
import {
  NotFoundError,
  BadRequestError,
  IDENTITY_ALT_KEYS,
  URI_ALT_KEYS,
  findCmdletTarget,
  emptyNamedTarget,
  matchTarget,
  extractODataFilter,
  parseODataEqFilter,
  applyODataEqFilter,
  parseODataFilter,
  applyODataFilter,
  type CmdletTarget,
} from './targets.js';

// G-STACKSIM-2 iteration 4: azCliResolvers backs the `az` CLI shim
// (azshim/az.cmd + azshim/az-shim.ps1), which POSTs directly to /resolve
// using the same {kind:'uri', method, uri, body} shape every other caller
// uses - no ResolverTable/QueryServer changes were needed for the shim
// itself, only these additional entries.
// SIMFIX FIX-S2: COLLECTION_REMAP (semantics.ts) puts each AO-used cmdlet on
// the collection its real resource lives in, so writes land where reads look.
const DEFAULT_ENTRIES: ResolverEntry[] = applyCollectionRemap([
  ...DEPTH10_AC_ENTRIES, // DEPTH-10.3 (P12-R2): before graphResolvers, so its GET+POST groupSettings entry matches first
  ...DEPTH10_R5_URI_ENTRIES, // PH-12 P12-R5 (DEPTH-10.6..10.11): first, so its POSTs win over GET-only twins
  ...graphResolvers,
  ...azureResolvers,
  ...exoResolvers,
  ...azCliResolvers,
]);

// G-STACKSIM-2 iteration 2: every collection a resolver entry (hand-authored
// or inventory-derived) touches must be a "known" ObjectStore type or
// create()/update()/upsert() throw (src/store/schemas.ts). Hand-authored
// entries' collections were already added to KNOWN_OBJECT_TYPES by earlier
// milestones; this registers every derived collection dynamically so
// codegen never needs to hand-maintain that list in lockstep.
for (const entry of DEFAULT_ENTRIES) {
  registerObjectType(entry.collection);
}

type MutationVerb = 'POST' | 'PATCH' | 'DELETE';
const MUTATION_VERBS: readonly MutationVerb[] = ['POST', 'PATCH', 'DELETE'];

/** PowerShell common parameters — call plumbing, never resource state. */
const PS_COMMON_PARAMETERS = new Set([
  'erroraction', 'warningaction', 'informationaction', 'errorvariable',
  'warningvariable', 'informationvariable', 'outvariable', 'outbuffer',
  'pipelinevariable', 'verbose', 'debug', 'whatif', 'confirm',
]);

/**
 * STACKSIM-FIDELITY (2026-07-11): translate a PowerShell cmdlet call's $args
 * array into the state patch its real counterpart would apply.
 *
 * The psmodule shims forward $args verbatim ({kind:'cmdlet', cmdlet, args});
 * this parses the '-Param value' convention:
 *  - '-Param value'        -> { Param: coerce(value) }
 *  - '-Param' (bare, next arg is another -Param or end) -> { Param: true } (switch)
 *  - '-Param:$true'        -> { Param: true } (colon switch syntax)
 *  - '$true'/'$false' (with or without the $), numerics, and quoted strings
 *    coerce to boolean/number/unquoted string; arrays (PS comma-lists arrive
 *    as real JSON arrays) pass through as-is.
 *  - PowerShell common parameters (-ErrorAction etc.) are dropped — they are
 *    call plumbing, not resource state. A value starting '-<digit>' is a
 *    negative number, not a parameter name.
 * Positional (non-dash) arguments are ignored: without the cmdlet's parameter
 * metadata there is no name to bind them to, and every CES registry/AO
 * template observed uses named parameters for state-bearing values.
 */
export function cmdletArgsToPatch(
  args: unknown,
  opts: { camelCaseParams?: boolean } = {},
): Record<string, unknown> | undefined {
  if (!Array.isArray(args) || args.length === 0) return undefined;
  const coerce = (v: unknown): unknown => {
    // SIMFIX FIX-S1: Windows PowerShell 5.1's ConvertTo-Json serializes an
    // array held in $args as {"value":[...],"Count":n}; unwrap it back to the
    // array the caller passed (e.g. Confirm-MgRiskyUser -UserIds @($id)).
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Array.isArray((v as { value?: unknown }).value) &&
      typeof (v as { Count?: unknown }).Count === 'number' &&
      Object.keys(v).length === 2
    ) {
      return (v as { value: unknown[] }).value;
    }
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (/^\$?true$/i.test(s)) return true;
    if (/^\$?false$/i.test(s)) return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s.replace(/^['"]|['"]$/g, '');
  };
  const isParamName = (v: unknown): v is string =>
    typeof v === 'string' && /^-[A-Za-z]/.test(v);
  const patch: Record<string, unknown> = {};
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (!isParamName(a)) {
      i += 1;
      continue;
    }
    const colon = a.indexOf(':');
    let name: string;
    let value: unknown;
    if (colon > 0 && colon === a.length - 1) {
      // SIMFIX FIX-S1: PowerShell forwards `-AccountEnabled:$false` in a
      // simple function's $args as TWO elements - the string
      // '-AccountEnabled:' and the value (false). The old branch read the
      // empty text after the colon, stored '' and skipped the real value,
      // so AO's `Update-MgUser -AccountEnabled:$false` wrote
      // accountEnabled='' instead of false.
      name = a.slice(1, colon);
      const next = args[i + 1];
      if (next === undefined || isParamName(next)) {
        value = true;
        i += 1;
      } else {
        value = coerce(next);
        i += 2;
      }
    } else if (colon > 0) {
      name = a.slice(1, colon);
      value = coerce(a.slice(colon + 1));
      i += 1;
    } else {
      name = a.slice(1);
      const next = args[i + 1];
      if (next === undefined || isParamName(next)) {
        value = true; // bare switch parameter
        i += 1;
      } else {
        value = coerce(next);
        i += 2;
      }
    }
    if (!PS_COMMON_PARAMETERS.has(name.toLowerCase())) {
      // GP-STACKSIM-1 M3 (2026-07-25): each SDK's parameter names must map
      // to that SDK's own wire/object casing. The Graph SDK maps PascalCase
      // parameters (-DisplayName, -Status, -IsTrusted) to camelCase JSON
      // properties - spreading them verbatim wrote case-duplicate keys next
      // to the camelCase seed fields ('status' + 'Status' on one object), a
      // shape no real tenant can hold and one PS 5.1's ConvertFrom-Json
      // refuses to parse (the exact limitation the FIDELITY-1 tail-(c) note
      // recorded). Every later PS read of the touched collection then died
      // with empty stdout - the eo:securityAlerts/cuiGroup/namedLocations
      // "Unexpected end of JSON input" class in the 2026-07-25 coverage
      // re-run. Az and EXO object models are natively PascalCase (firewall
      // seeds carry Name/ProvisioningState), so ONLY Graph (-Mg*) calls
      // lower-first — a blanket lowerFirst broke Get-AzFirewall the same
      // way in reverse (AZ-FW-003/004, F-11/F-12).
      patch[opts.camelCaseParams ? name.charAt(0).toLowerCase() + name.slice(1) : name] = value;
    }
  }
  // FIDELITY tail (a): Graph SDK cmdlets take the resource body as
  // -BodyParameter @{...} (PowerShell evaluates the hashtable BEFORE the shim
  // sees it, so it arrives here as a real JSON object). The object IS the
  // resource — spread it into the patch root instead of nesting it under a
  // 'BodyParameter' key nothing will ever read (New-Mg* creations previously
  // produced field-less shells; the named-location/tap-config failure class).
  // GP-STACKSIM-1 M3 (2026-07-25): -AdditionalProperties is the SDK's
  // untyped-fields bag - its CONTENTS are already wire-shaped resource
  // properties (e.g. AO's A-14 passes ipRanges through it), so it spreads
  // exactly like -BodyParameter. Matched case-insensitively: the parameter
  // key's casing depends on the camelCaseParams mapping above.
  for (const bodyKey of ['bodyparameter', 'body', 'additionalproperties']) {
    const actualKey = Object.keys(patch).find((k) => k.toLowerCase() === bodyKey);
    if (actualKey === undefined) continue;
    const v = patch[actualKey];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      delete patch[actualKey];
      Object.assign(patch, v);
    }
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * FIDELITY tail (b): honor `-Filter "field eq <value>"` on cmdlet GETs — the
 * one OData shape the CES registries use. Two value forms, both real:
 *  - single-quoted string:  `displayName eq 'Approved-CUI-Networks'`
 *    (EO's cuiGroup, AO's namedLocation reads)
 *  - bare OData literal:     `accountEnabled eq true`, `assignedPlans eq 42`,
 *    `onPremisesSyncEnabled eq null` — booleans/numbers/null are NEVER quoted
 *    in OData, so a value-must-be-quoted parser silently returned the WHOLE
 *    collection (Stamper's `Get-MgUser -Filter 'accountEnabled eq true'` got
 *    every user, disabled ones included — a wrong-facts read). A leading `$`
 *    (PS `$true`) is tolerated and stripped.
 * Field match is case-insensitive (PS PascalCase vs Graph camelCase); the
 * value compares by string form, so `true`/`42` match a boolean/number field.
 * P1.4c (2026-10-27): `a eq 'x' and b eq 'y'` (Stamper's PIM eligibility
 * read) is honoured too, via the same parser the URI `$filter` path uses.
 * Anything more complex (startswith, and/or, ne) passes through unfiltered
 * rather than guessing.
 */
export function applyCmdletFilter(data: unknown, args: unknown): unknown {
  if (!Array.isArray(args) || !Array.isArray(data)) return data;
  const i = args.findIndex((a) => typeof a === 'string' && a.toLowerCase() === '-filter');
  const expr = i !== -1 ? args[i + 1] : undefined;
  if (typeof expr !== 'string') return data;
  // Quoted branch first (a quoted value may contain spaces); the bare branch
  // is quote-free and whitespace-free, with an optional PS `$` prefix stripped.
  // synthetic-customer W5 cycle 1 (W3 finding F-4): `startswith(field, 'x')`
  // (Stamper's `Get-MgUser -Filter "startsWith(displayName, 'Admin-')"`) is
  // honoured, case-insensitively as Graph compares strings; it used to return
  // every user. Only the cmdlet path: the URI `$filter` grammar still answers
  // 400 for it (parseODataFilter).
  const sw = /^\s*startswith\(\s*([\w.]+)\s*,\s*'([^']*)'\s*\)\s*$/i.exec(expr);
  if (sw) {
    const lcField = sw[1].toLowerCase();
    const prefix = sw[2].toLowerCase();
    return data.filter((o) => {
      if (!o || typeof o !== 'object') return false;
      const rec = o as Record<string, unknown>;
      const key = Object.keys(rec).find((k) => k.toLowerCase() === lcField);
      return key !== undefined && typeof rec[key] === 'string' && (rec[key] as string).toLowerCase().startsWith(prefix);
    });
  }
  const m = /^\s*([\w.]+)\s+eq\s+(?:'([^']*)'|\$?([^'\s]+))\s*$/i.exec(expr);
  if (!m) {
    const clauses = /\s+and\s+/i.test(expr) ? parseODataEqFilter(expr) : undefined;
    return clauses ? applyODataEqFilter(data, clauses) : data;
  }
  const lcField = m[1].toLowerCase();
  const value = m[2] !== undefined ? m[2] : m[3];
  return data.filter((o) => {
    if (!o || typeof o !== 'object') return false;
    const rec = o as Record<string, unknown>;
    const key = Object.keys(rec).find((k) => k.toLowerCase() === lcField);
    return key !== undefined && String(rec[key]) === value;
  });
}

/**
 * P0-2 fix 8 (dlp-policy, KEYSTONE, 2026-07-27): honor `-Identity <val>` on a
 * named-cmdlet GET the way a real single-object cmdlet does. Named-cmdlet
 * GETs previously honored only `-Filter` (above); `-Identity` fell through
 * and returned the WHOLE collection, so `Get-DlpCompliancePolicy -Identity
 * 'CMMC-CUI-Block'` against a 2-elem seeded collection returned a 2-elem
 * array - Stamper's verifier `extractJsonPath` unwraps a single-element
 * array but returns undefined for a 2+-element one. Matches case-
 * insensitively against whichever of Identity/Name/DisplayName/id the
 * object actually carries (real EXO/Graph objects use different ones), and
 * returns the SINGLE matched object - not a narrowed array - mirroring how
 * a real `-Identity` cmdlet returns one object, never a collection. Returns
 * undefined (not the original data) when `-Identity` is absent or nothing
 * matches, so the caller falls back to `-Filter`/unfiltered data.
 */
export function applyCmdletIdentity(data: unknown, args: unknown): unknown {
  if (!Array.isArray(args) || !Array.isArray(data)) return undefined;
  const i = args.findIndex((a) => typeof a === 'string' && a.toLowerCase() === '-identity');
  const raw = i !== -1 ? args[i + 1] : undefined;
  if (typeof raw !== 'string') return undefined;
  const value = raw.replace(/^['"]|['"]$/g, '').toLowerCase();
  const IDENTITY_FIELDS = ['identity', 'name', 'displayname', 'id'];
  return data.find((o) => {
    if (!o || typeof o !== 'object') return false;
    const rec = o as Record<string, unknown>;
    return IDENTITY_FIELDS.some((f) => {
      const key = Object.keys(rec).find((k) => k.toLowerCase() === f);
      return key !== undefined && String(rec[key]).toLowerCase() === value;
    });
  });
}

/**
 * GP-DEMO-2 (2026-07-28) ledger-truthfulness fix: Invoke-AzRestMethod is a
 * generic ARM REST passthrough - its HTTP verb is whatever the CALLER passed
 * via -Method, not something intrinsic to the cmdlet name the way New-/Set-/
 * Remove-Az* are. deriveResolversFromInventory's verb-prefix heuristic
 * (WRITE_VERB_TO_HTTP) mapped the PowerShell verb 'Invoke' to POST
 * unconditionally, so a `-Method GET` call was routed through the mutation
 * path and ledgered as a mutate - a false record of state change on a real
 * tenant that never happened. This cmdlet's OWN -Method argument is the
 * ground truth; parses it (and -Path/-Uri, both seen in real registry
 * command text - AZ-AUTO-002 uses -Uri, AZ-LOG-004/AZ-SEN-010 use -Path)
 * directly off the raw $args array the psmodule shim forwards verbatim.
 * Defaults to 'POST' when -Method is absent (should not occur in practice -
 * the real cmdlet requires -Method - but preserves this sim's prior
 * always-mutate behavior rather than guessing 'GET').
 */
export function parseInvokeAzRestMethodArgs(args: unknown): { method: string; path?: string } {
  let method = 'POST';
  let path: string | undefined;
  if (Array.isArray(args)) {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (typeof a !== 'string') continue;
      const lc = a.toLowerCase();
      if (lc === '-method' && typeof args[i + 1] === 'string') {
        method = (args[i + 1] as string).toUpperCase();
      } else if ((lc === '-path' || lc === '-uri') && typeof args[i + 1] === 'string') {
        path = (args[i + 1] as string).replace(/^['"]|['"]$/g, '');
      }
    }
  }
  return { method, path };
}

/** The resource object a Set-Az* call was handed (named param or forwarded pipeline input), if any. */
function azObjectArg(args: unknown, cmdlet: string): Record<string, unknown> | undefined {
  if (!Array.isArray(args)) return undefined;
  // Only the parameter that carries the resource ITSELF: -InputObject (the
  // forwarded pipeline object) or the one named after the cmdlet's noun
  // (-AzureFirewall for Set-AzFirewall, -NetworkSecurityGroup, -VirtualNetwork,
  // -RouteTable). A parent passed for scope (Set-AzNetworkWatcherFlowLog
  // -NetworkWatcher $nw) is not the resource being set.
  const noun = cmdlet.replace(/^Set-Az/, '').toLowerCase();
  for (let i = 0; i < args.length - 1; i++) {
    const a = args[i];
    const v = args[i + 1];
    if (typeof a !== 'string' || !/^-[A-Za-z]/.test(a)) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const pn = a.slice(1).replace(/:$/, '').toLowerCase();
    if (pn !== 'inputobject' && !noun.endsWith(pn) && !pn.endsWith(noun)) continue;
    const o = v as Record<string, unknown>;
    if (['id', 'Id', 'Name', 'name', 'ResourceId'].some((k) => typeof o[k] === 'string')) return o;
  }
  return undefined;
}

/**
 * PH-13 FX: a Graph PATCH merge for one object - a property the patch does not name keeps its
 * value, and a nested plain object in the patch is merged into the stored one (one level deep, as
 * authorizationPolicy.defaultUserRolePermissions). Arrays and scalars in the patch replace.
 */
export function mergeNestedPatch(existing: Record<string, unknown> | undefined, patch: Record<string, unknown>): Record<string, unknown> {
  if (!existing) return patch;
  const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const out: Record<string, unknown> = { ...patch };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlain(v) && isPlain(existing[k])) out[k] = { ...(existing[k] as Record<string, unknown>), ...v };
  }
  return out;
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

/** Removes the target parameter (any casing) from a mutation patch - it names the object, it is not a field of it. */
function stripParam(patch: Record<string, unknown> | undefined, param: string): Record<string, unknown> | undefined {
  if (!patch) return patch;
  const lc = param.toLowerCase();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (k.toLowerCase() !== lc) out[k] = v;
  return out;
}

/** Payload parameter that references a second object (member/credential) of a sub-resource write. */
function referencedId(args: unknown): string | undefined {
  if (!Array.isArray(args)) return undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string') continue;
    const lc = a.toLowerCase().replace(/:$/, '');
    if (lc === '-directoryobjectid' || lc === '-keyid') {
      const v = args[i + 1];
      if (typeof v === 'string' && v.trim()) return v.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return undefined;
}

/** W5c1-b: the URI's `$select` property list (lower-cased), or undefined. */
function extractODataSelect(uri: string): string[] | undefined {
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
    if (key === '$select' || key === '`$select') {
      const names = val.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      return names.length > 0 ? names : undefined;
    }
  }
  return undefined;
}

/** W5c1-c: the URI's `$expand` navigation names (lower-cased, nested options dropped), or undefined. */
function extractODataExpand(uri: string): string[] | undefined {
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
    if (key === '$expand' || key === '`$expand') {
      const names = val.replace(/\([^)]*\)/g, '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      return names.length > 0 ? names : undefined;
    }
  }
  return undefined;
}

/**
 * W5c1-c: navigation properties Graph returns only on `$expand` (the sim
 * stores them inline on the object). URI reads only; the named cmdlets
 * still return them inline.
 */
const EXPAND_ONLY: Record<string, string[]> = {
  roleManagementPolicies: ['rules'],
  // W5c2 follow-up 7: Intune `assignments` too (Graph returns them only on
  // `$expand=assignments` or the `/assignments` sub-resource).
  deviceManagementConfigurationPolicies: ['settings', 'assignments'],
  deviceConfigurations: ['assignments'],
  deviceCompliancePolicies: ['assignments'],
  iosManagedAppProtections: ['assignments'],
  androidManagedAppProtections: ['assignments'],
};

/** W5c2 follow-up 7: expandable navigations that Graph returns as an empty array when the object has none. */
const EXPAND_EMPTY_ARRAY = new Set(['assignments']);

/** W5c2 follow-up 7: the Intune `/assign` action and `/assignments` read, by URI collection segment -> store collection. */
const ASSIGNABLE: Record<string, string> = {
  'deviceManagement/deviceConfigurations': 'deviceConfigurations',
  'deviceManagement/configurationPolicies': 'deviceManagementConfigurationPolicies',
  'deviceManagement/deviceCompliancePolicies': 'deviceCompliancePolicies',
  'deviceAppManagement/iosManagedAppProtections': 'iosManagedAppProtections',
  'deviceAppManagement/androidManagedAppProtections': 'androidManagedAppProtections',
};
const ASSIGN_URI = /^\/(?:v1\.0|beta)\/(deviceManagement\/(?:deviceConfigurations|configurationPolicies|deviceCompliancePolicies)|deviceAppManagement\/(?:ios|android)ManagedAppProtections)\/([^/]+)\/(assign|assignments)$/;

/** W5c1-c: drops the navigation properties `navs` from each object unless expanded (W5c2 follow-up 7: several per collection). */
function projectExpand(out: unknown, navs: string[], expand: string[] | undefined): unknown {
  const all = !!expand && expand.includes('*');
  const keep = navs.filter((n) => all || (expand ?? []).includes(n.toLowerCase()));
  const drop = navs.filter((n) => !keep.includes(n));
  const one = (o: unknown) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    const rec: Record<string, unknown> = { ...(o as Record<string, unknown>) };
    for (const n of drop) delete rec[n];
    for (const n of keep) if (EXPAND_EMPTY_ARRAY.has(n) && !Array.isArray(rec[n])) rec[n] = [];
    return rec;
  };
  if (Array.isArray(out)) return out.map(one);
  if (out && typeof out === 'object' && Array.isArray((out as { value?: unknown }).value)) {
    return { ...(out as object), value: (out as { value: unknown[] }).value.map(one) };
  }
  return one(out);
}

/** W5c1-b: keeps only the selected top-level properties (Graph property names are case-insensitive). */
function projectSelect(out: unknown, select: string[]): unknown {
  const one = (o: unknown) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k]) => select.includes(k.toLowerCase())));
  };
  if (Array.isArray(out)) return out.map(one);
  if (out && typeof out === 'object' && Array.isArray((out as { value?: unknown }).value)) {
    return { ...(out as object), value: (out as { value: unknown[] }).value.map(one) };
  }
  return one(out);
}

/** W5c2 follow-up 12: the Az cmdlets resolveAzActionGroup answers. */
const AZ_ACTION_GROUPS = new Set(['Get-AzActionGroup', 'New-AzActionGroup', 'Set-AzActionGroup', 'New-AzActionGroupEmailReceiverObject']);

/** W5c2 follow-up 12: an action group in ARM's REST shape (Invoke-AzRestMethod list). */
function actionGroupArm(g: StoreObject): Record<string, unknown> {
  const o = g as Record<string, any>;
  return {
    id: o.id,
    name: o.Name,
    type: 'Microsoft.Insights/ActionGroups',
    location: o.Location ?? 'Global',
    tags: o.Tags ?? {},
    properties: {
      groupShortName: o.GroupShortName ?? null,
      enabled: o.Enabled !== false,
      emailReceivers: ((o.EmailReceiver ?? []) as Array<Record<string, unknown>>).map((r) => ({ name: r.Name, emailAddress: r.EmailAddress, useCommonAlertSchema: r.UseCommonAlertSchema ?? false, status: r.Status ?? 'Enabled' })),
      smsReceivers: [],
      webhookReceivers: [],
    },
  };
}

/** W5c2 follow-up 11: the Az cmdlets resolveAzKeyManagement answers. */
const AZ_KEY_MANAGEMENT = new Set(['Get-AzKeyVault', 'New-AzKeyVault', 'Get-AzRoleAssignment', 'New-AzRoleAssignment', 'Get-AzVM', 'Get-AzUserAssignedIdentity']);

/** W5c2 follow-up 3: Graph label collections that mirror the Security & Compliance `label` rows (withPurviewLabels). */
const PURVIEW_LABEL_MIRRORS = new Set(['policyLabels', 'sensitivityLabels']);

/** W5c2: the value of `-<name>` (case-insensitive, `-Name:value` too) when it is a non-empty string. */
function cmdletParamValue(args: unknown, lcName: string): string | undefined {
  if (!Array.isArray(args)) return undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string' || !a.startsWith('-')) continue;
    const colon = a.indexOf(':');
    const name = (colon > 0 ? a.slice(1, colon) : a.slice(1)).toLowerCase();
    if (name !== lcName) continue;
    const raw = colon > 0 && colon < a.length - 1 ? a.slice(colon + 1) : args[i + 1];
    if (typeof raw !== 'string') return undefined;
    const v = raw.trim().replace(/^['"]|['"]$/g, '');
    return v.length > 0 && !/^-[A-Za-z]/.test(v) ? v : undefined;
  }
  return undefined;
}

/** W5c2: PS 5.1 can serialize an array as {value:[...],Count:n}; restore the arrays, at any depth. */
function unwrapPsArrays(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unwrapPsArrays);
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 2 && Array.isArray(o.value) && typeof o.Count === 'number') return (o.value as unknown[]).map(unwrapPsArrays);
  return Object.fromEntries(keys.map((k) => [k, unwrapPsArrays(o[k])]));
}

/** Sub-resource records that stand for another directory object (group members) present that object's id. */
function presentRecord(r: StoreObject): StoreObject {
  const memberId = (r as Record<string, unknown>).memberId;
  return typeof memberId === 'string' ? { ...r, id: memberId } : r;
}

// FIDELITY tail (c) — PascalCase surfacing on Get-Mg* — was PROTOTYPED and
// BACKED OUT 2026-07-12: a rename breaks EO's ComplianceSignalFetcher and AO's
// audit-read (the DOC-verification integration tests), which consume raw Graph
// camelCase; an additive alias is impossible (PS 5.1 ConvertFrom-Json rejects
// case-duplicate keys). Stamper's SDK-style $.DisplayName verifications are the
// only consumer that wants PascalCase, so the correct fix lives in Stamper's
// verification-normalization (or the registry get_command adding a projection),
// NOT in the shared sim response. Filed as a FIDELITY-1 follow-on; see the loop
// board. The remaining tail failures gated on this are documented there.

/**
 * Strips a real Graph absolute-URL prefix so both callers' URI conventions
 * match the same relative-path resolver patterns: AO's TemplateRegistry.ts
 * uses relative `-Uri '/v1.0/...'`, while ces-stamper's
 * cmmc-l2-commands.registry.json hardcodes the absolute
 * 'https://graph.microsoft.us/...' host (confirmed by a targeted read at
 * M4 - see IMPLEMENTATION_LOG.md).
 */
function normalizeUri(uri: string): string {
  return uri.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
}

/**
 * G-STACKSIM-2 iteration 2: some Invoke-MgGraphRequest call sites target a
 * dynamic-id path segment (e.g. '/v1.0/users/{upn}', substituted by the
 * coverage harness to a literal string before this ever runs). A
 * UriPatternResolverEntry may declare a single '*' path segment to match any
 * one literal segment at that position, without supporting true dynamic-id
 * mutation (every match still resolves to the entry's own fixed collection).
 */
function matchesPattern(pattern: string, uri: string): boolean {
  return matchPatternCapture(pattern, uri) !== null;
}

/**
 * G-STACKSIM-2 iteration 3: like `matchesPattern`, but also returns the
 * literal value matched at each `*` wildcard segment (or `null` if the
 * pattern doesn't match at all). Backs dynamic-id mutation (e.g. AO's
 * A-10/A-20 DELETE a specific `/roleAssignments/{id}` or
 * `/conditionalAccess/policies/{id}` by the id Graph itself returned from an
 * earlier GET) - the class-level doc comment's older "every mutating entry
 * collapses to one well-known id" limitation only applies when a pattern has
 * no captured segment to use instead.
 */
function matchPatternCapture(pattern: string, uri: string): string[] | null {
  const patternSegments = pattern.split('/');
  const uriSegments = uri.split('/');
  if (patternSegments.length !== uriSegments.length) return null;
  const captures: string[] = [];
  for (let i = 0; i < patternSegments.length; i++) {
    if (patternSegments[i] === '*') {
      captures.push(uriSegments[i]);
    } else if (patternSegments[i] !== uriSegments[i]) {
      return null;
    }
  }
  return captures;
}

/**
 * Cmdlet-pattern / URI-pattern -> store-query resolver (Core Design (d)).
 * Every lookup is gated through StackShapeGate.checkAccess() before the
 * store is touched (Core Design (e), invoke-time enforcement layer), for
 * both reads and mutations.
 *
 * M2 was read-surface only. M4 adds mutation handling for
 * Invoke-MgGraphRequest -Method POST/PATCH/DELETE against URI-pattern
 * entries that declare `mutationVerbs` (PLAN.md M4 File Inventory: "mutation
 * handling for Invoke-MgGraphRequest -Method POST/PATCH/DELETE in the
 * generic URI resolver"). Named-cmdlet entries remain GET-only (they mirror
 * real SDK Get-Mg* cmdlets, which are read-only).
 *
 * M5 adds the evidence hold: every successful GET-shaped resolve (both
 * named-cmdlet and URI-pattern) is snapshotted via `evidenceHold.record()`
 * when one is supplied (Core Design (c)) - mirroring how M4's `auditWriter`
 * is only wired for mutations.
 */
export class ResolverTable {
  private readonly entries: ResolverEntry[];

  constructor(
    private readonly store: ObjectStore,
    private readonly gate: StackShapeGate,
    entries: ResolverEntry[] = DEFAULT_ENTRIES,
    private readonly auditWriter?: DirectoryAuditWriter,
    private readonly evidenceHold?: EvidenceHold,
  ) {
    this.entries = entries;
  }

  async resolveCmdlet(cmdlet: string, args?: unknown): Promise<unknown> {
    // GP-DEMO-2 (2026-07-28): Invoke-AzRestMethod's read-vs-write direction
    // is caller-supplied (-Method), not intrinsic to the cmdlet name - see
    // parseInvokeAzRestMethodArgs's doc comment. Routed before the generic
    // fixed-verb entry lookup below, which cannot represent a cmdlet whose
    // verb varies per call.
    // PH-12 P12-R5: the AZ-* entries the simulator could not answer (and the guest-configuration
    // Invoke-AzRestMethod path) - depth10R5Resolvers.ts.
    if (DEPTH10_R5_CMDLETS.has(cmdlet) || (cmdlet === 'Invoke-AzRestMethod' && isDepth10R5AzRest(args))) {
      const r5 = this.entries.find((e): e is NamedCmdletResolverEntry => e.kind === 'cmdlet' && e.cmdlet === cmdlet);
      if (!r5) throw new Error(`ResolverTable: no resolver registered for cmdlet "${cmdlet}"`);
      await validateCmdletArgs(this.store, cmdlet, args, r5.verb !== 'GET');
      this.gate.checkAccess(r5);
      const out = await resolveDepth10R5({ store: this.store, auditWriter: this.auditWriter }, cmdlet, args);
      if (r5.verb === 'GET') await this.recordEvidence(r5, 'GET', out);
      return out;
    }
    if (cmdlet === 'Invoke-AzRestMethod') {
      return this.resolveInvokeAzRestMethod(args);
    }
    const entry = this.entries.find(
      (e): e is NamedCmdletResolverEntry => e.kind === 'cmdlet' && e.cmdlet === cmdlet,
    );
    if (!entry) {
      throw new Error(`ResolverTable: no resolver registered for cmdlet "${cmdlet}"`);
    }
    // FX-10: unresolved {placeholder} values and invalid ids are a 400,
    // before any lookup or write (inputValidation.ts).
    await validateCmdletArgs(this.store, cmdlet, args, entry.verb !== 'GET');
    // FIN-21: Stamper tenant initialization on a clean tenant (bootstrap,
    // preflight, baseline) - tenantInitResolvers.ts.
    if (TENANT_INIT_CMDLETS.has(cmdlet)) {
      this.gate.checkAccess(entry);
      const out = await resolveTenantInit({ store: this.store, auditWriter: this.auditWriter }, cmdlet, args);
      if (entry.verb === 'GET') await this.recordEvidence(entry, 'GET', out);
      return out;
    }
    // DEPTH-9a: the infra registry entries DEPTH-2 plans for an m365_azure enclave - depthInfraResolvers.ts.
    if (DEPTH_INFRA_CMDLETS.has(cmdlet)) {
      this.gate.checkAccess(entry);
      const out = await resolveDepthInfra({ store: this.store, auditWriter: this.auditWriter }, cmdlet, args);
      if (entry.verb === 'GET') await this.recordEvidence(entry, 'GET', out);
      return out;
    }
    // DEPTH-10.8: the user-reported-message policy Stamper's IR.L2-3.6.1.user-reporting sets - depth10IRResolvers.ts.
    if (DEPTH10_IR_CMDLETS.has(cmdlet)) {
      this.gate.checkAccess(entry);
      const out = await resolveDepth10Ir({ store: this.store, auditWriter: this.auditWriter }, cmdlet, args);
      if (entry.verb === 'GET') await this.recordEvidence(entry, 'GET', out);
      return out;
    }
    // PH-13 (P13-ST): evidence-only reads the simulator answered empty although the tenant holds the object - ph13Resolvers.ts.
    if (PH13_CMDLETS.has(cmdlet)) {
      this.gate.checkAccess(entry);
      const out = await resolvePh13({ store: this.store }, cmdlet, args);
      await this.recordEvidence(entry, 'GET', out);
      return out;
    }
    // DEPTH-10.1 (P12-R1): the AU entries' Exchange / Purview writes - depth10AuResolvers.ts.
    if (DEPTH10_AU_CMDLETS.has(cmdlet)) {
      this.gate.checkAccess(entry);
      return resolveDepth10Au({ store: this.store, auditWriter: this.auditWriter }, cmdlet, args);
    }
    // W5c2 follow-up 11: Key Vault, Azure RBAC role assignments and the
    // enclave's managed identities (Stamper's SC.L2-3.13.10.key-vault).
    if (AZ_KEY_MANAGEMENT.has(cmdlet)) {
      this.gate.checkAccess(entry);
      return this.resolveAzKeyManagement(cmdlet, args);
    }
    // W5c2 follow-up 12: Azure Monitor action groups.
    if (AZ_ACTION_GROUPS.has(cmdlet)) {
      this.gate.checkAccess(entry);
      return this.resolveAzActionGroup(cmdlet, args);
    }
    // synthetic-customer W5c2 (2026-10-28): a PIM policy's rules are the
    // `rules` list on the policy itself (the one `$expand=rules` returns),
    // so a rule write is visible on the next policy read.
    if (cmdlet === 'Get-MgPolicyRoleManagementPolicyRule' || cmdlet === 'Update-MgPolicyRoleManagementPolicyRule') {
      this.gate.checkAccess(entry);
      const policyId = cmdletParamValue(args, 'unifiedrolemanagementpolicyid');
      if (policyId === undefined) throw new BadRequestError(`${cmdlet}: -UnifiedRoleManagementPolicyId is required (got no id)`);
      const ruleId = cmdletParamValue(args, 'unifiedrolemanagementpolicyruleid');
      if (cmdlet === 'Get-MgPolicyRoleManagementPolicyRule') {
        const out = await this.readPolicyRules(policyId, ruleId);
        const response = ruleId !== undefined ? out : applyCmdletFilter(out, args);
        await this.recordEvidence(entry, 'GET', response);
        return response;
      }
      if (ruleId === undefined) throw new BadRequestError(`${cmdlet}: -UnifiedRoleManagementPolicyRuleId is required (got no id)`);
      const patch = cmdletArgsToPatch(args, { camelCaseParams: true }) ?? {};
      for (const k of Object.keys(patch)) {
        if (/^unifiedrolemanagementpolicy(rule)?id$/i.test(k)) delete patch[k];
      }
      return this.writePolicyRule(policyId, ruleId, patch, `PATCH ${cmdlet}`, cmdlet);
    }
    // SIMFIX FIX-S2: cmdlets whose selection rules are the service's own.
    if (cmdlet === 'Search-UnifiedAuditLog' || cmdlet === 'Get-PnPListItem') {
      this.gate.checkAccess(entry);
      const out =
        cmdlet === 'Search-UnifiedAuditLog'
          ? await searchUnifiedAuditLog(this.store, args, Date.now())
          : await getPnpListItems(this.store, args);
      await this.recordEvidence(entry, 'GET', out);
      return out;
    }
    // P1.4b (2026-10-27): Enable-OrganizationCustomization "hydrates" the
    // tenant's organization config - Get-OrganizationConfig then reports
    // IsDehydrated false, as a real tenant does.
    if (cmdlet === 'Enable-OrganizationCustomization') {
      this.gate.checkAccess(entry);
      const cfg = (await this.store.list('organizationConfig'))[0];
      if (!cfg) throw new NotFoundError(`${cmdlet}: no organizationConfig object`);
      const out = await this.store.update('organizationConfig', cfg.id, { IsDehydrated: false });
      await this.auditWriter?.recordMutation({
        objectType: 'organizationConfig',
        objectId: cfg.id,
        activityDisplayName: `PATCH ${cmdlet}`,
        requestVerb: 'PATCH',
        source: cmdlet,
      });
      return out;
    }
    if (cmdlet === 'Confirm-MgRiskyUser') {
      this.gate.checkAccess(entry);
      const out = await confirmRiskyUsers(this.store, args, new Date().toISOString());
      await this.auditWriter?.recordMutation({
        objectType: 'riskyUsers',
        objectId: (out as Array<{ id: string }>).map((u) => u.id).join(','),
        activityDisplayName: `POST ${cmdlet}`,
        requestVerb: 'POST',
        source: cmdlet,
      });
      return out;
    }
    // STACKSIM-FIDELITY (2026-07-11): named-cmdlet mutations now APPLY their
    // parameters as object state. The psmodule shims have always POSTed the
    // call's $args to /resolve; dropping them here meant every Set-*/New-*
    // upserted a bare {id} shell, so Stamper's post-set verification read
    // properties that were never written - the remaining 15 M2-gate failures
    // after the item-level GET fix.
    // SIMFIX FIX-S1 (data safety): a call that NAMES its target (-UserId,
    // -GroupId, -ManagedDeviceId, -Identity, ... - see targets.ts) acts on
    // exactly that object or fails not-found. It never falls back to the
    // entry's singletonId or to the whole collection.
    const target = findCmdletTarget(args, cmdlet);
    // PH-13 P13-REG (LOG-PH12-AO.md STOP 2): an action cmdlet (TARGET_ACTIONS) whose target parameter is
    // present but null or empty is a 400, as in real Graph. It used to find no target and fall through to
    // the generic upsert below, which created a phantom object (R-F9 S1 AO B-01: managedDevice-60).
    if (!target && TARGET_ACTIONS[cmdlet]) {
      const emptyParam = emptyNamedTarget(args, cmdlet);
      if (emptyParam !== undefined) throw new BadRequestError(`${cmdlet}: -${emptyParam} is required (got no value)`);
    }
    if (target) {
      if (entry.verb === 'GET') {
        return this.resolveTargetedGet(entry, target, args);
      }
      const isGraph = /^[A-Za-z]+-Mg[A-Z]/.test(entry.cmdlet);
      const patch = stripParam(cmdletArgsToPatch(args, { camelCaseParams: isGraph }), target.param);
      return this.resolveTargetedMutation(entry, entry.verb as MutationVerb, patch, target, args);
    }
    // SIMFIX FIX-S1/FIX-S2: Set-Az* persists the OBJECT it is handed
    // (`Set-AzFirewall -AzureFirewall $fw`, `$nsg | Set-AzNetworkSecurityGroup`
    // - the psmodule wrapper forwards pipeline input as -InputObject). The
    // object names its resource (id / ARM Id / Name): that resource is
    // updated with the object's state, or the call is a 404. It used to
    // collapse onto the entry's singleton (firewall-1 / nsg-1) whatever
    // object was passed, and nest it under a key nothing reads - F-11's
    // Deallocate() never reached the store, and a second NSG's rules would
    // have been written onto the first.
    if (/^Set-Az[A-Z]/.test(cmdlet) && !/Config$/.test(cmdlet) && entry.verb !== 'GET') {
      const objArg = azObjectArg(args, cmdlet);
      if (objArg) {
        this.gate.checkAccess(entry);
        const objs = await this.store.list(entry.collection);
        const key = String(objArg.id ?? objArg.Id ?? objArg.ResourceId ?? objArg.Name ?? objArg.name ?? '');
        const found =
          matchTarget(objs, key, ['Id', 'ResourceId', 'name']) ??
          (objArg.Name ?? objArg.name ? matchTarget(objs, String(objArg.Name ?? objArg.name), ['name']) : undefined);
        if (!found) throw new NotFoundError(`${cmdlet}: no ${entry.collection} resource named "${key}"`);
        const { id: _i, ...state } = objArg;
        if (entry.collection === 'vnets' && Array.isArray(state.Subnets)) {
          // FIN-21: ARM assigns each new subnet its resource Id
          // (<vnet Id>/subnets/<name>), so a later Get-AzVirtualNetworkSubnetConfig
          // read finds it by Id (BaselineProvisioner's check-after-build).
          const vnetId = String((found as Record<string, unknown>).Id ?? state.Id ?? '');
          state.Subnets = (state.Subnets as unknown[]).map((sn) => {
            const o = sn && typeof sn === 'object' ? (sn as Record<string, unknown>) : undefined;
            if (!o || o.Id || !vnetId || typeof o.Name !== 'string') return sn;
            return { ...o, Id: `${vnetId}/subnets/${o.Name}`, ProvisioningState: o.ProvisioningState ?? 'Succeeded' };
          });
        }
        const result = await this.store.update(entry.collection, found.id, state);
        await this.auditWriter?.recordMutation({
          objectType: entry.collection,
          objectId: found.id,
          activityDisplayName: `PATCH ${cmdlet}`,
          requestVerb: 'PATCH',
          source: cmdlet,
        });
        return result;
      }
    }
    if (entry.verb === 'GET') {
      // FIDELITY tail (b): honor -Filter on cmdlet GETs so a filtered
      // Get-Mg*...NamedLocation returns the single matching object, not the
      // whole collection. Evidence recording (inside resolveEntry) keeps the
      // FULL unfiltered read; only the caller-facing result is narrowed. (c)
      // PascalCase surfacing was prototyped and backed out — see the note above.
      // P0-2 fix 8: -Identity (applyCmdletIdentity, above) is checked first -
      // it addresses one object, the way real -Identity cmdlets do - and
      // falls back to -Filter/unfiltered when absent or unmatched.
      const out = presentForCmdlet(entry.cmdlet, await this.resolveEntry(entry, 'GET'));
      const identityMatch = applyCmdletIdentity(out, args);
      return identityMatch !== undefined ? identityMatch : applyCmdletFilter(out, args);
    }
    // Graph SDK cmdlets (Verb-Mg*) map parameter names to camelCase wire
    // properties; Az/EXO object models are natively PascalCase - see
    // cmdletArgsToPatch's casing note.
    const isGraphSdkCmdlet = /^[A-Za-z]+-Mg[A-Z]/.test(entry.cmdlet);
    return this.resolveEntry(entry, entry.verb, cmdletArgsToPatch(args, { camelCaseParams: isGraphSdkCmdlet }));
  }

  /**
   * SIMFIX FIX-S1: GET of a NAMED object. Resolves the target in its own
   * collection (id or the API's real alternate key); a miss is a 404.
   *  - The entry reads that same collection -> the single object (the way a
   *    real `Get-MgUser -UserId x` returns one user, never the list).
   *  - The entry reads a sub-resource collection (Get-MgUserMemberOf,
   *    Get-MgGroupMember, Get-MgUserAuthenticationMethod, ...) -> only the
   *    records scoped to that object (record.<param> === object id, e.g.
   *    `groupId`), with -Filter still honored on top.
   */
  private async resolveTargetedGet(
    entry: NamedCmdletResolverEntry,
    target: CmdletTarget,
    args: unknown,
  ): Promise<unknown> {
    this.gate.checkAccess(entry);
    const obj = await this.lookupTarget(entry, target);
    const targetCollection = target.spec?.collection ?? entry.collection;
    let response: unknown;
    if (entry.cmdlet === 'Get-MgUserMemberOf') {
      response = applyCmdletFilter(await userMemberOf(this.store, obj), args);
    } else if (targetCollection === entry.collection) {
      response = presentForCmdlet(entry.cmdlet, obj);
    } else {
      const scopeField = lowerFirst(target.param);
      const scoped = (await this.store.list(entry.collection)).filter(
        (r) => (r as Record<string, unknown>)[scopeField] === obj.id,
      );
      const presented = entry.collection === 'groupMember' ? await presentMembers(this.store, scoped) : scoped.map(presentRecord);
      response = applyCmdletFilter(presented, args);
    }
    await this.recordEvidence(entry, 'GET', response);
    return response;
  }

  /**
   * SIMFIX FIX-S1: mutation of a NAMED object. The target must exist (404
   * otherwise, store untouched). Same-collection writes update/delete exactly
   * that object; sub-resource/action writes (Revoke-MgUserSignInSession,
   * Remove-MgGroupMemberByRef, ...) record against that object's id (plus the
   * referenced member/key id when the call carries one) - never against a
   * singleton that may be a different object.
   */
  private async resolveTargetedMutation(
    entry: NamedCmdletResolverEntry,
    verb: MutationVerb,
    patch: Record<string, unknown> | undefined,
    target: CmdletTarget,
    args: unknown,
  ): Promise<unknown> {
    this.gate.checkAccess(entry);
    if (!entry.mutationVerbs?.includes(verb)) {
      throw new Error(`ResolverTable: verb "${verb}" is not supported by resolver "${entry.cmdlet}"`);
    }
    const obj = await this.lookupTarget(entry, target);
    const targetCollection = target.spec?.collection ?? entry.collection;
    let result: unknown;
    let mutatedId: string;
    const action = TARGET_ACTIONS[entry.cmdlet];
    if (action) {
      mutatedId = obj.id;
      result = await action({
        store: this.store,
        target: obj,
        targetCollection,
        patch: patch ?? {},
        now: new Date().toISOString(),
      });
    } else if (targetCollection === entry.collection) {
      mutatedId = obj.id;
      if (verb === 'DELETE') {
        await this.store.delete(entry.collection, obj.id);
        result = { id: obj.id, deleted: true };
      } else {
        const p = entry.collection === 'users' ? transformUserPatch(patch ?? {}, new Date().toISOString()) : patch ?? {};
        result = await this.store.update(entry.collection, obj.id, p);
      }
    } else {
      const scopeField = lowerFirst(target.param);
      // The referenced member/credential: -DirectoryObjectId / -KeyId, or a
      // Graph `@odata.id` reference body (New-MgGroupMemberByRef) whose
      // trailing segment is the member's id (P0-2 fix 9). The raw reference
      // is call plumbing and is never stored.
      const { ['@odata.id']: odataRef, ...fields } = patch ?? {};
      const ref =
        referencedId(args) ??
        (typeof odataRef === 'string' ? odataRef.split('/').filter(Boolean).pop() : undefined);
      mutatedId = ref ? `${obj.id}|${ref}` : obj.id;
      if (verb === 'DELETE') {
        await this.store.delete(entry.collection, mutatedId);
        result = { id: mutatedId, deleted: true };
      } else {
        result = await this.store.upsert(entry.collection, mutatedId, {
          ...fields,
          [scopeField]: obj.id,
          ...(ref ? { memberId: ref } : {}),
        });
      }
    }
    if (this.auditWriter) {
      await this.auditWriter.recordMutation({
        objectType: entry.collection,
        objectId: mutatedId,
        activityDisplayName: `${verb} ${entry.cmdlet}`,
        requestVerb: verb,
        source: entry.cmdlet,
      });
    }
    return result;
  }

  /** Resolves a cmdlet's named target or throws NotFoundError (never a fallback). */
  private async lookupTarget(entry: NamedCmdletResolverEntry, target: CmdletTarget): Promise<StoreObject> {
    const collection = target.spec?.collection ?? entry.collection;
    const altKeys = target.spec?.altKeys ?? target.altKeys ?? IDENTITY_ALT_KEYS;
    const obj = matchTarget(await this.store.list(collection), target.value, altKeys);
    if (!obj) {
      throw new NotFoundError(
        `${entry.cmdlet} -${target.param} '${target.value}': no ${collection} object with that ${
          altKeys.length ? `id or ${altKeys.join('/')}` : 'id'
        }`,
      );
    }
    return obj;
  }

  /** Next free `<singular>-<n>` id in a collection (the seed generators' id convention). */
  private async nextId(collection: string): Promise<string> {
    const singular = collection.endsWith('ies')
      ? `${collection.slice(0, -3)}y`
      : collection.endsWith('s')
        ? collection.slice(0, -1)
        : collection;
    const existing = await this.store.list(collection);
    let max = 0;
    for (const o of existing) {
      const m = new RegExp(`^${singular}-(\\d+)$`).exec(o.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${singular}-${Math.max(max, existing.length) + 1}`;
  }

  private async recordEvidence(entry: ResolverEntry, verb: string, response: unknown): Promise<void> {
    if (!this.evidenceHold) return;
    const source = entry.kind === 'uri' ? entry.pattern : entry.cmdlet;
    await this.evidenceHold.record({
      objectType: entry.collection,
      request: { kind: entry.kind, identifier: source, verb },
      response,
      source,
    });
  }

  /**
   * GP-DEMO-2 (2026-07-28): Invoke-AzRestMethod's -Method decides GET vs
   * mutation at RESOLUTION time (parseInvokeAzRestMethodArgs, above) - the
   * cmdlet itself is registered once in azureResolvers.ts as a generic
   * mutation fallback (collection 'restMethod'), which this method only
   * reaches for non-GET calls whose -Path doesn't match one of the
   * specifically-modeled ARM resources in azRestMethodPathResolvers
   * (locks / Sentinel Ueba settings - the two real infra-registry
   * get_command shapes this fix was reproduced against).
   *  - GET: never mutates. A path match resolves + evidence-records like
   *    any other read (same as resolveUri's GET branch). An unmatched path
   *    is an honest, non-fabricated empty/unknown shape (Core Design (e)/
   *    (c): the sim never invents state for a resource it doesn't model) -
   *    no store touch, no ledger entry, mirroring what a real tenant's
   *    truthful "nothing to report" would look like for a passthrough this
   *    sim doesn't model.
   *  - non-GET: existing mutation path, verb taken from -Method (PUT maps
   *    to PATCH - this codebase's established idempotent-PUT-as-merge-patch
   *    convention, see azCliResolvers.ts's `az rest --method PUT` note).
   */
  private async resolveInvokeAzRestMethod(args: unknown): Promise<unknown> {
    const { method, path } = parseInvokeAzRestMethodArgs(args);
    const normalized = path ? normalizeUri(path) : undefined;
    // W5c2 follow-up 12: the ARM action-group list (subscription or resource group).
    const ag = normalized ? /^\/subscriptions\/([^/]+)(?:\/resourceGroups\/([^/]+))?\/providers\/Microsoft\.Insights\/actionGroups$/i.exec(normalized) : null;
    if (ag && method === 'GET') {
      const lc = (v: unknown) => String(v ?? '').toLowerCase();
      const rows = (await this.store.list('actionGroup')).filter((g) => {
        const id = lc((g as Record<string, unknown>).id);
        return id.startsWith(`/subscriptions/${lc(ag[1])}/`) && (ag[2] === undefined || id.includes(`/resourcegroups/${lc(ag[2])}/`));
      });
      return { value: rows.map((g) => actionGroupArm(g)) };
    }
    const matched = normalized
      ? azRestMethodPathResolvers.find((e) => matchesPattern(e.pattern, normalized))
      : undefined;

    if (method === 'GET') {
      if (matched) {
        return this.resolveEntry(matched, 'GET');
      }
      return {};
    }

    const mutationVerb: MutationVerb = method === 'PUT' ? 'PATCH' : MUTATION_VERBS.includes(method as MutationVerb) ? (method as MutationVerb) : 'POST';

    if (matched && matched.mutationVerbs?.includes(mutationVerb)) {
      return this.resolveEntry(matched, mutationVerb, cmdletArgsToPatch(args));
    }

    const fallbackEntry = this.entries.find(
      (e): e is NamedCmdletResolverEntry => e.kind === 'cmdlet' && e.cmdlet === 'Invoke-AzRestMethod',
    );
    if (!fallbackEntry) {
      throw new Error('ResolverTable: no resolver registered for cmdlet "Invoke-AzRestMethod"');
    }
    return this.resolveEntry(fallbackEntry, mutationVerb, cmdletArgsToPatch(args));
  }

  async resolveUri(method: string, uri: string, body?: unknown): Promise<unknown> {
    const normalized = normalizeUri(uri);
    // FX-10: see resolveCmdlet.
    await validateUriRequest(this.store, method, normalized, body);
    // PH-12 P12-AO: REST paths AdminOps sends that no other resolver serves (aoResolvers.ts).
    { const ao = await resolveAoUri({ store: this.store, auditWriter: this.auditWriter }, method, normalized, body); if (ao !== undefined) return ao; }
    // PH-13 P13-LV: the MFA method delete of AdminOps A-22, leaver access termination (leaverResolvers.ts).
    { const lv = await resolveLeaverUri({ store: this.store, auditWriter: this.auditWriter }, method, normalized); if (lv !== undefined) return lv; }
    // DEPTH-10.4 (PH-12 P12-R3): Entra activity-based (idle web session) timeout policies - depth10SCResolvers.ts.
    if (/^\/(?:v1\.0|beta)\/policies\/activityBasedTimeoutPolicies(?:\/[^/]+)?$/.test(normalized)) return resolveDepth10Sc({ store: this.store, auditWriter: this.auditWriter }, method, normalized, body);
    // DEPTH-10.2 (P12-R1): directory-setting and enrollment-configuration writes - depth10IaResolvers.ts.
    const depth10Ia = await resolveDepth10IaUri({ store: this.store, auditWriter: this.auditWriter }, method, normalized, body);
    if (depth10Ia !== undefined) return depth10Ia;
    // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-ao-paired-read-endpoints, A-07
    // optional follow-up): the per-user MFA requirement is a Graph BETA
    // resource keyed by a user id/UPN in the MIDDLE of the path
    // ('/beta/users/{id}/authentication/requirements'), not a trailing '*'
    // this table's generic dynamic-id capture (matchPatternCapture) supports.
    // Special-cased like resolveInvokeAzRestMethod above: read-only, never
    // mutates, honest 404 on an unknown user - AO's A-07 set stores
    // perUserMfaState on the user (Set-MgUserAuthenticationMethodRequirement,
    // semantics.ts TARGET_ACTIONS) and this read surfaces exactly that field.
    if (method === 'GET') {
      const mfaMatch = /^\/beta\/users\/([^/]+)\/authentication\/requirements$/.exec(normalized);
      if (mfaMatch) {
        return this.resolvePerUserMfaRequirement(decodeURIComponent(mfaMatch[1]));
      }
    }
    // synthetic-customer W1 (2026-10-28): the signed-in operator and the
    // derived PIM eligibility instances (read-only; never mutate).
    if (method === 'GET' && normalized === '/v1.0/me') return this.resolveMe();
    if (method === 'GET' && normalized === '/v1.0/roleManagement/directory/roleEligibilityScheduleInstances') {
      const rows = await this.resolveEligibilityInstances();
      const expr = extractODataFilter(uri);
      return { value: expr !== undefined ? applyODataFilter(rows, parseODataFilter(expr)) : rows };
    }
    // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-run-hunting-query): EO's
    // vulnerability-recency signal is a POST that only READS (the advanced-
    // hunting query API has no other shape) - ComplianceSignalFetcher.
    // fetchGraphCollection always sends -Method POST for this one URI with a
    // KQL query body it never inspects the content of here (the sim answers
    // from its own seeded managedDevices state, not the caller's KQL text -
    // same "never told which command is running" principle as the AO
    // semantic runner). Never mutates: no store write, no audit/ledger entry.
    // EO-collection W2.2 (2026-10-27): the answer now depends on the table the
    // KQL names (resolveHuntingQuery).
    // W5c2 follow-up 10 (SIM-W4c1..W4c7): EO coverage sub-resource reads.
    if (method === 'GET') {
      const sub = await this.resolveCoverageSubresource(uri, normalized);
      if (sub !== undefined) return sub;
    }
    // W5c2 follow-up 9: activated directory roles as REST reads, from the
    // same store the cmdlets read (`directoryRole`, `directoryRoleMember`):
    // the list (with `$expand=members`), one role, and its members.
    const roleMatch = /^\/(?:v1\.0|beta)\/directoryRoles(?:\/([^/]+)(\/members)?)?$/.exec(normalized);
    if (roleMatch && method === 'GET') return this.resolveDirectoryRoles(uri, roleMatch[1] !== undefined ? decodeURIComponent(roleMatch[1]) : undefined, roleMatch[2] !== undefined);
    // W5c2 follow-up 7: Intune `POST .../{id}/assign` stores the object's
    // `assignments` (Graph replaces the whole set); `GET .../{id}/assignments`
    // reads them.
    const assignMatch = ASSIGN_URI.exec(normalized);
    if (assignMatch) {
      const collection = ASSIGNABLE[assignMatch[1]];
      const id = decodeURIComponent(assignMatch[2]);
      const obj = matchTarget(await this.store.list(collection), id, []);
      if (!obj) throw new NotFoundError(`${method} ${normalized}: no ${collection} object with id "${id}"`);
      if (assignMatch[3] === 'assignments') {
        if (method !== 'GET') throw new BadRequestError(`${method} ${normalized}: the assignments of an Intune policy are written through /assign`);
        return { value: ((obj as Record<string, unknown>).assignments as unknown[] | undefined) ?? [] };
      }
      if (method !== 'POST') throw new BadRequestError(`${method} ${normalized}: /assign is a POST action`);
      return this.assignIntunePolicy(collection, obj, body, normalized);
    }
    // synthetic-customer W5c2: a PIM policy's rules sub-resource reads and
    // writes the policy's own `rules` list (see resolveCmdlet).
    const ruleMatch = /^\/(?:v1\.0|beta)\/policies\/roleManagementPolicies\/([^/]+)\/rules(?:\/([^/]+))?$/.exec(normalized);
    if (ruleMatch) {
      const policyId = decodeURIComponent(ruleMatch[1]);
      const ruleId = ruleMatch[2] !== undefined ? decodeURIComponent(ruleMatch[2]) : undefined;
      if (method === 'GET') {
        const out = await this.readPolicyRules(policyId, ruleId);
        if (ruleId !== undefined) return out;
        const expr = extractODataFilter(uri);
        const rows = out as Record<string, unknown>[];
        return { value: expr !== undefined ? applyODataFilter(rows, parseODataFilter(expr)) : rows };
      }
      if (method === 'PATCH' && ruleId !== undefined) {
        const patch = body && typeof body === 'object' && !Array.isArray(body) ? { ...(body as Record<string, unknown>) } : {};
        return this.writePolicyRule(policyId, ruleId, patch, `PATCH ${normalized}`, `Invoke-MgGraphRequest PATCH ${normalized}`);
      }
      throw new BadRequestError(`${method} ${normalized}: the rules of a role management policy support GET and PATCH of one rule only`);
    }
    // W7-SIM (2026-10-29): PATCH one lifecycle workflow (AO's A-21).
    if (method === 'PATCH') {
      const lw = /^\/v1\.0\/identityGovernance\/lifecycleWorkflows\/workflows\/([^/]+)$/.exec(normalized);
      if (lw) {
        let id = lw[1];
        try {
          id = decodeURIComponent(id);
        } catch {
          /* keep the raw segment */
        }
        return this.patchLifecycleWorkflow(id, body);
      }
    }
    if (method === 'POST' && normalized === '/v1.0/security/runHuntingQuery') {
      return this.resolveHuntingQuery(body);
    }
    // P1.4c (2026-10-27): createInstance on an Intune template creates a new
    // intent (deviceManagementIntents, listed by /beta/deviceManagement/intents
    // and Get-MgDeviceManagementIntent) with a new GUID id and the template's
    // id - it used to upsert an object keyed 'deviceManagementInstances'.
    if (method === 'POST') {
      const ci = /^\/beta\/deviceManagement\/templates\/([^/]+)\/createInstance$/.exec(normalized);
      if (ci) return this.resolveCreateInstance(decodeURIComponent(ci[1]), body);
    }
    let dynamicId: string | undefined;
    const entry = this.entries.find((e): e is UriPatternResolverEntry => {
      if (e.kind !== 'uri') return false;
      const captures = matchPatternCapture(e.pattern, normalized);
      if (captures === null) return false;
      // G-STACKSIM-2 iteration 3: a pattern's single `*` segment (e.g.
      // '/v1.0/identity/conditionalAccess/policies/*') captures the real id
      // Graph itself returned from an earlier GET, e.g. AO's A-10/A-20
      // DELETE (and A-19's PATCH) a specific object by id rather than a
      // fixed singleton - see matchPatternCapture()'s doc comment.
      // GP-STACKSIM-1 M3 fidelity fix (2026-07-25): only a wildcard in the
      // FINAL path segment is a resource id. A middle `*` (the vault name in
      // '/azcli/keyvault/*/certificates', the NSG name in
      // '/azcli/network/nsgs/*/rules') is a SCOPING segment - the URI still
      // addresses the collection named by its last segment, exactly as the
      // real APIs do. Treating those captures as item ids made STAB-1 M1b's
      // honest item-level 404 fire on collection reads (the ao:C-05/C-03/
      // F-06 500s in the 2026-07-25 coverage re-run).
      if (captures.length > 0 && e.pattern.split('/').pop() === '*') {
        dynamicId = captures[captures.length - 1];
      }
      return true;
    });
    if (!entry) {
      throw new Error(`ResolverTable: no resolver registered for URI "${uri}"`);
    }
    if (dynamicId !== undefined) {
      try {
        dynamicId = decodeURIComponent(dynamicId);
      } catch {
        /* keep the raw segment */
      }
    }
    const out = await this.resolveEntry(entry, method, body, dynamicId);
    // SIMFIX FIX-S1: honor `$filter` on collection GETs. normalizeUri strips
    // the query string, so AO's A-10 `roleAssignments?$filter=principalId eq
    // '<id>' and roleDefinitionId eq '<ga>'` used to return EVERY assignment -
    // and its `foreach ... DELETE` would then have deleted every one.
    // EO-collection B20 / W2.1: the grammar is parseODataFilter's (eq, ne,
    // ge, gt, le, lt joined by `and`); anything else throws BadRequestError
    // (HTTP 400) instead of silently returning the whole collection.
    let filtered = out;
    if (method === 'GET' && dynamicId === undefined) {
      const expr = extractODataFilter(uri);
      const clauses = expr !== undefined ? parseODataFilter(expr) : undefined;
      if (clauses) {
        if (Array.isArray(out)) filtered = applyODataFilter(out, clauses);
        else if (out && typeof out === 'object' && Array.isArray((out as { value?: unknown }).value)) {
          filtered = { ...(out as object), value: applyODataFilter((out as { value: unknown[] }).value, clauses) };
        }
      }
    }
    // W5c1-c: PIM policy `rules` and settings-catalog `settings` come back
    // only with `$expand`, as on Graph (EO's reads ask for them).
    const navs = method === 'GET' ? EXPAND_ONLY[entry.collection] : undefined;
    if (navs) filtered = projectExpand(filtered, navs, extractODataExpand(uri));
    // W5c1-b (SIM-9): honour `$select` on user reads, as Graph does: only the
    // selected properties come back (signInActivity, displayName and jobTitle
    // are absent unless selected). Users only; other collections still
    // return whole objects.
    // W5c2 follow-up 4 (SIM-11): deleted users too.
    if (method === 'GET' && (entry.collection === 'users' || entry.collection === 'deletedUsers')) {
      const select = extractODataSelect(uri);
      if (select) return projectSelect(filtered, select);
    }
    return filtered;
  }

  /**
   * W5c2 follow-up 7: the `/assign` action. Body `{ assignments: [{ target, ... }] }`;
   * each stored assignment is `{ id: '<policyId>_<groupId>', target }` (Graph's
   * id form; an all-devices / all-users target keeps its `@odata.type` as the
   * id suffix). The set replaces the object's assignments, and `isAssigned`
   * follows. Answers the assignment collection, as Graph does.
   */
  private async assignIntunePolicy(collection: string, obj: StoreObject, body: unknown, normalized: string): Promise<unknown> {
    let b = body;
    if (typeof b === 'string') {
      try {
        b = JSON.parse(b) as unknown;
      } catch {
        throw new BadRequestError(`POST ${normalized}: the body is not JSON`);
      }
    }
    const list = (unwrapPsArrays(b) as { assignments?: unknown } | undefined)?.assignments;
    if (!Array.isArray(list)) throw new BadRequestError(`POST ${normalized}: the body needs an assignments array`);
    const assignments = list.map((a) => {
      const target = ((a ?? {}) as Record<string, unknown>).target as Record<string, unknown> | undefined;
      if (!target || typeof target !== 'object') throw new BadRequestError(`POST ${normalized}: each assignment needs a target`);
      const suffix = typeof target.groupId === 'string' ? target.groupId : String(target['@odata.type'] ?? 'target').replace(/^#microsoft\.graph\./, '');
      return { id: `${obj.id}_${suffix}`, target };
    });
    await this.store.update(collection, obj.id, { assignments, isAssigned: assignments.length > 0 } as Partial<StoreObject>);
    await this.auditWriter?.recordMutation({
      objectType: collection,
      objectId: obj.id,
      activityDisplayName: `POST ${normalized}`,
      requestVerb: 'POST',
      source: `Invoke-MgGraphRequest POST ${normalized}`,
    });
    return { value: assignments };
  }

  /**
   * W5c2 follow-up 10: the EO coverage sub-resources (undefined = not one of them).
   *  - /beta|v1.0/deviceManagement/managedDevices/{id}/windowsProtectionState
   *  - /beta/deviceManagement/windowsMalwareInformation/{id}[/deviceMalwareStates]
   *  - /v1.0/identityGovernance/termsOfUse/agreements/{id}[/acceptances]
   *  - /v1.0/identityGovernance/accessReviews/definitions/{id}[/instances[/{iid}[/decisions]]]
   *  - /v1.0/sites/{id}/permissions (the site by its Graph id, or the spoSites id)
   * Lists honour `$filter`; one page, as everywhere in the Sim.
   */
  private async resolveCoverageSubresource(uri: string, normalized: string): Promise<unknown> {
    const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
    const list = (rows: StoreObject[]) => {
      const expr = extractODataFilter(uri);
      return { value: expr !== undefined ? applyODataFilter(rows, parseODataFilter(expr)) : rows };
    };
    const need = async (collection: string, id: string, what: string): Promise<StoreObject> => {
      const o = matchTarget(await this.store.list(collection), id, []);
      if (!o) throw new NotFoundError(`GET ${normalized}: no ${what} with id "${id}"`);
      return o;
    };
    let m = /^\/(?:v1\.0|beta)\/deviceManagement\/managedDevices\/([^/]+)\/windowsProtectionState$/.exec(normalized);
    if (m) {
      const device = await need('managedDevices', dec(m[1]), 'managed device');
      const state = matchTarget(await this.store.list('windowsProtectionStates'), device.id, []);
      if (!state) throw new NotFoundError(`GET ${normalized}: managed device "${device.id}" reports no Windows protection state`);
      return state;
    }
    m = /^\/beta\/deviceManagement\/windowsMalwareInformation\/([^/]+)(\/deviceMalwareStates)?$/.exec(normalized);
    if (m) {
      const malware = await need('windowsMalwareInformation', dec(m[1]), 'malware information');
      if (!m[2]) return malware;
      return list((await this.store.list('deviceMalwareStates')).filter((r) => (r as Record<string, unknown>).malwareId === malware.id));
    }
    m = /^\/v1\.0\/identityGovernance\/termsOfUse\/agreements\/([^/]+)(\/acceptances)?$/.exec(normalized);
    if (m) {
      const agreement = await need('touAgreements', dec(m[1]), 'terms of use agreement');
      if (!m[2]) return agreement;
      return list((await this.store.list('touAgreementAcceptances')).filter((r) => (r as Record<string, unknown>).agreementId === agreement.id));
    }
    m = /^\/v1\.0\/identityGovernance\/accessReviews\/definitions\/([^/]+)(?:\/instances(?:\/([^/]+)(\/decisions)?)?)?$/.exec(normalized);
    if (m) {
      const def = await need('accessReviewDefinitions', dec(m[1]), 'access review definition');
      const wantsInstances = /\/instances/.test(normalized);
      if (!wantsInstances) return def;
      const instances = (await this.store.list('accessReviewInstances')).filter((r) => (r as Record<string, unknown>).definitionId === def.id);
      if (m[2] === undefined) return list(instances);
      const inst = matchTarget(instances, dec(m[2]), []);
      if (!inst) throw new NotFoundError(`GET ${normalized}: no instance "${dec(m[2])}" of access review "${def.id}"`);
      if (!m[3]) return inst;
      return list((await this.store.list('accessReviewDecisions')).filter((r) => (r as Record<string, unknown>).instanceId === inst.id));
    }
    m = /^\/v1\.0\/sites\/([^/]+)\/permissions$/.exec(normalized);
    if (m) {
      const id = dec(m[1]);
      const site = (await this.store.list('spoSites')).find((x) => x.id === id || String((x as Record<string, unknown>).GraphSiteId ?? '').toLowerCase() === id.toLowerCase());
      if (!site) throw new NotFoundError(`GET ${normalized}: no SharePoint site with id "${id}"`);
      const graphId = String((site as Record<string, unknown>).GraphSiteId ?? site.id);
      return list((await this.store.list('sitePermissions')).filter((r) => (r as Record<string, unknown>).siteId === graphId));
    }
    return undefined;
  }

  /**
   * W5c2 follow-up 11: the Az key-management cmdlets.
   *  - Get-AzKeyVault [-ResourceGroupName] [-VaultName]: the vaults with the
   *    Az.KeyVault properties (VaultName, ResourceId, ResourceGroupName ...),
   *    scoped by resource group; -VaultName returns that one vault (none: empty).
   *  - New-AzKeyVault: a NEW vault (never onto an existing one; a taken name is
   *    a 400) with the posted properties; soft delete is always on.
   *  - Get-/New-AzRoleAssignment: Azure RBAC assignments in their own
   *    collection (`azRoleAssignments`), filtered by -Scope, -RoleDefinitionName,
   *    -ObjectId; a duplicate assignment is a 400 (Azure's Conflict).
   *  - Get-AzVM [-ResourceGroupName] [-Name]: the virtual machines of the ARM
   *    store, with their `Identity` block.
   *  - Get-AzUserAssignedIdentity [-ResourceGroupName]: user-assigned identities
   *    in that resource group (rows without one are not in any group).
   */
  private async resolveAzKeyManagement(cmdlet: string, args: unknown): Promise<unknown> {
    const p = (name: string) => cmdletParamValue(args, name.toLowerCase());
    const has = (name: string) => Array.isArray(args) && args.some((a) => typeof a === 'string' && a.replace(/:.*$/, '').toLowerCase() === `-${name.toLowerCase()}`);
    const lc = (v: unknown) => String(v ?? '').toLowerCase();
    const rgOf = (id: unknown) => /\/resourceGroups\/([^/]+)/i.exec(String(id ?? ''))?.[1];
    const rg = p('ResourceGroupName');
    const vaultView = (v: StoreObject) => {
      const o = v as Record<string, unknown>;
      const resourceId = String(o.ResourceId ?? o.Id ?? '');
      return { ...o, VaultName: o.VaultName ?? o.name, ResourceId: resourceId || undefined, ResourceGroupName: o.ResourceGroupName ?? rgOf(resourceId) };
    };
    if (cmdlet === 'Get-AzKeyVault') {
      let vaults = (await this.store.list('keyVaults')).map(vaultView);
      if (rg !== undefined) vaults = vaults.filter((v) => lc(v.ResourceGroupName) === lc(rg));
      const name = p('VaultName') ?? p('Name');
      if (name !== undefined) return vaults.find((v) => lc(v.VaultName) === lc(name)) ?? [];
      return vaults;
    }
    if (cmdlet === 'New-AzKeyVault') {
      const name = p('VaultName') ?? p('Name');
      const group = rg;
      if (name === undefined || group === undefined) throw new BadRequestError('New-AzKeyVault: -VaultName and -ResourceGroupName are required');
      const existing = (await this.store.list('keyVaults')).map(vaultView);
      if (existing.some((v) => lc(v.VaultName) === lc(name))) throw new BadRequestError(`New-AzKeyVault: the vault name '${name}' is already in use`);
      const arm = await this.store.list('armResources');
      const armSub = (arm.find((r) => (r as Record<string, unknown>).type === 'Microsoft.Resources/subscriptions') as Record<string, unknown> | undefined)?.subscriptionId;
      const vaultSub = /\/subscriptions\/([^/]+)/i.exec(String(existing[0]?.ResourceId ?? ''))?.[1];
      const sub = String(armSub ?? vaultSub ?? 'sim-sub');
      const resourceId = `/subscriptions/${sub}/resourceGroups/${group}/providers/Microsoft.KeyVault/vaults/${name}`;
      const retention = Number(p('SoftDeleteRetentionInDays') ?? 90);
      const vault = {
        id: `keyVault-${name}`,
        name,
        VaultName: name,
        Id: resourceId,
        ResourceId: resourceId,
        ResourceGroupName: group,
        Location: p('Location') ?? 'usgovvirginia',
        Sku: p('Sku') ?? 'Standard',
        VaultUri: `https://${name}.vault.usgovcloudapi.net/`,
        EnablePurgeProtection: has('EnablePurgeProtection'),
        EnableSoftDelete: true,
        SoftDeleteRetentionInDays: Number.isFinite(retention) ? retention : 90,
        EnableRbacAuthorization: has('EnableRbacAuthorization'),
      };
      const created = await this.store.create('keyVaults', vault as StoreObject);
      await this.auditWriter?.recordMutation({ objectType: 'keyVaults', objectId: created.id, activityDisplayName: 'POST New-AzKeyVault', requestVerb: 'POST', source: cmdlet });
      return vaultView(created);
    }
    if (cmdlet === 'Get-AzRoleAssignment') {
      const scope = p('Scope');
      const role = p('RoleDefinitionName');
      const objectId = p('ObjectId');
      return (await this.store.list('azRoleAssignments')).filter((a) => {
        const o = a as Record<string, unknown>;
        return (scope === undefined || lc(o.Scope) === lc(scope)) && (role === undefined || lc(o.RoleDefinitionName) === lc(role)) && (objectId === undefined || lc(o.ObjectId) === lc(objectId));
      });
    }
    if (cmdlet === 'New-AzRoleAssignment') {
      const scope = p('Scope');
      const role = p('RoleDefinitionName');
      const objectId = p('ObjectId');
      if (scope === undefined || role === undefined || objectId === undefined) throw new BadRequestError('New-AzRoleAssignment: -ObjectId, -RoleDefinitionName and -Scope are required');
      const all = await this.store.list('azRoleAssignments');
      if (all.some((a) => { const o = a as Record<string, unknown>; return lc(o.Scope) === lc(scope) && lc(o.RoleDefinitionName) === lc(role) && lc(o.ObjectId) === lc(objectId); })) {
        throw new BadRequestError(`New-AzRoleAssignment: Conflict: the role assignment already exists (${objectId}, '${role}', ${scope})`);
      }
      const id = `azRoleAssignment-${all.length + 1}`;
      const created = await this.store.create('azRoleAssignments', {
        id,
        RoleAssignmentId: `${scope}/providers/Microsoft.Authorization/roleAssignments/${id}`,
        Scope: scope,
        DisplayName: null,
        ObjectId: objectId,
        ObjectType: 'ServicePrincipal',
        RoleDefinitionName: role,
        CanDelegate: false,
      } as StoreObject);
      await this.auditWriter?.recordMutation({ objectType: 'azRoleAssignments', objectId: created.id, activityDisplayName: 'POST New-AzRoleAssignment', requestVerb: 'POST', source: cmdlet });
      return created;
    }
    if (cmdlet === 'Get-AzVM') {
      const name = p('Name');
      const vms = (await this.store.list('armResources'))
        .filter((r) => (r as Record<string, unknown>).type === 'Microsoft.Compute/virtualMachines')
        .map((r) => {
          const o = r as Record<string, any>;
          return {
            ...o,
            Name: o.name,
            Id: o.id,
            ResourceGroupName: rgOf(o.id),
            Location: o.location,
            Identity: o.identity ? { Type: o.identity.type, PrincipalId: o.identity.principalId, TenantId: o.identity.tenantId ?? null } : null,
            ProvisioningState: o.properties?.provisioningState,
          };
        })
        .filter((v) => rg === undefined || lc(v.ResourceGroupName) === lc(rg));
      if (name !== undefined) return vms.find((v) => lc(v.Name) === lc(name)) ?? [];
      return vms;
    }
    // Get-AzUserAssignedIdentity
    const ids = (await this.store.list('managedIdentities')).map((m) => {
      const o = m as Record<string, unknown>;
      return { ...o, Name: o.Name ?? o.name, ResourceGroupName: o.ResourceGroupName ?? rgOf(o.Id ?? o.id) };
    });
    return rg === undefined ? ids : ids.filter((m) => lc(m.ResourceGroupName) === lc(rg));
  }

  /**
   * W5c2 follow-up 12: Azure Monitor action groups.
   *  - New-AzActionGroupEmailReceiverObject: a local constructor (nothing stored).
   *  - Get-AzActionGroup [-ResourceGroupName] [-Name]: subscription-wide or one
   *    group's list; -Name returns that group (none: empty).
   *  - New-AzActionGroup: create-or-update (ARM PUT) by resource group and name,
   *    with the posted receivers; Enabled defaults to true.
   *  - Set-AzActionGroup: update an existing group (404 when there is none).
   */
  private async resolveAzActionGroup(cmdlet: string, args: unknown): Promise<unknown> {
    const p = (name: string) => cmdletParamValue(args, name.toLowerCase());
    const raw = (name: string): unknown => {
      if (!Array.isArray(args)) return undefined;
      const i = args.findIndex((a) => typeof a === 'string' && a.replace(/:$/, '').toLowerCase() === `-${name.toLowerCase()}`);
      return i === -1 ? undefined : unwrapPsArrays(args[i + 1]);
    };
    const lc = (v: unknown) => String(v ?? '').toLowerCase();
    const receiver = (r: unknown) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { Name: o.Name ?? o.name, EmailAddress: o.EmailAddress ?? o.emailAddress, UseCommonAlertSchema: o.UseCommonAlertSchema ?? o.useCommonAlertSchema ?? false, Status: 'Enabled' };
    };
    if (cmdlet === 'New-AzActionGroupEmailReceiverObject') {
      return receiver({ Name: p('Name'), EmailAddress: p('EmailAddress'), UseCommonAlertSchema: raw('UseCommonAlertSchema') === true || /^\$?true$/i.test(String(raw('UseCommonAlertSchema') ?? '')) });
    }
    const rg = p('ResourceGroupName');
    const name = p('Name');
    const groups = await this.store.list('actionGroup');
    if (cmdlet === 'Get-AzActionGroup') {
      const scoped = groups.filter((g) => rg === undefined || lc((g as Record<string, unknown>).ResourceGroupName) === lc(rg));
      if (name !== undefined) return scoped.find((g) => lc((g as Record<string, unknown>).Name) === lc(name)) ?? [];
      return scoped;
    }
    if (rg === undefined || name === undefined) throw new BadRequestError(`${cmdlet}: -ResourceGroupName and -Name are required`);
    const existing = groups.find((g) => lc((g as Record<string, unknown>).Name) === lc(name) && lc((g as Record<string, unknown>).ResourceGroupName) === lc(rg));
    const emails = raw('EmailReceiver');
    const fields: Record<string, unknown> = {};
    if (emails !== undefined) fields.EmailReceiver = (Array.isArray(emails) ? emails : [emails]).map(receiver);
    if (p('ShortName') !== undefined) fields.GroupShortName = p('ShortName');
    if (p('Location') !== undefined) fields.Location = p('Location');
    const enabled = raw('Enabled') ?? raw('Enable');
    if (enabled !== undefined) fields.Enabled = enabled === true || /^\$?true$/i.test(String(enabled));
    let out: StoreObject;
    if (cmdlet === 'Set-AzActionGroup' && !existing) throw new NotFoundError(`Set-AzActionGroup: no action group '${name}' in resource group '${rg}'`);
    if (existing) {
      out = await this.store.update('actionGroup', existing.id, fields as Partial<StoreObject>);
    } else {
      const arm = await this.store.list('armResources');
      const sub = String((arm.find((r) => (r as Record<string, unknown>).type === 'Microsoft.Resources/subscriptions') as Record<string, unknown> | undefined)?.subscriptionId ?? 'sim-sub');
      const id = `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Insights/actionGroups/${name}`;
      out = await this.store.create('actionGroup', { id, Id: id, Name: name, ResourceGroupName: rg, Location: 'Global', Enabled: true, EmailReceiver: [], SmsReceiver: [], WebhookReceiver: [], ...fields } as StoreObject);
    }
    await this.auditWriter?.recordMutation({ objectType: 'actionGroup', objectId: out.id, activityDisplayName: `${existing ? 'PATCH' : 'POST'} ${cmdlet}`, requestVerb: existing ? 'PATCH' : 'POST', source: cmdlet });
    return out;
  }

  /** W5c2 follow-up 9: `/directoryRoles`, `/directoryRoles/{id}` and `/directoryRoles/{id}/members` (members as user directory objects). */
  private async resolveDirectoryRoles(uri: string, roleId: string | undefined, membersOnly: boolean): Promise<unknown> {
    const roles = await this.store.list('directoryRole');
    const rows = await this.store.list('directoryRoleMember');
    const membersOf = (id: string) => rows.filter((m) => (m as Record<string, unknown>).directoryRoleId === id).map((m) => presentRecord(m));
    if (roleId === undefined) {
      const expand = extractODataExpand(uri) ?? [];
      const withMembers = expand.includes('members') || expand.includes('*');
      const list = withMembers ? roles.map((r) => ({ ...r, members: membersOf(r.id) })) : roles;
      const expr = extractODataFilter(uri);
      return { value: expr !== undefined ? applyODataFilter(list, parseODataFilter(expr)) : list };
    }
    const role = matchTarget(roles, roleId, []);
    if (!role) throw new NotFoundError(`GET /directoryRoles/${roleId}: no directory role with that id`);
    return membersOnly ? { value: membersOf(role.id) } : role;
  }

  /** W5c2: a role management policy by id (404 otherwise). */
  private async rolePolicy(policyId: string): Promise<StoreObject> {
    const policy = matchTarget(await this.store.list('roleManagementPolicies'), policyId, []);
    if (!policy) throw new NotFoundError(`roleManagementPolicies '${policyId}': no role management policy with that id`);
    return policy;
  }

  /** W5c2: the policy's rules, or the one rule named (404 when absent). */
  private async readPolicyRules(policyId: string, ruleId: string | undefined): Promise<unknown> {
    const policy = await this.rolePolicy(policyId);
    const rules = ((policy as Record<string, unknown>).rules as Record<string, unknown>[] | undefined) ?? [];
    if (ruleId === undefined) return rules;
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) throw new NotFoundError(`roleManagementPolicies '${policyId}' rule '${ruleId}': no such rule`);
    return rule;
  }

  /**
   * W5c2: PATCH one rule of a policy. The body's properties replace the
   * rule's (Graph replaces `setting` whole); the rule keeps its id. The
   * policy's `rules` list is written back, so the next policy read (and
   * EO's `$expand=rules`) shows it.
   */
  private async writePolicyRule(policyId: string, ruleId: string, patch: Record<string, unknown>, activity: string, source: string): Promise<unknown> {
    const policy = await this.rolePolicy(policyId);
    const rules = ((policy as Record<string, unknown>).rules as Record<string, unknown>[] | undefined) ?? [];
    const i = rules.findIndex((r) => r.id === ruleId);
    if (i === -1) throw new NotFoundError(`roleManagementPolicies '${policyId}' rule '${ruleId}': no such rule`);
    const { id: _ignored, ...fields } = unwrapPsArrays(patch) as Record<string, unknown>;
    const updated = { ...rules[i], ...fields, id: ruleId };
    const next = rules.map((r, j) => (j === i ? updated : r));
    await this.store.update('roleManagementPolicies', policy.id, { rules: next } as Partial<StoreObject>);
    await this.auditWriter?.recordMutation({
      objectType: 'roleManagementPolicies',
      objectId: `${policy.id}|${ruleId}`,
      activityDisplayName: activity,
      requestVerb: 'PATCH',
      source,
    });
    return updated;
  }

  /**
   * W7-SIM (2026-10-29): `PATCH /v1.0/identityGovernance/lifecycleWorkflows/workflows/{id}`.
   * The body (an object, or the JSON string AO's A-21 sends) may set
   * `isEnabled` and `isSchedulingEnabled` (booleans); any other property is
   * a 400. As on Graph, a workflow cannot be scheduled while disabled
   * (`isSchedulingEnabled` true with `isEnabled` false is a 400). A missing
   * workflow is a 404. The change is stored on the workflow (the next list
   * or item read shows it) and written to the directory audit, as every
   * other write is.
   */
  private async patchLifecycleWorkflow(id: string, body: unknown): Promise<unknown> {
    const pattern = '/v1.0/identityGovernance/lifecycleWorkflows/workflows/*';
    const entry = this.entries.find((e): e is UriPatternResolverEntry => e.kind === 'uri' && e.pattern === pattern);
    if (!entry) throw new Error(`ResolverTable: no resolver registered for URI "${pattern}"`);
    this.gate.checkAccess(entry);
    let b = body;
    if (typeof b === 'string') {
      try {
        b = JSON.parse(b) as unknown;
      } catch {
        throw new BadRequestError(`PATCH ${pattern}: the body is not JSON`);
      }
    }
    b = unwrapPsArrays(b);
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new BadRequestError(`PATCH ${pattern}: the body must be a JSON object`);
    const ALLOWED = ['isEnabled', 'isSchedulingEnabled'];
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
      const name = ALLOWED.find((a) => a.toLowerCase() === k.toLowerCase());
      if (name === undefined) throw new BadRequestError(`PATCH ${pattern}: property "${k}" cannot be updated (the simulator accepts isEnabled and isSchedulingEnabled)`);
      if (typeof v !== 'boolean') throw new BadRequestError(`PATCH ${pattern}: ${name} must be a boolean`);
      patch[name] = v;
    }
    const wf = matchTarget(await this.store.list('lifecycleWorkflows'), id, []);
    if (!wf) throw new NotFoundError(`PATCH ${pattern}: no lifecycleWorkflows object with id "${id}"`);
    const next = { ...(wf as Record<string, unknown>), ...patch };
    if (next.isSchedulingEnabled === true && next.isEnabled !== true) {
      throw new BadRequestError(`PATCH ${pattern}: workflow "${wf.id}" cannot be scheduled while it is disabled (isEnabled false)`);
    }
    const result = await this.store.update('lifecycleWorkflows', wf.id, patch as Partial<StoreObject>);
    await this.auditWriter?.recordMutation({
      objectType: 'lifecycleWorkflows',
      objectId: wf.id,
      activityDisplayName: `PATCH ${pattern}`,
      requestVerb: 'PATCH',
      source: pattern,
    });
    return result;
  }

  private async resolveCreateInstance(templateId: string, body: unknown): Promise<unknown> {
    const template = matchTarget(await this.store.list('deviceManagementTemplates'), templateId, []);
    if (!template) {
      throw new NotFoundError(
        `POST /beta/deviceManagement/templates/${templateId}/createInstance: no deviceManagementTemplates object with that id`,
      );
    }
    const b = (body as Record<string, unknown> | undefined) ?? {};
    const assignments = Array.isArray(b.assignments) ? b.assignments : [];
    const intent = await this.store.create('deviceManagementIntents', {
      id: randomUUID(),
      displayName: b.displayName ?? (template as Record<string, unknown>).displayName,
      description: b.description ?? '',
      templateId: template.id,
      isAssigned: assignments.length > 0,
      isMigratingToConfigurationPolicy: false,
      lastModifiedDateTime: new Date().toISOString(),
      roleScopeTagIds: ['0'],
    });
    await this.auditWriter?.recordMutation({
      objectType: 'deviceManagementIntents',
      objectId: intent.id,
      activityDisplayName: 'POST /beta/deviceManagement/templates/*/createInstance',
      requestVerb: 'POST',
      source: '/beta/deviceManagement/templates/*/createInstance',
    });
    return intent;
  }

  /**
   * FC-SIM-2 (2026-09-28, A-07 optional follow-up): `GET /beta/users/{id |
   * userPrincipalName}/authentication/requirements` -> `{ perUserMfaState }`.
   * Real Graph's per-user MFA state is lower-cased ("enforced"/"enabled"/
   * "disabled"); AO's set stores whatever casing the caller passed
   * (`-PerUserMfaState Enforced`), so this read normalizes it the way the
   * real beta endpoint's own response is documented, rather than echoing
   * the set's raw casing back.
   */
  /**
   * synthetic-customer W1 (2026-10-28): GET /v1.0/me - the user the caller
   * signed in as, the same object GET /v1.0/users/{id} returns. The operator
   * is the scenario's `signedInUser` pointer (customer-history seeds it: S1's
   * operator is the administrator's admin account); without one it is
   * `user-1`, the sim.user1 identity SimTenantConfig publishes as
   * `operator_upn` (muster-partial and the other generated tenants).
   *
   * Live-tenant caveat: /me exists only under DELEGATED auth. Muster's live
   * harvest runs app-only (client credentials), where Graph has no signed-in
   * user and /me fails - so on a live tenant the operator UPN is not
   * discovered and Muster must fall back to the operator's answered value
   * (PLAN §2.2, MG-19). The sim answers /me for any caller; that is a sim
   * convenience, not evidence a live read would succeed.
   */
  private async resolveMe(): Promise<unknown> {
    const pointer = (await this.store.read('signedInUser', 'me')) as Record<string, unknown> | undefined;
    const userId = typeof pointer?.userId === 'string' ? pointer.userId : 'user-1';
    const user = await this.store.read('users', userId);
    if (!user) throw new NotFoundError(`GET /v1.0/me: the signed-in operator "${userId}" is not a users object`);
    return user;
  }

  /**
   * synthetic-customer W1 (2026-10-28): GET .../roleEligibilityScheduleInstances
   * - a read-time projection of roleEligibilitySchedules (seeded, or created
   * by an approved adminAssign request), so instances never drift from their
   * schedules. One instance per Provisioned schedule whose window holds now
   * (live clock, like Graph): started, and not past an `afterDateTime` end.
   */
  /**
   * W5c1-b (SIM-1): Graph v1.0 returns the authentication methods policy
   * with its per-method configurations inline (`authenticationMethodConfigurations`).
   * The sim keeps each configuration in its own collection (the PATCH target
   * at .../authenticationMethodConfigurations/{id}), so the policy read
   * embeds them at read time and a configuration change is visible on both
   * reads. A configuration stored without `@odata.type` gets Graph's type
   * for its id. A policy object that carries its own array keeps it.
   */
  /**
   * W5c2 follow-up 3: the Graph label reads (Get-MgInformationProtectionPolicyLabel,
   * Get-MgInformationProtectionSensitivityLabel) also show the Security &
   * Compliance `label` rows (New-Label / Set-Label), as the Purview store
   * backs both on a live tenant. Read-time projection, so rows created
   * before this change show too. A row whose id (Guid, else id) is already
   * in the Graph collection is not added again (S1's seeded CUI label).
   */
  private async withPurviewLabels(rows: StoreObject[]): Promise<StoreObject[]> {
    const have = new Set(rows.map((r) => r.id));
    const mirrored: StoreObject[] = [];
    for (const l of await this.store.list('label')) {
      const o = l as Record<string, unknown>;
      const id = String(o.Guid ?? o.id);
      if (have.has(id)) continue;
      have.add(id);
      const name = String(o.DisplayName ?? o.Name ?? id);
      mirrored.push({ id, name, displayName: name, isActive: o.Disabled !== true, hasProtection: o.EncryptionEnabled === true } as StoreObject);
    }
    return [...rows, ...mirrored];
  }

  private async withMethodConfigurations(policies: StoreObject[]): Promise<StoreObject[]> {
    const configs = ((await this.store.list('authenticationMethodsPolicyConfigurations')) as Array<Record<string, unknown>>).map((c) => {
      if (c['@odata.type'] !== undefined) return c;
      const id = String(c.id);
      return { '@odata.type': `#microsoft.graph.${id.charAt(0).toLowerCase()}${id.slice(1)}AuthenticationMethodConfiguration`, ...c };
    });
    return policies.map((p) =>
      (p as Record<string, unknown>).authenticationMethodConfigurations !== undefined ? p : ({ ...p, authenticationMethodConfigurations: configs } as StoreObject),
    );
  }

  private async resolveEligibilityInstances(): Promise<Record<string, unknown>[]> {
    const now = Date.now();
    const out: Record<string, unknown>[] = [];
    for (const s of (await this.store.list('roleEligibilitySchedules')) as Array<Record<string, unknown>>) {
      if (String(s.status ?? 'Provisioned') !== 'Provisioned') continue;
      const info = (s.scheduleInfo ?? {}) as { startDateTime?: string; expiration?: { type?: string; endDateTime?: string } };
      const start = info.startDateTime ?? (s.createdDateTime as string | undefined) ?? null;
      const end = info.expiration?.type === 'afterDateTime' ? (info.expiration.endDateTime ?? null) : null;
      if (start && Date.parse(start) > now) continue;
      if (end && Date.parse(end) <= now) continue;
      out.push({
        id: `${s.id}-instance`,
        principalId: s.principalId,
        roleDefinitionId: s.roleDefinitionId,
        directoryScopeId: s.directoryScopeId ?? '/',
        appScopeId: null,
        startDateTime: start,
        endDateTime: end,
        memberType: s.memberType ?? 'Direct',
        roleEligibilityScheduleId: s.id,
      });
    }
    return out;
  }

  private async resolvePerUserMfaRequirement(idOrUpn: string): Promise<unknown> {
    const user = matchTarget(await this.store.list('users'), idOrUpn, URI_ALT_KEYS.users ?? []);
    if (!user) {
      throw new NotFoundError(
        `GET /beta/users/${idOrUpn}/authentication/requirements: no users object with that id or userPrincipalName`,
      );
    }
    const raw = (user as Record<string, unknown>).perUserMfaState;
    return { perUserMfaState: typeof raw === 'string' && raw.length > 0 ? raw.toLowerCase() : 'disabled' };
  }

  /**
   * FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-run-hunting-query): the latest
   * Defender vulnerability-assessment recency per device, in the documented
   * advanced-hunting response shape (`{ schema, results }`). Derived from the
   * seeded managedDevices' own `lastTvmAssessed` field - real assessment
   * data the sim already carries - rather than a disconnected canned table,
   * so a device that starts appearing/disappearing from managedDevices (or
   * whose sync date moves) changes this read too.
   */
  /**
   * EO-collection W2.2 (2026-10-27): advanced hunting routed by the table the
   * KQL `Query` names - the first of the known tables to appear in the text:
   *  - DeviceTvmInfoGathering (EO's TVM_RECENCY_QUERY today) or
   *    DeviceTvmSoftwareVulnerabilities -> the vulnerability-recency rows
   *    (resolveTvmHuntingQuery, unchanged);
   *  - AlertInfo / AlertEvidence -> rows derived from the seeded `alerts`
   *    collection (resolveAlertHuntingQuery);
   *  - anything else (or no query) -> an empty result set with an empty
   *    schema, never the TVM rows.
   * The rest of the KQL (where/summarize/project) is not evaluated.
   */
  private async resolveHuntingQuery(body: unknown): Promise<unknown> {
    let query = '';
    if (typeof body === 'string') {
      const raw = body;
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        query = raw;
      }
    }
    if (body && typeof body === 'object') {
      const k = Object.keys(body).find((key) => key.toLowerCase() === 'query');
      const v = k !== undefined ? (body as Record<string, unknown>)[k] : undefined;
      if (typeof v === 'string') query = v;
    }
    const tables = ['DeviceTvmInfoGathering', 'DeviceTvmSoftwareVulnerabilities', 'AlertInfo', 'AlertEvidence'];
    let table: string | undefined;
    let at = Infinity;
    for (const t of tables) {
      const m = new RegExp(`\\b${t}\\b`).exec(query);
      if (m && m.index < at) {
        at = m.index;
        table = t;
      }
    }
    // synthetic-customer W0: DeviceTvmSoftwareVulnerabilities answers with the
    // seeded per-device CVE rows when the tenant has them (customer-history);
    // a tenant without them keeps the recency rows, as before.
    if (table === 'DeviceTvmSoftwareVulnerabilities') {
      const rows = await this.store.list('tvmSoftwareVulnerabilities');
      if (rows.length > 0) return this.resolveTvmVulnerabilityRows(rows);
    }
    if (table === 'DeviceTvmInfoGathering' || table === 'DeviceTvmSoftwareVulnerabilities') return this.resolveTvmHuntingQuery();
    if (table === 'AlertInfo' || table === 'AlertEvidence') return this.resolveAlertHuntingQuery(table);
    return { schema: [], results: [] };
  }

  /**
   * AlertInfo: one row per alert. AlertEvidence: one row per alert per entity
   * (the user and/or device the alert names). Columns are the documented
   * Defender XDR advanced-hunting ones the seed can fill; Timestamp is the
   * alert's createdDateTime.
   */
  private async resolveAlertHuntingQuery(table: 'AlertInfo' | 'AlertEvidence'): Promise<unknown> {
    const alerts = (await this.store.list('alerts')) as Array<Record<string, unknown>>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    if (table === 'AlertInfo') {
      return {
        schema: [
          { name: 'Timestamp', type: 'DateTime' },
          { name: 'AlertId', type: 'String' },
          { name: 'Title', type: 'String' },
          { name: 'Category', type: 'String' },
          { name: 'Severity', type: 'String' },
          { name: 'ServiceSource', type: 'String' },
          { name: 'DetectionSource', type: 'String' },
          { name: 'AttackTechniques', type: 'String' },
        ],
        results: alerts.map((a) => ({
          Timestamp: str(a.createdDateTime),
          AlertId: a.id,
          Title: str(a.title),
          Category: str(a.category),
          Severity: str(a.severity),
          ServiceSource: str(a.serviceSource),
          DetectionSource: str(a.detectionSource),
          AttackTechniques: Array.isArray(a.mitreTechniques) ? JSON.stringify(a.mitreTechniques) : '[]',
        })),
      };
    }
    const results: Array<Record<string, unknown>> = [];
    for (const a of alerts) {
      const base = { Timestamp: str(a.createdDateTime), AlertId: a.id, Title: str(a.title), Categories: JSON.stringify(a.category ? [a.category] : []), ServiceSource: str(a.serviceSource) };
      const evidence = Array.isArray(a.evidence) ? (a.evidence as Array<Record<string, unknown>>) : [];
      for (const e of evidence) {
        const isUser = String(e['@odata.type'] ?? '').includes('userEvidence');
        const account = (e.userAccount ?? {}) as Record<string, unknown>;
        results.push({
          ...base,
          EntityType: isUser ? 'User' : 'Machine',
          EvidenceRole: str(e.roles && Array.isArray(e.roles) ? e.roles[0] : null) ?? 'Impacted',
          AccountUpn: isUser ? str(account.userPrincipalName) : null,
          DeviceId: isUser ? null : str(e.mdeDeviceId ?? e.deviceId),
          DeviceName: isUser ? null : str(e.deviceDnsName),
        });
      }
    }
    return {
      schema: [
        { name: 'Timestamp', type: 'DateTime' },
        { name: 'AlertId', type: 'String' },
        { name: 'Title', type: 'String' },
        { name: 'Categories', type: 'String' },
        { name: 'ServiceSource', type: 'String' },
        { name: 'EntityType', type: 'String' },
        { name: 'EvidenceRole', type: 'String' },
        { name: 'AccountUpn', type: 'String' },
        { name: 'DeviceId', type: 'String' },
        { name: 'DeviceName', type: 'String' },
      ],
      results,
    };
  }

  /** Per-device CVE rows in the documented DeviceTvmSoftwareVulnerabilities columns (a state table: no Timestamp). */
  private resolveTvmVulnerabilityRows(rows: StoreObject[]): unknown {
    const columns = ['DeviceId', 'DeviceName', 'OSPlatform', 'SoftwareVendor', 'SoftwareName', 'SoftwareVersion', 'CveId', 'VulnerabilitySeverityLevel', 'RecommendedSecurityUpdate', 'RecommendedSecurityUpdateId', 'CveMitigationStatus'];
    return {
      schema: columns.map((name) => ({ name, type: 'String' })),
      results: rows.map((r) => Object.fromEntries(columns.map((c) => [c, (r as Record<string, unknown>)[c] ?? '']))),
    };
  }

  private async resolveTvmHuntingQuery(): Promise<unknown> {
    const devices = (await this.store.list('managedDevices')).filter(
      (d) => typeof (d as Record<string, unknown>).lastTvmAssessed === 'string',
    );
    return {
      schema: [
        { name: 'DeviceId', type: 'String' },
        { name: 'DeviceName', type: 'String' },
        { name: 'LastAssessed', type: 'DateTime' },
      ],
      results: devices.map((d) => ({
        DeviceId: d.id,
        DeviceName: (d as Record<string, unknown>).deviceName ?? d.id,
        LastAssessed: (d as Record<string, unknown>).lastTvmAssessed,
      })),
    };
  }

  private async resolveEntry(
    entry: ResolverEntry,
    requestVerb: string,
    body?: unknown,
    dynamicId?: string,
  ): Promise<unknown> {
    this.gate.checkAccess(entry);

    if (requestVerb === 'GET') {
      const results =
        entry.collection === 'authenticationMethodsPolicy'
          ? await this.withMethodConfigurations(await this.store.list(entry.collection))
          : PURVIEW_LABEL_MIRRORS.has(entry.collection)
            ? await this.withPurviewLabels(await this.store.list(entry.collection))
            : await this.store.list(entry.collection);
      // STAB-1 M1b fidelity fix (2026-07-11): an item-level GET returns the SINGLE
      // object, the way real Graph does - not the whole collection. Serving the
      // collection array made Stamper's registry-based verification (jsonpath
      // `$.state` over the post-set GET) fail on every task whose SET actually
      // changed state - 22 tasks in the ces-tester M2 gate. Item-level means the
      // URI captured a dynamic id (pattern '.../*') or the pattern's own last
      // segment IS the fixed singletonId (e.g. '.../authenticationMethodConfigurations/
      // Fido2'). The codegen-defaulted singletonId (= collection name, a mutation-
      // target default on collection endpoints) never equals its pattern's last
      // segment, so collection GETs keep returning the full list/envelope.
      // CAVEAT: deriveResolversFromInventory defaults `singletonId: collection` on
      // derived COLLECTION endpoints (a mutation-target default, e.g.
      // '/v1.0/deviceManagement/deviceCompliancePolicies' with singletonId
      // 'deviceCompliancePolicies') and those patterns' last segments DO equal the
      // singletonId. Disambiguation: when the named object exists, it is a genuine
      // singleton read (seeded singletons store their object under exactly that id);
      // when it does not AND singletonId === collection, treat it as the collection
      // endpoint it really is. Only a dynamic-id capture ('.../*') or a distinct
      // fixed singletonId 404s on a missing object, the way real Graph does.
      // P1.4b (2026-10-27): a value-envelope endpoint whose singletonId is
      // its own collection name is a COLLECTION endpoint - a GET there always
      // lists, even if an object with that id was stored (older stores carry
      // one from New-MgDeviceManagementDeviceConfiguration).
      const fixedItemId =
        entry.kind === 'uri' &&
        entry.singletonId &&
        entry.pattern.split('/').pop() === entry.singletonId &&
        !(entry.envelope === 'value' && entry.singletonId === entry.collection)
          ? entry.singletonId
          : undefined;
      const itemId = entry.kind === 'uri' ? (dynamicId ?? fixedItemId) : undefined;
      let response: unknown;
      // GP-STACKSIM-1 M3 fidelity fix (2026-07-25): real Graph addresses
      // /users/{id | userPrincipalName} by EITHER key (AO's A-10/A-19 GET a
      // user by UPN before acting on its id). Mirror that alternate-key
      // lookup for the users collection only; every other collection stays
      // id-addressed, the way its real API is.
      const item =
        itemId !== undefined ? matchTarget(results, itemId, URI_ALT_KEYS[entry.collection] ?? []) : undefined;
      if (item !== undefined) {
        response = item;
      } else if (
        itemId !== undefined &&
        (dynamicId !== undefined || entry.singletonId !== entry.collection)
      ) {
        // Real Graph 404s on a missing item; surface it as an error the caller
        // (Invoke-MgGraphRequest) turns into a non-zero exit, not a silent [].
        throw new NotFoundError(
          `ResolverTable: no ${entry.collection} object with id "${itemId}" (item-level GET)`,
        );
      } else {
        // M3: URI-pattern GETs on a collection endpoint must be wrapped in the
        // OData `{ value: [...] }` envelope to match real Microsoft Graph shape
        // (TenantProbe.psm1's Get-EutGraphValue reads $r.value). Named-cmdlet
        // entries mirror SDK cmdlets, which already return the array directly.
        response = entry.kind === 'uri' && entry.envelope === 'value' ? { value: results } : results;
      }

      const source = entry.kind === 'uri' ? entry.pattern : entry.cmdlet;
      if (this.evidenceHold) {
        await this.evidenceHold.record({
          objectType: entry.collection,
          request: { kind: entry.kind, identifier: source, verb: requestVerb },
          response,
          source,
        });
      }

      return response;
    }

    if (
      MUTATION_VERBS.includes(requestVerb as MutationVerb) &&
      entry.mutationVerbs?.includes(requestVerb as MutationVerb)
    ) {
      return this.resolveMutation(entry, requestVerb as MutationVerb, body, dynamicId);
    }

    throw new Error(
      `ResolverTable: verb "${requestVerb}" is not supported by resolver "${
        entry.kind === 'uri' ? entry.pattern : entry.cmdlet
      }"`,
    );
  }

  /**
   * G-STACKSIM-2 iteration 2: handles mutations for both entry kinds.
   * Named-cmdlet writes (New-/Set-/Update-/Remove-/Add-/action Invoke-*)
   * carry an intrinsic verb (the cmdlet name itself selects POST/PATCH/
   * DELETE, unlike Invoke-MgGraphRequest's caller-supplied -Method) but
   * mutate the store identically to a URI-pattern mutation once resolved.
   */
  private async resolveMutation(
    entry: ResolverEntry,
    verb: MutationVerb,
    body: unknown,
    dynamicId?: string,
  ): Promise<unknown> {
    const identifier = entry.kind === 'uri' ? entry.pattern : entry.cmdlet;
    // G-STACKSIM-2 iteration 3: a URI pattern's captured `*` segment (the
    // real id an earlier GET returned to the caller) takes priority over a
    // fixed singletonId when present - genuine dynamic-id mutation, per
    // matchPatternCapture()'s doc comment, rather than always collapsing to
    // one well-known id.
    const objectId = dynamicId ?? entry.singletonId;
    if (!objectId) {
      throw new Error(
        `ResolverTable: mutation for "${identifier}" requires a singletonId or a dynamic-id URI capture`,
      );
    }

    let result: unknown;
    let mutatedId: string = objectId;
    if (dynamicId !== undefined && (verb === 'PATCH' || verb === 'DELETE')) {
      // SIMFIX FIX-S1: an item-level URI mutation acts on the object the URI
      // names - by id or by the collection's real alternate key (users: UPN)
      // - and 404s when there is none. PATCH used to upsert a phantom object
      // keyed by the raw segment (a UPN became a second "user"), DELETE
      // silently no-oped; neither ever reported the miss.
      const obj = matchTarget(await this.store.list(entry.collection), dynamicId, URI_ALT_KEYS[entry.collection] ?? []);
      if (!obj) {
        throw new NotFoundError(`${verb} ${identifier}: no ${entry.collection} object with id "${dynamicId}"`);
      }
      mutatedId = obj.id;
      if (verb === 'DELETE') {
        await this.store.delete(entry.collection, obj.id);
        result = { id: obj.id, deleted: true };
        // W7-SIM (2026-10-29): removing a directory role assignment (AO's
        // A-10) also removes the principal from that activated directory
        // role's members (`/directoryRoles?$expand=members`), as on Graph,
        // unless another assignment of the same role to the same principal
        // remains.
        if (entry.collection === 'roleAssignments') {
          const ra = obj as Record<string, unknown>;
          const still = (await this.store.list('roleAssignments')).some((r) => {
            const o = r as Record<string, unknown>;
            return o.principalId === ra.principalId && o.roleDefinitionId === ra.roleDefinitionId;
          });
          const role = (await this.store.list('directoryRole')).find((r) => (r as Record<string, unknown>).roleTemplateId === ra.roleDefinitionId);
          if (!still && role) {
            for (const m of await this.store.list('directoryRoleMember')) {
              const o = m as Record<string, unknown>;
              if (o.directoryRoleId === role.id && o.memberId === ra.principalId) await this.store.delete('directoryRoleMember', m.id);
            }
          }
        }
      } else {
        let p = (body as Record<string, unknown> | undefined) ?? {};
        if (entry.collection === 'keyVaultKeys' && p.rotated === true) {
          // `az keyvault key rotate`: a new key VERSION - new kid, fresh
          // created/updated timestamps; the key stays enabled.
          const kid = String(((obj as Record<string, unknown>).key as { kid?: string } | undefined)?.kid ?? '');
          const base = kid.replace(/\/[^/]*$/, '').includes('/keys/') && kid.split('/').length > 5 ? kid.replace(/\/[^/]*$/, '') : kid;
          const version = Date.now().toString(16);
          const nowSec = Math.floor(Date.now() / 1000);
          const attrs = ((obj as Record<string, unknown>).attributes as Record<string, unknown> | undefined) ?? {};
          p = { key: { kid: `${base}/${version}` }, attributes: { ...attrs, enabled: true, created: nowSec, updated: nowSec } };
        }
        result = await this.store.update(entry.collection, obj.id, p);
      }
    } else if (
      verb === 'POST' &&
      dynamicId === undefined &&
      entry.singletonId === entry.collection &&
      ((entry.kind === 'uri' && entry.envelope === 'value') ||
        // P1.4b (2026-10-27): a Graph SDK create cmdlet is the same POST to
        // the collection. New-MgDeviceManagementDeviceConfiguration used to
        // store an object whose id was the collection name, which turned every
        // later GET .../deviceConfigurations into a single-object read (the
        // SC.L2-3.13.12.camera-block empty list). caPolicies keep their
        // displayName key and group members their @odata.id key (below).
        (entry.kind === 'cmdlet' &&
          /^New-Mg[A-Z]/.test(entry.cmdlet) &&
          entry.collection !== 'caPolicies' &&
          entry.collection !== 'groupMember' &&
          !(body && typeof body === 'object' && '@odata.id' in (body as object))))
    ) {
      // SIMFIX (REQ graph-fidelity #2): POST to a Graph COLLECTION creates a
      // NEW member with a server-assigned id, the way real Graph does. It
      // used to upsert an object whose id was the collection name, which
      // turned the next collection GET into a single-object read (B-13/B-14:
      // 'Property "value" cannot be found').
      const bodyObj = { ...((body as Record<string, unknown> | undefined) ?? {}) };
      delete bodyObj.id;
      const newId = await this.nextId(entry.collection);
      result = await this.store.create(entry.collection, {
        id: newId,
        createdDateTime: new Date().toISOString(),
        ...bodyObj,
      });
      mutatedId = newId;
      // P1.4c (2026-10-27): an approved adminAssign eligibility REQUEST
      // provisions the eligibility SCHEDULE that
      // Get-MgRoleManagementDirectoryRoleEligibilitySchedule reads, the way
      // a real tenant does. Nothing filled that collection before.
      if (entry.collection === 'roleEligibilityScheduleRequests' && String(bodyObj.action ?? '').toLowerCase() === 'adminassign') {
        await this.store.create('roleEligibilitySchedules', {
          id: await this.nextId('roleEligibilitySchedules'),
          principalId: bodyObj.principalId,
          roleDefinitionId: bodyObj.roleDefinitionId,
          directoryScopeId: bodyObj.directoryScopeId ?? '/',
          memberType: 'Direct',
          status: 'Provisioned',
          scheduleInfo: bodyObj.scheduleInfo,
          createdUsing: newId,
          createdDateTime: new Date().toISOString(),
        });
      }
    } else if (verb === 'DELETE') {
      await this.store.delete(entry.collection, objectId);
      result = { id: objectId, deleted: true };
    } else {
      // G-STACKSIM-2 iteration 3: POST now merge-patches via
      // ObjectStore.upsert() (same as PATCH), not ObjectStore.create()'s
      // full overwrite. Every mutating entry already collapses to one
      // well-known singletonId/dynamicId (this class's mutation model never
      // supported creating a genuinely distinct new resource per call), so
      // a body-less "New-X" cmdlet call (named-cmdlet mutations never
      // thread real args/body through - see the class doc comment) used to
      // silently clobber an already-seeded, field-rich singleton object
      // with a bare `{id}` shell (e.g. Stamper's AZ-LOG-002 New-AzStorageAccount
      // against the real, Identity/Encryption-carrying seeded storage
      // account) - a real destructive-write bug this iteration's manual Az
      // resolver overrides surfaced. Merge-patching is a strict superset of
      // the old behavior when nothing existed yet (upsert's `existing ?
      // ... : { id, ...patch }` branch), and non-destructive when it did.
      let bodyObj = (body as (Record<string, unknown> & { id?: string; userPrincipalName?: string }) | undefined) ?? {};
      // GP-STACKSIM-1 M3 (2026-07-25): a users POST carrying a
      // userPrincipalName and no explicit id CREATES a distinct user keyed
      // by that UPN - its natural alternate key - the way a real tenant
      // does. Singleton-collapsing New-MgUser onto user-1 overwrote the
      // seeded user's UPN, so every LATER /v1.0/users/{upn} lookup 404'd
      // (the ao:A-01 -> ao:A-10 run-order failure in the 2026-07-25
      // coverage re-runs).
      // SIMFIX FIX-S2: a new user gets a server-assigned id (the seed's
      // `user-<n>` convention) and is addressable by id OR UPN afterwards
      // (URI_ALT_KEYS / TARGET_PARAMS). Keying the object by its UPN string
      // (the 2026-07-25 approach) made `$newUser.Id` a UPN; a second
      // create with a UPN that already exists is the real service's
      // conflict, never a silent merge onto the existing user.
      let naturalId: string | undefined;
      if (verb === 'POST' && entry.collection === 'users' && !bodyObj.id && typeof bodyObj.userPrincipalName === 'string') {
        const upn = bodyObj.userPrincipalName;
        const clash = (await this.store.list('users')).find(
          (u) => String((u as { userPrincipalName?: unknown }).userPrincipalName ?? '').toLowerCase() === upn.toLowerCase(),
        );
        if (clash) {
          throw new Error(
            `Request_BadRequest: Another object with the same value for property userPrincipalName already exists (${upn} is ${clash.id}).`,
          );
        }
        naturalId = await this.nextId('users');
      }
      // P0-2 fix 10 (CA-policy create, 2026-07-28): a CA-policy POST's
      // real-tenant business key is its -DisplayName (New-MgIdentityConditional
      // AccessPolicy -DisplayName 'CMMC-RemoteMaintenance-MFA' -State '...';
      // this is a Graph SDK cmdlet, so resolveCmdlet's isGraphSdkCmdlet check
      // already camelCased -DisplayName to bodyObj.displayName before this
      // ever runs - see cmdletArgsToPatch's casing note above). Scoped to the
      // caPolicies collection only (mirrors the users UPN naturalId block
      // immediately above), NOT generalized into cmdletNaturalId's Name/
      // Identity check below: New-MgIdentityConditionalAccessNamedLocation is
      // a sibling Graph SDK New- cmdlet that also carries its own displayName
      // (coverage/inventory.json line 222) and intentionally collapses onto
      // its fixed singletonId ('namedLocation-1') today - a blanket
      // displayName-keyed naturalId would silently change that cmdlet's
      // create-vs-collapse behavior too.
      const caPolicyNaturalId =
        verb === 'POST' && entry.collection === 'caPolicies' && !bodyObj.id && naturalId === undefined && typeof bodyObj.displayName === 'string'
          ? bodyObj.displayName
          : undefined;
      // P0-2 fix 8 (dlp-policy, KEYSTONE, 2026-07-27): a named-cmdlet POST's
      // own -Name/-Identity argument is its real-tenant business key (e.g.
      // New-DlpCompliancePolicy -Name 'CMMC-CUI-Block' upserts onto that
      // exact policy on a real tenant) - unlike a URI-pattern mutation,
      // which already addresses its resource by URL segment (dynamicId/
      // singletonId). Mirrors the users UPN naturalId block above, but for
      // any named-cmdlet POST rather than one hand-picked collection.
      // synthetic-customer W5 cycle 1 (W3 finding c): New-DkimSigningConfig
      // names its object by -DomainName, and Exchange Online reports it as
      // Domain / Identity / Name = that domain. It used to collapse onto a
      // server id and store only `DomainName`, so `Get-DkimSigningConfig |
      // Select Domain` read null. One object per domain (multi-domain safe).
      const dkimDomain =
        verb === 'POST' && entry.kind === 'cmdlet' && entry.collection === 'dkimSigningConfig' && typeof bodyObj.DomainName === 'string'
          ? bodyObj.DomainName
          : undefined;
      if (dkimDomain !== undefined) {
        bodyObj = { Domain: dkimDomain, Name: dkimDomain, Identity: dkimDomain, Status: 'Valid', ...bodyObj };
      }
      const cmdletNaturalId =
        verb === 'POST' && entry.kind === 'cmdlet' && !bodyObj.id && naturalId === undefined && caPolicyNaturalId === undefined
          ? typeof bodyObj.Name === 'string'
            ? bodyObj.Name
            : typeof bodyObj.Identity === 'string'
              ? bodyObj.Identity
              : undefined
          : undefined;
      // P0-2 fix 9 (member-add, 2026-07-27): New-MgGroupMemberByRef's
      // resource body is a Graph `@odata.id` reference
      // ('https://.../directoryObjects/{id}'), not a Name/Identity - the
      // trailing path segment IS the real member's id on a real tenant.
      const odataRef = bodyObj['@odata.id'];
      const odataRefId =
        verb === 'POST' &&
        !bodyObj.id &&
        naturalId === undefined &&
        caPolicyNaturalId === undefined &&
        cmdletNaturalId === undefined &&
        typeof odataRef === 'string'
          ? odataRef.split('/').filter(Boolean).pop()
          : undefined;
      // SIMFIX FIX-S2: a create-by-name whose name an existing object already
      // carries (a seeded `storageAccount-1` named 'simstorage1') lands on THAT
      // object - ARM PUTs are idempotent by name - instead of minting a second
      // object with the same name that every later by-name read would collide on.
      const existingByName =
        cmdletNaturalId !== undefined
          ? matchTarget(await this.store.list(entry.collection), cmdletNaturalId, ['name', 'Identity', 'DisplayName'])
          : undefined;
      let effectiveId =
        bodyObj.id ?? naturalId ?? caPolicyNaturalId ?? existingByName?.id ?? cmdletNaturalId ?? odataRefId ?? objectId;
      // P1.4c (2026-10-27) sweep: a create that names nothing must never be
      // stored under its collection's own name (run 4 camera-block, run 5
      // createInstance) - it gets a server id like any other create. True
      // singleton URIs (a raw endpoint whose last segment IS its id) keep it.
      if (
        verb === 'POST' &&
        effectiveId === entry.collection &&
        !(entry.kind === 'uri' && entry.envelope === 'raw' && entry.pattern.split('/').pop() === entry.singletonId)
      ) {
        effectiveId = await this.nextId(entry.collection);
      }

      // The raw '@odata.id' ref is call plumbing (the mechanism used to
      // locate the id above), never a field a real tenant's response
      // carries - stripped before the object is stored.
      let bodyForStore: Record<string, unknown> = bodyObj;
      if (Object.prototype.hasOwnProperty.call(bodyForStore, '@odata.id')) {
        const { '@odata.id': _odataRef, ...rest } = bodyForStore;
        bodyForStore = rest;
      }

      // P0-2 fix 6+7 (malware-rule + anti-phish, 2026-07-27): server-
      // computed create defaults (New-MalwareFilterRule's $.State='Enabled',
      // New-AntiPhishPolicy's $.Enabled=true - a real tenant sets these, the
      // caller's own SET args never do) merge UNDER the caller's arg patch,
      // so an explicit arg always wins.
      let patch: Record<string, unknown> =
        verb === 'POST' && entry.kind === 'cmdlet' && entry.creationDefaults
          ? { ...entry.creationDefaults, ...bodyForStore }
          : bodyForStore;
      if (verb === 'POST' && entry.kind === 'cmdlet' && cmdletNaturalId !== undefined && !/-(Az|Mg)[A-Z]/.test(entry.cmdlet) && patch.Identity === undefined) {
        // SIMFIX FIX-S2: an Exchange/Purview object's Identity is its name
        // (Get-HostedOutboundSpamFilterRule ... | Select -ExpandProperty Identity).
        patch = { Identity: cmdletNaturalId, ...patch };
      }
      if (verb === 'POST' && entry.kind === 'cmdlet' && /^New-Az[A-Z]/.test(entry.cmdlet) && AZ_ARM_TYPES[entry.collection]) {
        // SIMFIX FIX-S2: ARM assigns every new resource its resource Id
        // (/subscriptions/.../providers/<type>/<name>); callers link resources
        // by it (F-13 attaches an NSG / route table to a subnet by .Id).
        const name = String(patch.Name ?? patch.name ?? effectiveId);
        const rg = String(patch.ResourceGroupName ?? 'sim-rg');
        if (patch.Id === undefined) {
          patch = { Id: `/subscriptions/sim-sub/resourceGroups/${rg}/providers/${AZ_ARM_TYPES[entry.collection]}/${name}`, ...patch };
        }
      }
      if (entry.collection === 'users') {
        // SIMFIX FIX-S2: the service stamps a new user's server-side fields
        // and never stores (or returns) the password it was given.
        const now = new Date().toISOString();
        patch = transformUserPatch(patch, now);
        if (naturalId !== undefined) patch = { userType: 'Member', createdDateTime: now, assignedLicenses: [], ...patch };
      }

      if (verb === 'PATCH' && entry.collection === 'authorizationPolicy') {
        // PH-13 FX (2026-11-01): Graph's PATCH of authorizationPolicy keeps every property the
        // body does not name, nested ones included: Learn's Update authorizationPolicy examples 3
        // and 5 send only defaultUserRolePermissions.allowedToCreateApps or .permissionGrantPoliciesAssigned
        // (https://learn.microsoft.com/graph/api/authorizationpolicy-update?view=graph-rest-1.0).
        // The shallow upsert replaced the whole defaultUserRolePermissions object, so a 3-key PATCH
        // (AC.L1-3.1.2.default-user-permissions, AO A-18) dropped permissionGrantPoliciesAssigned and
        // the next entry's read lacked it (R-F10 S1, IA.L1-3.5.1.app-consent-restrict). Only this
        // singleton: a CA policy PATCH does replace `conditions` whole (AO A-19).
        patch = mergeNestedPatch((await this.store.read(entry.collection, effectiveId)) as Record<string, unknown> | undefined, patch);
      }
      result = await this.store.upsert(entry.collection, effectiveId, patch);
      // synthetic-customer W3: the create response reports the in-progress
      // value (types.ts createResponseOverrides); the store keeps the settled one.
      if (verb === 'POST' && entry.kind === 'cmdlet' && entry.createResponseOverrides) {
        result = { ...(result as Record<string, unknown>), ...entry.createResponseOverrides };
      }
      mutatedId = effectiveId;
    }

    if (this.auditWriter) {
      await this.auditWriter.recordMutation({
        objectType: entry.collection,
        objectId: mutatedId,
        activityDisplayName: `${verb} ${identifier}`,
        requestVerb: verb,
        source: identifier,
      });
    }

    return result;
  }
}
