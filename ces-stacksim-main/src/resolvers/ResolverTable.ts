// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

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
  IDENTITY_ALT_KEYS,
  URI_ALT_KEYS,
  findCmdletTarget,
  matchTarget,
  extractODataFilter,
  parseODataEqFilter,
  applyODataEqFilter,
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
  const m = /^\s*([\w.]+)\s+eq\s+(?:'([^']*)'|\$?([^'\s]+))\s*$/i.exec(expr);
  if (!m) return data;
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
    if (cmdlet === 'Invoke-AzRestMethod') {
      return this.resolveInvokeAzRestMethod(args);
    }
    const entry = this.entries.find(
      (e): e is NamedCmdletResolverEntry => e.kind === 'cmdlet' && e.cmdlet === cmdlet,
    );
    if (!entry) {
      throw new Error(`ResolverTable: no resolver registered for cmdlet "${cmdlet}"`);
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
    // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-run-hunting-query): EO's
    // vulnerability-recency signal is a POST that only READS (the advanced-
    // hunting query API has no other shape) - ComplianceSignalFetcher.
    // fetchGraphCollection always sends -Method POST for this one URI with a
    // KQL query body it never inspects the content of here (the sim answers
    // from its own seeded managedDevices state, not the caller's KQL text -
    // same "never told which command is running" principle as the AO
    // semantic runner). Never mutates: no store write, no audit/ledger entry.
    if (method === 'POST' && normalized === '/v1.0/security/runHuntingQuery') {
      return this.resolveTvmHuntingQuery();
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
    if (method === 'GET' && dynamicId === undefined) {
      const expr = extractODataFilter(uri);
      const clauses = expr !== undefined ? parseODataEqFilter(expr) : undefined;
      if (clauses) {
        if (Array.isArray(out)) return applyODataEqFilter(out, clauses);
        if (out && typeof out === 'object' && Array.isArray((out as { value?: unknown }).value)) {
          return { ...(out as object), value: applyODataEqFilter((out as { value: unknown[] }).value, clauses) };
        }
      }
    }
    return out;
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
      const results = await this.store.list(entry.collection);
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
      const fixedItemId =
        entry.kind === 'uri' && entry.singletonId && entry.pattern.split('/').pop() === entry.singletonId
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
      entry.kind === 'uri' &&
      dynamicId === undefined &&
      entry.envelope === 'value' &&
      entry.singletonId === entry.collection
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
      const bodyObj = (body as (Record<string, unknown> & { id?: string; userPrincipalName?: string }) | undefined) ?? {};
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
      const effectiveId =
        bodyObj.id ?? naturalId ?? caPolicyNaturalId ?? existingByName?.id ?? cmdletNaturalId ?? odataRefId ?? objectId;

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

      result = await this.store.upsert(entry.collection, effectiveId, patch);
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
