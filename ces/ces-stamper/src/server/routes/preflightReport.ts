// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-21 (2026-10-31): pure helpers for GET /api/preflight (execute.routes.ts, preflight block).
 *
 * 1. `withPascalAliases`: the Graph PowerShell SDK returns PascalCase objects (Id, AppRoles, Value,
 *    AppRoleId, AccountEnabled), and ConvertTo-Json keeps those names. A tenant answering in
 *    camelCase (the simulator's store objects, or Graph REST JSON) used to read as "not found"
 *    everywhere in preflight, because the route reads `obj.Id`. Each camelCase key gains a
 *    PascalCase alias (never overwriting a key that is already there), recursively.
 * 2. `buildPreflightHeldReport` / `summarizeBreakGlass`: the summary event now names every held
 *    item (FD rulings: Teams Administrator and Sites.FullControl.All are HELD) and carries the
 *    break-glass check, so a reader of the summary alone sees both (check V117).
 */

/** Adds a PascalCase alias for every camelCase key (recursively); existing keys win. */
export function withPascalAliases<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => withPascalAliases(v)) as unknown as T;
  if (!value || typeof value !== 'object') return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) out[k] = withPascalAliases(v);
  for (const k of Object.keys(src)) {
    if (!/^[a-z]/.test(k)) continue;
    const pascal = k.charAt(0).toUpperCase() + k.slice(1);
    if (!(pascal in out)) out[pascal] = out[k];
  }
  return out as T;
}

export interface PreflightHeldItem {
  phase: 'graph_permission' | 'directory_role';
  name: string;
  detail: string;
}

export interface PreflightHeldReport {
  /** Every held item, in the order preflight reports them. */
  items: PreflightHeldItem[];
  count: number;
  /** The switch that would lift the hold (never set by CES). */
  release_flag: 'CES_HELD_STANDING_GRANTS_ENABLED';
}

export function buildPreflightHeldReport(
  heldResourceAppRoles: ReadonlyArray<{ permission: string; resourceName: string }>,
  heldDirectoryRoles: readonly string[],
  detail: string,
): PreflightHeldReport {
  const items: PreflightHeldItem[] = [
    ...heldResourceAppRoles.map((hp) => ({ phase: 'graph_permission' as const, name: `${hp.permission} (${hp.resourceName})`, detail })),
    ...heldDirectoryRoles.map((name) => ({ phase: 'directory_role' as const, name, detail })),
  ];
  return { items, count: items.length, release_flag: 'CES_HELD_STANDING_GRANTS_ENABLED' };
}

export type BreakGlassStatus = 'exists' | 'missing' | 'error' | 'not_run';

export interface PreflightBreakGlassReport {
  status: BreakGlassStatus;
  /** True only when every recorded account was found cloud-only and enabled (and at least the minimum were recorded). */
  verified: boolean;
  upns: string[];
  detail: string;
}

export function summarizeBreakGlass(status: BreakGlassStatus, upns: readonly string[], detail: string): PreflightBreakGlassReport {
  return { status, verified: status === 'exists', upns: [...upns], detail };
}
