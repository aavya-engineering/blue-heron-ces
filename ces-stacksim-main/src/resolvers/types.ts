// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { AzureTier } from '../gating/StackShapeGate.js';

/**
 * Cmdlet-pattern / URI-pattern -> store-query resolver table entry types
 * (Core Design (d)). Two entry kinds:
 *  1. Named-cmdlet entries mirror ComplianceSignalFetcher.endpointToCmdlet's
 *     map 1:1 (one entry per Get-Mg* wrapper function).
 *  2. Generic URI-pattern entries back the single Invoke-MgGraphRequest
 *     wrapper, covering TemplateRegistry.ts writes (M4) and any GET not
 *     covered by a named cmdlet.
 * Every entry carries `azureTier` so StackShapeGate can invoke-time-gate it
 * (Core Design (e)) before it touches the store.
 */
export type ResolverVerb = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface ResolverEntryBase {
  /** ObjectStore collection name this resolver reads/writes. */
  collection: string;
  /** Verb this resolver currently implements support for. */
  verb: ResolverVerb;
  azureTier: AzureTier;
  /**
   * G-STACKSIM-2 iteration 2: verbs beyond GET this entry supports for
   * mutation. For `kind: 'uri'` entries this backs the generic
   * Invoke-MgGraphRequest resolver path (M4, unchanged). For `kind: 'cmdlet'`
   * entries (new, iteration 2) this backs write-shaped named cmdlets
   * (New-/Set-/Update-/Remove-/Add-/action Invoke-* cmdlets) whose PowerShell
   * verb is intrinsic to the cmdlet name rather than caller-supplied.
   * Absent/empty = read-only.
   */
  mutationVerbs?: Array<'POST' | 'PATCH' | 'DELETE'>;
  /**
   * Object id within `collection` this entry's mutations target. Dynamic-id
   * mutation (e.g. a trailing `/{id}` URI segment, or a cmdlet's -Id
   * argument selecting one of many objects) is not supported - every
   * mutating entry collapses to one well-known id within its collection.
   */
  singletonId?: string;
}

export interface NamedCmdletResolverEntry extends ResolverEntryBase {
  kind: 'cmdlet';
  /** Exact PowerShell cmdlet name, e.g. 'Get-MgIdentityConditionalAccessPolicy'. */
  cmdlet: string;
  /** Graph endpoint this cmdlet mirrors, for documentation/traceability. */
  endpoint: string;
  /**
   * P0-2 fix 6+7 (malware-rule + anti-phish, 2026-07-27): server-computed
   * fields a real tenant's New-* response carries that the caller's own
   * arguments never set (e.g. New-MalwareFilterRule's $.State='Enabled',
   * New-AntiPhishPolicy's $.Enabled=true - same class as DLP's
   * DistributionStatus; the CES registry templates are correct, the sim
   * just never computed the field). Applied only on POST
   * (ResolverTable.resolveMutation), merged UNDER the caller's own arg
   * patch so an explicit arg always wins.
   */
  creationDefaults?: Record<string, unknown>;
}

export interface UriPatternResolverEntry extends ResolverEntryBase {
  kind: 'uri';
  /** Path template matched against Invoke-MgGraphRequest's -Uri, e.g. '/v1.0/policies/authorizationPolicy'. A single '*' segment matches any one path segment (dynamic id). */
  pattern: string;
  /**
   * Whether a GET response is wrapped in the OData `{ value: [...] }`
   * envelope (collection endpoints, e.g. conditionalAccess/policies) or
   * returned as the raw resolved array/object (singleton endpoints, e.g.
   * authorizationPolicy) - matches real Microsoft Graph response shapes.
   * Load-bearing for M3: TenantProbe.psm1's `Get-EutGraphValue` reads
   * `$r.value`, so a collection endpoint's fake response must be wrapped.
   */
  envelope: 'value' | 'raw';
}

export type ResolverEntry = NamedCmdletResolverEntry | UriPatternResolverEntry;
