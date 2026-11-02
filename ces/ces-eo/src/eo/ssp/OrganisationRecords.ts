// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 3 (P11, SC-5): the organisation's operating records, uploaded through the Evidence Collector
 * (EC), fill SSP content the tenant cannot supply:
 *   - the "Not supplied by the organisation (content gap): the <kind> records that evidence this control."
 *     sentence on a control the EC items are tagged to becomes a sentence naming each record's kind, row
 *     count, date range, file and hash (method examine; organisation-supplied, never a tested condition);
 *   - appendix F (Personnel Security Ledger) renders from `personnel_screening` / `personnel_lifecycle`
 *     records and appendix G (Training Compliance Matrix) from `training_completion` records, when the
 *     generator left them as the content gap (EO's own personnel / training stores win).
 *
 * Status is never touched (verify V27, DEC-7): this runs on the finished SSP, after statuses are fixed, and
 * writes only `implementationNarrative`, `appendices[F|G]` and `contentProvenance`. It never writes
 * `status`, `evidenceReferences`, `evidenceDetails` or any evidence id list. A met control carries no
 * content-gap sentence, so its narrative is never changed.
 * W5 cycle 4 (SC-3a): it also lists each tagged record on its control as `organisationRecords` (EC item id, file,
 * sha256, record kind, rows, period, method examine), on every tagged control whatever its status, so the evidence
 * index (bundle item 12, built from controlImplementations) can attach the record to the examine items it covers.
 *
 * Record file (`ces-org-record/1`, JSON, media type application/json): `{ schema, record_kind, kind_label?,
 * title?, marker?, rows: [{ date: 'YYYY-MM-DD', ... }] }`. EO counts the rows and takes the date range from
 * the rows' `date` values; it trusts no count or period the file states. The content's SHA-256 must equal
 * the EC item's `sha256`, else the item is skipped. Row fields read for the appendices: `person_id`, `name`,
 * `job_title`, `screening`, `result` (screening); `event`, `step`, `status` (lifecycle); `course`, `status`
 * (training).
 */
import { createHash } from 'node:crypto';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import type { AssessmentMethod } from '../packager/MethodLabeler.js';
import { NOT_SUPPLIED } from './ContentGap.js';
import type { SspContentProvenanceEntry } from './OdpValueProvider.js';

export const ORG_RECORD_SCHEMA = 'ces-org-record/1';
/** NIST SP 800-171A method for an organisation-supplied record: an assessor examines it (MethodLabeler vocabulary). */
export const ORGANISATION_RECORD_METHOD: AssessmentMethod = 'examine';
/** The marker a synthetic customer's records carry; stated next to the record when present. */
export const SIMULATED_RECORD_MARKER = 'SIMULATED CUSTOMER (FICTIONAL)';

export interface OrganisationRecordRow {
  date?: unknown;
  [field: string]: unknown;
}

/** One parsed, hash-checked organisation record (one EC item). */
export interface OrganisationRecord {
  itemId: string;
  filename: string;
  sha256: string;
  controlIds: string[];
  recordKind: string;
  kindLabel: string;
  title?: string;
  count: number;
  dateFrom?: string;
  dateTo?: string;
  /** W5 cycle 4: the EC item's collectedAt. */
  collectedAt?: string;
  simulated: boolean;
  rows: OrganisationRecordRow[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses one EC item's content as an organisation record, or undefined (not a record, unreadable, no rows, or hash mismatch). */
export function parseOrganisationRecord(item: EcEvidenceItem, content: Buffer): OrganisationRecord | undefined {
  if (createHash('sha256').update(content).digest('hex') !== item.sha256) return undefined;
  let doc: unknown;
  try { doc = JSON.parse(content.toString('utf8')); } catch { return undefined; }
  if (!doc || typeof doc !== 'object') return undefined;
  const d = doc as { schema?: unknown; record_kind?: unknown; kind_label?: unknown; title?: unknown; marker?: unknown; rows?: unknown };
  if (d.schema !== ORG_RECORD_SCHEMA || typeof d.record_kind !== 'string' || !d.record_kind.trim() || !Array.isArray(d.rows)) return undefined;
  const rows = d.rows.filter((r): r is OrganisationRecordRow => !!r && typeof r === 'object' && !Array.isArray(r));
  if (rows.length === 0) return undefined; // nothing to examine is not a record
  const dates = rows.map(r => r.date).filter((x): x is string => typeof x === 'string' && ISO_DATE.test(x)).sort();
  const kind = d.record_kind.trim();
  return {
    itemId: item.itemId,
    filename: item.filename,
    sha256: item.sha256,
    controlIds: [...item.controlIds],
    recordKind: kind,
    kindLabel: typeof d.kind_label === 'string' && d.kind_label.trim() ? d.kind_label.trim() : kind.replace(/_/g, ' '),
    ...(typeof d.title === 'string' && d.title.trim() ? { title: d.title.trim() } : {}),
    count: rows.length,
    ...(dates.length > 0 ? { dateFrom: dates[0], dateTo: dates[dates.length - 1] } : {}),
    ...(item.collectedAt ? { collectedAt: item.collectedAt } : {}),
    simulated: d.marker === SIMULATED_RECORD_MARKER,
    rows,
  };
}

/** The two EcEvidenceReader calls this module uses. */
export interface OrganisationRecordSource {
  readItems(tenantSlug: string): Promise<EcEvidenceItem[]>;
  readItemContent(tenantSlug: string, itemId: string): Promise<{ buffer: Buffer } | null>;
}

/**
 * The tenant's organisation records from EC: JSON items whose content parses as `ces-org-record/1` and whose
 * hash matches. Ordered by filename, then item id. Never throws (EC down, no secret: an empty list).
 */
export async function readOrganisationRecords(source: OrganisationRecordSource, tenantSlug: string): Promise<OrganisationRecord[]> {
  const out: OrganisationRecord[] = [];
  try {
    const items = await source.readItems(tenantSlug);
    for (const item of items) {
      if (!/^application\/([a-z.+-]*\+)?json\b/i.test(item.mediaType)) continue;
      const content = await source.readItemContent(tenantSlug, item.itemId);
      if (!content) continue;
      const rec = parseOrganisationRecord(item, content.buffer);
      if (rec) out.push(rec);
    }
  } catch {
    return out;
  }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return out.sort((a, b) => cmp(a.filename, b.filename) || cmp(a.itemId, b.itemId));
}

const GAP_SENTENCE = /Not supplied by the organisation \(content gap\): the ([a-z][a-z ]*) records that evidence this control\./;
export const RECORDS_LABEL = '**Organisation-supplied records (examine):**';

const hashRef = (r: OrganisationRecord): string => `sha256 ${r.sha256.slice(0, 12)}...`;
const dateRange = (r: OrganisationRecord): string =>
  r.dateFrom === undefined ? 'undated' : r.dateFrom === r.dateTo ? `dated ${r.dateFrom}` : `dated ${r.dateFrom} to ${r.dateTo}`;

/** One record as the narrative states it: count, kind, date range, file, EC item and hash reference. */
export function describeRecord(r: OrganisationRecord): string {
  const noun = r.count === 1 ? 'record' : 'records';
  return `${r.count} ${r.kindLabel} ${noun} ${dateRange(r)} (${r.filename}, EC item ${r.itemId}, ${hashRef(r)}${r.simulated ? `, marked ${SIMULATED_RECORD_MARKER}` : ''})`;
}

/**
 * FIN-11: how the listed records relate to the status. Under GD-b a reviewed objective can decide a control no stack
 * source has assessed, and NS-3b's records stores decide the PS / AT controls, so the records alone never set the
 * status, but a review or a store decision of them can (the assessment finding then names it).
 */
export const RECORDS_STATUS_SENTENCE = 'they are listed for an assessor to examine and, on their own, are not a tested condition and do not set '
  + "this control's status; a document review of an objective (GD-b) or a records-store decision can, and the assessment finding then names it.";

/** The sentence that replaces a control's records content gap. */
export function recordsSentence(records: OrganisationRecord[]): string {
  return `${RECORDS_LABEL} ${records.map(describeRecord).join('; ')}. The organisation supplied these records through the Evidence Collector; `
    + RECORDS_STATUS_SENTENCE;
}

const cell = (v: unknown): string => {
  const s = Array.isArray(v) ? v.map(String).join(', ') : v === undefined || v === null || v === '' ? '-' : String(v);
  return s.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const personKey = (r: OrganisationRecordRow): string | undefined => str(r.person_id) ?? str(r.name);

/** documentId for an appendix built from records: each file with its hash reference. */
function recordsDocumentId(records: OrganisationRecord[]): string {
  return `ORGANISATION RECORDS: ${records.map(r => `${r.filename} (${hashRef(r)})`).join('; ')}`;
}
function recordsNote(records: OrganisationRecord[]): string {
  return `Organisation-supplied records (examine; not a tested condition): ${records.map(describeRecord).join('; ')}.`;
}

/** Appendix F from personnel screening and lifecycle records; undefined when no screening or lifecycle row names a person. */
export function personnelLedger(records: OrganisationRecord[]): { documentId: string; summary: string } | undefined {
  const used = records.filter(r => r.recordKind === 'personnel_screening' || r.recordKind === 'personnel_lifecycle');
  const people = new Map<string, { name: string; jobTitle: string; screening?: string; screened?: string; result?: string; events: Map<string, OrganisationRecordRow[]> }>();
  const touch = (row: OrganisationRecordRow) => {
    const key = personKey(row);
    if (!key) return undefined;
    let p = people.get(key);
    if (!p) { p = { name: str(row.name) ?? key, jobTitle: str(row.job_title) ?? '-', events: new Map() }; people.set(key, p); }
    return p;
  };
  for (const r of used.filter(x => x.recordKind === 'personnel_screening')) {
    for (const row of r.rows) {
      const p = touch(row);
      if (!p) continue;
      p.screening = str(row.screening) ?? p.screening;
      p.screened = typeof row.date === 'string' ? row.date : p.screened;
      p.result = str(row.result) ?? p.result;
    }
  }
  for (const r of used.filter(x => x.recordKind === 'personnel_lifecycle')) {
    for (const row of r.rows) {
      const p = touch(row);
      if (!p) continue;
      const ev = str(row.event) ?? 'lifecycle';
      p.events.set(ev, [...(p.events.get(ev) ?? []), row]);
    }
  }
  if (people.size === 0) return undefined;
  const lifecycle = (events: Map<string, OrganisationRecordRow[]>): string => {
    if (events.size === 0) return '-';
    return [...events].map(([ev, rows]) => {
      const dates = rows.map(x => x.date).filter((x): x is string => typeof x === 'string').sort();
      const open = rows.filter(x => str(x.status)?.toLowerCase() !== 'done' && str(x.status)?.toLowerCase() !== 'completed');
      const done = rows.length - open.length;
      return `${ev} ${dates[dates.length - 1] ?? 'undated'}: ${done} of ${rows.length} checklist steps done${open.length ? `; open: ${open.map(x => cell(x.step)).join('; ')}` : ''}`;
    }).join(' / ');
  };
  const rows = [...people.values()].map(p =>
    `| ${cell(p.name)} | ${cell(p.jobTitle)} | ${cell(p.screening)} | ${cell(p.screened)} | ${cell(p.result)} | ${cell(lifecycle(p.events))} |`);
  return {
    documentId: recordsDocumentId(used),
    summary: `| Name | Job Title | Screening | Screened On | Result | Onboarding / Termination Checklist |\n|------|-----------|-----------|-------------|--------|------------------------------------|\n${rows.join('\n')}\n\n${recordsNote(used)}`,
  };
}

/** Appendix G from training completion records; undefined when no row names a person and a course. */
export function trainingMatrix(records: OrganisationRecord[]): { documentId: string; summary: string } | undefined {
  const used = records.filter(r => r.recordKind === 'training_completion');
  const courses: string[] = [];
  const people = new Map<string, { name: string; jobTitle: string; byCourse: Map<string, OrganisationRecordRow> }>();
  for (const r of used) {
    for (const row of r.rows) {
      const key = personKey(row);
      const course = str(row.course);
      if (!key || !course) continue;
      if (!courses.includes(course)) courses.push(course);
      let p = people.get(key);
      if (!p) { p = { name: str(row.name) ?? key, jobTitle: str(row.job_title) ?? '-', byCourse: new Map() }; people.set(key, p); }
      p.byCourse.set(course, row);
    }
  }
  if (people.size === 0) return undefined;
  const completed = (row: OrganisationRecordRow | undefined) => !!row && str(row.status)?.toLowerCase() === 'completed';
  const rows = [...people.values()].map(p => {
    const cells = courses.map(c => {
      const row = p.byCourse.get(c);
      if (!row) return 'not required';
      return completed(row) ? `completed ${cell(row.date)}` : cell(row.status);
    });
    const required = p.byCourse.size;
    const done = courses.filter(c => completed(p.byCourse.get(c))).length;
    return `| ${cell(p.name)} | ${cell(p.jobTitle)} | ${cells.join(' | ')} | ${required} | ${done} | ${Math.round((100 * done) / required)}% |`;
  });
  return {
    documentId: recordsDocumentId(used),
    summary: `| Name | Job Title | ${courses.map(cell).join(' | ')} | Required Courses | Completed Courses | Compliance % |\n|------|-----------|${courses.map(() => '---').join('|')}|------------------|-------------------|---------------|\n${rows.join('\n')}\n\n${recordsNote(used)}`,
  };
}

/** W5 cycle 4: one organisation record as listed on a control (read by EvidenceIndex as IndexOrganisationRecord). */
export interface ControlOrganisationRecord {
  itemId: string; file: string; sha256: string; recordKind: string; rows: number;
  dateFrom?: string; dateTo?: string; collectedAt?: string; method: AssessmentMethod;
}
interface RecordsControl { control_id: string; status: string; implementationNarrative: string; organisationRecords?: ControlOrganisationRecord[] }

const controlRecord = (r: OrganisationRecord): ControlOrganisationRecord => ({
  itemId: r.itemId, file: r.filename, sha256: r.sha256, recordKind: r.recordKind, rows: r.count,
  ...(r.dateFrom ? { dateFrom: r.dateFrom } : {}), ...(r.dateTo ? { dateTo: r.dateTo } : {}),
  ...(r.collectedAt ? { collectedAt: r.collectedAt } : {}), method: ORGANISATION_RECORD_METHOD,
});
interface RecordsSspFields {
  appendices?: Array<{ id: string; documentId: string; summary: string }>;
  contentProvenance?: SspContentProvenanceEntry[];
}

const provenanceSource = (records: OrganisationRecord[]): string =>
  records.map(r => `EC item ${r.itemId} ${r.filename}, sha256 ${r.sha256} (${ORG_RECORD_SCHEMA} ${r.recordKind}, ${r.count} rows, method ${ORGANISATION_RECORD_METHOD})`).join('; ');

/**
 * Fills, in place, the records content gaps from organisation records (see the module comment). Idempotent:
 * a filled sentence no longer matches the gap sentence, and a filled appendix is no longer the content gap.
 */
export function applyOrganisationRecords<T extends { controlImplementations: RecordsControl[] }>(ssp: T, records: OrganisationRecord[]): T {
  if (records.length === 0) return ssp;
  const doc = ssp as unknown as RecordsSspFields;
  const provenance: SspContentProvenanceEntry[] = doc.contentProvenance ?? [];
  const record = (field: string, source: string) => {
    const at = provenance.findIndex(p => p.field === field);
    const entry: SspContentProvenanceEntry = { field, provenance: 'organisation records', source };
    if (at >= 0) provenance[at] = entry; else provenance.push(entry);
  };

  for (const control of ssp.controlImplementations) {
    const tagged = records.filter(r => r.controlIds.includes(control.control_id));
    if (tagged.length > 0) control.organisationRecords = tagged.map(controlRecord);
    if (control.status === 'met' || !GAP_SENTENCE.test(control.implementationNarrative)) continue;
    if (tagged.length === 0) continue;
    control.implementationNarrative = control.implementationNarrative.replace(GAP_SENTENCE, recordsSentence(tagged));
    record(`controlImplementations[${control.control_id}].implementationNarrative`, provenanceSource(tagged));
  }

  const fill = (id: 'F' | 'G', built: { documentId: string; summary: string } | undefined, kinds: string[]) => {
    const a = doc.appendices?.find(x => x.id === id);
    if (!a || !built || a.documentId !== NOT_SUPPLIED) return;
    a.documentId = built.documentId;
    a.summary = built.summary;
    record(`appendices[${id}].documentId`, provenanceSource(records.filter(r => kinds.includes(r.recordKind))));
  };
  fill('F', personnelLedger(records), ['personnel_screening', 'personnel_lifecycle']);
  fill('G', trainingMatrix(records), ['training_completion']);

  if (provenance.length > 0) doc.contentProvenance = provenance;
  return ssp;
}
