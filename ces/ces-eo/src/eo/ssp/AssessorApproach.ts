// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * GC-KB-2: the assessor knowledge bases (KB-1, ces-shared `./data/assessor-approach` and
 * `./data/assessor-evidence-matrix`) read for the SSP's per-control "Assessment approach" block and,
 * later, PKG-3's evidence index (`objectiveEvidenceSources`). Text only: nothing here sets a status,
 * an SPRS value or a credit.
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';

/** KB-1 evidence sources (assessor-evidence-matrix `ces_sources`). */
export type CesSource = 'stack_signal' | 'ao_row' | 'stamper_evidence' | 'ec_upload' | 'eo_store' | 'interview';

export interface EvidenceSourceRow {
  artifact_type: string;
  ces_source: CesSource;
  notes: string;
}

interface ApproachObjective { id: string; determination: string; methods: string[] }
interface ApproachPractice { id: string; family: string; title: string; what_assessor_does: string; common_failure_modes: string[]; objectives: ApproachObjective[] }
interface MatrixObjective { id: string; practice_id: string; methods: string[]; evidence: EvidenceSourceRow[] }

/** Whether CES holds the artifact for this tenant in this run: `unknown` where EO cannot tell. */
export type HeldState = 'held' | 'not_held' | 'unknown';

export interface ApproachEvidence { artifactType: string; cesSource: CesSource; held: HeldState }
export interface ApproachObjectiveBlock { objectiveId: string; determination: string; methods: string[]; evidence: ApproachEvidence[]; text: string }
export interface AssessmentApproach { practiceId: string; summary: string; objectives: ApproachObjectiveBlock[] }

/** What EO knows this run about the evidence a control has (all optional; absent = not known). */
export interface HeldEvidence {
  /** Entry ids of the control's Stamper evidence records with a non-empty payload. */
  stamperEntryIds?: string[];
  /** The control's evidence-store records (from the determination ledger), when a ledger was read. */
  storeRecords?: Array<{ sourceId: string; objectiveIds: string[] }>;
  /** Count of the control's Evidence Collector uploads, when the control's sources were read. */
  ecUploads?: number;
  /** FIN-11: whether any tenant signal of the control was read successfully this run (absent = not known). */
  stackSignalsRead?: boolean;
  /** FIN-11: AdminOps command ids with a live row on the control this run (absent = not known). */
  adminOpsCommandIds?: string[];
  /** FIN-11: objective ids covered by the tenant's interview records (absent = records not read). Cited only. */
  interviewObjectiveIds?: string[];
}

let cache: { practices: Map<string, ApproachPractice>; objectives: Map<string, MatrixObjective> } | null = null;

function kb(): { practices: Map<string, ApproachPractice>; objectives: Map<string, MatrixObjective> } {
  if (cache) return cache;
  const req = createRequire(import.meta.url);
  const approach = JSON.parse(fs.readFileSync(req.resolve('ces-shared/data/assessor-approach'), 'utf-8')) as { practices: ApproachPractice[] };
  const matrix = JSON.parse(fs.readFileSync(req.resolve('ces-shared/data/assessor-evidence-matrix'), 'utf-8')) as { objectives: MatrixObjective[] };
  cache = {
    practices: new Map(approach.practices.map(p => [p.id, p])),
    objectives: new Map(matrix.objectives.map(o => [o.id, o])),
  };
  return cache;
}

/** PKG-3: the evidence-matrix rows for one 800-171A objective (e.g. "AC.L1-3.1.1[a]"); empty when unknown. */
export function objectiveEvidenceSources(objectiveId: string): EvidenceSourceRow[] {
  return (kb().objectives.get(objectiveId)?.evidence ?? []).map(r => ({ ...r }));
}

const SOURCE_LABEL: Record<CesSource, string> = {
  stack_signal: 'tenant signal',
  ao_row: 'AdminOps record',
  stamper_evidence: 'Stamper evidence',
  ec_upload: 'Evidence Collector upload',
  eo_store: 'EO evidence store',
  interview: 'interview',
};

const HELD_LABEL: Record<HeldState, string> = {
  held: 'record present this run',
  not_held: 'no record this run',
  unknown: 'not checked',
};

/** Stamper registry entry ids named in a matrix row ("AU.L2-3.3.7.time-sync", "AZ-LOG-004"). */
const STAMPER_ENTRY_RE = /\b(?:[A-Z]{2}\.L[12]-\d+\.\d+\.\d+(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+|AZ-[A-Z]+-\d{3})\b/g;
const COLLECTOR_RE = /\b(collect\.[A-Za-z0-9]+)/;
/** FIN-11: the AdminOps command a matrix `ao_row` names ("AdminOps A-21 Leaver ..."). */
const AO_COMMAND_RE = /\bAdminOps ([A-Z]-\d{2})\b/;

function heldFor(row: EvidenceSourceRow, objectiveId: string, h: HeldEvidence): HeldState {
  switch (row.ces_source) {
    case 'stamper_evidence': {
      if (!h.stamperEntryIds) return 'unknown';
      const named = row.notes.match(STAMPER_ENTRY_RE) ?? [];
      if (named.some(id => h.stamperEntryIds!.includes(id))) return 'held';
      // FIN-11: a row that names its entries is not held when none of them is. A row that names none (a gate
      // document, for example) cannot be matched to a record, so it stays unknown unless the control has none.
      if (named.length > 0 || h.stamperEntryIds.length === 0) return 'not_held';
      return 'unknown';
    }
    case 'eo_store': {
      if (!h.storeRecords) return 'unknown';
      const collector = COLLECTOR_RE.exec(row.notes)?.[1];
      const recs = collector ? h.storeRecords.filter(r => r.sourceId === collector) : h.storeRecords;
      return recs.some(r => r.objectiveIds.includes(objectiveId)) ? 'held' : 'not_held';
    }
    case 'ec_upload':
      if (h.ecUploads === undefined) return 'unknown';
      return h.ecUploads > 0 ? 'held' : 'not_held';
    case 'stack_signal':
      if (h.stackSignalsRead === undefined) return 'unknown';
      return h.stackSignalsRead ? 'held' : 'not_held';
    case 'ao_row': {
      if (!h.adminOpsCommandIds) return 'unknown';
      const command = AO_COMMAND_RE.exec(row.notes)?.[1];
      return (command ? h.adminOpsCommandIds.includes(command) : h.adminOpsCommandIds.length > 0) ? 'held' : 'not_held';
    }
    case 'interview':
      if (!h.interviewObjectiveIds) return 'unknown';
      return h.interviewObjectiveIds.includes(objectiveId) ? 'held' : 'not_held';
    default:
      return 'unknown';
  }
}

/** FIN-11: the label of one evidence row: an EC row names the upload count, every other row the held state. */
function heldLabel(e: ApproachEvidence, h: HeldEvidence): string {
  if (e.cesSource === 'ec_upload' && e.held === 'held' && h.ecUploads !== undefined) {
    return `${h.ecUploads} ${h.ecUploads === 1 ? 'upload' : 'uploads'} on this control this run`;
  }
  // FIN-26 (FD-7): an interview record is cited, never scored; the label says so wherever it is held.
  if (e.cesSource === 'interview' && e.held === 'held') return `${HELD_LABEL.held}; cited, not scored`;
  return HELD_LABEL[e.held];
}

/** The control's "Assessment approach" block, per objective; undefined when the KB has no entry for the practice. */
export function assessmentApproachFor(practiceId: string, held: HeldEvidence = {}): AssessmentApproach | undefined {
  const { practices, objectives } = kb();
  const p = practices.get(practiceId);
  if (!p) return undefined;
  return {
    practiceId,
    summary: p.what_assessor_does,
    objectives: p.objectives.map(o => {
      const evidence = (objectives.get(o.id)?.evidence ?? []).map(r => ({
        artifactType: r.artifact_type,
        cesSource: r.ces_source,
        held: heldFor(r, o.id, held),
      }));
      const sources = evidence.map(e => `${e.artifactType} (${SOURCE_LABEL[e.cesSource]}: ${heldLabel(e, held)})`).join('; ');
      return {
        objectiveId: o.id,
        determination: o.determination,
        methods: [...o.methods],
        evidence,
        text: `${o.id} ${o.determination}. Methods: ${o.methods.join(', ')}. Evidence sources: ${sources || 'none listed'}.`,
      };
    }),
  };
}

/**
 * FIN-11 (NS-audit F-9): the non-stack set, the 28 controls of `AUDIT-NONSTACK.md` section 1. A control is in it when
 * no objective of the practice has a `stack_signal` row in the KB-1 evidence matrix (25 controls), plus the three
 * the records stores decide (NS-3b). Only this set is labelled "Non-Technology Stack" in the SSP DOCX.
 */
export const STORE_DECIDED_NONSTACK: readonly string[] = ['AT.L2-3.2.1', 'AT.L2-3.2.3', 'PS.L2-3.9.2'];

let nonStackCache: Set<string> | null = null;

export function nonStackPractices(): Set<string> {
  if (nonStackCache) return nonStackCache;
  const { practices, objectives } = kb();
  const out = new Set<string>(STORE_DECIDED_NONSTACK);
  for (const p of practices.values()) {
    const rows = p.objectives.flatMap(o => objectives.get(o.id)?.evidence ?? []);
    if (p.objectives.length > 0 && !rows.some(r => r.ces_source === 'stack_signal')) out.add(p.id);
  }
  nonStackCache = out;
  return out;
}

export function isNonStackPractice(practiceId: string): boolean {
  return nonStackPractices().has(practiceId);
}
