// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 3 (EO rules part 2, item 1): assignment-aware credit. An Intune object (update ring,
 * device configuration / BitLocker profile, compliance policy, settings-catalog policy, app-protection
 * policy) acts on no device or user until it is assigned to a group. So a live read or a Stamper record
 * of such an object credits a control only when the object has at least one assignment:
 *   - `assignments[]` / `groupAssignments[]` non-empty, or Graph's own `isAssigned: true` -> assigned;
 *   - an empty `assignments[]` / `groupAssignments[]`, or `isAssigned: false` -> unassigned
 *     ("created but assigned to no group") -> not met;
 *   - no assignment information on the object -> unknown -> not assessed with the read printed (never
 *     presence-met).
 */
import type { SignalResult } from 'ces-shared/types/signal';
import type { Verdict } from './conditions.js';
import { listOf, notAssessed } from './conditions.js';

export type AssignmentState = 'assigned' | 'unassigned' | 'unknown';

/** The sentence of an unassigned object (brief wording). */
export const UNASSIGNED_SENTENCE = 'created but assigned to no group';

/**
 * Endpoints (registry form, version and query stripped, lower-cased) whose rows are assignable Intune
 * objects. `deviceManagement/windowsUpdateForBusinessUpdateRings` is the RA.L2-3.11.3 registry string
 * (update rings are `deviceConfigurations` of type windowsUpdateForBusinessConfiguration on Graph).
 */
export const ASSIGNABLE_INTUNE_ENDPOINTS: ReadonlySet<string> = new Set([
  'devicemanagement/deviceconfigurations',
  'devicemanagement/devicecompliancepolicies',
  'devicemanagement/configurationpolicies',
  'devicemanagement/intents',
  'devicemanagement/windowsupdateforbusinessupdaterings',
  'deviceappmanagement/iosmanagedappprotections',
  'deviceappmanagement/iosmanagedappprotectionpolicies',
  'deviceappmanagement/androidmanagedappprotections',
  'deviceappmanagement/managedapppolicies',
]);

const normalizeEndpoint = (p: string | undefined | null): string =>
  String(p ?? '')
    .replace(/^https?:\/\/[^/]+/, '')
    .split('?')[0]
    .replace(/^\/+|\/+$/g, '')
    .replace(/^(v1\.0|beta)\//i, '')
    .toLowerCase();

/** True for a read whose rows are assignable Intune objects. */
export function isAssignableIntuneSignal(s: SignalResult): boolean {
  return ASSIGNABLE_INTUNE_ENDPOINTS.has(normalizeEndpoint(s.endpoint));
}

/** The assignment state of one Intune object as read. */
export function assignmentStateOf(row: Record<string, unknown>): AssignmentState {
  let sawEmpty = false;
  for (const key of ['assignments', 'groupAssignments']) {
    const v = row[key];
    if (Array.isArray(v)) {
      if (v.length > 0) return 'assigned';
      sawEmpty = true;
    }
  }
  if (typeof row.isAssigned === 'boolean') return row.isAssigned ? 'assigned' : 'unassigned';
  return sawEmpty ? 'unassigned' : 'unknown';
}

const objectName = (r: Record<string, unknown>): string => String(r.displayName ?? r.name ?? r.id ?? 'unnamed');

/** The same read shape (bare array, `{ value: [] }` envelope or one object) holding only the kept rows. */
function keepRows(data: unknown, keep: (r: Record<string, unknown>) => boolean): unknown {
  if (Array.isArray(data)) return data.filter(r => r && typeof r === 'object' && keep(r as Record<string, unknown>));
  if (data && typeof data === 'object') {
    const v = (data as Record<string, unknown>).value;
    if (Array.isArray(v)) return { ...(data as object), value: v.filter(r => r && typeof r === 'object' && keep(r as Record<string, unknown>)) };
    return keep(data as Record<string, unknown>) ? data : { value: [] };
  }
  return data;
}

const credits = (v: Verdict): boolean => v.status === 'met' || v.status === 'partial';
/** The evaluator's own label (the text before the first colon of its evidence). */
const labelOf = (v: Verdict): string => {
  const i = v.evidence.indexOf(':');
  return i > 0 && i < 120 ? v.evidence.slice(0, i) : 'Intune configuration';
};

/**
 * Runs `evaluate` with the assignment rule applied to the assignable Intune reads among `signals`.
 * The evaluator's verdict is kept when it does not credit, or when every Intune object read is
 * assigned. Otherwise the evaluator is run again on the assigned objects only: if it still credits,
 * that verdict stands; if not, the objects the credit rested on are named, and the result is not
 * assessed when any of them carries no assignment information, else not met ("created but assigned
 * to no group"). Never upgrades a verdict.
 */
export function assignmentGated(evaluate: (signals: SignalResult[]) => Verdict, signals: SignalResult[]): Verdict {
  const full = evaluate(signals);
  if (!credits(full)) return full;
  const intune = signals.filter(s => isAssignableIntuneSignal(s) && s.status === 'success' && s.rawData != null);
  const rows = intune.flatMap(s => listOf(s.rawData).map(r => ({ s, r, state: assignmentStateOf(r) })));
  if (rows.length === 0 || rows.every(x => x.state === 'assigned')) return full;

  const assignedOnly = (extra?: Record<string, unknown>) => signals.map(s => intune.includes(s)
    ? { ...s, rawData: keepRows(s.rawData, r => r === extra || assignmentStateOf(r) === 'assigned') }
    : s);
  const gated = evaluate(assignedOnly());
  if (credits(gated)) return gated;

  const open = rows.filter(x => x.state !== 'assigned');
  const resting = open.filter(x => credits(evaluate(assignedOnly(x.r))));
  const named = resting.length > 0 ? resting : open;
  const ids = [...new Set(intune.map(s => s.signalId))];
  const unknown = named.filter(x => x.state === 'unknown');
  const without = `without the assignment test the read gives: ${full.evidence}`;
  if (unknown.length > 0) {
    return notAssessed(labelOf(full),
      `the Intune object read carries no assignment information for '${unknown.map(x => objectName(x.r)).join("', '")}', so EO cannot tell whether the object(s) the result rests on are assigned to any group (an Intune object acts on no device or user until it is assigned; ${without})`,
      signals, ids);
  }
  return {
    status: 'not_met',
    evidence: `${labelOf(full)}: '${named.map(x => objectName(x.r)).join("', '")}' ${UNASSIGNED_SENTENCE}, so it applies to no device or user (${without})`,
  };
}

// ---------------------------------------------------------------- Stamper records

const INTUNE_COMMAND_RE = /deviceManagement\/(deviceConfigurations|deviceCompliancePolicies|configurationPolicies|intents|templates\/[^/'"\s]+\/createInstance)|deviceAppManagement\/\w*ManagedAppProtections|DeviceManagementDeviceConfiguration|DeviceManagementDeviceCompliancePolicy|DeviceManagementConfigurationPolicy|DeviceManagementIntent|ManagedAppProtection/i;
/**
 * Intune object types (device configuration templates, compliance policies, app protection, settings catalog,
 * intents). Authentication-method configurations (`fido2AuthenticationMethodConfiguration`, ...) are policy
 * objects, not assignable Intune objects, and never match.
 */
const INTUNE_ODATA_RE = /#microsoft\.graph\.((windows|ios|android|macOS|aosp|editionUpgrade|sharedPC)\w*(Configuration|CompliancePolicy|Protection)|\w*ManagedAppProtection|deviceManagementConfigurationPolicy|deviceManagementIntent)$/i;
const NOT_INTUNE_ODATA_RE = /AuthenticationMethodConfiguration$/i;

function payloadRows(raw: unknown): Record<string, unknown>[] | undefined {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return undefined; }
  }
  return listOf(v);
}

/**
 * The assignment state of a Stamper record that reads or writes an Intune object (by its command's
 * Intune path or cmdlet, or a payload row of an Intune `@odata.type`), or undefined for any other
 * record. Any assigned object -> assigned; every object explicitly unassigned -> unassigned; else
 * (no assignment information, or a payload that does not parse) -> unknown.
 */
export function stamperRecordAssignmentState(commandExecuted: string, rawResponse: unknown): AssignmentState | undefined {
  const rows = payloadRows(rawResponse);
  const intune = INTUNE_COMMAND_RE.test(commandExecuted ?? '')
    || (rows ?? []).some(r => { const t = String(r['@odata.type'] ?? ''); return INTUNE_ODATA_RE.test(t) && !NOT_INTUNE_ODATA_RE.test(t); });
  if (!intune) return undefined;
  if (!rows || rows.length === 0) return 'unknown';
  const states = rows.map(assignmentStateOf);
  if (states.includes('assigned')) return 'assigned';
  if (states.every(s => s === 'unassigned')) return 'unassigned';
  return 'unknown';
}
