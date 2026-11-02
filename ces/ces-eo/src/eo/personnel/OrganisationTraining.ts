// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Gap closure NS-3b: the customer-scoped training catalog, built from the organisation's uploaded
 * `training_completion` records (Evidence Collector items, `ces-org-record/1`, hash checked by
 * OrganisationRecords.parseOrganisationRecord).
 *
 * The customer's courses are its own products (for example "S1 Security Awareness: Handling CUI (2026)"),
 * not the DoD / CDSE courses of EO's default catalog, so they are not mapped onto those: each distinct
 * `course` value becomes its own catalog course, id = the course name verbatim (the id the customer's
 * completions are recorded under), satisfying the AT controls the record is tagged with.
 *
 * Population (who must take the course):
 *   - a course tagged with an all-personnel AT control (AT.L2-3.2.1 awareness, AT.L2-3.2.3 insider threat)
 *     is required of every active person: the control itself sets that population, and the people come
 *     from the personnel store, not from the completion record;
 *   - any other course (AT.L2-3.2.2 role-based training) is required of the job titles the record lists.
 *     That population comes from the completion record itself, so the training store does not decide a
 *     control on it (TrainingStore.catalogDecidesControl).
 */
import type { TrainingCatalog, TrainingCourse } from '../../shared/types/personnel.types.js';

export const TRAINING_COMPLETION_KIND = 'training_completion';
/** AT controls whose population is every active person. */
export const ALL_PERSONNEL_AT_CONTROLS: ReadonlySet<string> = new Set(['AT.L2-3.2.1', 'AT.L2-3.2.3']);
/** `required_for_roles` value of a course whose population is the job titles its record lists. */
export const RECORD_ROLES = 'organisation_record_roles';

/** The minimum an organisation record must carry (OrganisationRecords.OrganisationRecord). */
export interface TrainingRecordInput {
  filename: string;
  sha256: string;
  recordKind: string;
  controlIds: string[];
  rows: Array<Record<string, unknown>>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The customer-scoped catalog from the training records among `records`, or undefined when none names an AT course. */
export function catalogFromOrganisationRecords(records: TrainingRecordInput[]): TrainingCatalog | undefined {
  const byId = new Map<string, { controls: Set<string>; titles: Set<string>; files: Set<string> }>();
  for (const r of records) {
    if (r.recordKind !== TRAINING_COMPLETION_KIND) continue;
    const at = r.controlIds.filter(c => c.startsWith('AT.'));
    if (at.length === 0) continue;
    for (const row of r.rows) {
      const course = str(row.course);
      if (!course) continue;
      const entry = byId.get(course) ?? { controls: new Set<string>(), titles: new Set<string>(), files: new Set<string>() };
      for (const c of at) entry.controls.add(c);
      const title = str(row.job_title);
      if (title) entry.titles.add(title);
      entry.files.add(`${r.filename} (sha256 ${r.sha256.slice(0, 12)})`);
      byId.set(course, entry);
    }
  }
  if (byId.size === 0) return undefined;
  const courses: TrainingCourse[] = [...byId.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, e]) => {
    const controls = [...e.controls].sort();
    const allPersonnel = controls.some(c => ALL_PERSONNEL_AT_CONTROLS.has(c));
    return {
      id,
      title: id,
      provider: 'organisation',
      duration: 'not stated',
      description: `Customer-scoped course from the organisation's uploaded training records: ${[...e.files].sort().join(', ')}.`,
      targetRoles: allPersonnel ? ['*'] : [...e.titles].sort(),
      required_for_roles: allPersonnel ? ['all_users'] : [RECORD_ROLES],
      satisfies_controls: controls,
      refresh_cycle_days: 365,
    };
  });
  return { courses };
}
