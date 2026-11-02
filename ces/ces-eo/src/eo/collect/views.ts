// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W2: how the evaluators read collected records. A collector's windowed view is a
 * signal (`collect.*`) whose rows are every record the store holds for that source within the view
 * period. When a collected view is absent (no collector ran, e.g. the scheduled capture path), the
 * evaluator falls back to the same source's point-in-time read (W0.3), if one is given.
 */
import type { SignalResult } from 'ces-shared/types/signal';
import { graphItems, isoTime } from './Collector.js';

export interface CollectedRows {
  /** At least one of the sources was read successfully. */
  read: boolean;
  rows: unknown[];
  /** Rows per source signal id actually used. */
  bySource: Record<string, number>;
  /** One line per source: what the read returned. */
  states: string[];
}

/**
 * Rows of the collected views `ids`; for each id, `fallback[id]` (a point-in-time read's signal
 * id) is used only when the collected view is not among the signals at all.
 */
export function collectedRows(signals: SignalResult[], ids: string[], fallback: Record<string, string> = {}): CollectedRows {
  const out: CollectedRows = { read: false, rows: [], bySource: {}, states: [] };
  for (const id of ids) {
    let sig = signals.find((s) => s.signalId === id);
    if (!sig && fallback[id]) sig = signals.find((s) => s.signalId === fallback[id]);
    const used = sig?.signalId ?? id;
    if (!sig) { out.states.push(fallback[id] ? `'${id}' was not collected and '${fallback[id]}' was not read` : `'${id}' was not read`); continue; }
    if (sig.status !== 'success' || sig.rawData == null) {
      out.states.push(`read of '${used}' failed (${sig.error ?? sig.status})`);
      continue;
    }
    const rows = rowsOf(sig.rawData);
    out.read = true;
    out.rows.push(...rows);
    out.bySource[used] = rows.length;
    out.states.push(`'${used}' returned ${rows.length} record${rows.length === 1 ? '' : 's'}`);
  }
  return out;
}

/**
 * Rows of a read: a collection (`value`, `results`, bare array), or, for a point-in-time cmdlet read
 * that serialized a one-element collection as a single object, that object.
 */
function rowsOf(raw: unknown): unknown[] {
  const items = graphItems(raw);
  if (items.length > 0 || !raw || typeof raw !== 'object' || Array.isArray(raw)) return items;
  const keys = Object.keys(raw as object);
  return keys.length > 0 && !keys.some((k) => k === 'value' || k === 'results' || k === 'Results') ? [raw] : [];
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A UAL row's AuditData (a JSON string in the EXO shape), parsed; {} when unreadable. */
export function auditDataOf(row: unknown): Record<string, unknown> {
  const raw = obj(row).AuditData;
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try { return obj(JSON.parse(String(raw ?? ''))); } catch { return {}; }
}

/** Workloads in scope for a GCC High CUI enclave's audit records (3.3.1). */
export const IN_SCOPE_WORKLOADS = ['AzureActiveDirectory', 'Exchange', 'SharePoint'] as const;

/** The in-scope workload a UAL row belongs to (AuditData.Workload, else RecordType), or null. */
export function ualWorkload(row: unknown): string | null {
  for (const v of [auditDataOf(row).Workload, obj(row).RecordType]) {
    const s = str(v);
    if (/azureactivedirectory/i.test(s)) return 'AzureActiveDirectory';
    if (/exchange/i.test(s)) return 'Exchange';
    if (/sharepoint|onedrive/i.test(s)) return 'SharePoint';
  }
  return null;
}

export type ActorKind = 'user' | 'app' | 'none';

/**
 * Who a record attributes its action to:
 * - sign-in: userPrincipalName or userId (user);
 * - directory audit: initiatedBy.user {userPrincipalName | id} (user), else initiatedBy.app
 *   {appId | servicePrincipalId | displayName} (app);
 * - UAL row: UserIds (user, unless it names a service such as `SecurityComplianceAlerts`).
 */
export function actorOf(row: unknown): { kind: ActorKind; actor: string } {
  const r = obj(row);
  const signIn = str(r.userPrincipalName) || str(r.userId);
  if (signIn) return { kind: 'user', actor: signIn };
  const by = obj(r.initiatedBy);
  const user = obj(by.user);
  const u = str(user.userPrincipalName) || str(user.id);
  if (u) return { kind: 'user', actor: u };
  const app = obj(by.app);
  const a = str(app.appId) || str(app.servicePrincipalId) || str(app.displayName);
  if (a) return { kind: 'app', actor: a };
  const ual = str(r.UserIds);
  if (ual) return { kind: ual.includes('@') ? 'user' : 'app', actor: ual };
  return { kind: 'none', actor: '' };
}

/** The event a record logs (operation or activity), '' when absent. */
export function eventOf(row: unknown): string {
  const r = obj(row);
  return str(r.Operations) || str(r.activityDisplayName) || str(r.operationType)
    || (str(r.createdDateTime) && (str(r.userPrincipalName) || str(r.userId)) ? 'sign-in' : '');
}

/** The record's event time (ISO), '' when absent or unparseable. */
export function eventTimeOf(row: unknown): string {
  const r = obj(row);
  return isoTime(r.CreationDate ?? r.activityDateTime ?? r.createdDateTime);
}

/**
 * W2 (versioned sources): the newest version of each object. Rows are grouped by `keyOf` (the
 * object id, without the collector's `@<update time>` suffix) and the row with the latest
 * `timeOf` is kept; ties keep the first. Rows without a key are kept as they are.
 */
export function latestVersions(rows: unknown[], keyOf: (row: unknown) => string, timeOf: (row: unknown) => string): unknown[] {
  const byKey = new Map<string, unknown>();
  const loose: unknown[] = [];
  for (const row of rows) {
    const k = keyOf(row);
    if (!k) { loose.push(row); continue; }
    const cur = byKey.get(k);
    if (cur === undefined) { byKey.set(k, row); continue; }
    const a = Date.parse(timeOf(row));
    const b = Date.parse(timeOf(cur));
    if (Number.isFinite(a) && (!Number.isFinite(b) || a > b)) byKey.set(k, row);
  }
  return [...byKey.values(), ...loose];
}

/** A row's field, read from flat Graph JSON or a PowerShell SDK object (PascalCase / AdditionalProperties). */
export function fieldOf(row: unknown, key: string): unknown {
  const r = obj(row);
  if (key in r) return r[key];
  const upper = key.charAt(0).toUpperCase() + key.slice(1);
  if (upper in r) return r[upper];
  const ap = obj(r.AdditionalProperties ?? r.additionalProperties);
  return key in ap ? ap[key] : undefined;
}
