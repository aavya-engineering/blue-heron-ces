// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InventoryItem } from '../coverage/InventoryTypes.js';
import type { NamedCmdletResolverEntry, UriPatternResolverEntry } from '../resolvers/types.js';
import type { AzureTier } from '../gating/StackShapeGate.js';
import { KNOWN_OBJECT_TYPES } from '../store/schemas.js';

/**
 * G-STACKSIM-2 iteration 2 (docs/context/LOOP_STATE.md G-STACKSIM-2 Loop
 * State, iteration 2 scope: "extend the module manifest/codegen from the
 * inventory itself"). Derives ResolverTable entries directly from
 * `coverage/inventory.json` so every named cmdlet and Invoke-MgGraphRequest
 * URI that Stamper/EO/AO actually reference gets a wrapper function and a
 * resolver entry, without hand-authoring one entry per cmdlet.
 *
 * Design (see IMPLEMENTATION_LOG.md "G-STACKSIM-2 iteration 2" for the full
 * rationale):
 *  - Read cmdlets (Get-*) resolve to `store.list(collection)` - an empty
 *    array is a VALID result (Core Design (e)/(c) unaffected; no objects are
 *    fabricated).
 *  - Write cmdlets (New-/Set-/Update-/Remove-/Add-/action Invoke-*) route
 *    through ResolverTable's mutation path (store upsert/create/delete +
 *    DirectoryAuditWriter + ledger), gated by StackShapeGate exactly like
 *    hand-authored URI-pattern mutations.
 *  - Collection name = the cmdlet's noun with its module marker (Mg/Az)
 *    stripped, first letter lowercased - e.g. Get-MgUser/New-MgUser/
 *    Remove-MgUser all derive to collection "user", so a write against one
 *    is visible to a read against another (same underlying resource).
 *  - A cmdlet's read/write direction is taken from the *inventory items
 *    that reference it* (InventoryItem.classification), not guessed purely
 *    from the verb prefix - grounded in the real extractor's own
 *    read/write tagging rather than a second heuristic that could disagree.
 */

export interface DerivedResolverBundle {
  graph: NamedCmdletResolverEntry[];
  az: NamedCmdletResolverEntry[];
  exo: NamedCmdletResolverEntry[];
  graphUri: UriPatternResolverEntry[];
}

/** PowerShell engine builtins that appear in command text but are never sim-owned cmdlets (resolve via $PSHOME\Modules retained path). */
const BUILTIN_EXCLUDE = new Set([
  'ConvertTo-Json',
  'ConvertFrom-Json',
  'ConvertTo-SecureString',
  'ConvertTo-Html',
  'ForEach-Object',
  'Where-Object',
  'Select-Object',
  'Sort-Object',
  'Group-Object',
  'Measure-Object',
  'Tee-Object',
  'Write-Output',
  'Write-Host',
  'Write-Error',
  'Write-Warning',
  'Write-Verbose',
  'New-Object',
  'New-Guid',
  'New-TimeSpan',
  'New-Item',
  'Get-Date',
  'Get-Content',
  'Get-ChildItem',
  'Set-Content',
  'Start-Sleep',
  'Out-Null',
  'Out-String',
  'Import-Csv',
  'Export-Csv',
  'Test-Path',
  'Select-String',
  'Format-List',
  'Format-Table',
  'Join-Path',
  'Split-Path',
  'Copy-Item',
  // G-STACKSIM-2 iteration 4: AU.L2-3.3.3.sentinel-connector:set (a real
  // Stamper command, only executable now that az-CLI items are no longer
  // excluded) cleans up its own temp file via `Remove-Item $f
  // -ErrorAction SilentlyContinue`. Without this exclusion, the derivation
  // scan would mint a fake sim-owned "Remove-Item" cmdlet wrapper (verb
  // "Remove" -> DELETE mutation) that shadows the real PowerShell builtin
  // for every module this sim generates - silently no-op'ing real local
  // filesystem cleanup instead of genuinely deleting the temp file.
  'Remove-Item',
  'Invoke-MgGraphRequest',
  'Invoke-RestMethod',
  'Invoke-Expression',
  'Invoke-Command',
]);

/** Standard PowerShell approved verbs (subset actually seen across CES registries) - a token whose "verb" isn't in this set is almost certainly a quoted display-name fragment the naive regex over-matched, not a real cmdlet invocation. */
const APPROVED_VERBS = new Set([
  'Get',
  'Set',
  'New',
  'Add',
  'Remove',
  'Update',
  'Enable',
  'Disable',
  'Invoke',
  'Connect',
  'Disconnect',
  'Confirm',
  'Clear',
  'Revoke',
  'Close',
  'Register',
  'Unregister',
  'Search',
  'Import',
  'Export',
  'Test',
  'Start',
  'Stop',
  'Restore',
  'Backup',
  'Grant',
  'Block',
  'Unblock',
  'Approve',
  'Deny',
  'Complete',
  'Merge',
  'Copy',
  'Move',
  'Open',
  'Publish',
  'Unpublish',
  'Send',
  'Receive',
  'Wait',
  'Resume',
  'Suspend',
  'Sync',
  'Initialize',
  'Limit',
  'Mount',
  'Dismount',
  'Optimize',
  'Repair',
  'Resolve',
  'Restart',
  'Save',
  'Show',
  'Submit',
  'Rename',
  'Request',
  'Reset',
]);

const WRITE_VERB_TO_HTTP: Record<string, 'POST' | 'PATCH' | 'DELETE'> = {
  New: 'POST',
  Add: 'POST',
  Register: 'POST',
  Invoke: 'POST',
  Confirm: 'POST',
  Grant: 'POST',
  Enable: 'PATCH',
  Disable: 'PATCH',
  Set: 'PATCH',
  Update: 'PATCH',
  Revoke: 'PATCH',
  Unblock: 'PATCH',
  Remove: 'DELETE',
  Clear: 'DELETE',
  Close: 'DELETE',
  Unregister: 'DELETE',
};

/** Strips single- and double-quoted string literals so cmdlet-name-shaped display values inside quotes (e.g. 'CMMC-CUI-Block-Rule') are never mistaken for an invoked command. */
function stripQuotedStrings(text: string): string {
  return text.replace(/'(?:[^']|'')*'/g, ' ').replace(/"(?:[^"\\]|\\.)*"/g, ' ');
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

interface DerivedCollectionInfo {
  collection: string;
  /** Set iff the collection was remapped onto a seeded plural (see below). */
  seededSingletonId?: string;
}

function deriveCollectionInfo(noun: string): DerivedCollectionInfo {
  const stripped = noun.replace(/^(Mg|Az)/, '');
  const singular = lowerFirst(stripped || noun);
  // 2026-07-10 fidelity fix: the auto-derived singular name (Get-MgUser ->
  // "user") never matches SeedEngine's hand-mapped plural collections
  // ("users"), so no-filter reads on seeded resources returned [] even on a
  // fully seeded tenant (valid under the coverage bar's empty-read rule, but
  // hollow for GUI walkthroughs and state-detection consumers). When the
  // exact plural exists in the curated seeded schema, use it — the remap is
  // membership-gated on KNOWN_OBJECT_TYPES, so it can never invent a
  // collection, and it applies at noun level, keeping every verb of the same
  // cmdlet noun (Get-/New-/Update-/Remove-) on one collection so writes stay
  // visible to reads.
  //
  // Remapped WRITE entries must merge-patch the first SEEDED object
  // (`<singular>-1`, every seed generator's id convention) instead of the
  // default `singletonId: collection` — otherwise e.g. New-AzFirewall mints
  // a `{id:"firewalls"}` shell INSIDE the seeded collection and every
  // subsequent Get returns [rich seeded object, field-less shell], which
  // broke AZ-FW-003/004 + AO F-11/F-12 (.Deallocate() on an object with no
  // IpConfigurations) on this fix's first coverage run. Same pattern as the
  // manual Set-AzFirewall override (azureResolvers.ts, singletonId
  // 'firewall-1').
  const plural = `${singular}s`;
  if (KNOWN_OBJECT_TYPES.includes(plural)) {
    return { collection: plural, seededSingletonId: `${singular}-1` };
  }
  return { collection: singular };
}

interface CmdletUsage {
  cmdlet: string;
  hasRead: boolean;
  hasWrite: boolean;
}

function collectCmdletUsages(items: InventoryItem[], engines: ReadonlySet<string>): Map<string, CmdletUsage> {
  const usages = new Map<string, CmdletUsage>();
  for (const item of items) {
    if (item.excluded || !engines.has(item.engine)) continue;
    const text = stripQuotedStrings(item.commandText);
    const re = /\b([A-Z][a-zA-Z]*)-([A-Z][a-zA-Z0-9]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const [full, verb] = [`${m[1]}-${m[2]}`, m[1]];
      if (BUILTIN_EXCLUDE.has(full)) continue;
      if (!APPROVED_VERBS.has(verb)) continue;
      const usage = usages.get(full) ?? { cmdlet: full, hasRead: false, hasWrite: false };
      if (item.classification === 'write') usage.hasWrite = true;
      else usage.hasRead = true;
      usages.set(full, usage);
    }
  }
  return usages;
}

function buildNamedEntries(
  usages: Map<string, CmdletUsage>,
  exclude: ReadonlySet<string>,
  tierFor: (cmdlet: string) => AzureTier,
): NamedCmdletResolverEntry[] {
  const entries: NamedCmdletResolverEntry[] = [];
  for (const usage of usages.values()) {
    if (exclude.has(usage.cmdlet)) continue;
    const verb = usage.cmdlet.split('-')[0];
    const noun = usage.cmdlet.split('-').slice(1).join('-');
    const { collection, seededSingletonId } = deriveCollectionInfo(noun);
    const azureTier = tierFor(usage.cmdlet);

    // G-STACKSIM-2 iteration 3 fix: the write/read decision is now the
    // cmdlet's OWN PowerShell verb (via WRITE_VERB_TO_HTTP), not
    // `usage.hasWrite`. The old `usage.hasWrite` check treated a cmdlet as
    // write-only whenever it was merely REFERENCED anywhere inside a
    // write-classified item's command text - but Stamper/AO's compound
    // set_command scripts routinely do `$vnet = Get-AzVirtualNetwork ...; ...
    // Set-AzVirtualNetwork ...` (a genuine mutating call alongside a
    // read-only helper lookup in the SAME script). That conflation
    // mis-registered read-only cmdlets like Get-AzStorageAccount/
    // Get-AzVirtualNetwork/Get-AzNetworkSecurityGroup as POST-mutation-only
    // resolvers, so every "read" call to them silently created a blank
    // shell object (id-only, no seeded fields) instead of returning the
    // real seeded, field-rich object - the root cause of the
    // AZ-LOG-002a/c, AZ-NET-002..005, AZ-NSG-002..005, AZ-PE-001/002
    // failures (coverage/coverage-report.json). A cmdlet's own verb prefix
    // (Get/New/Set/Remove/...) is the ground truth for read-vs-write, per
    // PowerShell's approved-verb convention already encoded in
    // WRITE_VERB_TO_HTTP - "Get" is never a key there, so Get-* cmdlets are
    // now always GET regardless of which script they were extracted from.
    const httpVerb = WRITE_VERB_TO_HTTP[verb];
    if (httpVerb) {
      entries.push({
        kind: 'cmdlet',
        cmdlet: usage.cmdlet,
        endpoint: `derived:${usage.cmdlet}`,
        collection,
        verb: httpVerb,
        azureTier,
        mutationVerbs: [httpVerb],
        singletonId: seededSingletonId ?? collection,
      });
    } else {
      entries.push({
        kind: 'cmdlet',
        cmdlet: usage.cmdlet,
        endpoint: `derived:${usage.cmdlet}`,
        collection,
        verb: 'GET',
        azureTier,
      });
    }
  }
  return entries;
}

const SENTINEL_NOUN_PREFIX = /^(OperationalInsights|Sentinel)/;

function azTier(cmdlet: string): AzureTier {
  const noun = cmdlet.split('-').slice(1).join('-').replace(/^Az/, '');
  return SENTINEL_NOUN_PREFIX.test(noun) ? 'sentinel' : 'full';
}

/** Known collection-name overrides so derived URI entries reuse existing, semantically-matching KNOWN_OBJECT_TYPES instead of minting a near-duplicate. Keyed by the normalized path's final segment. */
const URI_COLLECTION_OVERRIDES: Record<string, { collection: string; envelope: 'value' | 'raw' }> = {
  deviceCompliancePolicies: { collection: 'deviceCompliancePolicies', envelope: 'value' },
  managedDevices: { collection: 'managedDevices', envelope: 'value' },
  roleAssignments: { collection: 'roleAssignments', envelope: 'value' },
  secureScores: { collection: 'secureScores', envelope: 'value' },
  alerts_v2: { collection: 'alerts', envelope: 'value' },
  directoryAudits: { collection: 'directoryAudits', envelope: 'value' },
  signIns: { collection: 'signInLogs', envelope: 'value' },
  users: { collection: 'users', envelope: 'value' },
  policies: { collection: 'caPolicies', envelope: 'value' },
};

/** Path suffixes that are singleton resources (raw envelope), not collections. */
const SINGLETON_URI_SUFFIXES = [
  'authorizationPolicy',
  'authenticationMethodsPolicy',
  'settings',
  'organization',
];

function normalizeUriPath(rawUri: string): string {
  return rawUri
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]
    .replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, '*');
}

function deriveUriCollection(pattern: string): { collection: string; envelope: 'value' | 'raw' } {
  const segments = pattern.split('/').filter((s) => s.length > 0 && s !== '*');
  const last = segments[segments.length - 1] ?? 'unknown';
  if (URI_COLLECTION_OVERRIDES[last]) return URI_COLLECTION_OVERRIDES[last];
  if (last === 'createInstance') {
    const parent = segments[segments.length - 3] ?? 'template';
    return { collection: lowerFirst(parent) + 'Instances', envelope: 'raw' };
  }
  const envelope: 'value' | 'raw' = SINGLETON_URI_SUFFIXES.includes(last) ? 'raw' : 'value';
  return { collection: lowerFirst(last), envelope };
}

/**
 * G-STACKSIM-2 iteration 3 fix: scans a command's text for EVERY
 * `Invoke-MgGraphRequest` invocation, not just the first. The prior
 * implementation ran non-global `-Uri`/`-Method` regexes ONCE per item, so a
 * compound multi-statement script with two or more Invoke-MgGraphRequest
 * calls (e.g. AO's A-10/A-19/A-20, each chaining several GET/POST/PATCH/
 * DELETE calls in one `set_command`) only ever registered its FIRST call's
 * URI/method pair - every subsequent call in the same script (often the one
 * that actually matters, e.g. A-10's POST to
 * roleEligibilityScheduleRequests) never got a resolver entry at all,
 * surfacing at runtime as "no resolver registered for URI" (404). Chunking
 * the text at each literal "Invoke-MgGraphRequest" occurrence and matching
 * -Uri/-Method within that chunk alone (not the whole remaining string)
 * keeps each call's own pair correctly paired.
 */
function extractGraphRequestCalls(
  commandText: string,
): Array<{ uri: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE' }> {
  const marker = 'Invoke-MgGraphRequest';
  const calls: Array<{ uri: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE' }> = [];
  let idx = commandText.indexOf(marker);
  while (idx !== -1) {
    const nextIdx = commandText.indexOf(marker, idx + marker.length);
    const chunk = commandText.slice(idx, nextIdx === -1 ? commandText.length : nextIdx);
    const uriMatch = /-Uri\s+['"]([^'"]+)['"]/.exec(chunk);
    if (uriMatch) {
      const methodMatch = /-Method\s+['"]?([A-Za-z]+)/.exec(chunk);
      const method = (methodMatch ? methodMatch[1].toUpperCase() : 'GET') as 'GET' | 'POST' | 'PATCH' | 'DELETE';
      calls.push({ uri: uriMatch[1], method });
    }
    idx = nextIdx;
  }
  return calls;
}

function buildUriEntries(
  items: InventoryItem[],
  excludePatterns: ReadonlySet<string>,
): UriPatternResolverEntry[] {
  const byPattern = new Map<string, Set<'GET' | 'POST' | 'PATCH' | 'DELETE'>>();
  for (const item of items) {
    if (item.excluded || item.engine !== 'invoke-mggraphrequest') continue;
    for (const call of extractGraphRequestCalls(item.commandText)) {
      const pattern = normalizeUriPath(call.uri);
      if (excludePatterns.has(pattern)) continue;
      const set = byPattern.get(pattern) ?? new Set();
      set.add(call.method);
      byPattern.set(pattern, set);
    }
  }

  const entries: UriPatternResolverEntry[] = [];
  for (const [pattern, methods] of byPattern.entries()) {
    const { collection, envelope } = deriveUriCollection(pattern);
    const mutationVerbs = [...methods].filter((m): m is 'POST' | 'PATCH' | 'DELETE' => m !== 'GET');
    entries.push({
      kind: 'uri',
      pattern,
      collection,
      verb: 'GET',
      azureTier: 'none',
      envelope,
      ...(mutationVerbs.length > 0 ? { mutationVerbs, singletonId: collection } : {}),
    });
  }
  return entries;
}

export function deriveResolversFromInventory(
  items: InventoryItem[],
  handled: { cmdlets: ReadonlySet<string>; uriPatterns: ReadonlySet<string> },
): DerivedResolverBundle {
  const graphUsages = collectCmdletUsages(
    items,
    new Set(['graph-cmdlet', 'invoke-mggraphrequest']),
  );
  const azUsages = collectCmdletUsages(items, new Set(['az-cmdlet']));
  const exoUsages = collectCmdletUsages(
    items,
    new Set(['exo-cmdlet', 'ipps-cmdlet', 'spo-cmdlet', 'other']),
  );

  return {
    graph: buildNamedEntries(graphUsages, handled.cmdlets, () => 'none'),
    az: buildNamedEntries(azUsages, handled.cmdlets, azTier),
    exo: buildNamedEntries(exoUsages, handled.cmdlets, () => 'none'),
    graphUri: buildUriEntries(items, handled.uriPatterns),
  };
}

/**
 * Walks up from `startDir` looking for tenant-stacksim's own package.json,
 * so the package root is found regardless of whether this module is
 * running as source (src/codegen, vitest/vite-node) or compiled output
 * (dist/src/codegen - tsconfig's rootDir "." + outDir "dist" nests an extra
 * "src" level under dist that a fixed "two levels up" assumption would miss).
 */
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

/**
 * Resolves `coverage/inventory.json` relative to this source file's own
 * location, so resolver modules can derive entries regardless of
 * process.cwd() or whether they're running from src or dist.
 */
export function resolveDefaultInventoryPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(findPackageRoot(here), 'coverage', 'inventory.json');
}

/**
 * Loads inventory items synchronously (resolver modules derive entries at
 * import time, mirroring how moduleManifest.ts is a plain data import).
 * Returns [] rather than throwing if inventory.json is missing/malformed -
 * derivation is additive; a missing inventory should never break the sim's
 * core M0-M6 surface (hand-authored entries still load normally).
 */
export function loadInventoryItemsSync(inventoryPath: string = resolveDefaultInventoryPath()): InventoryItem[] {
  try {
    const raw = readFileSync(inventoryPath, 'utf8');
    const parsed = JSON.parse(raw) as { items: InventoryItem[] };
    return parsed.items ?? [];
  } catch {
    return [];
  }
}
