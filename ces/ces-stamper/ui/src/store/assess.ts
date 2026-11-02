// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Assess card (legacy card 2) state: the assess stream and its #taskList entry rows, the CMMC
// posture grid and family table (handleCmmcStatus), the cached-state restore, Compute Gaps, the
// CMMC status editor (filters, export) and the evidence drill-down. Behaviour source:
// ces-stamper/public/index.html (line numbers per function). The legacy plan-less grid
// (cmmcLegacyGrid) is not re-implemented (PLAN §5, pending FG-2): its counts show in the one grid.

import { create } from 'zustand';
import type { EvidenceRecord } from 'ces-ui-kit';
import { stamperApi, stamperStreams } from '../api';
import { useWorkflowStore } from './workflow';
import {
  DEV_SLUG,
  accumulateRunLog,
  autoSaveRunLog,
  closeActiveStream,
  finishRunLog,
  initRunLog,
  openActiveStream,
  releaseActiveStream,
  useTenantStore,
} from './tenant';
import type { CardBadgeClass, StreamEvent } from './tenant';
import { onVerboseSync, syncVerbose, useConsoleStore } from './console';
import { PENDING_BADGE, useTranslateStore } from './translate';

// ---- Types ----

export type AutoType = 'automated' | 'excluded' | 'nonstack';
export type GridColumn = AutoType | 'total';
export type GridRow = 'satisfied' | 'provisional' | 'not_satisfied';
export type BucketKey = 'satisfied' | 'provisional' | 'unsat';
export type GridCategory = 'satisfied' | 'provisional' | 'excluded' | 'nonstack_oos' | 'unsat' | '';
export type ControlStatus = 'MET' | 'PARTIAL' | 'NOT_MET' | 'NOT_APPLICABLE' | 'NOT_VERIFIED' | 'UNKNOWN';

export const AUTO_TYPES: readonly AutoType[] = ['automated', 'excluded', 'nonstack'];
export const GRID_COLUMNS: readonly GridColumn[] = ['automated', 'excluded', 'nonstack', 'total'];
export const GRID_ROWS: readonly GridRow[] = ['satisfied', 'provisional', 'not_satisfied'];
export const ROW_BUCKET: Readonly<Record<GridRow, BucketKey>> = { satisfied: 'satisfied', provisional: 'provisional', not_satisfied: 'unsat' };
/** The satType each grid row opens in the editor (showCmmcGridControls L9877). */
export const ROW_SAT_TYPE: Readonly<Record<GridRow, string>> = { satisfied: 'satisfied', provisional: 'provisional', not_satisfied: 'unsat' };

export interface CmmcControlRef {
  control_id: string;
  family: string;
  practice: string;
  cmmc_level?: string;
  nist_ref?: string;
}

export interface AssessedControl {
  control_id: string;
  automationType?: string;
  sprsWeight?: number;
  registryEntryCount?: number;
  discoveredCount?: number;
  missingCount?: number;
  reason?: string;
  entryDetails?: EntryDetail[];
  _category?: string;
  [key: string]: unknown;
}

export interface EntryDetail {
  entry_id?: string;
  entryId?: string;
  label?: string;
  status?: string;
  engine?: string;
  autoClass?: string;
}

export interface FamilyStats {
  name?: string;
  total?: number;
  satisfied?: number;
  excluded?: number;
  provisional?: number;
  wontBe?: number;
  willBe?: number;
  notVerified?: number;
}

/** The `cmmc_status` event (also `/api/assess-state` `cmmcStatus`). */
export interface CmmcStatus {
  total?: number;
  hasDirectives?: boolean;
  satisfiedControls?: AssessedControl[];
  provisionalControls?: AssessedControl[];
  excludedControls?: AssessedControl[];
  nonsStackControls?: AssessedControl[];
  wontBeControls?: AssessedControl[];
  willBeControls?: AssessedControl[];
  notVerifiedControls?: AssessedControl[];
  outOfScopeControls?: AssessedControl[];
  sprsByCategory?: { satisfied?: number; provisional?: number; not_satisfied?: number };
  byFamily?: Record<string, FamilyStats>;
  [key: string]: unknown;
}

export type Buckets = Record<AutoType, Record<BucketKey, AssessedControl[]>>;

export interface GridCell {
  count: number;
  pct: string;
}

export interface GridModel {
  hasDirectives: boolean;
  /** Top-row column tallies; the directive grid only (plan-less mode leaves them at "--"). */
  summary: Record<GridColumn, number> | null;
  cells: Record<GridRow, Record<GridColumn, GridCell>>;
  sprs: Record<GridRow, number>;
  buckets: Buckets;
}

export interface FamilyRow {
  family: string;
  name: string;
  total: number;
  ok: number;
  prov: number;
  gap: number;
  greenPct: number;
  bluePct: number;
  amberPct: number;
}

export interface GapEntry {
  entry_id: string;
  label: string;
  status: string;
}

export interface GapControl {
  control_id: string;
  practice: string;
  priority: string;
  gap_entries: GapEntry[];
}

export interface GapPlan {
  summary: {
    total_gap_entries: number;
    total_controls_with_gaps: number;
    manual_only_count: number;
    automated_count: number;
    by_priority: { critical: number; high: number; medium: number; low: number };
  };
  gap_controls: GapControl[];
}

/** One `assess_check` event (assess.routes.ts). */
export interface AssessCheck {
  entryId?: string;
  label?: string;
  engine?: string;
  found?: boolean;
  status?: string;
  cmmc_controls?: string[];
  entryIndex?: number;
  command?: string;
  rawOutput?: string;
  set_command?: string;
  file?: string;
  evidenceContent?: string;
  reason?: string;
  registry?: Record<string, any> | null;
  fullRegistry?: Record<string, any> | null;
  outcome?: string | null;
  outcomeRationale?: string | null;
  complianceVerdict?: string | null;
  verdictRationale?: string | null;
  [key: string]: unknown;
}

export interface AssessEntryRow {
  key: string;
  /** console store logEpoch at the time (rows vanish when the console is cleared). */
  epoch: number;
  total: number;
  /** verboseMode when the row was written (legacy truncates at creation). */
  verbose: boolean;
  data: AssessCheck;
}

export interface TrackedEntry {
  status: 'sat' | 'gap' | 'oos';
  autoClass: 'automated' | 'manual';
  entryId?: string;
  label?: string;
  engine?: string;
}

export interface GridTracker {
  checked: number;
  total: number;
  controlHits: Record<string, { entries: Record<string, TrackedEntry> }>;
}

export interface EditorControl {
  control_id: string;
  family: string;
  cmmc_level: string | undefined;
  nist_ref: string | undefined;
  practice: string;
  status: ControlStatus;
  gridCategory: GridCategory | 'not_verified';
  implType: string;
  automationType: string;
  registryEntryCount: number;
  discoveredCount: number;
  missingCount: number;
  reason: string;
  entryDetails: EntryDetail[];
  mpSteps: MpStep[] | null;
  tmControl: Record<string, any> | null;
  tmIntents: Array<Record<string, any>> | null;
  scopeExclusion: Record<string, any> | null;
}

export interface MpStep {
  step_name: string;
  gap_classifications: string[];
  task_type: string;
  priority: string;
  support_type: string;
}

export interface EditorFilterParams {
  autoType?: string | null;
  satType?: string | null;
  familyFilter?: string;
  useExecutionData?: boolean;
}

/** Legacy openEvidenceModal argument (L11554, L11751). */
export interface EvidenceModalData {
  entryId: string;
  label: string;
  engine: string;
  outcome?: string | null;
  outcomeRationale?: string | null;
  complianceVerdict?: string | null;
  verdictRationale?: string | null;
  cmmc_controls?: string[];
  evidenceContent?: string;
  file?: string;
  command?: string;
  rawOutput?: string;
  set_command?: string;
  fullRegistry?: Record<string, any> | null;
  noEvidence?: boolean;
  expectedPath?: string;
}

// ---- Pure functions (exported for tests) ----

/** handleCmmcStatus L10214. */
export function normalizeBucket(at: string): string {
  if (at === 'document-absence' || at === 'document-prohibition') return 'excluded';
  if (at === 'inherit-fedramp') return 'automated';
  return at;
}

function emptyBuckets(): Buckets {
  return {
    automated: { satisfied: [], provisional: [], unsat: [] },
    excluded: { satisfied: [], provisional: [], unsat: [] },
    nonstack: { satisfied: [], provisional: [], unsat: [] },
  };
}

/** handleCmmcStatus L10228-10254 (identical in both grid modes). */
export function bucketCmmcStatus(d: CmmcStatus): Buckets {
  const buckets = emptyBuckets();
  for (const c of d.satisfiedControls || []) {
    const at = normalizeBucket(c.automationType || 'nonstack') as AutoType;
    if (!buckets[at]) continue;
    if (at === 'excluded' || at === 'nonstack') buckets[at].provisional.push(c);
    else buckets[at].satisfied.push(c);
  }
  for (const c of d.provisionalControls || []) {
    const at = normalizeBucket(c.automationType || 'nonstack') as AutoType;
    if (buckets[at]) buckets[at].provisional.push(c);
  }
  const unsat = (d.wontBeControls || []).concat(d.willBeControls || []).concat(d.notVerifiedControls || []);
  for (const c of unsat) {
    const at = normalizeBucket(c.automationType || 'nonstack') as AutoType;
    if (buckets[at]) buckets[at].unsat.push(c);
  }
  return buckets;
}

const pct = (count: number, total: number) => `${Math.round((count / total) * 100)}%`;

/** The grid values handleCmmcStatus writes (L10194-10422). */
export function gridFromStatus(d: CmmcStatus): GridModel {
  const total = d.total || 110;
  const buckets = bucketCmmcStatus(d);
  const cells = {} as Record<GridRow, Record<GridColumn, GridCell>>;
  for (const row of GRID_ROWS) {
    const key = ROW_BUCKET[row];
    const r = {} as Record<GridColumn, GridCell>;
    let rowTotal = 0;
    for (const at of AUTO_TYPES) {
      const count = buckets[at][key].length;
      rowTotal += count;
      r[at] = { count, pct: pct(count, total) };
    }
    r.total = { count: rowTotal, pct: pct(rowTotal, total) };
    cells[row] = r;
  }
  let summary: Record<GridColumn, number> | null = null;
  if (d.hasDirectives) {
    const tally = (at: AutoType) => buckets[at].satisfied.length + buckets[at].provisional.length + buckets[at].unsat.length;
    summary = { automated: tally('automated'), excluded: tally('excluded'), nonstack: tally('nonstack'), total: 0 };
    summary.total = summary.automated + summary.excluded + summary.nonstack;
  }
  let sprs: Record<GridRow, number>;
  if (d.sprsByCategory) {
    sprs = {
      satisfied: d.sprsByCategory.satisfied || 0,
      provisional: d.sprsByCategory.provisional || 0,
      not_satisfied: d.sprsByCategory.not_satisfied || 0,
    };
  } else {
    let unsat = 0;
    for (const at of AUTO_TYPES) for (const c of buckets[at].unsat) unsat += c.sprsWeight || 0;
    sprs = { satisfied: 0, provisional: 0, not_satisfied: unsat };
  }
  return { hasDirectives: Boolean(d.hasDirectives), summary, cells, sprs, buckets };
}

/** Family table rows (L10424-10455), families sorted. */
export function familyRowsFromStatus(d: CmmcStatus): FamilyRow[] {
  if (!d.byFamily) return [];
  return Object.keys(d.byFamily)
    .sort()
    .map((family) => {
      const f = d.byFamily![family] || {};
      const total = f.total || 1;
      const ok = (f.satisfied || 0) + (f.excluded || 0);
      const prov = f.provisional || 0;
      const gap = (f.wontBe || 0) + (f.willBe || 0) + (f.notVerified || 0);
      return {
        family,
        name: String(f.name ?? ''),
        total,
        ok,
        prov,
        gap,
        greenPct: Math.round((ok / total) * 100),
        bluePct: Math.round((prov / total) * 100),
        amberPct: Math.round((gap / total) * 100),
      };
    });
}

/** L9748. */
export function entryAutoClass(d: AssessCheck): 'automated' | 'manual' {
  const reg = d.registry || d.fullRegistry || {};
  if (d.engine === 'manual_gate' || reg['manual_only'] || !reg['set_command_template']) return 'manual';
  return 'automated';
}

/** L9755. */
export function controlAutoType(ctrl: { entries: Record<string, TrackedEntry> }): AutoType {
  let auto = 0;
  let manual = 0;
  for (const id of Object.keys(ctrl.entries)) {
    if (ctrl.entries[id]!.autoClass === 'automated') auto++;
    else manual++;
  }
  if (manual === 0 && auto > 0) return 'automated';
  if (auto === 0) return 'nonstack';
  return 'excluded';
}

export function emptyTracker(total = 0): GridTracker {
  return { checked: 0, total, controlHits: {} };
}

/** trackAssessEntry L9767 (the incremental legacy-grid update is not re-implemented). */
export function trackAssessEntry(tracker: GridTracker, d: AssessCheck): GridTracker {
  const status: TrackedEntry['status'] = d.status === 'out_of_scope' ? 'oos' : d.found ? 'sat' : 'gap';
  const autoClass = entryAutoClass(d);
  const controlHits = { ...tracker.controlHits };
  for (const cid of d.cmmc_controls || []) {
    const hit = controlHits[cid] ? { entries: { ...controlHits[cid]!.entries } } : { entries: {} as Record<string, TrackedEntry> };
    hit.entries[String(d.entryId)] = { status, autoClass };
    controlHits[cid] = hit;
  }
  return { ...tracker, checked: tracker.checked + 1, controlHits };
}

/** trackExecuteEvidence L9785, for the Execute card. */
export function trackExecuteEvidence(tracker: GridTracker, d: AssessCheck & { subId?: string }): GridTracker {
  const controls = d.cmmc_controls || [];
  if (controls.length === 0) return tracker;
  const autoClass = entryAutoClass(d);
  const controlHits = { ...tracker.controlHits };
  for (const cid of controls) {
    const hit = controlHits[cid] ? { entries: { ...controlHits[cid]!.entries } } : { entries: {} as Record<string, TrackedEntry> };
    const key = d.subId || d.entryId || `exec-${tracker.checked}`;
    hit.entries[key] = { status: 'sat', autoClass, entryId: d.subId || d.entryId || key, label: d.label || d.subId || key, engine: d.engine || '' };
    controlHits[cid] = hit;
  }
  return { ...tracker, checked: tracker.checked + 1, controlHits };
}

/** buildControlsFromGridTracker L9946 (entry rows carry `entryId`, not `entry_id`, as in legacy). */
export function buildControlsFromGridTracker(tracker: GridTracker, refControls: readonly CmmcControlRef[] | null): EditorControl[] {
  const refMap: Record<string, CmmcControlRef> = {};
  for (const r of refControls || []) refMap[r.control_id] = r;
  return Object.keys(tracker.controlHits)
    .sort()
    .map((cid) => {
      const hit = tracker.controlHits[cid]!;
      const ref = refMap[cid] || null;
      const entryDetails: EntryDetail[] = [];
      let hasGap = false;
      let hasSat = false;
      let allOos = true;
      for (const eid of Object.keys(hit.entries)) {
        const e = hit.entries[eid]!;
        entryDetails.push({ entryId: e.entryId || eid, label: e.label || eid, status: e.status, autoClass: e.autoClass || '', engine: e.engine || '' });
        if (e.status === 'gap') hasGap = true;
        if (e.status === 'sat') {
          hasSat = true;
          allOos = false;
        }
        if (e.status !== 'oos') allOos = false;
      }
      const gridCategory: GridCategory = hasGap ? 'unsat' : allOos && !hasSat ? 'nonstack_oos' : 'satisfied';
      const status: ControlStatus = gridCategory === 'satisfied' ? 'MET' : gridCategory === 'nonstack_oos' ? 'NOT_APPLICABLE' : 'NOT_MET';
      return {
        control_id: cid,
        family: ref ? ref.family : cid.substring(0, 2),
        cmmc_level: ref ? ref.cmmc_level : '',
        nist_ref: ref ? ref.nist_ref : '',
        practice: ref ? ref.practice : cid,
        status,
        gridCategory,
        implType: '',
        automationType: controlAutoType(hit),
        registryEntryCount: entryDetails.length,
        discoveredCount: entryDetails.filter((ed) => ed.status === 'sat').length,
        missingCount: entryDetails.filter((ed) => ed.status === 'gap').length,
        reason: '',
        entryDetails,
        mpSteps: null,
        tmControl: null,
        tmIntents: null,
        scopeExclusion: null,
      };
    });
}

/** mergeControlData L12015. */
export function mergeControlData(
  refControls: readonly CmmcControlRef[],
  assessData: CmmcStatus | null,
  mpData: Record<string, any> | null,
  tmData: Record<string, any> | null,
): EditorControl[] {
  const assessMap: Record<string, AssessedControl> = {};
  const category: Record<string, string> = {};
  if (assessData) {
    const all = ([] as AssessedControl[]).concat(
      assessData.satisfiedControls || [],
      assessData.provisionalControls || [],
      assessData.excludedControls || [],
      assessData.nonsStackControls || [],
      assessData.wontBeControls || [],
      assessData.willBeControls || [],
      assessData.notVerifiedControls || [],
      assessData.outOfScopeControls || [],
    );
    for (const ac of all) if (!assessMap[ac.control_id]) assessMap[ac.control_id] = ac;
    const mark = (arr: AssessedControl[] | undefined, cat: string) => {
      for (const c of arr || []) category[c.control_id] = cat;
    };
    mark(assessData.satisfiedControls, 'satisfied');
    mark(assessData.provisionalControls, 'provisional');
    mark(assessData.excludedControls, 'excluded');
    mark(assessData.nonsStackControls, 'nonstack_oos');
    mark(assessData.wontBeControls, 'unsat');
    mark(assessData.willBeControls, 'unsat');
    mark(assessData.notVerifiedControls, 'not_verified');
  }

  const mpStepMap: Record<string, MpStep[]> = {};
  if (mpData && Array.isArray(mpData['steps'])) {
    for (const step of mpData['steps']) {
      for (const cc of step.control_coverage || []) {
        (mpStepMap[cc.control_id] ||= []).push({
          step_name: step.step_name || step.name || '',
          gap_classifications: step.gap_classifications || [],
          task_type: step.task_type || '',
          priority: step.priority || '',
          support_type: cc.support_type || '',
        });
      }
    }
  }
  const tmControlMap: Record<string, Record<string, any>> = {};
  if (tmData && Array.isArray(tmData['normative_controls'])) {
    for (const nc of tmData['normative_controls']) tmControlMap[nc.control_id] = nc;
  }
  const tmIntentMap: Record<string, Array<Record<string, any>>> = {};
  if (tmData && Array.isArray(tmData['config_intents'])) {
    for (const ci of tmData['config_intents']) {
      for (const id of ci.control_ids || []) (tmIntentMap[id] ||= []).push(ci);
    }
  }

  return refControls.map((ref) => {
    const aData = assessMap[ref.control_id] || null;
    const mpSteps = mpStepMap[ref.control_id] || null;
    let status: ControlStatus = 'UNKNOWN';
    let gridCategory: EditorControl['gridCategory'] = '';
    const cat = category[ref.control_id] || '';
    if (aData && assessData) {
      if (cat === 'satisfied' || aData._category === 'satisfied' || (assessData.satisfiedControls || []).indexOf(aData) !== -1) {
        status = 'MET';
        gridCategory = 'satisfied';
      } else if (cat === 'provisional') {
        status = 'PARTIAL';
        gridCategory = 'provisional';
      } else if (cat === 'excluded') {
        status = 'NOT_APPLICABLE';
        gridCategory = 'excluded';
      } else if (cat === 'nonstack_oos' || aData._category === 'out_of_scope' || (assessData.outOfScopeControls || []).indexOf(aData) !== -1) {
        status = 'NOT_APPLICABLE';
        gridCategory = 'nonstack_oos';
      } else if (cat === 'not_verified' || aData._category === 'not_verified') {
        status = 'NOT_VERIFIED';
        gridCategory = 'unsat';
      } else if (cat === 'unsat' || aData._category === 'will_be_satisfied' || (assessData.willBeControls || []).indexOf(aData) !== -1) {
        status = 'PARTIAL';
        gridCategory = 'unsat';
      } else {
        status = 'NOT_MET';
        gridCategory = 'unsat';
      }
    }
    let implType = '';
    if (mpSteps && mpSteps.length > 0) {
      const gc = new Set<string>();
      for (const s of mpSteps) for (const g of s.gap_classifications || []) gc.add(g);
      if (gc.has('scoped_out')) implType = 'Scoped Out';
      else if (gc.has('control_not_available')) implType = 'Not Available';
      else if (gc.has('manual_alternative')) implType = 'Manual Alternative';
      else if (gc.has('manual')) implType = 'Manual Process';
      else if (gc.has('configure') || gc.has('customize') || gc.has('auto_generate')) implType = 'Automated';
    }
    let scopeExclusion: Record<string, any> | null = null;
    if (mpData && Array.isArray(mpData['scope_exclusions'])) {
      scopeExclusion = mpData['scope_exclusions'].find((exc: any) => exc.affected_controls && exc.affected_controls.indexOf(ref.control_id) !== -1) || null;
    }
    return {
      control_id: ref.control_id,
      family: ref.family,
      cmmc_level: ref.cmmc_level,
      nist_ref: ref.nist_ref,
      practice: ref.practice,
      status,
      gridCategory,
      implType,
      automationType: aData ? aData.automationType || 'nonstack' : '',
      registryEntryCount: aData ? aData.registryEntryCount || 0 : 0,
      discoveredCount: aData ? aData.discoveredCount || 0 : 0,
      missingCount: aData ? aData.missingCount || 0 : 0,
      reason: aData ? aData.reason || '' : '',
      entryDetails: aData ? aData.entryDetails || [] : [],
      mpSteps,
      tmControl: tmControlMap[ref.control_id] || null,
      tmIntents: tmIntentMap[ref.control_id] || null,
      scopeExclusion,
    };
  });
}

export interface EditorFilters {
  params: EditorFilterParams | null;
  family: string;
  status: string;
  impl: string;
  search: string;
}

/** applyEditorFilters L12261. */
export function filterEditorControls(controls: readonly EditorControl[], f: EditorFilters): EditorControl[] {
  const term = f.search.trim().toLowerCase();
  return controls.filter((c) => {
    if (f.params) {
      if (f.params.satType && c.gridCategory !== f.params.satType) return false;
      if (f.params.autoType && c.automationType !== f.params.autoType) return false;
    }
    if (f.family && c.family !== f.family) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.impl && c.implType !== f.impl) return false;
    if (term && (c.control_id + ' ' + c.practice + ' ' + c.nist_ref).toLowerCase().indexOf(term) === -1) return false;
    return true;
  });
}

const AUTO_LABELS: Record<string, string> = { automated: 'Automated', excluded: 'Excluded', nonstack: 'NonStack' };
const SAT_LABELS: Record<string, string> = {
  satisfied: 'Satisfied',
  provisional: 'Provisional',
  excluded: 'Excluded',
  nonstack_oos: 'Non-Stack',
  unsat: 'Not Satisfied / Not Verified',
};

/** #edFilterCount text (L12296-12307). */
export function editorCountLabel(shown: number, total: number, params: EditorFilterParams | null): string {
  let label = '';
  if (params) {
    const parts: string[] = [];
    if (params.autoType) parts.push(AUTO_LABELS[params.autoType] || params.autoType);
    if (params.satType) parts.push(SAT_LABELS[params.satType] || params.satType);
    if (parts.length > 0) label = ` (${parts.join(', ')})`;
  }
  return `${shown} of ${total} controls${label}`;
}

/** renderEditorDashboard L12191 (NOT_VERIFIED is not a tile, as in legacy). */
export function editorStatusCounts(controls: readonly EditorControl[]): Record<'MET' | 'PARTIAL' | 'NOT_MET' | 'NOT_APPLICABLE' | 'UNKNOWN', number> {
  const counts = { MET: 0, PARTIAL: 0, NOT_MET: 0, NOT_APPLICABLE: 0, UNKNOWN: 0 };
  for (const c of controls) if (c.status in counts) counts[c.status as keyof typeof counts]++;
  return counts;
}

/** renderEditorNav L12224: family -> count, sorted. */
export function editorFamilies(controls: readonly EditorControl[]): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const c of controls) counts[c.family] = (counts[c.family] || 0) + 1;
  return Object.keys(counts)
    .sort()
    .map((f) => [f, counts[f]!]);
}

/** exportReviewerData L12544 (content; the screen downloads it). */
export function buildReviewerExport(controls: readonly EditorControl[], exportedAt = new Date().toISOString()) {
  return {
    exported_at: exportedAt,
    total_controls: controls.length,
    controls: controls.map((c) => ({
      control_id: c.control_id,
      family: c.family,
      practice: c.practice,
      status: c.status,
      category: c.gridCategory,
      implType: c.implType,
      automationType: c.automationType,
      registryEntryCount: c.registryEntryCount,
      discoveredCount: c.discoveredCount,
      reason: c.reason,
      entryDetails: (c.entryDetails || []).map((ed) => ({ entry_id: ed.entry_id, status: ed.status, label: ed.label, engine: ed.engine })),
      hasMP: !!c.mpSteps,
      hasTM: !!c.tmControl,
      scopeExclusion: c.scopeExclusion ? { si_field: c.scopeExclusion['si_field'], justification: c.scopeExclusion['justification'] } : null,
    })),
  };
}

export function reviewerExportFilename(date = new Date()): string {
  return `cmmc-review-${date.toISOString().slice(0, 10)}.json`;
}

/** The legacy modal fields as the kit EvidenceViewer's record. */
export function modalDataToEvidence(m: EvidenceModalData): EvidenceRecord {
  const registryEntry = (m.fullRegistry as EvidenceRecord['registryEntry']) || {
    entry_id: m.entryId,
    label: m.label,
    engine: m.engine,
    ...(m.command ? { get_command: m.command } : {}),
    ...(m.set_command ? { set_command: m.set_command } : {}),
  };
  if (m.noEvidence) return { noEvidence: true, expectedPath: m.expectedPath, registryEntry };
  const record: EvidenceRecord = {
    registryEntry: { ...registryEntry, entry_id: registryEntry.entry_id || m.entryId, label: registryEntry.label || m.label },
    cmmc_controls: m.cmmc_controls || [],
  };
  if (m.outcome) record.outcome = m.outcome;
  if (m.outcomeRationale) record.outcomeRationale = m.outcomeRationale;
  if (m.complianceVerdict) record.complianceVerdict = m.complianceVerdict;
  if (m.verdictRationale) record.verdictRationale = m.verdictRationale;
  if (m.rawOutput) record.rawResponse = m.rawOutput;
  if (m.evidenceContent) record.evidenceContent = m.evidenceContent;
  if (m.file) record['file'] = m.file;
  return record;
}

/** Entry-row status icon, row class and verdict class (handleAssessEvent L7433-7447). */
export function assessRowClasses(d: AssessCheck): { icon: string; iconCls: string; rowCls: string; verdictCls: string } {
  let icon: string;
  let iconCls: string;
  let rowCls: string;
  if (d.found) {
    icon = '✓';
    iconCls = 'sat';
    rowCls = d.status || 'exists';
  } else if (d.status === 'error') {
    icon = '✗';
    iconCls = 'err';
    rowCls = 'error';
  } else if (d.status === 'skipped' || d.status === 'no_query') {
    icon = '—';
    iconCls = 'skip';
    rowCls = String(d.status);
  } else if (d.status === 'out_of_scope') {
    icon = '⚐';
    iconCls = 'sat';
    rowCls = 'out_of_scope';
  } else {
    icon = '○';
    iconCls = 'unsat';
    rowCls = 'missing';
  }
  const verdictCls = d.found ? 'sat' : d.status === 'error' ? 'err' : d.status === 'skipped' || d.status === 'no_query' ? 'skip-verdict' : 'unsat';
  return { icon, iconCls, rowCls, verdictCls };
}

/** checkTenantFields L6271 for the Assess card: required auth fields absent from the tenant config. */
export const ASSESS_REQUIRED_FIELDS: readonly string[] = ['tenant.tenant_id', 'auth.app_id', 'auth.cert_thumbprint', 'auth.cert_path'];

export function missingTenantFields(tenant: string, config: Record<string, unknown>): string[] | null {
  if (tenant === DEV_SLUG) return null;
  const missing = ASSESS_REQUIRED_FIELDS.filter((field) => {
    let val: unknown = config || {};
    for (const part of field.split('.')) val = val ? (val as Record<string, unknown>)[part] : undefined;
    return !val || (typeof val === 'string' && !val.trim());
  });
  return missing.length ? missing : null;
}

// ---- Store ----

export interface EvidenceViewState {
  open: boolean;
  record: EvidenceRecord | null;
  nav: EntryDetail[];
  index: number;
}

export interface EditorState {
  open: boolean;
  controls: EditorControl[] | null;
  family: string;
  params: EditorFilterParams | null;
  status: string;
  impl: string;
  search: string;
  /** "Showing execution results" banner (grid-tracker mode). */
  executionBanner: boolean;
}

export interface AssessState {
  /** Page-load /api/cmmc-controls map (legacy _cmmcControlMap L5158), for the Execute drill-down. */
  controlMap: Record<string, { practice: string; family: string; cmmc_level?: string }>;
  /** Editor reference controls (legacy _cmmcRefControls, fetched on first editor open). */
  refControls: CmmcControlRef[] | null;
  running: boolean;
  /** #assessCounter text. */
  counter: string;
  stale: boolean;
  badge: { text: string; className: CardBadgeClass };
  /** Legacy setCardState: 'active' while assessing, 'done' after (adds card-done). */
  cardState: '' | 'active' | 'done';
  collapsed: boolean;
  /** "Missing tenant config fields" banner (checkTenantFields L6271), set on each Assess click. */
  configWarn: string[] | null;
  /** #verboseAssess shows checked; the legacy verboseMode flag stays false until the box changes. */
  verboseChecked: boolean;
  verboseMode: boolean;
  uploadToBlob: boolean;
  totalEntries: number;
  entries: AssessEntryRow[];
  evidenceMap: Record<string, AssessCheck>;
  tracker: GridTracker;
  cmmc: CmmcStatus | null;
  grid: GridModel | null;
  families: FamilyRow[];
  /** cmmc_summary_sprs: "110 pts" until the first reset, then "--" (legacy never refills it). */
  summarySprs: string;
  reviewToggleVisible: boolean;
  reviewCollapsed: boolean;
  gapPlan: GapPlan | null;
  computingGaps: boolean;
  openEditorAfterAssess: boolean;
  editor: EditorState;
  evidence: EvidenceViewState;

  loadControlMap: () => Promise<void>;
  resetCmmcTiles: () => void;
  applyCmmcStatus: (d: CmmcStatus) => void;
  loadCachedState: (tenant: string) => Promise<void>;
  markAssessStale: () => void;
  setVerbose: (checked: boolean) => void;
  setUploadToBlob: (checked: boolean) => void;
  doAssess: () => void;
  haltAssess: () => void;
  computeGaps: () => Promise<void>;
  toggleReviewDetail: () => void;
  toggleCard: () => void;
  showGridControls: (autoType: GridColumn, satType: string) => Promise<void>;
  openEditor: (useFreshAssess: boolean, params?: EditorFilterParams | null) => Promise<void>;
  closeEditor: () => void;
  setEditorFamily: (family: string) => void;
  setEditorFilter: (patch: Partial<Pick<EditorState, 'status' | 'impl' | 'search'>>) => void;
  /** Control card click: evidence for its first entry with prev/next, else expand (toggleCtrlCard L12509). */
  openControlEvidence: (control: EditorControl) => boolean;
  showEvidenceForEntry: (entryId: string, label: string, engine: string) => Promise<void>;
  openEvidenceModal: (data: EvidenceModalData) => void;
  evidenceNav: (delta: 1 | -1) => void;
  closeEvidence: () => void;
  trackExecuteEvidence: (d: AssessCheck & { subId?: string }) => void;
  reset: () => void;
}

const CLOSED_EVIDENCE: EvidenceViewState = { open: false, record: null, nav: [], index: 0 };

function initialState() {
  return {
    controlMap: {},
    refControls: null as CmmcControlRef[] | null,
    running: false,
    counter: '',
    stale: false,
    badge: { text: 'Pending', className: 'status-default' as CardBadgeClass },
    cardState: '' as '' | 'active' | 'done',
    collapsed: false,
    configWarn: null as string[] | null,
    verboseChecked: true,
    verboseMode: false,
    uploadToBlob: true,
    totalEntries: 0,
    entries: [] as AssessEntryRow[],
    evidenceMap: {} as Record<string, AssessCheck>,
    tracker: emptyTracker(),
    cmmc: null as CmmcStatus | null,
    grid: null as GridModel | null,
    families: [] as FamilyRow[],
    summarySprs: '110 pts',
    reviewToggleVisible: false,
    reviewCollapsed: false,
    gapPlan: null as GapPlan | null,
    computingGaps: false,
    openEditorAfterAssess: false,
    editor: { open: false, controls: null, family: '', params: null, status: '', impl: '', search: '', executionBanner: false } as EditorState,
    evidence: CLOSED_EVIDENCE,
  };
}

let entrySeq = 0;

function tenantSlug(): string {
  return useTenantStore.getState().slug;
}

async function fetchJsonFile(filePath: string): Promise<Record<string, any> | null> {
  try {
    return (await stamperApi.readPlanFile(filePath)) as Record<string, any>;
  } catch {
    return null;
  }
}

export const useAssessStore = create<AssessState>()((set, get) => ({
  ...initialState(),

  // L5158 loadCmmcControlMap
  loadControlMap: async () => {
    try {
      const data = (await stamperApi.cmmcControls()) as { controls?: CmmcControlRef[] };
      const map: AssessState['controlMap'] = {};
      for (const c of (data && data.controls) || []) map[c.control_id] = { practice: c.practice, family: c.family, cmmc_level: c.cmmc_level };
      set({ controlMap: map });
    } catch {
      /* drill-down lacks descriptions (legacy comment) */
    }
  },

  // L10110
  resetCmmcTiles: () => set({ cmmc: null, grid: null, families: [], summarySprs: '--' }),

  // L10194
  applyCmmcStatus: (d) =>
    set({ cmmc: d, grid: gridFromStatus(d), families: familyRowsFromStatus(d), stale: false, reviewToggleVisible: true }),

  // L5026
  loadCachedState: async (tenant) => {
    if (!tenant || tenant === DEV_SLUG) return;
    try {
      const data = (await stamperApi.getAssessState(tenant)) as { ok?: boolean; accomplishedIds?: unknown; cmmcStatus?: CmmcStatus; timestamp?: string };
      if (!data || data.ok === false || !data.accomplishedIds) return;
      get().resetCmmcTiles();
      if (data.cmmcStatus) get().applyCmmcStatus(data.cmmcStatus);
      const workflow = useWorkflowStore.getState();
      workflow.setStepState('translate', 'ready');
      // FIN-33: card 3 reads Pending, not Locked, once Translate is ready (legacy L5042).
      useTranslateStore.getState().setBadge(PENDING_BADGE);
      let executedAt: string | null = null;
      try {
        executedAt = window.localStorage.getItem(`executedAt_${tenant}`);
      } catch {
        executedAt = null;
      }
      if (executedAt && data.timestamp && new Date(executedAt) > new Date(data.timestamp)) {
        get().markAssessStale();
      } else {
        useWorkflowStore.getState().setStepState('assess', 'done');
        set({ cardState: 'done', collapsed: true, badge: { text: 'Assessed', className: 'status-done' } });
      }
    } catch {
      /* legacy: catch (_e) {} */
    }
  },

  // L4807
  markAssessStale: () => {
    useWorkflowStore.getState().setStepState('assess', 'ready');
    set({ stale: true, badge: { text: 'Stale', className: 'status-default' } });
  },

  // L4699 syncVerbose (the Execute card's own box follows the same flag in legacy)
  // FIN-33: one verbose flag; #verboseExecute follows (legacy syncVerbose L4699).
  setVerbose: (checked) => {
    set({ verboseChecked: checked, verboseMode: checked });
    syncVerbose(checked);
  },
  setUploadToBlob: (checked) => set({ uploadToBlob: checked }),

  // L7225 doAssess
  doAssess: () => {
    const tenantStore = useTenantStore.getState();
    const tenant = tenantStore.slug;
    set({ configWarn: missingTenantFields(tenant, tenantStore.tenantConfig) });
    if (!tenant || tenant === DEV_SLUG) {
      tenantStore.showStatus('Select a tenant before assessing readiness.', 'error');
      return;
    }
    tenantStore.showStatus('Querying tenant infrastructure...', 'info');
    useWorkflowStore.getState().setStepState('assess', 'running');
    set({
      stale: false,
      running: true,
      cardState: 'active',
      collapsed: false,
      counter: '0',
      badge: { text: 'Assessing...', className: 'status-running' },
    });
    tenantStore.clearLog();
    set({ entries: [] });
    get().resetCmmcTiles();
    initRunLog();

    const epPath = (useTranslateStore.getState().outputPath || '').trim();
    const { verboseMode, uploadToBlob } = get();
    const url = stamperStreams.assess({ tenant, verbose: verboseMode, uploadToBlob, planFile: epPath || undefined });
    const source = openActiveStream(
      url,
      (d) => handleAssessEvent(d),
      () => {
        useTenantStore.getState().showStatus('Assessment connection error.', 'error');
        useWorkflowStore.getState().setStepState('assess', 'failed');
        releaseActiveStream(source);
        set({ running: false, badge: { text: 'Error', className: 'status-error' } });
      },
    );
  },

  // L7103
  haltAssess: () => {
    closeActiveStream();
    const tenantStore = useTenantStore.getState();
    tenantStore.showStatus('Assessment halted by operator.', 'error');
    useWorkflowStore.getState().setStepState('assess', 'failed');
    set({ running: false, badge: { text: 'Error', className: 'status-error' } });
    tenantStore.appendLog('Assessment halted.', 'success');
    finishRunLog();
    void autoSaveRunLog();
  },

  // L7294
  computeGaps: async () => {
    const tenantStore = useTenantStore.getState();
    const tenant = tenantStore.slug;
    if (!tenant || tenant === DEV_SLUG) {
      tenantStore.showStatus('Select a tenant before computing gaps.', 'error');
      return;
    }
    set({ computingGaps: true });
    tenantStore.showStatus('Computing gap-remediation plan from cached assess state...', 'info');
    type GapsReply = { success?: boolean; error?: string; plan?: GapPlan };
    let body: GapsReply | null = null;
    let ok = true;
    try {
      body = (await stamperApi.computeGaps(tenant)) as GapsReply;
    } catch (err) {
      const payload = (err as { payload?: unknown }).payload;
      if (payload && typeof payload === 'object') {
        ok = false;
        body = payload as GapsReply;
      } else {
        set({ computingGaps: false });
        useTenantStore.getState().showStatus(`Compute Gaps request failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
        return;
      }
    }
    set({ computingGaps: false });
    if (!ok || !body || body.success !== true || !body.plan) {
      useTenantStore.getState().showStatus((body && body.error) || 'Failed to compute gaps.', 'error');
      return;
    }
    set({ gapPlan: body.plan });
    useTenantStore
      .getState()
      .showStatus(
        `Gap-remediation plan computed: ${body.plan.summary.total_gap_entries} gap entries across ${body.plan.summary.total_controls_with_gaps} controls.`,
        'success',
      );
  },

  toggleReviewDetail: () => set((s) => ({ reviewCollapsed: !s.reviewCollapsed })),
  toggleCard: () => set((s) => ({ collapsed: !s.collapsed })),

  // L9877 showCmmcGridControls
  showGridControls: async (autoType, satType) => {
    const autoTypeFilter = autoType === 'automated' || autoType === 'excluded' || autoType === 'nonstack' ? autoType : null;
    const known = ['satisfied', 'provisional', 'excluded', 'nonstack_oos', 'unsat'];
    const satTypeFilter = known.includes(satType) ? satType : null;
    await get().openEditor(false, {
      autoType: autoTypeFilter,
      satType: satTypeFilter,
      useExecutionData: Object.keys(get().tracker.controlHits).length > 0,
    });
  },

  // L11850 openCmmcEditor
  openEditor: async (useFreshAssess, params = null) => {
    set((s) => ({ editor: { ...s.editor, params: params || null } }));
    if (useFreshAssess) {
      set({ openEditorAfterAssess: true });
      get().doAssess();
      return;
    }
    if (!get().refControls) {
      try {
        const data = (await stamperApi.cmmcControls()) as { controls?: CmmcControlRef[] };
        set({ refControls: (data && data.controls) || [] });
      } catch {
        useTenantStore.getState().showStatus('Failed to load CMMC reference controls', 'error');
        return;
      }
    }
    const refControls = get().refControls || [];
    if (params && params.useExecutionData) {
      const controls = buildControlsFromGridTracker(get().tracker, refControls);
      set((s) => ({ editor: { ...s.editor, open: true, controls, family: '', executionBanner: true } }));
      return;
    }
    const paths = useTranslateStore.getState();
    let mpPath = paths.missionPlan.trim();
    let tmPath = paths.manifest.trim();
    if (!mpPath || !tmPath) {
      try {
        const pd = (await stamperApi.planDataPaths(tenantSlug() || DEV_SLUG)) as { ok?: boolean; missionPlan?: string; manifest?: string };
        if (pd && pd.ok) {
          if (!mpPath && pd.missionPlan) mpPath = pd.missionPlan;
          if (!tmPath && pd.manifest) tmPath = pd.manifest;
        }
      } catch {
        /* proceed without */
      }
    }
    const mpData = mpPath ? await fetchJsonFile(mpPath) : null;
    const tmData = tmPath ? await fetchJsonFile(tmPath) : null;
    const controls = mergeControlData(refControls, get().cmmc, mpData, tmData);
    set((s) => ({
      editor: { ...s.editor, open: true, controls, family: (params && params.familyFilter) || '', executionBanner: false },
    }));
  },

  closeEditor: () => set((s) => ({ editor: { ...s.editor, open: false } })),
  setEditorFamily: (family) => set((s) => ({ editor: { ...s.editor, family } })),
  setEditorFilter: (patch) => set((s) => ({ editor: { ...s.editor, ...patch } })),

  openControlEvidence: (control) => {
    if (control.entryDetails && control.entryDetails.length > 0) {
      const first = control.entryDetails[0]!;
      set({ evidence: { ...CLOSED_EVIDENCE, nav: control.entryDetails, index: 0 } });
      void get().showEvidenceForEntry(String(first.entry_id), first.label || '', first.engine || '');
      return true;
    }
    return false;
  },

  // L11751
  showEvidenceForEntry: async (entryId, label, engine) => {
    const cached = get().evidenceMap[entryId];
    if (cached) {
      get().openEvidenceModal({
        entryId: cached.entryId || entryId,
        label: cached.label || label,
        outcome: cached.outcome || null,
        outcomeRationale: cached.outcomeRationale || null,
        complianceVerdict: cached.complianceVerdict || null,
        verdictRationale: cached.verdictRationale || null,
        cmmc_controls: cached.cmmc_controls || [],
        evidenceContent: cached.evidenceContent || '',
        file: cached.file || '',
        engine: cached.engine || engine,
        command: cached.command || '',
        rawOutput: cached.rawOutput || '',
        set_command: cached.set_command || '',
        fullRegistry: cached.fullRegistry || cached.registry || null,
      });
      return;
    }
    const tenant = tenantSlug() || DEV_SLUG;
    try {
      let data: Record<string, any>;
      try {
        data = (await stamperApi.evidenceContent(tenant, entryId)) as Record<string, any>;
      } catch (err) {
        const payload = (err as { payload?: unknown }).payload;
        if (!payload || typeof payload !== 'object') throw err;
        data = payload as Record<string, any>;
      }
      if (data['error']) {
        get().openEvidenceModal({ entryId, label, engine, noEvidence: true, expectedPath: data['error'] || 'Unknown path' });
        return;
      }
      const structured = (data['structured'] || {}) as Record<string, any>;
      const reg = (structured['registryEntry'] || {}) as Record<string, any>;
      const vr = structured['verificationResult'];
      get().openEvidenceModal({
        entryId,
        label: reg['label'] || label,
        engine: reg['engine'] || engine,
        outcome: structured['outcome'] || null,
        outcomeRationale: structured['outcomeRationale'] || null,
        complianceVerdict: structured['complianceVerdict'] || (vr ? (vr.passed ? 'SAT' : 'UNSAT') : null),
        verdictRationale: structured['verdictRationale'] || (vr ? vr.reason : null),
        cmmc_controls: reg['control_ids'] || structured['cmmc_controls'] || (structured['metadata'] ? structured['metadata'].controlIds : null) || [],
        evidenceContent: data['content'] || '',
        file: data['file'] || '',
        command: structured['command'] || (structured['metadata'] ? structured['metadata'].commandExecuted : '') || '',
        rawOutput: String(structured['rawResponse'] || structured['rawOutput'] || structured['output'] || '')
          .replace(/\r?\nSTAMPER_EXECUTION_SUCCESS\s*$/, '')
          .replace(/^STAMPER_EXECUTION_SUCCESS\r?\n?$/, ''),
        set_command: structured['set_command'] || '',
        fullRegistry: reg['entry_id'] ? reg : null,
      });
    } catch {
      get().openEvidenceModal({ entryId, label, engine, noEvidence: true, expectedPath: 'Network error fetching evidence' });
    }
  },

  openEvidenceModal: (data) => set((s) => ({ evidence: { ...s.evidence, open: true, record: modalDataToEvidence(data) } })),

  // L11806-11818
  evidenceNav: (delta) => {
    const { nav, index } = get().evidence;
    const next = index + delta;
    if (next < 0 || next > nav.length - 1) return;
    set((s) => ({ evidence: { ...s.evidence, index: next } }));
    const entry = nav[next]!;
    void get().showEvidenceForEntry(String(entry.entry_id), entry.label || '', entry.engine || '');
  },

  closeEvidence: () => set({ evidence: CLOSED_EVIDENCE }),

  trackExecuteEvidence: (d) => set((s) => ({ tracker: trackExecuteEvidence(s.tracker, d) })),

  reset: () => set(initialState()),
}));

// FIN-33: mirror the one verbose flag (console.ts syncVerbose).
onVerboseSync((on) => {
  const st = useAssessStore.getState();
  if (st.verboseChecked !== on || st.verboseMode !== on) useAssessStore.setState({ verboseChecked: on, verboseMode: on });
});

// L7371 handleAssessEvent
function handleAssessEvent(d: StreamEvent): void {
  accumulateRunLog(d);
  const tenantStore = useTenantStore.getState();
  const store = useAssessStore.getState();
  const type = d['type'];
  if (type === 'connection_log') {
    const phase = d['phase'];
    const message = String(d['message'] ?? '');
    if (phase === 'config_loaded') {
      tenantStore.setConnectionState('connecting', `Config loaded — ${d['tenant']}`, 'Connecting');
      tenantStore.appendLog(message, 'info');
    } else if (phase === 'connecting') {
      tenantStore.appendLog(message, 'info');
    } else if (phase === 'connected') {
      tenantStore.setConnectionState('connected', String(d['tenant']), '');
      tenantStore.appendLog(message, 'success');
    } else if (phase === 'error') {
      tenantStore.appendLog(message, 'error');
    } else {
      tenantStore.appendLog(String(d['message'] || phase), 'info');
    }
  } else if (type === 'assess_start') {
    useAssessStore.setState({ evidenceMap: {}, totalEntries: d['totalEntries'] || 0, tracker: emptyTracker(d['totalEntries']) });
    tenantStore.appendLog(`Evidence directory: ${d['evidencePath'] || '?'}`, 'info');
  } else if (type === 'assess_phase') {
    if (d['phase'] === 'imported') tenantStore.appendLog(`Found ${d['count']} pre-existing evidence files`, 'info');
    else if (d['phase'] === 'fallback_scan') tenantStore.appendLog('Scanning for resources by type...', 'info');
    else if (d['phase'] === 'live') tenantStore.appendLog(`Running live queries against ${d['count']} registry entries...`, 'info');
  } else if (type === 'fallback_resolved') {
    tenantStore.appendLog(`[auto-discovered] ${d['variable']} = "${d['value']}" (1 ${d['resourceType']} in RG)`, 'success');
  } else if (type === 'fallback_ambiguous') {
    tenantStore.appendLog(
      `[!] ${d['variable']}: ${d['count']} ${d['resourceType']}s found — ${(d['candidates'] || []).join(', ')} — set in tenant config`,
      'warn',
    );
  } else if (type === 'fallback_not_found') {
    tenantStore.appendLog(`[–] ${d['variable']}: No ${d['resourceType']}s in RG`, 'info');
  } else if (type === 'assess_check') {
    const check = d as AssessCheck;
    useAssessStore.setState((s) => ({
      counter: String((parseInt(s.counter, 10) || 0) + 1),
      evidenceMap: { ...s.evidenceMap, [String(check.entryId)]: check },
      tracker: trackAssessEntry(s.tracker, check),
      entries: [
        ...s.entries,
        { key: `assess-${++entrySeq}`, epoch: useConsoleStore.getState().logEpoch, total: s.totalEntries, verbose: s.verboseMode, data: check },
      ],
    }));
  } else if (type === 'assess_summary') {
    tenantStore.appendLog(`Assessment complete: ${d['accomplished']} already done, ${d['pending']} pending`, 'success');
    tenantStore.showStatus('Assessment complete — CMMC posture incoming', 'success');
  } else if (type === 'cmmc_status') {
    store.applyCmmcStatus(d as CmmcStatus);
  } else if (type === 'assess_done') {
    closeActiveStream();
    const workflow = useWorkflowStore.getState();
    workflow.setStepState('assess', 'done');
    workflow.setStepState('translate', 'ready');
    // FIN-33: card 3 reads Pending once Translate is ready (legacy L7610).
    useTranslateStore.getState().setBadge(PENDING_BADGE);
    useAssessStore.setState({ running: false, cardState: 'done', collapsed: true, badge: { text: 'Assessed', className: 'status-done' } });
    const tenant = tenantStore.slug || '';
    if (tenant && tenant !== DEV_SLUG) {
      try {
        window.localStorage.removeItem(`executedAt_${tenant}`);
      } catch {
        /* storage unavailable */
      }
    }
    tenantStore.appendLog('Assessment complete.', 'success');
    if (useAssessStore.getState().openEditorAfterAssess) {
      useAssessStore.setState({ openEditorAfterAssess: false });
      void useAssessStore.getState().openEditor(false, useAssessStore.getState().editor.params);
    }
    const grid = useAssessStore.getState().grid;
    let sat = 0;
    let gap = 0;
    if (grid) {
      for (const at of AUTO_TYPES) {
        sat += grid.buckets[at].satisfied.length + grid.buckets[at].provisional.length;
        gap += grid.buckets[at].unsat.length;
      }
    }
    tenantStore.notifyRunEnd('assess', true, `${sat} completed / ${gap} not satisfied`);
    void autoSaveRunLog();
  } else if (type === 'error') {
    tenantStore.showStatus(`Assessment error: ${d['message']}`, 'error');
    useWorkflowStore.getState().setStepState('assess', 'failed');
    useAssessStore.setState({ running: false, badge: { text: 'Error', className: 'status-error' } });
    closeActiveStream();
  }
}
