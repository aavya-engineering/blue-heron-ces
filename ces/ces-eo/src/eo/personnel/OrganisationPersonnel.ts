// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Synthetic-customer W5 cycle 7 (personnel store): the organisation's uploaded personnel records
 * (Evidence Collector items, `ces-org-record/1`, kinds `personnel_screening` and `personnel_lifecycle`)
 * as the source of PS.L2-3.9.1 / PS.L2-3.9.2 readiness when present.
 *   - screening rows -> one person per `person_id` (an admin-account row carrying `owner_person_id` counts
 *     as its owner, so a person is never counted twice); screening state from `result` (`cleared` -> cleared,
 *     `expired` -> expired, anything else -> unscreened); a person with several rows takes the latest by `date`;
 *   - lifecycle rows -> per person, the `termination` events (leavers) and their steps (`status` `done` = complete);
 *     a leaver whose account-disable step is done is offboarded and leaves the screening population;
 *   - PS.L2-3.9.1: met when every person who is not offboarded is cleared (at least one person);
 *   - PS.L2-3.9.2: met when at least one leaver is recorded and every leaver's account-disable step is done;
 *     a leaver whose account-disable step is missing or not done is not met, the person printed.
 * The record files carry no account state, so "enabled" is read from the record: an account-disable step that
 * is not done means the account was not disabled.
 */
import type { PersonnelReadiness } from '../../shared/types/personnel.types.js';

export const PERSONNEL_SCREENING_KIND = 'personnel_screening';
export const PERSONNEL_LIFECYCLE_KIND = 'personnel_lifecycle';
export const PERSONNEL_RECORD_KINDS: ReadonlySet<string> = new Set([PERSONNEL_SCREENING_KIND, PERSONNEL_LIFECYCLE_KIND]);

/** A lifecycle step that disables the leaver's account. */
const ACCOUNT_DISABLE_STEP = /account[^;]*\bdisabl|disabl\w*[^;]*\baccount/i;

type Row = Record<string, unknown>;

/** The personnel records the store keeps for a tenant (rows plus the provenance of each upload). */
export interface StoredOrganisationPersonnel {
  savedAt: string;
  sources: Array<{ itemId: string; filename: string; sha256: string; recordKind: string; rows: number }>;
  screening: Row[];
  lifecycle: Row[];
}

/** The minimum an organisation record must carry to feed the store (OrganisationRecords.OrganisationRecord). */
export interface PersonnelRecordInput {
  itemId: string;
  filename: string;
  sha256: string;
  recordKind: string;
  rows: Row[];
}

/** The personnel-kind records among `records`, or undefined when there are none. */
export function personnelFromRecords(records: PersonnelRecordInput[], savedAt: string): StoredOrganisationPersonnel | undefined {
  const kept = records.filter(r => PERSONNEL_RECORD_KINDS.has(r.recordKind) && r.rows.length > 0);
  if (kept.length === 0) return undefined;
  return {
    savedAt,
    sources: kept.map(r => ({ itemId: r.itemId, filename: r.filename, sha256: r.sha256, recordKind: r.recordKind, rows: r.rows.length })),
    screening: kept.filter(r => r.recordKind === PERSONNEL_SCREENING_KIND).flatMap(r => r.rows),
    lifecycle: kept.filter(r => r.recordKind === PERSONNEL_LIFECYCLE_KIND).flatMap(r => r.rows),
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** The person a row belongs to: the owner of an admin account, else the row's own person id. */
const personOf = (r: Row): string => str(r.owner_person_id) || str(r.person_id);
const labelOf = (id: string, rows: Row[]): string => {
  const title = rows.map(r => str(r.job_title)).find(Boolean);
  return title ? `${id} (${title})` : id;
};

type ScreeningState = 'cleared' | 'expired' | 'unscreened';
const stateOf = (result: string): ScreeningState => {
  const r = result.toLowerCase();
  if (r === 'cleared') return 'cleared';
  if (r === 'expired') return 'expired';
  return 'unscreened';
};

export interface OrganisationReadiness {
  readiness: PersonnelReadiness;
  /** Set when the screening records decided PS.L2-3.9.1. */
  rationale391?: string;
  /** Set when the lifecycle records decided PS.L2-3.9.2. */
  rationale392?: string;
}

/**
 * PS readiness from the stored organisation records. A part whose record kind is absent is left to the
 * caller (`rationale391` / `rationale392` undefined, the counts of that part zero).
 */
export function readinessFromOrganisationRecords(stored: StoredOrganisationPersonnel): OrganisationReadiness {
  // Leavers: termination events per person.
  const leaverRows = new Map<string, Row[]>();
  for (const r of stored.lifecycle) {
    if (str(r.event).toLowerCase() !== 'termination') continue;
    const id = personOf(r);
    if (!id) continue;
    leaverRows.set(id, [...(leaverRows.get(id) ?? []), r]);
  }
  const leavers = [...leaverRows.entries()].map(([id, rows]) => {
    const disable = rows.filter(r => ACCOUNT_DISABLE_STEP.test(str(r.step)));
    const disabled = disable.length > 0 && disable.every(r => str(r.status).toLowerCase() === 'done');
    const open = rows.filter(r => str(r.status).toLowerCase() !== 'done').map(r => str(r.step) || 'unnamed step');
    return { id, label: labelOf(id, rows), disabled, hasDisableStep: disable.length > 0, open };
  });
  const offboardedIds = new Set(leavers.filter(l => l.disabled).map(l => l.id));

  // Persons from the screening rows (latest row per person).
  const latest = new Map<string, Row>();
  for (const r of stored.screening) {
    const id = personOf(r);
    if (!id) continue;
    const prev = latest.get(id);
    if (!prev || str(r.date) >= str(prev.date)) latest.set(id, r);
  }
  const persons = [...latest.entries()].map(([id, r]) => ({ id, label: labelOf(id, [r]), state: stateOf(str(r.result)), result: str(r.result) || 'no result' }));
  const active = persons.filter(p => !offboardedIds.has(p.id));
  const cleared = active.filter(p => p.state === 'cleared');
  const notCleared = active.filter(p => p.state !== 'cleared');

  const readiness: PersonnelReadiness = {
    cleared: cleared.length,
    total: active.length,
    expiringSoon: 0,
    unscreened: notCleared.length,
    offboarded: offboardedIds.size,
    ps_3_9_1: active.length > 0 && notCleared.length === 0 ? 'met' : 'not_met',
    ps_3_9_2: leavers.length > 0 && leavers.every(l => l.disabled) ? 'met' : 'not_met',
  };

  const files = (kind: string) => stored.sources.filter(s => s.recordKind === kind).map(s => s.filename).join(', ');
  const out: OrganisationReadiness = { readiness };
  if (stored.screening.length > 0) {
    const scope = `${persons.length} person(s) in the uploaded screening records (${files(PERSONNEL_SCREENING_KIND)}), ${offboardedIds.size} offboarded excluded`;
    out.rationale391 = readiness.ps_3_9_1 === 'met'
      ? `personnel screening from the organisation's records: ${scope}; all ${active.length} active person(s) cleared`
      : active.length === 0
        ? `personnel screening from the organisation's records: ${scope}; no active person`
        : `personnel screening from the organisation's records: ${scope}; not cleared: ${notCleared.map(p => `${p.label} result '${p.result}'`).join(', ')}`;
  }
  if (stored.lifecycle.length > 0) {
    const scope = `${leavers.length} leaver(s) in the uploaded lifecycle records (${files(PERSONNEL_LIFECYCLE_KIND)})`;
    const failing = leavers.filter(l => !l.disabled);
    out.rationale392 = leavers.length === 0
      ? `termination from the organisation's records: ${scope}; no termination recorded`
      : failing.length === 0
        ? `termination from the organisation's records: ${scope}; every leaver's account-disable step is done (${leavers.map(l => l.label).join(', ')})`
        : `termination from the organisation's records: ${scope}; account not disabled: ${failing.map(l => `${l.label} (${l.hasDisableStep ? 'account-disable step not done' : 'no account-disable step recorded'}; open: ${l.open.join('; ') || 'none'})`).join(', ')}`;
  }
  return out;
}
